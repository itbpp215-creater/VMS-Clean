"""Client for the isolated Frigate 0.17.2 configuration validator."""

from __future__ import annotations

import http.client
import os


VALIDATOR_HOST = os.environ.get(
    "CONFIG_API_FRIGATE_VALIDATOR_HOST",
    "config-validator",
).strip()
VALIDATOR_PORT = int(
    os.environ.get("CONFIG_API_FRIGATE_VALIDATOR_PORT", "5004")
)
VALIDATOR_TIMEOUT_SECONDS = float(
    os.environ.get("CONFIG_API_FRIGATE_VALIDATOR_TIMEOUT_SECONDS", "30")
)
MAX_RESPONSE_BYTES = 64 * 1024


class FrigateValidationRejected(ValueError):
    """Report that the pinned Frigate parser rejected a candidate config."""


class FrigateValidatorUnavailable(RuntimeError):
    """Report that the isolated validator could not make a decision."""


def validate_yaml_with_frigate(
    payload: str,
    *,
    connection_factory=http.client.HTTPConnection,
) -> None:
    """Require the pinned validator to accept ``payload`` before persistence."""

    # The host and path are fixed service configuration, not request-controlled
    # URLs. HTTP stays on an isolated internal Compose network and carries no
    # browser credential.
    if not VALIDATOR_HOST:
        raise FrigateValidatorUnavailable("Frigate validator host is not configured")
    connection = connection_factory(
        VALIDATOR_HOST,
        VALIDATOR_PORT,
        timeout=VALIDATOR_TIMEOUT_SECONDS,
    )
    try:
        connection.request(
            "POST",
            "/validate",
            body=payload.encode("utf-8"),
            headers={
                "Content-Type": "application/x-yaml",
                "Content-Length": str(len(payload.encode("utf-8"))),
            },
        )
        response = connection.getresponse()
        # Drain only a small bounded response. The validator intentionally returns
        # no config fragment or parser traceback across the service boundary.
        response.read(MAX_RESPONSE_BYTES)
    except (OSError, http.client.HTTPException) as exc:
        raise FrigateValidatorUnavailable(
            "Frigate validator is unavailable"
        ) from exc
    finally:
        connection.close()

    if response.status in {200, 204}:
        return
    if response.status in {400, 413, 422}:
        raise FrigateValidationRejected("Pinned Frigate rejected configuration")
    raise FrigateValidatorUnavailable(
        f"Frigate validator returned unexpected status {response.status}"
    )
