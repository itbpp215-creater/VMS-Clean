---
name: bpp-dev-workflow
description: >-
  Runbook for completing a development task in BPP PrerimWatch.
  Follow this strictly to ensure all documentation (CLAUDE.md rules 8, 9, 10) is updated before considering a task complete.
---

# BPP-VMS Development Workflow

When completing any development task in this repository, you MUST follow these steps before considering the task finished.

## 1. Code Commenting Rules (CLAUDE.md Section 10)
- Every new or modified function, method, class, or module must have a docstring or comment explaining:
  - What it does and why.
  - Inputs, outputs, and side effects.
- Every changed logic block must have a comment explaining intent and behavior.
- Every changed line must be covered by a comment explaining the change.

## 2. Documentation Updates (CLAUDE.md Section 9)
You must review your changes and update the relevant documentation:
- Changed features? Update `docs/features/<feature-name>.md`.
- Changed architecture? Update `docs/architecture.md`.
- Changed config, IPs, models, cameras? Update `docs/current-state.md`.
- Made a significant architectural decision? Create an ADR in `docs/decisions/`.
- Important debugging session or context? Create a session log in `docs/sessions/`.

## 3. Testing (CLAUDE.md Section 4)
Ensure you run the required tests before committing:
```bash
PYTHONPATH=auth-service python -m pytest -q auth-service/tests
python -m unittest discover -s watchlist-api/tests -v
PYTHONPATH=config-api python -m pytest -q config-api/tests
python -m unittest discover -s config-validator/tests -v
python -m unittest discover -s lpr-service/tests -v
python -m pytest -q tests
npm ci
npm run test:browser
```
