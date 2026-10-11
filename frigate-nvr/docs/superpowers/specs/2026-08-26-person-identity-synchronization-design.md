# Person Identity Synchronization Design

**Date:** 2026-08-26
**Status:** Approved for implementation planning
**Scope:** NAS Bot person identity updates across Dossiers, Persons, Cases, and graph references

## Problem

Telegram image ingestion currently writes identity data to two persistent models:

- `Cases/**/metadata.json` and `Persons/persons_index.json` through `NASStorageManager` and `PersonRegistry`.
- `Dossiers/<dossier_id>/profile.json` and `Dossiers/dossiers_index.json` through `DossierVaultManager`.

The Arrest Vault edit-name action updates only the selected dossier profile. It does not update the matching Person Registry record, source case metadata, or cached names in linked dossiers. The dossier identifier is derived from the OCR name at creation time, so a corrected display name can coexist with an identifier that contains the original OCR value. Historical synchronization can later read the unchanged case metadata and reintroduce the old name.

## Goals

- Make an officer-approved name the authoritative display name everywhere that represents the same person.
- Preserve `dossier_id`, `person_id`, dossier folder names, graph node IDs, and evidence paths as immutable identifiers.
- Update all affected persistent files as one recoverable operation instead of leaving partially synchronized state.
- Match identity using strong identifiers and explicit source links, never fuzzy name similarity alone during a rename.
- Repair already inconsistent records through a dry-run-first maintenance command.
- Prevent historical `sync-all` from overwriting an officer-corrected name with an older OCR name.
- Persist `linked_person_ids` in case metadata after person registration.

## Non-goals

- Renaming dossier folders or changing existing `dossier_id` and `person_id` values.
- Automatically merging two ambiguous people merely because their names are similar.
- Reprocessing image OCR or modifying original evidence binaries.
- Introducing a message broker, external database, or new infrastructure service.
- Deploying or mutating production data as part of code implementation without a separate validated maintenance run.

## Considered approaches

### Independent writes from the API

The update endpoint could call each existing manager sequentially. This is small but unsafe: a failure after one write would leave the same partial-state problem, and matching rules would remain duplicated across services.

### Event-driven synchronization

The dossier service could publish an identity-change event consumed by the other stores. This would support future scale but adds delivery, idempotency, retry, and reconciliation infrastructure that the current file-backed system does not need.

### Transactional identity synchronization coordinator — selected

A focused coordinator resolves one identity, builds a complete change set, snapshots affected files, writes replacements atomically, and rolls back the snapshot if any replacement fails. This matches the current file-backed architecture while providing one place for identity rules and repair logic.

## Identity and identifier rules

`dossier_id` and `person_id` are immutable technical identifiers even when a legacy value contains a human name. UI labels, search results, exports, and graph labels use the authoritative `suspect_name` field instead of parsing identifiers.

The coordinator resolves a target in this order:

1. The explicitly selected `dossier_id`.
2. An exact national ID match when a valid ID is present.
3. An exact normalized phone match across primary and historical phone fields.
4. Persisted `linked_person_ids` and case source references.

Name similarity is diagnostic information only. It must not authorize a merge or select between multiple candidates. If strong identifiers resolve to conflicting Person Registry records, the operation returns HTTP `409` with non-sensitive record identifiers and performs no writes.

## Components

### Identity synchronization coordinator

A new focused service owns planning and applying identity changes. Its public operation accepts a stable dossier ID and a non-empty corrected display name. It returns a structured result containing the unchanged identifiers, affected-file counts, warnings, and whether the request was a no-op.

The coordinator has two modes:

- `plan`: read-only; validates identity resolution and lists the categories and counts of files that would change.
- `apply`: executes the previously validated rules, with an in-process lock covering plan, snapshot, replace, index rebuild, and verification.

### Dossier manager integration

The existing profile update method continues to handle non-identity fields. A `suspect_name` update delegates to the coordinator instead of directly changing one JSON file. After synchronization, the dossier index is rebuilt from profiles.

The selected dossier profile receives the corrected name. Every other dossier that caches the selected dossier in `linked_dossiers` receives the corrected cached `suspect_name`. Link identities and reasons remain unchanged.

### Person Registry integration

The matching Person Registry record receives the corrected name while retaining its `person_id`, source list, addresses, phones, and timestamps. The coordinator updates only a uniquely resolved record. Absence of a matching registry record is reported as a warning rather than causing a false merge; the selected dossier can still be corrected when no contradictory identity exists.

### Case metadata integration

Only case records proven to belong to the resolved identity are updated. Proof is an exact linked person ID, an exact national ID, an exact normalized phone, or a case ID present in the resolved Person Registry source list. Within a proven case, only the matching suspect entry changes.

New and updated case writes persist `linked_person_ids` after Person Registry upserts. Case identifiers, timestamps, evidence filenames, and evidence content do not change.

### Graph and search behavior

The graph remains generated from dossier profiles, so rebuilding the dossier index exposes the corrected label without changing node IDs or edges. Cached linked-dossier labels are synchronized so detail views agree with graph nodes. Searches continue to accept stable IDs; display-name searches use rebuilt indexes.

## Transaction and filesystem safety

Before applying changes, the coordinator reads and validates every affected JSON document and records its original bytes. It writes each replacement to a temporary sibling file, flushes and closes it, then uses `os.replace` for atomic promotion.

The operation keeps an in-process lock to prevent concurrent identity writes. If validation or staging fails, no original file is replaced. If a promotion or post-write verification fails, every already replaced file is restored from its captured original bytes and indexes are rebuilt from restored profiles. Temporary files are removed only when their resolved paths remain inside the configured NAS storage root.

The API must not log the corrected name, national ID, phone number, address, or full profile. Audit output contains stable record IDs, counts, status, and the authenticated operator identity when available.

## Historical synchronization rules

Historical `sync-all` remains an ingestion/reconciliation operation, not an authority over officer corrections. Existing dossiers must not have `suspect_name` overwritten by OCR-derived case data when the dossier records that an officer correction is authoritative.

An applied identity correction records minimal provenance on the dossier profile:

- `name_source: "officer_correction"`
- `name_corrected_at`: ISO-8601 timestamp
- `name_corrected_by`: authenticated username or `system_migration`

Upsert logic preserves an officer-corrected name. Strong identifiers may still add phones, addresses, sources, files, and other non-name fields. A new OCR record without strong identifiers cannot merge into the corrected dossier based only on a partial or fuzzy name.

## API behavior

The existing dossier update route remains compatible. For payloads containing `suspect_name`, it invokes the coordinator and returns a synchronization summary alongside the updated dossier.

Expected failures are:

- HTTP `400` for an empty or invalid corrected name.
- HTTP `404` when the selected dossier does not exist.
- HTTP `409` when strong identifiers conflict or more than one registry identity is equally valid.
- HTTP `500` when the transaction fails and rollback succeeds.
- HTTP `503` when rollback cannot restore verified original state; this condition requires operator intervention and must be recorded without personal data.

Non-name profile fields in the same request are applied only after identity synchronization succeeds. If any requested field cannot be applied, the full request must preserve its pre-request state.

## Repair command

A maintenance command accepts `--dossier-id`, `--correct-name`, and either `--dry-run` or `--apply`. Dry-run is the default and prints only stable identifiers, affected counts, and warnings. Apply requires an explicit flag and creates a timestamped backup manifest under the configured NAS data backup area without copying evidence binaries.

The repair command uses the same coordinator as the API, so production repair and future edits follow identical matching and transaction rules. It must refuse paths outside the configured NAS root and never scan or print unrelated case contents.

## Testing

Tests use temporary NAS directory fixtures and real JSON files. Required regression coverage includes:

- Correcting a dossier name updates its dossier profile and index without changing `dossier_id` or folder name.
- A uniquely matched Person Registry record is updated without changing `person_id` or unrelated fields.
- Proven case suspect entries update while unrelated suspects and cases remain byte-equivalent where no change is required.
- Cached linked-dossier names update in both directions without changing edges or reasons.
- `linked_person_ids` is persisted by new case writes.
- Historical sync preserves an officer-corrected name while merging non-name evidence.
- Ambiguous identity returns a conflict and changes no files.
- A forced replace failure restores every already changed file.
- Dry-run reports the same affected set that apply changes and performs no writes.
- Repeating the same correction is idempotent.
- Logs and command output do not contain corrected names or strong personal identifiers.

Each behavior is implemented with red-green-refactor TDD. The focused NAS Bot suite runs before the repository-mandated regression suites.

## Documentation impact

- Update `docs/features/nas-bot-integration.md` with authoritative-name and repair behavior.
- Update `docs/architecture.md` with identity ownership and transactional synchronization flow.
- Update `docs/troubleshooting.md` with conflict, rollback, and safe repair procedures.
- Update `docs/current-state.md` only after implementation and verification establish the new runtime baseline.
- Create a session log recording diagnosis, implementation, test evidence, and whether the production repair was performed.
- Record the immutable-identifier decision in an ADR because it governs future data migrations and integrations.

## Acceptance criteria

- An officer correction made from Arrest Vault is reflected in Dossiers, Persons, proven Cases, cached linked labels, search, and graph display after one successful request.
- No identifier, folder, evidence file, case ID, or graph edge is renamed or deleted.
- Conflicts and failures do not leave partial updates.
- Historical synchronization cannot restore an older OCR name over an officer correction.
- Existing inconsistent data can be inspected safely in dry-run and repaired with the same tested coordinator.
- All focused and required project tests pass, affected documentation is updated, and no production deploy occurs without separate authorization.
