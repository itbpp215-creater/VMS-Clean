# Playback

- **Status:** ACTIVE · **Last reconciled:** UNRECONCILED (structure retrofit only) · **Evidence:** `web/`

## Purpose

Playback ใช้ตรวจวิดีโอย้อนหลังตามวัน เวลา กล้อง และเหตุการณ์ โดยอิง recording segments ของ Frigate

## Current capabilities

- ปฏิทินเลือกวัน
- จุดแสดงวันที่มี recording จาก recording summary
- ใช้ local timezone เพื่อหลีกเลี่ยงการวางวันผิดจาก UTC
- Timeline แสดง recording windows และ event lane
- Timeline zoom หลายระดับและ pan
- Event bars ตาม object class พร้อม filter class
- Playback speed ตั้งแต่ slow motion ถึงความเร็วสูง โดย browser limit ถูกป้องกันด้วย safe clamp
- Multi-camera layout 1/2/4 จอ
- Sync follower cameras ตาม absolute time ของจอหลัก
- Snap ไปยังช่วง recording ที่มีจริงและไม่หลอกว่า sync เมื่อ gap ห่างเกิน policy
- Auto-advance ระหว่าง recording chunks
- Digital zoom 2x-5x ต่อ video surface

## Time handling

หลีกเลี่ยงการ parse `YYYY-MM-DD` แบบที่ browser อาจตีความเป็น UTC เมื่อตรรกะต้องการวันท้องถิ่น

Recording summary ต้องส่ง timezone ที่เหมาะสมเพื่อให้วันที่ที่มีข้อมูลตรงกับเวลาท้องถิ่น

## Multi-camera sync model

จอหลักเป็น source of truth ของ playback time ส่วน follower แต่ละจอมี recording segments ของตัวเองและ seek ไปยัง absolute time เดียวกันเท่าที่มีข้อมูล

หาก camera follower ไม่มี recording ใกล้เวลาที่ต้องการ ระบบควรแสดงว่าไม่มีภาพช่วงนั้น แทนการเล่นคนละเวลาแล้วอ้างว่า sync

## Digital zoom

Digital zoom เป็น client-side pixel scaling ไม่ได้เพิ่มรายละเอียดจากต้นฉบับ คุณภาพยังขึ้นกับ source resolution

## Related

- [Event Investigation](event-investigation.md)
- [Media Capture](media-capture.md)
- [Operator Dashboard](operator-dashboard.md)
