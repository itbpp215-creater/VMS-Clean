# ADR-0010: Verified new-camp installation package

- Status: Accepted
- Date: 2026-08-02

## Context

The former `install_new_camp.exe` was a small wrapper with no maintained source in
the repository. It checked an obsolete LPR model directory, expected a missing
Frigate storage patch, and attempted to retrieve the one-time administrator
credential from a host path that is not mounted by the named `auth-db` volume.
The wrapper could continue after failed native Docker commands, causing an
apparently successful installation with missing prerequisites or unusable login
credentials.

## Decision

The installer is now maintained as `installer/install_new_camp.ps1`, launched by
a thin, reproducible `install_new_camp.exe` compiled from `installer/Program.cs`.
`installer/build-new-camp-package.ps1` produces a complete transfer directory and
ZIP with a SHA-256 manifest. The installer validates that manifest and all required
runtime assets before creating configuration or invoking Docker.

The package includes the required detector ONNX model at
`frigate-nvr/config/model_cache/yolo11m-640.onnx`, the two required `.pt` runtime
models in `frigate-nvr/LicensePlateRECOG/model/`, the storage threshold patch,
installer source, and runtime configuration. It excludes `.env`, Docker volumes,
recordings, backups, other caches, and all other legacy LPR source files.

The first administrator credential is generated only for an empty auth database.
It is read once directly from the running `auth-service` container's `auth-db`
volume, displayed to the local operator, and deleted only after the operator types
`DELETE`. A deliberate recovery run must supply `-RecoveryUsername`; this path
rotates that named user's password rather than silently resetting an existing
administrator.

## Alternatives considered

1. Distribute the EXE alone — rejected because PowerShell source, compose files,
   models, and patches are required at runtime and cannot be integrity checked.
2. Copy credentials through `frigate-nvr/storage/db` — rejected because auth data
   is stored in the Docker named volume and a host plaintext copy expands exposure.
3. Continue on Docker errors and print warnings — rejected because a half-built
   security/video system must be treated as an installation failure.
4. Auto-reset a default admin on every run — rejected because it could silently
   take over an existing deployment.

## Consequences

- Operators transfer the complete `BPP-VMS-New-Camp` directory or its ZIP, not the
  EXE by itself.
- Corruption, incomplete transfer, missing models, and missing patches stop before
  deployment starts.
- The release process gains a reproducible source and manifest verification step.
- Existing installations use explicit recovery mode for password rotation.

## Validation

- Python regression tests cover patch injection and installer-release invariants.
- PowerShell parser validation covers installer, package builder, and deployment
  scripts.
- The package builder verifies required inputs, generates hashes, and its manifest
  can be verified without Docker Desktop.
- A live Docker image build and new-host installation remain required release-gate
  checks when Docker Desktop is available.

## Revisit when

- the installer is migrated away from Windows PowerShell,
- credentials move outside `auth-db`, or
- LPR model packaging becomes a separately versioned artifact.

## Related

- `../operations.md`
- `../features/storage-management.md`
- `ADR-0003-storage-threshold-inside-frigate.md`
- `ADR-0008-server-side-auth-and-federation.md`
