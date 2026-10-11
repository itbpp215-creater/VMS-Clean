# BPP-VMS System Workflows & Logic

This document details the internal logic, interactions, and workflows of every major subsystem within the BPP-VMS (Frigate NVR) project.

---

## 1. Frigate NVR Engine (Core)
**Role:** Core video management, object detection, and recording engine.
- **Video Processing Logic:** Receives RTSP/RTMP streams, transcodes/restreams them for WebRTC/HLS consumption.
- **AI Object Detection Logic:** If `detect.enabled` is `true`, it sends low-res frames to the Google Coral TPU (or CPU) to find specified objects (e.g., `person`, `car`).
- **Event Recording Logic:** 
  - Records clips ONLY if the camera is enabled, AI is enabled, and tracked objects are found. 
  - Uses `active_objects` retention mode to save disk space (only records while the object is in frame).
  - Keeps events/alerts for a default of 7 days (configurable).

---

## 2. Config-API (System Configurator)
**Role:** The backend manager that safely modifies Frigate's configuration (`config.yml`).
- **Save Flow Logic:**
  1. Receives payload from the Dashboard (Camera Enabled status, AI Objects, etc).
  2. Modifies `config.yml` in a transactional, thread-safe manner (preventing config corruption).
  3. `applyEnabledChanges`: Explicitly updates the camera's `enabled` and `detect.enabled` states based on user preference, and keeps `record.enabled` in lockstep (`true` only while the camera is enabled).
  4. `sync_detect_roles`: Adjusts ffmpeg roles (adding/removing the `detect` role) based on whether AI is turned on. **(Bugfixed: It now respects the user's explicit AI OFF preference instead of auto-overriding it).**
  5. Triggers a Frigate process restart to apply YAML changes.

---

## 3. LPR Service (License Plate Recognition)
**Role:** Independent sidecar AI that reads Thai license plates.
- **Polling Logic:** Continuously polls Frigate's `/api/events` (every 2 seconds) for active events labeled as vehicles (`car`, `motorcycle`, `truck`, `bus`).
- **Trigger Logic:** When a vehicle's bounding box touches the user-drawn "LPR Zone", it triggers a high-resolution snapshot.
- **OCR Logic:** Passes the high-res crop into a PaddleOCR/YOLO model to detect and read Thai characters.
- **Finalization:** When the vehicle leaves (event ends), it selects the highest-confidence reading and POSTs it back to Frigate as a `sub_label` (e.g., `2กข1234 กทม`).

---

## 4. Watchlist API (Alert & Suspect Management)
**Role:** Manages the database of suspicious license plates and handles alert dispatch.
- **Storage Logic:** Uses a SQLite database to store license plate strings, owner names, and notes.
- **LPR Integration:** The LPR service reads from this database. When an OCR reading matches a Watchlist entry, it triggers an alert.
- **Alert Dispatch Logic:** Sends real-time webhooks with the snapshot image, plate number, and camera location to Discord and/or Telegram channels.

---

## 5. Dashboard (Frontend UI & WebRTC)
**Role:** The main operator interface (Nginx static file server).
- **State Management Logic:** Uses an IIFE (Immediately Invoked Function Expression) to manage `window.cfg` and `state.draft`.
- **Persistence Precedence:** At startup the Dashboard loads the shared channel map from `GET /settings/channels` and synchronizes it into browser storage. The browser copy is used only when the server settings read is unavailable, so a saved CH01-CH16 mapping survives refreshes and is consistent across browsers.
- **Channel Mapping Logic:** Dashboard slots such as `CH01` are display positions, not permanent camera identities. An administrator can remap a slot to another NVR camera; subsequent lifecycle, AI, and recording changes target the slot's current `src`. Remapping does not implicitly disable the previously selected NVR camera.
- **Saving Logic:** 
  - When the user clicks "บันทึก" (Save), the UI clones the current draft state (`state.draft`) into `cfg.channels`.
  - It sequentially calls `/api/config/cameras/.../objects` and `/api/config/cameras/.../enabled` to dispatch state changes to `config-api`.
  - Writes the raw JSON state back to `channels.json` through the admin-only `PUT /settings/admin/channels` WebDAV route. `GET /settings/channels` remains an authenticated-user read-only route.
- **WebRTC Player:** Connects directly to Frigate's go2rtc engine for sub-second latency live viewing.

---

## 6. Config Validator
**Role:** Safety checks for camera streams before applying them to Frigate.
- **Validation Logic:** When a new camera is added, it attempts to connect to the RTSP URL. If the stream is offline or invalid, it rejects the configuration, preventing Frigate from entering a crash-loop due to bad camera addresses.

---

## 7. Auth Service
**Role:** Gateway security and session management.
- **Access Logic:** Validates username/password against stored credentials.
- **Session Logic:** Issues HTTP-only session cookies. All APIs (`config-api`, `watchlist-api`, Frigate itself) are protected behind reverse-proxy rules that require a valid session cookie for any mutating actions (POST/PUT/DELETE).
