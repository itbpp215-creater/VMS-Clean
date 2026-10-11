# ADR-0011: GUI installation and encrypted account migration

- Status: Accepted
- Date: 2026-08-02

## Context

New-camp setup previously used console prompts in the package's current folder
and generated a one-time administrator password. Operators need to choose a local
installation folder, choose the first administrator credentials, and retain the
ability for current local users to sign in on a new machine. Authentication stores
only bcrypt hashes in Docker's named `auth-db` volume, so original plaintext
passwords cannot and must not be exported.

## Decision

Use a Windows Forms EXE as the GUI front end and keep deployment work in reviewed
PowerShell/Python source. Form values containing secrets cross to the worker on
redirected standard input, never as command-line arguments. The worker stages,
hash-verifies, and relocates only manifest-listed package files to a new local
folder before provisioning Docker.

The GUI creates a chosen active administrator through a management command that
operates only on an empty auth database. Existing users are transferred through a
separate AES-256-GCM/scrypt-encrypted `.bppusers` file containing only username,
bcrypt hash, role, and active flag. Import and new-admin creation occur in one
SQLite transaction. The target creates a new JWT signing key, invalidating sessions
from the source machine while preserving password-based login for imported users.

## Alternatives considered

1. Pass passwords as EXE/PowerShell parameters — rejected because process command
   lines can be observed and retained by tooling.
2. Copy `auth.db` and `secret.key` directly — rejected because it transfers
   sessions, login-attempt history, audit records, and signing material.
3. Include account data inside every installer ZIP — rejected because package
   manifests are transferable release artifacts, not per-site secret containers.
4. Replace the old user database — rejected because existing accounts would lose
   access or require password resets.

## Consequences

- A complete package remains mandatory, but the installed system can live in an
  operator-selected local folder.
- The GUI-selected admin and imported users appear in existing Dashboard user/RBAC
  management without a separate account store.
- Operators must protect a migration password and separately transfer/delete the
  encrypted export file according to local policy.
- New GUI deployments use a deterministic path-derived `COMPOSE_PROJECT_NAME`
  suffix, isolating named volumes for distinct installation folders on the same
  Docker host. Earlier `bpp-vms` GUI attempts remain resumable; existing
  deployments otherwise retain their project identity unless deliberately migrated.

## Validation

- Unit tests cover encrypted round-trip, tamper/wrong-password rejection, and
  malformed migration records.
- Auth tests cover import with an existing user password and duplicate admin-name
  rejection.
- Static installer tests cover GUI stdin handling, UAC manifest, relocation, and
  migration command wiring.
- A clean-host Docker installation and source-to-target account export/import are
  still required release-gate checks when Docker Desktop is available.

## Related

- `../features/installation-and-account-migration.md`
- `../operations.md`
- `../security-model.md`
- `ADR-0010-verified-new-camp-package.md`
