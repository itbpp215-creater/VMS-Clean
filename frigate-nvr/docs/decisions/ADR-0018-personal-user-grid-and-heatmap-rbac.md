# ADR-0018: Personal User Grid and Heatmap Camera RBAC

- Status: Accepted
- Date: 2026-09-22

## Context

In the existing dashboard architecture, channel slot mapping (`CH01`–`CH16`) and stream enablement states were persisted globally to `/settings/channels` (`channels.json`) and synchronized directly to Frigate's backend ingest configuration. Consequently, whenever any user (regardless of permission level) switched a camera slot, added a camera from the map, or toggled a stream off via the UI, it altered the channel layout for all other concurrent users and frequently triggered Frigate process restarts, disrupting live feeds for the entire deployment (over 100+ concurrent operators). Furthermore, camera placement, movement, and deletion controls on the GIS Heatmap lacked visual and role-based gating, causing non-admin operators to encounter confusing authorization errors when interacting with map pins.

## Decision

1. **Personal User Grid Architecture**: Decouple per-user viewport layout from the global NVR ingest configuration. Each authenticated user session maintains their own personal slot-to-camera mappings, active grid layout, and channel visibility stored in their server-backed profile (`/api/nas-bot/user/profile`), falling back to client-side storage during network failures.
2. **System Master Grid Preservation**: Central channels (`/settings/channels`) are preserved strictly as the system-wide baseline template managed exclusively by administrators (`/settings/admin/channels`). New users or users requesting a reset inherit this master layout without overwriting individual profiles.
3. **Client-Side Stream Isolation**: Toggling a camera off or changing a slot in a user's browser only disconnects that client's WebRTC peer connection or HLS stream session. Backend camera ingest in Frigate and go2rtc remains continuously active for all other operators without process restarts or side effects.
4. **Dual Camera Selection UX**: Operators can assign cameras to their personal grid slots either from the GIS Heatmap popup ("เปิดในจอของฉัน") or directly on the dashboard grid via a fast Camera Picker modal on empty or active channel tiles.
5. **Heatmap Camera Marker RBAC**: Viewing the GIS Heatmap and camera locations remains available to all authenticated roles. However, camera marker placement (`btnAddMapCameraUI`), marker relocation (`data-cam-move`), and marker deletion (`data-cam-delete`) are strictly restricted to `admin` and `superadmin` roles in both the presentation layer and the backend configuration endpoint (`/settings/admin/camera_gps`).

## Consequences

- More than 100+ concurrent users can view completely different camera combinations simultaneously without channel collisions, screen hijacking, or Frigate downtime.
- Hardware camera streams stay continuously ingested once by Frigate/go2rtc, with go2rtc multicasting WebRTC streams efficiently to concurrent clients.
- Map camera pins cannot be accidentally moved or deleted by standard operators, while operational situational awareness remains fully accessible across all user tiers.
