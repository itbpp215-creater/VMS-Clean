# ADR-0015: Mainstream multi-frame LPR with searchable AI-pending results

- Status: Accepted
- Date: 2026-08-20

## Context

The reviewed LPR flow prevented false alerts but also hid every AI observation from Frigate's license-plate category until an administrator reviewed it. Production showed a 29-hour-old last searchable result even while the detector continued creating pending candidates. Single snapshots also produced small, blurred, or reflective crops that were frequently unreadable.

## Decision

1. A Frigate vehicle event remains the only trigger; person events remain association metadata.
2. When one spatial vehicle cluster owns a camera, LPR samples a bounded set of high-resolution main-feed frames. Overlapping Frigate labels are merged and the largest event represents that physical vehicle. A configured LPR zone is preferred; cameras without one may use the full frame because results remain reviewable.
3. Concurrent vehicle events are ambiguous, so the service falls back to the exact event snapshot and its matching vehicle box.
4. Crop area, sharpness, detector confidence, OCR confidence, and readable status rank evidence. Duplicate reads within one frame count as one vote.
5. A plausible readable registration/province must agree across distinct frames before it is written to Frigate as an AI-pending `recognized_license_plate` and `sub_label`.
6. Partial and unreadable candidates never create placeholder plate text. Every detector-positive crop still enters human review.
7. Human review remains authoritative: approval/correction overwrites the AI value; unreadable or non-plate review clears it. Watchlist history, alerts, and training truth remain human-confirmed only.

## Alternatives considered

- Keep snapshot-only review: rejected because it does not satisfy immediate plate-category visibility and loses temporal image quality choices.
- Publish every single-frame OCR result: rejected because blur and reflections would make transient guesses searchable.
- Assign full-frame results while multiple vehicles share a camera: rejected because the plate could be linked to the wrong event.
- Require human review before any Frigate field update: superseded for searchable display by this decision; it remains mandatory for operational truth and alerts.

## Consequences

- Readable results appear sooner while retaining an explicit pending review record.
- Main-feed requests and CPU work increase but are capped per event.
- Cameras benefit from a configured LPR zone; without one, reviewers may receive more false candidates.
- A short-lived wrong AI consensus can be searchable until review, but it cannot trigger a confirmed watchlist action.

## Validation

Unit tests cover distinct-frame voting and exclusion of partial/invalid reads. Deployment acceptance must verify main-feed resolution, bounded sampling, pending candidate creation, Frigate field publication, review correction/clearing, service health, and no recorder restart regression.

## Revisit when

- Frigate exposes synchronized per-object boxes for arbitrary main-feed frames;
- review metrics justify a higher consensus quorum;
- multiple simultaneous vehicles require object tracking across the high-resolution stream.

## Related

- [`ADR-0014-reviewed-thai-lpr-active-learning.md`](ADR-0014-reviewed-thai-lpr-active-learning.md)
- [`../features/license-plate-recognition.md`](../features/license-plate-recognition.md)
