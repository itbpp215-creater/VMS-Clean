# ADR-0019: Decoupling System Master Grid in Dashboard Settings from Admin Personal Grid

- Status: Accepted
- Date: 2026-09-22

## Context

Following the implementation of the Personal User Grid (ADR-0018), each operator can independently customize their 16-channel viewport layout without modifying central configurations or disrupting other concurrent operators. However, in the administrative Settings Modal ("ตั้งค่ากล้อง" -> Tab 2 "หน้าจอกล้อง (Dashboard)"), the channel editing draft was previously initialized by shallow-copying `cfg.channels` directly from the active browser session (`state.draft = cfg.channels.map(...)`).

This introduced a serious operational risk:
If an administrator had configured their own personal viewing grid on the live dashboard (e.g., monitoring a specific set of incident cameras) and subsequently opened the Settings Modal to adjust camera ingest, AI detections, or storage settings, the administrator's personal channel selections would unintentionally overwrite the central System Master Grid (`/settings/channels` / `channels.json`) upon saving. Consequently, new user accounts and operators resetting to system defaults would inherit the administrator's temporary private layout instead of the authentic master baseline.

## Decision

1. **System Master Grid Isolation**:
   - The Dashboard Settings modal (Tab 2: หน้าจอกล้อง) is decoupled from the administrator's personal viewport.
   - When opening settings, the system asynchronously fetches the authentic baseline channels from `/settings/channels` (`fetchServerMasterChannels()`) into `state.draft`, guaranteeing that the settings modal always manages the central System Master Grid regardless of what the administrator is viewing on their active screen.
2. **Zero Disruption Propagation Policy**:
   - Saving changes in Tab 2 persists strictly to the central System Master Grid (`/settings/admin/channels`).
   - Saving changes does NOT alter or overwrite the personalized grids of 100+ concurrent operators who already customized their layouts.
   - The updated master grid is inherited exclusively by:
     1. Newly created user accounts on their initial login.
     2. Existing operators who explicitly click "คืนค่าผังระบบ" (`btnResetLayout`).
   - If the administrator who saves the master grid currently has an active Personal User Grid, their personal view remains intact. If they are viewing the default baseline, their view is safely updated.
3. **Clear Visual Context**:
   - Tab 2 features a prominent purple header banner (`.master-grid-banner`) with a `ผังแม่แบบระบบส่วนกลาง (System Master Grid)` badge and descriptive note explicitly clarifying that modifications here define the system-wide baseline template, not a personal layout.
4. **1-Click "Copy Current Screen to Master" Feature**:
   - Added `btnCopyCurrentToMaster` with an SVG copy icon in Tab 2, enabling administrators to intentionally promote their currently active live screen layout into the System Master Grid draft in a single click with user confirmation.

## Consequences

- Completely eliminates accidental corruption of the System Master Grid caused by administrators browsing customized personal grids.
- Provides total operational safety for 100+ concurrent field operators during administrative configuration maintenance.
- Streamlines the workflow for promoting proven multi-camera operational layouts into the organizational standard template.
