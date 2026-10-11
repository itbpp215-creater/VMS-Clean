# ADR-0022: Frigate-Authoritative AI Detection State & Settings Reconciliation

## Context
Operators observed that cameras actively running AI object detection in Frigate NVR and generating detection events (e.g. `KhonKaen3`, `KhonKaen15`) displayed as "AI ปิด" in the Dashboard Camera Settings modal. Furthermore, clicking the AI toggle button failed to update the visual state or enable object selection in the grid.

Investigation revealed three root causes:
1. `channels.json` stored `"detect": false` for all channel slots, overriding the live Frigate status.
2. `btnChDetect` mutated only personal profile mute lists (`userProfile.disabled_ai_cameras`) without updating `d.detect` in the channel draft or persisting to `config.yml`.
3. In `renderChForm`, `dt = !isAiDisabledByMe && (ch.detect !== false)`. With `ch.detect === false`, `dt` remained deadlocked at `false`, preventing the UI from ever displaying "AI เปิด".

## Decision
1. **Frigate Single Source of Truth**: The dashboard settings UI derives camera AI status directly from Frigate configuration (`detect.enabled`), overriding any stale or false flags in frontend `channels.json`.
2. **Authoritative Reconcile on Modal Load**: When opening the camera settings modal, channel draft items (`state.draft[i].detect`) are automatically reconciled against Frigate's live camera configuration.
3. **Role-Gated System Mutation**: Administrators toggling the AI button update the draft channel detection state (`d.detect`), which is committed to Frigate (`PUT /api/config/cameras/{name}/enabled`) upon saving settings. Non-administrators view authoritative AI status in read-only mode and control only personal notification mute lists.
4. **Personal Alerts Synchronization**: The personal alert matrix in settings tab 4 (`tabMyAlerts`) correlates directly with each camera's live AI detection status (`state.draft` and `state.frigateDetect`), displaying real-time status badges (`AI เปิด` / `AI ปิด (NVR)`), guidance warnings, and syncing `userProfile.disabled_ai_cameras` upon alert subscription saves.

## Consequences
- The AI toggle button accurately reflects the live object detection state in Frigate.
- Enabling or disabling AI via the settings modal properly persists to Frigate's `config.yml` on save.
- Personal alert mutes remain decoupled from system-level detection while maintaining visual and functional synchronization in the personal alert settings matrix.
