"""Collect and evaluate fail-closed Frigate, NVENC, GPU, and storage health.

The module probes only the fixed Docker-internal Frigate statistics route,
fixed argv-only executables, and injected derived-storage availability.  It
returns credential-free immutable observations and never controls Docker,
restarts services, changes camera settings, or reads Frigate configuration.
"""

from __future__ import annotations

import math
import os
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import httpx

# Binary memory and exact runtime boundaries match the approved node policy.
GiB = 1024**3
_FRIGATE_STATS_URL = "http://frigate:5000/api/stats"
_NVIDIA_QUERY = ("--query-gpu=temperature.gpu,memory.free", "--format=csv,noheader,nounits")
_ENCODER_QUERY = ("-hide_banner", "-encoders")


class CommandRunner(Protocol):
    """Describe the bounded argv-only command probe injected into HealthGate."""

    def __call__(self, argv: tuple[str, ...], timeout_seconds: float) -> str:
        """Return bounded stdout for one fixed argv or raise on probe failure."""
        ...


class FrigateProbe(Protocol):
    """Describe the fixed internal JSON health boundary injected for tests."""

    def __call__(self, url: str, timeout_seconds: float) -> Mapping[str, object]:
        """Return the decoded statistics object or raise on network failure."""
        ...


@dataclass(frozen=True, slots=True)
class HealthSnapshot:
    """Hold only credential-free facts needed by admission and observability.

    Fields are scalar booleans, optional GPU values, and an anonymous FPS tuple.
    Construction has no side effects; camera names, URLs, command diagnostics,
    GPU serials, and credentials are deliberately absent from representation.
    """

    frigate_available: bool
    encoder_available: bool
    gpu_temperature_c: int | None
    free_vram_bytes: int | None
    cache_available: bool
    tmpfs_available: bool
    camera_fps: tuple[float, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class GateDecision:
    """Return an admission result with an optional stable credential-free code.

    ``allowed`` is true only when a new transcode may start; ``code`` identifies
    the first failed policy class and contains no external diagnostic text.
    Instances perform no I/O or state mutation.
    """

    allowed: bool
    code: str | None = None


def can_start(
    snapshot: HealthSnapshot,
    *,
    start_temperature_c: int = 80,
    minimum_free_vram_bytes: int = GiB,
) -> GateDecision:
    """Evaluate one snapshot against strict start boundaries without side effects.

    The immutable ``snapshot`` contains sanitized probe facts; thresholds are
    validated trusted settings.  The return denies unavailable Frigate/NVENC,
    temperature at or above the ceiling, VRAM below the floor, or loss of both
    derived-storage tiers.  Camera FPS is intentionally not considered.
    """
    # Reject bypassed invalid policy inputs rather than silently weakening gates.
    if not isinstance(snapshot, HealthSnapshot):
        raise TypeError("snapshot must be a HealthSnapshot")
    if not isinstance(start_temperature_c, int) or isinstance(start_temperature_c, bool):
        raise ValueError("start temperature threshold must be an integer")
    if not isinstance(minimum_free_vram_bytes, int) or isinstance(minimum_free_vram_bytes, bool) or minimum_free_vram_bytes < 1:
        raise ValueError("minimum free VRAM must be positive")

    # Stable codes let the API classify a retryable health refusal without
    # exposing the failing URL, executable path, or probe diagnostics.
    if not snapshot.frigate_available:
        return GateDecision(False, "frigate_unavailable")
    if not snapshot.encoder_available:
        return GateDecision(False, "encoder_unavailable")
    if snapshot.gpu_temperature_c is None or snapshot.gpu_temperature_c >= start_temperature_c:
        return GateDecision(False, "gpu_temperature")
    if snapshot.free_vram_bytes is None or snapshot.free_vram_bytes < minimum_free_vram_bytes:
        return GateDecision(False, "gpu_memory")
    if not snapshot.cache_available and not snapshot.tmpfs_available:
        return GateDecision(False, "storage_unavailable")
    return GateDecision(True)


def _default_command_runner(argv: tuple[str, ...], timeout_seconds: float) -> str:
    """Run one fixed argv probe with a hard timeout and no shell interpretation.

    Inputs are constructed only by :class:`HealthGate`; output is stdout text.
    The side effect is one bounded child process.  Nonzero exit, timeout, or OS
    errors propagate to the caller, which converts them to unavailable facts.
    """
    # Shell remains disabled and stderr is discarded from returned state so a
    # hostile child diagnostic cannot enter snapshots, job state, or logs.
    completed = subprocess.run(
        list(argv),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds,
        check=True,
        shell=False,
    )
    # Both approved commands have small deterministic output; cap retained text
    # before parsing as defense in depth against a substituted executable.
    return completed.stdout[: 256 * 1024]


def _default_frigate_probe(url: str, timeout_seconds: float) -> Mapping[str, object]:
    """Fetch JSON from the sole fixed Frigate statistics route with a timeout.

    The URL is rechecked against a literal before one internal HTTP GET.  Output
    must be a JSON object; redirects and arbitrary URLs are rejected.  Network,
    HTTP, or shape failures raise for :meth:`HealthGate.snapshot` to sanitize.
    """
    # Preserve the internal-only authority even if a future caller bypasses the
    # constructor and invokes this module-level boundary directly.
    if url != _FRIGATE_STATS_URL:
        raise ValueError("Frigate health URL is not approved")
    response = httpx.get(url, timeout=timeout_seconds, follow_redirects=False)
    response.raise_for_status()
    document = response.json()
    if not isinstance(document, dict):
        raise ValueError("Frigate health response must be an object")
    return document


def _default_storage_probe(kind: str) -> bool:
    """Return whether one fixed derived-media root is an existing directory.

    ``kind`` selects only ``/cache`` or ``/work`` and cannot provide a path.
    The read-only filesystem check has no mutation side effects and fails closed
    for an unknown selector, missing root, or inaccessible metadata.
    """
    # Scheduler/storage code remains the authority for capacity and publication;
    # health merely proves at least one configured derived root is mounted.
    root = {"cache": Path("/cache"), "tmpfs": Path("/work")}.get(kind)
    if root is None:
        return False
    return _storage_available(root)


def _storage_available(root: Path) -> bool:
    """Return whether one fixed derived root exists and is writable/traversable.

    ``root`` is selected only by the internal storage probe or a unit test.  The
    read-only metadata/access checks return a boolean without creating files;
    missing, non-directory, permission-denied, or OS-error states fail closed.
    MediaStore still owns authoritative capacity and safe publication checks.
    """
    # Existence alone is insufficient for a read-only or non-traversable mount;
    # require the service principal's write and search permissions together.
    try:
        return root.is_dir() and os.access(root, os.W_OK | os.X_OK)
    except OSError:
        return False


def _camera_fps(document: Mapping[str, object]) -> tuple[float, ...]:
    """Extract anonymous finite nonnegative FPS values from Frigate statistics.

    Input is untrusted decoded JSON; output is a sorted numeric tuple with no
    camera names or URLs.  Invalid/missing records are ignored because FPS is
    observability-only and must never turn into an admission gate.
    """
    # Traverse only the documented cameras object and intentionally discard its
    # keys so credential-shaped names cannot survive in returned state.
    cameras = document.get("cameras")
    if not isinstance(cameras, Mapping):
        return ()
    values: list[float] = []
    for record in cameras.values():
        if not isinstance(record, Mapping):
            continue
        value = record.get("camera_fps")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        numeric = float(value)
        if math.isfinite(numeric) and numeric >= 0:
            values.append(numeric)
    return tuple(sorted(values))


def _gpu_facts(output: str) -> tuple[int, int]:
    """Parse nvidia-smi CSV into hottest temperature and least free VRAM.

    The input contains nounit rows of Celsius and MiB values.  Output selects
    conservative facts across visible GPUs; malformed, empty, negative, or
    nonsensical rows raise so snapshot collection fails closed.
    """
    temperatures: list[int] = []
    free_bytes: list[int] = []
    # Every visible device must produce a valid complete row; partial truth could
    # otherwise select a healthier GPU than the encoder later chooses.
    for line in output.splitlines():
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 2:
            raise ValueError("invalid NVIDIA health output")
        temperature = int(parts[0])
        memory_mib = int(parts[1])
        if not 0 <= temperature <= 150 or memory_mib < 0:
            raise ValueError("invalid NVIDIA health values")
        temperatures.append(temperature)
        free_bytes.append(memory_mib * 1024**2)
    if not temperatures:
        raise ValueError("missing NVIDIA health output")
    return max(temperatures), min(free_bytes)


class HealthGate:
    """Own sanitized health collection and in-flight failure hysteresis.

    Construction accepts only testable external boundaries and trusted fixed
    executable paths/thresholds.  :meth:`snapshot` performs read-only probes;
    :meth:`continue_transcode` mutates only an in-memory consecutive-failure
    counter and never controls Docker, Frigate, cameras, or recording state.
    """

    def __init__(
        self,
        *,
        frigate_probe: FrigateProbe = _default_frigate_probe,
        command_runner: CommandRunner = _default_command_runner,
        storage_probe: Callable[[str], bool] = _default_storage_probe,
        nvidia_smi_path: str = "/usr/bin/nvidia-smi",
        ffmpeg_path: str = "/usr/bin/ffmpeg",
        timeout_seconds: float = 3.0,
        start_temperature_c: int = 80,
        cancel_temperature_c: int = 85,
        minimum_free_vram_bytes: int = GiB,
        snapshot_provider: Callable[[], HealthSnapshot] | None = None,
        clock: Callable[[], float] = time.monotonic,
        runtime_probe_interval_seconds: float = 1.0,
    ) -> None:
        """Validate and retain fixed probes, paths, thresholds, and test seam.

        Inputs are trusted construction dependencies; no probe runs here.  The
        optional snapshot provider/clock are deterministic test seams, and the
        runtime interval bounds expensive probe cadence.  Invalid values
        raise credential-free errors before the component can collect health.
        """
        # Require callable boundaries, single executable argv tokens, finite
        # positive timeouts, and thermal ordering that cancels after start denial.
        if not callable(frigate_probe) or not callable(command_runner) or not callable(storage_probe):
            raise TypeError("health probes must be callable")
        if not isinstance(nvidia_smi_path, str) or not nvidia_smi_path or not isinstance(ffmpeg_path, str) or not ffmpeg_path:
            raise ValueError("health executable paths must be configured")
        if not isinstance(timeout_seconds, (int, float)) or isinstance(timeout_seconds, bool) or not math.isfinite(float(timeout_seconds)) or timeout_seconds <= 0:
            raise ValueError("health timeout must be positive")
        if not isinstance(start_temperature_c, int) or isinstance(start_temperature_c, bool):
            raise ValueError("start temperature threshold must be an integer")
        if not isinstance(cancel_temperature_c, int) or isinstance(cancel_temperature_c, bool) or cancel_temperature_c <= start_temperature_c:
            raise ValueError("cancel temperature must exceed start temperature")
        if not isinstance(minimum_free_vram_bytes, int) or isinstance(minimum_free_vram_bytes, bool) or minimum_free_vram_bytes < 1:
            raise ValueError("minimum free VRAM must be positive")
        if snapshot_provider is not None and not callable(snapshot_provider):
            raise TypeError("snapshot provider must be callable")
        if not callable(clock):
            raise TypeError("health clock must be callable")
        if (
            not isinstance(runtime_probe_interval_seconds, (int, float))
            or isinstance(runtime_probe_interval_seconds, bool)
            or not math.isfinite(float(runtime_probe_interval_seconds))
            or runtime_probe_interval_seconds <= 0
        ):
            raise ValueError("runtime probe interval must be positive")

        # Retain only fixed boundaries and numeric thresholds; no credentials,
        # command output, Frigate JSON, or external exception text is stored.
        self._frigate_probe = frigate_probe
        self._command_runner = command_runner
        self._storage_probe = storage_probe
        self._nvidia_smi_path = nvidia_smi_path
        self._ffmpeg_path = ffmpeg_path
        self._timeout_seconds = float(timeout_seconds)
        self._start_temperature_c = start_temperature_c
        self._cancel_temperature_c = cancel_temperature_c
        self._minimum_free_vram_bytes = minimum_free_vram_bytes
        self._snapshot_provider = snapshot_provider
        self._clock = clock
        self._runtime_probe_interval_seconds = float(runtime_probe_interval_seconds)
        self._consecutive_runtime_failures = 0
        self._last_runtime_probe_at: float | None = None
        self._last_runtime_allowed = True

    def __repr__(self) -> str:
        """Render only policy thresholds, excluding probes, paths, and output."""
        # A fixed coarse representation prevents injected callable or executable
        # repr values from disclosing credentials in diagnostics.
        return (
            "HealthGate("
            f"start_temperature_c={self._start_temperature_c}, "
            f"cancel_temperature_c={self._cancel_temperature_c}, "
            f"minimum_free_vram_bytes={self._minimum_free_vram_bytes})"
        )

    def snapshot(self) -> HealthSnapshot:
        """Collect one sanitized health observation from fixed read-only probes.

        No inputs are accepted.  Output is an immutable credential-free snapshot.
        Side effects are one internal Frigate GET, two timeout-bounded argv-only
        probes, and two read-only storage checks; every external failure becomes
        an unavailable fact without retaining or propagating diagnostic text.
        """
        # An explicit provider supports deterministic scheduler/runtime tests
        # while preserving the exact public snapshot return contract.
        if self._snapshot_provider is not None:
            snapshot = self._snapshot_provider()
            if not isinstance(snapshot, HealthSnapshot):
                raise TypeError("snapshot provider must return HealthSnapshot")
            return snapshot

        # Isolate every external boundary so one failure cannot skip the other
        # independent observations and no exception text enters returned state.
        frigate_available = False
        camera_fps: tuple[float, ...] = ()
        try:
            document = self._frigate_probe(_FRIGATE_STATS_URL, self._timeout_seconds)
            if not isinstance(document, Mapping):
                raise ValueError("Frigate health response must be an object")
            frigate_available = True
            camera_fps = _camera_fps(document)
        except Exception:
            frigate_available = False
            camera_fps = ()

        gpu_temperature_c: int | None = None
        free_vram_bytes: int | None = None
        try:
            gpu_output = self._command_runner(
                (self._nvidia_smi_path, *_NVIDIA_QUERY), self._timeout_seconds
            )
            gpu_temperature_c, free_vram_bytes = _gpu_facts(gpu_output)
        except Exception:
            gpu_temperature_c = None
            free_vram_bytes = None

        encoder_available = False
        try:
            encoder_output = self._command_runner(
                (self._ffmpeg_path, *_ENCODER_QUERY), self._timeout_seconds
            )
            encoder_available = "h264_nvenc" in encoder_output.split()
        except Exception:
            encoder_available = False

        # Storage probes receive enum-like selectors rather than paths, keeping
        # path authority inside the production boundary implementation.
        try:
            cache_available = self._storage_probe("cache") is True
        except Exception:
            cache_available = False
        try:
            tmpfs_available = self._storage_probe("tmpfs") is True
        except Exception:
            tmpfs_available = False

        return HealthSnapshot(
            frigate_available=frigate_available,
            encoder_available=encoder_available,
            gpu_temperature_c=gpu_temperature_c,
            free_vram_bytes=free_vram_bytes,
            cache_available=cache_available,
            tmpfs_available=tmpfs_available,
            camera_fps=camera_fps,
        )

    def can_start(self, snapshot: HealthSnapshot) -> GateDecision:
        """Apply this gate's configured admission thresholds to one snapshot.

        Input is a sanitized immutable observation and output is a pure stable
        decision.  This method performs no probes or state changes.
        """
        return can_start(
            snapshot,
            start_temperature_c=self._start_temperature_c,
            minimum_free_vram_bytes=self._minimum_free_vram_bytes,
        )

    def continue_transcode(self) -> bool:
        """Return whether owned work may continue under runtime hysteresis.

        The method collects one snapshot (or injected equivalent), cancels
        immediately when the encoder disappears, and cancels after two
        consecutive other bad checks.  A healthy check resets the counter;
        side effects are only probes and this in-memory counter mutation.
        """
        # Transcoder polls about every 50 ms, while nvidia-smi/FFmpeg/HTTP probes
        # are intentionally sampled at a slower bounded cadence.  Reuse only a
        # sanitized boolean decision; a backwards/non-finite clock fails closed
        # into an immediate fresh observation.
        try:
            now = float(self._clock())
        except Exception:
            now = math.nan
        if (
            math.isfinite(now)
            and self._last_runtime_probe_at is not None
            and now >= self._last_runtime_probe_at
            and now - self._last_runtime_probe_at < self._runtime_probe_interval_seconds
        ):
            return self._last_runtime_allowed
        snapshot = self.snapshot()
        self._last_runtime_probe_at = now if math.isfinite(now) else None
        # Encoder disappearance cannot recover inside an already running FFmpeg
        # process, so terminate it without waiting for a second observation.
        if not snapshot.encoder_available:
            self._consecutive_runtime_failures = 0
            self._last_runtime_allowed = False
            return self._last_runtime_allowed

        # Runtime permits the 80-84 C no-new-work band but treats 85 C, lost
        # Frigate, inadequate VRAM, or both storage tiers lost as a bad check.
        bad = (
            not snapshot.frigate_available
            or snapshot.gpu_temperature_c is None
            or snapshot.gpu_temperature_c >= self._cancel_temperature_c
            or snapshot.free_vram_bytes is None
            or snapshot.free_vram_bytes < self._minimum_free_vram_bytes
            or (not snapshot.cache_available and not snapshot.tmpfs_available)
        )
        if not bad:
            self._consecutive_runtime_failures = 0
            self._last_runtime_allowed = True
            return self._last_runtime_allowed
        self._consecutive_runtime_failures += 1
        self._last_runtime_allowed = self._consecutive_runtime_failures < 2
        return self._last_runtime_allowed

    def reset_runtime_failures(self) -> None:
        """Clear only this gate's in-memory consecutive runtime fault count.

        The method has no inputs or external side effects and is called before a
        new scheduler-owned transcode so faults cannot leak between jobs.
        """
        self._consecutive_runtime_failures = 0
        # A new owned process requires an immediate fresh observation rather than
        # inheriting a previous job's cached decision or probe timestamp.
        self._last_runtime_probe_at = None
        self._last_runtime_allowed = True
