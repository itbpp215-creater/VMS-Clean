# 0030 - Tiered watchlist match and digits-only gate

Status: accepted (2026-10-07). Revises ADR 0025, 0026, 0029 (does not modify `is_valid_thai_plate`).

## Context
Alerts only fired on a full exact read, and Readable plates waited for human review. Digits-only reads on cars were dropped. The outbox consumer lived in `lpr-trainer` (manual profile, not running): `lpr_alert_outbox` never delivered anything.

## Decision
- `lpr_learning.match_tier(observed, watch)`: `exact` (red), `letters_partial` (orange: trailing digit group equal, >=3 digits, at least one positional letter equal), `digits_only` (yellow: digit group equal, >=3 digits, no letters read). Anything else: no alert.
- `lpr-service` accepts a digits-only read as `partial` only if it equals a digit group of an active watchlist plate; other digits-only reads are still dropped (ADR 0026/0029 protection).
- AI Readable plates matching the watchlist alert immediately as unconfirmed (previously after human review).
- Weak tiers: 5-minute cooldown per (watchlist plate + camera). Exact is never suppressed.
- `lpr-service` delivers the outbox itself via internal watchlist-api endpoints `alerts/recover|claim|{id}/result` (Discord, Telegram, nas-bot `watchlist_plate`). No compose/image change. `train_pipeline.py` (baked into image) is untouched and uses the same atomic claim, so no double send; its heading wording may differ if the manual trainer is ever run.
- Live frame source unchanged (Frigate detect-stream `latest.jpg`); main stream only in Recording Replay.

## Consequences
More alerts for the 3-digit watchlist plates (estimated ~0.3 false digit-only alerts/day). Monitor for 24h.