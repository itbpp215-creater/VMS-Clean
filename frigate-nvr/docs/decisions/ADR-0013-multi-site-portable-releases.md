# ADR-0013: Manifest-driven multi-site migration and offline updates

- Status: Accepted
- Date: 2026-08-09

## Context

One source deployment must seed multiple Windows GPU sites. Some targets reuse the
same cameras, some use different cameras, and each site must be locally usable
before future synchronization exists. Copying the former full-host encrypted
archive would clone JWT/TLS/DuckDNS/Federation identity and runtime media, while a
source-only installer would lose users, Watchlist and NAS state. Sites also need a
manual Google Drive update path that does not overwrite local configuration.

## Decision

Use one canonical release policy and manifest-driven lifecycle tools. A v1 migration
TAR contains allowlisted application/models/images and approved state, with separate
disabled Clone and empty-camera NewSite profiles. Target identity and local IP TLS
are always generated per node. DuckDNS/ACME remain installed behind an inactive
`public-edge` Compose profile.

Updates are complete, versioned TARs. Release-owned paths and site-owned paths are
separate. Update promotion snapshots the prior release, changes only manifest-listed
release files, validates health, and automatically restores/starts the prior release
on failure. Three successful rollback generations are kept.

The owner explicitly chose an unencrypted migration TAR and SHA-256 integrity without
a signing key. The existing encrypted complete-host workflow remains available as a
different legacy use case; it is not the implementation behind multi-site v1.

## Alternatives considered

1. Clone the encrypted complete host to every site — rejected because it transfers
   source JWT/TLS/public-edge identity, Frigate history and media.
2. Use Git pull on every target — rejected because targets require offline Docker
   images and site state must not be merged or reset by Git.
3. Centralize all sites before local rollout — deferred because local independence
   is required first and Federation/sync trust is not yet provisioned.
4. Digitally sign every release — not selected by the owner; SHA-256 detects transfer
   corruption/tampering but does not authenticate publisher identity.

## Consequences

- Every node has independent identity, secrets, TLS and Compose volumes.
- Clone targets cannot contact/record source cameras until an operator enables them.
- Google Drive can distribute version folders, but access control and out-of-band
  version confirmation remain important because artifacts are unsigned.
- Source failure after quiescence deliberately causes downtime until the archive
  verifies; target update failure favors restoring availability of the old release.
- True pre-login startup is not promised for Docker Desktop WSL2.

## Validation

- Portable fixture suites exercise policy/path/TAR guards, profile isolation,
  readback hashes, installer retry, per-node TLS, update state preservation,
  rollback and three-generation pruning.
- Production TAR creation and first-target GPU installation remain explicit live
  release gates.

## Revisit when

- cross-site Federation/synchronization is designed,
- an organization signing/KMS service is available,
- Docker Desktop supports an approved pre-login engine mode, or
- target state schemas require real apply/rollback migrations.

## Related

- [`../features/multi-site-releases.md`](../features/multi-site-releases.md)
- [`../operations.md`](../operations.md)
- [`../security-model.md`](../security-model.md)
- [`ADR-0012-complete-machine-migration-archive.md`](ADR-0012-complete-machine-migration-archive.md)
