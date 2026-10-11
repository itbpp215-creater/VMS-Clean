# ADR-0006: ปิด/เปิดกล้องจาก dashboard ด้วย camera-level `enabled` + restart

- **Status:** Accepted · **Date:** 2026-07-16 (retro-documenting behavior ที่ ship แล้วใน `ea14c4f`, `c2bb6f1`, `5777e6e`)
- **Evidence:** `web/assets/app.js` (`applyEnabledChanges`, `saveSettings`), `docs/troubleshooting.md` #11

## Context

ฟีเจอร์ปิดกล้องรุ่นแรกสั่ง `detect.enabled=false` + `record.enabled=false` แบบ live ผ่าน
`/api/config/set` + `update_topic` แล้วพบปัญหาจริง 2 เรื่อง (รายละเอียด+วิธีวินิจฉัย:
`troubleshooting.md` #11):

1. **GPU ไม่ว่าง** — detect/record toggle ไม่หยุด ffmpeg ของกล้อง (decode CUDA + NVENC
   transcode ยังรัน) มีเพียง camera-level `enabled=false` เท่านั้นที่ทำให้ Frigate หยุด
   ffmpeg และไม่ spawn process ตอน start (`camera/maintainer` เช็ค `enabled_in_config`)
2. **detection ตายทั้งระบบ** — การ republish config ระหว่าง toggle เคยทำ thread
   `detected_frames_processor` crash (`KeyError` ที่ `objects.filters`) → ไม่มี event
   ทุกกล้องทั้งที่ detector ยังรัน

## Decision

Dashboard เขียน **camera-level `enabled`** ลงไฟล์ config ผ่าน `config/set`
**โดยไม่ใส่ `update_topic`** (เขียน disk อย่างเดียว ไม่ republish) ยิงเรียงลำดับต่อกล้อง
แล้ว **restart Frigate หนึ่งครั้ง** ต่อรอบบันทึก (batch ทุกกล้องที่เปลี่ยน) — ตอนเปิดกลับ
คืน `detect.enabled`/`record.enabled = true` ให้กล้องที่เคยถูก soft-disable จากโค้ดเก่าด้วย

## Alternatives rejected

- **Live toggle ผ่าน `update_topic`/WS `<cam>/enabled/set`** — หยุด ffmpeg/คืน GPU
  ไม่ได้จริงจากการทดสอบ และ republish เป็นจุดชนวน crash ข้อ 2
- **ยิง `config/set` แบบ `Promise.all`** — endpoint เป็น read-modify-write ทั้งไฟล์
  การเขียนพร้อมกันทับกันเอง (เคยเกิด race จริง แก้ใน `c2bb6f1`)

## Consequences

- ปิด/เปิดกล้องมี downtime ~20-30 วิ (restart) แลกกับ GPU ว่างจริง + detection กลับมาสะอาด
- ถ้า provisioning กล้องใหม่ restart อยู่แล้วในรอบเดียวกัน จะไม่ restart ซ้ำ

## Revisit when

- Frigate เพิ่ม API หยุด ffmpeg ต่อกล้องแบบ live ที่เชื่อถือได้ หรือแก้ KeyError republish upstream
