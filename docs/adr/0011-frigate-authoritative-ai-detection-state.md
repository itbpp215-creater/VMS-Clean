# Frigate-Authoritative AI Detection State & Settings Reconciliation

To eliminate desynchronization where the dashboard settings AI toggle is locked at "AI ปิด" while Frigate NVR is actively running object detection, camera AI detection state is strictly authoritative from Frigate:

1. **Frigate Single Source of Truth**: The dashboard settings UI derives camera AI status directly from Frigate NVR configuration (`detect.enabled`), overriding any stale or false flags in frontend `channels.json`.
2. **Authoritative Reconcile on Modal Load**: When opening the camera settings modal, channel draft items (`state.draft[i].detect`) are automatically reconciled against Frigate's live camera configuration.
3. **Role-Gated System Mutation**: Administrators toggling the AI button update the draft channel detection state (`d.detect`), which is committed to Frigate (`PUT /api/config/cameras/{name}/enabled`) upon saving settings. Non-administrators view authoritative AI status in read-only mode and control only personal notification mute lists.
4. **Personal Alerts Synchronization**: The personal alert matrix in settings tab 4 (`tabMyAlerts`) correlates directly with each camera's live AI detection status (`state.draft` and `state.frigateDetect`), rendering real-time status badges (`AI เปิด` / `AI ปิด (NVR)`), alert guidance warnings, and synchronizing `userProfile.disabled_ai_cameras` when alert subscriptions are configured.
