# ADR-0009: Crash-safe serialized config transactions

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Camera provisioning and role synchronization modify Git-managed `config/config.yml`, sometimes together with `nvr_groups.json`. Direct open/write operations can truncate a file on crash, lose a concurrent request's update, leave YAML and group metadata inconsistent, or preserve obsolete go2rtc stream entries after rename/delete.

The Config API also controls Frigate restart through the Docker socket. File safety without authoritative admin verification would still expose a high-impact control plane.

## Decision

All Config API routes are admin-only and every mutation uses one persistence transaction:

1. verify original cookie/Bearer directly with auth-service
2. validate request-controlled names, URL host/scheme, placeholder-only URL credentials and WebRTC address
3. acquire a platform-native interprocess lock across read-modify-commit
4. load round-trip YAML and strict group JSON
5. mutate in memory and remove affected old main/sub streams
6. validate project-owned semantic structures
7. serialize and reparse the exact YAML payload
8. write/fsync temporary files in each destination directory
9. create transaction-tagged backups
10. atomically replace files with `os.replace`
11. if a coordinated replacement fails, restore every already-replaced original
12. retain a bounded backup history and remove temporary files

Native Frigate config routes remain admin-readable but reject non-read methods, so browser writes cannot bypass this transaction path.

No-op synchronization does not commit or create a backup. Frigate restart remains explicit after a successful write.

## Alternatives considered

### Write YAML directly

Rejected because process/host failure can leave a partial file and concurrent requests can overwrite one another.

### Temporary file + rename without lock

Rejected because it protects individual bytes from truncation but not lost updates between simultaneous read-modify-write requests.

### Lock and atomic YAML only, groups separately

Rejected because camera/group metadata can diverge when the second write fails.

### Store all configuration in a database

Deferred because Frigate and deployment currently use Git-managed YAML as source of truth. A database would require a larger ownership/deploy redesign.

### Invoke full Frigate validation inside every request

Not selected as the sole validator because it couples API latency/availability to a running Frigate container. Config API performs a bounded structural/semantic validation; deployment must still run the upstream validator.

## Consequences

Positive:

- concurrent API workers cannot lose each other's updates
- an interrupted write does not expose a partially serialized primary file
- YAML/group changes can roll back together
- retained backups support operator recovery
- renames/deletes do not leave the affected camera's stream entries behind

Costs:

- writes can return 503 while another transaction holds the lock
- backup directory requires retention/monitoring
- rollback itself can fail under severe filesystem faults and requires operator recovery
- semantic validator must evolve when project-managed config shapes change
- Git may still show an intentional tracked config change after UI provisioning

## Validation

Config tests cover lock timeout/serialization, malformed data, atomic replacement, coordinated rollback, backup retention, temporary cleanup and stream cleanup. Config RBAC tests cover spoofed headers and regular-user denial.

Full Frigate validation and a live restart were not available in the hardening environment because Docker engine was unavailable; both remain pre-production requirements.

## Revisit when

- Config API gains multi-host writers
- configuration ownership moves from Git/YAML to a database/control plane
- Frigate exposes a transactional validated configuration API suitable for this workflow
- filesystem does not provide the required same-filesystem atomic replace semantics

## Related

- [`../features/camera-provisioning.md`](../features/camera-provisioning.md)
- [`../operations.md`](../operations.md)
- [`../architecture.md`](../architecture.md)
- [`ADR-0004-git-managed-production-deployment.md`](ADR-0004-git-managed-production-deployment.md)
