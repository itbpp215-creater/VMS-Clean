# Mobile Video Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, on-demand H.264/AAC compatibility path so event video, portable downloads/shares, and timeline Playback work on iOS/iPadOS/Android without changing or interrupting Frigate's original HEVC recordings.

**Architecture:** A new internal-only `media-compat-service` validates immutable Frigate event or camera/time sources, coalesces requests through a one-active/two-waiting scheduler, transcodes with NVIDIA NVENC into validated fast-start MP4 files, and serves byte ranges through the authenticated Dashboard gateway. Desktop playback keeps the original Frigate path; portable playback and every primary download/share use the compatibility path. Persistent derived cache is allowed only on drive D above the recording threshold plus a 2 GiB safety margin, otherwise the service uses a bounded tmpfs lease.

**Tech Stack:** Python 3.11, FastAPI/Pydantic/httpx/Uvicorn, FFmpeg/ffprobe with CUDA and `h264_nvenc`, NVIDIA Container Toolkit, Docker Compose v2, Nginx, browser JavaScript, Playwright 1.61.1, Python `pytest`/`unittest`, Windows PowerShell 5.1.

## Global Constraints

- Execute implementation in an isolated Git worktree such as `D:\BPP-VMS\.worktrees\mobile-video-compatibility`; do not develop directly in the running production checkout.
- Do not change camera, go2rtc, Frigate recording, detector, Live View, storage location, or original HEVC media.
- Do not stop, recreate, or restart `frigate-nvr` during implementation or rollout. Record its container ID and `StartedAt` before deployment and prove both remain unchanged afterward.
- The new service has no host-published port, no security/config network, no arbitrary URL/path input, no write access to recordings, and no access to camera credentials or Frigate configuration.
- Use only NVIDIA hardware video encoding. Missing/unhealthy NVENC must fail closed; never select `libx264` or another CPU video encoder.
- Preserve source resolution up to 1920x1080, emit H.264 `avc1`/`yuv420p`, add AAC-LC only when audio exists, regenerate monotonic zero-based timestamps, and publish only a complete ffprobe-validated non-fragmented fast-start MP4.
- Admit at most three unique explicit user requests per node: one running and two waiting. Identical requests coalesce and do not consume another slot. Explicit actions outrank prefetch. Retry explicit work once; never retry prefetch.
- Mobile timeline chunks are exactly bounded to at most 60 seconds. Desktop retains its existing 300-second default and 900-second high-speed behavior.
- Persistent compatibility cache lives only at `D:\BPP-VMS\frigate-nvr\runtime-cache\mobile-video`, is capped at 10 GiB, and may publish only when free space remains above 15% plus 2 GiB. Otherwise use the 512 MiB tmpfs with a 15-minute last-access lease.
- Compatibility cache is disposable derived data. Exclude it from Git, migration TARs, update TARs, backups, site-owned state, rollback state, and NAS export.
- Do not include the supplied real camera clip or any other captured video/image fixture. Generate synthetic fixtures during tests.
- Every browser route remains behind the current auth subrequest. Nginx strips client-supplied identity/service headers and injects a new independently generated `MEDIA_COMPAT_PROXY_SHARED_SECRET` plus verified `X-User`/`X-Role`.
- All changed functions and logic blocks need intent, inputs/outputs, side effects, invariants, and failure behavior comments required by `CLAUDE.md`.
- Follow TDD for every behavior: add the narrow failing test, run it and observe the stated failure, implement only that behavior, rerun the focused test, then commit.
- Before every implementation commit, also run the mandatory BPP verification suites applicable to the changed components; a focused test alone is never sufficient for a BPP commit.
- Keep the feature disabled in production until automated checks, Desktop regression, iPhone 16 Pro Safari/Files, Android browser, and runtime GPU/Frigate checks all pass.

---

## File Structure

Create a focused service instead of placing queue/transcode/cache logic in the existing 3,500-line browser application:

- `media-compat-service/media_compat/settings.py` -- validated configuration and immutable numeric thresholds.
- `media-compat-service/media_compat/models.py` -- request, response, source, job, and error contracts.
- `media-compat-service/media_compat/auth.py` -- constant-time trusted-gateway authentication and verified user context.
- `media-compat-service/media_compat/source.py` -- source validation and fixed Frigate-internal URL construction.
- `media-compat-service/media_compat/cache.py` -- cache keys, atomic publication, LRU/disk guard, tmpfs leases, cleanup, and range parsing.
- `media-compat-service/media_compat/health.py` -- Frigate/NVIDIA/NVENC start and runtime gates.
- `media-compat-service/media_compat/transcoder.py` -- bounded FFmpeg invocation and ffprobe validation.
- `media-compat-service/media_compat/scheduler.py` -- coalescing priority queue, capacity, retries, cancellation, and lifecycle.
- `media-compat-service/media_compat/api.py` -- FastAPI composition and `/health`, `/prepare`, `/jobs/{id}`, `/media/{key}.mp4` endpoints.
- `media-compat-service/tests/` -- unit, API, scheduler, storage, security, and generated-media integration tests.
- `media-compat-service/Dockerfile`, `requirements.txt`, and `requirements-dev.txt` -- pinned runtime/test image based on the same pinned Frigate/NVIDIA-capable image already approved in this repository.
- `web/assets/media-compat.js` -- portable-client policy, prepare/poll/cancel client, stable share links, and download helper.
- `web/assets/app.js`, `web/index.html`, and `web/assets/app.css` -- integrate the helper into both event players, both event action sets, and main/follower Playback UI.
- `dashboard-nginx.conf` and `docker-compose.yml` -- authenticated internal gateway and hardened service runtime.
- Release/migration policy and tests -- regenerate the new proxy secret per node and prove the derived cache never enters a package.
- Feature, architecture, security, operations, troubleshooting, history, and session documentation required by repository policy.

---

### Task 1: Define the Service Contracts, Settings, and Gateway Authentication

**Files:**
- Create: `media-compat-service/media_compat/__init__.py`
- Create: `media-compat-service/media_compat/models.py`
- Create: `media-compat-service/media_compat/settings.py`
- Create: `media-compat-service/media_compat/auth.py`
- Create: `media-compat-service/tests/conftest.py`
- Create: `media-compat-service/tests/test_models.py`
- Create: `media-compat-service/tests/test_auth.py`
- Create: `media-compat-service/requirements.txt`
- Create: `media-compat-service/requirements-dev.txt`

**Interfaces:**
- Produces: `Settings.from_env() -> Settings` with validated feature switch, queue, cache, disk, GPU, timeout, and upstream values.
- Produces: discriminated `PrepareRequest`, `PrepareResponse`, and `JobStatusResponse` JSON contracts.
- Produces: `require_gateway(request: Request, settings: Settings) -> UserContext` using constant-time secret comparison.
- Consumes: `MEDIA_COMPAT_PROXY_SHARED_SECRET`, fixed `FRIGATE_BASE_URL=http://frigate:5000`, and non-secret tuning environment variables.

- [ ] **Step 1: Add failing request-model tests**

Test exactly one source selector and strict bounds:

```python
def test_prepare_request_requires_exactly_one_immutable_source() -> None:
    with pytest.raises(ValidationError):
        PrepareRequest(purpose="playback")
    with pytest.raises(ValidationError):
        PrepareRequest(
            purpose="playback", event_id="evt-1",
            camera="cam01", start=100, end=160,
        )


def test_timeline_range_is_positive_and_bounded() -> None:
    with pytest.raises(ValidationError):
        PrepareRequest(purpose="playback", camera="cam01", start=160, end=100)
```

Run:

```powershell
python -m pytest -q media-compat-service/tests/test_models.py
```

Expected: FAIL because the package and models do not exist.

- [ ] **Step 2: Implement strict typed contracts**

Use literal states and a post-validation invariant:

```python
Purpose = Literal["playback", "download", "share", "prefetch"]
JobState = Literal["queued", "running", "ready", "failed", "cancelled"]

class PrepareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    purpose: Purpose
    event_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    camera: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,80}$")
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=1)
```

The validator accepts either `event_id`, or the complete `camera/start/end` tuple, never both. Event duration is resolved later; timeline requests must satisfy `end > start` and an absolute maximum export duration from settings.

- [ ] **Step 3: Add failing settings and authentication tests**

Cover missing/blank proxy secret, non-HTTP internal URL, invalid thresholds, missing identity headers, incorrect secret, client-injected role, and exact valid gateway headers. Assert no secret value appears in exception text or `repr(settings)`.

Run:

```powershell
python -m pytest -q media-compat-service/tests/test_auth.py
```

Expected: FAIL because settings/auth implementations do not exist.

- [ ] **Step 4: Implement fail-closed settings and gateway auth**

Use `secrets.compare_digest`; accept `X-User` and `X-Role` only after the proxy secret succeeds. Limit roles to the existing authenticated operator/admin set. Defaults must match the approved design:

```python
@dataclass(frozen=True, slots=True)
class Settings:
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
```

- [ ] **Step 5: Pin dependencies and run focused tests**

Pin FastAPI, Pydantic, httpx, Uvicorn, pytest, pytest-asyncio, and anyio versions. Run:

```powershell
python -m pytest -q media-compat-service/tests/test_models.py media-compat-service/tests/test_auth.py
```

Expected: PASS.

- [ ] **Step 6: Commit service contracts**

```powershell
git add media-compat-service
git commit -m "feat: define media compatibility contracts"
```

---

### Task 2: Validate Frigate Sources Without Filesystem or URL Injection

**Files:**
- Create: `media-compat-service/media_compat/source.py`
- Create: `media-compat-service/tests/test_source.py`
- Modify: `media-compat-service/media_compat/models.py`

**Interfaces:**
- Produces: `SourceResolver.resolve(request, user) -> ResolvedSource`.
- Produces: fixed internal paths `/api/events/{quoted_id}/clip.mp4` or `/api/{quoted_camera}/start/{start}/end/{end}/clip.mp4`.
- Consumes: an injected `httpx.AsyncClient`; never consumes a client URL or filesystem path.

- [ ] **Step 1: Add failing source-resolution tests**

Mock Frigate event metadata and HEAD responses. Assert:

```python
assert resolved.upstream_url == "http://frigate:5000/api/events/evt-1/clip.mp4"
assert resolved.identity == EventSource(event_id="evt-1")
assert "rtsp" not in resolved.model_dump_json()
```

Cover unknown event/camera, `has_clip=false`, non-2xx upstream, empty media, excessive range, encoded slash/traversal, query fragments, and authorization-denied user. Run the focused test and expect import failure.

- [ ] **Step 2: Implement allowlisted source construction**

Build paths from already validated scalar fields with `urllib.parse.quote(value, safe="")`; never join user input to a local path. For event requests, fetch `/api/events/{id}` and reject events without clips. For timeline, query the fixed recordings endpoint for the validated camera and requested bounds, require an intersecting segment, then construct the clip route. Never fetch `/api/config`, whose expanded stream configuration may contain camera credentials; fail closed if Frigate cannot answer.

- [ ] **Step 3: Preserve authorization as a service invariant**

Use the trusted gateway role and a single `authorize_source(user, source)` function. The initial policy mirrors current event/Playback access for authenticated `user` and `admin` roles; tests must prove unknown/blank roles receive 403 and never trigger a Frigate media request.

- [ ] **Step 4: Run source and contract tests**

```powershell
python -m pytest -q media-compat-service/tests/test_source.py media-compat-service/tests/test_models.py
```

Expected: PASS with all attempted URL/path injection rejected before upstream I/O.

- [ ] **Step 5: Commit source validation**

```powershell
git add media-compat-service/media_compat/source.py media-compat-service/media_compat/models.py media-compat-service/tests/test_source.py
git commit -m "feat: validate immutable Frigate media sources"
```

---

### Task 3: Implement Derived Cache, Disk Guard, tmpfs Leases, and Byte Ranges

**Files:**
- Create: `media-compat-service/media_compat/cache.py`
- Create: `media-compat-service/tests/test_cache.py`
- Create: `media-compat-service/tests/test_ranges.py`

**Interfaces:**
- Produces: `CacheKey.for_source(source, profile, schema_version) -> str` using canonical JSON plus SHA-256.
- Produces: `MediaStore.reserve/publish/open/touch/evict/cleanup_orphans` with no recording-path operations.
- Produces: `parse_range(header, size) -> ByteRange | None` and 200/206/416 response metadata.
- Consumes: dedicated `/cache` and `/work` roots injected as resolved paths.

- [ ] **Step 1: Add failing cache-key and path-containment tests**

Assert identical sources coalesce, one timestamp/profile/schema change changes the key, every output remains a direct child of `/cache` or `/work`, and symlink/path traversal is rejected. Expect failure before implementation.

- [ ] **Step 2: Add failing storage-policy tests**

Inject `disk_usage` and a fake clock. Cover exact boundaries:

```python
assert policy.can_persist(total=100*GiB, free=19*GiB, output=1*GiB)
assert not policy.can_persist(total=100*GiB, free=18*GiB, output=1*GiB)
```

The publication calculation must retain `15% of total + 2 GiB` after output is written. Cover 10 GiB LRU eviction, active-reader protection, expired tmpfs lease eviction, actual/estimated tmpfs overflow, partial cleanup, restart index rebuild, and orphan cleanup.

- [ ] **Step 3: Implement atomic derived-media storage**

Write only `*.partial` under the selected root, fsync/close, validate before publication, then use `os.replace(partial, final)`. Store non-secret metadata in an adjacent atomic JSON sidecar. Evict derived LRU entries before refusing a persistent write; never inspect, delete, or rename anything under `/media/frigate`.

- [ ] **Step 4: Add failing HTTP byte-range parser tests**

Cover `bytes=0-0`, open-ended, suffix, full-file, malformed, multiple-range rejection, unsatisfiable 416 with `Content-Range: bytes */SIZE`, `HEAD`, and active-lease touch. Expected: FAIL until parser exists.

- [ ] **Step 5: Implement single-range serving contract**

Return `Accept-Ranges: bytes`, exact `Content-Length`, `Content-Type: video/mp4`, and `Content-Range` on 206. Stream only the selected span with a bounded chunk reader and close the active-reader lease in `finally`.

- [ ] **Step 6: Run focused storage tests**

```powershell
python -m pytest -q media-compat-service/tests/test_cache.py media-compat-service/tests/test_ranges.py
```

Expected: PASS without writing outside pytest temporary directories.

- [ ] **Step 7: Commit cache and range support**

```powershell
git add media-compat-service/media_compat/cache.py media-compat-service/tests/test_cache.py media-compat-service/tests/test_ranges.py
git commit -m "feat: add guarded compatibility media storage"
```

---

### Task 4: Build the NVENC-Only Transcode and Validation Pipeline

**Files:**
- Create: `media-compat-service/media_compat/transcoder.py`
- Create: `media-compat-service/tests/test_transcoder.py`
- Create: `media-compat-service/tests/test_ffmpeg_integration.py`

**Interfaces:**
- Produces: `Transcoder.build_command(source_url, output_path, has_audio) -> list[str]` without shell parsing.
- Produces: `Transcoder.run(job, health_callback) -> ProbeResult` with bounded timeout and process-group cancellation.
- Produces: `validate_output(path, expected_duration, expected_dimensions, source_has_audio) -> ProbeResult`.
- Consumes: fixed FFmpeg/ffprobe executable paths supplied by settings and one validated internal source URL.

- [ ] **Step 1: Add failing command-construction tests**

Assert argv contains NVIDIA decode and encode, timestamp normalization, compatible pixel format, optional AAC, and fast-start MP4:

```python
argv = transcoder.build_command(source, target, has_audio=True)
assert "h264_nvenc" in argv
assert "yuv420p" in argv
assert "+faststart" in argv
assert "aac" in argv
assert not any(token in argv for token in ("libx264", "libopenh264"))
```

Assert the output is never piped through a shell and source text cannot add arguments.

- [ ] **Step 2: Implement the bounded NVENC command**

Use a concrete argument list equivalent to:

```text
ffmpeg -nostdin -hide_banner -loglevel warning -hwaccel cuda
-fflags +genpts+discardcorrupt -i http://frigate:5000/api/events/evt-1/clip.mp4
-map 0:v:0 -map 0:a:0? -c:v h264_nvenc -pix_fmt yuv420p
-vf setpts=PTS-STARTPTS -c:a aac -af asetpts=PTS-STARTPTS
-movflags +faststart -avoid_negative_ts make_zero -y <owned-partial-path>
```

Do not scale unless the decoded source exceeds 1920x1080; preserve aspect ratio and even dimensions. If audio is absent, omit audio encoder/filter arguments. Capture bounded stderr and redact internal URLs from logs.

- [ ] **Step 3: Add failing output-validation tests**

Mock ffprobe JSON for wrong codec tag (`hev1`), wrong pixel format, fragmented output, backward timestamps, missing expected audio, resolution change, zero duration, and decode error. Validation accepts only H.264 with `codec_tag_string=avc1`, `yuv420p`, expected dimensions, monotonic start/duration tolerance, and AAC when source audio exists.

- [ ] **Step 4: Implement validation and failure cleanup**

Run ffprobe via argv, parse JSON strictly, then run a null decode verification. Any timeout, nonzero exit, invalid probe, cancellation, or overflow removes only the owned partial file and raises a stable non-secret error code.

- [ ] **Step 5: Generate synthetic integration fixtures at runtime**

The test creates a color/testsrc HEVC fragmented MP4, with and without a sine audio track, in `tmp_path`. It then transcodes and asserts codec tag, resolution, pixel format, audio, monotonic packets, fast-start placement, and full decode. Mark the NVENC case `@pytest.mark.gpu` and skip only when `ffmpeg -encoders` proves `h264_nvenc` unavailable; unit command tests remain mandatory.

- [ ] **Step 6: Run unit and available integration tests**

```powershell
python -m pytest -q media-compat-service/tests/test_transcoder.py
python -m pytest -q -m gpu media-compat-service/tests/test_ffmpeg_integration.py
```

Expected: unit tests PASS. On the production GPU node, integration tests PASS; on a non-GPU workstation, only the explicitly GPU-marked cases SKIP.

- [ ] **Step 7: Commit NVENC pipeline**

```powershell
git add media-compat-service/media_compat/transcoder.py media-compat-service/tests/test_transcoder.py media-compat-service/tests/test_ffmpeg_integration.py
git commit -m "feat: transcode portable media with NVENC"
```

---

### Task 5: Add Runtime Health Gates and the Coalescing Priority Scheduler

**Files:**
- Create: `media-compat-service/media_compat/health.py`
- Create: `media-compat-service/media_compat/scheduler.py`
- Create: `media-compat-service/tests/test_health.py`
- Create: `media-compat-service/tests/test_scheduler.py`

**Interfaces:**
- Produces: `HealthGate.snapshot() -> HealthSnapshot` and `can_start(snapshot) -> GateDecision`.
- Produces: `Scheduler.submit(source, purpose, user) -> Job`, `cancel_waiter(job_id, user)`, `status(job_id, user)`, `start/stop`.
- Consumes: injected resolver/store/transcoder/health/clock; owns one worker task and no Docker control.

- [ ] **Step 1: Add failing health-gate tests**

Cover Frigate unavailable, `h264_nvenc` absent, temperature 79/80/84/85, free VRAM just below/exactly 1 GiB, tmpfs/cache unavailable, and credential redaction. Prove camera FPS is observability data, not a start gate.

- [ ] **Step 2: Implement start and in-flight gates**

Query Frigate's internal health/API and `nvidia-smi` using argv with a timeout. Start only below 80 C and at/above 1 GiB free VRAM. During transcode, cancel after two consecutive bad checks or immediately on loss of the encoder; temperature at/above 85 C is bad. Never call Docker, restart Frigate, or change camera settings.

- [ ] **Step 3: Add failing scheduler-state tests**

Use async barriers to prove:

- one running unique job plus two waiting unique jobs are admitted;
- the fourth unique request gets HTTP-style `queue_full` metadata;
- duplicate requests share one job and one FFmpeg call without another slot;
- explicit play/download/share outrank queued prefetch;
- cancelling one waiter does not cancel shared work needed by another;
- obsolete unshared prefetch can be dropped;
- explicit failure retries exactly once after a recovered gate;
- prefetch never retries;
- published cache hit bypasses the queue/transcoder;
- service shutdown terminates owned work and deletes partials only.

- [ ] **Step 4: Implement the scheduler state machine**

Use one worker and a stable priority heap. Maintain maps by cache key and job ID. State transitions are only:

```text
queued -> running -> ready
queued -> cancelled
running -> queued    (one explicit retry after health recovery)
running -> failed
running -> cancelled
```

The scheduler records waiter identities, last error code, retry count, queue time, run time, and progress derived from FFmpeg progress output. It never stores secrets or source credentials.

- [ ] **Step 5: Run concurrency and health tests repeatedly**

```powershell
1..10 | ForEach-Object { python -m pytest -q media-compat-service/tests/test_health.py media-compat-service/tests/test_scheduler.py }
```

Expected: all ten runs PASS without timing flakes, leaked tasks, or more than one mocked transcode concurrently.

- [ ] **Step 6: Commit health and scheduling**

```powershell
git add media-compat-service/media_compat/health.py media-compat-service/media_compat/scheduler.py media-compat-service/tests/test_health.py media-compat-service/tests/test_scheduler.py
git commit -m "feat: schedule compatibility jobs safely"
```

---

### Task 6: Expose the Authenticated Prepare, Status, Cancel, Health, and Media API

**Files:**
- Create: `media-compat-service/media_compat/api.py`
- Create: `media-compat-service/tests/test_api.py`
- Modify: `media-compat-service/media_compat/models.py`
- Modify: `media-compat-service/media_compat/cache.py`

**Interfaces:**
- Produces: `GET /health`, `POST /prepare`, `GET /jobs/{job_id}`, `DELETE /jobs/{job_id}/waiter`, and `GET|HEAD /media/{cache_key}.mp4`.
- Produces: stable error codes `invalid_source`, `forbidden`, `not_found`, `queue_full`, `health_gate`, `transcode_failed`, `cancelled`, and `range_not_satisfiable`.
- Consumes: trusted gateway headers and the components from Tasks 1-5.

- [ ] **Step 1: Add failing API contract tests**

Use FastAPI's ASGI test client with fake components. Assert prepare responses:

```json
{"state":"ready","job_id":"job-123","media_url":"/api/media-compat/media/8b2d4c6e.mp4","retry_after_ms":null}
```

or queued/running with `media_url=null` and bounded `retry_after_ms`. Cover auth failure, validation 422, ownership isolation, queue full 429, retryable health 503, stable failed state, HEAD, 200, 206, and 416.

- [ ] **Step 2: Implement lifespan and API routes**

Start/stop the scheduler through FastAPI lifespan. Apply gateway authentication to all browser-facing routes; `/health` may return only coarse internal readiness without secrets, paths, or GPU serial data. Job status is visible only to a waiter/user authorized for that source.

- [ ] **Step 3: Implement streaming media responses**

Resolve the key only through the store index, touch the lease, support one byte range, and set:

```text
Content-Type: video/mp4
Accept-Ranges: bytes
Cache-Control: private, max-age=900
X-Content-Type-Options: nosniff
```

Do not return internal filesystem paths or upstream Frigate URLs.

- [ ] **Step 4: Run the complete service unit suite**

```powershell
python -m pytest -q media-compat-service/tests -m "not gpu"
```

Expected: PASS with no network, GPU, production file, or Docker dependency.

- [ ] **Step 5: Commit the API**

```powershell
git add media-compat-service/media_compat/api.py media-compat-service/media_compat/models.py media-compat-service/media_compat/cache.py media-compat-service/tests/test_api.py
git commit -m "feat: expose compatibility media API"
```

---

### Task 7: Containerize and Route the Service Through the Hardened Gateway

**Files:**
- Create: `media-compat-service/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `dashboard-nginx.conf`
- Modify: `.env.example`
- Modify: `tests/test_p0_security.py`
- Create: `tests/test_media_compat_compose.py`

**Interfaces:**
- Produces: internal Compose service `media-compat-service:5008` on `media` only.
- Produces: authenticated same-origin prefix `/api/media-compat/`.
- Consumes: dedicated cache bind, 512 MiB tmpfs, NVIDIA device reservation, `MEDIA_COMPAT_ENABLED=false` by default, and `MEDIA_COMPAT_PROXY_SHARED_SECRET` in Dashboard plus service only.

- [ ] **Step 1: Add failing Compose and gateway security tests**

Assert the service exists and has no `ports`, no `env_file`, no `security`, `config-validation`, or egress network; has `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, GPU reservation, `/work` tmpfs, and only `./runtime-cache/mobile-video:/cache`. Assert the Dashboard route performs auth, derives `X-User`/`X-Role`, injects the new secret, blanks Cookie/Authorization and every browser-supplied BPP service header, preserves Range, and never proxies a client-selected upstream URL.

Run:

```powershell
python -m pytest -q tests/test_media_compat_compose.py tests/test_p0_security.py
```

Expected: FAIL because the service and route do not exist.

- [ ] **Step 2: Build a pinned runtime/test image**

Base the runtime on the repository's already pinned Frigate 0.17.2 TensorRT image and its known NVIDIA-capable FFmpeg path:

```dockerfile
FROM ghcr.io/blakeblackshear/frigate:0.17.2-tensorrt@sha256:8a364092b03561b9c08ac00730206e363a53d07ea0304f7d543b403b65432b5e AS runtime
```

Install only pinned service dependencies, copy the `media_compat` package, create an unprivileged runtime user where compatible with GPU device access, and launch Uvicorn on 5008. Add a test target with dev requirements; do not bind-mount source in production.

- [ ] **Step 3: Add the least-privilege Compose service**

The implementation must read through `http://frigate:5000`; omit the recording mount entirely. Mount only the dedicated cache and tmpfs. Add healthcheck and `restart: unless-stopped`. Add the service to Dashboard `depends_on` without adding any dependency from Frigate to the new service. Set the runtime gate explicitly and safely by default:

```yaml
MEDIA_COMPAT_ENABLED: ${MEDIA_COMPAT_ENABLED:-false}
```

- [ ] **Step 4: Add the authenticated Nginx route**

Use the existing Watchlist trusted-proxy pattern:

```nginx
location /api/media-compat/ {
    auth_request /auth/verify;
    auth_request_set $auth_user $upstream_http_x_user;
    auth_request_set $auth_role $upstream_http_x_role;
    proxy_set_header X-User $auth_user;
    proxy_set_header X-Role $auth_role;
    proxy_set_header X-BPP-Proxy-Secret ${MEDIA_COMPAT_PROXY_SHARED_SECRET};
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_pass http://media-compat-service:5008/;
}
```

Also clear all untrusted identity/service variants, forward `Range`/`If-Range`, disable proxy buffering for media responses, and set bounded connect/read/send timeouts. Expand `NGINX_ENVSUBST_FILTER` to exactly the two proxy-secret names.

- [ ] **Step 5: Validate configuration and image capabilities**

```powershell
docker compose config --quiet
docker compose build media-compat-service
docker compose run --rm --no-deps media-compat-service ffmpeg -hide_banner -encoders
```

Expected: Compose validates; output includes `h264_nvenc`. No application service is started.

- [ ] **Step 6: Run security tests and commit infrastructure**

```powershell
python -m pytest -q tests/test_media_compat_compose.py tests/test_p0_security.py
git add media-compat-service/Dockerfile docker-compose.yml dashboard-nginx.conf .env.example tests/test_media_compat_compose.py tests/test_p0_security.py
git commit -m "feat: route compatibility media internally"
```

---

### Task 8: Add the Browser Compatibility Client and Portable Policy

**Files:**
- Create: `web/assets/media-compat.js`
- Create: `tests/media-compat-client.test.mjs`
- Modify: `web/index.html`
- Modify: `package.json`

**Interfaces:**
- Produces: `window.BppMediaCompat.isPortableClient()`, `prepare()`, `waitUntilReady()`, `cancelWaiter()`, `download()`, and `shareLink()`.
- Produces: stable authenticated share query `/?media=event&id=<encoded-event-id>`.
- Consumes: same-origin `/api/media-compat/`; never accepts an arbitrary media URL.

- [ ] **Step 1: Add failing pure-client tests**

Use Node's built-in test runner and injected navigator/fetch/clock. Cover iPhone, iPad, iPadOS desktop-identifying touch device, Android phone/tablet, Windows Desktop, macOS Desktop, missing client hints, abort, 429/503, job failure, and polling backoff. Assert `prepare` submits only event ID or camera/start/end plus purpose.

- [ ] **Step 2: Implement portable detection as routing policy**

Prefer `navigator.userAgentData.mobile` when available, then iOS/iPadOS/Android fallbacks. Treat `MacIntel` plus touch points as iPadOS. Unknown clients default to Desktop original playback but can invoke compatibility after a media `error`; detection is not used as authorization.

- [ ] **Step 3: Implement bounded prepare/poll/cancel helpers**

Poll only while the caller's `AbortSignal` remains active, honor bounded `retry_after_ms`, cap total UI wait, and map server codes to Thai operator messages. Do not spin, leak timers, or retry a terminal failure in the browser; server policy owns the single conversion retry.

- [ ] **Step 4: Load the helper before the application and pin its revision**

Add `assets/media-compat.js?v=1` immediately before `app.js`, bump `app.js` only when its integration lands, and add a focused `test:media-compat-client` package script.

- [ ] **Step 5: Run client tests and commit**

```powershell
npm run test:media-compat-client
git add web/assets/media-compat.js web/index.html tests/media-compat-client.test.mjs package.json
git commit -m "feat: add portable media browser client"
```

---

### Task 9: Integrate Event Players, Universal Download, Original Download, and Sharing

**Files:**
- Modify: `web/assets/app.js`
- Modify: `web/index.html`
- Modify: `web/assets/app.css`
- Modify: `tests/browser-smoke.mjs`

**Interfaces:**
- Produces: portable event preparation in both `openPlayer` and event-details video.
- Produces: primary H.264 download plus separate byte-identical original HEVC download in both event action surfaces.
- Produces: authenticated application share link which prepares compatibility media after login.
- Consumes: `window.BppMediaCompat` and existing original Frigate event clip URL helper.

- [ ] **Step 1: Extend the browser mock router and add failing portable tests**

Mock `/api/media-compat/prepare`, `/jobs/{id}`, and `/media/{key}.mp4`. Create iPhone and Desktop Playwright contexts. Assert iPhone event player and event-detail player wait for compatible media; Desktop player still sets `/nvr/api/events/{id}/clip.mp4`. Assert a mobile media error cannot recurse indefinitely and stale event preparation is aborted when the modal closes or another event opens.

- [ ] **Step 2: Add failing action tests**

For both event surfaces assert:

- primary Download prepares H.264 on iPhone and Desktop;
- “ดาวน์โหลดไฟล์ต้นฉบับ” uses the unchanged Frigate clip URL;
- Share copies `new URL('/?media=event&id=evt-1', location.origin).href`, not a direct `/nvr/api/events/evt-1/clip.mp4` URL;
- opening that authenticated link selects the event and prepares compatible media;
- failed conversion leaves original download available and reports the original is not missing.

- [ ] **Step 3: Refactor one event media coordinator**

Add small application helpers such as:

```javascript
function originalEventClipUrl(eventId) { /* fixed Frigate route */ }
async function eventPlaybackUrl(eventId, { signal, forceCompat = false } = {}) { /* policy */ }
async function portableDownloadForEvent(eventId, fileName, signal) { /* prepare then blob */ }
```

Route both `openPlayer()` and the event-details player through the same coordinator. Preserve demo behavior, zoom, snapshot, controls, and current Desktop autoplay handling.

- [ ] **Step 4: Add preparation/error UI and original actions**

Reuse existing spinners where possible. Add explicit Thai states for queued, converting, health wait, queue full, failure, and original-file fallback. Add accessible original-download buttons to both player/action layouts without replacing the primary button.

- [ ] **Step 5: Run focused browser and client suites**

```powershell
npm run test:media-compat-client
npm run test:browser
```

Expected: PASS for mobile compatibility behavior and all existing dashboard regressions.

- [ ] **Step 6: Commit event integration**

```powershell
git add web/assets/app.js web/index.html web/assets/app.css tests/browser-smoke.mjs
git commit -m "feat: deliver portable event video"
```

---

### Task 10: Integrate 60-Second Portable Timeline Chunks and Follower Prefetch

**Files:**
- Modify: `web/assets/app.js`
- Modify: `tests/browser-smoke.mjs`
- Modify: `web/assets/app.css`

**Interfaces:**
- Produces: `pbChunkLen()` returning at most 60 seconds on portable clients and unchanged Desktop behavior.
- Produces: compatibility preparation for `pbLoadClip` and `pbSyncFollower` with identical absolute boundaries.
- Produces: one lower-priority next-chunk prefetch per active Playback session.
- Consumes: current recording-segment calculations and `BppMediaCompat` cancellation primitives.

- [ ] **Step 1: Add failing main/follower routing tests**

In an iPhone context click a known recorded time and assert prepare receives `camera`, exact `start`, `end <= start + 60`, and `purpose=playback`. Select 2- and 4-cell layouts and prove followers use their own camera with the same absolute start target and at-most-60-second boundary. In Desktop context assert original Frigate clip routes and 300/900-second behavior remain.

- [ ] **Step 2: Make main and follower loads generation-safe**

Convert `pbLoadClip` to an async coordinator guarded by a Playback session/generation token. Abort obsolete waits on seek, date/camera/layout change, overlay close, and follower camera change. Only the latest generation may set `video.src`, spinner text, `winStart`, or `winEnd`.

- [ ] **Step 3: Preserve synchronized time semantics**

Keep `pbSnapToRecorded` and `pbContiguousEnd` as the source of truth. Calculate the absolute `[start,end]` once, prepare that exact tuple, then seek by `absT-start`. Do not derive synchronization from converted media duration or wall-clock completion time.

- [ ] **Step 4: Add failing continuation and prefetch tests**

Assert the next chunk is submitted only after current media becomes ready, uses `purpose=prefetch`, never has more than one pending prefetch per cell/session, is cancelled on seek when unshared, and does not block explicit main/follower work. Assert `ended` consumes a ready prefetched URL or prepares the next chunk and continues.

- [ ] **Step 5: Implement bounded portable prefetch**

Store prefetch by `{session, camera, start, end}`. Never prefetch Desktop original routes. Do not interrupt server work shared by another user; browser cancellation only removes this waiter's interest. Clear all leases/timers when Playback closes.

- [ ] **Step 6: Preserve Playback download policy**

Route primary timeline Download through compatibility on all clients and add an explicit original HEVC action for the selected range. Preserve exact selected start/end and filename. For an over-limit export, show guidance to narrow the range instead of silently splitting or lowering resolution.

- [ ] **Step 7: Run browser regressions and commit**

```powershell
npm run test:browser
git add web/assets/app.js web/assets/app.css tests/browser-smoke.mjs
git commit -m "feat: support portable timeline playback"
```

---

### Task 11: Integrate Per-Node Secrets and Exclude Derived Cache From Every Release Path

**Files:**
- Modify: `scripts/release/release-policy.json`
- Modify: `scripts/release/build_site_profiles.py`
- Modify: `scripts/release/Install-BppRelease.ps1`
- Modify: `scripts/release/New-BppMigrationPackage.ps1`
- Modify: `scripts/release/New-BppUpdatePackage.ps1`
- Modify: `scripts/release/Test-BppRelease.ps1`
- Modify: `tests/test_release_profiles.py`
- Modify: `tests/test_release_installer.py`
- Modify: `tests/test_release_package.py`
- Modify: `tests/test_release_update.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: unique `MEDIA_COMPAT_PROXY_SHARED_SECRET` on every installed node.
- Produces: release policy exclusion for `runtime-cache` and verifier rejection if cache media appears.
- Consumes: existing multi-site install/update/migration workflows without enabling DuckDNS.

- [ ] **Step 1: Add failing per-node secret tests**

Add the new key to fixture source env and assert clone/new-site profiles clear the old value, installer generates a nonblank unique replacement, reports/logs never contain it, updates preserve the target-owned value, and two installs differ.

- [ ] **Step 2: Add failing derived-cache exclusion tests**

Place fake `.mp4`, `.partial`, and metadata beneath `runtime-cache/mobile-video` in migration/update fixtures. Assert neither TAR contains any `runtime-cache` entry. Add a malicious archive fixture and assert `Test-BppRelease.ps1` rejects it as forbidden derived/runtime media.

- [ ] **Step 3: Update canonical release policy and builders**

Add `runtime-cache` to `excludedRuntimeRoots`, `siteOwnedPaths`, and excluded path names as appropriate, but not `requiredState` or `rollbackState`. Add `MEDIA_COMPAT_PROXY_SHARED_SECRET` to `regeneratedSecretKeys` and profile-cleared keys. Generate it beside the existing independent proxy/service secrets in `Install-BppRelease.ps1`.

- [ ] **Step 4: Add Git exclusion**

Add exactly:

```gitignore
# Disposable mobile playback derivatives; never package or commit.
runtime-cache/mobile-video/
```

- [ ] **Step 5: Run release/migration regression suites**

```powershell
python -m pytest -q tests/test_release_profiles.py tests/test_release_installer.py tests/test_release_package.py tests/test_release_update.py tests/test_machine_migration.py
```

Expected: PASS; existing camera/profile, local-only DuckDNS, autostart, rollback, and no-media guarantees remain intact.

- [ ] **Step 6: Commit release integration**

```powershell
git add scripts/release tests/test_release_profiles.py tests/test_release_installer.py tests/test_release_package.py tests/test_release_update.py .gitignore
git commit -m "feat: package media compatibility safely"
```

---

### Task 12: Complete Documentation, Automated Verification, Controlled Rollout, and Rollback Proof

**Files:**
- Create: `docs/features/mobile-video-compatibility.md`
- Create: `docs/sessions/session-2026-08-09-mobile-video-compatibility.md`
- Modify: `docs/features/README.md`
- Modify: `docs/README.md`
- Modify: `docs/current-state.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security-model.md`
- Modify: `docs/operations.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/history.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: operator runbook for health, queue, cache, GPU, mobile troubleshooting, deployment, rollback, and multi-site defaults.
- Produces: recorded acceptance evidence for iPhone 16 Pro, Android, Desktop, Frigate continuity, and cache guard.
- Consumes: approved design, implementation commits, test output, and runtime measurements; contains no credentials or camera media.

- [ ] **Step 1: Write the feature owner and cross-links**

Document source/output formats, API states, portable/Desktop policy, queue limits, exact D-drive cache guard, tmpfs lease, health thresholds, error codes, security boundaries, and exclusions. Link the feature from both indexes and link back to the approved design and this plan.

- [ ] **Step 2: Update operational and security documentation**

Record the new service/network/secret, no-host-port rule, cache cleanup procedure, internal health commands, queue behavior, failed conversion guidance, original-download fallback, and rollback that never changes original recordings. Update current service count/topology and session/history entries.

- [ ] **Step 3: Run placeholder and documentation consistency scans**

```powershell
$markers = @(('TO' + 'DO'), ('T' + 'BD'), ('FIX' + 'ME'), ('PLACE' + 'HOLDER'), ('change' + '-me'), ('example' + '-secret'))
rg -n ($markers -join '|') media-compat-service web docs scripts/release docker-compose.yml dashboard-nginx.conf --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/specs/**'
rg -n "media-compat-service|MEDIA_COMPAT_PROXY_SHARED_SECRET|runtime-cache/mobile-video" docs scripts/release docker-compose.yml dashboard-nginx.conf .gitignore
```

Expected: first command has no unintended implementation placeholders; second shows consistent ownership/security/exclusion documentation.

- [ ] **Step 4: Run the full automated gate**

```powershell
python -m pytest -q media-compat-service/tests -m "not gpu"
python -m pytest -q tests
npm run test:media-compat-client
npm run test:browser
docker compose config --quiet
docker compose build media-compat-service
docker compose run --rm --no-deps media-compat-service ffmpeg -hide_banner -encoders
docker compose run --rm --no-deps media-compat-service ffprobe -version
```

Expected: every test passes, Compose validates, image builds, and runtime lists `h264_nvenc`. Stop on any failure.

- [ ] **Step 5: Capture the pre-rollout recording baseline**

Record without exposing secrets:

```powershell
docker inspect frigate-nvr --format '{{.Id}} {{.State.StartedAt}} {{.State.Health.Status}}'
nvidia-smi --query-gpu=name,memory.total,memory.free,temperature.gpu --format=csv,noheader
docker stats --no-stream frigate-nvr
```

Also record enabled connected camera FPS/skipped FPS and detector inference from Frigate metrics. Keep the values in the session document, not chat logs containing credentials.

- [ ] **Step 6: Start only the new service and reload only Dashboard**

Generate the missing local proxy secret through the existing safe env tooling, then:

```powershell
docker compose up -d --no-deps media-compat-service
docker compose up -d --no-deps dashboard
```

Expected Dashboard interruption: approximately 10-30 seconds. Keep `MEDIA_COMPAT_ENABLED=false` for this pre-acceptance start. Do not use a command that includes `frigate`; do not use global `docker compose up -d`.

- [ ] **Step 7: Validate the disabled gate and runtime readiness**

With the route still guarded by the feature switch, prove `/health` reports runtime readiness, `h264_nvenc` is present, and `/prepare` refuses to admit any work with the stable disabled response. Confirm no FFmpeg process starts and Frigate health, detector inference, camera FPS, and skipped FPS remain at baseline.

- [ ] **Step 8: Prove the D-drive guard and cache safety**

Use injected/test thresholds rather than filling D. Demonstrate persistent publish above the guard, tmpfs-only behavior at/below `15% + 2 GiB`, 10 GiB LRU eviction, 15-minute lease semantics, restart cleanup, and zero writes/deletes under `storage/`.

- [ ] **Step 9: Run real-device acceptance**

After automated/runtime gates pass, set `MEDIA_COMPAT_ENABLED=true` and recreate only `media-compat-service` with `docker compose up -d --no-deps media-compat-service`; the Dashboard route and static UI require no second reload. During this supervised acceptance window, run one representative 60-second conversion and record duration, GPU temperature, VRAM, encoder utilization, Frigate health, detector inference, camera FPS, and skipped FPS. Confirm one active plus two waiting, fourth unique rejection, duplicate coalescing, cache hit without FFmpeg, health-gate cancellation, and no `libx264` process/argument. Then test:

- iPhone 16 Pro Safari event player, event-details player, main/follower Playback, seek/continuation, primary download in Files, original download, and shared authenticated link;
- at least one Android browser/tablet equivalent flows;
- Windows Desktop original event/Playback remains original, while primary download/share is H.264 and original download remains byte-identical;
- Live View, recording, detection, snapshots, zoom, and unrelated Dashboard functions remain operational.

Record pass/fail and file probe facts, not captured media.

- [ ] **Step 10: Verify Frigate continuity and rollback**

Compare Frigate container ID and `StartedAt` to Step 5; both must be identical and health must remain `healthy`. Exercise rollback by restoring the prior Dashboard assets/config and stopping only `media-compat-service`; prove Desktop/original behavior returns and recording remains continuous. Restore the new Dashboard only after rollback proof passes.

- [ ] **Step 11: Commit documentation and final evidence**

```powershell
git add docs CLAUDE.md
git commit -m "docs: operate mobile video compatibility"
git status --short
```

Expected: documentation commit succeeds and the worktree is clean.

- [ ] **Step 12: Request code review and finish the development branch**

Invoke `superpowers:requesting-code-review`, address findings with `superpowers:receiving-code-review`, rerun the full gate with `superpowers:verification-before-completion`, then use `superpowers:finishing-a-development-branch` to present merge/PR/keep/discard options. Do not merge or deploy to additional sites without the user's explicit choice.

---

## Final Acceptance Gate

Do not call the implementation complete until every item below has evidence:

- [ ] iPhone 16 Pro and Android can play event video and main/follower timeline video.
- [ ] Primary event/timeline downloads and shared links use H.264/AAC and work on portable plus Desktop clients.
- [ ] Original HEVC download remains available and byte-identical to the same Frigate source response.
- [ ] Portable chunks are at most 60 seconds; Desktop remains 300/900 seconds and on original media.
- [ ] Output is H.264 `avc1`, `yuv420p`, source resolution, AAC when present, monotonic, complete, non-fragmented, fast-start, range-seekable, and fully decodable.
- [ ] Exactly one NVENC job runs; two unique jobs may wait; duplicates coalesce; the fourth unique job is rejected clearly; no CPU video encoder runs.
- [ ] Cache hit launches no FFmpeg process; cache never exceeds 10 GiB; guard and tmpfs lease behave exactly as approved.
- [ ] Migration, update, backup, rollback, NAS, and Git contain no compatibility-cache media.
- [ ] The compatibility service has no host port, no recording/config write mount, no security network, and no browser-trusted identity header.
- [ ] Frigate container ID/`StartedAt` remain unchanged during rollout; health, enabled-camera FPS, detection, Live View, and recording remain operational.
- [ ] Removing the new service and restoring the previous Dashboard requires no recording/database repair and returns the prior behavior.
