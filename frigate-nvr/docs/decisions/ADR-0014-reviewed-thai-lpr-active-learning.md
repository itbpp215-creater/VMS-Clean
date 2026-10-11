# ADR-0014: Human-reviewed Thai LPR with bounded inference and versioned active learning

- Status: Accepted; searchable-display portion of Decision 3 superseded by ADR-0015
- Date: 2026-08-19

## Context

The original sidecar could crop arbitrary high-confidence regions, accept a per-character OCR result as truth, update Frigate, and alert immediately. Screenshots demonstrated signs, clothes, road paint, vehicle parts, and blurred regions presented as readable license plates. The original model files exist, but the source dataset and `data.yaml` do not.

The system must continue recording video regardless of whether an LPR crop is later rejected. It must support Thai plate layouts, multiple plates, incomplete reads, human teaching, controlled automatic training, and rollback.

## Decision

1. Retain the existing external LPR sidecar and base detector/character models.
2. Restrict plate search to the exact vehicle region intersected with the optional camera LPR zone. Person events may share a relationship link but never define the search crop.
3. Treat every AI result as a pending multi-candidate observation. Human-confirmed truth remains required for Watchlist history, alerts, and training data; ADR-0015 now permits a multi-frame readable consensus to update searchable Frigate fields while it remains pending.
4. Store immutable reviews. Ordinary administrators can review; conflicting answers require the unique superadministrator `arm215`.
5. Represent non-plate, unreadable, partial, and readable as distinct review answers. Never infer omitted characters. Unreadable is a positive detector label with no OCR label; non-plate requires a reason-coded hard-negative category.
6. Add contextual whole-line OCR for registration/province rows while preserving per-character OCR as fallback.
7. Use reviewed positives and negatives plus synthetic Thai coverage to fine-tune the existing detector and line OCR. Apply deterministic holdouts, coverage gates, no-regression metrics, atomic pair promotion, retained versions, and explicit rollback.
8. Queue reviewed Watchlist notifications in a durable outbox. Partial matches are tentative; only exact full reads enter confirmed history.
9. Never alter Frigate retention from the LPR review path. A non-plate removes only its operational crop and retains a reason-coded restricted negative training copy.

## Alternatives considered

- Raise detector confidence only: rejected because many false regions had high confidence and blur would still be guessed.
- Replace both existing models immediately: rejected because no verified original dataset/label contract exists and an unvalidated replacement could regress production.
- Train directly from every AI result: rejected because it would reinforce false positives.
- Use person boxes as a shortcut for motorcycles: rejected because a person box contains many non-plate textures and violates the requested vehicle-only boundary.
- Promote partial Watchlist matches as confirmed hits: rejected because omitted characters make identity ambiguous.

## Consequences

- Searchable AI-pending plate results may arrive before review under ADR-0015; correctness, Watchlist actions, and training authority still require review.
- Training cannot start merely because synthetic data exists; reviewed coverage is mandatory.
- The Compose topology gains an internal `lpr-trainer` worker and persistent model store, but no new user-facing product.
- Two models must load successfully before runtime swaps versions.
- Administrators need a review workflow; `arm215` carries exclusive conflict, threshold, and rollback responsibility.

## Validation

Unit suites cover inference bounds, status semantics, immutable/conflicting reviews, negative retention without video changes, legacy migration, dataset gates, atomic promotion metadata, and durable notification delivery. Live Docker build, GPU fine-tuning, camera acceptance, and bot delivery are required before production promotion.

## Revisit when

- a verified original labeled dataset and class map become available;
- Thai plate rules materially change;
- the review volume or false-negative rate justifies a second-stage plate classifier;
- a managed model registry replaces the local version store.

## Related

- [`ADR-0005-thai-lpr-external-sidecar.md`](ADR-0005-thai-lpr-external-sidecar.md)
- [`ADR-0007-lpr-zone-in-sidecar.md`](ADR-0007-lpr-zone-in-sidecar.md)
- [`../features/license-plate-recognition.md`](../features/license-plate-recognition.md)
