# Orphaned Windows ACL Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows ACL hardening recover safely from orphaned account SIDs, then restore the existing Docker Compose deployment without restarting Windows.

**Architecture:** Rebuild each protected path's DACL from a new `FileSecurity` or `DirectorySecurity` descriptor containing only approved SIDs. Verify the applied descriptor through raw SID values, so neither replacement nor verification depends on resolving stale accounts. Exercise the real script against a temporary tree containing a synthetic orphaned SID before applying it to the live runtime paths.

**Tech Stack:** PowerShell 5.1, .NET NTFS access-control APIs, Python `unittest`, Docker Desktop, Docker Compose, project validation suites.

**Global Constraints:** Never read, print, copy, or commit protected file contents. Never grant `Users`, `Authenticated Users`, or `Everyone`. Do not delete or recreate volumes, recordings, models, databases, or runtime data. Do not restart Windows. Use `git -c safe.directory=D:/BPP-VMS` for repository commands because the checkout owner SID belongs to the previous Windows account.

---

## Task 1: Add an orphaned-SID regression test (RED)

**Files:**

- Modify: `frigate-nvr/tests/test_windows_acl.py`
- Test: `frigate-nvr/tests/test_windows_acl.py`

- [ ] **Step 1: Add a Windows-only test harness for temporary ACL trees**

Add `tempfile` to the imports. Add a private helper on `WindowsAclTests` that runs non-interactive PowerShell with a supplied working directory and returns `subprocess.CompletedProcess[str]`. Give the helper a docstring because repository rule 8 requires comments/docstrings on modified code.

```python
@staticmethod
def _run_powershell(script: str, cwd: Path, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    """Run an isolated PowerShell ACL probe without exposing file contents."""

    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
```

- [ ] **Step 2: Create the failing end-to-end regression**

Add `test_hardening_replaces_orphaned_sid_and_is_idempotent`, guarded with `@unittest.skipUnless(os.name == "nt", ...)`. In a `TemporaryDirectory`, create all protected paths expected by the real script:

```text
.env
config/auth/
config/backups/
config/certs/
config/lpr/
lpr-data/
```

Create at least one nested file under each directory. Seed the root items and nested items with a synthetic unresolvable SID such as `S-1-5-21-999999999-888888888-777777777-4242` by constructing a `SecurityIdentifier` and `FileSystemAccessRule` directly; do not resolve the SID to an account name.

Invoke the repository's real `scripts/harden-windows-acl.ps1` twice with the temporary path passed as `-RepositoryRoot`. Assert both runs exit zero. Then call `GetSecurityDescriptorBinaryForm()` on each item's ACL, construct a `RawSecurityDescriptor`, and assert:

- DACL protection is enabled.
- no ACE is inherited;
- every ACE is an allow ACE;
- the unique SID set is exactly SYSTEM (`S-1-5-18`), Administrators (`S-1-5-32-544`), and the current test process user SID;
- the synthetic orphaned SID is absent.

The second successful invocation is the idempotency assertion. Failure messages may include paths and SID values, but never protected file contents.

- [ ] **Step 3: Update the static control assertions**

The implementation will stop using `icacls /inheritance:r`, so replace that assertion with checks for the replacement-descriptor controls that will be introduced in Task 2:

```python
self.assertIn("SetAccessRuleProtection", script)
self.assertIn("RawSecurityDescriptor", script)
self.assertIn("ACL verification failed", script)
```

- [ ] **Step 4: Run the new test and confirm the current implementation fails for the intended reason**

Run from `D:\BPP-VMS\frigate-nvr`:

```powershell
python -m unittest tests.test_windows_acl.WindowsAclTests.test_hardening_replaces_orphaned_sid_and_is_idempotent -v
```

Expected: `FAIL` because the current script calls `IdentityReference.Translate(...)` or `icacls /remove` on the synthetic orphaned SID and returns nonzero. If it fails for temp-path setup or permissions instead, correct the test harness and rerun until the failure proves the orphaned-SID defect.

## Task 2: Rebuild and verify DACLs by raw SID (GREEN)

**Files:**

- Modify: `frigate-nvr/scripts/harden-windows-acl.ps1`
- Modify: `frigate-nvr/tests/test_windows_acl.py`
- Test: `frigate-nvr/tests/test_windows_acl.py`

- [ ] **Step 1: Add a fresh-descriptor constructor**

Add `New-RestrictedAcl` with a synopsis comment. It must select `DirectorySecurity` for directories and `FileSecurity` for files, disable inheritance without copying inherited rules, and add exactly one `FullControl` allow rule for every approved SID.

```powershell
function New-RestrictedAcl {
    <#
    .SYNOPSIS
    Builds a replacement DACL containing only the approved SIDs.
    #>
    param(
        [Parameter(Mandatory)]
        [System.IO.FileSystemInfo]$Item,

        [Parameter(Mandatory)]
        [System.Security.Principal.SecurityIdentifier[]]$Principals
    )

    $acl = if ($Item.PSIsContainer) {
        [System.Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        [System.Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($true, $false)

    $inheritance = if ($Item.PSIsContainer) {
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }

    foreach ($principal in $Principals) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $principal,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    return $acl
}
```

Keep principal parameters typed as `SecurityIdentifier[]`; `Resolve-PrincipalSid` and the three built-in principals already produce that type.

- [ ] **Step 2: Add raw-DACL inspection**

Add `Get-RawDaclEntries` with a synopsis comment. It must build a `RawSecurityDescriptor` from the ACL object's binary form and return records containing the SID value, ACE type/qualifier, and inherited flag without calling `Translate()`.

```powershell
function Get-RawDaclEntries {
    <#
    .SYNOPSIS
    Reads DACL identities as raw SIDs without account-name translation.
    #>
    param(
        [Parameter(Mandatory)]
        [System.Security.AccessControl.FileSystemSecurity]$Acl
    )

    $bytes = $Acl.GetSecurityDescriptorBinaryForm()
    $descriptor = [System.Security.AccessControl.RawSecurityDescriptor]::new(
        $bytes,
        0
    )
    foreach ($ace in $descriptor.DiscretionaryAcl) {
        [pscustomobject]@{
            SidValue = $ace.SecurityIdentifier.Value
            AceType = $ace.AceType
            IsInherited = $ace.IsInherited
        }
    }
}
```

Use `AceType` values for allow verification (`AccessAllowed`, `AccessAllowedObject`, or the exact allow type emitted by the constructor). Do not fall back to account-name translation.

- [ ] **Step 3: Replace the mutation logic in `Set-RestrictedAcl`**

Keep the existing `ShouldProcess` guard and containment checks. Remove the incremental `icacls /inheritance:r`, `/remove:g`, `/remove:d`, and `/grant:r` loops. Instead:

```powershell
$replacementAcl = New-RestrictedAcl -Item $Item -Principals $Principals
Set-Acl -LiteralPath $Item.FullName -AclObject $replacementAcl
```

This changes only NTFS ACL metadata. It must not change file ownership, timestamps intentionally, contents, paths, or Docker data.

- [ ] **Step 4: Verify the resulting descriptor exactly**

After `Set-Acl`, retrieve the ACL and raw entries. Throw `ACL verification failed for <path>` when any of these are true:

- `AreAccessRulesProtected` is false;
- any raw ACE is inherited;
- any raw ACE is not an allow ACE;
- the sorted unique raw SID set differs from the sorted unique approved SID set;
- an approved SID is missing or an unexpected SID remains.

Preserve the existing fail-closed behavior: a partial result is an error, and the script must not print a success message unless every protected item verifies.

- [ ] **Step 5: Make the active-host test raw-SID safe**

Update `test_active_acl_has_no_broad_or_inherited_access_rules` to enumerate `RawSecurityDescriptor.DiscretionaryAcl` rather than `$acl.Access` plus `Translate()`. It must continue checking Everyone, Authenticated Users, and built-in Users, and now also fail on non-allow ACEs. This prevents the audit itself from crashing when diagnosing an orphaned SID.

- [ ] **Step 6: Run targeted and full ACL tests**

Run from `D:\BPP-VMS\frigate-nvr`:

```powershell
python -m unittest tests.test_windows_acl.WindowsAclTests.test_hardening_replaces_orphaned_sid_and_is_idempotent -v
python -m unittest tests.test_windows_acl -v
```

Expected: the targeted temporary-tree test passes. The full module's live-host audit may remain inaccessible until Task 3 applies the repaired ACL; if so, record only that known access-denied result and rerun immediately after the live hardening step rather than weakening or skipping the assertion.

- [ ] **Step 7: Review and commit the code/test change**

Run these Git commands from `D:\BPP-VMS` so every pathspec is relative to the repository root:

```powershell
git -c safe.directory=D:/BPP-VMS diff -- frigate-nvr/scripts/harden-windows-acl.ps1 frigate-nvr/tests/test_windows_acl.py
git -c safe.directory=D:/BPP-VMS diff --check
git -c safe.directory=D:/BPP-VMS add frigate-nvr/scripts/harden-windows-acl.ps1 frigate-nvr/tests/test_windows_acl.py
git -c safe.directory=D:/BPP-VMS commit -m "fix(security): rebuild Windows ACLs from approved SIDs"
```

Confirm no protected runtime files or generated artifacts are staged.

## Task 3: Apply the ACL migration and restore Docker Compose

**Files:**

- Runtime metadata only: `.env`, `config/auth`, `config/backups`, `config/certs`, `config/lpr`, `lpr-data`
- No tracked content changes expected

Run all Task 3 commands from `D:\BPP-VMS\frigate-nvr` in the current non-elevated operator session. Only the two hardening-script child processes are elevated through UAC.

- [ ] **Step 1: Preview the exact live targets in an elevated PowerShell process**

Run the real script with `-WhatIf`, the explicit repository root, and a visible elevated PowerShell process so the operator can approve UAC and review every preview line:

```powershell
$aclScript = (Resolve-Path '.\scripts\harden-windows-acl.ps1').Path
$aclPreview = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $aclScript,
    '-RepositoryRoot', 'D:\BPP-VMS\frigate-nvr', '-WhatIf'
)
if ($aclPreview.ExitCode -ne 0) { throw "Elevated ACL preview failed with exit code $($aclPreview.ExitCode)" }
```

Use an elevated process because the stale descriptor may deny the current medium-integrity token. Verify the preview lists only the six protected roots and their children under `D:\BPP-VMS\frigate-nvr`.

- [ ] **Step 2: Apply the replacement ACLs in an elevated process**

```powershell
$aclApply = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $aclScript,
    '-RepositoryRoot', 'D:\BPP-VMS\frigate-nvr'
)
if ($aclApply.ExitCode -ne 0) { throw "Elevated ACL apply failed with exit code $($aclApply.ExitCode)" }
```

Expected: `Restricted ACLs applied to sensitive repository runtime paths.` No Windows restart is permitted or required.

- [ ] **Step 3: Verify access from the normal operator token**

```powershell
python -m unittest tests.test_windows_acl -v
docker compose config --quiet
```

Expected: both exit zero. These checks validate metadata/config parsing only; do not display `.env` or protected file contents.

- [ ] **Step 4: Start the already-built Compose stack**

The image build completed before this plan and the failure occurred during bind-mount container creation, so reuse those images:

```powershell
docker compose up -d --no-build
```

Do not run `down -v`, prune, delete the two `Created` containers, or remove any volume. If Compose reports a remaining access-denied path, inspect only its ACL metadata, add the path to the protected boundary only if justified by the approved design, and add a regression test before changing the script.

- [ ] **Step 5: Validate services and GPU**

```powershell
docker compose ps
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker exec frigate-nvr python3 -m frigate --validate-config
nvidia-smi
docker exec frigate-nvr nvidia-smi
```

Also inspect Frigate's Docker health status with `docker inspect`. Expected: required services are running, Frigate becomes healthy, config validation exits zero, and NVIDIA is visible where the deployment expects it. Poll boundedly while startup health is `starting`; report an actual unhealthy result rather than hiding it.

## Task 4: Document the reusable control and this host recovery

**Files:**

- Modify: `frigate-nvr/docs/security-model.md`
- Modify: `frigate-nvr/docs/operations.md`
- Modify: `frigate-nvr/docs/troubleshooting.md`
- Modify: `frigate-nvr/docs/current-state.md`
- Create: `frigate-nvr/docs/sessions/2026-08-08-orphaned-windows-acl-recovery.md`
- Modify: `frigate-nvr/docs/sessions/README.md`

- [ ] **Step 1: Update the canonical security model**

Document that Windows protected-path DACLs are replacement descriptors, not incremental edits. State the exact default principals (SYSTEM, Administrators, invoking operator), how `-AdditionalPrincipal` is resolved, why raw SID verification is mandatory, and that broad principals and stale/orphaned SIDs fail verification.

- [ ] **Step 2: Update operations and troubleshooting**

In `operations.md`, document preview/apply/verify commands with explicit `-RepositoryRoot`, elevation expectations, and the no-restart behavior. In `troubleshooting.md`, add the Docker bind-mount symptom (`Access is denied` during container creation), the stale Windows SID cause after account/machine migration, safe diagnosis through ACL metadata, and the script-based repair. Explicitly forbid broad ACL grants as a workaround.

- [ ] **Step 3: Record current state and session evidence**

Update `current-state.md` with the final ACL control and actual Compose/health/GPU outcome from Task 3. Create the session log using the repository template with goal, starting state, work performed, decisions, problems found, validation, files changed, remaining work, and documentation impact. Do not include credentials, file contents, tokens, passwords, private keys, or sensitive environment values.

- [ ] **Step 4: Link the new session log**

Add `2026-08-08-orphaned-windows-acl-recovery.md` under “Session logs in this folder” in `docs/sessions/README.md`, preserving the file's existing encoding and formatting.

- [ ] **Step 5: Review and commit documentation**

Run these Git commands from `D:\BPP-VMS`:

```powershell
git -c safe.directory=D:/BPP-VMS diff -- frigate-nvr/docs
git -c safe.directory=D:/BPP-VMS diff --check
git -c safe.directory=D:/BPP-VMS add frigate-nvr/docs/security-model.md frigate-nvr/docs/operations.md frigate-nvr/docs/troubleshooting.md frigate-nvr/docs/current-state.md frigate-nvr/docs/sessions/2026-08-08-orphaned-windows-acl-recovery.md frigate-nvr/docs/sessions/README.md
git -c safe.directory=D:/BPP-VMS commit -m "docs: record orphaned Windows ACL recovery"
```

## Task 5: Run mandatory verification and hand off

**Files:**

- Verify only; no planned file changes

- [ ] **Step 1: Run every repository-mandated backend suite**

From `D:\BPP-VMS\frigate-nvr`:

```powershell
$env:PYTHONPATH='auth-service'
python -m pytest -q auth-service/tests
$authTestsExit = $LASTEXITCODE
Remove-Item Env:PYTHONPATH
if ($authTestsExit -ne 0) { throw "auth-service tests failed with exit code $authTestsExit" }

python -m unittest discover -s watchlist-api/tests -v

$env:PYTHONPATH='config-api'
python -m pytest -q config-api/tests
$configApiTestsExit = $LASTEXITCODE
Remove-Item Env:PYTHONPATH
if ($configApiTestsExit -ne 0) { throw "config-api tests failed with exit code $configApiTestsExit" }

python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
```

Run each command independently and preserve its exit code. If a suite fails, use `superpowers:systematic-debugging`; do not call the task complete based only on the ACL tests.

- [ ] **Step 2: Run the mandatory browser suite**

```powershell
npm ci
npm run test:browser
```

Expected: both exit zero. Do not stage `node_modules`, reports, caches, screenshots, or other generated artifacts.

- [ ] **Step 3: Recheck deployment and security invariants**

```powershell
docker compose config --quiet
python -m unittest tests.test_windows_acl -v
docker compose ps
docker inspect --format '{{json .State.Health}}' frigate-nvr
docker exec frigate-nvr python3 -m frigate --validate-config
docker exec frigate-nvr nvidia-smi
git -c safe.directory=D:/BPP-VMS diff --check
git -c safe.directory=D:/BPP-VMS status --short
```

Expected: configuration valid, ACL tests pass, required containers running, Frigate healthy, GPU visible, and only intentional commits/known ignored runtime artifacts present.

- [ ] **Step 4: Review comments, docs, and secret hygiene**

Inspect every modified code block for the required explanatory comment/docstring. Confirm the five canonical/session documentation surfaces are updated consistently. Inspect staged/tracked paths—not protected contents—for accidental `.env`, credential, database, recording, model, cache, or generated-output inclusion.

- [ ] **Step 5: Report the outcome with fresh evidence**

Use `superpowers:verification-before-completion` before claiming success. Report separately:

- ACL migration result and approved SID set;
- Docker Compose service and health state;
- Frigate config validation;
- NVIDIA visibility;
- mandatory test counts/results;
- commits created;
- confirmation that Windows was not restarted;
- any remaining blocker with its exact non-secret error.
