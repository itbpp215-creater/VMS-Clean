"""Strict, JSON-serializable contracts for internal media preparation jobs.

The models accept untrusted request payloads and return typed response payloads.
They have no I/O or mutable global state, reject unknown fields, and fail closed
when a caller supplies an ambiguous, malformed, or unsafe source selector.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# These literals make every serialized purpose and lifecycle state explicit.
Purpose = Literal["playback", "download", "share", "prefetch"]
JobState = Literal["queued", "running", "ready", "failed", "cancelled"]
# API responses expose only these stable classifications, never child-process,
# upstream, filesystem, or health-probe diagnostic strings.
PublicErrorCode = Literal[
    "invalid_source",
    "forbidden",
    "not_found",
    "queue_full",
    "health_gate",
    "transcode_failed",
    "cancelled",
    "range_not_satisfiable",
]


class PrepareRequest(BaseModel):
    """Describe one immutable event or timeline source to prepare.

    Inputs are a purpose plus either an event identifier or a complete camera
    timeline.  Output is a validated Pydantic model with no side effects.  The
    post-validation invariant requires one and only one source; malformed or
    ambiguous payloads raise ``ValidationError`` before any upstream call.
    """

    # This boundary forbids surprise fields and canonicalizes user whitespace.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    purpose: Purpose
    event_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    camera: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,80}$")
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def require_exactly_one_source(self) -> "PrepareRequest":
        """Enforce exclusive event or complete, positive-duration timeline input.

        The method receives the parsed request and returns it unchanged on
        success; it has no side effects.  An event cannot be combined with a
        timeline, and a timeline must include all fields with ``end > start``;
        violations raise ``ValueError`` for Pydantic to expose as validation
        failures.  The settings-dependent maximum is checked by the operation
        that selects its configured limit before queueing a job.
        """
        # Treat a non-empty event id as one immutable source and all timeline
        # fields as the only alternate source form.
        has_event = self.event_id is not None
        timeline_values = (self.camera, self.start, self.end)
        has_any_timeline_field = any(value is not None for value in timeline_values)
        has_complete_timeline = all(value is not None for value in timeline_values)

        # Reject both source forms, a partial timeline, and an absent source.
        if has_event == has_any_timeline_field or (has_any_timeline_field and not has_complete_timeline):
            raise ValueError("exactly one complete immutable source is required")

        # A completed timeline must cover at least one positive time unit.
        if has_complete_timeline and self.end is not None and self.start is not None and self.end <= self.start:
            raise ValueError("timeline end must be greater than start")
        return self

    def require_within_export_limit(self, maximum_duration_seconds: int) -> "PrepareRequest":
        """Apply the caller's configured absolute duration ceiling to a timeline.

        ``maximum_duration_seconds`` comes from validated settings and this
        request is returned unchanged on success; no I/O or state mutation
        occurs.  Event requests need no duration check, while a non-positive
        limit or an oversized timeline raises ``ValueError`` before queueing.
        """
        # Defend callers that bypass settings and only measure complete timelines.
        if maximum_duration_seconds < 1:
            raise ValueError("maximum export duration must be positive")
        if self.start is not None and self.end is not None and self.end - self.start > maximum_duration_seconds:
            raise ValueError("timeline duration exceeds the configured export limit")
        return self


class EventSource(BaseModel):
    """Identify a Frigate event after server-side metadata validation.

    ``event_id`` is a previously validated scalar identifier; the model returns
    a JSON-safe immutable identity and has no I/O.  It intentionally stores no
    camera stream, filesystem path, or user-provided URL so later job stages can
    safely derive cache keys and audit records from an approved source only.
    """

    # Freeze the identity and reject additions so internal source records cannot grow secrets.
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    event_id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,160}$")


class TimelineSource(BaseModel):
    """Identify an approved retained camera interval without a media location.

    Inputs are a validated camera name and positive bounded timestamps; output
    is an immutable identity with no side effects.  The absence of a URL or
    local path preserves the source boundary after Frigate availability checks.
    """

    # Freeze only the scalar identity fields used by downstream cache and job code.
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    camera: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    start: int = Field(ge=0)
    end: int = Field(ge=1)

    @model_validator(mode="after")
    def require_positive_duration(self) -> "TimelineSource":
        """Reject an identity whose exclusive end does not follow its start.

        The method receives parsed scalar fields and returns this model without
        I/O or mutation.  It repeats the timeline invariant at the resolved
        identity boundary so directly constructed cache inputs cannot be empty.
        """
        # Keep every timeline identity meaningful before later job stages consume it.
        if self.end <= self.start:
            raise ValueError("timeline end must be greater than start")
        return self


class ResolvedSource(BaseModel):
    """Expose the sole Frigate-internal URL paired with a safe source identity.

    Inputs are server-constructed values after metadata and media probes; output
    is an immutable JSON model with no I/O.  It excludes all Frigate config,
    recording-path, credential, and stream fields by accepting only these two
    explicitly declared values.
    """

    # Reject unreviewed fields and make the resolved hand-off record immutable.
    model_config = ConfigDict(extra="forbid", frozen=True)

    upstream_url: str = Field(pattern=r"^http://frigate:5000/api/[^?#]+$")
    identity: EventSource | TimelineSource


class PrepareResponse(BaseModel):
    """Acknowledge a newly accepted preparation job without exposing internals.

    Inputs are server-generated identifiers and an initial lifecycle state;
    output is a JSON model with no side effects.  It forbids unknown fields so
    downstream clients receive only the documented, safe public contract.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    state: JobState
    job_id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    media_url: str | None = Field(
        default=None,
        pattern=r"^/api/media-compat/media/[0-9a-f]{8,64}\.mp4$",
    )
    retry_after_ms: int | None = Field(default=None, ge=100, le=5000)


class JobStatusResponse(BaseModel):
    """Report the current lifecycle state and optional ready-media location.

    Inputs are server-side job status values; output is a JSON model with no
    side effects.  The URL stays optional until a job is ready, while unknown
    fields fail validation so accidental internal details cannot leak.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    state: JobState
    job_id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    media_url: str | None = Field(
        default=None,
        pattern=r"^/api/media-compat/media/[0-9a-f]{8,64}\.mp4$",
    )
    retry_after_ms: int | None = Field(default=None, ge=100, le=5000)
    error_code: PublicErrorCode | None = None
