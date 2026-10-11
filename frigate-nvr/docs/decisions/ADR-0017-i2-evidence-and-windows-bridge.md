# ADR-0017: Reviewed evidence graph and licensed Windows i2 bridge

- Status: Accepted
- Date: 2026-08-27

## Context

The project needs i2-style grouping and future Analyst's Notebook ingestion without silently conflating people. IBM i2 conversion also depends on the installed, licensed Windows application and its 32-bit COM automation interface, while the application services run in Docker.

## Decision

Use connected components as graph groups. Treat exact phone overlap as strong graph evidence but not as authority to merge person records. Treat general names, addresses, and areas as weak evidence; the explicit parcel exception links a receiver to existing dossiers only by an exact normalized phone or full-name match and never merges dossiers. Store shared decisions and import audit history in an atomic versioned graph-state file, while keeping layout and viewport state per account.

Accept `.anb` through a streamed 1 GiB endpoint. Retain the raw file in protected NAS storage, deduplicate by SHA-256, and queue a copy for a per-user Windows logon task. The task runs a 32-bit PowerShell bridge against the licensed IBM i2 COM server, producing normalized JSON for preview. Admin or Superadmin must explicitly apply or roll back an import. A rollback removes only evidence added by that import and retains raw files and audit history.

Map supported IBM icon/style metadata to local styles without copying IBM assets. Notify paired Admin/Superadmin Telegram accounts with sanitized job metadata only.

## Consequences

Ambiguous relationships require review, but identity integrity and auditability are preserved. The bridge requires a licensed Windows user to remain signed in; queued jobs become retryable after 24 hours. Docker and Windows share only an ignored runtime queue, and production deployment requires recreating the affected services after validation.
