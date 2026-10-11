# ADR-0004: Treat Git as the source of truth for production-managed files

- Status: Accepted
- Date: 2026-07-03

## Context

The production host runs a self-hosted GitHub Actions runner. Deployment fetches the target branch and uses `git reset --hard FETCH_HEAD` before running `deploy.sh`.

Keeping unpushed commits or tracked-file edits only on production has already caused local work to be overwritten during auto-deploy.

## Decision

Treat tracked files in Git as the source of truth. Production working tree is disposable for tracked content.

Rules:

- change tracked config/code through Git
- develop on a branch and review before merge
- do not keep unpushed work on production
- keep secrets/runtime state only in gitignored machine-local paths

## Alternatives considered

- Edit production directly and sync back later
- Disable hard reset and preserve local drift
- Use production host as a development workstation

## Consequences

Positive:

- reproducible deployment state
- less configuration drift
- clear rollback through Git history

Trade-offs:

- direct local edits can be lost
- machine-local dependencies must be documented and backed up separately

## Validation

The current workflow explicitly fetches and resets to remote state, while `.env`, storage, model cache and runtime files remain outside Git tracking.

## Revisit when

- deployment changes to immutable images/artifacts or another configuration-management system

## Related

- [`../operations.md`](../operations.md)
- [`../current-state.md`](../current-state.md)
