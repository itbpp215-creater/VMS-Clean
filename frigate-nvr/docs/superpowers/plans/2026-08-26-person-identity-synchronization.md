# Person Identity Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an officer-corrected person name synchronize safely across Dossiers, Persons, proven Cases, cached graph labels, and historical sync without changing stable identifiers.

**Architecture:** Add a file-backed transactional `IdentitySyncCoordinator` that plans all JSON changes, stages sibling temporary files, atomically promotes them, and restores original bytes on failure. Existing dossier updates delegate identity-bearing requests to this coordinator; OCR ingestion remains unchanged except for persisting person links and preserving officer-corrected names.

**Tech Stack:** Python 3, FastAPI/Pydantic, JSON file storage, `unittest`, `tempfile`, `unittest.mock`, PowerShell test commands.

**Spec:** `docs/superpowers/specs/2026-08-26-person-identity-synchronization-design.md`

## Global Constraints

- Execute from an isolated Git worktree created with `superpowers:using-git-worktrees`; the current `main` worktree contains unrelated user changes.
- Preserve `dossier_id`, `person_id`, dossier folders, case IDs, graph node IDs, evidence paths, and evidence bytes.
- Never resolve or merge an identity by fuzzy/substring name matching during correction.
- Never print names, national IDs, phone numbers, addresses, profiles, or evidence contents in command output or logs.
- All changed functions and logic blocks require comments/docstrings compliant with `CLAUDE.md` section 10.
- Use test-first RED→GREEN cycles; do not write production behavior before its failing regression test.
- Stage and commit only files named in the current task; do not stage unrelated dirty files.
- Do not push, deploy, restart containers, or mutate the production NAS volume without separate authorization.

---

## File Structure

- Create `nas-bot-service/services/identity_sync.py`: identity resolution, change planning, atomic JSON transaction, rollback, and sanitized result types.
- Create `nas-bot-service/repair_person_identity.py`: dry-run-first maintenance CLI using the same coordinator.
- Create `nas-bot-service/tests/test_identity_sync.py`: real temporary-filesystem regression tests for identity correction, conflicts, atomicity, idempotence, and CLI behavior.
- Modify `nas-bot-service/services/nas_manager.py`: persist `linked_person_ids` after Person Registry upserts.
- Modify `nas-bot-service/services/dossier_manager.py`: preserve authoritative corrected names and delegate identity-bearing profile updates.
- Modify `nas-bot-service/main.py`: instantiate the coordinator, pass operator identity, and map typed synchronization errors to HTTP responses.
- Modify `nas-bot-service/tests/test_nas_bot.py`: lock the case-link persistence and API compatibility behavior.
- Modify `docs/features/nas-bot-integration.md`: document identity ownership and repair usage.
- Modify `docs/architecture.md`: document the transactional identity synchronization flow.
- Modify `docs/troubleshooting.md`: document conflict, rollback, dry-run, and recovery procedures.
- Modify `docs/current-state.md`: record the verified feature baseline only after tests pass.
- Create `docs/decisions/ADR-0016-immutable-person-identifiers.md`: record the immutable identifier decision.
- Create `docs/sessions/2026-08-26-person-identity-synchronization.md`: record diagnosis, implementation, verification, and production-repair status.

---

### Task 1: Persist Case-to-Person Links

**Files:**
- Modify: `nas-bot-service/services/nas_manager.py:125-171`
- Test: `nas-bot-service/tests/test_nas_bot.py`

**Interfaces:**
- Consumes: `PersonRegistry.upsert_person(...) -> Dict[str, Any]`
- Produces: `NASStorageManager.save_case_report(...)` return value and persisted `metadata.json` both contain identical `linked_person_ids: List[str]`.

- [ ] **Step 1: Add a failing persistence regression test**

Add a test using the existing `self.nas_manager` fixture. Read the created `metadata.json` through `find_case_folder` and assert the returned and persisted link lists match:

```python
def test_save_case_report_persists_linked_person_ids(self):
    """Persist generated person links in both the response and case metadata."""
    result = self.nas_manager.save_case_report(
        case_id="Case_Link_001",
        officer_username="officer01",
        platform="telegram",
        notes="identity link fixture",
        suspects=[{"suspect_name": "บุคคล ทดสอบ", "phone_number": "0800000001"}],
    )
    case_dir = self.nas_manager.find_case_folder("Case_Link_001")
    with open(os.path.join(case_dir, "metadata.json"), encoding="utf-8") as handle:
        persisted = json.load(handle)
    self.assertEqual(persisted["linked_person_ids"], result["linked_person_ids"])
    self.assertEqual(len(persisted["linked_person_ids"]), 1)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `frigate-nvr`:

```powershell
$env:PYTHONPATH = 'nas-bot-service'
python -m unittest nas-bot-service/tests/test_nas_bot.py -v
```

Expected: the new test fails because `linked_person_ids` exists in the returned dictionary but is absent from the already-written `metadata.json`.

- [ ] **Step 3: Persist metadata after registration**

Move the final metadata write below Person Registry upserts, or perform one documented final atomic rewrite after assigning `metadata["linked_person_ids"]`. Keep evidence writes and returned schema unchanged.

```python
# Persist the completed case metadata only after person registration so the
# durable record and API response expose the same stable person identifiers.
metadata["linked_person_ids"] = linked_person_ids
with open(meta_path, "w", encoding="utf-8") as handle:
    json.dump(metadata, handle, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: Run the NAS Bot suite and verify GREEN**

Run the command from Step 2. Expected: all tests pass with no traceback or warning caused by this change.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add -- frigate-nvr/nas-bot-service/services/nas_manager.py frigate-nvr/nas-bot-service/tests/test_nas_bot.py
git commit -m "fix(nas-bot): persist case person links"
```

---

### Task 2: Build the Transactional Identity Sync Coordinator

**Files:**
- Create: `nas-bot-service/services/identity_sync.py`
- Create: `nas-bot-service/tests/test_identity_sync.py`

**Interfaces:**
- Produces: `IdentitySyncCoordinator(root_path: str)`
- Produces: `plan_update(dossier_id: str, updates: Dict[str, Any], actor: str) -> IdentitySyncPlan`
- Produces: `apply_update(dossier_id: str, updates: Dict[str, Any], actor: str) -> Dict[str, Any]`
- Produces errors: `IdentityNotFoundError`, `IdentityConflictError`, `IdentityValidationError`, `IdentityTransactionError`, and `IdentityRollbackError`.
- Produces result keys: `dossier`, `dossier_id`, `person_ids`, `affected_counts`, `warnings`, `noop`.

- [ ] **Step 1: Write failing immutable-ID and propagation tests**

Create fixtures under one `TemporaryDirectory` containing:

- `Dossiers/ocr_name_2569/profile.json` plus `dossiers_index.json`.
- A second dossier whose `linked_dossiers` caches the target's old name.
- `Persons/persons_index.json` with an exact phone match and one source case.
- Two case `metadata.json` files: one proven matching case and one unrelated case.

Assert a correction changes display fields but not identifiers or directory names:

```python
def test_apply_update_propagates_name_without_changing_stable_ids(self):
    """Synchronize a proven identity while preserving every technical ID."""
    before_unrelated = self.unrelated_case_path.read_bytes()
    result = self.coordinator.apply_update(
        "ocr_name_2569",
        {"suspect_name": "ชื่อ ที่แก้แล้ว"},
        actor="officer01",
    )
    self.assertEqual(result["dossier_id"], "ocr_name_2569")
    self.assertTrue((self.root / "Dossiers" / "ocr_name_2569").is_dir())
    self.assertEqual(self.read_target_dossier()["suspect_name"], "ชื่อ ที่แก้แล้ว")
    self.assertEqual(self.read_person()["person_id"], "PERSON_001")
    self.assertEqual(self.read_person()["suspect_name"], "ชื่อ ที่แก้แล้ว")
    self.assertEqual(self.read_matching_case()["suspects"][0]["suspect_name"], "ชื่อ ที่แก้แล้ว")
    self.assertEqual(self.read_linked_dossier()["linked_dossiers"][0]["suspect_name"], "ชื่อ ที่แก้แล้ว")
    self.assertEqual(self.unrelated_case_path.read_bytes(), before_unrelated)
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
$env:PYTHONPATH = 'nas-bot-service'
python -m unittest nas-bot-service/tests/test_identity_sync.py -v
```

Expected: import failure for `services.identity_sync` because the coordinator does not exist.

- [ ] **Step 3: Implement validation, normalization, and typed models**

Define frozen dataclasses for staged file changes and public plans. The public representation must contain paths only relative to the NAS root and counts, never profile values.

```python
@dataclass(frozen=True)
class PlannedJsonChange:
    """Describe one validated JSON replacement and retain bytes for rollback."""
    path: Path
    original_bytes: bytes
    replacement: Dict[str, Any] | List[Dict[str, Any]]

@dataclass(frozen=True)
class IdentitySyncPlan:
    """Expose a sanitized, read-only summary of one identity update plan."""
    dossier_id: str
    person_ids: Tuple[str, ...]
    affected_counts: Dict[str, int]
    warnings: Tuple[str, ...]
    noop: bool
    changes: Tuple[PlannedJsonChange, ...] = field(repr=False)
```

Reject empty/control-character names and resolve all candidate paths beneath `root_path` using `Path.resolve()` plus `relative_to(self.root_path)`.

- [ ] **Step 4: Implement strong identity resolution and change planning**

Plan changes by exact national ID, normalized phone, persisted `linked_person_ids`, and Person Registry source case IDs. Never call substring-name matching. Update:

- the selected dossier profile, including `name_source`, `name_corrected_at`, and `name_corrected_by`;
- exactly one proven Person Registry record;
- only proven matching suspect objects in case metadata;
- cached target names in every dossier's `linked_dossiers`;
- `dossiers_index.json` from the planned dossier profiles.

Raise `IdentityConflictError` before creating any change when strong identifiers select more than one Person Registry record.

- [ ] **Step 5: Implement atomic staging, promotion, verification, and rollback**

Use a process-wide `threading.RLock`. For each change, write JSON to a unique sibling temporary file, flush, call `os.fsync`, and close it before promotion. Promote with `os.replace`. On failure, restore every promoted path from its original bytes through the same sibling-stage-and-replace mechanism.

```python
def _replace_bytes_atomically(path: Path, payload: bytes) -> None:
    """Replace one in-root file through a flushed sibling temporary file."""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
```

After promotion, reload every JSON file and compare it to the planned replacement. Raise `IdentityTransactionError` after successful rollback or `IdentityRollbackError` if restoration cannot be verified.

- [ ] **Step 6: Verify GREEN for propagation**

Run the focused test command from Step 2. Expected: the immutable-ID propagation test passes.

- [ ] **Step 7: Add RED conflict, rollback, idempotence, and privacy tests**

Add separate tests proving:

- two exact strong-identifier matches raise `IdentityConflictError` and preserve every original byte;
- a patched second `os.replace` failure restores the first promoted file;
- applying the same corrected name twice returns `noop=True` on the second call;
- `repr(plan)`, exception strings, and captured logs omit the corrected name, phone, and national ID;
- `plan_update` changes no file bytes.

- [ ] **Step 8: Run the new tests and verify RED for each missing behavior**

Run the focused suite after adding one behavior at a time. Confirm each failure is an assertion about the missing behavior, not fixture or import setup.

- [ ] **Step 9: Implement the minimal behavior until all coordinator tests are GREEN**

Keep conflict messages limited to stable IDs and counts. Ensure no-op planning produces zero staged changes and that rollback verification reads original bytes rather than trusting `os.replace` return values.

- [ ] **Step 10: Commit only coordinator files**

```powershell
git add -- frigate-nvr/nas-bot-service/services/identity_sync.py frigate-nvr/nas-bot-service/tests/test_identity_sync.py
git commit -m "feat(nas-bot): synchronize person identity atomically"
```

---

### Task 3: Preserve Officer-Corrected Names During Upsert and Historical Sync

**Files:**
- Modify: `nas-bot-service/services/dossier_manager.py:143-254`
- Test: `nas-bot-service/tests/test_identity_sync.py`

**Interfaces:**
- Consumes dossier provenance fields: `name_source`, `name_corrected_at`, `name_corrected_by`.
- Produces: `DossierVaultManager.upsert_dossier(..., name_source: str = "ocr") -> Dict[str, Any]` that preserves authoritative names when `name_source == "officer_correction"` already exists.

- [ ] **Step 1: Write a failing historical-sync regression test**

Create an officer-corrected dossier with a stable phone, then create a historical case with the same phone and the old OCR name. Call `sync_all_existing_cases()` and assert the corrected name and provenance survive while a new evidence filename is added.

```python
def test_historical_sync_preserves_officer_corrected_name(self):
    """Merge historical evidence without restoring an obsolete OCR name."""
    manager = DossierVaultManager(root_path=str(self.root))
    manager.sync_all_existing_cases()
    profile = manager.get_dossier_detail("ocr_name_2569")
    self.assertEqual(profile["suspect_name"], "ชื่อ ที่แก้แล้ว")
    self.assertEqual(profile["name_source"], "officer_correction")
    self.assertIn("historical.jpg", {item["filename"] for item in profile["personal_files"]})
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: `upsert_dossier` replaces the corrected name with the historical OCR name.

- [ ] **Step 3: Add provenance-aware name assignment**

Add the documented `name_source` parameter. When loading an existing profile, update `suspect_name` only if the stored source is not `officer_correction`, or the incoming source is explicitly `officer_correction`. Continue merging non-name fields and files.

- [ ] **Step 4: Prevent fuzzy-name-only merge into an authoritative dossier**

Change dossier lookup for ingestion so an officer-corrected dossier is selected by strong ID or phone, not by a partial legacy OCR name. Exact normalized display-name matching may remain for non-authoritative legacy records, but substring matching must not merge into an officer-corrected record.

- [ ] **Step 5: Run focused coordinator and NAS Bot suites**

```powershell
$env:PYTHONPATH = 'nas-bot-service'
python -m unittest nas-bot-service/tests/test_identity_sync.py nas-bot-service/tests/test_nas_bot.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit only provenance files**

```powershell
git add -- frigate-nvr/nas-bot-service/services/dossier_manager.py frigate-nvr/nas-bot-service/tests/test_identity_sync.py
git commit -m "fix(dossier): preserve corrected person names"
```

---

### Task 4: Integrate Identity Synchronization with the Dossier API

**Files:**
- Modify: `nas-bot-service/services/dossier_manager.py:470-510`
- Modify: `nas-bot-service/main.py:36-71,1672-1696`
- Modify: `nas-bot-service/tests/test_identity_sync.py`
- Modify: `nas-bot-service/tests/test_nas_bot.py`

**Interfaces:**
- Consumes: `IdentitySyncCoordinator.apply_update(dossier_id, updates, actor)`.
- Produces: `DossierVaultManager.update_dossier_profile(dossier_id, updates, *, actor="system")` returning the synchronized result.
- Produces HTTP response fields: `status`, `message`, `dossier`, and `identity_sync`.

- [ ] **Step 1: Add failing manager-delegation tests**

Assert that a name-bearing update changes Dossiers, Persons, Cases, and cached links through the manager's public method. Assert a non-name update retains existing behavior. Assert a mixed name/area request is applied as one planned transaction.

- [ ] **Step 2: Add failing HTTP error-mapping tests**

Exercise `update_dossier` with a patched manager raising each typed error and assert:

```python
cases = [
    (IdentityValidationError("invalid identity update"), 400),
    (IdentityNotFoundError("stable dossier not found"), 404),
    (IdentityConflictError("identity conflict: 2 candidates"), 409),
    (IdentityTransactionError("identity update rolled back"), 500),
    (IdentityRollbackError("identity rollback verification failed"), 503),
]
```

The response detail must not include request PII.

- [ ] **Step 3: Run both focused suites and verify RED**

Use the command from Task 3 Step 5. Expected: delegation and status mapping assertions fail because the current route calls the dossier-only implementation.

- [ ] **Step 4: Wire one coordinator instance to the shared NAS root**

Instantiate the coordinator with `nas_manager.root_path`. Update the manager method to delegate all updates when `suspect_name` is present; pass non-name-only requests through the existing narrow update logic. For mixed requests, include every allowed field in the coordinator's selected-profile replacement so the request is atomic.

- [ ] **Step 5: Pass authenticated operator identity without logging PII**

Add `X-User` as an optional header to the route and pass `x_user or "system"` as `actor`. Do not include the name or profile in log messages; log stable dossier ID, actor, counts, and status.

- [ ] **Step 6: Map typed failures and preserve response compatibility**

Catch only known synchronization errors and raise the designed status. Return the updated dossier under the existing `dossier` key and add the sanitized coordinator result under `identity_sync`.

- [ ] **Step 7: Run focused suites and verify GREEN**

Run the command from Task 3 Step 5. Expected: all coordinator, manager, route, and legacy NAS Bot tests pass.

- [ ] **Step 8: Commit only API integration files**

```powershell
git add -- frigate-nvr/nas-bot-service/main.py frigate-nvr/nas-bot-service/services/dossier_manager.py frigate-nvr/nas-bot-service/tests/test_identity_sync.py frigate-nvr/nas-bot-service/tests/test_nas_bot.py
git commit -m "fix(nas-bot): route name edits through identity sync"
```

---

### Task 5: Add the Dry-Run-First Repair Command

**Files:**
- Create: `nas-bot-service/repair_person_identity.py`
- Modify: `nas-bot-service/tests/test_identity_sync.py`

**Interfaces:**
- Consumes: `IdentitySyncCoordinator.plan_update(...)` and `apply_update(...)`.
- Produces: `main(argv: Optional[Sequence[str]] = None) -> int`.
- CLI contract: `--dossier-id VALUE --correct-name VALUE [--dry-run | --apply] [--root PATH] [--actor VALUE]` with dry-run as the default.

- [ ] **Step 1: Add failing CLI dry-run and apply tests**

Call `main([...])` directly with temporary fixture paths. Capture stdout and assert it contains only stable dossier ID, counts, mode, and warnings. Assert default/dry-run preserves every file byte. Assert `--apply` changes the planned files and creates a backup manifest containing relative paths and digests but no profile values.

- [ ] **Step 2: Run the focused suite and verify RED**

Expected: import failure because `repair_person_identity.py` does not exist.

- [ ] **Step 3: Implement guarded argument parsing and sanitized output**

Use a mutually exclusive `--dry-run`/`--apply` group and default to dry-run. Resolve `--root` and require Dossiers and Persons under that root. Never serialize `vars(args)` because it includes the corrected name.

```python
summary = {
    "mode": "apply" if args.apply else "dry-run",
    "dossier_id": result.dossier_id,
    "affected_counts": result.affected_counts,
    "warnings": list(result.warnings),
    "noop": result.noop,
}
print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
```

- [ ] **Step 4: Add backup manifest creation for apply mode**

Before apply, create a timestamped directory under `Backups/identity-sync/` inside the coordinator's resolved NAS root. Store original JSON bytes for affected metadata files only; exclude evidence. Write a manifest with stable dossier/person IDs, relative paths, SHA-256 digests, timestamp, and actor. Reject any resolved backup or source path outside root.

- [ ] **Step 5: Verify CLI GREEN and idempotence**

Run the focused suite. Then run the CLI twice against a copied fixture: first apply returns changed counts, second dry-run returns `noop=true` and zero affected files.

- [ ] **Step 6: Commit only CLI files**

```powershell
git add -- frigate-nvr/nas-bot-service/repair_person_identity.py frigate-nvr/nas-bot-service/tests/test_identity_sync.py
git commit -m "feat(nas-bot): add safe identity repair command"
```

---

### Task 6: Documentation, Full Verification, and Production Repair Gate

**Files:**
- Modify: `docs/features/nas-bot-integration.md`
- Modify: `docs/architecture.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/current-state.md`
- Create: `docs/decisions/ADR-0016-immutable-person-identifiers.md`
- Create: `docs/sessions/2026-08-26-person-identity-synchronization.md`

**Interfaces:**
- Consumes the final CLI/API behavior from Tasks 1-5.
- Produces operator documentation and verification evidence required by `CLAUDE.md` sections 8-10.

- [ ] **Step 1: Determine the next ADR number and write the immutable-ID decision**

List `docs/decisions/ADR-*.md`, select the next numeric identifier, and record context, decision, consequences, rejected folder-rename strategy, and rollback implications. Do not include real person names or case data.

- [ ] **Step 2: Update feature and architecture owner documents**

Document:

- Dossier display name as the officer-controlled authority.
- Immutable dossier/person IDs.
- Strong-identifier resolution order.
- Transaction, rollback, and sanitized audit behavior.
- Historical OCR synchronization precedence.
- The repair command's dry-run-first workflow.

- [ ] **Step 3: Add troubleshooting and current-state entries**

Add symptoms and safe diagnostics for `400`, `404`, `409`, `500`, and `503`. Explicitly state that operators must not use `sync-all` as an identity repair tool. Update current state only with verified behavior and clearly mark production repair as pending until performed.

- [ ] **Step 4: Create the session log**

Record the root cause, files changed, RED/GREEN evidence, regression results, remaining runtime limitation, and whether a production dry-run/apply occurred. Do not store the corrected name, strong identifiers, addresses, or evidence details.

- [ ] **Step 5: Run focused syntax and test verification**

```powershell
$env:PYTHONPATH = 'nas-bot-service'
python -m py_compile nas-bot-service/services/identity_sync.py nas-bot-service/services/dossier_manager.py nas-bot-service/services/nas_manager.py nas-bot-service/repair_person_identity.py nas-bot-service/main.py
python -m unittest discover -s nas-bot-service/tests -v
```

Expected: compilation succeeds and all NAS Bot tests pass.

- [ ] **Step 6: Run repository-mandated regression suites**

Run each command independently and record pass/fail counts. Distinguish pre-existing failures from new regressions with a clean comparison; do not hide failures.

```powershell
$env:PYTHONPATH = 'auth-service'; python -m pytest -q auth-service/tests
python -m unittest discover -s watchlist-api/tests -v
$env:PYTHONPATH = 'config-api'; python -m pytest -q config-api/tests
python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
npm ci
npm run test:browser
```

- [ ] **Step 7: Inspect the final diff for scope, comments, privacy, and whitespace**

```powershell
git diff --check
git status --short
git diff --stat
rg -n -S 'print\(.*(suspect_name|id_card|phone)|logger\..*(suspect_name|id_card|phone)' nas-bot-service
```

Review every changed function against `CLAUDE.md` section 10. Confirm no runtime JSON, backup, evidence, token, name, national ID, phone, or address is tracked.

- [ ] **Step 8: Commit documentation only after behavior is verified**

```powershell
git add -- frigate-nvr/docs/features/nas-bot-integration.md frigate-nvr/docs/architecture.md frigate-nvr/docs/troubleshooting.md frigate-nvr/docs/current-state.md frigate-nvr/docs/decisions/ADR-0016-immutable-person-identifiers.md frigate-nvr/docs/sessions/2026-08-26-person-identity-synchronization.md
git commit -m "docs: document person identity synchronization"
```

- [ ] **Step 9: Request a code review before integration**

Use `superpowers:requesting-code-review`. Address findings through `superpowers:receiving-code-review`, rerun focused tests, and keep unrelated workspace changes out of the branch.

- [ ] **Step 10: Run production dry-run only after separate authorization**

Resolve the actual values from the authenticated runtime without printing personal fields, assign them to the four variables below in the operator's private shell, and run:

```powershell
$nasRoot = (Resolve-Path -LiteralPath $operatorSelectedNasRoot).Path
$dossierId = $operatorSelectedStableDossierId
$correctName = $operatorApprovedCorrectName
$operator = $authenticatedOperatorUsername
python nas-bot-service/repair_person_identity.py --root $nasRoot --dossier-id $dossierId --correct-name $correctName --dry-run --actor $operator
```

Report only affected counts, stable IDs, warnings, and backup readiness. Do not proceed to `--apply` without showing the dry-run result and receiving explicit authorization.

- [ ] **Step 11: Verify post-apply consistency if production apply is authorized later**

After apply, verify by stable ID that Dossier, Person Registry, proven Cases, linked labels, search, and graph agree. Run a second dry-run and require `noop=true`. Do not deploy or restart services unless separately authorized.
