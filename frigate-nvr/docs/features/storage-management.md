# Storage Management

- **Status:** ACTIVE · **Last reconciled:** 2026-08-02 · **Evidence:** `patches/patch_storage_threshold.py`, `config/config.yml`, `docker-compose.yml`

## Current policy

Current config does not record continuously 24/7:

- `continuous.days: 0`
- `motion.days: 0`
- active-camera alerts and detections retain their complete event window without an age limit (`99999` days, `all` mode)
- Frigate's built-in storage maintainer, not an external cleanup script, then reclaims the oldest recordings when free disk space falls below the configurable reserve (default 15%)
- snapshots retained 14 days

## Custom free-space protection

`patches/patch_storage_threshold.py` modifies Frigate StorageMaintainer behavior so cleanup can start before the disk becomes critically full. The patch matches the pinned Frigate source as one complete block, inserts its helper after Frigate's module logger declaration, and fails the image build if either anchor drifts.

Priority of threshold value:

1. `config/dashboard-settings/storage_threshold`
2. `STORAGE_MIN_FREE_PERCENT` from environment
3. default `15`

Dashboard runtime setting is re-read by the patched logic on the maintenance cycle, so changing the value does not require rebuilding the image

The event archive exposes a camera selector (including all cameras) and a date selector (including all retained days). These filters query Frigate with bounded pages rather than filtering only a recent browser cache. It renders 36 cards first, retrieves metadata in the background, then reveals the next 36 cards automatically as the operator reaches the archive scrollbar bottom; the total and rendered counts are displayed separately.

## Why cleanup stays inside Frigate

External deletion scripts were rejected because deleting media files outside Frigate can create mismatch between filesystem and database and may bypass Frigate retention/pinned-media behavior

The chosen design keeps deletion inside Frigate's own storage management path and changes only the trigger threshold

## Recovery of an interrupted recording index

If retained MP4 files exist but their matching `recordings` rows are missing, use
`scripts/recover-recording-index.py` from inside the Frigate container. Run it
without `--apply` first, review every reported path, then run it one UTC date at
a time with `--date`, an unused SQLite backup path, and `--apply`. The tool reads actual MP4 durations, indexes
only Frigate's canonical UTC directory structure, and never deletes, moves, or
re-encodes source recordings. It cannot recreate a clip whose media file is no
longer present for the event window.

## Upgrade risk

The patch is intentionally fail-loud. If Frigate internal code changes and the patch pattern no longer matches, image build should fail instead of silently losing storage protection

When upgrading Frigate:

1. inspect upstream storage implementation
2. update patch pattern if required
3. test cleanup behavior and DB consistency
4. document architecture changes in ADR/session/troubleshooting as appropriate

## Related

- [ADR-0003](../decisions/ADR-0003-storage-threshold-inside-frigate.md)
- [Current State](../current-state.md)
- [Troubleshooting](../troubleshooting.md)
