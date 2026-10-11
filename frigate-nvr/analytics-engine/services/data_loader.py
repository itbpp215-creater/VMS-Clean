"""
Live Data Loader for analytics-engine (BPP-VMS)

Reads real detection events from SQLite database (/lpr-config/watchlist.db)
and scans field case reports from NAS storage (/data/nas-storage/Cases).

Inputs:
    - DB path: /lpr-config/watchlist.db
    - NAS path: /data/nas-storage/Cases
Outputs:
    - list of LPR events and NAS case reports
Side effects:
    - Read-only file and SQLite access.
"""

import os
import glob
import json
import sqlite3
import logging
import time as _time
from typing import List, Dict, Any

logger = logging.getLogger("analytics.data_loader")

DB_PATH = os.environ.get("WATCHLIST_DB_PATH", "/lpr-config/watchlist.db")
NAS_STORAGE_PATH = os.environ.get("NAS_STORAGE_PATH", "/data/nas-storage")

_lpr_events_cache: Dict[str, Any] = {"data": None, "ts": 0.0}
_nas_reports_cache: Dict[str, Any] = {"data": None, "ts": 0.0}
_CACHE_TTL_SEC = 60.0  # 60-second cache to prevent recursive disk walks and excessive query load


def load_real_lpr_events() -> List[Dict[str, Any]]:
    """
    Fetch detection history events from SQLite database (cached with 60s TTL).
    """
    now = _time.time()
    if _lpr_events_cache["data"] is not None and (now - _lpr_events_cache["ts"]) < _CACHE_TTL_SEC:
        return _lpr_events_cache["data"]

    events = []
    if not os.path.exists(DB_PATH):
        logger.warning(f"Watchlist database not found at {DB_PATH}")
        _lpr_events_cache.update(data=events, ts=now)
        return events

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Check if lpr_events or detection_history table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row["name"] for row in cursor.fetchall()]

        if "detection_history" in tables:
            cursor.execute("SELECT * FROM detection_history ORDER BY id DESC LIMIT 500")
            for row in cursor.fetchall():
                row_dict = dict(row)
                events.append({
                    "plate": row_dict.get("license_plate") or row_dict.get("plate", ""),
                    "timestamp": row_dict.get("detected_at") or row_dict.get("created_at", ""),
                    "checkpoint": row_dict.get("camera_name") or row_dict.get("checkpoint", "Main Checkpoint"),
                    "lat": row_dict.get("lat"),
                    "lon": row_dict.get("lon")
                })
        elif "lpr_events" in tables:
            cursor.execute("SELECT * FROM lpr_events ORDER BY id DESC LIMIT 500")
            for row in cursor.fetchall():
                row_dict = dict(row)
                events.append({
                    "plate": row_dict.get("license_plate", ""),
                    "timestamp": row_dict.get("created_at", ""),
                    "checkpoint": row_dict.get("camera_name", "Main Checkpoint"),
                    "lat": row_dict.get("lat"),
                    "lon": row_dict.get("lon")
                })
        conn.close()
    except Exception as e:
        logger.error(f"Error reading SQLite LPR events: {e}")

    _lpr_events_cache.update(data=events, ts=now)
    return events


def load_real_nas_reports() -> List[Dict[str, Any]]:
    """
    Scan NAS cases directory for metadata.json files (cached with 60s TTL).
    """
    now = _time.time()
    if _nas_reports_cache["data"] is not None and (now - _nas_reports_cache["ts"]) < _CACHE_TTL_SEC:
        return _nas_reports_cache["data"]

    reports = []
    cases_dir = os.path.join(NAS_STORAGE_PATH, "Cases")
    if not os.path.exists(cases_dir):
        _nas_reports_cache.update(data=reports, ts=now)
        return reports

    pattern = os.path.join(cases_dir, "**", "metadata.json")
    meta_files = glob.glob(pattern, recursive=True)

    for meta_path in meta_files:
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                reports.append(data)
        except Exception:
            continue

    _nas_reports_cache.update(data=reports, ts=now)
    return reports
