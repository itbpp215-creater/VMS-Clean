"""
Autonomous NAS Sync and Video Archive/Restore Engine for BPP-VMS.

Provides:
1. Real-time background auto-sync of intelligence data (/data/nas-storage -> NAS //HOST/SHARE/nas-storage)
   with debouncing.
2. Periodic background video archiving (/media/recordings -> NAS //HOST/SHARE/recordings)
   for completed hours.
3. On-demand video retrieval & export:
   - Mode A (Evidence): Fetches chunk MP4s, merges them via ffmpeg into single incident MP4 in /media/exports
   - Mode B (Timeline): Restores chunk MP4s back to /media/recordings for native playback
4. Health & Status reporting.
"""

import os
import sys
import time
import json
import uuid
import ntpath
import shutil
import logging
import datetime
import threading
import subprocess
from typing import Dict, Any, List, Optional, Tuple

try:
    import smbclient
    import smbclient.path
    SMB_AVAILABLE = True
except ImportError:
    SMB_AVAILABLE = False

logger = logging.getLogger("nas-bot.sync_service")

class NASSyncService:
    """
    Autonomous service managing real-time data sync, video archiving, and
    on-demand video retrieval between the BPP-VMS container and Synology NAS.
    """

    def __init__(
        self,
        nas_host: Optional[str] = None,
        nas_share: Optional[str] = None,
        nas_username: Optional[str] = None,
        nas_password: Optional[str] = None,
        local_storage_path: Optional[str] = None,
        local_recordings_path: Optional[str] = None,
        local_exports_path: Optional[str] = None,
        temp_path: Optional[str] = None
    ):
        self.nas_host = nas_host or os.getenv("NAS_HOST", "192.168.1.100")
        self.nas_share = nas_share or os.getenv("NAS_SHARE", "BPP215")
        self.nas_username = nas_username or os.getenv("NAS_USERNAME", "Bpp215")
        self.nas_password = nas_password or os.getenv("NAS_PASSWORD", "ChangeMePassword123")

        self.sync_enabled = os.getenv("NAS_SYNC_ENABLED", "true").lower() in ("1", "true", "yes")
        self.debounce_sec = int(os.getenv("NAS_SYNC_DEBOUNCE_SEC", "8"))
        self.video_archive_enabled = os.getenv("NAS_VIDEO_ARCHIVE_ENABLED", "true").lower() in ("1", "true", "yes")
        self.video_archive_interval_min = int(os.getenv("NAS_VIDEO_ARCHIVE_INTERVAL_MIN", "15"))

        self.local_storage_path = local_storage_path or os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")
        self.local_recordings_path = local_recordings_path or os.getenv("LOCAL_RECORDINGS_PATH", "/media/recordings")
        self.local_exports_path = local_exports_path or os.getenv("LOCAL_EXPORTS_PATH", "/media/exports")
        self.archive_base = os.getenv("LOCAL_ARCHIVE_PATH", "/media/archive-e")
        self.archive_recordings_path = os.getenv("ARCHIVE_RECORDINGS_PATH", os.path.join(self.archive_base, "recordings"))
        self.archive_clips_path = os.getenv("ARCHIVE_CLIPS_PATH", os.path.join(self.archive_base, "clips"))
        self.local_lpr_crops_path = os.getenv("LOCAL_LPR_CROPS_PATH", "/media/lpr-crops")
        self.archive_crops_path = os.getenv("LOCAL_ARCHIVE_CROPS_PATH", os.path.join(self.archive_base, "lpr-crops"))
        self.temp_path = temp_path or "/data/nas-temp"
        self.cache_file = "/data/nas-sync-cache.json"
        self.archive_cache_file = "/data/nas-archive-cache.json"
        self.crops_cache_file = "/data/nas-crops-cache.json"

        # Threading and lifecycle
        self._stop_event = threading.Event()
        self._sync_thread: Optional[threading.Thread] = None
        self._archive_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Operational state
        self._is_connected = False
        self._last_check_time: Optional[str] = None
        self._last_sync_time: Optional[str] = None
        self._last_error: Optional[str] = None
        self._pending_files: Dict[str, Dict[str, Any]] = {}  # rel_path -> {"first_seen": float, "last_mtime": float, "last_size": int, "full_path": str}
        self._synced_cache: Dict[str, Tuple[float, int]] = {}  # rel_path -> (mtime, size)
        self._archived_hours_cache: Dict[str, bool] = {}  # "YYYY-MM-DD/HH" -> True
        self._synced_crops_cache: Dict[str, bool] = {}  # crop_filename -> True
        self._restore_tasks: Dict[str, Dict[str, Any]] = {}
        self._archive_status = {
            "last_run": None,
            "last_archived_hour": None,
            "synced_files_count": 0,
            "status": "idle",
            "error": None
        }

        self._load_caches()

    # -------------------------------------------------------------------------
    # Lifecycle & Connection
    # -------------------------------------------------------------------------

    def start(self):
        """Start the background sync and archiving threads."""
        if not SMB_AVAILABLE:
            logger.error("smbprotocol/smbclient is not installed! NAS sync engine disabled.")
            return

        try:
            os.makedirs(self.local_storage_path, exist_ok=True)
            os.makedirs(self.local_exports_path, exist_ok=True)
            os.makedirs(self.temp_path, exist_ok=True)
        except Exception as e:
            logger.warning(f"Error creating local directories: {e}")

        logger.info(
            f"Starting NASSyncService for NAS \\\\{self.nas_host}\\{self.nas_share} "
            f"(AutoSync: {self.sync_enabled}, VideoArchive: {self.video_archive_enabled})"
        )

        self._stop_event.clear()

        if self.sync_enabled and (self._sync_thread is None or not self._sync_thread.is_alive()):
            self._sync_thread = threading.Thread(target=self._sync_worker_loop, daemon=True, name="NASSyncWorker")
            self._sync_thread.start()

        if self.video_archive_enabled and (self._archive_thread is None or not self._archive_thread.is_alive()):
            self._archive_thread = threading.Thread(target=self._video_archive_loop, daemon=True, name="NASVideoArchiveWorker")
            self._archive_thread.start()

    def stop(self):
        """Stop background threads gracefully."""
        logger.info("Stopping NASSyncService background workers...")
        self._stop_event.set()
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=3)
        if self._archive_thread and self._archive_thread.is_alive():
            self._archive_thread.join(timeout=3)
        self._save_caches()
        logger.info("NASSyncService stopped.")

    def _register_smb_session(self) -> bool:
        """Register or verify SMB session with Synology NAS."""
        if not SMB_AVAILABLE:
            return False

        try:
            smbclient.register_session(
                self.nas_host,
                username=self.nas_username,
                password=self.nas_password,
                connection_timeout=4
            )
            # Test root share accessibility
            test_path = f"\\\\{self.nas_host}\\{self.nas_share}"
            exists = smbclient.path.exists(test_path)
            self._is_connected = exists
            self._last_check_time = datetime.datetime.now().isoformat()
            if exists:
                self._last_error = None
            else:
                self._last_error = f"Share '{self.nas_share}' not accessible on {self.nas_host}"
            return exists
        except Exception as e:
            self._is_connected = False
            self._last_check_time = datetime.datetime.now().isoformat()
            self._last_error = str(e)
            logger.debug(f"SMB session registration failed: {e}")
            return False

    def test_connection(self) -> Dict[str, Any]:
        """Test SMB connectivity to NAS and return detailed diagnostic status."""
        ok = self._register_smb_session()
        return {
            "connected": ok,
            "nas_host": self.nas_host,
            "nas_share": self.nas_share,
            "nas_user": self.nas_username,
            "last_check_time": self._last_check_time,
            "error": self._last_error
        }

    def get_status(self) -> Dict[str, Any]:
        """Return comprehensive live status for dashboard badge and APIs."""
        with self._lock:
            return {
                "enabled": self.sync_enabled,
                "video_archive_enabled": self.video_archive_enabled,
                "connected": self._is_connected,
                "nas_host": self.nas_host,
                "nas_share": self.nas_share,
                "last_check_time": self._last_check_time,
                "last_sync_time": self._last_sync_time,
                "pending_sync_count": len(self._pending_files),
                "synced_files_count": len(self._synced_cache),
                "archive_status": dict(self._archive_status),
                "active_restore_tasks": len([t for t in self._restore_tasks.values() if t.get("status") in ("pending", "running")]),
                "last_error": self._last_error
            }

    # -------------------------------------------------------------------------
    # File Sync & SMB Helpers
    # -------------------------------------------------------------------------

    def _smb_path(self, subpath: str) -> str:
        """Convert a relative Unix-style subpath to a Windows SMB UNC path."""
        clean = subpath.strip("/\\").replace("/", "\\")
        return f"\\\\{self.nas_host}\\{self.nas_share}\\{clean}"

    def _ensure_remote_dir(self, remote_dir_unc: str):
        """Recursively ensure a directory exists on the remote SMB share."""
        try:
            if not smbclient.path.exists(remote_dir_unc):
                smbclient.makedirs(remote_dir_unc, exist_ok=True)
        except Exception as e:
            logger.debug(f"ensure_remote_dir error for {remote_dir_unc}: {e}")

    def _upload_file(self, local_file: str, remote_file_unc: str) -> bool:
        """Stream copy local file to remote SMB file."""
        try:
            remote_dir = ntpath.dirname(remote_file_unc)
            self._ensure_remote_dir(remote_dir)

            with open(local_file, "rb") as src, smbclient.open_file(remote_file_unc, mode="wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)  # 1MB buffer
                    if not chunk:
                        break
                    dst.write(chunk)
            return True
        except Exception as e:
            logger.warning(f"Upload failed {local_file} -> {remote_file_unc}: {e}")
            self._is_connected = False
            self._last_error = str(e)
            return False

    def _download_file(self, remote_file_unc: str, local_file: str) -> bool:
        """Stream copy remote SMB file to local filesystem."""
        try:
            os.makedirs(os.path.dirname(local_file), exist_ok=True)
            with smbclient.open_file(remote_file_unc, mode="rb") as src, open(local_file, "wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
            return True
        except Exception as e:
            logger.warning(f"Download failed {remote_file_unc} -> {local_file}: {e}")
            return False

    # -------------------------------------------------------------------------
    # Caches (Persistence)
    # -------------------------------------------------------------------------

    def _load_caches(self):
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    self._synced_cache = {k: tuple(v) for k, v in raw.items()}
        except Exception as e:
            logger.warning(f"Failed to load sync cache: {e}")

        try:
            if os.path.exists(self.archive_cache_file):
                with open(self.archive_cache_file, "r", encoding="utf-8") as f:
                    self._archived_hours_cache = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load archive cache: {e}")

        try:
            if os.path.exists(self.crops_cache_file):
                with open(self.crops_cache_file, "r", encoding="utf-8") as f:
                    self._synced_crops_cache = json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load crops cache: {e}")

    def _save_caches(self):
        try:
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(self._synced_cache, f)
        except Exception as e:
            logger.debug(f"Failed to save sync cache: {e}")

        try:
            with open(self.archive_cache_file, "w", encoding="utf-8") as f:
                json.dump(self._archived_hours_cache, f)
        except Exception as e:
            logger.debug(f"Failed to save archive cache: {e}")

        try:
            with open(self.crops_cache_file, "w", encoding="utf-8") as f:
                json.dump(self._synced_crops_cache, f)
        except Exception as e:
            logger.debug(f"Failed to save crops cache: {e}")

    # -------------------------------------------------------------------------
    # Background Worker 1: Real-time Intelligence Data Auto-Sync
    # -------------------------------------------------------------------------

    def _scan_local_storage_changes(self):
        """Scan /data/nas-storage for new or modified files."""
        if not os.path.exists(self.local_storage_path):
            return

        now = time.time()
        for root, dirs, files in os.walk(self.local_storage_path):
            # Skip hidden directories, temp, or scratch
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("scratch", "tmp", ".system_generated")]

            for file_name in files:
                if file_name.startswith(".") or file_name.endswith(".tmp"):
                    continue

                full_path = os.path.join(root, file_name)
                try:
                    stat = os.stat(full_path)
                    mtime = stat.st_mtime
                    size = stat.st_size
                except OSError:
                    continue

                rel_path = os.path.relpath(full_path, self.local_storage_path).replace("\\", "/")

                cached = self._synced_cache.get(rel_path)
                if cached is None or cached[0] != mtime or cached[1] != size:
                    # New or modified file
                    if rel_path not in self._pending_files:
                        self._pending_files[rel_path] = {
                            "first_seen": now,
                            "last_mtime": mtime,
                            "last_size": size,
                            "full_path": full_path
                        }
                    else:
                        # Update mtime/size if still changing
                        if self._pending_files[rel_path]["last_mtime"] != mtime or self._pending_files[rel_path]["last_size"] != size:
                            self._pending_files[rel_path]["first_seen"] = now
                            self._pending_files[rel_path]["last_mtime"] = mtime
                            self._pending_files[rel_path]["last_size"] = size

    def _sync_worker_loop(self):
        """Main loop watching and syncing files to NAS with debouncing."""
        logger.info("NASSyncWorker thread started.")
        reconnect_timer = 0
        cache_save_timer = 0

        while not self._stop_event.is_set():
            try:
                # 1. Check SMB connection
                now = time.time()
                if not self._is_connected:
                    if now - reconnect_timer > 20:
                        reconnect_timer = now
                        self._register_smb_session()

                # 2. Scan for local file changes
                self._scan_local_storage_changes()

                # 3. Process debounce queue if connected
                if self._is_connected and self._pending_files:
                    ready_items = []
                    for rel_path, info in list(self._pending_files.items()):
                        # If file has been stable for debounce_sec
                        if now - info["first_seen"] >= self.debounce_sec:
                            ready_items.append((rel_path, info))

                    for rel_path, info in ready_items:
                        if self._stop_event.is_set():
                            break

                        full_path = info["full_path"]
                        if not os.path.exists(full_path):
                            self._pending_files.pop(rel_path, None)
                            continue

                        remote_unc = self._smb_path(f"nas-storage/{rel_path}")
                        success = self._upload_file(full_path, remote_unc)
                        if success:
                            self._synced_cache[rel_path] = (info["last_mtime"], info["last_size"])
                            self._pending_files.pop(rel_path, None)
                            self._last_sync_time = datetime.datetime.now().isoformat()
                            logger.info(f"Auto-synced to NAS: nas-storage/{rel_path}")
                        else:
                            # Connection interrupted, stop processing batch
                            break

                # 4. Periodically persist cache
                if now - cache_save_timer > 60:
                    cache_save_timer = now
                    self._save_caches()

            except Exception as e:
                logger.error(f"Error in NASSyncWorker loop: {e}", exc_info=True)

            self._stop_event.wait(5.0)

    # -------------------------------------------------------------------------
    # Background Worker 2: Hourly Video Archiving
    # -------------------------------------------------------------------------

    def _video_archive_loop(self):
        """Periodically archive closed recording hours to NAS."""
        logger.info("NASVideoArchiveWorker thread started.")

        # Initial delay to let startup settle
        self._stop_event.wait(15.0)

        while not self._stop_event.is_set():
            try:
                if self._is_connected:
                    self._archive_status["status"] = "checking"
                    if os.path.exists(self.local_recordings_path):
                        self._process_video_archives()
                    self._process_crop_archives()
                    self._archive_status["status"] = "idle"
                    self._archive_status["last_run"] = datetime.datetime.now().isoformat()
            except Exception as e:
                logger.error(f"Error in NASVideoArchiveWorker: {e}")
                self._archive_status["status"] = "error"
                self._archive_status["error"] = str(e)

            # Sleep interval
            self._stop_event.wait(self.video_archive_interval_min * 60)

    def _process_video_archives(self):
        """Iterate recording directories (SSD D: and Archive E:) and copy closed hours to NAS."""
        now = datetime.datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        current_hour = now.hour

        scan_bases = [self.local_recordings_path]
        if os.path.exists(self.archive_recordings_path) and self.archive_recordings_path != self.local_recordings_path:
            scan_bases.append(self.archive_recordings_path)

        for base_path in scan_bases:
            if self._stop_event.is_set():
                break

            try:
                date_dirs = sorted(os.listdir(base_path))
            except Exception:
                continue

            for date_str in date_dirs:
                if self._stop_event.is_set():
                    break

                date_path = os.path.join(base_path, date_str)
                if not os.path.isdir(date_path) or len(date_str) != 10:
                    continue

                try:
                    hour_dirs = sorted(os.listdir(date_path))
                except Exception:
                    continue

                for hour_str in hour_dirs:
                    if self._stop_event.is_set():
                        break

                    try:
                        hour_int = int(hour_str)
                    except ValueError:
                        continue

                    # Rule: ONLY archive closed hours!
                    if date_str > today_str:
                        continue
                    if date_str == today_str and hour_int >= current_hour:
                        continue

                    hour_key = f"{date_str}/{hour_str}"
                    if self._archived_hours_cache.get(hour_key):
                        continue

                    # Check if already marked as archived on NAS
                    remote_hour_unc = self._smb_path(f"recordings/{date_str}/{hour_str}")
                    marker_unc = f"{remote_hour_unc}\\.archived"
                    try:
                        if smbclient.path.exists(marker_unc):
                            self._archived_hours_cache[hour_key] = True
                            continue
                    except Exception:
                        pass

                    # Archive this hour
                    logger.info(f"Archiving completed recording hour: {hour_key} (from {base_path}) to NAS...")
                    self._archive_status["status"] = f"archiving {hour_key}"
                    success = self._archive_single_hour(date_path, date_str, hour_str)
                    if success:
                        self._archived_hours_cache[hour_key] = True
                        self._archive_status["last_archived_hour"] = hour_key
                        self._save_caches()

    def _archive_single_hour(self, date_path: str, date_str: str, hour_str: str) -> bool:
        """Upload all video chunks for a specific date and hour."""
        hour_local_path = os.path.join(date_path, hour_str)
        if not os.path.isdir(hour_local_path):
            return False

        all_ok = True
        synced_in_hour = 0

        for root, dirs, files in os.walk(hour_local_path):
            for file_name in files:
                if not file_name.endswith(".mp4"):
                    continue

                full_path = os.path.join(root, file_name)
                rel_to_hour = os.path.relpath(full_path, hour_local_path).replace("/", "\\")
                remote_file_unc = self._smb_path(f"recordings/{date_str}/{hour_str}\\{rel_to_hour}")

                try:
                    if smbclient.path.exists(remote_file_unc):
                        remote_size = smbclient.path.getsize(remote_file_unc)
                        local_size = os.path.getsize(full_path)
                        if remote_size == local_size:
                            continue
                except Exception:
                    pass

                ok = self._upload_file(full_path, remote_file_unc)
                if ok:
                    synced_in_hour += 1
                    self._archive_status["synced_files_count"] += 1
                else:
                    all_ok = False
                    break

            if not all_ok:
                break

        if all_ok:
            try:
                marker_unc = self._smb_path(f"recordings/{date_str}/{hour_str}\\.archived")
                with smbclient.open_file(marker_unc, mode="w") as f:
                    f.write(f"archived_at={datetime.datetime.now().isoformat()}\nfiles={synced_in_hour}")
                logger.info(f"Hour {date_str}/{hour_str} archived successfully ({synced_in_hour} files).")
                return True
            except Exception as e:
                logger.warning(f"Failed to create .archived marker on NAS: {e}")
                return False
        return False

    def _process_crop_archives(self):
        """Sync newly created and archived LPR detection crops to Synology NAS (crops/ folder)."""
        if not self._is_connected:
            return

        scan_bases = [self.local_lpr_crops_path]
        if os.path.exists(self.archive_crops_path) and self.archive_crops_path != self.local_lpr_crops_path:
            scan_bases.append(self.archive_crops_path)

        remote_crops_dir = self._smb_path("crops")
        try:
            self._ensure_remote_dir(remote_crops_dir)
        except Exception as e:
            logger.warning(f"Could not verify remote crops dir on NAS: {e}")
            return

        synced_count = 0
        for base_dir in scan_bases:
            if self._stop_event.is_set():
                break
            if not os.path.exists(base_dir):
                continue

            try:
                files = os.listdir(base_dir)
            except Exception:
                continue

            for f in files:
                if self._stop_event.is_set():
                    break
                if not (f.endswith(".jpg") or f.endswith(".webp") or f.endswith(".png")):
                    continue
                if self._synced_crops_cache.get(f):
                    continue

                local_path = os.path.join(base_dir, f)
                if not os.path.exists(local_path):
                    continue
                remote_unc = f"{remote_crops_dir}\\{f}"

                try:
                    success = self._upload_file(local_path, remote_unc)
                    if success:
                        self._synced_crops_cache[f] = True
                        synced_count += 1
                except Exception as e:
                    logger.debug(f"Failed to sync crop {f} to NAS: {e}")

        if synced_count > 0:
            logger.info(f"Synced {synced_count} LPR crops to Synology NAS (crops/)")
            self._save_caches()

    # -------------------------------------------------------------------------
    # On-Demand Video Retrieval Engine
    # -------------------------------------------------------------------------

    def list_available_dates(self, camera: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List all dates and available hours, showing whether files are on SSD (D:), Archive (E:), NAS, or combinations.
        """
        results: Dict[str, Dict[str, Any]] = {}

        # 1. Scan Local SSD (Tier 1)
        if os.path.exists(self.local_recordings_path):
            try:
                for date_name in os.listdir(self.local_recordings_path):
                    d_path = os.path.join(self.local_recordings_path, date_name)
                    if not os.path.isdir(d_path) or len(date_name) != 10:
                        continue

                    if date_name not in results:
                        results[date_name] = {"date": date_name, "ssd_hours": [], "archive_e_hours": [], "nas_hours": [], "cameras": set()}

                    for h_name in os.listdir(d_path):
                        h_path = os.path.join(d_path, h_name)
                        if os.path.isdir(h_path) and h_name.isdigit():
                            if camera:
                                cam_dir = os.path.join(h_path, camera)
                                if os.path.isdir(cam_dir) and any(f.endswith(".mp4") for f in os.listdir(cam_dir)):
                                    results[date_name]["ssd_hours"].append(int(h_name))
                                    results[date_name]["cameras"].add(camera)
                            else:
                                results[date_name]["ssd_hours"].append(int(h_name))
                                try:
                                    for c in os.listdir(h_path):
                                        if os.path.isdir(os.path.join(h_path, c)):
                                            results[date_name]["cameras"].add(c)
                                except Exception:
                                    pass
            except Exception as e:
                logger.debug(f"Local SSD dates scan error: {e}")

        # 2. Scan Local Drive E: Archive (Tier 2)
        if os.path.exists(self.archive_recordings_path):
            try:
                for date_name in os.listdir(self.archive_recordings_path):
                    d_path = os.path.join(self.archive_recordings_path, date_name)
                    if not os.path.isdir(d_path) or len(date_name) != 10:
                        continue

                    if date_name not in results:
                        results[date_name] = {"date": date_name, "ssd_hours": [], "archive_e_hours": [], "nas_hours": [], "cameras": set()}

                    for h_name in os.listdir(d_path):
                        h_path = os.path.join(d_path, h_name)
                        if os.path.isdir(h_path) and h_name.isdigit():
                            if camera:
                                cam_dir = os.path.join(h_path, camera)
                                if os.path.isdir(cam_dir) and any(f.endswith(".mp4") for f in os.listdir(cam_dir)):
                                    results[date_name]["archive_e_hours"].append(int(h_name))
                                    results[date_name]["cameras"].add(camera)
                            else:
                                results[date_name]["archive_e_hours"].append(int(h_name))
                                try:
                                    for c in os.listdir(h_path):
                                        if os.path.isdir(os.path.join(h_path, c)):
                                            results[date_name]["cameras"].add(c)
                                except Exception:
                                    pass
            except Exception as e:
                logger.debug(f"Drive E Archive dates scan error: {e}")

        # 3. Scan Remote NAS if connected (Tier 3)
        if self._is_connected:
            try:
                remote_rec_unc = self._smb_path("recordings")
                if smbclient.path.exists(remote_rec_unc):
                    for date_name in smbclient.listdir(remote_rec_unc):
                        if len(date_name) != 10:
                            continue
                        if date_name not in results:
                            results[date_name] = {"date": date_name, "ssd_hours": [], "archive_e_hours": [], "nas_hours": [], "cameras": set()}

                        remote_date_unc = f"{remote_rec_unc}\\{date_name}"
                        try:
                            for h_name in smbclient.listdir(remote_date_unc):
                                if h_name.isdigit():
                                    if camera:
                                        remote_cam_unc = f"{remote_date_unc}\\{h_name}\\{camera}"
                                        try:
                                            if smbclient.path.exists(remote_cam_unc):
                                                results[date_name]["nas_hours"].append(int(h_name))
                                                results[date_name]["cameras"].add(camera)
                                        except Exception:
                                            pass
                                    else:
                                        results[date_name]["nas_hours"].append(int(h_name))
                        except Exception:
                            pass
            except Exception as e:
                logger.debug(f"Remote NAS dates scan error: {e}")

        # Format and sort
        formatted = []
        for date_name, data in sorted(results.items(), reverse=True):
            ssd_set = set(data["ssd_hours"])
            archive_set = set(data["archive_e_hours"])
            nas_set = set(data["nas_hours"])
            all_hours = sorted(list(ssd_set | archive_set | nas_set))

            # If searching for specific camera and no hours found on any tier, skip
            if camera and not all_hours:
                continue

            loc_badges = []
            if ssd_set:
                loc_badges.append("ssd")
            if archive_set:
                loc_badges.append("archive_e")
            if nas_set:
                loc_badges.append("nas")

            storage_loc = "+".join(loc_badges) if loc_badges else "unknown"

            formatted.append({
                "date": date_name,
                "cameras": sorted(list(data["cameras"])),
                "hours": all_hours,
                "ssd_hours": sorted(list(ssd_set)),
                "archive_e_hours": sorted(list(archive_set)),
                "nas_hours": sorted(list(nas_set)),
                "local_hours_count": len(ssd_set),
                "archive_e_hours_count": len(archive_set),
                "nas_hours_count": len(nas_set),
                "storage_location": storage_loc
            })

        return formatted

    def start_restore(
        self,
        camera: str,
        date: str,
        start_hour: int,
        end_hour: int,
        mode: str = "evidence"
    ) -> str:
        """
        Initiate an asynchronous video restore job.
        mode:
          - 'evidence': Concatenates chunks into single evidence MP4 in /media/exports
          - 'timeline': Restores chunks back to /media/recordings for native playback
        Returns task_id.
        """
        task_id = f"restore_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        task_info = {
            "task_id": task_id,
            "camera": camera,
            "date": date,
            "start_hour": start_hour,
            "end_hour": end_hour,
            "mode": mode,
            "status": "pending",
            "progress": 0,
            "message": "กำลังเตรียมการกู้คืนวิดีโอจากคลังข้อมูล...",
            "created_at": datetime.datetime.now().isoformat(),
            "download_url": None,
            "filename": None,
            "size_bytes": 0,
            "error": None
        }

        with self._lock:
            self._restore_tasks[task_id] = task_info

        worker = threading.Thread(
            target=self._execute_restore_task,
            args=(task_id,),
            daemon=True,
            name=f"Restore-{task_id}"
        )
        worker.start()
        return task_id

    def get_restore_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get status of a specific restore task."""
        with self._lock:
            return self._restore_tasks.get(task_id)

    def _execute_restore_task(self, task_id: str):
        """Execute video restoration across SSD, Drive E: Archive, and NAS."""
        task = self._restore_tasks[task_id]
        camera = task["camera"]
        date = task["date"]
        start_hour = task["start_hour"]
        end_hour = task["end_hour"]
        mode = task["mode"]

        task["status"] = "running"
        task["progress"] = 5
        task["message"] = f"กำลังค้นหาไฟล์วิดีโอกล้อง {camera} วันที่ {date} ช่วง {start_hour:02d}:00 - {end_hour:02d}:59..."

        # List of tuples: (hour_int, chunk_filename, location_source, source_path)
        # location_source: 'ssd', 'archive_e', 'nas'
        chunks_to_fetch: List[Tuple[int, str, str, str]] = []

        for h in range(start_hour, end_hour + 1):
            h_str = f"{h:02d}"
            found_local_files = set()

            # 1. Tier 1: Local SSD D:
            local_cam_dir = os.path.join(self.local_recordings_path, date, h_str, camera)
            if os.path.isdir(local_cam_dir):
                for f in sorted(os.listdir(local_cam_dir)):
                    if f.endswith(".mp4"):
                        chunks_to_fetch.append((h, f, "ssd", os.path.join(local_cam_dir, f)))
                        found_local_files.add(f)

            # 2. Tier 2: Drive E: Archive
            archive_cam_dir = os.path.join(self.archive_recordings_path, date, h_str, camera)
            if os.path.isdir(archive_cam_dir):
                for f in sorted(os.listdir(archive_cam_dir)):
                    if f.endswith(".mp4") and f not in found_local_files:
                        chunks_to_fetch.append((h, f, "archive_e", os.path.join(archive_cam_dir, f)))
                        found_local_files.add(f)

            # 3. Tier 3: Remote Synology NAS
            if self._is_connected:
                remote_cam_unc = self._smb_path(f"recordings/{date}/{h_str}\\{camera}")
                try:
                    if smbclient.path.exists(remote_cam_unc):
                        for f in sorted(smbclient.listdir(remote_cam_unc)):
                            if f.endswith(".mp4") and f not in found_local_files:
                                chunks_to_fetch.append((h, f, "nas", f"{remote_cam_unc}\\{f}"))
                except Exception as e:
                    logger.debug(f"Error checking remote cam dir {remote_cam_unc}: {e}")

        chunks_to_fetch.sort(key=lambda x: (x[0], x[1]))

        if not chunks_to_fetch:
            task["status"] = "failed"
            task["error"] = f"ไม่พบไฟล์วิดีโอของกล้อง {camera} ในช่วงเวลาที่เลือกทั้งบน SSD, ไดรฟ์ E: คลังข้อมูล และ NAS"
            task["message"] = task["error"]
            return

        total_chunks = len(chunks_to_fetch)
        logger.info(f"Task {task_id}: Found {total_chunks} chunks to process (mode: {mode}).")

        task["progress"] = 15
        task["message"] = f"พบไฟล์บันทึก {total_chunks} ไฟล์ กำลังดำเนินการแบบ {mode}..."

        try:
            if mode == "evidence":
                self._handle_evidence_mode(task, chunks_to_fetch)
            elif mode == "timeline":
                self._handle_timeline_mode(task, chunks_to_fetch)
            else:
                task["status"] = "failed"
                task["error"] = f"Unknown mode: {mode}"
        except Exception as e:
            logger.error(f"Task {task_id} failed with error: {e}", exc_info=True)
            task["status"] = "failed"
            task["error"] = str(e)
            task["message"] = f"การประมวลผลล้มเหลว: {e}"

    def _handle_evidence_mode(self, task: Dict[str, Any], chunks: List[Tuple[int, str, str, str]]):
        """Fetch chunks into temporary workspace and stitch into single MP4 with ffmpeg."""
        task_id = task["task_id"]
        camera = task["camera"]
        date = task["date"]
        start_hour = task["start_hour"]
        end_hour = task["end_hour"]

        work_dir = os.path.join(self.temp_path, task_id)
        os.makedirs(work_dir, exist_ok=True)

        concat_list_file = os.path.join(work_dir, "concat.txt")
        total = len(chunks)
        local_chunk_paths = []

        for idx, (hour_int, filename, loc_src, src_path) in enumerate(chunks):
            target_chunk = os.path.join(work_dir, f"chunk_{idx:04d}_{hour_int:02d}_{filename}")
            if loc_src in ("ssd", "archive_e"):
                shutil.copy2(src_path, target_chunk)
            else:
                ok = self._download_file(src_path, target_chunk)
                if not ok:
                    logger.warning(f"Could not download chunk {src_path} from NAS.")
                    continue

            local_chunk_paths.append(target_chunk)
            pct = 15 + int((idx + 1) / total * 60)
            task["progress"] = pct
            src_label = "SSD/คลัง E:" if loc_src != "nas" else "NAS"
            task["message"] = f"กำลังดึงไฟล์จาก {src_label} ({idx + 1}/{total})..."

        if not local_chunk_paths:
            raise RuntimeError("ไม่สามารถรวบรวมไฟล์วิดีโอจากคลังข้อมูลได้")

        with open(concat_list_file, "w", encoding="utf-8") as f:
            for p in local_chunk_paths:
                safe_p = p.replace("'", "'\\''")
                f.write(f"file '{safe_p}'\n")

        task["progress"] = 80
        task["message"] = "กำลังรวมไฟล์คลิปวิดีโอเข้าเป็นไฟล์หลักฐานชุดเดียว (FFmpeg Stream Copy)..."

        export_filename = f"Evidence_{camera}_{date}_{start_hour:02d}00-{end_hour:02d}59.mp4"
        export_target = os.path.join(self.local_exports_path, export_filename)
        os.makedirs(self.local_exports_path, exist_ok=True)

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_file,
            "-c", "copy",
            export_target
        ]

        logger.info(f"Running ffmpeg concat: {' '.join(cmd)}")
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            raise RuntimeError(f"FFmpeg concat failed: {result.stderr[-200:]}")

        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass

        file_size = os.path.getsize(export_target) if os.path.exists(export_target) else 0

        task["status"] = "completed"
        task["progress"] = 100
        task["message"] = f"รวมไฟล์วิดีโอหลักฐานสำเร็จ ({file_size / (1024*1024):.2f} MB)"
        task["filename"] = export_filename
        task["download_url"] = f"/api/nas-bot/video-archive/download/{export_filename}"
        task["size_bytes"] = file_size

        logger.info(f"Task {task_id} completed successfully: {export_target}")

    def _handle_timeline_mode(self, task: Dict[str, Any], chunks: List[Tuple[int, str, str, str]]):
        """Restore missing chunks from Drive E: Archive or NAS back to /media/recordings so Timeline can play them."""
        camera = task["camera"]
        date = task["date"]
        total = len(chunks)
        restored_count = 0

        for idx, (hour_int, filename, loc_src, src_path) in enumerate(chunks):
            if loc_src == "ssd":
                continue  # Already present on SSD

            target_dir = os.path.join(self.local_recordings_path, date, f"{hour_int:02d}", camera)
            os.makedirs(target_dir, exist_ok=True)
            target_file = os.path.join(target_dir, filename)

            if loc_src == "archive_e":
                shutil.copy2(src_path, target_file)
                restored_count += 1
            elif loc_src == "nas":
                ok = self._download_file(src_path, target_file)
                if ok:
                    restored_count += 1

            pct = 15 + int((idx + 1) / total * 80)
            task["progress"] = pct
            task["message"] = f"กำลังกู้คืนไฟล์กลับสู่ SSD ({idx + 1}/{total})..."

        task["status"] = "completed"
        task["progress"] = 100
        task["message"] = f"กู้คืนไฟล์วิดีโอจำนวน {restored_count} ไฟล์กลับสู่ Timeline ของระบบเรียบร้อยแล้ว"
        logger.info(f"Task {task['task_id']} timeline restore completed: {restored_count} files restored.")


# Global service instance
nas_sync_service = NASSyncService()
