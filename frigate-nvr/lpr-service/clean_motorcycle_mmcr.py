#!/usr/bin/env python3
"""
Clean up MMCR hallucinations on motorcycles, trucks, buses, and mismatched body types.
Syncs ground truth labels with Frigate API and watchlist.db.
"""

import os
import sys
import json
import sqlite3
import urllib.request
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("clean_mmcr")

DB_PATH = "/data/watchlist.db" if os.path.exists("/data/watchlist.db") else "/lpr-config/watchlist.db"
FRIGATE_URL = os.environ.get("FRIGATE_URL", "http://frigate:5000")


def fetch_frigate_label(event_id: str) -> str:
    if not event_id:
        return ""
    url = f"{FRIGATE_URL}/api/events/{event_id}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MMCR-Cleaner/1.0"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("label", "")
    except Exception:
        pass
    return ""


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
    log.info("Starting MMCR ground truth verification and cleanup on: %s", DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        "SELECT id, event_id, plate_text, province, vehicle_type, vehicle_color, vehicle_brand, vehicle_model FROM lpr_candidates"
    )
    rows = cur.fetchall()
    log.info("Evaluating %d total candidates...", len(rows))

    cleaned_motorcycles = 0
    cleaned_mismatched = 0

    for row in rows:
        cand_id = row["id"]
        event_id = row["event_id"]
        v_type = row["vehicle_type"] or ""
        v_color = row["vehicle_color"] or "ไม่ระบุสี"
        v_brand = row["vehicle_brand"]
        v_model = row["vehicle_model"]
        plate = row["plate_text"] or ""
        prov = row["province"] or ""
        plate_str = f" [{plate} {prov}]".strip() if plate else ""

        frigate_label = fetch_frigate_label(event_id)

        # 1. Motorcycle Cleanup:
        if frigate_label == "motorcycle" or v_type in ("รถมอเตอร์ไซค์", "motorcycle"):
            new_type = "รถมอเตอร์ไซค์"
            new_desc = f"{new_type} {v_color}{plate_str}".strip()
            cur.execute(
                """
                UPDATE lpr_candidates
                SET vehicle_type = ?,
                    vehicle_brand = NULL,
                    vehicle_model = NULL,
                    description = ?
                WHERE id = ?
                """,
                (new_type, new_desc, cand_id),
            )
            set_frigate_description(event_id, new_desc)
            if v_brand is not None or v_type != "รถมอเตอร์ไซค์":
                cleaned_motorcycles += 1
            continue

        # 2. Truck Cleanup:
        if frigate_label == "truck" or v_type in ("รถบรรทุก", "truck"):
            new_type = "รถบรรทุก"
            new_desc = f"{new_type} {v_color}{plate_str}".strip()
            cur.execute(
                """
                UPDATE lpr_candidates
                SET vehicle_type = ?,
                    vehicle_brand = NULL,
                    vehicle_model = NULL,
                    description = ?
                WHERE id = ?
                """,
                (new_type, new_desc, cand_id),
            )
            set_frigate_description(event_id, new_desc)
            continue

        # 3. Bus Cleanup:
        if frigate_label == "bus" or v_type in ("รถบัส", "bus"):
            new_type = "รถบัส"
            new_desc = f"{new_type} {v_color}{plate_str}".strip()
            cur.execute(
                """
                UPDATE lpr_candidates
                SET vehicle_type = ?,
                    vehicle_brand = NULL,
                    vehicle_model = NULL,
                    description = ?
                WHERE id = ?
                """,
                (new_type, new_desc, cand_id),
            )
            set_frigate_description(event_id, new_desc)
            continue

        # 4. Mismatched Body Type & Car Model Check:
        # e.g., Pickups labeled as Mazda 2, or Vans labeled as Mazda 2
        if v_brand and v_model:
            is_mismatched = False
            if "รถกระบะ" in v_type and v_model in ("มาสด้า 2", "มาสด้า 3", "ซีวิค", "ซิตี้", "แอคคอร์ด", "ยาริส", "วีออส", "คัมรี่", "ดอลฟิน", "แอทโต 3", "โมเดล 3"):
                is_mismatched = True
            elif "รถตู้" in v_type and v_model in ("มาสด้า 2", "มาสด้า 3", "ซีวิค", "ซิตี้", "ดีแม็กซ์", "ไฮลักซ์ รีโว่", "ไฮลักซ์ วีโก้", "เรนเจอร์", "ไทรทัน", "นาวาร่า"):
                is_mismatched = True
            elif "รถ SUV" in v_type and v_model in ("มาสด้า 2", "มาสด้า 3", "ซีวิค", "ซิตี้", "ดีแม็กซ์", "ไฮลักซ์ รีโว่", "คอมมิวเตอร์", "ไฮเอซ"):
                is_mismatched = True

            if is_mismatched:
                clean_desc = f"{v_type} {v_color}{plate_str}".strip()
                cur.execute(
                    """
                    UPDATE lpr_candidates
                    SET vehicle_brand = NULL,
                        vehicle_model = NULL,
                        description = ?
                    WHERE id = ?
                    """,
                    (clean_desc, cand_id),
                )
                set_frigate_description(event_id, clean_desc)
                cleaned_mismatched += 1

    conn.commit()
    conn.close()
    log.info("Finished! Fixed %d motorcycle hallucinations, resolved %d mismatched body-type models.", cleaned_motorcycles, cleaned_mismatched)


if __name__ == "__main__":
    run()
