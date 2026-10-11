# ADR-0008: Server-side authorization and layered Federation trust

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

The application previously relied too heavily on browser-visible role state and trusted internal headers/routes. A stolen/stored browser token, spoofed `X-Role`, direct backend request or leaked Federation credential could cross capabilities that should be independent. A predictable/default administrator also made a fresh or accidentally reset deployment unsafe.

Federation additionally carries license-plate intelligence between sites. A single static application credential over an unrestricted route does not establish where a caller came from, whether a trusted proxy verified transport, or how much personal data should leave the node.

## Decision

1. Browser authentication uses a Secure, HttpOnly, SameSite=Strict session cookie. JavaScript receives display identity only.
2. No default admin/password exists. A fresh auth database must be bootstrapped with a one-time randomly generated credential.
3. Current database role/active state is authoritative on every authenticated request.
4. nginx enforces coarse route policy, while each privileged backend also enforces its own authorization:
   - Config API verifies the original cookie/Bearer directly with auth-service.
   - Watchlist API trusts proxy identity only with a separate proxy secret and performs method-level admin checks.
   - nginx strips browser session credentials before proxying to Frigate, Watchlist or Federation.
5. Settings, Config, Watchlist mutation/export/inactive records and Frigate config/restart are admin-only.
6. Internal capabilities use separate secrets for proxy identity, audit append, Federation read and LPR history append.
7. Federation requires:
   - TLS
   - application secret
   - trusted proxy secret
   - mTLS-success or VPN assertion created by the trusted proxy
   - a narrow source CIDR at the current nginx gateway
8. Federation exports only active plate/display/danger fields and disables caching.
9. Missing/weak secret, unavailable verifier or incomplete assertion fails closed.

## Alternatives considered

### UI-only RBAC

Rejected because a user can call APIs without rendering the UI.

### Trust `X-User`/`X-Role` from any Compose caller

Rejected because container-network reachability is not identity and headers are trivial to spoof.

### One shared secret for all internal calls

Rejected because compromise would grant unrelated read/write/audit capabilities and make targeted rotation impossible.

### Federation application secret only

Rejected because a leaked secret would work from any reachable network and could be sent through an untrusted proxy.

### Mandatory mTLS only

Not selected for the current template because the existing deployment already has a VPN trust path. The backend contract supports either a verified mTLS assertion or VPN assertion; current nginx implements the CIDR/VPN path. mTLS may be added without changing the minimized response contract.

## Consequences

Positive:

- role changes revoke authorization immediately
- XSS cannot directly read the session token
- browser/client headers cannot grant backend admin
- leaked service credentials have narrower capability
- Federation limits both caller path and exported data
- fresh/reset auth volumes fail safely

Costs:

- TLS certificates and first-admin bootstrap are mandatory
- secret rotation must coordinate all holders/peers
- auth-service availability is required for privileged Config calls
- Federation networking must maintain an accurate VPN CIDR or trusted mTLS terminator
- nginx and backend policy must be tested together

## Validation

- auth unit tests cover bootstrap, password/JWT rotation, cookie flags, role refresh and last-admin invariant
- Config/Watchlist tests cover spoofed identity and regular-user denial
- Federation tests cover missing/wrong secrets, transport assertion and minimized active-only output
- repository security tests inspect gateway/CSP/secret scoping
- browser smoke test covers admin/user presentation, HttpOnly storage invariant and stored XSS

Live Compose/nginx validation remains required on a Docker-capable host because the hardening environment did not have a reachable Docker engine.

## Revisit when

- deployment adopts a central OIDC/identity provider
- every site supports managed mutual TLS and certificate rotation
- services move off one Compose network or use a service mesh
- Federation data contract/regulatory requirements change

## Related

- [`../security-model.md`](../security-model.md)
- [`../architecture.md`](../architecture.md)
- [`../features/watchlist.md`](../features/watchlist.md)
- [`../operations.md`](../operations.md)
