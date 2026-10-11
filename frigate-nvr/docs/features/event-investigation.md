# Event Investigation

- **Status:** ACTIVE · **Last reconciled:** UNRECONCILED (structure retrofit only) · **Evidence:** `web/`

## Purpose

Event Investigation คือ workflow สำหรับค้นหา ตรวจสอบ และจัดการเหตุการณ์ที่ Frigate ตรวจพบ

## Current capabilities

- Event rail แสดงเหตุการณ์ล่าสุด
- Dynamic filter ตาม object class
- เลือก class ที่ต้องการโฟกัสใน rail
- Event Library จัดกลุ่มและแสดง snapshot grid
- Event Detail แสดงชนิด เวลา confidence snapshot และวิดีโอ
- Description metadata บันทึกผ่าน Frigate event API และใช้ค้นหาได้
- Search และ filter รวมถึงกรองรายการที่มีคำอธิบาย
- ดาวน์โหลด snapshot/recorded media ตามความสามารถของ event
- Handoff จาก event rail ไปยัง Event Library และเปิดรายละเอียด event ที่เลือก
- Tracked Object Details ใช้ตรวจ lifecycle ของ object ที่เกี่ยวข้อง

- When filtered results are empty but older history remains, Event Library shows a load-more control with
  readable icon and label layout at desktop and mobile widths.

## Data source

ข้อมูลมาจาก Frigate REST API ผ่าน same-origin `/nvr/` proxy

## Write operations

การบันทึก description หรือ operation แบบ non-GET จาก browser ต้องแนบ CSRF header ที่ Frigate ต้องการ

## Data semantics

Session logs อาจบันทึก limit หรือ implementation detail ของแต่ละช่วงเวลา แต่เอกสารนี้ใช้บอก behavior ปัจจุบันเท่านั้น ค่าที่เป็น implementation constant ให้ยืนยันจาก `web/assets/app.js` ก่อนเปลี่ยน

## Related

- [Operator Dashboard](operator-dashboard.md)
- [Playback](playback.md)
- [Media Capture](media-capture.md)
- [Security Model](../security-model.md)
