# Current System State

- **Status:** ACTIVE
- **Last reconciled:** 2026-09-04 (reconciled entrance cameras RTSP bridge, NGINX dynamic resolver, Cloudflare Named Tunnel, and runtime service list)
- **Evidence:** `config/config.yml`, `docker-compose.yml`, `dashboard-nginx.conf`, `scripts/rtsp_proxy.js`, `scripts/rtsp_bridge_watchdog.ps1`, `scripts/migrate-machine.ps1`, `auth-service/`, `watchlist-api/`, `config-api/`, `config-validator/`, `lpr-service/`, `nas-bot-service/`, `web/`, `.github/workflows/security-tests.yml`

## Multi-site release tooling (production package verified; target acceptance pending)

- `scripts/release/New-BppMigrationPackage.ps1` builds an unencrypted v1.0.0 TAR
  containing offline images, models, auth users/audit, Watchlist text state and NAS
  state while excluding captured media, Frigate DB, caches, Git and old node identity.
- Clone retains camera/NAS configuration with every camera/detect/record toggle off;
  NewSite has no source camera producers or credentials.
- Every target creates independent node, Compose, JWT, IP-SAN TLS and capability
  secrets. DuckDNS/ACME remain behind inactive `public-edge`; the initial URL is the
  new machine's LAN IP.
- Autostart runs after the selected Windows user logs in and waits for Docker Desktop;
  pre-login Docker Desktop WSL2 startup is not claimed.
- Self-contained semantic updates preserve site-owned state, roll back failed
  candidates and retain three successful rollback generations.
- Portable verification passes. The production v1.0.0 TAR was built from clean
  `main` commit `6ad5571`, fully extracted/rehash/scope-verified, and the 12 source
  services were restored with healthy config/GPU/HTTPS checks. First clean GPU
  target acceptance remains an external release gate and is not yet claimed.

Owner document: [`features/multi-site-releases.md`](features/multi-site-releases.md)

> เอกสารนี้เป็น snapshot ของ branch ปัจจุบัน ไม่ใช่หลักฐานว่า change ชุดนี้ deploy ไป production แล้ว

## Product and host baseline

- Product: **BPP PrerimWatch**
- Deployment brand: **BPP 215 / PRERIMWATCH**
- Platform provider: **Things Analytic Co., Ltd.**
- Production OS: Windows + Docker Desktop
- Production GPU: NVIDIA RTX 5060 Ti
- Frigate config schema: `0.17-0`
- Deploy ปัจจุบันยังเป็น manual `./deploy.sh`; self-hosted runner ต้องตรวจสถานะก่อนอ้างว่า auto-deploy ใช้งานได้
- Public Ingress: Cloudflare Named Tunnel ผ่านโดเมนหลัก `vms.local` เชื่อมต่อไปยัง `https://nvr-dashboard:443` ควบคู่กับ DuckDNS `bpp215.duckdns.org:8080` (fallback)

## Runtime topology

Compose branch นี้มี **17 services** (production acceptance of the new LPR worker is pending):

| Service | หน้าที่ | Host exposure |
|---|---|---|
| `frigate` | NVR, go2rtc, recording, object detection และ internal API | `8555/tcp+udp` สำหรับ WebRTC เท่านั้น |
| `media-compat-service` | สร้าง media response ที่เข้ากันได้กับ client และตรวจ health เทียบกับ Frigate | internal `5008`; ไม่ publish |
| `dashboard` | TLS reverse proxy (dynamic Docker DNS resolver `127.0.0.11`), auth gateway และ static application | `80` redirect ไป `443`; `443` เป็น application entry point |
| `auth-service` | login, HttpOnly session, user/RBAC และ audit | internal `5002`; ไม่ publish |
| `watchlist-api` | Watchlist CRUD, reviewed LPR candidates/reviews/dataset/jobs, history และ Federation export | internal `5001`; ไม่ publish |
| `lpr` | อ่านป้ายไทยเฉพาะในกรอบรถและส่งผล AI เป็น pending review | ไม่ publish |
| `lpr-trainer` | ส่ง reviewed alerts, ฝึก/ทดสอบ/เลื่อนรุ่นโมเดลและ rollback; ไม่เข้าถึงกล้อง | ไม่ publish |
| `config-api` | admin-only, crash-safe Camera/WebRTC config transaction; ไม่มี Docker control | internal `5003`; ไม่ publish |
| `config-validator` | validate candidate config ด้วย Frigate parser รุ่นเดียวกับ runtime | internal validation network; ไม่ publish |
| `nas-bot-service` | sync/สำรองไฟล์ไป NAS, Dossier Vault, i2 graph engine, auto-link network discovery | ไม่ publish |
| `analytics-engine` | รวบรวม/สรุปสถิติ event สำหรับหน้า analytics | ไม่ publish |
| `chat-service` | in-app chat ของ operator | ไม่ publish |
| `duckdns` | อัปเดต DDNS `bpp215.duckdns.org` ให้ชี้ public IP ปัจจุบัน | ไม่ publish; อยู่บน `wan-egress` |
| `cloudflared-tunnel` | Cloudflare Zero Trust Tunnel ขาเข้าสำหรับ `vms.local` | ไม่ publish; egress ไปยัง Cloudflare edge |
| `acme` | ออก/ต่ออายุ Let's Encrypt cert (DNS-01 ผ่าน DuckDNS) | ไม่ publish; อยู่บน `wan-egress` |
| `n8n-service` | workflow automation engine (MCP and webhook integration) | internal `5678`; ไม่ publish |
| `system-restarter` | dirty-worktree helper ที่เฝ้า `config/restart.trigger` และใช้ Docker socket restart services | ไม่ publish; เป็น pre-existing privileged operational gap นอกขอบเขต LPR |

Frigate HTTP `5000`, RTSP `8554` และ service APIs ไม่ได้ publish ออก host ใน Compose ปัจจุบัน
จึงไม่มี direct Frigate UI URL จาก host: Dashboard TLS `443` เป็น application entry point เดียว,
`80` ใช้ redirect เท่านั้น ส่วน WebRTC media ใช้ `8555/tcp+udp` โดยตรง

Production Windows autostart รัน `autostart-frigate.ps1` หลัง operator sign-in ผ่าน
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. สคริปต์รอ Docker Desktop
per-user engine, สั่ง `compose up -d`, คืน `frigate-nvr` เป็น `unless-stopped` และ
บันทึกจำนวน service ที่ยังไม่ Running ลง `autostart.log`.

### Pinned runtime/dependency baseline

- Frigate และ Config Validator base: `ghcr.io/blakeblackshear/frigate:0.17.2-tensorrt` + pinned manifest digest
- Dashboard: `nginx:1.29.8-alpine3.23` + pinned manifest digest
- Auth/Watchlist/Config Python base: `python:3.11.15-slim-bookworm` + pinned manifest digest
- LPR: Ultralytics CPU image pinned by digest
- Browser Chart.js: `4.5.1`
- Config API direct requirements are exact-version pinned
- Security-test CI pin Node `22.23.1`, Playwright `1.61.1` และ GitHub Actions releases

## Camera state

`config/config.yml` มี camera blocks **19 ตัว**:
- ชุด Nongwang (15 ตัว): `nongwang1`..`nongwang15`
- ชุดทางเข้ากองร้อย (4 ตัว): `D_BPP215_1`, `D_BPP215_2`, `D_BPP215_3`, `D_BPP215_4` (เครื่องบันทึก Imou Wireless Recorder `NVR1104HS-W-S2` IP `192.168.1.11:554` ผ่าน Native Node.js RTSP Proxy บนโฮสต์พอร์ต 8556 พร้อมระบบค้นหา NVR IP อัตโนมัติบน subnet `192.168.1.0/24:37777`; มีกล้องไร้สาย Imou Bullet 2C ติดตั้งจริง 3 ตัวบนช่อง 1-3 ส่วนช่อง 4 ยังไม่ได้เชื่อมต่อกล้อง)

- upstream ชุด Nongwang เป็น RTSP endpoint ชุด Nongwang
- credential ใน tracked YAML ใช้ `{FRIGATE_NONGWANG_USER}` และ `{FRIGATE_NONGWANG_PASS}`
- เปิดใช้งานจริง **8 ตัว** — Nongwang 5 ตัว (`nongwang1`, `nongwang3`, `nongwang4`, `nongwang5`, `nongwang6`) และ Entrance 3 ตัว (`D_BPP215_1`, `D_BPP215_2`, `D_BPP215_3`) มี `enabled`, `detect.enabled` และ `record.enabled` เป็น `true` ทั้งสามค่า และกำลังบันทึก/ตรวจจับอยู่จริง; ส่วน `D_BPP215_4` ปิดไว้เนื่องจากไม่มีกล้องเชื่อมต่อกับช่อง 4 ของ Imou NVR ป้องกัน FFmpeg crash loop
- เมื่อผู้ดูแลเปิดกล้องจาก Dashboard, Config API จะเปิด `record.enabled` พร้อม `enabled`; เมื่อปิดกล้อง ระบบจะปิด recording ด้วย
- CH01-CH16 เป็นช่องแสดงผลที่เปลี่ยนไปผูก NVR camera ตัวใดก็ได้; หลังบันทึก Dashboard โหลด mapping ส่วนกลางจากเซิร์ฟเวอร์กลับมาทุกครั้งที่เริ่มหน้าและใช้ browser storage เป็น fallback เท่านั้น
- go2rtc มี streams main + `_sub` + `_hd` ครอบคลุมกล้องทั้งหมดเพื่อรองรับการตรวจจับและดูเต็มจอ
- ⚠️ ข้อจำกัดที่ยังอยู่: `delete_camera` ของ config-api เคยไม่ล้าง `<name>_hd` — แก้แล้วเมื่อ 2026-08-08 แต่กล้องที่ถูกลบไปก่อนหน้านั้นอาจทิ้ง `_hd` ค้างไว้ ควรตรวจก่อนใช้ชื่อเดิมซ้ำ

ยังมี legacy credential variables `FRIGATE_DVR_*` และ optional `FRIGATE_CAM11_*` สำหรับ migration/stream เก่า แต่ไม่ได้เป็น camera block ใน baseline 15 ตัวนี้

## AI, recording and WebRTC

| รายการ | ค่าปัจจุบัน |
|---|---|
| Detector | ONNX, `yolo-generic` |
| Model | YOLO11m 640×640 |
| Model path | `/config/model_cache/yolo11m-640.onnx` |
| Model storage | machine-local, gitignored |
| Alert retention | 7 วัน, motion |
| Detection retention | 7 วัน, motion |
| Continuous/motion retention | 0 วัน (นโยบายเดิมไม่เปลี่ยน; Dashboard ใช้ recording ที่มีอยู่เป็น clip fallback เฉพาะช่วงเหตุการณ์) |
| Snapshot | เปิด, bounding box, retention 14 วัน |
| WebRTC candidates | `192.168.1.200:8555`, `127.0.0.1:8555`, `stun:8555` (อัปเดต 2026-08-07 — LAN IP จริงของเครื่อง) |
| การดูผ่าน internet | ✅ ใช้งานได้จริง — ผู้ใช้ forward UDP+TCP 8555 → `192.168.1.200` ที่ router แล้ว และยืนยันว่าดูวิดีโอผ่าน 4G นอก LAN ได้ (2026-08-08) |
| Stream encoding (nongwang×15) | main = `#video=copy` (HEVC ตรง — record ไม่กิน CPU), sub = `#video=h264#hardware` (NVENC — detect + tile บนเว็บ), `<cam>_hd` = main+NVENC on-demand สำหรับดูเต็มจอ (เว็บใช้ `ch.hd`) — เลิก libx264 software ทั้งหมด 2026-08-07 |
| TLS cert | Let's Encrypt `bpp215.duckdns.org` ออก/ต่ออายุโดย container `acme-sh` (DNS-01/DuckDNS) — nginx reload อัตโนมัติจาก cert-watch hook (ดู operations.md) |
| กล้องที่เพิ่มใหม่ผ่านหน้าเว็บ | config-api สร้าง stream ตาม pattern เดียวกับ `nongwang*` (main=copy, sub=NVENC, `_hd` on-demand) ตั้งแต่ 2026-08-07 — ดู [`features/camera-provisioning.md`](features/camera-provisioning.md#stream-encoding-template-2026-08-07) |

## Authentication and authorization baseline

- ไม่มี default admin หรือ default password ใน source/config
- role `superadmin` มีสิทธิ์ admin ทั้งหมดพร้อม gate แยกสำหรับตัดสิน LPR/ปรับเกณฑ์/rollback; มีได้หนึ่งชื่อที่กำหนดเป็น `arm215` และ promote ผ่าน local CLI เท่านั้น
- auth-service ปฏิเสธ startup หากไม่มี active administrator
- การ bootstrap/rotate password สร้าง credential แบบสุ่มและเขียนไป one-time file ที่สร้างแบบไม่ overwrite; ห้ามส่ง password ออก stdout
- installation เดิมใช้ `replace-default-admin` เพื่อสร้างชื่อ/password ใหม่และ disable legacy `admin` ใน SQLite transaction เดียว
- browser session อยู่ใน cookie `bpp_token` ที่ตั้ง `HttpOnly`, `Secure`, `SameSite=Strict`
- JavaScript ไม่เก็บ JWT ใน `localStorage`, `sessionStorage` หรือ cookie ที่อ่านได้
- role และ active state ถูกอ่านจาก auth database ทุก authenticated request

Server-side authorization ปัจจุบัน:

- Dashboard, Frigate reads, Watchlist reads/history และ LPR crops: authenticated user
- Shared settings reads: authenticated user; settings mutations/sensitive settings reads, user/audit management, Config API ทุก route, camera mutation, Watchlist mutation/export/inactive records และ Dashboard gateway `/nvr/api/restart`: admin
- Watchlist backend และ Config backend ตรวจ authorization ซ้ำ ไม่พึ่ง UI visibility หรือ header role จาก client
- nginx ส่ง browser cookie/Bearer ต่อเฉพาะ auth-service และ Config backend ที่ต้อง re-verify; ล้าง credentials ก่อน proxy ไป Watchlist, Federation และ Frigate

## Federation baseline

Federation Watchlist เป็น server-to-server endpoint แบบ fail closed:

1. peer เข้า exact route `GET /api/watchlist-federation` ผ่าน TLS
2. nginx จำกัด source ด้วยรายการ IPv4/IPv6 CIDR แบบ comma-separated ใน
   `BPP_FEDERATION_ALLOW_CIDR`; entrypoint ตรวจรูปแบบและสร้าง `allow` แยกต่อ CIDR
3. peer ส่ง `WATCHLIST_FEDERATION_SHARED_SECRET`
4. nginx ล้าง assertion จาก client แล้วเพิ่ม internal proxy secret และ VPN assertion
5. watchlist-api ตรวจ application secret, proxy secret และ mTLS **หรือ** VPN assertion
6. response ส่งเฉพาะ active `plate`, `plate_display`, `danger_level` และตั้ง `no-store`

Owner document: [`features/watchlist.md`](features/watchlist.md)

## LPR baseline

- `lpr-service` ใช้ vehicle event เป็น trigger แล้วสุ่ม mainstream `_hd` 1920×1080 สูงสุด 12 เฟรมเมื่อกล้องมีรถหนึ่ง spatial cluster (label ที่กรอบซ้อนกันนับเป็นรถเดียว) ให้คะแนนภาพและต้องมี readable consensus อย่างน้อย 2 เฟรมก่อนเขียนผล AI-pending เข้า Frigate; ถ้ามีรถหลาย cluster พร้อมกันจะ fallback ไป exact snapshot/event box
- Candidate ที่ส่ง Watchlist API ไม่สำเร็จถูกเขียนแบบ atomic ลง `lpr-data/outbox/candidates/` และ replay แบบ idempotent หลัง Frigate poll สำเร็จ จึงไม่หายเมื่อ API/secret ขัดข้องหรือ container restart
- `lpr` และ `lpr-trainer` มี Docker healthcheck จาก atomic heartbeat; runtime LPR ต้องทั้งโหลดโมเดลแล้วและ poll Frigate สำเร็จจึง healthy ส่วน trainer refresh heartbeat ระหว่าง training ที่ใช้เวลานาน
- production confidence baseline เป็น detector `0.35` และ character OCR `0.35` ตรงกันทั้ง source และ Compose
- รองรับหลายป้ายต่อ event และผูก candidate เดียวกับ vehicle/person events ที่สัมพันธ์กัน โดยไม่ใช้กรอบ person ตรวจป้าย
- สถานะ operational คือ ไม่พบ, พบแต่อ่านไม่ได้, อ่านได้บางส่วน, อ่านได้ครบ และรอตรวจ; ระบบไม่เดาตัวที่หาย
- โมเดล detector/character เดิมใน `LicensePlateRECOG/model/` ยังเป็น base/fallback; เพิ่ม contextual whole-line OCR สำหรับแถวทะเบียนและจังหวัด
- AI-only results เข้า `lpr_candidates` แบบ pending และไม่เขียน searchable Frigate/Watchlist history/ชุดฝึกจนคนยืนยัน
- admin ตรวจด้วยกรอบสี่มุม perspective; คำตอบขัดแย้งหยุด training และรอ `arm215` adjudicate
- รายการ legacy หรือป้ายที่ AI พลาดยังมีปุ่มเพิ่ม/สอน; ระบบสร้าง manual-review candidate แบบ idempotent ก่อนรับ crop ที่ผู้ดูแลยืนยัน
- candidate ที่ยังแก้ไขได้ทุกภาพแสดงทั้ง `ตรวจสอบ/สอน AI` และ `ไม่ใช่ป้าย/ลบและสอน AI`; ปุ่มแดงเปิดฟอร์ม non-plate ที่บังคับเลือกสาเหตุก่อนบันทึก ไม่ลบทันที
- การ์ดผล LPR แยกสถานะ/candidate/action ชัดเจน; ปุ่ม action เรียงแถวเดียวบน desktop, สองคอลัมน์เท่ากันบน tablet และซ้อนเต็มความกว้างบนโทรศัพท์โดยไม่เกิด horizontal overflow
- คลังเหตุการณ์หน้าเดิมมีตัวกรอง LPR สำหรับ AI รอตรวจ, partial, unreadable, confirmed, non-plate และ conflict พร้อม badge บนการ์ด; metadata นี้ admin-only และไม่เขียน placeholder ลง `recognized_license_plate`
- แท็บวิดีโอ LPR ลองเรียก MP4 แม้ list metadata ยังเป็น `has_clip=false`; candidate ที่เปิดผ่าน person event ใช้ primary vehicle event สำหรับเล่น/ดาวน์โหลด/แชร์. เมื่อ event MP4 เก่าหมดอายุ หน้าจอ desktop ตรวจ recordings ในเครื่องและตัดเฉพาะช่วงเหตุการณ์เป็น fallback; ถ้าไม่มี recording จริงจึงแสดงข้อความให้ลองใหม่/ไม่มีคลิป
- `พบแต่อ่านไม่ได้` เป็น detector-positive โดยไม่มี OCR label; non-plate บังคับเลือก reason, ลบเฉพาะ crop operational, เก็บ reason-coded restricted negative และไม่เปลี่ยน/ลบวิดีโอ
- exact Watchlist หลังคนยืนยันเท่านั้นจึงเป็น confirmed history; partial เป็น possible match เท่านั้น
- `lpr-trainer` เริ่มอัตโนมัติเมื่อ approved examples ครบค่า default 500 และ coverage gate, สร้าง synthetic Thai coverage, fine-tune รุ่นเดิม, ทดสอบ no-regression, promote คู่ detector/OCR แบบ atomic และเก็บหลายรุ่นให้ rollback
- Discord/Telegram ใช้ durable outbox สำหรับ reviewed Watchlist alerts และแจ้ง lifecycle ของ training/model
- production ใช้ reviewed LPR API/UI/runtime/trainer แล้วตั้งแต่ 2026-08-19; ยังไม่มี reviewed dataset ครบเกณฑ์ 500/coverage gate และยังไม่ได้สร้างหรือ promote โมเดลรุ่นใหม่จริง

## New-camp installation baseline

- `install_new_camp.exe` is a UAC-elevated Windows Forms wizard for the reviewed `installer/install_new_camp.ps1` worker; it is distributed only with a complete manifest-verified package
- the release package carries the reviewed detector `config/model_cache/yolo11m-640.onnx` plus the two LPR `.pt` files at `LicensePlateRECOG/model/`, never a copied `.env`, runtime database, recording, or legacy LPR source
- GUI installation copies the verified package to an operator-selected local folder, writes a deterministic path-derived `COMPOSE_PROJECT_NAME`, and creates a chosen Web Admin in its own empty `auth-db` volume
- an optional encrypted `.bppusers` export preserves username, bcrypt hash, role, and active state only; imported users retain their passwords but receive a new-machine JWT/session boundary
- the deployment and installer fail fast on package, build, startup, health, or credential-handoff failure

Owner document: [`features/installation-and-account-migration.md`](features/installation-and-account-migration.md)

## Complete-machine migration baseline

- `scripts/migrate-machine.ps1` exports/imports an encrypted, full BPP-VMS host
  snapshot without using `install_new_camp.exe`
- the snapshot retains application files, `.env`, config/certificates/models/LPR
  state, Docker `auth-db` and `frigate-db` volumes, and optionally recordings and
  Docker images; `cuda-cache` is intentionally excluded as hardware-specific
- an import requires a new empty destination, restores volumes before first start,
  re-applies Windows secret ACL hardening, waits for Frigate health, and validates
  the Frigate config
- the archive moves existing JWT/auth state as well as password hashes, so it is a
  high-sensitivity encrypted migration artifact rather than a general installer or
  routine backup; operators must update the target host/WebRTC IP after cutover

## Config persistence baseline

Config API:

- ตรวจ admin โดยส่ง cookie/Bearer เดิมไป auth-service โดยตรงและไม่เชื่อ `X-User`/`X-Role` จาก caller
- ทำหน้าที่แก้ config เท่านั้น: ไม่มี Docker socket, container restart หรือ status route
- serialize read-modify-write ด้วย interprocess file lock
- ส่ง serialized candidate ไป `config-validator` แบบ read-only/unprivileged ซึ่งใช้ parser จาก Frigate image รุ่นเดียวกับ runtime ก่อน persist; validator unavailable ตอบ `503` และ config ที่ไม่ผ่านตอบ `422`
- camera URL ต้องมี valid host และถ้ามี userinfo ทั้ง username/password ต้องเป็น `{FRIGATE_*}` placeholders; literal/mixed credentials ถูก reject ก่อน lock/backup
- ใช้ lock เดียวกันกับทุก read/write และ recovery, strict path allowlist, durable prepared/committed journal, `fsync` และ atomic `os.replace`
- สร้าง timestamped backup, retain ค่าเริ่มต้น 10 ชุดต่อไฟล์; backup directory ใช้ mode `0700` และ backup/journal ใช้ `0600`
- recover journal ก่อน read/write ทุกครั้งและ rollback coordinated YAML/JSON เมื่อ replacement ใดล้มหรือ process crash
- update/delete camera ล้าง main/sub stream ที่สัมพันธ์กับ camera นั้น; tracked baseline ไม่มี orphan stream
- native Frigate config route เป็น admin read-only; Config API เป็น writer เดียวเพื่อไม่ bypass transaction
- การ restart แยกออกจาก Config API: admin เรียก `/nvr/api/restart` ที่ Dashboard gateway ซึ่งส่งตรงไป Frigate internal API

Owner document: [`features/camera-provisioning.md`](features/camera-provisioning.md)

## Browser hardening baseline

- stored data จาก camera, user, Watchlist และ history ถูกสร้างด้วย DOM API/`textContent`
- CSP ไม่อนุญาต inline script หรือ `eval`
- nginx เพิ่ม HSTS, `nosniff`, frame/referrer/permissions headers
- Watchlist CORS ปิดโดย default; ถ้าจำเป็นต้องระบุ exact HTTPS origins

## Secrets and machine-local state

ห้าม commit:

- `.env`
- `config/auth/`, `config/certs/`, `config/lpr/`, `config/dashboard-settings/`
- credential one-time files และ JWT key
- camera/model credentials, private keys, webhook/token
- `config/model_cache/`, `LicensePlateRECOG/model/`
- runtime databases, `lpr-data/`, recordings และ generated dumps/logs

Compose ส่ง environment แบบแยก capability ต่อ service ไม่ใช้ broad `env_file`: Frigate ได้เฉพาะ camera/storage variables, Dashboard ได้ proxy/CIDR, Auth ได้ audit/cookie policy, Watchlist ได้ Watchlist/Audit secrets และ LPR ได้เฉพาะ LPR/Federation/history values

Frigate ยังต้อง bind `./config:/config` สำหรับ runtime ของตัวเอง แต่ไม่ได้ใช้ `privileged: true` และเปิด `no-new-privileges`. Compose ซ้อน tmpfs masks ที่ `/config/auth`, `/config/certs`, `/config/lpr`, `/config/dashboard-settings` และ `/config/backups` เพื่อไม่ให้ broad bind เปิด JWT/TLS/Watchlist/application backups ของ service อื่น

Windows host ACL hardening ถูก apply แบบ recursive กับ `.env`, `config/auth`, `config/backups`, `config/certs`, `config/lpr` และ `lpr-data`: เหลือ SYSTEM, local Administrators, approved operator/service principals เท่านั้น ไม่มี broad Authenticated Users/Builtin Users access. Operator script อยู่ที่ `scripts/harden-windows-acl.ps1`

## Person identity synchronization baseline (branch verified; production pending)

- Name-bearing dossier updates route through one same-root `IdentitySyncCoordinator`; mixed allowed
  dossier fields are included in the same plan rather than committed separately
- Officer-corrected dossier names carry `name_source=officer_correction` provenance and are preserved
  during later historical OCR ingestion; `sync-all` is not an identity repair operation
- `dossier_id`, `person_id`, dossier folders, case IDs, graph identities/edges and evidence artifacts
  remain unchanged while the display name propagates to the selected dossier/index, a uniquely proven
  Person record, proven Case suspect entries and exact stable-ID cached dossier links
- Resolution starts from the selected stable dossier and accepts only exact national ID, normalized
  phone, persisted person link or Person Registry source-case proof; multiple candidate Person records
  fail without writes and name similarity never authorizes a merge
- Coordinator writes are sibling-staged, flushed/fsynced, atomically promoted, read-back verified and
  restored to exact original bytes or absence when a failure can be rolled back
- Dossier, Person Registry and Case metadata writers share the coordinator's re-entrant transaction lock;
  historical-phone aliases remain internal exact-lookup keys and are excluded from the dossier-list API
- `repair_person_identity.py` defaults to read-only dry-run. Explicit `--apply` first publishes a
  recoverable backup of the exact in-lock plan's original JSON metadata, with root-relative manifest
  paths, existence flags and SHA-256 digests; evidence binaries are excluded
- Focused branch verification on 2026-08-26 passed Python compilation and all 53 NAS Bot tests.
  Browser smoke also passed both scenarios. See the session log for unrelated/environmental full-suite gaps
- **No production migration, production repair dry-run, production repair apply or deployment has run
  for this feature as of 2026-08-26**

## Validation status and known operational gaps

- 2026-08-20 LPR reject-action validation passes: Auth 34, Watchlist 19, LPR/training 27, Config Validator 2, JavaScript syntax, and 2 browser smoke scenarios including the real event-manager candidate path. Config API remains at the same unrelated 37/39 result; the root compatibility suite has unrelated release-tool/dirty-config failures documented below.
- 2026-08-20 responsive LPR action validation passes at 1600/700/390 px, including aligned/equal/full-width button sizing and no phone overflow. Live Dashboard serves `app.css?v=59`; HTTPS/nginx/GPU checks pass and Frigate identity/start/restart count remain unchanged.
- 2026-08-20 LPR primary-clip fix is live in `app.js?v=32`: production checks found recent Frigate MP4s present (`has_clip=true`, HTTP 200), browser regression proved stale-false/person-link fallback, and Dashboard-only recreation left Frigate identity/start/restart count unchanged and healthy.
- 2026-08-20 local-recording fallback: the Dashboard falls back from an unavailable event MP4 to a bounded local-recording clip; browser smoke covers that 404-to-recording path. It uses existing files and leaves the established retention policy unchanged; event windows with no recording remain unrecoverable.
- 2026-08-20 absent-recording diagnosis: the historical KK07 event at 2026-08-18 15:32:10 had `has_snapshot=true`, `has_clip=false`, and no indexed/raw recording segment for its event window. Dashboard `app.js?v=34` distinguishes this snapshot-only condition from a still-finalizing clip.
- 2026-08-20 snapshot-first LPR teaching: Dashboard `app.js?v=36` keeps historical snapshot-only events trainable with an ordinary draggable/resizable 64×20px-minimum rectangle, hides video-only controls when no MP4 exists, and avoids the obsolete legacy crop request that caused slow/broken thumbnails. It does not create missing historic video; a future evidence-capture change is required to guarantee a video asset for every new LPR event.
- 2026-08-20 event archive retention: active cameras retain complete alert/detection windows without a seven-day age cutoff. Frigate's existing patched StorageMaintainer safely reclaims the oldest recordings only when free space is below the administrator-controlled reserve (default 15%). Dashboard `app.js?v=37` filters the Event Archive by one camera or all cameras and one day or all retained days.
- 2026-08-20 fallback deployment recreated Frigate and Dashboard only: Frigate returned healthy, nginx/HTTPS checks passed, and live Dashboard serves `app.js?v=33`.
- 2026-08-19 reviewed-LPR validation passes: Auth 34, Watchlist 19, LPR/training 27, Config Validator 2, browser JavaScript syntax, and 2 browser smoke scenarios.
- Config API full suite currently passes 37/39; two pre-existing credential-validation tests fail because the dirty worktree's `config-api/api.py` writes `/config/restart.trigger` for literal URL credentials. Root suite passes 37, skips 1, and has 15 failures/errors from pre-existing tracked inline camera credentials/`env_file` plus unavailable PowerShell `Get-FileHash`. Those unrelated user-owned changes were not overwritten by this LPR task.
- Production Docker Compose accepted the current 15-service structure on 2026-08-19; scoped builds for `auth-service`, `watchlist-api`, `lpr`, and `lpr-trainer` completed and the new trainer started successfully. Older mojibake comments remain a source-quality cleanup item.

- Unit/security tests ครอบคลุม auth, server RBAC, Federation, Watchlist, crash/recovery config transaction, canonical validator และ LPR notification/history
- final rerun ผ่าน **88 Python/repository tests**: Auth 19, Watchlist 9, Config API 30, Config Validator 2, LPR 11 และ root security/repository 17
- browser smoke ผ่าน **2 scenarios** ด้วย `npm run test:browser`: ครอบคลุม admin/user UI RBAC, mock HttpOnly session invariant, stored XSS และ Config actions แบบ mock; ไม่ใช่ production TLS/nginx/real-cookie end-to-end
- `.github/workflows/security-tests.yml` รัน Python/repository และ browser jobs ด้วย dependency/action versions ที่ pin ไว้ แยกจาก deploy workflow; ยังไม่ถือเป็น deployment/merge gate เว้นแต่ตั้ง branch protection ให้ require check
- `docker compose config --quiet` ผ่านใน hardening session วันที่ 2026-07-23
- Live scoped deployment on 2026-08-19 validated image build, container startup, Dashboard-to-Watchlist health, live LPR candidate submission, GPU visibility, and stable Frigate health without restarting the recorder.
- Live scoped Dashboard recreation on 2026-08-20 served `app.js?v=31`, passed nginx syntax/HTTPS checks, and left the same healthy Frigate container, start time, and restart count unchanged.
- camera passwords ถูกย้ายออกจาก tracked config แล้ว แต่ password ของ upstream device ต้อง rotate ที่อุปกรณ์/DVR ภายนอกและอัปเดต `.env` ใน change window แยก
- GUI installer provisions a local self-signed TLS pair when no PEM files exist; replace it with approved PKI material for trusted production browser access, and bootstrap admin before Dashboard use
- legacy runtime administrator ถูก disable และ replacement credential ถูกสร้างเป็น one-time file บน disk; `auth-service` was recreated and `arm215` is the sole active `superadmin` after the 2026-08-19 LPR deployment.
- generated dumps/logs/test database variants/stale patch scripts ถูกล้าง และ ignore rules ครอบคลุม artifact patterns กับ local `.test-deps/`

## Related

- [Architecture](architecture.md)
- [Security Model](security-model.md)
- [Operations](operations.md)
- [Features](features/README.md)
- [Session 2026-07-23](sessions/2026-07-23-security-hardening.md)

## i2 link analysis baseline — nas-bot deployed

- Source implements connected-component grouping, weak area review, receiver-only exact phone/name parcel links without provisional people, audited manual links, per-account layouts, live refresh, and progressive canvas rendering.
- `.anb` upload/preview/apply/rollback and a 32-bit Windows licensed COM bridge are implemented. Runtime queue: `runtime/i2-bridge/`; archive: NAS `I2Imports/`.
- Limits: 1 GiB upload, 250,000 normalized nodes+edges, 250,000 saved layout positions, one Windows conversion at a time, 24-hour retryable timeout.
- RBAC: Officer/Admin/Superadmin may use the graph; Admin/Superadmin alone apply, restore, or roll back imports.
- `nas-bot-service` is pinned to `python:3.11.13-slim-bookworm` because the floating 3.11.16 slim runtime segfaulted in native `ssl/_hashlib` on this host.
- Compose/Nginx/Frigate configuration, focused tests, built-image `main` import, Windows PowerShell 5.1 parsing, empty-queue bridge execution, and a real 117,421,056-byte `.anb` conversion pass (2,544 nodes / 4,205 edges / zero warnings) pass. On 2026-08-27, `nas-bot` alone was recreated to correct runtime drift and attach the host `runtime/i2-bridge` bind mount; a real 117,421,056-byte upload then returned HTTP 200 and entered Windows bridge processing. Frigate and dashboard were not restarted.

## Dossier consolidation and parcel receiver precedence — deployed

- Web Chat and Telegram plain-text reports share the same parcel parser. For a Flash/PNO report,
  receiver name, phone, and address are authoritative person fields even when a titled sender appears
  first in the raw report. Structured parcel output no longer publishes sender name or sender phone;
  the original report remains in `raw_text`/case notes for evidentiary retention.
- The i2 graph continues to match parcels to existing dossiers only by exact normalized receiver phone
  or exact normalized full receiver name. Sender fields and unmatched receivers never create graph
  nodes or edges.
- On 2026-08-27 the live duplicate `ไม่ระบุชื่อ_2569` was recoverably consolidated into canonical
  `สุธิพล_สุขรินทร์_2569`. The canonical dossier retained its strong fields and now contains all three
  distinct evidence images. The source was retired from live Dossiers/index rather than deleted.
- Recovery material is under
  `Backups/dossier-merges/20260827T072601Z_ไม่ระบุชื่อ_2569_to_สุธิพล_สุขรินทร์_2569/`, including
  source-before, target-before, retired live source, original index, and the merge manifest.
- Post-deployment verification: 4 Chat parser tests and 13 dossier-merge/i2 tests passed; both services
  returned healthy/running, the graph contained one canonical node and zero old nodes, and no sender
  fields appeared in graph output.

## i2 upload interruption recovery — deployed 2026-08-27

- Dashboard serves `i2-graph.js?v=10`; same-file selection retries and drop-zone click propagation are
  fixed. HTTPS asset verification returned HTTP 200 with both safeguards present.
- Windows bridge startup now recovers abandoned processing descriptors under an exclusive queue lock.
- `BPP i2 Analyst Bridge` is registered with battery stop disabled, start-when-available enabled, zero
  execution limit, 999 one-minute restart attempts, and `IgnoreNew` concurrency.
- The interrupted production job `i2_cfb73f949e404d61a2016147348e38e1` retained its 117,421,056-byte
  source. After explicit approval, orphan ANB PID 8864 was closed; the corrected task started at 15:14
  local time, re-claimed the descriptor, and launched a new responsive ANB process without an error file.
- The recovered conversion completed at 16:01 local time and reconciled through the nas-bot API to
  `ready_preview`: 2,544 nodes, 4,205 edges, and zero warnings. The protected 117,421,056-byte archive
  and 4,975,151-byte `normalized-graph.json` both exist under the import ID. The import has not been
  applied to the shared graph; Admin/Superadmin review and Apply remain a separate intentional action.
- On 2026-08-27 the import was applied successfully and API verification returned 2,578 visible graph
  nodes and 4,232 edges, including all 2,544 imported nodes and 4,205 imported edges. Dashboard v11 now
  fits the viewport after Apply, on an explicit Reload, and when a saved layout predates the graph fingerprint;
  original i2 coordinates and operator-saved positions remain preserved.
- Regression verification: frontend/recovery contract 2/2, i2/dossier tests 13/13, JavaScript syntax,
  PowerShell 5.1 execution, Nginx syntax, HTTPS asset delivery, Compose/Frigate validation all pass.

## i2 authenticated upload and restore recovery — deployed 2026-08-27

- Dashboard logs traced a large-upload HTTP 500 to an internal `/auth/verify` 413 before the request
  reached `nas-bot`. The internal verifier now shares the exact import route's 1 GiB limit while keeping
  `proxy_pass_request_body off` and an empty forwarded `Content-Length`.
- A reviewed `rolled_back` import remains retained but hidden by design. Admin Restore makes the same
  normalized evidence visible again, records `restored_at`/`restored_by`, and does not re-upload or run
  the Windows COM converter.
- Deployment recreated dashboard with its auth/config dependencies to render the Nginx template, then
  recreated `nas-bot` alone to load Restore. Frigate was not restarted.

## i2 layout safety recovery — deployed 2026-08-27

- The former full rearrange control cleared the account's entire position map, then compressed thousands of
  disconnected components to the minimum zoom; fallback group labels overlapped even though graph evidence
  was unchanged. It is replaced by **จัดโหนดใหม่**, which affects unpositioned nodes only.
- Dashboard v13 adds explicitly confirmed **คืนผัง i2** to rebuild only the current account's display from
  imported source coordinates. Unnamed/small groups are not labelled at macro zoom, preventing repeated
  fallback labels from obscuring the graph.
- Validation: i2 layout/upload/recovery contract 6/6, i2/dossier 13/13, JavaScript syntax, Compose/Frigate,
  HTTPS asset delivery, container health, and GPU check passed. Dashboard alone was recreated; the i2 bridge
  task was restarted and remains Running with one 32-bit controller.
