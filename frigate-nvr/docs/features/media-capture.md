# Media Capture

- **Status:** ACTIVE · **Last reconciled:** UNRECONCILED (structure retrofit only) · **Evidence:** `web/`

## Current capabilities

ระบบรองรับการจับภาพและบันทึก media จากหลาย surface ของ Dashboard

### Snapshot

- Live tile / fullscreen live viewer
- Event video surfaces
- Playback main/follower cells
- Event snapshot bestshot download เมื่อ event มี snapshot

Snapshot จากวิดีโอทำ client-side ผ่าน canvas แล้วดาวน์โหลดเป็น PNG

### Client-side recording

Live view สามารถบันทึกผ่าน browser `MediaRecorder` จาก MediaStream

- ใช้ format ที่ browser รองรับ
- มี fallback ตาม capability ของ browser
- จำกัดระยะเวลาการอัดเพื่อป้องกัน resource runaway
- ต้องหยุดและ finalize recording เมื่อ rebuild/ปิด view
- การสลับ stream ระหว่างอัดต้องถูกจำกัดเพื่อไม่ให้ไฟล์เสีย

## Security and privacy

ไฟล์ที่ผู้ใช้จับภาพหรือบันทึกถูกสร้างใน browser context และอาจถูกดาวน์โหลดลงเครื่องผู้ใช้ การใช้งานต้องสอดคล้องกับนโยบายข้อมูลของหน่วยงาน

## Related

- [Playback](playback.md)
- [Event Investigation](event-investigation.md)
- [Operator Dashboard](operator-dashboard.md)
