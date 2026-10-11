#!/usr/bin/env python3
"""
Re-classify historical vehicle candidates using the newly deployed Zero-Shot CLIP model.
Processes vehicle crops and Frigate snapshots, extracts make/model/color/type,
and outputs batch updates.
"""

import os
import sys
import json
import sqlite3
import urllib.request
import logging
import cv2
import numpy as np

from vehicle_mmcr import analyze_vehicle

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("reclassify_clip")

DB_PATH = "/lpr-config/watchlist.db"
CROPS_DIR = "/data/crops"
OUTPUT_PATH = "/data/clip_reclassify_updates.json"
FRIGATE_URL = os.environ.get("FRIGATE_URL", "http://frigate:5000")


def fetch_frigate_snapshot(event_id: str) -> np.ndarray:
    if not event_id:
        return None
    url = f"{FRIGATE_URL}/api/events/{event_id}/snapshot.jpg"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CLIP-Reclassify/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                arr = np.frombuffer(resp.read(), np.uint8)
                return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        pass
    return None


def set_frigate_description(event_id: str, description: str):
    if not description or not event_id:
        return
    url = f"{FRIGATE_URL}/api/events/{event_id}/description"
    payload = json.dumps({"description": description[:300]}).encode("utf-8")
    try:
        req = urllib.request.Request(
            url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            pass
    except Exception:
        pass


def run():
    log.info("Starting Historical CLIP Re-classification...")
    if not os.path.exists(DB_PATH):
        log.error("Database not found at %s", DB_PATH)
        return

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    cur = conn.cursor()
    cur.execute(
        "SELECT id, event_id, crop_path, plate_text, province, vehicle_type, vehicle_color FROM lpr_candidates ORDER BY id ASC"
    )
    rows = cur.fetchall()
    conn.close()

    log.info("Found %d candidates to re-classify.", len(rows))
    updates = []
    processed_crops = 0
    identified_brands = 0

    for i, (row_id, event_id, crop_path, plate, prov, old_type, old_color) in enumerate(rows, 1):
        img = None
        if crop_path:
            crop_file = os.path.join(CROPS_DIR, os.path.basename(crop_path))
            if os.path.isfile(crop_file):
                img = cv2.imread(crop_file)

        if img is None and event_id:
            img = fetch_frigate_snapshot(event_id)

        if img is not None and img.size > 0:
            res = analyze_vehicle(img, label="car", plate_text=plate or "", province=prov or "")
            brand = res.get("brand_th") or None
            model = res.get("model_th") or None
            if brand:
                identified_brands += 1
            v_type = res.get("body_type_th") or old_type or "รถยนต์"
            v_color = res.get("color_th") or old_color or "ไม่ระบุสี"
            desc = res.get("description") or f"{v_type} {v_color}"
            updates.append({
                "id": row_id,
                "event_id": event_id,
                "vehicle_type": v_type,
                "vehicle_color": v_color,
                "vehicle_brand": brand,
                "vehicle_model": model,
                "description": desc,
            })
            processed_crops += 1
            if desc and event_id:
                set_frigate_description(event_id, desc)
        else:
            # Fallback when no image could be retrieved
            v_type = old_type or "รถยนต์"
            v_color = old_color or "ไม่ระบุสี"
            plate_full = " ".join([p for p in [plate, prov] if p and p.strip()])
            desc = f"{v_type} {v_color}"
            if plate_full:
                desc = f"{desc} [{plate_full}]"
            updates.append({
                "id": row_id,
                "event_id": event_id,
                "vehicle_type": v_type,
                "vehicle_color": v_color,
                "vehicle_brand": None,
                "vehicle_model": None,
                "description": desc,
            })

        if i % 100 == 0 or i == len(rows):
            log.info("Progress: %d/%d processed (%d crops evaluated, %d brands identified)", i, len(rows), processed_crops, identified_brands)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(updates, f, ensure_ascii=False, indent=2)

    log.info("Re-classification complete! Saved %d updates to %s (Identified %d brands/models).", len(updates), OUTPUT_PATH, identified_brands)


if __name__ == "__main__":
    run()
