# 📊 มอดูล AI Data Analytics & Intelligence Engine (เฟส 4)

> **Status:** ACTIVE · **Last reconciled:** 2026-08-04 · **Owner:** analytics-engine

เอกสารสถาปัตยกรรมและรายละเอียดการทำงานของมอดูล **AI Data Analytics & Intelligence Engine** สำหรับสกัด ประมวลผล และวิเคราะห์แนวโน้มข้อมูลคดี/ป้ายทะเบียน/พื้นที่เสี่ยงยานพาหนะยาเสพติด ในระบบ BPP-VMS (Sloth AI System)

---

## 📌 1. วัตถุประสงค์และฟีเจอร์หลัก (Key Features)

มอดูล **analytics-engine** ทำหน้าที่รวบรวมข้อมูลจาก `lpr-service`, `watchlist-api` และ `nas-bot-service` มาประมวลผลวิเคราะห์เชิงสถิติและข่าวกรอง 4 ด้าน:

1. **Interactive Heat Map & Risk Score:**
   * สกัดพิกัด GPS จากรายงานคดีและกล้อง LPR มาพล็อตแผนที่ความร้อน (Heat Map)
   * คำนวณคะแนนความเสี่ยง (Risk Score) แยกรายพื้นที่จัดลำดับจุดเฝ้าระวัง
   * **Zone Intelligence Details Modal (หน้ารายละเอียดข่าวกรองระดับพื้นที่):**
     - คลิกรูปแปลงเขตอำเภอ/ตำบล หรือจุดวางงาน (Stash Points) เพื่อเปิดหน้ารายละเอียดคดีและรายงานข่าวกรอง
     - **In-Modal Category Filter Tabs:** สลับหมวดหมู่คดี (`[ทั้งหมด]`, `[ยาเสพติด]`, `[อาวุธปืน]`, `[ต่างด้าว]`, `[ทั่วไป]`) ได้ทันทีภายในหน้าต่าง พร้อมตัวเลขนับจำนวนสด
     - **Interactive Action Buttons:** ทุกการ์ดติดตั้งปุ่มเปิดดูแฟ้มบุคคล (`🗂️ เปิดแฟ้ม Dossier`), ดูรายละเอียดเหตุการณ์ฉบับเต็ม (`👁️ รายละเอียดฉบับเต็ม`), ดูในผังเครือข่าย (`🌐 ดูในผัง i2`), และเปิดดู/ดาวน์โหลดไฟล์แนบคดีใน NAS (`📂 ดูไฟล์แนบคดี`)
     - **Name Normalization & Search Recall:** สกัดและตัดคำนำหน้าอำเภอ/ตำบลอัตโนมัติ เพื่อการสืบค้นข้อมูลจาก NAS Bot ได้ครบถ้วนสูงสุด
2. **Time Pattern Analytics (สถิติช่วงเวลาเกิดเหตุ):**
   * วิเคราะห์สถิติช่วงเวลาพบบ่อย (Peak Hours), วันเสี่ยง, เดือนเสี่ยง
   * แสดงกราฟเปรียบเทียบแนวโน้มรายเดือนและรายปี
3. **Route & Trajectory Link Analysis (วิเคราะห์เส้นทางและความเชื่อมโยง):**
   * วิเคราะห์ลำดับการผ่านกล้องของรถเป้าหมาย เพื่อคำนวณเส้นทางลำเลียงยาเสพติด (จุดเริ่มต้น ➔ จุดผ่าน ➔ จุดปลายทาง)
   * จับคู่ยานพาหนะที่มักเดินทางผ่านกล้องในเวลาใกล้เคียงกัน (Co-occurrence Analysis)
4. **AI Attribute Analysis (การแยกแยะรูปลักษณ์):**
   * จำแนกประเภท ยี่ห้อ สีรถ และสกัดลักษณะบุคคล (เพศ, สีเสื้อผ้า)

---

## 🧠 2. สถาปัตยกรรมระบบ (System Architecture)

```
[ LPR / Watchlist DB ]       [ NAS Case Reports ]
          │                           │
          └─────────────┬─────────────┘
                        │
                        ▼
         ┌─────────────────────────────┐
         │  analytics-engine (Python)  │  Port 5006
         │  - Heatmap & Clustering     │
         │  - Time-series Aggregation  │
         │  - Route Linker             │
         └──────────────┬──────────────┘
                        │
                        ▼
         ┌─────────────────────────────┐
         │ Analytics Dashboard (Web)   │
         │  - Leaflet / Heatmap UI     │
         │  - Chart.js Trend Graphs    │
         └─────────────────────────────┘
```

---

## 🔌 3. รายการ REST API Endpoints

- `GET /api/analytics/heatmap` — คืนค่าพิกัด Heat Map + Weight ความเสี่ยง
- `GET /api/analytics/time-stats` — คืนค่าสถิติช่วงเวลาเกิดเหตุรายชั่วโมง/รายวัน/รายเดือน
- `GET /api/analytics/routes` — วิเคราะห์ลำดับเส้นทางผ่านกล้องของยานพาหนะ
- `GET /api/analytics/risk-scores` — คำนวณจัดลำดับคะแนนความเสี่ยงแยกรายพื้นที่

---

## 🛠️ 4. การดูแลรักษาและแก้ปัญหา (Maintenance & Troubleshooting)

- **พิกัด Heat Map ไม่แสดงผล:** ตรวจสอบว่าไฟล์รายงานคดีใน NAS มีพิกัด GPS หรือกล้อง LPR ถูกกำหนดพิกัดใน `lpr_zones.json` เรียบร้อยแล้วหรือไม่
- **การทดสอบ:** สามารถรัน Unit Test ได้ด้วยคำสั่ง `python -m unittest discover -s analytics-engine/tests -v`
