"""Verify dashboard credentials against auth-service before trusting an identity.

The config service is reachable by other containers, so caller-provided role or
user headers are never an identity source. Only the response from the configured
auth-service verification endpoint may assert the authenticated user and role.
"""

from dataclasses import dataclass
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest
from urllib.request import urlopen


# Authentication should fail closed quickly so config writes do not hang while the
# identity provider is unavailable.
DEFAULT_AUTH_TIMEOUT_SECONDS = 2.0


@dataclass(frozen=True)
class TrustedIdentity:
    """Represent an identity asserted by auth-service.

    ``username`` and ``role`` come only from a successful direct verification
    response. The immutable value has no side effects and can safely be shared
    with authorization dependencies.
    """

    username: str
    role: str


class IdentityVerificationError(Exception):
    """Describe a safe HTTP failure raised while verifying caller credentials.

    ``status_code`` is suitable for the API response and ``detail`` deliberately
    excludes upstream exception text so network or deployment details are not
    disclosed to untrusted callers.
    """

    def __init__(self, status_code: int, detail: str) -> None:
        """Store the client-safe status and message for the FastAPI boundary."""

        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _credential_headers(authorization: str | None, cookie: str | None) -> dict[str, str]:
    """Return the allowlisted credentials to send to auth-service.

    Caller-controlled identity headers are intentionally not accepted as inputs.
    The returned dictionary contains only bearer/cookie credentials and has no
    side effects.
    """

    # Forward only credentials that auth-service already understands; omitting all
    # other headers prevents a caller from injecting an asserted user or role.
    headers: dict[str, str] = {}
    if authorization:
        headers["Authorization"] = authorization
    if cookie:
        headers["Cookie"] = cookie
    return headers


def verify_identity(
    verify_url: str,
    authorization: str | None,
    cookie: str | None,
    *,
    timeout_seconds: float = DEFAULT_AUTH_TIMEOUT_SECONDS,
    opener: Callable[..., object] = urlopen,
) -> TrustedIdentity:
    """Validate request credentials and return auth-service's trusted identity.

    ``verify_url`` identifies the internal auth-service endpoint;
    ``authorization`` and ``cookie`` are the original request credentials.
    ``opener`` is injectable for deterministic tests. The function performs one
    outbound GET and raises :class:`IdentityVerificationError` on every failure,
    ensuring authorization fails closed.
    """

    # A request with only spoofable identity headers must never reach the trusted
    # path because there is no credential for auth-service to validate.
    headers = _credential_headers(authorization, cookie)
    if not headers:
        raise IdentityVerificationError(401, "Unauthorized")
    if not verify_url:
        raise IdentityVerificationError(503, "Authentication service unavailable")

    # Ask auth-service to decode the bearer token or HttpOnly session cookie. Its
    # response headers are trusted because this is a direct server-to-server call,
    # not data copied from the original client request.
    request = URLRequest(verify_url, headers=headers, method="GET")
    try:
        with opener(request, timeout=timeout_seconds) as response:
            username = (response.headers.get("X-User") or "").strip()
            role = (response.headers.get("X-Role") or "").strip()
    except HTTPError as exc:
        # Preserve credential failures while hiding other upstream details as a
        # generic availability error.
        if exc.code in (401, 403):
            raise IdentityVerificationError(exc.code, "Unauthorized") from exc
        raise IdentityVerificationError(503, "Authentication service unavailable") from exc
    except (URLError, TimeoutError, OSError, ValueError, AttributeError) as exc:
        # Network, timeout, malformed deployment configuration, and invalid
        # verifier responses all fail closed instead of trusting caller headers.
        raise IdentityVerificationError(503, "Authentication service unavailable") from exc

    # A successful response without both assertions violates the internal
    # protocol, so treat it as an unavailable verifier instead of guessing.
    if not username or not role:
        raise IdentityVerificationError(503, "Authentication service unavailable")
    return TrustedIdentity(username=username, role=role)
