# Troubleshooting Knowledge Base

- **Status:** REFERENCE · **Last reconciled:** 2026-08-26 (section 24 reconciled; earlier entries retain their prior evidence state) · **Evidence:** incident จริงจาก `docs/sessions/`, `config/config.yml`, `deploy.sh`, `nas-bot-service/services/identity_sync.py`, `nas-bot-service/repair_person_identity.py`

เอกสารนี้เก็บปัญหาที่เกิดขึ้นจริง วิธีวินิจฉัย สาเหตุ และแนวทางแก้ที่พิสูจน์แล้ว เพื่อไม่ต้องเริ่ม debug ใหม่จากศูนย์

## รูปแบบรายการ

แต่ละปัญหาควรมี:

- อาการ
- ผลกระทบ
- วิธีแยกสาเหตุ
- Root cause
- วิธีแก้
- วิธีป้องกัน
- session/commit ที่เกี่ยวข้อง

---

## 1. RTMP camera reconnect เป็นจังหวะคงที่

### อาการ

- Frigate watchdog restart ffmpeg ทุกประมาณ 40-50 วินาทีแบบสม่ำเสมอ
- upstream stream ดูปกติ
- auth ถูก
- network ไม่ได้หลุดแบบสุ่ม

### วิธีวินิจฉัย

ทดสอบ upstream ด้วย FFmpeg ตรง:

```bash
docker exec frigate-nvr /usr/lib/ffmpeg/7.0/bin/ffmpeg -i "<url>" -f null -
```

ตรวจ go2rtc producer ID สองครั้งโดยเว้นเวลา:

```bash
docker exec frigate-nvr wget -qO- "http://127.0.0.1:1984/api/streams?src=<cam>"
```

ถ้า producer ID เปลี่ยนตรงกับรอบที่กล้องหลุด ให้สงสัย native RTMP client ของ go2rtc

### Root cause ที่เคยยืนยัน

native RTMP client ของ go2rtc 1.9.10 ไม่เสถียรกับ media server ของ `cam11`

### วิธีแก้

```text
ffmpeg:rtmp://...#video=copy
```

อย่าเปลี่ยนกลับเป็น native `rtmp://` โดยไม่มี regression test

---

## 2. RTMP auth ผิดแต่ไม่มี error ชัดเจน

### อาการ

- กล้องเหมือน offline
- connection ถูกตัดเร็ว
- log ไม่มี authentication error ที่เข้าใจง่าย

### วิธีแก้

ตรวจ `.env` ก่อน โดยเฉพาะ:

```text
FRIGATE_CAM11_USER
FRIGATE_CAM11_PASS
```

ตรวจว่า config ใช้ placeholder ชื่อเดียวกันและ `deploy.sh` guard ผ่าน

---

## 3. VIDEO LOSS หลังเปิด NVIDIA hardware acceleration

### อาการ

- upstream stream ปกติ
- Frigate แสดง VIDEO LOSS
- ffmpeg log มี error CUDA/NVDEC

### การทดสอบแยกสาเหตุ

ปิด hwaccel ชั่วคราวบนเครื่องนั้น:

```yaml
hwaccel_args: []
```

ถ้าภาพกลับมา ให้ตรวจ NVIDIA driver / WSL2 / NVDEC support / preset

ห้าม commit local CPU fallback เป็น production baseline โดยไม่ตั้งใจ

---

## 4. NVIDIA GPU lost / no adapters found

### อาการ

```text
nvidia-container-cli: initialization error: WSL environment detected but no adapters were found
```

หรือ host:

```text
GPU is lost. Reboot the system to recover this GPU
```

### Root cause

GPU หลุดจาก PCIe/driver state ระดับ host ไม่ใช่ Frigate config

### วิธีแก้หลัก

รีบูต Windows เพื่อให้ host driver reinitialize GPU

`wsl --shutdown` อย่างเดียวเคยไม่เพียงพอ

### CPU fallback ชั่วคราว

ต้องแก้ครบสามส่วน:

1. override NVIDIA reservation ด้วย Compose `!override []`
2. ปิด hardware decode (`hwaccel_args: []`)
3. บังคับ ONNX detector `device: CPU`

ถ้าไม่บังคับ `device: CPU` ในกรณี GPU มีอยู่แต่เสีย state ONNX Runtime อาจพยายาม init CUDA และ crash

หลัง reboot ให้คืนค่า GPU path ทั้งหมด

---

## 5. CUDA JIT warm-up / detector watchdog loop

### อาการ

- หลังลบ volume หรือเครื่องใหม่ detector warm-up นาน
- watchdog รายงาน detection stuck
- detector ถูก kill ซ้ำ
- `skipped_fps` สูงและ detection FPS เป็น 0

### สาเหตุ

GPU รุ่นใหม่อาจต้อง JIT compile kernels จาก PTX ใน first run

### การป้องกัน

รักษา named volume:

```text
cuda-cache:/root/.nv
```

### วิธีแก้เมื่อ queue ค้าง

เมื่อ cache เริ่มพร้อมแล้ว:

```bash
docker restart frigate-nvr
```

---

## 6. Dashboard 502 หรือใช้ nginx config เก่า หลัง deploy

### สาเหตุที่เคยพบ

- single-file bind mount ของ `dashboard-nginx.conf` ชี้ inode เก่าหลัง `git reset`
- nginx resolve `frigate` hostname ตอน start แล้ว service IP เปลี่ยนหลัง Frigate recreate

### วิธีแก้

```bash
docker compose up -d --force-recreate dashboard
```

`deploy.sh` ทำขั้นตอนนี้อัตโนมัติ

---

## 7. Config ผ่าน validator แต่ go2rtc fail เพราะ missing variable

### สาเหตุ

Frigate config validation ไม่ได้จับทุกกรณีของ `{FRIGATE_*}` substitution ใน go2rtc

### การป้องกัน

`deploy.sh` ตรวจทุก placeholder ใน `config/config.yml` ว่ามี key ใน `.env`

ห้ามลบ guard นี้โดยไม่มีวิธีทดแทน

---

## 8. Storage patch build fail หลังอัป Frigate

### อาการ

Docker image build ล้มตอน `patch_storage_threshold.py`

### ความหมาย

Internal code ของ Frigate ที่ patch อ้างถึงเปลี่ยนไป

### แนวทาง

1. ตรวจ upstream Frigate change
2. ปรับ pattern ใน patch
3. ทดสอบ behavior การลบไฟล์และ DB consistency
4. อัปเดต ADR/session/troubleshooting ถ้ากลไกเปลี่ยน

การ fail ดัง ๆ เป็น behavior ที่ตั้งใจไว้

---

## 9. Browser write request ได้ `401 Missing CSRF header`

### อาการ

- GET/read API ใช้งานได้
- non-GET จาก browser เช่น config update หรือ description save ได้ `401`
- log ระบุ `Missing CSRF header`

### Root cause

Frigate ตรวจ non-GET request ที่มี `Origin` header และต้องมี `X-CSRF-Token` header

### วิธีแก้

ให้ Dashboard write helper แนบ header ที่จำเป็นกับทุก browser write operation

อย่าเสียเวลา debug label map หรือ payload ก่อนตรวจ CSRF เมื่ออาการคือ read ได้แต่ write 401

---

## 10. Camera provisioning สำเร็จใน UI แต่ config มี credential จริง

### อาการ/ความเสี่ยง

Camera URL แบบมี username/password ถูกเขียนลง `config/config.yml` และอาจถูก commit โดยไม่ตั้งใจ

### วิธีป้องกัน

ก่อน commit:

1. ตรวจ URL ใน config
2. ย้าย credential ไป `.env`
3. แทนด้วย `{FRIGATE_*}`
4. เพิ่ม key เปล่าใน `.env.example`

ห้าม commit password จริง

---

## 11. ปิดกล้อง (dashboard) แล้ว GPU ยังทำงาน + เปิดกลับ detection ไม่มา

### อาการ

- ปิดกล้องทุกช่องจากหน้า Settings แล้ว หน้าเว็บซ่อนภาพได้ แต่ GPU ยังทำงาน ~15-25%
- เปิดกล้องกลับ ภาพสดกลับมาแต่ detection เดิมไม่ทำงาน → ไม่มีคลิปเหตุการณ์

### วิธีวินิจฉัย

```bash
# เทียบ config vs stats ต่อกล้อง
GET /api/config  → cameras.<x>.detect.enabled / record.enabled
GET /api/stats   → cameras.<x>.camera_fps / detection_fps
# ถ้า detection_fps > 0 แต่ /api/events ไม่มี event ใหม่มานาน = pipeline หลัง detector ตาย
docker logs frigate | grep -iE "Exception in thread|KeyError|detected_frames_processor"
```

### Root cause (สองเรื่องแยกกัน)

1. **GPU ไม่ว่าง:** `detect.enabled`/`record.enabled=false` แค่หยุด "ตรวจจับ/บันทึก" **ไม่หยุด ffmpeg**. ffmpeg ต่อกล้อง (role `[detect,record]`) ใช้ `-hwaccel cuda + scale_cuda` (decode GPU) + go2rtc `h264_nvenc` transcode + birdseye ยังรันตราบใดที่ `enabled=true`. เฉพาะ **camera-level `enabled=false`** เท่านั้นที่ทำให้ `CameraWatchdog.stop_all_ffmpeg()` (video.py:283) หยุด ffmpeg → คืน GPU. และ `camera/maintainer.py` เช็ค `if not config.enabled_in_config: return` ตอน spawn process → **มีผลเฉพาะตอน restart**.
2. **detection ตายทั้งระบบ:** thread เดียว `detected_frames_processor` **crash** จาก `KeyError` ที่ `track/tracked_object.py:120` (`objects.filters[label]`) — จุดชนวนคือ `/api/config/set` republish config ระหว่าง toggle ทำให้ `objects.filters` ในสำเนา config ไม่ครบชั่วขณะ. thread ตาย = ไม่มี event ทุกกล้อง (detector GPU ยังรัน detection_fps>0 แต่ผลถูกทิ้ง). แถม config/set detect ON **ไม่ force motion ON** เหมือน dispatcher command (`_on_detect_command`) — ถ้า motion ถูกปิด object detection ไม่มี region → detection ~0.

### วิธีแก้

- **กู้ทันที:** `docker restart frigate-nvr` → rebuild config สะอาด (filters ตรง track, motion กลับ, thread ฟื้น) → detection/event กลับมา
- **ถาวร (dashboard):** ปิด/เปิดกล้องใช้ **camera-level `enabled` แล้ว restart** ไม่ใช่ detect/record live-toggle:
  - เขียน `config/set {cameras:{X:{enabled:false}}}` **โดยไม่ใส่ `update_topic`** (เขียน disk อย่างเดียว ไม่ republish → เลี่ยง KeyError crash) — ยิงเรียงลำดับต่อกล้อง (ห้าม `Promise.all` เพราะ config/set เป็น read-modify-write ทั้งไฟล์)
  - เปิด = `{enabled:true, detect:{enabled:true}, record:{enabled:true}}` แล้ว `POST /api/restart` ครั้งเดียว (batch)
  - พิสูจน์แล้ว: ปิด 3 กล้อง + restart → camera_fps=0 + VRAM ลด ~1.15GB; เปิดกลับ + restart → detection_fps>0 + มี event ใหม่ + ไม่มี KeyError

### หมายเหตุ

มีทาง live (ไม่ต้อง restart) คือ WS command `<cam>/enabled/set` payload `OFF`/`ON` ผ่าน `/ws` (→ dispatcher `_on_enabled_command` → `CameraWatchdog` หยุด ffmpeg) แต่ dashboard เลือกใช้ config+restart เพราะเชื่อถือได้กว่าและไม่เสี่ยง crash (ผู้ใช้ยอมรับ trade-off restart ~30-60 วิ)

---

## 12. LPR อ่านทะเบียนขาดตัวอักษร / ตัว ป ไม่เคยปรากฏ

### อาการ

- ทะเบียนที่อ่านได้สั้นกว่าป้ายจริง 1 ตัวอักษร (ตำแหน่งพยัญชนะ)
- ทะเบียนที่มีตัว "ป" ไม่เคยถูกอ่านเจอเลย
- ทะเบียนต้องสงสัยไม่ trigger แจ้งเตือนทั้งที่รถผ่านกล้องชัดเจน

### Root cause

ตาราง mapping ใน `lpr-service/helper.py` (สืบทอดจากโค้ดต้นแบบของทีม) ไม่ตรงกับ
class จริงของโมเดล `data_plate.pt`: โมเดลมี class `A05` ที่ตารางแปลไม่ได้
(ตัวอักษรถูกทิ้งจากข้อความ — by design เพื่อไม่ให้รหัสดิบปนในทะเบียน) และตาราง
มี `A27` = ป ที่โมเดลไม่มีทาง output

### การตรวจ

```bash
docker logs lpr-service 2>&1 | grep "reconcile\|dead entries"
```

จะเห็น warning ตอน start ระบุรหัสที่ไม่ตรงกันทั้งสองทิศ

### วิธีแก้

ต้องได้ label definitions (data.yaml) จากทีมที่ train โมเดลมายืนยันว่าแต่ละรหัส
A## คือพยัญชนะตัวใด แล้วแก้ตาราง `_THAI_CHAR` ใน `lpr-service/helper.py`
**ห้ามเดาจากลำดับพยัญชนะไทย** — ความไม่ตรง A05/A27 พิสูจน์แล้วว่าสมมติฐาน
"เลขรหัส = ลำดับพยัญชนะ" ใช้ไม่ได้กับโมเดลชุดนี้

ดู [`features/license-plate-recognition.md`](features/license-plate-recognition.md)

---

## 13. Push เข้า `main` แล้ว auto-deploy ไม่ทำงาน (self-hosted runner เงียบ)

### อาการ

- Push commit เข้า `main` (ไม่ใช่ path ที่ CI ignore) แต่ production ไม่อัปเดต
- ตรวจ `git status` บน production directory (`D:\BPP-VMS\frigate-nvr`) แล้วพบว่ายัง
  behind origin/main อยู่ แม้ผ่านไปนานแล้ว

### Root cause

`.github/workflows/deploy.yml` (เวอร์ชันก่อน 2026-07-16) สั่ง runner
`cd "C:/Things-Analytic-NVR/frigate-nvr"` ก่อนรัน `git fetch`/`git reset --hard`/
`deploy.sh` — แต่ path นี้**ไม่มีอยู่จริง**บนเครื่อง production ปัจจุบัน (ยืนยันแล้วว่า
`C:\Things-Analytic-NVR\frigate-nvr` ไม่มี) โปรเจกต์จริงรันจาก `D:\BPP-VMS\frigate-nvr`
(ยืนยันจาก
`docker inspect frigate-nvr --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`)
workflow เขียนไว้จาก path ของเครื่อง/การติดตั้งเดิมที่ยังไม่ได้อัปเดตตอนย้ายโปรเจกต์
มา `D:\BPP-VMS`

นอกจาก path แล้ว ตรวจเพิ่ม 2026-07-16 พบว่า**เครื่องนี้ไม่มี self-hosted runner เลย**:
ไม่มี process `Runner.Listener`, ไม่มี Windows service ชื่อมี `actions.runner`,
และไม่มีโฟลเดอร์ `actions-runner/` — แปลว่า job น่าจะไม่เคยถูก dispatch มาเครื่องนี้
(ค้าง queued/fail ฝั่ง GitHub) ไม่ใช่แค่ล้มที่ขั้น `cd`

### สถานะการแก้ (อัปเดต 2026-07-16)

1. ✅ **path ใน workflow แก้แล้ว** — `.github/workflows/deploy.yml` ใช้
   `cd "D:/BPP-VMS/frigate-nvr"` ตรงกับเครื่อง production ปัจจุบัน
2. ⏳ **ลงทะเบียน self-hosted runner ใหม่บนเครื่องนี้** (ยังไม่ทำ — auto-deploy
   ยังไม่กลับมาจนกว่าจะเสร็จ): ติดตั้ง runner จากหน้า Settings → Actions → Runners
   ของ repo, ติด label `windows-production`, ตั้งเป็น service ให้รันอัตโนมัติหลัง reboot
3. ⏳ ตรวจ GitHub Actions run history ของ repo ว่า job เก่าค้าง queued/fail อย่างไร
   และ runner เก่า (เครื่องเดิม) ยังลงทะเบียนค้างอยู่หรือไม่ — ถ้ามีให้ถอดออก
4. ⏳ หลัง runner พร้อม ทดสอบด้วย `workflow_dispatch` (กดรันเองจากหน้า Actions)
   แล้วดูว่า deploy จบ healthy

### ผลกระทบจนกว่าจะลงทะเบียน runner เสร็จ

ทุก push เข้า `main` ต้องมาสั่ง deploy manual บน production เอง (`git pull` +
merge `config/config.yml` ด้วยมือ + `./deploy.sh`) — ดู session log
2026-07-16 สำหรับตัวอย่างขั้นตอน manual deploy ที่ปลอดภัยเมื่อ `config.yml`
local มี production secret ที่ไม่ได้ commit

---

## 14. Credential จริงหลุดเข้า git history ผ่าน config.yml จากเครื่องอื่น

### อาการ

Pull commit จากเครื่องอื่นมาแล้วพบว่า `config/config.yml` ที่ push ขึ้นมามี
camera URL ที่มี username/password จริงฝังตรงๆ (ไม่ใช่ `{FRIGATE_*}` placeholder)

### เคสที่ยืนยันแล้ว

commit `a22ea7d` (2026-07-15, จากเครื่อง dev ที่ไม่มี NVIDIA GPU) เพิ่มกล้อง
`fujinon` ด้วย credential จริงตรงๆ ใน `go2rtc.streams`:
`rtsp://<user>:<pass>@192.168.1.10:554/stream1` — อยู่ใน git history ของ
`origin/main` แล้ว (repo private แต่ยังถือว่า credential นี้ compromised
สำหรับใครก็ตามที่มีสิทธิ์อ่าน repo)

### สาเหตุ

`config/config.yml` เป็น tracked file ที่หลายเครื่อง (production + dev) แก้ไข
ผ่าน git ตาม guardrail ใน `CLAUDE.md` §3 ("config.yml เป็น git-managed") แต่
convention การแทน credential จริงด้วย `{FRIGATE_*}` placeholder (ที่ `cam11` ใช้)
ไม่ได้ถูกบังคับด้วย validation ใดๆ — เครื่อง dev commit ค่าจริงตรงๆ ได้โดยไม่มี
guard ขวาง (`deploy.sh` เช็คแค่ว่า `{FRIGATE_*}` ที่อ้างถึงมีอยู่ใน `.env`
ไม่ได้เช็คว่าไม่มี credential จริงหลุดเข้ามา)

### Current remediation status — 2026-07-23

- tracked `config/config.yml` ใช้ `{FRIGATE_NONGWANG_USER}` / `{FRIGATE_NONGWANG_PASS}`
  และไม่มี inline camera credential จาก repository security scan
- current topology ถูก reconcile เป็น 14 cameras / 28 main+sub streams; legacy orphan
  streams 10 รายการถูกล้าง
- generated dumps/logs/test variants ที่อาจเก็บ payload เก่าถูกล้างและเพิ่ม ignore rules
- credential ที่เคยเผยแพร่หรืออยู่ใน tracked history ต้องถือว่า compromised ต่อไปจนกว่า
  จะ rotate ที่ upstream device และพิจารณา history rewrite ใน change window ที่ได้รับอนุมัติ

### วิธีแก้เมื่อพบซ้ำ

1. หยุด commit/deploy ที่มีค่าจริง
2. rotate credential ที่ upstream endpoint; การลบข้อความออกจาก YAML ไม่ revoke ค่าเดิม
3. เก็บค่าใหม่ใน `.env` และใช้ `{FRIGATE_*}` placeholder ใน tracked config
4. recreate `frigate` เพื่อโหลด environment ใหม่
5. รัน repository security tests และตรวจ Git history/artifacts ตาม incident scope
6. พิจารณา `git filter-repo` เฉพาะเมื่อมี approval และแผนประสานผู้ clone ทุกคน

---

## 15. Auth-service ไม่ start เพราะไม่มี active admin

### อาการ

- `auth-service` exit ตอน startup
- Dashboard login ใช้งานไม่ได้
- log ระบุว่าไม่มี active administrator และแนะนำ `bootstrap-admin`

### Root cause

เป็น fail-closed behavior เมื่อ auth database ว่าง, mount ผิด, DB ถูกลบ หรือ active
admin สุดท้ายไม่อยู่ ระบบจงใจไม่สร้าง default admin/password อัตโนมัติ

### วิธีตรวจ/แก้

1. ตรวจว่า named volume `auth-db:/data` ชี้ volume ที่ตั้งใจ
2. restore `auth.db` เดิมถ้าเป็น mount/backup issue
3. ถ้าเป็น installation ใหม่และ DB ว่างจริง ให้รัน:

   ```bash
   docker compose run --rm auth-service \
     python manage.py bootstrap-admin <username> \
     --output-file /data/admin-credential.once
   ```

4. เก็บ credential ใน approved store, ทดสอบ login แล้วลบ one-time file

หาก installer รุ่นเก่าสร้างบัญชีแล้วแต่ไม่เคยแสดงรหัส ให้ตรวจ one-time
credential ที่ยังค้างใน `/data/admin-credential.once` ของ `auth-db` volume
ก่อนสั่ง rotate password. Installer รุ่นใหม่สร้างชื่อไฟล์แบบสุ่ม อ่านค่าใน
memory เพื่อแสดงครั้งเดียว และลบจาก volume หลัง operator ยืนยัน `DELETE`.

ห้ามแก้โดยเพิ่ม password default ลง source/Compose/เอกสาร

---

## 16. Protected API ได้ 401, 403 หรือ 503 หลัง rotate secret/role

### ความหมาย

- `401`: ไม่มี/หมดอายุ credential หรือ proxy/service signature ผิด
- `403`: identity ถูกต้องแต่ role/capability/source ACL ไม่พอ
- `503`: auth verifier หรือ required server secret ยังไม่พร้อม/ตั้งค่าสั้นเกินไป

### วิธีตรวจ

1. เรียก `/auth/session` ผ่าน TLS gateway และตรวจ current role
2. ตรวจ auth-service/watchlist/config logs โดยไม่พิมพ์ secret
3. ยืนยันว่าค่าใหม่ยาวอย่างน้อย 32 random bytes และทุก holder ถูก recreate
4. อย่าทดสอบด้วยการเพิ่ม `X-Role: admin`; Config API จงใจ ignore และ Watchlist
   ต้องมี proxy signature ที่ remote client ไม่มี
5. หลัง JWT rotation ให้ login ใหม่ เพราะ session เดิมถูก invalidate

การแก้ชั่วคราวด้วยการ bypass backend dependency หรือใช้ secret เดียวทุก service
เป็น security regression

---

## 17. Federation ได้ 401/403/503 หรือ response มีข้อมูลน้อยกว่าที่คาด

หาก `nvr-dashboard` หยุดพร้อม `invalid number of arguments in "allow"`
ให้ตรวจว่าใช้ source รุ่นเก่าที่นำค่า comma-separated ไปวางใน `allow` บรรทัดเดียว
หรือไม่ รุ่นปัจจุบันจะแปลงแต่ละ CIDR เป็นคนละ directive ก่อน nginx start และจะ
หยุดแบบ fail-closed พร้อมข้อความ `BPP_FEDERATION_ALLOW_CIDR must contain only`
เมื่อมีค่าว่างหรือรูปแบบที่ไม่ใช่ IPv4/IPv6 CIDR

### วิธีแยกสาเหตุ

- TLS/certificate error: peer URL/certificate chain ไม่ผ่าน HTTPS verification
- `401`: Federation secret หรือ internal proxy secret ไม่ตรง
- `403`: source อยู่นอก `BPP_FEDERATION_ALLOW_CIDR` หรือไม่มี trusted VPN/mTLS assertion
- `503`: Watchlist server secret ยังไม่ได้ bootstrap
- HTTP 200 แต่ไม่มี owner/phone/notes: เป็น data-minimization contract ไม่ใช่ข้อมูลหาย

### วิธีแก้

1. ตรวจ direct source address ที่ nginx เห็นและใช้ CIDR แคบของ VPN จริง
2. recreate `dashboard`, `watchlist-api`, `lpr` และ update peer หลัง secret rotation
3. ตรวจว่า peer ใช้ exact HTTPS route `GET /api/watchlist-federation`
4. ถ้าใช้ mTLS ต้องให้ trusted proxy verify certificate ก่อน assert `SUCCESS`
5. ทดสอบ negative cases จาก source/secret/method ที่ไม่อนุญาตด้วย

ห้ามขยาย CIDR เป็นทุก network, เปิด HTTP หรือเพิ่ม PII กลับเข้า Federation response เพื่อแก้ปัญหา connectivity

---

## 18. Config API ได้ 503 busy, 422 validation หรือ 500 safe failure

### ความหมาย

- `503 Configuration is busy`: writer อื่นถือ OS lock เกิน timeout
- `422`: request หรือ config structure ไม่ผ่าน validation
- `500 Configuration update failed safely`: commit ล้มและ service พยายาม rollback

### วิธีแก้

1. ตรวจ config-api logs และ filesystem health/free space
2. รอ writer เดิมจบแล้ว retry; **อย่าลบ `.config-api.lock`** เพราะ file existence ไม่ใช่ ownership
3. ตรวจ request camera name, URL scheme, WebRTC IPv4 และ ffmpeg roles
4. ตรวจ backups ที่ `config/backups/`; ถ้า YAML/JSON เปลี่ยนพร้อมกันให้เลือก transaction ID เดียวกัน
5. หลัง restore รัน Frigate validator ก่อน restart
6. ตรวจว่า 14 cameras map กับ 28 expected main/sub streams ไม่มี orphan

ถ้า rollback incomplete ให้หยุด config writes/Frigate, preserve files เพื่อวิเคราะห์ แล้ว restore coordinated backup ตาม [`operations.md`](operations.md)

---

## 19. Dashboard ไม่ขึ้นหลังบังคับ TLS หรือ browser รายงาน CSP block

### อาการ

- port 80 redirect แต่ TLS connection fail
- nginx start fail เพราะ certificate file ไม่มี
- feature ที่เพิ่มใหม่ไม่ทำงานและ console แสดง CSP violation

### วิธีแก้

1. provision `config/certs/fullchain.pem` และ `privkey.pem` ด้วย permission ที่เหมาะสม
2. ตรวจ `nginx -t` ใน image/host ที่มี Docker
3. script ใหม่ต้องเป็น same-origin หรือ pinned source ที่ review แล้วและ CSP อนุญาต
4. ย้าย inline executable script ไปไฟล์ asset; ห้ามแก้ด้วย `'unsafe-inline'`/`'unsafe-eval'`
5. รัน `tests/browser-smoke.mjs` และ repository security invariants

ถ้า page render stored data เป็น markup ให้ถือเป็น incident: revert path นั้นไปใช้
DOM creation/`textContent` และตรวจ session/audit exposure

---

## 20. Service/runner อ่าน secret path ไม่ได้หลัง Windows ACL hardening

### อาการ

- Docker/runner/operator ได้ `Access denied` ที่ `.env`, auth, certificate, Watchlist หรือ LPR paths
- `icacls` ไม่แสดง identity ที่ process ใช้งานจริง

### Root cause

ACL script จงใจลบ inherited/broad entries และเหลือ SYSTEM, local Administrators,
invoking operator กับ principals ที่ระบุเท่านั้น Process ที่รันด้วย Windows account
อื่นต้องถูกอนุมัติและเพิ่มอย่างชัดเจน

### วิธีแก้

1. ระบุ Windows identity ที่ process ใช้จริง
2. preview:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\harden-windows-acl.ps1 `
     -AdditionalPrincipal "DOMAIN\ServiceAccount" -WhatIf
   ```

3. apply โดยตัด `-WhatIf`
4. ตรวจ target และ child files ด้วย `icacls`
5. rerun service health โดยไม่แสดง content ของ secret

ห้ามแก้ด้วยการ grant `Authenticated Users`, `Everyone` หรือ `Builtin Users`.
Script จะ fail หาก final ACL มี principal เกิน/ขาด และ refuse path นอก repository root

---

## 20. GUI installer stops with password policy error

### Symptom

The installer reports that the Web Admin password must contain upper-case,
lower-case, and numeric characters.

### Cause

The selected password does not meet the same policy enforced by auth-service:
14–256 characters, no more than 72 UTF-8 bytes, and at least one lower-case,
upper-case, and numeric character.

### Recovery

1. Use a password such as `BppNewCamp2026!` that satisfies all three classes.
2. Run the current GUI package again and choose a **new** destination folder if
   the prior failed attempt already copied a package there.
3. Do not delete Docker volumes blindly. An early password failure can leave an
   empty named volume with a fresh JWT key; the next clean attempt can safely
   provision its first administrator when the selected project identity matches.

Current GUI and PowerShell preflight checks reject this password before creating
package files or Docker resources. If an older EXE shows the error only after
Docker output, rebuild/use the latest generated package.

---

## 21. ภาพสดบนเว็บช้า/หน่วง (VLC ปกติ) หรือดูผ่าน internet ไม่ได้/ได้บางเครื่อง

### อาการ

- mainstream บน dashboard หน่วง/ช้ามาก แต่ VLC ดึง RTSP ต้นทางตรงเล่นลื่น
- เข้าเว็บผ่าน domain จากภายนอกได้ แต่ tile ทุกช่องขึ้น VIDEO LOSS
- บางเครื่อง/บางเบราว์เซอร์ดูได้ บางเครื่องไม่ได้ ทั้งที่เครือข่ายเดียวกัน

### วิธีวินิจฉัย (เรียงตามที่เจอบ่อย — เคสจริง 2026-08-07)

```bash
# 1) CPU อิ่มจาก software transcode?  (เคยเจอ: 1204% จาก libx264 26 process)
docker stats --no-stream frigate-nvr
docker exec frigate-nvr sh -c "ps -eo args | grep '[f]fmpeg' | grep -c libx264"
#    → config.yml go2rtc ต้องเป็น #video=copy (ต้นทางที่ไม่ต้องแปลง) หรือ
#      #video=h264#hardware (NVENC) เท่านั้น — #video=h264 เปล่าๆ = ซีพียูล้วน

# 2) WebRTC candidate ตรงกับ LAN IP จริงไหม (IP เครื่องนี้เปลี่ยนมาแล้ว 4 รอบ)
ipconfig | grep IPv4        # เทียบกับ go2rtc.webrtc.candidates ใน config.yml

# 3) ดูผ่าน internet: ต้อง forward UDP+TCP 8555 → เครื่องนี้ ที่ router
#    (candidates มี stun:8555 ให้ advertise public IP เอง; หน้าเว็บโหลดได้
#     แต่วิดีโอไม่มา = media plane 8555 ไปไม่ถึงแทบทุกครั้ง)

# 4) "บางเครื่องดูได้": ตรวจ CSP + cert
curl -sk -D - -o /dev/null https://localhost/ -H "Host: <domain>:<port>" | grep -i connect-src
#    ต้องเห็น wss://<domain>:<port> (ใช้ $http_host ไม่ใช่ $host ที่ตัด port)
echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -subject -issuer
#    cert ต้องตรงโดเมนและออกโดย CA จริง (Let's Encrypt ผ่าน acme-sh container)
```

### Root cause ที่เคยยืนยัน (2026-08-07)

1. go2rtc `#video=h264` ไม่มี `#hardware` = libx264 ซอฟต์แวร์ 30 สตรีม → CPU อิ่ม
2. candidate เป็น IP เก่า (`192.168.0.246` ขณะเครื่องอยู่ `192.168.1.200`)
3. ไม่ได้ forward 8555 → remote เข้าเว็บได้แต่ media ไปไม่ถึง
4. CSP `wss://$host` ตัด port + redirect `301 https://$host...` ตัด port → เข้าผ่าน
   external :8080 พังเฉพาะบางเบราว์เซอร์/หลุดทั้งหน้า
5. cert self-signed CN คนละโดเมน → พฤติกรรมต่างกันตามเครื่อง

### วิธีแก้ที่ใช้จริง

main=`#video=copy` (บันทึก HEVC ตรง) + sub=`#video=h264#hardware` + สตรีม
`<cam>_hd` (main+NVENC) แบบ on-demand ให้ปุ่มดูเต็มจอ (เว็บใช้ `ch.hd || ch.src`);
แก้ candidate ตาม LAN จริง; nginx ใช้ `$http_host` ทั้ง CSP และ redirect; ออก cert
จริงด้วย acme-sh (DNS-01/DuckDNS) — ดูรายละเอียดครบใน
[`sessions/session-2026-08-07-stream-performance-and-remote-video.md`](sessions/session-2026-08-07-stream-performance-and-remote-video.md)

### การป้องกัน

- เพิ่มกล้องใหม่: ห้ามใช้ `#video=h264` เปล่าๆ ใน go2rtc (เลือก copy หรือ NVENC)
  ตั้งแต่ 2026-08-07 config-api สร้าง pattern ที่ถูกให้อัตโนมัติแล้ว
- ตั้ง DHCP reservation ให้เครื่อง production — candidate ผูกกับ IP
- nginx reload หลัง acme ต่ออายุ cert **เป็นอัตโนมัติแล้ว** ตั้งแต่ commit `5c98a87`
  (hook `scripts/reload-nginx-on-cert-change.envsh`) ไม่ต้องสั่งมือ

---

## 22. ทั้ง stack ดับเงียบข้ามคืน ทั้งที่เครื่องไม่ได้ reboot (Docker Desktop Resource Saver)

**อาการ:** เช้ามาพบทุก container `Exited` พร้อมกัน กล้องไม่บันทึกไปหลายชั่วโมง
`docker ps -a` แสดง exit code ปนกันระหว่าง `0`, `143` (SIGTERM) และ `137` (SIGKILL)
ซึ่งเป็นลายเซ็นของการหยุดแบบ graceful ทั้งเอนจิน ไม่ใช่ service ใด service หนึ่งแครช

**Root cause (ยืนยันจาก log จริง 2026-08-07):** Docker Desktop **Resource Saver** หยุด
WSL VM เองเมื่อ CPU ว่างนานพอ โดยที่ Windows ไม่ได้ reboot เลย

```text
[15:12:52][engines] setting engine linux/wsl state running -> stopping
[15:12:53][idle] VM stopped
[15:12:53][idlemetrics] Compute time at shutdown 44m26s on 23m27s
[21:28:45][idle] starting VM        <- 6 ชม. 16 นาทีต่อมา ตอนมีคนมาเปิดใช้
```

**ทำไม `restart: unless-stopped` ไม่ช่วย:** restart policy ทำงานภายใน Docker engine
ที่ยังรันอยู่เท่านั้น เมื่อ Resource Saver ดับ VM ทั้งตัว ตัว engine เองก็หายไป และ
container ถูกทำเครื่องหมายว่า "หยุดแล้ว" จึงไม่ถูกปลุกแม้ engine กลับมา

**วิธีตรวจว่าใช่เคสนี้:**

```bash
docker exec frigate-nvr cat /proc/uptime          # uptime ของ VM
```

เทียบกับ `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime` — ถ้า Windows uptime
ยาวกว่า VM uptime มาก แปลว่าเครื่องไม่ได้ reboot แต่ VM ถูกหยุดต่างหาก

**วิธีแก้ (ทำแล้ว 2026-08-08):** ปิด Resource Saver ใน
`%APPDATA%\Docker\settings-store.json`

```json
"UseResourceSaver": false,
"AutoPauseTimeoutSeconds": 0
```

มีผลเมื่อ Docker Desktop start รอบถัดไป ตรวจยืนยันได้จาก Settings → Resources ใน UI

**ข้อควรระวัง:** ถ้าเปลี่ยนค่าในไฟล์ขณะ Docker Desktop รันอยู่ ตัวโปรแกรมอาจเขียนทับ
ตอนปิด — ให้ตรวจค่าซ้ำหลัง restart ทุกครั้ง หรือปิดจาก UI แทน

---

## 23. หลัง Windows reboot คอนเทนเนอร์ขึ้นไม่ครบ

**อาการ:** Docker Desktop เปิดหลัง sign-in และคอนเทนเนอร์ส่วนใหญ่ Running แต่
`frigate-nvr` ยัง Exited, Dashboard restart วน และ service ที่พึ่ง Frigate unhealthy.

**Root cause ที่ยืนยัน 2026-08-16:** สคริปต์ autostart ไม่ได้ลงทะเบียนใน Startup/Run
และยังอ้าง repo กับ Docker CLI คนละพาธกับ production ปัจจุบัน นอกจากนี้การแยก BSOD
เคยตั้ง runtime restart policy ของ `frigate-nvr` เป็น `no`; `docker compose up -d`
เพียงอย่างเดียวไม่ reconcile policy นี้เมื่อไม่ recreate container.

**วิธีแก้:** ใช้ tracked `autostart-frigate.ps1` ซึ่งรอ Docker engine, สั่ง full Compose,
ตั้ง Frigate กลับเป็น `unless-stopped` และ log expected/running/missing service count.
ลงทะเบียน script ผ่าน HKCU Run ตาม [Operations](operations.md#production-windows-autostart).

**ตรวจหลัง reboot:**

```powershell
Get-Content D:\BPP-VMS\frigate-nvr\autostart.log -Tail 30
& "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --project-directory D:\BPP-VMS\frigate-nvr ps
```

Frigate และ media compatibility ต้องจบที่ `healthy`; Docker Desktop เปิดอยู่เพียงอย่างเดียว
ไม่ถือว่าระบบพร้อม.

---

## 24. Person identity update ล้มเหลวหรือข้อมูลชื่อไม่สอดคล้องกัน

### อาการและความหมายของ HTTP status

| Status | ความหมายที่ operator ใช้ตัดสินใจ | Safe action |
|---|---|---|
| `400` | corrected name/input หรือ identity storage state ไม่ผ่าน validation | แก้ input หรือ malformed metadata แบบ read-only ก่อน; request นี้ไม่เขียนไฟล์ |
| `404` | stable dossier target ไม่มีอยู่ | ตรวจ stable `dossier_id` โดยไม่ค้น/เดาจากชื่อ แล้วรัน dry-run ใหม่ |
| `409` | strong evidence รวมกันชี้ไป Person Registry มากกว่าหนึ่ง record | หยุดและ adjudicate ด้วย stable IDs/source records; conflict เกิดก่อน staging จึงไม่มี writes |
| `500` | transaction ล้มเหลว แต่ original bytes/absence ของ promoted files ถูก restore และ verify แล้ว | ตรวจ filesystem health แล้วเริ่มใหม่จาก dry-run; อย่า retry apply อัตโนมัติ |
| `503` | rollback ไม่สามารถ restore/verify original state ได้ครบ | หยุด identity writes ทันที, preserve storage snapshot และทำ controlled recovery ตามด้านล่าง |

HTTP detail เป็นข้อความ generic โดยตั้งใจและไม่สะท้อนชื่อหรือ strong identifiers. CLI แปลง validation,
conflict, transaction, rollback และ filesystem failures เป็น `{"error":"identity_repair_failed"}`
พร้อม exit code `1`; จึงต้องใช้ mode, timing และ backup state แยกสาเหตุโดยไม่พิมพ์ PII

### Read-only diagnosis

1. หยุดการแก้ชื่อ dossier เพิ่มเติมสำหรับ target เดียวกัน ใช้ stable dossier ID เป็น reference
   และเก็บ corrected name/identifier ทั้งหมดไว้ใน private operator context
2. **ห้ามใช้ `/api/nas-bot/dossiers/sync-all` เพื่อซ่อม identity** เพราะ endpoint นี้เป็น historical
   ingestion และไม่ได้ทำ transaction ข้าม Dossiers, Persons และ Cases
3. รัน repair command โดยไม่ใส่ `--apply` (หรือใส่ `--dry-run` อย่างชัดเจน):

   ```powershell
   python nas-bot-service/repair_person_identity.py `
     --root $operatorSelectedNasRoot `
     --dossier-id $operatorSelectedStableDossierId `
     --correct-name $operatorApprovedCorrectName `
     --actor $authenticatedOperator
   ```

4. อ่านเฉพาะ `affected_counts`, `warnings`, `noop` และ stable dossier ID. warning
   `person_registry_match_not_found` หมายถึงไม่มี Person record ที่พิสูจน์ได้ ไม่ใช่สิทธิให้สร้าง/merge
   จากชื่อ; warning `case_suspect_ambiguous:<stable case id>` หมายถึง case นั้นถูกข้าม
5. หาก dry-run conflict/fail ให้แก้ต้นเหตุแบบ read-only ก่อน อย่าเพิ่ม `--apply`

### Apply gate and verification

หลัง review dry-run และได้รับอนุมัติ apply แยกต่างหาก ให้รัน input ชุดเดิมพร้อม `--apply` เพียงครั้งเดียว.
CLI วาง backup callback และ promotion ไว้ใต้ coordinator lock เดียวกัน จึง backup original bytes ของ
exact plan ที่กำลังจะ promote ไม่ใช่ผลจาก re-plan คนละ snapshot

Backup ที่ complete อยู่ใต้ `Backups/identity-sync/<UTC timestamp>-<random id>/` ภายใน NAS root:

- เก็บเฉพาะ affected JSON metadata ตาม root-relative path เดิม ไม่ copy evidence
- `manifest.json` เก็บ stable dossier/person IDs, timestamp, actor, path, `original_existed` และ
  SHA-256 ของ original bytes
- ถ้าไฟล์เดิมไม่มีอยู่ manifest บันทึก `original_existed=false` โดยไม่มี payload เพื่อให้ recovery
  คืนค่าเป็น “ไม่มีไฟล์” ได้ตรงเดิม
- ถ้าสร้างหรือ verify backup ไม่สำเร็จ incomplete directory ถูกล้างและ source metadata ยังไม่ promote

หลัง apply สำเร็จ ให้รัน default dry-run ซ้ำด้วย input เดิมและต้องได้ `noop=true`; จากนั้นตรวจ Dossier,
Person, proven Cases, cached links, search และ graph ด้วย stable IDs. อย่าใช้ชื่อจาก path หรือ parse ID
เพื่อยืนยันตัวตน

### Recovery หลัง `500` หรือ `503`

- `500`: coordinator ยืนยัน exact rollback แล้ว จึงรักษา state ก่อน request ไว้. เก็บ error time,
  ตรวจพื้นที่ว่าง/permission/filesystem และรัน dry-run ใหม่หลังแก้สาเหตุ; ไม่ต้อง overwrite จาก backup
  เพียงเพราะได้รับ `500`
- `503`: อย่าสันนิษฐานว่าไฟล์ใดสำเร็จหรือถูก rollback แล้ว. หยุด dossier name update และ repair apply,
  เก็บ read-only snapshot ของ metadata ปัจจุบัน และห้ามรัน `sync-all`
- ถ้า `503` เกิดจาก CLI `--apply`, ใช้ complete backup ของ invocation เดียวกันเป็น recovery source.
  ตรวจว่า manifest paths เป็น relative และ resolve อยู่ใต้ NAS root, verify SHA-256 ของทุก payload,
  restore exact bytes เฉพาะรายการ `original_existed=true` และคืน original absence เฉพาะรายการ
  `original_existed=false`. ห้ามแตะ evidence หรือ path นอก manifest
- Repair CLI **ยังไม่มี restore subcommand**; การ restore จึงต้องใช้ approved backup tooling ใน
  maintenance window พร้อม second-person review หรือ operator procedure ที่ให้ผล atomic เทียบเท่า
- ถ้า `503` มาจาก API update จะไม่มี persistent identity-sync backup ใหม่โดยอัตโนมัติ เพราะ API ใช้
  in-memory rollback เท่านั้น ให้กู้จาก approved external backup หลัง snapshot/forensic comparison
- หลัง recovery ให้ตรวจ manifest digests/state, รัน default dry-run และตรวจ consistency ตาม stable ID.
  อย่า apply ซ้ำจนกว่าจะเข้าใจสาเหตุและ dry-run ผ่าน

> **Production status:** workflow นี้ยังไม่ได้ใช้กับ production; ณ 2026-08-26 ไม่มี production
> migration, repair dry-run, repair apply หรือ deployment ของ person identity synchronization

---

## 25. หมวดกล้องทางเข้ากองร้อย สัญญาณภาพขาดหายทั้งหมด (D_BPP215_1 ถึง D_BPP215_4) / RTSP Bridge WSL2 Network Timeout

### อาการ
- กล้องทางเข้ากองร้อยทั้ง 4 ตัว (`D_BPP215_1`, `D_BPP215_2`, `D_BPP215_3`, `D_BPP215_4`) ขึ้น VIDEO LOSS บน Dashboard
- go2rtc log แสดง error `Invalid data found when processing input` หรือ ffmpeg 404
- ไม่สามารถรับ stream จาก `host.docker.internal:8556`

### วิธีวินิจฉัย
1. ตรวจสอบพอร์ต 8556 บน Windows Host:
   ```powershell
   Get-NetTCPConnection -LocalPort 8556 -ErrorAction SilentlyContinue
   ```
2. ตรวจสอบ process ที่ถือครองพอร์ต หากถูกถือครองโดย `com.docker.backend.exe` หรือ Docker container `rtsp-bridge`
3. ทดสอบการเชื่อมต่อไปยัง Dahua NVR (ปัจจุบัน `192.168.1.17:554`, เดิม `192.168.1.11:554` / `192.168.1.25:554`):
   ```powershell
   Test-NetConnection -ComputerName 192.168.1.17 -Port 554
   ```
4. หาก NVR มีการรีบูตและได้ IP ใหม่จาก DHCP สามารถแสกนหาพอร์ต Dahua Media (37777) บน subnet 192.168.1.0/24:
   ```powershell
   node -e "const net = require('net'); for(let i=1;i<=254;i++){ const s = net.connect(37777, '192.168.1.'+i); s.on('connect', ()=>{console.log('Dahua NVR found:', '192.168.1.'+i); s.destroy();}); s.on('error', ()=>{}); }"
   ```

### Root cause ที่ยืนยัน
1. คอนเทนเนอร์ Docker `rtsp-bridge` เข้าไป bind พอร์ต 8556 บน Windows Host แต่เน็ตเวิร์ก WSL2 ไม่สามารถเชื่อมต่อไปยัง Physical LAN IP ได้ (100% packet loss) ขัดขวางไม่ให้ Native Node.js RTSP Proxy บนโฮสต์ทำงาน
2. IP Address ของเครื่องบันทึก Dahua NVR มีการเปลี่ยนแปลงตาม DHCP (จากเดิม `192.168.1.25` -> `192.168.1.11` -> `192.168.1.17`) ทำให้ RTSP Proxy เดิมต่อไม่ติด
3. ไฟล์ `scripts/rtsp_bridge_watchdog.ps1` และ `scripts/start_rtsp_proxy.vbs` มี hardcoded path เก่า `D:\VMS-215` แทนที่จะเป็นไดเรกทอรีจริง `D:\BPP-VMS` เมื่อรีสตาร์ตเครื่อง Windows Startup พยายามรัน script แต่ไม่พบไฟล์ ทำให้ `node.exe rtsp_proxy.js` ไม่ทำงาน พอร์ต 8556 จึงปิดสนิท

### วิธีแก้
1. ปิดและลบคอนเทนเนอร์ `rtsp-bridge` ออกจาก `docker-compose.yml` ถาวร
2. รัน RTSP Bridge บน Windows Host โดยตรงผ่าน `node scripts/rtsp_proxy.js` (เปิดฟังที่ 0.0.0.0:8556 และส่งต่อไปยัง Dahua NVR 554)
3. ใส่ระบบ **Autonomous Subnet Discovery** ลงใน `scripts/rtsp_proxy.js` โดยเมื่อพบ upstream error จะแสกนหาพอร์ต 37777 บน subnet `192.168.1.0/24` อัตโนมัติ (ใช้เวลา ~600ms) และบันทึกลง `runtime/nvr_ip.txt` ทันทีโดยไม่ต้องแก้คอนฟิกด้วยตนเอง
4. ปรับปรุง `scripts/rtsp_bridge_watchdog.ps1` และ `scripts/start_rtsp_proxy.vbs` ให้คำนวณพาธไดเรกทอรีและ node.exe แบบ dynamic (`$MyInvocation` / `fso.GetParentFolderName`) ไม่พึ่งพา hardcoded drive path
5. เพิ่ม single-instance mutex (`Global\BPP_VMS_RTSP_Bridge_Watchdog`) และลงทะเบียน Windows Scheduled Task `BPP-RTSP-Bridge-Watchdog` ให้เปิดทำงานตลอดเวลาและรีสตาร์ตตัวเองอัตโนมัติเมื่อเครื่องบูตหรือผู้ใช้ล็อกอิน

### วิธีป้องกัน
- กำหนด Static IP หรือ DHCP Reservation บน Router ให้กับ Dahua NVR MAC `3c-e3-6b-04-41-aa`
- ให้ระบบพึ่งพา Autonomous Subnet Discovery ใน `scripts/rtsp_proxy.js` ซึ่งตรวจจับและสลับ IP ให้อัตโนมัติในระดับมิลลิวินาที
- ห้ามนำ service ที่ต้องเชื่อมต่อไปยังอุปกรณ์ Physical LAN โดยตรงไปรันเป็น Docker container ใน WSL2 โดยไม่มี host routing ที่รองรับ
- รักษาระบบ watchdog ผ่าน Windows Scheduled Task (`BPP-RTSP-Bridge-Watchdog`) ควบคู่กับ Startup shortcut เพื่อการทำงานที่ไม่สะดุดหลังรีบูตเครื่อง

---

## 26. สถานะ 'เข้าถึง Sloth BPP 215 ไม่ได้' และวิดีโอดับทุกกล้อง (502 Bad Gateway หลังรีสตาร์ต Frigate)

### อาการ
- หน้าเว็บแสดงแถบแดง *"เข้าถึง Sloth BPP 215 ไม่ได้"*
- กล้องสด WebRTC ไม่ขึ้นภาพ
- API routes `/nvr/` ส่งคืน `502 Bad Gateway`
- NGINX error log มีข้อความ: `113: Host is unreachable while connecting to upstream, upstream: "http://172.25.0.X:5000/api/version"`

### วิธีวินิจฉัย
1. ตรวจสอบ IP ของคอนเทนเนอร์ `frigate-nvr`:
   ```bash
   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' frigate-nvr
   ```
2. เทียบกับ upstream IP ใน NGINX error log:
   ```bash
   docker logs nvr-dashboard --tail 50
   ```
   ถ้า upstream IP ไม่ตรงกับ container IP ปัจจุบัน แสดงว่า NGINX ติด DNS caching

### Root cause ที่ยืนยัน
NGINX directive `proxy_pass http://frigate:5000/` (แบบใช้ static hostname ตรงๆ) ทำ DNS lookup เพียงครั้งเดียวตอน NGINX startup. เมื่อคอนเทนเนอร์ `frigate-nvr` ถูกรีสตาร์ต Docker IPAM กำหนด IP ใหม่ (เช่น เปลี่ยนจาก 172.25.0.7 เป็น 172.25.0.2) แต่ NGINX ยังส่ง request ไปยัง IP เดิมที่ไม่มีอยู่แล้ว ทำให้เกิด Host unreachable

### วิธีแก้
แก้ไข `dashboard-nginx.conf` ในทุก proxy block ที่ส่งไป Frigate ให้ใช้ Dynamic DNS Resolver ของ Docker:
```nginx
resolver 127.0.0.11 valid=10s ipv6=off;
set $frigate_backend "frigate:5000";
proxy_pass http://$frigate_backend;
```
การส่งผ่านตัวแปร `$frigate_backend` จะบังคับให้ NGINX ทำ re-resolve ผ่าน Docker embedded DNS (`127.0.0.11`) ทุก 10 วินาที

---

## 27. เข้าหน้าเว็บไม่ได้ผ่าน URL เก่า *.trycloudflare.com (DNS_PROBE_FINISHED_NXDOMAIN)

### อาการ
- เมื่อคลิกลิงก์เข้าสู่ระบบผ่าน Edge Proxy หรือ shortcut เดิม บราวเซอร์ขึ้น `DNS_PROBE_FINISHED_NXDOMAIN`
- URL ที่เข้าเป็นโดเมนชั่วคราวสุ่มของ Cloudflare Quick Tunnels เช่น `rpg-monica-sims-girlfriend.trycloudflare.com`

### Root cause
โปรเจกต์ได้ย้ายไปใช้ **Cloudflare Named Tunnel แบบถาวรบนโดเมนทางการ `vms.local`** แล้ว แต่ยังมีไฟล์บางส่วน (เช่น Vercel Edge Proxy ใน `public/index.html`, `api/proxy.js`, `runtime/cloudflare_tunnel_url.txt`) ที่ยังมี URL `*.trycloudflare.com` เก่าค้างอยู่

### วิธีแก้
1. ค้นหาและแทนที่ URL เก่าด้วย `https://vms.local/` ในทุกไฟล์
2. ล็อค `scripts/rtsp_bridge_watchdog.ps1` ให้บันทึกเฉพาะ `https://vms.local/` ลงใน `runtime/cloudflare_tunnel_url.txt`
3. เผยแพร่และแจ้งผู้ใช้งานให้บันทึก Bookmark เฉพาะโดเมนหลัก `https://vms.local/` เท่านั้น

---

## 28. แผนที่ฮีทแมพกดดูรายละเอียดบางพื้นที่ไม่ขึ้น ("ไม่พบรายงานเหตุการณ์ในพื้นที่") หรือไม่มีปุ่มกดดูแฟ้ม/ข้อมูลเพิ่มเติม

### อาการ
- คลิกที่บางอำเภอหรือจุดวางงานบนแผนที่ฮีทแมพแล้ว modal แจ้งว่า `"ไม่พบรายงานเหตุการณ์ในพื้นที่"` ทั้งที่มีรายงานคดีในอำเภอนั้น
- ในหน้ารายละเอียดพื้นที่ ข้อมูลแสดงเป็นข้อความตัวหนังสือล้วน ไม่มีปุ่มสำหรับเปิดดูแฟ้มประวัติบุคคล (Dossier), ดูรายละเอียดเหตุการณ์ฉบับเต็ม, หรือเปิดผังเครือข่าย i2
- เมื่อซูมแผนที่ระดับ 12 ขึ้นไป รูปแปลงเขตพื้นที่ (Polygons) หายไปทั้งแผนที่
- อำเภอเฉลิมพระเกียรติคลิกแล้วไม่พบคดี

### Root cause
1. **Query Prefix Mismatch:** `analytics.js` ส่งชื่ออำเภอพร้อมคำนำหน้า เช่น `"อำเภอนางรอง"` ไปค้นหาที่ `/api/nas-bot/search?q=...` ซึ่งฐานข้อมูลจัดเก็บที่อยู่เป็น `"อ.นางรอง"` หรือ `"นางรอง"` ทำให้ค้นพบเพียง 9 รายการจากทั้งหมด 56 รายการ
2. **Strict Category Filter Masking:** หน้ารายละเอียดพื้นที่กรองเฉพาะประเภทคดีที่เลือกไว้บนแผนที่ (Default: `'drug'`) หากพื้นที่นั้นมีเฉพาะคดีอาวุธปืนหรือบุคคลต่างด้าว ข้อมูลจะถูกกรองทิ้งจนหมด
3. **Missing Interactive Action Buttons:** ไม่ได้ติดตั้งปุ่มเชื่อมโยงไปยัง `window.openDossierDetail`, `window.openChatIncidentDetailModal`, `window.openI2Graph`, และการเปิดดูไฟล์แนบคดีใน NAS
4. **Subdistrict GeoJSON Missing on Zoom:** ใน `onMapZoom()`, เมื่อซูม >= 12 ระบบลบ `choroDistrict` และพยายาม fetch `/assets/geo/buriram_subdistrict.geojson` ซึ่งไม่มีอยู่จริง (404) ทำให้เลเยอร์โพลีกอนหายไปทั้งหมด
5. **GeoJSON Typo:** ใน `buriram_district.geojson` มีการสะกดชื่ออำเภอตกสระอิเป็น `"เฉลิมพระเกียรต"`

### วิธีแก้
1. นำเข้าฟังก์ชัน `normalizeDistrictName(rawName)` ใน `analytics.js` ตัดคำนำหน้า (`อ.`, `ต.`, `อำเภอ`, `ตำบล`), สกัดชื่ออำเภอจากที่อยู่จุดวางงาน และแปลงชื่ออำเภอเฉลิมพระเกียรติ จากนั้นส่งชื่ออำเภอที่ Clean ไปค้นหาที่ `/api/nas-bot/search`
2. เพิ่มแท็บตัวกรองหมวดหมู่ภายใน Modal (`[ทั้งหมด]` `[ยาเสพติด]` `[อาวุธปืน]` `[ต่างด้าว]` `[ทั่วไป]`) พร้อม badge จำนวนนับสด สลับดูได้ทันทีโดยไม่ต้องปิด modal
3. ติดตั้ง Action Buttons บนการ์ดทุกใบ: `🗂️ เปิดแฟ้ม Dossier`, `👁️ รายละเอียดฉบับเต็ม`, `🌐 ดูในผัง i2`, และ `📂 ดูไฟล์แนบคดี`
4. เพิ่ม Event Delegation ใน `analytics.js` สำหรับปุ่ม `.btn-view-nas-files` เพื่อเรียกดูและดาวน์โหลดไฟล์ภาพ/เอกสารพยานหลักฐานจาก NAS ได้โดยตรง
5. ปรับปรุง `onMapZoom()` ให้คงเลเยอร์อำเภอไว้ (`ระดับ: อำเภอ (ขยาย)`) หากไฟล์ตำบลไม่พร้อมใช้งาน
6. แก้ไข typo ใน `buriram_district.geojson` เป็น `"เฉลิมพระเกียรติ"` และ bump cache buster เป็น `analytics.js?v=9`

---

## 29. กล้องทางเข้ากองร้อยหมุนโหลดค้าง / ไม่ขึ้นภาพบน Dashboard (Imou Wireless NVR 3-Camera Channel Mapping & Empty CH4)

### อาการ
- กล้องทางเข้ากองร้อยบน Dashboard ขึ้นสถานะ BUFFERING หรือหมุนโหลดค้างไม่ขึ้นภาพ โดยเฉพาะช่องที่ 4
- กล้องทางเข้ากองร้อย 1 หายไปจากหน้าแรกของตาราง 2x2
- Frigate log มี ffmpeg exit status 1 ซ้ำๆ ทุก 5 วินาที สำหรับกล้อง `D_BPP215_4`

### Root cause
1. **ฮาร์ดแวร์ NVR มีกล้องจริงเพียง 3 ตัว:** เครื่องบันทึกเป็น Imou Wireless Recorder (รุ่น `NVR1104HS-W-S2`) ซึ่งมีกล้องไร้สาย Imou Bullet 2C (`IPC-F22`) จับคู่อยู่เพียง 3 ตัว (Channel 1, 2, 3) ส่วน Channel 4 ว่างเปล่า (`Enable=false`, `Address=192.168.0.0`)
2. **FFmpeg Crash Loop บน Frigate:** `config/config.yml` เปิด `D_BPP215_4` (`enabled: true`, `detect: true`, `record: true`) ทำให้ Frigate พยายามดึง RTSP Channel 4 ที่ไม่มีกล้องและแครชวนซ้ำ
3. **Dashboard Channels Mapping สลับตำแหน่ง:** ใน `config/dashboard-settings/channels.json` ช่องแรก (CH01) กลายเป็น `KK06` (ซอยหน้าบ้านไอ้โจ้) ทำให้ `D_BPP215_1` หลุดไปอยู่ช่อง 5 (CH05) ซึ่งอยู่นอกจอของ Grid 2x2 และช่อง 4 ใน Grid ถูกแทนที่ด้วย `D_BPP215_4` ที่ไม่มีกล้องจริง
4. **User Profile Hidden Channels:** บัญชีผู้ใช้งาน `tangmo` ใน `user_profiles.json` มีการซ่อน `D_BPP215_1..4` อยู่

### วิธีแก้
1. **ปิด Channel 4 ใน Frigate:** แก้ไข `config/config.yml` ให้ `D_BPP215_4` มี `enabled: false`, `detect.enabled: false`, `record.enabled: false`
2. **จัดเรียง Grid ลำดับช่อง Dashboard:** อัปเดต `config/dashboard-settings/channels.json` ให้ CH01=`D_BPP215_1`, CH02=`D_BPP215_2`, CH03=`D_BPP215_3`, CH04=`KK06` และกำหนด `D_BPP215_4` ให้ `enabled: false`
3. **ล้างค่า Hidden Channels:** ตรวจสอบและลบกล้องทางเข้ากองร้อยออกจาก `hidden_channels` ใน `user_profiles.json`
4. **รีสตาร์ต Services:** รีสตาร์ต Frigate container และ reload NGINX dashboard
5. **ตรวจสอบผล:** ยืนยันผ่าน WebRTC Substream (H.264 640x480) ภาพสดไหลลื่นทั้ง 3 ช่องทางเข้ากองร้อย

---

## Escalation checklist

ก่อนสรุปว่าเป็น application bug ให้ตรวจ:

1. `docker ps`
2. Frigate health
3. `nvidia-smi`
4. disk free
5. `.env` placeholders
6. upstream stream ด้วย FFmpeg ตรง
7. go2rtc producer state
8. Frigate logs
9. Dashboard/nginx logs
10. GitHub deploy commit ล่าสุด
11. browser network response และ CSRF header สำหรับ write API
12. `/auth/session` role/expiry และ auth-service availability
13. shared-secret holders ถูก recreate ครบหลัง rotation
14. Federation source CIDR/TLS assertion
15. Config transaction backups/lock/filesystem health
16. Windows ACL มี approved runtime principal และไม่มี broad local-user access

## Related documents

- [Operations](operations.md)
- [Security Model](security-model.md)
- [Architecture](architecture.md)
- [History](history.md)
