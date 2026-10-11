"""
Tiered Storage Archival Service for BPP-VMS.

Responsible for automatically transitioning historical recordings and event clips
from Tier 1 (Fast SSD on Drive D:) to Tier 2 (High-Capacity Archive HDD on Drive E:),
freeing SSD storage while keeping all historical data intact for permanent retention.

Architecture:
- Tier 1: /media/recordings and /media/clips (D: SSD)
- Tier 2: /media/archive-e/recordings and /media/archive-e/clips (E: Archive HDD ~1TB)
- Tier 3: Synology NAS (100.88.125.117 / BPP215)
"""

import os
import shutil
import time
import logging
import datetime
import threading
from typing import Dict, Any, Optional

logger = logging.getLogger("nas-bot.tiered_archiver")


class TieredStorageArchiver:
    """
    Background worker that monitors disk age and space on Tier 1 (SSD D:)
    and moves aged recording segments and event clips to Tier 2 (Archive E:).
    """

    def __init__(
        self,
        local_recordings_path: Optional[str] = None,
        local_clips_path: Optional[str] = None,
        archive_recordings_path: Optional[str] = None,
        archive_clips_path: Optional[str] = None,
        retention_recording_days: int = 3,
        retention_clip_days: int = 7,
        disk_threshold_percent: float = 15.0,
        interval_min: int = 15
    ):
        self.local_recordings_path = local_recordings_path or os.getenv("LOCAL_RECORDINGS_PATH", "/media/recordings")
        self.local_clips_path = local_clips_path or os.getenv("LOCAL_CLIPS_PATH", "/media/clips")
        self.archive_base = os.getenv("LOCAL_ARCHIVE_PATH", "/media/archive-e")
        self.archive_recordings_path = archive_recordings_path or os.path.join(self.archive_base, "recordings")
        self.archive_clips_path = archive_clips_path or os.path.join(self.archive_base, "clips")
        self.local_lpr_crops_path = os.getenv("LOCAL_LPR_CROPS_PATH", "/media/lpr-crops")
        self.archive_crops_path = os.getenv("LOCAL_ARCHIVE_CROPS_PATH", os.path.join(self.archive_base, "lpr-crops"))

        self.retention_recording_days = int(os.getenv("TIERED_STORAGE_RECORDING_DAYS", str(retention_recording_days)))
        self.retention_clip_days = int(os.getenv("TIERED_STORAGE_CLIP_DAYS", str(retention_clip_days)))
        self.retention_crop_days = int(os.getenv("TIERED_STORAGE_CROP_DAYS", "7"))
        self.disk_threshold_percent = float(os.getenv("STORAGE_MIN_FREE_PERCENT", str(disk_threshold_percent)))
        self.interval_min = int(os.getenv("TIERED_STORAGE_INTERVAL_MIN", str(interval_min)))

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        self._status = {
            "enabled": True,
            "last_run": None,
            "status": "idle",
            "total_recordings_moved": 0,
            "total_clips_moved": 0,
            "total_crops_moved": 0,
            "total_bytes_moved": 0,
            "last_error": None
        }

    def start(self):
        """Start the background archiver thread."""
        if not os.path.exists(self.archive_base):
            logger.warning(f"Archive destination {self.archive_base} does not exist. Tiered Archiver disabled.")
            self._status["enabled"] = False
            return

        try:
            os.makedirs(self.archive_recordings_path, exist_ok=True)
            os.makedirs(self.archive_clips_path, exist_ok=True)
        except Exception as e:
            logger.error(f"Cannot initialize archive folders: {e}")
            return

        logger.info(
            f"Starting TieredStorageArchiver (Recording Retention: {self.retention_recording_days}d, "
            f"Clip Retention: {self.retention_clip_days}d, Interval: {self.interval_min}m) -> {self.archive_base}"
        )

        self._stop_event.clear()
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._worker_loop, daemon=True, name="TieredStorageArchiver")
            self._thread.start()

    def stop(self):
        """Stop background archiver gracefully."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        logger.info("TieredStorageArchiver stopped.")

    def get_status(self) -> Dict[str, Any]:
        """Return operational metrics for UI/API."""
        with self._lock:
            return dict(self._status)

    def trigger_archive_now(self) -> Dict[str, Any]:
        """Trigger an immediate archival cycle."""
        logger.info("Manual archival cycle triggered.")
        threading.Thread(target=self._run_archival_cycle, daemon=True).start()
        return {"status": "started", "timestamp": datetime.datetime.now().isoformat()}

    def _worker_loop(self):
        """Periodic loop executing archival scans."""
        # Initial wait to let system finish startup
        self._stop_event.wait(30.0)

        while not self._stop_event.is_set():
            try:
                self._run_archival_cycle()
            except Exception as e:
                logger.error(f"Unexpected error in TieredStorageArchiver: {e}", exc_info=True)
                with self._lock:
                    self._status["status"] = "error"
                    self._status["last_error"] = str(e)

            self._stop_event.wait(self.interval_min * 60)

    def _run_archival_cycle(self):
        """Run a single archival check and move operation."""
        if not os.path.exists(self.archive_base):
            return

        with self._lock:
            self._status["status"] = "running"
            self._status["last_run"] = datetime.datetime.now().isoformat()

        logger.info("Starting Tiered Storage archival scan...")
        rec_moved, rec_bytes = self._archive_recordings()
        clip_moved, clip_bytes = self._archive_clips()
        crop_moved, crop_bytes = self._archive_crops()

        with self._lock:
            self._status["status"] = "idle"
            self._status["total_recordings_moved"] += rec_moved
            self._status["total_clips_moved"] += clip_moved
            self._status["total_crops_moved"] += crop_moved
            self._status["total_bytes_moved"] += (rec_bytes + clip_bytes + crop_bytes)
            self._status["last_error"] = None

        logger.info(
            f"Tiered Storage archival completed: {rec_moved} recordings ({rec_bytes / (1024*1024):.1f} MB), "
            f"{clip_moved} clips/snapshots ({clip_bytes / (1024*1024):.1f} MB), "
            f"{crop_moved} LPR crops ({crop_bytes / (1024*1024):.1f} MB) moved to Drive E:."
        )

    def _archive_recordings(self) -> (int, int):
        """Move recording folders older than retention days from D: to E:."""
        if not os.path.exists(self.local_recordings_path):
            return 0, 0

        now = datetime.datetime.now()
        # Cutoff date: anything strictly before cutoff is archived
        cutoff_date = (now - datetime.timedelta(days=self.retention_recording_days)).strftime("%Y-%m-%d")

        moved_files = 0
        moved_bytes = 0

        try:
            date_dirs = sorted(os.listdir(self.local_recordings_path))
        except Exception as e:
            logger.warning(f"Cannot list recordings directory: {e}")
            return 0, 0

        for date_str in date_dirs:
            if self._stop_event.is_set():
                break

            # Date format YYYY-MM-DD
            if len(date_str) != 10:
                continue

            local_date_path = os.path.join(self.local_recordings_path, date_str)
            if not os.path.isdir(local_date_path):
                continue

            # Check if this date qualifies for archiving
            if date_str < cutoff_date:
                archive_date_path = os.path.join(self.archive_recordings_path, date_str)
                os.makedirs(archive_date_path, exist_ok=True)

                try:
                    hour_dirs = sorted(os.listdir(local_date_path))
                except Exception:
                    continue

                for hour_str in hour_dirs:
                    if self._stop_event.is_set():
                        break

                    local_hour_path = os.path.join(local_date_path, hour_str)
                    if not os.path.isdir(local_hour_path):
                        continue

                    archive_hour_path = os.path.join(archive_date_path, hour_str)

                    # Move files inside hour folder
                    h_moved, h_bytes = self._move_directory_contents(local_hour_path, archive_hour_path)
                    moved_files += h_moved
                    moved_bytes += h_bytes

                    # Remove empty hour directory on D:
                    try:
                        if not os.listdir(local_hour_path):
                            os.rmdir(local_hour_path)
                    except Exception:
                        pass

                # Remove empty date directory on D:
                try:
                    if not os.listdir(local_date_path):
                        os.rmdir(local_date_path)
                except Exception:
                    pass

        return moved_files, moved_bytes

    def _archive_clips(self) -> (int, int):
        """Move snapshots and clip files older than retention days from D: to E:."""
        if not os.path.exists(self.local_clips_path):
            return 0, 0

        now_ts = time.time()
        cutoff_ts = now_ts - (self.retention_clip_days * 86400)

        moved_files = 0
        moved_bytes = 0

        for root, dirs, files in os.walk(self.local_clips_path):
            if self._stop_event.is_set():
                break

            # Skip cache directory
            dirs[:] = [d for d in dirs if d != "cache"]

            for file_name in files:
                # Target event snapshots (.jpg, .webp) and event clips (.mp4)
                if not (file_name.endswith(".jpg") or file_name.endswith(".webp") or file_name.endswith(".mp4")):
                    continue

                local_file = os.path.join(root, file_name)
                try:
                    stat = os.stat(local_file)
                    if stat.st_mtime >= cutoff_ts:
                        continue  # Still within active Tier 1 retention

                    rel_path = os.path.relpath(local_file, self.local_clips_path)
                    archive_file = os.path.join(self.archive_clips_path, rel_path)

                    os.makedirs(os.path.dirname(archive_file), exist_ok=True)
                    shutil.copy2(local_file, archive_file)

                    # Verify copy
                    if os.path.exists(archive_file) and os.path.getsize(archive_file) == stat.st_size:
                        os.remove(local_file)
                        moved_files += 1
                        moved_bytes += stat.st_size
                except Exception as e:
                    logger.debug(f"Error moving clip file {local_file}: {e}")

        # Clean empty directories
        for root, dirs, files in os.walk(self.local_clips_path, topdown=False):
            if root != self.local_clips_path:
                try:
                    if not os.listdir(root):
                        os.rmdir(root)
                except Exception:
                    pass

        return moved_files, moved_bytes

    def _archive_crops(self) -> (int, int):
        """Move LPR detection crops older than retention days from D: (SSD) to E: (Archive)."""
        if not os.path.exists(self.local_lpr_crops_path):
            return 0, 0

        now_ts = time.time()
        cutoff_ts = now_ts - (self.retention_crop_days * 86400)

        moved_files = 0
        moved_bytes = 0

        os.makedirs(self.archive_crops_path, exist_ok=True)

        try:
            for file_name in os.listdir(self.local_lpr_crops_path):
                if self._stop_event.is_set():
                    break

                if not (file_name.endswith(".jpg") or file_name.endswith(".webp") or file_name.endswith(".png")):
                    continue

                local_file = os.path.join(self.local_lpr_crops_path, file_name)
                if not os.path.isfile(local_file):
                    continue

                try:
                    stat = os.stat(local_file)
                    if stat.st_mtime >= cutoff_ts:
                        continue  # Keep within active SSD retention

                    archive_file = os.path.join(self.archive_crops_path, file_name)
                    shutil.copy2(local_file, archive_file)

                    # Verify copy
                    if os.path.exists(archive_file) and os.path.getsize(archive_file) == stat.st_size:
                        os.remove(local_file)
                        moved_files += 1
                        moved_bytes += stat.st_size
                except Exception as e:
                    logger.debug(f"Error moving LPR crop file {local_file}: {e}")
        except Exception as e:
            logger.warning(f"Error scanning local LPR crops directory {self.local_lpr_crops_path}: {e}")

        return moved_files, moved_bytes

    def _move_directory_contents(self, src_dir: str, dst_dir: str) -> (int, int):
        """Move all files from src_dir to dst_dir preserving subpaths."""
        moved_files = 0
        moved_bytes = 0

        for root, dirs, files in os.walk(src_dir):
            for f in files:
                src_path = os.path.join(root, f)
                rel_path = os.path.relpath(src_path, src_dir)
                dst_path = os.path.join(dst_dir, rel_path)

                try:
                    f_size = os.path.getsize(src_path)
                    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                    shutil.copy2(src_path, dst_path)

                    if os.path.exists(dst_path) and os.path.getsize(dst_path) == f_size:
                        os.remove(src_path)
                        moved_files += 1
                        moved_bytes += f_size
                except Exception as e:
                    logger.warning(f"Failed to move {src_path} -> {dst_path}: {e}")

        return moved_files, moved_bytes


# Global singleton instance
tiered_archiver = TieredStorageArchiver()
