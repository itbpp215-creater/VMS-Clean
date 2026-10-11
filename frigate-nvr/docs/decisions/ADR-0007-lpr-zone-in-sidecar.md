# ADR-0007: โซนจับป้ายทะเบียนอยู่ฝั่ง lpr-service ไม่ใช่ Frigate zones

- **Status:** Accepted · **Date:** 2026-07-17
- **Evidence:** `lpr-service/app.py` (`load_zones`, `boxes_intersect`, `LPREngine.process(zone=)`), `web/assets/app.js` (zone editor `openLprZone`/`lzContentRect`), `dashboard-nginx.conf` (`/settings/lpr_zones`)

## Context

ป้ายทะเบียนอ่านไม่ออกเพราะเฟรมสดถูกดึงที่ 720p จากกล้อง scene (พิสูจน์: 0 reads ตลอดประวัติ
— ดู session 2026-07-17) ผู้ใช้เสนอแนวคิด: ตีกรอบบริเวณที่ป้ายเห็นชัด แล้วให้ระบบ snapshot
ซ้ำเมื่อป้ายเข้ากรอบก่อนส่ง OCR

## Decision

เก็บและประมวลผลโซนที่ **lpr-service** ทั้งหมด: dashboard เขียน `config/lpr/lpr_zones.json`
(normalized `[x,y,w,h]` — convention เดียวกับ `data.box` ของ Frigate) ผ่าน nginx PUT,
sidecar hot-reload ทุก ≤60 วิ แล้วใช้โซน 3 ทาง: (1) trigger ดึงเฟรม**เต็ม resolution** เมื่อ
กรอบรถแตะโซน (2) จำกัดบริเวณค้นหาป้าย (3) hard filter ให้ผลชนะต้องอยู่ในโซน

## Alternatives rejected

- **Frigate native zones** — Frigate รู้จักแค่ "รถ" ไม่รู้จัก "ป้าย"; แก้ zone ต้องเขียน
  config.yml + restart ทุกครั้ง; ไม่มีทางสั่ง "snapshot เมื่อป้ายเข้ากรอบ" ได้อยู่ดี
- **สั่ง snapshot ผ่าน Frigate API** — snapshot ของ Frigate เป็น best-frame อัตโนมัติของ
  "ตัวรถ" ไม่ใช่ป้าย; `latest.jpg` แบบไม่จำกัด height ให้ผลเทียบเท่าและง่ายกว่า

## Consequences

- เปลี่ยนโซน/เปิดปิดกล้อง LPR ไม่กระทบ Frigate เลย (ไม่มี restart, event/clip เดิมทุกอย่าง)
- โซนเป็น hard filter: กล้องที่ตีโซนแล้วจะไม่อ่านป้ายนอกโซนเลย (จงใจ — นอกโซนคือจุดที่มัว)
- ความแม่นของโซนอิงการชดเชย letterbox ฝั่ง editor (`lzContentRect`) — แก้ UI ต้องรักษา invariant นี้

## Revisit when

- ได้กล้อง ANPR เฉพาะจุด หรือ Frigate มี dedicated LPR zone/trigger API ที่รองรับไทย
