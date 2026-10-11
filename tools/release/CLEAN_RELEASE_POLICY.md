# กฎเหล็กและนโยบายเผยแพร่ระบบฉบับสะอาด (Clean Release Policy)
**ระบบ BPP-VMS — กฎเกณฑ์และข้อกำหนดการคัดแยกโค้ดระหว่าง ตชด.215 และ Clean Distribution Repo**

---

## ⚠️ กฎเหล็กบังคับใช้ทุกครั้ง (MANDATORY DIRECTIVES)

1. **ห้ามข้อมูลเฉพาะของ ตชด.215 หลุดออกไปเด็ดขาด (Zero-BPP215 Leak):**
   - ห้ามนำ IP กล้อง, ลิงก์ RTSP, รหัสผ่าน DVR/NVR ทุกตัวของ ตชด.215 เข้าสู่ Clean Repo
   - ห้ามนำข้อมูล Synology NAS (IP, Share Name, รหัสผ่าน) เข้าสู่ Clean Repo
   - ห้ามนำ Google Gemini API Key ส่วนตัว หรือ Telegram Bot Token / Chat ID เข้าสู่ Clean Repo
   - ห้ามนำบัญชีแผ่นป้ายทะเบียนเฝ้าระวัง (Suspect Watchlist) เข้าสู่ Clean Repo
   - ห้ามนำโดเมนภายใน (`sloth.bpp215.com`, `bpp215.com`) และ Cloudflare/Tailscale Token เข้าสู่ Clean Repo

2. **ระบบต้องสามารถติดตั้งและรันได้ทันที (Out-of-the-Box Stability):**
   - Clean Repo ต้องมี Template คอนฟิกที่ครบถ้วน (`config.clean.yml`, `.env.clean`)
   - หากผู้ใช้เครื่องใหม่ยังไม่มีคีย์เสริม (Gemini, Telegram, NAS) ระบบต้องไม่แครช (Graceful Fallback)
   - หน้าเว็บและระบบพื้นฐานต้องเปิดใช้งานได้ 100%

3. **ต้องผ่านการตรวจสอบความปลอดภัยระดับเครื่อง (Local Pre-Push Gate) เสมอ:**
   - ห้าม Push ตรงไปยัง Clean Distribution Repo โดยไม่ผ่านสคริปต์ `Sync-CleanRelease.ps1`
   - สคริปต์จะทำการตรวจสอบคำต้องห้าม (Pattern Scan / Security Linter) หากพบความเสี่ยง จะระงับการ Push ทันที

---

## 📊 ตารางการคัดแยกไฟล์ (File Classification Matrix)

| ส่วนประกอบ | ฝั่ง BPP215 (Internal Dev) | ฝั่ง VMS-Clean (Distribution Repo) |
| :--- | :--- | :--- |
| **Git Remote** | `origin` (`itbpp215-creater/VMS-215`) | `release` (`itbpp215-creater/VMS-Clean`) |
| **config.yml** | เก็บกล้องจริงของ ตชด.215 ทั้งหมด | แทนที่ด้วย `config.clean.yml` (กล้องตัวอย่าง 1 ตัว ปิดไว้) |
| **.env** | เก็บคีย์และรหัสผ่านจริงของ ตชด.215 | **ไม่รวม .env** (มีเฉพาะ `.env.example` ฉบับสะอาด) |
| **กล้อง/พิกัด** | `camera_sources.json`, `cam_list.tsv` | **ล้างออกทั้งหมด** (เหลือไฟล์เปล่าแบบถูกหลักไวยากรณ์) |
| **ป้ายทะเบียนเฝ้าระวัง** | `suspect_plates.txt` ข้อมูลจริง | **ไฟล์ว่างเปล่า** (พร้อมคอมเมนต์วิธีเพิ่มป้าย) |
| **n8n Workflow** | เวิร์กโฟลว์พร้อมคีย์ในเครื่อง | ปลด hardcoded Gemini API key ออก ให้ถามคีย์ผู้ใช้ |
| **คู่มือการใช้งาน** | คู่มือสำหรับ ตชด.215 | เพิ่ม `CLEAN_INSTALL_GUIDE_TH.md` และ `clean_install_guide.html` |
| **สคริปต์ติดตั้ง** | `Setup_New_Machine.bat` | `Setup_New_Machine.bat` ถามคีย์แบบสุภาพ ข้ามได้ |

---

## 🔒 คำและรูปแบบต้องห้าม (Blocked Signatures & Patterns)

ระบบตรวจสอบความปลอดภัย (Pre-Push Gate) จะสแกนค้นหารูปแบบต่อไปนี้ หากพบจะทำการบล็อกทันที:
1. `AQ.Ab8RN6...` (Default Gemini Key เก่าในประวัติ)
2. `sloth.bpp215.com` (โดเมนเฉพาะ ตชด.215)
3. `192.168.1.115` (IP ของ Synology NAS ตชด.215)
4. `Bpp215#2026` (รหัสผ่าน NAS เดิม)
5. ลิงก์ RTSP ที่ชี้ไปยัง IP กล้องจริงของหน่วย เช่น `10.11.` หรือโดเมนกล้องภายใน
6. `CLOUDFLARE_TUNNEL_TOKEN` ที่ไม่ใช่ค่า `none_local_only`
