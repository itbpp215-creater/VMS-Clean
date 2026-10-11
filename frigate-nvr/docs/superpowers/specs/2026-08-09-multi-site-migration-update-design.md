# Multi-Site Migration and Offline Update Design

**Status:** Approved on 2026-08-09

## Problem

The production BPP-VMS host must be converted into a reusable Windows 10/11
migration package that can install multiple independent nodes. Some nodes will
eventually use the source camera set and some will use new camera sets. Every
node must initially receive the same users, roles, authentication audit history,
Watchlist, and text-only LPR history, while runtime media and Frigate event
history must not move.

The existing `scripts/migrate-machine.ps1` is not suitable for this use case. It
always encrypts its payload, treats one destination as a direct machine clone,
copies the source JWT boundary, excludes the whole `storage` tree as one coarse
unit, and does not provide multi-site provisioning or versioned rollback-safe
updates. The existing wrapper scripts also contain hard-coded paths and a
hard-coded migration password. A new package and lifecycle are required rather
than another invocation of the legacy encrypted migration flow.

The target nodes will start as local-only systems. They will be administered by
the owner, who downloads packages manually from a private Google Drive folder,
accepts one Windows UAC prompt, and runs the installer or updater. Central
synchronization and automated remote delivery are deferred.

## Goals

- Create an unencrypted, fully verified
  `D:\BPP-VMS-Migration-Package\BPP-VMS-FullBackup.tar` release at `v1.0.0`.
- Install to a new, empty `D:\BPP-VMS\frigate-nvr` on supported Windows 10 or
  Windows 11 hosts with NVIDIA RTX 3060 6 GB through RTX 5060 Ti 16 GB GPUs.
- Support both a disabled source-camera clone and a clean new-site profile.
- Preserve users, password hashes, roles, authentication audit records,
  Watchlist data, text-only LPR history, approved configuration backups, and
  NAS configuration.
- Generate a new site identity, node identity, Compose identity, local TLS
  certificate, JWT boundary, and internal capability secrets on every node.
- Start BPP-VMS automatically after the owner signs in and Docker Desktop is
  ready.
- Provide self-contained semantic-versioned update bundles that can jump from
  any earlier installed release, preserve site state, and roll back on failure.
- Retain three successful rollback generations per target node.
- Keep the source stack stopped for the entire export and verification window;
  start it again only after every required check succeeds.
- Preserve the existing encrypted archive as an untouched fallback.

## Non-goals

- Do not copy camera recordings, event clips, snapshots, thumbnails, LPR crop
  images, exports, or any other runtime-captured image or video.
- Do not copy the active Frigate event database or legacy `config/backup.db`.
- Do not copy Git metadata/history, linked worktrees, virtual environments,
  `node_modules`, caches, build cache, or CUDA cache.
- Do not copy the source DuckDNS token, ACME account, public-domain
  certificate/private key, Telegram or Discord credentials, old JWT key,
  browser sessions, or one-time credential files.
- Do not install Docker Desktop, WSL2, Windows updates, or NVIDIA drivers.
- Do not synchronize nodes or automatically download from Google Drive in this
  release.
- Do not cryptographically sign update bundles. The owner explicitly selected
  private manual distribution plus SHA-256 integrity checks.
- Do not overwrite a non-empty target `D:\BPP-VMS`.

## Considered approaches

### 1. Direct whole-machine clone -- rejected

A direct copy is simple but carries machine identity, JWT material, public DNS
state, active camera state, and site-specific integration credentials to every
host. It creates collisions and cannot safely update nodes with different
camera configurations.

### 2. Immutable release plus separately managed site state -- selected

The release contains application code, Docker images, models, approved seed
data, profile inputs, and lifecycle tools. Installation creates a distinct
machine boundary and update changes only versioned application components.
Site-owned state is explicitly preserved or migrated. This supports multiple
sites, offline installation, controlled updates, and rollback.

### 3. Docker Desktop/WSL disk clone -- rejected

A VM-disk clone would be large, coupled to the source Docker Desktop and GPU
state, difficult to audit for excluded media, and unsuitable for hosts that
need different cameras and identities.

## Release artifacts

The migration directory contains:

- `BPP-VMS-FullBackup.tar` -- unencrypted `v1.0.0` release payload.
- `Install_BPP-VMS.bat` -- elevated one-click installation launcher.
- `Update_BPP-VMS.bat` -- elevated one-click update launcher.
- `Verify_BPP-VMS.bat` -- non-destructive release verification launcher.
- `BPP-VMS-FullBackup.tar.sha256` -- outer archive digest.
- `manifest.json` -- version, source commit, scope, image IDs, required disk
  space, file digests, and schema compatibility.
- A Thai installation, recovery, and update guide.

The existing `BPP-VMS-FullBackup.tar.enc` remains unchanged. A new release is
assembled as a partial/staging artifact and is moved atomically to the final
`.tar` name only after full verification. An existing `.tar` may be replaced
only at that final atomic promotion step.

Future updates are named `BPP-VMS-Update-vMAJOR.MINOR.PATCH.tar`. Every
production update is self-contained and carries all application files and
Docker images required by that version so a node can skip intermediate
releases.

## Payload scope

### Included application material

- Maintained application source, scripts, Docker/Compose definitions, static UI
  assets, documentation needed by operators, and configuration templates.
- All resolved Docker images required by the release.
- The reviewed ONNX detector model and the two reviewed LPR models.
- Branding images, icons, maps, and other static assets required by the UI.
- Configuration backups that do not contain Frigate event databases.
- Update-builder and target update/rollback tooling.

### Included seed and recovery state

- The active authentication database with users, password hashes, roles, active
  state, and audit records, but without `secret.key`, session material, or
  `*.once` credential files.
- `config/lpr/watchlist.db`, including Watchlist records and text LPR history.
- Active `nas-storage` and `nas-bot-data` volume content plus source NAS
  configuration.
- Approved root recovery material from `D:\BPP-VMS\backup`, excluding embedded
  `.git` directories and Git logs.
- The inactive pre/post-auth-restore volume copies in a non-active
  `recovery-archive`, scrubbed to exclude JWT keys, browser/session material,
  and one-time credential files.
- A clone-profile environment seed that retains camera credentials and NAS
  configuration but excludes identity and external-integration secrets.

Recovery-only data is never imported as the active database automatically.

### Explicit exclusions

- `storage/**`, currently containing recordings, event MP4 files, JPEGs, WebP
  images, exports, and caches.
- `lpr-data/**`, currently containing runtime LPR JPEG crops.
- The active `frigate-db` Docker volume and `config/backup.db`.
- `.git/**`, `.worktrees/**`, `node_modules/**`, `.venv/**`, Python caches,
  test caches, generated logs/dumps, temporary files, and build caches.
- `cuda-cache` and hardware-specific GPU runtime cache.
- Source ACME state, DuckDNS token/subdomain identity, public certificate and
  private key.
- Telegram bot token/chat ID, Discord bot token/webhook, and any other bot
  credential. These fields start empty on every node.
- Source JWT key, browser sessions, and one-time credential handoff files.

Static application images remain included. The media exclusion applies only to
images and video captured by cameras or LPR runtime processing.

## Site and secret boundaries

Every installation asks for a human-readable site name and creates an opaque,
globally unique node ID. The Windows hostname is recorded as metadata but is not
used as the sole identity. The installer derives a valid per-node Compose
project name so Docker resources cannot accidentally inherit the source host's
identity.

Every node generates new values for:

- the persisted JWT signing key, invalidating source browser sessions while
  retaining usernames, password hashes, roles, and audit records;
- `AUTH_AUDIT_SHARED_SECRET`;
- `WATCHLIST_PROXY_SHARED_SECRET`;
- `WATCHLIST_SERVICE_SHARED_SECRET`;
- local HTTPS private key and certificate;
- node and Compose identities.

`WATCHLIST_FEDERATION_SHARED_SECRET` remains empty until the later federation
and synchronization design. DuckDNS, ACME, Telegram, and Discord remain
disabled and unconfigured. Their supported configuration surfaces remain in
the application so each node can be configured later without rebuilding it.

NAS configuration is cloned as requested. Bot tokens are not considered NAS
configuration and remain empty.

The unencrypted TAR still contains source camera credentials for clone mode,
password hashes, Watchlist records, LPR history, and audit data. It is therefore
a high-sensitivity artifact and must remain in storage controlled by the owner.
SHA-256 detects corruption or an unexpected byte change but does not prove who
created a package if an attacker can replace both the package and checksum.

## Installer workflow

`Install_BPP-VMS.bat` relaunches the reviewed PowerShell worker with UAC and no
secret command-line arguments. The worker performs these phases:

1. **Preflight.** Verify supported Windows build, WSL2, Docker Desktop/Compose,
   `tar.exe`, PowerShell capabilities, NVIDIA driver, `nvidia-smi`, Docker GPU
   access, free disk space, release manifest, and outer/inner SHA-256 values.
2. **Destination guard.** Refuse any non-empty `D:\BPP-VMS`; never offer a
   destructive overwrite shortcut.
3. **Identity input.** Ask for the site name and enumerate likely LAN IPv4
   addresses for explicit owner selection and confirmation.
4. **Profile input.** Select either disabled source-camera clone or clean new
   site.
5. **Staging.** Extract and verify to a temporary directory before writing the
   destination.
6. **Application install.** Copy the immutable application release, load Docker
   images, create site metadata, and construct a site-local `.env`.
7. **State import.** Restore accounts/audit, Watchlist/LPR text history, NAS
   state, and approved configuration. Generate new secret boundaries.
8. **Profile transformation.** Clone mode retains source camera definitions and
   credentials but forces every camera, detector, and recording toggle off.
   New-site mode contains no camera definitions or source camera credentials;
   cameras are added later through Dashboard.
9. **Local TLS.** Generate a self-signed certificate whose subject alternative
   name covers the selected LAN IP. Configure Dashboard as
   `https://<selected-ip>` without enabling public DNS or ACME. Browsers on
   other client devices may require explicit trust installation or show the
   expected self-signed warning.
10. **Create and validate.** Validate Compose, create volumes/containers, import
    state before first service start, apply the narrow Windows ACL policy, start
    the local-only stack, validate Frigate configuration, and check every
    required health endpoint and GPU path.
11. **Autostart.** Create a Scheduled Task triggered after the installing owner
    signs in. It starts/waits for Docker Desktop, starts the Compose project, and
    reports health. It does not claim true pre-login WSL2 startup. The owner will
    sign in remotely after Windows reboots and may disconnect without signing
    out.
12. **Report.** Record release version, node/site identity, selected IP, local
    URL, installed image IDs, health results, and integrations/cameras that
    remain disabled. Never record secret values.

An installation failure never reports success or starts a partially restored
stack. The destination remains diagnosable and the report identifies the failed
phase without printing secrets.

## Source export workflow

The source exporter first records the exact set of running Compose services,
validates prerequisites, resolves every inclusion/exclusion path, checks
available space, and prepares a staging directory outside the source tree. It
then stops the complete Compose stack and keeps it stopped through collection,
Docker image export, TAR assembly, readback, test extraction, content audit,
and checksum verification.

If any export or verification step fails, the stack remains stopped. The
operator/agent fixes the issue and resumes or repeats the failed phase until all
checks pass. Services are restarted only after the final archive and companion
artifacts pass every acceptance check. Only services that were running before
export are restarted, followed by Frigate config validation, GPU inspection,
and stack health verification.

This deliberate failure policy differs from target updates: source backup
failure prioritizes obtaining one verified snapshot before writers resume.

## Update builder

Production releases use Semantic Versioning starting at `v1.0.0`:

- patch for compatible bug fixes;
- minor for backward-compatible features;
- major for a breaking lifecycle or state-schema change.

The production builder refuses to run unless:

- the repository is on `main`;
- the tracked and untracked release-relevant working tree is clean;
- the requested version is greater than the recorded production version;
- required tests, config validation, and release checks pass;
- every changed persistent-state schema has a reviewed migration and rollback
  strategy.

The manifest records source commit, release version, schema versions, image IDs,
file hashes, migrations, required free space, compatibility rules, and release
notes. A non-main branch may create only an explicitly labelled development
package; target production install requires a conspicuous override to accept it.

The owner uploads production update TARs to a private Google Drive folder and
downloads them manually on each target. Automatic polling, Drive OAuth/service
accounts, public links, and central rollout are deferred.

## Target update and rollback workflow

`Update_BPP-VMS.bat` requests UAC and performs:

1. Verify package/manifest hashes, semantic version, source/target schema
   compatibility, current health, free space, and target identity.
2. Capture a consistent rollback snapshot of versioned application files,
   site configuration, mutable databases/volumes affected by migrations, local
   image references, and service state.
3. Stop the site stack.
4. Load the new self-contained image set and stage the new application release.
5. Apply reviewed merge migrations to site configuration and databases. Never
   replace `.env`, local TLS, node identity, camera definitions, camera on/off
   state, accounts/audit, Watchlist/LPR history, NAS settings/state, bot/public
   integration choices, or media recorded after installation.
6. Validate Compose, configuration, TLS, GPU access, state schemas, and required
   health endpoints.
7. Promote and start the new version only after all checks pass. Retain three
   successful rollback generations and prune older generations only after the
   new release is healthy.

If any update or post-update health check fails, restore application files,
images, configuration, and migrated databases from the captured snapshot, then
start and validate the previous version automatically. The failure report must
state whether rollback and old-version health succeeded. Unlike source export,
a target update failure prioritizes restoring service immediately.

## Error handling and safety invariants

- Caller-supplied paths are canonicalized and constrained to expected roots.
- Recursive deletion is limited to tool-created staging paths with strict name
  guards; no user-selected root is recursively deleted.
- Final archive and release promotion are atomic.
- TAR entries are rejected for absolute paths, drive prefixes, traversal, or
  link behavior that can escape extraction roots.
- All manifests use explicit schemas and reject unknown required fields or
  unsupported versions.
- Secret values are never written to stdout, logs, reports, manifests, command
  lines, Markdown, or checksums-by-path reports exposed to unauthorized users.
- Sensitive destination paths receive the existing narrow Windows ACL policy.
- Database and config copies occur only while writers are quiesced.
- Frigate media/event exclusions are content-audited after test extraction.
- Update retention deletes only a verified rollback generation older than the
  three successful retained generations.
- No installer/update path modifies a non-empty unknown destination.

## Baseline defects included in scope

The clean branch baseline was measured before this design document was added:

- Watchlist 9/9, Config API 39/39, Config Validator 2/2, and LPR 11/11 passed.
- Auth passed 30/31; local TLS generation calls POSIX-only `os.fchmod` and leaks
  an open temporary handle on the Windows error path.
- Root tests passed 20/31. Existing failures include absent installer release
  sources in a clean Git checkout, a migration password/security expectation
  mismatch, stale `_hd` stream ownership expectations, protected-path tests that
  assume a production `.env` exists in a worktree, and related release/security
  drift.
- Browser baseline could not run because `npm` is not installed on the host
  PATH; only a bundled Node executable and the production dependency tree are
  currently available.

The implementation must repair migration/installer/TLS/release tests and make
the clean-worktree test strategy valid. Tests that legitimately require
production-only secrets or ACLs must use safe fixtures or be clearly separated
from portable repository tests. Current valid `_hd` streams must be recognized
rather than removed. Required browser dependencies must be provisioned through
a reproducible supported command before final verification.

## Testing and acceptance

### Automated coverage

- Unit tests for inclusion/exclusion rules, manifest validation, safe path
  handling, profile transformations, secret regeneration, camera disabling,
  checksum failures, and version rules.
- Fixture-based export/import tests proving account/password-hash/role/audit,
  Watchlist, text LPR history, NAS state, and recovery archive behavior.
- Assertions that no runtime media, LPR crops, Frigate event database, Git
  metadata, source identity secret, or one-time credential enters a release.
- Windows tests for local IP SAN certificate generation and ACL application.
- Installer tests for empty-destination refusal, source-clone and new-site
  profiles, local-only services, generated node identity, and autostart task.
- Update tests covering state preservation, successful migrations, a forced
  health-check failure, full rollback, previous-version restart, and retention
  pruning at three successful generations.
- Existing Python/repository suites and browser smoke tests from `CLAUDE.md`.

### Release verification

- Validate Compose and Frigate configuration before source shutdown.
- Read the completed TAR from beginning to end.
- List and path-audit every TAR entry.
- Extract the full archive to a fresh temporary directory.
- Recompute and compare every manifest digest.
- Verify Docker image bundle structure and recorded image IDs.
- Verify all required models, databases, installer/updater files, and companion
  documentation.
- Run a post-extraction forbidden-content audit.
- Verify the production source stack starts with its prior service set and is
  healthy only after all archive checks pass.

Local dry runs and full archive extraction prove package integrity but do not
prove every target host condition. Final end-to-end migration acceptance occurs
on the first real target: preflight, install, login, local HTTPS, GPU/config
validation, all required service health, camera-disabled state, preserved seed
data, reboot/sign-in autostart, one successful update, and one forced rollback.

## Documentation impact

- `docs/current-state.md`: record the release/update baseline and actual
  production deployment status without claiming untested target rollout.
- `docs/architecture.md`: describe immutable application release versus
  site-owned state, node identity, installation, and update/rollback flows.
- `docs/operations.md`: add package creation, target installation, private Drive
  distribution, update, rollback, autostart, and recovery procedures.
- `docs/security-model.md`: document unencrypted high-sensitivity artifacts,
  per-node secrets, SHA-only trust limitation, local TLS, and excluded source
  identities.
- `docs/features/installation-and-account-migration.md`: describe both install
  profiles and preserved account/audit behavior.
- A dedicated update owner document under `docs/features/` and links from both
  documentation indexes.
- `docs/troubleshooting.md`: cover preflight, Docker-after-login, TLS, GPU,
  archive verification, update, and rollback failures.
- `docs/history.md`: record the multi-site packaging/update milestone after
  verified completion.
- `docs/sessions/`: capture implementation, baseline defects, validation,
  production export, and first-target acceptance status.
- An ADR for immutable releases with separate site state and manual private
  Drive distribution.

## Deployment phases

1. Implement and test lifecycle tooling in the isolated branch/worktree.
2. Repair the relevant clean-baseline defects and pass required portable tests.
3. Review documentation and merge the approved release implementation to
   `main` without touching production runtime state.
4. Validate production configuration and prerequisites.
5. Stop the source stack and create/fully verify `v1.0.0`; keep it stopped across
   any retry until success, then restart and health-check it.
6. Retain the old encrypted archive and transfer the new unencrypted release
   only through owner-controlled storage.
7. Complete first-target installation and update/rollback acceptance before
   declaring cross-machine migration fully verified.

## Approved decisions summary

- Architecture: immutable release plus separately managed site state.
- Release: unencrypted TAR, `v1.0.0`, Docker images included, old `.enc` retained.
- Media: no camera/LPR runtime image or video and no Frigate event history.
- Identity: accounts/audit preserved; JWT, node, Compose, TLS, and internal
  capability secrets regenerated per node.
- Profiles: source cameras cloned but all disabled, or clean camera-free site.
- Integrations: NAS cloned; DuckDNS/ACME surfaces retained but unconfigured;
  Telegram/Discord and Federation secrets empty.
- Updates: manual private Google Drive download, one-click UAC install,
  self-contained releases, site-state-preserving migrations, automatic rollback,
  and three retained rollback generations.
- Source failure policy: remain stopped and continue until the archive passes.
- Target update failure policy: rollback and restore the prior healthy release.
