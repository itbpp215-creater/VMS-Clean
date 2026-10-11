# คู่มือการเชื่อมต่อกล้อง TP-Link VIGI, Edge LPR และหน่วยงานภายนอก (BPP-VMS)

> **ฉบับปรับปรุง:** กันยายน 2026  
> **ระบบ:** BPP-VMS (Border Patrol Police Video Management System)  
> **วัตถุประสงค์:** แนะนำการเชื่อมต่อกล้อง TP-Link VIGI, กล้องตรวจจับป้ายทะเบียนเฉพาะทาง (Dahua ITC / VIGI LPR), และการดึงสัญญาณภาพจากหน่วยงานภายนอกที่ไม่มี Public IP (CGNAT) เข้าสู่ศูนย์บัญชาการ BPP-VMS โดยไม่ต้องติดตั้งเราเตอร์ MikroTik เพิ่มเติม

---

## 1. ภาพรวมสถาปัตยกรรม (Architecture Overview)

ระบบ BPP-VMS ออกแบบการประมวลผลเป็นแบบ **Hybrid Intelligence**:
1. **กล้องทั่วไป (General CCTV):** ส่ง RTSP เข้ามา -> ถอดรหัสภาพและประมวลผลโมเดล AI (YOLOv8 + LPR) บนเซิร์ฟเวอร์
2. **กล้องอัจฉริยะ (TP-Link VIGI Smart AI):** มีชิป AI ในตัวกล้องตรวจจับคน/ยานพาหนะอยู่แล้ว -> BPP-VMS ปิด Server AI (`detect.enabled: false`) ช่วยประหยัด CPU/GPU ของเซิร์ฟเวอร์ได้ 100% แต่ยังคงบันทึกวิดีโอ 24/7 และดูภาพสดได้สมบูรณ์
3. **กล้องตรวจจับป้ายทะเบียนเฉพาะทาง (Dahua ITC / VIGI LPR):** กล้องอ่านป้ายและตัดภาพรถด้วยตัวเอง -> ยิงข้อมูลผ่าน **Edge LPR Webhook** เข้าเซิร์ฟเวอร์ -> ระบบนำผลไปตรวจสอบกับฐานข้อมูลรถเฝ้าระวัง (Watchlist DB) และส่งแจ้งเตือน Telegram ทันทีภายในเวลาต่ำกว่า 50 มิลลิวินาที

```
+-----------------------------------------------------------------------------------+
|                           หน่วยงานภายนอก (Behind CGNAT / 4G)                       |
|                                                                                   |
|  [ กล้อง Dahua ITC LPR ] ------(HTTPS Webhook Push :443)------+                   |
|                                                               |                   |
|  [ กล้อง TP-Link VIGI ]                                       |                   |
|           | (RTSP วงแลน)                                      |                   |
|           v                                                   v                   |
|  [ เครื่อง VIGI NVR ] ----(RTMP Outbound Push :1935)-----> [ BPP-VMS Gateway ]   |
|         หรือ                                                  |                   |
|  [ PC: BPP NVR Bridge ] --(RTMP Outbound Push :1935)---------+                   |
|                                                                                   |
|  * ไม่ต้องมี Public IP / ไม่ต้อง Forward Port / ไม่ต้องซื้อเราเตอร์ MikroTik      |
+-----------------------------------------------------------------------------------+
                                                                |
                                                                v
                                                  +---------------------------+
                                                  |    BPP-VMS Central Hub    |
                                                  | - Admin Gatekeeper        |
                                                  | - Watchlist Instant Match |
                                                  | - Telegram Photo Alert    |
                                                  | - 24/7 NVR Recording      |
                                                  +---------------------------+
```

---

## 2. การเชื่อมต่อกล้อง TP-Link VIGI (Standalone & NVR)

### 2.1 โครงสร้าง RTSP URL ของ TP-Link VIGI
กล้องและเครื่องบันทึก VIGI ใช้พอร์ตมาตรฐาน **554** โดยมีรูปแบบ URL ดังนี้:

* **กล้อง Standalone (ต่อตรงรายตัว):**
  * Main Stream (คมชัดสูง): `rtsp://{username}:{password}@{ip}:554/stream1`
  * Sub Stream (ลื่นไหล/ประหยัดแบนด์วิดท์): `rtsp://{username}:{password}@{ip}:554/stream2`
* **ดึงผ่านเครื่องบันทึก VIGI NVR (Multi-Channel):**
  * ช่องที่ 1: `rtsp://{username}:{password}@{nvr_ip}:554/ch1/stream2`
  * ช่องที่ 2: `rtsp://{username}:{password}@{nvr_ip}:554/ch2/stream2`
  * ช่องที่ N (เช่น ถึง 16): `rtsp://{username}:{password}@{nvr_ip}:554/ch16/stream2`

> **ข้อแนะนำ:** สำหรับการดึงหลายกล้องผ่าน NVR แนะนำให้ใช้ `/stream2` (Sub Stream) เพื่อให้การส่งผ่านเครือข่ายลื่นไหลและไม่หน่วงแบนด์วิดท์

### 2.2 การตั้งค่าบนหน้าเว็บ BPP-VMS
1. ไปที่เมนู **ตั้งค่าระบบ (Admin)** > แท็บ **กล้องในระบบ (NVR)**
2. คลิกปุ่ม **เพิ่มกล้องใหม่**
3. ในช่อง **ประเภทกล้อง (Preset):** เลือก **TP-Link VIGI (Smart AI)**
   * ระบบจะปิดฟังก์ชัน AI บนเซิร์ฟเวอร์ (`detect.enabled: false`) ให้โดยอัตโนมัติ เพื่อไม่ให้เปลืองโหลด CPU/GPU
4. ใส่ชื่อกล้อง และวาง RTSP URL ลงในช่อง **RTSP URL (Main Stream)**
5. กดปุ่ม **ตกลง** เพื่อบันทึก

---

## 3. การเชื่อมต่อกล้องตรวจจับป้ายทะเบียน Dahua ITC (Edge LPR Webhook)

### 3.1 Webhook URL ของระบบ BPP-VMS
ระบบมี Endpoint สำหรับรับข้อมูลป้ายทะเบียนและภาพถ่ายจากตัวกล้องโดยตรง:
```
https://[SERVER_DOMAIN_OR_IP]/api/lpr/camera-webhook?token=bpp_secret_2026
```
*(กรณีทดสอบในเครื่อง สามารถใช้ `https://localhost/api/lpr/camera-webhook?token=bpp_secret_2026`)*

### 3.2 ขั้นตอนการตั้งค่าบนหน้า Web UI ของกล้อง Dahua ITC
1. เปิดเบราว์เซอร์แล้วพิมพ์ IP ของกล้อง Dahua ITC และเข้าสู่ระบบ (เช่น `admin / รหัสผ่าน`)
2. ไปที่เมนู **Setting** > **Event** > **Smart Plan**
   * ตรวจสอบว่าได้เปิดใช้งานฟังก์ชัน **ITC / ANPR (Vehicle Detection & Plate Recognition)** แล้ว
3. ไปที่เมนู **Setting** > **Network** > **Access Platform** > เลือกแท็บ **Alarm Center** หรือ **HTTP Push / Webhook**
4. กำหนดค่าดังนี้:
   * **Enable:** ทำเครื่องหมายถูก [✓]
   * **Protocol:** HTTP หรือ HTTPS
   * **Server Address / URL:** ใส่ Webhook URL ของ BPP-VMS (ตามข้อ 3.1)
   * **Port:** 443 (สำหรับ HTTPS) หรือ 80 (สำหรับ HTTP)
   * **Report Type:** ANPR / Traffic Data
   * **Data Content:** เลือกส่ง **Plate String**, **Vehicle Overview Picture**, และ **Plate Snapshot**
5. คลิก **Save** เพื่อบันทึกการตั้งค่า

### 3.3 การทำงานของ Central Gatekeeper (การเปิด-ปิดระบบ)
* เมื่อผู้ดูแลระบบกด **ปิดใช้งานกล้อง** หรือกด **ปิด AI** ของกล้องตัวนั้นในหน้าจอ Dashboard BPP-VMS
* เมื่อกล้อง Dahua ยิง Webhook เข้ามา เซิร์ฟเวอร์จะทำการตรวจสอบสิทธิ์ผ่าน Gatekeeper และ **ทิ้งข้อมูลทันที (Drop / HTTP 200 Ignored)** โดยไม่มีการประมวลผล ไม่ส่งเสียงเตือน ไม่บันทึกภาพลงฮาร์ดดิสก์ และไม่ส่ง Telegram Alert ช่วยให้ผู้ดูแลสามารถสั่งควบคุมเปิด-ปิดกล้องได้อย่างเบ็ดเสร็จ 100%

---

## 4. โซลูชันสำหรับหน่วยงานภายนอกที่ไม่มี Public IP (CGNAT / 4G SIM)

หากหน่วยงานปลายทาง (เช่น ด่านตรวจ, ชุมชน, โรงเรียน) มีกล้อง VIGI และใช้เน็ตบ้านทั่วไปหรือซิม 4G ซึ่ง **ไม่มี Public IP** และ **ไม่สามารถ Forward Port ได้**:

### 🎯 หัวใจสำคัญ: การส่งสัญญาณขาออก (Outbound vs Inbound)
* **Inbound (ภายนอกวิ่งเข้ามาหา):** จะถูกไฟร์วอลล์และ NAT ของผู้ให้บริการบล็อก (ต้องใช้ DDNS/Port Forward/VPN MikroTik)
* **Outbound (ภายในยิงออกไปหาเซิร์ฟเวอร์):** ไฟร์วอลล์และเน็ต 4G **อนุญาต 100%** เสมอ

### ทางเลือกที่ 1: ใช้ฟังก์ชัน RTMP Push จากกล้องหรือ VIGI NVR
หากกล้องหรือเครื่องบันทึก NVR มีเมนู **RTMP / Live Broadcast**:
1. ตั้งค่า Target RTMP URL ไปที่เซิร์ฟเวอร์ BPP-VMS:
   ```
   rtmp://[SERVER_PUBLIC_IP]:1935/live/[CAMERA_ID]
   ```
2. บนหน้า BPP-VMS เพิ่มกล้องโดยใส่ URL สตรีม:
   ```
   rtmp://127.0.0.1:1935/live/[CAMERA_ID]
   ```
3. สัญญาณภาพจะไหลตรงเข้าสู่ BPP-VMS ทันทีโดยไม่ต้องเปิดพอร์ตที่หน้างาน

### ทางเลือกที่ 2: ใช้โปรแกรมสำเร็จรูป BPP NVR Bridge บนคอมพิวเตอร์หน้างาน (แนะนำสูงสุด — รองรับหลายยี่ห้อ)
ศูนย์สั่งการ BPP-VMS ได้จัดทำโปรแกรมสำเร็จรูป **BPP NVR Bridge (GUI)** สำหรับ Windows ซึ่งรวมเอนจิน FFmpeg ความเร็วสูงและหน้าต่างกราฟิกในตัว รองรับเครื่องบันทึก NVR ยี่ห้อชั้นนำทั้ง **TP-Link VIGI, Dahua, Hikvision และแบบกำหนดเอง (Custom RTSP)**:
1. **ดาวน์โหลดโปรแกรม:**
   * คลิกดาวน์โหลดจากหน้า Dashboard: ไปที่เมนูตั้งค่ากล้อง > ปุ่ม **[📖 วิธีนำไปใส่ในกล้อง]** > แท็บที่ 3 > คลิก **[📥 ดาวน์โหลด BPP NVR Bridge สำหรับ Windows (ZIP)]**
   * หรือลิงก์ตรงอย่างเป็นทางการ: `https://vms.local/downloads/bpp-nvr-bridge.zip` (หรือเฉพาะไฟล์สคริปต์ `BPP-NVR-Bridge.ps1`)
2. **การติดตั้งและเปิดใช้งาน:**
   * แตกไฟล์ ZIP ไว้บนเครื่องคอมพิวเตอร์หน้างาน (เครื่องในวง LAN เดียวกับ NVR หรือเครื่องที่ต่อท่อ VPN เข้าไซต์งาน)
   * ตรวจสอบว่ามีโฟลเดอร์ `bin\ffmpeg.exe` อยู่ครบถ้วน
   * ดับเบิลคลิกเปิด **`BPP-NVR-Bridge.vbs`** (แนะนำอย่างยิ่ง เพื่อเปิดแบบไม่มีหน้าต่างคอนโซลดำ CMD ขึ้นมากวนใจ 100%) หรือดับเบิลคลิก `BPP-NVR-Bridge.bat` จะปรากฏหน้าต่างควบคุมกราฟิก (Cyber Dark Purple GUI)
3. **การตั้งค่าใช้งาน:**
   * **เซิร์ฟเวอร์ BPP-VMS:** ระบุ **`bpp215.duckdns.org`** หรือ WAN IP ที่ Forward พอร์ต RTMP 1935 ไว้ และตั้งรหัสหน่วยงาน (เช่น `Bpp215` หรือ `dan_khok_sung`) *(หมายเหตุ: ห้ามใช้ vms.local ในช่องนี้เนื่องจาก Cloudflare Proxy ไม่รองรับพอร์ต 1935)*
   * **ยี่ห้อ NVR:** เลือกแบรนด์เครื่องบันทึก:
     * `TP-Link VIGI` — URL: `/ch{ch}/stream1|stream2`
     * `Dahua / DH` — URL: `/cam/realmonitor?channel={ch}&subtype=0|1`
     * `Hikvision / HIK` — URL: `/Streaming/Channels/{ch}01|02`
     * `กำหนดเอง (Custom URL)` — กำหนด RTSP Path template เองได้
   * **เครื่อง NVR:** 
     * กรณีต่อในวง LAN: ระบุ IP เช่น `192.168.1.100` หรือ `192.168.20.199` และ Port (554)
     * กรณีเชื่อมต่อผ่านท่อ VPN (เช่น MikroTik WireGuard `10.10.10.x`): ให้กรอกเป็น IP ปลายท่อของ MikroTik เช่น **`10.10.10.2`** และ Port **`554`** ได้ทันที เพราะเราเตอร์ MikroTik มีการทำ Port Forward (DST-NAT) พอร์ต 554 ตรงไปยัง NVR ให้แล้ว (ไม่ต้องกรอก IP วงใน 192.168.20.199)
   * **Username & Password:** ใส่ข้อมูลผู้ใช้และรหัสผ่าน NVR แล้วกดปุ่ม "ทดสอบเชื่อมต่อ"
   * **เลือกช่องกล้อง (1-16):** ติ๊กเลือกช่องที่ต้องการส่ง และเลือกความละเอียด (Sub Stream ประหยัดเน็ต 0% CPU หรือ Main Stream)
   * คลิก **"💾 บันทึกค่า"** แล้วกด **"🚀 เริ่มส่งสัญญาณ (Start Bridge)"**
4. **ความสะดวกสบายในการทำงาน:**
   * คลิกปุ่ม **"📥 ย่อลง System Tray"** โปรแกรมจะย่อไปอยู่ข้างนาฬิกา ไม่รบกวนหน้าจอของเจ้าหน้าที่
   * ติ๊กเครื่องหมายถูก [✓] **"เปิดโปรแกรมพร้อมเปิดเครื่อง (Run on Windows Startup)"** เพื่อให้โปรแกรมเปิดตัวเองและเริ่มส่งสัญญาณอัตโนมัติทุกครั้งที่เปิดคอมพิวเตอร์
   * **Watchdog Auto-Healing:** หากเน็ตหลุด ไฟตก หรือ NVR ดับ ตัวโปรแกรมจะคอยเฝ้าระวังและเชื่อมต่อใหม่ทุก 5 วินาทีโดยอัตโนมัติ
5. **การลงทะเบียนกล้องที่เซิร์ฟเวอร์ BPP-VMS (Server-side Camera Registration):**
   * ที่หน้า Dashboard BPP-VMS ไปที่ **⚙️ ตั้งค่าระบบ ➔ กล้องในระบบ (NVR) ➔ + เพิ่มกล้องใหม่**
   * **ประเภทกล้อง (Preset):** เลือก **`TP-Link VIGI (Smart AI)`** *(เพื่อปิด AI ตรวจจับบนเซิร์ฟเวอร์)*
   * **ชื่อกล้อง:** ตั้งตามรหัสหน่วยงานและช่อง เช่น `dan_khok_sung_ch1`
   * **RTSP URL:** กรอก `rtmp://127.0.0.1:1935/live/[unit_code]_ch[N]` (เช่น `rtmp://127.0.0.1:1935/live/dan_khok_sung_ch1`)
   * กด **"บันทึก"** ภาพสดจะแสดงบนหน้าจอ Dashboard ของ BPP-VMS ทันที

---

## 5. การตรวจสอบความถูกต้องและการทดสอบระบบ (Verification)

### 5.1 ตรวจสอบสถานะสตรีม RTMP จาก BPP NVR Bridge บนเซิร์ฟเวอร์
เมื่อโปรแกรม BPP NVR Bridge เริ่มส่งสัญญาณสำเร็จ สามารถตรวจสอบที่เซิร์ฟเวอร์ได้ดังนี้:
1. เปิดเบราว์เซอร์บนเครื่องเซิร์ฟเวอร์ไปที่หน้าสถานะของ go2rtc: `http://127.0.0.1:1984`
2. จะพบ Stream ชื่อ `[unit_code]_ch[N]` (เช่น `dan_khok_sung_ch1`) ขึ้นสถานะรับสัญญาณ RTMP ขาเข้า
3. บนหน้าจอ Live Dashboard ของ BPP-VMS กล้องที่ลงทะเบียนไว้จะแสดงภาพสดที่ไหลลื่นทันที

### 5.2 ทดสอบการส่ง Webhook ป้ายทะเบียนจำลอง (cURL)
สามารถทดสอบการทำงานของ Webhook ผ่าน PowerShell บนเซิร์ฟเวอร์ได้ดังนี้:

```powershell
$payload = @{
    camera = "ext_lpr_gate1"
    plate = "9กข9999"
    confidence = 0.96
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
} | ConvertTo-Json

$payload | Out-File -FilePath test.json -Encoding utf8

curl.exe -k -X POST "https://localhost/api/lpr/camera-webhook?token=bpp_secret_2026" `
  -H "Content-Type: application/json" `
  --data-binary "@test.json"

Remove-Item test.json
```

**ผลลัพธ์ที่ถูกต้อง:**
* หากป้ายตรงกับ Watchlist: ส่งกลับ `{"status":"ok","hit":true,"event_id":"ext_...","plate":"9กข9999",...}` และมีแจ้งเตือนส่งเข้า Telegram ทันที
* หากกล้องถูกปิดใช้งานใน Admin: ส่งกลับ `{"status":"ignored","reason":"Camera or AI is disabled by administrator"}`

---
*เอกสารนี้จัดทำขึ้นสำหรับทีมเทคนิคและผู้ดูแลระบบ BPP-VMS ศูนย์สั่งการตำรวจตระเวนชายแดนที่ 215*
