# Environment Variables Reference

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-19
- **Evidence:** `.env.example`, `docker-compose.yml`, service source

Populate `.env` from `.env.example`; never commit real values. Compose scopes variables explicitly per service rather than loading the full `.env` into every container.

Every `*_SECRET` below must be independently generated with at least 32 random bytes. An empty value is not a development default; protected operations fail closed.

## Frigate and camera

| Variable | Required | Consumer | Meaning |
|---|---:|---|---|
| `FRIGATE_NONGWANG_USER` | yes | Frigate | Nongwang RTSP username used by tracked placeholders |
| `FRIGATE_NONGWANG_PASS` | yes | Frigate | Nongwang RTSP password |
| `FRIGATE_DVR_USER` | yes in current Compose | Frigate | legacy/DVR stream username |
| `FRIGATE_DVR_PASS` | yes in current Compose | Frigate | legacy/DVR stream password |
| `FRIGATE_CAM11_USER` | no | Frigate | optional legacy external cam11 username |
| `FRIGATE_CAM11_PASS` | no | Frigate | optional legacy external cam11 password |
| `STORAGE_MIN_FREE_PERCENT` | no (`15`) | Frigate patch | free-space threshold; runtime Dashboard setting takes precedence |

`{FRIGATE_*}` substitution occurs at container startup. Change `.env` and recreate Frigate; restart alone keeps the old container environment.

## Authentication

| Variable | Default | Consumer | Meaning |
|---|---|---|---|
| `AUTH_COOKIE_SECURE` | `true` | auth-service | require Secure session cookie; false is only for isolated HTTP tests |
| `COMPOSE_PROJECT_NAME` | `bpp-vms-<path hash>` for new GUI installs | Docker Compose | stable per-folder named-volume identity; prevents separate GUI test installs on one host sharing `auth-db` |
| `AUTH_AUDIT_SHARED_SECRET` | none | auth + approved producer | authenticate internal audit append |
| `AUTH_DB_PATH` | `/data/auth.db` | auth-service | test/non-Compose database override |
| `JWT_SECRET_PATH` | `/data/secret.key` | auth-service/CLI | persisted JWT key path |
| `JWT_SECRET` | unset | auth-service | optional external secret-manager key; disables file rotation command |

There is deliberately no admin username/password environment variable. The GUI
passes selected credentials to `manage.py provision-installation` over standard
input; console recovery keeps the existing bootstrap/rotation commands.

## Watchlist and Federation

| Variable | Default | Consumer | Meaning |
|---|---|---|---|
| `WATCHLIST_PROXY_SHARED_SECRET` | none | Dashboard + watchlist-api | authenticate proxy-created identity/assertions |
| `WATCHLIST_FEDERATION_SHARED_SECRET` | none | watchlist-api + LPR/peers | application credential for minimized Federation reads |
| `WATCHLIST_SERVICE_SHARED_SECRET` | none | watchlist-api + LPR | append detection history only |
| `BPP_FEDERATION_ALLOW_CIDR` | `127.0.0.1/32` | Dashboard nginx | comma-separated direct peer/VPN IPv4/IPv6 CIDRs; loopback keeps Federation closed |
| `WATCHLIST_ALLOWED_ORIGINS` | empty | watchlist-api | comma-separated exact trusted origins; empty disables CORS middleware |
| `WATCHLIST_DB_PATH` | `/data/watchlist.db` | watchlist-api | test/non-Compose database override |
| `LPR_SUPERADMIN_USERNAME` | `arm215` | watchlist-api | sole username allowed to adjudicate conflicts, change threshold and request rollback |

Dashboard startup trims `BPP_FEDERATION_ALLOW_CIDR` entries and generates one
nginx `allow` directive per CIDR. Empty entries, non-CIDR text, or nginx syntax
stop startup without printing the configured networks.

Do not use `*` in `WATCHLIST_ALLOWED_ORIGINS`.

## Config API

| Variable | Default | Meaning |
|---|---|---|
| `CONFIG_API_AUTH_VERIFY_URL` | `http://auth-service:5002/auth/verify` | direct server-side identity verifier |
| `CONFIG_API_LOCK_PATH` | `/config/.config-api.lock` | persistent interprocess lock file |
| `CONFIG_API_BACKUP_DIR` | `/config/backups` | timestamped recovery backups |
| `CONFIG_API_BACKUP_RETENTION` | `10` | successful backups retained per target |
| `CONFIG_API_LOCK_TIMEOUT_SECONDS` | `5` | bounded wait before HTTP 503 busy response |

These defaults normally remain internal to the Compose network and do not need `.env` entries.

## LPR service

| Variable | Default | Meaning |
|---|---|---|
| `LPR_FRIGATE_BASE_URL` | `http://frigate:5000` | internal Frigate API |
| `LPR_CAMERAS` | `cam11` | fallback comma-separated camera list |
| `LPR_CAMERAS_FILE` | `/lpr-config/lpr_cameras.txt` | runtime camera list; existing empty file means disable all |
| `LPR_ZONES_FILE` | `/lpr-config/lpr_zones.json` | normalized per-camera LPR zones |
| `LPR_LABELS` | `car,motorcycle,truck,bus,person` | polled labels; person is association-only |
| `LPR_VEHICLE_LABELS` | `car,motorcycle,truck,bus` | labels whose exact box may contain a plate search |
| `LPR_POLL_INTERVAL` | `2` | event poll seconds |
| `LPR_FRAME_INTERVAL` | `1.5` | live-frame sampling seconds |
| `LPR_MAINSTREAM_MAX_SAMPLES` | `12` | maximum high-resolution main-feed frames retained per vehicle event |
| `LPR_MAINSTREAM_CONSENSUS_MIN` | `2` | distinct frames that must agree before publishing an AI-pending readable plate |
| `LPR_PLATE_DET_CONF` | `0.35` | plate detector threshold |
| `LPR_CHAR_CONF` | `0.35` | character detector threshold |
| `LPR_MIN_PLATE_LEN` | `3` | minimum accepted normalized plate length |
| `LPR_USE_FRIGATE_BOX` | `1` | use event box where coordinate contract is valid |
| `LPR_BOX_PAD_RATIO` | `0.15` | crop padding ratio |
| `LPR_PLATE_DETECT_MODEL` | `/models/license_plate.pt` | machine-local plate detector |
| `LPR_CHAR_MODEL` | `/models/data_plate.pt` | machine-local Thai character model |
| `LPR_LINE_OCR_MODEL` | empty | optional initial contextual registration/province checkpoint |
| `LPR_MODEL_VERSION` | `baseline-20260818` | initial model-pair identity before a reviewed version is active |
| `LPR_MODEL_STORE_DIR` | `/model-store` | retained active pointer/checkpoints; read-only in runtime |
| `LPR_DEVICE` | `auto` | inference device; current image is CPU-pinned |
| `LPR_SUSPECT_PLATES` | empty | additional comma-separated suspect plates |
| `LPR_SUSPECT_PLATES_FILE` | `/lpr-config/suspect_plates.txt` | machine-local fallback list |
| `LPR_WATCHLIST_DB` | `/lpr-config/watchlist.db` | local read-only Watchlist database |
| `LPR_DISCORD_WEBHOOK_URL` | empty | Discord secret; empty disables channel |
| `LPR_TELEGRAM_BOT_TOKEN` | empty | Telegram secret |
| `LPR_TELEGRAM_CHAT_ID` | empty | Telegram destination; both Telegram values are required |
| `LPR_ALERT_LOCATION` | `Sloth BPP 215` in code; Compose normally overrides | alert location label |
| `LPR_ALERT_COOLDOWN` | `30` | repeat-alert cooldown per normalized plate |
| `LPR_SET_SUB_LABEL` | `1` | write Frigate sub-label |
| `LPR_DATA_DIR` | `/data` | crops/log output |
| `LPR_LOG_RETAIN_DAYS` | `14` | file retention |
| `LPR_LOG_LEVEL` | `INFO` | service log level |

LPR also receives `WATCHLIST_FEDERATION_SHARED_SECRET` and `WATCHLIST_SERVICE_SHARED_SECRET`; it does not receive proxy, auth-audit or camera credentials.

## LPR reviewed training worker

| Variable | Default | Meaning |
|---|---|---|
| `LPR_TRAIN_DEVICE` | `cpu` | training device passed to the worker as `LPR_DEVICE` |
| `LPR_TRAIN_EPOCHS` | `40` | detector fine-tuning epochs |
| `LPR_LINE_OCR_EPOCHS` | `30` | contextual CTC OCR epochs |
| `LPR_SYNTHETIC_COUNT` | `2500` | synthetic Thai plates used to fill layout/character/province coverage |
| `LPR_MIN_COVERAGE_PER_KIND` | `25` | minimum human-reviewed examples for each required kind |
| `LPR_METRIC_TOLERANCE` | `0.005` | maximum accepted no-regression tolerance |
| `LPR_THAI_FONTS_DIR` | `C:/Windows/Fonts` | host Thai-font directory mounted read-only |

The automatic sample threshold is not an environment variable. It defaults to 500 in `lpr_learning_settings` and can be changed only by `arm215` through the administrator UI/API. The worker also receives the LPR Discord/Telegram settings and the shared database/model/dataset mounts; it receives no camera or Frigate endpoint.

## Runtime files, not environment

| Path | Meaning |
|---|---|
| named Docker volume `auth-db:/data/auth.db` | users, login attempts and audit |
| named Docker volume `auth-db:/data/secret.key` | JWT signing key when not externally managed |
| `config/lpr/watchlist.db` | Watchlist and detection history |
| `config/lpr/lpr_cameras.txt` | LPR-enabled cameras |
| `config/lpr/lpr_zones.json` | LPR zones |
| `config/lpr/dataset/` | reviewed positive/negative examples; restricted negatives are not operational UI files |
| `lpr-model-store/` | retained validated model generations and atomic `active.json` pointer |
| `config/dashboard-settings/nodes.json` | approved Federation node URLs/names |
| `config/dashboard-settings/storage_threshold` | runtime storage override |
| `config/certs/fullchain.pem` / `privkey.pem` | Dashboard TLS material |

All are machine-local and may contain sensitive operational state.

On Windows, apply/verify their host DACLs with `scripts/harden-windows-acl.ps1`; environment scoping and container mounts do not prevent another local account from reading a broadly permissioned host file.

## Rotation/reload matrix

| Change | Recreate/restart |
|---|---|
| Camera `FRIGATE_*` | recreate `frigate` |
| Auth audit/cookie policy | recreate `auth-service` and relevant producers |
| Proxy secret/CIDR | recreate `dashboard` + `watchlist-api` |
| Federation secret | recreate `watchlist-api` + `lpr`; update peers |
| Service history secret | recreate `watchlist-api` + `lpr` |
| LPR tuning/env | recreate `lpr` |
| LPR camera/zone runtime files | hot reload, normally within 60 seconds |
| JWT key file | restart/recreate `auth-service`; all sessions invalid |

## IBM i2 import and bridge

| Variable | Default | Purpose |
|---|---:|---|
| `I2_IMPORT_MAX_BYTES` | `1073741824` | Maximum streamed `.anb` upload size (1 GiB) |
| `I2_IMPORT_MAX_ITEMS` | `250000` | Maximum normalized nodes plus edges accepted from the bridge |
| `I2_LAYOUT_MAX_NODES` | `250000` | Maximum positions accepted in one account layout |
| `I2_BRIDGE_JOB_TIMEOUT_HOURS` | `24` | Queue age before a job becomes retryable failed |
| `I2_BRIDGE_ROOT` | `/i2-bridge` | Container path of the ignored Windows bridge bind mount |
