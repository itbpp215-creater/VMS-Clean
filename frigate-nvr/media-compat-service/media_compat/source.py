"""Resolve validated requests into fixed Frigate-internal media source URLs.

This module never reads recordings, configuration, Docker, or camera streams.
It only probes two allowlisted Frigate API route families through an injected,
bounded ``httpx.AsyncClient`` before producing a redacted source contract.
"""

import re
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from media_compat.auth import UserContext
from media_compat.models import EventSource, PrepareRequest, ResolvedSource, TimelineSource
from media_compat.settings import FRIGATE_BASE_URL, Settings

# These scalar grammars mirror the request contract and protect direct model bypasses.
_EVENT_ID_PATTERN = re.compile(r"[A-Za-z0-9_.:-]{1,160}")
_CAMERA_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}")


def authorize_source(user: UserContext, source: PrepareRequest) -> None:
    """Authorize an immutable source request using only a trusted gateway role.

    ``user`` must be the gateway-authenticated context and ``source`` is the
    already parsed selector whose type does not change this initial policy.  The
    function returns no value or side effect on success; blank or unknown roles
    raise HTTP 403 before any Frigate metadata or media request is attempted.
    """
    # Keep source policy centralized and deny runtime-created contexts outside RBAC literals.
    if user.role not in {"user", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


class SourceResolver:
    """Validate source availability with fixed Frigate calls and bounded timeouts.

    ``client`` is an injected internal HTTP dependency and ``settings`` supplies
    validated operational limits.  Resolver methods perform only
    GET/HEAD calls to allowlisted routes; they never open filesystem paths or
    accept a caller-provided URL, path, query string, or Frigate configuration.
    """

    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        """Store injected transport and immutable bounds for later resolution.

        Inputs are a caller-owned async client and validated settings; the
        constructor returns no value and performs no I/O.  A per-call timeout is
        created from settings so every later Frigate request is strictly bounded.
        """
        # Retain only the injected client; its lifecycle is closed through ``aclose`` below.
        self._client = client
        # Convert the approved whole-second timeout into httpx's bounded timeout object.
        self._timeout = httpx.Timeout(settings.frigate_timeout_seconds)
        # Pin outbound authority to the module constant so even a bypassed settings object cannot redirect I/O.
        self._base_url = FRIGATE_BASE_URL
        # Store the validated export ceiling to reject excessive timeline work before I/O.
        self._maximum_duration_seconds = settings.max_export_duration_seconds

    async def aclose(self) -> None:
        """Close the injected client when this resolver's owning scope finishes.

        The method takes no input and returns no value after releasing the async
        HTTP client's resources.  It performs only client cleanup and never
        contacts Frigate, reads files, or alters the caller's media source.
        """
        # Delegate cleanup to the injected transport after tests or an application scope finish.
        await self._client.aclose()

    async def resolve(self, request: PrepareRequest, user: UserContext) -> ResolvedSource:
        """Resolve one authorized event or timeline only after availability probes.

        ``request`` is an immutable selector and ``user`` is trusted gateway
        identity; the return is a redacted ``ResolvedSource``.  The method makes
        bounded fixed-route I/O only after authorization and scalar validation;
        malformed, unavailable, or unreachable sources fail closed via HTTP errors.
        """
        # Enforce role policy before examining fields or reaching the injected client.
        authorize_source(user, request)
        # Resolve exclusively one complete source form even when a caller bypasses Pydantic.
        if request.event_id is not None:
            if request.camera is not None or request.start is not None or request.end is not None:
                raise self._invalid_source()
            if not self._is_valid_event_id(request.event_id):
                raise self._invalid_source()
            return await self._resolve_event(request.event_id)
        if request.camera is None or request.start is None or request.end is None:
            raise self._invalid_source()
        # Require actual non-boolean integers before arithmetic on bypassed model values.
        if (
            not self._is_valid_camera(request.camera)
            or isinstance(request.start, bool)
            or isinstance(request.end, bool)
            or not isinstance(request.start, int)
            or not isinstance(request.end, int)
            or request.end <= request.start
        ):
            raise self._invalid_source()
        # Reject overlong timelines only after their runtime scalar types are confirmed safe.
        try:
            request.require_within_export_limit(self._maximum_duration_seconds)
        except ValueError as error:
            raise self._invalid_source() from error
        return await self._resolve_timeline(request.camera, request.start, request.end)

    async def _resolve_event(self, event_id: str) -> ResolvedSource:
        """Confirm event metadata and its clip bytes before returning an event source.

        ``event_id`` is an allowlisted scalar; output is a fixed event clip
        source.  The method performs bounded GET then HEAD calls, rejecting an
        absent clip flag, malformed metadata, and unavailable media without
        exposing upstream internals or accepting an event-controlled location.
        """
        # Preserve exactly the model/transcoder-approved path punctuation while
        # quoting any future grammar drift; percent escapes are intentionally
        # absent for the current allowlist so both boundaries consume one URL.
        quoted_event_id = quote(event_id, safe="_.:-")
        # Construct the metadata route from trusted literals and the pinned internal base only.
        metadata_url = self._internal_url(f"/api/events/{quoted_event_id}")
        metadata_response = await self._get(metadata_url)
        self._require_metadata_success(metadata_response)
        # Parse only JSON metadata and require Frigate's explicit clip availability flag.
        try:
            metadata = metadata_response.json()
        except ValueError as error:
            raise self._upstream_unavailable() from error
        if not isinstance(metadata, dict) or metadata.get("has_clip") is not True:
            raise self._source_not_found()
        # Probe the derived fixed clip URL rather than trusting metadata to provide a media path.
        clip_url = self._internal_url(f"/api/events/{quoted_event_id}/clip.mp4")
        await self._require_media(clip_url)
        # Return only the derived route and scalar identity, deliberately excluding all event metadata.
        return ResolvedSource(upstream_url=clip_url, identity=EventSource(event_id=event_id))

    async def _resolve_timeline(self, camera: str, start: int, end: int) -> ResolvedSource:
        """Confirm retained overlap and clip bytes for one validated camera range.

        ``camera``, ``start``, and ``end`` are allowlisted scalar values; output
        is a fixed recording-clip source.  The method makes a bounded GET to the
        only recordings endpoint and a HEAD to the generated clip route, never
        reading Frigate configuration or using a filesystem recording location.
        """
        # Quote the validated camera before placing it in the sole recordings endpoint family.
        quoted_camera = quote(camera, safe="")
        # Build bounded query values from numeric fields rather than accepting any caller query text.
        recordings_url = self._internal_url(f"/api/{quoted_camera}/recordings")
        recordings_response = await self._get(recordings_url, params={"after": str(start), "before": str(end)})
        self._require_metadata_success(recordings_response)
        # Treat malformed recordings data as an upstream failure, never as evidence of media availability.
        try:
            recordings = recordings_response.json()
        except ValueError as error:
            raise self._upstream_unavailable() from error
        if not self._has_intersecting_recording(recordings, start, end):
            raise self._source_not_found()
        # Confirm the generated clip contains bytes before allowing a conversion job to consume it.
        clip_url = self._internal_url(f"/api/{quoted_camera}/start/{start}/end/{end}/clip.mp4")
        await self._require_media(clip_url)
        # Keep the resolved result limited to scalar identity and a known internal media route.
        return ResolvedSource(upstream_url=clip_url, identity=TimelineSource(camera=camera, start=start, end=end))

    async def _get(self, url: str, *, params: dict[str, str] | None = None) -> httpx.Response:
        """Issue one timeout-bounded GET to a resolver-generated internal URL.

        ``url`` and optional ``params`` are constructed only by resolver code;
        output is the raw response.  Transport failures become a generic 502 so
        callers cannot distinguish network topology or trigger alternate URLs.
        """
        # Bound every metadata request and translate all network errors into a safe failure.
        try:
            return await self._client.get(url, params=params, timeout=self._timeout)
        except httpx.HTTPError as error:
            raise self._upstream_unavailable() from error

    async def _require_media(self, url: str) -> None:
        """Require a successful positive-length HEAD response for one generated clip URL.

        ``url`` is an internal route constructed by this class; no value is
        returned.  The method performs one bounded HEAD call and raises a safe
        error for transport, status, missing-length, malformed-length, or empty
        media so a queue never receives an unconfirmed source.
        """
        # Probe the resource without downloading media before scheduling expensive conversion work.
        try:
            response = await self._client.head(url, timeout=self._timeout)
        except httpx.HTTPError as error:
            print(f"FAILED HTTP ERROR: {error}", flush=True)
            raise self._upstream_unavailable() from error
            
        print(f"HEAD {url} -> {response.status_code} {response.headers}", flush=True)
        if not response.is_success:
            if response.status_code == status.HTTP_404_NOT_FOUND:
                print(f"FAILED NOT SUCCESS 404: {response.status_code}", flush=True)
                raise self._source_not_found()
            print(f"FAILED NOT SUCCESS NOT 404: {response.status_code}", flush=True)
            raise self._upstream_unavailable()
            
        if "Content-Length" in response.headers:
            try:
                content_length = int(response.headers["Content-Length"])
            except ValueError as error:
                print(f"FAILED VALUE ERROR: {response.headers['Content-Length']}", flush=True)
                raise self._source_not_found() from error
            if content_length < 1:
                print(f"FAILED CONTENT LENGTH < 1: {content_length}", flush=True)
                raise self._source_not_found()

    def _internal_url(self, path: str) -> str:
        """Join a literal resolver route to the already pinned internal base URL.

        ``path`` must be a resolver-built route beginning with ``/api/``; the
        return is an absolute internal URL with no query or fragment.  Invalid
        construction raises HTTP 422 before I/O, preventing future callers from
        repurposing this helper as a general URL join operation.
        """
        # Allow only the API prefix and explicitly reject URL syntax beyond the fixed route grammar.
        if not path.startswith("/api/") or "?" in path or "#" in path:
            raise self._invalid_source()
        return f"{self._base_url}{path}"

    @staticmethod
    def _is_valid_event_id(value: object) -> bool:
        """Return whether one runtime event identifier matches the scalar allowlist.

        ``value`` is a potential direct-model-bypass value and the boolean return
        has no side effects.  Full matching rejects percent escapes, traversal,
        slashes, query syntax, whitespace, and every non-contract character.
        """
        # Check the runtime type before full matching so bypassed non-strings fail as a client error.
        return isinstance(value, str) and bool(_EVENT_ID_PATTERN.fullmatch(value))

    @staticmethod
    def _is_valid_camera(value: object) -> bool:
        """Return whether one runtime camera name matches the scalar allowlist.

        ``value`` is a potential direct-model-bypass value and output is a pure
        boolean.  Full matching prevents a camera from contributing path, query,
        fragment, or traversal syntax to a fixed Frigate route.
        """
        # Keep camera validation separate and reject non-strings before regular-expression matching.
        return isinstance(value, str) and bool(_CAMERA_PATTERN.fullmatch(value))

    @staticmethod
    def _has_intersecting_recording(recordings: object, start: int, end: int) -> bool:
        """Return whether Frigate metadata contains a valid segment overlapping a range.

        ``recordings`` is untrusted decoded JSON while ``start`` and ``end`` are
        validated integers; output is a pure boolean.  Invalid segment objects
        are ignored, so only a real positive-duration intersection authorizes a
        timeline clip route.
        """
        # Require the documented list shape before examining untrusted segment fields.
        if not isinstance(recordings, list):
            return False
        # Accept only numeric, non-boolean timestamp pairs and test half-open interval overlap.
        for segment in recordings:
            if not isinstance(segment, dict):
                continue
            segment_start = segment.get("start_time")
            segment_end = segment.get("end_time")
            if isinstance(segment_start, bool) or isinstance(segment_end, bool):
                continue
            if not isinstance(segment_start, (int, float)) or not isinstance(segment_end, (int, float)):
                continue
            if segment_end > segment_start and segment_start < end and segment_end > start:
                return True
        return False

    @staticmethod
    def _require_metadata_success(response: httpx.Response) -> None:
        """Map a Frigate metadata response to safe source or upstream failures.

        ``response`` is a completed GET result and no value is returned.  A 404
        means the requested source is absent; every other non-success status is
        a generic 502 so callers receive no Frigate diagnostic detail.
        """
        # Preserve the source-not-found distinction while failing closed for every other upstream status.
        if not response.is_success:
            if response.status_code == status.HTTP_404_NOT_FOUND:
                raise SourceResolver._source_not_found()
            raise SourceResolver._upstream_unavailable()

    @staticmethod
    def _invalid_source() -> HTTPException:
        """Create the uniform client error used for malformed source selectors.

        The method takes no input and returns an HTTP 422 exception without side
        effects.  A generic message avoids reflecting unsafe path or query text
        into API responses or logs while making the validation failure explicit.
        """
        # Keep malformed selectors distinct from unavailable but syntactically valid media.
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid media source")

    @staticmethod
    def _source_not_found() -> HTTPException:
        """Create the uniform 404 used when confirmed media is not available.

        The method takes no input and returns an HTTP exception with no side
        effects.  It deliberately omits upstream metadata and paths so callers
        learn only that the selected media cannot be resolved at this time.
        """
        # Avoid exposing Frigate event or recording diagnostics in a not-found response.
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media source unavailable")

    @staticmethod
    def _upstream_unavailable() -> HTTPException:
        """Create the uniform 502 used for failed or malformed Frigate responses.

        The method takes no input and returns an HTTP exception with no side
        effects.  It hides internal network and upstream details while ensuring
        callers fail closed rather than treating an uncertain probe as media.
        """
        # Use a generic upstream failure that cannot disclose topology or configuration state.
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Media source unavailable")
