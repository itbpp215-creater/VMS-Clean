# Multi-Platform Bot & NAS Storage Integration Feature

> **Status:** ACTIVE · **Last reconciled:** 2026-08-26 (baseline `d15be3f`) · **Evidence:** `nas-bot-service/main.py`, `nas-bot-service/services/identity_sync.py`, `nas-bot-service/services/dossier_manager.py`, `nas-bot-service/services/nas_manager.py`, `nas-bot-service/repair_person_identity.py` · **Owner:** nas-bot-service

เอกสารระบุรายละเอียดการทำงาน การตั้งค่า และขั้นตอนการดูแลรักษามอดูล **nas-bot-service** สำหรับระบบ BPP-VMS (Sloth AI System)

---

## 1. Feature Summary

- **Multi-Platform Bot Gateway:** รองรับ 4 ช่องทาง (Telegram Bot, LINE Official Account / LINE Notify, Discord Bot, Dashboard Web Chat Widget)
- **EXIF GPS Metadata Extraction:** สกัดพิกัด GPS และวันเวลาถ่ายจริงจากไฟล์ภาพถ่ายภาคสนามอัตโนมัติ
- **NAS Case Folder Structuring:** สร้างและจัดเก็บไฟล์หลักฐาน (รูปภาพ, วิดีโอ, ไฟล์ Word, PDF, ข้อความคดี) ลงใน NAS storage ตามโครงสร้างมาตรฐาน:
  `/NAS/Cases/YYYY/MM/Case_ID/`
- **Unified Authentication:** บัญชีผู้ใช้ของ Bot ผูกกับ `auth-service` ผ่านรหัสผ่านใช้ครั้งเดียว (One-Time 6-digit Pairing Code)
- **Local Virtual NAS Fallback:** ทำงานลงโฟลเดอร์ Local ในระหว่างที่ยังไม่มีเครื่อง NAS จริง เมื่อติดตั้งเครื่อง NAS ใหม่เพียงเปลี่ยนตัวแปรใน `.env`

### Text routing parity

- Web Chat และ Telegram ส่งข้อความรายงานทั่วไปเข้า `chat-service /api/chat/send`
  ด้วยข้อความต้นฉบับเหมือนกัน เพื่อใช้ intent parser และ event store ชุดเดียวกัน
- Telegram เก็บข้อความรายงานที่บันทึกสำเร็จลง NAS เป็น text-only case โดยระบุ
  `platform=telegram`; ข้อความตอบรับใช้ค่า `reply` จาก chat-service เช่นเดียวกับ Web Chat
- การค้นหาเป็น explicit command เท่านั้น: `/search <คำค้น>` หรือ `ค้นหา <คำค้น>`
  ข้อความทั่วไปจะไม่ค้นหาข้อมูลเดิมก่อนและจะไม่ถูกเปลี่ยนจากรายงานเป็นผลค้นหา

---

## 2. Configuration & Tokens

การตั้งค่าใน `.env`:

```env
NAS_STORAGE_PATH=/data/nas-storage
TELEGRAM_BOT_TOKEN=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
DISCORD_BOT_TOKEN=
DISCORD_WEBHOOK_URL=
```

---

## 3. Pairing Bot User Account

1. ผู้ใช้กดขอ Pairing Code ในหน้า Dashboard หรือผ่าน API `/api/nas-bot/pair/request`
2. ระบบสร้างรหัส 6 หลัก (อายุ 10 นาที)
3. ผู้ใช้นำรหัสส่งเข้าไปในแชท Bot (Telegram / LINE / Discord)
4. Bot ตรวจสอบรหัสแล้วผูก Chat ID กับ username ในระบบ BPP-VMS

---

## 4. Person Identity Synchronization

### Authority and immutable identifiers

- เมื่อเจ้าหน้าที่แก้ `suspect_name` ผ่าน dossier update route ชื่อใน dossier ที่เลือกจะเป็น
  authoritative display name และบันทึก provenance เป็น `name_source=officer_correction`,
  เวลาที่แก้ และ operator จาก `X-User` (หรือ `system` เมื่อไม่มี header)
- `dossier_id`, `person_id`, dossier folder, case ID, graph node ID, graph edge และไฟล์หลักฐาน
  เป็น technical identity ที่คงที่ การแก้ชื่อไม่ rename หรือย้าย artifact เหล่านี้
- Case ใหม่ persist `linked_person_ids` หลัง Person Registry upsert เพื่อให้ response และ
  `metadata.json` อ้าง stable person IDs ชุดเดียวกัน

### Resolution and propagation

การแก้ชื่อเริ่มจาก `dossier_id` ที่ผู้ใช้เลือกโดยตรง จากนั้น coordinator รวบรวมหลักฐานตัวตน
แบบ strong และ exact ได้แก่ national ID, phone ที่ normalize เป็น digits, persisted
`linked_person_ids` และ Person Registry source case IDs. หลักฐานเหล่านี้เป็น candidate proof
ร่วมกัน ไม่ใช่ first-match-wins; หากรวมแล้วชี้ไป Person Registry มากกว่าหนึ่ง record ระบบตอบ
conflict และไม่เขียนไฟล์ใด ๆ ชื่อหรือ substring similarity ไม่เคยอนุญาตการเลือกหรือ merge ใน flow นี้

เมื่อ resolve ได้อย่างไม่กำกวม transaction เดียวจะวางแผนและอัปเดตเฉพาะส่วนที่พิสูจน์ความสัมพันธ์ได้:

- selected dossier profile และ `dossiers_index.json` สำหรับ search/graph label
- Person Registry record เดียวที่ resolve ได้ โดยคง `person_id` เดิม
- suspect entries ใน Cases ที่พิสูจน์ด้วย stable person link, source case หรือ strong identifier;
  multi-suspect case ที่ระบุบุคคลไม่ได้จะถูกข้ามพร้อม warning
- cached `linked_dossiers[].suspect_name` ที่อ้าง target ด้วย `dossier_id` ตรงกัน

หากไม่พบ Person Registry match การแก้ dossier และ case ที่ยังพิสูจน์ได้สามารถดำเนินต่อพร้อม
warning `person_registry_match_not_found`; ระบบจะไม่สร้างหรือเดา Person record จากชื่อ

ทุก replacement ถูก stage เป็น sibling JSON, flush/fsync ก่อน `os.replace`, read back เพื่อ verify
และอยู่ใต้ process-wide lock เดียวกัน หาก apply ล้มเหลว ระบบ restore original bytes หรือ original
absence ของไฟล์ที่ promote ไปแล้วและตรวจซ้ำ การตอบกลับ/audit ของ identity flow จำกัดอยู่ที่ stable IDs,
operator, aggregate counts, warnings, status และ `noop`; corrected name กับ strong identifiers ไม่อยู่ใน
plan repr, sanitized `identity_sync` summary, exception detail, coordinator log หรือ CLI stdout.
API route ยังคงส่ง full dossier แยกต่างหากให้ caller ที่ผ่าน authorization ตาม response contract เดิม

Writers of Dossier, Person Registry, and Case metadata use this same re-entrant lock before reading so an
older identity plan cannot overwrite concurrent ingestion. Historical phone aliases are internal exact-lookup
keys only; the dossier-list API retains its established public fields and omits alias history.

### Historical synchronization precedence

`sync-all` ยังคงเป็น ingestion/reconciliation ของข้อมูลเก่า ไม่ใช่เครื่องมือซ่อม identity. เมื่อ dossier
มี `name_source=officer_correction` การ upsert จาก OCR จะ merge evidence และ non-name fields ที่ใช้ได้
แต่ไม่เขียนทับ authoritative name. Weak substring-name lookup จะข้าม corrected dossier; exact national ID
หรือ normalized phone ยังเชื่อมหลักฐานใหม่เข้ากับ dossier เดิมได้

### Dry-run-first repair command

เก็บค่า root, stable dossier ID, ชื่อที่อนุมัติ และ operator ไว้ใน private operator shell แล้วเริ่มด้วย
default dry-run (การไม่ระบุ `--apply` เท่ากับ read-only):

```powershell
python nas-bot-service/repair_person_identity.py `
  --root $operatorSelectedNasRoot `
  --dossier-id $operatorSelectedStableDossierId `
  --correct-name $operatorApprovedCorrectName `
  --actor $authenticatedOperator
```

stdout แสดงเฉพาะ mode, stable dossier ID, affected counts, warnings และ `noop`. ตรวจผล dry-run
และแก้ conflict ก่อนทุกครั้ง; ห้ามใช้ `sync-all` แทน repair. เมื่อได้รับอนุมัติ apply แยกต่างหากจึงเพิ่ม
`--apply` ด้วย input ชุดเดิม

`--apply` สร้าง backup จาก original bytes ของ exact in-lock plan ก่อน promote ที่
`Backups/identity-sync/<UTC timestamp>-<random id>/`. Backup มีเฉพาะ affected JSON metadata,
manifest ที่เก็บ root-relative paths, original-existence flags และ SHA-256 digests; ไม่ copy evidence.
Backup ถูก stage และ verify ก่อน publish ทั้ง directory หากขั้นตอน backup ล้มเหลว source metadata
จะยังไม่ถูก promote. หลัง apply ให้รัน default dry-run ซ้ำและต้องได้ `noop=true` ก่อนปิดงาน

คำสั่งนี้ยังไม่มี restore subcommand อัตโนมัติ การ restore ต้องทำตามขั้นตอนควบคุมใน
[Troubleshooting #24](../troubleshooting.md#24-person-identity-update-ล้มเหลวหรือข้อมูลชื่อไม่สอดคล้องกัน)

> **Production status:** ณ 2026-08-26 ยังไม่มี production migration, repair dry-run,
> repair apply หรือ deployment ของ feature นี้

---

## 5. Troubleshooting & Maintenance

- **ภาพถ่ายไม่มี GPS:** ตรวจสอบว่าแอปกล้องในมือถือผู้ใช้เปิด Location Access ไว้หรือไม่ และการส่งภาพผ่าน Telegram ควรเลือกส่งแบบ "Send as File" เพื่อไม่ให้ EXIF ถูกบีบอัดออก
- **สลับไปใช้เครื่อง NAS จริง:** ปรับแต่ง Mount Path ใน `docker-compose.yml` หรือปรับเปลี่ยน `NAS_STORAGE_PATH` ให้ส่องไปที่ไดรฟ์ของ NAS โดยไม่ต้อง rebuild โค้ด
- **ชื่อ person ไม่ตรงกันหรือ update ได้ 4xx/5xx:** ใช้ workflow ที่
  [Troubleshooting #24](../troubleshooting.md#24-person-identity-update-ล้มเหลวหรือข้อมูลชื่อไม่สอดคล้องกัน)
  และหยุด identity writes เมื่อพบ `503`

## 5. i2 link analysis and Analyst's Notebook import

nas-bot now owns the reviewed evidence graph API, atomic graph state, and import lifecycle. It does not use equal area/address/name as automatic identity proof. Exact phone overlap is the only future dossier cross-link rule; ambiguous legacy links remain visible for review. See [i2 Link Analysis](i2-link-analysis.md) for behavior, RBAC, retention, and bridge operations.

## 6. Parcel receiver authority and recoverable dossier merge

For Flash Tracking/PNO text, `parse_flash_parcels` emits receiver-facing fields only. `parse_message`
then makes the first parcel receiver authoritative for top-level person name, phone, and address and
clears generic police-suspect matches. This prevents an earlier sender line from becoming the person in
Web Chat or Telegram, while retaining the untouched operator report as raw evidence.

`services/dossier_merge.py` is an exact-ID, dry-run-first maintenance utility. It validates same-person
names and non-conflicting national IDs, plans SHA-256-verified evidence copies, preserves canonical
non-empty fields, unions files/phones/links, removes only the exact source index entry, and retires the
live source into a timestamped backup. On failure after backup creation it restores the target, source,
and original index. Stop `nas-bot` during `--apply` so Telegram ingestion cannot race the transaction.

```powershell
docker compose run --rm --no-deps nas-bot python -m services.dossier_merge `
  --root /data/nas-storage --source <exact-source-id> --target <exact-canonical-id>
# Review dry-run, stop nas-bot, then repeat with --apply and start nas-bot again.
```
