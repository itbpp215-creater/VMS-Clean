# CLAUDE.md — BPP PrerimWatch

> เอกสารนี้เป็น **entry point สำหรับเริ่มทำงานกับ repo** ไม่ใช่ที่เก็บรายละเอียดทุกอย่าง
> สถานะปัจจุบันของระบบดูที่ [`docs/current-state.md`](docs/current-state.md)
> สารบัญเอกสารทั้งหมดดูที่ [`docs/README.md`](docs/README.md)

> ⚠️ **Repository นี้เป็น private — ห้ามทำเป็น public** เพราะมีรายละเอียดโครงสร้างระบบภายใน

---

## 1. System summary

ระบบนี้คือ **BPP PrerimWatch** โดยใช้แบรนด์ **BPP 215 / PRERIMWATCH** บนแพลตฟอร์ม **Ai CCTV Surveillance Platform** ของ Things Analytic และพัฒนาต่อยอดจาก Frigate NVR

องค์ประกอบหลัก:

- `frigate` — custom branded Frigate image สำหรับ video processing, event recording, snapshots และ AI detection
- `dashboard` — TLS/auth gateway + custom web application บน nginx พอร์ต `443` (`80` redirect)
- `auth-service` — login, HttpOnly session, users/RBAC และ audit
- `watchlist-api` — Watchlist, detection history และ minimized Federation export
- `config-api` — admin-only, crash-safe camera/WebRTC config transaction โดยไม่มี Docker control
- `config-validator` — isolated Frigate parser สำหรับ validate candidate config ก่อน persist
- `lpr` — sidecar อ่านป้ายไทย, notification และ Watchlist history
- `go2rtc` — stream gateway/restream ภายใน Frigate
- NVIDIA GPU — hardware decode และ ONNX object detection
- GitHub Actions + self-hosted runner — deploy ไป production เมื่อ `main` เปลี่ยน

Compose มี 13 services (`frigate`, `media-compat-service`, `dashboard`, `auth-service`,
`watchlist-api`, `lpr`, `config-api`, `config-validator`, `nas-bot`, `analytics-engine`,
`chat-service`, `duckdns`, `acme`); `go2rtc` ทำงานอยู่ภายใน `frigate`

Current production baseline และค่าปัจจุบันทั้งหมด: [`docs/current-state.md`](docs/current-state.md)

---

## 2. Critical current facts

### Production

- Windows + Docker Desktop
- NVIDIA RTX 5060 Ti
- Current WebRTC LAN candidate: `192.168.1.200:8555` (พร้อม `127.0.0.1:8555` และ `stun:8555`)
- Repo: `itbpp215-creater/VMS-215` — git root อยู่ที่ `D:\BPP-VMS` ไม่ใช่ `D:\BPP-VMS\frigate-nvr`
- ⚠️ Docker Desktop **Resource Saver ต้องปิดไว้เสมอ** — ถ้าเปิด มันจะหยุด WSL VM ตอน idle
  แล้วทั้ง stack ดับจนกว่าจะมีคนมาสั่งขึ้นเอง (`restart: unless-stopped` ช่วยไม่ได้
  เพราะ policy ทำงานแค่ในเอนจินที่ยังรันอยู่) เคยทำให้ระบบดับ 6.7 ชม.
  ดู `docs/troubleshooting.md` #22
- ⚠️ Auto-deploy ผ่าน CI **ยังใช้งานไม่ได้** — path ใน workflow แก้เป็น `D:/BPP-VMS/frigate-nvr` แล้ว (2026-07-16) แต่เครื่อง production ยังไม่มี self-hosted runner ลงทะเบียน/รันอยู่ (ดู `docs/troubleshooting.md` #13) — deploy ปัจจุบันเป็น manual `./deploy.sh`

### Camera

Current camera blocks: **15 ตัว** — `nongwang1`..`nongwang15` ตาม tracked `config/config.yml`; `nongwang11` remains disabled as a legacy compatibility entry.

- upstream credential อยู่ใน `.env` ผ่าน `FRIGATE_NONGWANG_USER/PASS`
- tracked `config/config.yml` ห้ามมี inline username/password
- go2rtc มี 45 streams = main + `_sub` + `_hd` ของทั้ง 15 cameras (`_hd` เพิ่มเมื่อ 2026-08-07
  ตอนเลิก software transcode — ห้ามลบทิ้งเพราะเข้าใจผิดว่าเป็น orphan)
- เปิดใช้งานจริง 5 ตัว: `nongwang1`, `nongwang3`, `nongwang4`, `nongwang5`, `nongwang6`
  (`enabled`/`detect`/`record` = true ทั้งสามค่า); อีก 10 ตัวปิดอยู่

`nongwang11` เป็น legacy compatibility entry ที่ปิดอยู่ใน baseline ปัจจุบัน หากเปิดกลับมา
**ห้ามเปลี่ยน FFmpeg RTMP wrapper กลับเป็น native `rtmp://` โดยไม่มี regression test**

### AI

Current detector baseline:

- `type: onnx`
- model type: `yolo-generic`
- **YOLO11m 640x640**
- model path: `/config/model_cache/yolo11m-640.onnx`
- model file เป็น machine-local และ gitignored

Current tracked objects:

- person
- car
- motorcycle
- truck (จำเป็นต่อ LPR — รถกระบะถูก YOLO จัดเป็น truck)
- bus

(`bicycle`, `dog`, `knife`, `backpack` เคยอยู่ในรายการนี้แต่ไม่มีใน `objects.track`
ของ config ปัจจุบันแล้ว — ตัดออกเมื่อ 2026-08-08 หลังตรวจกับระบบจริง)

### Recording

- continuous recording: disabled
- alerts retention: 7 days
- detections retention: 7 days
- snapshots: enabled, retain 14 days

### License plate recognition (LPR)

มี sidecar `lpr-service` อ่านป้ายทะเบียนไทยแบบ event-driven (poll Frigate events API
เฉพาะช่วงมี event รถ) แล้วเขียนผลกลับเป็น `recognized_license_plate`/`sub_label`
+ แจ้งเตือน Discord เมื่อตรงบัญชีต้องสงสัย

- โมเดล `.pt` สองตัวอยู่ `LicensePlateRECOG/model/` — **ทั้งโฟลเดอร์ gitignored**
  (โค้ดต้นแบบ `main.py` มี webhook token + credential กล้องฝังอยู่ ห้าม track)
- โค้ดที่ดูแลต่อคือ `lpr-service/` เท่านั้น — secret ทั้งหมดอยู่ `.env` (`LPR_*`)
- Discord/Telegram ใช้ worker แยก; Watchlist history ต้องใช้ service secret และ confidence จาก `best_score`
- Federation sync ใช้ HTTPS + secret จาก environment เท่านั้น
- ห้ามใช้ built-in LPR ของ Frigate กับป้ายไทย (dictionary ไม่มีอักษรไทย —
  ดู `docs/decisions/ADR-0005-thai-lpr-external-sidecar.md`)

รายละเอียด: [`docs/features/license-plate-recognition.md`](docs/features/license-plate-recognition.md)

### Storage protection

มี custom patch `patches/patch_storage_threshold.py`

ลำดับค่าที่ใช้:

1. dashboard runtime setting
2. `.env` `STORAGE_MIN_FREE_PERCENT`
3. default `15`

รายละเอียด: [`docs/features/storage-management.md`](docs/features/storage-management.md)

---

## 3. Non-negotiable guardrails

### File Access Rules

- กฎเกณฑ์ที่ว่าด้วยการจัดการสิทธิ์ การเข้าถึงไฟล์ และความลับของโปรเจกต์
- ห้าม Agent และ Developer ละเมิดกฎเหล่านี้เด็ดขาด เพื่อป้องกันความลับหลุดรอด
- อ่านกฎการเข้าถึงไฟล์โดยละเอียดได้ที่: [`docs/file-access-rules.md`](docs/file-access-rules.md)

### Config ownership

`config/config.yml` เป็น git-managed

- แก้ผ่าน Git
- browser mutation ต้องผ่าน admin-only Config API transaction เท่านั้น; native Frigate config route เป็น read-only
- Config API ยอม URL userinfo เฉพาะ username/password แบบ `{FRIGATE_*}` placeholders และ reject literal/mixed credentials
- production deploy ใช้ `git reset --hard`
- production working tree สำหรับ tracked files ถือว่า disposable
- ห้ามเก็บ unpushed work ไว้เฉพาะเครื่อง production

### Secrets

ห้าม commit:

- `.env`
- password/token/credential จริง
- camera URL ที่มี credential จริง
- model files
- runtime database
- recordings

ทุก `{FRIGATE_*}` ที่ `config/config.yml` อ้างถึงต้องมี key ใน `.env`

ห้ามมี default admin/password ใน source/config; installation ใหม่ต้องใช้
`auth-service/manage.py bootstrap-admin` และลบ one-time credential file หลัง handoff

Shared secrets ต่อไปนี้ต้องสุ่มอิสระอย่างน้อย 32 bytes และห้าม reuse ข้าม capability:

- `AUTH_AUDIT_SHARED_SECRET`
- `WATCHLIST_PROXY_SHARED_SECRET`
- `WATCHLIST_FEDERATION_SHARED_SECRET`
- `WATCHLIST_SERVICE_SHARED_SECRET`

Frigate bind `./config` แต่ต้องคงสถานะ non-privileged + `no-new-privileges`;
ห้ามลบ nested tmpfs masks ของ `auth`, `certs`, `lpr`, `dashboard-settings`,
`backups` เพราะจะเปิดไฟล์ของ service อื่นให้ Frigate อ่าน

บน Windows ต้องรัน `scripts/harden-windows-acl.ps1` เพื่อจำกัด `.env`,
auth/backups/certs/LPR state และ `lpr-data` ให้เฉพาะ SYSTEM, Administrators
และ approved operator/service principals; ห้ามแก้ permission ด้วย broad Users group

### Network security

- Application HTTP ต้องเข้าทาง Dashboard TLS `443`; port `80` redirect เท่านั้น
- Frigate HTTP `5000`, RTSP `8554`, Auth `5002`, Watchlist `5001` และ Config `5003` อยู่ internal Compose network
- ห้าม publish direct Frigate UI/API; host เปิดตรงเฉพาะ WebRTC media `8555/tcp+udp`
- Dashboard proxy `/nvr/` ไป Frigate backend และใช้ server-side `auth_request`
- ห้ามเปิด wildcard CORS ให้ backend
- อย่า publish backend ports โดยไม่มี threat review/auth ที่เหมาะสม
- Settings, Config, Watchlist mutation/export/inactive records และ Frigate config/restart ต้องเป็น admin ที่ server
- Federation ต้องมี application secret + proxy secret + VPN CIDR หรือ trusted mTLS assertion และส่งออกเฉพาะข้อมูลขั้นต่ำ
- Browser session ต้องคง `HttpOnly`, `Secure`, `SameSite=Strict`; JavaScript ห้ามเก็บ JWT
- nginx ต้องล้าง browser Cookie/Authorization ก่อน proxy ไป Frigate, Watchlist และ Federation; ส่งต่อเฉพาะ Auth/Config ที่ต้อง verify
- browser non-GET writes ต้องมี CSRF header ที่ Frigate ต้องการ

รายละเอียด: [`docs/security-model.md`](docs/security-model.md)

### GPU/runtime

- อย่าลบ `cuda-cache` volume โดยไม่จำเป็น
- เครื่องใหม่ต้อง provision ONNX model ก่อน start detector
- GPU lost ระดับ host ต้องตรวจ `nvidia-smi` และอาจต้อง reboot Windows

### Deployment

- งานทดลองหรือ refactor ควรทำบน branch แยก
- merge เข้า `main` เมื่อ review/validate แล้ว
- Markdown และ `docs/**` ถูก CI ignore เพื่อไม่ restart production จากการแก้เอกสารอย่างเดียว

### Core Business Logic

- ห้ามแก้ไข เปลี่ยนแปลง หรือลบล้าง Business Logic หลักของระบบ (AI, Main/Sub Stream, Camera Toggling, Grouping, Federation, LPR) ยกเว้นจะได้รับอนุญาตอย่างเป็นทางการ
- ทุกครั้งที่แก้โค้ดจะต้องยึดตามหลักการเหล่านี้เสมอ
- อ่านกฎและข้อบังคับโดยละเอียดได้ที่: [`docs/core-business-logic.md`](docs/core-business-logic.md)

---

## 4. Quick commands

### First setup

```bash
git clone https://github.com/itbpp215-creater/VMS-215.git
cd VMS-215/frigate-nvr
cp .env.example .env
# ใส่ secret แบบสุ่มอิสระ, camera credentials, TLS certs และ provision models
docker compose run --rm auth-service python manage.py bootstrap-admin <username> \
  --output-file /data/admin-credential.once
# เก็บ credential ใน approved store แล้วลบ one-time file หลัง verify
docker compose build
docker compose up -d
```

### Standard deploy

```bash
./deploy.sh
```

### Validate config

```bash
docker exec frigate-nvr python3 -m frigate --validate-config
```

### Automated security/regression tests

```bash
PYTHONPATH=auth-service python -m pytest -q auth-service/tests
python -m unittest discover -s watchlist-api/tests -v
PYTHONPATH=config-api python -m pytest -q config-api/tests
python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
npm ci
npm run test:browser
```

Baseline ที่ reconcile วันที่ 2026-07-23 คือ 88 Python/repository tests
(Auth 19, Watchlist 9, Config API 30, Config Validator 2, LPR 11, root 17)
และ browser smoke 2 scenarios. Workflow `.github/workflows/security-tests.yml`
pin Node `22.23.1` และ Playwright `1.61.1`; workflow นี้แยกจาก deploy และจะเป็น merge gate
ต่อเมื่อ repository ตั้ง branch protection ให้ require check นี้

### Health

```bash
docker inspect -f '{{.State.Health.Status}}' frigate-nvr
docker ps --format "{{.Names}}: {{.Status}}"
nvidia-smi
```

รายละเอียด operations: [`docs/operations.md`](docs/operations.md)

---

## 5. Important file map

| Path | Responsibility |
|---|---|
| `docker-compose.yml` | runtime services, volumes, ports, GPU reservation |
| `Dockerfile` | custom Frigate image, branding, storage patch |
| `config/config.yml` | Frigate/go2rtc/detector/camera config |
| `deploy.sh` | deployment guard, build, restart, dashboard recreate, health wait |
| `.github/workflows/deploy.yml` | self-hosted production deployment |
| `.github/workflows/security-tests.yml` | pinned Python/repository and browser security tests |
| `dashboard-nginx.conf` | TLS/auth gateway, RBAC routes, CSP, Federation ACL และ proxies |
| `web/` | custom application UI |
| `auth-service/` | secure bootstrap, session, server RBAC, users และ audit |
| `watchlist-api/` | Watchlist/history/Federation backend |
| `config-api/` | authorized crash-safe config transaction; ไม่มี Docker socket/restart/status |
| `config-validator/` | isolated read-only Frigate config validation service |
| `lpr-service/` | Thai LPR sidecar (event-driven, คู่กับ Frigate events API) |
| `tests/` | repository security invariants + browser smoke |
| `patches/` | custom patches applied to Frigate image |
| `branding/` | custom branding assets and patch scripts |
| `docs/` | project knowledge base |

---

## 6. Documentation map

### Read first

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/current-state.md`](docs/current-state.md) — current system snapshot

### Understand the system

- [`docs/file-access-rules.md`](docs/file-access-rules.md) — **FILE ACCESS RULES: ห้ามละเมิดการเข้าถึงไฟล์และความลับเด็ดขาด**
- [`docs/core-business-logic.md`](docs/core-business-logic.md) — **CORE INVARIANTS: ห้ามละเมิด Business Logic เด็ดขาด**
- [`docs/architecture.md`](docs/architecture.md) — components and data flow
- [`docs/features/README.md`](docs/features/README.md) — feature behavior
- [`docs/security-model.md`](docs/security-model.md) — trust boundary, secrets, CSRF และ exposure

### Operate and deploy

- [`docs/operations.md`](docs/operations.md)
- [`docs/reference/frigate-configuration.md`](docs/reference/frigate-configuration.md)

### Debug known problems

- [`docs/troubleshooting.md`](docs/troubleshooting.md)

### Understand evolution

- [`docs/history.md`](docs/history.md)
- [`docs/sessions/README.md`](docs/sessions/README.md)

### Understand decisions

- [`docs/decisions/README.md`](docs/decisions/README.md)

### Keep documentation healthy

- [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## 7. Source-of-truth policy

เมื่อข้อมูลขัดแย้งกัน ให้ใช้ลำดับนี้:

1. code/config บน branch ที่กำลังใช้งาน
2. `docs/current-state.md`
3. เอกสารเฉพาะเรื่อง
4. ADR สำหรับเหตุผลของ decision
5. session logs / history / old notes

**อย่าแก้โค้ดให้ตรงเอกสารเก่าโดยอัตโนมัติ** ให้ตรวจ intent ของ current code ก่อน แล้วอัปเดตเอกสารตามความจริง

---

## 8. Documentation rule for future development

เมื่อพัฒนาเพิ่ม:

- current state เปลี่ยน -> update `docs/current-state.md`
- architecture/data flow เปลี่ยน -> update `docs/architecture.md`
- feature behavior เปลี่ยน -> update owner document ใน `docs/features/`
- security boundary/secret/CSRF เปลี่ยน -> update `docs/security-model.md`
- deploy/operation เปลี่ยน -> update `docs/operations.md`
- config convention เปลี่ยน -> update `docs/reference/`
- พบ incident ที่อาจเกิดซ้ำ -> update `docs/troubleshooting.md`
- มี decision สำคัญ -> create ADR ใน `docs/decisions/`
- มี development context สำคัญ -> create session log ใน `docs/sessions/`

เป้าหมายคือให้ `CLAUDE.md` คงเป็น entry point ที่อ่านเร็ว ส่วนรายละเอียดเติบโตออกไปเป็นเอกสารที่มี owner และหน้าที่ชัดเจน

---

## 9. Mandatory documentation completion rule

> **งานพัฒนาโปรแกรมยังไม่ถือว่าเสร็จ จนกว่าจะอัปเดตเอกสาร `.md` ที่ได้รับผลกระทบเรียบร้อยแล้ว**

กฎนี้ใช้กับทุกงานที่เปลี่ยน source code, configuration, runtime behavior, UI behavior, deployment, security, integration, AI model, camera flow, storage behavior หรือ operational procedure

หลังเขียนโปรแกรมหรือแก้ระบบเสร็จ **ทุกครั้ง** ต้องทำ Documentation Review ก่อน commit/merge โดยตรวจการเปลี่ยนแปลงจริงจาก diff แล้วบันทึกความรู้ลงเอกสารตามโครงสร้างนี้

### 9.1 Required post-development workflow

ทำตามลำดับต่อไปนี้:

1. ตรวจ `git diff` / changed files และสรุปว่า behavior ใดเปลี่ยนจริง
2. ระบุเอกสาร owner ของแต่ละการเปลี่ยนแปลงจากตารางด้านล่าง
3. อัปเดตเอกสาร canonical ให้ตรงกับ code/config ปัจจุบัน
4. ถ้ามีเหตุผลเชิงสถาปัตยกรรมหรือ trade-off สำคัญ ให้สร้าง/อัปเดต ADR
5. ถ้าพบปัญหาและวิธีแก้ที่อาจเกิดซ้ำ ให้เพิ่ม `troubleshooting.md`
6. บันทึก session log เมื่อเป็นงานพัฒนา การแก้ปัญหา หรือการเปลี่ยนแปลงที่มีบริบทสำคัญ
7. ตรวจลิงก์เอกสารและตรวจว่าไม่มี secret/credential จริงหลุดเข้า Markdown
8. จึงถือว่างานพร้อม commit, review, merge หรือ handoff

### 9.2 Documentation update matrix

| การเปลี่ยนแปลงหลังพัฒนา | เอกสารที่ต้องตรวจและอัปเดต |
|---|---|
| Production host, IP, GPU, model, camera, port, service หรือ runtime dependency | `docs/current-state.md` |
| Component, data flow, trust boundary หรือ architecture | `docs/architecture.md` |
| พฤติกรรมของ feature หรือ UI | owner document ใน `docs/features/` |
| Feature ใหม่ที่ซับซ้อนและยังไม่มี owner document | สร้าง `docs/features/<feature-name>.md` และเพิ่มลิงก์ใน `docs/features/README.md` กับ `docs/README.md` |
| Install, deploy, startup, health check, maintenance หรือ recovery procedure | `docs/operations.md` |
| Security, secret, credential, network exposure, auth หรือ CSRF | `docs/security-model.md` |
| Config syntax, convention, schema หรือ integration reference | เอกสารที่เหมาะสมใน `docs/reference/` |
| Bug/incident ที่อาจเกิดซ้ำ พร้อม root cause หรือวิธีแก้ | `docs/troubleshooting.md` |
| Milestone หรือเหตุการณ์ที่มีผลระดับระบบ | `docs/history.md` |
| การตัดสินใจสำคัญที่อนาคตอาจถามว่า “ทำไมทำแบบนี้” | `docs/decisions/ADR-XXXX-*.md` |
| บริบทการทำงาน การทดลอง ลำดับ debug ผล validation และงานค้าง | `docs/sessions/` |
| เพิ่ม/ย้าย/เปลี่ยนโครงเอกสาร | `docs/README.md` และ `docs/documentation-guide.md` |
| Critical fact หรือ guardrail ที่คนเริ่มงานต้องรู้ทันที | `CLAUDE.md` โดยเก็บเฉพาะสรุปและลิงก์ไปเอกสารรายละเอียด |

### 9.3 Minimum record for every completed development task

สำหรับงานที่มีการแก้ code/config จริง อย่างน้อยต้องมีหลักฐานครบดังนี้:

- **What changed** — เปลี่ยนอะไร
- **Why** — เหตุผลหรือ requirement
- **Behavior now** — หลังแก้แล้วระบบทำงานอย่างไร
- **Validation** — ทดสอบอะไรและผลเป็นอย่างไร
- **Operational impact** — ต้อง deploy/restart/migrate/provision อะไรหรือไม่
- **Risk / limitation** — มีข้อจำกัดหรือความเสี่ยงอะไร
- **Documentation impact** — อัปเดตเอกสารใดแล้ว

ข้อมูลเหล่านี้อาจกระจายอยู่ใน canonical document + ADR + troubleshooting + session log ตามหน้าที่ของแต่ละเอกสาร ไม่จำเป็นต้องคัดลอกเนื้อหาเดียวกันทุกไฟล์

### 9.4 Session log rule

เมื่อเป็นงานพัฒนาที่มีการเปลี่ยน behavior, feature, config, architecture, deployment หรือมีการ debug ที่มีสาระสำคัญ ให้สร้างหรืออัปเดต session log ใน `docs/sessions/`

Session log ต้องเก็บอย่างน้อย:

- goal
- starting state / branch หรือ commit ที่เกี่ยวข้อง
- work performed
- decisions
- problems found
- validation
- files changed ที่สำคัญ
- remaining work
- documentation impact

Session log เป็น historical record และ **ห้ามใช้แทน** `current-state.md` หรือ feature documentation

### 9.5 Canonical documentation must be updated, not only session logs

ห้ามทำเพียงเขียน session log แล้วจบ หากการเปลี่ยนแปลงมีผลต่อสถานะหรือ behavior ปัจจุบัน

ตัวอย่าง:

- เพิ่ม Playback feature -> update `docs/features/playback.md` และ session log
- เปลี่ยน YOLO model -> update `docs/current-state.md`, `docs/architecture.md`, `docs/features/object-detection.md`, ADR ถ้ามี decision สำคัญ และ session log
- แก้ production incident -> update `docs/troubleshooting.md`, `docs/history.md` ถ้าสำคัญ และ session log
- เปลี่ยน deployment -> update `docs/operations.md`, `docs/current-state.md`/`docs/architecture.md` ตามผลกระทบ, ADR และ session log

### 9.6 No-document-impact is an explicit conclusion

ถ้าตรวจแล้วการแก้ code ไม่มีผลต่อ current behavior, architecture, operations, security, public feature behavior หรือ knowledge ที่ควรเก็บ สามารถไม่แก้ canonical document ได้ **แต่ต้องเป็นข้อสรุปจากการตรวจ ไม่ใช่การข้ามขั้นตอนโดยอัตโนมัติ**

สำหรับงานเล็กมาก เช่น typo/comment/internal refactor ที่ behavior ไม่เปลี่ยน อาจไม่ต้องสร้าง session log ใหม่ แต่ยังต้องตรวจ documentation impact ก่อนถือว่างานเสร็จ

### 9.7 Documentation Definition of Done

ก่อนประกาศว่างานเสร็จ ให้ตอบคำถามต่อไปนี้ครบ:

- [ ] Code/config ที่เปลี่ยนผ่าน validation/test ที่เหมาะสมแล้วหรือไม่
- [ ] `docs/current-state.md` ยังตรงกับระบบหรือไม่
- [ ] Architecture/data flow เปลี่ยนหรือไม่ และอัปเดตแล้วหรือไม่
- [ ] Feature owner document ตรงกับ behavior ใหม่หรือไม่
- [ ] Operations/security/reference ได้รับผลกระทบหรือไม่
- [ ] มี incident knowledge ที่ควรเพิ่ม troubleshooting หรือไม่
- [ ] มี decision ที่ควรสร้าง ADR หรือไม่
- [ ] มี session context ที่ควรบันทึกหรือไม่
- [ ] Documentation index/link ต้องอัปเดตหรือไม่
- [ ] ไม่มี secret หรือ credential จริงในเอกสารหรือไม่

**ถ้ายังมีข้อที่ควรทำแต่ยังไม่ทำ งานยังไม่ถือว่า complete**

รายละเอียดเพิ่มเติมและกติกาการดูแลเอกสาร: [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## 10. Mandatory source-code commenting rule

> **ไม่ว่าจะเป็นมนุษย์หรือ AI Agent งานเขียนหรือแก้ Source Code ยังไม่ถือว่าเสร็จ จนกว่าโค้ดที่เพิ่มหรือปรับแก้จะมี Comment อธิบายครบตามกฎนี้**

กฎนี้ใช้กับ Source Code ที่โครงการควบคุมเองทั้งหมด เช่น JavaScript, HTML, CSS, Python, Shell, PowerShell, Dockerfile และภาษาอื่นที่เพิ่มในอนาคต

### 10.1 Who must follow this rule

กฎนี้บังคับใช้กับทุกผู้ที่แก้โค้ดโดยไม่มีข้อยกเว้นตามตัวผู้เขียน:

- Developer / Engineer
- Maintainer / Reviewer
- Claude Code หรือ AI Agent อื่น
- Code generator ที่สร้างโค้ดซึ่งทีมจะนำมาแก้ไขและดูแลต่อ

### 10.2 Every new or modified function must be documented

ทุก function, method, handler, callback, class, module-level routine หรือ reusable logic ที่สร้างใหม่หรือมีการแก้ไข ต้องมี Comment หรือ Docstring อธิบายอย่างน้อย:

- หน้าที่และวัตถุประสงค์ของโค้ด
- input หรือ parameter สำคัญ
- output / return value ถ้ามี
- side effect เช่น การเขียน config, restart service, เปลี่ยน state, เขียนไฟล์ หรือเรียก API
- assumption, invariant หรือข้อจำกัดที่สำคัญ
- เหตุผลของ workaround หรือ behavior ที่อาจดูไม่ปกติ

### 10.3 Every changed section and changed line must be explained in source

ทุกส่วนและทุกบรรทัดที่เพิ่มหรือปรับแก้ต้องอยู่ภายใต้ Comment ที่อธิบายความหมายของการเปลี่ยนแปลงนั้นใน Source Code

วิธีปฏิบัติ:

- บรรทัดที่ต้องการเหตุผลเฉพาะ ให้ใส่ inline comment หรือ comment ใกล้บรรทัดนั้น
- หลายบรรทัดต่อเนื่องที่ทำหน้าที่เดียวกัน สามารถใช้ block comment หนึ่งจุดอธิบายทั้ง block ได้ แต่ Comment ต้องครอบคลุมเจตนาและ behavior ของทุกบรรทัดใน block นั้นอย่างชัดเจน
- ห้ามปล่อย logic ที่แก้ใหม่โดยไม่มี comment อธิบายเพียงเพราะชื่อ function หรือตัวแปรดูเหมือนเข้าใจได้เอง
- ถ้ามีการแก้ behavior เดิม ต้องแก้ Comment เดิมให้ตรงกับ behavior ใหม่ด้วย

ดังนั้นคำว่า “ทุกบรรทัดต้องมี Comment” ในโครงการนี้หมายถึง **ทุกบรรทัดที่เพิ่มหรือแก้ต้องมีคำอธิบายที่ตามรอยได้ในบรรทัดนั้นหรือ block comment ที่ครอบคลุมโดยตรง** ไม่จำเป็นต้องเขียน comment ซ้ำแบบหนึ่ง comment ต่อหนึ่งบรรทัดเมื่อหลายบรรทัดเป็น logic เดียวกัน

### 10.4 Comment quality requirements

Comment ต้องอธิบาย **why / intent / constraint / behavior** ไม่ใช่เพียงแปล syntax เป็นภาษาคน

ตัวอย่างที่ไม่เพียงพอ:

```js
// เพิ่มค่า 1
count += 1;
```

ตัวอย่างที่ดีกว่า:

```js
// นับ retry ก่อนเริ่มรอบถัดไป เพื่อหยุด reconnect loop เมื่อครบเพดานที่กำหนด
count += 1;
```

Comment ที่ดีควรช่วยให้ผู้ดูแลภายหลังตอบได้ว่า:

- ทำไมโค้ดนี้ต้องมี
- ทำไมเลือกวิธีนี้
- เปลี่ยนหรือลบได้ภายใต้เงื่อนไขใด
- มีผลกับระบบส่วนใด

### 10.5 Comments are part of the code and must stay current

Comment ถือเป็นส่วนหนึ่งของ Source Code:

- stale comment ที่ไม่ตรงกับ behavior จริงถือเป็น defect
- เมื่อแก้ code ต้องตรวจและแก้ comment ที่เกี่ยวข้องใน diff เดียวกัน
- ห้าม copy comment เก่ามาใช้โดยไม่ตรวจว่าตรงกับ logic ใหม่
- ห้ามเขียน comment ที่อ้างค่าชั่วคราว, IP, credential หรือ assumption ที่หมดอายุแล้วโดยไม่ระบุขอบเขต
- ห้ามใส่ secret, password, token หรือ credential จริงใน comment

### 10.6 Scope exceptions

กฎการ Comment ใช้กับ Source Code ที่ทีมดูแลเอง ส่วนไฟล์ต่อไปนี้ไม่ต้องแก้เพื่อเพิ่ม comment เพียงเพื่อให้ผ่านกฎ หากไม่ได้แก้เนื้อหาโดยตรง:

- generated artifacts
- minified bundles
- vendored third-party source
- binary files
- lock files

แต่ถ้ามีการแก้ไฟล์ดังกล่าวด้วยมือและไฟล์นั้นกลายเป็น logic ที่ทีมต้องดูแลต่อ ต้องบันทึกเหตุผลไว้ในเอกสารหรือ source ที่เหมาะสม

### 10.7 Required review before completion

ก่อนถือว่างานเขียนโค้ดเสร็จ ต้องตรวจ `git diff` และยืนยันว่า:

- [ ] ทุก function/method/class/module ที่เพิ่มหรือแก้มี comment/docstring อธิบาย
- [ ] ทุก changed logic block มี comment อธิบาย intent และ behavior
- [ ] ทุก changed line ถูกครอบคลุมโดย inline comment หรือ block comment ที่อธิบายโดยตรง
- [ ] comment เก่าที่ได้รับผลกระทบถูกอัปเดตให้ตรงกับ code
- [ ] comment ไม่เพียง restate syntax แต่บอกเหตุผลหรือข้อจำกัดที่มีประโยชน์
- [ ] ไม่มี secret หรือ credential จริงใน comment
- [ ] documentation `.md` ที่ได้รับผลกระทบถูกอัปเดตตาม Section 9 แล้ว

**หากยังมีโค้ดที่เพิ่มหรือแก้โดยไม่มี Comment ครบตามกฎนี้ งานยังไม่ถือว่า complete และยังไม่ควร merge หรือ handoff**
