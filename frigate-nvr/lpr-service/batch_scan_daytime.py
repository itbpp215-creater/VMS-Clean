"""
batch_scan_daytime.py — สแกนย้อนหลังและครอปภาพป้ายทะเบียนช่วงกลางวันเข้าสู่ระบบ LPR
สำหรับ BPP PrerimWatch

- ดึงรายการเหตุการณ์รถ (car, motorcycle, truck, bus) ช่วงกลางวัน (06:00 - 18:30) ในรอบ 3 วัน
- สแกนคลิปวิดีโอ 1080p เพื่อหากรอบป้ายทะเบียนและอ่านตัวอักษร
- ตัดภาพแผ่นป้ายที่คมชัดที่สุด บันทึกลง /data/crops/<event_id>.jpg
- อัปเดต sub_label ใน Frigate เพื่อให้แสดงผลในหมวด "ป้ายทะเบียน" ของคลังเหตุการณ์
- ผู้ปฏิบัติงานสามารถกดเข้าไปตรวจทานและกด "แก้ไข/สอน AI" ได้ทันที
"""

import os
import sys
import time
import json
import logging
import datetime
import tempfile
import urllib.request
import numpy as np
import cv2
from ultralytics import YOLO

from helper import get_thai_character, DATA_PROVINCE

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("lpr-batch")

FRIGATE_BASE = os.environ.get("LPR_FRIGATE_BASE_URL", "http://frigate:5000")
DATA_DIR = os.environ.get("LPR_DATA_DIR", "/data")
CROPS_DIR = os.path.join(DATA_DIR, "crops")
MODEL_DIR = os.environ.get("LPR_MODEL_DIR", "/models")
DET_MODEL = os.path.join(MODEL_DIR, "license_plate.pt")
CHAR_MODEL = os.path.join(MODEL_DIR, "data_plate.pt")

os.makedirs(CROPS_DIR, exist_ok=True)


def load_daytime_vehicle_events(days=3):
    after_ts = time.time() - (days * 86400)
    url = f"{FRIGATE_BASE}/api/events?after={int(after_ts)}&limit=10000&has_clip=1"
    log.info("Fetching vehicle events from Frigate: %s", url)
    try:
        req = urllib.request.urlopen(url, timeout=30)
        events = json.loads(req.read().decode())
    except Exception as e:
        log.error("Failed to fetch events: %s", e)
        return []

    vehicle_labels = {"car", "motorcycle", "truck", "bus"}
    daytime_events = []
    for ev in events:
        label = ev.get("label")
        if label not in vehicle_labels:
            continue
        st = ev.get("start_time", 0)
        dt = datetime.datetime.fromtimestamp(st)
        # Daytime 06:00 to 18:30
        if 6 <= dt.hour < 19:
            daytime_events.append(ev)

    log.info("Found %d daytime vehicle events in past %d days", len(daytime_events), days)
    return daytime_events


def update_frigate_sub_label(event_id, text, score=1.0):
    try:
        data = json.dumps({"subLabel": text, "subLabelScore": score}).encode("utf-8")
        req = urllib.request.Request(
            f"{FRIGATE_BASE}/api/events/{event_id}/sub_label",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception as e:
        log.debug("Update sub_label failed for %s: %s", event_id, e)
        return False


def run_batch_scan(days=3, max_process=200):
    log.info("Starting Daytime LPR Batch Scan (Days=%d, Max=%d)...", days, max_process)
    events = load_daytime_vehicle_events(days=days)
    if not events:
        log.warning("No daytime vehicle events found.")
        return

    m_det = YOLO(DET_MODEL)
    m_char = YOLO(CHAR_MODEL)

    success_count = 0
    scanned_count = 0

    # ประมวลผลจากเหตุการณ์ล่าสุด
    for ev in events[:max_process]:
        event_id = ev["id"]
        cam = ev.get("camera", "cam")
        st = ev.get("start_time", 0)
        dt_str = datetime.datetime.fromtimestamp(st).strftime("%Y-%m-%d %H:%M:%S")
        crop_path = os.path.join(CROPS_DIR, f"{event_id}.jpg")

        scanned_count += 1
        clip_url = f"{FRIGATE_BASE}/api/events/{event_id}/clip.mp4"

        tmp_path = None
        best_crop = None
        best_chars = []
        best_province = ""
        best_score = 0.0

        try:
            tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp_path = tmp.name
            tmp.close()
            urllib.request.urlretrieve(clip_url, tmp_path)
            cap = cv2.VideoCapture(tmp_path)

            if cap.isOpened():
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 100)
                # สุ่ม 12 เฟรมทั่วทั้งคลิป
                sample_indices = set(np.linspace(5, max(5, total_frames - 5), num=min(12, max(1, total_frames - 6)), dtype=int))
                f_idx = 0

                while cap.isOpened() and f_idx < total_frames + 10:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if f_idx in sample_indices and frame is not None and frame.size > 0:
                        h, w = frame.shape[:2]
                        # ตรวจหากรอบป้าย
                        res_det = m_det(frame, imgsz=1280, conf=0.28, verbose=False)[0]
                        for b in res_det.boxes:
                            x1, y1, x2, y2 = map(int, b.xyxy[0])
                            bw, bh = x2 - x1, y2 - y1
                            ratio = bw / float(max(1, bh))
                            # กรอง Aspect Ratio ป้ายทะเบียน
                            if not (0.70 <= ratio <= 4.0):
                                continue

                            pad_w = int(bw * 0.12)
                            pad_h = int(bh * 0.12)
                            nx1 = max(0, x1 - pad_w)
                            ny1 = max(0, y1 - pad_h)
                            nx2 = min(w, x2 + pad_w)
                            ny2 = min(h, y2 + pad_h)
                            crop = frame[ny1:ny2, nx1:nx2]

                            if crop.size > 0:
                                res_char = m_char(crop, conf=0.28, verbose=False)[0]
                                chars = []
                                prov = ""
                                confs = []
                                # แยกตัวอักษรและจังหวัด
                                sorted_boxes = sorted(res_char.boxes, key=lambda cb: cb.xyxy[0][0])
                                for cb in sorted_boxes:
                                    cls_code = m_char.names[int(cb.cls[0])]
                                    th_char = get_thai_character(cls_code)
                                    if cls_code in DATA_PROVINCE:
                                        prov = DATA_PROVINCE[cls_code]
                                    elif th_char:
                                        chars.append(th_char)
                                    confs.append(float(cb.conf[0]))

                                avg_conf = float(np.mean(confs)) if confs else 0.0

                                # ถ้าอ่านตัวอักษรได้มากกว่า
                                if len(chars) > len(best_chars) or (len(chars) == len(best_chars) and avg_conf > best_score):
                                    best_chars = chars
                                    best_province = prov
                                    best_crop = crop.copy()
                                    best_score = avg_conf

                                # หรือถ้ายังไม่มี crop เลย แต่เจอกรอบป้ายชัดเจน
                                if best_crop is None:
                                    best_crop = crop.copy()

                    f_idx += 1
                cap.release()
        except Exception as e:
            log.debug("Error scanning clip for %s: %s", event_id, e)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

        # ถ้าพบกรอบป้ายทะเบียน
        if best_crop is not None:
            plate_text = "".join(best_chars).strip()
            if plate_text:
                if best_province:
                    plate_label = f"{plate_text} {best_province}"
                else:
                    plate_label = plate_text
            else:
                plate_label = "[รอสอน AI]"

            # บันทึกภาพ crop
            cv2.imwrite(crop_path, best_crop)
            # อัปเดต sub_label ใน Frigate
            update_frigate_sub_label(event_id, plate_label, score=max(0.5, best_score))
            success_count += 1
            log.info("[%d/%d] SUCCESS: %s (%s, %s) -> Plate: %s (Crop size: %s)",
                     scanned_count, min(len(events), max_process), event_id, cam, dt_str, plate_label, best_crop.shape)

    log.info("Batch Scan Completed! Successfully processed and cropped %d/%d vehicle events.", success_count, scanned_count)


if __name__ == "__main__":
    days = 3
    max_ev = 100
    if len(sys.argv) > 1:
        try:
            days = int(sys.argv[1])
        except ValueError:
            pass
    if len(sys.argv) > 2:
        try:
            max_ev = int(sys.argv[2])
        except ValueError:
            pass
    run_batch_scan(days=days, max_process=max_ev)
