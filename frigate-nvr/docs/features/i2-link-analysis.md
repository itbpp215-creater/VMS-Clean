# i2 Link Analysis

## Purpose

The i2 graph is a reviewed evidence workspace for dossiers, parcel records, CDR data, and normalized IBM i2 imports. It helps investigators see connected components without turning weak similarity into an identity decision.

## Evidence rules

- Exact normalized phone overlap creates or reuses a phone node and may connect evidence, but does not merge authoritative people.
- A shared area remains reviewable evidence and never auto-merges people. Parcel names/phones are used only for exact receiver-to-dossier graph links and never merge authoritative dossiers.
- Parcel evidence is receiver-only for both current and legacy schemas. Sender fields never enter the graph, unmatched receivers are omitted, and a receiver links only to an existing dossier by exact normalized phone or full name; no provisional parcel person is created.
- Legacy `linked_dossiers` remain visible for review. New writes no longer create hard-coded area/address links, including the former `1045` and Bang Khun Thian behavior.
- Manual links and approved proposals are audited and can be soft-cancelled. Existing source evidence is not deleted.

## Graph behavior

- Groups are connected components and retain a floating shared name without a surrounding hull, background, or border. Officer, Admin, and Superadmin can rename a shared group.
- Layout, viewport, zoom, and pins are saved per account. New linked nodes are placed near an existing neighbor without rearranging the old layout.
- Applying a reviewed i2 import preserves its supplied positions but fits the current viewport to the newly visible graph. A saved layout whose graph fingerprint is older than the current graph is fitted on first open; the Reload control also fits the complete graph without rewriting imported or operator-saved positions.
- **จัดโหนดใหม่** arranges only nodes without positions and never clears imported i2 or saved operator positions. **คืนผัง i2** is an explicitly confirmed, per-account recovery action: it restores trusted i2 source positions and places only local nodes without source coordinates. It does not change graph facts, relationships, raw evidence, or other accounts' layouts.
- Live refresh preserves the view. Rendering is progressively culled for large graphs, while explicit auto-arrange remains available.
- Officer, Admin, and Superadmin may open the graph. Import apply and rollback require Admin or Superadmin.

## IBM i2 import

Phase 1 accepts one `.anb` file at a time, up to 1 GiB. The raw upload is retained in protected NAS storage and copied to an ignored Windows bridge queue. A signed-in, licensed Windows account runs the 32-bit COM bridge and returns normalized JSON. The dashboard supports hash deduplication, preview, Admin apply, retry after a 24-hour timeout, rollback-impact preview, whole-import rollback, and Admin Restore of a rolled-back reviewed import without reconversion. `.i2x` and `.anx` are deferred.

Built-in IBM icon identifiers are mapped to local graph styles; IBM image assets are not copied. Imported positions and supported styles are preserved where available.

## Operations and privacy

Raw `.anb` files are Admin-only, backed up with the NAS archive, and never attached to Telegram. Telegram status messages contain only a sanitized filename, job ID, state, and node/edge counts. See [Operations](../operations.md#ibm-i2-windows-bridge) and [ADR-0017](../decisions/ADR-0017-i2-evidence-and-windows-bridge.md).

The exact upload route and its internal body-less authentication subrequest both permit the same 1 GiB limit. This prevents a permitted large upload from being rejected by the internal check and surfaced as a misleading HTTP 500; the verifier still receives no file body.

## Upload retry and interrupted bridge recovery

- The hidden `.anb` file input stops click bubbling into its parent drop zone. Its value is cleared
  before dispatching the selected `File`, so an operator can choose the same file again after a failed
  browser/network attempt and still trigger a new upload request.
- Dashboard cache key `i2-graph.js?v=12` publishes this behavior without changing other dashboard
  services. The upload endpoint remains the exact authenticated 1 GiB Nginx exception.
- The Windows bridge holds an exclusive `bridge.lock` file handle. A second manual/task instance exits
  without claiming work, while an OS-released lock after process termination allows recovery.
- At startup the bridge reconciles every descriptor left under `jobs/processing`: descriptors with an
  output/error are retired to `done`; descriptors without a result are moved back to `pending`; corrupt
  or duplicate descriptors are retained under unique `done` names for audit. Raw `.anb` input is never
  deleted by recovery.
- The per-user Scheduled Task uses `IgnoreNew`, starts when available, has no execution time limit,
  retries at one-minute intervals, and is allowed to continue across Windows battery-policy changes.
