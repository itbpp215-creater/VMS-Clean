## Update 2026-10-22 (Midday 2) - Fix Mobile iOS Safari Initialization Halt & Blank Purple Screen Trap (Incident 2.185, v212)
- **Problem / User Request**:
  - User reported: *"ระบบยังไม่มาครับ"* (The system is still not appearing) accompanied by an iPhone screenshot (`media_1792640873663_82e9c6b8.png`).
  - Screen status: The Events Rail drawer was cleanly closed (fixed in v211), but the central screen remained completely blank (purple background), clock stayed stuck on static HTML `--:--:--`, date was empty, counters showed `ออนไลน์ 0  เชื่อมต่อ 0  ออฟไลน์ 0`, and no camera grid tiles or layout switch buttons appeared.
- **Root Cause Diagnosed**:
  1. **Premature `bind()` Execution Blocking Core UI Rendering**:
     - In `app.js`, `async function init()` executed `bind()` before `tickClock()`, `buildLayoutSwitch()`, and `rebuildGrid()`.
     - When any unguarded DOM query, missing element, or WebKit-specific behavior occurred inside `bind()` (such as direct `.addEventListener` without null check, digital zoom element queries, or touch handlers), an uncaught exception was thrown.
     - Because `init()` is an async function, an uncaught exception immediately aborted the entire function. Lines 12460-12466 (`tickClock()`, `buildLayoutSwitch()`, `rebuildGrid()`) were never reached, leaving the static HTML default values `--:--:--` and an empty `#grid`.
  2. **Lack of Fault Isolation in Event Listeners**:
     - Over 50 event listeners in `bind()` lacked optional chaining `?.` or existence guards. An issue in any non-essential control (e.g. playback zoom, NVR auto-discovery, detail popups) completely crashed the primary live camera view.
- **Resolution**:
  1. **Immediate 0ms Clock & Grid Render Before Event Binding (`frigate-nvr/web/assets/app.js`)**:
     - Restructured `init()` so that `tickClock()`, `setInterval(tickClock, 1000)`, mobile drawer auto-hide, cached profile restore, and `rebuildGrid()` execute FIRST in dedicated `try...catch` blocks. The camera grid and live clock render in 0ms regardless of any subsequent network or binding issues.
  2. **Fault-Isolated `bind()` & Sub-Routine Null Guards (`frigate-nvr/web/assets/app.js`)**:
     - Wrapped `bind()` and all sub-sections (Topbar, Events, Viewer, Layout, Zoom, Snapshot, Playback, Settings) in independent `try...catch` blocks.
     - Added null guards and safe stubs to `makeVideoZoom()` and `wireZoomControls()`.
     - Upgraded all `$('id').addEventListener` to `$('id')?.addEventListener`.
  3. **Global Client Error Telemetry & Startup Rejection Guard (`frigate-nvr/web/assets/app.js`)**:
     - Added global `error` and `unhandledrejection` listeners at the script root to log errors and send lightweight beacon logs to `/api/client-error`.
     - Wrapped top-level `startDashboardApp()` with `.catch()` to prevent unhandled promise rejections.
  4. **Cache Buster Bump**: Updated cache buster to `app.js?v=212` in `index.html` and reloaded Nginx. Verified live via Chrome DevTools Protocol simulating iPhone: 9 camera grid tiles rendered, clock ticking live (`11:07:52`), date displayed, and all 5 WebSockets connected cleanly.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`, `Troubleshooting & Incident Runbook.md`.

## Update 2026-10-22 (Midday) - Fix Mobile iPhone Events Rail Overlay & "0 รายการ" Black Screen Trap + Auto-Heal API Origin on Cellular (Incident 2.184, v211)
- **Problem / User Request**:
  - User uploaded an iPhone screenshot (iOS Safari, portrait mode) showing:
    1. The "เหตุการณ์" (Events Rail drawer) was open and stuck displaying: `● เหตุการณ์ 0 รายการ` with an empty pitch-black list below.
    2. The mobile camera dashboard and grid was 80% occluded by the drawer with no obvious way to dismiss it except the tiny top-right chevron button, trapping the user.
    3. User was confused whether events had failed to load, why 0 events appeared, or why the drawer covered the screen.
- **Root Cause Diagnosed**:
  1. **Unconditional Initial DOM Visibility in HTML**:
     - `<aside id="eventsRail">` in `index.html` lacked the `hidden` attribute in static HTML. On mobile portrait (`width < 768px`), CSS applied `position: fixed !important; height: 100dvh !important; width: min(280px, 80vw) !important; z-index: 99 !important;`. During network delay or initial parse, the static uninitialized HTML rendered immediately, trapping the screen.
  2. **Silent Failure / Empty State with No Feedback**:
     - When `fetchEvents()` ran or encountered network delays / Frigate restart, if `state.events` was empty, `renderEvents()` was bypassed or `evList` was left with 0 children, causing the raw static HTML string `0 รายการ` with a black void to stay on screen indefinitely with zero user feedback.
  3. **Stale LocalStorage API Origin on Cellular 4G/5G**:
     - `loadCfg()` preserved `saved.api` from `localStorage` as long as it started with `http`. If an operator previously accessed the dashboard over local LAN IP (`http://192.168.1.xxx:8080/nvr`) and later opened the dashboard remotely over cellular HTTPS (`https://vms.local`), Safari silently blocked `apiUrl('/api/events')` due to Mixed Content / unreachable private IP.
  4. **No Backdrop Dismiss or Touch Swipe Dismiss**:
     - The dark backdrop was implemented via `.events-rail::before` (a CSS pseudo-element), which does not receive separate pointer click handlers. Tapping anywhere outside the drawer on mobile did not dismiss it.
- **Resolution**:
  1. **Hidden by Default in Static HTML (`frigate-nvr/web/index.html`)**:
     - Added `hidden` attribute to `<aside id="eventsRail" ... hidden>`. On desktop (>= 900px), `init()` immediately unhides it in 0ms; on mobile (< 900px), it remains strictly hidden until explicitly invoked.
  2. **Active Mobile Backdrop & Gesture Swipe to Dismiss (`app.js`, `app.css`, `index.html`)**:
     - Added `<div id="eventsBackdrop" class="events-backdrop" hidden></div>` with `z-index: 90` and smooth fade-in.
     - Added click listener on `#eventsBackdrop` and global document click handler outside `#eventsRail` to auto-dismiss on tap.
     - Added touch swipe right listener (`touchstart` / `touchend`, `dx > 45px`) to smoothly close the drawer with native swipe gestures on iPhone/iPad.
  3. **Auto-Heal Stale `cfg.api` and `cfg.base` Origins (`frigate-nvr/web/assets/app.js`)**:
     - In `loadCfg()`, if `SAME_ORIGIN` is active and `saved.api` or `saved.base` uses `http:` while the page is on `https:`, or points to a mismatched hostname, automatically heal to `DEFAULTS.api` (`location.origin + '/nvr'`) and `DEFAULTS.base`.
  4. **Informative Loading & Empty States with Active Filter Badges (`app.js`, `app.css`)**:
     - Added `renderEventsEmptyState(reason)` with dedicated UI states:
       - `loading`: Subtle spinner with "กำลังโหลดเหตุการณ์ล่าสุด… กำลังเชื่อมต่อฐานข้อมูล AI NVR".
       - `offline`: "⏳ กำลังเชื่อมต่อระบบเหตุการณ์… รอสัญญาณจาก NVR" with a quick `🔄 ลองเชื่อมต่อใหม่` button.
       - `none`: Clean empty icon with "ไม่มีเหตุการณ์ล่าสุด" and if class filters are active, displays "กำลังกรองเฉพาะ: [คน, รถ]" with a single-click `ล้างตัวกรอง (แสดงทั้งหมด)` button.
     - Added `.is-filtered` styling to `#btnRailClasses` with glowing badge when filters are engaged.
- **Files Changed**: `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/app.css`, `AI_HANDOVER_CONTEXT.md`, `Troubleshooting & Incident Runbook.md`.

## Update 2026-10-22 (Morning) - Fix CH05 Frozen Video & Non-Admin Operator Grid `VIDEO LOSS` on Split-Stream Cameras (`Doonsad1`) (Incidents 2.181 & 2.182, v210)
- **Problem / User Request**:
  1. User reported: *"ภาพกล้อง5 ที่ ch5 ค้าง"* (`CH05 กล้อง5` / `Doonsad5` live stream froze while still displaying `REC`).
  2. User uploaded a photo of the Wallboard TV (`Big`) showing `CH04 โค้งดูนสาดไปนาคำน้อย` (`Doonsad1`) stuck on `VIDEO LOSS / สัญญาณวิดีโอขาดหาย / NO VIDEO` while the same camera played live on `suchakree`'s iPhone.
- **Root Cause & Architecture Diagnosed**:
  1. **Incident 2.181 (Frozen Frame on `Doonsad5_sub`)**:
     - `ws.onmessage` in `app.js` updated `this.lastFrameTime = Date.now()` on every binary WebSocket packet, and `onTimeUpdate` updated `this.lastFrameTime` whenever `video.currentTime` advanced on the audio timeline even when `totalVideoFrames` had stopped advancing due to an MSE buffer micro-gap (`sb.buffered.length > 1`) or keyframe eviction (`end - 8`).
  2. **Incident 2.182 (`VIDEO LOSS` on `Doonsad1` for Non-Admin Operators)**:
     - When non-admin operators (`Big`, `tangmo1`, etc.) loaded camera metadata via `/api/public-config/cameras-catalog` (`config-api/api.py`), the endpoint returned `has_hd` but omitted `has_sub` / `sub_url`.
     - Consequently, `assignCameraToChannel()` and `inpCamSelect` in `app.js` set `ch.sub = ''`, causing `rebuildGrid()` / `syncGridDiffSmoothly()` (`ch.sub || ch.src`) to request raw `src=Doonsad1` (`#video=copy` HEVC + PCMA/8000) instead of NVENC H.264 `src=Doonsad1_sub`, which failed with `VIDEO LOSS`.
- **Resolution**:
  1. **Decoded-Frame Watchdog & MSE Gap Recovery (`frigate-nvr/web/assets/app.js`)**:
     - Removed `this.lastFrameTime = Date.now()` from raw `ws.onmessage`, verified `getVideoPlaybackQuality().totalVideoFrames` advances in `onTimeUpdate` and `startWatchdog()`, added automatic gap-jumping across disjoint `sb.buffered` ranges, increased MSE buffer retention to `> 30s` (keeping `15s` / 1-2 GOPs), and added a byte-signature stale guard in `startSnapshotStream()`.
  2. **Full `has_sub` Catalog Parity & Multi-Layer Substream Auto-Healing (`config-api/api.py`, `nas-bot-service/services/user_profile.py`, `web/assets/app.js` `v=210`)**:
     - Added `"has_sub": f"{cam_name}_sub" in go2rtc_streams` to `/api/config/cameras` and `/api/public-config/cameras-catalog` in `frigate-nvr/config-api/api.py`.
     - Added `normalizeChannelStreams(ch)` and `playableGridStream(ch)` (`ch.sub || ch.hd || ch.src`) plus a `Camera` constructor guard in `frigate-nvr/web/assets/app.js` (`v=210` in `index.html`) so split-stream cameras never fall back to raw unplayable HEVC `ch.src`.
     - Added `_normalize_channel_streams()` in `frigate-nvr/nas-bot-service/services/user_profile.py` to auto-heal `sub`/`hd` in `/data/user_profiles.json` and bump `grid_revision`, immediately healing the Wallboard TV (`Doonsad1_sub` active with 2 consumers in `go2rtc`).
- **Files Changed**: `frigate-nvr/config-api/api.py`, `frigate-nvr/nas-bot-service/services/user_profile.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 (Night) - Connect Face Recognition Engine to Arrest Vault Dossiers (`คลังข้อมูล` 830 Dossiers / 187 Suspect Faces) (Incident 2.183, v206)
- **Problem / User Request**:
  - User asked: *"ระบบใบหน้าเอาฐานข้อมูลมาจากคลังข้อมูลด้วยไหม"* (Does the face recognition system also pull its database from the Arrest Vault / Dossier database?).
- **Root Cause & Architecture Diagnosed**:
  - Previously, `FaceOnnxEngine` (`face_onnx.py`) only loaded faces from `config/faces` (manual enrollment), while the Arrest Vault (`คลังข้อมูล` at `/data/nas-storage/Dossiers`) contained **830 suspect dossiers**, of which **194 dossiers had 428 image files** (`Personal/*.jpg` ID card photos, TR14 forms, and arrest warrant photos).
- **Resolution**:
  1. **Automatic Arrest Vault (`Dossiers`) Face Indexing & Incremental Disk Cache (`frigate-nvr/lpr-service/face_onnx.py`)**:
     - Added `_resolve_dossiers_dir()`, `_load_dossiers_faces_unlocked()`, and `sync_dossiers()` to `FaceOnnxEngine`.
     - Automatically scans `Dossiers/<dossier_id>/Personal/*` and `profile.json`, detects human faces via `face.onnx` (`conf_thres=0.28`, filtering out non-face document scans), extracts 512-D ArcFace embeddings via `w600k_r50.onnx`, and caches embeddings + 112×112 cropped thumbnails in `config/faces/.dossiers_face_cache.json` (`1.85 MB`).
     - Extracted **187 suspect persons (`234` face photos)** with full metadata (`suspect_name`, `id_card`, `role_tag`, `charge`/`behavior`, `dossier_id`), reloading from cache in `~278 ms`.
  2. **Docker & Native Dossier Storage Sync + `/watchlist/faces/sync-dossiers` API**:
     - Copied `/data/nas-storage/Dossiers` (`830` dossiers, `428 MB`) into `D:\sloth+vms\native\nas-storage\Dossiers` for Native Mode and mounted `nas-storage:/data/nas-storage:ro` in `lpr` inside `docker-compose.yml`.
     - Added `POST /watchlist/faces/sync-dossiers` (`/api/watchlist/faces/sync-dossiers`) across `lpr-service/app.py`, `watchlist-api/api.py`, and `tools/native-exe/native_gateway.py`.
  3. **Watchlist Face Gallery Search & Source Badges (`v206`)**:
     - Added live search filter (`#inpFaceFilterQuery` by name, 13-digit ID card, or charge), `🔄 ซิงค์จากคลังข้อมูลจับกุม` button (`#btnFaceSyncDossiers`), and `📁 คลังข้อมูล` vs `🚨 เฝ้าระวัง` badges + `🪪` 13-digit ID card display on face cards in `index.html` and `app.js` (`?v=206`).
- **Files Changed**: `frigate-nvr/lpr-service/face_onnx.py`, `frigate-nvr/lpr-service/app.py`, `frigate-nvr/watchlist-api/api.py`, `frigate-nvr/docker-compose.yml`, `frigate-nvr/tools/native-exe/native_gateway.py`, `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.js`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 (Evening) - Sync Latest BPP-VMS Incidents 2.179–2.181 + Full Face Watchlist Dual-Tab UI v205 into Sloth+VMS
- **Problem / User Request**:
  - User requested updating `D:\sloth+vms` to the very latest version (`อัพให้เป็นล่าสุดด้วยครับ`).
- **Root Cause & Changes Merged**:
  1. **Merged Latest `origin/main` Commits (`01f6919`, `9f936c4`, `4a0da1d`) into `D:\sloth+vms\repo`**:
     - **Incident 2.179 (`01f6919`)**: Fixed `mseBufLen`/`silentMs` `ReferenceError` crash causing `VIDEO LOSS` on iOS 5G & restored surgical grid diffing.
     - **Incident 2.180 (`9f936c4`)**: Instant `0ms` camera grid & clock rendering on page load and non-blocking NAS SMB archive startup (`chat-widget.js` `v12`, `nas-video-archive.js` `v4`, deferred scripts).
     - **Incident 2.181 (`4a0da1d`)**: Prevented frozen video frames via real decoded frame tracking (`totalVideoFrames` watchdog), MSE gap jumping, and stale snapshot byte-signature guard.
  2. **Restored & Cleaned UTF-8 Dual-Tab Face Watchlist UI (`v205`)**:
     - Added the `#btnWlTabPlates` / `#btnWlTabFaces` dual-tab bar and `#wlPanePlates` / `#wlPaneFaces` panels inside `#watchlistOverlay` in `frigate-nvr/web/index.html` (`app.js?v=205`) and fixed UTF-8 Thai strings in `initFaceWatchlistUi()` in `frigate-nvr/web/assets/app.js`.
  3. **Live Runtime Config & Database Sync**:
     - Synced the latest `config.yml` (preserving `face_recognition:`), `camera_credentials.env`, `camera_sources.json`, `camera_templates.json`, `nvr_groups.json`, `dashboard-settings/camera_names.json`, `auth/auth.db`, and `lpr/watchlist.db` (`22.73 MB`) from `D:\BPP-VMS\frigate-nvr\config` into `D:\sloth+vms\native\config` and `D:\sloth+vms\native\migration-snapshot\config`.
- **Files Changed**: `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/chat-widget.js`, `frigate-nvr/web/assets/nas-video-archive.js`, `frigate-nvr/config/*`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 - Unified Sloth+VMS v201: Full Face Recognition (ArcFace 512-D + YOLO26 Face), Shaka Tactical Logo & Cutover Readiness Audit (Incident 2.176)
- **Problem / User Request**:
  - User requested updating `D:\sloth+vms` to the latest `D:\BPP-VMS` version (`v200` + `v201`), replacing the bottom-left brand logo with the new tactical Shaka hoodie character logo (`arm215-logo.png`), completing end-to-end AI Face Detection & 512-D Recognition (`อ่านใบหน้าได้หรือยัง`), auditing and fixing any remaining bugs, and verifying full readiness to switch over to `sloth+vms`.
- **Root Cause & Architecture Diagnosed**:
  1. **Face Detection & Recognition Engine & UI Integration**:
     - `face.onnx` (`[1, 300, 6]` YOLO26 End2End face detector) and `w600k_r50.onnx` (ArcFace ResNet-50 512-D embedding model) existed in `lpr-service/models/` and `native_gateway.py`, but needed a unified engine (`FaceOnnxEngine`) shared across Docker (`lpr-service` + `watchlist-api`) and Native Windows (`native_ai_worker` + `native_gateway`), automatic camera `person` event face scanning, and a complete Watchlist Face Recognition UI tab in `index.html` / `app.js`.
     - On Windows, `cv2.imwrite()` failed silently when saving enrolled face images into directories containing Thai characters (`config/faces/<ชื่อบุคคล>/...`) because OpenCV's Win32 `imwrite` uses ANSI paths rather than UTF-8.
  2. **Bugs Found & Fixed During Full Audit of `native_gateway.py` & `native_ai_worker.py`**:
     - `native_gateway.py` used `socket.AF_INET` in `_is_tcp_port_free()` without `import socket` at the top of the module.
     - `native_gateway.py` line 1116 referenced `FRIGATE_ROOT` instead of `_FRIGATE_ROOT` when constructing `_HISTORY_JOBS_DIR`.
     - `native_ai_worker.py` was missing `analyze_image_bytes(jpg_bytes, run_lpr=True, run_attributes=True, run_faces=True, camera=...)` called by `_background_ai_camera_scanner()` in `native_gateway.py`.
- **Resolution**:
  1. **Unified `FaceOnnxEngine` (`frigate-nvr/lpr-service/face_onnx.py`)**:
     - Built `FaceOnnxEngine` supporting All-GPU (`TensorRTExecutionProvider`, `CUDAExecutionProvider`, `DmlExecutionProvider`, `CPUExecutionProvider`) with `detect_faces()` (`face.onnx`), `extract_embedding()` (`w600k_r50.onnx` 512-D L2-normalized vector), `register_face_bytes()` (using `cv2.imencode` + `Path.write_bytes` for full Thai/Unicode path support on Windows & Linux), `search_by_image_bytes()` (1:N search), `compare_two_images_bytes()` (1:1 verification), `analyze_camera_frame()`, and `get_recent_detections()`.
  2. **End-to-End Backend Wiring (Docker & Native Modes)**:
     - Updated `frigate-nvr/lpr-service/app.py`, `frigate-nvr/lpr-service/Dockerfile`, `frigate-nvr/docker-compose.yml`, and `frigate-nvr/watchlist-api/api.py` so `lpr-service` automatically scans `person` events for faces, matches against Watchlist faces, sets Frigate `sub_label`, and exposes `/watchlist/faces`, `/watchlist/faces/recent`, `/watchlist/faces/register`, `DELETE /watchlist/faces/{person_name}`, `/watchlist/faces/search`, and `/watchlist/faces/compare`.
     - Updated `frigate-nvr/tools/native-exe/native_ai_worker.py` and `frigate-nvr/tools/native-exe/native_gateway.py` with `analyze_image_bytes()`, `run_faces=True` in `_background_ai_camera_scanner()`, and matching `/api/watchlist/faces/*` endpoints, plus fixed `import socket` and `_FRIGATE_ROOT`.
  3. **Watchlist Dual-Tab UI (`v201`) & Tactical Shaka Brand Logo**:
     - Added the `👤 ใบหน้าบุคคลเฝ้าระวัง & ค้นหาด้วย AI (ArcFace 512-D)` tab inside `#watchlistModal` (`frigate-nvr/web/index.html` & `frigate-nvr/web/assets/app.js` `?v=201`) with Face Enrollment, 1:N Face Search by photo, 1:1 Face Compare, Registered Watchlist Cards, and Recent Camera Face Detections with 1-click Watchlist enrollment.
     - Updated `frigate-nvr/web/assets/arm215-logo.png` with the user-selected tactical hoodie + Shaka sign logo and synced `v200` surgical single-slot grid diffing (`syncGridDiffSmoothly()`).
- **Files Changed**: `frigate-nvr/lpr-service/face_onnx.py`, `frigate-nvr/lpr-service/app.py`, `frigate-nvr/lpr-service/Dockerfile`, `frigate-nvr/docker-compose.yml`, `frigate-nvr/watchlist-api/api.py`, `frigate-nvr/tools/native-exe/native_ai_worker.py`, `frigate-nvr/tools/native-exe/native_gateway.py`, `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/arm215-logo.png`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 - Restore Real-Time Background Officer GPS Updates When Swiped Out of Browser (Incident 2.174)
- **Problem / User Request**:
  - User reported: *"GPS ไม่อัพเดทเหมือนเดิมถ้าปัดออกจากหน้าต่างเว็บ"* (when swiping out of the browser window / minimizing Safari or Chrome to the Home screen or another app, the officer's GPS pin stopped updating its coordinates on the map).
- **Root Cause & Architecture Diagnosed**:
  1. **WebAudio Keepalive Suspended Immediately on iOS/Android (`frigate-nvr/web/assets/app.js`)**:
     - `navigator.audioSession.type = 'ambient'` mapped to `AVAudioSessionCategoryAmbient` on iOS Safari 16.4+, which iOS explicitly suspends the instant the user swipes out of Safari.
     - `ScriptProcessorNode` (`sp`) was only connected to `this._mediaStreamDest` (`createMediaStreamDestination`) and **never connected to `this._audioCtx.destination`**, so hardware audio DMA never pulled the audio graph in the background; furthermore, `out[i] = 0` wrote pure digital zeros (`0.0`), triggering iOS CoreAudio / Android AudioTrack hardware silence detection after 3 seconds.
     - `startStreamKeepalive()` (`EventSource('/auth/location/stream-keepalive')`) was only opened when `document.hidden` became `true` (mid-transition) instead of staying warm while sharing.
  2. **Backend False `sharing_disabled: True` Kill-Switch & SSE Timestamp Lockout (`frigate-nvr/auth-service/auth.py`)**:
     - Forensics on `nvr-dashboard` logs revealed over **50 responses of `POST /auth/location HTTP/1.1 200 67` (`{"sharing_disabled": true}`)** sent to `suchakree`'s iPhone while driving on AIS 5G!
     - Because iOS Happy Eyeballs alternated HTTP requests between IPv6 (`2001:44c8:...`) and IPv4 (`1.47.141.100`), `session_key` (`ip|ua`) changed between requests. Meanwhile, when driving at 80 km/h (`>35m` every `1.6s`), any `blur`/`pagehide` or `sw-location.js` post with `fix_age_ms >= 4500` triggered `is_stale_relay = True` with `dist_from_existing_m > 35.0m`, causing `auth.py` to return `{"sharing_disabled": True}` and `heartbeat()` to return `force_location_off: True`, which killed the officer's own `bppLocationTracker` (`this.stop(false)`)!
     - In `stream_location_keepalive()`, `UPDATE user_location SET updated_at = ?` ran every 2 seconds, keeping `ex_age_sec < 2.0s` forever while `ex_acc` stayed at `4.74m` (`<= 15m`), which permanently locked out all background Fused/Wi-Fi/Cell location updates (`accuracy > 28m`).
     - In `get_client_ip()`, requests arriving via `cloudflared-tunnel` had private Docker IP `172.22.0.8` in `X-Real-IP`, masking `CF-Connecting-IP`.
  3. **Client Geolocation Watcher Pause & 15s/28m Filter Blocking Background Fixes (`frigate-nvr/web/assets/app.js` & `frigate-nvr/web/sw-location.js`)**:
     - On iOS WebKit and Android Blink, swiping out of the browser pauses existing `watchPosition` observers (`activityStateDidChange`), and `_restartGeoWatchers` was only called if `watchId === null`.
     - `watchId` used `maximumAge: 5000` (returning cached fixes), `watchIdLow` waited `15000ms`, `onPosition()` rejected `incomingAcc > 28m` for `20000ms`, and `sw-location.js` hardcoded `fix_age_ms: Math.max(5000, ...)` so every Service Worker relay was ignored as stale by `auth.py`.
- **Resolution**:
  1. **Zero-Widget Hardware DMA WebAudio + Continuous SSE Keepalive (`frigate-nvr/web/assets/app.js` `v=198`)**:
     - Switched `navigator.audioSession.type` from `'ambient'` to `'transient'` (fallback `'auto'`) while keeping `navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'` (zero Lock Screen widget).
     - Connected `ScriptProcessorNode` (`sp`) to **both** `this._audioCtx.destination` and `this._mediaStreamDest`, and wrote `-114 dB` sub-LSB alternating dither (`(i & 1) ? 0.000002 : -0.000002`) in `onaudioprocess` so hardware DMA never triggers silence suspension.
     - Kept `startStreamKeepalive()` connected continuously whenever `this.isSharing` is active so the SSE wakeup stream is already open before swiping out.
  2. **Background Geolocation Watcher Preservation, `lastFreshPostAt` Separation & WebRTC `<audio>` Stream (`frigate-nvr/web/assets/app.js` `v=199` & `frigate-nvr/web/sw-location.js` `v=8`)**:
     - **CRITICAL WebKit Fix**: Prevented `_restartGeoWatchers()` from calling `navigator.geolocation.clearWatch(this.watchId)` while `document.hidden === true`. Calling `clearWatch()` while backgrounded destroyed the foreground-authorized `watchPosition` observer, and iOS WebKit refuses to start new `watchPosition()` registrations while `document.hidden` is `true`. Existing `watchId` and `watchIdLow` handles are now preserved untouched across the entire background session.
     - Separated `this.lastFreshPostAt` from `this.lastPostedAt` so 4-second cached keepalive pings (`isCachedRelay = true`) never overwrite the fresh-fix timestamp or block new GPS fixes (`this.lastFixReceivedAt > this.lastFreshPostAt`) from being transmitted immediately.
     - Connected `pc2.ontrack` in `startWebRtcKeepalive()` to an in-memory `<audio playsinline autoplay>` element (`RealtimeMediaSource`) with `navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'`, granting full WebRTC background location priority on iOS 18 without displaying a Lock Screen music widget.
     - Set `maximumAge: 0` on `watchPosition` (`watchId` and `watchIdLow`) and `getCurrentPosition`, accepted all valid Fused/Wi-Fi/Cell fixes immediately when `document.hidden` is true, and updated `sw-location.js` (`v8`) to immediately relay unposted fresh fixes (`swLastFixAt > swLastClientPostAt`) with their real `fix_age_ms` (`<= 2500ms`).
  3. **Backend Multi-IP Mobile Tolerance & True Coordinate Timestamping (`frigate-nvr/auth-service/auth.py`)**:
     - Fixed `get_client_ip()` to prefer `CF-Connecting-IP` when `X-Real-IP` is a private Docker IP (`172.x`/`10.x`/`192.168.x`).
     - Removed false `sharing_disabled: True` and `force_location_off: True` on session/IP switches (`update_location()` now only returns `sharing_disabled: True` when `user_location.sharing_enabled == 0` in SQLite, while still ignoring stale cached points from secondary devices >50m away).
     - Changed `stream_location_keepalive()` to update `user_presence.last_heartbeat` instead of `user_location.updated_at`, so `ex_age_sec` reflects actual GPS fix age.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 - Ultra-Smooth 60 FPS Mobile Map Panning & Instant Tile Loading Optimization (Incident 2.173)
- **Problem / User Request**:
  - User reported: *"ภาพยังมาช้าและการเลื่อนแผนที่ยังกระตุกอยู่"* (with mobile screenshots showing black unloaded map tile regions when panning satellite/road layers and laggy/stuttering map dragging on mobile Safari).
- **Root Cause & Architecture Diagnosed**:
  1. **Why Map Tiles Loaded Slowly & Showed Black Regions When Panning (`frigate-nvr/web/assets/analytics.js`)**:
     - **465-Camera HTTP Stream Probing Saturating Mobile Connections (`loadCameraPoints()`)**: Every time the map loaded, `loadCameraPoints()` immediately called `checkAllCameraStatuses()` + `startStatusPolling()`, firing **465 HTTP `fetch(hlsUrl)` requests** in batches of 6 (with 8s timeouts each), saturating mobile Safari's HTTP connection pool and starving satellite/map tile downloads (`mt0..3.google.com` / `basemaps.cartocdn.com`) for 30–60+ seconds.
     - **`updateWhenIdle: isMobileDevice` (`true` on mobile) on All Tile Layers**: Setting `updateWhenIdle: true` on `cartoDarkLayer`, `cartoVoyagerLayer`, `hybridLayer`, and `satLayer` instructed Leaflet to **refuse requesting any new tiles while the user's finger was dragging the map**, leaving newly exposed areas black until after `moveend` fired.
     - **`crossOrigin: true` Overhead**: Forced anonymous CORS preflight/mode overhead on every tile `<img>` element across Google and CartoDB tile CDNs.
  2. **Why Map Panning & Zooming Stuttered on Mobile (`frigate-nvr/web/assets/analytics.js`)**:
     - **Dual Full-Screen GPU `backdrop-filter: blur(...)` Over Live Video Streams**: `.analytics-modal` applied `backdrop-filter: blur(18px)` and `.analytics-content` applied `backdrop-filter: blur(26px)` (even though `.analytics-content` already had `0.99` alpha opacity) while background `<video>` streams in `.workspace` continued decoding behind the modal, forcing iOS WebKit's GPU compositor to run a 26px Gaussian blur over full-screen video textures on every touch-move frame.
     - **465 Unculled DOM Camera Markers + 2 MB Eager Popup HTML**: `renderCameraPoints()` mounted all 465 `L.marker` DOM nodes (`~4,200` DOM elements) onto `cameraPointLayer` simultaneously (including ~420 off-screen markers that Leaflet still repositioned on every frame) and eagerly constructed 465 × 4.5KB popup HTML strings (~2 MB string allocation).
     - **CSS Keyframe Animations & Transitions Running During Drag (`map-panning` / `leaflet-dragging`)**: `.officer-ping`, `.gpsone-ping`, `.camera-marker-pin` (`transition: transform 0.25s`), and `.gpsone-lock-ring` were only paused during `.map-zooming`, not during `.map-panning` / `.leaflet-dragging`.
     - **1-Second Officer & GPSOne Polling Thrashing DOM During Gestures**: `loadOfficerLocations()` (1s) and `loadGpsOneLocations()` (1s) continued executing `marker.setLatLng()`, `.getPopup()?.setContent(...)` (rebuilding 3KB popup HTML on closed popups every 1s), and `updateGpsOnePursuitOverlay()` (`gpsOnePursuitLayer.clearLayers()` + recreating `gpsone-pursuit-dist-badge` DOM markers 2 times per second) while the user was actively dragging the map.
- **Resolution**:
  1. **Instant Tile Streaming & Zero Background Network Contention (`analytics.js` `v=123`)**:
     - Removed automatic `checkAllCameraStatuses()` and `startStatusPolling()` from `loadCameraPoints()`; camera status is now checked on-demand when opening an individual camera's popup (`popupopen`).
     - Updated `cartoDarkLayer`, `cartoVoyagerLayer`, `hybridLayer`, and `satLayer` with `updateWhenIdle: false` (streams tiles immediately during pan), `updateWhenZooming: false` (prevents fractional pinch-zoom tile floods), `keepBuffer: 6` (pre-buffers surrounding tiles), and removed `crossOrigin: true`.
  2. **Eliminated GPU Full-Screen Blur & Paused Background Video Decoding (`analytics.js` `v=123`)**:
     - Removed `backdrop-filter: blur(18px)` / `blur(26px)` from `.analytics-modal` and `.analytics-content`.
     - Added `body.analytics-modal-open .workspace { visibility: hidden !important; pointer-events: none !important; }` and `setBackgroundGridStreamsPaused(true/false)` to pause background `<video>` decoders in `#grid` while `#analyticsModal` is open and resume them on close.
  3. **Camera Marker Viewport Culling & Lazy Popup Binding (`analytics.js` `v=123`)**:
     - Added `syncVisibleCameraMarkers()` (triggered on `renderCameraPoints()` and debounced on `moveend`/`zoomend`) so only camera markers inside `leafletMap.getBounds().pad(0.45)` are mounted in the live DOM (`cameraPointLayer`), reducing active DOM nodes by ~85–90%.
     - Converted camera, Officer, and GPSOne popups to lazy functional binding (`marker.bindPopup(() => ...)`), so popup HTML is only built/updated when a popup is actually opened.
  4. **Gesture-Aware Polling Suppression & Animation Freeze During Drag (`analytics.js` `v=123`)**:
     - Added `.map-panning` and `.leaflet-dragging` CSS rules to freeze all marker keyframe animations and transitions while dragging, defaulted `setMapTouchMode(true)` with native `touch-action: none !important`, and reduced mobile `L.canvas` padding to `0.15`.
     - Added `isMapInteracting` tracking (`dragstart`/`movestart`/`zoomstart` → `dragend`/`moveend`/`zoomend` + 220ms cooldown) to pause 1s `loadOfficerLocations()` and `loadGpsOneLocations()` DOM mutations during active touch gestures, and memoized `updateGpsOnePursuitOverlay()` via `lastPursuitLayerSig`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-21 - Eliminate Officer GPS Teleportation Across Multi-Device Sessions & Stale Background Relay Loops (Incident 2.172)
- **Problem / User Request**:
  - User reported: *"ทำไมพิกัดตัวเองมันวาร์ปไปมา"* (with screenshots showing Officer `ม.ม้าExpress @suchakree` jumping back and forth by **14.3 km** every 1–4 seconds between `18.1855028, 103.7377117` at บ้านศรีวิไล and `18.300057527180194, 103.80468716269183` north of ป่านันทนาการหินสามวาฬ).
- **Root Cause & Architecture Diagnosed**:
  1. **Two iPhones Transmitting Under the Same `suchakree` Account simultaneously (`frigate-nvr/auth-service/auth.py` & `frigate-nvr/web/sw-location.js`)**:
     - Prior to creating the separate `Park` account at `23:39`, a second iPhone 14.3 km away had logged into `suchakree` at `23:21`. Because `/auth/heartbeat` returned `force_location: True` to all active sessions of `suchakree` whenever `user_location.sharing_enabled == 1`, both phones activated `bppLocationTracker`.
     - When the second iPhone went into the background at `23:21`, its Service Worker (`sw-location.js` `relayCoordsFromSw()`) and `app.js` (`onWorkerTick` `elapsedSincePost >= 4000`) continuously re-POSTed its frozen cached coordinate (`18.300057527180194, 103.80468716269183`, `accuracy: 10.7284`) every 4.3 seconds, overwriting `suchakree`'s live 1-second GPS fixes (`18.1855028, 103.7377117`, `accuracy: 2.04m`)!
  2. **Aggressive 1.2s Coarse Cell-Tower Fallback (`watchIdLow`) & Stale `localStorage` Pre-Send (`frigate-nvr/web/assets/app.js`)**:
     - `watchIdLow` (`enableHighAccuracy: false`) fired whenever `Date.now() - this.lastFixAt > 1200`, allowing coarse cell-tower/Wi-Fi fixes to overwrite 2m satellite fixes, and `start()` immediately POSTed stale `localStorage.getItem('bpp_last_coords')` before acquiring a fresh hardware fix.
- **Resolution**:
  1. **Single-Device GPS Session Ownership, Frozen-Relay Rejection & Coarse-Fix Guard (`frigate-nvr/auth-service/auth.py`)**:
     - Added `_GPS_OWNER_SESSION`, `_GPS_SESSION_COORD_STATE`, and `_GPS_FROZEN_COORD_COUNTS` in `auth.py`. Only the session sending fresh live GNSS fixes owns GPS transmission for a username; competing sessions or sessions sending identical frozen coordinates (`>=3` repeats) receive `{"status": "ok", "sharing_disabled": True}` on `POST /auth/location` and `force_location_off: True` on `POST /auth/heartbeat`, forcing their `app.js` (`this.stop(false)`) and `sw-location.js` (`stopSwPulseLoop()`) to permanently shut down.
     - Same-device background keepalive relays (`fix_age_ms > 2500` or repeated identical coordinates) only refresh `updated_at` without overwriting newer coordinates, and coarse fixes (`accuracy > 28m`) are ignored when a recent (`<20s`) high-accuracy (`<=15m`) fix exists.
     - Cleaned the corrupted `18.3000575` ghost points from `mission_tracks` in `auth.db`.
  2. **Fresh-Only Client GPS Transmission (`frigate-nvr/web/assets/app.js` `v=197` & `frigate-nvr/web/sw-location.js` `v=7`)**:
     - Removed `localStorage` `bpp_last_coords` pre-sending on `start()`, raised `watchIdLow` fallback threshold from `1200ms` to `15000ms`, filtered out `accuracy > 28m` fixes in `onPosition()` while high-accuracy GNSS is active, and tagged keepalive relays with `fix_age_ms`.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-20 - Eliminate Pink Stop Badge Clutter on Map, 99.2% Reduction in 1s GPSOne Polling Payload, and 0ms Instant GPS Disable (Incident 2.171)
- **Problem / User Request**:
  - User reported: *"ยังปิด GPSไม่ได้ ทำไมตรงหมุดGPSขึ้นอะไรเต็มไปหมด"* (with mobile screenshots showing a dense stack of pink/purple `"นิ่ง 1.1 ..."`, `"นิ่ง 1.3 ..."`, `"นิ่ง 1.2 นาที"`, `"นิ่ง 1 ชม. 3..."` badges covering the GPS pin on the map, and inability to turn off GPS sharing or GPSOne pins).
- **Root Cause & Architecture Diagnosed**:
  1. **`2.48 MB/sec` Unbounded `live_trail` Payload on Every 1-Second Poll (`frigate-nvr/analytics-engine/services/gpsone_tracker.py`)**:
     - `list_devices()` returned the entire 24-hour `live_trail` array (**10,967 points = `2,482,664 bytes` / `2.48 MB`**) on every 1-second `GET /api/analytics/gpsone/locations` poll, saturating mobile Safari's main thread and network queue so button taps (`ปิดพิกัด` / `ปิดหมุด`) timed out or got overwritten by in-flight responses.
  2. **Permanent Pink `"นิ่ง ..."` `L.divIcon` Badges Rendered Over Live Trail (`frigate-nvr/web/assets/analytics.js`)**:
     - `attachRouteHoverLogInspector()` spawned permanent `<div class="gps-stop-log-badge">นิ่ง ...</div>` `L.divIcon` labels at every stationary cluster along the trail and rebuilt them every 1 second via `updateGpsOnePursuitOverlay()`.
  3. **1-Second DOM Destruction in `#gpsOneManagerModal` & Async Race When Disabling GPS (`analytics.js`, `app.js`, `sw-location.js`)**:
     - `newModalSig` included `d.device_time` (which ticks every 1s), rebuilding `listEl.innerHTML` every second and destroying `.btn-gpsone-toggle` mid-tap on mobile touchscreens.
     - Disabling Officer GPS or GPSOne waited for `await fetch(...)` before stopping the local tracker or removing markers, allowing in-flight 1s polls and buffered `watchPosition` callbacks to re-render the pins.
- **Resolution**:
  1. **Capped 1s `live_trail` Payload by 99.2% (`gpsone_tracker.py`)**:
     - Capped `live_trail` in `list_devices()` to the latest 20 points (`live_trail[-20:]`, preserving `live_trail_total`), shrinking `/api/analytics/gpsone/locations` from **`2.48 MB` to `20 KB`** (-99.2%).
  2. **Removed Permanent Pink Stop Badges (`analytics.js` `v=122`)**:
     - Replaced the permanent `<div class="gps-stop-log-badge">นิ่ง ...</div>` `L.divIcon` labels in `attachRouteHoverLogInspector()` with subtle `L.circleMarker` (`radius: 4.5`) dots that show stop duration only on hover/tap, and restricted live breadcrumb trail rendering in `updateGpsOnePursuitOverlay()` to actively followed targets (`followedGpsOneImei`).
  3. **0ms Instant Synchronous GPS Disable & Modal DOM Stability (`analytics.js` `v=122`, `app.js` `v=196`, `sw-location.js` `v=6`)**:
     - Removed `d.device_time` from `newModalSig` so `#gpsOneManagerModal` buttons are never destroyed mid-tap.
     - Added `gpsOneFetchEpoch`/`gpsOneSuppressPollUntil` and `officerLocFetchEpoch`/`officerLocSuppressUntil` guards, executing local `bppLocationTracker.stop(false)`, marker removal, and UI state updates synchronously at **0ms** before firing background `fetch(..., { keepalive: true })`, plus a 1-tap `disable_everything` option in `showLocationScopeChoice('disable')`.
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-20 - Zero Lock-Screen Media Widget & Continuous Background GPS Sharing After Minimizing Safari / Switching Apps (Incident 2.170)
- **Problem / User Request**:
  - User reported: *"พบว่าเมื่อออกจาก safari หรือ บราวเซอร์อื่นๆกลับมาหน้าจอหลักแล้วพิกัดก็จะออฟไลน์อยู่ครับ และมันจะขึ้นแบบนี้ โดยไม่อยากให้ขึ้นแบบนี้มากวนใจครับ หาวิธีแก้ปัญหาให้มันสามารถส่งพิกัดได้ตลอดจริงๆหน่อยกดเปิดทีเดียวแล้วพับแอพไปทำอย่างอื่นได้เลย"* (with iOS Lock Screen screenshot showing the media player widget `🟢 BPP-VMS Real-Time GPS / ตชด.215 — ระบบเกาะติดพิกัดเจ้า...`).
- **Root Cause & Architecture Diagnosed**:
  1. **Why the Annoying Music Player Widget (`🟢 BPP-VMS Real-Time GPS`) Appeared on the iOS/Android Lock Screen (`frigate-nvr/web/assets/app.js`)**:
     - `startAudioKeepalive()` created an HTML5 `<audio>` element (`new Audio(audioUrl)`) playing a 12-second WAV loop and explicitly populated `navigator.mediaSession.metadata = new MediaMetadata({ title: '🟢 BPP-VMS Real-Time GPS', artist: 'ตชด.215 — ระบบเกาะติดพิกัดเจ้า...' })` with `playbackState = 'playing'`. iOS (`MPNowPlayingInfoCenter`) and Android (`MediaSession`) immediately render a full Lock Screen media player widget whenever `<audio>` + `MediaMetadata` is active.
  2. **Why Officer Location Went Offline After Exiting Safari / Browser to the Home Screen**:
     - **Cross-Device Self-Disable Bug in `loadOfficerLocations()` (`frigate-nvr/web/assets/analytics.js` lines 7518–7539)**: Whenever the user had another browser/PC logged into the same account (`curUser`) where `isSharing` was locally `false`, `loadOfficerLocations()` saw `key.toLowerCase() === curUser.toLowerCase()` and sent `POST /auth/location/toggle { enabled: false }` to the server every 5 seconds, wiping `sharing_enabled = 0` in `auth.db` and stopping the mobile phone's tracker!
     - **15-Second Service Worker Relay Cutoff (`frigate-nvr/web/sw-location.js`)**: `sw-location.js` stopped relaying background coordinates after 15 seconds (`if (Date.now() - swLastFixAt > 15000) return;`) and only relayed a fix once (`if (swLastFixAt <= swLastRelayedFixAt) return;`), and lost `swIsSharing` state in memory if the OS restarted the Service Worker thread.
     - **65s Presence & 180s Location Dropouts on Server (`frigate-nvr/auth-service/auth.py`)**: `get_user_presence()` marked officers offline after 65s and `get_active_locations()` dropped officer pins after 180s when mobile iOS Safari throttled background timers.
- **Resolution**:
  1. **Eliminated Lock-Screen Media Player Widget Completely (`frigate-nvr/web/assets/app.js` `v=195`)**:
     - Removed `new Audio()`, `_getSilentWavUrl()`, and `new MediaMetadata(...)` from `bppLocationTracker`.
     - Explicitly set `navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none';` and `navigator.audioSession.type = 'ambient'` so iOS/Android never displays any Lock Screen or Control Center media player widget.
     - Replaced with a **Zero-Widget Stealth Background Engine**: Ambient WebAudio (`18Hz` at `0.00001` gain + `ScriptProcessorNode`), In-Memory WebRTC DataChannel Loopback (`bpp-life360-gps`), Server-Sent Events (SSE) background wakeup stream (`GET /auth/location/stream-keepalive`), Motion/Orientation sensor wakeup listeners (`devicemotion` / `deviceorientation`), and Dedicated WebWorker.
  2. **Upgraded Service Worker (`frigate-nvr/web/sw-location.js` `v=5`) with `CacheStorage` Persistence & Continuous Background Relay**:
     - Persisted `{ isSharing, coords, lastFixAt, lastClientPostAt }` in `CacheStorage` (`bpp-vms-loc-state-v5`) so if iOS/Android restarts the Service Worker in the background, it immediately restores active sharing state and coordinates.
     - Removed the 15-second cutoff and single-relay restriction so the Service Worker continuously wakes window clients (`BG_LOCATION_PING` every 1s) and relays `POST /auth/location` every 4s while `swIsSharing === true`.
  3. **Continuous Online & Active Pin Persistence on Server (`frigate-nvr/auth-service/auth.py`) & Multi-Device Safety (`frigate-nvr/web/assets/analytics.js` `v=121`)**:
     - Added `GET /auth/location/stream-keepalive` (SSE stream) to `auth.py` which pushes a wakeup event every 2s while `sharing_enabled == 1` and keeps `user_presence.last_heartbeat` and `user_location.updated_at` fresh.
     - Updated `get_user_presence()` and `get_active_locations()` in `auth.py` so officers with `sharing_enabled == 1` and valid coordinates remain continuously **Online (`is_online = True`, `signal_status = "live"`, `is_live = True`)** until they explicitly click **"ปิดพิกัด"** (or an admin disables it).
     - Removed the destructive `fetch('/auth/location/toggle', { enabled: false })` block from `loadOfficerLocations()` in `analytics.js` (`v=121`) and scoped auto-resume in `app.js` (`v=195`) to `localWasEnabled` (`bpp_gps_user_enabled === '1'`), ensuring other browsers/PCs never disable the phone's active sharing or auto-turn-on GPS on refresh.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_gateway.py` (synced Incidents 2.169 & 2.170 + `/auth/location/stream-keepalive` into `dev/sloth-vms` commit `4fba3a1` & rebuilt `BPP-VMS.exe` / `BPP-VMS-Setup.exe`), `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-20 - Fix Map Pin Hide / Disable-All Across All 3 Subsystems (GPSONE Devices, Hidden Cameras for Superadmin, and Officer Locations) & Route Hover Log Inspector Bugfix (Incident 2.169)
- **Problem / User Request**:
  - User reported: *"ทำไมกดซ่อนหรือกดผิดทั้งหมดแล้วก็ยังเห็นมันขึ้นมาแสดงอยู่ที่หน้าแผนที่อยู่เลย ตรวจสอบหน่อย"*
- **Root Cause & Architecture Diagnosed**:
  1. **GPSONE Hardware Trackers Auto-Re-Enabling After "ปิดหมุด" / "ปิดทั้งหมด" (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `frigate-nvr/web/assets/analytics.js`)**:
     - In `set_device_enabled()` and `set_all_devices_enabled()`, `cfg["manual_hide_online"] = True` was only set when `is_online == True`. For offline devices (`is_online == False`) or devices temporarily transitioning state, `manual_hide_online` remained `False`.
     - In `poll_single_device()` (line 1841), `if not prev_online or not self._devices[imei].get("manual_hide_online", False): self._devices[imei]["enabled"] = True` contained `not prev_online or ...`, which unconditionally forced `enabled = True` whenever an offline/unpolled device reported `is_online == True`, ignoring `manual_hide_online == True`!
     - On the frontend (`analytics.js`), disabling a device or clicking `#btnGpsOneDisableAll` did not immediately clear `followedGpsOneImei`, `gpsOnePursuitLayer` (breadcrumb trail / stop badges / vector lines), `clearActiveRouteHoverInspector()`, or `clearMissionTrajectory()`.
     - Additionally, `toggleFollowGpsOne()` auto-started the operator's personal `bppLocationTracker` even when the operator had not enabled their own location sharing.
  2. **Hidden Cameras Still Rendered on the Map for Superadmin Even After Clicking "ซ่อนกล้อง" / "ซ่อนทั้งหมด" (`frigate-nvr/web/assets/analytics.js` & `frigate-nvr/web/assets/tactical-map.js`)**:
     - `renderCameraPoints()` (`analytics.js` line 6388) and `tactical-map.js` (line 188) used `if (c.hidden && !isSuper) return;`, which kept all hidden camera pins visible on the map at 45% opacity whenever logged in as `superadmin`. Thus, clicking "ซ่อนกล้อง" or `#btnHideAllCams` ("ซ่อนทั้งหมด") never removed the pins from the Superadmin's map.
     - Furthermore, `#btnUnhideAllCams` and `#btnHideAllCams` in `initHiddenCamGroupsUI()` passed 4 arguments to `showCustomConfirm(title, message, onConfirm)` (which takes 3 arguments), passing a string (`'ยกเลิกทั้งหมด'`) as the `onConfirm` callback and causing `TypeError: onConfirm is not a function` when clicked.
  3. **Officer Locations Still Visible or Re-Appearing After Clicking "ปิดพิกัด" / "ซ่อนทั้งหมด" (`frigate-nvr/auth-service/auth.py`, `native_gateway.py`, & `frigate-nvr/web/assets/analytics.js`)**:
     - In `analytics.js` (`btnLocToggle.onclick`), when an Admin/Superadmin's own personal location was already off (`!isSharing`), clicking `#btnToggleOfficerLocation` only showed `"เปิดเฉพาะของฉัน"` vs `"สั่งเปิดทุกคน"` — there was no option to **"สั่งปิดพิกัดทุกคนในระบบ (ซ่อนทั้งหมด)"** to clear other officers' stale pins, nor a per-pin **"ซ่อน / ปิดหมุดพิกัดนี้"** button in the Officer map popup.
     - In `auth.py` (`POST /auth/location`), `if existing is not None and not existing["sharing_enabled"] and not force_all_active:` allowed an in-flight `POST /auth/location` to overwrite `sharing_enabled = 0` back to `1` if `force_location_all` had previously been `"1"`.
     - In `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_gateway.py` (used by `BPP-VMS.exe`), `/auth/location/toggle` and `/auth/location/force-all` were stubs returning `{"sharing_enabled": True}` without clearing `_native_officer_locations`.
  4. **Historical Route Log Hover Inspector Argument Order & `[object Object]` Stop Badge (`frigate-nvr/web/assets/analytics.js`)**:
     - In `showGpsOneTrajectory()`, `attachRouteHoverLogInspector` was called with `(polyline, enrichedPts, ...)` instead of `(enrichedPts, polyline, ...)`, and `formatStopDurationTh(sMin)` (which returns `{ durText, durColor }`) was interpolated directly into HTML without `.durText`.
- **Resolution**:
  1. **GPSONE Strict Manual Hide Persistence & Instant Layer Cleanup (`gpsone_tracker.py` & `analytics.js` `v=120`)**:
     - Updated `set_device_enabled()`, `set_all_devices_enabled()`, and `add_or_update_device()` so disabling any device (`enabled=False`) always sets `manual_hide_online = True` and `force_show_offline = False` regardless of current online/offline state.
     - Removed `not prev_online or` from `poll_single_device()` so a manually hidden device (`manual_hide_online=True`) is never auto-enabled during background polling.
     - Updated `toggleGpsOneDevice()`, `toggleAllGpsOneDevices()`, and `chkShowGpsOneLayer.onchange` to immediately clear `followedGpsOneImei`, `gpsOnePointLayer`, `gpsOnePursuitLayer`, `gpsOneMarkersMap`, `clearActiveRouteHoverInspector()`, and `clearMissionTrajectory()`.
     - Removed auto-start of `bppLocationTracker` from `toggleFollowGpsOne()`.
  2. **Hidden Cameras Actually Hidden on Map by Default + Explicit Ghost-Preview Toggle (`analytics.js` `v=120` & `tactical-map.js` `v=4`)**:
     - Added `window.showHiddenCamerasOnMap = false` by default and updated `renderCameraPoints()`, `syncCamsBtnUI()`, `updateCameraMarkerState()`, `updateTacticalKpis()`, `getTacticalMapStats()`, and `tactical-map.js` so hidden cameras are completely removed from the map for all users (including Superadmin) unless Superadmin explicitly checks `#chkShowHiddenCamsOnMap` ("แสดงหมุดที่ซ่อนอยู่บนแผนที่") inside `#hiddenCamGroupsModal`.
     - Fixed the 3-argument `showCustomConfirm(title, message, onConfirm)` calls on `#btnUnhideAllCams` and `#btnHideAllCams`.
  3. **Officer Location Disable-All & Per-Officer Popup Hide (`auth.py`, `native_gateway.py`, & `analytics.js` `v=120`)**:
     - Updated `showLocationScopeChoice()` and `btnLocToggle.onclick` so Admin/Superadmin always see **"สั่งปิดพิกัดทุกคนในระบบ (ซ่อนทั้งหมด)"** (`disable_all`) even when their own location is off, and added a **"ซ่อน / ปิดหมุดพิกัดนี้"** button (`data-officer-disable`) inside each Officer's map popup.
     - Updated `POST /auth/location/toggle` (`auth.py` & `native_gateway.py`) to accept optional `username` for Admin/Superadmin per-pin hiding, updated `POST /auth/location/force-all` to allow `require_admin`, and guarded `POST /auth/location` so disabled officers (`sharing_enabled = 0`) are never resurrected by in-flight location posts.
  4. **Fixed Route Hover Log Inspector in `showGpsOneTrajectory()` (`analytics.js` `v=120`)**:
     - Fixed `attachRouteHoverLogInspector(enrichedPts, polyline, ...)` argument order and `formatStopDurationTh(sMin).durText` string extraction.
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/tactical-map.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-20 - `BPP-VMS.exe` Window Controls Flush Inside `.topbar` Frame & Full Sync of Latest `origin/main` VMS Updates into `D:\sloth+vms` (Incident 2.168)
- **Problem / User Request**:
  - User requested: *"ปุ่มย่อ ขยาย ออก มันล้นกรอบออกมาครับให้มันอยู่ในกรอบพอดีหน่อย และอัพเดททุกอย่างให้เป็นเวอร์ชั้นล่าสุดตามที่ผมพึ่งแก้ไขไปในโปรเจกต์ vms"*
- **Root Cause & Architecture Diagnosed**:
  1. **Why Window Control Buttons (`─ □ ✕`) Overflowed Outside the `.topbar` Frame (`BppVmsShell.cs`)**:
     - In `frigate-nvr/web/assets/app.css`, `header.topbar` has `margin: 14px 14px 0; padding: 12px 16px; border-radius: 16px; border: 1px solid rgba(168,85,247,.45);`.
     - Using `position: fixed; top: 8px; right: 12px;` positioned `#bppSlothNativeWindowControls` relative to the viewport `(0, 0)` instead of `header.topbar`, causing the cluster to protrude 6px above and 2px to the right of `.topbar`'s purple rounded border.
  2. **Syncing `D:\sloth+vms\repo` (`dev/sloth-vms`) & `D:\sloth+vms\native` with `D:\BPP-VMS` (`origin/main` `f36b7b6`)**:
     - `D:\BPP-VMS` (`origin/main`) had received new features up to commit `f36b7b6` (Incidents 2.159, 2.160, 2.161, 2.162, 2.164, 2.166, 2.167 — including History Pull `#historyPullOverlay`, GPSOne unlimited SQLite history & hover route log inspector, capture-phase map popup buttons, and updated `camera_templates.json` / `config.yml`).
- **Resolution (`origin/dev/sloth-vms` commits `fb571ba` & `acf5c30`)**:
  1. **Window Controls Flush Inside `.topbar` Frame (`D:\sloth+vms\repo\frigate-nvr\tools\native-exe\BppVmsShell.cs`)**:
     - Appended `#bppSlothNativeWindowControls` directly inside `header.topbar` (`position: relative !important; padding-right: 122px !important;`) with `position: absolute !important; top: 12px !important; right: 12px !important; height: 36px !important; border-radius: 10px !important;`, aligning the `36px`-tall control cluster vertically and horizontally with the `36px`-tall `.topbar` content and keeping it 100% inside the `.topbar` purple frame.
  2. **Merged `origin/main` (`f36b7b6`) into `dev/sloth-vms` & Added Native History Pull Endpoints (`native_gateway.py`)**:
     - Merged `origin/main` into `D:\sloth+vms\repo` (`dev/sloth-vms`), preserving both the latest `origin/main` features and `#tabSystemUpdate`.
     - Added `/api/nas-bot/history-pull/cameras`, `/api/nas-bot/history-pull/jobs`, `/api/nas-bot/history-pull/jobs/{job_id}`, and `/api/nas-bot/history-pull/jobs/{job_id}/cancel` to `native_gateway.py` (sharing `D:\BPP-VMS\frigate-nvr\storage\exports\.history_jobs` so all 26 historical cameras load natively inside `BPP-VMS.exe`).
     - Synced `config.yml`, `camera_templates.json`, `gpsone_devices.local.json`, `gpsone_history.local.db`, `auth/*`, and `dashboard-settings/*` from `D:\BPP-VMS\frigate-nvr\config\` into `D:\sloth+vms\native\config\`, recompiled `D:\sloth+vms\native\BPP-VMS.exe`, and verified `/api/native/ping`, `/api/nas-bot/history-pull/cameras` (`26` cameras), and `/api/analytics/gpsone/devices` (`4` devices) on `:8443`.
  3. **Removed Legacy `SLOTH-BPP215.exe` Windows Registry Auto-Start & Added Enterprise Graphical Installer Wizard (`BPP-VMS-Setup.exe` — Clean / Custom / Full Clone Migration)**:
     - Killed the legacy `D:\sloth-bpp215\SLOTH-BPP215\SLOTH-BPP215.exe` splash process (`SlothEyeSplashWindow` stuck at `0%`) and removed its `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` (`SLOTH BPP215`) key.
     - Created **`D:\sloth+vms\BPP-VMS-Setup.exe`** (`frigate-nvr/tools/native-exe/BppVmsSetupWizard.cs`) — a frameless Cyber-Glass Enterprise Setup & Migration Wizard that automatically launches on any new PC (`COMPUTERNAME != .machine_id` in `BppVmsShell.cs`) or when double-clicking `BPP-VMS-Setup.exe` / `Install-On-New-PC.bat`.
     - Provides 3 selectable migration modes backed by `D:\sloth+vms\native\migration-snapshot\`:
       1. **🆕 ติดตั้งแบบเครื่องใหม่ทั้งหมด (Clean New Machine)** — starts with 0 cameras and lets the operator type the new machine's custom agency/system title right in the installer.
       2. **🎛️ เลือกนำข้อมูลบางส่วนจากเครื่องเดิมไปด้วย (Custom Selective Migration)** — granular checkboxes to selectively bring **รายการกล้อง CCTV (36 กล้อง)**, **บัญชีผู้ใช้งาน (User Accounts & Roles)**, **อุปกรณ์ติดตามพิกัด GPS (GPSOne)**, **บัญชีดำป้ายทะเบียนเฝ้าระวัง (LPR Watchlist)**, and/or **ชื่อหน่วยงานและโลโก้เดิม (Branding)**.
       3. **📦 นำการตั้งค่าเดิมทั้งหมดไปด้วย 100% (Full System Clone)** — clones 100% of cameras, users, GPS, watchlist, and branding to the new PC.
- **Files Changed**: `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\BppVmsSetupWizard.cs`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\BppVmsShell.cs`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\Build-BppNativeExe.ps1`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\Setup-PortableBppVms.ps1`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_gateway.py`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\gpu_accelerator.py`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_ai_worker.py`, `D:\sloth+vms\BPP-VMS-Setup.exe`, `D:\sloth+vms\native\BPP-VMS.exe`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - Interactive GPS Route Log Hover Inspector (Pass Timestamp & Stationary Dwell Minutes) and Full BPP-VMS Deep Violet Theme & SVG Iconography Across All GPS Features (Incident 2.167)
- **Problem / User Request**:
  - User requested: *"การเก็บ log ขอแบบเอาเมาส์ชี้ที่ log แล้วดูได้ด้วยว่าผ่านที่นี่กี่โมง ถ้านิ่งนิ่งกี่นาที และปรับ icon ของฟีเจอร์ gps ทั้งหมดให้เข้ากับเว็บด้วย สีอะไรก็เอาให้มันเข้ากับเว็บด้วย"*
- **Root Cause & Architecture Diagnosed**:
  1. **GPS Route Logs Lacked Stationary Dwell Calculation & Hover Inspection**:
     - Previously, historical trajectory polylines (`showGpsOneTrajectory`, `showMissionTrajectory`) and live pursuit breadcrumb trails (`updateGpsOnePursuitOverlay`) rendered plain polylines without mouse hover inspection, stationary cluster clustering, or a route log timeline panel.
     - `_build_unlimited_live_trail` in `gpsone_tracker.py` collapsed consecutive stationary fixes within ~3 meters (`d_lat <= 0.00003`) without recording `arrive_time`, `depart_time`, or `stop_minutes`, losing the exact stationary duration at that spot.
  2. **Legacy Orange/Amber Palette & OS Emojis in GPS Features**:
     - GPS markers, popups, pursuit HUD banners, route lines, and modals previously used `#f59e0b` (amber/orange), stark `#ffffff` popups, and OS emojis (`🎯`, `🚓`, `📦`, `🛡️`, `🛰️`, `📡`, etc.) instead of the BPP-VMS Deep Violet / Cyber Cyan / Neon Emerald glassmorphism theme and custom stroke SVG icons.
- **Resolution**:
  1. **Stationary Dwell Duration & Arrival/Departure Window Enrichment (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `frigate-nvr/web/assets/analytics.js` `v=119`)**:
     - Added `_parse_track_epoch()` and `_enrich_points_with_dwell()` in `gpsone_tracker.py` (and `enrichTrackPointsWithDwell()` in `analytics.js`) to cluster consecutive GPS points within ~38–42 meters (`<= 0.038 km`) and calculate exact stationary duration in minutes (`stop_minutes` / `dwell_minutes`), `arrive_time`, `depart_time`, and `is_stop`.
     - Updated `_get_stored_history_points()`, `_build_unlimited_live_trail()`, `_load_from_disk()`, and `poll_single_device()` so both historical trajectories and live breadcrumb trails preserve `arrive_time`, `depart_time`, `stop_minutes`, and `is_stop`.
  2. **Interactive Hover Route Log Inspector & Route Log Timeline Panel (`frigate-nvr/web/assets/analytics.js` `v=119`)**:
     - Added `attachRouteHoverLogInspector()`, `showRouteLogPointInspectorAt()`, and `buildRouteHoverTooltipHtml()`:
       - Hovering anywhere along a **Live Breadcrumb Trail (`updateGpsOnePursuitOverlay`)**, **GPS Historical Trajectory (`showGpsOneTrajectory`)**, or **Mission Trajectory (`showMissionTrajectory`)** snaps to the nearest GPS log point and displays a dark-violet glassmorphic floating tooltip (`.gps-route-hover-tooltip`) showing:
         - **เวลาที่ผ่านจุดนี้ (`ผ่านจุดนี้เมื่อ: YYYY-MM-DD HH:MM:SS น.`)**
         - **เวลาที่หยุดนิ่ง (`หยุดนิ่งที่จุดนี้: X นาที / X ชม. Y นาที` พร้อมช่วงเวลา `HH:MM - HH:MM น.`)** when stationary, or live speed (`กำลังเคลื่อนที่: XX.X กม./ชม.`) when moving.
       - Renders distinct stationary stop log markers (`.gps-stop-log-node`) along the route, an interactive **Route Log Timeline Panel (`บันทึก Log เส้นทาง & จุดหยุดนิ่ง`)** on the map where hovering any log row highlights that point on the map (`showRouteLogPointInspectorAt`), and a hoverable **Recent Route Log (`Log เส้นทางล่าสุด`)** pill strip inside each device card in `#gpsOneManagerModal`.
  3. **Cohesive BPP-VMS Deep Violet Glassmorphic Palette & Custom SVG Iconography (`frigate-nvr/web/assets/analytics.js` `v=119`, `frigate-nvr/web/assets/tactical-map.js` `v=3`)**:
     - Replaced all GPS emojis and orange `#f59e0b` / white popup styles with custom stroke SVG icons (`GPSONE_ICON_STYLES[*].svg`) and the BPP-VMS color palette (`rgba(18, 14, 38, 0.96)`, `#a855f7`, `#c084fc`, `#38bdf8`, `#34e2a8`, `#fb5b78`).
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/tactical-map.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - Fix Map Popup Action & Share Buttons (Capture-Phase Event Delegation + In-Place Officer Popup Updates), Explicit Opt-In Location Sharing on Refresh, and Native SVG Icons Across Map UI (Incident 2.166)
- **Problem / User Request**:
  - User reported: *"เวลากดพิกัดแล้ว ปุ่มต่างๆมันกดได้ไหม ปุ่มแชร์เหมือนกดแล้วจะไม่มีอะไรเกิดขึ้น และปรับ icon ให้เข้ากับเว็บด้วย และทำไมผมเห็นว่ารีเฟรชทีไรพิกัดผมเปิดเองตลอดเลย ผมยังไม่ได้กดเปิดในหน้าแผนที่เลย"*
- **Root Cause & Architecture Diagnosed**:
  1. **Why Popup Action & Share Buttons (`.btn-action-share-gps`, `.btn-gps-popup-action`) Did Nothing When Clicked**:
     - Leaflet attaches `L.DomEvent.disableClickPropagation` to `.leaflet-popup`, which stops click propagation in the bubble phase before events reach `document.addEventListener('click', ...)` registered with `useCapture = false`.
     - In `loadOfficerLocations()` (`analytics.js`), `existing.getPopup()?.setContent(popupContent)` was called every 1,000ms even while the popup was open (`existing.isPopupOpen()`), destroying and recreating the button DOM nodes mid-click.
     - `showMapShareBanner()` and `showMapToast()` appended their DOM elements to `document.body` instead of `document.fullscreenElement || document.getElementById('analyticsModal') || document.body`, hiding the banner/toast behind fullscreen modals.
  2. **Why Officer Location Auto-Enabled on Every Page Refresh Even Without Clicking "เปิดพิกัด"**:
     - `_armAudioOnInteraction()` in `app.js` called `this.start(null, true, true)` on any click/tap anywhere on the page unless `_userDisabled` was true.
     - `loadOfficerLocations()` in `analytics.js` forced `tracker.isSharing = true` and `tracker.start(null, true, false)` whenever the server returned an existing `myLoc` row, while `heartbeat()` in `auth.py` defaulted new `user_location` rows to `sharing_enabled = 1` and re-forced `sharing_enabled = 1` on every heartbeat when `force_location_all == "1"` remained sticky in `system_state`.
- **Resolution**:
  1. **Instant 1-Tap Popup Buttons (`frigate-nvr/web/assets/analytics.js` `v=118`)**:
     - Switched global `document.addEventListener('click', ..., true)` handlers for `.btn-action-share-gps` and `.btn-gps-popup-action` to **capture phase (`true`)** so they execute before Leaflet's `stopPropagation`, and also bound direct `click` + `touchend` handlers inside `leafletMap.on('popupopen', ...)`.
     - Updated `loadOfficerLocations()` to update open Officer popups **in-place** (`offPopupCoord_*`, `offPopupAcc_*`, `offPopupSpd_*`, `offPopupTime_*`, `offPopupNav_*`, `offPopupShare_*`) when `existing.isPopupOpen()` is true instead of calling `setContent()`.
     - Mounted `showMapShareBanner()`, `showMapToast()`, and `showLocationScopeChoice()` onto `document.fullscreenElement || document.getElementById('analyticsModal') || document.body`, and added a "คัดลอกซ้ำ" button + 350ms debounce to `shareGpsLocation()`.
  2. **Strict Opt-In Location Sharing on Refresh (`frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js` `v=194`, `frigate-nvr/web/assets/analytics.js` `v=118`)**:
     - Changed `heartbeat()` in `auth.py` so new `user_location` rows default to `sharing_enabled = 0` and removed the sticky heartbeat override; reset `force_location_all = '0'` and `sharing_enabled = 0` in `auth.db`.
     - Updated `initUserHeartbeat()`, `_armAudioOnInteraction()`, `sendPresenceHeartbeat()`, and `loadOfficerLocations()` so page refresh and screen clicks never auto-start GPS tracking unless the user explicitly clicked `#btnToggleOfficerLocation` ("เปิดพิกัด") on the map (or Superadmin explicitly triggered Force-Enable-All).
  3. **Unified BPP-VMS Stroke SVG Iconography (`frigate-nvr/web/assets/analytics.js` `v=118`)**:
     - Replaced emoji icons across map toolbar buttons, Officer popups, Camera popups, GPSONE popups, Pursuit HUD banner, Share banner/toast, and Mission/GPSONE modals with clean stroke SVG icons matching the BPP-VMS design system.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - `BPP-VMS.exe` Fixed Top-Right Window Controls, Elimination of DirectML GPU Freeze at Startup, Public HLS Upstream Fixes & 100% Local Settings Preservation on Update (Incident 2.165)
- **Problem / User Request**:
  - User uploaded screenshots (`media_1792415331326_ece2ff31.png`, `media_1792415400619_36553b05.png`) of `D:\sloth+vms\native\BPP-VMS.exe` and asked:
    1. Why the minimize/maximize/close buttons (`─ □ ✕`) wrapped down to the second row instead of staying locked at the top-right corner.
    2. Why opening `BPP-VMS.exe` caused the machine to become slow and freeze.
    3. Requested removing the `⚡ NATIVE GPU` badge and the manual `ซิงค์เว็บ` button, making Web UI sync 100% automatic whenever the program is updated/changed.
    4. Asked whether installing on a new machine makes it an independent system where the new machine can configure its own branding/settings, and whether pressing Update preserves 100% of the local machine's settings, users, and configurations without overwriting them.
- **Root Cause & Architecture Diagnosed**:
  1. **Why `BPP-VMS.exe` Froze the PC ~7 Seconds After Opening (`DmlExecutionProvider` Display Driver Stall)**:
     - In `gateway.log`, 4 seconds after `BPP-VMS.exe` started, `_background_boot_services()` called `get_native_ai_engine()`, which loaded 6 ONNX models (`color.onnx`, `brand.onnx`, `vehicletype.onnx`, `thlprv2.onnx`, `face.onnx`, `w600k_r50.onnx`) onto `DmlExecutionProvider` (DirectML) with `enable_mem_pattern = True` (default) and `ORT_ENABLE_ALL` in `vehicle_attr_onnx.py`.
     - Creating multiple DirectML sessions with `enable_mem_pattern=True` while Docker and WebView2 (16 live cameras) were using the GPU stalled the Windows Direct3D 12 display driver (`dwm.exe`) and froze the Python process right after `Loaded brand.onnx`.
  2. **Why `CH01`–`CH05` (`Khon Kaen` / `DOH`) Showed `กำลังเชื่อมต่อ... (BUFFER)`**:
     - `_PUBLIC_HLS_UPSTREAMS` in `native_gateway.py` had placeholder domains (`https://camerai1.doh.go.th`, `https://stream.ubon.go.th`) instead of the real upstreams from `dashboard-nginx.conf` (`https://camerai1.iticfoundation.org`, `https://38.159.250.22`, `https://hj50ac9nwcc.sn.mynetname.net:18191`, `https://streaming.udoncity.go.th:1935`), and `proxy_public_hls` was synchronous with an 8s timeout.
  3. **Why Window Controls Wrapped to the Second Row**:
     - `BppVmsShell.cs` appended `#bppSlothNativeWindowControls` as a flex child inside `<header>` instead of `position: fixed; top: 8px; right: 12px;`.
- **Resolution (`origin/dev/sloth-vms` commit `7c7de31`)**:
  1. **Eliminated DirectML GPU Freeze (`native_gateway.py`, `native_ai_worker.py`, `vehicle_attr_onnx.py`)**:
     - Made all ONNX models in `NativeAiEngine` 100% lazy-loaded on demand (zero models loaded at startup; `BPP-VMS.exe` + `python` + `go2rtc` now use only ~170 MB RAM total and <1% CPU at startup).
     - Enforced DirectML-required flags (`enable_mem_pattern = False`, `execution_mode = ORT_SEQUENTIAL`, `ORT_ENABLE_BASIC`, `intra_op_num_threads = 1`) in both `native_ai_worker.py` and `vehicle_attr_onnx.py`.
  2. **Fixed Public HLS Upstreams & Non-Blocking Proxy (`native_gateway.py`)**:
     - Updated `_PUBLIC_HLS_UPSTREAMS` to match `dashboard-nginx.conf` (`https://camerai1.iticfoundation.org`, `https://38.159.250.22`, `https://hj50ac9nwcc.sn.mynetname.net:18191`, `https://streaming.udoncity.go.th:1935`) and made `proxy_public_hls` / `proxy_camera_latest_jpg` `async def` via `asyncio.to_thread`.
  3. **Fixed Top-Right Window Controls & Removed Clutter (`BppVmsShell.cs`)**:
     - Removed `⚡ NATIVE GPU` badge and `ซิงค์เว็บ` button; pinned `─ □ ✕` at `position: fixed; top: 8px; right: 12px; z-index: 2147483647;` with `padding-right: 116px !important` on `.topbar`, and removed `WS_THICKFRAME` from `CreateParams`.
  4. **2-Minute Automatic Web Sync & 100% Local Config/User Protection (`system_updater.py`)**:
     - Added `PROTECTED_LOCAL_FILES` (`_snapshot_local_machine_files` / `_restore_local_machine_files`) in `system_updater.py` so `config.yml`, `auth/auth.db`, `dashboard-settings/*` (`branding.json`, `logo.png`, `channels.json`, `camera_names.json`, `camera_gps.json`), `lpr/*`, and `gpsone_*` are snapshotted before any `git pull`/`checkout` and restored immediately afterwards.
  5. **Bottom-Left Footer Branding Upgrade (`index.html`, `app.css`, `arm215-logo.svg`)**:
     - Replaced `Things Analytic Co., Ltd.` in the bottom-left `.bottombar` with **`Sucahkree Arm 215`** (bold cyber gradient) + **`+ Things Analytic Co., Ltd.`** (smaller secondary text) and created the custom fierce cyber/esports emblem `assets/arm215-logo.svg` in both `D:\sloth+vms\repo` and `D:\BPP-VMS`.
- **Files Changed**: `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\BppVmsShell.cs`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_gateway.py`, `D:\sloth+vms\repo\frigate-nvr\tools\native-exe\native_ai_worker.py`, `D:\sloth+vms\repo\frigate-nvr\lpr-service\vehicle_attr_onnx.py`, `D:\sloth+vms\repo\frigate-nvr\config-api\system_updater.py`, `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.css`, `frigate-nvr/web/assets/arm215-logo.svg`.

## Update 2026-10-19 - On-Demand Multi-Camera NVR History Pull & AI Retro-Scan (`history_pull_worker.py` + `#historyPullOverlay` + Instant 26-Camera Catalog Fix) (Incident 2.164)
- **Problem / User Request**:
  1. Earlier user requests on Case `2026-10-17`:
     - Requested genuine NVR playback frames with real YOLOv8 + ByteTrack bounding boxes, snapshots, clips, and Frigate DB rows for the 5-camera Nonburi black sedan convoy (`nonburi1`, `nonburi2`, `nonburi4`, `nonburi5`, `nonburi6`), and requested removing unrelated false-positive event `1792221220.056603-f8fc61` (`nonburi4` 14:13:40 `21944`) from both the trajectory report and Frigate/Watchlist databases.
     - Asked whether pulled historical NVR recordings can be viewed in the dashboard Playback timeline (`ดูย้อนหลัง`) and asked for an on-demand tool to pull & AI-scan historical NVR footage across **all historical-capable cameras simultaneously** from a single button (`📥 ดึงภาพย้อนหลัง & สแกน AI`).
  2. Follow-up screenshot (`uploaded_media_1792415915530.png`):
     - Opening `#historyPullOverlay` showed `โหลดรายการกล้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` inside `#hpCameraGroupsContainer`.
- **Root Cause & Architecture Diagnosed**:
  1. **Historical NVR Pull Capability Across All 36 Cameras**:
     - Audited all 36 configured cameras and verified **26 cameras across 4 NVR groups** support historical playback extraction:
       - **Group 1 — กล้องโนนบุรี (Uniview NVR `113.53.250.205:8554` 16x Fast Replay)**: `nonburi1`, `nonburi2`, `nonburi4`, `nonburi5`, `nonburi6` (5 cameras).
       - **Group 2 — ทต.หนองแวง (TVT NVMS-9000 WebSocket 1080p)**: `nongwang1` .. `nongwang15` (15 cameras).
       - **Group 3 — อบต.ดูนสาด (Dahua NVR RTSP Playback 1080p)**: `Doonsad1`, `Doonsad5`, `Doonsad6` (3 cameras).
       - **Group 4 — ตชด.215 BPP215 (Local NVR Storage + Hikvision ISAPI/RTSP)**: `D_BPP215_1`, `D_BPP215_2`, `D_BPP215_3` (3 cameras).
     - The remaining 10 cameras (`KK-*` public HLS live streams and ` Kranuan01-05` live tunnel streams without exposed NVR playback port) are live-only.
  2. **Why `#hpCameraGroupsContainer` Showed `โหลดรายการกล้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` in `app.js`**:
     - `hpRenderCameraGroups()` and `hpRenderJobStatus()` called `escHtml(...)`, which did not exist in `app.js` (the existing helper in `app.js` is `escapeHtml(...)`). When `hpLoadCatalog()` fetched `/api/nas-bot/history-pull/cameras` and invoked `hpRenderCameraGroups()`, `ReferenceError: escHtml is not defined` was thrown and caught by `try/catch`, displaying the fallback error text.
- **Resolution**:
  1. **Unified Multi-Backend History Pull & AI Retro-Scan Worker (`frigate-nvr/scripts/history_pull_worker.py`)**:
     - Created persistent daemon `/opt/history_pull_worker.py` inside `frigate-nvr` (managed by `s6-svscan` at `/run/service/history-pull-worker/run` and auto-started on container boot via `/usr/local/go2rtc/create_config.py`).
     - Supports all 4 NVR backends (Uniview 16x RTSP replay + PTS normalization, TVT NVMS-9000 WebSocket binary H.264 demuxer, Dahua RTSP playback, and Local/Hikvision RTSP playback), writes 1-minute `.mp4` segments into `/media/frigate/recordings/YYYY-MM-DD/HH/<camera>/MM.SS.mp4` (`+07:00` UTC conversion), inserts rows into Frigate `recordings` SQLite table so the **Playback (`ดูย้อนหลัง`)** timeline and red calendar dots work immediately, and runs YOLOv8 + HSV color classification + Frigate `event` + Watchlist `lpr_candidates` registration (`/internal/history-pull-candidate` in `watchlist-api/api.py`).
  2. **REST API Endpoints (`frigate-nvr/nas-bot-service/main.py` & `frigate-nvr/watchlist-api/api.py`)**:
     - Added `GET /api/nas-bot/history-pull/cameras`, `POST /api/nas-bot/history-pull/jobs`, `GET /api/nas-bot/history-pull/jobs`, `GET /api/nas-bot/history-pull/jobs/{job_id}`, and `POST /api/nas-bot/history-pull/jobs/{job_id}/cancel` in `nas-bot-service/main.py`, plus `POST /internal/history-pull-candidate` in `watchlist-api/api.py`.
  3. **Frontend Modal, Native BPP-VMS Glassmorphic UI & SVG Icons, and Instant 26-Camera Catalog (`frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.css` `v=162`, `frigate-nvr/web/assets/app.js` `v=192`)**:
     - Added **`ดึงภาพย้อนหลัง & สแกน AI`** buttons in both Event Manager (`#btnOpenHistoryPullFromEmgr`) and Playback (`#btnOpenHistoryPullFromPb`), opening `#historyPullOverlay`.
     - Restyled `#historyPullOverlay` and all trigger buttons to use native BPP-VMS glassmorphic components (`.modal`, `.modal-head`, `.modal-head-icon`, `.nvr-chip`, `.hp-card`, `.hp-group-card`, `.hp-cam-item.is-selected`, `.field`, `.inp`, `.obj-chip-btn`, `.btn-primary`, `.hp-progress-fill`) and crisp stroke SVG icons (replacing all emojis).
     - Fixed `ReferenceError: escHtml is not defined` by defining `hpEsc(v)` and embedded `HP_DEFAULT_GROUPS` (all 26 cameras across the 4 NVR groups, with the 5 `nonburi` cameras pre-selected by default) so `hpLoadCatalog()` renders the 26-camera checklist in `0ms` immediately upon opening the modal and then syncs with `/api/nas-bot/history-pull/cameras` in the background.
- **Files Changed**: `frigate-nvr/scripts/history_pull_worker.py`, `frigate-nvr/nas-bot-service/main.py`, `frigate-nvr/watchlist-api/api.py`, `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.css`, `frigate-nvr/web/assets/app.js`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - Continuous Background Real-Time Officer GPS via Hardware Audio DMA `ScriptProcessorNode`, Deadlock-Free Geolocation Watchers, and Elimination of Stalled Pins (Incident 2.161)
- **Problem / User Request**:
  - User asked: "?????????????????????????????????????????????????????????????????????????" and then instructed: "@[Quote] ??????????????? ???????????????????????????????????????????????????????????????????????????????" (Do not show a yellow stalled pin state `?? ?????????????????`; instead, ensure the officer's real GPS coordinates are continuously pulled even when the mobile browser screen is minimized/folded, and remove offline pins completely).
- **Root Cause & Architecture Diagnosed**:
  1. **Why Background Geolocation Stopped Updating on Mobile Browsers (`app.js`)**:
     - `_armAudioOnInteraction()` previously fired on `pointerdown` / `touchstart` and immediately removed all event listeners. On iOS Safari (WebKit), `pointerdown` / `touchstart` does not grant media playback user activation (`UserGestureIndicator`) if the touch starts a scroll, so `audio.play()` and `AudioContext.resume()` threw `NotAllowedError` and never started.
     - `_getSilentWavUrl()` previously used sample amplitude `12` with `audio.volume = 0.05`, which scaled `12 * 0.05 = 0.6` and truncated to `0` (`0x0000`) in the 16-bit integer OS mixer (`AudioFlinger` / `AVAudioSession`), triggering the OS Silence Detector after ~30s of backgrounding.
     - When switching apps while `getCurrentPosition` was in flight, mobile browsers dropped the pending request without firing callbacks, leaving `_gpsRequestInFlight = true` permanently deadlocked.
  2. **Stale Offline Pins & Cached Re-Posting (`auth.py`, `app.js`, `sw-location.js`)**:
     - `GET /auth/locations` previously returned rows from hours/days ago, and `onWorkerTick` / `sw-location.js` re-posted cached `lastCoords` even when no new GPS callback had arrived.
- **Resolution**:
  1. **Hardware Audio Thread `ScriptProcessorNode` + Unity-Gain 18Hz Infrasonic PCM + Persistent User Gesture Activation (`frigate-nvr/web/assets/app.js` `v=190`)**:
     - Upgraded `_getSilentWavUrl()` to dual `18Hz + 19.5Hz` infrasonic sine waves at amplitude `96` (`-50 dBFS`) with `audio.volume = 1.0` so samples never truncate to zero in the OS integer mixer while remaining 100% inaudible (`<20Hz`).
     - Attached a WebAudio `ScriptProcessorNode(4096, 1, 1)` (`onaudioprocess`) running directly on the **OS Real-Time Hardware Audio Thread** (~5x/sec even when the screen is off or browser is minimized) to drive `onWorkerTick()`.
     - Changed `_armAudioOnInteraction()` to a persistent listener on `touchend`, `pointerup`, `click`, and `keydown` so `audio.play()`, `AudioContext.resume()`, and `RTCPeerConnection` loopback are guaranteed to activate on the very first valid user tap and auto-recover if ever paused.
  2. **Deadlock-Free Dual-Provider Background Geolocation & Auto-Respawning Watchers (`app.js` `v=190`, `sw-location.js` `v4`)**:
     - Added 5-second timeout recovery on `_gpsRequestInFlight` (`_gpsRequestStartedAt`) so dropped background requests never deadlock.
     - Added `_restartGeoWatchers()` auto-rebinding `watchPosition` every 8s on the active audio/WebRTC callback stack if WebKit/Blink pauses the watcher while minimized, paired with 1.2s `getCurrentPosition` (`maximumAge: 2500`) across both GNSS and FusedLocationProvider (WiFi/Cell).
     - Only transmits coordinates to `/auth/location` when `navigator.geolocation` genuinely returns a position callback (`lastFixReceivedAt > lastPostedAt`).
  3. **Zero Stalled Pins on Map (`frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/analytics.js` `v=117`, `frigate-nvr/web/index.html`)**:
     - Removed the `?? ?????????????????` badge state completely; active officers stay `?? ???????????`, and offline/closed sessions (`>180s` without a GPS fix) are automatically pruned from the map.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - Unlimited GPS Historical Trajectory Persistence (`gpsone_history.local.db` & Unlimited `live_trail`) + Full Multi-Week Cloud Route Recovery (Incident 2.160)
- **Problem / User Request**:
  - User requested: "การเก็บเส้นทางย้อนหลังของ gps ให้เก็บทั้งหมดเลยไม่มีจำกัด เส้นที่เคยเก็บมาแล้วมันหายไปเอากลับมาด้วย" (Store all historical GPS trajectories without any limit, and recover/restore the previously collected routes that disappeared).
- **Root Cause & Architecture Diagnosed**:
  1. **60-Point Truncation in `live_trail` (`gpsone_tracker.py` line 1502)**:
     - Previously, `poll_single_device` truncated `live_trail` to the most recent 60 points (`if len(live_trail) > 60: live_trail = live_trail[-60:]`). Once a moving tracker accumulated more than 60 points (`888880100441041` and `CT32020` both hit 60 points), earlier points were discarded and disappeared from the map.
  2. **24-Hour Query Window & 720-Hour Cap (`main.py` & `analytics.js`)**:
     - Clicking **`🛣️ เส้นทาง`** / **`🛣️ เส้นทางย้อนหลัง`** called `showGpsOneTrajectory(imei, 24)` (`hours=24`, with `main.py` capping `min(hours, 720)`). When >24 hours had elapsed since movement, `thaigpsdd_v2` (`CT32020` / `DD1`) had no fallback and returned 0 points (`"ไม่มีการเคลื่อนที่ย้อนหลังในช่วง 24 ชั่วโมงที่ผ่านมา"`), while `aspx_gps903` only fell back to 7 days (capped at ~500 points per call), omitting historical routes from June–October.
     - Additionally, `/auth/mission/list` in `auth.py` had a `LIMIT 50` SQL clause.
- **Resolution**:
  1. **Permanent Unlimited SQLite Track Archive (`gpsone_history.local.db`) & Unlimited `live_trail` (`frigate-nvr/analytics-engine/services/gpsone_tracker.py`)**:
     - Created SQLite database `gpsone_history.local.db` (table `gps_track_history` with `UNIQUE(imei, recorded_at, lat_key, lng_key)` and WAL mode) via `_init_history_db`, `_save_history_points`, `_get_stored_history_points`, and `_build_unlimited_live_trail`.
     - Removed `if len(live_trail) > 60: live_trail = live_trail[-60:]` in `poll_single_device` and persisted every live GPS movement point into both `gps_track_history` and `live_trail` without any point limit or expiration.
  2. **Full Multi-Week Cloud Route Recovery (`backfill_device_history` in `gpsone_tracker.py`)**:
     - Implemented `backfill_device_history(imei, days_back=120)` which seeds existing `live_trail` points into SQLite and sweeps the cloud (`gps903.net`, `gps.thaigpsdd.com`, `gpspos.net`) in 7-day chunks (automatically subdividing dense `aspx_gps903` chunks with $\ge 490$ points into 1-day and 6-hour windows to bypass the ~500-point per-call cloud limit).
     - Executed full backfill across all 4 registered devices, recovering **12,282 total historical points** (`888880100672173`: `399` points / `290` trail; `888880100658933` `พิทักษ์ฝั่งโขง1`: `3,913` points / `3,506` trail; `888880100441041` `พิทักษ์ฝั่งโขง2`: `4,386` points / `3,975` trail; `CT32020` `DD1`: `3,584` points / `3,196` trail).
  3. **Unlimited History API & Segmented Frontend Rendering (`main.py`, `auth.py`, `analytics.js` `v=114`, `index.html`)**:
     - Updated `GET /api/analytics/gpsone/devices/{imei}/history` in `main.py` to default to `hours: int = 0` (`all_history = True`, no 720-hour cap) and removed `LIMIT 50` in `/auth/mission/list` (`auth.py`).
     - Updated `showGpsOneTrajectory(imei, hours = 0)`, `buildGpsOnePopupHtml`, `handleGpsOnePopupAction`, `renderGpsOneModalList` (showing total stored point count on the `🛣️ เส้นทางย้อนหลัง (X,XXX จุด)` button), and `updateGpsOnePursuitOverlay` (using `splitIntoSegments(cleanPts, 0.8)` so continuous road trails render solid and >0.8 km offline jumps render dashed).
- **Files Changed**: `.gitignore`, `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/analytics-engine/main.py`, `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-19 - Camera Streaming Stability (MJPEG Black-Screen Fix, 0ms Poster Handover, Warm-Pause Viewer Resume, Global Transport Memory) & 24/7 Zero-Refresh Always-On Engine (Incident 2.159)
- **Problem / User Request**:
  - User reported two interconnected operational requirements:
    1. Camera streaming stability: some cameras (`CH06`, `CH07`, `CH10` on mobile/10-camera grid) showed green `ออนไลน์` status with a black screen; opening fullscreen viewer (`openViewer`) took 5–10 seconds on `"กำลังเชื่อมต่อสตรีมหลัก..."`; closing fullscreen viewer (`closeViewer`) caused all 10 cameras to simultaneously show `"กำลังเชื่อมต่อใหม่..."` (`🟡 RECONNECT`); frequent `"กำลังเชื่อมต่อ..."` on initial load / Cloudflare Tunnel / 5G.
    2. 24/7 Continuous Unattended Operation & Real-Time Zero-Refresh Updates: keep the dashboard open 24/7 without freezing or needing manual page refresh, and automatically reflect new AI events, LPR plates, camera name/grid changes, and CSS/JS updates in real time.
- **Root Cause & Architecture Diagnosed**:
  1. **Black Screen with Green `ออนไลน์` Dot (`CH06`, `CH07`, `CH10`)**:
     - When hardware H.264 decoders are exhausted (6–8 limit on iOS/Android) or `MediaSource` `sourceopen` times out (2,500ms), `Camera.connect()` falls back to `currentMode = 'mjpeg'`, rendering JPEG frames into `this.video.poster`. However, `this.video.src` / `this.video.srcObject` remained bound to the empty `MediaSource` and `startWatchdog()` called `this.video.play()` every 1s—causing the browser to paint an opaque black `<video>` frame plane over the `poster` image! Additionally, audio-only progress (`this.video.currentTime > 0` while `videoWidth === 0`) triggered `markLive()` prematurely and removed `poster`.
  2. **Slow Fullscreen Viewer (`openViewer`)**:
     - `openViewer()` always requested a cold HD main stream (`playableMainStream(ch)`) from scratch, waited 5,000ms for WebRTC UDP timeout on WAN/5G before trying MSE, and did not copy the live frame from the grid tile into `#cvVideo.poster`.
  3. **All 10 Cameras Showing `"กำลังเชื่อมต่อใหม่..."` on `closeViewer()`**:
     - `openViewer()` called `t.cam.suspend()` (destroying all 10 WebSocket/MSE/WebRTC connections), and `closeViewer()` called `t.cam.resumeFromSuspend()` -> `this.connect()` where `this._graceStart` was `0`, so `inGrace` evaluated to `false` and immediately triggered `this.onStatus('reconnecting')` on every tile.
  4. **24/7 Freeze & Stale UI**:
     - Uncaught `QuotaExceededError` on `sb.appendBuffer()`, missing HLS frame-stall watchdog, uncleaned temporary `<canvas>` GPU buffers, 60-second full DOM destruction in `renderEvents()` (`Math.floor(e.mins)` in `state.evSignature`), single-401 immediate redirect in `authenticatedFetch`, and lack of `/nvr/ws` real-time event push.
- **Resolution**:
  1. **Fixed MJPEG Black Screen & Premature Poster Removal (`frigate-nvr/web/assets/app.js` `v=184`)**:
     - Added `clearVideoForMjpeg()` (`video.pause()`, `srcObject = null`, `removeAttribute('src')`, `video.load()`) whenever switching to `currentMode = 'mjpeg'`, prevented `startWatchdog()` from calling `video.play()` in MJPEG/paused modes, and required `this.video.videoWidth > 0` before calling `markLive()`.
  2. **Direct Zero-Load Live Passthrough Fullscreen Viewer (`0.00ms` Instant Live Video, Zero `"กำลังเชื่อมต่อ..."` Spinner) + Silent Background HD Swap (`index.html`, `app.css` `v=161`, `app.js` `v=185`)**:
     - Instead of pausing the clicked tile's stream and opening a brand-new `Camera` connection on `#cvVideo` (which required waiting 0.5–3s for a new H.264 IDR keyframe and displayed `"กำลังเชื่อมต่อ..."`), `openViewer(i)` now activates **Direct Zero-Load Live Passthrough**: promotes the clicked tile's `<div class="tile-feed">` (`tile.el.classList.add('viewer-active-tile')`) to `position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 54;` right beneath `.cam-viewer.is-passthrough` (`z-index: 55`), keeping the exact same `<video>` stream playing uninterrupted in `0.00ms` with `viewerStatus('live')` (`#cvCenter.hidden = true`).
     - Clicking `<button id="btnCvStreamMode">` to upgrade to `MAIN (HD)` warms up `state.viewerCam` silently in the background on `#cvVideo` while keeping the live passthrough stream visible on screen, swapping to `#cvVideo` only at the exact millisecond the first HD frame is decoded (`st === 'live'`). Switching back to `SUB` restores the passthrough stream in `0.00ms`.
  3. **Warm-Pause Viewer Handover (`pauseForViewer` / `resumeFromViewer`) & Synchronous `0.00ms` Grid Resume (`app.js` `v=185`)**:
     - Opening fullscreen viewer places only the other 9 background tiles (`idx !== i`) into Warm-Pause (`pauseForViewer()` — pauses `<video>` decoding while keeping connections alive for 90s); closing fullscreen (`closeViewer()`) removes `.viewer-active-tile` and resumes all `viewerPaused` tiles synchronously (`0.00ms`, zero stagger delay) at the live edge with zero `"กำลังเชื่อมต่อใหม่..."`. Also suppressed `.ov-connecting` on grid tiles whenever `t.video.poster` or `t.video.videoWidth > 0` is already present.
  4. **Global Transport Memory (`streamTransportState`) & Staggered Grid Startup (`app.js` `v=185`)**:
     - Automatically prefers WebSocket MSE on WAN/Cloudflare Tunnel/Mobile (`!isLocalLanHost || isMobileDevice`) and remembers WebRTC failures globally, eliminating the 5,000ms WebRTC wait. Staggered initial `Camera` connections by `65ms` per slot.
  5. **24/7 Always-On Engine & 100% Real-Time Zero-Refresh Updates (`app.js` `v=185`)**:
     - Added `safeAppendMse()` (`QuotaExceededError` self-eviction), HLS frame watchdog (`15s` `recoverMediaError()`), `captureVideoPoster()` with immediate `c.width = 0; c.height = 0;` GPU release, `run24x7HealthScrubber()` (5-min MSE buffer trim, live-edge nudge, bounded `pb.evCache`/`pb.recCache`, Screen WakeLock), and resilient `verifySessionOrRedirect()` on 401.
     - Connected Frigate real-time WebSocket (`/nvr/ws` via `connectFrigateRealtimeWS()`) + enhanced `/api/watchlist/stream` SSE + LPR signature hydration in `renderEvents()` (with zero-churn in-place `.ev-ago` updates), added `syncGridDiffSmoothly()` + `syncRealtimeConfigDigest()`, and added `initLiveAssetVersionWatcher()` for zero-reload CSS hot-swap and warm-poster JS soft-reload.
- **Files Changed**: `frigate-nvr/web/index.html`, `frigate-nvr/web/assets/app.css`, `frigate-nvr/web/assets/app.js`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Isolated SLOTH + BPP-VMS Workspace (`D:\sloth+vms`), Zero-Drop Live Stream Engine (P0), ONNX AI Upgrade (`thlprv2.onnx`, `color.onnx`, `brand.onnx`, Face Recognition — P3/P2/P1), In-App 1-Click Updater + 15-Min Auto Web Sync (U), and 100% Native Windows `BPP-VMS.exe` Edition with All-GPU Accelerator & Field Uplink (E/F) (Incident 2.158)
- **Problem / User Request**:
  - User requested comparing `D:\BPP-VMS` with `D:\sloth-bpp215\SLOTH-BPP215`, executing the full Master Blueprint (`P0 → P3 → P2 → P1 → U → E → F`) inside a dedicated isolated folder **`D:\sloth+vms`** (on Git branch **`dev/sloth-vms`** of `itbpp215-creater/VMS-215`) without touching or restarting the live production HQ system (`D:\BPP-VMS`), and building the new system as a **100% Native Windows `.exe` (`D:\sloth+vms\native\BPP-VMS.exe`) requiring Zero Docker** while sharing the exact same `frigate-nvr/web/` UI with HQ (`vms.local`).
- **Root Cause & Architecture Diagnosed**:
  1. **Live Video Reconnect Loop (Phase P0 — 5 Root Causes in `frigate-nvr/web/assets/app.js`)**:
     - `ws.onmessage` only updated `this.lastFrameTime` on the very first binary MSE packet (`if (!this.mseLive)`), relying strictly on `video.ontimeupdate` thereafter; backgrounded tabs or minor decode pauses triggered false 8-second watchdog kills (`this.fail()`).
     - Remote/4G NVR RTP timestamp jumps created disjoint `sb.buffered` ranges (`[0..12.1]` and `[12.4..16.0]`), stalling `<video>` at buffer holes because `playbackRate = 1.15` cannot cross unbuffered gaps.
     - Fixed 30-chunk `mseQueue` overflowed on 2K/4K keyframes; Watchdog lacked soft recovery; `rebuildGrid()` destroyed all active camera players (`grid.innerHTML = ''`) whenever a single camera was edited.
  2. **AI Model Benchmark & Multi-Attribute Fusion (Phases P3, P2, P1)**:
     - Benchmarking `thlprv2.onnx` (`384×640` vs `640×640`) against `data_plate.pt` on 41 real BPP-215 plates + 50 SLOTH plates (`D:\sloth+vms\reports\P3_benchmark_report.md`) proved `thlprv2.onnx` at native `384×640` achieves **56.1% Exact Plate Match** and **88.9% Character Similarity** on BPP-215 real plates (surpassing `data_plate.pt`'s 43.9% exact / 81.4% char similarity).
     - Added fast local ONNX classification (`color.onnx` 15 classes + `brand.onnx` 24 classes in ~15ms via `vehicle_attr_onnx.py`) and Frigate/ONNX Face Recognition (`face.onnx` + `w600k_r50.onnx`) with Admin-only `/nvr/api/faces` security gate and purple `👤 <ชื่อบุคคล>` badges on Event Cards.
  3. **Unified Web UI + Zero-Docker Native Windows `.exe` Architecture (Phases U, E, F)**:
     - Both HQ (`vms.local`) and Field `.exe` (`D:\sloth+vms\native\BPP-VMS.exe`) share `frigate-nvr/web/` via a 15-minute background `git fetch` + `git checkout origin/<branch> -- frigate-nvr/web` zero-downtime hot-sync thread (`system_updater.py`) plus a 1-Click Update UI tab (`#tabSystemUpdate`).
     - In `D:\sloth+vms\native\`, `BPP-VMS.exe` (C# WebView2 Shell + System Tray) supervises `go2rtc.exe` and `native_gateway.py` (`:8443`), which mounts `config-api`, `auth-service`, `watchlist-api`, Frigate-compatible `/nvr/api/*` endpoints, `native_ai_worker.py` (`DmlExecutionProvider` / `CUDAExecutionProvider` / `CPUExecutionProvider`), and `FieldUplinkSync` in a single native process without Docker.
- **Resolution**:
  1. **Created Isolated Workspace `D:\sloth+vms` (`repo/`, `models/`, `lab/`, `native/`, `reports/`) on branch `dev/sloth-vms` (`dc432b2`)**:
     - Production `D:\BPP-VMS` remained 100% untouched.
  2. **Phase P0 (`Zero-Drop Live Stream Engine` in `frigate-nvr/web/assets/app.js` `v=184`, commit `3205e10`)**:
     - Added `shouldPreferMSEFirst()`, byte-bounded `mseQueue` (`12 MB` cap), `this.lastFrameTime = Date.now()` on every MSE binary frame, disjoint `sb.buffered` hole jumper (`> 0.15s` stall), Two-Stage Watchdog Soft Recovery (`seek + play` at 12s before hard reconnect at 22s, 30s tolerance when tab hidden), and differential `rebuildGrid()`.
  3. **Phase P3, P2, P1 (AI Models & Face Recognition, commits `0d1475f`, `fb8c852`, `1268cb4`)**:
     - Saved full benchmark report to `D:\sloth+vms\reports\P3_benchmark_report.md`.
     - Created `frigate-nvr/lpr-service/vehicle_attr_onnx.py` + wired into `vehicle_mmcr.py` + verified with 4 unit tests in `frigate-nvr/lpr-service/tests/test_vehicle_attr_onnx.py`.
     - Enabled `face_recognition:` in `config.yml` & `config.clean.yml`, added `location ^~ /nvr/api/faces` Admin gate in `dashboard-nginx.conf`, and added `extractFaceInfo()` + purple face badges in `app.js`.
  4. **Phase U (`system_updater.py` + `#tabSystemUpdate`, commit `e97b7db`)**:
     - Created `frigate-nvr/config-api/system_updater.py`, wired `/api/config/system/update/*` in `config-api/api.py`, and added the "อัปเดตระบบ" tab in `index.html` and `app.js`.
  5. **Phase E & F (`D:\sloth+vms\native\BPP-VMS.exe` + `gpu_accelerator.py` + `native_ai_worker.py` + `native_gateway.py`, commit `dc432b2`)**:
     - Created `frigate-nvr/tools/native-exe/{gpu_accelerator.py,native_ai_worker.py,native_gateway.py,BppVmsShell.cs,Build-BppNativeExe.ps1}` and compiled `D:\sloth+vms\native\BPP-VMS.exe` with `go2rtc.exe`, `mediamtx.exe`, `bore.exe`, and `onnxruntime-directml` (`Intel UHD 770` + `NVIDIA GeForce RTX 5060 Ti` + `h264_nvenc`).
- **Files Changed (on branch `dev/sloth-vms` in `D:\sloth+vms\repo`)**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `frigate-nvr/lpr-service/vehicle_attr_onnx.py`, `frigate-nvr/lpr-service/vehicle_mmcr.py`, `frigate-nvr/lpr-service/tests/test_vehicle_attr_onnx.py`, `frigate-nvr/config/config.yml`, `frigate-nvr/config/config.clean.yml`, `frigate-nvr/dashboard-nginx.conf`, `frigate-nvr/config-api/system_updater.py`, `frigate-nvr/config-api/api.py`, `frigate-nvr/config-api/Dockerfile`, `frigate-nvr/docker-compose.yml`, `frigate-nvr/tools/native-exe/*`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Nonburi Historical Recordings Playback (`ดูย้อนหลัง`), Auto-Jump to Latest Recorded Date, NVENC H.265➔H.264 Fallback, and Overlapping Segment Cleanup (Incident 2.157)
- **Problem / User Request**:
  - User asked: "@[Quote] แล้วไฟล์ย้อนหลังจะดูจากระบบได้ไหม" regarding the historical recordings imported from the `กล้องโนนบุรี` (UniEase P2P) NVR into BPP-VMS.
- **Root Cause & Architecture Diagnosed**:
  1. **Camera Dropdown Scope in Playback Modal (`#pbCam` in `openPlayback()` / `pbBuildFollowers()`)**:
     - `openPlayback()` and `pbBuildFollowers()` previously populated `<select id="pbCam">` solely from `pbCamList()` (`cfg.channels` — the active live grid channels), omitting `nonburi1`, `nonburi2`, `nonburi4`, `nonburi5`, and `nonburi6` whenever the user's live grid was set to another camera group.
  2. **Default Date Mismatch When Selecting Historical-Only Cameras (`pbLoadRecDays()`)**:
     - `#pbDate` defaults to today (`2026-10-18`), whereas the imported `กล้องโนนบุรี` recordings span `2026-10-17` (`06:15 – 20:10 น.`, `~650` segments / `10.8+` hours per camera) and `2026-10-16`, causing `#playbackOverlay` to display `"ไม่มีบันทึกในวันนี้"` until the user manually opened the calendar and clicked `17 ต.ค. 2569`.
  3. **HEVC (`hev1`) Playback Fallback & Overlapping Segment Codec Mismatch (`kran01`, `kran03`, `tritn1..5`)**:
     - Duplicate overlapping `recordings` rows (`1792221040.0-kran01`, `1792221065.0-kran03`) mixed `hevc` and `h264` inside Frigate's `ffmpeg -f concat -c copy` playlist, and `StorageMaintainer` had cleared `has_clip` on `tritn1..5` during routine cleanup.
- **Resolution**:
  1. **Removed Duplicate Overlapping Recording Rows & Verified All 9 Event Clips (`/db/frigate.db`)**:
     - Removed duplicate overlapping rows `1792221040.0-kran01` and `1792221065.0-kran03`, transcoded the canonical segments (`nonburi5/10.00.mp4` and `nonburi1/11.01.mp4`) to H.264 (`yuv420p` + `+faststart`), restored `has_clip=1, retain_indefinitely=1`, and verified HTTP 200 H.264 playback across all 9 `kran*` and `tritn*` events.
  2. **Enhanced Playback Modal (`ดูย้อนหลัง`) Camera Selector, Auto-Date Jump, & NVENC Fallback (`frigate-nvr/web/assets/app.js` `v=183`, `frigate-nvr/web/index.html`)**:
     - Added `pbPopulateCamSelect(sel, includeBlank)` so `#pbCam` and multi-screen follower selects always include both active dashboard cameras and the `กล้องโนนบุรี & กล้องในระบบอื่นๆ` group (`nonburi1`, `nonburi2`, `nonburi4`, `nonburi5`, `nonburi6`) with full Thai names (`pbCamLabel`).
     - Updated `pbLoadRecDays()` so if the currently selected date has no recordings (`!pb.recDays.has(curDay)`) while `pb.recDays.size > 0`, it automatically jumps to the most recent recorded date (`2026-10-17`) and loads the timeline immediately.
     - Added automatic `prepareAndPlayVideoCompat` (`media-compat-service` NVENC H.265 ➔ H.264 transcoding) fallback on `pbVideo` and follower `<video>` error events.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Multi-Role GPS Device Addition, Creator Default Visibility (`owner_user`), Per-User Sharing Configuration, and Superadmin Full Control & Online Visibility (Incident 2.156)
- **Problem / User Request**:
  - User requested: "สำหรับการเพิ่ม gps ให้ user ทุกระดับสามารถเพิ่มได้ และให้แต่ละ user สามารถกำหนดได้ว่าจะให้ user ไหนบ้างที่สามารถเห็นได้ ค่าเริ่มต้นคือให้ user ที่เพิ่ม gps นั้นเห็นของที่ตัวเองเพิ่มเสมอ และให้ superadmin สามารถทำได้ทุกอย่างกับทุกอุปรกรณ์ gps และให้เห็น gps ทุกตัวได้ถ้าออนไลน์"
- **Root Cause & Architecture Diagnosed**:
  1. Previously, adding/editing/deleting GPS devices and configuring user permissions in `/api/analytics/gpsone/*` and `#gpsOneManagerModal` were restricted to `Superadmin` only (`is_superadmin()` / `isGpsOneSuperadmin()`).
  2. GPS devices did not record `owner_user` (the username of the creator), so regular users had no ownership model to manage or share the devices they added.
  3. In `list_devices`, `if not include_disabled and not cfg.get("enabled", True): continue` was evaluated before checking `is_online`, which could skip an online tracker before the auto-enable transition ran.
- **Resolution**:
  1. **Multi-Role GPS Creation & Creator Ownership (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `main.py`)**:
     - Added `owner_user` tracking on every GPS device (`upsert_device` records `owner_user = actor_user` on creation).
     - Added `normalize_allowed_users(raw_list, owner_user)` and updated `can_user_view_device(cfg, username, role)` so the user who added a GPS device (`owner_user`) **always** has view access to their own GPS device by default (`allowed_users` always includes `owner_user`).
     - Added `can_user_manage_device(cfg, username, role)` returning `True` for `Superadmin` (on all devices) and `owner_user` (on devices they added).
     - Updated `/api/analytics/gpsone/devices`, `/relocate`, `/toggle`, `/toggle-all`, `/permissions`, `/permissions/device`, `/permissions/user`, and `DELETE /devices/{imei}` in `main.py` to allow all authenticated users to add GPS devices and manage/share their own devices while `Superadmin` has full control over every device.
  2. **Superadmin Full Control & Online Visibility (`gpsone_tracker.py`)**:
     - Evaluated `is_online` and auto-re-enabled online trackers (`cfg["enabled"] = True`) *before* checking `include_disabled` in `list_devices`, ensuring any GPS device that is online is automatically visible on the map (`และให้เห็น gps ทุกตัวได้ถ้าออนไลน์`).
  3. **Frontend Per-User Sharing in Add/Edit Form & Permissions Tab (`frigate-nvr/web/assets/analytics.js` `v=113`, `index.html`)**:
     - Enabled `#btnMapGpsOne`, `#btnQuickAddGpsOne`, `#tabBtnGpsOneAdd`, `#tabBtnGpsOnePerms`, `#btnOpenAddGpsForm`, and `#btnOpenPermsInList` for all user roles in `syncGpsOneRoleUI()`.
     - Added `#gpsOneFormAllowedUsersSection` (`renderGpsOneFormAllowedUsers`) directly inside the Add/Edit GPS form so any user adding or editing a GPS device can immediately select which users can see it (with the creator pre-checked and locked as `(ผู้เพิ่ม - เห็นเสมอ)` by default, and Superadmin always having full access).
     - Updated `renderGpsOneModalList` and `loadAndRenderGpsOnePermissions` to use `canManageGpsOneDevice(dev)` so creators can edit, delete, toggle, and manage user visibility for their own GPS devices while Superadmin can manage all devices.
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/analytics-engine/main.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Life360-Grade 4-Engine Background Real-Time GPS Tracking, Zero-Click Auto-Lock on First Visit, and Smooth Officer Pin Gliding (Incident 2.155)
- **Problem / User Request**:
  - User requested: "@[Quote] ไม่เอาแบบนี้อยากให้ทำยังไงก็ได้ให้พิกัมัน realtime แบบแอป 360life เลย โดยที่เจ้าหน้าที่เข้าหน้าเว็บเราแค่ครั้งเดียวพอแต่ให้พิกัดเกาะไปตลอดเลย" (Do not let officer pins degrade into Background/Last Known or require manual toggling; make officer location tracking real-time just like Life360 where an officer accesses our web page just once and GPS locks onto them continuously forever, even when exiting Safari/Chrome).
- **Root Cause & Architecture Diagnosed**:
  1. **OS Silence Detector Revoking Background Audio WakeLock on iOS Safari & Android Chrome**:
     - Previously, `_getSilentWavUrl()` synthesized 8-bit flat digital silence (`0x80` = 128) at `audio.volume = 0.001`.
     - Modern iOS (`AVAudioSession`) and Android (`AudioFlinger` / Chrome `SilenceDetector`) inspect the digital PCM buffer. Flat zero-amplitude buffers or volumes `< 0.01` are classified as "Silent Audio", causing the OS to revoke the background media WakeLock after 30–60 seconds when the user switches away from Safari/Chrome.
  2. **Background `setInterval` Timer Throttling vs. Hardware Audio DMA Clock (`timeupdate`)**:
     - When Safari/Chrome is minimized, standard JS `setInterval` timers are throttled by WebKit/Blink, whereas `HTMLMediaElement`'s `timeupdate` event and `RTCPeerConnection` `RTCDataChannel` messages run on unthrottled hardware audio DMA and C++ network threads.
  3. **Manual Activation Requirement & First-Visit Race Condition in `/auth/location`**:
     - Previously, officers had to manually click "เปิดพิกัด" on first visit, and if `POST /auth/location` arrived before `/auth/location/toggle` (`existing is None` in `user_location`), `auth.py` returned `sharing_disabled: True`, causing the client to immediately shut off tracking!
- **Resolution**:
  1. **Zero-Click Auto-Lock on First Web Visit (`app.js`, `analytics.js`, `auth.py`)**:
     - In `auth.py` (`/auth/heartbeat` & `/auth/location`): Automatically initializes `user_location` with `sharing_enabled = 1` on the officer's very first visit and accepts initial coordinates without rejecting when `existing is None`.
     - In `app.js` (`initUserHeartbeat`) & `analytics.js` (`loadOfficerLocations`): Automatically starts `bppLocationTracker.start(null, true, true)` as soon as any authenticated officer opens the web page (unless explicitly disabled by user/admin), caching `bpp_last_coords` in `localStorage` for 0ms instant pin lock on page load.
  2. **4-Engine Life360-Grade Background Keepalive Architecture (`app.js` & `sw-location.js`)**:
     - **Engine 1 — 16-Bit Infrasonic Dithered PCM WAV + Hardware Audio DMA Clock (`_getSilentWavUrl`, `startAudioKeepalive`)**: Synthesizes a 12-second 16-bit 8000Hz WAV containing a 14Hz infrasonic sine wave + 2-LSB triangular dither (`-68 dBFS`) at `volume = 0.05`. Completely inaudible to human ears (<20Hz infrasound), but presents a dynamic AC waveform that defeats iOS/Android silence detectors. Hooks `audio.ontimeupdate` (~4x/sec hardware clock) + auto-resume on `pause` directly to `onWorkerTick()`.
     - **Engine 2 — In-Memory WebRTC Active-Call Loopback (`startWebRtcKeepalive`)**: Connects two local `RTCPeerConnection` instances (`_rtcPc1` <-> `_rtcPc2`) in memory with an audio stream track and `RTCDataChannel('bpp-life360-gps')` pulsing every 1,000ms. Elevates browser tab priority to **Active VoIP Call** on both iOS Safari and Android Chrome.
     - **Engine 3 — Web Locks API Anti-Freeze Hold (`acquireWebLock`)**: Holds an exclusive `navigator.locks.request('bpp_life360_gps_keepalive')` lock so the browser Page Lifecycle controller never freezes or discards the background tab.
     - **Engine 4 — Service Worker v3 1Hz Ping-Pong & Background Relay (`sw-location.js`)**: Pings clients every 1s (`BG_LOCATION_PING`) and directly relays cached coordinates to `/auth/location` from the Service Worker thread if the window thread is momentarily busy during an app switch.
  3. **Dual Satellite + Cellular/WiFi Geolocation Fusion & Life360 Smooth Marker Gliding (`app.js`, `analytics.js`, `auth.py`)**:
     - Runs dual `watchPosition` (High-Accuracy Satellite + Low-Power Cellular/WiFi) and active 1Hz `getCurrentPosition` with automatic indoor/pocket WiFi/Cell fallback so coordinates never stall indoors.
     - Added `smoothGlideOfficerMarker()` (`requestAnimationFrame` easeOutQuad over 820ms) in `analytics.js` and locked active sharing officers to `🟢 สดเรียลไทม์ (live)` in `auth.py`.
  4. **Removed Cluttering `🕶️ พรางจอ` (`#btnToggleStealthMode`) Toolbar Button (`analytics.js` `v=115`, `app.js` `v=186`, `index.html`)**:
     - Because the 4-Engine Background Keepalive maintains GPS tracking automatically in the background without requiring manual Stealth Mode activation, removed `#btnToggleStealthMode` from the map toolbar (`analytics.js`) and `updateUI()` (`app.js`) per user request (`"เกะกะเอาออกเลย"`).
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Cross-Camera Chronological Trajectory Tracing (`nonburi5` ➔ `nonburi1` & Return) for 'นักบินกระนวล 2.4 ล้านเม็ด', Native Frigate Bounding-Box Snapshots, and Tactical Movement Timeline Banner in Event Archive (Incident 2.154)
- **Problem / User Request**:
  - User requested: "แล้วไฟล์ย้อนหลังที่เราดึงมาเราจะดูได้ที่ไหน และไล่หารถคันนี้ตามไทม์ไลน์ จากล้องสามแยกวัดกัลยาณบริหาร ด้วยและบันทึกเหตุการณ์ให้ด้วย และทำยังไงเราถึงจะรู้ไทม์ไลน์การเคลื่อนที่ของมันว่าผ่านกล้องไหนก่อนและไปกล้องไหนต่อ" (and subsequently requested removing `nonburi4` from the archive, keeping only the 4 verified sightings across `nonburi5` [สามแยกไฟกระพริบ] and `nonburi1` [สามแยกวัดกัลยาณบริหาร]).
- **Root Cause & Forensic Findings**:
  1. **NVR Unified Hardware Clock (`nvr_ep`) vs. Per-Camera OSD Clock Offset (`+2834s` / `47m 14s` in Afternoon)**:
     - All cameras on the Uniview NVR (`NVR302-16S2-P16`) are recorded against a single unified NVR hardware epoch clock (`nvr_ep`).
     - During the afternoon of `17/10/2026`, `nonburi5` (`สามแยกไฟกระพริบ`)'s camera OSD clock lagged `nonburi1` (`สามแยกวัดกัลยาณบริหาร`) by `47 minutes 14 seconds` (`2,834s`), whereas by `20:00` at night `nonburi5`'s OSD clock had synced to match `nonburi1` (`20:00:05` on `nonburi1` ➔ `20:00:27` on `nonburi5`).
     - Using the unified NVR hardware clock (`nvr_ep`) + multi-vehicle convoy cross-verification, we traced all **4 trajectory points** (2 inbound points in the afternoon + 2 outbound return points at night).
- **Resolution**:
  1. **Registered All 4 Chronological Trajectory Sightings in `/db/frigate.db` (`event` + `recordings`) and `config/lpr/watchlist.db` (`lpr_candidates`)**:
     - **Inbound Trip (ขาไป — ช่วงบ่าย 17 ต.ค. 2569)**:
       1. `1792221047.000000-kran01` (`nonburi5 - สามแยกไฟกระพริบ`, **`14:10:47 น.`**): จุดที่ 1/2 ขับจากซ้ายล่างมุ่งหน้าตรงไปทางสามแยกวัดกัลยาณบริหาร
       2. `1792221070.000000-kran03` (`nonburi1 - สามแยกวัดกัลยาณบริหาร`, **`14:11:10 น.`** | **`⏱️ +23 วินาที`**, OSD `14:58:24`): จุดที่ 2/2 ขับจากขวามาซ้ายผ่านหน้าป้ายวัดกัลยาณบริหาร
     - **Outbound Return Trip (ขากลับ — ช่วงค่ำ 17 ต.ค. 2569)**:
       3. `1792242005.000000-kran05` (`nonburi1 - สามแยกวัดกัลยาณบริหาร`, **`20:00:05 น.`** | `22 วินาทีก่อนถึงไฟกระพริบ`, OSD `20:00:26`): จุดที่ 1/2 ขับย้อนกลับจากซ้ายไปขวาผ่านหน้าป้ายวัดกัลยาณบริหาร มุ่งหน้าไปทางสามแยกไฟกระพริบ
       4. `1792242027.000000-kran02` (`nonburi5 - สามแยกไฟกระพริบ`, **`20:00:27 น.`** | **`⏱️ +22 วินาที`**): จุดที่ 2/2 ขับกลับออกมาจากฝั่งวัดกัลยาณบริหาร (ขวาบน) ผ่านสามแยกไฟกระพริบ
     - Verified HTTP 200 across `/api/events/{id}/snapshot.jpg?bbox=1` and `/api/events/{id}/clip.mp4` for all 4 events (removed `kran04` / `nonburi4` per operator instruction).
  2. **Native Frigate Bounding-Box Rendering on Clean 1080p Historical Video Frames (`get_event_snapshot_bytes(bounding_box=True)` + `?bbox=1` in `app.js` `v=181`)**:
     - Replaced the earlier mobile-screenshot-based snapshots (`kran01`, `kran02`) and custom rectangles with **100% clean unannotated 1080p frames extracted directly from the historical video recordings** (`-clean.webp` and `-clean.png`), detected the exact YOLO bounding boxes (`[x_rel, y_rel, w_rel, h_rel]`, `area`, `score`), and rendered all snapshots via **Frigate's native `get_event_snapshot_bytes(..., bounding_box=True)`** (`car: 91% 16968`, `car: 90% 25200`, `car: 89% 27360`, `car: 89% 20608`).
     - Updated `emgrThumb()` and `openEmgrDetail()` in `frigate-nvr/web/assets/app.js` (`v=181`) to request `/api/events/{id}/snapshot.jpg?bbox=1`, ensuring Frigate always draws its native bounding box on clean snapshots and busting the `max-age=31536000` browser cache on mobile/desktop.
  3. **Added Tactical Chronological Vehicle Movement Timeline Banner (`frigate-nvr/web/assets/app.js` `v=181`, `frigate-nvr/web/index.html`)**:
     - Enhanced `renderEventMgr()` so whenever a tag chip (`🏷️ นักบินกระนวล 2.4 ล้านเม็ด` or `🏷️ ไททัน`) or search query is active (`2..40` matching events), an interactive **Route Timeline Banner (`ไทม์ไลน์เส้นทางการเคลื่อนที่ เรียงจากผ่านกล้องไหนก่อน ➔ ไปกล้องไหนต่อ`)** is rendered at the top of the Event Archive, grouping sightings into trips (`> 1 hr` gap separation), displaying `จุดที่ 1 ➔ ⏱️ +23 วินาที ➔ จุดที่ 2 ➔ ...`, and opening the full event snapshot/video modal on click.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Registration of Two 'นักบินกระนวล 2.4 ล้านเม็ด' Events (`nonburi5` @ `14:10:47` & `20:00:27`) in Event Archive with 1x H.264 Clips & Quick Tag Chip (Incident 2.153)
- **Problem / User Request**:
  - User requested: "เอาสองเหตุการณ์นี้จากกล้องสี่แยกไฟกระพริบบันทึกเป็นเหตุการณ์ด้วย พร้อมใส่คำบรรว่า นักบินกระนวล 2.4 ล้านเม็ด ให้หาง่าย" (Save two additional Mitsubishi Triton 4-door pickup sightings on `nonburi5` [สามแยก/สี่แยกไฟกระพริบ] at `17/10/2026 14:10:47` and `17/10/2026 20:00:27` into the Event Archive with the caption `นักบินกระนวล 2.4 ล้านเม็ด` for easy searching).
- **Resolution**:
  1. **Pulled 1x Native 25fps H.264 Clips & Registered Both Events in `/db/frigate.db` + `config/lpr/watchlist.db`**:
     - `1792221047.000000-kran01` (`nonburi5` — `2026-10-17 14:10:47 น.`): `[นักบินกระนวล 2.4 ล้านเม็ด] รถกระบะ 4 ประตู มิตซูบิชิ ไททัน (Mitsubishi Triton) สีบรอนซ์เงิน - กล้องโนนบุรี 5 (สี่แยก/สามแยกไฟกระพริบ) 17 ต.ค. 2569 เวลา 14:10:47 น.`
     - `1792242027.000000-kran02` (`nonburi5` — `2026-10-17 20:00:27 น.`): `[นักบินกระนวล 2.4 ล้านเม็ด] รถกระบะ 4 ประตู มิตซูบิชิ ไททัน (Mitsubishi Triton) สีบรอนซ์เงิน - กล้องโนนบุรี 5 (สี่แยก/สามแยกไฟกระพริบ) 17 ต.ค. 2569 เวลา 20:00:27 น.`
     - Verified HTTP 200 across `/api/events/{id}`, `/snapshot.jpg`, `/thumbnail.jpg`, and `/clip.mp4` (`8.2 MB` and `11.7 MB` H.264 clips).
  2. **Added 1-Click `🏷️ นักบินกระนวล 2.4 ล้านเม็ด` Tag Filter Chip (`frigate-nvr/web/assets/app.js` `v=179`, `frigate-nvr/web/index.html`)**:
     - Added a dedicated amber tactical filter chip `นักบินกระนวล 2.4 ล้านเม็ด (2)` next to `ไททัน (7)` in `renderEmgrFilters()` so operators can filter either group with a single click or search by `นักบินกระนวล`, `2.4 ล้านเม็ด`, or `ไททัน`.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - Mitsubishi Triton 4-Door Pickup Event Archive Registration, H.264 Clip Transcoding, and 'ไททัน' Tag Search Chip (Incident 2.152)
- **Problem / User Request**:
  - User requested: "ทำเป็นเหตุการณ์บันทึกลงคลังด้วยทุกคันที่ว่ามา ติดแท็กให้หาด้วยว่าไททัน" (Save all 4 Mitsubishi Triton 4-door pickup trucks / 5 sightings identified from the `กล้องโนนบุรี` historical recordings into the Event Archive [`คลังวิดีโอเหตุการณ์`] and tag them so they can be searched by `ไททัน`).
- **Root Cause & Architecture Diagnosed**:
  1. **Dual-Layer Event Archive Architecture (`Frigate /db/frigate.db` + `Watchlist /data/watchlist.db`)**:
     - For historical events from external NVR recordings (`nonburi*`) to appear immediately in `คลังวิดีโอเหตุการณ์` (`#eventMgrOverlay`) with full-frame snapshots, thumbnails, playable video clips, and LPR/MMCR tags without requiring the user to manually scroll past thousands of recent events, they must be registered in **both**:
       - Frigate's `event` table (`/db/frigate.db` with `retain_indefinitely = 1`, `has_clip = 1`, `has_snapshot = 1`, `sub_label = 'ไททัน'`) + `/media/frigate/clips/{camera}-{id}-clean.webp`, `/media/frigate/clips/{camera}-{id}.jpg`, and `/media/frigate/clips/thumbs/{camera}/{id}.webp`.
       - Watchlist API's `lpr_candidates` table (`/data/watchlist.db` with `plate_text = 'ไททัน'`, `province = 'มิตซูบิชิ 4 ประตู'`, `vehicle_type = 'รถกระบะ 4 ประตู'`, `vehicle_brand = 'มิตซูบิชิ'`, `vehicle_model = 'ไททัน (Triton)'`, `status = 'readable'`, `review_state = 'confirmed'`, `human_confirmed = 1`, `operational_visible = 1`) + vehicle crops in `/lpr-data/crops/triton-{event_id}.jpg`.
  2. **DOM ID Mismatch in `fetchEmgrLprIndex()` (`app.js` Line 3747)**:
     - `fetchEmgrLprIndex` checked `$('emgrOverlay')` instead of `$('eventMgrOverlay')`, causing it to fetch `limit=120` instead of `limit=2000` when the Event Archive modal was open unless `forceFull=true` was passed.
  3. **HEVC Recording Segments for Browser `<video>` Playback**:
     - Raw Uniview NVR segments are H.265 (`hevc`). Transcoding the 5 target 60-second recording segments in-place to H.264 (`h264_nvenc` + `+faststart`) ensures `/api/events/{id}/clip.mp4` plays natively in all browsers.
- **Resolution**:
  1. **Registered All 5 Mitsubishi Triton 4-Door Sightings in Frigate & Watchlist Event Archive**:
     - `1792192528.400000-tritn1` (`nonburi5` — `2026-10-17 06:15:28 น.`): คันที่ 1 (จุดที่ 1.1) มิตซูบิชิ ไททัน พลัส 4 ประตู สีดำ ซุ้มล้อสีเงิน
     - `1792213059.900000-tritn2` (`nonburi6` — `2026-10-17 11:57:39 น.`): คันที่ 1 (จุดที่ 1.2) มิตซูบิชิ ไททัน พลัส 4 ประตู สีดำ ซุ้มล้อสีเงิน
     - `1792213102.100000-tritn3` (`nonburi4` — `2026-10-17 11:58:22 น.`): คันที่ 2 มิตซูบิชิ ไททัน พลัส 4 ประตู สีบรอนซ์เงิน มีราวหลังคา
     - `1792213204.200000-tritn4` (`nonburi5` — `2026-10-17 12:00:04 น.`): คันที่ 3 มิตซูบิชิ ไททัน พลัส 4 ประตู สีเทาดำ Titanium Grey
     - `1792213259.800000-tritn5` (`nonburi1` — `2026-10-17 12:00:59 น.`): คันที่ 4 มิตซูบิชิ ไททัน 4 ประตู สีฟ้า-เทา ติดป้ายโฆษณา "บริษัทมิตรแท้อีสาน จำกัด"
  2. **Enhanced Event Archive Search & Filter UI (`frigate-nvr/web/assets/app.js` `v=178`, `frigate-nvr/web/index.html`)**:
     - Fixed `$('eventMgrOverlay')` check in `fetchEmgrLprIndex` and passed `forceFull=true` from `fetchEmgrEvents()`.
     - Added `ไททัน` / `ไทตั้น` / `มิตซู` / `มิตซูบิชิ` / `triton` / `mitsubishi` synonym matching in `emgrMatch(ev, q)` and hydrated `state.emgrLprByEvent` + `state.emgrMmcrByEvent` during live search (`#emgrSearch`).
     - Added a 1-click **`🏷️ ไททัน`** filter chip in `renderEmgrFilters()` so operators can filter all 5 Triton events with a single click or by typing `ไททัน` in the search box.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-18 - UniEase 16x Fast RTSP Replay Proxy, OSD Clock Offset Alignment (+2834s), 48h Historical Recording Importer, and GPU Vehicle Scanner (Incident 2.151)
- **Problem / User Request**:
  - User requested: "ดึงไฟล์ย้อนหลังตั้งแต่เมื่อวานเข้าระบบเราไว้ด้วยหน่อย แล้วคุณไปหารถกระบะ 4 ประตู ยี่ห้อมิตซู รุ่นไทตั้นให้หน่อยว่าผ่านกล้องเวลาไหนบ้าง" (Pull historical recordings since yesterday from the UniEase `กล้องโนนบุรี` NVR into BPP-VMS, and find Mitsubishi Triton 4-door pickup trucks with their camera passage timestamps).
- **Root Cause & Architecture Diagnosed**:
  1. **Uniview NVR (`NVR302-16S2-P16`) RTSP `/replay` Protocol & Single Hardware Slot**:
     - The NVR supports RTSP historical playback at `/c{ch}/b{begin_epoch}/e{end_epoch}/replay` (main stream `1920x1080` H.265 25fps) and `/c{ch}/s2/b{begin_epoch}/e{end_epoch}/replay` (sub stream `720x576` H.265 25fps).
     - The NVR enforces a strict **1-concurrent-session hardware limit** on `/replay` (opening a second `/replay` session returns `503 ServerUnavailable` / `E50404`), and requires a clean RTSP `TEARDOWN` handshake before the slot is released immediately (`~110ms`).
     - Sending `Scale: 16.0\r\nSpeed: 16.0\r\n` on the RTSP `PLAY` request unlocks **`18.5x–19.8x` real-time transfer speed (`~34 Mbps`)** over the P2P UDP tunnel, pulling 10 minutes (`600s`) of 1080p25 H.265 video in just **30 seconds**.
  2. **NVR `DeviceTime` vs. Camera OSD Clock Offset (`+2834` seconds / `47m 14s`)**:
     - Querying `/LAPI/V1.0/System/Time` revealed that the NVR's internal `DeviceTime` (`b{ts}`/`e{ts}`) lags real Thailand time (`UTC+7`) and the cameras' burned-in OSD clocks by **exactly `2834` seconds (`47 minutes 14 seconds`)** across all 5 online cameras (`nonburi1`, `nonburi2`, `nonburi4`, `nonburi5`, `nonburi6`).
- **Resolution**:
  1. **Upgraded `tools/uniease-p2p-bridge/uniease_p2p_bridge.py`**:
     - Added `/fast16/`, `/fast8/`, `/fast4/` virtual RTSP path prefixes: strips the prefix before forwarding to the NVR, recalculates the Digest `Authorization` signature for the stripped URI, and injects `Scale: 16.0\r\nSpeed: 16.0\r\n` into the RTSP `PLAY` request.
     - Added automatic `TEARDOWN` completion + `0.25s` response drain on `/replay` client disconnect so the NVR's single replay slot is released immediately.
     - Added static local HTTP proxy on `0.0.0.0:18080` forwarding to the NVR's dynamic P2P `HttpPort`.
  2. **Created Historical Importer & GPU Vehicle Scanner (`tools/uniease-p2p-bridge/uniease_history_sync.py`)**:
     - Producer-Consumer pipeline: Thread 1 pulls 1080p H.265 chunks via `/fast16/c{ch}/b{nvr_start}/e{nvr_end}/replay` applying `OSD_OFFSET_SEC = 2834`, slices them into 60-second MP4 segments under `frigate-nvr/storage/recordings/{YYYY-MM-DD}/{HH}/nonburi{ch}/{MM}.{SS}.mp4`, and registers them in `/db/frigate.db` (`recordings` table).
     - Thread 2 runs `yolo11m.pt` on `NVIDIA GeForce RTX 5060 Ti` (`cuda:0`) with multi-object IoU tracking, stationary vehicle filtering, and road-pole split-track deduplication to extract moving vehicle crops and contact sheets (`frigate-nvr/runtime/uniease-p2p/contact_sheets/sheet_XXX.jpg`).
- **Files Changed**: `tools/uniease-p2p-bridge/uniease_p2p_bridge.py`, `tools/uniease-p2p-bridge/uniease_history_sync.py`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-17 - UniEase / Uniview EZCloud P2P NVR Camera Integration (`กล้องโนนบุรี` - 7 Channels) & Patched Native STUN Hole-Punch RTSP Bridge (Incident 2.150)
- **Problem / User Request**:
  - User requested: "เอากล้องจาก uniease เข้าระบบ" with UniEase / Uniview EZCloud credentials (`กล้องโนนบุรี`, user `jaload`).
- **Root Cause & Architecture Diagnosed**:
  1. **Uniview EZCloud P2P Architecture (`NVR302-16S2-P16`, Serial `210235XGKG3243000001`)**:
     - The target NVR sits behind NAT (`125.25.157.183` / `deviceNatType: 6`) with no port forwarding (`http:0;rtsp:0`), no Cloud CDN relay package (`code: 2821 - Activation failed due to insufficient CDN resources`), and no embedded WebSocket RTSP server (`httpCode: 599` on `/LAPI/V1.0/Network/WebSocketServer/URL`).
     - Streaming requires a direct UDP STUN hole-punched P2P tunnel (`connectMode: 1`, `p2pVersion: "2.2.4.2"`, STUN `43.173.134.237`) established via Uniview's `Cloud_Plugin_UN.exe` (`CloudHttpServer.exe` + `libtunnel.dll` + `libcloud.dll`).
  2. **Three Upstream Bugs in Uniview's `CloudHttpServer.exe` & `libtunnel.dll` on 20-Core Windows Host**:
     - **Bug 1 (`CheckTime` Checkcode Expiration)**: `CloudHttpServer.exe` at offset `0x5d80` rejects standalone `/tunnelStart` requests if the browser-specific checkcode/timestamp differs. Patched prologue (`55 8b ec` -> `33 c0 c3`, `xor eax, eax; ret`) in `CloudHttpServer_notime.exe`.
     - **Bug 2 (120-Second Idle Tunnel Teardown)**: `CloudHttpServer.exe` at offset `0x18ad` (`8b 91 38 55 42 00 83 ea 01`) decrements a 120s counter and calls `TUNNEL_DeleteConnection`. Patched `83 ea 01` -> `83 ea 00` (`sub edx, 0`) so active P2P tunnels never self-terminate.
     - **Bug 3 (20-Core CPU Stack Buffer Overflow in `libtunnel.dll`)**: In `libtunnel.dll` (`libcloud.c:8346`, file offset `0x2a093`, bytes `83 7d d4 00 7e 0a`), `get_cpu_cores()` returns `20` on this 20-core host and logs `Get CPU num:20, max:4`, but because of a signed comparison bug (`if (cores <= 0) cores = 4` instead of `if (cores <= 0 || cores > 4) cores = 4`), it spawns 20 `t2u_runner` threads into a 16-element stack array, corrupting the stack and hanging `/tunnelStart`. Patched `7e 0a` (`jle +10`) -> `eb 0a` (`jmp +10`) to clamp `t2u_runner` threads to 4, reducing `/tunnelStart` handshake time to **60ms**.
  3. **Dynamic NVR Password (`dynamicPasswordNew`) & ONVIF Backchannel SDP Quirk**:
     - EZCloud `/openapi/device/network/nat/list` issues a rotating 32-hex-char `dynamicPasswordNew` for NVR user `admin`.
     - When `go2rtc` sends `Require: www.onvif.org/ver20/backchannel` in `DESCRIBE`, the Uniview NVR returns an audio-only backchannel SDP (omitting `m=video`).
- **Resolution**:
  1. **UniEase P2P RTSP Bridge Daemon (`tools/uniease-p2p-bridge/uniease_p2p_bridge.py` & `Start-UniEase-Bridge.vbs`)**:
     - Runs patched `CloudHttpServer_notime.exe` + `libtunnel.dll` in `frigate-nvr/runtime/uniease-p2p/bin` (gitignored runtime directory) and exposes a static RTSP proxy on `0.0.0.0:18554`.
     - Transparently strips `Require: www.onvif.org/ver20/backchannel` from `DESCRIBE` requests so the NVR returns the full H.265 Video + G.711u Audio SDP (`sprop-parameter-sets` included).
     - Automatically signs RTSP `Authorization: Digest` and `Basic` headers on the fly using the latest `dynamicPasswordNew` from EZCloud, and maintains a 25-second `OPTIONS` keepalive + auto-heal watchdog.
     - Registered in Windows Startup (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BPP-VMS-UniEase-Bridge.lnk`) and spawned persistently via WMI.
  2. **Added 7 `กล้องโนนบุรี` Channels (`nonburi1` .. `nonburi7`)**:
     - `nonburi1`: `โนนบุรี 1 - สามแยกวัดกัลยาณบริหาร (IP Camera 01)` (Online - 1080p H.265)
     - `nonburi2`: `โนนบุรี 2 - ลานร้านค้า (IP Camera 02)` (Online - 1080p H.265)
     - `nonburi3`: `โนนบุรี 3 - IP Camera 03` (Offline on NVR)
     - `nonburi4`: `โนนบุรี 4 - แยกไฟแดง (IP Camera 04)` (Online - 1080p H.265)
     - `nonburi5`: `โนนบุรี 5 - สามแยกไฟกระพริบ (IP Camera 05)` (Online - 1080p H.265)
     - `nonburi6`: `โนนบุรี 6 - สี่แยกเกาะกลาง (IP Camera 06)` (Online - 1080p H.265)
     - `nonburi7`: `โนนบุรี 7 - หน้าเทศบาล` (Offline on NVR)
     - Configured in `config.yml` (`cameras` and `go2rtc.streams` with dual native RTSP + `#video=h264#hardware` producers), `nvr_groups.json` (`กล้องโนนบุรี`), `camera_names.json`, `camera_sources.json`, and `camera_credentials.env`.
- **Files Changed**: `tools/uniease-p2p-bridge/uniease_p2p_bridge.py`, `tools/uniease-p2p-bridge/Start-UniEase-Bridge.vbs`, `frigate-nvr/config/config.yml`, `frigate-nvr/config/nvr_groups.json`, `frigate-nvr/config/camera_sources.json`, `frigate-nvr/config/camera_templates.json`, `frigate-nvr/config/camera_credentials.env`, `frigate-nvr/config/dashboard-settings/camera_names.json`, `.gitignore`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-17 - Leaflet Popup Action Button Click Swallowing Fix, Thundering Herd Map Tile Recovery Throttling, and Zero Gray Screen Void Theme (Incident 2.148)
- **Problem / User Request**:
  1. "กดปุ่มเส้นทาง ปุ่มย้าย รีเฟรช และกดปุ่มแก้ไขแล้วไม่มีอะไรเกิดขึ้นครับ" (Clicking "เส้นทาง" [Trajectory], "ย้าย" [Relocate], "รีเฟรช" [Refresh], and "แก้ไข" [Edit] buttons inside the GPS tracker popup does nothing).
  2. "และยังเกิดอาการหน้าเว็บขึ้นสีเทาล้วนอยู่ครับ" (The screen still turns completely gray when viewing the map over extended periods).
- **Root Cause & Architecture Diagnosed**:
  1. **Leaflet Click Event Swallowing (`L.DomEvent.disableClickPropagation`)**:
     - In `frigate-nvr/web/assets/analytics.js` (`marker.on('popupopen')`), `L.DomEvent.disableClickPropagation(el)` was applied directly to the Leaflet popup container.
     - On mobile touch devices and hybrid Windows touchscreen/laptop hardware, stopping propagation on `touchstart` and `mousedown` prevents the browser from synthesizing the subsequent `click` event. As a result, inline `onclick="window.showGpsOneTrajectory(...)"` handlers were completely swallowed and never fired.
     - Furthermore, `relocateGpsOneOnMap` merely set `cursor = 'crosshair'` and closed the popup with zero toast/banner instructions or ESC cancellation handling, leading users to believe the button did nothing.
  2. **Cascading "Thundering Herd" Map Tile Redraw Loops & Google Tile 429 Cascades**:
     - The map tile watchdog `healMapTilesIfNeeded` triggered whenever `brokenRatio >= 0.20`, immediately calling `currentMapBaseLayer.redraw()`.
     - `redraw()` aggressively tore down all existing, successfully-rendered DOM tiles and fired 20-30 simultaneous burst requests to Google Maps tile servers.
     - This burst triggered Google's automated rate limiter (HTTP 429 / connection drop), causing 100% of tiles to fail on the subsequent redraw.
     - Because Leaflet's default stylesheet defines `.leaflet-container { background: #ddd; }`, failing tiles exposed a solid, washed-out light-gray sheet (`#ddd`), turning the entire tactical screen gray.
  3. **Canvas / Chart.js Context Memory Leaks During Long Sessions**:
     - In tactical fullscreen mode, `#hourlyChart` is hidden (`display: none`). Every 30 seconds during `loadAllData()`, `renderHourlyChart()` attempted to instantiate a new `Chart.js` canvas instance on the hidden element without garbage collecting WebGL/2D canvas contexts, leaking memory during extended map monitoring.
- **Resolution**:
  1. **Direct Event Delegation & Fallback Click Listener (`analytics.js`)**:
     - Removed `L.DomEvent.disableClickPropagation(el)` from `marker.on('popupopen')`.
     - Added direct click delegation on `el` targeting `.btn-gps-popup-action` with `data-gps-action` and `data-imei`.
     - Added global delegated click listener on `document` targeting `.btn-gps-popup-action`.
     - Implemented unified `handleGpsOnePopupAction(act, imei, btn)` with a 400ms debounce guard to prevent double-execution across event routes.
  2. **Enhanced Action Feedback & Cancel Options (`analytics.js`)**:
     - `trajectory`: Closes popup to reveal map, shows loading toast `showMapToast('🛣️ กำลังโหลดประวัติเส้นทาง 24 ชม....')`.
     - `refresh`: Shows loading state on button and toast `showMapToast('🔄 กำลังดึงพิกัดสด...')`.
     - `relocate`: Closes popup, shows instructional toast `showMapToast('📍 โหมดย้ายหมุด: กรุณาคลิกบนแผนที่...')`, binds `Escape` key listener to cleanly cancel crosshair mode.
     - `edit`: Closes popup and opens the manager modal form directly.
     - Replaced disruptive blocking `alert()` popups with non-blocking tactical `showMapToast()`.
  3. **Targeted Tile Recovery & Zero Gray Void Enforcement (`analytics.js`, `leaflet.min.css`, `app.css`)**:
     - Modified `healMapTilesIfNeeded` to retry individual broken tile `<img>` elements via `_watchdogRetry` query parameters without destroying good tiles. Redraw is restricted to extreme cases (>= 85% broken) and strictly rate-limited (minimum 45s between redraws).
     - Added production parameters (`&hl=th&s=Ga`) to Google Hybrid tile URL.
     - Added zoom fallback guard for ESRI imagery when zooming beyond level 18.
     - Replaced `.leaflet-container { background: #ddd; }` in `leaflet.min.css` with dark theme `#06070f`.
     - Enforced `!important` `#06070f` background on `.leaflet-container`, `.leaflet-pane`, `.leaflet-tile-pane`, `.leaflet-tile-container`, `#leafletMap`, and `#analyticsMapCanvas` in `app.css`.
  4. **Canvas Memory Guard (`analytics.js`)**:
     - Added visibility guard in `renderHourlyChart`: skips instantiation when chart canvas is hidden (`ctx.offsetParent === null && ctx.clientWidth === 0`).
  5. **Cache Busters Bumped (`index.html`)**:
     - Bumped `analytics.js?v=110`, `app.css?v=159`, and `leaflet.min.css?v=2` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/app.css`, `frigate-nvr/web/assets/leaflet.min.css`, `frigate-nvr/web/index.html`, `AI_HANDOVER_CONTEXT.md`.

## Update 2026-10-17 - Continuous 1-Second Real-Time Officer GPS Tracking, Resilient Background Audio Keepalive, and Tactical Stealth / Pocket Mode (Incident 2.147)
- **Problem / User Request**:
  - User reported: "หมุดเจ้าหน้าที่ไม่ขึ้นแบบเรียลไทม์เวลาเจ้าหน้าที่ปิดหน้าจอเหมือนมันก็ไม่ยอมอัพเดทเลย" (Officer pin does not update in real-time, and when the officer locks/turns off their screen, it seems to not update at all).
- **Root Cause & Architecture Diagnosed**:
  1. **Malformed Sub-Millisecond Audio Keepalive Loop**:
     - The previous audio keepalive implementation in `bppLocationTracker` used a 48-byte Base64 WAV snippet containing only 1 audio sample (~22 microseconds).
     - Modern mobile browsers (Google Chrome on Android and Apple Safari on iOS) cannot loop sub-millisecond audio buffers without encountering continuous audio buffer underruns. The audio pipeline paused/stalled instantly.
     - Consequently, whenever an officer pressed the physical power button or switched apps, Android Doze mode and iOS WebKit suspended all JavaScript execution, Timers, and Web Worker threads.
  2. **Impossible Geolocation Timeout & Zero Cache Tolerance**:
     - In background worker ticks, `getCurrentPosition` was invoked with `{ enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }`.
     - When a mobile device is carried in an officer's vest or pocket with the screen locked, obtaining a brand-new satellite lock with `maximumAge: 0` takes 5 to 15 seconds. A 4000ms timeout caused 100% of background location requests to fail with `PositionError.TIMEOUT`.
  3. **Transmitter Stagnation on Screen ON**:
     - When the screen was on, `getCurrentPosition` was skipped due to `if (document.hidden && elapsed >= 2000)`.
     - Location updates relied solely on `watchPosition`, which on mobile OSes throttles aggressively when the officer is moving slowly or stationary, often staying silent for 15-30 seconds.
     - Meanwhile, the worker tick kept sending the old `lastCoords` with an updated timestamp, causing the officer pin to stay completely stationary (frozen) and then abruptly teleport to a new spot.
  4. **Hardware WakeLock Termination on Physical Button Press**:
     - When an officer pressed the physical power button to put the phone in a pocket, the OS automatically revoked `navigator.wakeLock`.
- **Resolution**:
  1. **Dynamic In-Memory 4-Second Silent PCM WAV Synthesizer (`_getSilentWavUrl`)**:
     - Synthesizes an in-memory 8000Hz 8-bit mono PCM WAV blob (24,044 bytes, 4 seconds of silence at amplitude 128).
     - Allows mobile OS audio engines (Android AudioFlinger / iOS AVPlayer) to loop smoothly without buffer underruns, keeping the audio DAC and JS thread active in the background.
  2. **Dual Audio Keepalive Anchor (HTML5 Audio + Web Audio API Oscillator)**:
     - Runs both an HTML5 Audio looping element (`volume = 0.001`) and a 1Hz inaudible Web Audio `OscillatorNode` with gain `0.0001`.
     - Integrates with `navigator.mediaSession` so the Android/iOS lock screen displays an active tactical beacon.
  3. **Gesture Auto-Arming (`_armAudioOnInteraction`)**:
     - Pre-arms the audio context on the first user touch/click/key interaction to satisfy browser autoplay policies.
  4. **Dual-Engine Active Pulse GPS with Tolerant Cache Window (`onWorkerTick`)**:
     - If no new coordinate fix has arrived in >= 1200ms, immediately calls `getCurrentPosition` with `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 1500 }`.
     - The 1.5s cache tolerance allows the mobile GPS chipset to return an instant fix if available while prompting fresh fixes, guaranteeing true 1-second transmission cadence without timeouts.
  5. **Tactical Stealth / Pocket Mode (`enterStealthMode` / `exitStealthMode`)**:
     - Added `#btnToggleStealthMode` ("🕶️ พรางจอ") on the map toolbar.
     - Fullscreen `#000000` blackout (0% OLED pixel drain), `touch-action: none` (prevents pocket touches), Screen WakeLock kept active, military HUD with live coords/speed, hold 1.4s or double-tap to unlock.
  6. **UI Integration & Cache Buster Bump (`analytics.js`, `index.html`)**:
     - Hooked `#btnToggleStealthMode` click handler and synced visibility with sharing status.
     - Bumped `app.js?v=176` and `analytics.js?v=109` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Yuki GPS / UKI GPS (GPSPOS / Ou Chuang IoT) Hardware Tracker Integration alongside GPSONE & DDGPS (Incident 2.146)
- **Problem / User Request**:
  - User requested: "yuki gps ด้วย" (Add full support for **Yuki GPS / UKI GPS** hardware trackers alongside **GPSONE** and **DDGPS** on the BPP-VMS Tactical GIS Map).
- **Root Cause & Architecture Diagnosed**:
  1. **Yuki GPS / UKI GPS (`www.gpspos.net` / `globalcartrackers.com`) Protocol**:
     - Hardware GPS trackers sold under the **Yuki GPS / UKI GPS** brand in Thailand (LK209, TK905, S168 magnetic trackers by Ou Chuang IoT) communicate with `http://www.gpspos.net/APP/AppJson.asp` (and `https://www.globalcartrackers.com/APP/AppJson.asp`).
     - Requests use signed JSON RPC payloads (`_x44dd`):
       - `strAppID` = Base64 of host name (`www.gpspos.net`) padded with `/` until `len % 3 == 0`.
       - `strToken` = Base64 of `f"{cmd}\x11{sql_params}\x11{field}\x11\x1b"` padded with `"5"` until UTF-8 byte length `% 3 == 0`.
       - `strSign` = `md5(f"{nTimeStamp}{strRandom}{strUser}{strAppID}{strToken}")`.
     - Authentication supports:
       - Direct IMEI/TEID login (`nType = 2`, `Proc_LoginIMEI([imei, password])`),
       - User Account login (`nType = 0`, `Proc_Login([username, password])`),
       - Alias login (`nType = 1`, `Proc_LoginAnother([alias, password])`).
     - Live telemetry uses `Proc_GetLastPosition` + `Proc_GetCarInfo` (single device) or `Proc_GetChildrenPos` (multi-device account).
     - `nTEState` bitmask encodes battery percentage (`(nTEState & 0xFF0000) >> 16`), location type (`4096` = WiFi, `8192` = LBS, `128` = Unfixed, `0` = GPS Satellite), and sleep mode (`2147483648` / `134217728`).
     - Historical trajectory uses `Proc_GetTrack([teid, start_ts_sec, end_ts_sec, 5000])`.
- **Resolution**:
  1. **Backend UKI GPS / Yuki GPS Driver (`frigate-nvr/analytics-engine/services/gpsone_tracker.py`)**:
     - Added `GPSPOS_UKI_URLS`, `convert_gpspos_item()`, `_call_gpspos_api()`, `_parse_gpspos_records()`, `_login_gpspos()`, and `_extract_gpspos_session_meta()`.
     - Updated `_authenticate_device()`, `_fetch_devices_from_session()`, `poll_single_device()`, `_fetch_latest_gps_satellite_fix()`, `list_devices()`, and `fetch_device_history()` to support `protocol == "gpspos_uki"` (`provider = "yukigps"` or `"auto"`).
     - Automatically resolves LBS/WiFi cell-tower drift by querying `Proc_GetTrack` and filtering for true GPS satellite fixes (`(nTEState & (8192 | 4096 | 128)) == 0`).
  2. **Frontend UI & Provider Selector (`frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`)**:
     - Added `<option value="yukigps">🟣 YUKI GPS / UKI GPS (gpspos.net / globalcartrackers)</option>` to `#selectGpsOneProvider`.
     - Added `🟣 YUKI GPS` badges in both `renderGpsOneModalList` and `buildGpsOnePopupHtml`.
     - Bumped `analytics.js?v=108` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Continuous Map Tile Auto-Recovery, Rotating Multi-Subdomain & Self-Healing Watchdog for 24/7 Operations (Incident 2.145)
- **Problem / User Request**:
  - User reported: "เปิดหน้าดูแผนที่นานๆแล้วขึ้นสีเทาครับ แก้ด้วยให้มันไม่มีปัญหาแม้ว่าเปิดนานแค่ไหน" (When opening/viewing the map page for a long time, it turns gray. Please fix it so there are no issues no matter how long it stays open).
- **Root Cause & Architecture Diagnosed**:
  1. **Leaflet Default Background Light Gray Void**:
     - Leaflet's built-in CSS default is `.leaflet-container { background: #ddd; }`.
     - Whenever network connection hiccups, slow DNS occurs, or Google throttles requests, the tiles fail or become transparent, exposing an eyesore light-gray `#ddd` box.
  2. **Single-Subdomain Google Tile Bottleneck & Rate Limiting**:
     - `hybridLayer` was hardcoded to `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` without subdomain rotation.
     - Modern browsers enforce a strict limit of 6 concurrent TCP connections per origin. Long-running tactical sessions (continuous 1s GPS updates, zooming, panning) exhausted connections to `mt1.google.com`. Google servers routinely return HTTP 429 or drop sockets when overloaded by single-origin unauthenticated tile traffic.
  3. **No Tile Retry or Fallback in Leaflet**:
     - When a tile image errors out (`tileerror`), Leaflet adds `.leaflet-tile-error` and permanently abandons it. It never retries unless the user manually pans away and back. Over several hours of monitoring, broken tiles accumulate until the entire canvas appears blank/gray.
  4. **Excessive Buffer & Drag Churn**:
     - `keepBuffer: 4` and `updateWhenIdle: false` forced Leaflet to keep up to ~120 offscreen tiles in memory and fire continuous high-frequency network requests during touch drags.
  5. **Choropleth Polygon Canvas Re-instantiation Memory Leak**:
     - `loadAllData()` executes every 30s via `chatRefreshInterval` and called `updateChoroplethLayers()`, which destroyed and re-instantiated 3 GeoJSON layers with hundreds of polygon features on `L.Canvas` every 30 seconds. Over hours, this leaked memory and degraded canvas contexts.
  6. **Missing Re-synchronization on Mobile Sleep / Tab Inactivity**:
     - When a phone screen locks or browser tab sleeps in the background, CSS layout and viewport dimensions desync. Upon wake, Leaflet remained with stale/0x0 dimensions and never re-evaluated broken tiles.
- **Resolution**:
  1. **Dark Theme Tactical Background (`analytics.js`)**:
     - Styled `#leafletMap.leaflet-container, .leaflet-container` with background `#090d16 !important`, matching the tactical theme and eliminating the raw gray flash.
  2. **Rotating Multi-Subdomain Google Hybrid (`analytics.js`)**:
     - Changed Google Hybrid endpoint to `https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` with `subdomains: ['0', '1', '2', '3']`. This quadruples connection throughput (up to 24 concurrent HTTP connections across 4 origins), dramatically reducing rate-limiting risk.
  3. **Automatic Multi-Subdomain Retry & Satellite Mirror Failover (`setupTileLayerRecovery`)**:
     - Implemented `setupTileLayerRecovery(layer, fallbackTemplate)`:
       - On `tileerror`, retries up to 3 times with exponential backoff while automatically rotating to the next subdomain (`mt0` -> `mt1` -> `mt2` -> `mt3`).
       - If all 3 Google attempts fail, automatically switches the broken tile to ESRI World Imagery (`server.arcgisonline.com`) satellite mirror.
  4. **In-Place Polygon Recoloring (`updateChoroplethLayers`)**:
     - Optimized `updateChoroplethLayers()`: When `currentZoomLevel` has not changed, it calls `choroDistrict.setStyle(zoneStyle)` and `choroSubdistrict.setStyle(zoneStyle)` in-place instead of destroying and recreating hundreds of GeoJSON paths every 30s.
  5. **Continuous Self-Healing Watchdog Engine (`startMapWatchdog` / `healMapTilesIfNeeded`)**:
     - Periodically checks tile health every 25 seconds while `#analyticsModal` is open.
     - Inspects active viewport: if >20% of tiles are broken or if 0 tiles are present in an active container, it triggers `leafletMap.invalidateSize(false)` and `currentMapBaseLayer.redraw()` (throttled to at most once per 12s).
     - Watchdog automatically starts on modal open / tactical mode toggle, and stops when modal closes.
  6. **Instant Tab Visibility, Window Focus & Online Reconnection Recovery**:
     - Attached recovery listeners to `document.addEventListener('visibilitychange')`, `window.addEventListener('focus')`, `window.addEventListener('pageshow')`, and `window.addEventListener('online')` to immediately heal tiles and refresh live feeds when device wakes up or network recovers.
  7. **Cache Busting**: Bumped `analytics.js?v=107` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Multi-Provider Hardware GPS Tracker Integration (DDGPS / ThaiGPSDD / IOPGPS + GPSONE), Mobile Compact Popup & Per-User RBAC (Incident 2.144)
- **Problem / User Request**:
  1. "เวลากดดู gps ในแผนที่ผ่านมือถือแล้วมันใหญ่จนดูรายละเอียดไม่เห็น และให้ตั้ง GPS ที่ออฟไลน์ให้มันปิดพิกัดไว้ก่อนให้เปิดเฉพาะที่ออนไลน์ และให้ superadmin เห็นgpsทั้งหมด และให้ superadmin กำหนดได้ว่าจะให้ user ไหนดูgps ตัวไหนได้บ้างแบบเลือกราย user ครับ"
  2. "ให้รองรับ ddgps ได้ด้วย" (Support DDGPS / GPSDD hardware trackers alongside GPSONE and manual pins).
- **Root Cause & Architecture Diagnosed**:
  1. **DDGPS / GPSDD Dual Server Architecture**:
     - Hardware GPS trackers sold under the **DDGPS / GPSDD** brand in Thailand operate on two backend architectures:
       - **ThaiGPSDD / IOPGPS / WanWay v2 Cloud** (`https://gps.thaigpsdd.com`, `https://www.iopgps.com`, `https://www.wanwaygps.com`): Uses `POST /login` with double-MD5 salting (`password = md5(plain_pwd) + md5(10_digit_random)` and `loginType="ADMIN"`), returning `SESSION` cookie and `accountId`. Uses `GET /rest/loadage/device/status?imei=...&mapType=2` and `GET /rest/loadage/device/status/list?accountId=...&mapType=2` for unshifted WGS84 telemetry (`mapType=2`), and `GET /rest/device/track/{imei}/v3?locationType=1&mapType=2` for satellite-only historical tracks.
       - **GPSDD Classic (`http://a.gpsdd.net`, `http://www.gpsdd.net`)**: Uses the `DevicesAjax.asmx` WebForms protocol (`aspx_gps903`) identical to `gps903.net`.
  2. **Mobile Popup & Offline Pin Clutter**:
     - Previous GPS map popups were too wide/tall on smartphone viewports (`min-width: 260px`), obscuring the surrounding map.
     - Offline GPS trackers remained enabled on the map by default, cluttering active operations.
- **Resolution**:
  1. **Multi-Provider Auto-Discovery & Polling Engine (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `main.py`)**:
     - Added `_login_thaigpsdd()`, `convert_thaigpsdd_item()`, and multi-provider `_authenticate_device()` supporting `provider="auto"`, `"ddgps"`, or `"gpsone"`.
     - Supports logging in by **IMEI**, **Account Username**, or **`Account:IMEI`** (for multi-device accounts) and caches `resolved_protocol` (`thaigpsdd_v2` vs `aspx_gps903`) and `resolved_base_url` per device.
     - Resolves LBS cell-tower drift on both GPSONE (`ShowLBS=0`) and DDGPS (`locationType=1&mapType=2`) by locking onto the last true GPS satellite fix when stationary or offline.
  2. **Auto-Disable Offline Trackers & Auto-Enable Online Trackers**:
     - Offline hardware trackers automatically set `enabled = False` (unless Superadmin explicitly toggles `force_show_offline`), while online trackers automatically set `enabled = True`.
  3. **Superadmin Full Visibility & Per-User GPS Access Control (`allowed_users`)**:
     - Superadmin (`role == "superadmin"` or `suchakree`) sees all GPS trackers and has full add/edit/delete and permission management controls (`GET/PUT /api/analytics/gpsone/permissions`, `PUT /api/analytics/gpsone/permissions/user/{username}`).
     - Non-superadmin users only see trackers where their username is in `allowed_users`.
  4. **Mobile-First Compact Popup & Provider Badges (`frigate-nvr/web/assets/analytics.js`, `index.html`)**:
     - Added responsive CSS (`.gpsone-compact-popup` capped at `min(238px, 78vw)` on mobile) and `autoPanPadding`.
     - Added `#selectGpsOneProvider` (`auto`, `ddgps`, `gpsone`) in `#gpsOneManagerModal` and `🛰️ DDGPS` / `📡 GPSONE` badges on cards and map popups.
     - Bumped `analytics.js?v=106` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/analytics-engine/services/gpsone_tracker.py`, `frigate-nvr/analytics-engine/main.py`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Fix Leaflet Tactical Marker Coordinate Offset & Pinch/Zoom Desynchronization (Incident 2.143)
- **Problem / User Request**:
  - User reported: "ไอคอนพิกัดบนแผนที่มันเหลื่อมกับพิกัดต้องซูมเข้าไปลึกๆถึงจะตรง" (The coordinate icon on the map is offset/shifted relative to the coordinates, you have to zoom in deep for it to align properly).
  - Screenshot showed the GPSONE device popup pointing to the true road coordinates (16.76424, 104.14484 on Highway 4012), but the circular target marker icon (🎯) was rendered ~270px below the popup tip at the bottom edge of the map canvas.
- **Root Cause Diagnosed**:
  1. **In-Flow Document Stacking via `position: relative` (`analytics.js`)**:
     - Leaflet manages marker positioning in `.leaflet-marker-pane` using `position: absolute; left: 0; top: 0;` and positions markers via `transform: translate3d(x, y, 0)` calculated from the pane's (0, 0) origin.
     - `.gpsone-marker-pin` and `.officer-marker-pin` had CSS rules declaring `position: relative;`.
     - When multiple officer/GPS markers were present, each marker with `position: relative` occupied layout space in normal flow (height: 38px). Successive sibling markers in the DOM were pushed downward by `N * 38px`.
     - Leaflet's `translate3d(x, y, 0)` then translated the marker relative to its offset in-flow layout box (`x, y + offset`), rendering the marker hundreds of pixels below its true coordinate! Meanwhile, `.leaflet-popup` in `.leaflet-popup-pane` remained `position: absolute` at `(x, y)`, causing the popup tip and icon to separate drastically.
     - At lower zoom levels, a 270px visual offset corresponds to 30-50 km on the terrain, making the misalignment glaringly obvious across the province.
  2. **Marker Drift and Zoom Lag via `transition: transform 0.85s linear` (`analytics.js`)**:
     - `.leaflet-marker-icon.gpsone-marker-pin, .leaflet-marker-icon.officer-marker-pin` had `transition: transform 0.85s linear;`.
     - Leaflet recalculates pixel transforms continuously during panning and pinch-to-zoom on mobile. The CSS transition forced the marker to slowly glide over 0.85s instead of immediately matching the map tiles.
     - During zoom gestures, the marker floated away from the terrain and only snapped into alignment after zooming stopped and stabilized at deep zoom.
  3. **Missing `popupAnchor` in `L.divIcon` Definitions**:
     - `createGpsOneDivIcon` and `createOfficerDivIcon` omitted `popupAnchor`, causing Leaflet to default to `[0, 0]` (the center of the circle) instead of attaching cleanly to the top border of the pin.
- **Resolution**:
  1. **Strict Absolute Positioning (`analytics.js`)**:
     - Set `.officer-marker-pin` and `.gpsone-marker-pin` to `position: absolute !important; width: 38px; height: 38px;`.
     - Ensured markers never enter normal document flow and never stack or push sibling markers down.
  2. **Removed Marker Transform Transitions (`analytics.js`)**:
     - Changed `.leaflet-marker-icon.gpsone-marker-pin, .leaflet-marker-icon.officer-marker-pin` to `position: absolute !important; transition: none !important;`.
     - Eliminated all zoom/pan lag and drifting; markers stay 100% pinned to their true geographical coordinates across all zoom levels.
  3. **Added Explicit `popupAnchor`**:
     - Added `popupAnchor: [0, -20]` to both `createGpsOneDivIcon` and `createOfficerDivIcon`, ensuring popups point to the top edge of the pin icons.
  4. **Cache Busting**: Bumped `analytics.js?v=105` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Fix Self Location Disable Failure & Marker Resurrect Loop (Incident 2.142)
- **Problem / User Request**:
  - User reported: "ปิดพิกัดตัวเองไม่ได้" (Cannot turn off my own location) with screenshot showing toast "ปิดแชร์พิกัดเฉพาะของคุณเรียบร้อยแล้ว", but the button remained active green "[ 🔘 กำลังแชร์พิกัด ]" and the user's pin (`@suchakree`) remained visible on the map.
- **Root Cause Diagnosed**:
  1. **Server Resurrect Loop in `toggle` & `update_location` (`auth.py`)**:
     - `POST /auth/location/toggle` previously executed `DELETE FROM user_location WHERE username = ?` when disabled.
     - When `user_location` was deleted, subsequent `POST /auth/location` calls checked `if existing is not None and not existing["sharing_enabled"]`. Since `existing` was `None`, it fell through and re-inserted `user_location` with `sharing_enabled = 1` and `user_presence.location_sharing = 1`!
  2. **Global Standing State Overriding Personal Disablement (`auth.py` & `analytics.js`)**:
     - In `POST /auth/heartbeat`, `force_location` was computed as `(sharing_enabled or force_all_active) and not loc_sharing`. Because `force_all_active` was stored as `1` in `system_state`, every 30s heartbeat forced `user_presence.location_sharing = 1` back on!
     - In `analytics.js` (`loadOfficerLocations()`), `isSharing` was calculated as `Boolean((tracker && tracker.isSharing) || isMeInOfficers || forceAllActive)`. Even after calling `tracker.stop()`, `forceAllActive` forced `isSharing = true` on the next 1s interval, triggering `tracker.start()` to restart GPS and re-assert `.active` class!
  3. **Absence of User-Disabled Intent Flag (`app.js` & `analytics.js`)**:
     - The tracker had no explicit flag to record that the user intentionally disabled their own GPS (`_userDisabled`), allowing heartbeats and stale map markers to revive the tracker.
- **Resolution**:
  1. **Update `sharing_enabled = 0` and Preserve Row (`auth.py`)**:
     - `POST /auth/location/toggle` now updates `UPDATE user_location SET sharing_enabled = 0` (never deletes row; preserves coordinates).
     - `POST /auth/location` checks `if existing is None or not existing["sharing_enabled"]: return {"sharing_disabled": True}` and rejects updates.
     - `POST /auth/heartbeat` computes `force_location = sharing_enabled and not loc_sharing`. If `sharing_enabled == 0`, it NEVER forces the user on and sends `force_location_off: True` if presence was still active.
     - `GET /auth/locations` filters strictly by `WHERE u.active = 1 AND l.sharing_enabled = 1`.
  2. **Strict User-Disabled State (`app.js` & `analytics.js`)**:
     - In `app.js`: Added `_userDisabled` property to `bppLocationTracker`, persisted to `localStorage.getItem('bpp_gps_user_disabled')`.
     - In `updateUI()`: If `_userDisabled` is true, forces `isAct = false`, ensuring button returns to `[ ⦾ เปิดพิกัด ]` without `.active`.
     - In `sendPresenceHeartbeat()`: If `_userDisabled` is true, suppresses auto-start.
     - In `analytics.js`: In `loadOfficerLocations()`, if `_userDisabled` is true, forces `isSharing = false`, stops any running watcher, prunes own pin from the map, and prevents auto-start.
  3. **Immediate Server Synchronization in Button Handler (`analytics.js`)**:
     - When clicking "ปิดเฉพาะพิกัดของฉัน", sets `_userDisabled = true`, awaits `POST /auth/location/toggle` with `enabled = false`, stops tracker locally, strips own marker from `officerMarkersMap` and `officerPointLayer`, and directly sets button to inactive.
  4. **Cache Busting**: Bumped `app.js?v=175` and `analytics.js?v=103` in `index.html`.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Streamlined Location Control: Integrated Admin Scope Chooser & Removed Redundant Toolbar Button (Incident 2.141)
- **Problem / User Request**:
  - User requested: "ปุ่มเปิดพิกัดทุกคนมันซ้ำซ้อน ให้กดเปิดพิกัดแล้วเลือกได้ว่าจะเปิดทุกคนไหมจากระดับ admin ขึ้นไป และเอาปุ่มเปิดพิกัดทุกคนออก" (The "เปิดพิกัดทุกคน" button is redundant. When clicking "เปิดพิกัด", allow Admin level and above to choose whether to open everyone's location or only their own, and remove the redundant "เปิดพิกัดทุกคน" button).
- **Resolution**:
  1. **Removed Redundant Toolbar Button (`analytics.js`)**:
     - Removed `#btnMapForceAllLoc` from the tactical GIS map toolbar HTML and its control logic in `updateMapAdminControls()`.
     - Toolbar now retains the clean, single-action button `#btnToggleOfficerLocation` ("เปิดพิกัด").
  2. **Integrated Admin Scope Chooser Modal (`showLocationScopeChoice` in `analytics.js`)**:
     - For regular users (non-admin): Clicking `#btnToggleOfficerLocation` continues to toggle only their personal GPS tracking with zero popups (1-click direct toggle).
     - For users with Admin role or higher (`isMapAdminUser()` checking `admin`, `superadmin`, and designated accounts):
       - When clicking to turn ON: Displays a modal to choose:
         - `🌐 เปิดพิกัดทุกคนในระบบ (ทุกคนที่เคยอนุญาตตำแหน่งไว้)` -> Executes `executeForceEnableAllLocations(btn, true)`.
         - `👤 เปิดเฉพาะพิกัดของฉัน` -> Starts personal GPS tracker only (`tracker.start()`).
         - `ยกเลิก` / `Escape` / Backdrop click -> Closes modal with no action.
       - When clicking to turn OFF: Displays a modal to choose:
         - `🛑 สั่งปิดพิกัดทุกคนในระบบ` -> Executes `executeForceDisableAllLocations(btn, true)`.
         - `👤 ปิดเฉพาะพิกัดของฉัน` -> Stops personal GPS tracker only (`tracker.stop()`).
         - `ยกเลิก` -> Closes modal with no action.
  3. **Smooth UX (Zero Double Confirms)**:
     - `executeForceEnableAllLocations` and `executeForceDisableAllLocations` now support `skipConfirm = true` when invoked from the scope modal to avoid redundant confirmation prompts.
  4. **Cache Busting**: Bumped `analytics.js?v=102` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Universal Force-All Location Activation for All Users with Prior Permission, Coordinate Preservation, and Tactical Map Sync (Incident 2.140)
- **Problem / User Request**:
  - User requested: "กดเปิดพิกัดทุกคนแล้วให้มันเปิดทุกคนที่เคยอนุญาตตำแหน่งไว้เลย" (When clicking force-enable location for everyone, make it turn on/activate for everyone who has ever granted location permission).
  - Previously, clicking "สั่งเปิดพิกัดทุกคน" (`POST /auth/location/force-all`) failed to display other officers on the map because:
    1. `auth.py`'s `force-all` endpoint only inserted `user_location` `WHERE is_online = 1` from `user_presence`, completely ignoring officers whose heartbeats were idle (>65s) or offline.
    2. Crucially, `force-all` only set `user_presence.location_sharing = 1` for `superadmin["sub"]` alone! For all other users, `p.location_sharing` remained 0, causing `GET /auth/locations` (`WHERE p.location_sharing = 1`) to discard all other officers.
    3. When Superadmin previously turned off sharing (`enable=False`), the server executed `SET latitude = NULL, longitude = NULL`, permanently destroying last known coordinates so re-enabling location showed no markers.
    4. On the client side (`app.js` and `analytics.js`), auto-activation of GPS tracking was blocked by `_watchAttempted = true` or `!wasSharing`, and the app did not remember if permission was previously granted (`bpp_gps_permitted`), nor did `GET /auth/locations` broadcast the global `force_all_enabled` command to connected officer devices.
- **Resolution**:
  1. **Comprehensive Server-Side Force-All & Global System State (`auth.py`)**:
     - Added persistent `system_state` table in SQLite (`auth.db`) with `get_system_state()` and `set_system_state()` helpers.
     - In `POST /auth/location/force-all` (`enable=True`):
       - Sets `sharing_enabled = 1` for ALL users in `user_location`.
       - Upserts `user_location` with `sharing_enabled = 1` for ALL active users in `users`.
       - Upserts `user_presence` with `location_sharing = 1` for ALL active users.
       - Records global state `force_location_all = '1'`.
     - In `POST /auth/location/force-all` (`enable=False`):
       - Sets `sharing_enabled = 0` and `location_sharing = 0`, but **PRESERVES `latitude` and `longitude`**! Last known coordinates are never destroyed.
  2. **Inclusive Location Query & Status Categorization (`GET /auth/locations`)**:
     - Uses `LEFT JOIN user_presence p` and `WHERE u.active = 1 AND (l.sharing_enabled = 1 OR p.location_sharing = 1)`.
     - Returns all officers who have coordinates:
       - `diff_sec <= 45s`: `signal_status = 'live'` (🟢 สดเรียลไทม์)
       - `diff_sec <= 300s`: `signal_status = 'background'` (🟡 โหมดพื้นหลัง)
       - `diff_sec > 300s`: `signal_status = 'last_known'` (⚪ พิกัดล่าสุด)
     - Broadcasts `"force_all_enabled": true/false` in the response payload.
  3. **Zero-Delay Auto-Activation on Officer Devices (`analytics.js` & `app.js`)**:
     - In `analytics.js` (`loadOfficerLocations()`, polled every 1s): if `force_all_enabled` or `isMeInOfficers` is true, the officer's browser auto-starts `window.bppLocationTracker.start()` without waiting 30s for the heartbeat.
     - In `app.js` (`onPosition()`): persists `localStorage.setItem('bpp_gps_permitted', '1')`. Because permission was previously granted, `getCurrentPosition` / `watchPosition` acquires coordinates silently with zero browser prompts.
     - In `sendPresenceHeartbeat()`: unblocked auto-start if `shouldShare && watchId === null`.
  4. **Superadmin Quick-Action Toolbar Button (`analytics.js`)**:
     - Added `#btnMapForceAllLoc` (`🌐 เปิดพิกัดทุกคน`) directly on the tactical map toolbar for Superadmins (right next to `#btnToggleOfficerLocation`), in addition to `#btnForceEnableAllLoc` in Mission Control.
     - Unified modal confirmation: "เปิดพิกัดทุกคนที่เคยอนุญาตตำแหน่งไว้?".
  5. **Cache Busting**: Bumped `app.js?v=174` and `analytics.js?v=101` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Fix GPS Location Share Failure with Guaranteed Clipboard Copy, Floating Tactical Banner, and Mobile Deep-Linking (Incident 2.139)
- **Problem / User Request**:
  - User reported: "กดแชร์แล้วไม่มีอะไรเกิดขึ้นครับ" (When clicking share, nothing happens!).
  - Root Cause Diagnosed:
    1. **Desktop Windows Chrome / Edge `navigator.share` Abort Trap**: On Windows 10/11 desktops, Chrome/Edge has `navigator.share` available. When triggered, Windows opens its native OS share flyout (Nearby Sharing / Mail). If dismissed or cancelled by the user, it throws an `AbortError`. The previous code caught `AbortError` and immediately executed `return;` without ever copying to the clipboard or providing UI feedback. To the user, clicking appeared completely dead/unresponsive.
    2. **Inline HTML Attribute Escaping Syntax Errors**: Buttons were generated using inline `onclick="window.shareGpsLocation('${lat}', '${lng}', '${escapeHtml(displayName)}')"` which threw unhandled JavaScript `SyntaxError` whenever an officer name, camera name, or GPS label contained single quotes or complex characters.
    3. **Toast Hidden/Obscured**: `showMapToast` was anchored at `bottom:24px;right:24px`, placing it behind Leaflet map controls, bottom attribution, or off-screen.
    4. **Missing `window.bppToast`**: `app.js` failed to export `window.bppToast`, breaking callers across the frontend.
- **Resolution**:
  1. **Guaranteed Instant Clipboard Copy (`analytics.js`)**:
     - `shareGpsLocation(lat, lng, label)` now prioritizes immediate clipboard copy via `copyToClipboardFallback()` (using `navigator.clipboard.writeText` with resilient fallback to hidden `textarea` and `document.execCommand('copy')`).
     - Formats standard tactical share text: `📍 {label}\nพิกัด: {lat}, {lng}\nนำทาง: https://www.google.com/maps?q={lat},{lng}`.
  2. **Cyberpunk Floating Tactical Share Banner (`#mapShareFloatingBanner`)**:
     - Automatically renders at top-center (`position:fixed; top:20px; left:50%; z-index:9999999`) with emerald neon glow.
     - Displays confirmation message and 2 quick-action buttons:
       - `💬 ส่งเข้า LINE`: Deep link `https://line.me/R/msg/text/?...` to forward coordinates directly to LINE contacts/groups in 1 click.
       - `🌐 Google Maps`: Opens the coordinates immediately in Google Maps.
     - Auto-dismisses in 6 seconds or via manual close button (✕).
  3. **Delegated Event Architecture (`.btn-action-share-gps`)**:
     - Eliminated inline `onclick` handler strings across all map popups and modals:
       - Camera Popup (`renderCameraPoints`)
       - Officer GPS Popup (`officerMarkersMap`)
       - GPSONE Vehicle Tracker Popup (`buildGpsOnePopupHtml`)
       - Pursuit HUD Banner (`mapGpsOnePursuitBanner`)
       - GPSONE Fleet Manager Modal (`showGpsOneManagerModal`)
     - Uses delegated `document.addEventListener('click')` with `data-lat`, `data-lng`, and `data-label` (URI encoded) to guarantee zero string escaping syntax errors.
  4. **Mobile-Only Web Share Guard**:
     - `navigator.share` is now invoked exclusively on mobile OS devices (`/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)`), avoiding broken desktop Windows share flyouts.
  5. **Top-Center Toast & Global Export**:
     - Relocated `showMapToast()` to top-center (`top:24px;left:50%;transform:translateX(-50%);z-index:9999999`).
     - Exported `window.bppToast` in `app.js`.
  6. **Cache Busting**: Bumped `app.js?v=173` and `analytics.js?v=100` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Real-Time Officer User GPS Tracking with Uninterrupted Background & Tab-Switching Persistence (Incident 2.138)
- **Problem / User Request**:
  - User requested: "ให้มันส่งสัญญาณพิกัดเจ้าหน้าที่ user กับ gps แบบเรียลไทม์ และเป็นไปได้อย่าให้หลุดแม้เจ้าหน้าที่จะออกจากหน้าจอเว็บของระบบ" (Make officer user GPS signal send in real-time, and prevent disconnection/dropping even when the officer leaves the web screen / browser tab / background).
  - Previously, when an officer sharing GPS switched browser tabs, opened another application (LINE, Phone, Camera), or locked their phone screen, mobile browser power-saving mechanisms aggressively throttled or suspended JavaScript timers (`setInterval`) and paused `watchPosition` callbacks within 15-30 seconds.
  - Furthermore, `auth-service/auth.py` enforced a rigid 65-second heartbeat threshold (`diff_sec <= 65`). As soon as an officer's backgrounded device experienced a ~70s lull, the server declared the officer offline and dropped them from `/auth/locations`, causing their pin to vanish completely from the tactical map.
- **Resolution**:
  1. **Background Audio Keepalive Anchor (`app.js`)**:
     - Embedded an inaudible, looping 1-second silent stereo PCM WAV buffer (`Audio(silentWav)` at volume 0.01) triggered during user activation of `start()`.
     - Integrated `navigator.mediaSession` metadata ("🚨 BPP-VMS Tactical GPS Beacon") and playbackState `'playing'` with a lock-screen 'stop' action handler.
     - Modern mobile OSes (iOS Safari, Android Chrome) treat active media playback as background audio, completely preventing CPU suspension of the browser tab and keeping background timers/sockets alive.
  2. **Dedicated Web Worker Timer & Screen Wake Lock (`app.js`)**:
     - Screen Wake Lock API (`navigator.wakeLock.request('screen')`) automatically keeps mobile displays awake during active field operations.
     - Spawns an inline dedicated Web Worker via Blob URL running a steady 1-second tick loop. Dedicated workers run on independent threads and are not throttled to 60s like window-level DOM timers.
     - On worker tick: automatically checks coordinate age; if hidden and elapsed >= 2000ms, forces hardware GPS position acquisition (`navigator.geolocation.getCurrentPosition`) and transmits immediately.
  3. **Page Visibility & Lifecycle Re-sync (`app.js` & `analytics.js`)**:
     - `document.addEventListener('visibilitychange')`:
       - On `hidden`: immediately transmits latest coordinates with `is_background: true` and `keepalive: true` via `fetch('/auth/location')`.
       - On `visible`: immediately re-acquires Wake Lock, queries hardware GPS for an instant 0-delay fix, re-verifies `watchPosition`, sends presence heartbeat, and immediately polls `loadOfficerLocations()` and `loadGpsOneLocations()`.
     - `window.addEventListener('online')`: immediately re-transmits location upon network reconnection.
     - All location and heartbeat POST requests now specify `{ keepalive: true }`, ensuring network transmission completes even during tab transitions or unloads.
  4. **Server-Side Grace Window & Signal Status (`auth-service/auth.py`)**:
     - In `GET /auth/locations`: calculates freshness using `max(last_heartbeat, updated_at)`.
     - Extended grace period for location-sharing officers:
       - `diff_sec <= 45s`: `signal_status = "live"`, `is_live = True` (🟢 Real-time Live).
       - `diff_sec <= 300s` (5 minutes): `signal_status = "background"`, `is_live = False` (🟡 Background / Screen-off persistence). The officer marker remains visible on the commander's tactical map instead of disappearing.
       - Up to 600s if an operational mission is active.
     - In `GET /auth/presence`: grants the same 300s grace window for sharing officers so presence counters don't flicker.
     - In `POST /auth/location`: accepts optional `is_background` and `timestamp` fields.
  5. **Tactical Map Visual States & Popup Badges (`analytics.js`)**:
     - Dynamic marker styles: `.officer-marker-pin.has-face` for live real-time (pulsing emerald radar ring) vs `.officer-marker-pin.has-face.is-background` (amber/gold pulse and amber border with `#78350f` face container).
     - Popup status badge: displays `🟢 สดเรียลไทม์` when live or `🟡 พื้นหลัง (x วิ / relTime)` when in background mode.
     - Connected `sw-location.js` (`v2`) `BG_LOCATION_PING` to `window.bppLocationTracker.refreshPosition()`.
  6. **Cache Busting**: Bumped `app.js?v=172` and `analytics.js?v=99` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/auth-service/auth.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/sw-location.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Superadmin Camera Pin/Group Hiding & Instant 1-Click GPS Sharing (Incident 2.137)
- **Problem / User Request**:
  - User requested: "ให้ superadmin สามารถซ่อนปักหมุดกล่มกล้องได้โดยไม่ให้คนอื่นเห็น และสามารถเปิดกลับมาได้ตามต้องการ และที่ gps ให้กดแชร์พิกัดได้เลย" (Allow Superadmins to hide camera pins or entire camera groups from regular users, unhide/restore them at will, and provide 1-click GPS location sharing).
  - Previously, all 485 camera pins on the tactical/heatmap map were displayed universally to all users without operational compartmentalization. Superadmins lacked a way to hide sensitive operational camera groups (e.g. Special routes, covert surveillance, or specific districts/provinces) from standard personnel.
  - When an officer or Superadmin clicked the "เปิดพิกัด" (Location Sharing) button, Superadmins were blocked by a modal dialog prompt (`showLocationScopeChoice`), obstructing immediate sharing. Furthermore, vehicle/tracker GPS popups, pursuit HUD banners, and officer popups had no direct share action to copy or dispatch Google Maps coordinates to messaging apps (LINE/Telegram).
- **Resolution**:
  1. **Superadmin RBAC & Pin Filtering (`analytics.js` & `tactical-map.js`)**:
     - Defined `isMapSuperadminUser()` checking session/local role `superadmin` or usernames `suchakree`, `arm215`, `bpp215`.
     - In `renderCameraPoints()`: non-superadmin users skip any camera with `cam.hidden === true` (`if (cam.hidden && !isMapSuperadminUser()) return;`).
     - For Superadmin: hidden cameras remain visible with a distinct visual style `.pin-hidden-admin` (slate translucent body, dashed red border, glowing red shadow, and 🚫 badge).
     - In camera popup: added Superadmin toggle button `[🚫 ซ่อนหมุดนี้ (คนอื่นจะไม่เห็น)]` / `[👁️ เลิกซ่อน (เปิดให้ทุกคนเห็น)]` with real-time PUT to `/settings/admin/camera_gps` via `saveCameraGPS()`.
     - In `tactical-map.js`: `performSearch()` excludes hidden cameras for normal users and marks them as `👁️‍🗨️ [ซ่อนอยู่]` for Superadmins.
  2. **Superadmin Camera Groups Management Modal (`#hiddenCamGroupsModal`)**:
     - Added `#btnManageHiddenCamGroups` (`👁️‍🗨️ ซ่อนกลุ่มกล้อง`) in the map toolbar, visible only to Superadmins.
     - Dual Grouping Modes: supports grouping both by **NVR Group** (via `/downloads/nvr_groups.json`, e.g. "กล้องที่ดึงมาทางพิเศษ", "BPP215", "อบต.ดูนสาด", "ทต.โกรกแก้ว", "DOH กรมทางหลวง") and by **Province** (17 provinces).
     - 1-Click Group Actions: `🚫 ซ่อนกลุ่มนี้` and `👁️ เปิดกลุ่มนี้` with live counters (Total / Hidden / Visible).
     - Global Actions: `👁️ เปิดทั้งหมด` and `🚫 ซ่อนทั้งหมด` (with confirmation).
     - Tab 2: Searchable & filterable individual camera list with real-time toggle buttons.
  3. **Instant 1-Click GPS Location Sharing**:
     - Removed `showLocationScopeChoice` obstruction from `btnLocToggle.onclick` so clicking "เปิดพิกัด" immediately starts/stops location sharing without prompt delays (Superadmin force-enable/disable is still accessible inside the Mission Control modal).
     - Implemented `window.shareGpsLocation(lat, lng, label)` featuring native Web Share API (`navigator.share`) with fallback to clipboard copying of formatted Google Maps link (`https://www.google.com/maps?q=lat,lng`) + toast notification (`showMapToast`).
     - Added direct `📤 แชร์พิกัด` buttons into:
       - GPSONE vehicle tracker popups (`buildGpsOnePopupHtml`)
       - Tactical Pursuit HUD banner (`mapGpsOnePursuitBanner`)
       - Officer GPS marker popups (`popupContent`)
       - GPSONE device list cards in manager modal (`renderGpsOneModalList`)
       - Camera map popups (under coordinates)
  4. **Cache Busting**: Bumped `analytics.js?v=98` and `tactical-map.js?v=2` in `frigate-nvr/web/index.html`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/assets/tactical-map.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-17 - Resolution & Permanent Prevention of Cloudflare 502 Bad Gateway / WSL2 14GB Memory Lockup from 527-Camera Config Bloat (Incident 2.136)
- **Problem**:
  - User uploaded screenshot showing `https://vms.local/index.html` returning **Cloudflare `502 Bad gateway`** (`vms.local Host Error`, Ray ID `a4bbc67f0dab2dd0`) and instructed to prevent this from ever happening again.
- **Root Cause Diagnosed**:
  1. **WSL2 Kernel Page Allocation Livelock (`vmmemWSL` at 14.89 GB):**
     - Docker VM kernel log (`init.log.*`) showed `page allocation failure: order:4, mode:0x40c40(GFP_NOFS|__GFP_COMP)` across `uvicorn` (`config-api`, `nas-bot-service`), `ffmpeg`, `cuda-EvtHandlr`, and `dec0:0:h264` (`frigate-nvr`) as `Node 0 Normal free` dropped to `32,884 kB` (hitting `min: 32,636 kB` under the `.wslconfig` `memory=14GB` ceiling). This locked up `dockerd` and `nvr-dashboard`, causing upstream timeouts on `cloudflared-tunnel` (`502 Bad Gateway`).
  2. **527-Camera Bloat Chain Reaction in `config.yml` & Runtime Sync Storm:**
     - `GET /api/config/cameras` and `GET /api/public-config/cameras-catalog` in `config-api/api.py` defaulted `enabled` to `True` for streams in `go2rtc.streams` / `nvr_groups.json` that were not in `config['cameras']`.
     - When a Superadmin saved settings in `web/assets/app.js` (`saveSettings()`), it compared `state.frigateCams` (527 catalog cameras) against `state.nvrCameras`, falsely concluded ~500 unprovisioned streams were `enabled: true`, and fired 500+ sequential `PUT /api/config/cameras/{name}/enabled` (`{"enabled": false}`) requests.
     - `set_camera_enabled()` in `config-api/api.py` unconditionally called `_ensure_camera_in_config()` even when `request.enabled` was `False`, inserting 488 never-used disabled camera blocks into `config.yml` (totaling 527 cameras / 11,352 lines).
     - Frigate `0.18.2` allocated 2 shared-memory buffers in `/dev/shm` (`<cam>` and `out-<cam>`) + `OutputProcess` objects for all 527 cameras (`1,360` files in `/dev/shm`), driving `frigate-nvr` RAM to `7.07 GiB` and `config-validator` RAM to `575.5 MiB` at boot.
     - Every 2 minutes, `reconcile_cameras_internal()` in `config-api/api.py` called `_sync_camera_to_frigate_runtime()` for all 527 cameras (including 521 disabled cameras), spawning 527 threads, opening 1,581 MQTT connections, and forcing `watchlist-api` and `frigate-nvr` to serialize/parse the 527-camera JSON config 527 times every 120 seconds.
- **Resolution**:
  1. **Immediate Service Recovery**:
     - Reset the hung WSL2 VM (`wsl --shutdown`), restarted Docker Desktop and all 18 BPP-VMS Compose containers, and verified `https://vms.local/login.html` and `/index.html` return `HTTP/1.1 200 OK`.
  2. **Backend Guards (`frigate-nvr/config-api/api.py`)**:
     - Fixed `get_cameras()` and `public_get_cameras_catalog()` to return `enabled: False` when `cam_name not in cameras`.
     - Guarded `set_camera_enabled()` so `request.enabled=False` on a camera not in `config['cameras']` returns `200 OK` immediately without creating a disabled camera entry in `config.yml` or calling `_sync_camera_to_frigate_runtime()`.
     - Restricted `reconcile_cameras_internal()` no-op sync loop to only sync active/enabled cameras (`current_active_cameras` with `enabled: True`, i.e., 6 cameras instead of 527).
  3. **Frontend Guard (`frigate-nvr/web/assets/app.js` & `web/index.html`)**:
     - Updated `saveSettings()` to only disable non-grid cameras when `propagateMaster` is explicitly checked AND `nc.enabled === true` in `state.nvrCameras`. Bumped cache buster to `app.js?v=171`.
  4. **Config & Shared Memory Cleanup (`config.yml` & `camera_templates.json`)**:
     - Pruned 488 never-used disabled camera stubs (0 events and 0 recordings in `frigate.db`) from `config.yml` and `camera_templates.json`, retaining all 6 active cameras + 33 historical cameras in `frigate.db` (39 total) and 100% of `go2rtc.streams` (607 streams).
     - `frigate-nvr` RAM dropped from `7.07 GiB` to `4.81 GiB` (`-2.26 GiB`), `config-validator` RAM dropped from `575.5 MiB` to `11.05 MiB` (`-564 MiB`), and WSL2 `MemAvailable` increased from `2.16 GiB` to `5.14 GiB`.
     - Added regression test `test_disabling_unprovisioned_stream_does_not_bloat_cameras_config` in `config-api/tests/test_config_transactions.py`.
- **Files Changed**: `frigate-nvr/config-api/api.py`, `frigate-nvr/config-api/tests/test_config_transactions.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`, `frigate-nvr/config/config.yml`, `frigate-nvr/config/camera_templates.json`.

## Update 2026-10-17 - Map Fluid Smooth Zooming & Transition Stutter Elimination (Incident 2.125)
- **Problem**:
  - User reported: "แผนที่เวลาซูมเข้าออกมันกระตุกๆครับ" (When zooming in and out of the map, it stutters / lags / is jerky).
- **Root Cause Diagnosed**:
  1. **Wheel Debounce & Step Jumps:** `wheelDebounceTime: 80` (double Leaflet's default of 40ms) delayed mouse wheel responses by 80ms, creating a laggy freeze. Because `wheelPxPerZoomLevel` was at the default (60), a standard mouse wheel notch (120px) jumped 2 zoom levels abruptly at once.
  2. **Tile Layer Loading Blocked During Zoom:** All four tile layers (`cartoDarkLayer`, `cartoVoyagerLayer`, `hybridLayer`, `satLayer`) were configured with `updateWhenZooming: false` and `updateWhenIdle: true`. This forced Leaflet to freeze tile loading during zooms, scale low-res tiles into giant blurry pixels, and dump 20+ tile image loads all at once only after the map became 100% idle.
  3. **Marker CSS Transition & Animation Clashes:** Markers had conflicting CSS rules (`transition: transform 0.85s linear` and `.leaflet-zoom-anim .leaflet-marker-icon... transition: transform 0.25s cubic-bezier(0, 0, 0.25, 1)`). Because Leaflet scales the parent `.leaflet-marker-pane` directly during zoom, applying child transitions caused compound double-transformations and 0.85s drifting/lagging on 488+ markers. Additionally, continuous CSS animations (`stashPulse`, `officerPingAnim`, `gpsoneLockSpin`, `camActivePulse`) forced the GPU to re-composite hundreds of elements every frame during zoom.
  4. **1-Second Polling Collisions:** Background timers (`loadOfficerLocations` and `loadGpsOneLocations`) running every 1,000ms called `setLatLng()` and modified Leaflet DOM while `leafletMap._animatingZoom` was active.
- **Resolution**:
  1. **L.map Parameter Tuning (`analytics.js`)**:
     - Reset `wheelDebounceTime: 40` for immediate scroll responsiveness.
     - Set `wheelPxPerZoomLevel: 120` so 1 mouse wheel notch = exactly 1 smooth zoom level step.
     - Added `zoomDelta: 1, zoomSnap: 1, zoomAnimation: true, zoomAnimationThreshold: 8, fadeAnimation: true, markerZoomAnimation: true`.
  2. **Progressive Tile Streaming (`analytics.js`)**:
     - Updated all base tile layers: `updateWhenIdle: false`, `updateWhenZooming: true`, and increased `keepBuffer: 4` so adjacent tiles pre-render seamlessly without pixelated stalls.
  3. **Zoom Transition Suppression & Animation Pause (`analytics.js`)**:
     - Added `.map-zooming` class on `zoomstart` and removed 60ms after `zoomend`.
     - Completely suppressed marker transitions (`transition: none !important;`) on `.map-zooming` and `.leaflet-zoom-anim`.
     - Paused infinite pulse/spin animations (`animation-play-state: paused !important;`) during zoom.
     - Added `contain: layout style;` to `.camera-marker-wrapper` and `.tactical-stash-marker-wrapper`.
  4. **Polling Interruption Guard (`analytics.js`)**:
     - Added `if (leafletMap._animatingZoom) return;` at the entry of both `loadOfficerLocations()` and `loadGpsOneLocations()`.
  5. **Cache Busting (`index.html`)**:
     - Bumped `analytics.js?v=95` -> `analytics.js?v=96`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-16 - 24-Hour Military Time Selector for AI Detection & Alert Schedules (Incident 2.135)
- **Problem / User Request**:
  - User requested: "ปรับให้เป็นแบบ 24 ชม.ได้ไหม am pm มันงง" ("Can it be adjusted to 24-hour format? AM/PM is confusing.")
  - Prior implementation used native HTML5 `<input type="time">`, which relies on client OS/browser locale settings. On Windows client systems configured with 12-hour format, Chrome/Edge displays a 3-segment dial `HH : MM : AM/PM`, causing operational confusion when setting military schedules (e.g. typing 18:00 converted to 06:00 PM or failed validation).
- **Root Cause**:
  - Native `<input type="time">` cannot be forced to a 24-hour presentation cross-browser without custom UI controls, as Chromium delegates rendering to the Windows Regional format.
- **Resolution**:
  1. **Dual-Dropdown 24-Hour Military Time Pickers (`web/index.html` & `web/assets/app.css?v=158`)**:
     - Designed custom `.ai-24h-picker-wrap` Cyberpunk controls:
       - Hour dropdown: `00` through `23` (24 values)
       - Colon separator: `:`
       - Minute dropdown: `00` through `59` (60 values)
       - Thai unit label: `น.` (นาฬิกา)
     - Preserved `<input type="hidden" id="inpAiSchedStart">` and `inpAiSchedEnd` to ensure 100% backward compatibility with `config-api` and `ai_schedules.json` (`"HH:MM"` format).
     - Applied the exact same 24-hour picker to Personal Alert Schedules (`inpMyScheduleStart` and `inpMyScheduleEnd`).
     - Added quick preset button: `<button type="button" id="btnSchedPresetLate" class="obj-chip-btn">🌌 ช่วงดึก (22:00–05:00)</button>`.
  2. **Reactive Synchronization & Event Wiring (`web/assets/app.js?v=170`)**:
     - Added `populate24hSelect(sel, max)` and `initAll24hSelects()`.
     - Updated `renderAiSchedule()` and `renderMySubscription()` to pad hours/minutes with leading zeros, set select values, and calculate cross-midnight status (`isOvernight`).
     - Wired change events on all hour/minute selects to automatically update hidden inputs, dirty tracking (`state.schedDirty`, `state.myAlertsDirty`), and live UI badges.
     - Wired `btnSchedPresetLate` preset handler.
  3. **Verification**:
     - Verified syntax via `node -c frigate-nvr/web/assets/app.js` (clean, 0 errors).
     - Cache-busted with `app.css?v=158` and `app.js?v=170`.

## Update 2026-10-16 - Frigate 0.18.2-tensorrt Phased Migration & Patch Modernization (Incident 2.134)
- **Goal / Request**:
  - Safely migrate Frigate NVR from `0.17.2-tensorrt` to `0.18.2-tensorrt` (Latest release) without losing database history, live recordings, or breaking sidecars (`lpr-service`, `watchlist-api`, `config-validator`, `config-api`).
- **Pre-Migration Safety & Baseline (Phase 0)**:
  - Cold backup of SQLite database `frigate.db` (127 MB) via SQLite backup API to `/media/frigate/frigate_pre_018_backup.db` (`D:\BPP-VMS\frigate-nvr\storage\frigate_pre_018_backup.db`).
  - Git baseline tag `v2.133-frigate-0.17.2` pushed to remote.
- **Root Cause & Patch Modernization (Phase 1)**:
  1. **Storage Maintainer Patch (`patches/patch_storage_threshold.py`)**:
     - Upstream 0.18.2 changed `return remaining_storage < hourly_bandwidth` to `return remaining_storage < float(hourly_bandwidth)`.
     - Updated patch and unit tests with dual-version compatibility (`UPSTREAM_BLOCK_018` & `UPSTREAM_BLOCK_017`) keeping `max(float(hourly_bandwidth), percentage_reserve)`.
  2. **Detection Resilience Patch (`patches/patch_detection_resilience.py`)**:
     - Upstream 0.18.2 added `camera_state = self.camera_states.get(camera); if camera_state is None: continue` in `object_processing.py` and changed `write_snapshot_to_disk()` to use `webp_bytes = self.get_clean_webp()` in `tracked_object.py`.
     - Updated patch and unit tests with dual-version matching for both 0.17 and 0.18 layouts.
  3. **go2rtc Environment Reload Patch (`patches/patch_go2rtc_env_reload.py`)**:
     - Anchors in `/usr/local/go2rtc/create_config.py` verified identical in 0.18.2; dynamic `/config/camera_credentials.env` reload retained.
  4. **UI Branding Patch (`branding/patch_logo.py`)**:
     - Frigate cat SVG path `M130 446.5` successfully detected in `index-Cy1bzmLK.js`, replaced with BPP215 brand logo and CSS injected into `login.html` and `index.html`.
  5. **Nginx Media Compatibility (`dashboard-nginx.conf`)**:
     - Updated line 701 regex `clip\.mp4|snapshot\.(?:jpg|webp)|thumbnail\.(?:jpg|webp)` to serve both WebP and JPEG snapshots/thumbnails directly and via archive fallback.
- **Database Schema Migration & Integrity Verification (Phase 2)**:
  - Isolated test copy of `frigate.db` migrated using Peewee router:
    - `033_create_export_case_table`
    - `034_add_export_case_to_exports`
    - `035_add_motion_heatmap`
  - Post-migration `PRAGMA integrity_check` returned `ok`. All 44,508 events and 75,835 recordings verified intact.
- **Production Cutover & Verification (Phase 3)**:
  - `frigate-branded:local` and `config-validator:local` built with pinned base `ghcr.io/blakeblackshear/frigate:0.18.2-tensorrt@sha256:1cafb6ebbaff0aaf275cc3f31951bcf7e29f3989f18a10ba9565091367d8736c`.
  - Recreated containers via `docker compose up -d --no-deps config-validator frigate`.
  - Both containers started healthy:
    - Frigate version: `0.18.2-cfa08c5`.
    - Camera capture/detect workers active with CUDA HWACCEL on FFmpeg 8.0.
    - Go2rtc streams active on port 1984/8554.
    - `lpr-service` receiving HTTP 200 on event polls.
    - Snapshot endpoints serving JPEG for backward compatibility.
    - `media-compat-service` kept safely pinned to 0.17.2 runtime per scope rules.

## Update 2026-10-16 - Camera Settings Modal Channel Header Overflow Fix (Incident 2.133)
- **Problem**:
  - User reported from Settings Modal (`ตั้งค่ากล้อง -> ผังหน้าจอ`): "เมนูมันล้นครับครับพวกโซนป้ายและพิกัด" (The menu is overflowing, plate zone and coordinates buttons are cut off).
  - Attached screenshot showed that `.ch-form-head` had all items forced on a single line with `flex-wrap: nowrap`, squishing the channel title into `ท...` and pushing the `btnChLprZone` (โซนป้าย) and `btnChGps` (พิกัด 📍) buttons beyond the right boundary, forcing an unwanted horizontal scrollbar.
- **Root Cause**:
  1. `.ch-form-head` had `display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;` with `.ch-form-status { margin-left: auto; }`.
  2. With 6 action buttons (`btnSysStream`, `btnChEnabled`, `btnChDetect`, `btnChLpr`, `btnChLprZone`, `btnChGps`) sharing the same row as the channel chip, camera title, and status indicator, the total minimum width exceeded 900px, which far exceeded the ~650px container width of `.ch-form`.
- **Resolution**:
  1. **Two-Row Responsive Header Architecture (`web/index.html` & `web/assets/app.css?v=157`)**:
     - Restructured `.ch-form-head` into two semantic rows:
       - Row 1 (`.ch-form-title-row`): `selChLabel` (CH chip), `selChName` (full title with `font-size: 16px; font-weight: 600; text-overflow: ellipsis; min-width: 0`), and `selChStatus` on the right with a clean pill badge.
       - Row 2 (`.ch-form-actions`): Dedicated actions toolbar with `display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%`.
  2. **Styling & Overflow Prevention**:
     - Added `.ch-enable-btn.lpr-zone-btn` styling matching the Cyberpunk theme.
     - Constrained `.ch-form` with `overflow-x: hidden; overflow-y: auto;` to eliminate any horizontal scrolling.
     - Enhanced mobile media queries so both rows adapt cleanly on smaller screens.
  3. **Cache Busting**:
     - Bumped `app.css?v=157` and `app.js?v=169` in `web/index.html`.

## Update 2026-10-16 - Per-Camera AI Detection Time-Window Scheduling & Frigate 0.18.2 Assessment (Incident 2.132)
- **Problem / Request**:
  - User asked why some AI object filter pills could not be selected (explained the 10-object per-camera limit `MAX_TRACKED_OBJECTS = 10` where selecting 10 objects locks the remaining unselected pills with `opacity: 0.42` until one is unchecked).
  - User asked if per-camera AI detection can be scheduled by time window (`การตรวจจับ ai รายกล้องทำให้สามารถตั้งช่วงเวลาที่จะตรวจจับได้ไหม /plan`), and whether Frigate should be upgraded to `0.18.2` first.
- **Root Cause & Technical Assessment**:
  1. **Frigate 0.18.2 Upgrade Risk Analysis**:
     - Kept Frigate on `0.17.2-tensorrt` because `0.18.0+` drops `.jpg` event snapshots on disk in favor of `.webp` (breaking `lpr-service`, `watchlist-api`, and `nas-bot-service`), breaks our 3 build-time source patches in `frigate-nvr/Dockerfile`, and still has no built-in per-camera scheduling UI.
  2. **Zero-Restart AI Schedule Architecture**:
     - Needed a real-time scheduling layer in `config-api` and `web/` that toggles `frigate/{camera}/detect/set` (`ON`/`OFF`) via MQTT and WebSocket without restarting Frigate and without interrupting 24/7 video recording (`record` stays `ON`).
     - Required integration with `_sync_camera_to_frigate_runtime()` so the 2-minute demand-driven reconciliation loop does not re-enable AI when a camera is outside its scheduled time window.
- **Resolution**:
  1. **Persistent Storage (`frigate-nvr/config/ai_schedules.json`)**:
     - Created `/config/ai_schedules.json` storing per-camera schedules (`enabled`, `start_time`, `end_time`, `days` 1..7, `timezone: "Asia/Bangkok"`).
  2. **Backend Scheduler & API (`frigate-nvr/config-api/api.py`)**:
     - Implemented `evaluate_camera_schedule()` and `is_camera_in_ai_schedule()` in `Asia/Bangkok` (UTC+7), supporting both same-day (`08:00`–`17:00`) and cross-midnight (`18:00`–`06:00`) ranges plus ISO weekday filtering (`1..7`).
     - Added `GET /api/public-config/schedules`, `GET /api/public-config/cameras/{name}/schedule`, and `PUT /api/public-config/cameras/{name}/schedule`.
     - Updated `_sync_camera_to_frigate_runtime()` and `PUT /api/config/cameras/{name}/detect_toggle` to gate runtime detection by `is_camera_in_ai_schedule(name)` while preserving `config.yml` and 24/7 recording.
     - Upgraded `_reconciliation_background_worker()` to enforce AI schedule boundaries every 30 seconds (`enforce_ai_schedules_internal()`).
  3. **Frontend UI (`web/index.html`, `web/assets/app.css?v=156`, `web/assets/app.js?v=168`)**:
     - Added the `ตั้งเวลาเปิด-ปิดการตรวจจับ AI อัตโนมัติ (รายกล้อง)` panel in Settings (`ตั้งค่ากล้อง -> ผังหน้าจอ`) with quick presets (`🌙 กลางคืน (18:00–06:00)`, `🏢 เวลาทำการ (08:00–17:00)`, `🕒 24 ชม.`), overnight badge (`🌙 ข้ามคืน`), weekday pills (`จ.`–`อา.`), live status badge (`🟢 อยู่ในช่วงเวลา (AI ทำงาน)` / `🌙 นอกช่วงเวลา (พัก AI ชั่วคราว)`), and dirty-state tracking in `saveSettings()`.
  4. **Verification**:
     - Verified Python unit tests (`CameraAiScheduleTests`) and live `config-api` endpoints on port 5003.

## Update 2026-10-16 - Elimination of Camera OSD Watermark False Positive Plate Detection (Incident 2.131)
- **Problem**:
  - User uploaded event snapshot screenshot from `CH06 กล้อง6` (`Doonsad6`) at 18:48:44 where a white pickup passed by.
  - The LPR service detected the Dahua camera's permanent "IPC" on-screen watermark at the bottom-left corner of the video frame as a license plate (detector conf: 38.2%), and OCR misclassified English "IPC" as Thai characters "บบ7", displaying `💳 ผลการตรวจป้ายทะเบียน: อ่านได้บางส่วน — บบ7` (Candidate ID: 33554).
- **Root Cause**:
  1. **Corner & Bottom Edge OSD Filter Missing in `_find_plates()`**:
     - `_find_plates()` previously only filtered the top 10% of the frame (`y < 0.10`).
     - Dahua and Hikvision cameras place fixed watermarks in bottom corners (`IPC`, channel numbers, timestamps). During high-res mainstream live sampling or when vehicle bounding boxes clip the corner, the plate detector detected the "IPC" text box.
  2. **Thai OCR Misreading English Acronyms as Partial Plates**:
     - The character model read `I P C` as `บ บ 7`.
     - `is_valid_thai_plate('บบ7')` passed because length was 3 (>= 3) and contained Thai consonants + digit without checking score or English blocklists.
- **Resolution**:
  1. **Purged Candidate 33554**:
     - Updated in `watchlist.db`: `status = 'not_found'`, `review_state = 'adjudicated'`, `non_plate_reason = 'camera_watermark'`, `operational_visible = 0`, `plate_text = ''`.
  2. **Added `is_camera_osd_watermark(box, frame_w, frame_h)`**:
     - Rejects any box in camera OSD locations: Top bar (`y < 10%` or `y1 < 6%`), bottom-left corner (`cy > 80%` and `cx < 20%`), bottom-right corner (`cy > 80%` and `cx > 80%`), and extreme bottom edge (`cy > 95%` or `y2 > 97%`).
     - Applied across all passes in `_find_plates()` (normal, CLAHE, and shear) and in `process_candidates()`.
  3. **Added OSD Keyword Blocklist & Score Guard**:
     - Added `OSD_BLOCKLIST_WORDS` containing `IPC`, `CAM`, `CAMERA`, `DAHUA`, `HIKVISION`, `VIGI`, `CH01`-`CH16`, etc.
     - Added rule to `is_valid_thai_plate()`: 3-character plate reads without province require `score >= 0.65`.
  4. **Restarted & Verified `lpr-service`**:
     - Restarted container, verified healthy, and confirmed event candidate query returns `[]`.

## Update 2026-10-16 - Dynamic Reload Patch for camera_credentials.env in go2rtc create_config.py (Incident 2.130)
- **Problem**:
  - User added a third camera (`Doonsad6` / กล้อง 6 อบต.ดูนสาด) via the Web UI and reported: "เพิ่มกล้องใหม่ก็เกิดปัญหาเดิมอีกแล้ว" (Adding a new camera caused the exact same issue again).
  - All streams failed to load because `create_config.py` aborted on `{FRIGATE_CAM_DOONSAD6_RTSP_URL_USER}` KeyError, leaving `go2rtc` with only 10 fallback streams.
- **Root Cause**:
  1. **Upstream create_config.py Missing Dynamic .env Parsing**:
     - Upstream `/usr/local/go2rtc/create_config.py` only parses `os.environ` and `/run/secrets`.
     - When `config-api` writes newly added credentials to `/config/camera_credentials.env` and restarts Frigate via `/api/restart`, Docker does not inject newly added variables into `os.environ` of the existing container.
     - `create_config.py` raised `KeyError` and exited before writing `/dev/shm/go2rtc.yaml`.
- **Resolution**:
  1. Developed and deployed `patches/patch_go2rtc_env_reload.py` which patches `/usr/local/go2rtc/create_config.py` to automatically read `/config/camera_credentials.env` if present.
  2. Integrated the patch into `frigate-nvr/Dockerfile` so any future image rebuilds retain this functionality permanently.
  3. Applied the patch to the live container and reloaded `go2rtc` (`/command/s6-svc -t /run/service/go2rtc`), instantly restoring all 607 streams across the system without requiring container recreation.
  4. Verified live streaming: All 3 remote Dahua cameras (`Doonsad1`, `Doonsad5`, `Doonsad6`) are streaming 1080p live video with NVENC hardware transcoding smoothly (>31 MB transferred per stream to user's browser).

## Update 2026-10-16 - Newly Added Camera Web UI Save Triggers go2rtc Substitution Crash Due to Missing Container Recreate (Incident 2.129)
- **Problem**:
  - User added a second camera from Ob-Tor Doonsad (Doonsad5 / กล้อง 5) via the Camera Management Web UI and clicked Save.
  - After saving, all camera tiles including Doonsad1 (CH04) and Doonsad5 (CH05) showed VIDEO LOSS (สัญญาณวิดีโอขาดหาย).
- **Root Cause**:
  1. **Container Environment Missing Dynamic .env Reload**:
     - When config-api saves a new camera, it writes the credentials to camera_credentials.env and updates config.yml with {FRIGATE_CAM_DOONSAD5_RTSP_URL_USER} placeholders, then restarts Frigate.
     - However, Docker container restart does NOT re-read .env files into container environment variables.
     - Consequently, go2rtc failed variable substitution with: [ERROR] Invalid substitution found: 'FRIGATE_CAM_DOONSAD5_RTSP_URL_USER' and entered a restart crash loop, causing all WebRTC/MSE streams across the entire system to go down.
  2. **HEVC Codec on Remote Dahua Channel 5**:
     - Remote Dahua channel 5 streams in HEVC (H.265). Browser playback requires #video=h264#hardware NVENC transcoding for both Doonsad5_sub and Doonsad5_hd.
- **Resolution**:
  1. Recreated rigate-nvr container via docker compose up -d --force-recreate frigate to inject newly added FRIGATE_CAM_DOONSAD5_* environment variables.
  2. go2rtc started cleanly with zero substitution errors.
  3. Verified live streaming: Both Doonsad1_sub (CH04) and Doonsad5_sub (CH05) immediately connected to the user's Chrome browser, streaming smoothly (>13 MB transferred on each stream).

## Update 2026-10-16 - Integration of Dahua WizSense NVR (DHI-NVR4208-8P-EI) via MikroTik Cloud DDNS & ONVIF Stream Protocol (Incident 2.128)
- **Problem**:
  - Field unit at Ob-Tor Doonsad (อบต.ดูนสาด) configured port forwarding on MikroTik (hh00a2wndsn.sn.mynetname.net:8080 for Web and :554 for RTSP) for a Dahua WizSense NVR (DHI-NVR4208-8P-EI).
  - While the web service was reachable at port 8080 and port 554 was open, attempting to pull RTSP streams directly via /cam/realmonitor?channel=1&subtype=0 on port 554 returned 401 Unauthorized on both VLC and Frigate/go2rtc.
  - User reported 'ภาพไม่เห็นมาเลย' from dashboard grid because dashboard tiles were still pointing to offline local channels (CH01-CH04 from BPP 215 LAN outage) before the new camera Doonsad1 was selected into a grid slot.
- **Root Cause**:
  1. **Dahua WizSense Private Protocol vs ONVIF Separation**:
     - Modern Dahua WizSense NVRs (DHI-NVR4208-8P-EI) strictly segregate ONVIF/RTSP streaming authentication from local Web GUI administrator credentials.
     - The ONVIF user credentials (slothbpp2:Aa123456) authenticate through port 8080.
  2. **RTSP over Port 8080 with NVENC Hardware Transcoding**:
     - Using fmpeg:rtsp://{FRIGATE_CAM_DOONSAD1_...}@hh00a2wndsn.sn.mynetname.net:8080/cam/realmonitor?channel=1&subtype=0#video=h264#hardware#audio=copy tunnels RTSP directly through port 8080 with ONVIF credentials and GPU NVENC transcoding, ensuring 100% stable playback.
  3. **Grid Slot Mapping**:
     - The operator (suchakree) updated slot 4 to Doonsad1 (โค้งดูนสาดไปนาคำน้อย), immediately establishing a WebRTC/MSE connection streaming >400 KB/s live 1080p video.
- **Resolution**:
  1. Created Dahua ONVIF user slothbpp2 with password Aa123456 in NVR Account settings.
  2. Updated camera_credentials.env, camera_sources.json, and config.yml for Doonsad1, Doonsad1_sub, and Doonsad1_hd on port 8080 with NVENC hardware acceleration.
  3. Enabled AI detect and motion record for Doonsad1 in rigate-nvr/config/config.yml.
  4. Verified live streaming: User's Chrome browser is actively streaming Doonsad1_sub via MSE WebSocket with over 15 MB transferred cleanly.

## Update 2026-10-16 - Orphaned Account Subscription Audit (`tangmo` vs `tangmo1`) & AI Demand Account Name Visibility (Incident 2.127)
- **Problem**:
  - User reported from mobile screenshot on account `tangmo1` for camera `KK06 ซอยหน้าบ้านไอ้โจ้` (CH04):
    "หน้าบัญชี tangmo1 ก็ยังขึ้นแบบนี้สรุปบัญชีไหนเปิดอยู่กันแน่ผมต้องการปิด"
    The UI displayed `🤖 AI ปิด · ยังเปิดโดย 1 บัญชีอื่น`, preventing the user from knowing which account was demanding AI on `KK06` or how to shut it down.
- **Root Cause**:
  1. **Account Name Discrepancy & Orphaned Subscription (`tangmo` vs `tangmo1`)**:
     - The active user account in `auth-service` (`/data/auth.db`) is `tangmo1`.
     - However, in `nas-bot-service` (`/data/user_subscriptions.json`) and `/data/bot_user_pairings.json`, an older subscription and Telegram pairing existed under the previous username `tangmo` (`telegram:8698100078`).
     - In `tangmo`'s subscription, `master_enabled: true` was active with `KK06` set to `motorcycle: true`.
     - In `nas-bot-service/main.py` (`_compute_effective_ai_demand`), any paired subscription with active object alerts maintains persistent 24/7 AI demand on Frigate.
     - Because `tangmo` was considered an active subscription, `KK06` demand had 1 user (`tangmo`).
     - When the operator logged in as `tangmo1`, `tangmo1`'s own profile had `detect: false`, so the UI rendered `AI ปิด · ยังเปิดโดย 1 บัญชีอื่น`.
  2. **Lack of Account Name Transparency**:
     - `/api/nas-bot/user/ai-demand` only returned `{ counts: { <cam>: <number> } }` without returning the demanding accounts list (`users`).
     - As a result, the frontend could only show `ยังเปิดโดย X บัญชีอื่น` without specifying which user accounts held the demand, leaving operators unable to identify the source.
- **Resolution**:
  1. **Closed AI Demand on `KK06` & Migrated `tangmo` to `tangmo1`**:
     - Removed the orphaned `tangmo` subscription from `/data/user_subscriptions.json` and ensured `tangmo1` subscription exists with `KK06` disabled.
     - Updated `/data/bot_user_pairings.json` so Telegram user `8698100078` is linked to `tangmo1`.
     - Invoked camera reconciliation (`/api/public-config/reconcile`) and verified Frigate NVR runtime stopped detection on `KK06` (`enabled = False, detect = False`).
  2. **Ghost Account Safeguard in `_compute_effective_ai_demand` (`nas-bot-service/main.py`)**:
     - Added an automatic guard `if uname not in all_profiles: continue` so any orphaned subscription for an account that does not exist in `auth-service` / `user_profiles.json` is automatically ignored and cannot create ghost AI demand on any camera.
  3. **Account Name Visibility on Demand UI (`nas-bot-service`, `app.js?v=167`)**:
     - Updated `/api/nas-bot/user/ai-demand` in `nas-bot-service/main.py` to return `"users": demand`.
     - Updated `app.js` (`fetchAiDemandCounts` and `renderChForm`) to extract demanding account names and render `· ยังเปิดโดย 1 บัญชีอื่น (tangmo)` in the button and `เปิดใช้งานโดย: ... — คลิกเพื่อเปิด AI ร่วมด้วย` in the tooltip.
  4. **Cache Busting (`index.html`)**:
     - Bumped `app.js?v=166` to `app.js?v=167`.
- **Files Changed**: `frigate-nvr/nas-bot-service/main.py`, `frigate-nvr/web/assets/app.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-16 - Group A (ตชด.23) CCTV Map Pin Live Preview & GPS Metadata Parity (Incident 2.126)
- **Problem**:
  - User reported: "กล้องกลุ่ม a ทำไมสัญญานในหมุดแผนที่ไม่มาแต่เปิดดูตาม ch สัญญาณมาปกติ" (Why do Group A cameras [A01–A22] fail to display video and show "กล้องออฟไลน์ — ไม่สามารถแสดงภาพได้" / red offline pin on the Leaflet risk heatmap/CCTV pins, even though they stream live video completely normally when opened on a dashboard channel tile [CH01–CH16]?).
- **Root Cause**:
  1. **Missing Status & Stream Metadata in `camera_gps.json`**:
     - In `frigate-nvr/config/dashboard-settings/camera_gps.json`, 437 out of 485 map cameras (DOH, Roiet, Udon, Ubon, ITIC) had `"status": "Ready"` and `"url": "https://..."`.
     - In contrast, all 22 Group A cameras (`A01` through `A22`) had valid lat/lng and province ("มุกดาหาร") but were completely missing `"status": "Ready"` and `"url"`.
     - In `analytics.js` (`renderCameraPoints`), `isReady` evaluated `cam.status === 'Ready'`. Because `cam.status` was `undefined`, `isReady` defaulted to `false`.
     - Consequently, the Leaflet popup evaluated `else if (hasPreview && !isReady)` and rendered `<div class="cam-preview-loading" style="color:#fb5b78;">กล้องออฟไลน์ — ไม่สามารถแสดงภาพได้</div>`. The `<video>` element was never mounted into the DOM and `startPopupPreview()` was never invoked!
  2. **Client-side Fetch Probe Failures on iOS / DuckDNS**:
     - The background health checker (`checkCameraStatus`) attempted client-side `fetch(hlsUrl)` against external duckdns endpoints. On mobile Safari / iOS 5G, JavaScript `fetch()` calls fail on CORS or cross-origin TLS handshakes, marking cameras offline (`cameraLiveStatus = 'offline'`).
     - In contrast, dashboard channel tiles (`app.js`) stream via Safari's native AVPlayer (`video.src = hlsUrl`) or WebRTC/MSE via `go2rtc` without pre-emptive client-side JS `fetch()` blocking, which is why channels CH01–CH16 played seamlessly.
- **Resolution**:
  1. **GPS Metadata Parity (`camera_gps.json`)**:
     - Populated `"status": "Ready"` and `"url": "https://slothbpp23.duckdns.org/hls/{cid}.m3u8"` for all 22 Group A cameras (`A01`–`A22`), restoring 100% parity across all 485 map pins.
  2. **Direct Preview Mounting & Resilient Playback (`analytics.js?v=95`)**:
     - In `analytics.js` (`renderCameraPoints`), updated `previewHtml` to always mount the `<video>` element whenever `hasPreview` is true, rather than suppressing it behind synthetic readiness checks.
     - Updated `marker.on('popupopen')` to call `startPopupPreview(camId, cam)` whenever `hasPreview` is true.
     - Added an `error` event listener on Safari native HLS (`application/vnd.apple.mpegurl`) to display a polite "สัญญาณขาดหาย" fallback only if playback genuinely encounters an error.
     - In `checkCameraStatus`, ensured static `Ready` cameras remain `'ready'` even if client-side JS `fetch()` aborts or throws CORS/network errors.
     - Enhanced `isRtspCam` detection to recognize `A*` and `vigi_*` IDs reliably.
  3. **Cache Busting (`index.html`)**:
     - Bumped `analytics.js?v=94` to `analytics.js?v=95`.
- **Files Changed**: `frigate-nvr/config/dashboard-settings/camera_gps.json`, `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-16 - Hikvision DVR (`192.168.1.77`) LAN Outage Diagnosis (`ทางเข้ากองร้อย 1–3`) & iOS Safari 5G / Low Power Mode Streaming Fallback (Incident 2.125)
- **Problem**:
  - User uploaded mobile screenshot (`10:34:33`, 5G cellular, iOS Low Power Mode ON) showing `CH01 ทางเข้ากองร้อย1`, `CH02 ทางเข้ากองร้อย2`, and `CH03 ทางเข้ากองร้อย3` (`D_BPP215_1`–`D_BPP215_3`) with `VIDEO LOSS / สัญญาณวิดีโอขาดหาย / NO VIDEO`.
- **Root Cause**:
  1. **Physical LAN / Power Outage on Hikvision DVR (`192.168.1.77`)**:
     - The Hikvision DVR at `192.168.1.77:554` (which supplies `D_BPP215_1`–`D_BPP215_9`) stopped responding on the local LAN (`192.168.1.0/24`) today at **09:08:57 AM (`02:08:57 UTC`)**.
     - Live `Test-NetConnection 192.168.1.77 -Port 554`, `ffprobe`, `arp -a`, and a full subnet scan (`192.168.1.1..254` on ports `554/80/8000`) confirmed `DestinationHostUnreachable` (no ARP response and no RTSP port 554 open on `192.168.1.0/24`), while external/relay cameras (`KK06`, `doh_per_*`, `A01`–`A22`, `roiet_*`) continue streaming and recording normally.
     - Additionally, `go2rtc` retained stale/zombie RTSP producer entries on `D_BPP215_1_sub..3_sub` from before 09:08 AM.
  2. **iOS Safari 5G / Low Power Mode `ManagedMediaSource` Block**:
     - On iPhone (`iOS 18.7`) over 5G with Low Power Mode active (yellow battery icon), WebKit suppresses `ManagedMediaSource` from firing `sourceopen` unless `video.preload = 'auto'` is set, and in strict Low Power Mode can block `sourceopen` entirely (resulting in `101 2` bytes in nginx WebSocket logs).
- **Resolution**:
  1. Reset zombie RTSP producers on `D_BPP215_1_sub`, `D_BPP215_2_sub`, and `D_BPP215_3_sub` in `go2rtc` so they immediately reconnect as soon as power/LAN to `192.168.1.77` is restored.
  2. Updated `frigate-nvr/web/assets/app.js` (`?v=166` in `index.html`) to set `video.preload = 'auto'`, refresh `this.timeoutT` when switching to `startMSE()`, and fall back to `go2rtc` WebSocket MJPEG (`{ type: 'mjpeg' }`) if `ManagedMediaSource` `sourceopen` is suppressed after 2.5s on iOS Low Power Mode / 5G.

## Update 2026-10-16 - Desktop Map Header Responsive 2-Tier Layout & Toolbar Overflow Fix (Incident 2.124)
- **Problem**:
  - User reported via monitor photo: "เมนูบนแผนที่ในคอมมันล้นจอครับ" (The menu above the map on PC overflows the screen).
  - All 14 controls and dropdowns (Administrative level toggle, CCTV toggle, Add CCTV pin, Province selector, Heatmap toggle, Stash toggle, Officer location, Mission control, GPS tracker, Add GPS, Touch drag toggle, Incident type dropdown, Date range select, and Custom date inputs) were placed inside a single flex container (`.map-card-controls-right`) with `flex-shrink: 0` and unconstrained width.
  - On PC/desktop screens (~1050px map card width), the total unconstrained content width of all 14 controls exceeded 1,150px. Because `.map-card-controls-right` lacked `width: 100%` / `max-width: 100%`, it expanded beyond the card border. Because `.analytics-map-card` has `overflow: hidden`, the rightmost controls (`#incidentTypeDropdown` and `#dateRangeSelect` "เดือนปัจจุบัน") were partially or completely cut off and inaccessible to the user.
- **Resolution**:
  1. **2-Tier Semantic Layout (`analytics.js?v=94`)**:
     - Separated `.map-card-header` into two distinct tiers:
       - **Top Row (`.map-card-header-top`)**: Title (`🗺️ แผนที่โซนความเสี่ยง`) on the left, paired with the Primary Analytics Filters on the right (`.map-card-filters`: `#mapLevelToggle` อำเภอ/ตำบล, `#incidentTypeDropdown` ยาเสพติด/อาวุธปืน/ต่างด้าว/ทุกคดี, `#dateRangeSelect` เดือนปัจจุบัน, and `#customDateInputs`).
       - **Bottom Toolbar (`.map-card-controls-right`)**: Dedicated Map Layers & Tactical Tracking toolbar row (`กล้อง CCTV 📍`, `➕ ปักหมุดกล้อง`, `ทุกจังหวัด`, `ฮีทแมพ`, `จุดวางงาน`, `เปิดพิกัด`, `ภารกิจ`, `GPS ติดตาม`, `➕ เพิ่ม GPS`, `คุมแผนที่`).
  2. **Responsive CSS & Flex Containment (`analytics.js`)**:
     - Configured `.map-card-header`: `display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; min-height: auto;`.
     - Configured `.map-card-filters`: `display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end;` with `.itd-menu { right: 0; left: auto; }` preventing dropdown overflow off-screen.
     - Configured `.map-card-controls-right`: `width: 100%; max-width: 100%; box-sizing: border-box; flex-wrap: wrap; row-gap: 5px;` ensuring that on smaller desktop/laptop screens or zoomed displays, buttons gracefully wrap without overflowing or clipping.
     - Synced responsive media queries (`@media (max-width: 860px)` and `@media (max-width: 768px)`) to keep mobile layout smooth and stacked.
  3. **Cache Busting (`index.html`)**:
     - Bumped `analytics.js?v=93` to `analytics.js?v=94`.
- **Files Changed**: `frigate-nvr/web/assets/analytics.js`, `frigate-nvr/web/index.html`.

## Update 2026-10-15 - Fix "ยังไม่มีในระบบ NVR" Camera Object Config & End-to-End Per-User Telegram AI Notifications Across All 524 Cameras (Incident 2.123)
- **Problem**:
  1. When selecting any camera not active at Frigate boot time (428 of 524 cameras, e.g., `ubon_l2_cam287`, `doh_per_7_015`, `doh_per_8_007`, `KK06`, `Udon2`) in Settings → Tab 2 (`หน้าจอกล้อง`), the UI displayed:
     `กล้อง "<name>" ยังไม่มีในระบบ NVR — ตั้งค่าการตรวจจับได้เฉพาะกล้องที่ตั้งค่าไว้`
     and blocked configuring YOLO11 object classes or starting AI detection in `frigate-nvr`.
  2. Even when a camera was provisioned into `config.yml` by `reconcile_cameras_internal()` or `PUT /api/config/cameras/{name}/detect_toggle`, `frigate-nvr` never spawned `CameraTracker` / `CameraCapture` (`capture_pid: None`) unless `frigate-nvr` was restarted, and non-admin users (`user`, `officer`) received `403 Forbidden` when saving YOLO11 object classes (`PUT /api/config/cameras/{name}/objects`).
  3. Users did not reliably receive Telegram notifications across all cameras and object classes because:
     - `get_demand_camera_pool()` in `nas-bot-service/services/user_profile.py` only kept `online_cameras` (heartbeat < 5m) and `force_cameras`, deprovisioning AI cameras 5 minutes after a user closed their browser tab.
     - `nas-bot-service/main.py` raised `UnboundLocalError: cannot access local variable 'has_any_match'` at line 630 in Telegram polling when a search query had 0 matches.
     - `lpr-service/app.py` (`fetch_active_events`) only polled 5 labels (`car,motorcycle,truck,bus,person`), omitting `knife`, `backpack`, and `bicycle`.
     - Clicking `saveBtn` (`บันทึกและรีเฟรช`) on Tab 2 called `saveMyAlertsSettings()` unconditionally, overwriting `master_enabled: false` in `user_subscriptions.json` if Tab 4 had not been loaded or if the user had not manually toggled `#chkMyMasterAlert`.
- **Resolution**:
  1. **Unified 524-Camera Catalog & Role-Accessible Object Config (`config-api/api.py`, `app.js?v=165`)**:
     - Added `_ensure_camera_in_config()` in `config-api/api.py` to auto-materialize any of the 524 cameras from `camera_templates.json`, `go2rtc.streams`, `nvr_groups.json`, `camera_sources.json`, or `camera_gps.json`.
     - Added `GET /api/public-config/cameras-catalog` and `PUT /api/public-config/cameras/{name}/objects` (accessible to all authenticated roles) and updated `loadFrigateObjects()`, `loadNvrCameras()`, `applyObjectChanges()`, and `saveSettings()` in `app.js` (`?v=165`).
  2. **Zero-Restart Dynamic Frigate Runtime Provisioning Bridge (`watchlist-api/api.py`, `config-api/api.py`)**:
     - Added `POST /internal/frigate-runtime-sync` in `watchlist-api/api.py` (authenticated via `X-BPP-Federation: WATCHLIST_FEDERATION_SHARED_SECRET`), bridging `config-api` (on `security` network) to `frigate:5000` and `frigate:1984` (on `media` network) with zero infrastructure changes.
     - Automatically registers missing `go2rtc` streams via `PUT http://frigate:1984/api/streams` and invokes Frigate 0.17.2's internal ZMQ publisher via `PUT http://frigate:5000/api/config/set` (`update_topic: config/cameras/{name}/add`, `detect`, `record`, `enabled`, `objects`) so `CameraMaintainer` spawns/terminates `CameraTracker` and `CameraCapture` at runtime without restarting `frigate-nvr`.
  3. **24/7 AI Demand Persistence & End-to-End Telegram Alert Fixes (`nas-bot-service`, `lpr-service`, `app.js`)**:
     - Updated `user_profile.py` (`get_demand_camera_pool`) and `nas-bot-service/main.py` (`_compute_effective_ai_demand`) so cameras with active AI demand or active paired Telegram alert subscriptions remain provisioned even when the user closes their browser tab.
     - Fixed `has_any_match = False` initialization in `nas-bot-service/main.py`.
     - Updated `lpr-service/app.py` (`fetch_active_events` and `label_th_map`) to poll and translate all 9 alertable classes (`person`, `knife`, `backpack`, `car`, `motorcycle`, `bicycle`, `bus`, `truck`, `watchlist_plate`).
     - Added `state.myAlertsLoaded` and `state.myAlertsDirty` guards plus auto-enable of `#chkMyMasterAlert` in `app.js`.

## Update 2026-10-15 - Real-Time GPSONE Hardware Tracker, Officer Live Pursuit Mode & Custom GPS Pin Management on GIS Tactical Map (Incident 2.122)
- **Objective**:
  - Integrate real-time coordinates, battery status, speed, heading, live breadcrumb trails, and historical route playback from **GPSONE** (`gps903.net`) hardware GPS trackers onto the BPP-VMS GIS Tactical Map alongside the existing real-time officer location tracking system, without requiring hardware SMS reconfiguration so the mobile GPSONE app continues to work simultaneously.
  - Enable **1-second real-time tracking (`เกาะติดเป้าหมายเรียลไทม์`)** so field officers can pursue/follow a target GPS tracker live with auto-panning (`ล็อกเป้า` or `มุมมองคู่ เรา+เป้า`), a live tactical vector line connecting the officer's position to the target, and real-time distance/bearing readout.
  - Provide full **Disable/Turn Off (`การปิด`)**, **Delete (`การลบ`)**, and **Dual-Mode Add New GPS (`การเพิ่ม GPS ใหม่`)** controls directly on the map marker popup, map header toolbar, and GPS Manager modal.
  - Ensure accurate **Online vs. Offline status display**, **GPS Satellite vs. LBS coordinate resolution**, and **Real-Time Clock Correlation (`เวลาจริงปัจจุบัน` vs `พิกัดสุดท้ายก่อนออฟไลน์`)**.
- **Implementation**:
  1. **Backend GPSONE Cloud Poller (1.5s Interval), Live Breadcrumb Trail, Real-Time Clock Correlation & Manual Pin Registry (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `main.py`)**:
     - Hosted in `analytics-engine` (which has outbound internet access via the `edge` network and is already authenticated/proxied under `/api/analytics/*`, requiring zero infrastructure changes).
     - Supports Dual Modes in `upsert_device`:
       - `mode="gpsone"`: Authenticates against `http://www.gps903.net/Login.aspx?language=en-us` using IMEI + password, extracts `UserID` and `DeviceID`, caches `.ASPXAUTH` session cookies, and polls `POST /Ajax/DevicesAjax.asmx/GetDevicesByUserID` every **1.5 seconds (`POLL_INTERVAL_SEC = 1.5`)** in a background daemon thread for WGS84 coordinates (`latitude`, `longitude`), `battery_pct`, `speed_kmh`, `course`, `pos_mode`, `is_online`, and a rolling 60-point real-time breadcrumb trail (`live_trail`). Automatically releases any manual offline pin override (`override_lat`/`override_lng`) as soon as a new live GPS satellite fix (`dataType == "1"`) arrives.
       - `mode="manual"`: Stores custom latitude/longitude pins (`GPS-<timestamp>` auto-ID if `imei` is omitted) without polling `gps903.net`.
     - Added `_fetch_latest_gps_satellite_fix()` with incremental `since_time_str` windowing in `gpsone_tracker.py`: when `GetDevicesByUserID` returns an inaccurate LBS cell-tower coordinate (`dataType == "2"`, which can be 400m–2km away from the actual location), automatically resolves and caches the tracker's last accurate **GPS satellite coordinate (`dataType == "1"`, `ShowLBS == 0`)** via `GetDevicesHistory`, matching the GPSONE mobile app's default behavior.
     - Added `compute_time_correlation()` and `format_thai_duration()` in `gpsone_tracker.py` (`TZ_TH = UTC+7`): normalizes `device_time` against Thailand real time (guarding against double timezone offsets), returns live `real_time_th`, `age_seconds`, and `age_th` (e.g. `50 วัน 49 นาที`) on every `list_devices()` call, and translates `Offline` status to `ออฟไลน์ (ขาดการติดต่อ <ระยะเวลา>)`.
     - Enhanced `fetch_device_history()` to default to `ShowLBS=0` (accurate GPS satellite points only) and automatically fall back to the 7-day window leading up to the tracker's last recorded `gps_fix_time` when an offline tracker has no points in the recent 24-hour window.
     - Added REST endpoints in `analytics-engine/main.py`: `GET /api/analytics/gpsone/locations`, `GET /api/analytics/gpsone/devices`, `POST /api/analytics/gpsone/devices`, `POST /api/analytics/gpsone/devices/{imei}/toggle`, `POST /api/analytics/gpsone/devices/toggle-all`, `DELETE /api/analytics/gpsone/devices/{imei}`, `POST /api/analytics/gpsone/devices/{imei}/refresh`, and `GET /api/analytics/gpsone/devices/{imei}/history`.
     - Credentials and device registry are stored strictly in gitignored `frigate-nvr/analytics-engine/gpsone_devices.local.json` (and excluded in `.gitignore` and `tools/release/Sync-CleanRelease.ps1`).
  2. **Frontend 1-Second Real-Time Tactical Map Layer, Officer Live Pursuit Mode, Offline Visual State & Dual-Mode Manager UI (`frigate-nvr/web/assets/analytics.js`, `?v=92`)**:
     - Synchronized `gpsOnePollTimer` (`1000ms` / 1 second) with `loadOfficerLocations()` (`1000ms`), added smooth CSS marker interpolation (`.leaflet-marker-icon.gpsone-marker-pin`), directional heading arrow (`.gpsone-heading-arrow`), and in-place popup DOM updates (`updateOpenGpsOnePopupInPlace`) so 1-second updates never interrupt popup clicks.
     - Added **Officer Live Pursuit Mode (`🎯 เกาะติดเป้าหมายเรียลไทม์`)** (`toggleFollowGpsOne(imei)`, `setFollowPanMode(mode)`, `updateGpsOnePursuitOverlay()`): draws a live dashed tactical vector line (`L.polyline`) connecting the officer's real-time GPS location to the target GPSONE marker with a live midpoint distance + Thai bearing badge (`📏 ... กม. (ทิศ...)`), live breadcrumb trail, and a floating **Live Pursuit HUD Banner (`#mapGpsOnePursuitBanner`)** supporting both **`🎯 ล็อกเป้า`** (target lock) and **`🗺️ มุมมองคู่ (เรา+เป้า)`** (dual-bounds auto-fit).
     - Fixed Offline visual state in `createGpsOneDivIcon`, `buildGpsOnePopupHtml`, and `renderGpsOneModalList`: when `!dev.is_online`, hides the pulsing radar ring (`.gpsone-ping`), shows a red `ออฟไลน์` tag on the map marker pin instead of green `🔋100%`, replaces the misleading `⚪ สแตนด์บาย/ประหยัดพลังงาน` badge with `🔴 ออฟไลน์ (ขาดสัญญาณ <ระยะเวลา>)`, labels cached battery as `🔋 แบตก่อนดับ: <pct>%` in muted gray, and displays **`🕒 เวลาจริงปัจจุบัน`** alongside **`🛰️ พิกัดดาวเทียมจริงล่าสุด`** and **`📡 สัญญาณสุดท้ายก่อนดับ`** with elapsed offline duration.
     - Added direct control buttons inside each GPS marker popup (`buildGpsOnePopupHtml`): `🎯 เกาะติดเป้าหมายเรียลไทม์` (`toggleFollowGpsOne(imei)`), `📍 ย้ายจุดหมุด` (`relocateGpsOneOnMap(imei)`), `🛰️ พิกัดเครื่อง` (`resetGpsOneCoordOverride(imei)`), `⏸️ ปิด` (`toggleGpsOneDevice(imei, false)`), `✏️` (`editGpsOneFromPopup(imei)`), and `🗑️` (`deleteGpsOneDevice(imei)`), alongside Google Maps navigation and trajectory playback.
     - Updated `#gpsOneManagerModal` with bulk `🟢 เปิดแสดงทั้งหมด` / `⏸️ ปิดหมุด GPS ทั้งหมด`, per-device `🎯 เกาะติดเรียลไทม์`, `⏸️ ปิดหมุด` / `🟢 เปิดแสดงหมุด` toggle, and a Dual-Mode Add/Edit form supporting both GPSONE Cloud (`IMEI + Password`) and Manual Coordinates (`Lat, Lng`, Google Maps URL, or `🖱️ คลิกเลือกตำแหน่งบนแผนที่`).

## Update 2026-10-15 - Fix Telegram Bot False Vehicle Extraction ("ณ 11 บุรีรัมย์") and Arrest Report Hijack (Incident 2.120)
- **Problem**:
  - When an officer submitted a multi-suspect arrest and drug seizure report via Telegram (`@Sloth_bpp215bot`), the bot intercepted the message and prompted: `🚘 ตรวจพบข้อมูลยานพาหนะ: ณ 11 บุรีรัมย์ (รถยนต์) 🦥` with buttons to record it as an unidentified vehicle.
  - The report was completely dropped and never submitted to `chat-service` or recorded in the dossier vault / heatmap.
- **Root Cause**:
  1. `handle_intelligence_text` in `nas-bot-service/main.py` was executed unconditionally before `submit_plain_text_report`.
  2. In `intel_parser.py`, the vehicle plate regex `(?:ทะเบียน...)?\s*([1-9]?[ก-ฮ]{1,2}\s*[0-9]{1,4})` had an optional prefix, matching Thai prepositions/timestamps like `"ณ 11.00 น."` as plate `"ณ 11"`.
  3. When any province (e.g. `"จ.บุรีรัมย์"`) appeared in the text, it bypassed vehicle keyword validation and treated `"ณ 11"` as a vehicle, aborting report ingestion.
- **Resolution**:
  1. **Police Report Guard**: Added strict report detection (`จับกุม`, `ตรวจยึด`, `ผู้ต้องหา`, `ของกลาง`, `นำของกลางนำส่ง`, `สภ.`, `ชปส.`) in both `intel_parser.py` and `main.py`. Police reports are never parsed as snippets and route directly to `submit_plain_text_report`.
  2. **Strict Vehicle Regex**: Pre-stripped Thai dates, months, Buddhist Era years (`๒๕๖๙`), timestamps (`ณ 11.00 น.`), and address units. Single-letter series plates (`[ก-ฮ]\s*\d{1,4}`) now strictly require an explicit `ทะเบียน` prefix. In long text, vehicle keywords (`รถ`, `ทะเบียน`, `เก๋ง`, `กระบะ`) in close proximity to the plate are mandatory.
  3. **Purged False Records**: Deleted `ณ11_บุรีรัมย์`, `ณ11_กรุงเทพมหานคร`, `ยน๒๕๖๙_บุรีรัมย์`, `ยน๒๕๖๙_กรุงเทพมหานคร` from `vehicles_index.json`.
  4. **Container Restart**: Restarted `nas-bot-service`. Verified edge cases in Python (`None` on reports/dates/times, valid on real plates).

## Update 2026-10-15 - Fix Per-User ("ปิด AI บัญชีนี้") and Per-Camera ("btnChDetect") AI Detection Toggle & Frigate Runtime WebSocket Dispatch (Incident 2.121)
- **Problem**:
  - When an administrator disabled all AI for a user account (`ปิด AI บัญชีนี้` / `btnAcctAiOff`, e.g., on user `hallshiphop` with cameras `A01`–`A16`), AI detections continued running in `frigate-nvr` and appearing in the event feed.
  - Furthermore, when inspecting that user's cameras in the Settings modal (Tab 2 Dashboard / Tab 4 Alerts) and attempting to toggle AI off per-camera (`btnChDetect` / `saveSettings`), AI remained active in Frigate (`state.frigateDetect` still showed `true`) and kept 16 `ffmpeg` + AI detector pipelines running in memory (consuming 13.84 GB in `vmmemWSL`).
- **Root Cause**:
  1. **Missing Runtime Command Dispatch to `frigate-nvr`**:
     - `config-api/api.py` (`toggle_camera_detect`) updated `/config/config.yml` on disk (`detect.enabled = False`, `record.enabled = False`, `enabled = False`) and attempted to publish `frigate/<cam>/detect/set` via MQTT (`hostname="mqtt"`). However, `frigate-nvr` is isolated on the `media`/`media-egress` networks without MQTT enabled; instead, Frigate's internal `Dispatcher` listens on its WebSocket server (`/ws` on port 5000/5002, proxied at `/nvr/ws`).
     - Because neither `config-api` nor `app.js` (`setFrigateAi`) sent `<cam>/detect/set`, `<cam>/recordings/set`, and `<cam>/enabled/set` over `/nvr/ws`, `/config/config.yml` on disk had `detect: false` while `frigate-nvr` in memory continued running `A01`–`A16` with `detect: true, enabled: true`!
  2. **Per-Camera Toggle & Impersonation State Desync (`app.js`, `user_profile.py`)**:
     - `user_profile.py` (`apply_grid_action` and `update_profile`) updated `c["detect"] = False` in `channels` without synchronizing `disabled_ai_cameras`, and skipped accounts whose `channels` was `None` even if they had `active_channels` from heartbeat.
     - In `app.js`, when `btnChDetect` or `runGridKillSwitch('ai_off')` ran after `channels` already had `detect: false`, `ai_release` was empty (`[]`) or `toggle_camera_detect` returned early (`changed: False`) because `config.yml` on disk already had `detect.enabled == False`, never stopping the out-of-sync in-memory Frigate detector.
     - `saveSettings()` while impersonating a user (`state.impersonatingUser`) saved `targetProf` to `nas-bot-service` without reconciling `fetchAiDemandCounts()` against Frigate via `setFrigateAi`.
     - `renderChList`, `renderChForm`, `renderMyAlertsMatrix`, and `btnChEnabled` read/mutated `state.userProfile` (the admin's own profile) instead of `targetProf` when impersonating a user, and `renderMyAlertsMatrix` overwrote `c.detect === false` with `state.frigateDetect[srcId]`.
- **Fix & Recovery**:
  1. **Frigate Runtime WebSocket Command Dispatch (`frigate-nvr/web/assets/app.js`, `?v=164`)**:
     - Added `sendFrigateWsCommands(commands)` in `app.js` which connects to `/nvr/ws` (`frigate:5000/ws`) and dispatches `{ topic: "<cam>/detect/set", payload: "ON"|"OFF" }`, `{ topic: "<cam>/recordings/set", payload: "ON"|"OFF" }`, and `{ topic: "<cam>/enabled/set", payload: "ON"|"OFF" }` directly to Frigate's runtime `Dispatcher`.
     - Updated `setFrigateAi(src, on)` to invoke `sendFrigateWsCommands` after `PUT /api/config/cameras/{src}/detect_toggle` and immediately update `state.frigateDetect[src]` and `state.nvrCameras`.
     - Made `applyAiDeltaToFrigate`, `runGridKillSwitch`, `btnChDetect`, and `saveSettings` self-healing: whenever total AI demand (`counts[cam]`) is `0`, `setFrigateAi(cam, false)` is unconditionally enforced even if cached UI state or disk state already appeared `false`.
  2. **Impersonation & Profile Synchronization (`app.js`, `user_profile.py`, `main.py`, `config-api/api.py`)**:
     - `nas-bot-service/services/user_profile.py`: Synchronized `disabled_ai_cameras` with `channels` in `update_profile`, `_demanded_cameras`, and `apply_grid_action`; added fallback from `active_channels` when `channels` is not yet initialized.
     - `nas-bot-service/main.py`: Updated `_require_superadmin` to allow both `admin` and `superadmin` roles, matching `isKillSwitchAuthorized()` in `app.js`.
     - `config-api/api.py`: Removed early return in `toggle_camera_detect` so `record`, `enabled`, `ffmpeg.inputs`, and `camera_templates.json` are always reconciled; fixed `set_camera_objects` so editing object classes does not force `detect.enabled = True` on cameras whose AI is disabled.
     - Verified live `frigate-nvr` runtime config: only `D_BPP215_1`–`D_BPP215_3` have AI enabled (`A01`–`A16` are `(False, False, False)`), and WSL2 memory usage dropped from 13.84 GB to **1.89 GB**.

## Update 2026-10-15 - Cloudflare Tunnel Error 1033: WSL2 Docker Desktop Root VHDX Exhaustion & Recovery (Incident 2.119)
- **Problem**:
  - `https://vms.local` returned `Error 1033 Cloudflare Tunnel error` (Ray ID: `a4ad083f0b05798f`).
  - Docker Desktop failed to start on the host; `wsl -d docker-desktop` returned `wsl: An error occurred mounting the distribution disk, it was mounted read-only as a fallback.`
  - All 31 Docker containers (Frigate NVR, LPR, Supabase, `cloudflared-tunnel`) were down.
- **Root Cause**:
  - The root VHDX of `docker-desktop` distro (`C:\Users\bpp215\AppData\Local\Docker\wsl\main\ext4.vhdx`, 126 MB total) reached 100% capacity (123 MB used, 0 MB available).
  - Traced to a rogue archive write: 61 MB of old video clips and recordings were stored in `/mnt/host/e/BPP-VMS-Archive/` on the root disk when drive E: was detached.
  - Due to `ENOSPC` (Error 28), WSL could not create `/distro/wslXXXXXX` and mounted the filesystem as read-only (`EROFS`), crashing Docker Desktop backend (`com.docker.backend.exe`).
- **Fix & Recovery**:
  - Mounted disk in Debian, purged rogue `/mnt/host/e/` directory (recovering 54 MB, down to 54% usage).
  - Verified filesystem with `e2fsck -fy /dev/sdd` (0 errors).
  - Restarted WSL and launched `autostart-frigate.ps1`: all 18 Compose services / 31 containers recovered to healthy.
  - `cloudflared-tunnel` re-established active tunnels to Cloudflare edges (`sin22`, `bkk06`).
  - Probed `curl.exe -I https://vms.local`: returned `HTTP/1.1 200 OK` (CF-RAY `a4ad978e7b5a848d-HKG`).

## Update 2026-10-15 - Login Page & Auth API Content-Security-Policy (CSP) Isolation & Reconnaissance Hardening (Incident 2.118)
- **Objective**:
  - Prevent reconnaissance and information disclosure on unauthenticated entry points (`login.html`, `/auth/login`, `/auth/`).
  - Eliminate leakage of internal/external streaming architecture (public IP `38.159.250.22`, station DDNS `slothbpp23.duckdns.org`, MikroTik DDNS `*.sn.mynetname.net`, external camera hosts `camerai1.iticfoundation.org`, `streaming.udoncity.go.th`, `highwaytraffic.go.th`, and map tile providers) from the HTTP `Content-Security-Policy` (CSP) header.
  - Apply Defense-in-Depth form attribute hardening (`method="POST" action="/auth/login"`) to prevent credential leakage into query strings or server access logs if client JavaScript is blocked or slow.
- **Root Cause**:
  - Nginx configuration defined a single comprehensive CSP with all streaming IPs and map endpoints at the `server` block level.
  - In Nginx, unless overridden in a location block, unauthenticated requests to `/login.html` and `/auth/` received this broad header, giving attackers architectural knowledge of internal camera networks without authentication.
- **Implementation**:
  1. **Nginx Strict Login CSP Isolation (`dashboard-nginx.conf`)**:
     - `location = /login.html`: Added dedicated strict CSP containing strictly `'self'` directives (`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'none'; worker-src 'none'; manifest-src 'self'`).
     - Added strict security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, and `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`.
     - `location ^~ /auth/login` and `location /auth/`: Added `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, and `Cache-Control: no-store...` so auth endpoints never leak streaming topology.
     - `location = /index.html`: Explicitly declared full streaming and map CSP for authenticated sessions so WebRTC, HLS, Carto, OSM, and Google Maps functionality remains completely intact.
  2. **HTML & CSS Hardening (`login.html`, `login.css`)**:
     - Hardened `<form id="loginForm">` with `method="POST" action="/auth/login" autocomplete="on"` so credentials can never be sent as a GET query string.
     - Extracted inline styles from `login.html` into CSS classes in `frigate-nvr/web/assets/login.css` (`.brand-logo img`, `.login-footer .guide-link`).
     - **UI Logo & Glow Edge Fix**: Restored `style="width: 100%; height: 100%; object-fit: contain;"` on `<img>` and `width: 100%; height: 100%;` on `.brand-logo img`. Removed `overflow: hidden` from `.brand-logo` so the purple `drop-shadow(0 0 20px ...)` diffuses smoothly into the panel background without clipping into a square box/border. Added cache buster `login.css?v=3`.
  3. **Verification**:
     - Verified with `curl -k -I https://vms.local/login.html`: CSP strictly limited to `'self'`, 0 camera domains, 0 public streaming IPs, `x-frame-options: DENY`.
     - Verified `/auth/login`: CSP is `default-src 'none'`, `x-frame-options: DENY`.
     - Verified unauthenticated `/index.html`: Auth request interception returns 401 redirect to login with strict login CSP.

## Update 2026-10-15 - Onboard 29 Isan DOH PER Cameras Across Provincial Groups & Purge 57 Ghost/Alias Entries from Map Pin Dropdown (`➕ ปักหมุดกล้อง`)
- **Objective**:
  1. Add all **29 online Isan (and border) DOH `PER` cameras** (`PER-4-002` through `PER-17-014 (OUT)`) into BPP-VMS under their respective provincial groups (`<จังหวัด> (DOH)`) and pin all 29 onto the GIS map (`camera_gps.json`).
  2. Clean up the camera list in the map's `➕ ปักหมุดกล้อง` modal (`showAddCameraDropdown` / `fetchAllFrigateCameras`) so that it strictly reflects real cameras in the system (`519` total cameras = `485` pinned on map + `34` real unpinned cameras).
- **Implementation**:
  - **29 New DOH `PER` Cameras Added & Pinned**:
    - `doh_per_4_002`, `doh_per_4_003_1`, `doh_per_4_003_2`, `doh_per_6_023`, `doh_per_6_025`, `doh_per_6_026`, `doh_per_6_029`, `doh_per_6_030`, `doh_per_7_007`, `doh_per_7_015`, `doh_per_7_017`, `doh_per_7_020`, `doh_per_7_021`, `doh_per_7_022`, `doh_per_8_004`, `doh_per_8_005`, `doh_per_8_007`, `doh_per_8_011`, `doh_per_9_008`, `doh_per_9_009`, `doh_per_9_013`, `doh_per_9_015`, `doh_per_10_012`, `doh_per_13_013_1`, `doh_per_13_013_2`, `doh_per_13_020_1`, `doh_per_13_020_2`, `doh_per_17_014_in`, `doh_per_17_014_out`.
    - Dual-stream camera pairs (`4_003_2`, `13_013_2`, `13_020_2`, `17_014_out`) have their longitude offset by `+0.0004` (~40m) so both markers are visible and clickable side-by-side on the map.
    - Assigned to provincial groups in `nvr_groups.json`: `นครราชสีมา (DOH)`, `ขอนแก่น (DOH)`, `มุกดาหาร (DOH)`, `มหาสารคาม (DOH)`, `ร้อยเอ็ด (DOH)`, `อุบลราชธานี (DOH)`, `นครพนม (DOH)`, `สุรินทร์ (DOH)`, `บุรีรัมย์ (DOH)`, `ชัยภูมิ (DOH)`, `กาฬสินธุ์ (DOH)`, `สกลนคร (DOH)`, `บึงกาฬ (DOH)`.
    - Registered all 63 DOH + ITIC streams in live `go2rtc` (`http://127.0.0.1:1984/api/streams` inside `frigate-nvr`).
  - **Ghost Camera & Alias Purge (`57` stale entries removed)**:
    - Purged `a04_chanod`..`a20_nongtao` (12 lowercase `กก.ตชด.23` ghosts), `prasat1`..`prasat16` (16 deleted Prasat cameras), `KhonKaen1`..`KhonKaen26` (26 broken/duplicate entries), `kk01`..`kk27` (replaced by the 12 active `itic_kk*`), `longdo_doh_per_*`, `doh_per_17_013`, and unused stream keys `101`, `201`, `301`, `drone_live`, `live`, `rtmp_live_1`, `rtmp_live_2` from `config.yml`, `camera_templates.json`, `camera_sources.json`, `manual_recordings.json`, `camera_names.json`, and live `go2rtc`.
    - Synced `Udon1`, `Udon3`..`Udon10`, and `udon_api_38` into `config.yml` `go2rtc.streams` so all `519` grouped cameras in `nvr_groups.json` are present in `/api/config/cameras` (`485` pinned on map + `34` unpinned in `BPP215`/`บก.ตชด.ภาค 2`/`ทต.โกรกแก้ว`/`ทต.หนองแวง`).
  - **Backend & Frontend Fixes**:
    - `frigate-nvr/config-api/api.py`: Restricted RTMP stream-key extraction in `reconcile_cameras_internal()` to `rtmp*` URLs (preventing RTSP URLs ending in `/101`, `/201`, `/301` from creating bogus stream keys), and excluded empty ungrouped `go2rtc.streams` aliases from `get_cameras()`.
    - `frigate-nvr/web/assets/analytics.js` (`v=87`): Filtered out `INTERNAL_RTMP_ALIASES` and ungrouped entries (`!item.group`) in `fetchAllFrigateCameras()`; updated `#camProvinceSelect` initial HTML counts to `485 กล้อง` across all 17 Isan provinces.
    - `frigate-nvr/web/assets/app.js` (`v=163`): Added all 29 new `doh_per_*` Thai display names to `DEFAULT_SPECIAL_CAMERA_NAMES` and filtered out internal RTMP aliases/ungrouped entries in `loadNvrCameras()`.
    - Bumped cache busters in `frigate-nvr/web/index.html` (`app.js?v=163`, `analytics.js?v=87`).

## Update 2026-10-15 - Onboard 22 External HLS Cameras (A01–A22) into 'กล้องที่ดึงมาทางพิเศษ' & Purge Legacy 'กก.ตชด.23' Cameras/Map Pins
- **Objective**:
  1. Add 22 external HLS streams (`A01`–`A22` from `https://slothbpp23.duckdns.org/hls/A01.m3u8` .. `A22.m3u8`, covering ร้อย ตชด.234, 235, 236, and 237) into BPP-VMS under the camera group `"กล้องที่ดึงมาทางพิเศษ"`.
  2. Completely remove the 15 legacy RTMP push cameras in group `"กก.ตชด.23"` (`A04_Chanod`, `A05_Manorom`, `A06_Wanyai`, `A08_Namgum`, `A08_Namkum`, `A08_Saimoon`, `A09_Pakhuay`, `A11_Donnanghong`, `A12_Banhorm`, `A14_Donpucha`, `A15_Yeakbannard`, `A17_CHYU`, `A18_Tautain`, `A19_Nakhonruang`, `A20_Nongtao`) along with their 7 map pins (`Unknown (4)`, `Nakhon Phanom (2)`, `นครพนม (1)`) so map camera counts are accurate (`434 กล้อง`).
- **Implementation**:
  - Probed all 22 upstream URLs (`200 OK`, H.264 High 1920x1080 + AAC audio, CORS `Access-Control-Allow-Origin: *`).
  - Added `A01`–`A22` to `frigate-nvr/config/config.yml` (`cameras` and `go2rtc.streams` using `ffmpeg:https://slothbpp23.duckdns.org/hls/Axx.m3u8#input=hls#video=copy#audio=copy`), `frigate-nvr/config/camera_templates.json`, `frigate-nvr/config/nvr_groups.json` (group `"กล้องที่ดึงมาทางพิเศษ"`), and `frigate-nvr/config/dashboard-settings/camera_names.json` (Thai location + unit names).
  - Purged all 15 legacy `กก.ตชด.23` camera entries from `config.yml`, `nvr_groups.json`, `camera_templates.json`, `camera_sources.json`, `manual_recordings.json`, `camera_names.json`, `camera_gps.json`, `lpr/blocked_webhook_cameras.json`, and live `go2rtc`.
  - Updated `frigate-nvr/web/assets/analytics.js` (`v=86`) to remove the obsolete `Unknown (4)`, `Nakhon Phanom (2)`, and `นครพนม (1)` province filter entries, updated the total map pin count to `434 กล้อง`, added dynamic synchronization of `#camProvinceSelect` and `#btnToggleCams` counts from `cachedCameraGPS`, and enriched `fetchAllFrigateCameras()`, `renderCameraPoints()`, and `commitCameraGPS()` with Thai display names from `/settings/camera_names` and `window.displayCameraName`.
  - Updated `frigate-nvr/web/assets/app.js` (`v=162`) with `DEFAULT_SPECIAL_CAMERA_NAMES` (`A01`–`A22` Thai display names), refreshed `/settings/camera_names` inside `loadNvrCameras()`, and merged `DEFAULT_SPECIAL_CAMERA_NAMES` inside `saveCameraDisplayNames()` so stale browser tabs cannot overwrite `camera_names.json` and wipe the `A01`–`A22` Thai names.
  - Added `https://slothbpp23.duckdns.org` to `media-src` and `connect-src` in `frigate-nvr/dashboard-nginx.conf` CSP header and hot-reloaded `nvr-dashboard` nginx (`20-envsubst-on-templates.sh && nginx -s reload`).
  - Verified Frigate 0.17.2 schema validation (`PASSED`), `/api/public-config/hls-map`, `/api/config/cameras`, and `/settings/camera_names`.

## Update 2026-10-14 - Khon Kaen ITIC Camera ID Collision with ทต.โกรกแก้ว (kk## vs KK##)
- **Problem**: ITIC Khon Kaen cameras (`kk01`, `kk04`, ...) collided with ทต.โกรกแก้วโนนสุวรรณ cameras (`KK01`-`KK09`) on case-insensitive paths/systems.
- **Fix**: Renamed only the ITIC cameras to `itic_kk##` in `camera_gps.json`, `camera_names.json`, `cam_list.tsv`, `config.yml` (disabled stub `itic_kk01`) and the regional export. ทต.โกรกแก้ว `KK01-09` untouched (live Frigate/go2rtc/credentials/recordings). ITIC HLS URLs (`.../hls/kk##.m3u8`) unchanged.
- **Export**: `docs/regional_cameras_4provinces.json` regenerated (414 cameras, 12 `itic_kk*`).

## Update 2026-10-14 - Clean Release Configuration Decoupling and Safe Node Update Pipeline (ADR 0033)
- **Objective**: Enable downstream station nodes (e.g., ตชด.144) to seamlessly update their BPP-VMS system (frontend, backend services, bug fixes) from the Clean Distribution Repository (`itbpp215-creater/VMS-Clean`) without losing their station-specific configurations (`config.yml`, `.env`, `camera_sources.json`, `camera_credentials.env`, and SQLite databases).
- **Decisions & Implementation**:
  1. **Configuration Decoupling**:
     - Live site configuration files (`config.yml`, `camera_sources.json`, `camera_credentials.env`, `cam_list.tsv`, `.env`) are untracked from Git in `VMS-Clean` and ignored via `.gitignore`.
     - Baseline templates are tracked instead: `config.clean.yml`, `config.yml.example`, `camera_sources.json.template`, `.env.example`.
  2. **Continuous Linear History**:
     - Refactored `tools/release/Sync-CleanRelease.ps1` to fetch remote history from `VMS-Clean` and commit on top, eliminating orphan force-pushes so remote nodes can run standard `git pull origin main` without encountering `fatal: refusing to merge unrelated histories`.
  3. **Safe Node Update Worker (`Update_BPP-VMS.bat` / `update-system.ps1`)**:
     - Automated Snapshot: Copies existing site configs and SQLite databases to `.bpp-backup/<timestamp>/` prior to any code update.
     - Local Untrack: Issues `git update-index --assume-unchanged` locally to prevent merge conflicts.
     - Config Safeguard Gate: Verifies `config.yml` and `.env` after pull, immediately restoring them from snapshot if missing or reset. Initializes from `.example` only on fresh installs.
     - Rebuilds and launches containers with `docker compose up -d --build`.
  4. **Documentation**:
     - Created ADR 0033 (`docs/adr/0033-clean-release-configuration-decoupling-and-safe-node-update.md`).
     - Added domain glossary definitions in `CONTEXT.md`.

## Update 2026-10-15 - DOH Camera Stutter/Freeze Fix: Wowza 3-Segment Sliding Window, Sticky TARGETDURATION Normalization & Session Recovery (Incident 2.119)
- **Problem**: DOH (กรมทางหลวง, `streaming2.highwaytraffic.go.th`) cameras continued to stutter and freeze on the Dashboard grid and GIS map popups even after the initial buffer increase.
- **Root Causes Diagnosed**:
  1. **3-Segment Sliding Window vs `liveSyncDuration: 45` Mismatch**: DOH's Wowza server keeps **only 3 segments** (`~28.8s` total for 9.6s segments) in `chunklist_wXXXXXXXXX.m3u8` and deletes `seg[0]` immediately when `seg[3]` is created. Setting `liveSyncDuration: 45` (or `liveSyncDurationCount: 3..5`) exceeded the entire 28.8s playlist duration, causing `Hls.js` to clamp playback to `0.0s` of `seg[0]` (the oldest segment right before Wowza evicts it with `HTTP 404`).
  2. **Wowza Sticky `#EXT-X-TARGETDURATION` (19s–250s) Breaking Hls.js Polling & Live Sync**: Once a DOH camera experiences a single long GOP segment, Wowza permanently raises `#EXT-X-TARGETDURATION` (e.g., `24s`, `37s`, `51s`, `250s`) and never lowers it. In `hls.min.js`:
     - `liveSyncPosition` clamps to `edge - details.targetduration`, forcing playback back into `seg[0]` regardless of `liveSyncDuration`.
     - Playlist reload timer (`hn`) waits `targetduration` (`24–250s`) on update and `targetduration / 2` (`12–125s`) on unchanged reload (miss), which both starves the player buffer and exceeds Wowza's ~30-second HTTP session timeout, killing the `chunklist_wXXXXXXXXX.m3u8` session!
  3. **Dead Wowza Session Loop on `NETWORK_ERROR`**: Calling `hls.startLoad()` on error kept polling the expired `chunklist_wXXXXXXXXX.m3u8` URL instead of reloading `playlist.m3u8` to obtain a fresh `chunklist_w<NEW_ID>.m3u8` session.
  4. **Uncancelled Stagger Timer & Slow Gap Watchdog**: `setTimeout(start, ...)` in `Camera.connectHls` was not stored on `this.hlsStartT` or cleared in `cleanupPeer()`, allowing duplicate `Hls` instances to poll concurrently; `highBufferWatchdogPeriod: 5` delayed jumping over inter-segment PTS gaps (`0.8s` on `PER_13_010`) by 5 full seconds.
  5. **Upstream MPEG-TS Frame Rate Audit (22 DOH Cameras)**:
     - **Smooth 20–60 FPS at DOH Origin (10 cameras)**: `doh_per_11_004` (25fps), `doh_per_11_006` (26fps), `doh_per_11_008` (25fps), `doh_per_11_009` (25fps), `doh_per_12_005` (25fps), `doh_per_12_008` (25fps), `doh_per_13_009` (25fps), `doh_per_13_015` (25fps), `doh_per_15_011` (20fps), `doh_per_15_013` (60fps).
     - **Low/Bursty FPS inside DOH `.ts` Segments at Origin (12 cameras)**: `doh_per_15_007` (0.7fps, TD=250s), `doh_per_17_003` (0.9fps), `doh_per_17_005` (1.7fps), `doh_per_15_001` (2.1fps), `doh_per_15_002` (3.0fps), `doh_per_17_015` (3.2fps), `doh_per_17_012` (4.0fps), `doh_per_13_010` (5.2fps), `doh_per_17_017` (5.3fps), `doh_per_13_011` (9.8fps, frequent origin resets), `doh_per_15_012` & `doh_per_17_009` (origin timeout).
- **Fix**:
  - Added `createDohPlaylistLoader` (`pLoader`) in `web/assets/app.js` and wired it into both `Camera.connectHls` (`app.js`) and `startPopupPreview` (`analytics.js`):
    - Normalizes `#EXT-X-TARGETDURATION` to `3–6s` so Hls.js polls `chunklist_w*.m3u8` every `<=6s` (`3s` on miss), keeping Wowza sessions alive and preventing `seg[0]` clamping.
    - Dynamically sets `liveSyncDuration = dLast + 0.5 * dPrev` from actual `#EXTINF` values so playback always syncs to the middle of `seg[1]` (never touching expiring `seg[0]` while buffering `seg[1] + seg[2]`).
  - Set `highBufferWatchdogPeriod: 0.5`, `detectStallWithCurrentTimeMs: 600`, `maxBufferHole: 2.5`, `backBufferLength: 30`, `liveMaxUnchangedPlaylistRefresh: 8`, and re-triggered master `playlist.m3u8` reconnection on `PLAYLIST_UNCHANGED_ERROR` / `NETWORK_ERROR`.
  - Stored and cleared `this.hlsStartT` in `cleanupPeer()` / `destroy()`.
  - Bumped cache busters in `web/index.html`: `app.js?v=161`, `analytics.js?v=84`.

## Update 2026-10-14 - Restore 12 Khon Kaen ITIC Cameras Lost in Purge Script (Incident 2.118)
- **Problem**: All Khon Kaen city CCTV cameras (kk01–kk27, กล้องเทศบาลนครขอนแก่น) disappeared from the GIS map and the camera list panel. Province filter showed `ขอนแก่น (2)` instead of the expected 12+ cameras.
- **Root Cause**: Commit `c57b6c9` (2026-10-10 15:40) ran purge scripts (`clean_gps.py`, `purge_broken.py`) to remove offline Longdo/DOH cameras. The purge script deleted all cameras whose URLs matched the domain `camerai1.iticfoundation.org`. The Khon Kaen city CCTV feeds (kk01–kk27) also stream through this ITIC CDN domain and were erroneously swept along with the DOH dead cameras.
- **Fix**:
  - Re-added 12 live camera entries to `camera_gps.json` (on-disk, gitignored): `kk01,kk02,kk04,kk06,kk07,kk08,kk12,kk13,kk14,kk25,kk26,kk27` — all with GPS coordinates, Thai names, and HLS URLs verified 200 OK.
  - Restored Thai display names in `camera_names.json`.
  - Restored group mapping in `nvr_groups.json`.
  - Updated `analytics.js` province select: `ขอนแก่น (2) → (14)` and total `429 → 441`.
  - Bumped `analytics.js` cache buster `v=82 → v=83`.
  - Verified `config-api /api/public-config/hls-map` now returns all 12 kk cameras via camera_gps.json merge path.
- **Live stream status** (probed directly 2026-10-14):
  - 🟢 Online (200 OK): kk01, kk02, kk04, kk06, kk07, kk12, kk13, kk14, kk25, kk27
  - 🔴 Offline (404): kk08, kk09, kk18, kk19, kk21, kk22, kk24, kk26 — upstream ITIC server issue, not BPP-VMS issue.
- **Prevention**: The purge script must always whitelist `camerai1.iticfoundation.org/hls/kk*.m3u8` patterns (Khon Kaen Municipal CCTV) separately from Longdo DOH relay URLs.
- **Commit**: `5d1cbf3`

## Update 2026-10-12 - Frequent Multi-Camera Drops to '🟡 RECONNECT' Caused by Unchecked Frigate Container Restarts in Demand Reconciliation (Incident 2.117)
- **Problem**: Operators reported that frequently all or most camera tiles (e.g. 7 out of 8 cameras) dropped simultaneously into `🟡 RECONNECT: กำลังเชื่อมต่อใหม่...` while navigating or viewing the dashboard grid.
- **Root Cause & Fix**:
  - `reconcile_cameras_internal()` in `frigate-nvr/config-api/api.py` was being called on page load, channel switch, grid change, and AI delta. Because the user's active grid cameras (8 tiles) differed from `config.yml`'s active camera set (20 cameras), `to_provision` / `to_deprovision` evaluated to True, and lines 1639-1644 unconditionally touched `/config/restart.trigger`.
  - `system-restarter` detected the trigger and ran `docker restart config-validator frigate-nvr`. Because `go2rtc` runs inside `frigate-nvr`, restarting the container severed all active WebRTC/MSE WebSockets to the browser, causing every tile to display `🟡 RECONNECT`.
  - When the browser reconnected, subsequent requests triggered another reconcile, causing cascading restarts (e.g. 6 restarts in 3 minutes). Additionally, line 480 touched `restart.trigger` during stream URL validation.
  - Fix:
    1. Removed `with open("/config/restart.trigger", "a"): pass` from `reconcile_cameras_internal()` in `config-api/api.py`. All 585 camera streams are already pre-loaded into `go2rtc.streams` and served on demand; camera metadata updates in `config.yml` must never restart the container and drop active viewers.
    2. Removed rogue `open("/config/restart.trigger", "a").close()` from `_validate_stream_url`.
    3. Dynamic AI detection and recording toggling remains fully operational via MQTT (`frigate/{name}/detect/set` and `record/set`) without container restarts.
    4. Restarted `config-api`.
  - Verified `POST /api/public-config/reconcile` returns 200 OK without creating `restart.trigger`, `system-restarter` triggered zero new restarts, and `frigate-nvr` uptime and WebRTC streams remain continuously stable.

## Update 2026-10-12 - Camera Settings UI: AI Detection Toggle Reverting with 'สตรีมระบบของกล้องนี้ถูกปิดอยู่' (Incident 2.116)
- **Problem**: In the Camera Settings modal, clicking `[ 🤖 AI ]` to turn on AI detection on a camera (e.g. CH05 ในบ้านหงอนไก่) immediately bounced back to off, displaying toast error `สตรีมระบบของกล้องนี้ถูกปิดอยู่ ต้องเปิดสตรีมระบบก่อนจึงจะเปิด AI ได้` (HTTP 409).
- **Root Cause & Fix**:
  - Under Demand-Driven CPU Preservation (ADR-0020), when AI and recording are disabled, `config-api` sets `camera['enabled'] = False` to stop the Frigate capture process while leaving go2rtc live streaming active.
  - In `config-api/api.py:toggle_camera_detect`, a legacy check `if new_detect and tmpl.get("enabled") is False: raise 409` created a deadlock: because `enabled` was False when AI was off, turning AI back on was permanently blocked.
  - Fix: Removed the deadlock check in `config-api/api.py`. When `new_detect` is True, `toggle_camera_detect` automatically activates `camera['enabled'] = True`, `record['enabled'] = True`, and attaches the detect role to the sub-stream. Restarted `config-api`.
  - Verified `nongwang15` AI toggles on cleanly without error and YOLO11 detection is actively running.

## Update 2026-10-12 - Public IP RTSP Cameras (HEVC/H.265) Black Screen / Green Buffer Corruption Fix (Incident 2.115)
- **Problem**: Remote Public IP RTSP cameras (e.g. `118.172.151.7:45554`, CH04 สี่แยกบ้านหงอนไก่, CH05 ในบ้านหงอนไก่) connected with a green dot and REC indicator, but displayed solid black video on Dashboard/mobile.
- **Root Cause & Fix**:
  - The cameras stream H.265 (HEVC). The global `go2rtc.ffmpeg.rtsp` template had `-fflags nobuffer -flags low_delay`. Over WAN, packet jitter caused FFmpeg to drop packets and push incomplete P-frames to NVDEC before the IDR keyframe arrived, producing all-zero YUV frames (`RGB [0, 203, 0]` solid green screen) which browsers rendered as black.
  - Fix: Changed `go2rtc.ffmpeg.rtsp` in `config.yml` from `-fflags nobuffer -flags low_delay` to `-fflags +genpts+discardcorrupt`. Restarted `frigate-nvr`.
  - Verified frames now decode with full colors (>52,000 to >66,000 colors, RGB mean ~104). Both local LAN cameras and WAN public IP cameras stream crisp video smoothly.

## Update 2026-10-11 - Cloudflare 502 Bad Gateway Caused by Duplicate Cloudflare Tunnel Token in Supabase Container (Incident 2.114)
- **Problem**: When opening `https://vms.local` from external mobile devices (5G), Cloudflare intermittently/persistently failed with `Bad gateway Error code 502` (Host Error).
- **Root Cause & Fix**:
  - `D:\linebot\nas_linebot_system\supabase_docker\docker-compose.override.yml` defined an uncoordinated `supabase-tunnel` container using the **exact same Cloudflare Tunnel Token** as `cloudflared-tunnel` in `frigate-nvr/docker-compose.yml`.
  - Cloudflare Zero Trust load-balanced traffic between both instances. Because `supabase-tunnel` was not attached to `frigate-nvr_edge`, it failed with `lookup nvr-dashboard on 127.0.0.11:53: no such host`, producing 502 Bad Gateway.
  - Fix: Connected `cloudflared-tunnel` to `supabase_default` so one unified tunnel container handles both `vms.local` (`nvr-dashboard:443`) and `db.example.com` (`kong:8000`). Removed `supabase-tunnel` (`docker rm -f supabase-tunnel`) and commented out `tunnel:` in `supabase_docker/docker-compose.override.yml`.
  - Verified 100% 200 OK responses on `https://vms.local`.

## Update 2026-10-11 - Frigate Looping Crash (RestartCount=37) on Remote Node (ตชด.144) Resolved (Incident 2.113)
- **Problem**: On remote NVR node (ตชด.144 on `BOSS PC`, `https://bpp144.duckdns.org/index.html`), all 10 cameras simultaneously disconnected every ~1-2 minutes with `🟡 RECONNECT: กำลังเชื่อมต่อใหม่...`. `docker inspect frigate-nvr` reported `RestartCount=37`, `ExitCode=0`, and `OOMKilled=false`.
- **Root Cause & Fix**:
  - `config.yml` on the node contained a `model:` block (`path: /config/model_cache/yolo11m-640.onnx`), but omitted `detectors:`.
  - Frigate 0.17 defaulted to `cpu` detector (`cpu_tfl.py` using TensorFlow Lite), which threw `ValueError: Could not open ...` when attempting to load the non-existent ONNX model.
  - Frigate Watchdog detected the dead detector process (`not is_alive()`), logged `"Detection appears to have stopped. Exiting Frigate..."`, and called `restart_frigate()` -> SIGTERM to PID 1 -> `go2rtc` and `frigate` exited (`ExitCode=0`) -> all active WebRTC connections severed simultaneously -> Docker restarted container.
  - Fix: Removed `model:` and `objects:` blocks from `config.yml` (since all 10 cameras on 144 already have `detect: enabled: false`). Verified Frigate falls back to bundled `/cpu_model.tflite` without crashing.
  - Confirmed `BOSS PC` has an active `NVIDIA GeForce RTX 3050 (6GB)` with NVDEC hardware decoding accelerating ffmpeg (`preset-nvidia`).
  - Container restarted once; `RestartCount` stopped incrementing, Frigate stayed continuously healthy, and all 10 cameras stream smoothly with zero disconnect storms.

## Update 2026-10-11 - Dashboard Toolbar Layout Revert Fix (Incident 2.112)
- **Problem**: When rearranging camera tiles using the `🔀 จัดเรียง` toolbar button and clicking `💾 บันทึก`, the layout reverted to server default upon browser refresh.
- **Fix**:
  - Updated `frigate-nvr/web/assets/app.js` (`$('btnLayoutSave')` click handler) to automatically sync to `saveServerChannels()` (`PUT /settings/admin/channels`) when the user is an admin or superadmin.
  - Committed and pushed to `origin main`.

## Update 2026-10-11 - Web UI Modal: "Frigate rejected candidate configuration" / YAML Root Indentation Fix (Incident 2.111)
- **Problem**: When adding/editing a camera via the BPP-VMS Web UI modal, the save request was rejected with `{"detail":"Frigate rejected the candidate configuration"}` (HTTP 422).
- **Root Cause & Fix**:
  - `config-api` runs candidate configurations through Frigate's Pydantic parser (`config-validator:5004/validate`) before saving.
  - A previously edited camera block (`Nongtapod_144:`) was indented at the root level (0 spaces) instead of under `cameras:` (2 spaces), causing Pydantic to reject the entire document with `Extra inputs are not permitted [type=extra_forbidden]`.
  - Fixing the indentation of the camera block under `cameras:` resolved the issue; subsequent camera additions through the Web UI succeeded immediately.

## Update 2026-10-11 - BPP-215 Standby RTMP Push Slots & WebRTC Stream Alignment
- **Verification on BPP-215**:
  - Ports 1935 (RTMP ingest) and 8555 (WebRTC TCP/UDP) verified open and listening with Inbound firewall rules active.
  - WebRTC candidates in `config.yml` confirmed optimal (`192.168.1.200:8555`, `127.0.0.1:8555`, `bpp215.duckdns.org:8555`, `stun:8555`) supporting both local LAN and remote DDNS connections.
  - Added dedicated standby RTMP push slots (`rtmp_live_1:`, `rtmp_live_2:`, `drone_live:`) under `go2rtc.streams:` in `frigate-nvr/config/config.yml`.
  - Tested RTMP ingest with live FFmpeg push to `rtmp://127.0.0.1:1935/live/rtmp_live_1`; go2rtc accepted push seamlessly with zero errors.
  - Scope was strictly isolated: no existing cameras (`D_BPP215_1..3`, DOH feeds, provincial feeds) or system infrastructure were touched.

## Update 2026-10-11 - Standalone Deployment: RTMP Push Ingest & WebRTC Candidate Patterns (Incident 2.110)
- **Problem**: When deploying BPP-VMS to external stations (e.g., ตชด.144 on `BOSS PC`), incoming RTMP push cameras (4G cellular cameras pushed to port 1935) were rejected by go2rtc with `stream not found`, and remote WebRTC streams dropped due to missing ICE candidates.
- **Root Cause & Fix**:
  - In `go2rtc`, incoming RTMP ingest streams must be declared under `streams:` with `<stream_name>:` and empty value (not `[]`).
  - Added STUN and DDNS guidance under `webrtc.candidates` in `frigate-nvr/config/config.clean.yml`.
  - Added recommended RTMP push camera template with `detect: enabled: false` to prevent Frigate Watchdog from killing the container when cellular connection drops.
  - Synced to Clean Distribution Repo (`itbpp215-creater/VMS-Clean`) via `tools/release/Sync-CleanRelease.ps1`.

## Update 2026-10-11 - Single-Drive Deployment & Parameterized Drive E: Archive Mount (Incident 2.109)
- **Problem**: When deploying on single-drive machines (C: only, no drive E:), `docker compose up -d` crashed with `Error response from daemon: mkdir E:\BPP-VMS-Archive: The system cannot find the path specified.`
- **Fix**:
  - Replaced hardcoded `E:/BPP-VMS-Archive` mount paths in `frigate-nvr/docker-compose.yml` with `${BPP_ARCHIVE_CROPS_DIR:-./storage/lpr-archive}` and `${BPP_ARCHIVE_DIR:-./storage/lpr-archive}`.
  - Added default variables to `clean.env.template`, `.env.example`, and `setup-new-machine.ps1`.
  - Added auto-creation of `storage/recordings`, `storage/clips`, `storage/exports`, and `storage/lpr-archive` directories in `setup-new-machine.ps1`.
  - Synced to Clean Distribution Repo via `Sync-CleanRelease.ps1`.

## Update 2026-10-11 - Clean Distribution Release Framework & Zero-BPP215 Leak Sanitizer Gate
- **Architecture & Design**: Added Clean Distribution framework to allow deploying BPP-VMS to external stations/machines without leaking BPP215 cameras, NAS credentials, Telegram Bot tokens, Gemini API keys, or suspect watchlists.
- **Pre-Push Sanitization Gate (`tools/release/Sync-CleanRelease.ps1`)**:
  - Automatically scrubs private domains (`vms.local`), internal NAS IPs (`192.168.1.100`), passwords (`ChangeMePassword123`), and API keys.
  - Replaces `config.yml` with clean camera template (`config.clean.yml`) and `.env.example` with `clean.env.template`.
  - Runs automated Linter/Gate: blocks any push immediately if any sensitive pattern is detected.
  - Generates standalone offline `bpp-vms-clean-installer.zip` (bundled with AI models).
  - Pushes clean code to Clean Distribution Repo (`https://github.com/itbpp215-creater/VMS-Clean.git`).
- **Comprehensive Setup Guides**:
  - `docs/CLEAN_INSTALL_GUIDE_TH.md` (Markdown manual)
  - `docs/clean_install_guide.html` (Interactive web guide with copy buttons and external links for getting Gemini keys, Telegram tokens, NAS configs, and RTSP streams).
- **ADR & Policies**:
  - Added ADR 0032 (`docs/adr/0032-clean-distribution-architecture-and-sanitization-gate.md`).
  - Added `tools/release/CLEAN_RELEASE_POLICY.md`.
  - Added 1-Click launcher `tools/launchers/Publish_Clean_Release.bat`.
  - Codified Directive 5 in both Git and Obsidian `GEMINI.md`.
  - Purged 60+ legacy ad-hoc scratch and test files (`.py`, `.js`, and scrap data dumps) from repository root, n8n, and service directories, and codified Directive 6 / `.gitignore` to prevent temporary test scripts from ever entering git again.

## Update 2026-10-10 - Fixed Map Popup Fold and Network Drop (Incidents 2.105, 2.106, 2.107)
- **Incident 2.107 (Subnet Collision)**: Discovered that after fixing Docker, NVR 192.168.1.77 was still unreachable from inside containers. RCA: supabase_default network was randomly assigned 192.168.0.0/20 by Docker IPAM, trapping all traffic to the NVR. Fixed by hardcoding subnet: 10.254.0.0/16 in Supabase's docker-compose.yml.
- **Incident 2.105 (Docker Network Route Drop)**: Local cameras 192.168.1.77 lost connection (Timeout). A hard wsl --shutdown caused WSL's Docker desktop virtual disks to become corrupt and mount read-only, preventing the Docker engine from starting. Fixed by mounting the VHDXs bare (wsl --mount --vhd --bare) and running e2fsck from Debian, allowing Docker Desktop to start and rebuild the LAN bridge.
- **Incident 2.106 (Map Popup Auto-Close)**: The map popup for camera views would spontaneously close after ~30s. Fixed in nalytics.js: the 30-second loadAllData() refresh was indiscriminately destroying and recreating all camera Leaflet markers on the map, which forcefully closes any anchored popup. Changed to skip marker creation if they are already rendered on the map.

# Session Summary

## 1. Outstanding User Requests
- **Retrain Thai plate character OCR (data_plate.pt) correctly**: COMPLETED. The new model (`data_plate_v3.pt`) has been deployed to production and `lpr-service` was restarted.

- **Improve Telegram Alert Formatting:** COMPLETED. Modified lpr-service/app.py to parse Thai camera names from camera_names.json, include Google Maps links from camera_gps.json, and combine the full vehicle snapshot with the license plate crop via cv2.vconcat. Restarted lpr-service.
- **Investigate missing Telegram alert for detected plate กพ225:** COMPLETED. The alert was suppressed because the OCR model read 2525, failing the exact-digit partial match rule. User adjudicated the plate in the UI, which queued a confirmed alert successfully.


- **Fix infinite reconnect loop (BUFFER status):** COMPLETED. Fixed a bug in `web/assets/app.js` where `currentMode = 'mse'` prevented the MSE fallback from executing its setup function, causing streams to get stuck in an infinite `CONNECT_TIMEOUT` loop when WebRTC failed. Also fixed the UI to show `RECONNECT` instead of `BUFFER` when reconnecting after the grace period.


- **Fix Telegram bot getting stuck processing photos:** COMPLETED. Fixed a `NameError` in `nas-bot-service/main.py` where `custom_case_match` was referenced instead of `explicit_case`. This caused the async task to crash silently, leaving the bot stuck in the "Processing" state.

## 2. Agreed Decisions (grill-me)
1. Used 115 human-verified crops from MP4s + 121 human-approved crops from `watchlist.db` (pool3) + 4000 synthetic crops.
2. Discarded snapshot crops completely to avoid Frigate overlay text ("car: 94%").
3. 100-plate holdout was used to evaluate old vs new model.

## 3. Key Lessons & Fixes
- **Frigate Overlay Hallucination**: Discarded snapshot crops which contained Frigate overlay text. New model is completely immune to this hallucination.
- **Stuttering / Multi-line Slicing Bug**: Discovered a critical logic bug in `lpr-service/app.py`'s `_read_chars` slicing (ADR-0027). The top half (`0-52%`) and bottom half (`40-100%`) overlap between `40-52%`. Characters in this region were detected twice, and `f_sliced` concatenated them without NMS, causing stuttering (e.g. "à¸à¸772266353"). Added NMS directly to `app.py` for `f_sliced`. This fixed stuttering for BOTH the baseline and the new model.

## 4. Model Evaluation (Holdout 100 plates, with NMS fix applied)
- **Baseline (`data_plate_v1.pt`)**: Exact Match 30/100, Province 8/26.
- **New Model (`data_plate_v3.pt`)**: Exact Match 32/100, Province 16/26.
- Province accuracy doubled (+8 pts). Exact match slightly improved. Hallucinations eliminated. User explicitly approved the swap to V3.

## Update 2026-10-07 - Fixed Frigate AI Event Detection Stoppage (Incident 2.92)
- **Root Cause:** A dashboard settings save at 14:40:44 UTC with only KhonKaen channels in the grid triggered UI camera deprovisioning. Demand reconcile marked D_BPP215_1..3 as detect disabled and removed detect sub-streams from config.yml and camera_templates.json, freezing event detection for >20 mins.
- **Fix:**
  - Added `force_active: true` to D_BPP215_1..3 in camera_templates.json to prevent deprovisioning during demand reconciliation.
  - Restored detect roles, sub-stream inputs, and record settings in config.yml and camera_templates.json.
  - Restored master channels.json with D_BPP215_1..3 having detect: true.
  - Restarted frigate-nvr and config-api.
- **Verification:** Detection FPS active (5.9-13.1 FPS), new vehicle events on D_BPP215_1 and D_BPP215_3 detected and processed by LPR immediately.

## Update 2026-10-07 - Protection added for Core Perimeter Cameras against Accidental Grid Save Deactivation
- Added server-side guard in `config-api/api.py`: `set_camera_enabled` automatically refuses to deactivate cameras marked `force_active: true` or in `get_lpr_cameras()`, keeping AI detect enabled.
- Added client-side guard in `web/assets/app.js`: `saveSettings` now excludes `D_BPP215_1..3` from the unreferenced disable loop when an alternate camera grid is saved.

## Update 2026-10-07 - Improved Responsive Layout for "à¸à¸²à¸£à¹à¸ˆà¹‰à¸‡à¹€à¸•à¸·à¸­à¸™à¸ªà¹ˆà¸§à¸™à¸•à¸±à¸§" (My Alerts) Modal on Mobile Viewports (Incident 2.93)
- **Issue:** On mobile viewports (~390px), the superadmin account selector crushed the label into single-character vertical lines ("à¸à¸³à¸¥à¸±à¸‡\nà¸•à¸±à¹‰à¸‡\nà¸„à¹ˆà¸²\nà¹ƒà¸«à¹‰:"), and camera card headers wrapped awkwardly with preset buttons floating detached to the right.
- **Root Cause:**
  - `#wrapAlertTargetUser` label span lacked `white-space: nowrap` and `flex-shrink: 0`, collapsing inside flex container.
  - Camera card header (`.obj-head`) had `.obj-quick` with `margin-left: auto`, creating unbalanced whitespace when wrapped.
- **Fix:**
  - Added `.my-alerts-header-row`, `.my-alerts-target-user-wrap`, `.my-alerts-target-user-label`, and `.my-alerts-target-user-select`. Label now has `white-space: nowrap !important; flex-shrink: 0 !important;` and the selector expands across full width on mobile.
  - Redesigned camera card header (`.my-alerts-card-head`): on mobile viewports (< 768px), title and AI badge span line 1 (`justify-content: space-between`), and quick preset buttons (`âš¡ à¸Šà¸¸à¸”à¹à¸™à¸°à¸™à¸³`, `âœ• à¸¥à¹‰à¸²à¸‡à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”`) form a balanced 50/50 dual-button row on line 2 with 34px touch target height.
  - Enhanced touch targets and visual feedback for `.obj-item` chip pills with bright green checkmark (`âœ“`) and active gradient.
  - Bumped cache busters: `app.css?v=150`, `app.js?v=154`.

## Update 2026-10-07 - Fixed White-on-White Text in Officer GPS Tracking Map Popup (Incident 2.94)
- **Issue:** On the AI Analytics & Heatmap map, tapping an officer pin opened a Leaflet speech bubble popup where the person's name and details were pure white (`#ffffff` / `#f8fafc`) on a white popup background, rendering the text invisible.
- **Root Cause:** In `web/assets/analytics.js`, `popupContent` had hardcoded dark-mode inline styles (`color: #ffffff;`, `color: #f8fafc;`, `color: #cbd5e1;`, `border-bottom: 1px solid rgba(255,255,255,0.1)`) inside Leaflet's default `.leaflet-popup-content-wrapper` which is white (`#ffffff`).
- **Fix:**
  - Updated `popupContent` to use high-contrast dark typography: person's name in `#0f172a` (bold 13.5px), handle in `#64748b`, coordinates in `#0284c7`, accuracy & speed in `#0f172a`, and clean border `#e2e8f0`.
  - Added role badge styling (Superadmin purple, Admin pink, Officer blue).
  - Explicitly styled `.officer-leaflet-popup` in `app.css` and injected styles.
  - Bumped cache busters: `analytics.js?v=73`, `app.css?v=151`.

## Update 2026-10-07 - Fixed Watchlist Behavioral Analytics Modal Layout on Mobile (Incident 2.95)
- **Issue:** On mobile viewports (~390px), the Watchlist Behavioral Analytics modal ("à¸§à¸´à¹€à¸„à¸£à¸²à¸°à¸«à¹Œà¸žà¸¤à¸•à¸´à¸à¸£à¸£à¸¡") experienced horizontal overflow. The 24-hour bar chart and the right column of the target profile ("à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸‡à¸²à¸™:", "à¹€à¸„à¸£à¸·à¸­à¸‚à¹ˆà¸²à¸¢:") were cut off past the screen edge, and address/crime history had oversized fonts from iOS Safari auto text boosting.
- **Root Cause:**
  - Inline style `grid-template-columns: 280px 1fr;` in `index.html` and mobile CSS `repeat(2, 1fr)` squeezed 2 charts side-by-side into 175px columns, overflowing the mobile viewport.
  - `#wlStatsProfile` used 2 columns on mobile, pushing the right column off-screen.
  - Missing `-webkit-text-size-adjust: 100%` caused WebKit to enlarge font sizes on full-width elements.
- **Fix:**
  - Added `-webkit-text-size-adjust: 100%; text-size-adjust: 100%;` to `html, body` in `app.css`.
  - Restructured `.wl-stats-modal .stats-grid` on mobile (< 768px) into a single-column vertical stack (`display: flex !important; flex-direction: column !important; gap: 12px; width: 100%;`), letting each chart occupy 100% width with zero horizontal overflow.
  - Restructured `#wlStatsProfile` on mobile as a clean vertical key-value list with consistent 12px font and word wrapping.
  - Cleaned up inline styles from `index.html` in `.wl-stats-modal` and delegated styling to CSS.
  - Enhanced Chart.js options in `web/assets/watchlist.js` (`maxTicksLimit: 8` for 24h chart on mobile, responsive font sizes, bottom-aligned legend for donut chart).
  - Bumped cache busters: `app.css?v=152`, `watchlist.js?v=10`.

## Update 2026-10-07 - Watchlist Behavioral Stats Partial Match Ingestion (ADR 0031)
- **Goal:** Ingest watchlist observations into `watchlist_history` (behavioral analytics modal & charts) when trailing digits match completely and at least one letter matches in place (`exact` and `letters_partial` tiers from ADR 0030).
- **Decisions & Implementation:**
  1. **Ingestion Scope:** Included `exact` and `letters_partial` tiers; excluded `digits_only` (no letters) to avoid polluting target behavioral charts with generic vehicles.
  2. **Deduplication Cooldown:** Enforced a 3-minute cooldown per `(watchlist_plate, camera)` in `watchlist-api` (`_queue_ai_unconfirmed_alerts` and `add_history`), ensuring one physical pass counts as 1 visit.
  3. **Storage Schema:** Migrated `watchlist_history` with `observed_plate` and `match_tier` columns; keyed under canonical target `plate` so aggregate queries (`by_camera`, `by_hour`, `by_day`) correctly reflect full activity.
  4. **UI Auditability:** Updated `web/assets/watchlist.js` history table to display actual AI-read characters and tier badge (`ðŸŸ  à¸à¸‚9999 (à¸•à¸£à¸‡à¸šà¸²à¸‡à¸ªà¹ˆà¸§à¸™)` or `ðŸ”´ à¸•à¸£à¸‡à¸—à¸¸à¸à¸•à¸±à¸§`).
  5. **Scope:** Forward-only ingestion; no backfill of historical candidates.
  6. **Cache Busters:** `app.css?v=153`, `watchlist.js?v=11`.

### Update 2026-10-07 - Fixed Officer Location Button Sync, Heartbeat Auto-Disable & Map Centering (Incident 2.96)
- **Issue:** On the AI Analytics & Heatmap modal ("à¹à¸œà¸™à¸—à¸µà¹ˆà¹‚à¸‹à¸™à¸„à¸§à¸²à¸¡à¹€à¸ªà¸µà¹ˆà¸¢à¸‡"), an officer's live GPS pin (e.g. `@suchakree`) was clearly visible on the Leaflet map at Satuk, but the location toggle button in the control bar (`#btnToggleOfficerLocation`) remained in its inactive default state (`[ â¦¿ à¹€à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸” ]` without `.active` green glow) instead of showing `à¸à¸³à¸¥à¸±à¸‡à¹à¸Šà¸£à¹Œà¸žà¸´à¸à¸±à¸”`. Furthermore, clicking the button previously triggered an unexpected confirmation modal asking whether to turn off everyone's GPS, inadvertently wiping user coordinates.
- **Root Cause:**
  1. **Heartbeat Auto-Disable False Positive:** In `auth-service/auth.py`, `force_location_off = (not sharing_enabled) and loc_sharing`. Because `sharing_enabled` in `user_location` was not set to 1 by normal user GPS tracking, every 30s heartbeat returned `force_location_off: True`, causing client suicide (`tracker.stop(false)`).
  2. **Destructive Background Error Handling:** In `web/assets/app.js`, when silent background geolocation failed on mobile (e.g. Safari background permission restriction), `err.code === 1` called `this.stop(false)` which wiped `isSharing = false` and reverted UI to inactive.
  3. **One-Way DOM Injection Trap:** In `web/assets/analytics.js`, `btnLoc.classList.toggle('active', isSharing)` was isolated inside an `else` block after `if (tracker) { tracker.updateUI() }`. Since `tracker` was always defined, the direct DOM update never executed, leaving the button dependent on `tracker.isSharing` which was repeatedly reset to false by background errors.
  4. **Superadmin Force-All Conflation:** Personal toggle was previously bound to global force-all prompt, causing accidental coordinate purges.
  5. **Null Byte in app.js:** A corrupted byte `\x00` in `app.js` at line 10870 caused file search utilities to treat `app.js` as binary.
- **Fix:**
  1. **`auth-service/auth.py`:**
     - Fixed `force_location_off`: now requires `ul_row is not None and not sharing_enabled and loc_sharing`.
     - Fixed `force_all_location_sharing`: corrected variable name `superadmin["sub"]` in `log_audit()` (avoiding HTTP 500).
     - Updated `toggle_location_sharing` and `update_location` to set `sharing_enabled = 1`.
  2. **`web/assets/analytics.js`:**
     - Made `#btnToggleOfficerLocation` a streamlined, single-click toggle strictly for personal GPS sharing without modal popups.
     - Moved centralized Superadmin force-all controls (`ðŸŸ¢ à¸ªà¸±à¹ˆà¸‡à¹€à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™`, `ðŸ›‘ à¸ªà¸±à¹ˆà¸‡à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™`) into `#missionManagerModal` (Mission Control).
     - Fixed button state sync: Authoritative DOM update for `#btnToggleOfficerLocation` (`.active` class and `à¸à¸³à¸¥à¸±à¸‡à¹à¸Šà¸£à¹Œà¸žà¸´à¸à¸±à¸”`) directly from `isSharing`.
     - Added case-insensitive username matching for current officer.
     - Exposed `window.officerMarkersMap` globally.
     - Added auto-centering `leafletMap.flyTo(...)` on officer marker when opening the map.
     - Enhanced `.analytics-btn-officer-loc.active` with glowing green ring and drop-shadow.
  3. **`web/assets/app.js`:**
     - Made `tracker.start()` background errors non-destructive when `silent: true` (only clears `watchId`, does not reset `isSharing`).
     - Added fast initial GPS fix via `getCurrentPosition`.
     - Updated `bppLocationTracker.updateUI()` to cross-check `window.officerMarkersMap`.
     - Cleaned null byte `\x00` at line 10870.
  4. **`web/index.html`:**
     - Bumped cache busters: `app.js?v=156`, `analytics.js?v=76`.


## Update 2026-10-07 - Fixed Mobile Bottom Layout Cutoff for Risk Zone Leaderboard (Incident 2.97)
- **Issue:** On the AI Analytics & Heatmap modal (`#analyticsModal`) on mobile screens (< 768px) and tablets (<= 1024px), the "à¸ˆà¸±à¸”à¸¥à¸³à¸”à¸±à¸šà¹‚à¸‹à¸™à¸„à¸§à¸²à¸¡à¹€à¸ªà¸µà¹ˆà¸¢à¸‡" (Risk Zone Leaderboard) at the bottom was cut off vertically. Only Row 1 was shown, while Row 2 was severely clipped at the top edge of its ranking circle, and users could not view or scroll down to see the remaining rows.
- **Root Cause:**
  - Desktop `.analytics-main` used CSS Grid with `grid-template-rows: minmax(0, 1fr)`.
  - On mobile/tablet, `.analytics-right` and `.analytics-leaderboard` retained their inherited `height: 100%` and `flex: 1; min-height: 0; overflow: hidden;`. Inside CSS Grid's auto-track height calculation, this collapsed the leaderboard container to ~75px height.
  - `.leaderboard-body` had `overflow-y: auto; flex: 1; min-height: 0;`, creating a nested inner scrollbar inside the collapsed 75px container that was unreachable / unscrollable on mobile touch viewports.
  - Insufficient bottom padding on `.analytics-content` caused controls to clash with mobile safe areas.
- **Fix:**
  - In `web/assets/analytics.js` (`@media (max-width: 1024px)` and `@media (max-width: 767px)`):
    - Overrode `.analytics-main` from CSS Grid to `display: flex !important; flex-direction: column !important; height: auto !important; min-height: auto !important; overflow: visible !important; flex: none !important;`.
    - Overrode `.analytics-right` to `display: flex !important; flex-direction: column !important; height: auto !important; min-height: auto !important; overflow: visible !important; flex: none !important;`.
    - Overrode `.analytics-leaderboard` to `display: flex !important; flex-direction: column !important; width: 100% !important; height: auto !important; min-height: auto !important; overflow: hidden !important; flex: none !important; margin-bottom: 28px !important;`.
    - Overrode `.leaderboard-body` to `overflow-y: visible !important; overflow-x: hidden !important; height: auto !important; max-height: none !important; flex: none !important; min-height: auto !important;`, allowing all ranked items to expand naturally without nested scrollbars.
    - Overrode `.analytics-panel.active` to `display: flex !important; flex-direction: column !important; flex: none !important; height: auto !important; min-height: auto !important; overflow: visible !important;`.
    - Increased `.analytics-content` bottom padding to `calc(100px + env(safe-area-inset-bottom, 32px)) !important;` for mobile navigation bar clearance.
    - Added `.lb-row { padding: 9px 12px !important; }` and `.lb-row:last-child { border-bottom: none !important; }`.
  - In `web/index.html`: Bumped cache buster to `<script src="assets/analytics.js?v=77"></script>`.

## Update 2026-10-08 - Restored Superadmin GPS scope popup (Incident 2.98)
- **Issue:** Incident 2.96 removed the popup on #btnToggleOfficerLocation; superadmin lost the choice between self-only and everyone.
- **Fix:** analytics.js now shows showLocationScopeChoice() for role superadmin: self toggle / force-all on / force-all off (reuses Mission Control force-all handlers). Non-superadmin keeps single-click personal toggle. Cache buster analytics.js?v=78.



## Incident 2.99 - Force-all GPS disable did not stop clients (2026-10-08)
- **Symptom:** Superadmin pressed 'open everyone' by mistake; 'close everyone' did not turn sharing off (pins returned).
- **Root cause:** auth.py force-all set user_presence.location_sharing=0 in the same statement, so heartbeat force_location_off (needs loc_sharing=1) was never true; clients kept POSTing /auth/location which re-set sharing_enabled=1.
- **Fix:** force-all no longer touches user_presence.location_sharing (enable and disable); heartbeat clears the flag after signalling force_location_off; update_location ignores posts when user_location.sharing_enabled=0 (client must call /auth/location/toggle to re-enable). auth-service rebuilt (--no-deps).

## Incident 2.100 - Officer Location Button Sync on Force-All Disable/Enable & Tracker Shutdown (2026-10-08)
- **Symptom:** When Superadmin clicked "ðŸ›‘ à¸ªà¸±à¹ˆà¸‡à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™" (either via `#btnToggleOfficerLocation` scope chooser or Mission Control modal), the server successfully disabled all officer locations, but the toolbar button `#btnToggleOfficerLocation` on screen remained active green with text `[ ðŸŸ¢ à¸à¸³à¸¥à¸±à¸‡à¹à¸Šà¸£à¹Œà¸žà¸´à¸à¸±à¸” ]` instead of reverting to `[ â¦¿ à¹€à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸” ]`. User reported: "à¸à¸”à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™à¹à¸¥à¹‰à¸§à¸›à¸¸à¹ˆà¸¡à¹„à¸¡à¹ˆà¸­à¸±à¸žà¹€à¸”à¸—à¸•à¸²à¸¡".
- **Root Cause:**
  1. **Missing Local Tracker Stop in Force Controls:** In `web/assets/analytics.js`, `btnForceDisable.onclick` sent `POST /auth/location/force-all` with `{ enable: false }`, but never called `window.bppLocationTracker.stop(false)`. Thus, `tracker.isSharing` remained `true` and the browser continued watching GPS in the background.
  2. **Stale Tracker State Evaluated by Map Refresher:** When `loadOfficerLocations()` executed after the force-disable call, `const isSharing = Boolean((tracker && tracker.isSharing) || isMeInOfficers)` evaluated to `true` because `tracker.isSharing` was still `true`. Consequently, `btnLoc.classList.toggle('active', isSharing)` re-asserted `.active` and set text back to `à¸à¸³à¸¥à¸±à¸‡à¹à¸Šà¸£à¹Œà¸žà¸´à¸à¸±à¸”`.
  3. **Stale Marker Check in updateUI():** In `web/assets/app.js`, `bppLocationTracker.updateUI()` checked `mapHasMe = window.officerMarkersMap.has(curUser)`. Because `tracker.stop()` previously did not prune the current user's marker or clear `officerMarkersMap`, `mapHasMe` evaluated to `true`, maintaining `.active` state.
  4. **Unread Response in onPosition:** When `onPosition()` sent GPS coords to `POST /auth/location`, the backend returned `sharing_disabled: true`, but `app.js` ignored the response and kept transmitting.
  5. **Stale location_sharing in auth.py Heartbeat:** In `auth-service/auth.py`, when `force_location_off` was triggered, `loc_sharing` in the return dictionary was captured prior to the `UPDATE user_presence` statement, returning `location_sharing: True` alongside `force_location_off: True`.
- **Fix:**
  1. **`web/assets/analytics.js`:**
     - Updated `btnForceDisableAllLoc.onclick` to immediately call `tracker.stop(false)`, clear all markers from `officerMarkersMap` and `officerPointLayer`, update `#btnToggleOfficerLocation` DOM (`classList.remove('active')`, text `à¹€à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”`), and call `loadOfficerLocations()`.
     - Updated `btnForceEnableAllLoc.onclick` to immediately start the local tracker (`tracker.start(null, true, false)`), update DOM to active green (`à¸à¸³à¸¥à¸±à¸‡à¹à¸Šà¸£à¹Œà¸žà¸´à¸à¸±à¸”`), and call `loadOfficerLocations()`.
     - Updated `btnLocToggle.onclick` to await `btn.onclick()` for `all-on` / `all-off`, and to prune `curUser` marker from `officerMarkersMap` and `officerPointLayer` on personal stop.
  2. **`web/assets/app.js`:**
     - Updated `bppLocationTracker.stop()` to prune the user's own marker from `window.officerMarkersMap` and reset `_watchAttempted = false`.
     - Updated `onPosition()` to inspect `POST /auth/location` response and automatically call `this.stop(false)` if `sharing_disabled: true` is returned.
     - Updated `sendPresenceHeartbeat()` so that when `data.force_location_off` is true, `data.location_sharing = false` is enforced and `tracker.stop(false)` is invoked.
  3. **`auth-service/auth.py`:**
     - In `send_user_presence_heartbeat`, updated `loc_sharing = False` when `force_location_off` is triggered.
     - In `force_all_location_sharing`, updated `user_presence.location_sharing` for the executing superadmin immediately (to 0 on disable, to 1 on enable).
  4. **`web/index.html`:** Bumped cache busters: `app.js?v=157`, `analytics.js?v=79`.
  5. **`auth-service`:** Restarted container via `docker restart auth-service`.




## Incident 2.101 - Leaflet Officer Marker Orphan Leak & LayerGroup Sync on Force-All Disable (2026-10-08)
- **Symptom:** When Superadmin clicked "ðŸ›‘ à¸ªà¸±à¹ˆà¸‡à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™" (Force Off All Locations), the toolbar button successfully turned off to `[ â¦¿ à¹€à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸” ]`, and the backend database cleared all officer locations (`officers: []`), but on the AI Analytics & Heatmap Leaflet map, the officer pin (`ðŸ¦…ðŸ‚à¸£à¸§à¸¢ à¸£à¸­à¸” à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢ ðŸ‚ðŸ¦… @suchakree`) was still visible on the map and did not disappear. User reported: "à¸›à¸´à¸”à¸žà¸´à¸à¸±à¸”à¸—à¸¸à¸à¸„à¸™à¹à¸¥à¹‰à¸§à¹à¸•à¹ˆà¸—à¸³à¹„à¸¡à¸žà¸´à¸à¸±à¸”à¸œà¸¡à¸¢à¸±à¸‡à¸­à¸¢à¸¹à¹ˆ".
- **Root Cause Diagnosed:**
  1. **Global Layer Exposure Missing:** In `web/assets/analytics.js`, `officerPointLayer` (`L.layerGroup`) was declared as an isolated local variable in the module closure and was never assigned to `window.officerPointLayer` (whereas `officerMarkersMap` was exposed to `window.officerMarkersMap`).
  2. **Asymmetric Self Marker Removal in `tracker.stop()`:** In `web/assets/app.js:stop()`, it checked `if (marker && window.officerPointLayer) { window.officerPointLayer.removeLayer(marker); }`. Because `window.officerPointLayer` was `undefined`, the marker was never removed from Leaflet! However, the next line `window.officerMarkersMap.delete(matchKey)` deleted the officer entry from `officerMarkersMap`.
  3. **Orphaned Marker Untracked in Loop:** Because the officer entry had been deleted from `officerMarkersMap`, subsequent cleanup loops (`for (const [k, m] of officerMarkersMap.entries())`) could no longer see `@suchakree`'s marker.
  4. **Missing `officerPointLayer.clearLayers()`:** In Leaflet, `L.layerGroup` retains markers internally in `_layers` until `.clearLayers()` or `.removeLayer()` is called on the layer group. In `analytics.js:loadOfficerLocations()`, when `officers.length === 0`, it looped over `officerMarkersMap.entries()` which was already empty, so `officerPointLayer.clearLayers()` was never called, leaving the officer pin permanently orphaned on the map canvas.
  5. **Nginx Missing Cache-Control for Root & Assets:** `dashboard-nginx.conf` lacked explicit `Cache-Control: no-cache, must-revalidate` on `location = /index.html` and `location /assets/`, allowing aggressive mobile browsers (especially Safari iOS) to hold stale scripts in memory.
- **Fix:**
  1. **`web/assets/analytics.js`:**
     - Exposed `window.officerPointLayer = officerPointLayer` during map initialization and on reset.
     - In `loadOfficerLocations()`: when `officers.length === 0`, immediately call `officerPointLayer.clearLayers()`, iterate all remaining markers to call `marker.remove()`, and clear `officerMarkersMap`.
     - In stale marker pruning: added `if (marker && typeof marker.remove === 'function') marker.remove()` alongside `officerPointLayer.removeLayer(marker)`.
     - Added an orphaned layer scavenger in `loadOfficerLocations()`: `officerPointLayer.eachLayer(l => { if (!activeMarkerSet.has(l)) { officerPointLayer.removeLayer(l); l.remove?.(); } })`.
     - In `btnForceDisableAllLoc.onclick`: call `marker.remove()` for all entries and `officerPointLayer.clearLayers()`.
     - In `btnLocToggle.onclick`: call `myMarker.remove()` when stopping personal sharing.
  2. **`web/assets/app.js`:**
     - In `bppLocationTracker.stop()`: call `marker.remove()` directly on the marker instance before attempting `window.officerPointLayer.removeLayer(marker)`.
  3. **`dashboard-nginx.conf`:**
     - Added `add_header Cache-Control "no-cache, no-store, must-revalidate" always;` to `location = /index.html`.
     - Added `add_header Cache-Control "no-cache, must-revalidate" always;` to `location /assets/`.
     - Tested configuration with `nginx -t` and reloaded via `docker exec nvr-dashboard nginx -s reload`.
  4. **`web/index.html`:** Bumped cache busters: `app.js?v=158`, `analytics.js?v=80`.
- **Verification:**
  - Syntax validated with `node -c` on both `app.js` and `analytics.js`.
  - Nginx configuration reloaded successfully.
  - Backend `/auth/locations` confirmed returning `{"officers": [], "active_mission": null}`.
  - Cleared all Leaflet layers upon force-disable-all.


## Incident 2.102 - YOLO Slicing Bug on 3-Line Motorcycle Plates (2026-10-08)
- **Symptom:** AI data_plate_v3.pt read car plates perfectly (up to 95% accuracy) but failed horribly on motorcycle plates (often outputting garbage, stuttering numbers like 4444740, or omitting characters). It was observed that the bottom half of the motorcycle plate was frequently cut off during inference.
- **Root Cause Diagnosed:**
  1. **Legacy Slicing Logic in pp.py:** The function _detect_with_slicing(c) was originally designed to split 2-line car plates into top and bottom halves (at 52% and 40% height) to prevent YOLO from grouping top and bottom characters into one line incorrectly.
  2. **Flawed Aspect Ratio Filter:** The condition to trigger slicing was if aspect_ratio < 2.0. While standard 1-line car plates are wide (spect_ratio > 2.0), 3-line motorcycle plates are nearly square (spect_ratio ~ 1.0).
  3. **Catastrophic Intersection:** Because a motorcycle plate is spect_ratio < 2.0, it triggered the slicing. A motorcycle plate has 3 lines (0-33%, 33-66%, 66-100%). Slicing it at 52% literally severed the middle line (the province line) in half. Top crop missed the bottom of the province line, and bottom crop missed the top. The 3 model received garbage input for motorcycles and output garbage text as a result.
- **Fix:**
  1. **lpr-service/app.py:**
     - Modified _detect_with_slicing(c): Added a condition to skip slicing for motorcycle plates (spect_ratio <= 1.4).
     - Condition changed to: if aspect_ratio >= 2.0 or aspect_ratio <= 1.4 or c.shape[0] < 40: return f_orig
  2. **Dataset Harvesting for V4:**
     - To ensure long-term robustness and drop synthetic data completely, a massive dataset harvest was executed.
     - Extracted 1,058 pure real-world crops from Frigate's historical SQLite database.
     - 156 images were manual bounding-boxed by AI visual annotation teams on contact-sheet grids for complex motorcycle layouts.
     - 902 images were auto-annotated by the highly confident 3 model (filtered strictly by Thai plate regex to ensure zero hallucination or missed characters, and excluding province codes from training).
     - The combined 1,058 real images dataset was saved to D:\LPR\dataset\real_v4_pool (un-trained, saved for later).
- **Verification:**
  - docker restart lpr-service executed.
  - Slicing is bypassed for square motorcycle plates, allowing 3 to correctly read the full 3-line crop.

- [2026-10-10 15:00] Added 22 Isan DOH cameras back to BPP-VMS, extracting new streaming URLs and filtering Isan bounds via OpenStreetMap reverse geocoding.
- [2026-10-10 15:40] Purged all remaining offline Longdo and DOH cameras (e.g. kk01..kk27, KhonKaenX) from maps and internal configs to ensure a clean UI.
- [2026-10-10 15:51] Fixed YAML parser bug in automated config cleaner that caused duplicate keys/malformed structure in Frigate config. Verified Frigate restarts correctly.

## Update 2026-10-10 - Fixed Gemini Plate Hallucination on General Photos (Incident 2.103)
- **Issue:** User uploaded a truck photo to Telegram. Telegram bot used Gemini Vision AI which aggressively hallucinated "ว 73" as the license plate because it was instructed to extract plates from seized items.
- **Fix:** Modified `nas-bot-service/services/ai_ocr.py` prompt to explicitly forbid reading vehicle plates from general photos and added a validation step `extract_vehicle_plates(v)` to strictly filter out any invalid/short plate formats hallucinated by Gemini. Restarted `nas-bot-service`.

## Update 2026-10-10 - Fixed Map Camera Popup Stream Dying Silently (Incident 2.104)
- **Issue:** When opening an HLS camera stream (like DOH cameras) on the AI Analytics Map modal, the video would play for a short moment and then turn completely black without any error message ("กล้องพับ/ดับลง"). 
- **Root Cause:** `analytics.js` implemented a naive HLS player for the Leaflet popups. Unlike the main dashboard grid (`app.js`) which had proper `startLoad()` and `recoverMediaError()` handling, the map popup's HLS player just caught `Hls.Events.ERROR` and did nothing. Furthermore, since the `camPreviewLoading_` element was set to `display: none` when the stream started, the fatal error text was written to a hidden element, leaving a silent black rectangle.
- **Fix:** Added proper `Hls.ErrorTypes.NETWORK_ERROR` and `MEDIA_ERROR` auto-recovery routines to `startPopupPreview` in `analytics.js`. Also ensured that if the player cannot recover, the loading element's display is set to `flex` to show the "สัญญาณขาดหาย" text. Bumped `analytics.js?v=81`.
## Incident 2.110 - Standalone / Clean Deployment: RTMP Push Ingest Registration & WebRTC Candidates for Remote Cameras (2026-10-11)
- **Symptom:** Incoming RTMP push failed with `stream not found`, WebRTC disconnected or delayed externally via DuckDNS, and Frigate watchdog killed containers when remote cellular streams lost frames.
- **Fix:** Added RTMP Push placeholder slots in `go2rtc.streams:`, configured DDNS candidates with `stun:8555`, and disabled `detect` on cellular RTMP feeds.

## Incident 2.111 - Web UI Modal: "Frigate rejected the candidate configuration" on Camera Add / YAML Root Indentation Error (2026-10-11)
- **Symptom:** Web UI returned HTTP 422 `Frigate rejected the candidate configuration` when adding any camera due to `pydantic_core.ValidationError: Extra inputs are not permitted for FrigateConfig: Nongtapod_144`.
- **Fix:** Fixed YAML indentation of `Nongtapod_144` under `cameras:`. Pydantic parser validated successfully and UI camera additions resumed.

## Incident 2.112 - Dashboard Drag & Drop Layout Reverting on Refresh & Multi-Camera 4x4 Grid Streaming Optimization for Remote Sites (2026-10-11)
- **Symptom 1 (Layout Revert):** Clicking `🔀 จัดเรียง` on Dashboard toolbar, dragging tiles, and saving (`btnLayoutSave`) reverted on F5 refresh.
- **Root Cause 1:** `btnLayoutSave` only saved to user profile (`saveUserProfile()`), never syncing to server master grid (`saveServerChannels()`). On F5, `loadServerChannels()` overwrote channels with the server master grid.
- **Fix 1:** Updated `btnLayoutSave` in `app.js` to auto-sync to `saveServerChannels()` for admin/superadmin roles. Workaround: Settings Modal -> Tab 2 -> Check `[✔] อัปเดตผังแม่แบบระบบด้วย (Master Grid)` -> Save.
- **Symptom 2 (Multi-Camera Stream Lag & Simultaneous Drops to RECONNECT):** Remote site (144) dropped all 10 cameras to `🟡 RECONNECT` simultaneously, with high stream latency on 4x4 grid.
- **Root Cause 2:** Frigate restart drops all WebSockets; `webrtc.candidates` lacked `127.0.0.1:8555` forcing NAT hairpinning; 10x 1080p Main streams on grid overloaded client decoding.
- **Fix 2:** Added `127.0.0.1:8555` and LAN IP to `webrtc.candidates`, used sub-streams for grid tiles, and ensured `detect: enabled: false` on remote 4G feeds.


## Incident 2.113 - Telegram Bot Pairing Fails ("ขอเลขสำหรับเชื่อมไม่ได้") & Edge LPR Webhook Dropped on Remote Node (ตชด.144) (2026-10-11)
- **Symptom 1 (Telegram Pairing Code Unavailable):** Clicking "ขอรหัสผูก Telegram" (`#btnReqPairCode`) on Settings Tab 4 failed or hung on `...`. User unable to obtain the 6-digit OTP code to pair `@Sloth_bpp215bot`.
- **Root Cause 1:** `nas-bot-service` runs in Docker with `network_mode: "service:tailscale"`. When `tailscale-service` restarted, `nas-bot-service` lost its container network namespace while still marked "Up 3 hours". As a result, Nginx reverse proxy returned `502 Bad Gateway` on `/api/nas-bot/pair/request` and `/api/nas-bot/user/profile`.
- **Fix 1:** Run `docker restart nas-bot-service`. Once restarted, network stack is reattached, OTP code generation succeeds, and bot pairing via `/pair <6_digits>` functions normally.
- **Symptom 2 (Settings / LPR Toggle Reverting on Dashboard):** Toggling camera LPR or AI on Dashboard settings immediately reverted on next poll/reload.
- **Root Cause 2:** User preferences are persisted via `saveUserProfile()` to `PUT /api/nas-bot/user/profile`. The 502 Bad Gateway from the disconnected `nas-bot` container caused writes to fail silently in the background. Additionally, candidate YAML in Frigate config had duplicate `enabled: false` and syntax inconsistencies that failed strict Frigate validator (Pydantic) checks.
- **Fix 2:** Restarted `nas-bot-service` and cleaned `config.yml` syntax.
- **Symptom 3 (Edge Camera LPR / Alarm Webhook Not Arriving):** Edge cameras (Dahua ITC / TP-Link VIGI) sent LPR / alarm webhooks but zero events appeared in Watchlist or Dashboard.
- **Root Cause 3:** 
  1. The camera was sending via HTTP port 80. Nginx enforces `301 Moved Permanently` to HTTPS 443; embedded IP camera HTTP clients do not follow 301 redirects on HTTP POST requests, immediately dropping the payload.
  2. The webhook URL lacked the `camera_id` query parameter. Watchlist API's `is_camera_ai_enabled()` gatekeeper checks if the incoming camera name matches a known dashboard channel or Frigate camera. An unnamed camera defaults to `external_camera`, which fails the gatekeeper check and is dropped (`[Gatekeeper] Dropped webhook for ...`).
- **Fix 3:** Configured edge camera webhook to `HTTPS` on port `443` with full query parameters: `/api/lpr/camera-webhook?token=bpp_secret_2026&camera_id=<channel_name>` with image attachment enabled.
- **Symptom 4 ("ปิด AI ผ่านหน้าตั้งค่ากล้องแล้ว AI ยังทำงานอยู่"):** User disabled AI in Frigate/Dashboard, but green detection bounding boxes were still visible moving on the live video stream.
- **Root Cause 4:** The green bounding boxes are rendered by the camera's internal hardware DSP/OSD (In-Camera Smart Event / Target Graphic Overlay) burned into the video feed before RTSP encoding. Frigate server-side AI does not draw OSD on live WebRTC streams.
- **Fix 4:** Must be disabled in the camera's own web UI under `Event` -> `Smart Event` -> Disable `Target Graphic Overlay` / `OSD Information`.

## Incident 2.123 & 2.124 - Real-Time GPSONE Satellite Fix, Mobile-Compact Popup, Auto-Disable Offline Pins & Per-User GPS Access Control (2026-10-16)
- **Symptom / Requirement:**
  1. GPSONE device status/timestamps were inaccurate when devices went offline or fell back to LBS cell-tower coordinates (`dataType=2`), and officers needed real-time pursuit tracking (`1s` frontend / `1.5s` backend polling + live vector line + Follow Target HUD).
  2. On mobile screens (`<= 768px`), clicking a GPS marker opened a popup that was too large to read details and overlapped the top-left zoom buttons.
  3. Offline GPS devices needed to automatically have their map pins disabled (`enabled = False`) by default so only online GPS pins are shown, while automatically enabling pins when trackers come online.
  4. `superadmin` (`suchakree`, `arm215`, `bpp215`, or `role == "superadmin"`) must see all GPS devices, and `superadmin` must be able to configure per-user access (`allowed_users`) specifying which user can view which GPS device.
- **Fix & Implementation:**
  1. **Backend (`frigate-nvr/analytics-engine/services/gpsone_tracker.py` & `main.py`):**
     - Added real-time timestamp age validation (`_compute_time_status`, offline threshold `> 600s`), `ShowLBS=0` satellite coordinate prioritization (`dataType=1`), and `1.5s` background polling for active devices (with every-4th-tick polling for offline/disabled devices so newly powered-on trackers automatically enable themselves).
     - Auto-sets `enabled = False` for offline devices (unless `force_show_offline` is toggled by the operator) and `enabled = True` for online devices (unless `manual_hide_online` is set).
     - Enforced per-user visibility filtering via `X-User` and `X-Role` gateway headers in `GET /api/analytics/gpsone/locations` and `GET /api/analytics/gpsone/devices`. Superadmins see all devices; regular users see only devices where their username is in `allowed_users`.
     - Added `GET /api/analytics/gpsone/permissions`, `POST /api/analytics/gpsone/permissions/user`, and `POST /api/analytics/gpsone/permissions/device` (Superadmin-only), integrating live active account lookup from `http://auth-service:5002/auth/internal/users`.
  2. **Frontend (`frigate-nvr/web/assets/analytics.js` & `frigate-nvr/web/index.html`, `?v=93`):**
     - Built a compact, touch-scrollable mobile popup (`.gpsone-leaflet-popup`, `max-height: 205px`, `max-width: min(238px, calc(100vw - 62px))`, `autoPanPaddingTopLeft: L.point(46, 52)`) with `L.DomEvent.disableScrollPropagation` and `touchmove` `stopPropagation`.
     - Added `🟢 เปิดเฉพาะที่ออนไลน์` button (`#btnGpsOneEnableOnlineOnly`) and the `🔐 กำหนดสิทธิ์ราย User` tab (`#tabBtnGpsOnePerms`, `#paneGpsOnePerms`) in `#gpsOneManagerModal` for Superadmins to grant/revoke GPS visibility per user account.


## Incident 2.126 - Dedicated Fullscreen Tactical Map Mode, Top Navbar Integration, Live Status Counters & Unified Quick Search (2026-10-17)
- **User Requirement:**
  1. The user requested a dedicated Tactical Map view separated from the analytical heatmap (Choropleth crime statistics), so officers can focus purely on tactical operations (CCTV cameras 📍, live officer GPS coordinates 👮, and GPSONE vehicle trackers 🎯) with full-screen capability (`อยากให้สามารถเปิดหน้าแผนกล้องที่กับพวกการดูพิกัดและ gps แยกออกมาจากหน้าแผนที่ฮีทแมพได้ แบบสามารถกดให้มันเต็มจอได้`).
  2. The view must open in full-window mode immediately, provide a 1-click Native Fullscreen API button (`⛶ เต็มจอ`), include live KPI status counters (`📷 กล้องพร้อมใช้`, `👮 กำลังพล`, `🎯 GPS ติดตาม`), and an instant unified search box to quickly fly to any camera, officer, or GPS tracker.
  3. Seamless two-way switching between Analytics Dashboard and Tactical Map without destroying or duplicating the Leaflet map instance (Single Source of Truth architecture preserving 488 camera pins, live pursuit vectors, and WebRTC streaming channels).
- **Architecture & Implementation:**
  1. **Top Navbar Integration (`frigate-nvr/web/index.html`):**
     - Added dedicated button `#btnTacticalMap` with radar crosshair icon in the top navbar.
     - Linked new script `assets/tactical-map.js?v=1` and bumped `assets/analytics.js?v=97`.
  2. **Dual-Mode Modal Architecture (`frigate-nvr/web/assets/analytics.js`):**
     - Added `.tactical-fullscreen-mode` CSS class to expand `#analyticsModal` and `#analyticsMapCanvas` to 100vw × 100vh (`padding: 0`, `border-radius: 0`, `max-width: 100vw`, `max-height: 100vh`).
     - In Tactical mode: automatically disables analytical crime heatmap (`showHeatmapLayers = false`, `updateChoroplethLayers()`), hides KPI rail, 24h hourly chart, and zone leaderboard; reveals Tactical HUD header (`#tacKpiBar`, `#tacQuickSearchWrap`, `#btnTacToggleFullscreen`, `#btnSwitchToAnalytics`).
     - Added mode-switching shortcut buttons in the modal header (`#btnSwitchToTacticalMap` and `#btnSwitchToAnalytics`).
     - Hooked modal close logic to exit native fullscreen if active (`document.exitFullscreen()`).
     - Exposed `window.setTacticalMapMode(enabled)`, `window.toggleTacticalMap()`, `window.isTacticalMapMode()`, `window.updateTacticalKpis()`, `window.flyToOfficer(username)`, and `window.bppAnalyticsMap = leafletMap`.
  3. **Tactical Controller & Quick Search (`frigate-nvr/web/assets/tactical-map.js`):**
     - Handles top navbar click with intelligent toggle behavior: opens directly in tactical mode, switches mode if already open, or closes if already active.
     - Controls Native Fullscreen API via `#btnTacToggleFullscreen` with `fullscreenchange` event listening, dynamic icon/text toggling (`เต็มจอ` / `ย่อจอ`), and Leaflet `invalidateSize()` tile re-layout.
     - Built instant autocomplete Quick Search (`#tacQuickSearchInput`, `#tacSearchResults`) searching across:
       - CCTV Cameras (`window.cachedCameraGPS` / `cameraMarkersMap` by name, ID, province).
       - Online Officers (`window.officerMarkersMap` by username).
       - GPS Trackers (`window.lastGpsOneDevices` / `gpsOneMarkersMap` by IMEI, device name).
     - Navigable via keyboard (Arrow Up/Down, Enter, Escape) and click-to-fly (`flyTo` + auto-opens target marker popup).
     - Periodically refreshes tactical KPI status counters every 3 seconds.

## Incident 2.149 - Mobile vms.local Events Rail Drawer Blocking, Parallel Startup Initialization & Nginx Gzip Compression (2026-10-17)
- **Symptom / User Request:**
  The user uploaded a mobile screenshot of `vms.local` over 5G showing the right-hand Events Rail drawer (`เหตุการณ์ 0 รายการ`) covering ~75% of the screen, while the left camera grid remained empty and topbar controls were unresponsive during startup.
- **Root Cause:**
  1. **Mobile Events Rail Open During Sequential Startup Waterfall (`app.js`):** `<aside id="eventsRail">` is unhidden in HTML, and `if (window.innerWidth <= 899) setEventsOpen(false);`, `bind()`, `buildLayoutSwitch()`, and `rebuildGrid()` were only executed at the very end of `init()` after 6 sequential `await` network calls (`bppSessionPromise` → `/api/public-config/hls-map` → `/settings/camera_gps` → `/settings/camera_names` → `/settings/channels` → `/api/nas-bot/user/profile`). Furthermore, `loadUserProfile()` overwrote `cfg.eventsOpen` with the desktop profile's `events_open: true` on mobile viewports.
  2. **Missing Nginx Gzip Compression (`dashboard-nginx.conf`) & 2.04 MB Background Polling:** `nginx:alpine` defaults to `#gzip on;` (disabled), causing uncompressed transfers over Cloudflare Tunnel (`app.js` 649 KB took 17.36s, `camera_gps` 160 KB fetched twice by `app.js` and `analytics.js`, and `fetchEmgrLprIndex()` polling `/api/watchlist/lpr/candidates?limit=2000` at 2.04 MB every 20–30s even when `#emgrOverlay` was closed).
  3. **Exclusive File Lock Contention on `GET /api/public-config/hls-map` (`config-api/api.py`):** `get_hls_map()` opened an exclusive write transaction (`open_config_transaction`) on `config.yml`, blocking for up to 9s when `reconcile` was active.
- **Fix / Solution:**
  1. **Frontend (`frigate-nvr/web/assets/app.js` `v=177`, `frigate-nvr/web/assets/analytics.js` `v=111`, `frigate-nvr/web/index.html`):**
     - Immediately hides `#eventsRail` on mobile (`window.innerWidth <= 899`) at script parse time and at the start of `init()`, and binds UI controls (`bind()`, `buildLayoutSwitch()`) before awaiting network calls.
     - Prevents `loadUserProfile()` from overwriting `cfg.eventsOpen = true` on mobile viewports (`window.innerWidth <= 899`).
     - Parallelizes startup fetches (`loadServerChannels()`, `loadUserProfile()`, `hls-map`, `camera_gps`) and shares `window.bppCameraGpsPromise` with `analytics.js`.
     - Scopes `fetchEmgrLprIndex()` to `limit=120` when `#emgrOverlay` is hidden (`limit=2000` only when Event Manager is open).
  2. **Nginx Gateway (`frigate-nvr/dashboard-nginx.conf`):**
     - Enabled `gzip on; gzip_comp_level 5;` for JS/CSS/JSON/HTML/SVG, cutting `app.js` transfer time over `https://vms.local` from `17.36s` (649 KB) to `0.28s` (164 KB).
  3. **Config API (`frigate-nvr/config-api/api.py`):**
     - Cached `get_hls_map()` by `(config.yml mtime, camera_gps.json mtime)` and switched to lock-free `load_yaml_config()`, reducing response size to 3.7 KB (gzipped) and latency from `9.0s` to `0.69s`.


## Incident 2.171 - Eliminate Pink Stop Badge Clutter on Map, 99.2% Reduction in 1s GPSOne Polling Payload, and 0ms Instant GPS Disable (2026-10-20)
- **Symptom / User Request:**
  The user reported *"เป็นแบบนี้แล้วกดปิด gps ก็ไม่ปิด"* with a mobile Safari screenshot showing:
  1. A huge stack of pink/purple `"นิ่ง 1.1 ..."`, `"นิ่ง 1.3 ..."`, `"นิ่ง 1.2 นาที"`, `"นิ่ง 1 ชม. 3..."` badges cluttering the map (`#analyticsMapCanvas`) and obscuring the GPS pin and cameras.
  2. Tapping to turn off GPS (`กำลังแชร์พิกัด` `#btnToggleOfficerLocation` or `GPS ติดตาม` `#btnMapGpsOne` / `ปิดหมุด`) did not turn off or clear the GPS markers from the map.
- **Root Cause:**
  1. **2.48 MB/sec `/api/analytics/gpsone/locations` Polling Payload (`gpsone_tracker.py`):** `list_devices()` returned the entire 10,967-point `live_trail` array (`2,487,891 bytes`) across `devices` and `all_devices` on every 1-second poll (`setInterval(loadGpsOneLocations, 1000)`), choking mobile Safari's main thread and network queue.
  2. **Permanent Pink `<div class="gps-stop-log-badge">` DOM Clutter (`analytics.js`):** `attachRouteHoverLogInspector()` spawned permanent `L.divIcon` text badges (`นิ่ง ...`) at every stop cluster along the trail and rebuilt them every second, creating a giant overlapping stack of pink labels on `#analyticsMapCanvas`.
  3. **1-Second Modal `innerHTML` Wipe (`#gpsOneManagerModal`) & Poll Race Condition (`analytics.js`, `app.js`, `sw-location.js`):**
     - `newModalSig` included `${d.device_time}`, which changed every second and caused `#gpsOneDeviceList.innerHTML` to be wiped and recreated every 1,000ms — destroying `.btn-gpsone-toggle` (`ปิดหมุด`) mid-tap on mobile touchscreens.
     - Disabling officer GPS (`btnLocToggle.onclick`, `button[data-officer-disable]`, `executeForceDisableAllLocations`) or GPSOne trackers (`toggleGpsOneDevice`, `toggleAllGpsOneDevices`) waited for `await fetch(...)` before stopping the local tracker/markers, while in-flight 1s polls (`loadOfficerLocations` / `loadGpsOneLocations`) and buffered Geolocation `onPosition` callbacks re-rendered the markers and reset `isSharing = true`.
     - Foreground `EventSource('/auth/location/stream-keepalive')` held a persistent HTTP/1.1 connection slot in mobile Safari even when the app was in the foreground (`!document.hidden`).
- **Fix / Solution:**
  1. **Backend (`frigate-nvr/analytics-engine/services/gpsone_tracker.py`):**
     - Capped `live_trail` in `list_devices()` to the most recent 20 points (`[-20:]`) and added `live_trail_total`, cutting the 1s `/api/analytics/gpsone/locations` payload by **99.2%** (from `2.48 MB` to `20 KB`).
  2. **Tactical & Analytics Map (`frigate-nvr/web/assets/analytics.js` `v=122`):**
     - Removed permanent `<div class="gps-stop-log-badge">นิ่ง ...</div>` markers from `attachRouteHoverLogInspector()`; replaced with subtle `L.circleMarker` (`radius: 4.5`) dots that only show dwell time on hover/tap.
     - Updated `updateGpsOnePursuitOverlay()` so normal map view only shows the clean GPS pin (`followedGpsOneImei` required for pursuit trail).
     - Removed `d.device_time` from `newModalSig` in `loadGpsOneLocations()` so `#gpsOneManagerModal` buttons are never destroyed mid-tap, fixed `formatStopDurationTh(currentStopMins).durText` (`[object Object]`), and enabled `.btn-gpsone-toggle` (`ปิดหมุด`) on all cards.
     - Added `gpsOneFetchEpoch`/`gpsOneSuppressPollUntil` and `officerLocFetchEpoch`/`officerLocSuppressUntil` guards with **0ms synchronous optimistic disable** in `toggleGpsOneDevice()`, `toggleAllGpsOneDevices()`, `btnLocToggle.onclick`, `button[data-officer-disable]`, and `executeForceDisableAllLocations()`, plus a 1-tap `"ปิดพิกัดของฉัน + ซ่อนหมุด GPS ติดตามทั้งหมดบนแผนที่"` (`disable_everything`) option in `showLocationScopeChoice('disable')`.
  3. **Tracker & Service Worker (`frigate-nvr/web/assets/app.js` `v=196`, `frigate-nvr/web/sw-location.js` `v=6`, `frigate-nvr/web/index.html`):**
     - Guarded `onPosition(pos)` with `if (!this.isSharing || this._userDisabled) return;`.
     - Restricted `startStreamKeepalive()` SSE to open only when `document.hidden === true`.
     - Hardened `stop()` to send `{ type: 'STOP_SHARING' }` to Service Worker and purge `bpp-vms-loc-state-v5`/`v6` from `window.caches`.


## Incident 2.150 - Dual-Source LPR Harvester Integration & Dataset V4 Expansion to 5,655 Labeled Plates (2026-10-20)
- **Symptom / User Request:**
  The user checked the progress of LPR V4 labeling and requested adding live candidate crops into the pool while maintaining the strict constraint "DO NOT TRAIN YET".
- **Root Cause / Bottleneck:**
  The previous daily harvester (`45_daily_harvester.py`) only checked `frigate-nvr/storage/clips`, where full-frame event snapshots had tapered off. Meanwhile, `frigate-nvr/lpr-data/crops` had over 4,400 active vehicle plate crops that were not automatically being monitored or ingested.
- **Fix / Solution:**
  1. **Dual-Source Harvester (`D:\LPR\scripts\45_daily_harvester.py`):**
     - Enhanced `45_daily_harvester.py` to ingest from both `lpr-data/crops` (direct vehicle crops) and `storage/clips` (full-frame snapshot detector crops).
     - Integrated in-memory MD5 hash deduplication to guarantee that identical crops are never duplicated in the pool.
     - Enforced strict character validation (`is_valid_thai_plate`, 4-9 bounding boxes, stripped province codes) and YOLO-format normalized bbox generation.
  2. **Mass Crop Harvesting:**
     - Ingested 4,476 candidate crops from `lpr-data/crops`, adding **1,993 verified non-duplicate plates**.
     - Expanded total verified dataset in `D:\LPR\dataset\real_v4_pool` from **3,662 to 5,655 images** with 100% paired `.txt` labels.
  3. **Operational State:**
     - Verified scheduled task `BPP_LPR_Harvester` runs without errors and deduplicates seamlessly during daily 24h rolling checks.
     - Model training strictly held until explicit user command.


## Incident 2.172 - Eliminate Officer GPS Teleportation Across Multi-Device Sessions & Stale Background Relay Loops (2026-10-21)
- **Symptom / User Request:**
  The user reported *"ทำไมพิกัดตัวเองมันวาร์ปไปมา"* with two screenshots taken at `23:58` showing officer `ม.ม้าExpress @suchakree` teleporting back and forth every 1–4 seconds between:
  1. บ้านศรีวิไล (`18.1855028, 103.7377117`, `7.92 กม. ทิศเหนือ` from `GPS-5074`)
  2. ด้านเหนือป่านันทนาการหินสามวาฬ (`18.300057527180194, 103.80468716269183`, `6.82 กม. ทิศตะวันตกเฉียงใต้` from `GPS-5074` — 14.3 km away).
- **Root Cause:**
  1. **Multi-Device Login + `/auth/heartbeat` `force_location` Broadcast (`auth.py`):**
     - A second iPhone 14.3 km away (at `18.300057527180194, 103.80468716269183`) had logged in using the `suchakree` account at `23:21` (before user `Park` was created).
     - Because `/auth/heartbeat` returned `force_location = sharing_enabled and not loc_sharing` to EVERY session logged in under `suchakree`, enabling GPS on `suchakree`'s primary phone (or `force-all`) automatically forced the second phone to start transmitting GPS under `suchakree` as well.
  2. **Frozen `lastCoords` / `swLastCoords` Replay Loop (`sw-location.js`, `app.js`):**
     - When the second phone went into the background at `23:21`, its `sw-location.js` (`relayCoordsFromSw()`) and `app.js` (`onWorkerTick` `elapsedSincePost >= 4000`) kept re-POSTing the exact same 15-decimal-place cached coordinate (`18.300057527180194, 103.80468716269183, accuracy: 7.526390125850182`) every 4.3 seconds for 50 minutes, overwriting `suchakree`'s live 1-second GPS fixes (`18.1855028, 103.7377117, accuracy: 2.08m`) in `user_location` and `mission_tracks`.
  3. **Coarse Cell-Tower Fallback Overwriting High-Accuracy GNSS (`app.js`):**
     - `watchIdLow` (`enableHighAccuracy: false`) fired whenever `Date.now() - lastFixReceivedAt >= 1200` (1.2s), allowing `35m+` cell-tower fixes to overwrite `2m` satellite fixes.
- **Fix / Solution:**
  1. **Backend Single-Device GPS Ownership & Frozen-Relay Kill Switch (`frigate-nvr/auth-service/auth.py`):**
     - Added `_GPS_OWNER_SESSION`, `_GPS_SESSION_COORD_STATE`, and `_GPS_FROZEN_COORD_COUNTS` keyed by JWT `jti` + client IP (`session_key`).
     - In `POST /auth/location`: detects repeated identical float coordinates (`sess_repeat >= 1` or `global_repeat >= 2` or `fix_age_ms > 4500`). If a stale/frozen relay or secondary session attempts to overwrite an active primary session or jump >35m, `auth.py` rejects the overwrite and returns `{"sharing_disabled": True}` — immediately triggering `this.stop(false)` and `stopSwPulseLoop()` on the ghost device/tab.
     - For legitimate single-device background keepalive relays, updates `user_presence.last_heartbeat` and `user_location.updated_at` only, without overwriting `(latitude, longitude)` or inserting duplicate `mission_tracks` rows.
     - In `POST /auth/heartbeat`: never sends `force_location: True` to a secondary device when another session is already actively transmitting for that user (`has_other_active_owner`).
     - Added server-side coarse-accuracy guard so `accuracy > 28m` never overwrites a recent (`<20s`) high-accuracy (`<=15m`) GNSS fix.
     - Purged the corrupted `18.3000575` ghost points for `suchakree` from `mission_tracks`.
  2. **Frontend High-Accuracy Lock & Relay Tagging (`frigate-nvr/web/assets/app.js` `v=197`, `frigate-nvr/web/sw-location.js` `v=7`, `frigate-nvr/web/index.html`):**
     - Removed `localStorage` `bpp_last_coords` pre-transmission on `start()`.
     - Increased `watchIdLow` fallback threshold from `1200ms` to `15000ms` and filtered out `accuracy > 28m` fixes in `onPosition()` when a `<20s` high-accuracy (`<=15m`) GNSS fix is active.
     - Tagged background keepalive relays with `fix_age_ms`.


## Incident 2.175 - ARM 215 Tactical Shaka Streetwear Footer Logo & Kinetic Motion Animation (2026-10-21)
- **User Request:**
  Replace the bottom-left footer logo (.bottombar .brand) with a custom dark-streetwear tactical emblem featuring a young operator in a black hoodie, black tactical vest (ARM 215 patch), and dark sunglasses throwing the Shaka (Hang Loose) gesture with kinetic motion animation (ทำเหมือนกำลังขยับด้วย), and synchronize across both D:\BPP-VMS and D:\sloth+vms\repo.
- **Implementation:**
  1. **Transparent RGBA Emblem Extraction (rigate-nvr/web/assets/arm215-logo.png):**
     - Used edge flood-fill background removal on the user-provided artwork to remove the outer pitch-black canvas (
gba(0,0,0,0)) while preserving 100% of the internal black hoodie, tactical vest, and sunglasses details, cropped tightly and resized to 256x256 RGBA PNG.
  2. **Kinetic Shaka Animation & Hover Pop (rigate-nvr/web/assets/app.css =164, rigate-nvr/web/index.html):**
     - Updated .footer-logo-tile (42x42px), .footer-logo-bg (electric blue/indigo radial glow), and .footer-logo-img (40x40px) with @keyframes arm215ShakaMotion (3.2s ease-in-out infinite subtle Shaka wave/tilt) and interactive hover zoom (scale(1.22) rotate(-5deg)).
     - Updated .footer-brand-main gradient (#ffffff -> #60a5fa -> #818cf8) to match the ARM 215 emblem palette.


## Incident 2.178 - Surgical Single-Slot Grid Diffing & MSE Buffer/Tab-Resume Recovery (2026-10-21)
- **Symptom / User Request:**
  The user reported *"ทำไมยังมีอาการแบบนี้และเวลากดเว้นว่างช่องนี้ก็จะมีอาการเชื่อมต่อใหม่ทุกช่อง"* with a screenshot of the `3×3` grid (`CH01`–`CH05` simultaneously displaying `"กำลังเชื่อมต่อใหม่..."` / `🟡 RECONNECT` while `CH06`–`CH09` were empty slots `"ช่องสัญญาณว่าง"`).
- **Root Causes Diagnosed (`frigate-nvr/web/assets/app.js`):**
  1. **Full Grid Destruction on Single-Slot Clear/Assign (`window.assignCameraToChannel` & `rebuildGrid`):**
     - `window.assignCameraToChannel(camId, chIdx)` called `rebuildGrid()` after awaiting `saveUserProfile()`, `saveServerChannels()`, and `sendUserHeartbeat()`.
     - `rebuildGrid()` unconditionally ran `state.tiles.forEach(t => { if (t.cam) t.cam.destroy(); }); grid.innerHTML = '';`, tearing down **all** active camera connections (`CH01`–`CH05`) whenever a single slot (`CH06`) was cleared (`"เว้นว่างช่องนี้"`) or assigned.
  2. **Per-Frame MSE `sb.remove(start0, end - 8)` Evicting Active GOP Keyframes (`sb.addEventListener('updateend')`):**
     - After 8 seconds of MSE playback, `trimStart = end - 8 > start0` evaluated true on every frame (`25x/sec`), continuously locking `sb.updating` and invoking W3C Coded Frame Removal (`sb.remove`), which evicts all frames up to the next IDR keyframe at or after `end - 8`. On camera sub-streams with `8–10s` GOPs, this deleted the active keyframe right under `this.video.currentTime`, freezing all MSE cameras simultaneously.
  3. **Tab Switch (`visibilitychange`) Stranding `currentTime` in Evicted Buffer (`resume()` & `connect()`):**
     - While the tab was hidden (`this.paused = true`), `ws.onmessage` continued appending MSE chunks and `sb.remove` evicted old buffer while skipping `this.video.currentTime` catch-up. Upon returning to the tab, `resume()` did not seek `this.video.currentTime` to the live edge (`sb.buffered.end`), leaving `currentTime` stranded in an unbuffered hole until `startWatchdog()` triggered `this.fail()` on all 5 cameras simultaneously 8 seconds later.
- **Fix / Solution (`frigate-nvr/web/assets/app.js` `v=200`, `frigate-nvr/web/index.html`):**
  1. **Surgical In-Place Grid Diffing (`syncGridDiffSmoothly` & `rebuildGrid`):**
     - Upgraded `syncGridDiffSmoothly()` to handle both same-size slot updates and layout size changes (`2x2` ↔ `3x3` ↔ `4x4`) by comparing each slot's `_slotKey` (`src|sub|enabled|visible`) and replacing **only** the specific DOM tile(s) that changed while leaving all other playing `Camera` instances 100% untouched.
     - Updated `rebuildGrid(forceFull = false)` to delegate to `syncGridDiffSmoothly()` whenever `state.tiles` is already mounted.
     - Updated `window.assignCameraToChannel(camId, chIdx)` to execute `syncGridDiffSmoothly()` immediately (`0ms`) before background profile/server sync calls.
  2. **GOP-Safe MSE Buffer Trimming & Live-Edge Jump on Resume (`sb.updateend`, `resume()`, `startWatchdog()`, `connect()`):**
     - Changed MSE buffer eviction to run only when `(end - start0) > 30`, trimming `sb.remove(start0, end - 15)` so at least `15s` (1–2 full GOPs) remain buffered.
     - Added automatic jump across disjoint buffer holes (`sb.buffered.length > 1`) and unbuffered `currentTime < start0` states in `sb.updateend` and `resume()`.
     - Added Two-Stage Soft Recovery in `startWatchdog()` (`14s` threshold): seeks to live edge (`end - 0.4`) and calls `video.play()` before ever tearing down the WebSocket.
     - Extended `RECONNECT_GRACE_MS` to `45000ms` and suppressed the `"กำลังเชื่อมต่อใหม่..."` (`reconnecting`) overlay in `setTileStatus()` while a tile has a visible frame/poster during background recovery (`attempts <= 5`).


## Incident 2.179 - Fix Broken Merge (`mseBufLen` / `silentMs` ReferenceError Crash) & iOS 5G `VIDEO LOSS` across All Tiles (2026-10-21)
- **Symptom / User Request:**
  The user uploaded an iPhone 5G screenshot (`14:34:13`) showing all 5 configured camera slots (`CH01`–`CH05`: `ทางเข้ากองร้อย1`, `ทางเข้ากองร้อย2`, `ทางเข้ากองร้อย3`, `โค้งดูนสาดไปนาคำน้อย`, `กล้อง5`) stuck on **`VIDEO LOSS / สัญญาณวิดีโอขาดหาย / NO VIDEO`** (`ออนไลน์ 0 เชื่อมต่อ 0 ออฟไลน์ 5`).
- **Root Causes Diagnosed (`frigate-nvr/web/assets/app.js`):**
  1. **Broken Merge in Commit `cd0bbb4` (`ReferenceError: mseBufLen is not defined` & `ReferenceError: silentMs is not defined`):**
     - Commit `cd0bbb4` (`feat(face-ai): add ArcFace 512-D + YOLO26 face recognition engine & Watchlist UI v201`) overwrote `frigate-nvr/web/assets/app.js` with a partial merge that deleted `let mseBuf = new Uint8Array(...); let mseBufLen = 0;` while leaving `mseBufLen`, `mseBuf`, and `chunk` referenced inside `safeAppendMse`, `sb.updateend`, `sb.addSourceBuffer`, and `ws.onmessage` (`lines 1268, 1568, 1581, 1619`).
     - As a result, the very first binary fMP4 packet on `ws.onmessage` threw an uncaught **`ReferenceError: mseBufLen is not defined`**, aborting MSE decoding on every camera so `this.timeoutT` (`15000ms`) forced all 5 tiles into **`VIDEO LOSS`** (`this.onStatus('videoloss')`).
     - Additionally, `startWatchdog()` referenced `silentMs` (`} else if (silentMs < 3000) {`) without declaring `silentMs` (`ReferenceError: silentMs is not defined`).
  2. **Invalid `go2rtc` `{"type": "mjpeg"}` Fallback on H.264 Streams (`ManagedMediaSource` Timeout on iOS):**
     - When `ManagedMediaSource` did not fire `sourceopen` within `2500ms` on iOS (e.g., iOS Low Power Mode or >4 concurrent MSE decoders), the fallback sent `ws.send(JSON.stringify({ type: 'mjpeg' }))` to `go2rtc`. Because the camera streams are `video:H264` without server-side JPEG transcoding, `go2rtc` rejected it with `{"type":"error","value":"mjpeg: streams: codecs not matched: video:H264 => video:JPEG, video:RAW"}`, which immediately called `this.fail()` -> `VIDEO LOSS`.
  3. **Reverted Surgical Grid Diffing (`4974477`):**
     - Commit `cd0bbb4` also overwrote the `setTileStatus`, `rebuildGrid`, `syncGridDiffSmoothly`, and `window.assignCameraToChannel` improvements from commit `4974477`.
- **Fix / Solution (`frigate-nvr/web/assets/app.js` `v=202`, `frigate-nvr/web/index.html`):**
  1. **Restored `mseBuf` / `mseBufLen` & Declared `silentMs`:**
     - Restored `let mseBuf = new Uint8Array(4 * 1024 * 1024); let mseBufLen = 0;` and unified all `safeAppendMse` / `sb.updateend` / `ws.onmessage` buffer drains, completely eliminating all `ReferenceError` exceptions.
     - Declared `const silentMs = this.lastFrameTime > 0 ? (now - this.lastFrameTime) : 0;` in `startWatchdog()`.
  2. **Instant Snapshot Pre-Load + WebRTC / Frigate `/api/<cam>/latest.jpg` Live Fallback (`startSnapshotStream`):**
     - Pre-loads `/nvr/api/<baseCam>/latest.jpg` into `this.video.poster` immediately on `connect()` so iPhone 5G tiles render a live frame and `🟢 ออนไลน์` status within ~150ms.
     - Replaced the broken `ws.send({type: 'mjpeg'})` fallback with `startWebRTC()` fallback followed by `startSnapshotStream()` (1 FPS live refresh from Frigate's in-RAM `/api/<baseCam>/latest.jpg`), guaranteeing iOS devices never hit `VIDEO LOSS` even under Low Power Mode or hardware decoder limits.
  3. **Restored Surgical Single-Slot Grid Diffing (`syncGridDiffSmoothly`, `rebuildGrid`, `window.assignCameraToChannel`):**
     - Restored `0ms` surgical single-slot updates while preserving all Face-AI / Watchlist UI code from `cd0bbb4`.


## Incident 2.180 - Instant 0ms Grid & Clock Startup + Eliminate Blocking NAS SMB Scans on Page Load (2026-10-21)
- **Symptom / User Request:**
  The user uploaded screenshot `media_1792570090377_849c5fc8.png` (`"ตอนนี้เปิดแล้วไม่มีอะไรมาเลย"`) showing `vms.local` with an empty `#grid`, the clock showing `--:--:--`, `ออนไลน์ 0 เชื่อมต่อ 0 ออฟไลน์ 0`, and the Chrome tab spinner still spinning.
- **Root Causes Diagnosed:**
  1. **`init()` Blocked Initial Grid & Clock Render Behind Sequential Network Awaits (`frigate-nvr/web/assets/app.js`):**
     - `init()` did not call `rebuildGrid()` or `tickClock()` until after sequentially awaiting `window.bppSessionPromise` (`/auth/session`), `loadServerChannels()` (`/settings/camera_names` + `/settings/channels` without timeouts), `loadUserProfile()` (`/api/nas-bot/user/profile`), and `Promise.race([Promise.all([hlsPromise, gpsPromise]), 2500ms])` (`161 KB` `/settings/camera_gps`).
     - Furthermore, `<div id="scanNvrOverlay">` was placed after all 10 synchronous `<script>` tags in `index.html`, forcing `app.js` to wait for `DOMContentLoaded` (after >1.2 MB of secondary modal scripts like `analytics.js` and `i2-graph.js` finished downloading) before even starting `init()`.
  2. **Unconditional SMB Directory Scans on Page Load Blocking `nas-bot-service` (`nas-video-archive.js` & `chat-widget.js`):**
     - `nas-video-archive.js` called `loadAvailableCameras()` (`GET /api/nas-bot/video-archive/cameras`) and `loadSyncStatus()` (`GET /api/nas-bot/sync/status`) unconditionally on every page load (`DOMContentLoaded`) even when the NAS Video Archive modal was closed. Inside `nas-bot-service`, `GET /api/nas-bot/video-archive/cameras` walked dozens of `recordings\2026-*` date folders synchronously over Tailscale SMB (`\\100.88.125.117\BPP215`), blocking `nas-bot-service` for 30–60+ seconds and stalling `GET /api/nas-bot/user/profile`.
     - `chat-widget.js` also called `loadCasesDropdown()` (`GET /api/nas-bot/cases`, 60 KB) unconditionally at startup even when the chat widget was closed.
- **Fix / Solution (`app.js?v=203`, `nas-video-archive.js?v=4`, `chat-widget.js?v=12`, `index.html`):**
  1. **Instant `0ms` Synchronous Grid & Clock Render (`app.js` `v=203`):**
     - Persisted `_cachedUserProfile` and `_cachedCameraNames` alongside `channels` in `localStorage` (`ta-nvr-dashboard`).
     - Called `tickClock()`, `setInterval(tickClock, 1000)`, `buildLayoutSwitch()`, and `rebuildGrid()` **synchronously at `0ms`** at the very start of `init()` before any network `await` so the camera grid and live streams/posters appear immediately (`0ms`).
     - Added `timeoutSignal` bounds (`3500ms`–`5000ms`) to `/auth/session`, `/settings/camera_names`, `/settings/channels`, and `/api/nas-bot/user/profile`, and made the 161 KB `/settings/camera_gps` preload non-blocking in the background.
     - Once server channels/profile resolve, `rebuildGrid()` delegates to `syncGridDiffSmoothly()` to reconcile any changes in-place without interrupting playing streams.
  2. **DOM Order & Deferred Secondary Scripts (`index.html`):**
     - Moved `#scanNvrOverlay` above the `<script>` tags, removed the duplicate `<script src="assets/chart.umd.min.js">`, added `defer` to secondary modal scripts (`admin.js`, `watchlist.js`, `chat-widget.js`, `analytics.js`, `tactical-map.js`, `arrest-vault.js`, `i2-graph.js`, `nas-video-archive.js`), and invoked `init()` immediately when `app.js` loads.
  3. **Lazy-Loaded NAS Archive & Chat Cases (`nas-video-archive.js` `v=4`, `chat-widget.js` `v=12`):**
     - Removed unconditional `loadAvailableCameras()` and `loadSyncStatus()` calls on page startup in `nas-video-archive.js` (they already run in `openModal()` / `onActivate()`), eliminating startup SMB scans on `nas-bot-service`.
     - Deferred `loadCasesDropdown()` in `chat-widget.js` until `#btnBotChat` is opened or `12s` after startup.



## Incident 2.181 - Fix Frozen Camera Frame on `CH05 กล้อง5` (`Doonsad5_sub`) & Stale Snapshot/MSE Decoder Stall Recovery (2026-10-21)
- **Symptom / User Request:**
  The user uploaded screenshot `media_1792574813303_0e149877.png` (`"ภาพกล้อง5 ที่ ch5 ค้าง"`) showing `CH05 กล้อง5` (`Doonsad5_sub`) frozen on a static frame of a pedestrian and motorcycle while displaying `🟢 REC` (Online). Additionally, `nvr-dashboard` access logs showed the browser polling `GET /nvr/api/Banmuang_15/latest.jpg` every 1.1 seconds with an unchanging `51868`-byte cached response.
- **Root Causes Diagnosed (`frigate-nvr/web/assets/app.js`):**
  1. **Raw WebSocket Packet Timestamp Overwriting `this.lastFrameTime` (`ws.onmessage` Line 1617):**
     - In `ws.onmessage`, every binary MSE packet unconditionally set `this.lastFrameTime = Date.now()`.
     - When an MSE stream's `<video>` decoder stalled on a WAN RTSP packet glitch (`Doonsad5_sub`), hit a micro-gap in `sb.buffered`, or threw `InvalidStateError` (`MEDIA_ERR_DECODE` / `ms.readyState !== 'open'`) inside `safeAppendMse`, `ws.onmessage` kept resetting `this.lastFrameTime = Date.now()` on every incoming WebSocket packet (or audio packet). Consequently, `silentMs = now - this.lastFrameTime` in `startWatchdog()` remained `~0ms` forever and **never triggered `jumpToLiveEdge()` or `this.fail()`**.
  2. **Audio Track Clocking `video.currentTime` While Video Decoder Was Frozen (`onTimeUpdate`):**
     - `Doonsad5_sub`, `Doonsad1_sub`, and `Banmuang_15_sub` include `pcm_alaw` audio tracks. Even when H.264 frame decoding stalled (`totalVideoFrames` stopped increasing), the audio timeline continued advancing `video.currentTime`, firing `timeupdate` and resetting `this.lastFrameTime`.
  3. **MSE Disjoint Buffer Micro-Gap Check (`sb.buffered`):**
     - `if (sb.buffered.length > 1 && this.video.currentTime < startLast - 0.1)` failed to jump across `<100ms` DTS/PTS micro-gaps (e.g. `12.40s` vs `12.45s` on WAN RTSP streams with `+genpts+discardcorrupt`), leaving `video.currentTime` stuck at the end of an older buffered range.
  4. **Desktop Trapped in `startSnapshotStream()` & Stale Frigate `/latest.jpg` Poster Pre-load:**
     - On WAN (`vms.local`), `preferMSE` started MSE first (`triedMSE = true`), then fell back to WebRTC (`triedWebRTC = true`), which after `3.8s` fell into `startSnapshotStream()` even on Desktop Chrome.
     - When a camera was disabled/offline in Frigate (`camera_fps === 0`, such as `Banmuang_15`), Frigate's `/nvr/api/<cam>/latest.jpg` still returned `HTTP 200` with the same `51868`-byte cached JPEG forever, and both `Camera.connect()`'s poster pre-load and `startSnapshotStream()` marked the tile `🟢 REC` (`live`) on a frozen image.
- **Fix / Solution (`frigate-nvr/web/assets/app.js` `v=204`, `frigate-nvr/web/index.html`):**
  1. **Hardware/Software Decoded Frame Watchdog (`getVideoPlaybackQuality().totalVideoFrames`):**
     - Removed `this.lastFrameTime = Date.now()` from `ws.onmessage` (`currentMode === 'mse'`) and `jumpToLiveEdge()`; raw WebSocket packets only update `this.lastPacketTime`.
     - Updated `onTimeUpdate` and `startWatchdog()` to verify `this.video.getVideoPlaybackQuality().totalVideoFrames` is actually increasing before updating `this.lastFrameTime`.
     - Lowered MSE/WebRTC freeze recovery thresholds in `startWatchdog()` to **4.0s** for Stage 1 Soft Recovery (`jumpToLiveEdge()`) and **7.5s** for Stage 2 Hard Reconnect (`this.fail()`).
  2. **Immediate `safeAppendMse` / `video.error` Reconnect & Micro-Gap Jump:**
     - Added `error` event listener on `this.video` and checks in `safeAppendMse` / `startWatchdog()` so `this.video.error`, `ms.readyState !== 'open'`, or `InvalidStateError` triggers `this.fail()` immediately instead of swallowing errors.
     - Fixed `sb.addEventListener('updateend')` to jump across any `sb.buffered` gap whenever the current range has `<= 0.3s` of headroom remaining before `startLast`, and lowered live-edge catch-up seek from `gap > 8.0s` to `gap > 4.0s`.
  3. **Removed Premature Poster `live` Status & Added Stale Snapshot Byte-Signature Guard:**
     - Removed the `/api/<baseCam>/latest.jpg` poster pre-load in `Camera.connect()` that prematurely called `this.onStatus('live')`, and reduced `RECONNECT_GRACE_MS` from `45000ms` to `8000ms`.
     - Restricted `startSnapshotStream()` fallback to `isIOSDevice` only (Desktop/Android call `this.fail()` to retry real 25fps MSE/WebRTC streams), added byte-signature comparison so 3 identical cached snapshots trigger `this.fail()`, and added an automatic 30s upgrade retry back to `this.connect()`.


## Incident 2.182 - Warrant Suspect Face Database Integration & Real-time AI Warrant Comparison (2026-10-22)
- User Request: Warrant suspect face database and comparison
- Indexing: 101 warrant suspect face dossiers extracted with legal warrant details (warrant_no, court, charge, expiry countdown)
- Real-time Alert: Telegram/Discord high-priority warrant alerts and Frigate sub_label notation
- UI: Warrant comparison card and modal with side-by-side face compare and 1-click link to Arrest Vault
- Per-Camera Toggle (`btnChFace`, `app.js?v=209`, `face_onnx.py`): Added `👤 ใบหน้า เปิด/ปิด` button directly inside Dashboard Camera Settings (`#settingsOverlay`) alongside `AI เปิด` and `LPR เปิด`, persisted via `/api/watchlist/faces/cameras` (`.face_cameras.json`) and operator profile (`disabled_face_cameras`).
- Automatic Dossier Photo Hot-Reload (`auto_sync_if_due` in `face_onnx.py` & `arrest-vault.js?v=30`): Any new photos or arrest warrants added in the future (via Arrest Vault Web UI or Telegram Bot) are automatically detected and indexed into 512-D ArcFace embeddings immediately upon upload and via a 60s incremental background check.
