# Operator Dashboard

- **Status:** ACTIVE
- **Last reconciled:** 2026-07-29
- **Evidence:** `web/`, `dashboard-nginx.conf`, `auth-service/`

## Purpose

`web/` is the primary BPP PrerimWatch application layer. nginx serves it over TLS on port `443`; port `80` redirects to HTTPS.

## Current capabilities

- live camera grid with multiple layouts
- camera/channel/location search
- event rail, class focus and filters
- fullscreen live viewer
- Event Library, detail and playback workflows
- Watchlist/profile/history/statistics
- admin Settings for channel/object/storage/LPR/camera configuration
- one shared camera display name across the grid, channel picker, events, playback and NVR editor
- admin user/audit management
- responsive/accessibility behavior (see breakpoints below)

## Responsive breakpoints

Dashboard adapts layout for different screen sizes using CSS media queries and JavaScript column clamping. Desktop layout (>1024px) is never affected by mobile-specific rules.

| Breakpoint | Grid columns | Events Rail | Bottom bar | Modals |
|---|---|---|---|---|
| >1024px (desktop) | layout ที่เลือก (1-4 cols) | side-by-side กับ grid | ปกติ | ปกติ |
| 900-1024px (tablet) | สูงสุด 4 cols | overlay, ซ่อนเป็น default | wrap | ปกติ |
| 560-899px (mobile ใหญ่) | สูงสุด 3 cols | overlay, ซ่อนเป็น default | wrap | ปกติ |
| 401-560px (mobile) | สูงสุด 2 cols | overlay | column layout | full-screen |
| ≤400px (mobile เล็ก) | บังคับ 1 col | overlay | column layout | full-screen |

Icon toolbar buttons wrap on screens ≤899px. Tile text and padding scale down proportionally.

## Authentication and role behavior

- login creates an HttpOnly/Secure/SameSite=Strict session cookie
- application waits for `/auth/session` before applying role-aware controls
- regular users retain operational/Watchlist reads
- Settings, Nodes, Users and Watchlist mutation controls are admin-only in the UI
- nginx and backend APIs independently enforce privileged actions; hidden controls are not authorization
- logout calls the server endpoint and clears the cookie

JWT/session material is never stored in localStorage/sessionStorage. Only non-sensitive UI preferences such as layout may remain browser-local.

## Backend access

Dashboard uses same-origin routes:

- `/nvr/` → internal Frigate `5000`
- `/auth/` → auth-service
- `/api/watchlist` → watchlist-api
- `/api/config/` → config-api
- `/settings/` → admin-only runtime setting files
- `/lpr-crops/` → authenticated LPR evidence

Do not change browser code to call internal ports directly or enable wildcard CORS.

## Camera names and channel bindings

`channels[].src` is the canonical Frigate/NVR camera ID used for stream, configuration and API operations. The optional `channels[].name` is retained only as a legacy fallback and is saved as the technical ID for new channel bindings.

Operator-facing Thai/English display names are stored centrally in `config/dashboard-settings/camera_names.json`, keyed by that canonical ID. Dashboard UI resolves this map first, then falls back to the legacy channel name or source ID. Editing a display name therefore updates every Dashboard channel bound to that camera without changing its NVR identifier.

Only `web/assets/app.js` owns the NVR camera form and persists `camera_names.json` through `/settings/admin/camera_names`; the legacy `admin.js` camera-form listener is intentionally detached to prevent duplicate or incompatible saves.

## Stored data rendering

Camera/user/Watchlist/history strings are untrusted. The application uses DOM creation and `textContent`, encoded URL path segments and `addEventListener`. Do not interpolate persisted values into `innerHTML` or inline handlers.

nginx CSP disallows inline script and `eval`; external libraries must be pinned and explicitly allowlisted.

## Browser smoke coverage

`tests/browser-smoke.mjs` serves the real web tree on loopback and tests:

- admin controls visible
- regular-user mutation/admin controls hidden
- Watchlist remains read-only for regular user
- no JWT in JavaScript-visible storage
- HttpOnly cookie invisible to `document.cookie`
- stored XSS payload rendered literally without element/handler execution
- technical source IDs retained while shared display names render in the grid and both camera forms

## Personal User Grid Architecture

To support 100+ concurrent operators without feed disruption:
- Each user profile (`/api/nas-bot/user/profile`) maintains an isolated `channels` array representing their personal 16-slot grid (`CH01`–`CH16`).
- Assigning a camera to a grid slot via the empty slot picker ("➕ เลือกกล้อง"), the tile switch button ("เปลี่ยนกล้องในช่องนี้"), or the GIS Heatmap popup ("เปิดในจอของฉัน") updates only the operator's personal profile and localStorage.
- The System Master Grid (`/settings/channels`) acts as the default template and is never overwritten during daily operations.
- Operators can reset their personalized view back to the System Master Grid at any time using the "คืนค่าผังระบบ" button (`btnResetLayout`).
- Toggling or switching cameras only disconnects/reconnects the local browser's WebRTC peer connection or HLS stream without triggering Frigate backend restarts.

## GIS Heatmap Camera Marker RBAC

- All authenticated roles (`user`, `officer`, `admin`, `superadmin`) retain full read-only access to the GIS Heatmap, camera locations, coverage radiuses, and the "เปิดในจอของฉัน" personal grid assignment button.
- Administrative camera marker actions—including pin creation (`btnAddMapCameraUI`), marker relocation (`data-cam-move`), and marker deletion (`data-cam-delete`)—are strictly restricted to `admin` and `superadmin` roles.

## Related

- [Architecture](../architecture.md)
- [Security Model](../security-model.md)
- [ADR-0018: Personal User Grid and Heatmap Camera RBAC](../decisions/ADR-0018-personal-user-grid-and-heatmap-rbac.md)
- [Watchlist](watchlist.md)
- [Event Investigation](event-investigation.md)
- [Playback](playback.md)
- [Camera Provisioning](camera-provisioning.md)
