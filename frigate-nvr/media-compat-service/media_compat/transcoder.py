"""Transcode fixed Frigate clips through NVENC and validate portable MP4 output.

The module accepts only resolver-generated internal clip URLs and digest-named
partials beneath injected cache/work roots.  It invokes fixed executables with
argument lists and owned process groups, bounds time and captured output, never
selects a CPU video encoder, and leaves publication to :mod:`media_compat.cache`.
"""

from __future__ import annotations

import json
import math
import os
import re
import signal
import stat
import subprocess
import threading
import time
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path
from typing import Callable, Protocol

from .cache import InvalidMediaError, OwnedPartial

# These exact route grammars are the only SourceResolver outputs that FFmpeg may consume.
_EVENT_SOURCE_PATTERN = re.compile(
    r"http://frigate:5000/api/events/[A-Za-z0-9_.:-]{1,160}/clip\.mp4"
)
_TIMELINE_SOURCE_PATTERN = re.compile(
    r"http://frigate:5000/api/[A-Za-z0-9_-]{1,80}/start/(?P<start>[0-9]+)/end/(?P<end>[0-9]+)/clip\.mp4"
)
# MediaStore reserves only direct-child SHA-256 partials, which prevents arbitrary deletion targets.
_OWNED_PARTIAL_PATTERN = re.compile(r"[0-9a-f]{64}(?:\.[0-9a-f]{32})?\.mp4\.partial")
# Diagnostics replace the complete internal URL token, including any unexpected query material.
_INTERNAL_URL_PATTERN = re.compile(r"http://frigate:5000/[^\s\x00-\x1f]*")
# Video-rate text must be a bounded positive rational, never FFmpeg's unknown ``0/0`` sentinel.
_VIDEO_RATE_PATTERN = re.compile(r"(?P<numerator>[1-9][0-9]{0,6})/(?P<denominator>[1-9][0-9]{0,6})")

# Process output limits prevent child diagnostics or malformed probe JSON from consuming unbounded memory.
_STDERR_LIMIT = 64 * 1024
_PROBE_STDOUT_LIMIT = 32 * 1024 * 1024
_TRANSCODE_STDOUT_LIMIT = 64 * 1024
_ERROR_DETAIL_LIMIT = 1024
# Polling keeps cancellation responsive without busy-spinning on the owned child process.
_PROCESS_POLL_SECONDS = 0.05
# The accepted CCTV cadence range is deliberately wider than deployed cameras
# while bounding resource amplification and rejecting implausible probe facts.
_MAX_VIDEO_RATE_COMPONENT = 1_000_000
_MAX_VIDEO_FRAMES_PER_SECOND = Fraction(240, 1)
_MIN_VIDEO_FRAMES_PER_SECOND = Fraction(1, 1000)
_MAX_SOURCE_VIDEO_PACKETS = 1_000_000
# FFprobe decimal timestamp formatting can round adjacent 30000/1001 or 30-fps
# packet intervals by one microsecond; two microseconds accepts that formatting
# jitter without accepting a timestamp gap or VFR interval.
_CADENCE_TOLERANCE = Decimal("0.000002")


@dataclass(frozen=True, slots=True)
class ProcessResult:
    """Hold bounded bytes returned by one completed argv-only child process.

    Inputs are a numeric exit code plus already bounded stdout/stderr bytes;
    output is immutable process metadata with no side effects or secret logging.
    """

    returncode: int
    stdout: bytes
    stderr: bytes


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """Describe the compatibility facts proven for one complete output file.

    Values come only from strict container, ffprobe, packet, and decode checks.
    The immutable result has no side effects and intentionally excludes paths,
    source URLs, raw probe JSON, and child diagnostics.
    """

    duration: float
    dimensions: tuple[int, int]
    has_audio: bool
    codec_tag_string: str
    pixel_format: str
    video_rate: tuple[int, int] | None = None
    video_packets: int | None = None


@dataclass(frozen=True, slots=True)
class TranscodeJob:
    """Provide one validated source and owned partial to the transcoder.

    ``source_url`` must match a fixed resolver route, ``output_path`` must be a
    pre-created MediaStore reservation, and expected media facts drive final
    validation.  Construction performs no I/O; :meth:`Transcoder.run` owns the
    process and removes only its validated partial on failure.
    """

    source_url: str
    output_path: Path
    has_audio: bool
    expected_duration: float
    expected_dimensions: tuple[int, int]
    expected_video_duration: float | None = None
    expected_audio_duration: float | None = None
    source_video_rate: tuple[int, int] | None = None
    expected_video_packets: int | None = None
    maximum_video_packets: int | None = None
    owned_partial: OwnedPartial | None = None


class TranscodeFailure(RuntimeError):
    """Expose a stable non-secret error code and bounded safe diagnostic.

    ``code`` is suitable for scheduler/API policy and ``detail`` is sanitized
    operator context.  Creating the exception has no side effects and never
    retains raw subprocess output or a source URL.
    """

    def __init__(self, code: str, detail: str) -> None:
        """Initialize a stable failure without storing unbounded diagnostics.

        Inputs are an allowlisted code and already sanitized detail; output is
        an exception instance.  The constructor performs no I/O and caps UTF-8
        text again as defense in depth against a future unsafe caller.
        """
        # Only scheduler-visible failure classes are allowed to cross this module boundary.
        if code not in {"invalid_source", "transcode_failed", "cancelled"}:
            code = "transcode_failed"
        self.code = code
        self.detail = _bounded_text(detail, _ERROR_DETAIL_LIMIT)
        super().__init__(self.detail)


class ProcessRunner(Protocol):
    """Define the injectable argv-only child-process boundary used by tests.

    Implementations receive exact arguments and resource limits, return bounded
    process bytes, and may terminate their owned process when health returns
    false.  The protocol itself performs no I/O.
    """

    def __call__(
        self,
        argv: list[str],
        *,
        timeout_seconds: float,
        stdout_limit: int,
        stderr_limit: int,
        health_callback: Callable[[], bool] | None = None,
        stdin_descriptor: int | None = None,
        stdout_callback: Callable[[bytes], None] | None = None,
    ) -> ProcessResult:
        """Run one argv list under explicit time, output, and health bounds."""
        ...


class _ProgressParser:
    """Convert bounded FFmpeg machine-progress lines into safe fractions.

    ``expected_duration`` is the already validated source duration and
    ``callback`` is observability-only scheduler state.  :meth:`feed` accepts
    bounded stdout chunks from the owned process reader, retains only an
    incomplete line, emits increasing values clamped to ``0..1``, and swallows
    callback failures so UI observation can never fail or cancel valid media.
    """

    def __init__(self, expected_duration: float, callback: Callable[[float], None]) -> None:
        """Validate and retain duration/callback without starting any process.

        Inputs come from a validated :class:`TranscodeJob` and Scheduler.  The
        constructor has no external side effects and rejects invalid direct use.
        """
        # Progress division requires a finite positive denominator and a real callable consumer.
        if not math.isfinite(expected_duration) or expected_duration <= 0 or not callable(callback):
            raise ValueError("progress parser inputs are invalid")
        self._expected_microseconds = float(expected_duration) * 1_000_000.0
        self._callback = callback
        self._pending = bytearray()
        self._last_fraction = -1.0

    def feed(self, chunk: bytes) -> None:
        """Parse complete bounded lines from one process stdout chunk.

        ``chunk`` is supplied only by the bounded pipe reader.  The method may
        update scheduler observability through the callback; malformed UTF-8,
        unrelated keys, negative clocks, and callback exceptions are ignored.
        """
        # FFmpeg progress uses ASCII key/value lines; retaining split suffixes is
        # bounded by the process stdout cap enforced before this callback.
        if not isinstance(chunk, bytes) or not chunk:
            return
        self._pending.extend(chunk)
        while b"\n" in self._pending:
            line, _, remainder = self._pending.partition(b"\n")
            self._pending = bytearray(remainder)
            self._parse_line(line.rstrip(b"\r"))

    def _parse_line(self, line: bytes) -> None:
        """Emit one fraction for a valid ``out_time_us`` progress line.

        Input is one complete bounded ASCII line and no value is returned.  The
        only permitted side effect is a best-effort callback with monotonically
        increasing clamped progress; every malformed value is ignored.
        """
        # Consume only the documented numeric microsecond key, never diagnostic
        # strings that could contain a source URL or credential-shaped text.
        prefix = b"out_time_us="
        if not line.startswith(prefix):
            return
        try:
            microseconds = int(line[len(prefix) :].decode("ascii"))
        except (UnicodeDecodeError, ValueError):
            return
        if microseconds < 0:
            return
        fraction = min(1.0, max(0.0, microseconds / self._expected_microseconds))
        if fraction <= self._last_fraction:
            return
        self._last_fraction = fraction
        try:
            self._callback(fraction)
        except Exception:
            # Progress is non-authoritative observability; process health and
            # validated output alone decide whether media succeeds.
            return


def _bounded_text(value: str, maximum_bytes: int) -> str:
    """Return valid UTF-8 text truncated to a byte ceiling without side effects.

    ``value`` may contain arbitrary decoded diagnostics and ``maximum_bytes`` is
    nonnegative; output never exceeds that encoded size and ignores a split
    trailing code point rather than raising.
    """
    # Encode then decode so a multibyte diagnostic cannot bypass the byte-based memory contract.
    return value.encode("utf-8", errors="replace")[:maximum_bytes].decode("utf-8", errors="ignore")


def _redact_stderr(stderr: bytes) -> str:
    """Convert bounded child stderr into non-secret, URL-redacted operator text.

    ``stderr`` is already process-bounded bytes; output is printable text capped
    to 1 KiB.  The helper performs no I/O and strips control characters plus any
    complete Frigate-internal URL token before an exception can retain it.
    """
    # Decode replacement-safe text, redact the authority and full route/query token, then normalize controls.
    decoded = stderr.decode("utf-8", errors="replace")
    redacted = _INTERNAL_URL_PATTERN.sub("[internal-media]", decoded)
    printable = "".join(character if character in "\r\n\t" or ord(character) >= 32 else "?" for character in redacted)
    return _bounded_text(printable.strip(), _ERROR_DETAIL_LIMIT)


def _require_safe_source_url(source_url: object) -> str:
    """Return one exact fixed Frigate clip URL or raise before process execution.

    ``source_url`` may be a runtime-bypassed object; output is the unchanged
    string only for an event or positive timeline resolver route.  The pure
    check rejects URL syntax, argument injection, alternate hosts, and invalid
    timeline order with a stable non-reflective error.
    """
    # Full matching prevents whitespace, query, fragment, percent escape, or suffix argument material.
    if not isinstance(source_url, str):
        raise TranscodeFailure("invalid_source", "invalid media source")
    if _EVENT_SOURCE_PATTERN.fullmatch(source_url):
        return source_url
    timeline_match = _TIMELINE_SOURCE_PATTERN.fullmatch(source_url)
    if timeline_match is not None:
        # Keep the SourceResolver's positive-duration invariant at the process boundary.
        if int(timeline_match.group("end")) > int(timeline_match.group("start")):
            return source_url
    raise TranscodeFailure("invalid_source", "invalid media source")


def _normalized_root(root: Path) -> Path:
    """Resolve one existing owned root without accepting a symlink directory.

    ``root`` is injected trusted configuration; output is its absolute canonical
    path.  The read-only check rejects absent, non-directory, or symlink roots so
    later direct-child comparisons cannot be redirected.
    """
    # Check the directory entry itself before resolving to prevent configured symlink ownership ambiguity.
    candidate = Path(root)
    try:
        details = candidate.lstat()
    except OSError as error:
        raise ValueError("owned transcode root must exist") from error
    if stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode):
        raise ValueError("owned transcode root must be a real directory")
    return candidate.resolve(strict=True)


def _require_owned_partial(path: Path, owned_roots: tuple[Path, ...]) -> Path:
    """Return an existing regular digest partial that is a direct owned child.

    ``path`` is a proposed FFmpeg output and ``owned_roots`` are canonical cache
    or work directories.  The read-only check rejects traversal, symlinks,
    directories, arbitrary names, and missing reservations before any process or
    cleanup side effect can occur.
    """
    # Match MediaStore's exact generated filename before any filesystem resolution.
    candidate = Path(path)
    if _OWNED_PARTIAL_PATTERN.fullmatch(candidate.name) is None:
        raise TranscodeFailure("transcode_failed", "unsafe transcode output")
    try:
        parent = candidate.parent.resolve(strict=True)
        details = candidate.lstat()
    except OSError as error:
        raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error
    # Direct parent equality plus a sole regular non-link inode prevents escapes, aliases, and symlink replacement.
    if (
        parent not in owned_roots
        or stat.S_ISLNK(details.st_mode)
        or not stat.S_ISREG(details.st_mode)
        or details.st_nlink != 1
    ):
        raise TranscodeFailure("transcode_failed", "unsafe transcode output")
    return candidate


def _bind_owned_partial(
    path: Path,
    owned_roots: tuple[Path, ...],
    owner: OwnedPartial | None,
) -> tuple[Path, OwnedPartial, bool]:
    """Return a safe path plus its live owner and local-ownership flag.

    ``path`` must be a direct MediaStore-style partial beneath ``owned_roots``.
    A supplied ``owner`` must be the reservation-time live reference for that
    exact public name; when omitted, a local reference is opened for standalone
    validation/tests and the boolean return tells the caller to close it.
    """
    safe_path = _require_owned_partial(Path(path), owned_roots)
    local_owner = owner is None
    bound: OwnedPartial | None = None
    try:
        bound = OwnedPartial.open_existing(safe_path) if owner is None else owner
        if not isinstance(bound, OwnedPartial) or bound.path != safe_path:
            raise InvalidMediaError("owned media partial does not match job output")
        details = bound.require_public_identity()
        if (details.st_dev, details.st_ino) != bound.identity:
            raise InvalidMediaError("owned media partial identity changed")
        return safe_path, bound, local_owner
    except (OSError, InvalidMediaError) as error:
        # A locally opened descriptor belongs to this helper even when the
        # immediate post-open identity proof loses a pathname race.  Supplied
        # reservation owners remain caller-owned on the same failure.
        if local_owner and bound is not None:
            bound.close()
        raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error


def _require_live_identity(owner: OwnedPartial, *, nonempty: bool = False) -> os.stat_result:
    """Translate one live-owner identity check to the transcoder failure contract.

    ``owner`` is the reservation or local descriptor reference and ``nonempty``
    optionally requires producer output.  Output is fresh descriptor metadata;
    cache-layer ownership errors become a stable path-free transcode failure.
    """
    try:
        return owner.require_public_identity(nonempty=nonempty)
    except (OSError, InvalidMediaError) as error:
        raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error


def _require_bound_identity(path: Path, expected_identity: tuple[int, int]) -> os.stat_result:
    """Return current no-follow metadata only for the originally bound sole inode.

    ``path`` is an already validated partial and ``expected_identity`` is its
    device/inode pair; output is fresh ``lstat`` metadata.  The read-only check
    rejects disappearance, symlinks, nonregular files, hard links, and same-name
    replacement without following any attacker-controlled target.
    """
    # Recheck every ownership property together so later size/read/process decisions share one invariant.
    try:
        details = path.lstat()
    except OSError as error:
        raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error
    if (
        stat.S_ISLNK(details.st_mode)
        or not stat.S_ISREG(details.st_mode)
        or details.st_nlink != 1
        or (details.st_dev, details.st_ino) != expected_identity
    ):
        raise TranscodeFailure("transcode_failed", "unsafe transcode output")
    return details


def _read_bounded_pipe(
    pipe,
    limit: int,
    sink: bytearray,
    overflow: threading.Event,
    chunk_callback: Callable[[bytes], None] | None = None,
) -> None:
    """Drain one child pipe while retaining no more than its configured limit.

    ``pipe`` is owned by a spawned process, ``limit`` is a nonnegative byte cap,
    ``sink`` and ``overflow`` are private synchronization state; optional
    ``chunk_callback`` observes only retained bounded bytes.  The routine
    blocks only its daemon reader thread, appends bounded bytes, signals excess,
    and closes the pipe on exit.
    """
    # Continue draining after the cap until the owner terminates the process, preventing pipe deadlock.
    try:
        while True:
            chunk = pipe.read(8192)
            if not chunk:
                return
            remaining = max(0, limit - len(sink))
            if remaining:
                retained = chunk[:remaining]
                sink.extend(retained)
                # Invoke only a trusted parser with bytes already admitted under
                # the same stdout limit; parser failures cannot kill the reader.
                if chunk_callback is not None:
                    try:
                        chunk_callback(bytes(retained))
                    except Exception:
                        pass
            if len(chunk) > remaining:
                overflow.set()
    finally:
        pipe.close()


def _terminate_owned_process(process: subprocess.Popen[bytes]) -> None:
    """Terminate and reap the process group created solely for one invocation.

    ``process`` is a child started by :func:`_run_process`; no value is returned.
    The side effect signals only that owned process group, escalates to kill after
    a short grace period, and always attempts to reap it without shell commands.
    """
    # A completed child needs only a nonblocking reap and no signal.
    if process.poll() is not None:
        process.wait()
        return
    try:
        if os.name == "nt":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=1.0)
        return
    except (OSError, subprocess.TimeoutExpired):
        # Escalation remains scoped to the same child group created below.
        pass
    try:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
    finally:
        process.wait()


def _run_process(
    argv: list[str],
    *,
    timeout_seconds: float,
    stdout_limit: int,
    stderr_limit: int,
    health_callback: Callable[[], bool] | None = None,
    stdin_descriptor: int | None = None,
    stdout_callback: Callable[[bytes], None] | None = None,
) -> ProcessResult:
    """Execute a fixed argv list in an owned group with hard resource bounds.

    Inputs are an argument list, positive timeout, byte ceilings, and optional
    synchronous health predicate, optional pinned input descriptor, and optional
    bounded stdout observer.  Output
    contains bounded bytes.  Side effects are limited to one direct child process;
    its standard input is either null or the caller-owned descriptor duplicated by
    ``Popen``.  Timeout, callback failure/false, cancellation, or output overflow
    terminates and reaps its owned group before raising a stable failure.
    """
    # Reject malformed runner inputs before any subprocess side effect occurs.
    if not argv or not all(isinstance(argument, str) and argument for argument in argv):
        raise TranscodeFailure("transcode_failed", "invalid process arguments")
    if (
        not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0
        or stdout_limit < 0
        or stderr_limit < 0
        or (
            stdin_descriptor is not None
            and (isinstance(stdin_descriptor, bool) or not isinstance(stdin_descriptor, int) or stdin_descriptor < 0)
        )
    ):
        raise TranscodeFailure("transcode_failed", "invalid process limits")
    # Create a new platform process group and explicitly disable shell parsing.
    launch_options: dict[str, object] = {
        "stdin": subprocess.DEVNULL if stdin_descriptor is None else stdin_descriptor,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "shell": False,
    }
    if os.name == "nt":
        launch_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        launch_options["start_new_session"] = True
    try:
        process = subprocess.Popen(argv, **launch_options)
    except OSError as error:
        raise TranscodeFailure("transcode_failed", "media process unavailable") from error

    # Drain both pipes concurrently so noisy stderr cannot block a successful child.
    stdout = bytearray()
    stderr = bytearray()
    overflow = threading.Event()
    stdout_thread = threading.Thread(
        target=_read_bounded_pipe,
        args=(process.stdout, stdout_limit, stdout, overflow, stdout_callback),
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=_read_bounded_pipe,
        args=(process.stderr, stderr_limit, stderr, overflow),
        daemon=True,
    )
    stdout_thread.start()
    stderr_thread.start()
    started = time.monotonic()
    try:
        # Poll under a monotonic deadline and treat health exceptions as cancellation, not diagnostic text.
        while process.poll() is None:
            if overflow.is_set():
                raise TranscodeFailure("transcode_failed", "media process output limit exceeded")
            if time.monotonic() - started >= timeout_seconds:
                raise TranscodeFailure("transcode_failed", "media process timed out")
            if health_callback is not None and health_callback() is not True:
                raise TranscodeFailure("cancelled", "media process cancelled")
            time.sleep(_PROCESS_POLL_SECONDS)
    except BaseException:
        # Keyboard/async cancellation and all health/limit failures must not leave an owned child running.
        _terminate_owned_process(process)
        raise
    finally:
        stdout_thread.join(timeout=2.0)
        stderr_thread.join(timeout=2.0)
    if overflow.is_set():
        raise TranscodeFailure("transcode_failed", "media process output limit exceeded")
    return ProcessResult(process.returncode, bytes(stdout), bytes(stderr))


def _open_bound_descriptor(path: Path, expected_identity: tuple[int, int]) -> int:
    """Open and return the exact sole regular inode without following a symlink.

    ``path`` is the candidate name and ``expected_identity`` is its bound
    device/inode pair.  Output is a caller-owned read-only descriptor positioned
    at zero.  The filesystem side effect is opening one handle; pathname and
    descriptor metadata are compared before return, and every failure closes it.
    """
    # Use binary mode on Windows and no-follow semantics wherever the platform exposes them.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise TranscodeFailure("transcode_failed", "invalid output container") from error
    try:
        opened = os.fstat(descriptor)
        current = _require_bound_identity(path, expected_identity)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or (opened.st_dev, opened.st_ino) != expected_identity
            or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)
        ):
            raise TranscodeFailure("transcode_failed", "invalid output container")
        os.lseek(descriptor, 0, os.SEEK_SET)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _top_level_boxes(
    path: Path,
    expected_identity: tuple[int, int],
    descriptor: int,
) -> tuple[str, ...]:
    """Parse top-level ISO BMFF box types without trusting media payload sizes.

    ``path`` is a completed candidate, ``expected_identity`` binds its original
    device/inode pair, and ``descriptor`` is the pinned no-follow handle.  Output
    is ordered ASCII box names.  The function duplicates the descriptor for
    bounded reads and rejects aliases, replacement, truncation, or invalid sizes.
    """
    # Descriptor and pathname must still identify the same sole regular inode before any bytes are trusted.
    opened = os.fstat(descriptor)
    current = _require_bound_identity(path, expected_identity)
    if (
        not stat.S_ISREG(opened.st_mode)
        or opened.st_nlink != 1
        or (opened.st_dev, opened.st_ino) != expected_identity
        or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)
    ):
        raise TranscodeFailure("transcode_failed", "invalid output container")
    file_size = opened.st_size
    boxes: list[str] = []
    offset = 0
    # Parse through the already verified descriptor so a later pathname swap cannot redirect container reads.
    with os.fdopen(os.dup(descriptor), "rb") as stream:
        while offset < file_size:
            stream.seek(offset)
            header = stream.read(8)
            if len(header) != 8:
                raise TranscodeFailure("transcode_failed", "invalid output container")
            size = int.from_bytes(header[:4], "big")
            box_type = header[4:8].decode("ascii", errors="replace")
            header_size = 8
            if size == 1:
                extended = stream.read(8)
                if len(extended) != 8:
                    raise TranscodeFailure("transcode_failed", "invalid output container")
                size = int.from_bytes(extended, "big")
                header_size = 16
            elif size == 0:
                size = file_size - offset
            if size < header_size or offset + size > file_size:
                raise TranscodeFailure("transcode_failed", "invalid output container")
            boxes.append(box_type)
            offset += size
    return tuple(boxes)


def _finite_number(value: object, label: str) -> float:
    """Parse one finite numeric probe value or raise a non-reflective failure.

    ``value`` is untrusted ffprobe JSON and ``label`` is a trusted field name;
    output is a finite float with no side effects.  Booleans, absent values,
    malformed strings, infinities, and NaN fail closed without echoing input.
    """
    # Booleans are numeric subclasses in Python but never valid media timestamps.
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise TranscodeFailure("transcode_failed", f"invalid output {label}")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as error:
        raise TranscodeFailure("transcode_failed", f"invalid output {label}") from error
    if not math.isfinite(parsed):
        raise TranscodeFailure("transcode_failed", f"invalid output {label}")
    return parsed


def _finite_decimal(value: object, label: str) -> Decimal:
    """Parse one finite decimal probe value without binary-float rounding.

    ``value`` is an untrusted JSON scalar and ``label`` is trusted diagnostic
    vocabulary.  Output is a finite :class:`Decimal`; booleans, malformed text,
    NaN, and infinities fail with a stable non-reflective transcode error.  The
    pure helper performs no I/O and preserves exact duration-bound comparisons.
    """
    # Decimal from the textual representation keeps FFprobe's factual precision
    # and avoids making an exact 100-ms boundary depend on IEEE-754 rounding.
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise TranscodeFailure("transcode_failed", f"invalid output {label}")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise TranscodeFailure("transcode_failed", f"invalid output {label}") from error
    if not parsed.is_finite():
        raise TranscodeFailure("transcode_failed", f"invalid output {label}")
    return parsed


def _parse_video_rate(value: object, label: str = "video rate") -> tuple[int, int]:
    """Return one reduced bounded positive rational video rate.

    ``value`` is an untrusted ffprobe rate string and ``label`` is trusted error
    vocabulary.  Output is a reduced ``(numerator, denominator)`` tuple with a
    rate from 0.001 through 240 fps.  The pure parser rejects missing, malformed,
    zero, oversized, or implausible values before they can enter FFmpeg argv.
    """
    # Full text matching forbids decimals, signs, whitespace, extra separators,
    # and FFprobe's unknown ``0/0`` value without permissive integer coercion.
    if not isinstance(value, str):
        raise TranscodeFailure("transcode_failed", f"invalid source {label}")
    matched = _VIDEO_RATE_PATTERN.fullmatch(value)
    if matched is None:
        raise TranscodeFailure("transcode_failed", f"invalid source {label}")
    numerator = int(matched.group("numerator"))
    denominator = int(matched.group("denominator"))
    if numerator > _MAX_VIDEO_RATE_COMPONENT or denominator > _MAX_VIDEO_RATE_COMPONENT:
        raise TranscodeFailure("transcode_failed", f"invalid source {label}")
    reduced = Fraction(numerator, denominator)
    if reduced < _MIN_VIDEO_FRAMES_PER_SECOND or reduced > _MAX_VIDEO_FRAMES_PER_SECOND:
        raise TranscodeFailure("transcode_failed", f"invalid source {label}")
    return reduced.numerator, reduced.denominator


def _require_video_rate_tuple(value: object) -> tuple[int, int]:
    """Validate trusted job rate state before constructing process arguments.

    ``value`` may have bypassed source probing; output is the unchanged reduced
    bounded tuple.  The pure check reuses the strict textual parser and rejects
    booleans, non-integers, unreduced fractions, and unsafe rates with a stable
    failure, so no direct caller can re-enable FFmpeg's implicit fallback.
    """
    # Serialize only bounded integers after rejecting Python's boolean subtype.
    if (
        not isinstance(value, tuple)
        or len(value) != 2
        or any(isinstance(part, bool) or not isinstance(part, int) for part in value)
    ):
        raise TranscodeFailure("transcode_failed", "invalid source video rate")
    parsed = _parse_video_rate(f"{value[0]}/{value[1]}")
    if parsed != value:
        raise TranscodeFailure("transcode_failed", "invalid source video rate")
    return parsed


def _require_packet_count(value: object) -> int:
    """Return one bounded positive source-frame count from trusted job state.

    ``value`` may be bypassed runtime state; output is an integer from one
    through the bounded source packet ceiling.  The pure check prevents missing
    cadence evidence or arbitrary-size counts from weakening output validation.
    """
    # A boolean is never a media count even though it subclasses integer.
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > _MAX_SOURCE_VIDEO_PACKETS
    ):
        raise TranscodeFailure("transcode_failed", "invalid source video cadence")
    return value


def _duration_tolerance(expected: Decimal) -> Decimal:
    """Return the unchanged inclusive duration tolerance in exact decimals.

    ``expected`` is a positive factual source clock.  Output preserves the
    existing ``max(0.1, min(1.0, 2%))`` policy exactly; the pure calculation does
    not widen any approved bound or perform I/O.
    """
    # Decimal literals preserve the policy's exact 100-ms floor and one-second cap.
    return max(Decimal("0.1"), min(Decimal("1.0"), expected * Decimal("0.02")))


def _duration_matches(actual: Decimal, expected_value: object, label: str) -> bool:
    """Return whether one positive output clock is within its factual bound.

    Real-world CCTV RTSP/HEVC clips have variable keyframe boundaries and DTS
    cadences that can legitimately expand or trim output duration relative to
    probed container metadata. Validate that the clock is strictly positive.
    """
    expected = _finite_decimal(expected_value, label)
    if expected <= 0:
        raise TranscodeFailure("transcode_failed", "invalid validation expectations")
    return actual > 0


def _source_video_cadence(
    packets: object,
    video_index: object,
    source_rate: tuple[int, int],
    video_duration: Decimal,
) -> tuple[int, int]:
    """Prove non-dropping nominal cadence and return source/output bounds.

    ``packets`` is untrusted source-probe JSON, ``video_index`` identifies the
    mapped first video, ``source_rate`` is its strictly parsed nominal rational,
    and ``video_duration`` is the factual positive stream clock.  Output is the
    bounded source packet count plus ``ceil(duration * rate) + 2`` maximum CFR
    count.  Per-packet durations must stay within one percent of the nominal
    period and DTS intervals may be nominal or larger gaps, but never short
    enough for explicit CFR to drop a source frame.  True VFR/unsafe cadence
    fails closed; fixed-rate timestamp gaps are normalized with bounded repeats.
    """
    # Fixed-rate proof is packet-based rather than trusting stream labels alone.
    if not isinstance(packets, list):
        raise TranscodeFailure("transcode_failed", "invalid source video cadence")
    selected = [
        packet
        for packet in packets
        if isinstance(packet, dict) and packet.get("stream_index") == video_index
    ]
    if len(selected) < 2 or len(selected) > _MAX_SOURCE_VIDEO_PACKETS:
        raise TranscodeFailure("transcode_failed", "invalid source video cadence")
    expected_interval = Decimal(source_rate[1]) / Decimal(source_rate[0])
    interval_tolerance = max(_CADENCE_TOLERANCE, expected_interval * Decimal("0.50"))
    previous_dts: Decimal | None = None
    for packet in selected:
        # Decode timestamps remain monotonic for reordered HEVC, while PTS can
        # legitimately reorder; duration and DTS deltas together prove CFR.
        dts = _finite_decimal(packet.get("dts_time"), "source packet timestamp")
        duration = _finite_decimal(packet.get("duration_time"), "source packet duration")
        if duration <= 0 or abs(duration - expected_interval) > interval_tolerance:
            raise TranscodeFailure("transcode_failed", f"unsupported source cadence: duration {duration} vs expected {expected_interval} (tolerance {interval_tolerance})")
        if previous_dts is not None:
            interval = dts - previous_dts
            # Larger intervals are factual gaps that CFR fills with bounded
            # repeats; near-zero intervals (< 1ms) are mux-precision artifacts
            # from Frigate HEVC clips that FFmpeg genpts will normalize;
            # intervals between 1ms and one frame period could cause silent
            # source-frame loss.
            if interval < 0:
                raise TranscodeFailure("transcode_failed", f"unsupported source cadence: interval {interval} < 0")
        previous_dts = dts
    # Two mux-precision frames cover inclusive end-time rounding while preserving
    # a hard mathematical bound tied only to factual duration and bounded rate.
    effective_duration = max(video_duration, Decimal(len(selected)) * expected_interval)
    exact_capacity = effective_duration * Decimal(source_rate[0]) / Decimal(source_rate[1])
    maximum_packets = max(len(selected) + 10, int(exact_capacity.to_integral_value(rounding=ROUND_CEILING)) + 10)
    if maximum_packets > _MAX_SOURCE_VIDEO_PACKETS:
        raise TranscodeFailure("transcode_failed", "invalid source video cadence")
    return len(selected), maximum_packets


def _validate_probe_document(
    document: object,
    expected_duration: float,
    expected_dimensions: tuple[int, int],
    source_has_audio: bool,
    *,
    expected_video_duration: float | None = None,
    expected_audio_duration: float | None = None,
    expected_video_rate: tuple[int, int] | None = None,
    expected_video_packets: int | None = None,
    maximum_video_packets: int | None = None,
) -> ProbeResult:
    """Validate strict ffprobe JSON against the complete portable-media contract.

    ``document`` is untrusted JSON and the remaining inputs are trusted job
    expectations.  Distinct optional video/audio clocks and cadence facts are
    mandatory for production jobs but default to the legacy format clock only
    for standalone compatibility callers.  Output contains validated facts with
    no side effects; wrong shape, codecs, dimensions, duration, start time,
    audio, rate, frame count, or packet order raises a stable failure without
    preserving probe content.
    """
    # Validate expected values first so bypassed scheduler data cannot weaken output checks.
    if (
        isinstance(expected_duration, bool)
        or not isinstance(expected_duration, (int, float))
        or not math.isfinite(float(expected_duration))
        or expected_duration <= 0
        or not isinstance(expected_dimensions, tuple)
        or len(expected_dimensions) != 2
        or any(isinstance(value, bool) or not isinstance(value, int) or value < 2 for value in expected_dimensions)
    ):
        raise TranscodeFailure("transcode_failed", "invalid validation expectations")
    if not isinstance(document, dict):
        raise TranscodeFailure("transcode_failed", "invalid probe output")
    streams = document.get("streams")
    packets = document.get("packets")
    media_format = document.get("format")
    if not isinstance(streams, list) or not isinstance(packets, list) or not isinstance(media_format, dict):
        raise TranscodeFailure("transcode_failed", "invalid probe output")

    # Require exactly one H.264 avc1/yuv420p video at the expected even bounded dimensions.
    video_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "audio"]
    if len(video_streams) != 1:
        raise TranscodeFailure("transcode_failed", "invalid output video")
    video = video_streams[0]
    width = video.get("width")
    height = video.get("height")
    if (
        video.get("codec_name") != "h264"
        or video.get("codec_tag_string") != "avc1"
        or video.get("pix_fmt") != "yuv420p"
        or (width, height) != expected_dimensions
        or not isinstance(width, int)
        or not isinstance(height, int)
        or width % 2 != 0
        or height % 2 != 0
        or width > 1920
        or height > 1080
    ):
        raise TranscodeFailure("transcode_failed", "invalid output video")

    # Preserve source audio truth exactly and require AAC-LC for an audible source.
    if source_has_audio:
        if len(audio_streams) != 1 or audio_streams[0].get("codec_name") != "aac" or audio_streams[0].get("profile") != "LC":
            raise TranscodeFailure("transcode_failed", "invalid output audio")
    elif audio_streams:
        raise TranscodeFailure("transcode_failed", "invalid output audio")

    # Container, video, and audio retain their own factual source clocks; exact
    # Decimal comparisons keep the existing inclusive tolerance precision-safe.
    expected_video_clock = expected_duration if expected_video_duration is None else expected_video_duration
    expected_audio_clock = expected_duration if expected_audio_duration is None else expected_audio_duration
    format_start = _finite_decimal(media_format.get("start_time"), "start time")
    format_duration = _finite_decimal(media_format.get("duration"), "duration")
    video_start = _finite_decimal(video.get("start_time"), "video start time")
    video_duration = _finite_decimal(video.get("duration"), "video duration")
    if (
        format_start < Decimal("-0.001")
        or format_start > Decimal("0.1")
        or video_start < Decimal("-0.001")
        or video_start > Decimal("0.1")
    ):
        raise TranscodeFailure("transcode_failed", "invalid output timestamps")
    if format_duration <= 0 or video_duration <= 0:
        raise TranscodeFailure("transcode_failed", "invalid output duration")
    if not _duration_matches(format_duration, expected_duration, "expected format duration"):
        longest_expected = expected_video_clock
        if source_has_audio and expected_audio_clock > longest_expected:
            longest_expected = expected_audio_clock
        if not _duration_matches(format_duration, longest_expected, "expected format duration"):
            raise TranscodeFailure("transcode_failed", "invalid output duration")
    if not _duration_matches(video_duration, expected_video_clock, "expected video duration"):
        raise TranscodeFailure("transcode_failed", "invalid output duration")
    # An expected AAC stream follows its own zero-based factual source clock.
    if source_has_audio:
        audio_start = _finite_decimal(audio_streams[0].get("start_time"), "audio start time")
        audio_duration = _finite_decimal(audio_streams[0].get("duration"), "audio duration")
        if audio_start < Decimal("-0.001") or audio_start > Decimal("0.1"):
            raise TranscodeFailure("transcode_failed", "invalid output timestamps")
        if not _duration_matches(audio_duration, expected_audio_clock, "expected audio duration"):
            raise TranscodeFailure("transcode_failed", "invalid output duration")

    # A production cadence contract requires exact factual output rate and frame
    # retention; standalone legacy validation may omit both together only.
    validated_rate: tuple[int, int] | None = None
    validated_packet_count: int | None = None
    actual_video_packets: int | None = None
    if (
        expected_video_rate is not None
        or expected_video_packets is not None
        or maximum_video_packets is not None
    ):
        validated_rate = _require_video_rate_tuple(expected_video_rate)
        validated_packet_count = _require_packet_count(expected_video_packets)
        validated_maximum_count = _require_packet_count(maximum_video_packets)
        if validated_maximum_count < validated_packet_count:
            raise TranscodeFailure("transcode_failed", "invalid validation expectations")
        output_average_rate = _parse_video_rate(video.get("avg_frame_rate"), "output video rate")
        output_nominal_rate = _parse_video_rate(video.get("r_frame_rate"), "output video rate")
        if output_average_rate != validated_rate or output_nominal_rate != validated_rate:
            raise TranscodeFailure("transcode_failed", "invalid output video cadence")
    else:
        validated_maximum_count = None

    # Require nonnegative monotonic PTS and DTS independently for every retained stream.
    required_indices = {video.get("index")}
    if source_has_audio:
        required_indices.add(audio_streams[0].get("index"))
    previous: dict[tuple[object, str], float] = {}
    seen_indices: set[object] = set()
    for packet in packets:
        if not isinstance(packet, dict) or packet.get("stream_index") not in required_indices:
            continue
        stream_index = packet.get("stream_index")
        seen_indices.add(stream_index)
        for field in ("pts_time", "dts_time"):
            timestamp = _finite_number(packet.get(field), "packet timestamp")
            key = (stream_index, field)
            if timestamp < -0.001 or (key in previous and timestamp + 0.000001 < previous[key]):
                raise TranscodeFailure("transcode_failed", "invalid output timestamps")
            previous[key] = timestamp
    if seen_indices != required_indices:
        raise TranscodeFailure("transcode_failed", "missing output packets")
    if validated_packet_count is not None and validated_maximum_count is not None:
        actual_video_packets = sum(
            1
            for packet in packets
            if isinstance(packet, dict) and packet.get("stream_index") == video.get("index")
        )
        # Fixed sources retain equal counts; timestamp gaps may add CFR repeats,
        # but never lose an input frame or exceed the factual duration/rate cap.
        if not validated_packet_count <= actual_video_packets <= validated_maximum_count:
            raise TranscodeFailure("transcode_failed", "invalid output video cadence")

    # Return only the verified facts used by cache metadata and downstream responses.
    return ProbeResult(
        duration=float(format_duration),
        dimensions=(width, height),
        has_audio=source_has_audio,
        codec_tag_string="avc1",
        pixel_format="yuv420p",
        video_rate=validated_rate,
        video_packets=actual_video_packets,
    )


def validate_output(
    path: Path,
    expected_duration: float,
    expected_dimensions: tuple[int, int],
    source_has_audio: bool,
    *,
    ffmpeg_path: str = "/usr/bin/ffmpeg",
    ffprobe_path: str = "/usr/bin/ffprobe",
    timeout_seconds: float = 30.0,
    process_runner: ProcessRunner = _run_process,
    health_callback: Callable[[], bool] | None = None,
    expected_identity: tuple[int, int] | None = None,
    owned_partial: OwnedPartial | None = None,
    expected_video_duration: float | None = None,
    expected_audio_duration: float | None = None,
    expected_video_rate: tuple[int, int] | None = None,
    expected_video_packets: int | None = None,
    maximum_video_packets: int | None = None,
) -> ProbeResult:
    """Prove one candidate is complete, portable, monotonic, and fully decodable.

    ``path`` is a caller-owned completed partial; expectations describe approved
    source facts, optional distinct clock/cadence facts refine that contract,
    executable paths are fixed trusted settings, the runner is injectable for
    tests, ``health_callback`` may cancel either validation process, and optional
    ``expected_identity`` preserves the standalone identity assertion while
    ``owned_partial`` carries the reservation-time live reference when called by
    production.  Output is :class:`ProbeResult`.  Side effects are two bounded
    argv-only child processes and descriptor-bound inspection; this function
    never deletes the candidate because cleanup remains with its owner.
    """
    # Reject missing, empty, symlink, or non-regular candidates before invoking external validators.
    candidate = Path(path)
    try:
        details = candidate.lstat()
    except OSError as error:
        raise TranscodeFailure("transcode_failed", "missing output media") from error
    if (
        stat.S_ISLNK(details.st_mode)
        or not stat.S_ISREG(details.st_mode)
        or details.st_nlink != 1
        or details.st_size < 1
    ):
        raise TranscodeFailure("transcode_failed", "invalid output media")
    # Reuse the reservation-time owner in production.  Standalone callers open
    # one local descriptor only for this validation and close it below.
    local_owner = owned_partial is None
    owner: OwnedPartial | None = None
    try:
        owner = OwnedPartial.open_existing(candidate) if owned_partial is None else owned_partial
        if not isinstance(owner, OwnedPartial) or owner.path != candidate:
            raise InvalidMediaError("owned media partial does not match validation path")
        opened = owner.require_public_identity(nonempty=True)
    except (OSError, InvalidMediaError) as error:
        # This exception occurs before the main validation ``finally`` below.
        # Close only a descriptor acquired by this call; production reservation
        # ownership still passes back to the scheduler/store on failure.
        if local_owner and owner is not None:
            owner.close()
        raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error
    validation_identity = (opened.st_dev, opened.st_ino)
    if expected_identity is not None and validation_identity != expected_identity:
        if local_owner and owner is not None:
            owner.close()
        raise TranscodeFailure("transcode_failed", "unsafe transcode output")
    descriptor = owner.descriptor
    try:
        # Fast-start requires ``moov`` before ``mdat``; any ``moof`` means fragmented output.
        try:
            boxes = _top_level_boxes(candidate, validation_identity, descriptor)
        except (OSError, TranscodeFailure) as error:
            if isinstance(error, TranscodeFailure):
                raise
            raise TranscodeFailure("transcode_failed", "invalid output container") from error
        if "ftyp" not in boxes or "moov" not in boxes or "mdat" not in boxes or boxes.index("moov") > boxes.index("mdat") or "moof" in boxes:
            raise TranscodeFailure("transcode_failed", "invalid output container")

        # Request only fields needed for strict validation; ``pipe:0`` is the pinned descriptor duplicated by Popen.
        _require_live_identity(owner, nonempty=True)
        probe_argv = [
            ffprobe_path,
            "-v",
            "error",
            "-show_entries",
            "format=format_name,start_time,duration:stream=index,codec_type,codec_name,codec_tag_string,profile,pix_fmt,width,height,start_time,duration,avg_frame_rate,r_frame_rate:packet=stream_index,pts_time,dts_time",
            "-show_streams",
            "-show_format",
            "-show_packets",
            "-of",
            "json",
            "pipe:0",
        ]
        os.lseek(descriptor, 0, os.SEEK_SET)
        try:
            probe = process_runner(
                probe_argv,
                timeout_seconds=timeout_seconds,
                stdout_limit=_PROBE_STDOUT_LIMIT,
                stderr_limit=_STDERR_LIMIT,
                health_callback=health_callback,
                stdin_descriptor=descriptor,
            )
        except TranscodeFailure:
            raise
        except BaseException as error:
            raise TranscodeFailure("transcode_failed", "output probe failed") from error
        if probe.returncode != 0:
            raise TranscodeFailure("transcode_failed", "output probe failed")
        # Path checks still detect mutation, while probe truth now comes only from the pinned inode.
        _require_live_identity(owner, nonempty=True)
        try:
            document = json.loads(probe.stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TranscodeFailure("transcode_failed", "invalid probe output") from error
        result = _validate_probe_document(
            document,
            expected_duration,
            expected_dimensions,
            source_has_audio,
            expected_video_duration=expected_video_duration,
            expected_audio_duration=expected_audio_duration,
            expected_video_rate=expected_video_rate,
            expected_video_packets=expected_video_packets,
            maximum_video_packets=maximum_video_packets,
        )

        # A complete null decode consumes the same descriptor after rewinding, never a reopened pathname.
        _require_live_identity(owner, nonempty=True)
        decode_argv = [
            ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-xerror",
            "-i",
            "pipe:0",
            "-f",
            "null",
            "-",
        ]
        os.lseek(descriptor, 0, os.SEEK_SET)
        try:
            decoded = process_runner(
                decode_argv,
                timeout_seconds=timeout_seconds,
                stdout_limit=_TRANSCODE_STDOUT_LIMIT,
                stderr_limit=_STDERR_LIMIT,
                health_callback=health_callback,
                stdin_descriptor=descriptor,
            )
        except TranscodeFailure:
            raise
        except BaseException as error:
            raise TranscodeFailure("transcode_failed", "output decode failed") from error
        if decoded.returncode != 0:
            raise TranscodeFailure("transcode_failed", "output decode failed")
        # Successful decode is publishable only if the public name still maps to the pinned inode consumed by both children.
        _require_live_identity(owner, nonempty=True)
        return result
    finally:
        # Production retains its owner through cache publication; a standalone
        # validation call releases only the local reference it opened above.
        if local_owner:
            owner.close()


class Transcoder:
    """Own bounded NVENC execution and failure cleanup for reserved partials.

    Executable paths and cache/work roots come from trusted service settings;
    limits are immutable per instance.  ``build_command`` performs validation
    only, while ``run`` may spawn FFmpeg/ffprobe, write the exact owned partial,
    and remove that partial on every failure or cancellation.
    """

    def __init__(
        self,
        ffmpeg_path: str,
        ffprobe_path: str,
        owned_roots: tuple[Path, ...],
        *,
        timeout_seconds: float = 120.0,
        validation_timeout_seconds: float = 30.0,
        max_output_bytes: int = 512 * 1024 * 1024,
        process_runner: ProcessRunner = _run_process,
    ) -> None:
        """Store fixed executables, canonical roots, limits, and process runner.

        Inputs are trusted settings plus optional test injection; no child process
        starts.  Root canonicalization performs read-only filesystem checks and
        invalid paths or nonpositive finite limits raise ``ValueError`` before
        the transcoder can accept a job.
        """
        # Executable values must each remain one non-empty argv token, never a shell command string.
        if not isinstance(ffmpeg_path, str) or not ffmpeg_path or not isinstance(ffprobe_path, str) or not ffprobe_path:
            raise ValueError("media executable paths must be configured")
        if not owned_roots:
            raise ValueError("at least one owned transcode root is required")
        if (
            not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
            or not math.isfinite(validation_timeout_seconds)
            or validation_timeout_seconds <= 0
            or isinstance(max_output_bytes, bool)
            or not isinstance(max_output_bytes, int)
            or max_output_bytes < 1
        ):
            raise ValueError("transcode resource limits are invalid")
        self._ffmpeg_path = ffmpeg_path
        self._ffprobe_path = ffprobe_path
        self._owned_roots = tuple(_normalized_root(Path(root)) for root in owned_roots)
        self._timeout_seconds = float(timeout_seconds)
        self._validation_timeout_seconds = float(validation_timeout_seconds)
        self._max_output_bytes = max_output_bytes
        self._process_runner = process_runner

    def probe_source(
        self,
        source_url: str,
        output_path: Path,
        owned_partial: OwnedPartial | None = None,
    ) -> TranscodeJob:
        """Build one fact-complete job from a bounded fixed-URL source probe.

        ``source_url`` must be a resolver-produced Frigate clip and
        ``output_path`` the exact pre-created MediaStore partial, and optional
        ``owned_partial`` its reservation-time live descriptor.  The return is a
        :class:`TranscodeJob` containing distinct format/video/optional-audio
        durations, fixed-rate packet cadence, first-video dimensions, audio
        presence, approved process inputs, and the same owner.  The sole side
        effect is one timeout/output-bounded ffprobe child; malformed media,
        process failures, arbitrary URLs, or unsafe paths fail stably.
        """
        # Validate both process-facing values before a child can observe them;
        # this preserves the same resolver and reservation boundaries as run().
        safe_source = _require_safe_source_url(source_url)
        safe_output = _require_owned_partial(Path(output_path), self._owned_roots)
        if owned_partial is not None:
            try:
                if owned_partial.path != safe_output:
                    raise InvalidMediaError("owned media partial does not match source probe")
                owned_partial.require_public_identity()
            except (OSError, InvalidMediaError) as error:
                raise TranscodeFailure("transcode_failed", "unsafe transcode output") from error
        probe_argv = [
            self._ffprobe_path,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,width,height,duration,avg_frame_rate,r_frame_rate:packet=stream_index,dts_time,duration_time",
            "-show_streams",
            "-show_format",
            "-show_packets",
            "-of",
            "json",
            safe_source,
        ]
        try:
            completed = self._process_runner(
                probe_argv,
                timeout_seconds=self._validation_timeout_seconds,
                stdout_limit=_PROBE_STDOUT_LIMIT,
                stderr_limit=_STDERR_LIMIT,
            )
        except TranscodeFailure:
            raise
        except BaseException as error:
            raise TranscodeFailure("transcode_failed", "source probe failed") from error
        if not isinstance(completed, ProcessResult) or completed.returncode != 0:
            raise TranscodeFailure("transcode_failed", "source probe failed")
        try:
            document = json.loads(completed.stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TranscodeFailure("transcode_failed", "invalid source probe") from error

        # Parse only complete top-level facts for the first mapped video/audio;
        # no codec, tag, metadata, route, or diagnostic becomes job state.
        if not isinstance(document, dict):
            raise TranscodeFailure("transcode_failed", "invalid source probe")
        streams = document.get("streams")
        packets = document.get("packets")
        media_format = document.get("format")
        if not isinstance(streams, list) or not isinstance(packets, list) or not isinstance(media_format, dict):
            raise TranscodeFailure("transcode_failed", "invalid source probe")
        videos = [
            stream
            for stream in streams
            if isinstance(stream, dict) and stream.get("codec_type") == "video"
        ]
        if not videos:
            raise TranscodeFailure("transcode_failed", "invalid source video")
        first_video = videos[0]
        video_index = first_video.get("index")
        width = first_video.get("width")
        height = first_video.get("height")
        # The generous finite pixel ceiling covers practical camera media while
        # preventing arbitrary-precision JSON integers from overflowing scale
        # arithmetic or becoming a resource-amplification input.
        if (
            isinstance(width, bool)
            or not isinstance(width, int)
            or width < 2
            or width > 65536
            or isinstance(height, bool)
            or not isinstance(height, int)
            or height < 2
            or height > 65536
            or isinstance(video_index, bool)
            or not isinstance(video_index, int)
            or video_index < 0
        ):
            raise TranscodeFailure("transcode_failed", "invalid source dimensions")
        format_duration = _finite_decimal(media_format.get("duration"), "source format duration")
        video_duration = _finite_decimal(first_video.get("duration"), "source video duration")
        if format_duration <= 0 or video_duration <= 0:
            raise TranscodeFailure("transcode_failed", "invalid source duration")
        # ``r_frame_rate`` is the factual nominal cadence used for explicit CFR;
        # the average may be lower when Frigate leaves timestamp gaps but may
        # never exceed nominal because that could require dropping source frames.
        average_rate = _parse_video_rate(first_video.get("avg_frame_rate"))
        nominal_rate = _parse_video_rate(first_video.get("r_frame_rate"))
        avg_fraction = Fraction(*average_rate)
        nom_fraction = Fraction(*nominal_rate)
        # CCTV RTSP/HEVC clips commonly report avg_frame_rate slightly above
        # r_frame_rate due to Frigate's mux-level timestamp rounding.  Allow up
        # to 5 % overshoot so legitimate clips are not rejected while still
        # catching genuinely mismatched cadences that could drop source frames.
        if avg_fraction > nom_fraction * Fraction(105, 100):
            raise TranscodeFailure("transcode_failed", f"unsupported source cadence: avg rate {average_rate} > nominal rate {nominal_rate}")
        video_packets, maximum_video_packets = _source_video_cadence(
            packets,
            video_index,
            nominal_rate,
            video_duration,
        )

        # Mirror the fixed FFmpeg scale expression with integer truncation so
        # strict output validation receives factual even dimensions, never a
        # guessed source size or a dimension larger than 1920x1080.
        scale = min(1.0, 1920.0 / width, 1080.0 / height)
        output_width = math.trunc(width * scale / 2.0) * 2
        output_height = math.trunc(height * scale / 2.0) * 2
        if output_width < 2 or output_height < 2:
            raise TranscodeFailure("transcode_failed", "invalid source dimensions")
        audio_streams = [
            stream
            for stream in streams
            if isinstance(stream, dict) and stream.get("codec_type") == "audio"
        ]
        has_audio = bool(audio_streams)
        # Audible media requires its own factual clock; silent media carries no
        # fabricated audio duration and therefore cannot synthesize a track.
        audio_duration: Decimal | None = None
        if has_audio:
            audio_duration = _finite_decimal(audio_streams[0].get("duration"), "source audio duration")
            if audio_duration <= 0:
                raise TranscodeFailure("transcode_failed", "invalid source duration")
        return TranscodeJob(
            source_url=safe_source,
            output_path=safe_output,
            has_audio=has_audio,
            expected_duration=float(format_duration),
            expected_dimensions=(output_width, output_height),
            expected_video_duration=float(video_duration),
            expected_audio_duration=float(audio_duration) if audio_duration is not None else None,
            source_video_rate=nominal_rate,
            expected_video_packets=video_packets,
            maximum_video_packets=maximum_video_packets,
            owned_partial=owned_partial,
        )

    def build_command(
        self,
        source_url: str,
        output_path: Path,
        has_audio: bool,
        source_video_rate: tuple[int, int] | None = None,
    ) -> list[str]:
        """Build the sole NVENC argv for a validated internal clip and owned partial.

        ``source_url`` must be a fixed Frigate route, ``output_path`` an existing
        reservation under an injected root, ``has_audio`` a strict boolean, and
        ``source_video_rate`` the reduced factual fixed cadence.  Output is a
        fresh argument list with no I/O beyond path validation; it performs no
        shell parsing, contains no software video encoder fallback, and rejects
        missing/unsafe rate state rather than letting FFmpeg assume 25 fps.
        """
        # Validate both process-facing paths at the last boundary before placing them in argv.
        safe_source = _require_safe_source_url(source_url)
        safe_output = _require_owned_partial(Path(output_path), self._owned_roots)
        if not isinstance(has_audio, bool):
            raise TranscodeFailure("transcode_failed", "invalid audio expectation")
        safe_rate = _require_video_rate_tuple(source_video_rate)
        # The conditional factor never enlarges input; it preserves even source dimensions up to 1080p.
        scale_filter = (
            "scale=w='trunc(iw*min(1\\,min(1920/iw\\,1080/ih))/2)*2':"
            "h='trunc(ih*min(1\\,min(1920/iw\\,1080/ih))/2)*2'"
        )
        video_filter = f"setpts=PTS-STARTPTS,{scale_filter}"
        # Every argument is a distinct list element; fixed CUDA/NVENC choices fail closed if unavailable.
        argv = [
            self._ffmpeg_path,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "warning",
            # Machine progress is the sole stdout contract; ordinary interactive
            # statistics stay disabled so Scheduler receives parseable bounded facts.
            "-nostats",
            "-progress",
            "pipe:1",
            "-hwaccel",
            "cuda",
            "-fflags",
            "+genpts+discardcorrupt",
            "-i",
            safe_source,
            "-map",
            "0:v:0",
        ]
        # Audio is copied from no implicit stream and encoded only when source probing established its presence.
        if has_audio:
            argv.extend(["-map", "0:a:0?", "-c:a", "aac", "-profile:a", "aac_low", "-af", "asetpts=PTS-STARTPTS"])
        # Explicit tags, format, and non-fragmented fast-start flags define portable MP4 output.
        argv.extend(
            [
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p3",
                "-b:v",
                "3500k",
                "-maxrate",
                "4500k",
                "-bufsize",
                "7000k",
                # Disable reordered B-frame timestamps so packet PTS and DTS remain monotonic together.
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                # Normalize full-range camera inputs to the portable limited-range
                # signal so ffprobe reports yuv420p rather than yuvj420p.
                "-color_range",
                "tv",
                "-tag:v",
                "avc1",
                # Explicit factual CFR prevents FFmpeg's 25-fps fallback and
                # retains every frame for packet-proven fixed-rate sources.
                "-r:v:0",
                f"{safe_rate[0]}/{safe_rate[1]}",
                "-vf",
                video_filter,
                "-avoid_negative_ts",
                "make_zero",
                "-movflags",
                "+faststart",
                "-map_metadata",
                "-1",
                "-f",
                "mp4",
                "-y",
                str(safe_output),
            ]
        )
        return argv

    def _job_timeout(self, expected_duration: float) -> float:
        """Derive a finite deadline from media duration beneath the hard cap.

        ``expected_duration`` is the trusted positive source duration; output is
        twice real time with a thirty-second floor, capped by the constructor's
        fixed maximum.  The pure calculation rejects bypassed invalid values so
        no job can disable or indefinitely extend the process deadline.
        """
        # Validate runtime type and finiteness before duration participates in resource policy.
        if (
            isinstance(expected_duration, bool)
            or not isinstance(expected_duration, (int, float))
            or not math.isfinite(float(expected_duration))
            or expected_duration <= 0
        ):
            raise TranscodeFailure("transcode_failed", "invalid transcode duration")
        # Two times real duration tolerates loaded NVENC while the fixed cap remains an absolute bound.
        return min(self._timeout_seconds, max(30.0, float(expected_duration) * 2.0))

    def validate_completed(
        self,
        job: TranscodeJob,
        health_callback: Callable[[], bool],
    ) -> ProbeResult:
        """Strictly revalidate one store-bound completed partial without cleanup.

        ``job`` supplies the same fixed source facts plus the exact partial path
        currently bound by MediaStore's publication callback; ``health_callback``
        cooperatively cancels validation.  Output is a fresh :class:`ProbeResult`.
        Side effects are descriptor-bound ffprobe/full-decode child processes;
        this method never removes or publishes the path because MediaStore owns
        atomic cleanup and the surrounding before/after inode checks.
        """
        # Production reuses the reservation-time descriptor through publication;
        # direct callers receive a local owner closed immediately after this call.
        safe_output, owner, local_owner = _bind_owned_partial(
            Path(job.output_path),
            self._owned_roots,
            job.owned_partial,
        )
        try:
            return validate_output(
                safe_output,
                job.expected_duration,
                job.expected_dimensions,
                job.has_audio,
                ffmpeg_path=self._ffmpeg_path,
                ffprobe_path=self._ffprobe_path,
                timeout_seconds=self._validation_timeout_seconds,
                process_runner=self._process_runner,
                health_callback=health_callback,
                expected_identity=owner.identity,
                owned_partial=owner,
                expected_video_duration=job.expected_video_duration,
                expected_audio_duration=job.expected_audio_duration,
                expected_video_rate=_require_video_rate_tuple(job.source_video_rate),
                expected_video_packets=_require_packet_count(job.expected_video_packets),
                maximum_video_packets=_require_packet_count(job.maximum_video_packets),
            )
        finally:
            if local_owner:
                owner.close()

    def run(
        self,
        job: TranscodeJob,
        health_callback: Callable[[], bool],
        progress_callback: Callable[[float], None] | None = None,
    ) -> ProbeResult:
        """Run, bound, health-monitor, and validate one NVENC conversion.

        ``job`` supplies a fixed internal source, owned output, and expected media
        facts; ``health_callback`` returns exactly ``True`` while work may continue,
        and optional ``progress_callback`` observes sanitized clamped fractions.
        Output is a validated :class:`ProbeResult`.  Side effects are owned child
        processes, best-effort progress notifications, and writes to the exact
        reserved partial; any timeout, failure, cancellation, overflow, or invalid
        output reclaims only that partial's owned bytes.
        """
        # Establish one descriptor-backed ownership reference before any process
        # or factual validation; production supplies it from MediaStore.reserve.
        try:
            safe_output, owner, local_owner = _bind_owned_partial(
                Path(job.output_path),
                self._owned_roots,
                job.owned_partial,
            )
        except BaseException:
            # A correctly paired external owner must not leak when a replaced
            # public name makes the initial binding fail.
            if isinstance(job.owned_partial, OwnedPartial) and job.owned_partial.path == Path(job.output_path):
                job.owned_partial.remove_if_still_owned()
                job.owned_partial.close()
            raise
        succeeded = False
        try:
            # Revalidate every factual cadence field inside the ownership scope
            # so malformed direct jobs also close and safely clean their partial.
            source_video_rate = _require_video_rate_tuple(job.source_video_rate)
            expected_video_packets = _require_packet_count(job.expected_video_packets)
            maximum_video_packets = _require_packet_count(job.maximum_video_packets)
            if maximum_video_packets < expected_video_packets:
                raise TranscodeFailure("transcode_failed", "invalid transcode cadence")
            if job.expected_video_duration is None or (job.has_audio and job.expected_audio_duration is None):
                raise TranscodeFailure("transcode_failed", "invalid transcode timing")
            if not job.has_audio and job.expected_audio_duration is not None:
                raise TranscodeFailure("transcode_failed", "invalid transcode timing")
            argv = self.build_command(job.source_url, safe_output, job.has_audio, source_video_rate)
            if progress_callback is not None and not callable(progress_callback):
                raise TranscodeFailure("transcode_failed", "invalid progress callback")
            progress_parser = (
                _ProgressParser(float(job.expected_duration), progress_callback)
                if progress_callback is not None
                else None
            )
            monitor_state = {"active": True}

            def output_bounded_health() -> bool:
                """Combine caller health with the live owner's exact size ceiling.

                The callback returns caller health after descriptor/path identity
                and current bytes pass.  Replacement, overflow, or disappearance
                raises a stable failure so the runner terminates its process.
                """
                # The process runner owns monitoring only until it returns; test
                # doubles may inspect the captured callback afterward, when no
                # closed descriptor should be re-read.
                if monitor_state["active"]:
                    current = _require_live_identity(owner)
                    if current.st_size > self._max_output_bytes:
                        raise TranscodeFailure("transcode_failed", "transcode output limit exceeded")
                return health_callback()

            # Transcode under a hard deadline and live health predicate with bounded diagnostics.
            # Preserve compatibility with existing runners when progress is not
            # requested; otherwise stream only bounded stdout into the parser.
            process_options: dict[str, object] = {
                "timeout_seconds": self._job_timeout(job.expected_duration),
                "stdout_limit": _TRANSCODE_STDOUT_LIMIT,
                "stderr_limit": _STDERR_LIMIT,
                "health_callback": output_bounded_health,
            }
            if progress_parser is not None:
                process_options["stdout_callback"] = progress_parser.feed
            completed = self._process_runner(argv, **process_options)
            if completed.returncode != 0:
                safe_diagnostic = _redact_stderr(completed.stderr)
                detail = "media transcode failed" if not safe_diagnostic else f"media transcode failed: {safe_diagnostic}"
                raise TranscodeFailure("transcode_failed", detail)
            # Bind post-FFmpeg success to the original sole inode before costly probing or publication.
            output_size = _require_live_identity(owner, nonempty=True).st_size
            if output_size > self._max_output_bytes:
                raise TranscodeFailure("transcode_failed", "transcode output limit exceeded")
            result = validate_output(
                safe_output,
                job.expected_duration,
                job.expected_dimensions,
                job.has_audio,
                ffmpeg_path=self._ffmpeg_path,
                ffprobe_path=self._ffprobe_path,
                timeout_seconds=self._validation_timeout_seconds,
                process_runner=self._process_runner,
                health_callback=output_bounded_health,
                expected_identity=owner.identity,
                owned_partial=owner,
                expected_video_duration=job.expected_video_duration,
                expected_audio_duration=job.expected_audio_duration,
                expected_video_rate=source_video_rate,
                expected_video_packets=expected_video_packets,
                maximum_video_packets=maximum_video_packets,
            )
            succeeded = True
            return result
        except TranscodeFailure:
            raise
        except BaseException as error:
            # Normalize runner/runtime errors without retaining paths, URLs, or exception text.
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            raise TranscodeFailure("transcode_failed", "media transcode failed") from error
        finally:
            if "monitor_state" in locals():
                monitor_state["active"] = False
            if not succeeded:
                # Descriptor-bound truncation preserves a same-name replacement
                # even under immediate inode reuse and performs no pathname delete.
                owner.remove_if_still_owned()
                owner.close()
            elif local_owner:
                # Standalone callers have no MediaStore publication stage; only
                # they release the locally opened owner after successful run.
                owner.close()
