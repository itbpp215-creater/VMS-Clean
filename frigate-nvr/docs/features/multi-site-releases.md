# Multi-site migration releases and offline updates

- **Status:** IMPLEMENTED, production TAR verified; first-target acceptance pending
- **Last reconciled:** 2026-08-09
- **Evidence:** `scripts/release/`, `tests/test_release_*.py`, `release-policy.json`

## Migration release

`New-BppMigrationPackage.ps1` builds the unencrypted `BPP-VMS-FullBackup.tar`
for Windows 10/11 target machines. The source stack is quiesced before state is
collected and is restarted only after TAR listing, extraction, manifest hashes,
required artifacts, and scope checks all pass. Failure after quiescence keeps the
source stopped. The existing encrypted legacy archive/workflow remains separate.

The v1 release retains application/static branding assets, all required AI models,
offline Docker images, `auth.db` (users, password hashes, roles and audit), Watchlist
and text LPR history, NAS state/config, approved config backups, and scrubbed recovery
data. It excludes `storage`, `lpr-data`, Frigate event databases, CUDA/dependency
caches, Git/worktrees, old JWT/session keys, one-time credentials, source TLS/ACME,
DuckDNS, Telegram/Discord, and Federation identity.

## Target profiles

- **Clone:** retains camera definitions/placeholders/credentials and NAS settings,
  but forces every camera, detect, and record toggle off.
- **NewSite:** has no source cameras, go2rtc producers, or camera credentials; it
  retains the reviewed NAS setting for later operator confirmation.

Both profiles clear bot, DuckDNS/ACME, Federation, node, Compose, TLS and internal
shared-secret identity. Installation generates a unique node ID, Compose project,
local shared secrets, auth JWT key, and IP-SAN self-signed TLS pair for each machine.
`docker-compose.site.yml` keeps `duckdns` and `acme` behind the inactive
`public-edge` profile, so the first URL is `https://<new-LAN-IP>`.

## Install and startup behavior

The default target is `D:\BPP-VMS\frigate-nvr`; `D:\BPP-VMS` must be empty. A
tool-marked partial installation may be retried, but an unrelated/non-empty target
is refused. Production preflight checks elevation, Docker Desktop/Compose, NVIDIA
visibility, archive scope and model/state completeness. Services are created only
after images, config, state, TLS and ACLs are ready. Health, Frigate config and GPU
checks must pass before `.bpp-autostart-ready` and the logon Scheduled Task exist.

Docker Desktop WSL2 starts in the signed-in user session. Therefore autostart means:
the selected Windows user logs in, Docker Desktop starts, the Scheduled Task waits
for `docker info`, then starts the local-only Compose stack. Pre-login service start
is not claimed.

## Offline updates

`New-BppUpdatePackage.ps1` creates self-contained semantic-versioned TAR files with
application files and Docker images. Production artifacts require clean `main` and
a version newer than the policy baseline. Development artifacts carry `-dev.<commit>`
and targets reject them unless `-AllowDevelopment` is explicit.

`Update-BppRelease.ps1` never mirror-deletes the installation root. It changes only
manifest-listed release files and preserves site-owned `.env`, camera config,
node identity, site TLS, Watchlist/LPR, NAS, runtime media, local overlay and
autostart marker. Before promotion it snapshots the previous release. A candidate
failure restores old files/metadata and restarts/validates the old service set.
Only the three newest successful rollback generations are retained.

## Integrity and limitations

Every TAR has a SHA-256 companion plus an internal per-file manifest. This detects
incomplete or modified downloads but, by explicit owner decision, there is no
digital signature/key. The migration TAR is intentionally unencrypted and may
contain camera credentials, password hashes and operational state; Google Drive
access and local file permissions are security boundaries. Cross-site Federation
and synchronization remain disabled and are not part of v1.0.0 acceptance.

The release tooling has fixture-driven coverage. The real production v1.0.0 TAR
was built from clean `main` commit `6ad5571`, passed full readback/hash/scope
verification, and the source stack passed post-restore health/config/GPU/HTTPS.
The first clean GPU target install remains a separate external release gate and
must not be claimed until its recorded checks pass.
