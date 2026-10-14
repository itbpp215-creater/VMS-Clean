# 0033 - Clean Release Configuration Decoupling and Safe Node Update

Status: accepted (2026-10-14). Expands ADR 0032.

## Context
When remote station nodes (e.g., ตชด.144) deploy BPP-VMS from the Clean Distribution Repository (`itbpp215-creater/VMS-Clean`), they customize site-specific files (`config.yml`, `.env`, `camera_sources.json`, SQLite databases). 

Previously, `Sync-CleanRelease.ps1` forced orphan root commits on every push and tracked a sanitized `config.yml` in Git. This caused two major operational failures during downstream upgrades:
1. Downstream `git pull` failed with `fatal: refusing to merge unrelated histories`.
2. Any hard reset or merge conflict resolution risked completely overwriting local camera setups and credentials with blank clean templates.

## Decision
1. **Configuration Decoupling (`.gitignore` + `.example`)**:
   - In `VMS-Clean`, site-specific files (`config/config.yml`, `config/camera_sources.json`, `config/camera_credentials.env`, `.env`) are removed from Git tracking and added to `.gitignore`.
   - Track clean baseline templates instead: `config/config.clean.yml` (or `config.yml.example`), `.env.example`, `config/camera_sources.json.template`.
   - On new node bootstrap, templates are copied to live configs only if live configs do not already exist.

2. **Continuous Linear Clean History**:
   - `Sync-CleanRelease.ps1` fetches the latest tree of `itbpp215-creater/VMS-Clean` into its staging workspace before committing.
   - New clean releases are applied as incremental commits on top of existing clean history, allowing downstream nodes to run standard `git pull origin main`.

3. **Safe Node Update Workflow (`Update_BPP-VMS.bat` / `Update-VMSNode.ps1`)**:
   - Downstream nodes execute a 1-click update worker.
   - The worker takes a timestamped snapshot of `.env`, `config/`, databases (`auth.db`, `watchlist.db`, `frigate.db`), and state metadata before pulling code.
   - It performs Git fast-forward, verifies that node-specific configurations remain intact (restoring from snapshot if affected by file untracking), and initiates Docker service rebuilds.

## Consequences
- Downstream nodes can safely pull updates to code, dashboard frontend, and AI microservices with zero risk to local camera feeds or credentials.
- New deployments require a one-time copy of template configs to active configs.
- Release publishing maintains a clean, continuous commit log visible on GitHub without leaking upstream BPP215 secrets.
