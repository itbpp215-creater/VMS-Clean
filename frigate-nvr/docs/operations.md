# Operations and Deployment Runbook

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-20 (durable LPR delivery and worker health checks added)
- **Evidence:** `docker-compose.yml`, `.env.example`, service management commands, `deploy.sh`

## Multi-site v1 migration release

Build only from a clean `main` checkout on the source machine. The output directory
must be outside the application tree. The production invocation is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\release\New-BppMigrationPackage.ps1 `
  -InstallPath D:\BPP-VMS\frigate-nvr `
  -OutputDirectory D:\BPP-VMS-Migration-Package `
  -Version v1.0.0 `
  -ReplaceExisting
```

Preflight must complete before quiescence. After writers stop, a build/verifier
failure deliberately keeps the source stack stopped. Correct the problem and rerun
with `-ReplaceExisting`; do not manually start services until the final TAR has
passed listing, full extraction, per-file hashes, required model/state checks and
scope scanning. On success the tool restarts only services that were running before
the snapshot and validates Frigate health.

Expected Drive-folder artifacts:

- `BPP-VMS-FullBackup.tar` and `.sha256`
- Install/Update/Verify BAT files and `คู่มือ-BPP-VMS.md`
- adjacent `tools/` directory; BAT files are not standalone without it

The existing `.tar.enc` and legacy `migrate-machine.ps1` workflow are not modified
or deleted. The new TAR is unencrypted and must be access-controlled as sensitive.

### Install a target

1. Install Docker Desktop (WSL2) and a working NVIDIA driver; confirm `docker info`,
   `docker compose version` and `nvidia-smi -L`.
2. Keep `D:\BPP-VMS` absent or empty and download the complete Drive folder.
3. Run `Verify_BPP-VMS.bat`, then `Install_BPP-VMS.bat` and approve UAC.
4. Choose Clone or NewSite, enter the site name and the machine's stable LAN IPv4.
5. Open `https://<LAN-IP>` only after the BAT reports success. The self-signed IP
   certificate normally requires a browser trust exception on first use.

Clone contains camera definitions/credentials but starts with all camera, detect and
record toggles false. NewSite contains no source cameras/streams/credentials. Both
create independent node/Compose/JWT/TLS/shared secrets and leave Federation, bots,
DuckDNS and ACME blank. The `public-edge` profile remains inactive.

Installation failure leaves no autostart marker. A retry may replace only a target
carrying `.bpp-install-partial`; any other non-empty `D:\BPP-VMS` is refused.
After success, a current-user logon Scheduled Task waits for Docker Desktop and then
starts/validates the local-only stack. It does not guarantee pre-login WSL2 startup.

### Build and apply updates

Production updates require a clean `main` and a numeric version newer than the
policy baseline:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\release\New-BppUpdatePackage.ps1 `
  -Version v1.1.0 `
  -OutputDirectory D:\BPP-VMS-Updates\v1.1.0
```

Download one update TAR folder, run Verify, then `Update_BPP-VMS.bat`. The updater
preserves site-owned environment/cameras/TLS/Watchlist/NAS/media, disables autostart
during promotion, loads the bundled images, and validates the candidate. Failure
restores and validates the previous release automatically. Success retains the three
newest rollback generations under `.bpp-rollback`.

Development files are labelled `-dev.<commit>` and are rejected unless an operator
explicitly uses `-AllowDevelopment`; the one-click production BAT does not do so.
SHA-256/manifest provides integrity only, not publisher authentication. Cross-site
Federation/synchronization is outside v1.0.0 and remains disabled.

## Verified new-camp package

Build a transferable installer only from the repository root with:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1
powershell -ExecutionPolicy Bypass -File .\installer\build-new-camp-package.ps1
```

Transfer and extract the resulting ZIP as one directory. `install_new_camp.exe`
is a UAC-elevated Windows Forms wizard, not a self-contained system package: it
requires the adjacent `installer/`, `frigate-nvr/`, and `install-manifest.json`.
The wizard lets the operator choose a new local installation folder, then checks
the manifest, storage patch, and both LPR files before it creates `.env` or starts
Docker. The release builder includes only
`LicensePlateRECOG/model/license_plate.pt` and `data_plate.pt`; it excludes
`.env`, runtime state, recordings, databases, and legacy LPR source.

The wizard requires a selected Web Admin username/password and camera credentials.
The selected admin is stored as a bcrypt hash in an empty named `auth-db` volume
and appears in Dashboard user administration after startup. Any Docker build,
startup, health, manifest, destination-copy, or account-provisioning failure stops
the process without printing success. Run it as an approved Windows administrator
so it can apply the repository ACL policy.

### Transfer existing user accounts

On the source machine, run the updated EXE and select the existing BPP-VMS
installation folder that owns the current Compose project, then choose **สร้างไฟล์
ย้ายผู้ใช้จากเครื่องนี้**. Choose a new `.bppusers` output filename and a migration
password of at least 16 characters. Docker Desktop must be running; the operation
rebuilds the auth image then exports only account username, bcrypt hash, role, and
active state.

Transfer this encrypted file separately from the ZIP. In the new-machine wizard,
select it and provide the same migration password. The target `auth-db` must be
empty and the new selected admin username must not duplicate an imported user. The
import is atomic. Existing users keep their passwords but must sign in again
because no JWT signing key or browser session is transferred.

## Complete machine migration without the installer

Use `scripts/migrate-machine.ps1` when moving an existing BPP-VMS host and
retaining its complete local identity: Web users and passwords, `.env` secrets,
JWT/TLS material, Watchlist/LPR settings and history, Frigate event database,
models, and (optionally) recordings. This is not the new-camp installer. It
restores into a **new empty** Compose root and keeps the existing `auth-db`, so
users retain their passwords and existing browser sessions/JWT keys also move.

On the old host, open an elevated Windows PowerShell session from the current
`frigate-nvr` directory and export to an external drive or other approved encrypted
storage outside the application directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\migrate-machine.ps1 `
  -Mode Export `
  -InstallPath D:\BPP-VMS\frigate-nvr `
  -ArchivePath E:\BPP-VMS-2026-08-02.bppmig `
  -IncludeDockerImages
```

The script prompts twice for a migration password (minimum 16 characters); it
never accepts that password as a command-line argument. Add `-IncludeRecordings`
only when recordings are required because it can make the archive very large. Add
`-KeepSourceStopped` for a controlled cutover; otherwise the source Compose stack
is restarted after the consistent snapshot finishes. `-IncludeDockerImages` saves
the current Compose images for an offline target; omit it only when the target has
normal registry access and can rebuild images.

Copy both the resulting `.bppmig` archive and the same reviewed
`scripts/migrate-machine.ps1` file to the new machine. Install and start Docker
Desktop plus the approved NVIDIA driver there first. Then run an elevated PowerShell
session and select a new empty destination (not a folder containing an existing
deployment):

```powershell
powershell -ExecutionPolicy Bypass -File E:\migrate-machine.ps1 `
  -Mode Import `
  -ArchivePath E:\BPP-VMS-2026-08-02.bppmig `
  -InstallPath D:\BPP-VMS\frigate-nvr
```

Import authenticates before extraction, creates stopped Compose containers,
restores `auth-db` and `frigate-db` before services start, reapplies
`harden-windows-acl.ps1`, starts the stack, waits for Frigate health, and validates
the Frigate configuration. It checks `nvidia-smi` before it begins the target
restore. It does **not** copy the CUDA cache because it is
hardware-specific and safely recreates on the new GPU. Update the Dashboard WebRTC
host IP after the move; host network identity is intentionally not copied.

The `.bppmig` archive contains all site secrets and may contain recordings. Keep it
only in approved encrypted storage, verify the new host, then securely remove every
temporary copy and rotate any secret required by local policy. Do not import it
over an existing installation or use it as a routine backup format.

## First-time secure setup

1. Clone the private repository and create machine-local environment:

   ```bash
   git clone https://github.com/Meltingth/BPP-PrerimWatch.git
   cd BPP-PrerimWatch
   cp .env.example .env
   ```

2. Generate each required `*_SECRET` independently with an approved password manager/secret generator. Use at least 32 random bytes and never paste values into Git, tickets, chat or shell scripts.

3. Populate camera credentials in `.env`. Every `{FRIGATE_*}` referenced by `config/config.yml` must have a matching key.

4. Provision machine-local assets:

   - `config/model_cache/yolo11m-640.onnx` (included by the verified new-camp package)
   - `LicensePlateRECOG/model/license_plate.pt`
   - `LicensePlateRECOG/model/data_plate.pt`
   - TLS `config/certs/fullchain.pem` and `config/certs/privkey.pem` (the GUI installer creates a local self-signed pair only if both are absent; replace it with approved PKI material for production trust)
   - optional LPR/runtime files under `config/lpr/`

5. Bootstrap the first administrator **before normal startup**:

   ```bash
   docker compose run --rm auth-service \
     python manage.py bootstrap-admin <username> \
     --output-file /data/admin-credential.once
   ```

   The command refuses a database that already contains users. The file is in
   the native `auth-db` Docker volume at `/data`, not `config/auth/`. Record the
   generated credential in an approved secret store, verify login after startup,
   then remove the one-time file from that volume. Do not commit or retain it as
   a backup. The verified installer automates this handoff without using a host
   plaintext file.

6. Validate Compose and start:

   ```bash
   docker compose config --quiet
   docker compose build
   docker compose up -d
   ```

7. Access `https://<host>/`. Port 80 redirects to TLS; there is no supported plaintext application mode in production.

## Standard deployment

```bash
./deploy.sh
```

Tracked production files are Git-managed. Do not keep unpushed work only on the production host because deployment may replace it. Machine-local secrets, models, databases, certificates and recordings stay in gitignored paths.

### Production Windows autostart

Production Docker Desktop is installed per-user and starts after the operator signs in.
Register the tracked recovery script in the same user's Run key:

```powershell
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\BPP-VMS\frigate-nvr\autostart-frigate.ps1"'
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name 'BPP-PrerimWatch-Autostart' -PropertyType String -Value $command -Force
```

The script waits up to 15 minutes for the per-user Docker engine, runs the full
Compose project, restores `frigate-nvr` to `unless-stopped` after any isolation
test, and writes expected/running/missing service counts to `autostart.log`.
Verify after a reboot with `docker compose ps` and the tail of that log; Docker
Desktop being visible by itself does not prove the Compose stack was started.

After a security/config change, explicitly recreate containers that consume changed environment or nginx templates:

```bash
docker compose up -d --build
docker compose up -d --force-recreate dashboard auth-service watchlist-api lpr config-api
```

Recreate is required for environment changes; a process restart alone does not reload Compose environment.

## Authentication operations

### Rotate one account password

```bash
docker compose run --rm auth-service \
  python manage.py rotate-password <username> \
  --output-file /data/password-rotation.once
```

Store the new value securely, test it, then delete
`/data/password-rotation.once` from the native `auth-db` volume. The installer
uses rotation only with an explicit `-RecoveryUsername`; it never treats
bootstrap as a password reset.

### Replace an inherited/default-named administrator

For an existing database that still has active `admin`, create a distinct replacement and disable the legacy account atomically:

```bash
docker compose run --rm auth-service \
  python manage.py replace-default-admin <replacement_username> \
  --output-file /data/replacement-admin.once
```

The command refuses a missing/inactive legacy admin, a duplicate replacement name or an existing output path. Record the generated credential, restart auth-service, verify replacement login and legacy-account rejection, then delete the one-time file.

### Rotate the JWT signing key

```bash
docker compose run --rm auth-service python manage.py rotate-jwt-secret
docker compose up -d --force-recreate auth-service dashboard
```

All existing sessions become invalid after auth-service reloads the key. If `JWT_SECRET` is managed externally, rotate it in that secret manager instead; the CLI intentionally refuses to replace the file in that mode.

### Recover an empty/mis-mounted auth database

Auth-service failing with “No active administrator exists” is a safety behavior, not an invitation to add a default password.

1. Verify `./config/auth:/data` is the intended volume.
2. Restore the correct database if it exists.
3. Run `bootstrap-admin` only when the intended database is genuinely empty.
4. Never copy a credential from documentation or source.

## Shared-secret rotation

The four internal credentials are independent:

- `AUTH_AUDIT_SHARED_SECRET`
- `WATCHLIST_PROXY_SHARED_SECRET`
- `WATCHLIST_FEDERATION_SHARED_SECRET`
- `WATCHLIST_SERVICE_SHARED_SECRET`

For a coordinated rotation:

1. generate new independent values in the machine-local secret store/`.env`
2. update approved Federation peers for the Federation secret
3. recreate all holders together:

   ```bash
   docker compose up -d --force-recreate dashboard auth-service watchlist-api lpr
   ```

4. verify login, Watchlist read/admin mutation, history write and Federation from an allowed peer
5. revoke old values from every peer/store

Partial rotation fails closed and may temporarily return 401/403/503; do not weaken checks to bridge the change.

## Windows ACL hardening

Preview and then apply exact recursive ACLs from the intended Windows operator account:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\harden-windows-acl.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File .\scripts\harden-windows-acl.ps1
```

If Docker/runner uses a distinct approved Windows identity, add it explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\harden-windows-acl.ps1 `
  -AdditionalPrincipal "DOMAIN\ServiceAccount"
```

The script restricts `.env`, auth/backups/certs/LPR state and `lpr-data` to SYSTEM, local Administrators, the current operator and explicit additional principals. It recurses into existing children, verifies the final SID set and refuses paths outside the resolved repository root.

Run it:

- during first setup after creating machine-local paths
- after restoring secret/runtime directories from backup
- after changing the Windows service/runner identity

Do not solve a permission error by granting `Authenticated Users` or `Builtin Users`; rerun with the narrow required `-AdditionalPrincipal`.

## Camera credential rotation

Moving credentials from tracked YAML to `.env` does not revoke the upstream password.

1. Rotate the password on the camera/DVR/external stream endpoint.
2. Update the matching `FRIGATE_*` values in `.env`.
3. Recreate Frigate:

   ```bash
   docker compose up -d --force-recreate frigate
   ```

4. verify go2rtc producers and all expected camera streams.

The upstream device rotation remains an external operational action for the 2026-07-23 hardening change.

## Federation enablement

Federation is denied by default because `.env.example` uses loopback CIDR.

1. Establish the approved site-to-site VPN or mTLS termination.
2. Set `BPP_FEDERATION_ALLOW_CIDR` to one narrow direct peer/VPN IPv4/IPv6 CIDR,
   or a comma-separated list when approved peers arrive through multiple subnets.
3. Distribute a unique `WATCHLIST_FEDERATION_SHARED_SECRET` through a secret manager.
4. Confirm peers use an `https://` node URL.
5. Recreate Dashboard, Watchlist and LPR holders.
6. Test allowed GET, denied source, missing/incorrect secret and non-GET rejection.
7. Verify the response contains only plate/display/danger fields.

Current nginx template uses the VPN-CIDR assertion path. Enabling mTLS requires trusted-proxy certificate verification before it may assert success to watchlist-api.

Dashboard startup validates every configured CIDR and generates one nginx
`allow` directive per entry. A malformed or empty list element stops the
Dashboard fail-closed; correct the variable and recreate only `dashboard`.

## Config API and recovery

Config writes are serialized and create backups under `config/backups/`. Default retention is 10 successful backups per target file.

Before a manual restore:

1. stop `config-api` and avoid concurrent UI writes
2. select `config.yml` and `nvr_groups.json` backups with the same transaction identifier when both were changed
3. preserve the failed/current files for investigation outside Git if they may contain credentials
4. restore the selected backup
5. run Frigate validation
6. restart Frigate and config-api

```bash
docker exec frigate-nvr python3 -m frigate --validate-config
docker compose up -d config-api
docker compose restart frigate
```

Do not delete `.config-api.lock` to “unlock” a request. Ownership is an OS file lock, not the file's existence; a crashed process releases it automatically.

## Health and logs

```bash
docker ps --format "{{.Names}}: {{.Status}}"
docker inspect -f '{{.State.Health.Status}}' frigate-nvr
docker inspect -f '{{.State.Health.Status}}' lpr-service
docker inspect -f '{{.State.Health.Status}}' lpr-trainer
nvidia-smi
docker logs --tail 200 nvr-dashboard
docker logs --tail 200 auth-service
docker logs --tail 200 watchlist-api
docker logs --tail 200 config-api
docker logs --tail 200 lpr-service
docker logs --tail 200 lpr-trainer
```

For LPR delivery diagnosis, inspect the backlog without opening payload content:

```powershell
(Get-ChildItem -LiteralPath .\lpr-data\outbox\candidates -Filter *.json -ErrorAction SilentlyContinue).Count
Get-Content -Raw .\lpr-data\health\lpr.json
Get-Content -Raw .\lpr-model-store\health\lpr-trainer.json
```

An `lpr-service` unhealthy result means its heartbeat is stale, model readiness was not reached, or Frigate polling is currently failing. Check its logs and Frigate health before restarting it. A non-zero candidate backlog is safe during a Watchlist outage; do not delete the files. Once Watchlist and the service secret are available, the runtime replays at most 20 items per successful poll and removes each file only after API acceptance.

Functional checks:

- unauthenticated `/` redirects/renders login flow
- admin can open Settings/Users and mutate Watchlist
- regular user can read but cannot mutate Watchlist or invoke Config/restart
- logout clears the session cookie
- Federation fails outside approved trust path
- camera live/event/playback paths work through `/nvr/`

## Test and validation commands

Install service requirements in an isolated environment, then run:

```bash
cd auth-service
python -m pytest tests -q
cd ../watchlist-api
python -m unittest discover -s tests -v
cd ../config-api
python -m unittest discover -s tests -v
cd ../lpr-service
python -m unittest discover -s tests -v
cd ..
python -m unittest discover -s tests -p "test_p0_security.py" -v
node tests/browser-smoke.mjs
docker compose config --quiet
```

The browser smoke test requires Playwright and a compatible local Chromium. It serves the real `web/` directory on loopback with mock same-origin APIs and does not require production credentials/services.

Before deployment also run:

```bash
docker exec frigate-nvr python3 -m frigate --validate-config
```

## Reviewed LPR upgrade rollout

The 2026-08-19 LPR change is an upgrade of the existing sidecar. Do not start a training job during the initial rollout.

1. Back up `config/lpr/watchlist.db`, `lpr-data/`, and any existing `lpr-model-store/` outside the working tree.
2. Set both Discord and Telegram LPR credentials and verify `LPR_THAI_FONTS_DIR` points to the Windows Thai font directory.
3. Ensure the existing `LicensePlateRECOG/model/license_plate.pt` and `data_plate.pt` are present; the first serves as the fine-tuning parent and both remain runtime fallback.
4. Rebuild `watchlist-api`, `lpr`, and `lpr-trainer`; start Watchlist first so its idempotent schema migration finishes before the worker polls.
5. Promote the already-approved active administrator account to the unique superadministrator:

```bash
docker compose run --rm auth-service python manage.py promote-superadmin arm215
```

6. Recreate `auth-service` so new requests receive the current database role, then sign in as `arm215` and inspect **ตั้งค่าระบบ → การเรียนรู้ป้ายทะเบียน**.
7. Confirm historical administrator labels appear as confirmed and historical AI-only values appear as pending. Do not bulk-approve AI results.
8. Acceptance-test one example of each review answer. Verify unreadable creates only a positive detector example; verify non-plate requires a reason, removes only the crop, and leaves the event clip playable. Also open one legacy event with no candidate and confirm Review/teach AI remains available.
9. Acceptance-test an exact and partial Watchlist item: exact creates confirmed history; partial says possible match and creates no confirmed history.
10. Collect reviewed data until the threshold and all four coverage gates are met. The worker will then train/test automatically; a new version is not active until it passes and the runtime preloads both files.

Rollback from the UI queues a model-pair rollback and preserves the rejected/current version. If the upgraded services themselves fail before acceptance, stop `lpr-trainer` and restore the database/model-store backups; video recording remains owned by Frigate and must not be changed as part of LPR rollback.

## Backup scope

Back up outside Git:

- `.env` through an approved encrypted secret store
- `config/auth/` and `config/lpr/watchlist.db`
- Frigate database if event history matters
- `config/dashboard-settings/`, LPR runtime config and required model files
- TLS certificates according to PKI policy

Do not back up one-time plaintext credential handoff files as a convenience.

When changing Frigate volumes, preserve the nested tmpfs masks for `auth`, `certs`, `lpr`, `dashboard-settings` and `backups`, keep Frigate non-privileged, and retain `no-new-privileges`. A missing mask or privileged override can expose another service's sensitive host files even though environment variables remain scoped.

## TLS certificate (Let's Encrypt ผ่าน DuckDNS DNS-01)

ตั้งแต่ 2026-08-07 cert ของ `bpp215.duckdns.org` ออกโดย Let's Encrypt ผ่าน
container `acme-sh` (service `acme` ใน compose, daemon mode) ใช้ DNS-01 กับ
DuckDNS API (`DUCKDNS_TOKEN` ใน `.env`) — ไม่ต้องเปิดพอร์ตขาเข้าใดๆ

- ไฟล์ที่ nginx ใช้: `./config/certs/{fullchain,privkey}.pem` (mount :ro เข้า
  `nvr-dashboard`); state ของ ACME อยู่ `./config/acme/` (machine-local ห้าม commit)
### ต่ออายุอัตโนมัติเต็มรูปแบบ — ไม่มีขั้นตอนมือ (ตั้งแต่ 2026-08-07)

วงจรทำงานเองครบ 3 ทอด:

1. **acme-sh cron** (`supercronic` ใน container) รันวันละ 4 ครั้ง (00:41, 06:41,
   12:41, 18:41) → ถึงกำหนดจะต่ออายุเองผ่าน DNS-01 (Let's Encrypt ARI กำหนดวัน
   ให้ ~30 วันก่อนหมดอายุ)
2. **acme.sh copy cert ใหม่เอง** ลง `./config/certs/` (path ถูกจำไว้ใน
   `Le_RealFullChainPath`/`Le_RealKeyPath` ตอน `--install-cert` ครั้งแรก)
3. **nginx reload ตัวเอง** — hook `scripts/reload-nginx-on-cert-change.envsh`
   (mount เป็น `/docker-entrypoint.d/20-…`) เฝ้า checksum ของ `fullchain.pem`
   ทุก 1 ชม. เปลี่ยนเมื่อไหร่ก็ `nginx -t` แล้ว `nginx -s reload` ให้ทันที

> ทำไมต้องเฝ้าไฟล์แทนให้ acme สั่ง reload ตรงๆ: acme อยู่คนละ container จะสั่ง
> nginx ได้ต้อง mount Docker socket (เสี่ยง privilege escalation) หรือแชร์ PID
> namespace (ผูก lifecycle สองตัวเข้าด้วยกัน) — การเฝ้าไฟล์เลี่ยงทั้งสองอย่าง
> และ hook เป็น `.envsh` เพราะ bind mount บน Windows ไม่มี exec bit ที่
> entrypoint ต้องการสำหรับ `*.sh` (เหตุผลเดียวกับ hook federation ACL ข้างกัน)

ตรวจว่าระบบอัตโนมัติยังทำงาน:

```bash
docker exec nvr-dashboard ps -o args | grep sleep      # watcher ต้องมี sleep 3600
docker logs nvr-dashboard | grep cert-watch            # log ตอน reload อัตโนมัติ
docker exec acme-sh --list                             # คอลัมน์ Renew = วันต่ออายุถัดไป
```

ปรับความถี่ตรวจได้ด้วย env `CERT_WATCH_INTERVAL` (วินาที) ที่ service `dashboard`

- ตรวจ cert ที่เสิร์ฟจริง + วันหมดอายุ:

```bash
echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

- **สั่งต่ออายุเองทันที (ไม่ต้องรอ cron)** — ใช้เมื่ออยากทดสอบหรือกู้สถานการณ์;
  โควตา Let's Encrypt คือ 5 ใบซ้ำ/สัปดาห์ ต่อชุดโดเมนเดิม:

```bash
docker exec acme-sh --renew --force --ecc -d bpp215.duckdns.org
```

  เสร็จแล้ว **ไม่ต้อง reload เอง** — watcher จะ reload ให้ภายใน 1 ชม.
  (ยืนยันด้วย `docker logs nvr-dashboard | grep cert-watch`)

- ออกใหม่ทั้งหมดกรณี state หาย: `MSYS_NO_PATHCONV=1 docker exec acme-sh --issue --dns dns_duckdns -d bpp215.duckdns.org --server letsencrypt` แล้ว `MSYS_NO_PATHCONV=1 docker exec acme-sh --install-cert -d bpp215.duckdns.org --ecc --fullchain-file /certs-out/fullchain.pem --key-file /certs-out/privkey.pem`
  (ใน Git Bash ต้องมี `MSYS_NO_PATHCONV=1` ทุกครั้ง ไม่งั้น path `/certs-out` ถูกแปลงเป็น `C:/Program Files/Git/certs-out`)
  — `--install-cert` เป็นตัวลงทะเบียน path ปลายทางให้การต่ออายุรอบหน้า copy เองอัตโนมัติ

## Known validation limitation for this change

The 2026-07-23 hardening environment did not have a reachable Docker engine. Static/unit/browser tests and `docker compose config` can be run there, but nginx `-t`, image build, container startup and live end-to-end checks must be completed on a Docker-capable host before production deployment.

## Related

- [Current State](current-state.md)
- [Security Model](security-model.md)
- [Environment Variables](reference/environment-variables.md)
- [Troubleshooting](troubleshooting.md)
- [Camera Provisioning](features/camera-provisioning.md)

## IBM i2 Windows Bridge

1. Confirm IBM i2 Analyst's Notebook 9.2 is licensed for the Windows account and COM ProgID `LinkNotebook.Application.7` is registered.
2. Run `scripts/i2-bridge/install-i2-bridge.ps1` from that signed-in account. The installer registers a per-user logon task that launches `SysWOW64\WindowsPowerShell\v1.0\powershell.exe` and watches `runtime/i2-bridge`.
3. Keep the account signed in for automatic conversion. The dashboard queue may wait while signed out; after 24 hours the job becomes retryable.
4. If conversion fails, inspect only the PII-free status/error type in `runtime/i2-bridge/outbox`; use the dashboard Retry action. Do not delete the archived raw `.anb`.
5. Before Admin Apply, inspect Preview counts/warnings. Before rollback, inspect the rollback impact; raw/normalized files and shared dossier/CDR facts remain. A rolled-back reviewed import can be restored by Admin without uploading or converting the raw `.anb` again.

The scripts must remain UTF-8 with BOM for Windows PowerShell 5.1 Thai regex parsing. Use `-Once` for a safe empty-queue smoke test. Built-in IBM icons are mapped, not copied.

### Recovering a dossier merge

Every applied `services.dossier_merge` run publishes a directory below
`Backups/dossier-merges/`. To restore, stop `nas-bot`, verify the manifest's exact source/target IDs and
all SHA-256 values, replace only the canonical target with `target-before`, restore
`retired-live-source` to its original Dossiers source ID, and restore `dossiers_index.before.json`.
Start `nas-bot`, then verify source/target counts and graph output before accepting new ingestion. Never
restore by copying the whole NAS root or by deleting the backup directory.

### i2 upload does not send or remains processing

1. Confirm the browser loads `assets/i2-graph.js?v=12` or later and hard-refresh once after deployment.
2. Check nas-bot access logs for `POST /api/nas-bot/graph/import-i2`. No POST after file selection points
   to stale frontend assets or file-input handling. If dashboard logs show `/auth/verify` returning 413 while
   the import endpoint permits the file, verify that the internal verifier remains body-less and has the same
   `client_max_body_size 1g` limit as the exact upload route.
3. Compare `jobs/pending`, `jobs/processing`, and `outbox` without deleting files. Check the per-user
   `BPP i2 Analyst Bridge` task and the 32-bit `powershell`/`ANB` processes.
4. If the task ended but an ANB process still locks the exact bridge input, obtain explicit operator
   approval before closing that ANB process. Re-register `install-i2-bridge.ps1`, then start the task;
   startup recovery will requeue the interrupted descriptor automatically.
5. Verify the task remains Running, CPU/mtime progresses, no `.error.json` appears, and the import changes
   to `ready_preview`. Never delete the raw inbox/archive file to clear a stuck job.
