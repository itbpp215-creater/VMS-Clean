# ADR-0021: Bidirectional Personal Grid Synchronization in Settings with Explicit Admin Master Propagation

- Status: Accepted
- Date: 2026-09-24

## Context

Following the implementation of ADR-0019, the Settings Modal (Tab 2: หน้าจอกล้อง) was decoupled from an administrator's personal grid by asynchronously fetching and managing the central System Master Grid (`/settings/channels` / `channels.json`) independently. While this protected the system master template from unintended overwrites, it introduced severe operational friction:

1. **Dashboard-to-Settings Desynchronization**: When an operator or administrator selected or switched cameras on their active live dashboard (CH01–CH16), opening the Settings modal presented the static System Master Grid where unused channels (such as CH12–CH16) were blank and disabled. As a result, users could not view or configure AI object detection or LPR license plate recognition for their active camera feeds.
2. **Settings-to-Dashboard Disconnection**: When an operator configured channels in Settings Tab 2 and clicked "บันทึก" (Save), the save routine explicitly bypassed updating `cfg.channels` whenever a personal profile existed (`if (!hasPersonalGrid)`), preventing saved changes from taking effect on the user's active viewport.
3. **Demand-Driven Provisioning Race Condition**: When selecting cameras on the dashboard, the heartbeat notification to `nas-bot-service` was fired asynchronously without awaiting completion before triggering Frigate demand reconciliation. Furthermore, secondary sub-stream (`_sub`) and high-definition (`_hd`) identifiers were not populated during slot assignment, causing newly added cameras on CH12–CH16 to stall or report offline.

## Decision

1. **Personal Grid Authoritative in Settings Tab 2**:
   - The Settings Modal (Tab 2: หน้าจอกล้อง) initializes its editing draft (`state.draft`) directly from the user's active screen channels (`cfg.channels`).
   - Every operator and administrator immediately sees their active camera layout on CH01–CH16 and can directly toggle AI detection (`btnChDetect`), LPR license plate recognition (`btnChLpr`), and personal visibility (`btnChEnabled`) for any active slot.
   - Removed the asynchronous overwrite (`fetchServerMasterChannels()`) that previously clobbered active channel drafts upon opening settings.

2. **Explicit Admin Master Grid Propagation**:
   - For SuperAdmin and Admin roles, Tab 2 displays a dedicated checkbox:
     `[ ] อัปเดตผังแม่แบบระบบส่วนกลางด้วย (System Master Grid)` (unchecked by default).
   - When an Administrator saves settings with this option checked, the configuration updates their active personal screen AND is saved to the server (`/settings/admin/channels` / `channels.json`) as the system-wide master baseline.
   - When unchecked (default), saving strictly updates the user's personal screen and user profile without altering the System Master Grid.
   - Added an explicit "โหลดผังแม่แบบระบบ" button (`btnLoadMasterToDraft`) allowing administrators to inspect or modify the central baseline template on demand.

3. **Synchronized Ingest & Demand-Driven Provisioning**:
   - `sendUserHeartbeat()` is converted to return a Promise and is strictly `await`ed before `POST /api/public-config/reconcile` is dispatched.
   - `assignCameraToChannel(camId, chIdx)` automatically resolves `sub` (`camId + '_sub'`) and `hd` (`camId + '_hd'`) stream identifiers from `state.nvrCameras` and awaits both user heartbeat and demand reconciliation.
   - In `nas-bot-service`: Increased heartbeat timeout window to 300 seconds (5 minutes) to ensure continuous feed retention during operator monitoring sessions.

## Consequences

- 100% bidirectional synchronization between live dashboard viewports and the camera settings form.
- Full operator capability to configure AI and LPR detection on any assigned channel (CH01–CH16) without encountering empty or offline states.
- Total protection of the System Master Grid while providing administrators with clear, deliberate control over system template propagation.
- Immediate, reliable stream playback on newly assigned channels via automated sub-stream resolution and synchronized demand reconciliation.
