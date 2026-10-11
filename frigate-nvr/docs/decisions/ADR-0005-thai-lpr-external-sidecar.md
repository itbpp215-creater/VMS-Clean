# ADR-0005: อ่านป้ายทะเบียนไทยด้วย external sidecar แทน built-in LPR ของ Frigate

- สถานะ: Accepted (2026-07-15)
- ผู้เกี่ยวข้อง: LPR integration (`lpr-service/`)

## Context

ทีมมีระบบอ่านป้ายทะเบียนไทย (โฟลเดอร์ `LicensePlateRECOG/`) ที่พัฒนาแยกไว้:
โมเดล YOLO สองตัว (`license_plate.pt` หาตำแหน่งป้าย, `data_plate.pt` อ่าน
ตัวอักษร/จังหวัด 124 class) + สคริปต์ GUI ที่ต่อ RTSP ตรงและแจ้งเตือน Discord
ต้องการนำมาใช้ร่วมกับ Frigate ใน BPP PrerimWatch

ทางเลือกที่พิจารณา:

1. เปิด **built-in LPR ของ Frigate 0.17** (YOLOv9 plate detector + PaddleOCR)
2. รันสคริปต์เดิม **standalone** ต่อ RTSP จากกล้องตรง ๆ วิเคราะห์ทุกเฟรม
3. **External sidecar แบบ event-driven**: poll events API ของ Frigate
   ทำงานเฉพาะช่วงมีรถ แล้วเขียนผลกลับเข้า Frigate

## Decision

เลือกทางที่ 3 — สร้าง `lpr-service` เป็น sidecar container ใน compose เดียวกัน

## Rationale

### ตัดทางที่ 1 (built-in LPR) — อ่านไทยไม่ได้โดยสิ้นเชิง

ตรวจ source ใน container จริง (`frigate/data_processing/common/license_plate/`)
และ dictionary ที่ Frigate ดาวน์โหลดมาใช้ (`ppocr_keys_v1.txt` จาก
hawkeye217/paddleocr-onnx): มี 6,622 ตัวอักษร เป็น CJK 6,280 + Latin 77 + ตัวเลข
— **ไม่มีอักษรไทย (U+0E00–U+0E7F) แม้แต่ตัวเดียว** CTC decoder ผูก output กับ
dictionary นี้ตายตัว จึงเป็นไปไม่ได้ที่จะอ่าน ก-ฮ หรือชื่อจังหวัด และเกณฑ์คุณภาพ
default (recognition_threshold 0.9, min_plate_length 4) จะทิ้งผลที่อ่านได้แค่ตัวเลข
เกือบทั้งหมด — เปิดไว้มีแต่เสีย CPU (โมเดล ONNX เพิ่มอีก 4 ตัวต่อรถหนึ่งคัน)

### ตัดทางที่ 2 (standalone ต่อกล้องตรง) — เปลือง CPU และซ้ำซ้อน

- เครื่อง production ปัจจุบันไม่มี GPU (ดู session 2026-07-13) — detector หลักกิน
  CPU สูงอยู่แล้ว การถอดรหัสสตรีม + รันโมเดลตรวจจับ **ทุกเฟรมตลอด 24 ชม.**
  ซ้ำอีกชุดไม่คุ้ม ในเมื่อ Frigate รู้อยู่แล้วว่า "ตอนนี้มีรถ"
- ต่อ RTMP upstream ตรงเพิ่มอีกหนึ่ง connection — ขัดแนวทางเดิมที่ให้ทุก consumer
  ใช้ restream ของ go2rtc (ADR-0002)
- ผลอ่านไม่ผูกกับ event ของ Frigate — ค้นย้อนหลัง/ดูใน UI ไม่ได้

### เหตุผลสนับสนุนทางที่ 3

- **CPU เกือบศูนย์เมื่อไม่มีรถ** (วัดจริง: idle 0.25%) — จ่ายเฉพาะช่วง event:
  crop ตามกรอบรถที่ Frigate หาให้ฟรี → หาป้าย ~68ms → อ่านตัวอักษร ~115ms/ป้าย
  (วัดบน CPU เครื่องนี้จริง) ที่จังหวะ ~1 เฟรม/1.5 วิ
- Frigate 0.17 มี endpoint เฉพาะงานนี้: `POST /api/events/<id>/recognized_license_plate`
  — เขียนลง **field เดียวกับ built-in LPR** ทำให้ค้นหา/กรองใน UI ได้เหมือน native
  (ทดสอบกับ 0.17.2 จริงแล้ว รวมทั้งข้อความไทย UTF-8 ทั้ง sub_label และ plate)
- พอร์ต 5000 ภายใน docker network ได้สิทธิ์ admin โดยไม่ต้อง credential
  (พฤติกรรมมาตรฐานของ Frigate — เป็นเหตุผลเดิมที่ห้าม expose พอร์ตนี้อยู่แล้ว)
- แยก failure domain: sidecar ตาย → กล้อง/บันทึก/ตรวจจับหลักไม่กระทบ
- ถ้าย้ายไปเครื่องมี GPU: เปลี่ยน base image + `LPR_DEVICE=cuda` ได้โดยไม่แตะสถาปัตยกรรม

## Consequences

- มี container เพิ่มหนึ่งตัว (`lpr-service`, image จาก `ultralytics:latest-cpu`)
- โมเดล `.pt` เป็น machine-local (gitignored) — เครื่องใหม่ต้อง provision เอง
  เหมือน ONNX ของ detector หลัก
- ความหน่วงของผล: ได้ sub_label หลัง event จบ (ไม่ใช่ real-time ระหว่างรถยังวิ่ง)
  — ยอมรับได้เพราะ use case คือตรวจย้อนหลัง + แจ้งเตือนรายต้องสงสัย
- การอ่านระหว่าง event ใช้ `latest.jpg` — ถ้ารถผ่านเร็วมาก อาจเหลือแค่ snapshot
  ปิดท้ายของ Frigate หนึ่งเฟรม
- โค้ดต้นแบบ `LicensePlateRECOG/` ถูก gitignore ทั้งโฟลเดอร์ (มี webhook token +
  credential กล้องฝังใน `main.py`) — โค้ดที่ดูแลต่อคือ `lpr-service/` เท่านั้น

## References

- Owner doc: [`../features/license-plate-recognition.md`](../features/license-plate-recognition.md)
- Session log: [`../sessions/session-2026-07-15-lpr-integration.md`](../sessions/session-2026-07-15-lpr-integration.md)
- ADR-0002 (restream เป็นทางผ่านวิดีโอกลาง), ADR-0001 (same-origin proxy / ไม่ expose 5000)
