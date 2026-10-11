# License Plate Recognition (LPR) — reviewed Thai plates

- **Status:** DEPLOYED; reviewed training has not yet reached its promotion gate
- **Last reconciled:** 2026-08-20
- **Evidence:** `lpr-service/app.py`, `lpr-service/line_ocr.py`, `lpr-service/train_pipeline.py`, `watchlist-api/api.py`, `watchlist-api/lpr_learning.py`, `web/assets/app.js`, `docker-compose.yml`

## Purpose

The existing external LPR sidecar remains the runtime boundary for Thai plates, but an AI output is now an observation rather than truth. A searchable plate, Watchlist hit, and training example become authoritative only after a privileged human review.

This upgrade addresses false crops such as signs, clothing, road markings, vehicle trim, and unrelated image regions being presented as plates.

## Detection and reading contract

```text
Frigate vehicle event
  -> one spatial vehicle cluster on camera: sample bounded high-resolution mainstream frames
  -> optional LPR zone (or full main frame when no zone exists)
  -> concurrent vehicles: fall back to exact snapshot + event box
  -> license_plate.pt detector (all candidates)
  -> four-corner plate crop
  -> whole-line registration/province OCR
  -> legacy per-character data_plate.pt fallback
  -> rank crop area, sharpness, detector confidence, and OCR confidence
  -> require the same readable text across distinct frames
  -> publish readable AI result to Frigate as pending
  -> one pending candidate per physical plate
  -> link same plate to vehicle + associated person event
```

Mainstream inference runs only while the camera has one unambiguous spatial vehicle cluster. Overlapping car/truck/motorcycle labels are merged as one physical owner and the largest event box becomes its primary event; disjoint vehicle clusters fall back to exact Frigate snapshots. A configured LPR zone is the preferred boundary, while a camera without a zone can use its full main frame because every result remains pending review. A person box is never used as a plate owner.

The default runtime samples at most 12 main-feed frames per event and requires the same plausible registration/province read in at least two distinct frames. Duplicate detections within one frame count as one vote. A consensus result is immediately written to Frigate's searchable plate fields with AI-pending semantics; partial and unreadable observations remain review-only and never create placeholder registrations.

The user-visible states are:

| State | Meaning |
|---|---|
| `not_found` | ไม่พบป้ายทะเบียน |
| `detected_unreadable` | พบป้ายทะเบียน แต่ไม่สามารถอ่านได้ |
| `partial` | อ่านได้บางส่วน; missing characters remain blank |
| `readable` | registration and province pass plausibility checks |
| `pending_review` | AI result has not been confirmed by a person |

Whole-line OCR reads the registration and province rows together as a batch. The original character detector remains a fallback during migration and rollback; it is not discarded.

## Human review

Administrators open an event candidate, select the clearest video frame, move four independent corners, and preview a perspective-corrected crop. They must choose exactly one answer:

- not a plate
- plate found but unreadable
- partially readable
- fully readable

Partial answers contain only characters actually visible; the system does not fill missing characters. A fully readable answer requires a plausible normalized registration and province.

“Plate found but unreadable” is a detector-positive, OCR-free answer: its reviewed crop teaches the detector that the shape is a real plate without inventing characters. “Not a plate” requires one reason category (sign/text, logo/brand, clothing/pattern, road marking, vehicle part, reflection/light, wrong region, or other with detail). The reason is stored with the restricted hard negative for audit, distribution reporting, and future balanced sampling.

Legacy events that still contain an old Frigate plate label but have no reviewed candidate expose **Review/teach AI** instead of only Delete. An administrator can also add a missed plate from the event video; the API creates one idempotent manual-review candidate and the submitted perspective crop becomes training data only after the review is saved.

Every editable candidate crop exposes **Not a plate / delete and teach AI** beside the ordinary review action. The red action opens the same review form with **Not a plate** preselected, requires a reason category, and removes only the operational crop after the human answer is saved. It never deletes or stops the source event video.

Ordinary administrator reviews are immutable audit facts. Conflicting latest answers set the candidate to `conflict`, disable its training examples, and require the sole superadministrator `arm215` to adjudicate. Browser user management cannot create another superadministrator; promotion is a local CLI operation.

## Operational and training data

- AI-only candidates are pending and are never training truth. A readable multi-frame consensus may be searchable in Frigate before review, but cannot create Watchlist history or alerts; review correction overwrites it and unreadable/non-plate review clears it.
- Candidate ingestion is at-least-once: a Watchlist API outage or missing service credential writes the complete idempotent payload atomically under `lpr-data/outbox/candidates/`. The runtime replays a bounded batch after every successful Frigate poll and deletes a spool only after API acceptance. An ended in-memory event is not discarded if neither delivery nor durable spooling succeeds.
- Confirmed plates, including unreadable plates, create positive detector examples; only visible registration/province rows create the corresponding OCR examples.
- A confirmed non-plate crop is removed from operational display, copied to the restricted negative dataset, and used to teach the detector what is not a plate.
- Correcting or conflicting reviews disables older examples without deleting the audit record.
- Existing human-confirmed legacy samples migrate once as confirmed truth.
- Existing AI-only Frigate labels migrate to pending review only.
- No review path changes Frigate event retention or deletes event video.

## Watchlist behavior

Only a human-confirmed full read can create a confirmed Watchlist history row. A human-confirmed partial string can create a `possible_partial_match` notification when it is a contiguous substring of an active Watchlist plate, but it remains explicitly tentative and never enters confirmed history.

Alerts are written to a durable SQLite outbox in the same transaction as review. The learning worker sends queued messages and optional crops through configured Discord and Telegram channels, retries failures, and exposes delivery state with the candidate.

The runtime and trainer publish atomic JSON heartbeats. Docker marks `lpr` healthy only while its model is ready, the heartbeat is fresh, and Frigate polling succeeds; `lpr-trainer` remains observable during long epochs through its independent heartbeat thread. The production detector and character-confidence defaults are both `0.35`; any reduction requires a reviewed precision/recall comparison because it increases false-review workload.

## Reviewed active learning

`lpr-trainer` is a worker component of the existing LPR system, not a separate product. It has no camera access and consumes only approved examples.

1. The default automatic threshold is 500 new approved examples; `arm215` can change it from the administrator page.
2. Coverage requires reviewed positive detector, negative detector, registration OCR, and province OCR examples (default at least 25 of each).
3. Missing Thai plate layouts/characters/provinces are supplemented with synthetic Thai plates using installed Thai fonts.
4. The existing detector is fine-tuned rather than replaced from scratch. A contextual CTC line reader is trained for registration/province rows.
5. Stable train/validation/test assignment prevents a sample moving between evaluation and training across versions.
6. Detector mAP/precision and OCR character error rate must not regress beyond the configured tolerance.
7. A passing pair of checkpoints is atomically promoted through `lpr-model-store/active.json`; runtime preloads both before swapping.
8. Failed versions remain rejected; prior passing versions remain available for a superadministrator rollback.
9. Job start, promotion, validation failure, rollback, and failure are reported in the UI and through Discord/Telegram.

The initial repository does not include the original training dataset or `data.yaml`. The first reviewed generation therefore requires enough human-confirmed samples to satisfy coverage; no new trained model is claimed by this change alone.

## Administrator UI

The existing event archive remains the single LPR review surface; no separate
menu or duplicate event store is introduced. Administrators can filter the same
cards by **AI — pending review**, **partially readable**, **plate detected but
unreadable**, **confirmed**, **not a plate**, or **conflicting answers**. Each
matching card carries a compact review-state badge even when it correctly has no
`recognized_license_plate`. The metadata endpoint is administrator-only and
never creates placeholder plate strings.

The event detail supports multiple candidate chips and displays the exact status and Watchlist match class. Pending/confirmed editable candidates show both **Review/teach AI** and **Not a plate / delete and teach AI**; the latter opens the reason-coded negative form instead of performing an immediate destructive delete. The result card keeps status, candidates, and actions in separate visual groups: actions share one aligned row on desktop, two equal columns on tablets, and full-width stacked touch targets on phones. The settings page includes “การเรียนรู้ป้ายทะเบียน” with pending-review count, unused approved examples, threshold, latest job progress, retained model versions, and superadministrator-only rollback controls.

Event video playback does not treat list-level `has_clip=false` as permanent because that value can be stale while Frigate finalizes recording. The UI requests the MP4 and trusts the HTTP result; for a candidate opened through an associated person event, playback/download/share use the candidate's primary vehicle event link. If an event-specific MP4 is unavailable, desktop playback checks the camera's locally retained recordings and builds only the bounded event window (pre-capture through ten seconds after the event) before reporting that the video is unavailable. This uses the existing files and does not change the recording-retention policy. A genuinely unavailable or not-yet-finalized clip shows a retryable message instead of claiming the video was deleted.

For an older event where Frigate reports no matching local recording segment, the detail view explicitly says that the event has only a Snapshot and includes the camera/time window. It does not present a misleading retry instruction.

The teaching dialog uses a normal draggable/resizable rectangle rather than perspective corners. Readable and partial OCR answers enforce a minimum natural size of 64×20 pixels. If the saved detector crop is the only exact evidence frame, a privileged reviewer may still save that smaller crop as **unreadable** (positive detector-only) or **not a plate** (reason-coded negative); it never creates an OCR label or silently switches to a later Snapshot.

## Snapshot-only teaching

The teaching dialog uses a normal draggable/resizable rectangle rather than perspective corners. Its preview is a direct rectangular crop. Readable and partial OCR answers require 64×20 natural pixels, while an exact smaller detector crop can be retained only as unreadable positive detector evidence or a reason-coded non-plate negative. When an event has no MP4 (including a manual candidate from a person event), the Snapshot is shown immediately as an optional annotation surface; it is never silently substituted for the exact crop because it can be a different frame. The event-detail result avoids the obsolete event-ID crop request, so it does not wait for or show a broken legacy crop before the selected candidate has a reviewed crop.

## Storage and access

| Data | Path / store | Access |
|---|---|---|
| operational crops | `lpr-data/crops/` | authenticated UI |
| approved examples | `config/lpr/dataset/approved/` | admin metadata; trainer filesystem |
| restricted negatives | `config/lpr/dataset/restricted/negative/` | trainer/admin boundary only |
| candidate/review/job/model metadata | `config/lpr/watchlist.db` | Watchlist API / worker |
| retained checkpoints | `lpr-model-store/` | trainer write; runtime read |
| original detector/fallback character model | `LicensePlateRECOG/model/` | read-only runtime/trainer base |

## Validation

- Watchlist API tests cover machine identity, idempotent observations, multi-event links, review truth, negative retention, conflict/adjudication, threshold RBAC, legacy migration, and exact-versus-partial Watchlist semantics.
- LPR tests cover vehicle-box-only inference, no guessed text, multiple status handling, association, candidate outage spooling/replay, fail-closed heartbeats, pending legacy migration, deterministic training splits/gates, atomic model pointer, and durable alert delivery.
- Authentication tests cover inherited administrator capability, the separate superadministrator gate, and unique `arm215` promotion constraints.

Production image build, service startup, live candidate submission, and GPU visibility passed on 2026-08-19. Actual reviewed model fine-tuning/promotion and live Discord/Telegram delivery remain acceptance gates until enough reviewed data exists.

## Related

- [Watchlist](watchlist.md)
- [Architecture](../architecture.md)
- [Environment variables](../reference/environment-variables.md)
- [ADR-0005](../decisions/ADR-0005-thai-lpr-external-sidecar.md)
- [ADR-0007](../decisions/ADR-0007-lpr-zone-in-sidecar.md)
- [ADR-0014](../decisions/ADR-0014-reviewed-thai-lpr-active-learning.md)


## Watchlist alert tiers (ADR 0030)
| Tier | Rule | Message |
|---|---|---|
| exact | full plate equal | AI อ่านตรงทะเบียนเฝ้าระวังทุกตัว — ยังไม่ยืนยัน |
| letters_partial | digit group equal (>=3) + >=1 letter in position | AI อ่านเลขตรง อักษรตรงบางตัว |
| digits_only | digit group equal (>=3), no letters | AI อ่านเลขตรง ไม่เห็นอักษร — ความมั่นใจต่ำ |

Weak tiers: 5-minute cooldown per plate+camera. Delivery is done by lpr-service from the watchlist-api outbox.
