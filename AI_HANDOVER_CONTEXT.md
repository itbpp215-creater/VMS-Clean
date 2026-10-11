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


