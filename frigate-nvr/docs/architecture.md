# System Architecture

- **Status:** ACTIVE
- **Last reconciled:** 2026-08-26 (person identity synchronization verified on branch `d15be3f`; not deployed to production)
- **Evidence:** `docker-compose.yml`, `dashboard-nginx.conf`, `config/config.yml`, `nas-bot-service/services/identity_sync.py`, `nas-bot-service/services/dossier_manager.py`, `nas-bot-service/repair_person_identity.py`, service source directories

## Multi-site release and update flow

```text
clean main + running source
  -> preflight/capture running services -> stop writers
  -> filtered app + Clone/NewSite + approved state + Docker images
  -> TAR list/extract/hash/scope verification
  -> promote TAR -> restart only prior services

verified TAR -> empty Windows target
  -> generate independent node/Compose/JWT/TLS/shared secrets
  -> restore auth/Watchlist/NAS before first start
  -> local-only health/config/GPU checks -> enable logon autostart

versioned update -> snapshot release-owned files -> promote/validate
  -> success: metadata + newest three rollback generations
  -> failure: restore metadata/files -> start/validate previous release
```

`release-policy.json` is the ownership contract. Application release paths and
site-owned `.env`, camera config, node/TLS, local overlay, Watchlist/NAS and media
never share update ownership. Migration additionally excludes runtime camera/LPR
media and source JWT/TLS/public-edge identity.

## High-level topology

```text
Camera RTSP
    |
    v
go2rtc (inside Frigate) ---> WebRTC 8555 ---> Browser
    |
    v
Frigate 5000 (internal)
    |                 \
    |                  \ events/frames/results
    v                   v
Dashboard nginx       lpr-service
TLS 443 + auth        |  \--> pending multi-plate observations
    |                 |       in watchlist-api
    |                 \----> Federation peers over HTTPS/VPN
    |
    +--> auth-service 5002
    +--> watchlist-api 5001 <--> lpr-trainer
    |                         \--> Discord / Telegram
    |                         \--> versioned model store
    +--> config-api 5003 --> config files + Docker restart control
```

`dashboard` เป็น gateway เดียวสำหรับ application HTTP; backend ports อยู่เฉพาะ Compose network

## Component responsibilities

| Component | Responsibility | Persistent state |
|---|---|---|
| Frigate/go2rtc | ingest/restream, inference, events, snapshots, recordings | `config/`, `frigate-db`, `storage/`, `cuda-cache` |
| Dashboard nginx | TLS termination, `auth_request`, route/method/CIDR policy, CSP และ static UI | certificates/settings mounts |
| auth-service | credential verification, session JWT, current role/active lookup, audit, encrypted account migration | named `auth-db:/data` volume (`auth.db`, `secret.key`) |
| watchlist-api | Watchlist, candidate/review truth, history, alert outbox, training/model lifecycle, minimized Federation export | `config/lpr/watchlist.db`, reviewed dataset |
| lpr-service | vehicle-bounded Thai LPR inference, durable pending-candidate delivery and runtime heartbeat | `lpr-data/`, candidate outbox, base/active models |
| lpr-trainer | reviewed alert delivery, synthetic coverage, detector/OCR fine-tuning, validation, promotion, rollback and worker heartbeat | reviewed dataset, `lpr-model-store/` |
| config-api | authorized config reads/mutations, transaction/backup, restart/status | `config/config.yml`, `config/nvr_groups.json`, `config/backups/` |
| nas-bot | bot ingestion, NAS Cases/Persons/Dossiers และ transactional person display-name synchronization | NAS `Cases/`, `Persons/`, `Dossiers/`, `Backups/identity-sync/` |

Although Frigate needs the broad host `config/` bind, it is non-privileged with `no-new-privileges`; nested tmpfs mounts mask `auth/`, `certs/`, `lpr/`, `dashboard-settings/` and `backups/` from its mount view.

## Authentication flow

```text
Browser POST /auth/login
  -> auth-service verifies bcrypt password + lockout state
  -> Set-Cookie: bpp_token (HttpOnly, Secure, SameSite=Strict)
  -> browser requests protected route with cookie
  -> nginx auth_request /auth/verify[/admin]
  -> auth-service validates JWT and re-reads current DB role/active state
  -> nginx allows or denies request
```

Config API performs an additional direct verification against auth-service using only the original `Cookie`/`Authorization`. Watchlist API trusts `X-User`/`X-Role` only when nginx also supplies the independent `WATCHLIST_PROXY_SHARED_SECRET`.

nginx strips browser `Cookie`/`Authorization` before forwarding to Watchlist, Federation and Frigate. Only auth-service and Config API receive them because Config performs its own direct verification.

UI role visibility is presentation only; backend checks are authoritative.

## New-camp account provisioning flow

```text
Windows Forms installer
  -> JSON over worker stdin (no secret CLI arguments)
  -> verified package copied to selected local folder
  -> Docker auth-service management command
  -> optional AES-GCM/scrypt account bundle validation
  -> one SQLite transaction: imported bcrypt hashes + selected active admin
  -> auth-service starts with fresh JWT key on the new machine
  -> Dashboard /auth/users lists every imported and new account
```

The migration bundle excludes plaintext passwords, browser sessions, JWT signing
material, login-attempt state, and audit logs. The new machine therefore accepts
the prior passwords but invalidates all old browser sessions.

## Live video and detection flow

```text
Upstream RTSP + machine-local credential
  -> go2rtc ffmpeg producer
  -> local RTSP restream
  -> Frigate record/detect roles
  -> ONNX YOLO11m detector on NVIDIA GPU
  -> event/snapshot/recording metadata
  -> authenticated Dashboard via /nvr/
```

WebRTC media is the only Frigate port published directly (`8555/tcp+udp`). Frigate HTTP `5000` remains internal and must never be treated as an authenticated public API.

## Config mutation flow

```text
Admin browser
  -> nginx /api/config/* admin check
  -> config-api verifies original session with auth-service
  -> validate request
  -> acquire interprocess lock
  -> load YAML (+ groups JSON when needed)
  -> mutate in memory and remove affected stream entries
  -> semantic validation + serialize/reparse
  -> write/fsync same-filesystem temp files
  -> create retained backups
  -> atomic replace; rollback coordinated files on failure
  -> release lock
  -> optional explicit Frigate restart
```

The transaction validator protects project-owned structures but does not replace `python -m frigate --validate-config` before deploy.
nginx denies non-read methods on native `/nvr/api/config*`; Config API is the sole browser-accessible config writer.

## Person identity synchronization flow

```text
authenticated dossier name edit + stable dossier_id + operator
  -> DossierVaultManager delegates the complete name-bearing update
  -> IdentitySyncCoordinator holds one process-wide lock shared by Dossier, Person and Case writers
  -> read selected dossier and constrained Dossier/Person/Case metadata
  -> candidate Person union:
       exact national ID | normalized phone | persisted linked_person_ids | source case ID
  -> 0 matches: warning; 1 match: continue; >1 matches: conflict/no writes
  -> plan selected profile + cached linked labels + one Person + proven Case suspects
  -> rebuild dossier index from planned profile view
  -> stage every changed JSON as flushed/fsynced sibling
  -> promote with atomic replace -> read-back verification
  -> failure: restore exact original bytes or original absence -> byte/absence verification
```

Names are display data; `dossier_id`, `person_id`, dossier directories, case IDs, graph node IDs,
graph edges and evidence remain immutable. Candidate selection never uses fuzzy or substring name
matching. Strong routes form one candidate set rather than a first-match-wins cascade, so evidence
that points to multiple Person records fails before staging.

The selected dossier is the authority after an officer correction and records
`name_source=officer_correction`, a UTC correction time and the authenticated operator. The corrected
label propagates only to the uniquely matched Person, proven Case suspect objects, cached links whose
`dossier_id` equals the target, and the rebuilt search/graph index. A proven single-suspect case can
inherit case-level person/source proof; an unresolved multi-suspect case is skipped with a stable warning.

Historical `sync-all` is an ingestion path, not a repair path. It may merge non-name evidence into a
corrected dossier through an exact national ID or phone, but weak name matching skips authoritative
profiles and OCR cannot supersede the corrected name.

The maintenance CLI uses the same coordinator. Its default mode plans without writes. Explicit
`--apply` runs backup and promotion against the same in-lock plan: it first publishes a verified,
recoverable copy of every affected JSON file's exact original bytes (or records original absence), then
applies. This persistent backup is specific to the CLI; API edits rely on the coordinator's in-memory
rollback and do not create an identity-sync backup directory.

Identity plan repr, sanitized `identity_sync` summary, CLI output, coordinator logs and error responses
expose only their documented stable identifiers/counts/warnings/status/no-op fields. Replacement documents,
corrected names, national IDs, phones, addresses and evidence contents remain outside those operational
surfaces. The authorized API response separately retains its existing full-dossier field.

## Watchlist and LPR flow

```text
Authenticated user
  -> nginx /api/watchlist
  -> signed proxy identity
  -> watchlist-api read

Admin mutation
  -> same route
  -> watchlist-api method-level admin check
  -> SQLite update + authenticated audit event

Frigate vehicle event
  -> one overlapping vehicle cluster: bounded mainstream frame sampling + optional LPR zone
  -> ambiguous concurrent owners: exact snapshot bounding box fallback
  -> quality ranking + distinct-frame readable consensus
  -> searchable Frigate AI-pending label
  -> plate detector searches only inside the vehicle region
  -> line OCR + legacy character fallback produce zero or more candidates
  -> atomic local candidate outbox when watchlist-api is unavailable
  -> at-least-once, idempotent service-authenticated candidate(s) in watchlist-api
  -> admin four-corner perspective review
  -> conflict: arm215 adjudication
  -> confirmed truth updates linked Frigate events + reviewed dataset
  -> exact Watchlist hit: confirmed history + durable bot outbox
  -> partial Watchlist text: tentative bot outbox only

approved unused examples reach adjustable threshold (default 500)
  -> lpr-trainer checks reviewed category coverage
  -> fine-tune existing detector + contextual row OCR
  -> stable validation/test and no-regression gate
  -> atomic active model pointer or rejected version
  -> lpr-service preloads detector/OCR pair and hot-swaps
```

Person events can link to a candidate associated with the same vehicle, but a person box is never an inference crop. AI observations cannot update searchable Frigate fields, trigger a confirmed Watchlist history row, or become training truth. Reviewed unreadable plates remain positive detector examples without OCR labels. Rejected non-plates retain only a reason-coded restricted negative crop; the review path never changes Frigate video retention. Legacy events without a new candidate can create one idempotent `manual-review` candidate before an administrator submits the crop.

The `lpr-trainer` has no camera or Frigate network access. It reads human-approved examples and writes retained checkpoints. Runtime receives the model store read-only. Both detector and OCR checkpoints must preload before the active pair changes.

## Federation flow

```text
Peer lpr-service
  -> HTTPS GET /api/watchlist-federation
  -> Federation application secret
  -> nginx source CIDR allow/deny
  -> nginx strips caller assertions
  -> nginx adds proxy secret + VPN assertion
  -> watchlist-api verifies secret + proxy + (VPN or trusted mTLS assertion)
  -> active plate/display/danger only; Cache-Control: no-store
```

The current nginx template implements the VPN-CIDR path. Before template
rendering, a fail-closed entrypoint hook validates the comma-separated
`BPP_FEDERATION_ALLOW_CIDR` value and generates one nginx `allow` directive per
CIDR. watchlist-api also supports an mTLS-success assertion from a trusted proxy
if mTLS termination is added later.

## Browser rendering boundary

Persisted camera, user and Watchlist fields are untrusted display data:

```text
API JSON -> DOM element creation -> textContent
```

No persisted field may enter `innerHTML`, inline event attributes or executable URL construction. CSP provides a second boundary by disallowing inline scripts and `eval`; the session token remains unreadable to JavaScript.

## Secret capability boundaries

| Credential | Holders | Capability |
|---|---|---|
| JWT key | auth-service only | sign/verify sessions |
| `AUTH_AUDIT_SHARED_SECRET` | auth + approved audit producer | append internal audit only |
| `WATCHLIST_PROXY_SHARED_SECRET` | nginx + watchlist-api | authenticate proxy identity/assertions |
| `WATCHLIST_FEDERATION_SHARED_SECRET` | approved peers + watchlist/LPR | read minimized Federation data |
| `WATCHLIST_SERVICE_SHARED_SECRET` | LPR + watchlist-api | append detection history only |
| `FRIGATE_*` | Frigate only | connect upstream streams |

Filesystem mounts follow the same capability rule: a non-privileged Frigate with the required tmpfs masks must not traverse into auth keys, TLS private keys, Watchlist DB or Config API backups through its broad config bind.

## Architectural invariants

1. Application HTTP enters through TLS Dashboard gateway.
2. Backend role checks remain authoritative even if nginx/UI checks regress.
3. No default administrator or credential exists in tracked files.
4. Frigate HTTP and Docker control plane remain internal.
5. Federation requires application and network/transport trust, and exports minimum data.
6. Config writes are locked, validated, backed up and atomically replaced.
7. Persisted text is rendered as text, never executable markup.
8. Machine-local secrets/models/runtime databases are not committed.
9. AI-only LPR output is not authoritative truth or training data.
10. LPR review never changes event video retention.
11. Person display-name corrections preserve every stable identifier, graph edge and evidence artifact.
12. Person resolution for a correction requires exact strong evidence; fuzzy names cannot authorize a merge.

## Related

- [Current State](current-state.md)
- [Security Model](security-model.md)
- [Watchlist](features/watchlist.md)
- [Camera Provisioning](features/camera-provisioning.md)
- [LPR](features/license-plate-recognition.md)
- [NAS Bot Integration](features/nas-bot-integration.md)
- [ADR-0008](decisions/ADR-0008-server-side-auth-and-federation.md)
- [ADR-0009](decisions/ADR-0009-crash-safe-config-transactions.md)
- [ADR-0016](decisions/ADR-0016-person-identity-synchronization.md)

## i2 link-analysis boundary

`nas-bot` builds a shared evidence graph from Dossiers, parcels, CDR, reviewed decisions, and applied normalized i2 imports. `i2-graph-state.json` owns shared review/audit metadata and per-account layouts; it does not become an authoritative identity store. Nginx streams only `/api/nas-bot/graph/import-i2` up to 1 GiB. A bind-mounted ignored queue crosses the Docker/Windows boundary to a 32-bit licensed COM bridge. Raw uploads remain in NAS `I2Imports/`; the bridge returns normalized JSON for preview and Admin apply/rollback.

See [i2 Link Analysis](features/i2-link-analysis.md) and [ADR-0017](decisions/ADR-0017-i2-evidence-and-windows-bridge.md).

### Parcel identity authority

Web Chat owns channel-neutral plain-text intent parsing; Telegram forwards ordinary text unchanged to
that service. Parcel reports form a receiver-authoritative boundary: only receiver fields may populate
top-level person identity, and only exact receiver phone/full-name matches may enter the dossier/i2
relationship graph. Sender data remains solely in retained raw evidence and is not a graph entity.

### Interrupted i2 bridge recovery boundary

The host bridge queue is single-writer through an exclusive file handle. Because a power loss or killed
PowerShell process can leave a durable descriptor in `jobs/processing`, bridge startup treats that
directory as a recovery journal: completed outputs move to `done`, unfinished claims return to
`pending`, and malformed/duplicate claims are retained with unique audit names. Recovery never modifies
or removes the corresponding `inbox/*.anb` evidence file.
