# BPP-VMS Project Stabilization and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the 2026-08-25 feature set to a reviewable, test-backed, documented, secret-safe, and production-accepted baseline without absorbing unrelated working-tree or runtime data.

**Architecture:** Execute five gated workstreams in order: inventory, security containment, regression/documentation, branch reconciliation, and production acceptance. Each workstream runs in an isolated worktree and produces its own evidence; destructive Git history changes, credential rotation, branch integration, and deployment each require separate explicit approval.

**Tech Stack:** Git/PowerShell, Python 3 + pytest/unittest, Node.js 22.23.1 + Playwright 1.61.1, Docker Compose, Frigate 0.17, nginx, SQLite, Obsidian Markdown.

**Spec:** [`CLAUDE.md`](../../../CLAUDE.md), [`docs/current-state.md`](../../current-state.md), and [`AI_HANDOVER_CONTEXT.md`](../../../../AI_HANDOVER_CONTEXT.md).

## Global Constraints

- Keep the repository private; never publish internal topology or operational data.
- Treat the dirty production worktree and every pre-existing change as user-owned.
- Never use `git add .`, `git add -A`, a wildcard, or a workspace-wide stage command.
- Never print, copy into logs, or commit credential values, tokens, database contents, recordings, model files, or runtime evidence.
- Do not change `.agents` ACLs or rule files during stabilization. Governance alignment is a later, separately approved gate.
- Do not deploy, restart, recreate, stop, rotate credentials, rewrite Git history, merge, push, or delete branches/files without the explicit approval gate named in the relevant task.
- Follow TDD for every behavior change: write a failing test, confirm the expected failure, implement the minimum change, and rerun the focused and surrounding suites.
- Follow `CLAUDE.md` Sections 8-10 for canonical documentation and source comments.
- Use `frigate-nvr` as the Frigate container name for runtime validation.
- Every commit step below means “prepare the exact reviewed file list and proposed message”; execute the commit or push only after the user explicitly authorizes it.

## Evidence Snapshot That This Plan Must Preserve

- `main` and `origin/main` were both at `3d85b6b` during the 2026-08-26 audit.
- 120 commits landed after the 2026-08-20 canonical documentation reconciliation; 2 touched tests, 1 touched canonical docs, and 60 touched only the handover record.
- Tracked config contains 26 cameras and 78 go2rtc streams; the Obsidian camera note still says 15/45.
- Git tracks `config/camera_credentials.env` with 44 non-placeholder assignments, one Watchlist database, and 104 runtime-cache paths.
- The dirty worktree contains one likely UI change, generated/runtime changes, six untracked helper/test scripts, and approximately 1,580 untracked runtime-cache paths.
- `codex/mobile-video-compatibility` has 19 branch-only commits; `codex/orphaned-acl-recovery` has 13; `codex/multi-site-migration-update` has no branch-only commits.
- The previous live audit observed 15 running containers and Dashboard HTTPS 200; the execution environment must obtain fresh evidence before claiming current health.

## File Responsibility Map

| Responsibility | Primary files |
|---|---|
| Repository hygiene policy and test | `.gitignore`, `frigate-nvr/.gitignore`, `frigate-nvr/tests/test_repository_hygiene.py` |
| Camera credential storage | `frigate-nvr/config/camera_credentials.env` (machine-local), `frigate-nvr/config/config.yml`, `frigate-nvr/docker-compose.yml`, `frigate-nvr/config-api/api.py` |
| Security regression | `frigate-nvr/tests/test_p0_security.py`, `frigate-nvr/tests/test_repository_config.py`, `frigate-nvr/tests/test_windows_acl.py` |
| Recent feature regression | service tests under `auth-service/tests`, `config-api/tests`, `lpr-service/tests`, `watchlist-api/tests`, `media-compat-service/tests`, `nas-bot-service/tests`, `analytics-engine/tests`, and new `chat-service/tests` |
| Browser acceptance | `frigate-nvr/tests/browser-smoke.mjs`, `frigate-nvr/package.json` |
| Canonical truth | `frigate-nvr/docs/current-state.md`, `architecture.md`, `security-model.md`, `operations.md`, feature owner documents, ADRs, and session logs |
| Knowledge-base mirror | `D:\obsidian\...` only after canonical repository docs are correct |
| Agent governance | root `AGENTS.md` pointer if approved later, `GEMINI.md`, `.agents/rules/*`, `.agents/skills/*` |

---

### Task 1: Create an Isolated, Read-Only Baseline Inventory

**Files:**
- Create at execution: `frigate-nvr/docs/sessions/2026-08-26-project-stabilization.md`
- Do not modify source, runtime data, `.agents`, or production containers.

**Interfaces:**
- Consumes: current `main`, dirty production worktree, existing linked worktrees.
- Produces: immutable inventory with commit IDs, exact path counts, hashes, branch divergence, and validation availability.

- [ ] **Step 1: Create an isolated execution worktree**

Use `superpowers:using-git-worktrees`. Base it on the audited `origin/main` after a read-only fetch and name the branch `codex/project-stabilization-20260826`. Do not reuse the dirty production checkout.

- [ ] **Step 2: Record the repository identity**

Run:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git worktree list --porcelain
git branch -vv
```

Expected: root is `D:/BPP-VMS`; the stabilization worktree is clean before plan changes; the production checkout remains untouched.

- [ ] **Step 3: Record tracked sensitive/runtime paths without reading values**

Run:

```powershell
git ls-files 'frigate-nvr/config/camera_credentials.env'
git ls-files 'frigate-nvr/watchlist-api/data/*.db'
git ls-files 'frigate-nvr/chat-service/data/*'
git ls-files 'frigate-nvr/runtime-cache/**'
```

Record only filenames and counts. Never include file contents in the session log.

- [ ] **Step 4: Record branch divergence**

Run for each existing branch:

```powershell
git rev-list --left-right --count main...codex/mobile-video-compatibility
git rev-list --left-right --count main...codex/orphaned-acl-recovery
git rev-list --left-right --count main...codex/multi-site-migration-update
```

Expected audit baseline: 19, 13, and 0 branch-only commits respectively. Any changed count must be documented before continuing.

- [ ] **Step 5: Write the session log starting state**

Use the session template from `docs/sessions/README.md`. Include goal, commit, working-tree facts, known risks, and the explicit statement that no runtime mutation occurred.

- [ ] **Gate A: Human review**

Stop and present the inventory. Continue only after the user approves security containment. No commit/push is implied by approval.

---

### Task 2: Add a Failing Repository-Hygiene Regression Test

**Files:**
- Create: `frigate-nvr/tests/test_repository_hygiene.py`
- Modify later in Task 3: root `.gitignore`, `frigate-nvr/.gitignore`

**Interfaces:**
- Consumes: `git ls-files -z` from the repository root.
- Produces: a deterministic test that rejects machine-local credentials, runtime caches, operational databases, and live event stores from Git tracking.

- [ ] **Step 1: Write the failing test**

Create a test with these exact forbidden contracts:

```python
"""Reject machine-local secrets and runtime state from the Git index."""

import subprocess
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN_EXACT_PATHS = {
    "frigate-nvr/config/camera_credentials.env",
    "frigate-nvr/watchlist-api/data/watchlist.db",
    "frigate-nvr/chat-service/data/events.json",
}
FORBIDDEN_PREFIXES = ("frigate-nvr/runtime-cache/",)


def tracked_paths() -> set[str]:
    """Return normalized Git-index paths without inspecting file contents."""

    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
    )
    return {
        item.decode("utf-8").replace("\\", "/")
        for item in completed.stdout.split(b"\0")
        if item
    }


def test_machine_local_state_is_not_tracked() -> None:
    """Fail when secrets or mutable production state enter the Git index."""

    tracked = tracked_paths()
    forbidden = tracked & FORBIDDEN_EXACT_PATHS
    forbidden.update(
        path for path in tracked if path.startswith(FORBIDDEN_PREFIXES)
    )
    assert forbidden == set()
```

- [ ] **Step 2: Run the test and verify RED**

Run from `frigate-nvr`:

```powershell
python -m pytest -q tests/test_repository_hygiene.py
```

Expected: FAIL listing the four forbidden classes already present in the index. If it passes, fix the test because the audit evidence shows those paths are tracked.

- [ ] **Step 3: Review the test for secret-safe output**

Confirm failures print paths only, never credential values or database content.

---

### Task 3: Stop Tracking Machine-Local State Without Deleting It

**Files:**
- Modify: root `.gitignore`
- Modify: `frigate-nvr/.gitignore`
- Modify: Git index entries for the exact forbidden paths; preserve working files.
- Test: `frigate-nvr/tests/test_repository_hygiene.py`

**Interfaces:**
- Consumes: the failing hygiene test and approved Gate A inventory.
- Produces: ignored machine-local files, clean Git index policy, and unchanged production data on disk.

- [ ] **Step 1: Add exact ignore rules**

Add these rules to `frigate-nvr/.gitignore` with comments explaining that the files are runtime/security state:

```gitignore
config/camera_credentials.env
watchlist-api/data/
chat-service/data/
runtime-cache/
```

Keep `.env.example`, source fixtures under test directories, and `.gitkeep` files explicitly trackable where needed.

- [ ] **Step 2: Verify the resolved untrack target list**

Build a list using `git ls-files` for only the four approved path classes. Assert every resolved path begins with one of the approved prefixes before changing the index. Save counts, not contents, in the session log.

- [ ] **Step 3: Untrack exact resolved paths while preserving disk files**

Run from the Git root after Step 2 has approved the resolved list:

```powershell
$approvedPaths = @(
    git ls-files 'frigate-nvr/config/camera_credentials.env'
    git ls-files 'frigate-nvr/watchlist-api/data/watchlist.db'
    git ls-files 'frigate-nvr/chat-service/data/events.json'
    git ls-files 'frigate-nvr/runtime-cache/**'
) | Sort-Object -Unique
$approvedPrefixes = @(
    'frigate-nvr/config/camera_credentials.env',
    'frigate-nvr/watchlist-api/data/watchlist.db',
    'frigate-nvr/chat-service/data/events.json',
    'frigate-nvr/runtime-cache/'
)
$unexpected = @($approvedPaths | Where-Object {
    $path = $_
    -not ($approvedPrefixes | Where-Object { $path.StartsWith($_) })
})
if ($unexpected.Count -gt 0) { throw "Refusing unexpected paths" }
git rm --cached -- $approvedPaths
```

Verify each working file still exists after index removal. Do not use `git rm` without `--cached`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
python -m pytest -q tests/test_repository_hygiene.py
git check-ignore -v config/camera_credentials.env
git check-ignore -v watchlist-api/data/watchlist.db
git check-ignore -v chat-service/data/events.json
git check-ignore -v runtime-cache/mobile-video/example.partial
```

Expected: test PASS and every sample path resolves to the intended app-level ignore rule.

- [ ] **Step 5: Inspect the exact diff and proposed index-only removals**

Run `git status --short`, `git diff -- .gitignore frigate-nvr/.gitignore`, and `git diff --cached --name-status`. Confirm no working runtime file was deleted.

- [ ] **Step 6: Prepare the commit gate**

Proposed commit message: `test(security): reject tracked secrets and runtime state`.

Stage only the two ignore files, the new test, and approved cached removals. Stop for explicit commit approval.

---

### Task 4: Contain and Rotate Exposed Camera Credentials

**Files:**
- Machine-local only: `frigate-nvr/config/camera_credentials.env`
- Verify placeholders: `frigate-nvr/config/config.yml`
- Verify consumers: `frigate-nvr/docker-compose.yml`, `frigate-nvr/config-api/api.py`, `frigate-nvr/config-validator/`
- Modify canonical docs after rotation: `docs/security-model.md`, `docs/operations.md`, session log.

**Interfaces:**
- Consumes: untracked/ignored credential store from Task 3 and operator access to every affected camera.
- Produces: rotated per-camera credentials, valid placeholders, working streams, and an incident record with no secret values.

- [ ] **Step 1: Create an encrypted offline backup and change window**

The operator creates a dated encrypted backup outside the repository. Record only backup existence, checksum, owner, and restore procedure. Do not copy credential values into the plan/session log.

- [ ] **Step 2: Enumerate affected cameras without printing passwords**

Record camera identifiers and credential-variable names only. Compare the variable names referenced by `config/config.yml` with the machine-local file; require a one-to-one match.

- [ ] **Step 3: Rotate credentials at each camera/device**

Use unique high-entropy passwords per approved credential group. Update the machine-local file immediately after each device rotation. Keep the previous value only in the encrypted rollback backup.

- [ ] **Step 4: Validate configuration before restart**

Run:

```powershell
docker compose config --quiet
docker exec frigate-nvr python3 -m frigate --validate-config
```

Expected: exit 0; no unresolved `{FRIGATE_*}` variable; no secret printed.

- [ ] **Step 5: Gate the required service recreation**

Stop and request explicit runtime approval. Recreate only the services that read the credential env file after approval; do not restart the full stack by default.

- [ ] **Step 6: Verify every affected stream**

Check Frigate/go2rtc logs for authentication failures using redacted output, verify main/sub/HD stream availability, and confirm Dashboard live view. Roll back the affected camera group from the encrypted backup if validation fails.

- [ ] **Step 7: Record the security incident**

Document exposure scope, rotation completion, affected Git commits, validation, and remaining history-rewrite requirement without recording old or new values.

- [ ] **Gate B: Human review**

Do not rewrite history until rotation and runtime verification are complete and the user approves a repository freeze.

---

### Task 5: Purge Sensitive/Runtime Blobs From Git History

**Files/Repositories:**
- Operate on a new bare mirror clone, never the dirty production checkout.
- Purge exact paths: credential env, Watchlist DB, chat event store, and `runtime-cache/`.
- Preserve an encrypted pre-rewrite mirror backup until every collaborator confirms migration.

**Interfaces:**
- Consumes: completed credential rotation and Gate B repository freeze.
- Produces: rewritten private repository with forbidden blobs absent from all reachable refs.

- [ ] **Step 1: Freeze writes and create two backups**

Disable merges/pushes for the change window. Create an encrypted bare mirror and a second offline copy. Verify both with `git fsck --full`.

- [ ] **Step 2: Scan history with redacted output**

Run an approved offline Gitleaks binary:

```powershell
gitleaks git --redact --report-format json --report-path D:\BPP-VMS-security-audit\gitleaks-redacted.json
```

The report must live outside the repository and must not be pasted into tickets or Markdown. Record finding counts and affected path names only.

- [ ] **Step 3: Rewrite the mirror**

Run in the disposable mirror:

```powershell
git filter-repo --path frigate-nvr/config/camera_credentials.env --path frigate-nvr/watchlist-api/data/watchlist.db --path frigate-nvr/chat-service/data/events.json --path frigate-nvr/runtime-cache/ --invert-paths
```

Expected: all four path classes are absent from every rewritten ref.

- [ ] **Step 4: Verify the rewrite before force-push approval**

Run:

```powershell
git fsck --full
git log --all -- frigate-nvr/config/camera_credentials.env
git log --all -- frigate-nvr/watchlist-api/data/watchlist.db
git log --all -- frigate-nvr/chat-service/data/events.json
git log --all -- frigate-nvr/runtime-cache
```

Expected: `git fsck` succeeds and all path-history commands return no commits. Rerun the redacted secret scan and require zero high-confidence credential findings.

- [ ] **Step 5: Gate the force-push**

Present the old/new ref map, collaborator re-clone instructions, rollback mirror location, and downtime window. Force-push rewritten refs only after explicit user approval.

- [ ] **Step 6: Post-rewrite recovery**

Require all worktrees and CI runners to re-clone or hard-reset from an explicitly backed-up state. Re-enable writes only after `origin/main`, branch protection, and CI checks are verified.

---

### Task 6: Triage the Dirty Worktree and Untracked Helpers

**Files:**
- Review: `frigate-nvr/web/assets/app.css`
- Review/migrate: `chat-service/reparse_all_events.py`, `chat-service/services/test_parser_runner.py`
- Review/migrate: `nas-bot-service/test_dispatch.py`, `test_photo_telegram.py`, `test_single_photo_alert.py`
- Review: `frigate-nvr/patch.py`
- Preserve: all generated/runtime data until separately approved for cleanup.

**Interfaces:**
- Consumes: checksum inventory from Task 1.
- Produces: one decision per file—product change with tests, migrated automated test, retained local tool, or approved removal.

- [ ] **Step 1: Compare each file with committed behavior**

For each path, record purpose, imports, side effects, secret signals, overlapping committed tests, and whether it writes production data. Do not execute one-off scripts during classification.

- [ ] **Step 2: Validate the `app.css` change as a focused UI patch**

Confirm the flex alignment is required by the SVG + text markup in `web/assets/app.js`. Extend `tests/browser-smoke.mjs` with an assertion that the Event Archive load-more button has visible icon/text and does not overflow at desktop and mobile widths. Run the browser test RED before retaining the CSS change, then GREEN after applying it in the isolated branch.

- [ ] **Step 3: Migrate reusable Chat parser checks**

Create `chat-service/tests/test_intent_parser.py` and move deterministic assertions from `services/test_parser_runner.py` into pytest tests. Do not retain a test runner under the production `services/` package.

- [ ] **Step 4: Migrate reusable NAS Bot checks**

Move deterministic notification-routing assertions into `nas-bot-service/tests/test_nas_bot.py` or focused files under that test directory. Mock outbound Telegram HTTP at the boundary and assert payload semantics; never contact a real chat from unit tests.

- [ ] **Step 5: Classify one-off mutation scripts**

Treat `reparse_all_events.py` and `patch.py` as local operational tools unless their behavior is documented, idempotent, dry-run capable, and covered by tests. Keep them outside Git or convert them into reviewed scripts under `scripts/`; never execute them against production as part of cleanup.

- [ ] **Step 6: Stop for deletion/move approval**

Present the classification table and checksums. Remove or move no file until the user approves the exact path list.

---

### Task 7: Establish a Full Regression Baseline for the 120 Recent Commits

**Files:**
- Modify tests only when a missing behavior is demonstrated.
- Test owners: Auth, Config API/Validator, Watchlist, LPR, Chat, NAS Bot, Analytics, Media Compatibility, repository security, Browser smoke.
- Update: `.github/workflows/security-tests.yml` if service suites are absent from CI.

**Interfaces:**
- Consumes: clean isolated source tree and migrated tests from Task 6.
- Produces: test matrix with command, pass/fail count, failure classification, and commit coverage.

- [ ] **Step 1: Run existing Python/security suites without fixing failures**

Run from `frigate-nvr`:

```powershell
$env:PYTHONPATH='auth-service'; python -m pytest -q auth-service/tests; Remove-Item Env:PYTHONPATH
python -m unittest discover -s watchlist-api/tests -v
$env:PYTHONPATH='config-api'; python -m pytest -q config-api/tests; Remove-Item Env:PYTHONPATH
python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
python -m pytest -q media-compat-service/tests
python -m unittest discover -s nas-bot-service/tests -v
python -m unittest discover -s analytics-engine/tests -v
python -m pytest -q chat-service/tests
```

Record failures exactly and classify them as product regression, missing dependency, environment limitation, or stale test. Do not alter tests merely to make them pass.

- [ ] **Step 2: Add focused Config API masking tests**

In `config-api/tests/test_config_transactions.py`, add tests proving literal RTSP credentials become `{FRIGATE_*}` placeholders, the candidate config contains no literal password, and the machine-local credential writer is invoked atomically. Confirm RED against any missing guarantee, implement minimally, then rerun all Config API tests.

- [ ] **Step 3: Add Auth 30-day default tests**

In `auth-service/tests/test_auth.py`, verify default `AUTH_SESSION_HOURS` is 720 and both token expiry and cookie `max_age` use the same duration. Also verify an explicit environment override remains honored.

- [ ] **Step 4: Complete recent LPR acceptance tests**

Use `lpr-service/tests` to cover physical aspect/position filters, two-frame readable quorum, pending-review publication, trainer heartbeat during training, candidate outbox replay, and idempotency after Watchlist recovery.

- [ ] **Step 5: Complete Chat/NAS/Analytics tests**

Add deterministic fixtures for TR.14 parsing, multiple suspects, drug quantity units, Telegram album grouping, network cross-linking, CDR deletion, parcel exclusion from heatmaps, and multi-drug aggregation. No test may call real Telegram, NAS, camera, or internet services.

- [ ] **Step 6: Run locked browser smoke tests**

Run:

```powershell
npm ci
npm run test:browser
```

Validate desktop and mobile layouts for Event Archive, settings, Dossier Vault, i2 graph, clip player, and LPR review actions.

- [ ] **Step 7: Add missing suites to CI**

Update `.github/workflows/security-tests.yml` so Chat, NAS Bot, Analytics, and Media Compatibility suites run on pull requests. Pin dependencies; do not introduce live-service credentials into CI.

- [ ] **Gate C: Regression review**

Stop with a matrix showing all commands and results. No production deployment is allowed while P0/P1 regressions remain.

---

### Task 8: Reconcile Canonical Documentation and Obsidian

**Files:**
- Modify: `docs/current-state.md`, `docs/architecture.md`, `docs/security-model.md`, `docs/operations.md`
- Modify relevant owners: `docs/features/license-plate-recognition.md`, `event-investigation.md`, `playback.md`, `camera-settings-workflow.md`, `nas-bot-integration.md`, `data-analytics.md`, `watchlist.md`, `multi-site-releases.md`
- Modify indexes only when links change: `docs/README.md`, `docs/features/README.md`, `docs/sessions/README.md`
- Update: `AI_HANDOVER_CONTEXT.md` after canonical docs.
- Mirror later: exact corresponding notes under `D:\obsidian`.

**Interfaces:**
- Consumes: verified code/config, regression matrix, and production evidence.
- Produces: one non-contradictory source of truth with Obsidian as a mirror.

- [ ] **Step 1: Build a 120-commit change-to-owner matrix**

Map each commit to feature, architecture, operations, security, reference, or history. Group related commits into one current behavior statement; do not copy commit narratives into every document.

- [ ] **Step 2: Reconcile current state**

Document 26 cameras/78 streams, actual enabled cameras, 15-service topology, auth 720-hour default, current LPR/trainer model state, Config API masking behavior, deployment method, and verified runtime health date.

- [ ] **Step 3: Reconcile feature and security owners**

Describe behavior now, trust boundaries, credential storage, review semantics, failure behavior, operational limitations, and tests. Resolve the contradiction between the 2026-08-20 “training pending” statement and later handover claims about promoted jobs using runtime/model evidence.

- [ ] **Step 4: Update operations and recurring incidents**

Add validated procedures for credential rotation, repository hygiene, runner status, LPR health/outbox replay, and runtime acceptance. Update troubleshooting only for reproducible incidents with confirmed root cause.

- [ ] **Step 5: Update the session log and handover**

Record what changed, why, behavior now, validation, operational impact, risks, files changed, and remaining work. Remove mandatory auto-push language from the new session record; do not edit `.agents` in this task.

- [ ] **Step 6: Mirror canonical facts to Obsidian**

Update Camera Topology from 15/45 to verified 26/78 and sync the affected service/feature notes. Compare hashes or normalized content where notes are intended to mirror exactly. Report any vault path that is not writable instead of bypassing permissions.

- [ ] **Step 7: Validate Markdown and secrets**

Run the docs-check workflow locally where available, check links, and run a redacted secret scan over changed Markdown. Expected: no broken local links and no real credential values.

---

### Task 9: Reconcile Diverged Branches Without Blind Merges

**Files:**
- Review branch diffs only in dedicated worktrees.
- Do not modify production checkout or delete branches during comparison.

**Interfaces:**
- Consumes: green main regression baseline from Gate C.
- Produces: per-branch disposition—already superseded, extract specific commit, rebase/retest, or archive.

- [ ] **Step 1: Compare Mobile Video branch semantically**

Run `git range-diff` from the merge base and direct tip-to-tip diffs. Compare its 19 commits against current `media-compat-service`, Compose, nginx, and tests. Require its full pytest suite before extracting any missing test or fix.

- [ ] **Step 2: Compare ACL recovery branch without applying ACL changes**

Review the 13 unique commits, especially `scripts/harden-windows-acl.ps1`, `tests/test_windows_acl.py`, and P0 security tests. Extract only independently justified tests/fixes into a fresh branch after RED evidence. Do not run the ACL script against the current host during review.

- [ ] **Step 3: Confirm Multi-site branch is fully contained**

Use `git cherry main codex/multi-site-migration-update` and require no `+` commits. Mark it eligible for archival, but delete it only after explicit approval.

- [ ] **Step 4: Review and test each extracted change separately**

No merge commit may combine Mobile Video and ACL recovery. Each extracted change gets focused tests, full surrounding suite, docs impact review, and its own approval.

- [ ] **Gate D: Integration review**

Present range-diff conclusions and exact commits/files proposed for integration. Merge/rebase/cherry-pick only after approval.

---

### Task 10: Perform Production Acceptance in a Controlled Window

**Files/Runtime:**
- Validate: `docker-compose.yml`, `config/config.yml`, `.env`/machine-local credential presence without printing values.
- Deploy only with `./deploy.sh` after explicit approval.
- Record results in `docs/current-state.md`, `docs/operations.md`, and the stabilization session log.

**Interfaces:**
- Consumes: approved commit, all-green regression matrix, rotated credentials, canonical docs draft, and rollback point.
- Produces: tested production baseline with health evidence and rollback record.

- [ ] **Step 1: Establish rollback and backups**

Record current production commit, image IDs, config checksum, database backup checksum, model pointer/version, and credential backup existence. Confirm the backup restore procedure before mutation.

- [ ] **Step 2: Run preflight checks**

Run:

```powershell
docker compose config --quiet
docker exec frigate-nvr python3 -m frigate --validate-config
docker ps --format "{{.Names}}: {{.Status}}"
nvidia-smi
```

Expected: config exit 0, required services present, existing baseline health understood, and GPU visible.

- [ ] **Step 3: Gate deployment**

Present exact commit, image/build changes, services expected to recreate, estimated interruption, and rollback command. Run `./deploy.sh` only after explicit approval.

- [ ] **Step 4: Verify infrastructure health**

Confirm all 15 services are running, every healthcheck is healthy or has a documented no-healthcheck status, `frigate-nvr` is healthy, GPU decode/detector is active, Dashboard HTTPS returns 200, and internal backends are not directly published.

- [ ] **Step 5: Verify product acceptance matrix**

Test:

- 26 camera records and 78 go2rtc streams; sampled main/sub/HD playback.
- Admin Config API save masks literal credentials and preserves stream operation.
- Auth session expiry/cookie are both 720 hours.
- Event Archive pagination/date filter/plate search and mobile load-more layout.
- LPR pending/review/non-plate flow, trainer health, model pointer, outbox replay, and one real two-frame readable quorum event.
- Telegram per-user routing, album grouping, image delivery, and external clip playback using a designated test account.
- Dossier/i2/CDR/analytics workflows with test data that is removed through application APIs after acceptance.
- Multi-site installer only on the designated clean Windows/GPU target; never on production as a substitute.

- [ ] **Step 6: Roll back on a P0/P1 failure**

Restore the recorded commit/config/model pointer/database backup and redeploy the last known-good images. Re-verify Dashboard, cameras, Auth, Watchlist, and LPR before ending the window.

- [ ] **Step 7: Record acceptance evidence**

Update canonical docs with date, commit, tests, service health, GPU, camera/stream counts, model version, limitations, and any deferred non-blocking item.

---

### Task 11: Align Codex and Antigravity Governance After Stabilization

**Files:**
- Potential create: root `AGENTS.md` as a pointer only.
- Modify after separate approval: `GEMINI.md`, `.agents/rules/strict_directives.md`, `.agents/rules/auto_obsidian_sync.md`, `.agents/skills/bpp-dev-workflow/SKILL.md`, `.agents/skills/bpp-deployment/SKILL.md`.
- Test: static rule checks plus pressure scenarios.

**Interfaces:**
- Consumes: stable canonical `frigate-nvr/CLAUDE.md` and a separately approved safe ACL procedure.
- Produces: all agent entry points delegating to one canonical rule set without automatic broad staging, pushing, or deployment.

- [ ] **Step 1: Keep governance work parked until approval**

Do not modify `.agents` ACLs or content during Tasks 1-10. Record the current permission issue as a tooling limitation only.

- [ ] **Step 2: Design a pointer-only root entry point**

The root `AGENTS.md` should point to `frigate-nvr/CLAUDE.md`, `docs/current-state.md`, and the scoped skills without duplicating policy text.

- [ ] **Step 3: RED-test current rules**

Reuse the three pressure scenarios: dirty worktree + typo, production config edit without deploy authorization, and docs-only current-state reconciliation. Expected current result: unsafe broad stage/push, ambiguous deployment, and mirror-first documentation.

- [ ] **Step 4: Apply the minimal rule/skill changes**

Require exact-path staging, explicit commit/push/deploy authorization, canonical-first documentation, correct `frigate-nvr` container name, and no ACL mutation as a side effect of rule editing.

- [ ] **Step 5: GREEN-test and validate skills individually**

Run the same pressure scenarios and the skill validator after each skill edit. Do not batch two unverified skills. Expected: all scenarios refuse broad Git/runtime mutations and update canonical docs before mirrors.

- [ ] **Gate E: Governance approval**

Present diffs and test evidence. Commit/push only after explicit approval.

---

### Task 12: Final Verification and Handoff

**Files:**
- Finalize: stabilization session log and affected canonical docs.
- Update: `AI_HANDOVER_CONTEXT.md` after canonical documents.
- Mirror: approved Obsidian notes.

**Interfaces:**
- Consumes: evidence from all completed gates.
- Produces: review-ready handoff with no unsupported “100%” claims.

- [ ] **Step 1: Run the full clean-tree test matrix again**

Rerun every command from Task 7 plus Compose config validation and docs checks. Capture command, timestamp, exit code, and pass/fail count.

- [ ] **Step 2: Review source comments and documentation impact**

Inspect the exact diff against `CLAUDE.md` Sections 8-10. Confirm every changed logic block is commented, every canonical owner is current, and no session log is being used as a substitute for feature/current-state documentation.

- [ ] **Step 3: Run secret and artifact checks**

Require the hygiene test to pass, `git ls-files` to return none of the forbidden paths, the redacted scanner to report zero high-confidence secrets, and `git status --short` to contain only the exact planned files.

- [ ] **Step 4: Prepare exact staging and commit proposals**

List every path by workstream. Inspect `git diff --cached` after exact staging. Do not stage runtime data, user changes, or unrelated branch work.

- [ ] **Step 5: Obtain final commit/push approval**

Present proposed commits, deployment result, remaining non-blocking work, rollback points, and Obsidian sync status. Commit and push only the explicitly approved commits.

## Definition of Done

- No real camera credential, operational database, event store, recording, model, or runtime cache is tracked or reachable in approved rewritten history.
- Camera credentials are rotated and every affected stream is verified.
- All targeted and full regression suites pass with recorded evidence.
- CI runs the service suites needed for the recent feature set.
- Canonical docs reflect 26 cameras/78 streams, actual service/runtime/model/auth state, and the 2026-08-25 behavior.
- Obsidian mirrors canonical facts and contains no secret values.
- Diverged branches have a documented disposition; none were blindly merged or deleted.
- Production acceptance passes or the system is rolled back to the recorded known-good baseline.
- Agent governance is either aligned and pressure-tested or explicitly parked without modifying ACLs.
- The final handoff lists remaining work honestly and does not claim completion from Handover text alone.

## Recommended Execution Order and Approval Gates

1. Tasks 1-3 — inventory and index hygiene; Gate A.
2. Task 4 — credential rotation; Gate B.
3. Task 5 — destructive history rewrite in a disposable mirror.
4. Tasks 6-8 — worktree triage, regression, canonical documentation; Gate C.
5. Task 9 — branch reconciliation; Gate D.
6. Task 10 — production acceptance in an approved window.
7. Task 11 — governance alignment after stabilization; Gate E.
8. Task 12 — final verification and handoff.
