# ADR-0012: Complete-machine migration archive without the GUI installer

- Status: Accepted
- Date: 2026-08-02

## Context

The verified new-camp package intentionally creates a fresh installation and can
transfer only user password hashes through a `.bppusers` file. Operators also need
a supported way to replace an existing Windows host while retaining the complete
local system state, including existing authentication/JWT identity, runtime
databases, local models, TLS material and optionally recordings, without executing
the GUI installer.

Copying the application directory alone is incomplete because `auth-db` and
`frigate-db` are Docker named volumes. Copying Docker Desktop's implementation
directories directly is unsupported and couples the migration to its internal
Windows/WSL layout. A raw disk clone transfers unrelated host state, network
identity, and ACL identities, and makes heterogeneous hardware recovery fragile.

## Decision

Use `scripts/migrate-machine.ps1` with explicit `Export` and `Import` modes. The
source workflow stops Compose for a consistent point-in-time snapshot, copies the
application tree and named Docker volumes through their stopped service containers,
and optionally includes recordings and locally built Docker images. It excludes the
GPU-specific CUDA cache.

The script packages the payload as TAR and encrypts it using a passphrase collected
only through a SecureString console prompt. The envelope uses PBKDF2-derived
AES-256-CBC encryption and HMAC-SHA-256 authentication over the header and
ciphertext. Import authenticates before extracting, requires an elevated session
and an empty destination directory, creates stopped Compose containers, restores
volumes before service startup, reapplies host ACL hardening, then waits for
Frigate health and runs its canonical config validation.

## Alternatives considered

1. Copy only the BPP-VMS folder — rejected because named Docker volumes containing
   users/JWT material and Frigate history would be lost.
2. Copy Docker Desktop internal storage — rejected because its layout is not an
   application interface and is not portable across Docker Desktop versions.
3. Ship all state in the new-camp installer — rejected because release packages
   must remain reusable, cannot embed a site's secrets/recordings, and must create
   a fresh security boundary.
4. Clone the entire Windows disk — rejected as the supported path because it moves
   unrelated host identity/driver state and is unsuitable for different hardware.

## Consequences

- Operators can perform a two-command, no-GUI cutover while retaining accounts,
  passwords, JWT state and selected runtime data.
- The archive contains high-sensitivity secrets and may be very large with images
  or recordings; it requires approved encrypted transfer/storage and deletion after
  verification.
- The source can remain stopped after export for a controlled cutover, or restart
  automatically after snapshot completion.
- The target still needs Docker Desktop and approved NVIDIA driver installed; its
  host/WebRTC IP is intentionally configured after migration.

## Validation

- PowerShell parser validation covers the migration script syntax.
- `-Mode SelfTest` performs an AES/HMAC encryption-decryption byte round trip
  without Docker or production secrets.
- Static repository tests assert volume scope, no command-line passphrase,
  empty-destination protection and ACL-hardening invocation.
- A live source-to-target Docker migration remains a release-gate check on two
  approved GPU-capable Windows hosts.

## Revisit when

- Docker provides a stable first-class volume snapshot/export API,
- migration archives move to an approved organization key-management service, or
- the application no longer persists auth/Frigate state in named Docker volumes.

## Related

- [`../operations.md`](../operations.md)
- [`../features/installation-and-account-migration.md`](../features/installation-and-account-migration.md)
- [`../security-model.md`](../security-model.md)
- [`ADR-0011-gui-installation-and-encrypted-account-migration.md`](ADR-0011-gui-installation-and-encrypted-account-migration.md)
