# Installation and account migration

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-02
- **Evidence:** `installer/Program.cs`, `installer/install_new_camp.ps1`, `auth-service/manage.py`, `auth-service/auth_migration.py`

## GUI installation

`install_new_camp.exe` is a Windows Forms wizard distributed only inside the
complete manifest-verified `BPP-VMS-New-Camp` package. It requests UAC elevation,
lets an operator choose a new local installation directory, accepts camera and
Federation settings, and creates a selected Web Admin account. Secrets are sent to
the PowerShell worker through redirected standard input, never in command-line
arguments, logs, the manifest, or `.env.example`.

The worker copies only manifest-listed files into a sibling staging directory,
verifies hashes, then moves the result to the chosen installation root. It rejects
network paths, package-source paths, existing target paths, and drives with less
than 1 GB available. A fresh GUI installation writes a deterministic, path-derived
`COMPOSE_PROJECT_NAME` suffix, keeping Docker named volumes separate when multiple
test destinations exist on one Docker host while keeping the same destination
stable across retries.

Because release packages never transfer TLS private keys, the installer creates a
local self-signed certificate in `config/certs/` only when both Dashboard PEM
files are absent. It preserves a complete organization-provided pair and refuses
an incomplete pair. Browsers will require a one-time trust exception until the
site replaces the self-signed certificate with its approved PKI material.

If deployment is interrupted after package copy but before services start, selecting
the same folder resumes it. The worker requires the GUI Compose project name,
`.env`, a package manifest, and absence of Compose containers; it then refreshes
release files while preserving `.env` and the auth volume. A stale or incomplete
prior release is repaired from the verified source package after these safety
checks. It refuses any folder with Compose containers, so an active or manually
stopped installation cannot be overwritten by the resume path. Resume retains the
already-provisioned selected administrator rather than attempting a second
database initialization. It also retains the prior `.env` unchanged, preventing
form defaults or a blank Federation secret from changing machine-local settings.

For a first deployment, the Compose service lookup treats Docker's empty output as
an empty container ID. This lets a brand-new installation proceed to image build
instead of incorrectly treating the absence of an existing Frigate container as a
PowerShell error.

The selected Web Admin account is written directly to the empty `auth-db` volume
as a bcrypt hash. It is an active `admin` and therefore appears automatically in
Dashboard **จัดการผู้ใช้งานและสิทธิ์**, which lists the same `users` table used by
login and server-side RBAC.

## Account migration

Use **สร้างไฟล์ย้ายผู้ใช้จากเครื่องนี้** on the old machine while Docker Desktop
is running, and select the existing BPP-VMS installation folder that owns its
current Compose project and `auth-db` volume. The export contains only `username`, `password_hash`, `role`, and
`active`; it excludes plaintext passwords, JWT signing material, cookies/sessions,
login-attempt state, and audit records. The file is encrypted with AES-256-GCM and
an scrypt-derived key from an operator-selected migration password.

On the new machine, select the `.bppusers` file and provide the same migration
password. The importer validates the authenticated bundle, bcrypt hash scheme,
username, role, active flag, and duplicate names before making any database write.
It then imports all accounts and creates the new GUI-selected administrator in one
SQLite transaction. A selected admin username cannot collide with an imported one.

Existing users retain their bcrypt hashes, so they can sign in using their existing
passwords. Browser sessions do not migrate because the new machine creates its own
JWT key; all users must sign in again.

## Complete host migration without GUI

`scripts/migrate-machine.ps1` is a separate, administrator-run workflow for moving
an existing BPP-VMS installation to a new Windows host without the GUI installer.
It exports the application tree and preserves the `auth-db` and `frigate-db` Docker
volumes, all machine-local config/secrets/models, LPR data, and optionally Frigate
recordings and current Docker images. The archive is encrypted with a console-only
migration password using PBKDF2-derived AES-256-CBC plus HMAC-SHA-256 authentication.

Unlike `.bppusers`, a complete migration retains the existing JWT signing material
and therefore preserves the current authentication database exactly. It may also
contain camera credentials, Federation secrets, TLS keys, and recordings; it must
be stored and transferred as a high-sensitivity secret artifact. The restore target
must be a new empty application folder. The workflow restores volumes before any
service starts, re-applies Windows ACL hardening for the target host identities,
then validates the started Frigate config. It intentionally does not migrate CUDA
cache or the old host's WebRTC/LAN address.

## Password policy

New or changed passwords require 14–256 characters, at most 72 UTF-8 bytes, and at
least one lower-case letter, upper-case letter, and digit. Existing bcrypt hashes
are not invalidated solely because they were created under an older policy.

## Operational limits

- The package ZIP does not contain account exports; transfer the encrypted
  `.bppusers` file separately.
- The target `auth-db` volume must be empty. The installer refuses to overwrite an
  existing account database.
- The migration password cannot be recovered. Retain it securely until the import
  succeeds, then remove the export file according to local secret-handling policy.
- The selected installation directory stores package/config/media bind mounts;
  Docker named volumes remain managed by Docker Desktop.
- Complete machine migration is a point-in-time cutover, not an ongoing backup or
  synchronization feature; preserve/restore recordings only when the required
  storage and transfer window have been explicitly planned.
