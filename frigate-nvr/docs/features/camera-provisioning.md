# Camera Provisioning and Safe Config Mutation

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-08
- **Evidence:** `config-api/api.py`, `config-api/config_store.py`, `config-api/trusted_auth.py`, `web/assets/app.js`

## Purpose

Config API allows an administrator to inspect/add/update/delete camera definitions, synchronize LPR/detection roles, change WebRTC candidate and explicitly restart Frigate without allowing ordinary users or concurrent writes to corrupt tracked configuration.

## Authorization

Every `/api/config/*` route is admin-only, including reads/status:

1. nginx runs `/auth/verify/admin`
2. config-api independently forwards only the original `Cookie`/`Authorization` to auth-service
3. config-api ignores caller `X-User`/`X-Role`
4. auth-service response must contain a current identity with role exactly `admin`

Auth-service unavailable, missing credentials or incomplete verifier response fails closed.

## Endpoints

| Method/path | Behavior |
|---|---|
| `GET /api/config/cameras` | list camera sources/settings/groups |
| `POST /api/config/cameras` | add camera + streams + group |
| `PUT /api/config/cameras/{old_name}` | rename/replace camera and associated streams |
| `DELETE /api/config/cameras/{name}` | delete camera, group and main/sub streams |
| `GET/POST /api/config/webrtc` | read/set IPv4 WebRTC candidate |
| `POST /api/config/lpr_streams_sync` | reconcile input roles with LPR camera list |
| `POST /api/config/sync_detect_roles` | reconcile active recording/detection roles |
| `PUT /api/config/cameras/{name}/objects` | set the tracked-object list for one camera |
| `PUT /api/config/cameras/{name}/enabled` | enable/disable a camera (also flips detect/record) |
| `GET/PUT /api/config/federated_peers` | read/set federation peer list |
| `GET /api/config/federation/cameras` | camera list exposed to federation peers |

There is **no** `/status` and **no** `/restart` route, and config-api has **no Docker
socket** — the service runs `read_only: true` with `cap_drop: ALL` and cannot restart
anything. (Both routes were documented here until 2026-08-08; probing the running
service returns 404 for each.) A successful config write therefore does not by itself
prove Frigate accepted or loaded the new config — reloading is a separate operator step.

## Input validation

- camera name: 1–64 characters, starts alphanumeric, then alphanumeric/`_`/`-`
- main URL required; sub URL optional
- accepted schemes: `rtsp`, `rtsps`, `rtmp`, `rtmps`, `http`, `https`
- URL must contain a valid hostname
- if URL has userinfo, both username and password must be complete `{FRIGATE_*}` placeholders; literal or mixed credentials return 422
- control characters rejected
- WebRTC candidate must be an IPv4 address; service writes `<ip>:8555` plus `stun:8555`
- semantic config validation checks camera/detect/ffmpeg inputs and roles, go2rtc streams/candidates and group metadata

Frigate's own validator is still required before deployment.

## Write transaction

```text
validate request
  -> acquire OS interprocess lock
  -> load config.yml (+ nvr_groups.json when required)
  -> mutate in memory
  -> validate + serialize + reparse
  -> stage/fsync temporary files on destination filesystem
  -> create timestamped backups
  -> atomic os.replace
  -> rollback all already-replaced coordinated files on failure
  -> prune old successful backups
  -> release lock
```

Properties:

- lock covers the complete read-modify-commit window and prevents lost updates
- default lock wait is 5 seconds; timeout returns 503
- malformed request/config returns 422 without replacing the original
- config and group metadata commit together when both change
- default backup retention is 10 per target
- temporary files are cleaned on success/failure
- update/delete removes the old camera's main, `_sub` and `_hd` go2rtc entries, preventing those affected streams from becoming orphans
- current baseline (2026-08-08): 15 cameras map to 45 go2rtc streams — main + `_sub` + `_hd` each. The older "14 cameras / 28 streams" baseline predates the `_hd` streams; do not treat the `_hd` entries as orphans to delete

The lock file remains on disk intentionally. OS lock ownership, not file existence, controls access.

## Camera stream/input behavior

New camera:

- go2rtc main key = camera name
- optional sub key = `<camera>_sub`
- optional full-screen key = `<camera>_hd`, created only when a sub URL is supplied
- main input records
- non-LPR camera detects on sub when available, otherwise main
- LPR camera detects on main to preserve useful plate resolution
- record/snapshot retention follows project defaults
- group metadata is stored in `config/nvr_groups.json`

### Stream encoding template (2026-08-07)

Provisioning generates the same encoding pattern that the tracked `nongwang*` cameras
use, so a camera added through the dashboard costs no more CPU than one added by hand:

| go2rtc key | filter | why |
|---|---|---|
| `<camera>` (main, when a sub exists) | `#video=copy#audio=copy` | recording passes the upstream codec through — zero transcode |
| `<camera>_sub` | `#video=h264#hardware#audio=copy` | detect + dashboard tiles need H.264; NVENC does the work |
| `<camera>_hd` | `#video=h264#hardware#audio=copy` | full-screen view of the main stream; go2rtc starts it lazily, so NVENC runs only while somebody is watching |
| `<camera>` (main, when there is **no** sub) | `#video=h264#hardware#audio=copy` | the single stream must be browser-playable, so it is transcoded on NVENC |

Before this change every generated stream used `#video=h264` with no `#hardware`,
which pinned each one to software libx264 — the cause of the CPU saturation fixed in
[`sessions/session-2026-08-07-stream-performance-and-remote-video.md`](../sessions/session-2026-08-07-stream-performance-and-remote-video.md).

`GET /api/config/cameras` reports `has_hd` per camera. The dashboard sets a channel's
`hd` field from that flag rather than guessing from the name, so cameras provisioned
before this change are never pointed at an `_hd` stream that does not exist.

Filter suffixes are stripped before a URL is returned to the browser and re-applied on
save, so repeated edits do not accumulate duplicate `#audio=copy` fragments.

Role synchronization avoids empty-role sub inputs and compares normalized path/role signatures before writing, so a no-op sync creates no backup.

## Credential handling

Provisioning never persists literal URL credentials. For an authenticated stream:

1. generate service-specific keys such as `FRIGATE_SITE_USER` / `FRIGATE_SITE_PASS`
2. store real values only in machine-local `.env` and scope them to Frigate in Compose
3. enter the URL using `{FRIGATE_SITE_USER}:{FRIGATE_SITE_PASS}@...`
4. Config API rejects missing, mixed or literal userinfo before opening a transaction
5. review tracked config/backups and run repository credential invariants before commit

The UI placeholder shows this indirection pattern and must never suggest `user:password@...`.

## Failure/recovery

Do not report provisioning complete until:

- transaction returned success
- Frigate config validation passed
- explicit restart completed when required
- expected camera appears and streams

Backups are under `config/backups/`. For coordinated YAML/group changes restore files sharing the same transaction ID. See [`../operations.md`](../operations.md).

## Tests

`config-api/tests/` covers:

- spoofed role/header rejection and direct auth verification
- regular-user denial and admin access
- request/config validation
- lock timeout/concurrent serialization
- atomic write, backup retention, rollback and temp cleanup
- associated main/sub stream cleanup

## Limitations

- config-api writes the production config, so it must remain internal and admin-only — but it holds no Docker socket and cannot restart or inspect containers
- semantic validator is deliberately narrower than full Frigate schema validation
- live Docker restart/build/nginx validation was unavailable in the 2026-07-23 hardening environment

## Related

- [Security Model](../security-model.md)
- [Operations](../operations.md)
- [ADR-0009](../decisions/ADR-0009-crash-safe-config-transactions.md)
- [Frigate Configuration Reference](../reference/frigate-configuration.md)
