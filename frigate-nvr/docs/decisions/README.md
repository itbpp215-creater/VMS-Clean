# Architectural Decision Records (ADR)

โฟลเดอร์นี้บันทึกเหตุผลของการตัดสินใจทางสถาปัตยกรรมที่สำคัญ เพื่อให้คนที่เข้ามาดูแลภายหลังเข้าใจว่าเหตุใดระบบจึงเป็นแบบนี้ และเงื่อนไขใดทำให้ควรเปลี่ยนการตัดสินใจนั้น

## Current ADRs

1. [`ADR-0001-dashboard-same-origin-proxy.md`](ADR-0001-dashboard-same-origin-proxy.md) — ใช้ `/nvr/` same-origin proxy แทน wildcard CORS
2. [`ADR-0002-cam11-ffmpeg-rtmp-ingest.md`](ADR-0002-cam11-ffmpeg-rtmp-ingest.md) — ใช้ FFmpeg wrapper แทน native go2rtc RTMP client สำหรับ `cam11`
3. [`ADR-0003-storage-threshold-inside-frigate.md`](ADR-0003-storage-threshold-inside-frigate.md) — ให้ disk-threshold cleanup อยู่ใน Frigate storage management
4. [`ADR-0004-git-managed-production-deployment.md`](ADR-0004-git-managed-production-deployment.md) — ใช้ Git เป็น source of truth ของ tracked production files
5. [`ADR-0005-thai-lpr-external-sidecar.md`](ADR-0005-thai-lpr-external-sidecar.md) — อ่านป้ายทะเบียนไทยด้วย external sidecar แทน built-in LPR ของ Frigate
6. [`ADR-0006-camera-disable-via-enabled-restart.md`](ADR-0006-camera-disable-via-enabled-restart.md) — ปิด/เปิดกล้องด้วย camera-level enabled + restart
7. [`ADR-0007-lpr-zone-in-sidecar.md`](ADR-0007-lpr-zone-in-sidecar.md) — โซนจับป้ายอยู่ฝั่ง lpr-service ไม่ใช่ Frigate zones
8. [`ADR-0008-server-side-auth-and-federation.md`](ADR-0008-server-side-auth-and-federation.md) — server-side RBAC, secure bootstrap และ Federation trust หลายชั้น
9. [`ADR-0009-crash-safe-config-transactions.md`](ADR-0009-crash-safe-config-transactions.md) — lock, validation, backup, atomic replace และ rollback ของ Config API
10. [`ADR-0010-verified-new-camp-package.md`](ADR-0010-verified-new-camp-package.md) — ส่งมอบตัวติดตั้งใหม่พร้อม manifest, fail-fast deployment และ one-time credential handoff ที่ถูกต้อง
11. [`ADR-0011-gui-installation-and-encrypted-account-migration.md`](ADR-0011-gui-installation-and-encrypted-account-migration.md) — GUI installer, selected installation path และ encrypted user migration
12. [`ADR-0012-complete-machine-migration-archive.md`](ADR-0012-complete-machine-migration-archive.md) — encrypted full-host migration without the GUI installer
13. [`ADR-0013-multi-site-portable-releases.md`](ADR-0013-multi-site-portable-releases.md) — manifest-driven multi-site TARs, per-node identity and offline update rollback
14. [`ADR-0014-reviewed-thai-lpr-active-learning.md`](ADR-0014-reviewed-thai-lpr-active-learning.md) — bounded vehicle-only Thai LPR, human truth, versioned active learning and rollback
15. [`ADR-0015-mainstream-multiframe-ai-pending-lpr.md`](ADR-0015-mainstream-multiframe-ai-pending-lpr.md) — bounded main-feed sampling, distinct-frame consensus and searchable AI-pending results
16. [`ADR-0016-person-identity-synchronization.md`](ADR-0016-person-identity-synchronization.md) — immutable technical identifiers, exact strong-identity resolution and recoverable multi-file display-name synchronization

## เมื่อใดควรสร้าง ADR

สร้างเมื่อมีการตัดสินใจที่:

- เปลี่ยน component หรือ data flow หลัก
- เปลี่ยน AI model/runtime/provider
- เปลี่ยน storage policy หรือ database behavior
- เปลี่ยน deployment/CI/CD strategy
- เพิ่ม security boundary หรือ authentication model
- เลือก workaround ระยะยาวที่มี trade-off
- ย้าย production topology หรือ platform

ไม่ต้องสร้าง ADR สำหรับ bug fix เล็ก ๆ หรือ UI tweak

## Naming

```text
ADR-0001-short-title.md
ADR-0002-short-title.md
```

## Template

```markdown
# ADR-XXXX: Title

- Status: Proposed | Accepted | Superseded | Deprecated
- Date: YYYY-MM-DD

## Context
## Decision
## Alternatives considered
## Consequences
## Validation
## Revisit when
## Related
```

## Rule

ADR ไม่ใช่คู่มือใช้งานและไม่ใช่ current state

- current behavior -> `../current-state.md` / `../features/`
- implementation flow -> `../architecture.md`
- operational procedure -> `../operations.md`
- incident -> `../troubleshooting.md`
- decision rationale -> ADR

- [ADR-0017: Reviewed evidence graph and licensed Windows i2 bridge](ADR-0017-i2-evidence-and-windows-bridge.md)
