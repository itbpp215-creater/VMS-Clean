# BPP PrerimWatch

ระบบกล้องวงจรปิดอัจฉริยะ (AI CCTV / NVR) สร้างบน [Frigate NVR](https://github.com/blakeblackshear/frigate) (MIT)
พร้อม Dashboard ภาษาไทย, การตรวจจับวัตถุด้วย YOLO11 บน GPU, ระบบอ่านป้ายทะเบียนไทย
และบริการด้าน authentication, Watchlist และการแก้ config ที่แยกสิทธิ์ชัดเจน

| ส่วนประกอบ | หน้าที่ |
|---|---|
| `frigate` | video processing, recording, go2rtc และ AI detection (ONNX YOLO11m@640) |
| `dashboard` | TLS/auth gateway และหน้าจอปฏิบัติการ; publish `443` และ redirect `80` |
| `auth-service` | login, HttpOnly session, user/RBAC และ audit |
| `watchlist-api` | Watchlist, detection history และ Federation export แบบข้อมูลขั้นต่ำ |
| `lpr` | อ่านป้ายทะเบียนไทยจาก event รถ, บันทึก history และแจ้งเตือน |
| `config-api` | admin-only, crash-safe camera/WebRTC config mutations |
| `config-validator` | ตรวจ candidate config ด้วย parser จาก Frigate image รุ่นเดียวกับ runtime |

Compose มี 7 services ตามตารางข้างต้น โดย Dashboard TLS เป็น application entry point เดียว
Frigate UI/API และ backend ports ไม่ publish ออก host; มีเพียง WebRTC media `8555/tcp+udp`
ที่เปิดโดยตรงตามข้อจำกัดของ media path

## เริ่มต้นที่นี่

- **กฎและ guardrails ทั้งหมด (คนและ AI agent): [`CLAUDE.md`](CLAUDE.md)** ← อ่านก่อนแก้อะไรทั้งสิ้น
- สถานะระบบปัจจุบัน: [`docs/current-state.md`](docs/current-state.md)
- สารบัญเอกสารทั้งหมด: [`docs/README.md`](docs/README.md)

## Supported setup / Local development

ต้องมี: Windows + Docker Desktop (WSL2), NVIDIA GPU (production), ไฟล์โมเดล machine-local
(ONNX detector + LPR `.pt`), TLS certificate และ private key — ทั้งหมดเป็น machine-local/gitignored
และต้อง provision ตาม [`docs/operations.md`](docs/operations.md)

```bash
git clone https://github.com/Meltingth/BPP-PrerimWatch.git
cd BPP-PrerimWatch
cp .env.example .env
# ใส่ secret แบบสุ่มอิสระ, camera credentials และ TLS paths (ห้าม commit .env)
docker compose run --rm auth-service python manage.py bootstrap-admin <username> \
  --output-file /data/admin-credential.once
# เก็บ credential ใน approved secret store แล้วลบ one-time file หลังตรวจการเข้าใช้
docker compose build
docker compose up -d
```

Dashboard: `https://localhost/` (`http://localhost/` redirect ไป HTTPS)
ไม่มี direct Frigate UI URL จาก host
Deploy มาตรฐาน: `./deploy.sh` — รายละเอียด/health check: [`docs/operations.md`](docs/operations.md)

## Testing

ชุดทดสอบปัจจุบันผ่าน **88 Python/repository tests**:
Auth 19, Watchlist 9, Config API 30, Config Validator 2, LPR 11 และ root security/repository 17
พร้อม browser smoke **2 scenarios** ผ่าน `npm run test:browser`

Workflow `.github/workflows/security-tests.yml` pin GitHub Actions, Node `22.23.1`
และ Playwright `1.61.1` เพื่อรันชุดทดสอบแยกจาก production deploy workflow
การบังคับให้ผ่านก่อน merge ต้องตั้ง branch protection เพิ่มเติม
ดูคำสั่งทดสอบและข้อจำกัดของ browser mock ที่ [`docs/operations.md`](docs/operations.md)

> ⚠️ Repository นี้เป็น **private** — มีรายละเอียดโครงสร้างระบบภายใน ห้ามทำเป็น public
