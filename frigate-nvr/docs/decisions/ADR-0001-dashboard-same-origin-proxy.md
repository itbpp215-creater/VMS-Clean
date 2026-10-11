# ADR-0001: Use same-origin `/nvr/` proxy for Dashboard access

- Status: Accepted
- Date: 2026-07-02

## Context

The custom Dashboard is served on port 8080 while Frigate HTTP is on port 5000. Direct browser access across origins caused CORS issues and opening wildcard CORS on an unauthenticated backend would increase exposure.

## Decision

Serve Dashboard through nginx and proxy `/nvr/` to `frigate:5000`, including WebSocket upgrade support.

## Alternatives considered

- Call port 5000 directly and enable permissive CORS
- Expose Frigate API through another dedicated backend service

## Consequences

Positive:

- REST and WebSocket use one browser origin
- no wildcard CORS is required
- Dashboard has one stable backend prefix

Trade-offs:

- nginx becomes part of the application path
- stale bind-mounted config/DNS can require Dashboard container recreation after deploy

## Validation

Dashboard live view, events and clips were verified through `/nvr/` proxy and deployment script recreates the Dashboard after Frigate changes.

## Revisit when

- a dedicated authenticated API gateway is introduced
- external/untrusted network access becomes a requirement

## Related

- [`../architecture.md`](../architecture.md)
- [`../security-model.md`](../security-model.md)
- [`../troubleshooting.md`](../troubleshooting.md)
