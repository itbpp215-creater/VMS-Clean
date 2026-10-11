# Object Detection

- **Status:** ACTIVE · **Last reconciled:** 2026-07-23 · **Evidence:** `config/config.yml`, `web/`

## Current baseline

- Detector: ONNX
- Model type: `yolo-generic`
- Model: YOLO11m 640x640
- Runtime target: NVIDIA GPU via ONNX Runtime CUDA path
- Model file: included in the verified new-camp package at `/config/model_cache/yolo11m-640.onnx`; other model-cache content remains machine-local

## Label set

ระบบใช้ COCO 80 classes และมี model label override สำหรับ `bus` และ `truck`

Dashboard แบ่ง class เพื่อให้ง่ายต่อการเลือก เช่น:

- Security-oriented classes
- Animal classes
- General classes

UI รองรับการเลือก object tracking ต่อ camera และมี policy จำกัดจำนวน class ที่เลือกพร้อมกัน เพื่อควบคุมภาระและ UX

## Current tracked objects

Global/default anchor:

- person
- car
- motorcycle
- truck
- bus

Camera `nongwang1` currently adds `bicycle`, `knife`, `backpack` and `dog`.

`truck`/`bus` ถูกเพิ่ม (2026-07-15) เพราะระบบอ่านป้ายทะเบียน (`lpr-service`) ทำงาน
จาก event ของ Frigate — รถกระบะ/รถบรรทุกที่ YOLO จัดเป็น `truck` ต้องมี event
ไม่งั้น LPR จะไม่เห็นรถคันนั้นเลย (ดู [`license-plate-recognition.md`](license-plate-recognition.md))

## Per-camera configuration

Dashboard สามารถแก้ object tracking ของแต่ละ camera ผ่าน admin-only Config flow โดยต้องรักษา placeholder `{FRIGATE_*}` และไม่ทำลาย config ส่วนอื่น

Browser write operation ต้องแนบ CSRF header ที่ระบบต้องการ

## Model migration history

ระบบเคยใช้ YOLOv9-s 320 เป็น GPU detector baseline ก่อนเปลี่ยนมา YOLO11m 640 เพื่อเน้นความแม่นยำมากขึ้น ข้อมูล benchmark เดิมเก็บใน session logs/history และไม่ใช่ current state

## Operational notes

- เครื่องใหม่ต้อง provision model file ก่อน start
- model directory เป็น gitignored
- เปลี่ยน model/input size ต้องอัปเดต `current-state.md`, `architecture.md` และสร้าง ADR หากเป็น baseline ใหม่

## Related

- [Current State](../current-state.md)
- [Architecture](../architecture.md)
- [Troubleshooting](../troubleshooting.md)
