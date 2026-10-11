# Feature Documentation

- **Status:** ACTIVE · **Last reconciled:** 2026-08-02 · **Evidence:** `docs/features/`

โฟลเดอร์นี้เก็บเอกสารความสามารถของ Application Layer และ feature ที่มี behavior ซับซ้อนพอที่จะต้องมี owner document ของตัวเอง

## Current feature documents

- [`operator-dashboard.md`](operator-dashboard.md) — Dashboard, layout, live view, event rail และ UX หลัก
- [`object-detection.md`](object-detection.md) — model capability, COCO classes, per-camera tracking และ class policy
- [`event-investigation.md`](event-investigation.md) — event library, search/filter, description metadata และ event detail
- [`playback.md`](playback.md) — calendar, timeline, multi-camera sync, speed และ digital zoom
- [`media-capture.md`](media-capture.md) — snapshot และ client-side recording
- [`camera-provisioning.md`](camera-provisioning.md) — เพิ่มกล้องผ่าน Settings และ config mutation
- [`storage-management.md`](storage-management.md) — retention และ custom storage threshold
- [`branding-and-compliance.md`](branding-and-compliance.md) — BPP branding, white-label และ OSS notices
- [`license-plate-recognition.md`](license-plate-recognition.md) — อ่านป้ายทะเบียนไทย (lpr-service sidecar), sub_label และ suspect alert
- [`watchlist.md`](watchlist.md) — Watchlist PII, history, server RBAC, Federation export และ stored-XSS boundary
- [`installation-and-account-migration.md`](installation-and-account-migration.md) — GUI installer, selected install path, custom admin และ encrypted user migration

- [`multi-site-releases.md`](multi-site-releases.md) — unencrypted v1 migration TAR, Clone/NewSite isolation, local-only install and offline update rollback

## Rule

Feature document อธิบาย **พฤติกรรมปัจจุบัน** ไม่ใช่ลำดับการพัฒนา หากต้องการดูว่า feature ถูกสร้างอย่างไรและลองอะไรบ้าง ให้ดู session logs ใน `../sessions/` หรือ legacy session logs ที่ลิงก์จากหน้านั้น

- [i2 Link Analysis](i2-link-analysis.md) — reviewed evidence graph, personal layouts, and `.anb` import
