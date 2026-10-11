"""Fail-closed environment settings for the internal media service.

This module reads non-secret tuning values and the required proxy credential
from the process environment.  It performs no network or filesystem I/O and
never includes the credential in errors or a settings representation.
"""

import os
from dataclasses import dataclass, field

# The service is intentionally restricted to this Docker-internal upstream.
FRIGATE_BASE_URL = "http://frigate:5000"


def _read_int(name: str, default: int, *, minimum: int = 0) -> int:
    """Read a bounded integer environment setting without leaking other values.

    ``name`` identifies the environment key, ``default`` is used when absent,
    and ``minimum`` establishes its inclusive safety bound.  The return is a
    validated integer; this helper has no side effects and raises ``ValueError``
    with a key-only message when parsing or bounds validation fails.
    """
    # Read only the requested non-secret setting and normalize surrounding space.
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value.strip())
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def _read_float(name: str, default: float, *, minimum: float, maximum: float) -> float:
    """Read a bounded float environment setting without disclosing its content.

    ``name`` identifies the environment key and the bounds are inclusive.  The
    return is a validated float with no side effects; malformed or out-of-range
    values fail closed through a key-only ``ValueError``.
    """
    # Retain defaults for omitted knobs while rejecting invalid explicit values.
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        value = float(raw_value.strip())
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _read_bool(name: str, default: bool) -> bool:
    """Read a strict boolean environment setting using an explicit vocabulary.

    ``name`` identifies the key and ``default`` is returned when it is absent.
    The helper has no side effects and returns a boolean; any ambiguous text
    raises a key-only ``ValueError`` so feature activation cannot be guessed.
    """
    # Accept only conventional unambiguous spellings for operational switches.
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


@dataclass(frozen=True, slots=True)
class Settings:
    """Hold validated, immutable service configuration and a hidden proxy secret.

    Values are read via :meth:`from_env` or supplied by trusted tests.  Instances
    have no side effects after construction, retain resource-safety invariants,
    and hide the credential from ``repr``; invalid construction raises
    ``ValueError`` without rendering the secret.
    """

    proxy_shared_secret: str = field(default="", repr=False)
    enabled: bool = False
    active_jobs: int = 1
    waiting_jobs: int = 2
    cache_limit_bytes: int = 10 * 1024**3
    persistent_free_percent: float = 15.0
    persistent_safety_bytes: int = 2 * 1024**3
    tmpfs_limit_bytes: int = 512 * 1024**2
    tmpfs_lease_seconds: int = 15 * 60
    gpu_start_temp_c: int = 80
    gpu_cancel_temp_c: int = 85
    minimum_free_vram_bytes: int = 1024**3
    max_export_duration_seconds: int = 60 * 60
    frigate_timeout_seconds: int = 10
    frigate_base_url: str = FRIGATE_BASE_URL

    def __post_init__(self) -> None:
        """Defend direct construction with the same security and safety bounds.

        Inputs are dataclass fields and output is no value; the method performs
        no I/O.  It keeps test injection safe by rejecting blank credentials,
        unsafe limits, and any non-approved upstream before settings are usable.
        """
        # Reject empty secrets and preserve an intentionally secret-free error.
        if not self.proxy_shared_secret.strip():
            raise ValueError("MEDIA_COMPAT_PROXY_SHARED_SECRET must be configured")
        # Enforce the fixed HTTP-only internal target rather than arbitrary URLs.
        if self.frigate_base_url != FRIGATE_BASE_URL:
            raise ValueError("FRIGATE_BASE_URL must be the approved internal HTTP URL")
        # Ensure concurrency and storage values cannot disable resource guardrails.
        # One active encoder plus at most two waiting requests is a hard node
        # safety ceiling, not an operator-tunable expansion point.
        if self.active_jobs < 1 or not 0 <= self.waiting_jobs <= 2 or self.cache_limit_bytes < 1:
            raise ValueError("media compatibility queue and cache limits are invalid")
        if not 0 < self.persistent_free_percent <= 100:
            raise ValueError("MEDIA_COMPAT_PERSISTENT_FREE_PERCENT must be between 0 and 100")
        if self.persistent_safety_bytes < 0 or self.tmpfs_limit_bytes < 1 or self.tmpfs_lease_seconds < 1:
            raise ValueError("media compatibility disk thresholds are invalid")
        # Cancel before thermal damage and require positive VRAM and request limits.
        if not 0 <= self.gpu_start_temp_c < self.gpu_cancel_temp_c <= 120:
            raise ValueError("media compatibility GPU temperature thresholds are invalid")
        if self.minimum_free_vram_bytes < 1 or self.max_export_duration_seconds < 1 or self.frigate_timeout_seconds < 1:
            raise ValueError("media compatibility upstream thresholds are invalid")

    @classmethod
    def from_env(cls) -> "Settings":
        """Build settings from approved environment keys and validate all bounds.

        The method takes no explicit inputs, returns an immutable ``Settings``,
        and reads process environment values without logging them.  Missing or
        malformed credentials, thresholds, or upstream configuration raise safe
        ``ValueError`` messages before the service can start.
        """
        # Read the only secret separately so it is never interpolated into errors.
        proxy_secret = os.environ.get("MEDIA_COMPAT_PROXY_SHARED_SECRET", "").strip()
        # The upstream is fixed; an explicit different value is a deployment error.
        frigate_base_url = os.environ.get("FRIGATE_BASE_URL", FRIGATE_BASE_URL).strip()
        return cls(
            proxy_shared_secret=proxy_secret,
            enabled=_read_bool("MEDIA_COMPAT_ENABLED", False),
            active_jobs=_read_int("MEDIA_COMPAT_ACTIVE_JOBS", 1, minimum=1),
            waiting_jobs=_read_int("MEDIA_COMPAT_WAITING_JOBS", 2, minimum=0),
            cache_limit_bytes=_read_int("MEDIA_COMPAT_CACHE_LIMIT_BYTES", 10 * 1024**3, minimum=1),
            persistent_free_percent=_read_float(
                "MEDIA_COMPAT_PERSISTENT_FREE_PERCENT", 15.0, minimum=0.000001, maximum=100.0
            ),
            persistent_safety_bytes=_read_int("MEDIA_COMPAT_PERSISTENT_SAFETY_BYTES", 2 * 1024**3),
            tmpfs_limit_bytes=_read_int("MEDIA_COMPAT_TMPFS_LIMIT_BYTES", 512 * 1024**2, minimum=1),
            tmpfs_lease_seconds=_read_int("MEDIA_COMPAT_TMPFS_LEASE_SECONDS", 15 * 60, minimum=1),
            gpu_start_temp_c=_read_int("MEDIA_COMPAT_GPU_START_TEMP_C", 80),
            gpu_cancel_temp_c=_read_int("MEDIA_COMPAT_GPU_CANCEL_TEMP_C", 85),
            minimum_free_vram_bytes=_read_int("MEDIA_COMPAT_MINIMUM_FREE_VRAM_BYTES", 1024**3, minimum=1),
            max_export_duration_seconds=_read_int(
                "MEDIA_COMPAT_MAX_EXPORT_DURATION_SECONDS", 60 * 60, minimum=1
            ),
            frigate_timeout_seconds=_read_int("MEDIA_COMPAT_FRIGATE_TIMEOUT_SECONDS", 10, minimum=1),
            frigate_base_url=frigate_base_url,
        )
