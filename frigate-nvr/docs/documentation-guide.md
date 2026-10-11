# Documentation Maintenance Guide

เอกสารนี้กำหนดว่าการเปลี่ยนระบบแต่ละประเภทต้องอัปเดตเอกสารใด เพื่อให้ฐานความรู้ไม่ล้าหลังโค้ด

## Update matrix

| เมื่อเปลี่ยน... | ต้องอัปเดต |
|---|---|
| Production host / IP / GPU / port | `current-state.md`, อาจรวม `architecture.md` |
| Camera source / stream flow | `current-state.md`, `architecture.md`, feature/troubleshooting ตามผลกระทบ |
| AI model / input size / runtime | `current-state.md`, `architecture.md`, `features/object-detection.md`, ADR ถ้าเป็น baseline ใหม่ |
| Recording / retention / storage policy | `current-state.md`, `features/storage-management.md`, `operations.md`, ADR ถ้า behavior หลักเปลี่ยน |
| CI/CD / deploy flow | `current-state.md`, `operations.md`, `architecture.md`, ADR ถ้า strategy เปลี่ยน |
| Incident หรือ bug ที่อาจเกิดซ้ำ | `troubleshooting.md`, `history.md` ถ้าเป็น production incident |
| Security boundary / auth / CSRF / secret flow | `security-model.md`, troubleshooting/ADR ตามความเหมาะสม |
| Feature ใหญ่ | เอกสารใน `docs/features/`, `current-state.md` หากเป็น capability หลัก |
| Config syntax/convention | `docs/reference/` |
| Architectural decision | `docs/decisions/ADR-XXXX-*.md` |
| งานพัฒนาแต่ละช่วง | `docs/sessions/YYYY-MM-DD-*.md` |

## Definition of done

ก่อนถือว่างานเสร็จ ให้ถาม:

1. โค้ด/config เปลี่ยน current state หรือไม่
2. Data flow ยังอธิบายถูกใน `architecture.md` หรือไม่
3. Feature owner document ต้องอัปเดตหรือไม่
4. มี operational step ใหม่หรือไม่
5. มี security implication ใหม่หรือไม่
6. ปัญหาที่พบมีโอกาสเกิดซ้ำหรือไม่
7. มี decision ที่อนาคตอาจสงสัยว่า “ทำไมทำแบบนี้” หรือไม่
8. `CLAUDE.md` และ `docs/README.md` ยังชี้ไปเอกสารที่ถูกต้องหรือไม่

## CLAUDE.md is an entry point

`CLAUDE.md` ควรมีเฉพาะ:

- product/system summary
- current critical facts
- non-negotiable guardrails
- quick commands
- documentation map
- source-of-truth policy

รายละเอียดเชิงลึกต้องลิงก์ออก

## Code wins over stale documentation

ถ้าพบว่าเอกสารไม่ตรงกับโค้ด:

1. ตรวจว่าโค้ดนั้นคือสถานะที่ตั้งใจใช้จริงหรือไม่
2. แก้เอกสารให้ตรง
3. ถ้า architecture เปลี่ยนโดยไม่มีเหตุผลบันทึก ให้เพิ่ม ADR/session note
4. อย่าแก้โค้ดให้ตรงเอกสารเก่าโดยอัตโนมัติ

## Session log promotion

Session log เป็น raw historical context

เมื่อความรู้จาก session ถูกพิสูจน์แล้ว ให้ promote ไปยัง owner document:

- current fact -> `current-state.md`
- system design -> `architecture.md`
- feature behavior -> `features/`
- recurring incident -> `troubleshooting.md`
- security rule -> `security-model.md`
- config syntax -> `reference/`
- decision rationale -> `decisions/`
- milestone -> `history.md`

อย่าลบรายละเอียดการทดลองจาก session เพียงเพราะสรุปถูก promote แล้ว

## TODO handling

Session ไม่ควรเป็น task tracker ถาวร

- งานเสร็จ/หมดอายุ: คงไว้เป็นประวัติ
- งานที่ยังต้องทำจริง: สร้าง GitHub Issue

## No secrets

ห้ามใส่:

- password
- token
- API secret
- stream credential
- private key
- camera URL ที่มี credential จริง

ใช้ environment variable หรือ placeholder เท่านั้น

## Document ownership

- Platform/runtime: `current-state.md`, `operations.md`
- Architecture: `architecture.md`, ADRs
- Security: `security-model.md`
- Feature behavior: `docs/features/`
- Incident knowledge: `troubleshooting.md`
- Technical syntax: `docs/reference/`
- Session context: `docs/sessions/`

## Review cadence

อย่างน้อยเมื่อมี milestone หรือก่อน handoff ควรตรวจ:

- `CLAUDE.md`
- `docs/README.md`
- `current-state.md`
- architecture/data flow
- feature docs ที่แตะ
- security/deployment flow
- top recurring incidents
- open/superseded ADRs

เป้าหมายคือให้คนใหม่เริ่มจาก `CLAUDE.md` แล้วตามลิงก์ถึงข้อมูลที่ต้องใช้ได้โดยไม่ต้องอ่าน commit history ทั้ง repo

## Front-matter convention (เพิ่ม 2026-07-16)

เอกสาร canonical/ACTIVE ควรมีบรรทัด metadata ใกล้หัวไฟล์ตามแบบนี้ (ดูตัวอย่างจริงใน
`docs/reference/environment-variables.md`):

```
- **Status:** ACTIVE | REFERENCE | HISTORICAL · **Last reconciled:** YYYY-MM-DD (baseline <commit>) · **Evidence:** <source paths>
```

- **Last reconciled** = วันที่ตรวจเทียบกับ source จริงครั้งล่าสุด + commit ที่ใช้เป็นฐาน
- ข้อความที่ยังไม่ได้พิสูจน์กับระบบที่รันจริง ให้ติดป้าย `LIVE_UNVERIFIED` ในจุดนั้น
- เอกสารเก่าที่ถูกแทนที่ ให้ขึ้น banner `HISTORICAL/SUPERSEDED` + ลิงก์ไปเอกสารปัจจุบัน
- retrofit ชุดเอกสารหลัก (core, `features/`, `reference/`) ทำครบแล้ว 2026-07-16 —
  ไฟล์ใหม่ทุกไฟล์ต้องมีตั้งแต่สร้าง
- ข้อยกเว้น: ADR มี `Status:`/`Date:` ของตัวเองอยู่แล้ว ไม่ต้องเพิ่มบรรทัดนี้ซ้ำ;
  session log ใช้ HISTORICAL banner ที่หัวไฟล์แทน
- เอกสารที่ retrofit โครงโดยยังไม่ได้ตรวจ claim กับ source จริง ให้ใช้
  `Last reconciled: UNRECONCILED (structure retrofit only)` จนกว่าจะมีรอบ reconcile จริง
