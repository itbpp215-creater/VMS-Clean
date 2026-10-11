# Multi-Site Migration and Offline Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, and use an unencrypted `v1.0.0` multi-site BPP-VMS migration release plus self-contained, site-state-preserving offline updates with automatic rollback.

**Architecture:** A manifest-driven release layer separates versioned application material from explicitly enumerated site-owned state. PowerShell lifecycle tools perform guarded Windows/Docker orchestration, while small Python helpers perform YAML/TLS transformations that require existing Python libraries and can run in reviewed Docker images on target hosts. Every destructive-looking transition uses staging, explicit path guards, verification, and atomic promotion.

**Tech Stack:** Windows PowerShell 5.1, Python 3.11+, Docker Desktop/Compose v2 with WSL2, GNU/bsdtar-compatible `tar.exe`, SHA-256, SQLite, PyYAML, `cryptography`, batch launchers, Python `unittest`/`pytest`, Playwright.

## Global Constraints

- Work only in `D:\BPP-VMS\.worktrees\multi-site-migration-update` until reviewed changes are merged.
- Production source root remains `D:\BPP-VMS\frigate-nvr`; target installation root is exactly `D:\BPP-VMS\frigate-nvr` beneath a new empty `D:\BPP-VMS`.
- Release `v1.0.0` is an unencrypted TAR; retain the existing `.tar.enc` unchanged.
- Never include camera/LPR runtime media, Frigate event databases, Git metadata, worktrees, dependency caches, CUDA cache, source JWT key/session material, DuckDNS/ACME identity, Telegram/Discord credentials, or one-time credential files.
- Preserve users/password hashes/roles/audit, Watchlist and text LPR history, NAS state/configuration, approved config backups, and scrubbed recovery archives.
- Generate node, Compose, JWT, local TLS, `AUTH_AUDIT_SHARED_SECRET`, `WATCHLIST_PROXY_SHARED_SECRET`, and `WATCHLIST_SERVICE_SHARED_SECRET` values per target; leave `WATCHLIST_FEDERATION_SHARED_SECRET` empty.
- Clone profile retains source camera definitions/credentials but disables every camera/detect/record toggle; new-site profile contains no source camera or credential.
- Every production update is self-contained, preserves site state, and retains three successful rollback generations.
- Source export failure keeps the source stack stopped until the archive passes; target update failure rolls back and starts the old release immediately.
- Production package creation requires clean `main`; development packages are explicitly labelled and rejected by default on production targets.
- Every new/modified function and changed logic block must have intent, input/output, side-effect, invariant, and failure comments per `CLAUDE.md` section 10.
- Do not read secret values into chat, logs, manifests, Markdown, or command lines.

---

## File Structure

Create focused lifecycle units rather than extending the 1,064-line legacy migration script:

- `scripts/release/release-policy.json` -- canonical schema, source/site-owned paths, exclusions, required state, service/profile policy, and rollback retention.
- `scripts/release/BppRelease.Common.psm1` -- path guards, process execution, Compose adapter, secure random generation, env parsing/writing, hashing, TAR safety, manifest handling, and atomic file promotion.
- `scripts/release/build_site_profiles.py` -- deterministic clone/new-site YAML and environment transformations without logging secrets.
- `scripts/release/New-BppMigrationPackage.ps1` -- source quiesce, state collection, image export, release assembly, verification, final promotion, and delayed source restart.
- `scripts/release/Test-BppRelease.ps1` -- non-mutating outer/inner hash, manifest, TAR-path, content-scope, and required-artifact verification.
- `scripts/release/Install-BppRelease.ps1` -- target preflight, empty-root guard, identity/profile provisioning, state import, TLS, ACL, Compose start, health, and autostart registration.
- `scripts/release/New-BppUpdatePackage.ps1` -- clean-main semantic-versioned self-contained update builder.
- `scripts/release/Update-BppRelease.ps1` -- target snapshot, migration, validation, promotion, rollback, and three-generation pruning.
- `scripts/release/Start-BppNode.ps1` -- Scheduled Task action that waits for a signed-in user's Docker Desktop engine and starts/checks the site stack.
- `scripts/release/templates/docker-compose.site.yml` -- target-only overlay that places `duckdns` and `acme` behind the inactive `public-edge` profile.
- `scripts/release/templates/Install_BPP-VMS.bat`, `Update_BPP-VMS.bat`, and `Verify_BPP-VMS.bat` -- UAC-aware one-click launchers without secret arguments.
- `scripts/release/templates/คู่มือ-BPP-VMS.md` -- Thai release/install/update/recovery instructions copied beside the TAR.
- `tests/test_release_common.py`, `tests/test_release_profiles.py`, `tests/test_release_package.py`, `tests/test_release_installer.py`, and `tests/test_release_update.py` -- portable fixture-driven coverage.
- `auth-service/generate_tls_certificate.py` and its tests -- Windows-safe atomic PEM writes plus explicit LAN IP SANs.
- Existing stale installer/migration/repository/ACL tests -- reconciled to tracked source and current `_hd`/worktree behavior.

The legacy encrypted `scripts/migrate-machine.ps1` remains available for its documented single-host encrypted workflow but is no longer the implementation behind the new multi-site TAR.

---

### Task 1: Restore a Portable Clean Baseline and LAN TLS Generation

**Files:**
- Modify: `auth-service/generate_tls_certificate.py`
- Modify: `auth-service/tests/test_tls_certificate.py`
- Modify: `tests/test_repository_config.py`
- Modify: `tests/test_windows_acl.py`
- Modify: `tests/test_installer_release.py`
- Modify: `tests/test_machine_migration.py`
- Modify: `package.json`

**Interfaces:**
- Produces: `generate_tls_certificate(certificate_path: Path, private_key_path: Path, ip_addresses: Sequence[str] = ()) -> None`.
- Produces: portable repository tests that do not assume production `.env` or untracked installer files.
- Consumes: current 15-camera config where `<camera>`, `<camera>_sub`, and `<camera>_hd` are all owned streams.

- [ ] **Step 1: Extend TLS tests before implementation**

Add an IP SAN assertion and a Windows cleanup regression:

```python
tls_certificate.generate_tls_certificate(
    certificate_path,
    private_key_path,
    ip_addresses=["192.168.50.10"],
)
san = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName)
self.assertIn(ipaddress.ip_address("192.168.50.10"), san.value.get_values_for_type(x509.IPAddress))
```

Run:

```powershell
$env:PYTHONPATH='auth-service'
python -m pytest -q auth-service/tests/test_tls_certificate.py
```

Expected: FAIL because `generate_tls_certificate` lacks `ip_addresses`, and the existing Windows run still exposes `os.fchmod`/open-handle failure.

- [ ] **Step 2: Make atomic PEM writes portable and add explicit IP SANs**

Change `_write_new_file` so Windows closes the descriptor before cleanup, applies `os.chmod` after close, and POSIX uses `os.fchmod`. Validate every supplied address with `ipaddress.ip_address`, deduplicate addresses, and always retain localhost/hostname/127.0.0.1 SANs. Add repeatable CLI `--ip-address` arguments.

Implementation shape:

```python
def _set_private_mode(descriptor: int, path: Path, mode: int) -> None:
    """Apply a narrow mode using descriptor semantics on POSIX and path semantics on Windows."""
    if os.name == "nt":
        os.chmod(path, mode)
    else:
        os.fchmod(descriptor, mode)


def generate_tls_certificate(
    certificate_path: Path,
    private_key_path: Path,
    ip_addresses: Sequence[str] = (),
) -> None:
    """Create one non-overwriting local certificate covering localhost and approved LAN IPs."""
```

Ensure the exception handler closes a still-open descriptor before unlinking the temporary path.

- [ ] **Step 3: Reconcile portable repository expectations**

Update stream ownership to:

```python
camera_owned_streams = cameras | {
    stream
    for camera in cameras
    for stream in (f"{camera}_sub", f"{camera}_hd")
}
```

Move new multi-site installer assertions out of the nonexistent top-level `installer/` assumption and point them to `frigate-nvr/scripts/release/`. Preserve legacy migration crypto assertions only for `migrate-machine.ps1`; new unencrypted release assertions belong to the new test files.

Split the ACL suite into:

```python
@unittest.skipUnless(
    os.environ.get("BPP_RUN_PRODUCTION_ACL_AUDIT") == "1",
    "Production ACL audit requires machine-local protected paths",
)
def test_active_acl_has_no_broad_or_inherited_access_rules(self) -> None:
```

Keep fixture-based ACL behavior portable and mandatory.

- [ ] **Step 4: Make browser execution reproducible**

Add scripts without relaxing the pinned engine/dependency:

```json
{
  "scripts": {
    "test:browser": "node tests/browser-smoke.mjs",
    "test:portable": "node tests/browser-smoke.mjs"
  }
}
```

Document that final verification uses Node `22.23.1` and `npm ci`; the Codex bundled runtime may be used only when it exposes the same executable and dependency versions.

- [ ] **Step 5: Run focused and root baseline tests**

Run:

```powershell
$env:PYTHONPATH='auth-service'; python -m pytest -q auth-service/tests
python -m pytest -q tests
```

Expected: all portable tests PASS; the live production ACL audit is SKIPPED unless explicitly enabled.

- [ ] **Step 6: Commit the portable baseline**

```powershell
git add auth-service/generate_tls_certificate.py auth-service/tests/test_tls_certificate.py tests package.json
git commit -m "fix: make release baseline portable on Windows"
```

---

### Task 2: Add the Release Policy and Common Safety Module

**Files:**
- Create: `scripts/release/release-policy.json`
- Create: `scripts/release/BppRelease.Common.psm1`
- Create: `tests/test_release_common.py`

**Interfaces:**
- Produces: `Resolve-BppFullPath`, `Assert-BppPathUnderRoot`, `Invoke-BppNative`, `Read-BppEnv`, `Write-BppEnv`, `New-BppSecret`, `Get-BppFileManifest`, `Test-BppTarEntries`, `Read-BppManifest`, `Write-BppManifest`, `Move-BppAtomic`, `Invoke-BppCompose`, and `Remove-BppOwnedTemporaryDirectory`.
- Produces: policy schema `bpp-release-policy/v1` consumed by all later tools.

- [ ] **Step 1: Write policy and safety contract tests**

Create fixture-driven tests that import the module in Windows PowerShell and assert:

```python
assert policy["schema"] == "bpp-release-policy/v1"
assert "storage" in policy["excludedRuntimeRoots"]
assert "lpr-data" in policy["excludedRuntimeRoots"]
assert "frigate-db" in policy["excludedVolumes"]
assert policy["rollbackRetention"] == 3
```

Test traversal rejection, unknown manifest schema rejection, env round-trip with CRLF/Unicode and secret values absent from stdout, safe TAR paths, and cleanup refusal for a caller-selected path.

Run:

```powershell
python -m pytest -q tests/test_release_common.py
```

Expected: FAIL because the policy and module do not exist.

- [ ] **Step 2: Define the canonical policy**

The JSON must explicitly enumerate:

```json
{
  "schema": "bpp-release-policy/v1",
  "releaseSchema": 1,
  "rollbackRetention": 3,
  "excludedRuntimeRoots": ["storage", "lpr-data"],
  "excludedVolumes": ["frigate-db", "cuda-cache"],
  "siteOwnedPaths": [
    ".env",
    "config/config.yml",
    "config/acme",
    "config/certs",
    "config/lpr",
    "config/dashboard-settings",
    "config/backups",
    "storage",
    "lpr-data"
  ],
  "requiredModels": [
    "config/model_cache/yolo11m-640.onnx",
    "LicensePlateRECOG/model/license_plate.pt",
    "LicensePlateRECOG/model/data_plate.pt"
  ],
  "rollbackState": ["auth-db", "nas-storage", "nas-bot-data", "config/lpr", "config/dashboard-settings"]
}
```

Add explicit patterns for `.git`, `.worktrees`, `.venv`, `node_modules`, caches, `.once`, `secret.key`, `config/backup.db`, bot/DuckDNS/ACME secrets, and captured-media extensions only under runtime roots.

- [ ] **Step 3: Implement the common module**

Every exported function must use `[CmdletBinding()]`, strict mode, documented side effects, and native exit-code checking. `Read-BppEnv` returns an ordered dictionary without logging values. `Write-BppEnv` writes UTF-8 atomically and rejects newline-containing keys/values. `New-BppSecret` returns at least 32 random bytes encoded with Base64URL. TAR validation rejects absolute, UNC, drive-prefixed, traversal, and link escape entries.

- [ ] **Step 4: Run common-module tests**

```powershell
python -m pytest -q tests/test_release_common.py
```

Expected: PASS.

- [ ] **Step 5: Commit the common release layer**

```powershell
git add scripts/release/release-policy.json scripts/release/BppRelease.Common.psm1 tests/test_release_common.py
git commit -m "feat: add guarded release policy and primitives"
```

---

### Task 3: Build Deterministic Site Profiles and Exportable State

**Files:**
- Create: `scripts/release/build_site_profiles.py`
- Create: `tests/test_release_profiles.py`
- Modify: `scripts/release/BppRelease.Common.psm1`

**Interfaces:**
- Produces: `build_profiles(config: dict, env: Mapping[str, str]) -> tuple[Profile, Profile]` where `Profile` contains `config`, `env`, and `scope`.
- Produces: `Export-BppNamedVolume`, `Export-BppAuthSeed`, `Export-BppRecoveryVolume`, and `Get-BppActiveState` PowerShell functions.
- Consumes: `Read-BppEnv`, guarded paths, and `release-policy.json` from Task 2.

- [ ] **Step 1: Write failing profile tests**

Use a fixture with two enabled cameras, `_sub`/`_hd` streams, camera credentials, internal secrets, bot tokens, DuckDNS, NAS, and Federation values. Assert clone output retains camera definitions and camera/NAS values while setting all three camera toggles false. Assert new-site output has empty `cameras`, no camera streams, and no camera credential keys. Assert both profiles clear external/identity secrets.

Critical assertions:

```python
for camera in clone.config["cameras"].values():
    assert camera["enabled"] is False
    assert camera["detect"]["enabled"] is False
    assert camera["record"]["enabled"] is False
assert new_site.config["cameras"] == {}
assert new_site.config["go2rtc"]["streams"] == {}
assert clone.env["NAS_STORAGE_PATH"] == source_env["NAS_STORAGE_PATH"]
assert clone.env["DUCKDNS_TOKEN"] == ""
assert clone.env["WATCHLIST_FEDERATION_SHARED_SECRET"] == ""
```

Run:

```powershell
python -m pytest -q tests/test_release_profiles.py
```

Expected: FAIL because the profile builder is absent.

- [ ] **Step 2: Implement safe YAML/env profile generation**

Use `yaml.safe_load`/`safe_dump(sort_keys=False, allow_unicode=True)`. Refuse missing `cameras` or `go2rtc.streams` shapes rather than guessing. Build environment outputs from allowlists, not a blacklist-only copy. Never print values. Add CLI paths for source config/env and separate clone/new-site output directories.

- [ ] **Step 3: Add stopped-volume export functions**

`Export-BppNamedVolume` must locate the exact Compose volume name and use a tool-owned stopped helper container with a unique guarded name. `Export-BppAuthSeed` copies only `auth.db`; it refuses a missing database and excludes `secret.key`/`*.once`. Recovery-volume export applies the same scrub. `Get-BppActiveState` records running service names before source stop.

- [ ] **Step 4: Test profiles and volume command planning**

Use injected/mock native command adapters so tests prove exact Docker arguments without mounting real production volumes. Run:

```powershell
python -m pytest -q tests/test_release_profiles.py tests/test_release_common.py
```

Expected: PASS with no secret value in captured output.

- [ ] **Step 5: Commit profile and state collection**

```powershell
git add scripts/release/build_site_profiles.py scripts/release/BppRelease.Common.psm1 tests/test_release_profiles.py
git commit -m "feat: generate isolated site profiles and state seeds"
```

---

### Task 4: Build and Fully Verify the v1 Migration Release

**Files:**
- Create: `scripts/release/New-BppMigrationPackage.ps1`
- Create: `scripts/release/Test-BppRelease.ps1`
- Create: `tests/test_release_package.py`
- Modify: `scripts/release/BppRelease.Common.psm1`

**Interfaces:**
- Produces: `New-BppMigrationPackage.ps1 -InstallPath <path> -OutputDirectory <path> -Version v1.0.0 [-FixtureMode]`.
- Produces: `Test-BppRelease.ps1 -ArchivePath <tar> [-ExtractRoot <path>] -Full`.
- Consumes: policy/common module and profile/state outputs from Tasks 2-3.

- [ ] **Step 1: Write failing package-scope tests**

Build a fixture source containing required app/models, fake auth/Watchlist/NAS data, forbidden media/event/Git/secret paths, and static UI images. `-FixtureMode` skips Docker but consumes fixture image/state bundles. Assert final archive includes required data/static images and excludes every forbidden path/value.

Also test that a forced verifier failure leaves only `.partial`, never replaces an existing final TAR, and records that source restart is forbidden until success.

Run:

```powershell
python -m pytest -q tests/test_release_package.py
```

Expected: FAIL because builder/verifier scripts are absent.

- [ ] **Step 2: Implement source export phases**

Implement named phases with a resumable tool-owned staging state file:

```text
preflight -> quiesced -> files-collected -> volumes-collected -> images-saved
-> tar-built -> tar-extracted -> hashes-verified -> scope-verified -> promoted
-> source-restarted -> source-healthy
```

Before `quiesced`, validate Compose/Frigate, free space, output outside source, required models, and a clean release commit. After `quiesced`, never execute source `start` until `promoted` and all archive checks pass. On failure, retain guarded staging metadata and stopped source state for retry.

- [ ] **Step 3: Assemble manifest and image bundle**

The manifest contains schema/version/source commit, profiles, required models, volume/state inventory, image repository/tag/ID list, exclusions, file hashes, required disk space, and companion artifact hashes. It contains no secret values. Use `docker compose config --images` plus `docker image inspect` and `docker save` for the complete image set.

- [ ] **Step 4: Implement full verifier**

The verifier must:

1. compare outer SHA-256;
2. run TAR entry safety before extraction;
3. extract to a new guarded directory;
4. validate manifest schema/version;
5. recompute every payload digest;
6. verify image bundle entries and recorded image IDs;
7. verify all three models and required state;
8. scan runtime roots and database paths for forbidden media/event content;
9. verify no `.git`, old identity secret, bot/DuckDNS/ACME credential, `secret.key`, or `*.once` exists;
10. verify companion launchers/docs are present.

- [ ] **Step 5: Run package fixture tests and PowerShell parser checks**

```powershell
python -m pytest -q tests/test_release_package.py
$null = [System.Management.Automation.Language.Parser]::ParseFile(
  'scripts/release/New-BppMigrationPackage.ps1', [ref]$null, [ref]$parseErrors
)
if ($parseErrors.Count) { throw $parseErrors }
```

Expected: PASS.

- [ ] **Step 6: Commit release build and verification**

```powershell
git add scripts/release/New-BppMigrationPackage.ps1 scripts/release/Test-BppRelease.ps1 scripts/release/BppRelease.Common.psm1 tests/test_release_package.py
git commit -m "feat: build and verify multi-site migration releases"
```

---

### Task 5: Install Local-Only Nodes with Two Safe Profiles

**Files:**
- Create: `scripts/release/Install-BppRelease.ps1`
- Create: `scripts/release/Start-BppNode.ps1`
- Create: `scripts/release/templates/docker-compose.site.yml`
- Create: `tests/test_release_installer.py`
- Modify: `auth-service/generate_tls_certificate.py`

**Interfaces:**
- Produces: `Install-BppRelease.ps1 -ArchivePath <tar> -InstallRoot D:\BPP-VMS\frigate-nvr -Profile Clone|NewSite -SiteName <text> -LanIp <IPv4> [-PreflightOnly]`.
- Produces: `Start-BppNode.ps1 -InstallRoot <path> -TimeoutSeconds 300`.
- Consumes: verified archive, profile outputs, and common module.

- [ ] **Step 1: Write failing installer plan/fixture tests**

Test preflight refusal for a non-empty `D:\BPP-VMS`, invalid/ambiguous IP, unsupported Windows build, missing WSL/Docker/NVIDIA, failed checksum, and insufficient disk. In fixture mode assert exact install plans without requiring Docker.

Assert clone/new-site profile semantics, per-node secret uniqueness, empty Federation/bot/public-edge secrets, retained NAS config, new JWT key, site/node metadata, and no source certificate.

Run:

```powershell
python -m pytest -q tests/test_release_installer.py
```

Expected: FAIL because installer/start/overlay files are absent.

- [ ] **Step 2: Implement preflight and destination staging**

Support Windows 10 22H2 build 19045 and Windows 11 23H2 build 22631 or higher. Verify WSL version, Docker Compose, Linux containers, GPU access, `tar.exe`, free space, and archive integrity. Canonicalize the destination and reject any child before creating it. Extract to a sibling partial directory and promote only after application/state preparation succeeds.

- [ ] **Step 3: Provision site state and unique boundaries**

Write `config/dashboard-settings/site-identity.json` with schema, site name, node UUID, Windows hostname, LAN IP, release version, and creation time. Generate the three internal shared secrets and leave Federation empty. Restore `auth.db` before first auth start, omit the source JWT key so auth-service generates a new one, and append a non-secret audit event describing node installation.

- [ ] **Step 4: Provision local-only Compose and TLS**

The overlay must assign `profiles: ["public-edge"]` to `duckdns` and `acme`; target lifecycle commands always use both base and site overlay files. Generate an IP-SAN certificate by running the reviewed auth image helper with the target cert directory bind-mounted. Keep Telegram/Discord values empty. Apply clone/new-site config selected by the owner.

- [ ] **Step 5: Create, import, harden, start, and validate**

Load images, run Compose config, create stopped containers/volumes, import auth/NAS state, apply `harden-windows-acl.ps1`, start without `public-edge`, wait for required health, validate Frigate config, and record a secret-free installation report. A failure must not print success or start a partially imported stack.

- [ ] **Step 6: Register after-login autostart**

Register a narrow Scheduled Task for the installing user at logon. `Start-BppNode.ps1` launches Docker Desktop only if needed, polls `docker info`, starts the two-file Compose project, validates health, and exits nonzero with a local report on timeout. Do not claim pre-login WSL2 startup.

- [ ] **Step 7: Run installer tests**

```powershell
python -m pytest -q tests/test_release_installer.py auth-service/tests/test_tls_certificate.py
```

Expected: PASS.

- [ ] **Step 8: Commit local node installation**

```powershell
git add scripts/release/Install-BppRelease.ps1 scripts/release/Start-BppNode.ps1 scripts/release/templates/docker-compose.site.yml tests/test_release_installer.py auth-service
git commit -m "feat: install isolated local-only BPP nodes"
```

---

### Task 6: Build Self-Contained Updates and Roll Back Failures

**Files:**
- Create: `scripts/release/New-BppUpdatePackage.ps1`
- Create: `scripts/release/Update-BppRelease.ps1`
- Create: `tests/test_release_update.py`
- Modify: `scripts/release/release-policy.json`
- Modify: `scripts/release/BppRelease.Common.psm1`

**Interfaces:**
- Produces: `New-BppUpdatePackage.ps1 -Version vX.Y.Z -OutputDirectory <path> [-Development]`.
- Produces: `Update-BppRelease.ps1 -ArchivePath <tar> -InstallRoot <path> [-AllowDevelopment] [-FixtureMode]`.
- Produces: installed metadata `.bpp-release/current.json` and rollback generations under `.bpp-rollback/vX.Y.Z-<timestamp>`.

- [ ] **Step 1: Write failing semantic-version and state-preservation tests**

Test dirty tree refusal, non-main production refusal, non-increasing version refusal, `dev` rejection without override, and self-contained image requirements. Build a fixture target with camera config, `.env`, local TLS, node identity, users/audit, Watchlist/LPR history, NAS, and post-install media; assert successful update preserves exact site-owned bytes unless a declared migration changes them.

Force a migration or health failure and assert application files/images/config/database return to their old hashes and the old release is started. Install four successful updates and assert only the newest three rollback generations remain.

Run:

```powershell
python -m pytest -q tests/test_release_update.py
```

Expected: FAIL because update tools are absent.

- [ ] **Step 2: Implement the clean-main update builder**

Use `git status --porcelain=v1 --untracked-files=all`, `git branch --show-current`, and `git rev-parse HEAD`. Production requires `main` and no output. Parse versions with `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`; compare integer tuples. Reuse application collection, image save, manifest, and verifier primitives from Task 4.

- [ ] **Step 3: Implement explicit site-state ownership and migrations**

Never mirror-delete the installation root. Stage release-owned paths and atomically replace only files listed as release-owned. Preserve policy `siteOwnedPaths`. Each migration manifest entry names `id`, `fromSchema`, `toSchema`, `applyScript`, `rollbackScript`, and affected state paths. Reject a state-schema change lacking both apply and rollback scripts.

- [ ] **Step 4: Implement rollback snapshots and promotion**

Before stop, capture running service state and current health. After stop, snapshot release-owned files, affected site paths/volumes, current metadata, and image references. Load new images, apply staged files/migrations, validate, and promote metadata. On any failure, run migration rollback in reverse order, restore snapshots/images/files, start the old service set, and validate old health.

- [ ] **Step 5: Implement three-generation pruning**

Prune only after new-version health succeeds. Sort valid successful-generation metadata by promotion timestamp, keep newest three, verify each delete target is a direct child of `.bpp-rollback`, and delete one generation at a time. A pruning failure warns but does not invalidate the healthy update.

- [ ] **Step 6: Run update/rollback tests**

```powershell
python -m pytest -q tests/test_release_update.py tests/test_release_common.py
```

Expected: PASS, including forced rollback and state hash equality.

- [ ] **Step 7: Commit update lifecycle**

```powershell
git add scripts/release/New-BppUpdatePackage.ps1 scripts/release/Update-BppRelease.ps1 scripts/release/release-policy.json scripts/release/BppRelease.Common.psm1 tests/test_release_update.py
git commit -m "feat: add self-contained updates with rollback"
```

---

### Task 7: Add One-Click Launchers and Thai Operator Guidance

**Files:**
- Create: `scripts/release/templates/Install_BPP-VMS.bat`
- Create: `scripts/release/templates/Update_BPP-VMS.bat`
- Create: `scripts/release/templates/Verify_BPP-VMS.bat`
- Create: `scripts/release/templates/คู่มือ-BPP-VMS.md`
- Modify: `tests/test_release_package.py`
- Modify: `tests/test_release_installer.py`

**Interfaces:**
- Produces: companion files copied to `D:\BPP-VMS-Migration-Package` by the migration builder.
- Consumes: PowerShell tools from Tasks 4-6.

- [ ] **Step 1: Write launcher contract tests**

Assert each batch file resolves `%~dp0`, quotes every path, uses PowerShell `-ExecutionPolicy Bypass -File`, forwards no secret, preserves exit code, and pauses with a Thai success/failure summary. Installer/updater request UAC through their PowerShell worker; verifier remains non-mutating.

- [ ] **Step 2: Implement launchers**

Use this guarded pattern with the exact worker name per launcher:

```bat
@echo off
setlocal
set "BPP_PACKAGE_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BPP_PACKAGE_DIR%tools\Install-BppRelease.ps1" -ArchivePath "%BPP_PACKAGE_DIR%BPP-VMS-FullBackup.tar"
set "BPP_EXIT=%ERRORLEVEL%"
if not "%BPP_EXIT%"=="0" echo Installation failed with exit code %BPP_EXIT%.
exit /b %BPP_EXIT%
```

The actual scripts must use distinct names/arguments and comments explaining UAC ownership and secret handling.

- [ ] **Step 3: Write the Thai guide**

Cover prerequisites, supported Windows builds, Docker Desktop login startup limitation, GPU checks, empty target rule, Clone/NewSite selection, IP/self-signed TLS behavior, disabled cameras/integrations, Google Drive private download, update/rollback, three-generation retention, recovery reports, old `.enc` retention, and the unencrypted TAR sensitivity warning.

- [ ] **Step 4: Run companion-file tests**

```powershell
python -m pytest -q tests/test_release_package.py tests/test_release_installer.py
```

Expected: PASS.

- [ ] **Step 5: Commit operator UX**

```powershell
git add scripts/release/templates tests/test_release_package.py tests/test_release_installer.py
git commit -m "docs: add one-click multi-site operator workflow"
```

---

### Task 8: Complete Canonical Documentation and Full Verification

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operations.md`
- Modify: `docs/security-model.md`
- Modify: `docs/features/installation-and-account-migration.md`
- Create: `docs/features/offline-release-updates.md`
- Modify: `docs/features/README.md`
- Modify: `docs/README.md`
- Modify: `docs/troubleshooting.md`
- Modify: `docs/history.md`
- Create: `docs/decisions/ADR-0013-multi-site-release-state-boundary.md`
- Create: `docs/sessions/2026-08-09-multi-site-migration-update.md`

**Interfaces:**
- Produces: operator and maintainer documentation matching tested behavior.
- Consumes: final implementation and validation evidence from Tasks 1-7.

- [ ] **Step 1: Update canonical behavior and security docs**

Document exact release/site ownership, installer profiles, per-node secret generation, local TLS/public-edge behavior, unencrypted package sensitivity, SHA-only limitation, update/rollback flow, and source-vs-target failure policies. Do not claim a production TAR or first-target acceptance until those events actually pass.

- [ ] **Step 2: Add ADR and feature ownership**

The ADR records selection of manifest-driven immutable releases with explicit site state over whole-machine/WSL cloning. The feature document owns Semantic Versioning, clean-main builds, private manual Drive distribution, self-contained updates, migration contracts, rollback, and retention.

- [ ] **Step 3: Record baseline repair and validation in the session log**

Include initial suite counts/failures, code/tasks completed, commits, tests, Docker/config validation, operational actions not yet executed, package checksum once available, and first-target work remaining.

- [ ] **Step 4: Run the full required test matrix**

```powershell
$env:PYTHONPATH='auth-service'; python -m pytest -q auth-service/tests
python -m unittest discover -s watchlist-api/tests -v
$env:PYTHONPATH='config-api'; python -m pytest -q config-api/tests
python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
npm ci
npm run test:browser
docker compose config --quiet
docker exec frigate-nvr python3 -m frigate --validate-config
docker inspect -f '{{.State.Health.Status}}' frigate-nvr
nvidia-smi
```

Expected: all portable tests and browser scenarios PASS, Compose/config validation succeeds, Frigate is healthy, and NVIDIA is visible. Run production ACL audit separately with `BPP_RUN_PRODUCTION_ACL_AUDIT=1` only against the approved production root.

- [ ] **Step 5: Review comments, diffs, docs, and secrets**

Run:

```powershell
git diff --check
git diff --stat
rg -n 'T[B]D|T[O]DO|F[I]XME' scripts/release tests docs
git status --short
```

Review every changed function/logic block for `CLAUDE.md` section 10 comments. Search tracked changes for actual secret values without printing `.env` contents. Verify all documentation links and indexes.

- [ ] **Step 6: Commit canonical documentation**

```powershell
git add docs
git commit -m "docs: document multi-site releases and rollback updates"
```

---

### Task 9: Review, Merge, Create v1.0.0, and Prove the Source Result

**Files:**
- Generated outside Git: `D:\BPP-VMS-Migration-Package\BPP-VMS-FullBackup.tar`
- Generated outside Git: companion BAT, manifest, checksum, tools, guide, and verification report
- Preserved outside Git: `D:\BPP-VMS-Migration-Package\BPP-VMS-FullBackup.tar.enc`
- Modify after real evidence: `docs/sessions/2026-08-09-multi-site-migration-update.md`
- Modify after real evidence: `docs/current-state.md`, `docs/history.md`, and `docs/operations.md` only where actual status changes

**Interfaces:**
- Produces: verified production release artifacts and a healthy restarted source stack.
- Consumes: reviewed branch, all tests, production Docker/GPU/config, and owner-approved output directory.

- [ ] **Step 1: Request and apply code review**

Use `superpowers:requesting-code-review`. Resolve every correctness/security finding, rerun affected focused tests, and record review disposition in the session log.

- [ ] **Step 2: Run verification-before-completion**

Use `superpowers:verification-before-completion` and rerun the full Task 8 matrix from a clean worktree. Confirm branch status contains only committed intended changes.

- [ ] **Step 3: Integrate the branch safely**

Use `superpowers:finishing-a-development-branch`. Merge `codex/multi-site-migration-update` into local `main` only after review/tests pass. Do not run the production exporter from an unmerged feature commit because production release policy requires clean `main`.

- [ ] **Step 4: Run production preflight without stopping services**

From `D:\BPP-VMS\frigate-nvr`, run the exporter preflight/plan mode, full config validation, disk estimate, model/state inventory, output-path guard, image resolution, and current health/GPU checks. Confirm `BPP-VMS-FullBackup.tar.enc` exists and will not be targeted.

- [ ] **Step 5: Build and verify the production TAR while keeping source stopped**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release\New-BppMigrationPackage.ps1 `
  -InstallPath 'D:\BPP-VMS\frigate-nvr' `
  -OutputDirectory 'D:\BPP-VMS-Migration-Package' `
  -Version 'v1.0.0'
```

Expected: stack stops, all collection/build/full verification phases pass, final TAR and companion files are atomically promoted, only the prior running service set restarts, and source config/GPU/health pass. If any phase fails, keep the stack stopped, correct the failure, and resume/retry until success before restart.

- [ ] **Step 6: Independently verify final artifacts**

Run:

```powershell
& 'D:\BPP-VMS-Migration-Package\Verify_BPP-VMS.bat'
Get-FileHash -Algorithm SHA256 'D:\BPP-VMS-Migration-Package\BPP-VMS-FullBackup.tar'
Get-Item 'D:\BPP-VMS-Migration-Package\BPP-VMS-FullBackup.tar.enc'
```

Expected: verifier PASS, hash equals the companion checksum/manifest, and old encrypted file metadata/content remain untouched.

- [ ] **Step 7: Update evidence-only documentation and commit**

Record actual TAR size/hash/time, included/excluded counts, Docker image IDs, source downtime, retry history, source restart health, and the explicit fact that first-target acceptance remains pending until performed. Commit only truthful actual-state updates.

- [ ] **Step 8: Complete first-target acceptance when a target is available**

Install on one approved Windows 10/11 NVIDIA host, verify preserved seed data, disabled cameras/integrations, local HTTPS, login with existing passwords, unique node/JWT boundaries, reboot/remote-login autostart, one successful update, and one forced rollback. Record evidence before claiming full cross-machine migration verification.
