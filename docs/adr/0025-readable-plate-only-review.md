# Partial plates are logged, not reviewed; only a watchlist hit alerts

A **Readable Plate** (registration + province) becomes a Plate Candidate that waits for human review. A **Partial Plate** (registration characters but no province) is archived in the LPR library (bucket "ไม่ครบ") with its crop image so it stays searchable and auditable, but it is not a review task. A plate box with no readable text at all is dropped.

Amendment (same day): the first version of this ADR dropped partial plates entirely and wrote their text into the Frigate event. Both parts were reversed on operator feedback:

- A partial plate whose letters+digits **exactly equal** an active watchlist plate still alerts, regardless of province (province was never part of the watchlist match). It is queued for review and an immediate Discord/Telegram alert is sent, clearly worded "AI read, province unreadable, not yet confirmed". Fragments (e.g. `กข12`) and fuzzy/substring matches never alert automatically.
- Nothing is written to the Frigate `sub_label` / `recognized_license_plate` for partial plates: the dashboard renders those fields as "[ยืนยันแล้ว: …]", which would present an unconfirmed read as confirmed.

## Consequences

- The review queue only contains Readable Plates and partial plates that hit the watchlist.
- Non-matching partial plates are stored with `status='partial'`, `review_state='adjudicated'`, `human_confirmed=0`, visible in the archive; no pending work for officers.
- Decision is made server-side in `create_lpr_candidate` (`watchlist-api/api.py`, `_exact_watchlist_matches`, `_queue_ai_unconfirmed_alerts`), reusing the existing `possible_partial_match` alert type (no schema change). Alert wording lives in `_alert_message` (`lpr-service/train_pipeline.py`).
- `lpr-service` only drops `detected_unreadable` (`REVIEW_EXCLUDED_STATUSES`).
- A human reviewing a pending partial hit cancels the unsent unconfirmed alert and re-queues according to the decision (existing behaviour of `_queue_watchlist_alerts`).
- The 21 partial rows hidden earlier were restored into the archive "ไม่ครบ" bucket (backup `/data/watchlist.db.bak-20261004-partial`).
