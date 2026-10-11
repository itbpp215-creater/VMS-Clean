#!/usr/bin/env python3
"""
BPP-VMS MMCR Historical Backfill Utility
Analyzes historical vehicle events and populates Color, Body Type, Make, and Model
in watchlist.db and Frigate event descriptions.
"""

import os
import sys
import sqlite3
import logging
import urllib.request
import urllib.error
import json
from typing import Optional, Dict, Any
import cv2
import numpy as np

from vehicle_mmcr import analyze_vehicle

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backfill_mmcr")

DB_PATH = os.environ.get("LPR_WATCHLIST_DB") or os.environ.get("WATCHLIST_DB_PATH", "/lpr-config/watchlist.db")
if not os.path.exists(DB_PATH) and os.path.exists("/data/watchlist.db"):
    DB_PATH = "/data/watchlist.db"
elif not os.path.exists(DB_PATH) and os.path.exists("config/lpr/watchlist.db"):
    DB_PATH = "config/lpr/watchlist.db"
elif not os.path.exists(DB_PATH) and os.path.exists("../config/lpr/watchlist.db"):
    DB_PATH = "../config/lpr/watchlist.db"

CROPS_DIR = os.environ.get("LPR_CROPS_DIR", "/lpr-data/crops")
if not os.path.exists(CROPS_DIR) and os.path.exists("data/crops"):
    CROPS_DIR = "data/crops"
elif not os.path.exists(CROPS_DIR) and os.path.exists("config/lpr/crops"):
    CROPS_DIR = "config/lpr/crops"

FRIGATE_URL = os.environ.get("FRIGATE_URL", "http://frigate:5000")


def fetch_frigate_snapshot(event_id: str) -> Optional[np.ndarray]:
    """Fetch event snapshot image from Frigate API."""
    urls = [
        f"{FRIGATE_URL}/api/events/{event_id}/snapshot.jpg",
        f"http://127.0.0.1:5000/api/events/{event_id}/snapshot.jpg",
        f"http://frigate-nvr:5000/api/events/{event_id}/snapshot.jpg",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "BPP-MMCR-Backfill/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    arr = np.frombuffer(resp.read(), np.uint8)
                    return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            continue
    return None


def set_frigate_description(event_id: str, description: str):
    """Set Frigate event description."""
    if not description:
        return
    urls = [
        f"{FRIGATE_URL}/api/events/{event_id}/description",
        f"http://127.0.0.1:5000/api/events/{event_id}/description",
        f"http://frigate-nvr:5000/api/events/{event_id}/description",
    ]
    payload = json.dumps({"description": description[:300]}).encode("utf-8")
    for url in urls:
        try:
            req = urllib.request.Request(
                url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status in (200, 201):
                    return
        except Exception:
            continue


def run_backfill():
    log.info("Starting MMCR Historical Backfill on DB: %s", DB_PATH)
    if not os.path.exists(DB_PATH):
        log.error("Database not found at %s", DB_PATH)
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Ensure columns exist
    existing_cols = {row[1] for row in c.execute("PRAGMA table_info(lpr_candidates)").fetchall()}
    for col, col_type in [
        ("vehicle_color", "TEXT"),
        ("vehicle_type", "TEXT"),
        ("vehicle_brand", "TEXT"),
        ("vehicle_model", "TEXT"),
        ("description", "TEXT"),
    ]:
        if col not in existing_cols:
            log.info("Adding missing column: %s", col)
            c.execute(f"ALTER TABLE lpr_candidates ADD COLUMN {col} {col_type}")
    conn.commit()

    rows = c.execute(
        """
        SELECT id, event_id, camera, plate_text, province, crop_path,
               vehicle_color, vehicle_type, vehicle_brand, vehicle_model, description
        FROM lpr_candidates
        ORDER BY id DESC
        """
    ).fetchall()

    log.info("Found %d candidate records in database.", len(rows))
    updated_count = 0

    for row in rows:
        cand_id = row["id"]
        event_id = row["event_id"]
        plate_text = row["plate_text"] or ""
        province = row["province"] or ""
        crop_path = row["crop_path"] or ""

        # Try to load crop image
        crop_img = None
        if crop_path:
            full_crop_path = os.path.join(CROPS_DIR, os.path.basename(crop_path))
            if os.path.exists(full_crop_path):
                crop_img = cv2.imread(full_crop_path)

        # Fallback to Frigate event snapshot
        if crop_img is None and event_id:
            crop_img = fetch_frigate_snapshot(event_id)

        if crop_img is None:
            # Fallback MMCR heuristic without image
            mmcr = analyze_vehicle(np.zeros((30, 30, 3), dtype=np.uint8), label="car", plate_text=plate_text, province=province)
        else:
            mmcr = analyze_vehicle(crop_img, label="car", plate_text=plate_text, province=province)

        v_color = mmcr.get("color_th") or "ไม่ระบุสี"
        v_type = mmcr.get("body_type_th") or "รถยนต์"
        v_brand = mmcr.get("brand_th") or ""
        v_model = mmcr.get("model_th") or ""
        v_desc = mmcr.get("description") or ""

        c.execute(
            """
            UPDATE lpr_candidates
            SET vehicle_color = ?,
                vehicle_type = ?,
                vehicle_brand = ?,
                vehicle_model = ?,
                description = ?
            WHERE id = ?
            """,
            (v_color, v_type, v_brand, v_model, v_desc, cand_id),
        )
        if v_desc and event_id:
            set_frigate_description(event_id, v_desc)

        updated_count += 1
        if updated_count % 100 == 0:
            conn.commit()
            log.info("Backfilled %d/%d candidates...", updated_count, len(rows))

    conn.commit()
    conn.close()
    log.info("MMCR Backfill complete! Successfully processed %d candidates.", updated_count)


if __name__ == "__main__":
    run_backfill()
