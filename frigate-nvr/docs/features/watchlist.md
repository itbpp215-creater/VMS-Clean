# Watchlist, Detection History and Federation

- **Status:** ACTIVE
- **Last reconciled:** 2026-07-23
- **Evidence:** `watchlist-api/api.py`, `web/assets/watchlist.js`, `dashboard-nginx.conf`, `lpr-service/app.py`

## Purpose and data sensitivity

Watchlist stores normalized license plates, danger level and optional operational/PII fields such as owner, address, phone, network, criminal history and notes. Detection history adds camera, time and confidence, so both raw rows and aggregates require authentication.

SQLite state is machine-local at `config/lpr/watchlist.db`.

## Authorization model

| Operation | Authority |
|---|---|
| list active records, record detail, history, stats | authenticated user |
| include inactive records | admin |
| create/update/soft-delete/hard-delete | admin |
| full export | admin |
| append detection history | LPR service credential |
| minimized Federation export | approved Federation peer |
| health | internal health endpoint; do not expose as application data |

nginx authenticates the browser and sets `X-User`/`X-Role`, but watchlist-api trusts them only when `WATCHLIST_PROXY_SHARED_SECRET` matches. Client-supplied service/Federation assertions are stripped at the gateway.

UI hides mutation controls for regular users, while backend method-level RBAC is authoritative.

## Data behavior

- plate input is normalized to Thai/Latin/digits and uppercased
- danger level is one of `low`, `medium`, `high`, `critical`
- soft delete sets `active=0`; ordinary lists return active rows
- full export and inactive rows are privileged because they expose complete PII
- history returns at most 500 newest rows per plate
- stats aggregate detections by camera, hour and day

## LPR history writer

`lpr-service` calls `POST /watchlist/history` with `WATCHLIST_SERVICE_SHARED_SECRET`.

This capability:

- can append plate/camera/time/confidence
- cannot impersonate a browser identity
- cannot create/update/delete Watchlist records
- sends `EventState.best_score` as `confidence`
- fails without the separate service secret and does not stop the LPR event loop on network error

## Federation export

Public application route:

```text
GET /api/watchlist-federation
```

Required controls:

- TLS
- exact GET route
- source inside one of the validated IPv4/IPv6 CIDRs in
  `BPP_FEDERATION_ALLOW_CIDR`
- `WATCHLIST_FEDERATION_SHARED_SECRET`
- trusted proxy secret
- mTLS success or VPN assertion created by trusted proxy

Export contains only active:

```json
{
  "plate": "NORMALIZED_PLATE",
  "plate_display": "DISPLAY VALUE OR NULL",
  "danger_level": "high"
}
```

It deliberately excludes owner/address/phone/network/criminal history/notes/IDs/timestamps and uses `Cache-Control: no-store`.

Current nginx implements the VPN-CIDR path. Backend mTLS assertion support is available for a future trusted proxy that actually validates peer certificates.

## Audit

Successful admin mutations send an internal audit event to auth-service using `AUTH_AUDIT_SHARED_SECRET`. Audit identity/IP comes from the verified proxy identity. Audit delivery failure is logged but does not undo the already-completed Watchlist mutation.

## Browser rendering and stored XSS

All persisted Watchlist/profile/history fields are inserted with DOM creation and `textContent`. Data is never interpolated into row HTML or inline handlers. Identifier path segments are encoded.

The CSP and HttpOnly session cookie provide additional containment, but safe DOM construction remains required because stored payloads can affect every future viewer.

## CORS

CORS middleware is absent when `WATCHLIST_ALLOWED_ORIGINS` is empty. If a separate UI is approved, configure exact HTTPS origins; wildcard origin is prohibited.

## Operations

- Back up `config/lpr/watchlist.db` outside Git according to data-retention policy.
- Rotate proxy/Federation/service secrets independently.
- Use admin full export only for an approved backup workflow; it contains PII.
- Monitor auth-service audit delivery and Watchlist SQLite errors.
- Federation node URLs in `nodes.json` must use HTTPS.

## Tests

`watchlist-api/tests/test_api.py` covers:

- trusted proxy identity and spoof rejection
- regular-user read vs admin mutation/export
- inactive record restriction
- service-only history writes
- Federation secret/proxy/transport checks
- minimized active-only response

`tests/browser-smoke.mjs` covers role-aware controls and stored-XSS rendering with real dashboard assets.

## Related

- [Security Model](../security-model.md)
- [Architecture](../architecture.md)
- [LPR](license-plate-recognition.md)
- [ADR-0008](../decisions/ADR-0008-server-side-auth-and-federation.md)
