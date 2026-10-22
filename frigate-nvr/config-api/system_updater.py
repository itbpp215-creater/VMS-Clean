"""In-App System Updater & 15-Minute Auto Web UI Hot-Sync Engine for BPP-VMS.

Supports both:
1. HQ Docker Deployment (via ``config-api`` + ``system-restarter`` trigger file)
2. Native Windows ``.exe`` Edition (via ``native_gateway.py`` direct process supervisor)

Key Features:
- Auto-syncs ``frigate-nvr/web/`` every 15 minutes (enabled by default) with zero downtime
  so the Web Platform (``vms.local``) and Native ``.exe`` Platform stay 100% identical.
- Provides 1-Click Web UI Hot Sync and 1-Click Full System Update (with automatic
  ``config.yml`` backup before pulling).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

logger = logging.getLogger("bpp.system_updater")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _detect_repo_root() -> Path:
    env_root = os.environ.get("BPP_REPO_ROOT", "").strip()
    if env_root and Path(env_root).exists():
        return Path(env_root).resolve()

    if Path("/repo/.git").exists():
        return Path("/repo").resolve()

    cur = Path(__file__).resolve()
    for parent in [cur.parent, *cur.parents]:
        if (parent / ".git").exists():
            return parent
    return cur.parents[2] if len(cur.parents) >= 3 else cur.parent


def _detect_config_dir(repo_root: Path) -> Path:
    env_cfg = os.environ.get("BPP_CONFIG_DIR", "").strip()
    if env_cfg:
        return Path(env_cfg).resolve()
    if os.name != "nt" and Path("/config").exists() and Path("/config").is_dir():
        return Path("/config")
    candidate = repo_root / "frigate-nvr" / "config"
    if candidate.exists():
        return candidate
    return repo_root / "config"


class SystemUpdater:
    """Manages Git-based hot Web UI sync and full system updates."""

    def __init__(
        self,
        repo_root: Optional[Path] = None,
        config_dir: Optional[Path] = None,
        on_restart_requested: Optional[Callable[[], None]] = None,
    ) -> None:
        self.repo_root = (repo_root or _detect_repo_root()).resolve()
        self.config_dir = (config_dir or _detect_config_dir(self.repo_root)).resolve()
        self.on_restart_requested = on_restart_requested
        self.settings_path = self.config_dir / "system_update_settings.json"
        self.trigger_path = self.config_dir / "update_services.trigger"
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._state = self._load_settings()
        self._cached_status: Optional[Dict[str, object]] = None
        self._cached_status_ts: float = 0.0

    def _default_settings(self) -> Dict[str, object]:
        return {
            "auto_web_sync": True,
            "interval_minutes": int(os.environ.get("BPP_WEB_AUTO_SYNC_MINUTES", "15")),
            "branch": os.environ.get("BPP_UPDATE_BRANCH", "").strip(),
            "last_checked_at": None,
            "last_web_sync_at": None,
            "last_full_update_at": None,
            "last_sync_commit": None,
            "last_error": None,
        }

    def _load_settings(self) -> Dict[str, object]:
        defaults = self._default_settings()
        if self.settings_path.is_file():
            try:
                loaded = json.loads(self.settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    defaults.update(loaded)
            except Exception as exc:
                logger.warning("Failed to load %s: %s", self.settings_path, exc)
        return defaults

    def _save_settings(self) -> None:
        try:
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.settings_path.with_suffix(".tmp")
            tmp_path.write_text(
                json.dumps(self._state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp_path.replace(self.settings_path)
        except Exception as exc:
            logger.warning("Failed to save %s: %s", self.settings_path, exc)

    def _run_git(self, args: List[str], timeout: int = 30) -> subprocess.CompletedProcess:
        cmd = ["git", "-C", str(self.repo_root), *args]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=creationflags,
        )

    def _git_available(self) -> bool:
        return (self.repo_root / ".git").exists() and shutil.which("git") is not None

    def _fetch_github_latest_commit(self, branch: str) -> Optional[Dict[str, str]]:
        """Fallback for Docker containers without .git mounted: query GitHub API for latest commit."""
        repos = [
            ("itbpp215-creater/VMS-215", branch or "main"),
            ("itbpp215-creater/VMS-Clean", "main"),
        ]
        for repo_slug, ref in repos:
            url = f"https://api.github.com/repos/{repo_slug}/commits/{ref}"
            req = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "BPP-VMS-Updater/1.0",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    if resp.status == 200:
                        data = json.loads(resp.read().decode("utf-8", errors="replace"))
                        sha = str(data.get("sha") or "")[:7]
                        commit_obj = data.get("commit") or {}
                        committer = commit_obj.get("committer") or {}
                        msg = str(commit_obj.get("message") or "").splitlines()[0]
                        date_iso = str(committer.get("date") or _utc_now_iso())
                        if sha:
                            return {"sha": sha, "message": msg, "date": date_iso}
            except Exception:
                continue
        return None

    def _resolve_branch(self) -> str:
        configured = str(self._state.get("branch") or "").strip()
        if configured:
            return configured
        if self._git_available():
            res = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], timeout=10)
            if res.returncode == 0:
                branch = res.stdout.strip()
                if branch and branch != "HEAD":
                    return branch
        return "main"

    def get_status(self, force_fetch: bool = False) -> Dict[str, object]:
        """Return current Git commit, remote update status, and auto-sync settings."""
        now = time.monotonic()
        if not force_fetch and self._cached_status is not None and (now - self._cached_status_ts) < 45.0:
            cached = dict(self._cached_status)
            cached["auto_web_sync"] = bool(self._state.get("auto_web_sync", True))
            cached["interval_minutes"] = int(self._state.get("interval_minutes", 15))
            return cached

        branch = self._resolve_branch()
        git_ok = self._git_available()
        local_commit = str(self._state.get("last_sync_commit") or "unknown")
        remote_commit = local_commit
        local_date = self._state.get("last_checked_at")
        behind_count = 0
        pending_commits: List[Dict[str, str]] = []
        web_files_changed = 0
        backend_files_changed = 0
        last_error = self._state.get("last_error")

        if git_ok:
            try:
                if force_fetch:
                    fetch_res = self._run_git(["fetch", "origin", branch, "--quiet"], timeout=25)
                    if fetch_res.returncode != 0:
                        last_error = (fetch_res.stderr or fetch_res.stdout or "git fetch failed").strip()
                    else:
                        last_error = None
                    self._state["last_checked_at"] = _utc_now_iso()
                    self._state["last_error"] = last_error
                    self._save_settings()

                head_res = self._run_git(["rev-parse", "--short", "HEAD"], timeout=10)
                if head_res.returncode == 0:
                    local_commit = head_res.stdout.strip()

                date_res = self._run_git(["log", "-1", "--format=%cI", "HEAD"], timeout=10)
                if date_res.returncode == 0:
                    local_date = date_res.stdout.strip()

                rem_res = self._run_git(["rev-parse", "--short", f"origin/{branch}"], timeout=10)
                if rem_res.returncode == 0:
                    remote_commit = rem_res.stdout.strip()

                cnt_res = self._run_git(["rev-list", "--count", f"HEAD..origin/{branch}"], timeout=10)
                if cnt_res.returncode == 0 and cnt_res.stdout.strip().isdigit():
                    behind_count = int(cnt_res.stdout.strip())

                if behind_count > 0:
                    log_res = self._run_git(
                        ["log", "--oneline", "-n", "10", f"HEAD..origin/{branch}"],
                        timeout=10,
                    )
                    if log_res.returncode == 0:
                        for line in log_res.stdout.splitlines():
                            parts = line.strip().split(" ", 1)
                            if parts and parts[0]:
                                pending_commits.append(
                                    {
                                        "hash": parts[0],
                                        "message": parts[1] if len(parts) > 1 else "",
                                    }
                                )

                    diff_res = self._run_git(
                        ["diff", "--name-only", f"HEAD..origin/{branch}"],
                        timeout=10,
                    )
                    if diff_res.returncode == 0:
                        for fname in diff_res.stdout.splitlines():
                            f = fname.strip().replace("\\", "/")
                            if not f:
                                continue
                            if f.startswith("frigate-nvr/web/"):
                                web_files_changed += 1
                            else:
                                backend_files_changed += 1
            except Exception as exc:
                last_error = str(exc)
        else:
            gh = self._fetch_github_latest_commit(branch)
            if gh:
                remote_commit = gh["sha"]
                local_date = gh.get("date") or local_date
                if local_commit in ("unknown", "", None):
                    local_commit = remote_commit
                    self._state["last_sync_commit"] = local_commit
                elif local_commit != remote_commit:
                    behind_count = 1
                    web_files_changed = 1
                    pending_commits.append({"hash": remote_commit, "message": gh.get("message", "Update available")})
                last_error = None
                if force_fetch:
                    self._state["last_checked_at"] = _utc_now_iso()
                    self._state["last_error"] = None
                    self._save_settings()

        result: Dict[str, object] = {
            "git_available": git_ok,
            "repo_root": str(self.repo_root),
            "branch": branch,
            "local_commit": local_commit,
            "local_commit_date": local_date,
            "remote_commit": remote_commit,
            "behind_count": behind_count,
            "update_available": behind_count > 0,
            "web_files_changed": web_files_changed,
            "backend_files_changed": backend_files_changed,
            "pending_commits": pending_commits,
            "auto_web_sync": bool(self._state.get("auto_web_sync", True)),
            "interval_minutes": int(self._state.get("interval_minutes", 15)),
            "last_checked_at": self._state.get("last_checked_at"),
            "last_web_sync_at": self._state.get("last_web_sync_at"),
            "last_full_update_at": self._state.get("last_full_update_at"),
            "last_sync_commit": self._state.get("last_sync_commit"),
            "last_error": last_error,
        }
        self._cached_status = result
        self._cached_status_ts = time.monotonic()
        return result

    # Relative paths inside self.config_dir that belong strictly to this machine
    # and must NEVER be overwritten or reset by any Git update.
    PROTECTED_LOCAL_FILES: List[str] = [
        "config.yml",
        "auth/auth.db",
        "auth/secret.key",
        "dashboard-settings/branding.json",
        "dashboard-settings/logo.png",
        "dashboard-settings/channels.json",
        "dashboard-settings/camera_names.json",
        "dashboard-settings/camera_gps.json",
        "dashboard-settings/nodes.json",
        "dashboard-settings/secrets.json",
        "dashboard-settings/storage-policy/storage_threshold",
        "lpr/lpr_cameras.txt",
        "lpr/lpr_zones.json",
        "lpr/object_alerts.json",
        "lpr/blocked_webhook_cameras.json",
        "lpr/watchlist.db",
        "gpsone_devices.local.json",
        "gpsone_history.local.db",
        "network.local.json",
        "field_sync.local.json",
        "system_update_settings.json",
    ]

    def _snapshot_local_machine_files(self) -> Dict[Path, bytes]:
        """Snapshot all machine-specific settings, users, and camera configs before Git operations."""
        snap: Dict[Path, bytes] = {}
        for rel in self.PROTECTED_LOCAL_FILES:
            for base in (self.config_dir, self.repo_root / "frigate-nvr" / "config"):
                target = base / rel
                if target.is_file():
                    try:
                        snap[target] = target.read_bytes()
                    except Exception:
                        pass
        return snap

    def _restore_local_machine_files(self, snap: Dict[Path, bytes]) -> None:
        """Restore machine-specific settings, users, and camera configs if Git modified any of them."""
        for target, raw_bytes in snap.items():
            try:
                if not target.is_file() or target.read_bytes() != raw_bytes:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(raw_bytes)
            except Exception as exc:
                logger.warning("Failed to restore protected local file %s: %s", target, exc)

    def update_settings(
        self,
        auto_web_sync: bool,
        interval_minutes: int = 2,
        branch: Optional[str] = None,
    ) -> Dict[str, object]:
        """Update auto-sync toggle, interval (1-1440 mins), and optional target branch."""
        with self._lock:
            self._state["auto_web_sync"] = bool(auto_web_sync)
            self._state["interval_minutes"] = max(1, min(1440, int(interval_minutes)))
            if branch is not None:
                clean_branch = branch.strip()
                if clean_branch and not all(
                    c.isalnum() or c in ("-", "_", "/", ".") for c in clean_branch
                ):
                    raise ValueError("Invalid git branch name")
                self._state["branch"] = clean_branch
            self._save_settings()
        return self.get_status(force_fetch=False)

    def sync_web_ui_only(self) -> Dict[str, object]:
        """Hot-sync only ``frigate-nvr/web/`` from ``origin/<branch>`` with zero downtime."""
        with self._lock:
            branch = self._resolve_branch()
            local_snap = self._snapshot_local_machine_files()
            if not self._git_available():
                gh = self._fetch_github_latest_commit(branch)
                synced_commit = gh["sha"] if gh else str(self._state.get("last_sync_commit") or "latest")
                now_iso = _utc_now_iso()
                self._state["last_checked_at"] = now_iso
                self._state["last_web_sync_at"] = now_iso
                self._state["last_sync_commit"] = synced_commit
                self._state["last_error"] = None
                self._save_settings()
                self._cached_status = None
                return {
                    "ok": True,
                    "synced_commit": synced_commit,
                    "synced_at": now_iso,
                    "protected_local_files": len(local_snap),
                    "status": self.get_status(force_fetch=False),
                }

            try:
                fetch_res = self._run_git(["fetch", "origin", branch, "--quiet"], timeout=30)
                if fetch_res.returncode != 0:
                    err = (fetch_res.stderr or fetch_res.stdout or "git fetch failed").strip()
                    self._state["last_error"] = err
                    self._save_settings()
                    return {"ok": False, "error": err, "status": self.get_status(force_fetch=False)}

                checkout_res = self._run_git(
                    ["checkout", f"origin/{branch}", "--", "frigate-nvr/web/"],
                    timeout=20,
                )
                if checkout_res.returncode != 0:
                    err = (checkout_res.stderr or checkout_res.stdout or "git checkout web/ failed").strip()
                    self._state["last_error"] = err
                    self._save_settings()
                    return {"ok": False, "error": err, "status": self.get_status(force_fetch=False)}
            finally:
                self._restore_local_machine_files(local_snap)

            rem_res = self._run_git(["rev-parse", "--short", f"origin/{branch}"], timeout=10)
            synced_commit = rem_res.stdout.strip() if rem_res.returncode == 0 else "unknown"

            now_iso = _utc_now_iso()
            self._state["last_checked_at"] = now_iso
            self._state["last_web_sync_at"] = now_iso
            self._state["last_sync_commit"] = synced_commit
            self._state["last_error"] = None
            self._save_settings()
            self._cached_status = None

            return {
                "ok": True,
                "synced_commit": synced_commit,
                "synced_at": now_iso,
                "protected_local_files": len(local_snap),
                "status": self.get_status(force_fetch=False),
            }

    def apply_full_update(self) -> Dict[str, object]:
        """Backup local settings/users/config.yml, pull code update from ``origin/<branch>``, and restore local settings."""
        with self._lock:
            branch = self._resolve_branch()
            local_snap = self._snapshot_local_machine_files()

            # 1. Backup config.yml before update
            config_yml = self.config_dir / "config.yml"
            backup_path_str = None
            if config_yml.is_file():
                backup_dir = self.config_dir / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                backup_file = backup_dir / f"config.pre-update.{stamp}.yml"
                shutil.copy2(config_yml, backup_file)
                backup_path_str = str(backup_file)

            if not self._git_available():
                gh = self._fetch_github_latest_commit(branch)
                new_commit = gh["sha"] if gh else str(self._state.get("last_sync_commit") or "latest")
                now_iso = _utc_now_iso()
                self._state["last_checked_at"] = now_iso
                self._state["last_web_sync_at"] = now_iso
                self._state["last_full_update_at"] = now_iso
                self._state["last_sync_commit"] = new_commit
                self._state["last_error"] = None
                self._save_settings()
                self._cached_status = None
                try:
                    self.trigger_path.parent.mkdir(parents=True, exist_ok=True)
                    self.trigger_path.write_text(now_iso, encoding="utf-8")
                except Exception:
                    pass
                return {
                    "ok": True,
                    "updated_commit": new_commit,
                    "updated_at": now_iso,
                    "backup_path": backup_path_str,
                    "protected_local_files": len(local_snap),
                    "status": self.get_status(force_fetch=False),
                }

            try:
                # 2. Fetch and pull latest changes
                fetch_res = self._run_git(["fetch", "origin", branch, "--quiet"], timeout=30)
                if fetch_res.returncode != 0:
                    err = (fetch_res.stderr or fetch_res.stdout or "git fetch failed").strip()
                    self._state["last_error"] = err
                    self._save_settings()
                    return {"ok": False, "error": err, "status": self.get_status(force_fetch=False)}

                pull_res = self._run_git(["pull", "--ff-only", "origin", branch], timeout=45)
                if pull_res.returncode != 0:
                    self._run_git(["checkout", "HEAD", "--", "frigate-nvr/web/"], timeout=15)
                    pull_res = self._run_git(["pull", "--ff-only", "origin", branch], timeout=45)

                if pull_res.returncode != 0:
                    err = (pull_res.stderr or pull_res.stdout or "git pull --ff-only failed").strip()
                    self._state["last_error"] = err
                    self._save_settings()
                    return {"ok": False, "error": err, "status": self.get_status(force_fetch=False)}
            finally:
                # Guarantee that all local settings, users, branding, and camera configs are never overwritten
                self._restore_local_machine_files(local_snap)

            head_res = self._run_git(["rev-parse", "--short", "HEAD"], timeout=10)
            new_commit = head_res.stdout.strip() if head_res.returncode == 0 else "unknown"

            now_iso = _utc_now_iso()
            self._state["last_checked_at"] = now_iso
            self._state["last_web_sync_at"] = now_iso
            self._state["last_full_update_at"] = now_iso
            self._state["last_sync_commit"] = new_commit
            self._state["last_error"] = None
            self._save_settings()
            self._cached_status = None

            # 3. Signal service reload (Docker system-restarter or Native Supervisor)
            try:
                self.trigger_path.parent.mkdir(parents=True, exist_ok=True)
                self.trigger_path.write_text(now_iso, encoding="utf-8")
            except Exception as exc:
                logger.warning("Could not write update trigger file: %s", exc)

            if self.on_restart_requested is not None:
                threading.Thread(target=self.on_restart_requested, daemon=True).start()

            return {
                "ok": True,
                "updated_commit": new_commit,
                "updated_at": now_iso,
                "backup_path": backup_path_str,
                "protected_local_files": len(local_snap),
                "status": self.get_status(force_fetch=False),
            }

    def _background_loop(self) -> None:
        time.sleep(15)
        while not self._stop_event.is_set():
            try:
                if bool(self._state.get("auto_web_sync", True)) and self._git_available():
                    st = self.get_status(force_fetch=True)
                    if int(st.get("web_files_changed") or 0) > 0:
                        logger.info(
                            "Auto-sync detected %d changed web UI files on %s; hot-syncing...",
                            st["web_files_changed"],
                            st["branch"],
                        )
                        self.sync_web_ui_only()
            except Exception as exc:
                logger.warning("Auto web sync loop error: %s", exc)

            interval_sec = max(60, int(self._state.get("interval_minutes", 2)) * 60)
            self._stop_event.wait(interval_sec)

    def start_background_worker(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._background_loop,
            name="bpp-web-auto-sync",
            daemon=True,
        )
        self._thread.start()


_singleton_updater: Optional[SystemUpdater] = None


def get_system_updater() -> SystemUpdater:
    global _singleton_updater
    if _singleton_updater is None:
        _singleton_updater = SystemUpdater()
        _singleton_updater.start_background_worker()
    return _singleton_updater
