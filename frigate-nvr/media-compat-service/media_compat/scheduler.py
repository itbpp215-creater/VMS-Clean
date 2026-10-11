"""Coalesce, prioritize, and run compatibility media jobs with one worker.

The scheduler resolves immutable sources, hashes only safe identities, admits a
bounded one-running/two-waiting set, and delegates all media/storage authority
to injected reviewed components.  It retains no credentials, recording paths,
or raw media and owns no Docker, Frigate, or camera control capability.
"""

from __future__ import annotations

import asyncio
import heapq
import inspect
import math
import secrets
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Awaitable, Protocol

from media_compat.auth import UserContext
from media_compat.cache import CacheKey, MediaStore, Reservation
from media_compat.health import GateDecision, HealthGate, HealthSnapshot
from media_compat.models import PrepareRequest, Purpose, ResolvedSource
from media_compat.transcoder import ProbeResult, TranscodeFailure, TranscodeJob, Transcoder

# These versioned output facts deliberately exclude request purpose so playback,
# download, share, and prefetch for the same source coalesce to one derived file.
_OUTPUT_PROFILE = "portable-h264"
_OUTPUT_SCHEMA_VERSION = 1
_PURPOSE_PRIORITY = {"playback": 0, "download": 0, "share": 0, "prefetch": 1}
_EXPLICIT_PURPOSES = frozenset({"playback", "download", "share"})


class Resolver(Protocol):
    """Describe the reviewed async immutable-source resolver dependency."""

    async def resolve(self, request: PrepareRequest, user: UserContext) -> ResolvedSource:
        """Return one validated fixed Frigate-internal source identity and URL."""
        ...


class JobFactory(Protocol):
    """Bridge a resolved source and owned reservation to probed transcode facts."""

    def __call__(
        self, source: ResolvedSource, reservation: Reservation
    ) -> TranscodeJob | Awaitable[TranscodeJob]:
        """Return a fact-complete job, optionally after an async source probe."""
        ...


class QueueFullError(RuntimeError):
    """Expose stable HTTP-style overload metadata without source information."""

    status_code = 429
    code = "queue_full"
    retry_after_ms = 500

    def __init__(self) -> None:
        """Create a credential-free bounded-capacity refusal with no side effects."""
        super().__init__(self.code)


class HealthGateError(RuntimeError):
    """Expose stable HTTP-style retry metadata for uncached unhealthy work."""

    status_code = 503
    code = "health_gate"
    retry_after_ms = 1000

    def __init__(self, reason: str | None = None) -> None:
        """Retain only an allowlisted health class, never external diagnostics.

        ``reason`` comes from :class:`GateDecision`; construction performs no
        side effects and normalizes unknown values to a generic health code.
        """
        allowed = {
            "frigate_unavailable",
            "encoder_unavailable",
            "gpu_temperature",
            "gpu_memory",
            "storage_unavailable",
        }
        self.reason = reason if reason in allowed else None
        super().__init__(self.code)


@dataclass(slots=True)
class Job:
    """Track one coalesced derived-media lifecycle without source credentials.

    Public fields contain only opaque identifiers, safe purpose/state metadata,
    anonymous timing/progress, and stable errors.  Private fields retain the
    resolver-produced fixed internal source plus waiter bookkeeping in memory;
    no state is persisted and representation excludes internal media details.
    """

    job_id: str
    cache_key: str
    purpose: Purpose
    state: str
    queued_at: float
    started_at: float | None = None
    completed_at: float | None = None
    retry_count: int = 0
    last_error_code: str | None = None
    progress: float = 0.0
    queue_seconds: float = 0.0
    run_seconds: float = 0.0
    _resolved_source: ResolvedSource = field(repr=False, default=None)  # type: ignore[assignment]
    _waiters: set[str] = field(default_factory=set, repr=False)
    _owners: set[str] = field(default_factory=set, repr=False)
    _heap_version: int = field(default=0, repr=False)
    _sequence: int = field(default=0, repr=False)
    _attempt_started_at: float | None = field(default=None, repr=False)
    _cancel_requested: bool = field(default=False, repr=False)

    @property
    def waiter_identities(self) -> tuple[str, ...]:
        """Return a sorted immutable view of current authenticated waiters."""
        return tuple(sorted(self._waiters))


def _safe_username(user: UserContext) -> str:
    """Return one bounded trusted username suitable for in-memory ownership.

    Input is a gateway-authenticated context and output is its unchanged scalar
    username.  The pure check rejects bypassed blank/control/oversized values so
    job metadata cannot become an unbounded or log-breaking secret carrier.
    """
    if not isinstance(user, UserContext):
        raise TypeError("user must be an authenticated UserContext")
    username = user.username
    if (
        not isinstance(username, str)
        or not username
        or len(username) > 160
        or any(ord(character) < 32 or ord(character) == 127 for character in username)
    ):
        raise ValueError("authenticated username is invalid")
    return username


class Scheduler:
    """Own one stable priority heap, one worker task, and coalesced job maps.

    Construction receives resolver/store/transcoder/health/job-factory/clock
    dependencies.  :meth:`start` creates exactly one event-loop worker;
    :meth:`stop` cooperatively cancels only scheduler-owned work and reservations.
    No method controls Docker, restarts Frigate, changes cameras, or opens source
    recording paths.
    """

    def __init__(
        self,
        *,
        resolver: Resolver,
        store: MediaStore,
        transcoder: Transcoder,
        health: HealthGate,
        job_factory: JobFactory,
        clock: Callable[[], float] = time.monotonic,
        waiting_jobs: int = 2,
        estimated_size_bytes: int = 64 * 1024**2,
        health_poll_seconds: float = 0.25,
        terminal_job_ttl_seconds: float = 900.0,
        terminal_job_limit: int = 256,
    ) -> None:
        """Validate and retain bounded injected dependencies without starting work.

        Inputs provide all external authority and numeric queue policy.  The
        constructor has no network/process/filesystem side effects; malformed
        seams or limits fail before any worker or job can exist.
        """
        # Require explicit callable/component seams and positive finite limits;
        # one worker is fixed by design, while waiting capacity remains bounded.
        if not callable(getattr(resolver, "resolve", None)):
            raise TypeError("resolver must provide resolve")
        if not callable(getattr(store, "open_if_present", None)) or not callable(getattr(store, "reserve", None)):
            raise TypeError("store must provide guarded media operations")
        if not callable(getattr(transcoder, "run", None)) or not callable(
            getattr(transcoder, "validate_completed", None)
        ):
            raise TypeError("transcoder must provide run and validate_completed")
        if not callable(getattr(health, "snapshot", None)) or not callable(getattr(health, "can_start", None)):
            raise TypeError("health gate must provide snapshot and can_start")
        if not callable(job_factory) or not callable(clock):
            raise TypeError("job factory and clock must be callable")
        # Keep direct construction aligned with Settings so no composition code
        # can raise the approved one-running/two-waiting node ceiling.
        if (
            not isinstance(waiting_jobs, int)
            or isinstance(waiting_jobs, bool)
            or not 0 <= waiting_jobs <= 2
        ):
            raise ValueError("waiting job capacity must be between zero and two")
        if not isinstance(estimated_size_bytes, int) or isinstance(estimated_size_bytes, bool) or estimated_size_bytes < 1:
            raise ValueError("estimated output size must be positive")
        if (
            not isinstance(health_poll_seconds, (int, float))
            or isinstance(health_poll_seconds, bool)
            or not math.isfinite(float(health_poll_seconds))
            or health_poll_seconds <= 0
        ):
            raise ValueError("health poll interval must be positive")
        if (
            not isinstance(terminal_job_ttl_seconds, (int, float))
            or isinstance(terminal_job_ttl_seconds, bool)
            or not math.isfinite(float(terminal_job_ttl_seconds))
            or terminal_job_ttl_seconds <= 0
        ):
            raise ValueError("terminal job retention must be positive")
        if (
            not isinstance(terminal_job_limit, int)
            or isinstance(terminal_job_limit, bool)
            or terminal_job_limit < 1
        ):
            raise ValueError("terminal job limit must be positive")

        # Retain only reviewed authorities and initialize empty in-memory state;
        # source URLs enter only private resolver-produced job fields later.
        self._resolver = resolver
        self._store = store
        self._transcoder = transcoder
        self._health = health
        self._job_factory = job_factory
        self._clock = clock
        self._waiting_jobs = waiting_jobs
        self._estimated_size_bytes = estimated_size_bytes
        self._health_poll_seconds = float(health_poll_seconds)
        self._terminal_job_ttl_seconds = float(terminal_job_ttl_seconds)
        self._terminal_job_limit = terminal_job_limit
        self._lock = asyncio.Lock()
        # SourceResolver performs bounded upstream availability probes.  Match
        # their concurrency to the complete one-running-plus-waiting capacity so
        # unauthenticated fan-out cannot precede the serialized health admission.
        self._probe_admission = asyncio.Semaphore(1 + waiting_jobs)
        # Admission serialization bounds expensive external health work and
        # lets every contender recheck coalescing/capacity before probing.
        self._admission_lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._heap: list[tuple[int, int, int, str]] = []
        self._jobs_by_id: dict[str, Job] = {}
        self._terminal_jobs: OrderedDict[str, float] = OrderedDict()
        self._active_by_key: dict[str, Job] = {}
        self._sequence = 0
        self._worker_task: asyncio.Task[None] | None = None
        self._running_job: Job | None = None
        self._stopping = False
        self._closed = False

    async def start(self) -> None:
        """Create exactly one scheduler-owned worker task idempotently.

        The method has no inputs and returns after task creation, not job work.
        Calling it after final stop fails because reusing cancelled in-memory job
        state would violate lifecycle invariants.
        """
        async with self._lock:
            if self._closed:
                raise RuntimeError("scheduler is closed")
            if self._worker_task is None:
                self._worker_task = asyncio.create_task(
                    self._worker_loop(), name="media-compat-worker"
                )

    async def stop(self) -> None:
        """Cooperatively cancel owned work, queued jobs, and exact reservations.

        The method sets a stop predicate consumed by Transcoder health polling,
        marks queued jobs cancelled, then awaits the sole worker so its normal
        failure path aborts only the active MediaStore reservation.  It never
        cancels arbitrary tasks, recursively deletes files, or stops services.
        """
        async with self._lock:
            if self._closed:
                worker = self._worker_task
            else:
                self._stopping = True
                self._closed = True
                # Only queued lifecycle entries can transition immediately;
                # running work observes cancellation through its health callback.
                for job in list(self._jobs_by_id.values()):
                    if job.state == "queued":
                        self._finish_cancelled_locked(job)
                if self._running_job is not None:
                    self._running_job._cancel_requested = True
                self._wake.set()
                worker = self._worker_task
        if worker is not None:
            await worker

    async def submit(
        self,
        source: PrepareRequest,
        purpose: Purpose,
        user: UserContext,
    ) -> Job:
        """Resolve, coalesce, cache-check, health-gate, and admit one request.

        Inputs are a validated immutable selector, explicit approved purpose,
        and gateway-authenticated user.  Output is the shared or new in-memory
        job.  Side effects are bounded resolver/health/cache calls and possible
        queue state mutation; overload and unhealthy uncached work raise stable
        HTTP-style errors before reservation or FFmpeg execution.
        """
        username = _safe_username(user)
        if not isinstance(source, PrepareRequest):
            raise TypeError("source must be a PrepareRequest")
        if purpose not in _PURPOSE_PRIORITY or source.purpose != purpose:
            raise ValueError("purpose must match the validated source request")
        if self._closed:
            raise RuntimeError("scheduler is closed")

        # Resolver returns the only accepted source URL/identity shape; cache keys
        # omit purpose so all output-equivalent callers coalesce.
        # Resolve and availability-probe no more sources concurrently than this
        # node could possibly run or queue.  Duplicate coalescing remains after
        # resolution because only resolver-created identities may form keys.
        async with self._probe_admission:
            if self._closed:
                raise RuntimeError("scheduler is closed")
            resolved = await self._resolver.resolve(source, user)
        if not isinstance(resolved, ResolvedSource):
            raise TypeError("resolver must return ResolvedSource")
        cache_key = CacheKey.for_source(resolved.identity, _OUTPUT_PROFILE, _OUTPUT_SCHEMA_VERSION)

        # A worker-owned published lease proves ready bytes and is closed there
        # because the API obtains its own lease later when serving media ranges.
        cached = await asyncio.to_thread(self._cache_entry_available, cache_key)
        if cached:
            return self._ready_cache_hit(cache_key, purpose, username, resolved)

        # Coalesce before a fresh health probe so an already accepted shared job
        # remains reachable through a transient start-gate change.
        async with self._lock:
            existing = self._active_by_key.get(cache_key)
            if existing is not None:
                return self._join_locked(existing, purpose, username)

        # Serialize only admission decisions, not resolver I/O or worker
        # execution.  This ensures concurrent unique requests cannot fan out
        # unbounded nvidia-smi/FFmpeg/Frigate health probes.
        async with self._admission_lock:
            async with self._lock:
                if self._closed:
                    raise RuntimeError("scheduler is closed")
                # Recheck inside the admission gate so a previous contender's
                # newly active identical key coalesces without a duplicate probe.
                existing = self._active_by_key.get(cache_key)
                if existing is not None:
                    return self._join_locked(existing, purpose, username)

            # MediaStore can hold its own synchronous lock across secure file
            # opens and publisher validation.  Never await that boundary while
            # holding Scheduler's lifecycle lock: a completion/stop transition
            # must remain able to make progress independently.
            cached = await asyncio.to_thread(self._cache_entry_available, cache_key)

            async with self._lock:
                if self._closed:
                    raise RuntimeError("scheduler is closed")
                existing = self._active_by_key.get(cache_key)
                if existing is not None:
                    return self._join_locked(existing, purpose, username)
                if cached:
                    return self._ready_cache_hit(cache_key, purpose, username, resolved)
                capacity = 1 + self._waiting_jobs
                replaceable = purpose in _EXPLICIT_PURPOSES and self._has_droppable_prefetch_locked()
                if len(self._active_by_key) >= capacity and not replaceable:
                    raise QueueFullError()

            decision = await asyncio.to_thread(self._collect_start_decision)
            if not decision.allowed:
                raise HealthGateError(decision.code)

            async with self._lock:
                if self._closed:
                    raise RuntimeError("scheduler is closed")
                # Cancellation, publication, or worker completion may change
                # state during the probe, so repeat coalescing/cache/capacity.
                existing = self._active_by_key.get(cache_key)
                if existing is not None:
                    return self._join_locked(existing, purpose, username)

            cached = await asyncio.to_thread(self._cache_entry_available, cache_key)

            async with self._lock:
                if self._closed:
                    raise RuntimeError("scheduler is closed")
                existing = self._active_by_key.get(cache_key)
                if existing is not None:
                    return self._join_locked(existing, purpose, username)
                if cached:
                    return self._ready_cache_hit(cache_key, purpose, username, resolved)
                capacity = 1 + self._waiting_jobs
                if len(self._active_by_key) >= capacity:
                    # Drop only after health succeeds, so a refused explicit
                    # request never evicts useful prefetch work.
                    dropped = (
                        self._drop_obsolete_prefetch_locked()
                        if purpose in _EXPLICIT_PURPOSES
                        else False
                    )
                    if not dropped:
                        raise QueueFullError()

                now = float(self._clock())
                job = Job(
                    job_id=f"job-{secrets.token_hex(16)}",
                    cache_key=cache_key,
                    purpose=purpose,
                    state="queued",
                    queued_at=now,
                    _resolved_source=resolved,
                    _waiters={username},
                    _owners={username},
                )
                self._jobs_by_id[job.job_id] = job
                self._active_by_key[job.cache_key] = job
                self._push_locked(job)
                self._wake.set()
                return job

    async def cancel_waiter(self, job_id: str, user: UserContext) -> Job:
        """Remove one authenticated waiter and cancel only now-unshared work.

        Inputs identify an opaque job and its requesting user.  Output is the
        mutated job.  Side effects are in-memory waiter/lifecycle changes; a
        missing or never-owning identity fails without revealing another job.
        """
        username = _safe_username(user)
        async with self._lock:
            self._prune_terminal_jobs(float(self._clock()))
            job = self._jobs_by_id.get(job_id)
            if job is None or username not in job._owners:
                raise KeyError(job_id)
            if username not in job._waiters:
                return job
            job._waiters.remove(username)
            if job._waiters:
                return job
            if job.state == "queued":
                self._finish_cancelled_locked(job)
            elif job.state == "running":
                job._cancel_requested = True
            return job

    def status(self, job_id: str, user: UserContext) -> Job:
        """Return one owned job or deny cross-user lifecycle discovery.

        The lookup accepts an opaque id and trusted identity, returning the
        in-memory job for an owner.  It performs no external I/O; bounded
        retention pruning and LRU touch are its only mutations.  Missing jobs
        raise ``KeyError`` and nonowners raise ``PermissionError``.
        """
        username = _safe_username(user)
        self._prune_terminal_jobs(float(self._clock()))
        job = self._jobs_by_id.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if username not in job._owners:
            raise PermissionError("job is not owned by user")
        if job_id in self._terminal_jobs:
            self._terminal_jobs.move_to_end(job_id)
        return job

    def _cache_entry_available(self, cache_key: str) -> bool:
        """Open and immediately close one published lease in the worker thread.

        ``cache_key`` is Scheduler's opaque MediaStore-derived digest.  The
        return is true only if MediaStore can safely open the indexed media.  The
        helper owns the short lease and closes it before returning, so all store
        locking, metadata touch, descriptor close, and filesystem I/O remain
        outside the asyncio loop; the API opens its own lease when it serves
        ranges later.
        """
        cached = self._store.open_if_present(cache_key)
        if cached is None:
            return False
        try:
            return True
        finally:
            cached.close()

    def _ready_cache_hit(
        self,
        cache_key: str,
        purpose: Purpose,
        username: str,
        resolved: ResolvedSource,
    ) -> Job:
        """Create a completed nonqueued job after a secure published cache hit.

        Inputs contain only safe opaque/source identity data and one owner.
        Output is retained for later status lookup; no worker, capacity, factory,
        reservation, health, or transcode side effect occurs.
        """
        now = float(self._clock())
        job = Job(
            job_id=f"job-{secrets.token_hex(16)}",
            cache_key=cache_key,
            purpose=purpose,
            state="ready",
            queued_at=now,
            started_at=now,
            completed_at=now,
            progress=1.0,
            _resolved_source=resolved,
            _waiters={username},
            _owners={username},
        )
        self._jobs_by_id[job.job_id] = job
        self._retain_terminal_job(job, now)
        return job

    def _retain_terminal_job(self, job: Job, now: float) -> None:
        """Retain one terminal polling record under finite TTL and LRU bounds.

        ``job`` is a Scheduler-owned terminal lifecycle and ``now`` is its
        monotonic completion observation.  Side effects update only terminal
        indexes and evict expired/oldest completed records; active jobs are
        never indexed here and therefore never removed by retention cleanup.
        """
        if job.state not in {"ready", "failed", "cancelled"}:
            return
        self._terminal_jobs.pop(job.job_id, None)
        self._terminal_jobs[job.job_id] = now
        self._prune_terminal_jobs(now)

    def _prune_terminal_jobs(self, now: float) -> None:
        """Remove expired or least-recent terminal records without touching work.

        ``now`` is the caller's monotonic observation.  The in-memory mutation
        preserves every active job and keeps completed polling records for at
        most the configured TTL and count; it performs no I/O or cancellation.
        """
        expired_ids = [
            job_id
            for job_id, retained_at in self._terminal_jobs.items()
            if now - retained_at > self._terminal_job_ttl_seconds
        ]
        for job_id in expired_ids:
            self._terminal_jobs.pop(job_id, None)
            terminal = self._jobs_by_id.get(job_id)
            if terminal is not None and terminal.state in {"ready", "failed", "cancelled"}:
                self._jobs_by_id.pop(job_id, None)
        while len(self._terminal_jobs) > self._terminal_job_limit:
            oldest_id, _retained_at = self._terminal_jobs.popitem(last=False)
            terminal = self._jobs_by_id.get(oldest_id)
            if terminal is not None and terminal.state in {"ready", "failed", "cancelled"}:
                self._jobs_by_id.pop(oldest_id, None)

    def _join_locked(self, job: Job, purpose: Purpose, username: str) -> Job:
        """Join one active cache-key job and upgrade prefetch priority safely.

        Caller holds the scheduler lock.  Inputs are an active job, approved
        purpose, and sanitized user; output is the same shared job.  Side effects
        add waiter ownership and may push a versioned higher-priority heap entry.
        """
        job._waiters.add(username)
        job._owners.add(username)
        if job.purpose == "prefetch" and purpose in _EXPLICIT_PURPOSES:
            job.purpose = purpose
            if job.state == "queued":
                job._heap_version += 1
                self._push_locked(job, retain_sequence=True)
                self._wake.set()
        return job

    def _push_locked(self, job: Job, *, retain_sequence: bool = False) -> None:
        """Push one versioned queued job into the stable priority heap.

        Caller holds the scheduler lock.  A fresh admission receives increasing
        sequence order; health requeue/priority upgrade can retain original
        stability.  Side effect is one heap entry, with stale versions ignored.
        """
        if not retain_sequence or job._sequence == 0:
            self._sequence += 1
            job._sequence = self._sequence
        heapq.heappush(
            self._heap,
            (_PURPOSE_PRIORITY[job.purpose], job._sequence, job._heap_version, job.job_id),
        )

    def _pop_locked(self) -> Job | None:
        """Pop the next current queued entry, discarding stale heap versions.

        Caller holds the lock.  Output is one queued job or ``None``; the only
        side effect is removing heap tuples, never changing lifecycle state.
        """
        while self._heap:
            _priority, _sequence, version, job_id = heapq.heappop(self._heap)
            job = self._jobs_by_id.get(job_id)
            if job is not None and job.state == "queued" and job._heap_version == version:
                return job
        return None

    def _drop_obsolete_prefetch_locked(self) -> bool:
        """Cancel one oldest queued single-waiter prefetch under full capacity.

        Caller holds the lock.  Output says whether a slot was reclaimed; side
        effects use only the allowed ``queued -> cancelled`` transition and
        active-key removal.  Shared or running prefetch is never selected.
        """
        candidates = [
            job
            for job in self._active_by_key.values()
            if job.state == "queued" and job.purpose == "prefetch" and len(job._waiters) == 1
        ]
        if not candidates:
            return False
        obsolete = min(candidates, key=lambda candidate: candidate._sequence)
        self._finish_cancelled_locked(obsolete)
        return True

    def _has_droppable_prefetch_locked(self) -> bool:
        """Return whether full capacity contains a replaceable prefetch.

        Caller holds the scheduler lock.  The pure in-memory check returns true
        only for a queued explicit-purpose-replaceable prefetch with one waiter;
        it performs no cancellation so a later failed health probe changes no job.
        """
        return any(
            job.state == "queued" and job.purpose == "prefetch" and len(job._waiters) == 1
            for job in self._active_by_key.values()
        )

    def _finish_cancelled_locked(self, job: Job) -> None:
        """Apply an allowed cancellation transition and release active capacity.

        Caller holds the lock and supplies a queued or running job.  Side effects
        update only in-memory lifecycle/timing/maps; reservation cleanup remains
        the executing worker's exact-object responsibility.
        """
        if job.state not in {"queued", "running"}:
            return
        now = float(self._clock())
        if job._attempt_started_at is not None:
            job.run_seconds += max(0.0, now - job._attempt_started_at)
            job._attempt_started_at = None
        job.state = "cancelled"
        job.last_error_code = "cancelled"
        job.completed_at = now
        job._heap_version += 1
        self._active_by_key.pop(job.cache_key, None)
        self._retain_terminal_job(job, now)

    def _collect_start_decision(self) -> GateDecision:
        """Collect and evaluate one health snapshot outside the event loop.

        No inputs are accepted; output is a stable decision.  Side effects are
        only HealthGate's approved read-only probes and no external diagnostics
        are retained if an injected boundary unexpectedly raises.
        """
        try:
            snapshot = self._health.snapshot()
            if not isinstance(snapshot, HealthSnapshot):
                return GateDecision(False, "frigate_unavailable")
            decision = self._health.can_start(snapshot)
            return decision if isinstance(decision, GateDecision) else GateDecision(False, "frigate_unavailable")
        except Exception:
            return GateDecision(False, "frigate_unavailable")

    async def _worker_loop(self) -> None:
        """Own the sole queue-consumer lifecycle until cooperative final stop.

        The worker repeatedly pops stable priority entries, waits outside the
        lock for health recovery, executes exactly one reservation/transcode,
        and finalizes state.  It owns no other task and exits only after stop has
        cancelled queued work and the running reservation has been cleaned.
        """
    async def _worker_loop(self) -> None:
        """Own the sole queue-consumer lifecycle until cooperative final stop.

        The worker repeatedly pops stable priority entries, waits outside the
        lock for health recovery, executes exactly one reservation/transcode,
        and finalizes state.  It owns no other task and exits only after stop has
        cancelled queued work and the running reservation has been cleaned.
        """
        while True:
            async with self._lock:
                if self._stopping and self._running_job is None:
                    return
                job = self._pop_locked()
                if job is None:
                    self._wake.clear()
            if job is None:
                await self._wake.wait()
                continue

            decision = await asyncio.to_thread(self._collect_start_decision)
            if not decision.allowed:
                async with self._lock:
                    if job.state == "queued" and not self._stopping:
                        job.last_error_code = decision.code or "health_gate"
                        self._push_locked(job, retain_sequence=True)
                await asyncio.sleep(self._health_poll_seconds)
                self._wake.set()
                continue

            async with self._lock:
                if job.state != "queued" or self._stopping:
                    continue
                now = float(self._clock())
                job.state = "running"
                if job.started_at is None:
                    job.started_at = now
                    job.queue_seconds = max(0.0, now - job.queued_at)
                job._attempt_started_at = now
                job.last_error_code = None
                job.progress = 0.0
                self._running_job = job

            await self._execute(job)
            self._wake.set()

    async def _execute(self, job: Job) -> None:
        """Reserve, build facts, transcode, publish, and finalize one active job.

        Input is the sole running job.  Side effects are confined to the exact
        MediaStore reservation, injected source-probe factory, one Transcoder
        invocation in a thread, atomic publication, and lifecycle state.  Every
        failure aborts only that reservation before retry/final classification.
        """
        reservation: Reservation | None = None
        loop = asyncio.get_running_loop()

        def observe_progress(fraction: float) -> None:
            """Schedule one sanitized FFmpeg fraction onto the event-loop thread.

            The callback runs in Transcoder's worker thread.  It accepts only a
            finite number and has the sole side effect of queueing a safe state
            update; malformed values and a closing loop are ignored.
            """
            if not isinstance(fraction, (int, float)) or isinstance(fraction, bool) or not math.isfinite(float(fraction)):
                return
            try:
                loop.call_soon_threadsafe(self._set_progress, job, float(fraction))
            except RuntimeError:
                return

        def may_continue() -> bool:
            """Combine ownership/stop policy with HealthGate runtime hysteresis.

            No inputs are accepted; output is exactly true while this job remains
            shared and service-owned.  Side effects are HealthGate's approved
            probes/counter only; exceptions fail closed without diagnostics.
            """
            if self._stopping or job._cancel_requested or not job._waiters:
                return False
            try:
                return self._health.continue_transcode() is True
            except Exception:
                return False

        failure_code: str | None = None
        try:
            print(f"DEBUG: _execute starting for job {job.cache_key}", flush=True)
            reservation = await asyncio.to_thread(
                self._store.reserve, job.cache_key, self._estimated_size_bytes
            )
            produced = self._job_factory(job._resolved_source, reservation)
            transcode_job = await produced if inspect.isawaitable(produced) else produced
            if (
                not isinstance(transcode_job, TranscodeJob)
                or transcode_job.source_url != job._resolved_source.upstream_url
                or transcode_job.output_path != reservation.partial_path
                or transcode_job.owned_partial is not reservation.owned_partial
            ):
                raise TranscodeFailure("transcode_failed", "invalid transcode job factory output")
            self._health.reset_runtime_failures()
            await asyncio.to_thread(
                self._transcoder.run,
                transcode_job,
                may_continue,
                observe_progress,
            )

            def validate_for_publish(bound_path) -> bool:
                """Revalidate the exact MediaStore-bound partial before publish.

                ``bound_path`` comes only from MediaStore's active reservation
                callback after its first inode/size bind.  Output is true only
                after strict descriptor-bound structure/probe/decode validation;
                side effects are validation children, while MediaStore retains
                sole cleanup/publication authority on any exception or swap.
                """
                # Reconstruct only the output path from the store callback while
                # preserving the factory-probed source facts and fixed URL.
                completed_job = TranscodeJob(
                    source_url=transcode_job.source_url,
                    output_path=bound_path,
                    has_audio=transcode_job.has_audio,
                    expected_duration=transcode_job.expected_duration,
                    expected_dimensions=transcode_job.expected_dimensions,
                    expected_video_duration=transcode_job.expected_video_duration,
                    expected_audio_duration=transcode_job.expected_audio_duration,
                    source_video_rate=transcode_job.source_video_rate,
                    expected_video_packets=transcode_job.expected_video_packets,
                    maximum_video_packets=transcode_job.maximum_video_packets,
                    owned_partial=reservation.owned_partial,
                )
                self._transcoder.validate_completed(completed_job, may_continue)
                return True

            async with self._lock:
                if self._stopping or job._cancel_requested or not job._waiters:
                    return

            # ``publish`` invokes strict FFprobe/decode validation through its
            # identity-bound callback.  Keep that complete atomic store action
            # in one worker call so synchronous validation cannot starve submit,
            # status, or shutdown work on this event loop.
            await asyncio.to_thread(self._store.publish, reservation, validate_for_publish)
            reservation = None
        except TranscodeFailure as error:
            print(f"DEBUG: TranscodeFailure in _execute: {error.code} {error.detail}", flush=True)
            import traceback; traceback.print_exc()
            failure_code = error.code
        except Exception as error:
            print(f"DEBUG: Exception in _execute: {type(error)} {error}", flush=True)
            import traceback; traceback.print_exc()
            failure_code = "transcode_failed"
        finally:
            if reservation is not None:
                try:
                    await asyncio.to_thread(reservation.abort)
                except Exception:
                    # The exact reservation may already have been safely cleaned
                    # by Transcoder/MediaStore; never broaden cleanup on failure.
                    pass

        # Let thread-safe progress callbacks run before authoritative terminal
        # state clamps ready media to one or records the stable failure.
        await asyncio.sleep(0)
        async with self._lock:
            now = float(self._clock())
            if job._attempt_started_at is not None:
                job.run_seconds += max(0.0, now - job._attempt_started_at)
                job._attempt_started_at = None
            self._running_job = None

            if failure_code is None and not self._stopping and job._waiters:
                job.state = "ready"
                job.progress = 1.0
                job.last_error_code = None
                job.completed_at = now
                self._active_by_key.pop(job.cache_key, None)
                self._retain_terminal_job(job, now)
                return

            if self._stopping or job._cancel_requested or not job._waiters:
                self._finish_cancelled_locked(job)
                return

            # Only explicit work receives one retry.  Requeue occurs after the
            # failed attempt; the worker's next start probe waits for recovery.
            if job.purpose in _EXPLICIT_PURPOSES and job.retry_count < 1:
                job.state = "queued"
                job.retry_count += 1
                job.last_error_code = failure_code or "transcode_failed"
                job._heap_version += 1
                self._push_locked(job, retain_sequence=True)
                return

            job.state = "failed"
            job.last_error_code = failure_code or "transcode_failed"
            job.completed_at = now
            self._active_by_key.pop(job.cache_key, None)
            self._retain_terminal_job(job, now)

    @staticmethod
    def _set_progress(job: Job, fraction: float) -> None:
        """Apply one monotonic clamped progress update to a running job only.

        Inputs are scheduler-owned state and a sanitized numeric fraction.  The
        only side effect is in-memory observability; lifecycle and publication
        truth remain unchanged.
        """
        if job.state != "running":
            return
        job.progress = max(job.progress, min(1.0, max(0.0, fraction)))
