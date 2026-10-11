# Mobile Video Compatibility Design

**Date:** 2026-08-09

**Status:** Approved design

**Scope:** Event video, event downloads and sharing, and timeline Playback on portable devices

## 1. Problem Statement

BPP-VMS records the camera main streams by copying their native HEVC video. This
keeps continuous recording inexpensive and preserves the source quality, but the
resulting Frigate clips use HEVC Main with the `hev1` sample entry and fragmented
MP4 structure. The same downloaded file plays on Windows Desktop but does not play
in Safari or Files on an iPhone 16 Pro.

Read-only diagnosis established all of the following:

- the phone receives the clip successfully; the failure is not authentication,
  routing, DuckDNS, or a missing file;
- the downloaded file is a valid, decodable MP4 rather than random or corrupted
  bytes;
- the file contains HEVC Main `hev1`, 1920x1080 video;
- Frigate event output can contain multiple MP4 fragments and timestamp gaps;
- FFmpeg can decode the source and can produce a valid H.264 `avc1` version;
- Apple devices support HEVC generally, but Apple recommends `hvc1` rather than
  `hev1` for compatible delivery;
- a controlled in-memory benchmark converted approximately 60 seconds of 1080p
  source video with NVENC in 1.81 seconds (about 32x real time) without interrupting
  camera processing or detection.

Changing the recording pipeline to H.264 would consume GPU continuously and would
couple mobile compatibility to the safety-critical recording path. The approved
solution therefore adds compatibility at playback time only.

## 2. Goals

1. Play event clips on phones and tablets.
2. Make the primary event download and shared link playable on common devices.
3. Make timeline Playback work on portable devices, including the main view and
   synchronized follower views.
4. Preserve original HEVC recordings and the existing Desktop playback path.
5. Isolate failures and resource use from Frigate recording, detection, and Live
   View.
6. Convert historical and new recordings only when requested.
7. Reuse completed conversions when storage policy permits it.

## 3. Non-Goals

- Changing camera, go2rtc, or Frigate recording codecs.
- Re-encoding the existing archive in bulk.
- Changing Live View streams.
- Moving BPP-VMS, recordings, or the compatibility cache away from drive D.
- Using CPU video encoding as a fallback.
- Including compatibility cache files in backup, migration, or update packages.

## 4. Chosen Architecture

Add an isolated `media-compat-service` container. It reads media through Frigate's
internal API and writes only to its dedicated temporary/cache mount. It has no
permission to modify Frigate configuration, the recording database, or recording
files.

The dashboard gateway is the only browser-facing entry point. New compatibility
routes retain the existing login and role checks. The service has no host-published
port.

The service uses FFmpeg with CUDA decoding and NVIDIA NVENC encoding. Output is a
complete, non-fragmented, fast-start MP4 with:

- H.264 `avc1` video;
- the original 1920x1080 resolution unless the source is smaller;
- broadly compatible `yuv420p` output;
- monotonic timestamps starting at zero, while preserving the requested timeline
  duration and preventing backward PTS/DTS;
- AAC-LC audio when the source contains audio, otherwise video only;
- no software/CPU video-encoding fallback.

The service finishes and validates a temporary MP4 before publishing it. Publishing
is an atomic rename inside the temporary/cache filesystem, so clients never receive
partially written media.

## 5. Request and Delivery Flow

### 5.1 Preparation contract

The frontend submits a prepare request describing one of two immutable sources:

- an event ID; or
- a camera plus exact start and end timestamps.

The service returns either a ready media URL or a queued/running job identifier.
The frontend polls job status with a bounded interval and shows a Thai status such
as "กำลังเตรียมวิดีโอสำหรับอุปกรณ์นี้". Completed media URLs support `HEAD`,
`Content-Length`, `Accept-Ranges: bytes`, and correct `206 Partial Content`
responses.

The service coalesces identical requests by cache key. A cache key includes source
identity, requested time range, output profile, and transcoder schema version.
Concurrent users requesting the same media wait for one job and receive the same
validated result.

### 5.2 Event player

- Portable devices prepare and play the H.264 compatibility file.
- Desktop browsers retain the current original Frigate clip path.
- If a desktop browser cannot play the original, the media-error handler may offer
  the compatibility path without changing the normal Desktop default.

Portable routing is a usability policy rather than a security boundary. The
frontend covers iOS, iPadOS, and Android using the available mobile client hint plus
tested platform fallbacks for devices such as iPadOS that may identify as Desktop.
Any client whose original media element reports an unsupported-media error can use
the same compatibility path, so an unknown portable browser is not permanently
excluded by identification alone.

### 5.3 Timeline Playback

- Portable devices request 60-second compatibility chunks.
- Desktop retains the existing 300-second chunk behavior and original media path.
- The main view and follower views use the same absolute time boundaries.
- The frontend prefetches the next portable chunk only after the current chunk is
  ready and while the user remains in the same Playback session.
- Prefetch is lower priority than an explicit play, seek, download, or share
  request.
- Seeking cancels obsolete queued prefetch requests but never interrupts a job
  already shared by another user.

### 5.4 Download and sharing

- The primary Download action prepares H.264/AAC on every client, including
  Desktop, because downloaded files are expected to be portable.
- A separate "ดาวน์โหลดไฟล์ต้นฉบับ" action retains access to the original HEVC
  file for evidence preservation and advanced users.
- Share produces an authenticated application link rather than exposing an
  internal Frigate URL. Opening the link prepares and plays the portable H.264
  version after login.
- Authorization remains identical to the existing event or Playback permission;
  a compatibility route cannot grant access to a source the caller cannot read.

## 6. Resource Isolation and Scheduling

The machine currently has an RTX 5060 Ti 16 GB, an Intel Core i5-14500, and 32 GB
RAM. The measured NVENC benchmark and current runtime load support the conservative
scheduler below:

- one running transcode per node;
- at most three user requests admitted at once: one running and two waiting;
- duplicate requests do not consume additional queue slots;
- explicit user actions take priority over prefetch;
- no CPU video-encoding fallback;
- a bounded per-job timeout based on requested duration, with one automatic retry;
- one failed retry produces a clear user-visible error and leaves the original
  media untouched.

Before starting a job, the service verifies that:

- Frigate is healthy and its internal API responds;
- the NVIDIA GPU and NVENC encoder are available;
- GPU temperature is below 80 degrees Celsius;
- at least 1 GiB of VRAM is free;
- temporary output capacity is available.

During a job, two consecutive failed Frigate health checks, GPU temperature at or
above 85 degrees Celsius, or loss of the NVIDIA encoder cancels the compatibility
job. Cancellation never restarts or reconfigures Frigate. A cancelled explicit job
may use its single retry after the health gate recovers; prefetch is simply dropped.

Camera FPS is monitored for observability but is not a start gate because individual
cameras may legitimately be offline. Deployment validation must nevertheless show
that enabled, connected cameras and detector inference remain within their baseline
range during a compatibility conversion.

## 7. Cache and Temporary Storage

The persistent compatibility cache remains on drive D under a dedicated runtime
directory. The default path is:

`D:\BPP-VMS\frigate-nvr\runtime-cache\mobile-video`

The directory is gitignored and explicitly excluded from release, backup, export,
and migration packages.

Cache rules:

- hard logical ceiling: 10 GiB;
- LRU eviction by last successful access;
- the current configured recording free-space threshold remains 15 percent;
- compatibility cache may write only when drive D has more than 15 percent free
  space plus an additional 2 GiB safety margin;
- the service rechecks free space before atomic publication;
- cache is always evicted before any original recording could be affected;
- when the free-space guard cannot be met, persistent caching is disabled for that
  request.

When persistent caching is unavailable, the single active job uses a bounded tmpfs
working area. A complete file is built there so it can still be validated and served
with byte ranges. The initial tmpfs limit is 512 MiB, justified by the measured
approximately 20 MiB output for a 60-second 1080p benchmark and by the one-job
concurrency limit. A request whose estimated or actual output exceeds the tmpfs
limit fails safely with guidance to narrow the Playback export range; it never
spills into the recording directories.

A completed tmpfs result remains leased for 15 minutes after its most recent media
access so Safari and other players can issue repeated range requests. A new job may
evict an expired lease, but never an actively served file. All tmpfs results vanish
on service restart and are recreated on demand.

Cached files whose source event or source time range no longer exists are removed
by periodic orphan cleanup. Cache deletion is always safe because cache is derived
data.

## 8. Failure Handling

- A partial conversion stays under a temporary name and is never served.
- Process exit, validation failure, timeout, or health-gate cancellation removes
  the partial output.
- The service retries an explicit request once; it does not retry speculative
  prefetch.
- After the retry fails, the UI reports that the mobile-compatible video could not
  be created. It does not claim that the original recording is missing.
- Desktop original playback remains available independently.
- Restarting `media-compat-service` invalidates in-memory jobs. Clients may submit
  again, and valid published cache entries remain usable.
- Stopping or removing the compatibility service does not stop Frigate, recording,
  detection, or Live View.

## 9. Security Boundaries

- All browser routes pass through the existing Nginx authentication subrequest.
- The compatibility service is reachable only on internal Docker networks.
- The service receives only the minimum mounts and network access it needs.
- Its root filesystem is read-only; only tmpfs and the dedicated cache directory
  are writable.
- Client input is a validated event ID or camera/time tuple, never a filesystem
  path or arbitrary upstream URL.
- Response headers retain the gateway's current same-origin and hardening policy.
- Original-download authorization is no broader than current original clip access.

## 10. Observability

The service exposes an internal health endpoint and structured logs containing:

- cache key and source type without camera credentials;
- queued, running, ready, cache-hit, cancelled, and failed state;
- queue wait time, conversion duration, source duration, and output size;
- cache usage and free-space-guard decisions;
- retry and health-gate reason;
- FFmpeg exit classification without leaking source credentials.

The dashboard may display preparation progress, but administrative tuning UI is
outside this change. Queue, cache, timeout, and guard defaults remain documented
configuration values suitable for release packaging across sites.

## 11. Testing Strategy

### 11.1 Automated tests

- Generate synthetic HEVC `hev1` fragmented MP4 fixtures with timestamp gaps; do
  not commit real camera footage.
- Verify H.264 `avc1`, 1080p preservation, `yuv420p`, AAC when present, monotonic
  timestamps, non-fragmented fast-start output, and FFmpeg decode success.
- Verify event and camera/time source validation and authorization boundaries.
- Verify queue capacity, duplicate coalescing, priority, cancellation, timeout, and
  exactly one retry.
- Verify `HEAD`, content length, range parsing, valid `206`, invalid-range `416`,
  and seek behavior.
- Verify LRU eviction, the 10 GiB ceiling, the 15-percent-plus-2-GiB guard, tmpfs
  fallback, partial-file cleanup, and orphan cleanup.
- Verify no CPU encoder is selected when NVENC is absent or unhealthy.
- Verify mobile 60-second chunks and Desktop 300-second chunks.
- Verify Download, Original Download, Share, Event player, main Playback, and
  follower Playback routing.

### 11.2 Runtime validation

- Re-run the one-job NVENC benchmark and record conversion speed, VRAM, encoder,
  decoder, temperature, detector inference time, camera FPS, and skipped FPS.
- Validate with an iPhone 16 Pro in Safari and Files.
- Validate with at least one Android portable browser.
- Regression-test Desktop event playback, timeline Playback, original download,
  Live View, recording continuity, and detection.
- Exercise cache-disabled operation while drive D is at the configured storage
  guard.
- Confirm Frigate container identity and start time do not change during deployment.

## 12. Deployment and Rollback

Deployment builds and starts only `media-compat-service`, then updates/reloads the
dashboard gateway and static frontend. Frigate is not recreated or restarted.
Expected dashboard unavailability is 10-30 seconds while recording continues.

The feature remains disabled until service health, automated checks, Desktop
regression, and real portable-device playback all pass. If the rollout fails, the
dashboard remains on the original routes and the compatibility feature stays off.

Rollback restores the previous dashboard routes/static assets and stops the new
service. Only derived compatibility cache may be deleted. No recording repair or
codec rollback is required because original media was never modified.

## 13. Acceptance Criteria

The design is complete only when all of the following are demonstrated:

1. Event playback works on the iPhone 16 Pro and an Android portable browser.
2. Primary downloaded and shared files play on portable devices and Desktop.
3. The original HEVC download remains available and byte-identical to Frigate's
   source response for the same request.
4. Main and follower timeline Playback work with 60-second portable chunks,
   including seek and automatic continuation.
5. A cache hit starts without a new FFmpeg process.
6. A cache miss completes a 60-second representative clip within the agreed target
   under normal load; the measured baseline is 1.81 seconds on this node.
7. At most one NVENC conversion runs at a time, and no software video encoder runs.
8. Frigate recording, detection, Live View, Desktop playback, and enabled connected
   camera FPS remain operational during conversion.
9. At or below the drive-D safety guard, the compatibility cache performs no
   persistent write and original recordings are not displaced.
10. Disabling or removing the new service restores the prior behavior without any
    recording or database change.
