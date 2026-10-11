"""
strict_daytime_scan.py — ระบบคัดกรองและสแกนป้ายทะเบียนความละเอียดสูงช่วงกลางวัน (Strict Quality)
สำหรับ BPP PrerimWatch

เกณฑ์คุณภาพเข้มงวด:
1. เวลา: 07:30 - 17:00 น. เท่านั้น (ตัดเช้ามืด/ค่ำ/กลางคืน 100%)
2. ขนาดภาพป้าย (Crop Resolution): กว้าง >= 60px และ สูง >= 30px เท่านั้น (ตัดภาพจิ๋ว/เบลอทิ้ง)
3. สัดส่วนกรอบ (Aspect Ratio): 0.70 <= w/h <= 3.80
4. การตรวจจับตัวอักษร: ต้องตรวจพบตัวอักษรไทยหรือตัวเลขอย่างน้อย 2 ตัวขึ้นไป (ตัดเงา/ล้อรถ/แผ่นเปล่าทิ้ง)
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
log = logging.getLogger("lpr-strict")

FRIGATE_BASE = os.environ.get("LPR_FRIGATE_BASE_URL", "http://frigate:5000")
DATA_DIR = os.environ.get("LPR_DATA_DIR", "/data")
CROPS_DIR = os.path.join(DATA_DIR, "crops")
MODEL_DIR = os.environ.get("LPR_MODEL_DIR", "/models")
DET_MODEL = os.path.join(MODEL_DIR, "license_plate.pt")
CHAR_MODEL = os.path.join(MODEL_DIR, "data_plate.pt")

os.makedirs(CROPS_DIR, exist_ok=True)


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


def clear_low_quality_samples():
    """ล้างภาพ Crop ที่มีขนาดเล็กเกินไป (<60x30) และรีเซ็ต sub_label ของรายการขยะ"""
    log.info("Cleaning up low quality and tiny crop images...")
    preserved_ids = {"1786788426.690276-lcs8ug", "1786349800.01072-jg84i2"}
    
    if os.path.exists(CROPS_DIR):
        for fname in os.listdir(CROPS_DIR):
            if not fname.endswith(".jpg"):
                continue
            event_id = fname[:-4]
            if event_id in preserved_ids:
                continue
            
            fpath = os.path.join(CROPS_DIR, fname)
            img = cv2.imread(fpath)
            if img is None:
                os.remove(fpath)
                continue
            
            h, w = img.shape[:2]
            # ลบรูปที่เล็กกว่า 60x30 หรือรูปที่กว้าง/สูงผิดสัดส่วน
            if w < 60 or h < 30:
                log.info("Removing tiny/blurry crop: %s (%dx%d)", fname, w, h)
                try:
                    os.remove(fpath)
                    # รีเซ็ต sub_label ใน Frigate
                    update_frigate_sub_label(event_id, "", score=0.0)
                except Exception as e:
                    log.debug("Error removing %s: %s", fname, e)


def load_strict_daytime_events(days=3):
    """ดึงเหตุการณ์รถเฉพาะช่วงกลางวัน 07:30 - 17:00 น."""
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
    strict_events = []
    for ev in events:
        label = ev.get("label")
        if label not in vehicle_labels:
            continue
        st = ev.get("start_time", 0)
        # แปลงเป็นเวลาไทย (UTC+7) เนื่องจาก Container เป็น UTC
        dt = datetime.datetime.fromtimestamp(st) + datetime.timedelta(hours=7)
        
        # เข้มงวดเฉพาะเวลา 07:30 ถึง 17:00 น. เท่านั้น
        minute_of_day = dt.hour * 60 + dt.minute
        if (7 * 60 + 30) <= minute_of_day <= (17 * 60):
            # ดึงเฉพาะกล้องทางเข้า-ออกที่รถชะลอความเร็ว
            if ev.get("camera") in ("nongwang5", "nongwang3"):
                strict_events.append(ev)

    log.info("Found %d strict daytime (07:30-17:00) vehicle events in past %d days", len(strict_events), days)
    return strict_events


def run_strict_scan(days=3, max_process=200):
    clear_low_quality_samples()
    
    events = load_strict_daytime_events(days=days)
    if not events:
        log.warning("No strict daytime vehicle events found.")
        return

    m_det = YOLO(DET_MODEL)
    m_char = YOLO(CHAR_MODEL)

    success_count = 0
    scanned_count = 0

    for ev in events[:max_process]:
        event_id = ev["id"]
        cam = ev.get("camera", "cam")
        st = ev.get("start_time", 0)
        # ใช้เวลาไทยใน log
        dt_str = (datetime.datetime.fromtimestamp(st) + datetime.timedelta(hours=7)).strftime("%Y-%m-%d %H:%M:%S")
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
                # สุ่ม 15 เฟรมกระจายทั่วคลิป
                sample_indices = set(np.linspace(5, max(5, total_frames - 5), num=min(15, max(1, total_frames - 6)), dtype=int))
                f_idx = 0

                while cap.isOpened() and f_idx < total_frames + 10:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if f_idx in sample_indices and frame is not None and frame.size > 0:
                        h, w = frame.shape[:2]
                        # ตรวจหากรอบป้าย
                        res_det = m_det(frame, imgsz=1280, conf=0.35, verbose=False)[0]
                        for b in res_det.boxes:
                            x1, y1, x2, y2 = map(int, b.xyxy[0])
                            bw, bh = x2 - x1, y2 - y1
                            
                            # 0. ตัดปัญหา AI ไปครอบโดนตัวอักษรชื่อกล้อง/เวลาที่ด้านบนจอ (Top 15%)
                            if y1 < h * 0.15:
                                log.debug("Rejected by y1: %s < %s", y1, h * 0.15)
                                continue

                            # 1. บังคับขนาดพิกเซลขั้นต่ำ: ต้องไม่ต่ำกว่า 60x30 px
                            if bw < 60 or bh < 30:
                                log.debug("Rejected by size: %sx%s", bw, bh)
                                continue
                                
                            ratio = bw / float(max(1, bh))
                            # 2. บังคับสัดส่วน Aspect Ratio ของแผ่นป้าย
                            if not (0.75 <= ratio <= 3.8):
                                log.debug("Rejected by ratio: %s", ratio)
                                continue

                            pad_w = int(bw * 0.10)
                            pad_h = int(bh * 0.10)
                            nx1 = max(0, x1 - pad_w)
                            ny1 = max(0, y1 - pad_h)
                            nx2 = min(w, x2 + pad_w)
                            ny2 = min(h, y2 + pad_h)
                            crop = frame[ny1:ny2, nx1:nx2]

                            if crop.size > 0 and crop.shape[1] >= 60 and crop.shape[0] >= 30:
                                res_char = m_char(crop, conf=0.25, verbose=False)[0]
                                chars = []
                                prov = ""
                                confs = []
                                
                                # เรียงกล่องตัวอักษรตามแกน X (ซ้าย -> ขวา)
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

                                # 3. บังคับว่าต้องมีตัวอักษร/ตัวเลขอย่างน้อย 2 ตัวขึ้นไป (ตัดภาพเงา/ล้อรถ/แผ่นว่าง)
                                if len(chars) >= 2:
                                    if len(chars) > len(best_chars) or (len(chars) == len(best_chars) and avg_conf > best_score):
                                        best_chars = chars
                                        best_province = prov
                                        best_crop = crop.copy()
                                        best_score = avg_conf
                                else:
                                    log.debug("Rejected by chars length: %s", chars)

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

        # บันทึกเฉพาะเมื่อได้ภาพ Crop ที่คมชัดและมีตัวอักษรจริง
        if best_crop is not None and best_crop.shape[1] >= 60 and best_crop.shape[0] >= 30 and len(best_chars) >= 2:
            plate_text = "".join(best_chars).strip()
            if best_province:
                plate_label = f"{plate_text} {best_province}"
            else:
                plate_label = plate_text

            cv2.imwrite(crop_path, best_crop)
            update_frigate_sub_label(event_id, plate_label, score=max(0.6, best_score))
            success_count += 1
            log.info("[%d/%d] STRICT SUCCESS: %s (%s, %s) -> Plate: %s (Crop size: %s)",
                     scanned_count, min(len(events), max_process), event_id, cam, dt_str, plate_label, best_crop.shape)

    log.info("Strict Scan Completed! Valid High-Quality Plates Cropped: %d/%d", success_count, scanned_count)


if __name__ == "__main__":
    days = 3
    max_ev = 150
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
    run_strict_scan(days=days, max_process=max_ev)
