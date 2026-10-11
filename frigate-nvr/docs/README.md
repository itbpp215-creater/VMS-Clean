# Project Documentation Index

เอกสารในโฟลเดอร์นี้คือฐานความรู้หลักของ **BPP PrerimWatch** ซึ่งทำงานบน **Ai CCTV Surveillance Platform** ที่พัฒนาต่อยอดจาก Frigate NVR

> เริ่มต้นจาก [`../CLAUDE.md`](../CLAUDE.md) แล้วใช้หน้านี้เป็นสารบัญกลาง

## Source of truth

เมื่อข้อมูลขัดแย้งกัน ใช้ลำดับนี้:

1. **โค้ดและ config บน branch ที่กำลังใช้งาน**
2. **[`current-state.md`](current-state.md)** — snapshot ของสถานะระบบปัจจุบัน
3. **เอกสารเฉพาะเรื่อง** — architecture, feature, operations, security, reference
4. **ADR** — เหตุผลของการตัดสินใจทางสถาปัตยกรรม
5. **Session logs / history** — ลำดับเหตุการณ์ ไม่ใช่ current state

## Core documents

| เอกสาร | หน้าที่ |
|---|---|
| [`current-state.md`](current-state.md) | สถานะระบบปัจจุบันที่ต้องตรงกับโค้ด |
| [`architecture.md`](architecture.md) | Components, layers, data flow และ dependencies |
| [`operations.md`](operations.md) | Install, deploy, health check และ maintenance |
| [`security-model.md`](security-model.md) | Trust boundary, secrets, CSRF และ network exposure |
| [`troubleshooting.md`](troubleshooting.md) | อาการ สาเหตุ วิธีวินิจฉัย และแนวทางแก้ที่พิสูจน์แล้ว |
| [`history.md`](history.md) | Timeline การเปลี่ยนแปลงสำคัญระดับระบบ |
| [`documentation-guide.md`](documentation-guide.md) | กติกาการดูแลเอกสาร |

## Feature documentation

ดูสารบัญที่ [`features/README.md`](features/README.md)

เอกสารปัจจุบัน:

- [`features/operator-dashboard.md`](features/operator-dashboard.md)
- [`features/object-detection.md`](features/object-detection.md)
- [`features/event-investigation.md`](features/event-investigation.md)
- [`features/playback.md`](features/playback.md)
- [`features/media-capture.md`](features/media-capture.md)
- [`features/camera-provisioning.md`](features/camera-provisioning.md)
- [`features/storage-management.md`](features/storage-management.md)
- [`features/branding-and-compliance.md`](features/branding-and-compliance.md)
- [`features/license-plate-recognition.md`](features/license-plate-recognition.md)
- [`features/watchlist.md`](features/watchlist.md)
- [`features/installation-and-account-migration.md`](features/installation-and-account-migration.md)

- [`features/multi-site-releases.md`](features/multi-site-releases.md)

## Architecture decisions

ดู [`decisions/README.md`](decisions/README.md)

Current accepted ADRs:

- [`ADR-0001-dashboard-same-origin-proxy.md`](decisions/ADR-0001-dashboard-same-origin-proxy.md)
- [`ADR-0002-cam11-ffmpeg-rtmp-ingest.md`](decisions/ADR-0002-cam11-ffmpeg-rtmp-ingest.md)
- [`ADR-0003-storage-threshold-inside-frigate.md`](decisions/ADR-0003-storage-threshold-inside-frigate.md)
- [`ADR-0004-git-managed-production-deployment.md`](decisions/ADR-0004-git-managed-production-deployment.md)
- [`ADR-0005-thai-lpr-external-sidecar.md`](decisions/ADR-0005-thai-lpr-external-sidecar.md)
- [`ADR-0006-camera-disable-via-enabled-restart.md`](decisions/ADR-0006-camera-disable-via-enabled-restart.md)
- [`ADR-0007-lpr-zone-in-sidecar.md`](decisions/ADR-0007-lpr-zone-in-sidecar.md)
- [`ADR-0008-server-side-auth-and-federation.md`](decisions/ADR-0008-server-side-auth-and-federation.md)
- [`ADR-0009-crash-safe-config-transactions.md`](decisions/ADR-0009-crash-safe-config-transactions.md)
- [`ADR-0010-verified-new-camp-package.md`](decisions/ADR-0010-verified-new-camp-package.md)
- [`ADR-0011-gui-installation-and-encrypted-account-migration.md`](decisions/ADR-0011-gui-installation-and-encrypted-account-migration.md)
- [`ADR-0012-complete-machine-migration-archive.md`](decisions/ADR-0012-complete-machine-migration-archive.md)

- [`ADR-0013-multi-site-portable-releases.md`](decisions/ADR-0013-multi-site-portable-releases.md)

## Technical reference

- [`reference/README.md`](reference/README.md)
- [`reference/frigate-configuration.md`](reference/frigate-configuration.md)
- [`reference/environment-variables.md`](reference/environment-variables.md)

## Session logs

ดู [`sessions/README.md`](sessions/README.md)

Session logs เป็น historical record ของการทำงาน/การทดลอง ไม่ใช่ current state

Legacy session logs (2026-06-21 ถึง 2026-07-10) ถูกย้ายจากระดับ `docs/` เข้า `docs/sessions/` แล้ว (2026-07-16) — index อยู่ใน `sessions/README.md` และทุกไฟล์มี HISTORICAL banner

## Documentation principles

- `CLAUDE.md` เป็น entry point ไม่ใช่ที่เก็บรายละเอียดทุกเรื่อง
- Feature ที่ซับซ้อนต้องมี owner document ใน `docs/features/`
- การเปลี่ยน architecture สำคัญต้องมี ADR
- Incident ที่อาจเกิดซ้ำต้องเพิ่ม `troubleshooting.md`
- Production topology/model/camera/port/deployment เปลี่ยนต้องอัปเดต `current-state.md`
- ห้ามเก็บ secret หรือ credential จริงใน Git
- TODO จาก session ที่ยังต้องทำจริงควรย้ายเป็น GitHub Issue แทนการสะสมใน current-state

## Structure

```text
docs/
├── README.md
├── current-state.md
├── architecture.md
├── operations.md
├── security-model.md
├── troubleshooting.md
├── history.md
├── documentation-guide.md
├── features/
├── decisions/
├── reference/
└── sessions/
```
