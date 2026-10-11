"""Authenticate proxy-asserted identities for internal media endpoints.

The module receives ASGI requests after the trusted gateway has injected a
shared secret and identity headers.  It performs no outbound I/O and rejects
every malformed assertion before a user context can be returned.
"""

import secrets
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, Request, status

from media_compat.settings import Settings


@dataclass(frozen=True, slots=True)
class UserContext:
    """Represent the gateway-authenticated identity available to handlers.

    Inputs are validated username and role strings, and output is an immutable
    context with no side effects.  Its role is intentionally limited to existing
    application roles so no caller can create privilege classes through headers.
    """

    username: str
    role: Literal["user", "admin"]


def require_gateway(request: Request, settings: Settings) -> UserContext:
    """Verify gateway credentials and return its allowlisted asserted identity.

    ``request`` provides proxy headers and ``settings`` holds the configured
    secret.  On success the function returns ``UserContext`` without side
    effects; every missing, mismatched, or unsupported value raises a generic
    HTTP error.  Identity headers are deliberately read only after constant-time
    shared-secret comparison succeeds.
    """
    # Check the shared credential before inspecting spoofable identity assertions.
    received_secret = request.headers.get("X-BPP-Proxy-Secret", "")
    if not received_secret or not secrets.compare_digest(received_secret, settings.proxy_shared_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    # Normalize only the username after authentication; roles are protocol literals.
    username = request.headers.get("X-User", "").strip()
    role = request.headers.get("X-Role", "")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    # Preserve the established two-role RBAC vocabulary with no implicit fallback.
    if role not in {"user", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return UserContext(username=username, role=role)
