# ADR-0016: Preserve stable person identifiers during display-name synchronization

- Status: Accepted
- Date: 2026-08-26

## Context

NAS Bot stores person-related data in dossier profiles/indexes, Person Registry records, Case metadata
and cached linked-dossier labels. A dossier ID can contain the OCR-derived name from dossier creation,
but an officer may later correct the display name. Updating only the selected profile left other stores
inconsistent, while historical OCR synchronization could reintroduce the obsolete label.

Renaming a dossier ID or folder to follow the corrected name would also change a technical key already
referenced by graph nodes, links, Cases, URLs and filesystem artifacts. Selecting a Person record by fuzzy
name would be unsafe when similar labels represent different people.

## Decision

1. `dossier_id`, `person_id`, dossier folders, case IDs, graph node IDs, graph edges, evidence paths
   and evidence bytes are immutable. `suspect_name` is mutable display data.
2. An officer correction makes the selected dossier's display name authoritative and records
   `name_source=officer_correction`, correction time and operator provenance.
3. A file-backed `IdentitySyncCoordinator` owns all name-bearing dossier updates. It selects the stable
   dossier explicitly and forms the Person candidate set only from exact national ID, normalized phone,
   persisted person link and Person Registry source-case evidence. Names never authorize selection.
4. Zero Person matches produce a warning and do not invent a registry identity. One match may propagate.
   More than one match is a conflict before writes.
5. One locked plan covers the selected dossier and index, exact stable-ID cached labels, the uniquely
   proven Person record and proven Case suspect entries. Name-bearing mixed profile fields join that plan.
6. All changed JSON is sibling-staged, flushed/fsynced, atomically promoted and read-back verified. A
   failed apply restores each promoted path to its exact original bytes or original absence and verifies
   that recovery.
7. Historical OCR ingestion may merge non-name evidence into an authoritative dossier through strong
   identifiers, but cannot overwrite the corrected name or select that dossier by substring name.
8. Maintenance repair is dry-run by default. Explicit `--apply` publishes a verified, recoverable copy
   of the exact in-lock plan's original JSON metadata before promotion. Evidence is outside this backup.

## Alternatives considered

- **Rename dossier folders and IDs after every correction:** rejected because it breaks stable references,
  URLs, graph identities and recovery boundaries while expanding the operation to evidence paths.
- **Update each store independently from the API route:** rejected because a mid-sequence failure can leave
  partial identity state and duplicates matching rules.
- **Use an event bus and asynchronous consumers:** rejected for the current file-backed scale because it
  introduces delivery, ordering and reconciliation infrastructure without removing the need for repair.
- **Match or merge by fuzzy/substring name:** rejected because a display label is not sufficient identity proof.
- **Let historical `sync-all` remain the authority:** rejected because OCR ingestion must not supersede an
  authenticated officer correction.

## Consequences

- Legacy IDs may continue to contain an obsolete human-readable fragment; UIs and integrations must display
  `suspect_name` and treat IDs as opaque.
- Ambiguous strong evidence becomes an explicit `409` requiring operator adjudication rather than an
  automatic merge.
- A missing Person Registry match may leave that store unchanged while the dossier and independently proven
  Cases update; the sanitized warning makes this limitation visible.
- The process lock protects writers using this coordinator, not arbitrary external filesystem writers.
- API updates rely on exact in-memory rollback and do not create persistent identity-sync backups. CLI
  `--apply` adds a durable pre-apply backup; manual restore tooling/procedure remains necessary.
- A verified rollback maps to `500`. Failed rollback verification maps to `503` and requires immediate
  suspension of identity writes plus controlled recovery from the CLI or approved external backup.

## Validation

On branch baseline `d15be3f`, Python syntax compilation passed and all 41 NAS Bot tests passed. Coverage
includes immutable IDs, exact propagation boundaries, conflict/no-write behavior, mixed-update rollback,
privacy-safe outputs, historical OCR precedence, case-person link persistence, dry-run idempotence, exact
pre-apply backup, absent-file recovery and API status mapping. Both browser smoke scenarios also passed.

No production migration, repair dry-run, repair apply or deployment was performed for this decision.

## Revisit when

- storage moves from file-backed JSON to a transactional database;
- multiple processes or hosts must perform identity writes concurrently;
- a formal identity merge/split workflow is approved;
- recovery requires a tested automated restore command instead of controlled manifest-guided restore;
- external integrations require opaque replacement IDs for legacy name-derived dossier identifiers.

## Related

- [NAS Bot Integration](../features/nas-bot-integration.md)
- [Architecture](../architecture.md#person-identity-synchronization-flow)
- [Troubleshooting #24](../troubleshooting.md#24-person-identity-update-ล้มเหลวหรือข้อมูลชื่อไม่สอดคล้องกัน)
- [Session 2026-08-26](../sessions/2026-08-26-person-identity-synchronization.md)
