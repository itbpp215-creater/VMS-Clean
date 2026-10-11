# Orphaned Windows ACL Recovery Design

**Status:** Approved on 2026-08-08

## Problem

`scripts/harden-windows-acl.ps1` currently inspects every existing access rule,
translates its identity to a SID, and removes principals that are not approved.
After a Windows installation or repository migration, protected paths can retain
an orphaned SID whose account no longer exists. Windows cannot translate that
identity, `icacls /remove` returns error 1332, exact-ACL verification fails, and
the script stops before hardening the remaining paths.

On the affected production host, Docker Desktop runs as the current operator
with a medium-integrity token. The orphaned ACL state omitted that operator's
current SID from protected directories, so Docker could build images but could
not bind-mount `config/lpr` while creating `watchlist-api`.

## Goals

- Rebuild each protected DACL from the approved SID set without translating or
  preserving any existing access rule.
- Remove inherited, broad, stale, and orphaned access rules recursively.
- Preserve all file contents, runtime databases, models, recordings, and secret
  values; only NTFS access-control metadata may change.
- Keep the operation fail-closed and idempotent.
- Restore Docker Desktop bind-mount access for the approved invoking operator.
- Provide a real Windows regression test that reproduces an orphaned SID.

## Non-goals

- Do not change application business logic, Compose topology, ports, camera
  configuration, AI/LPR behavior, or secret values.
- Do not grant `Everyone`, `Authenticated Users`, or built-in `Users` access.
- Do not run Docker Desktop permanently as Administrator.
- Do not reset protected paths to inherited permissions, even temporarily.

## Considered approaches

### 1. Construct a fresh DACL from approved SIDs — selected

Create a new `FileSecurity` or `DirectorySecurity` descriptor for each item,
disable inheritance without copying inherited rules, add full-control rules for
SYSTEM, local Administrators, the invoking operator, and explicit additional
principals, then apply that descriptor. Verification reads the resulting rules
as SIDs and requires an exact set match.

This approach never needs to translate an existing orphaned identity and never
creates a window with broad inherited access.

### 2. Run `icacls /reset`, then apply restricted grants — rejected

This removes orphaned entries but temporarily restores inherited permissions.
On the current repository root those inherited permissions include broad local
access, which is unacceptable for secrets and personal data.

### 3. Retain the stale SID and add the current operator — rejected

This makes Docker work on one host but violates the exact-principal policy,
leaves migration debris in place, and cannot guarantee future account isolation.

## Architecture and data flow

The public script interface remains unchanged:

- `-RepositoryRoot` selects the guarded repository root.
- `-AdditionalPrincipal` resolves approved account names to SIDs before any ACL
  mutation begins.
- `-WhatIf` previews every target without changing permissions.

Before mutation, the script resolves the repository root, validates that every
target remains inside it, resolves all principals, and enumerates the existing
protected trees. For each file or directory, a helper constructs a new DACL from
only the prevalidated SID list and applies it. A second helper reads the applied
DACL and verifies that inheritance is disabled and the final SID set is exact.

The protected paths remain:

- `.env`
- `config/auth`
- `config/backups`
- `config/certs`
- `config/lpr`
- `lpr-data`

Missing `config/backups` is created before target enumeration, matching current
behavior. Other missing protected paths remain warnings rather than failures.

## Error handling and safety

- Principal resolution happens before the first ACL write, so an invalid
  `-AdditionalPrincipal` cannot leave a partially changed tree.
- Path containment is checked before mutation; targets outside the resolved
  repository root are refused.
- Each item receives a complete restricted DACL in one access-control update.
- Each item is verified immediately after application. Any mismatch stops the
  script with the failing path in the error message.
- A later failure can leave earlier items correctly hardened, but rerunning the
  script is safe because the operation is idempotent.
- Existing owners, file contents, and non-DACL metadata are not intentionally
  changed.

## Testing

Extend `tests/test_windows_acl.py` with a Windows-only behavioral regression:

1. Create a temporary repository-shaped tree containing every protected path
   and nested child files.
2. Give those items an access rule for a synthetic orphaned SID.
3. Invoke the real hardening script against the temporary root.
4. Assert successful exit, disabled inheritance, removal of the orphaned SID,
   and exact presence of SYSTEM, Administrators, and the invoking operator on
   every item.
5. Run the script a second time to prove idempotency.

Retain the static coverage test and the production-host broad/inherited ACL audit.
The new regression must fail against the current implementation before production
code changes are made.

## Documentation impact

- `docs/security-model.md`: describe fresh-DACL replacement and orphaned-SID
  handling.
- `docs/operations.md`: document safe use after Windows/repository migration.
- `docs/troubleshooting.md`: record the Docker bind-mount symptom, root cause,
  and recovery procedure.
- `docs/current-state.md`: record the reconciled production ACL state after the
  host migration succeeds.
- `docs/sessions/`: record diagnosis, tests, deployment results, and remaining
  operational work.

## Deployment and verification

After tests pass, run the script with `-WhatIf`, then apply it as the approved
Windows operator. Verify protected paths contain only the approved SIDs without
reading secret contents. Confirm a non-elevated `docker compose config --quiet`
can read the machine-local environment, run `docker compose up -d`, validate the
Frigate configuration, inspect container health, and check `nvidia-smi`.

No Windows restart is required. Existing `Created` containers may be reused by
Compose; no runtime database or volume deletion is part of this design.
