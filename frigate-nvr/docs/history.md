# Project History

## 2026-08-09 Multi-site release and offline update tooling

- implemented unencrypted manifest-verified migration TARs with explicit retained
  state and captured-media/old-identity exclusions
- added disabled-camera Clone and camera-empty NewSite profiles with per-node local TLS
- added local-only Windows install/autostart and semantic offline update rollback
- added one-click BAT launchers, Thai guidance and portable fixture regression tests
- built and fully verified the real production v1.0.0 TAR, then restored all 12
  source services with Frigate config, host/container GPU and HTTPS checks passing
- first clean target-machine acceptance remains the next external release gate

- **Status:** HISTORICAL · **Last reconciled:** UNRECONCILED (structure retrofit only) · **Evidence:** git history, `docs/sessions/`

เอกสารนี้เก็บ timeline ของการเปลี่ยนแปลงสำคัญในระดับระบบ ไม่ใช้แทน current state

> เมื่อข้อมูลปัจจุบันขัดกับ timeline ให้ดู `current-state.md` และโค้ดจริง

## 2026-06-21

- ใช้งาน production เดิมบน Ubuntu/LAN เก่า
- ตั้งค่ากล้องเดิมและ Frigate UI/branding รุ่นแรก
- มีการจัดการ WebRTC และ network access ใน environment เดิม

รายละเอียดเดิมเก็บไว้ใน session log รุ่นก่อนหน้า/ประวัติ Git

## 2026-07-02

- ย้ายฐานอ้างอิงไป production environment ใหม่บน Windows + Docker Desktop
- เพิ่ม `cam11` จาก external RTMP source
- เพิ่ม Dashboard v2 / Security Ops
- เพิ่ม service `dashboard` บน nginx port 8080
- เพิ่ม same-origin proxy `/nvr/` ไป Frigate API เพื่อหลีกเลี่ยง CORS
- เริ่มแยก application UI ออกจาก Frigate UI

## 2026-07-03

- ขึ้น production ใหม่จริง
- debug `cam11` ที่ reconnect เป็นช่วงคงที่
- ยืนยันว่า native RTMP client ของ go2rtc เป็นสาเหตุใน environment นี้
- เปลี่ยนเป็น FFmpeg RTMP producer wrapper
- เพิ่ม custom storage threshold patch
- ใช้ GPU inference และ CUDA cache persistence

## หลัง 2026-07-03 ถึง 2026-07-10

- Dashboard พัฒนาต่อจาก live view ไปสู่ event investigation และ media tooling
- เพิ่ม tracked object details
- เพิ่ม media capture / camera provisioning
- เพิ่ม digital zoom สำหรับ recorded video
- ปรับ UI settings และ OSS notices
- เปลี่ยนชื่อผลิตภัณฑ์เป็น **Ai CCTV Surveillance Platform**
- model path ปัจจุบันเปลี่ยนมาใช้ YOLO11m 640x640
- tracked object set ขยายเกิน person-only

## 2026-07-10 GPU-lost incident

- production host พบ NVIDIA GPU lost/no adapters state
- ยืนยันว่า `wsl --shutdown` ไม่สามารถกู้ state นี้ได้
- วิธีแก้หลักคือ reboot Windows
- สรุปวิธี CPU fallback ชั่วคราว
- เพิ่มแนวทาง boot GPU-race hardening ใน machine-local autostart script

## 2026-07-11 Documentation restructure

- แยก `CLAUDE.md` จากเอกสารรวมทุกเรื่องให้เป็น entry point และ guardrails
- เพิ่ม documentation index
- เพิ่ม current state, architecture, operations, troubleshooting และ history
- กำหนด ADR และ session log structure สำหรับการพัฒนาในอนาคต

## 2026-07-23 Security and reliability hardening

- เปลี่ยน browser auth เป็น Secure/HttpOnly/SameSite=Strict session และเลิกส่ง JWT ให้ JavaScript
- ปิด default admin; เพิ่ม one-time secure bootstrap และ password/JWT rotation
- บังคับ server-side RBAC สำหรับ Settings, Config, Watchlist mutation/export และ Frigate config/restart
- ปิด stored XSS paths ด้วย DOM `textContent` + CSP
- แยก internal capability secrets และปิด Federation แบบ fail closed ด้วย secret + proxy + VPN/mTLS assertion + minimized active-only fields
- เพิ่ม config transaction แบบ lock/validation/backup/atomic replace/rollback
- แก้ Discord worker separation และส่ง LPR `best_score` เข้า Watchlist history
- ย้าย Nongwang credential ออกจาก tracked YAML; upstream device password rotation ยังเป็น external action
- ล้าง orphan go2rtc streams 10 รายการ เหลือ 14 cameras/28 streams
- pin Frigate/Python/nginx/LPR/Chart.js และ Config API dependencies
- ล้าง generated dumps/logs/test variants/stale patch artifacts และเพิ่ม ignore patterns
- ลด Frigate จาก privileged เป็น `no-new-privileges`, mask sibling-service paths และจำกัด Windows host ACL
- จำกัด camera URL credentials เป็น `{FRIGATE_*}` placeholders และล้าง browser credentials ก่อนส่ง Frigate/Watchlist/Federation
- เพิ่ม Auth/Watchlist/Config/LPR/security/browser test coverage

รายละเอียด: [`sessions/2026-07-23-security-hardening.md`](sessions/2026-07-23-security-hardening.md)

## 2026-08-02 Verified new-camp installer

- คืน storage threshold patch ที่บังคับ reserve พื้นที่ว่างขั้นต่ำ 15% และให้ image build ล้มทันทีหาก source drift
- สร้าง source ของ EXE และ package builder ที่ส่งมอบ tree ครบพร้อม SHA-256 manifest
- แก้ model path, one-time admin credential handoff และ deploy failure handling ให้ตรงกับ runtime จริง
- กำหนดให้ release gate ต้องมี live Docker build/clean-host installation ก่อนใช้งาน production

## 2026-08-02 GUI installer and account migration

- เพิ่ม Windows Forms installer ให้เลือก local install folder และตั้ง Web Admin credential เอง
- เพิ่ม encrypted `.bppusers` transfer ที่คง bcrypt hash/role/active ของผู้ใช้เดิม แต่ไม่ย้าย JWT/session/audit
- เพิ่ม stable Compose project identity สำหรับ GUI installation ใหม่ และ validation ของ destination/manifest ก่อน deploy

## 2026-08-07 Stream performance and remote video

- เลิก software transcode ทั้งระบบ — go2rtc main เป็น `#video=copy`, sub เป็น NVENC และเพิ่ม `<cam>_hd` แบบ on-demand; CPU ของ frigate ลดจาก ~1247% เหลือหลักร้อยต้น และ libx264 process เหลือศูนย์
- แก้ WebRTC candidate ให้ตรง LAN IP จริง, nginx ใช้ `$http_host` เพื่อรองรับการเข้าผ่านพอร์ตภายนอก
- เปลี่ยนไปใช้ Let's Encrypt จริงผ่าน DuckDNS DNS-01 พร้อม hook ที่ reload nginx อัตโนมัติหลังต่ออายุ
- ย้าย git root ขึ้น `D:\BPP-VMS` และเปลี่ยน remote เป็น `itbpp215-creater/VMS-215`

## 2026-08-08 Security audit, production outage, and remote video verified

- **Incident:** ทั้ง stack ดับ 6 ชม. 39 นาที โดยเครื่องไม่ได้ reboot — Docker Desktop Resource Saver หยุด WSL VM เองตอน idle และ `restart: unless-stopped` ปลุกกลับไม่ได้เพราะ engine หายไปทั้งตัว วิดีโอช่วงนั้นหายถาวร; ปิด Resource Saver แล้วและบันทึกใน troubleshooting #22
- ตรวจทั้งแผน stream-performance/remote-video ด้วยผู้ตรวจหลายด้านที่ทุกข้อค้นพบต้องผ่านด่านหักล้างแบบ adversarial — ยืนยัน 15 ข้อ หักล้างทิ้ง 21 ข้อ
- **ปิดช่องโหว่ 3 จุด:** frigate/config-api อ่าน TLS private key และ DuckDNS token ได้ผ่าน `/config/acme` ที่ไม่ถูก mask; nas-bot เขียน Telegram bot token ลง log ทุก 31 วินาที; `/nvr/api/go2rtc` ส่งรหัสผ่าน RTSP ของ DVR ให้ผู้ใช้ที่ไม่ใช่ admin
- แก้บั๊กที่ทำให้ลบกล้องแล้วเหลือ `<name>_hd` ค้าง, fallback ไปสตรีม HEVC ที่เล่นไม่ได้, และกล้องที่เปิดโดยปิด AI แล้วไม่บันทึกวิดีโอ
- **การดูผ่าน internet ใช้งานได้จริง** — forward UDP+TCP 8555 ที่ router แล้วยืนยันการดูผ่าน 4G นอก LAN ปิดแผน Fix A–D ครบทุกข้อ

## วิธีเพิ่ม timeline

เพิ่มเฉพาะเหตุการณ์ที่มีผลระดับระบบ เช่น:

- ย้าย production host
- เปลี่ยน AI model/runtime
- เปลี่ยน architecture
- เปลี่ยน deployment strategy
- incident สำคัญ
- feature milestone ใหญ่

รายละเอียดการทำงานรายวันให้บันทึกใน `docs/sessions/` แทน
