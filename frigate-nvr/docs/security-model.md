# Security Model

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-02
- **Evidence:** `dashboard-nginx.conf`, `docker-compose.yml`, `auth-service/`, `watchlist-api/`, `config-api/`, `web/`

## Release artifact security boundary

The multi-site migration TAR is intentionally unencrypted and may contain camera
credentials, password hashes, auth audit, Watchlist and NAS state. Keep it in a
private Drive location and on ACL-restricted Windows storage. Its SHA-256 companion
and internal manifest detect changed/incomplete bytes but do not authenticate the
publisher because no signing key is used.

The verifier rejects unsafe TAR paths, Git/worktrees, dependencies/caches, captured
runtime media, Frigate event DB, old JWT/session keys, one-time credentials,
source TLS/ACME and external integration credentials. Install creates independent
node, Compose, JWT, TLS and capability secrets; Federation/bot/public-edge fields
start empty.

Update archives own only manifest-listed release paths. Site environment, camera
config, node/TLS, Watchlist/NAS, media, local overlay and autostart are preserved.
Autostart is disabled during promotion and the previous release is restored on a
candidate failure. Development artifacts require an explicit override.

## Security objectives

- ไม่มี reusable default credential
- browser ไม่อ่าน session token ได้
- authorization บังคับที่ server ไม่ใช่แค่ซ่อนปุ่ม
- backend ไม่เชื่อ identity header จาก remote client
- Federation เปิดเผยข้อมูลขั้นต่ำและต้องผ่าน application + network/transport controls
- tracked source/config ไม่มี secret จริง
- persisted text ไม่กลายเป็น executable HTML

## Network trust boundary

Host publish ปัจจุบัน:

- `80/tcp`: redirect ไป TLS
- `443/tcp`: Dashboard/authenticated application gateway
- `8555/tcp+udp`: WebRTC media

Frigate `5000`, RTSP `8554`, auth `5002`, Watchlist `5001` และ Config `5003` อยู่ใน Compose network เท่านั้น ห้าม publish backend เหล่านี้โดยไม่มี threat review และ compensating controls

## Session and identity

Login สำเร็จตั้ง cookie `bpp_token`:

- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- session อายุ 12 ชั่วโมง

Browser JavaScript ได้เฉพาะ `{username, role}` จาก `/auth/session`; JWT ไม่อยู่ใน response body, `localStorage`, `sessionStorage` หรือ JavaScript-readable cookie

nginx forwards the browser cookie/Bearer only to auth-service and Config API's direct verifier. Watchlist/Federation/Frigate upstream requests receive empty `Cookie` and `Authorization` headers, preventing session credentials from spreading to services that do not consume them.

JWT ใช้ยืนยัน subject/expiry/issuer ส่วน role และ active state อ่านจาก SQLite ใหม่ทุก request ดังนั้น demote/deactivate/delete มีผลทันทีโดยไม่รอ token หมดอายุ

Auth startup fail closed หากไม่มี active admin และรักษา invariant ว่าต้องเหลือ active admin อย่างน้อยหนึ่งบัญชี

## Authorization matrix

| Resource/action | Required authority | Enforcement |
|---|---|---|
| Dashboard/Frigate operational reads | active user | nginx `auth_request` |
| Shared settings reads | active user | nginx `auth_request` |
| Settings mutations and sensitive settings reads | admin | nginx admin verifier |
| User/audit administration | admin | auth-service dependency |
| Config reads/mutations/status/restart | admin | nginx + config-api direct auth verification |
| Watchlist active reads/history/stats | active user | nginx + signed trusted identity |
| Watchlist create/update/delete/export/inactive list | admin | watchlist-api method-level RBAC |
| Watchlist history append | LPR service credential | watchlist-api service dependency |
| Federation export | approved peer | nginx ACL + Watchlist Federation verifier |
| Frigate config and restart gateway routes | admin | nginx admin verifier |

UI visibility is not an authorization control.

## Secure bootstrap and rotation

- ไม่มี username/password default ใน source, Compose หรือ `.env.example`
- `manage.py bootstrap-admin` ทำงานได้เฉพาะ DB ว่าง
- bootstrap และ password rotation สร้าง password แบบสุ่มตาม policy แล้วเขียน one-time file ด้วย exclusive create
- `replace-default-admin` สร้าง replacement admin และ disable legacy account ใน `BEGIN IMMEDIATE` transaction เดียว; output collision/DB failure rollback ทั้งสองสถานะ
- password ไม่พิมพ์ออก stdout และไม่บันทึกใน audit
- JWT file สร้าง/เก็บด้วย restrictive mode; `rotate-jwt-secret` ใช้ atomic replacement และ invalidate session ทั้งหมดหลัง restart
- password policy: 14–256 ตัวอักษร พร้อม upper/lower/digit
- failed login 5 ครั้งต่อ IP+username lock 15 นาที

### GUI provisioning and migration

The Windows installer accepts the selected administrator password and optional
migration password through redirected standard input, not command-line arguments,
environment variables, logs, or `.env`. The target management command only works
against an empty `auth-db` volume and atomically inserts the selected active admin
with any imported accounts.

The optional `.bppusers` file is AES-256-GCM authenticated and uses an
scrypt-derived key. It contains only usernames, bcrypt password hashes, roles, and
active state. It never contains plaintext passwords, JWT signing key, browser
sessions, audit records, or login-attempt state. A wrong migration password and a
modified file produce the same failure; the operator must keep the migration
password and handle/delete the encrypted export under the approved secret policy.

### Complete machine migration archive

`scripts/migrate-machine.ps1` is distinct from `.bppusers`: it can move the full
machine-local security state, including `.env`, JWT/TLS material, Docker databases,
camera credentials, Federation secrets and optionally recordings. It prompts for a
16+ character passphrase through `Read-Host -AsSecureString`, never accepts it via
parameters, and encrypts the archive with PBKDF2-derived AES-256-CBC plus
encrypt-then-HMAC-SHA-256. The archive header and ciphertext are authenticated
before any TAR extraction occurs.

This archive is therefore equivalent to a high-sensitivity secret backup. Transfer
it only through approved encrypted storage, restore only into a fresh empty host,
delete temporary copies after validation, and rotate any secrets required by local
policy. Restore recreates source-independent Windows ACLs through
`harden-windows-acl.ps1`; it does not transfer source host ACL identities or CUDA
cache. Operational commands are in [`operations.md`](operations.md).

ดูขั้นตอนที่ [`operations.md`](operations.md)

## Internal service credentials

ทุก shared secret ต้องสร้างอิสระและมีความยาวอย่างน้อย 32 bytes:

| Secret | สิทธิ์ |
|---|---|
| `AUTH_AUDIT_SHARED_SECRET` | ส่ง audit event เข้า auth-service |
| `WATCHLIST_PROXY_SHARED_SECRET` | ยืนยัน identity/assertion ที่ nginx สร้าง |
| `WATCHLIST_FEDERATION_SHARED_SECRET` | อ่าน Federation export |
| `WATCHLIST_SERVICE_SHARED_SECRET` | เพิ่ม Watchlist detection history |

ห้าม reuse secret ข้าม capability และต้อง rotate ทุก holder พร้อมกันใน maintenance window

Compose scope secrets ต่อ service; container ที่ประมวลผลวิดีโอไม่ได้รับ Auth/Watchlist secrets และ Dashboard ไม่ได้รับ camera/webhook credentials

Because Frigate needs `./config:/config`, Compose overlays tmpfs masks on these sensitive subpaths inside Frigate:

- `/config/auth`
- `/config/certs`
- `/config/acme`
- `/config/lpr`
- `/config/backups`
- `/config/dashboard-settings` — mounted read-only from the dedicated
  `config/dashboard-settings/storage-policy/` subdirectory instead of a blind tmpfs.
  That subdirectory holds only `storage_threshold`, so every sibling settings file
  (`channels.json`, `secrets.json`, …) stays invisible exactly as before, while the
  one value Frigate legitimately reads actually reaches it.

`/config/acme` was added on 2026-08-08 after an audit found the `/config/certs` mask
was bypassable: acme.sh stores the same TLS private key and its DuckDNS API token
under `config/acme/`, which was unmasked in both Frigate and config-api. A compromise
of either container yielded the production key (transparent MITM of every remote
session) and the DNS token (subdomain takeover). acme.sh mounts that directory at
`/acme.sh`, so masking it in the consumers costs nothing.

The same mask set applies to config-api, which also bind-mounts `./config`.

Frigate is not privileged and Compose enforces `no-new-privileges`, so it cannot bypass these masks by mounting over them. NVIDIA access comes from the explicit device reservation.

### Gateway route scoping

`/nvr/api/config` is gated by the admin check while the `/nvr/` catch-all accepts any
valid session. `/nvr/api/go2rtc` is therefore returned as 404 outright: Frigate's
go2rtc passthrough emits stream definitions with the camera credentials already
substituted, so any authenticated operator could have read every DVR RTSP password and
connected to the upstream directly, bypassing the dashboard and its audit trail. No
application code calls it — the dashboard uses the scrubbed
`/live/webrtc/api/streams`.

### Windows host ACL

`scripts/harden-windows-acl.ps1` replaces inherited/explicit DACLs recursively on:

- `.env`
- `config/auth`
- `config/backups`
- `config/certs`
- `config/lpr`
- `lpr-data`

Approved principals are SYSTEM, local Administrators, the invoking operator and any explicitly supplied service/operator principals. The script uses SIDs, refuses targets outside repository root, creates the backup directory when absent and verifies no unexpected/missing principal remains. This prevents another ordinary local account from bypassing container secret scoping by reading host files directly.

## Federation controls

Federation ต้องผ่านทุกชั้น:

1. TLS transport
2. exact GET route เท่านั้น
3. source อยู่ใน CIDR อย่างน้อยหนึ่งรายการจาก `BPP_FEDERATION_ALLOW_CIDR`;
   Dashboard แปลงรายการที่ตรวจสอบแล้วเป็น nginx `allow` แยกแต่ละ CIDR
4. peer มี `WATCHLIST_FEDERATION_SHARED_SECRET`
5. trusted proxy เพิ่ม `WATCHLIST_PROXY_SHARED_SECRET`
6. backend เห็น mTLS success หรือ VPN assertion จาก proxy

nginx ล้าง `X-BPP-*` assertions จาก client ก่อนสร้างค่าที่เชื่อถือได้ Backend ใช้ constant-time comparison และ fail closed เมื่อ secret หาย/สั้น

Federation response ไม่รวม owner, address, phone, criminal history, network, notes, IDs หรือ timestamps; ส่งเฉพาะ active `plate`, `plate_display`, `danger_level` และ `Cache-Control: no-store`

Current template ใช้ VPN CIDR assertion. ถ้าจะใช้ mTLS ต้องเพิ่ม certificate verification ที่ trusted proxy ก่อนส่ง `X-BPP-mTLS-Verified: SUCCESS`; ห้ามให้ remote client กำหนด assertion เอง

## Stored XSS controls

- API-originated strings ใช้ `createElement` + `textContent`
- ไม่มี inline executable script ใน `index.html`
- event handlers ใช้ `addEventListener` ไม่ประกอบ `onclick` จาก data
- URL path ที่มี identifier ใช้ encoding
- session cookie เป็น HttpOnly จึงไม่สามารถถูกอ่านโดย injected JavaScript

CSP ปัจจุบัน:

- script เฉพาะ same-origin และ CDN ที่ระบุ
- ไม่มี `'unsafe-inline'` หรือ `'unsafe-eval'` ใน `script-src`
- `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`
- inline style ยังอนุญาตชั่วคราวเพราะ UI เดิมพึ่ง style attributes

Browser smoke test ใส่ stored payload ลงหลาย Watchlist fields แล้วยืนยันว่าแสดงเป็นข้อความ ไม่สร้าง element/handler และไม่ execute

## CORS and CSRF

- same-origin gateway เป็น default; ไม่มี wildcard CORS
- Watchlist CORS ปิดเมื่อ `WATCHLIST_ALLOWED_ORIGINS` ว่าง
- ถ้าจำเป็นต้องใช้ cross-origin UI ให้ระบุ exact trusted HTTPS origins เท่านั้น
- browser write ไป Frigate ต้องคง CSRF header ตาม upstream contract
- SameSite cookie ช่วยลด CSRF แต่ไม่ใช่เหตุผลให้ตัด server authorization/method checks

## Secret storage and source control

Tracked `config/config.yml` อ้าง camera credential ผ่าน `{FRIGATE_*}` เท่านั้น

ห้าม commit:

- `.env`, secret/key/certificate private key และ one-time credential file
- URL ที่มี username/password จริง
- auth/watchlist/Frigate runtime DB
- models, recordings, LPR crops/logs และ generated dumps

Camera credential ที่เคยอยู่ใน tracked config ถูกย้ายออกแล้ว แต่ถือว่าค่าเดิมต้อง rotate ที่ upstream device/DVR; การย้ายไฟล์อย่างเดียวไม่ revoke credential

## Audit boundary

Auth-service audit endpoint ไม่รับ unauthenticated service event. Producer ต้องส่ง `AUTH_AUDIT_SHARED_SECRET`; Watchlist audit ใช้ username/IP หลัง trusted proxy identity ผ่านแล้ว

Audit failure ไม่ rollback Watchlist CRUD ใน implementation ปัจจุบัน จึงต้อง monitor auth-service availability และ logs แยกต่างหาก

## Residual risks and limitations

- Frigate internal `5000` และ Docker socket มี privilege สูง; compromise ของ container network/config-api ยังมี blast radius มาก
- Config API rejects literal/mixed URL credentials; authenticated userinfo is accepted only when both components are `{FRIGATE_*}` placeholders
- current nginx template ยังพึ่ง TLS files ที่ provision จากภายนอก
- inline style ใน CSP ยังเปิดอยู่
- live container/nginx validation ยังไม่ได้ทำใน hardening environment เพราะ Docker engine ไม่พร้อม
- external camera password rotation ยังต้องทำที่อุปกรณ์จริง

## Related

- [Operations](operations.md)
- [Architecture](architecture.md)
- [Environment Variables](reference/environment-variables.md)
- [Watchlist](features/watchlist.md)
- [Troubleshooting](troubleshooting.md)
