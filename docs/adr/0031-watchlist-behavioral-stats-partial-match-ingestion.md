# 0031 - Watchlist behavioral stats partial match ingestion

Status: proposed (2026-10-07). Extends ADR 0030.

## Context
Previously, `watchlist_history` (the source of truth for the Watchlist Behavioral Analytics modal, charts, and 500-record history table) only recorded detections when the AI plate read matched a watchlist plate with 100% exact equality. When a target vehicle passed by and OCR missed a single letter or prefix (e.g. `กข9999` instead of `9กข9999`), an unconfirmed alert was dispatched under ADR 0030, but no entry was recorded into `watchlist_history`. The analytics modal showed 0 frequency and empty charts for that pass.

## Decision
1. **Ingestion Scope**: Detections with `tier in ("exact", "letters_partial")` (from `lpr_learning.match_tier`) are ingested into `watchlist_history`. The `digits_only` tier is deliberately excluded to prevent random vehicles with identical 3-4 digit groups from polluting target analytics.
2. **Deduplication Cooldown**: A 3-minute cooldown window per `(watchlist_plate, camera)` is enforced when recording into `watchlist_history`. Multiple frames/observations from a single vehicle transit count as exactly 1 visit in aggregate charts.
3. **Storage Schema**:
   - `plate`: canonical watchlist plate key (e.g. `9กข9999`) to correctly populate aggregate queries.
   - `observed_plate`: actual AI OCR text read from the image (e.g. `กข9999`).
   - `match_tier`: `exact` or `letters_partial`.
4. **UI Auditability**: The recent history table in `watchlist.js` renders the observed plate text and an indicator badge for partial matches (`กข9999 (อักษรตรงบางส่วน)`).
5. **No Historical Backfill**: Applies only to new incoming events forward; past candidates are untouched.

## Consequences
- Behavioral analytics graphs (camera distribution, hourly frequency, day of week) and history tables reflect vehicle passes even when OCR reads are partially occluded or missing leading digits.
- False positive contamination from generic numbers is avoided by excluding `digits_only` from stats.
