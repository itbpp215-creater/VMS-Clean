#!/usr/bin/env python3
"""
history_pull_worker.py — BPP-VMS Unified Multi-Camera Historical Pull & AI Vehicle Scanner Worker

Runs inside the frigate-nvr container (supervised by s6-svscan) where it has direct access to:
- /db/frigate.db (recordings & event tables)
- /media/frigate/recordings, /media/frigate/clips, /media/frigate/exports
- /config/config.yml & /config/camera_credentials.env (dynamic credential resolution, zero hardcoded secrets)
- NVIDIA RTX 5060 Ti GPU (onnxruntime-gpu + /config/model_cache/yolov9c.onnx + ffmpeg h264_nvenc)
- http://watchlist-api:5001/internal/history-pull-candidate (registers AI vehicle matches into watchlist.db)

Communicates with nas-bot-service REST API (/api/nas-bot/history-pull/*) via shared job files in:
  /media/frigate/exports/.history_jobs/ (mounted as /media/exports/.history_jobs/ in nas-bot-service)
"""

import os
import sys
import json
import time
import math
import glob
import shutil
import socket
import struct
import base64
import hashlib
import sqlite3
import logging
import datetime
import subprocess
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [HIST-PULL] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("history_pull_worker")

TZ_TH = datetime.timezone(datetime.timedelta(hours=7))
JOBS_DIR = Path("/media/frigate/exports/.history_jobs")
RECORDINGS_ROOT = Path("/media/frigate/recordings")
CLIPS_ROOT = Path("/media/frigate/clips")
THUMBS_ROOT = Path("/media/frigate/clips/thumbs")
FRIGATE_DB_PATH = "/db/frigate.db"
CONFIG_YML_PATH = Path("/config/config.yml")
CREDENTIALS_ENV_PATH = Path("/config/camera_credentials.env")
CAMERA_NAMES_PATH = Path("/config/dashboard-settings/storage-policy/../camera_names.json")
NVR_GROUPS_PATH = Path("/config/nvr_groups.json")
YOLO_MODEL_PATH = "/config/model_cache/yolov9c.onnx"
WATCHLIST_INTERNAL_URL = "http://watchlist-api:5001/internal/history-pull-candidate"

FFMPEG_BIN = "/usr/lib/ffmpeg/8.0/bin/ffmpeg"
if not os.path.exists(FFMPEG_BIN):
    FFMPEG_BIN = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE_BIN = "/usr/lib/ffmpeg/8.0/bin/ffprobe"
if not os.path.exists(FFPROBE_BIN):
    FFPROBE_BIN = shutil.which("ffprobe") or "ffprobe"

# COCO classes for vehicles
COCO_VEHICLE_CLASSES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

DEFAULT_CAMERA_LABELS = {
    "nonburi1": "โนนบุรี 1 (สามแยกวัดกัลยาณบริหาร)",
    "nonburi2": "โนนบุรี 2 (ลานร้านค้า)",
    "nonburi4": "โนนบุรี 4 (แยกไฟแดง)",
    "nonburi5": "โนนบุรี 5 (สามแยกไฟกระพริบ)",
    "nonburi6": "โนนบุรี 6 (สี่แยกเกาะกลาง)",
    "Doonsad1": "ดูนสาด 1 (โค้งดูนสาดไปนาคำน้อย)",
    "Doonsad5": "ดูนสาด 5 (อบต.ดูนสาด)",
    "Doonsad6": "ดูนสาด 6 (อบต.ดูนสาด)",
    "nongwang1": "หนองแวง 1 (หน้าเทศบาลหนองแวง)",
    "nongwang2": "หนองแวง 2 (ลานจอดรถเทศบาลฯ)",
    "nongwang3": "หนองแวง 3 (รร.บ้านร่วมจิต)",
    "nongwang4": "หนองแวง 4 (บ้านศรีทายาท)",
    "nongwang5": "หนองแวง 5 (ศูนย์ศิลปาชีพทหาร)",
    "nongwang6": "หนองแวง 6 (บ้านผไทรวมพล)",
    "nongwang7": "หนองแวง 7 (รร.บ้านปากช่อง)",
    "nongwang8": "หนองแวง 8 (ตลาดบ้านหนองหว้า)",
    "nongwang9": "หนองแวง 9 (สามแยกวัดเขาดิน)",
    "nongwang10": "หนองแวง 10 (บ้านปากช่อง 1)",
    "nongwang11": "หนองแวง 11 (บ้านปากช่อง 2)",
    "nongwang12": "หนองแวง 12 (บ้านหนองแวง)",
    "nongwang13": "หนองแวง 13 (ศูนย์เด็กเล็กบ้านหงอนไก่)",
    "nongwang14": "หนองแวง 14 (สี่แยกบ้านหงอนไก่)",
    "nongwang15": "หนองแวง 15 (ในบ้านหงอนไก่)",
    "D_BPP215_1": "ตชด.215 กล้อง 1 (หน้ากองร้อย)",
    "D_BPP215_2": "ตชด.215 กล้อง 2 (ป้อมยามหน้าค่าย)",
    "D_BPP215_3": "ตชด.215 กล้อง 3 (คลังอาวุธ)",
}


def load_env_vars() -> Dict[str, str]:
    """Load credentials dynamically from environment and /config/camera_credentials.env."""
    env_map = dict(os.environ)
    if CREDENTIALS_ENV_PATH.is_file():
        try:
            for line in CREDENTIALS_ENV_PATH.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_map[k.strip()] = v.strip().strip("'\"")
        except Exception as e:
            log.warning("Failed reading camera_credentials.env: %s", e)
    return env_map


def resolve_placeholders(text: str, env_map: Dict[str, str]) -> str:
    """Resolve {FRIGATE_*} and ${FRIGATE_*} placeholders using env_map."""
    import re
    def _repl(m):
        key = m.group(1) or m.group(2)
        return env_map.get(key, m.group(0))
    return re.sub(r"\$\{([A-Za-z0-9_]+)\}|\{([A-Za-z0-9_]+)\}", _repl, text or "")


def discover_cameras() -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Dynamically discover all historical-capable cameras from /config/config.yml + credentials.
    Returns:
      - internal_map: dict keyed by camera_id including resolved connection params (kept internal)
      - public_groups: list of NVR groups with safe camera metadata for UI display
    """
    import re
    import ruamel.yaml

    env_map = load_env_vars()
    internal_map: Dict[str, Dict[str, Any]] = {}

    # Load custom Thai display names if available
    custom_names: Dict[str, str] = dict(DEFAULT_CAMERA_LABELS)
    try:
        if NVR_GROUPS_PATH.is_file():
            nvr_data = json.loads(NVR_GROUPS_PATH.read_text(encoding="utf-8"))
            if isinstance(nvr_data, dict):
                for grp_name, grp_obj in nvr_data.items():
                    cams = grp_obj.get("cameras", {}) if isinstance(grp_obj, dict) else {}
                    if isinstance(cams, dict):
                        for cid, cinfo in cams.items():
                            if isinstance(cinfo, dict) and cinfo.get("name"):
                                custom_names[cid] = cinfo["name"]
    except Exception:
        pass

    streams: Dict[str, Any] = {}
    try:
        yaml = ruamel.yaml.YAML()
        with open(CONFIG_YML_PATH, encoding="utf-8") as f:
            cfg = yaml.load(f) or {}
        streams = (cfg.get("go2rtc") or {}).get("streams") or {}
    except Exception as e:
        log.error("Failed loading config.yml: %s", e)

    offline_skip = {"nonburi3", "nonburi7", "D_BPP215_4"}
    for cam_id, stream_def in streams.items():
        if (
            cam_id.endswith("_sub")
            or cam_id.endswith("_h264")
            or cam_id.endswith("_hd")
            or cam_id.lower().startswith("prasat")
            or cam_id in offline_skip
        ):
            continue
        raw_list = stream_def if isinstance(stream_def, list) else [stream_def]
        raw_str = " ".join(str(x) for x in raw_list if x)
        resolved = resolve_placeholders(raw_str, env_map)

        # 1. Uniview NVR (กล้องโนนบุรี): rtsp://user:pass@host:port/unicast/c{ch}/s0/live
        m_uv = re.search(r"rtsp://([^:@\s]+):([^@\s]+)@([^:/\s]+):(\d+)/unicast/c(\d+)/s\d+/live", resolved)
        if m_uv:
            user, pw, host, port, ch = m_uv.group(1), m_uv.group(2), m_uv.group(3), int(m_uv.group(4)), int(m_uv.group(5))
            internal_map[cam_id] = {
                "id": cam_id,
                "name": custom_names.get(cam_id, cam_id),
                "group_id": "nonburi",
                "group_name": "กล้องโนนบุรี (Uniview NVR 16x Fast Replay)",
                "protocol": "uniview_replay",
                "protocol_label": "Uniview 16x Replay + Local",
                "channel": ch,
                "host": host,
                "port": port,
                "user": user,
                "password": pw,
            }
            continue

        # 2. Dahua NVR (อบต.ดูนสาด): rtsp://user:pass@host:port/cam/realmonitor?channel={ch}
        m_dh = re.search(r"rtsp://([^:@\s]+):([^@\s]+)@([^:/\s]+):(\d+)/cam/realmonitor\?channel=(\d+)", resolved)
        if m_dh:
            user, pw, host, port, ch = m_dh.group(1), m_dh.group(2), m_dh.group(3), int(m_dh.group(4)), int(m_dh.group(5))
            internal_map[cam_id] = {
                "id": cam_id,
                "name": custom_names.get(cam_id, cam_id),
                "group_id": "doonsad",
                "group_name": "อบต.ดูนสาด (Dahua NVR RTSP Playback 1080p)",
                "protocol": "dahua_rtsp",
                "protocol_label": "Dahua RTSP Playback + Local",
                "channel": ch,
                "host": host,
                "port": port,
                "user": user,
                "password": pw,
            }
            continue

        # 3. TVT NVMS-9000 NVR (ทต.หนองแวง): rtsp://user:pass@host:port/chID={ch}&streamType=main
        m_tvt = re.search(r"rtsp://([^:@\s]+):([^@\s]+)@([^:/\s]+):(\d+)/chID=(\d+)&streamType=", resolved)
        if m_tvt and cam_id.lower().startswith("nongwang"):
            user, pw, host, rtsp_port, ch = m_tvt.group(1), m_tvt.group(2), m_tvt.group(3), int(m_tvt.group(4)), int(m_tvt.group(5))
            internal_map[cam_id] = {
                "id": cam_id,
                "name": custom_names.get(cam_id, cam_id),
                "group_id": "nongwang",
                "group_name": "ทต.หนองแวง (TVT NVMS-9000 WebSocket 1080p)",
                "protocol": "tvt_ws",
                "protocol_label": "TVT WebSocket HEVC + Local",
                "channel": ch,
                "host": host,
                "port": 88,
                "rtsp_port": rtsp_port,
                "user": user,
                "password": pw,
            }
            continue

        # 4. Hikvision / BPP215 Local NVR: rtsp://user:pass@host:port/Streaming/Channels/{ch}01
        m_hik = re.search(r"rtsp://([^:@\s]+):([^@\s]+)@([^:/\s]+):(\d+)/Streaming/Channels/(\d+)01", resolved)
        if m_hik:
            user, pw, host, port, ch = m_hik.group(1), m_hik.group(2), m_hik.group(3), int(m_hik.group(4)), int(m_hik.group(5))
            internal_map[cam_id] = {
                "id": cam_id,
                "name": custom_names.get(cam_id, cam_id),
                "group_id": "bpp215",
                "group_name": "ตชด.215 BPP215 (Local NVR Storage + Hikvision)",
                "protocol": "hikvision_local",
                "protocol_label": "Local Storage + Hikvision ISAPI",
                "channel": ch,
                "host": host,
                "port": port,
                "user": user,
                "password": pw,
            }
            continue

    # Build grouped public catalog (strictly stripped of credentials/hosts)
    group_order = [
        ("nonburi", "กล้องโนนบุรี (Uniview NVR 16x Fast Replay)"),
        ("nongwang", "ทต.หนองแวง (TVT NVMS-9000 WebSocket 1080p)"),
        ("doonsad", "อบต.ดูนสาด (Dahua NVR RTSP Playback 1080p)"),
        ("bpp215", "ตชด.215 BPP215 (Local NVR Storage + Hikvision)"),
    ]
    grouped: Dict[str, List[Dict[str, Any]]] = {g[0]: [] for g in group_order}
    for cid, info in internal_map.items():
        gid = info["group_id"]
        if gid not in grouped:
            grouped[gid] = []
        grouped[gid].append({
            "id": info["id"],
            "name": info["name"],
            "group_id": gid,
            "group_name": info["group_name"],
            "protocol": info["protocol"],
            "protocol_label": info["protocol_label"],
            "channel": info["channel"],
        })

    # Natural sort by channel number
    public_groups = []
    for gid, gname in group_order:
        cams = sorted(grouped.get(gid, []), key=lambda x: (x.get("channel", 999), x["id"]))
        if cams:
            public_groups.append({
                "group_id": gid,
                "group_name": gname,
                "camera_count": len(cams),
                "cameras": cams,
            })

    return internal_map, public_groups


def write_catalog_file(public_groups: List[Dict[str, Any]]) -> None:
    """Persist public camera catalog for nas-bot-service to serve cleanly."""
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    catalog_path = JOBS_DIR / "cameras_catalog.json"
    total_cams = sum(g["camera_count"] for g in public_groups)
    payload = {
        "updated_at": datetime.datetime.now(TZ_TH).isoformat(),
        "total_cameras": total_cams,
        "groups": public_groups,
    }
    tmp_path = JOBS_DIR / "cameras_catalog.json.tmp"
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(catalog_path)


# =============================================================================
# Video Probing & Segment Registration Helpers
# =============================================================================

def probe_video_duration(path: str) -> Tuple[float, int]:
    """Return (duration_sec, nb_frames) for an MP4 file using cv2."""
    if not os.path.isfile(path) or os.path.getsize(path) < 10000:
        return 0.0, 0
    try:
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return 0.0, 0
        fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
        n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        if fps <= 0 or n_frames <= 0:
            return 0.0, 0
        return float(n_frames) / float(fps), n_frames
    except Exception:
        return 0.0, 0


def target_recording_path(cam_id: str, seg_start: int) -> Path:
    """Compute Frigate's canonical UTC recording file path for seg_start."""
    dt_utc = datetime.datetime.fromtimestamp(seg_start, tz=datetime.timezone.utc)
    day_str = dt_utc.strftime("%Y-%m-%d")
    hour_str = dt_utc.strftime("%H")
    mm_ss = dt_utc.strftime("%M.%S")
    out_dir = RECORDINGS_ROOT / day_str / hour_str / cam_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"{mm_ss}.mp4"


def find_existing_segment(cam_id: str, seg_start: int, seg_end: int) -> Optional[str]:
    """Check if /db/frigate.db already has a valid recording file covering [seg_start, seg_end]."""
    try:
        conn = sqlite3.connect(FRIGATE_DB_PATH, timeout=10)
        rows = conn.execute(
            """
            SELECT path, start_time, end_time, duration
            FROM recordings
            WHERE camera = ? AND end_time > ? AND start_time < ?
            ORDER BY start_time ASC
            """,
            (cam_id, seg_start + 5, seg_end - 5),
        ).fetchall()
        conn.close()
        for r_path, _, _, _ in rows:
            if r_path and os.path.isfile(r_path) and os.path.getsize(r_path) > 20000:
                return r_path
    except Exception as e:
        log.warning("find_existing_segment error: %s", e)

    cand = target_recording_path(cam_id, seg_start)
    if cand.is_file() and cand.stat().st_size > 20000:
        register_recording_in_db(cam_id, str(cand), seg_start, seg_end)
        return str(cand)
    return None


def register_recording_in_db(cam_id: str, file_path: str, seg_start: int, seg_end: int) -> bool:
    """Insert or update a recording segment row in /db/frigate.db so Playback UI sees it."""
    if not os.path.isfile(file_path):
        return False
    size_mb = round(os.path.getsize(file_path) / (1024.0 * 1024.0), 3)
    dur, _ = probe_video_duration(file_path)
    if dur <= 1.0:
        dur = float(max(10, seg_end - seg_start))
    actual_end = float(seg_start) + min(float(seg_end - seg_start), dur)
    rec_id = f"{seg_start}.0-{cam_id}-hist"
    try:
        conn = sqlite3.connect(FRIGATE_DB_PATH, timeout=15)
        existing = conn.execute(
            "SELECT id FROM recordings WHERE path = ? LIMIT 1",
            (file_path,),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE recordings SET start_time = ?, end_time = ?, duration = ?, segment_size = ? WHERE id = ?",
                (float(seg_start), actual_end, float(actual_end - seg_start), size_mb, existing[0]),
            )
        else:
            conn.execute(
                """
                INSERT OR REPLACE INTO recordings
                (id, camera, path, start_time, end_time, duration, motion, objects, dBFS, segment_size)
                VALUES (?, ?, ?, ?, ?, ?, 100, 5, 0, ?)
                """,
                (rec_id, cam_id, file_path, float(seg_start), actual_end, float(actual_end - seg_start), size_mb),
            )
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        log.error("Failed registering recording in frigate.db: %s", e)
        return False


# =============================================================================
# Protocol Pullers (Uniview, Dahua, TVT WebSocket, Hikvision)
# =============================================================================

def pull_uniview_segment(cam_info: Dict[str, Any], seg_start: int, seg_end: int, out_path: Path) -> bool:
    """Pull 60s segment from Uniview NVR via 16x RTSP replay and normalize to 60s H.264 MP4."""
    user = urllib.parse.quote(cam_info["user"], safe="")
    pw = urllib.parse.quote(cam_info["password"], safe="")
    host = cam_info["host"]
    port = cam_info["port"]
    ch = cam_info["channel"]
    target_dur = max(10, seg_end - seg_start)

    raw_tmp = Path(f"/tmp/uv_raw_{cam_info['id']}_{seg_start}.mp4")
    enc_tmp = Path(f"/tmp/uv_enc_{cam_info['id']}_{seg_start}.mp4")
    try:
        # Use 16x fast replay first
        url_fast = f"rtsp://{user}:{pw}@{host}:{port}/fast16/c{ch}/b{seg_start}/e{seg_end}/replay"
        cmd_dump = [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp", "-timeout", "12000000",
            "-i", url_fast,
            "-t", "15", "-c:v", "copy", "-an",
            str(raw_tmp),
        ]
        subprocess.run(cmd_dump, timeout=22, check=False)

        if not raw_tmp.is_file() or raw_tmp.stat().st_size < 15000:
            # Fallback to 1x normal replay
            url_norm = f"rtsp://{user}:{pw}@{host}:{port}/c{ch}/b{seg_start}/e{seg_end}/replay"
            cmd_norm = [
                FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
                "-rtsp_transport", "tcp", "-timeout", "12000000",
                "-i", url_norm,
                "-t", str(target_dur), "-c:v", "copy", "-an",
                str(raw_tmp),
            ]
            subprocess.run(cmd_norm, timeout=target_dur + 15, check=False)

        if not raw_tmp.is_file() or raw_tmp.stat().st_size < 15000:
            return False

        raw_dur, n_frames = probe_video_duration(str(raw_tmp))
        # Stretch compressed fast16 PTS back to real-time target_dur
        if n_frames > 30 and raw_dur > 0.2 and raw_dur < target_dur * 0.5:
            scale_factor = round(float(target_dur) / float(raw_dur), 4)
            vf_str = f"setpts={scale_factor}*PTS,scale=1280:720"
        else:
            vf_str = "scale=1280:720"

        cmd_enc = [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(raw_tmp),
            "-vf", vf_str,
            "-r", "15",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            str(enc_tmp),
        ]
        subprocess.run(cmd_enc, timeout=45, check=False)
        if enc_tmp.is_file() and enc_tmp.stat().st_size > 20000:
            shutil.move(str(enc_tmp), str(out_path))
            return True
        return False
    except Exception as e:
        log.warning("pull_uniview_segment error (%s): %s", cam_info["id"], e)
        return False
    finally:
        for p in (raw_tmp, enc_tmp):
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass


def pull_dahua_segment(cam_info: Dict[str, Any], seg_start: int, seg_end: int, out_path: Path) -> bool:
    """Pull 60s segment from Dahua NVR via /cam/playback RTSP and transcode to browser H.264 MP4."""
    user = urllib.parse.quote(cam_info["user"], safe="")
    pw = urllib.parse.quote(cam_info["password"], safe="")
    host = cam_info["host"]
    port = cam_info["port"]
    ch = cam_info["channel"]
    target_dur = max(10, seg_end - seg_start)

    dt_s = datetime.datetime.fromtimestamp(seg_start, tz=TZ_TH).strftime("%Y_%m_%d_%H_%M_%S")
    dt_e = datetime.datetime.fromtimestamp(seg_end, tz=TZ_TH).strftime("%Y_%m_%d_%H_%M_%S")
    url = f"rtsp://{user}:{pw}@{host}:{port}/cam/playback?channel={ch}&subtype=0&starttime={dt_s}&endtime={dt_e}"

    enc_tmp = Path(f"/tmp/dh_enc_{cam_info['id']}_{seg_start}.mp4")
    try:
        cmd = [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp", "-timeout", "15000000",
            "-i", url,
            "-t", str(target_dur),
            "-vf", "scale=1280:720",
            "-r", "15",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            str(enc_tmp),
        ]
        subprocess.run(cmd, timeout=target_dur + 25, check=False)
        if enc_tmp.is_file() and enc_tmp.stat().st_size > 20000:
            shutil.move(str(enc_tmp), str(out_path))
            return True
        return False
    except Exception as e:
        log.warning("pull_dahua_segment error (%s): %s", cam_info["id"], e)
        return False
    finally:
        try:
            if enc_tmp.exists():
                enc_tmp.unlink()
        except Exception:
            pass


def _ws_recv_frame(sock: socket.socket, rbuf: bytes) -> Tuple[Optional[int], Optional[bytes], bytes]:
    while len(rbuf) < 2:
        chunk = sock.recv(65536)
        if not chunk:
            return None, None, rbuf
        rbuf += chunk
    b0, b1 = rbuf[0], rbuf[1]
    op = b0 & 0x0F
    ln = b1 & 0x7F
    idx = 2
    if ln == 126:
        while len(rbuf) < 4:
            chunk = sock.recv(65536)
            if not chunk:
                return None, None, rbuf
            rbuf += chunk
        ln = struct.unpack(">H", rbuf[2:4])[0]
        idx = 4
    elif ln == 127:
        while len(rbuf) < 10:
            chunk = sock.recv(65536)
            if not chunk:
                return None, None, rbuf
            rbuf += chunk
        ln = struct.unpack(">Q", rbuf[2:10])[0]
        idx = 10
    while len(rbuf) < idx + ln:
        chunk = sock.recv(65536)
        if not chunk:
            break
        rbuf += chunk
    return op, rbuf[idx : idx + ln], rbuf[idx + ln :]


def _ws_send_text(sock: socket.socket, txt: str) -> None:
    data = txt.encode("utf-8")
    ln = len(data)
    mask = os.urandom(4)
    hdr = bytearray([0x81])
    if ln < 126:
        hdr.append(0x80 | ln)
    elif ln < 65536:
        hdr.append(0x80 | 126)
        hdr.extend(struct.pack(">H", ln))
    else:
        hdr.append(0x80 | 127)
        hdr.extend(struct.pack(">Q", ln))
    hdr.extend(mask)
    masked = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
    sock.sendall(hdr + masked)


def pull_tvt_ws_segment(cam_info: Dict[str, Any], seg_start: int, seg_end: int, out_path: Path) -> bool:
    """Pull 60s segment from TVT NVMS-9000 NVR via WebSocket SHFL binary stream and encode to H.264 MP4."""
    host = cam_info["host"]
    port = cam_info["port"]
    user = cam_info["user"]
    pw = cam_info["password"]
    ch = int(cam_info["channel"])
    target_dur = max(10, seg_end - seg_start)

    hevc_tmp = Path(f"/tmp/tvt_raw_{cam_info['id']}_{seg_start}.hevc")
    enc_tmp = Path(f"/tmp/tvt_enc_{cam_info['id']}_{seg_start}.mp4")
    sock = None
    try:
        # Step 1: reqLogin
        req1 = urllib.request.Request(
            f"http://{host}:{port}/reqLogin",
            data=b'<?xml version="1.0" encoding="UTF-8"?><request version="1.0" systemType="NVMS-9000" clientType="WEB"/>',
            headers={"Content-Type": "application/xml"},
        )
        with urllib.request.urlopen(req1, timeout=10) as r1:
            cookie = (r1.headers.get("Set-Cookie") or "").split(";")[0]
            root1 = ET.fromstring(r1.read().decode("utf-8", errors="ignore"))
        nonce = root1.findtext(".//nonce") or ""
        sid = cookie.split("=")[1] if "=" in cookie else (root1.findtext(".//sessionId") or "")
        if not nonce or not sid:
            return False

        # Step 2: doLogin
        md5_pw = hashlib.md5(pw.encode("utf-8")).hexdigest().upper()
        sha512_pw = hashlib.sha512(f"{md5_pw}#{nonce}".encode("utf-8")).hexdigest()
        b64_user = base64.b64encode(user.encode("utf-8")).decode("ascii")
        b64_auth = base64.b64encode(sha512_pw.encode("utf-8")).decode("ascii")
        login_xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<request version="1.0" systemType="NVMS-9000" clientType="WEB">'
            "<types><loginType><enum>normal</enum><enum>register</enum></loginType></types>"
            f"<content><loginType>normal</loginType><userName>{b64_user}</userName><password>{b64_auth}</password></content>"
            "</request>"
        )
        req2 = urllib.request.Request(
            f"http://{host}:{port}/doLogin",
            data=login_xml.encode("utf-8"),
            headers={"Content-Type": "application/xml", "Cookie": cookie},
        )
        with urllib.request.urlopen(req2, timeout=10) as r2:
            resp2_xml = r2.read().decode("utf-8", errors="ignore")
        if "<status>success</status>" not in resp2_xml:
            log.warning("TVT doLogin failed for %s", cam_info["id"])
            return False

        # Step 3: WebSocket Playback
        sock = socket.create_connection((host, port), timeout=12)
        ws_key = base64.b64encode(os.urandom(16)).decode("ascii")
        handshake = (
            f"GET /requestWebsocketConnection?sessionID={sid} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Cookie: {cookie}\r\n\r\n"
        )
        sock.sendall(handshake.encode("utf-8"))
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        rem = buf.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in buf else b""

        # Wait for create_connection
        _, _, rem = _ws_recv_frame(sock, rem)
        _ws_send_text(
            sock,
            json.dumps({
                "url": "/device/create_connection#response",
                "head": {"seq": 1, "ver": "1.0"},
                "data": {"code": 0},
            }),
        )

        ch_guid = "{" + f"{ch:08x}".upper() + "-0000-0000-0000-000000000000}"
        _ws_send_text(
            sock,
            json.dumps({
                "url": "/device/playback/open",
                "head": {"ver": "1.0", "seq": 1},
                "data": {
                    "channel_id": ch_guid,
                    "start_time": int(seg_start),
                    "end_time": int(seg_end),
                    "stream_index": 0,
                },
            }),
        )

        max_frames = int(target_dur * 25) + 25
        v_frames = 0
        sock.settimeout(4.0)
        t_start = time.time()
        with open(hevc_tmp, "wb") as fw:
            while time.time() - t_start < target_dur + 20:
                try:
                    op, p, rem = _ws_recv_frame(sock, rem)
                    if op is None or p is None:
                        break
                    if op == 2 and len(p) > 24:
                        v0, jlen = struct.unpack_from("<II", p, 0)
                        hdr_off = 8 if v0 == 0 else 16
                        if hdr_off + jlen < len(p):
                            raw = p[hdr_off + jlen :]
                            if len(raw) >= 68 and raw[:4] == b"SHFL" and raw[8] == 1:
                                f_idx = struct.unpack_from("<I", raw, 36)[0]
                                ex_hdr = raw[45]
                                nal_len = struct.unpack_from("<I", raw, 48)[0]
                                nal = raw[68 + ex_hdr : 68 + ex_hdr + nal_len]
                                if nal:
                                    fw.write(nal)
                                    v_frames += 1
                                if f_idx % 8 == 0:
                                    _ws_send_text(
                                        sock,
                                        json.dumps({
                                            "url": "/device/playback/refresh_play_index",
                                            "head": {"ver": "1.0", "seq": 2},
                                            "data": {"play_frame_index": f_idx},
                                        }),
                                    )
                                if v_frames >= max_frames:
                                    break
                except socket.timeout:
                    break
                except Exception:
                    break

        if not hevc_tmp.is_file() or hevc_tmp.stat().st_size < 15000 or v_frames < 10:
            return False

        in_fps = max(5.0, min(30.0, round(float(v_frames) / float(target_dur), 2)))
        cmd_enc = [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-r", str(in_fps),
            "-f", "hevc", "-i", str(hevc_tmp),
            "-vf", "scale=1280:720",
            "-r", "15",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            str(enc_tmp),
        ]
        subprocess.run(cmd_enc, timeout=45, check=False)
        if enc_tmp.is_file() and enc_tmp.stat().st_size > 20000:
            shutil.move(str(enc_tmp), str(out_path))
            return True
        return False
    except Exception as e:
        log.warning("pull_tvt_ws_segment error (%s): %s", cam_info["id"], e)
        return False
    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass
        for p in (hevc_tmp, enc_tmp):
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass


def pull_hikvision_segment(cam_info: Dict[str, Any], seg_start: int, seg_end: int, out_path: Path) -> bool:
    """Pull 60s segment from Hikvision NVR via /Streaming/tracks/{ch}01 if available."""
    user = urllib.parse.quote(cam_info["user"], safe="")
    pw = urllib.parse.quote(cam_info["password"], safe="")
    host = cam_info["host"]
    port = cam_info["port"]
    ch = cam_info["channel"]
    target_dur = max(10, seg_end - seg_start)

    dt_s = datetime.datetime.fromtimestamp(seg_start, tz=datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dt_e = datetime.datetime.fromtimestamp(seg_end, tz=datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    url = f"rtsp://{user}:{pw}@{host}:{port}/Streaming/tracks/{ch}01?starttime={dt_s}&endtime={dt_e}"

    enc_tmp = Path(f"/tmp/hik_enc_{cam_info['id']}_{seg_start}.mp4")
    try:
        cmd = [
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp", "-timeout", "10000000",
            "-i", url,
            "-t", str(target_dur),
            "-vf", "scale=1280:720",
            "-r", "15",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
            str(enc_tmp),
        ]
        subprocess.run(cmd, timeout=target_dur + 15, check=False)
        if enc_tmp.is_file() and enc_tmp.stat().st_size > 20000:
            shutil.move(str(enc_tmp), str(out_path))
            return True
        return False
    except Exception:
        return False
    finally:
        try:
            if enc_tmp.exists():
                enc_tmp.unlink()
        except Exception:
            pass


def pull_or_get_segment(cam_info: Dict[str, Any], seg_start: int, seg_end: int) -> Optional[str]:
    """Return existing local recording path or pull from remote NVR and register in frigate.db."""
    cam_id = cam_info["id"]
    existing = find_existing_segment(cam_id, seg_start, seg_end)
    if existing:
        return existing

    out_path = target_recording_path(cam_id, seg_start)
    proto = cam_info.get("protocol", "")
    ok = False
    if proto == "uniview_replay":
        ok = pull_uniview_segment(cam_info, seg_start, seg_end, out_path)
    elif proto == "dahua_rtsp":
        ok = pull_dahua_segment(cam_info, seg_start, seg_end, out_path)
    elif proto == "tvt_ws":
        ok = pull_tvt_ws_segment(cam_info, seg_start, seg_end, out_path)
    elif proto == "hikvision_local":
        ok = pull_hikvision_segment(cam_info, seg_start, seg_end, out_path)

    if ok and out_path.is_file() and out_path.stat().st_size > 20000:
        register_recording_in_db(cam_id, str(out_path), seg_start, seg_end)
        return str(out_path)
    return None


# =============================================================================
# GPU AI Vehicle Scanner & Native Frigate Snapshot/Event Generator
# =============================================================================

_ORT_SESSION = None


def get_yolo_session():
    global _ORT_SESSION
    if _ORT_SESSION is not None:
        return _ORT_SESSION
    import onnxruntime as ort
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    try:
        _ORT_SESSION = ort.InferenceSession(YOLO_MODEL_PATH, providers=providers)
    except Exception:
        _ORT_SESSION = ort.InferenceSession(YOLO_MODEL_PATH, providers=["CPUExecutionProvider"])
    return _ORT_SESSION


def classify_crop_color_and_type(crop_bgr: np.ndarray, coco_label: str) -> Tuple[str, str, str]:
    """
    Classify vehicle color (Thai) and body type (Thai) from BGR crop.
    Returns (color_th, type_th, color_group_key).
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return "ไม่ระบุสี", "รถยนต์", "unknown"

    h, w = crop_bgr.shape[:2]
    y1, y2 = int(h * 0.22), int(h * 0.82)
    x1, x2 = int(w * 0.12), int(w * 0.88)
    body = crop_bgr[y1:y2, x1:x2]
    if body.size == 0:
        body = crop_bgr

    hsv = cv2.cvtColor(body, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(body, cv2.COLOR_BGR2LAB)
    h_ch, s_ch, v_ch = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    l_ch = lab[:, :, 0]

    valid = (v_ch >= 28) & (v_ch <= 248)
    n_valid = int(np.count_nonzero(valid))
    if n_valid < 15:
        color_th, color_key = "ไม่ระบุสี", "unknown"
    else:
        mean_s = float(np.mean(s_ch[valid]))
        mean_v = float(np.mean(v_ch[valid]))
        mean_l = float(np.mean(l_ch[valid]))
        if mean_s < 42:
            if mean_l > 170 or mean_v > 180:
                color_th, color_key = "สีขาว", "white"
            elif mean_l < 58 or mean_v < 55:
                color_th, color_key = "สีดำ", "black"
            elif mean_l >= 118 or mean_v >= 122:
                color_th, color_key = "สีบรอนซ์เงิน", "silver"
            else:
                color_th, color_key = "สีเทา", "silver"
        else:
            # Chromatic check
            red_m = (((h_ch <= 10) | (h_ch >= 165)) & (s_ch >= 50) & (v_ch >= 55))
            blue_m = ((h_ch >= 86) & (h_ch <= 135) & (s_ch >= 50) & (v_ch >= 45))
            green_m = ((h_ch >= 39) & (h_ch <= 85) & (s_ch >= 45) & (v_ch >= 45))
            yellow_m = ((h_ch >= 18) & (h_ch <= 38) & (s_ch >= 65) & (v_ch >= 90))
            counts = {
                ("สีแดง", "red"): int(np.count_nonzero(red_m)),
                ("สีน้ำเงิน", "blue"): int(np.count_nonzero(blue_m)),
                ("สีเขียว", "green"): int(np.count_nonzero(green_m)),
                ("สีเหลือง", "yellow"): int(np.count_nonzero(yellow_m)),
            }
            best_pair, best_cnt = max(counts.items(), key=lambda x: x[1])
            if best_cnt / float(n_valid) >= 0.15:
                color_th, color_key = best_pair
            elif mean_v > 165:
                color_th, color_key = "สีขาว", "white"
            elif mean_v < 65:
                color_th, color_key = "สีดำ", "black"
            else:
                color_th, color_key = "สีบรอนซ์เงิน", "silver"

    # Vehicle type classification
    if coco_label == "motorcycle":
        type_th = "รถมอเตอร์ไซค์"
    elif coco_label == "bus":
        type_th = "รถบัส"
    elif coco_label == "truck":
        aspect = float(w) / float(max(1, h))
        if aspect >= 1.25:
            type_th = "รถกระบะ"
        else:
            type_th = "รถบรรทุก"
    else:
        # car -> distinguish pickup vs sedan/SUV
        aspect = float(w) / float(max(1, h))
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        mid_x = int(w * 0.45)
        cab_u = gray[0 : int(h * 0.40), 0:mid_x]
        bed_u = gray[0 : int(h * 0.40), mid_x:w]
        bed_drop = 0.0
        if cab_u.size > 0 and bed_u.size > 0:
            bed_drop = (float(np.count_nonzero(cab_u > 35)) / cab_u.size) - (
                float(np.count_nonzero(bed_u > 35)) / bed_u.size
            )
        if bed_drop >= 0.14 or aspect >= 1.48:
            type_th = "รถกระบะ"
        else:
            type_th = "รถเก๋ง"

    return color_th, type_th, color_key


def matches_user_filter(
    coco_label: str,
    type_th: str,
    color_th: str,
    color_key: str,
    filter_type: str,
    filter_color: str,
) -> bool:
    """Evaluate if detected vehicle matches operator's filter criteria."""
    ft = (filter_type or "all").strip().lower()
    fc = (filter_color or "all").strip().lower()

    if ft and ft != "all":
        if ft == "pickup":
            if "กระบะ" not in type_th and coco_label not in ("car", "truck"):
                return False
            if coco_label == "motorcycle" or coco_label == "bus":
                return False
        elif ft == "sedan":
            if coco_label != "car":
                return False
        elif ft == "truck":
            if coco_label not in ("truck", "car") and "บรรทุก" not in type_th:
                return False
        elif ft == "motorcycle":
            if coco_label != "motorcycle":
                return False

    if fc and fc != "all":
        if fc == "white_silver":
            if color_key not in ("white", "silver"):
                return False
        elif fc == "white":
            if color_key != "white" and color_th != "สีขาว":
                return False
        elif fc == "silver":
            if color_key != "silver" and color_th not in ("สีบรอนซ์เงิน", "สีเทา"):
                return False
        elif fc == "black":
            if color_key != "black":
                return False
        elif fc == "red":
            if color_key != "red":
                return False
        elif fc == "blue":
            if color_key != "blue":
                return False

    return True


def write_frigate_event_and_snapshots(
    cam_id: str,
    cam_name: str,
    ev_ts: float,
    seg_end: float,
    frame_bgr: np.ndarray,
    box_xyxy: Tuple[int, int, int, int],
    coco_label: str,
    score: float,
    type_th: str,
    color_th: str,
    case_tag: str,
) -> Optional[Dict[str, Any]]:
    """
    Create native Frigate snapshot files (-clean.webp, .jpg with red bounding box, thumbs/.webp),
    insert event into /db/frigate.db, and register in watchlist.db.
    """
    CLIPS_ROOT.mkdir(parents=True, exist_ok=True)
    THUMBS_ROOT.mkdir(parents=True, exist_ok=True)

    fh, fw = frame_bgr.shape[:2]
    x1, y1, x2, y2 = box_xyxy
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(fw - 1, x2), min(fh - 1, y2)
    bw, bh = max(10, x2 - x1), max(10, y2 - y1)

    # Convert box area to 1280x720 detect canvas scale
    area_detect = int(round((bw / float(fw)) * 1280.0 * (bh / float(fh)) * 720.0))
    ev_id = f"{ev_ts:.6f}-{cam_id[:4]}hp"

    clean_webp_path = CLIPS_ROOT / f"{cam_id}-{ev_id}-clean.webp"
    snap_jpg_path = CLIPS_ROOT / f"{cam_id}-{ev_id}.jpg"
    thumb_webp_path = THUMBS_ROOT / f"{cam_id}-{ev_id}.webp"

    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil_clean = Image.fromarray(rgb)
    pil_clean.save(str(clean_webp_path), "WEBP", quality=85)

    # Draw Frigate-style red bounding box + label pill
    pil_annot = pil_clean.copy()
    draw = ImageDraw.Draw(pil_annot)
    box_color = (220, 38, 38)
    for t in range(3):
        draw.rectangle([x1 - t, y1 - t, x2 + t, y2 + t], outline=box_color)

    disp_label = "car" if coco_label in ("car", "truck") else coco_label
    label_txt = f"{disp_label}: {int(round(score * 100))}% {area_detect}"
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
    tb = draw.textbbox((0, 0), label_txt, font=font)
    tw, th_txt = tb[2] - tb[0], tb[3] - tb[1]
    ly1 = max(0, y1 - th_txt - 8)
    ly2 = ly1 + th_txt + 8
    draw.rectangle([x1, ly1, x1 + tw + 12, ly2], fill=box_color)
    draw.text((x1 + 6, ly1 + 3), label_txt, fill=(255, 255, 255), font=font)
    pil_annot.save(str(snap_jpg_path), "JPEG", quality=92)

    # Cropped thumbnail
    pad_x, pad_y = int(bw * 0.25), int(bh * 0.25)
    cx1, cy1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
    cx2, cy2 = min(fw, x2 + pad_x), min(fh, y2 + pad_y)
    pil_crop = pil_clean.crop((cx1, cy1, cx2, cy2))
    pil_crop.thumbnail((320, 320))
    pil_crop.save(str(thumb_webp_path), "WEBP", quality=85)

    # Encode crop to base64 JPEG for watchlist-api
    import io
    buf = io.BytesIO()
    pil_crop.save(buf, format="JPEG", quality=88)
    crop_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    dt_th = datetime.datetime.fromtimestamp(ev_ts, tz=TZ_TH)
    time_str = dt_th.strftime("%H:%M:%S")
    tag_clean = (case_tag or "").strip()
    desc_parts = [p for p in [tag_clean, f"{type_th} {color_th}".strip(), f"({cam_name} เวลา {time_str} น.)"] if p]
    full_desc = " — ".join(desc_parts)
    sub_label_val = tag_clean if tag_clean else f"{type_th} {color_th}".strip()

    norm_box = [
        round(x1 / float(fw), 4),
        round(y1 / float(fh), 4),
        round(bw / float(fw), 4),
        round(bh / float(fh), 4),
    ]
    data_json = json.dumps(
        {
            "box": norm_box,
            "region": [0.0, 0.0, 1.0, 1.0],
            "score": round(float(score), 4),
            "top_score": round(float(score), 4),
            "type": "object",
            "sub_label_score": 0.95,
            "description": full_desc,
            "attributes": [],
        },
        ensure_ascii=False,
    )

    start_time = max(ev_ts - 4.0, float(int(ev_ts // 60) * 60))
    end_time = min(ev_ts + 8.0, float(seg_end))

    try:
        conn = sqlite3.connect(FRIGATE_DB_PATH, timeout=15)
        conn.execute(
            """
            INSERT OR REPLACE INTO event
            (id, label, camera, start_time, end_time, top_score, false_positive, zones,
             thumbnail, has_clip, has_snapshot, region, box, area, retain_indefinitely,
             sub_label, plus_id, model_hash, detector_type, model_type, data)
            VALUES (?, ?, ?, ?, ?, ?, 0, '[]', '', 1, 1, '[]', ?, ?, 1, ?, NULL, 'yolov9c', 'onnx', 'yolo-generic', ?)
            """,
            (
                ev_id,
                disp_label,
                cam_id,
                start_time,
                end_time,
                round(float(score), 4),
                json.dumps(norm_box),
                area_detect,
                sub_label_val,
                data_json,
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.error("Failed inserting event into frigate.db: %s", e)
        return None

    # Register in watchlist.db via watchlist-api internal endpoint
    try:
        created_utc = datetime.datetime.fromtimestamp(ev_ts, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        req_body = json.dumps({
            "event_id": ev_id,
            "camera": cam_id,
            "plate_text": tag_clean or "ไม่พบทะเบียน",
            "province": cam_name,
            "vehicle_type": type_th,
            "vehicle_color": color_th,
            "description": full_desc,
            "detector_confidence": round(float(score), 4),
            "crop_base64": crop_b64,
            "created_at": created_utc,
        }).encode("utf-8")
        req = urllib.request.Request(
            WATCHLIST_INTERNAL_URL,
            data=req_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=6).read()
    except Exception as e:
        log.warning("Failed syncing event %s to watchlist-api: %s", ev_id, e)

    return {
        "event_id": ev_id,
        "camera": cam_id,
        "camera_name": cam_name,
        "timestamp": round(ev_ts, 2),
        "time_str": dt_th.strftime("%Y-%m-%d %H:%M:%S"),
        "label": disp_label,
        "vehicle_type": type_th,
        "vehicle_color": color_th,
        "score": round(float(score), 3),
        "case_tag": sub_label_val,
        "snapshot_url": f"/api/events/{ev_id}/snapshot.jpg",
        "clip_url": f"/api/events/{ev_id}/clip.mp4",
    }


def scan_segment_for_vehicles(
    cam_info: Dict[str, Any],
    seg_path: str,
    seg_start: int,
    seg_end: int,
    filter_type: str,
    filter_color: str,
    case_tag: str,
) -> List[Dict[str, Any]]:
    """Run GPU YOLOv9c across a 60s recording segment and create native Frigate events for matches."""
    if not os.path.isfile(seg_path):
        return []

    sess = get_yolo_session()
    in_name = sess.get_inputs()[0].name

    cap = cv2.VideoCapture(seg_path)
    if not cap.isOpened():
        return []
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    if fps <= 0 or fps > 120:
        fps = 15.0
    step_frames = max(1, int(round(fps * 1.0)))  # Sample 1 frame per second

    candidates = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step_frames == 0:
            fh, fw = frame.shape[:2]
            # Ignore top 10% OSD timestamp banner
            inp = cv2.resize(frame, (640, 640))
            inp_rgb = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            inp_tensor = np.transpose(inp_rgb, (2, 0, 1))[None, ...]

            preds = sess.run(None, {in_name: inp_tensor})[0][0]  # (84, 8400)
            preds = preds.T  # (8400, 84)
            boxes = preds[:, :4]
            scores_all = preds[:, 4:]

            # Keep best vehicle detection in this frame
            best_det = None
            for cls_id, coco_lbl in COCO_VEHICLE_CLASSES.items():
                cls_scores = scores_all[:, cls_id]
                idxs = np.where(cls_scores >= 0.38)[0]
                for i in idxs:
                    sc = float(cls_scores[i])
                    cx, cy, bw, bh = boxes[i]
                    if cy < 70 or bw < 28 or bh < 24:
                        continue
                    x1 = int((cx - bw / 2.0) * fw / 640.0)
                    y1 = int((cy - bh / 2.0) * fh / 640.0)
                    x2 = int((cx + bw / 2.0) * fw / 640.0)
                    y2 = int((cy + bh / 2.0) * fh / 640.0)
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, y2 = min(fw - 1, x2), min(fh - 1, y2)
                    if (x2 - x1) < 35 or (y2 - y1) < 28:
                        continue
                    crop = frame[y1:y2, x1:x2]
                    color_th, type_th, color_key = classify_crop_color_and_type(crop, coco_lbl)
                    if not matches_user_filter(coco_lbl, type_th, color_th, color_key, filter_type, filter_color):
                        continue
                    rank = sc * math.sqrt(float((x2 - x1) * (y2 - y1)))
                    if best_det is None or rank > best_det["rank"]:
                        best_det = {
                            "rank": rank,
                            "score": sc,
                            "box": (x1, y1, x2, y2),
                            "coco_label": coco_lbl,
                            "type_th": type_th,
                            "color_th": color_th,
                            "frame": frame.copy(),
                            "rel_sec": float(frame_idx) / float(fps),
                        }
            if best_det is not None:
                candidates.append(best_det)
        frame_idx += 1

    cap.release()
    if not candidates:
        return []

    # Group detections within 12-second windows so each passing vehicle produces 1 crisp event
    clusters: List[List[Dict[str, Any]]] = []
    for det in candidates:
        if not clusters or (det["rel_sec"] - clusters[-1][-1]["rel_sec"]) > 12.0:
            clusters.append([det])
        else:
            clusters[-1].append(det)

    created_events = []
    for cl in clusters:
        best = max(cl, key=lambda d: d["rank"])
        ev_ts = float(seg_start) + min(58.0, best["rel_sec"])
        ev_info = write_frigate_event_and_snapshots(
            cam_id=cam_info["id"],
            cam_name=cam_info["name"],
            ev_ts=ev_ts,
            seg_end=float(seg_end),
            frame_bgr=best["frame"],
            box_xyxy=best["box"],
            coco_label=best["coco_label"],
            score=best["score"],
            type_th=best["type_th"],
            color_th=best["color_th"],
            case_tag=case_tag,
        )
        if ev_info:
            created_events.append(ev_info)

    return created_events


# =============================================================================
# Job Queue Processor
# =============================================================================

def save_job(job_path: Path, job_data: Dict[str, Any]) -> None:
    job_data["updated_at"] = datetime.datetime.now(TZ_TH).isoformat()
    tmp = job_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job_data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(job_path)


def is_cancel_requested(job_path: Path) -> bool:
    try:
        data = json.loads(job_path.read_text(encoding="utf-8"))
        return data.get("status") == "cancel_requested" or bool(data.get("cancel_requested"))
    except Exception:
        return False


def process_job(job_path: Path, internal_map: Dict[str, Dict[str, Any]]) -> None:
    try:
        job = json.loads(job_path.read_text(encoding="utf-8"))
    except Exception as e:
        log.error("Failed reading job %s: %s", job_path, e)
        return

    job_id = job.get("job_id", job_path.stem)
    cameras: List[str] = job.get("cameras") or []
    start_ts = int(job.get("start_ts", 0))
    end_ts = int(job.get("end_ts", 0))
    ai_scan = bool(job.get("ai_scan", True))
    filter_type = str(job.get("vehicle_type") or "all")
    filter_color = str(job.get("vehicle_color") or "all")
    case_tag = str(job.get("case_tag") or "").strip()

    # Align to 60-second minute boundaries
    aligned_start = (start_ts // 60) * 60
    aligned_end = ((end_ts + 59) // 60) * 60
    if aligned_end <= aligned_start:
        aligned_end = aligned_start + 60
    # Cap single job window at 60 minutes per camera for safety
    if aligned_end - aligned_start > 3600:
        aligned_end = aligned_start + 3600

    minutes = list(range(aligned_start, aligned_end, 60))
    valid_cams = [c for c in cameras if c in internal_map]
    total_steps = max(1, len(valid_cams) * len(minutes))
    done_steps = 0

    job["status"] = "running"
    job["percent"] = 1
    job["segments_imported"] = 0
    job["events_created"] = 0
    job["matched_events"] = []
    cam_progress = {}
    for cid in cameras:
        cinfo = internal_map.get(cid)
        cam_progress[cid] = {
            "camera": cid,
            "name": cinfo["name"] if cinfo else cid,
            "status": "pending" if cinfo else "unsupported",
            "segments_ok": 0,
            "segments_total": len(minutes),
            "events_found": 0,
        }
    job["camera_progress"] = cam_progress
    save_job(job_path, job)

    log.info(
        "Starting job %s: %d cameras, window %d..%d (%d mins), ai_scan=%s, tag='%s'",
        job_id, len(valid_cams), aligned_start, aligned_end, len(minutes), ai_scan, case_tag,
    )

    for cid in valid_cams:
        if is_cancel_requested(job_path):
            job["status"] = "cancelled"
            save_job(job_path, job)
            log.info("Job %s cancelled by user.", job_id)
            return

        cinfo = internal_map[cid]
        job["current_camera"] = cid
        job["current_camera_name"] = cinfo["name"]
        cam_progress[cid]["status"] = "pulling"
        save_job(job_path, job)

        for seg_s in minutes:
            if is_cancel_requested(job_path):
                job["status"] = "cancelled"
                save_job(job_path, job)
                return

            seg_e = seg_s + 60
            seg_path = pull_or_get_segment(cinfo, seg_s, seg_e)
            if seg_path:
                cam_progress[cid]["segments_ok"] += 1
                job["segments_imported"] += 1
                if ai_scan:
                    cam_progress[cid]["status"] = "scanning"
                    save_job(job_path, job)
                    evs = scan_segment_for_vehicles(
                        cam_info=cinfo,
                        seg_path=seg_path,
                        seg_start=seg_s,
                        seg_end=seg_e,
                        filter_type=filter_type,
                        filter_color=filter_color,
                        case_tag=case_tag,
                    )
                    if evs:
                        cam_progress[cid]["events_found"] += len(evs)
                        job["events_created"] += len(evs)
                        job["matched_events"].extend(evs)

            done_steps += 1
            job["percent"] = min(99, max(1, int(round((done_steps / float(total_steps)) * 100.0))))
            save_job(job_path, job)

        cam_progress[cid]["status"] = "done" if cam_progress[cid]["segments_ok"] > 0 else "no_video"
        save_job(job_path, job)

    job["status"] = "completed"
    job["percent"] = 100
    job["current_camera"] = None
    job["completed_at"] = datetime.datetime.now(TZ_TH).isoformat()
    save_job(job_path, job)
    log.info(
        "Job %s completed: %d segments imported, %d AI events created.",
        job_id, job["segments_imported"], job["events_created"],
    )


def main():
    log.info("=== BPP-VMS Historical Pull & AI Scanner Worker starting ===")
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    last_catalog_ts = 0.0
    internal_map: Dict[str, Dict[str, Any]] = {}

    while True:
        try:
            now = time.time()
            if now - last_catalog_ts >= 60.0 or not internal_map:
                internal_map, public_groups = discover_cameras()
                write_catalog_file(public_groups)
                last_catalog_ts = now

            job_files = sorted(JOBS_DIR.glob("job_*.json"))
            for jf in job_files:
                try:
                    jdata = json.loads(jf.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if jdata.get("status") == "queued":
                    process_job(jf, internal_map)
        except Exception as e:
            log.error("Worker loop error: %s", e)

        time.sleep(1.5)


if __name__ == "__main__":
    main()
