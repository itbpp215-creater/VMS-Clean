#!/usr/bin/env python3
"""
BPP-VMS UniEase Historical Recording Importer & GPU Vehicle Scanner
===================================================================
1. Pulls historical recordings from the Uniview NVR (กล้องโนนบุรี) via the local
   UniEase P2P RTSP Proxy at 16x speed (`/fast16/c{ch}/b{begin}/e{end}/replay`).
2. Aligns NVR `DeviceTime` (+2834s offset) with the cameras' real Thailand OSD
   timestamp so the BPP-VMS Playback Timeline matches the burned-in OSD clock
   to the exact second.
3. Slices streams into 60-second MP4 segments under `frigate-nvr/storage/recordings/`
   and registers them in `/db/frigate.db` (`recordings` table).
4. Runs YOLOv11m on CUDA (`RTX 5060 Ti`) over downloaded segments to extract and
   index all pickup truck / vehicle sightings with OSD timestamps and contact sheets.
"""

import argparse
import datetime
import glob
import json
import logging
import os
import random
import shutil
import string
import subprocess
import sys
import time

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP_ROOT = os.path.join(BASE_DIR, "frigate-nvr")
STORAGE_REC_DIR = os.path.join(APP_ROOT, "storage", "recordings")
RUNTIME_DIR = os.path.join(APP_ROOT, "runtime", "uniease-p2p")
WORK_DIR = os.path.join(RUNTIME_DIR, "sync_work")
CROPS_DIR = os.path.join(RUNTIME_DIR, "vehicle_crops")
SHEETS_DIR = os.path.join(RUNTIME_DIR, "contact_sheets")
STATE_FILE = os.path.join(RUNTIME_DIR, "history_sync_state.json")
SYNC_LOG = os.path.join(RUNTIME_DIR, "history_sync.log")

# Camera OSD clock is +2834 seconds (+47m 14s) ahead of NVR DeviceTime
OSD_OFFSET_SEC = 2834
TZ_TH = datetime.timezone(datetime.timedelta(hours=7))

CHANNEL_MAP = {
    1: ("nonburi1", "โนนบุรี 1 - สามแยกวัดกัลยาณบริหาร"),
    2: ("nonburi2", "โนนบุรี 2 - ลานร้านค้า"),
    4: ("nonburi4", "โนนบุรี 4 - แยกไฟแดง"),
    5: ("nonburi5", "โนนบุรี 5 - สามแยกไฟกระพริบ"),
    6: ("nonburi6", "โนนบุรี 6 - สี่แยกเกาะกลาง"),
}

os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(CROPS_DIR, exist_ok=True)
os.makedirs(SHEETS_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(SYNC_LOG, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("UniEaseHistorySync")


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"completed_chunks": [], "detections": []}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)


def get_ffprobe_duration(mp4_path, ffprobe_bin):
    try:
        out = subprocess.check_output(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
                mp4_path,
            ],
            timeout=10,
        ).decode().strip()
        return float(out)
    except Exception:
        return 0.0


def register_segments_in_frigate_db(rows):
    if not rows:
        return
    payload = json.dumps(rows)
    py_code = (
        "import sqlite3, json, sys; "
        "rows = json.loads(sys.stdin.read()); "
        "conn = sqlite3.connect('/db/frigate.db', timeout=30); "
        "cur = conn.cursor(); "
        "cur.executemany('INSERT OR REPLACE INTO recordings "
        "(id, camera, path, start_time, end_time, duration, objects, motion, segment_size, dBFS, regions, motion_heatmap) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', rows); "
        "conn.commit(); conn.close()"
    )
    subprocess.run(
        ["docker", "exec", "-i", "frigate-nvr", "python3", "-c", py_code],
        input=payload.encode("utf-8"),
        check=True,
        timeout=30,
    )


def pull_and_ingest_chunk(ch: int, osd_start: int, osd_end: int, stream: str = "main"):
    cam_id, _ = CHANNEL_MAP[ch]
    dur = osd_end - osd_start
    nvr_start = osd_start - OSD_OFFSET_SEC
    nvr_end = osd_end - OSD_OFFSET_SEC + 30

    ff = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    for f in glob.glob(os.path.join(WORK_DIR, "seg_*.mp4")):
        try:
            os.remove(f)
        except OSError:
            pass

    sub_part = "/s2" if stream == "sub" else ""
    rtsp_url = f"rtsp://admin:jaload14@127.0.0.1:18554/fast16/c{ch}{sub_part}/b{nvr_start}/e{nvr_end}/replay"
    cmd = [
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-t",
        str(dur),
        "-c",
        "copy",
        "-f",
        "segment",
        "-segment_time",
        "60",
        "-reset_timestamps",
        "1",
        os.path.join(WORK_DIR, "seg_%04d.mp4"),
    ]
    t0 = time.time()
    subprocess.run(cmd, timeout=max(45, int(dur / 4)))
    dt = time.time() - t0

    seg_files = sorted(glob.glob(os.path.join(WORK_DIR, "seg_*.mp4")))
    if not seg_files:
        logger.warning("No segments produced for %s [%d..%d]", cam_id, osd_start, osd_end)
        return []

    cur_ts = float(osd_start)
    db_rows = []
    saved_paths = []

    for sf in seg_files:
        seg_dur = get_ffprobe_duration(sf, ffprobe)
        if seg_dur <= 0.5:
            try:
                os.remove(sf)
            except OSError:
                pass
            continue
        dt_utc = datetime.datetime.fromtimestamp(cur_ts, datetime.timezone.utc)
        day_str = dt_utc.strftime("%Y-%m-%d")
        hour_str = dt_utc.strftime("%H")
        mm_ss = dt_utc.strftime("%M.%S")

        rel_dir = os.path.join(day_str, hour_str, cam_id)
        host_dir = os.path.join(STORAGE_REC_DIR, rel_dir)
        os.makedirs(host_dir, exist_ok=True)
        fname = f"{mm_ss}.mp4"
        dest_path = os.path.join(host_dir, fname)
        shutil.move(sf, dest_path)

        size_mb = round(os.path.getsize(dest_path) / (1024 * 1024), 2)
        rand_suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        rec_id = f"{int(cur_ts)}.0-{rand_suffix}"
        container_path = f"/media/frigate/recordings/{day_str}/{hour_str}/{cam_id}/{fname}"
        end_ts = round(cur_ts + seg_dur, 3)

        db_rows.append(
            (
                rec_id,
                cam_id,
                container_path,
                round(cur_ts, 3),
                end_ts,
                round(seg_dur, 3),
                0,
                1,
                size_mb,
                0,
                1,
                None,
            )
        )
        saved_paths.append((dest_path, cur_ts, seg_dur))
        cur_ts = end_ts

    register_segments_in_frigate_db(db_rows)
    logger.info(
        "Ingested %s [%s -> %s] (%d segs in %.1fs, %.1fx realtime)",
        cam_id,
        datetime.datetime.fromtimestamp(osd_start, TZ_TH).strftime("%Y-%m-%d %H:%M"),
        datetime.datetime.fromtimestamp(osd_end, TZ_TH).strftime("%H:%M"),
        len(saved_paths),
        dt,
        dur / max(0.1, dt),
    )
    return saved_paths


def _iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    if inter <= 0:
        return 0.0
    areaA = max(1, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    areaB = max(1, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))
    return inter / float(areaA + areaB - inter)


def scan_segments_for_vehicles(ch: int, segments, model, state):
    import cv2

    cam_id, _ = CHANNEL_MAP[ch]
    new_crops = []

    for mp4_path, seg_start_ts, _ in segments:
        cap = cv2.VideoCapture(mp4_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        step = max(1, int(round(fps / 2.0)))  # 2 fps sampling
        frame_idx = 0

        # Active tracks: list of dicts
        # {id, first_box, last_box, first_ts, last_ts, max_disp, best_score, best_cand, hits}
        active_tracks = []
        finished_tracks = []
        next_tid = 1

        while True:
            ret = cap.grab()
            if not ret:
                break
            if frame_idx % step == 0:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    h, w = frame.shape[:2]
                    ts_sec = seg_start_ts + (frame_idx / fps)
                    res = model.predict(frame, classes=[2, 7], conf=0.32, verbose=False, device=0)
                    boxes = res[0].boxes if res else []

                    dets = []
                    for b in boxes:
                        x1, y1, x2, y2 = [int(v) for v in b.xyxy[0].tolist()]
                        bw, bh = x2 - x1, y2 - y1
                        if bw < int(w * 0.075) or bh < int(h * 0.065):
                            continue
                        edge_penalty = 0.45 if (x1 <= 6 or x2 >= w - 6 or y2 >= h - 6) else 1.0
                        cls_id = int(b.cls[0])
                        cls_name = "truck" if cls_id == 7 else "car"
                        conf = float(b.conf[0])
                        # Slight bonus for truck class or pickup-sized aspect ratios
                        cls_bonus = 1.25 if cls_id == 7 else 1.0
                        score = float(bw * bh) * edge_penalty * conf * cls_bonus
                        dets.append(((x1, y1, x2, y2), score, cls_name, conf))

                    # Match detections to existing active_tracks
                    used_dets = set()
                    for trk in active_tracks:
                        best_j = -1
                        best_match_iou = 0.15
                        tcx = 0.5 * (trk["last_box"][0] + trk["last_box"][2])
                        tcy = 0.5 * (trk["last_box"][1] + trk["last_box"][3])
                        for j, (dbox, dscore, dcls, dconf) in enumerate(dets):
                            if j in used_dets:
                                continue
                            ov = _iou(trk["last_box"], dbox)
                            dcx = 0.5 * (dbox[0] + dbox[2])
                            dcy = 0.5 * (dbox[1] + dbox[3])
                            dist_norm = ((tcx - dcx) ** 2 + (tcy - dcy) ** 2) ** 0.5 / max(1.0, float(w))
                            # Match either by IoU or close centroid within 18% of screen width
                            eff_match = max(ov, 0.40 - dist_norm * 2.0 if dist_norm < 0.18 else 0.0)
                            if eff_match > best_match_iou:
                                best_match_iou = eff_match
                                best_j = j

                        if best_j >= 0:
                            used_dets.add(best_j)
                            dbox, dscore, dcls, dconf = dets[best_j]
                            trk["last_box"] = dbox
                            trk["last_ts"] = ts_sec
                            trk["hits"] += 1
                            fcx = 0.5 * (trk["first_box"][0] + trk["first_box"][2])
                            fcy = 0.5 * (trk["first_box"][1] + trk["first_box"][3])
                            dcx = 0.5 * (dbox[0] + dbox[2])
                            dcy = 0.5 * (dbox[1] + dbox[3])
                            disp = ((dcx - fcx) ** 2 + (dcy - fcy) ** 2) ** 0.5
                            if disp > trk["max_disp"]:
                                trk["max_disp"] = disp
                            if dscore > trk["best_score"]:
                                trk["best_score"] = dscore
                                trk["best_cand"] = (dscore, frame.copy(), dbox, ts_sec, dcls, dconf)
                            if dcls == "truck":
                                trk["saw_truck"] = True

                    # Create new tracks for unmatched detections
                    for j, (dbox, dscore, dcls, dconf) in enumerate(dets):
                        if j not in used_dets:
                            active_tracks.append(
                                {
                                    "id": next_tid,
                                    "first_box": dbox,
                                    "last_box": dbox,
                                    "first_ts": ts_sec,
                                    "last_ts": ts_sec,
                                    "max_disp": 0.0,
                                    "best_score": dscore,
                                    "best_cand": (dscore, frame.copy(), dbox, ts_sec, dcls, dconf),
                                    "hits": 1,
                                    "saw_truck": dcls == "truck",
                                }
                            )
                            next_tid += 1

                    # Flush expired tracks (not seen for > 2.0s)
                    still_active = []
                    for trk in active_tracks:
                        if ts_sec - trk["last_ts"] > 2.0:
                            finished_tracks.append(trk)
                        else:
                            still_active.append(trk)
                    active_tracks = still_active

            frame_idx += 1

        finished_tracks.extend(active_tracks)
        cap.release()

        # Filter moving tracks and deduplicate split tracks (e.g. behind road poles)
        moving_tracks = [t for t in finished_tracks if t["max_disp"] >= 45.0]
        moving_tracks.sort(key=lambda t: t["best_score"], reverse=True)
        kept_tracks = []
        for trk in moving_tracks:
            _, _, dbox, ts_sec, _, _ = trk["best_cand"]
            cx = 0.5 * (dbox[0] + dbox[2])
            cy = 0.5 * (dbox[1] + dbox[3])
            is_dup = False
            for ktrk in kept_tracks:
                _, _, kbox, kts, _, _ = ktrk["best_cand"]
                if abs(ts_sec - kts) <= 3.2:
                    kcx = 0.5 * (kbox[0] + kbox[2])
                    kcy = 0.5 * (kbox[1] + kbox[3])
                    dist = ((cx - kcx) ** 2 + (cy - kcy) ** 2) ** 0.5
                    if dist < 480 or _iou(dbox, kbox) > 0.15:
                        is_dup = True
                        if trk.get("saw_truck"):
                            ktrk["saw_truck"] = True
                        break
            if not is_dup:
                kept_tracks.append(trk)

        kept_tracks.sort(key=lambda t: t["best_cand"][3])
        for trk in kept_tracks:
            cand = trk["best_cand"]
            if trk.get("saw_truck") and cand[4] != "truck":
                cand = (cand[0], cand[1], cand[2], cand[3], "truck", cand[5])
            c_info = _save_vehicle_crop(ch, cam_id, cand)
            if c_info:
                new_crops.append(c_info)
                state["detections"].append(c_info)

    if new_crops:
        save_state(state)
        _build_contact_sheets(state["detections"])
    return new_crops


def _save_vehicle_crop(ch, cam_id, cand):
    import cv2

    _, frame, (x1, y1, x2, y2), ts_sec, cls_name, conf = cand
    h, w = frame.shape[:2]
    pad_x = int((x2 - x1) * 0.22)
    pad_y = int((y2 - y1) * 0.22)
    cx1 = max(0, x1 - pad_x)
    cy1 = max(0, y1 - pad_y)
    cx2 = min(w, x2 + pad_x)
    cv2_y2 = min(h, y2 + pad_y)
    crop = frame[cy1:cv2_y2, cx1:cx2].copy()
    if crop.size == 0:
        return None

    dt_str = datetime.datetime.fromtimestamp(ts_sec, TZ_TH).strftime("%Y-%m-%d %H:%M:%S")
    fname = f"{cam_id}_{int(ts_sec * 10)}_{cls_name}.jpg"
    fpath = os.path.join(CROPS_DIR, fname)
    cv2.imwrite(fpath, crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    return {
        "camera": cam_id,
        "channel": ch,
        "timestamp": round(ts_sec, 1),
        "datetime_th": dt_str,
        "class": cls_name,
        "conf": round(conf, 2),
        "crop_path": fpath,
        "bbox": [x1, y1, x2, y2],
    }


def _build_contact_sheets(detections, per_sheet=20, cols=5):
    import cv2
    import numpy as np

    if not detections:
        return
    tile_w, tile_h = 360, 240
    rows_cnt = (per_sheet + cols - 1) // cols

    for s_idx in range(0, len(detections), per_sheet):
        batch = detections[s_idx : s_idx + per_sheet]
        sheet_path = os.path.join(SHEETS_DIR, f"sheet_{s_idx // per_sheet:03d}.jpg")
        canvas = np.zeros((rows_cnt * tile_h, cols * tile_w, 3), dtype=np.uint8)
        for i, det in enumerate(batch):
            r = i // cols
            c = i % cols
            img = cv2.imread(det["crop_path"])
            if img is None:
                continue
            resized = cv2.resize(img, (tile_w, tile_h - 32))
            y0 = r * tile_h
            x0 = c * tile_w
            canvas[y0 + 32 : y0 + tile_h, x0 : x0 + tile_w] = resized
            cls_tag = "T" if det.get("class") == "truck" else "C"
            label = f"#{s_idx+i}[{cls_tag}] {det['camera']} {det['datetime_th'][5:]}"
            color = (0, 255, 255) if cls_tag == "T" else (200, 255, 200)
            cv2.putText(
                canvas,
                label,
                (x0 + 4, y0 + 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.50,
                color,
                1,
                cv2.LINE_AA,
            )
        cv2.imwrite(sheet_path, canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 90])


def _ts(dt_str: str) -> int:
    return int(datetime.datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ_TH).timestamp())


def main():
    import queue
    import threading

    parser = argparse.ArgumentParser()
    parser.add_argument("--channels", default="4,5,6,1,2", help="Comma-separated channel numbers")
    parser.add_argument("--start", default="2026-10-16 06:00:00", help="Start TH datetime YYYY-MM-DD HH:MM:SS")
    parser.add_argument("--end", default="2026-10-17 23:40:00", help="End TH datetime YYYY-MM-DD HH:MM:SS")
    parser.add_argument("--chunk-sec", type=int, default=900, help="Chunk duration in seconds")
    parser.add_argument("--stream", default="main", choices=["main", "sub"])
    parser.add_argument("--no-scan", action="store_true")
    parser.add_argument("--full-48h", action="store_true", help="Sync all of Oct 16 & Oct 17 prioritizing daytime first")
    args = parser.parse_args()

    ch_list = [int(x.strip()) for x in args.channels.split(",") if x.strip()]

    state = load_state()
    done_set = set(state.get("completed_chunks", []))

    scan_queue = queue.Queue(maxsize=32)

    def gpu_worker():
        if args.no_scan:
            while True:
                item = scan_queue.get()
                if item is None:
                    scan_queue.task_done()
                    break
                scan_queue.task_done()
            return

        from ultralytics import YOLO

        model_path = os.path.join(BASE_DIR, "yolo11m.pt")
        logger.info("Loading YOLO model from %s on GPU...", model_path)
        model = YOLO(model_path)

        while True:
            item = scan_queue.get()
            if item is None:
                scan_queue.task_done()
                break
            ch, c_start, c_end, segs, key = item
            try:
                crops = scan_segments_for_vehicles(ch, segs, model, state)
                logger.info(
                    "GPU Scan Ch %d [%s -> %s]: extracted %d moving vehicles (total=%d)",
                    ch,
                    datetime.datetime.fromtimestamp(c_start, TZ_TH).strftime("%m-%d %H:%M"),
                    datetime.datetime.fromtimestamp(c_end, TZ_TH).strftime("%H:%M"),
                    len(crops),
                    len(state["detections"]),
                )
                done_set.add(key)
                state["completed_chunks"] = sorted(done_set)
                save_state(state)
            except Exception as e:
                logger.error("GPU scan error on %s: %s", key, e)
            finally:
                scan_queue.task_done()

    worker_thread = threading.Thread(target=gpu_worker, daemon=True)
    worker_thread.start()

    chunks = []
    if args.full_48h:
        windows = [
            ("2026-10-17 06:00:00", "2026-10-17 18:30:00"),
            ("2026-10-16 06:00:00", "2026-10-16 18:30:00"),
            ("2026-10-17 18:30:00", "2026-10-17 23:45:00"),
            ("2026-10-16 18:30:00", "2026-10-17 06:00:00"),
            ("2026-10-16 00:00:00", "2026-10-16 06:00:00"),
        ]
        for w_start_s, w_end_s in windows:
            cur = _ts(w_start_s)
            w_end = _ts(w_end_s)
            while cur < w_end:
                nxt = min(w_end, cur + args.chunk_sec)
                for ch in ch_list:
                    chunks.append((ch, cur, nxt))
                cur = nxt
    else:
        t_start = _ts(args.start)
        t_end = _ts(args.end)
        cur = t_start
        while cur < t_end:
            nxt = min(t_end, cur + args.chunk_sec)
            for ch in ch_list:
                chunks.append((ch, cur, nxt))
            cur = nxt

    for ch, c_start, c_end in chunks:
        key = f"ch{ch}_{c_start}_{c_end}_{args.stream}"
        if key in done_set:
            continue
        try:
            segs = pull_and_ingest_chunk(ch, c_start, c_end, stream=args.stream)
            if segs:
                if args.no_scan:
                    done_set.add(key)
                    state["completed_chunks"] = sorted(done_set)
                    save_state(state)
                else:
                    scan_queue.put((ch, c_start, c_end, segs, key))
        except Exception as e:
            logger.error("Error processing chunk %s: %s", key, e)
            time.sleep(2)

    scan_queue.put(None)
    scan_queue.join()
    worker_thread.join(timeout=10)


if __name__ == "__main__":
    main()

