"""
GPSONE (gps903.net) Cloud Tracker Integration & Background Poller for BPP-VMS.

Provides:
- Non-blocking background polling of GPSONE hardware trackers via gps903.net Web/AJAX API
- Uses persistent HTTP connection pooling (httpx / urllib) and persisted .ASPXAUTH session tokens
- Supports both 15-digit IMEI login and multi-device Account login
- Extracts WGS84 coordinates (latitude/longitude), speed, heading, battery %, ACC, GSM signal, and online/offline state
- Historical route trajectory retrieval via GetDevicesHistory
- Local persistence in gitignored `gpsone_devices.local.json` (never committed to Git or Clean Repo)
"""

import base64
import datetime
import hashlib
import http.cookiejar
import json
import logging
import os
import random
import re
import sqlite3
import string
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("analytics.gpsone")

BASE_DIR = Path(__file__).resolve().parent.parent
DEVICES_FILE = Path(os.environ.get("GPSONE_DEVICES_FILE", str(BASE_DIR / "gpsone_devices.local.json")))
HISTORY_DB_FILE = Path(os.environ.get("GPSONE_HISTORY_DB", str(BASE_DIR / "gpsone_history.local.db")))
GPS903_BASE_URL = os.environ.get("GPSONE_BASE_URL", "http://www.gps903.net").rstrip("/")
GPSDD_CLASSIC_URLS = [
    os.environ.get("GPSDD_BASE_URL", "http://a.gpsdd.net").rstrip("/"),
    "http://www.gpsdd.net",
]
THAIGPSDD_URLS = [
    os.environ.get("THAIGPSDD_BASE_URL", "https://gps.thaigpsdd.com").rstrip("/"),
    "https://www.iopgps.com",
    "https://www.wanwaygps.com",
]
GPSPOS_UKI_URLS = [
    os.environ.get("GPSPOS_BASE_URL", "http://www.gpspos.net").rstrip("/"),
    "https://www.globalcartrackers.com",
]
POLL_INTERVAL_SEC = float(os.environ.get("GPSONE_POLL_INTERVAL_SEC", "1.5"))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def normalize_track_timestamp(raw_ts: Any) -> str:
    """Normalize a raw timestamp string into 'YYYY-MM-DD HH:MM:SS' for chronological SQLite sorting."""
    clean = str(raw_ts or "").strip()
    if not clean:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.datetime.strptime(clean[:19], fmt)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    return clean[:19]


def split_account_and_target_imei(raw_identifier: str) -> Tuple[str, str]:
    """Split 'account:imei' or 'account/imei' into (login_username, target_imei)."""
    clean = str(raw_identifier or "").strip()
    for sep in (":", "/"):
        if sep in clean:
            left, right = clean.split(sep, 1)
            left_s, right_s = left.strip(), right.strip()
            if left_s and right_s:
                return left_s, right_s
    return clean, clean


def parse_gps903_js(raw: str) -> Dict[str, Any]:
    """Safely convert gps903.net / gpsdd.net unquoted-key JS object literal string into a Python dict."""
    if not raw or not raw.strip():
        return {}

    def _repl(match: re.Match) -> str:
        if match.group(1) is not None:
            return match.group(1)
        return f'{match.group(2)}"{match.group(3)}"{match.group(4)}'

    fixed = re.sub(
        r'("(?:\\.|[^"\\])*")|([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)',
        _repl,
        raw.strip(),
    )
    return json.loads(fixed)


def parse_data_context(data_context: str) -> Dict[str, Any]:
    """Extract battery percentage, ACC status, and GSM signal from gps903 dataContext field."""
    result: Dict[str, Any] = {
        "battery_pct": None,
        "acc_on": None,
        "gsm_signal": None,
    }
    if not data_context:
        return result

    ctx = str(data_context).strip()
    if "," in ctx:
        parts = [p.strip() for p in ctx.split(",")]
        if len(parts) >= 1 and parts[0] in ("0", "1"):
            result["acc_on"] = (parts[0] == "1")
        if len(parts) >= 2:
            try:
                bat = int(float(parts[1]))
                if 0 <= bat <= 100:
                    result["battery_pct"] = bat
            except ValueError:
                pass
        if len(parts) >= 3:
            try:
                result["gsm_signal"] = int(float(parts[2]))
            except ValueError:
                pass
    elif "-" in ctx:
        parts = [p.strip() for p in ctx.split("-")]
        if len(parts) >= 1 and parts[0] in ("0", "1"):
            result["acc_on"] = (parts[0] == "1")
        if len(parts) >= 2:
            try:
                bat = int(float(parts[1]))
                if 0 <= bat <= 100:
                    result["battery_pct"] = bat
            except ValueError:
                pass
    return result


TZ_TH = datetime.timezone(datetime.timedelta(hours=7))


def ms_or_sec_to_thai_str(val: Any) -> str:
    """Convert Unix timestamp (ms or sec) into Thailand local datetime string YYYY-MM-DD HH:MM:SS."""
    if val in (None, "", 0, "0"):
        return ""
    try:
        ts = float(val)
        if ts > 1e11:
            ts = ts / 1000.0
        if ts <= 0:
            return ""
        return datetime.datetime.fromtimestamp(ts, tz=TZ_TH).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def convert_thaigpsdd_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a ThaiGPSDD / IOPGPS / WanWay v2 device record into the standard tracker dictionary."""
    if "deviceStatusBean" in item or "imei" in item:
        bean = item.get("deviceStatusBean") or item
        sn = str(item.get("imei") or bean.get("imei") or "").strip()
        name = str(item.get("name") or sn).strip()
        status_code = bean.get("status")
        gps_ms = bean.get("gpsTime") or bean.get("heartTime") or bean.get("statusTime")
        srv_ms = bean.get("statusTime") or bean.get("sysTime") or gps_ms
        lat = bean.get("lat")
        lng = bean.get("lng")
        loc_type = bean.get("locationType")
        course = bean.get("course")
        speed = bean.get("speed")
        acc_raw = bean.get("accStatus")
        bat_raw = bean.get("chargePercentage")
        sat_num = bean.get("gpsNum")
        type_bean = item.get("deviceTypeBean") or {}
        model_name = str(type_bean.get("typeName") or "DDGPS")
        mileage_m = item.get("mileage") or 0.0
        stop_sec = 0
    else:
        sn = str(item.get("1") or "").strip()
        name = str(item.get("2") or sn).strip()
        status_code = item.get("4")
        gps_ms = item.get("5") or item.get("7") or item.get("8")
        srv_ms = item.get("8") or item.get("7") or item.get("5")
        lat = item.get("9")
        lng = item.get("10")
        loc_type = item.get("11")
        course = item.get("12")
        speed = item.get("13")
        acc_raw = item.get("14")
        bat_raw = (
            item.get("48")
            if item.get("48") is not None
            else (item.get("83") if item.get("83") is not None else item.get("16"))
        )
        sat_num = item.get("25")
        model_name = str(item.get("27") or item.get("73") or "DDGPS")
        mileage_m = item.get("28") or 0.0
        stop_sec = item.get("72") or 0

    st_int = -1
    try:
        st_int = int(status_code)
    except (TypeError, ValueError):
        st_int = -1

    if st_int == 1:
        status_str = "Move"
    elif st_int == 0:
        status_str = "Stop"
    elif st_int == 2:
        status_str = "Sleep"
    elif st_int == 10:
        status_str = "Offline"
    elif st_int == 20:
        status_str = "LoggedOff"
    elif st_int in (30, 31, 32, 33):
        status_str = "Arrears"
    else:
        status_str = "Offline"

    loc_int = 1
    try:
        if loc_type is not None:
            loc_int = int(loc_type)
    except (TypeError, ValueError):
        loc_int = 1
    data_type_str = "1" if loc_int == 1 else ("2" if loc_int == 0 else "3")

    acc_flag = "1" if acc_raw in (1, True, "1", "true", "True") else "0"
    bat_str = ""
    if bat_raw is not None:
        try:
            b_val = int(float(bat_raw))
            if 0 <= b_val <= 100:
                bat_str = str(b_val)
        except (TypeError, ValueError):
            pass
    sat_str = ""
    if sat_num is not None:
        try:
            sat_str = str(int(float(sat_num)))
        except (TypeError, ValueError):
            pass

    dev_id_num = 0
    digits_only = "".join(ch for ch in sn if ch.isdigit())
    if digits_only:
        try:
            dev_id_num = int(digits_only[-9:])
        except ValueError:
            dev_id_num = 0

    dist_km = 0.0
    try:
        dist_km = round(float(mileage_m or 0.0) / 1000.0, 2)
    except (TypeError, ValueError):
        dist_km = 0.0

    stop_min = 0
    if st_int != 1:
        try:
            stop_min = max(0, int(float(stop_sec or 0) // 60))
        except (TypeError, ValueError):
            stop_min = 0

    return {
        "id": dev_id_num,
        "sn": sn,
        "name": name,
        "modelName": model_name or "DDGPS",
        "latitude": lat,
        "longitude": lng,
        "speed": speed if speed is not None else 0.0,
        "course": course if course is not None else 999,
        "distance": dist_km,
        "dataContext": f"{acc_flag},{bat_str},{sat_str}",
        "status": status_str,
        "deviceUtcDate": ms_or_sec_to_thai_str(gps_ms),
        "serverUtcDate": ms_or_sec_to_thai_str(srv_ms),
        "dataType": data_type_str,
        "stopTimeMinute": stop_min,
    }


def convert_gpspos_item(item: Dict[str, Any], car_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Normalize a UKI GPS / Yuki GPS (gpspos.net AppJson.asp) position record into the standard tracker dictionary."""
    meta = car_meta or {}
    sn = str(item.get("strTEID") or item.get("strIMEI") or meta.get("strTEID") or meta.get("strIMEI") or "").strip()
    name = str(item.get("strCarNum") or meta.get("strCarNum") or sn).strip()
    model_raw = str(meta.get("strDeviceModel") or item.get("strDeviceModel") or "").strip()
    model_name = f"YUKI GPS ({model_raw})" if (model_raw and not model_raw.isdigit()) else "YUKI GPS"

    lat_val = item.get("dbLat")
    lng_val = item.get("dbLon")
    try:
        lat = float(lat_val) if lat_val not in (None, "") else None
        lng = float(lng_val) if lng_val not in (None, "") else None
    except (TypeError, ValueError):
        lat, lng = None, None

    try:
        speed = float(item.get("nSpeed") or 0.0)
    except (TypeError, ValueError):
        speed = 0.0

    try:
        course = float(item.get("nDirection") or 0.0)
    except (TypeError, ValueError):
        course = 999.0

    try:
        mileage_m = float(item.get("nMileage") or 0.0)
        dist_km = round(mileage_m / 1000.0, 2) if mileage_m > 0 else 0.0
    except (TypeError, ValueError):
        dist_km = 0.0

    try:
        n_time = int(float(item.get("nTime") or meta.get("nTime") or 0))
    except (TypeError, ValueError):
        n_time = 0

    try:
        n_car_state = int(float(item.get("nCarState") or 0))
    except (TypeError, ValueError):
        n_car_state = 0

    try:
        n_te_state = int(float(item.get("nTEState") or meta.get("nTEState") or 0))
    except (TypeError, ValueError):
        n_te_state = 0

    str_other = str(item.get("strOther") or "")
    lastpos_ts = 0
    recv_ts = 0
    for seg in str_other.split(";"):
        if "=" in seg:
            k_part, v_part = seg.split("=", 1)
            k_clean = k_part.strip().upper()
            if k_clean == "LASTPOS":
                try:
                    lastpos_ts = int(float(v_part.strip()))
                except ValueError:
                    pass
            elif k_clean == "RECVTIME":
                try:
                    recv_ts = int(float(v_part.strip()))
                except ValueError:
                    pass

    now_sec = int(time.time())
    is_online = (n_time > 0) and ((now_sec - n_time) < 600)
    if is_online and (n_te_state & 2048) and lastpos_ts > 0:
        is_online = (now_sec - lastpos_ts) < 600
    is_sleep = bool((n_te_state & 2147483648) or ((n_te_state & 134217728) and n_time > 0 and (now_sec - n_time) < 172800))

    if is_online:
        status_str = "Move" if speed >= 2.0 else "Stop"
    elif is_sleep:
        status_str = "Sleep"
    else:
        status_str = "Offline"

    if (n_te_state & 4096) != 0:
        data_type_str = "3"
    elif (n_te_state & 8192) != 0:
        data_type_str = "2"
    else:
        data_type_str = "1"

    acc_flag = "1" if (n_car_state & 128) != 0 else "0"
    bat_val = (n_te_state & 0xFF0000) >> 16
    bat_str = str(min(100, bat_val)) if bat_val > 0 else ""

    sat_str = ""
    sat_raw = item.get("nGPSSignal")
    if sat_raw is not None:
        try:
            sat_str = str(int(float(sat_raw)))
        except (TypeError, ValueError):
            pass

    stop_min = 0
    if speed < 2.0:
        try:
            park_ts = int(float(item.get("nParkTime") or 0))
            run_ts = int(float(item.get("nRunTime") or 0))
            if park_ts > 0 and park_ts >= run_ts and n_time >= park_ts:
                stop_min = max(0, (n_time - park_ts) // 60)
        except (TypeError, ValueError):
            stop_min = 0

    dev_id_num = 0
    raw_id = item.get("nID") or meta.get("nID")
    if raw_id:
        try:
            dev_id_num = int(float(raw_id))
        except (TypeError, ValueError):
            dev_id_num = 0
    if not dev_id_num:
        digits_only = "".join(ch for ch in sn if ch.isdigit())
        if digits_only:
            try:
                dev_id_num = int(digits_only[-9:])
            except ValueError:
                dev_id_num = 0

    return {
        "id": dev_id_num,
        "sn": sn,
        "name": name,
        "modelName": model_name,
        "latitude": lat,
        "longitude": lng,
        "speed": speed,
        "course": course,
        "distance": dist_km,
        "dataContext": f"{acc_flag},{bat_str},{sat_str}",
        "status": status_str,
        "deviceUtcDate": ms_or_sec_to_thai_str(n_time),
        "serverUtcDate": ms_or_sec_to_thai_str(recv_ts or n_time),
        "dataType": data_type_str,
        "stopTimeMinute": stop_min,
    }


def format_thai_duration(seconds: float) -> str:
    """Format elapsed seconds into a concise Thai human-readable duration correlated to the minute."""
    sec = max(0, int(seconds))
    if sec < 60:
        return f"{sec} วินาที"
    if sec < 3600:
        mins = sec // 60
        s = sec % 60
        return f"{mins} นาที {s} วินาที" if s > 0 else f"{mins} นาที"
    if sec < 86400:
        hrs = sec // 3600
        mins = (sec % 3600) // 60
        return f"{hrs} ชม. {mins} นาที" if mins > 0 else f"{hrs} ชม."
    days = sec // 86400
    hrs = (sec % 86400) // 3600
    mins = (sec % 3600) // 60
    if hrs > 0 and mins > 0:
        return f"{days} วัน {hrs} ชม. {mins} นาที"
    if hrs > 0:
        return f"{days} วัน {hrs} ชม."
    if mins > 0:
        return f"{days} วัน {mins} นาที"
    return f"{days} วัน"


def compute_time_correlation(raw_device_time: str, now_th: Optional[datetime.datetime] = None) -> Dict[str, Any]:
    """Normalize device_time against current Thailand real time (UTC+7) and compute elapsed age."""
    if now_th is None:
        now_th = datetime.datetime.now(TZ_TH)
    real_time_str = now_th.strftime("%Y-%m-%d %H:%M:%S")
    clean_raw = (raw_device_time or "").strip()
    if not clean_raw:
        return {
            "device_time": "",
            "real_time_th": real_time_str,
            "age_seconds": None,
            "age_th": "",
        }

    parsed_dt: Optional[datetime.datetime] = None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            naive = datetime.datetime.strptime(clean_raw[:19], fmt)
            parsed_dt = naive.replace(tzinfo=TZ_TH)
            break
        except ValueError:
            continue

    if parsed_dt is None:
        return {
            "device_time": clean_raw,
            "real_time_th": real_time_str,
            "age_seconds": None,
            "age_th": "",
        }

    # Guard against double timezone offset (when tracker sends local UTC+7/UTC+8 and gps903 adds +7h)
    if parsed_dt > now_th + datetime.timedelta(minutes=10):
        candidate_7 = parsed_dt - datetime.timedelta(hours=7)
        candidate_8 = parsed_dt - datetime.timedelta(hours=8)
        if candidate_7 <= now_th + datetime.timedelta(minutes=5):
            parsed_dt = candidate_7
        elif candidate_8 <= now_th + datetime.timedelta(minutes=5):
            parsed_dt = candidate_8

    age_sec = max(0.0, (now_th - parsed_dt).total_seconds())
    return {
        "device_time": parsed_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "real_time_th": real_time_str,
        "age_seconds": int(age_sec),
        "age_th": format_thai_duration(age_sec),
    }


def translate_status_th(status: str, age_th: str = "") -> Tuple[str, bool]:
    """Return (Thai status label, is_online boolean) from GPSONE / DDGPS status string."""
    st = (status or "").strip()
    st_lower = st.lower()
    if st_lower in ("move", "moving", "1"):
        return "ออนไลน์ (กำลังเคลื่อนที่)", True
    if st_lower in ("stop", "static", "motionless", "0"):
        return "ออนไลน์ (จอดนิ่ง)", True
    if st_lower in ("sleep", "2"):
        return "ออนไลน์ (โหมดประหยัดพลังงาน)", True
    if st_lower == "online":
        return "ออนไลน์", True
    if st_lower == "pinned":
        return "ปักหมุดพิกัด", True
    if st_lower in ("offline", "10"):
        suffix = f" (ขาดการติดต่อ {age_th})" if age_th else " (ขาดสัญญาณ)"
        return f"ออฟไลน์{suffix}", False
    if st_lower in ("loggedoff", "unused", "20"):
        return "ยังไม่เปิดใช้งาน (ออฟไลน์)", False
    if st_lower in ("arrears", "expired", "30", "31", "32", "33"):
        return "ระงับสัญญาณ (ออฟไลน์)", False
    return (st or "ออฟไลน์ / ไม่ทราบสถานะ"), False


SUPERADMIN_USERS = {"suchakree", "arm215", "bpp215"}


def is_superadmin_user(username: Optional[str], role: Optional[str]) -> bool:
    """Return True if the caller is a Superadmin (sees all GPS trackers and manages all devices)."""
    if (role or "").strip().lower() == "superadmin":
        return True
    if (username or "").strip().lower() in SUPERADMIN_USERS:
        return True
    return False


def can_user_manage_device(cfg: Dict[str, Any], username: Optional[str], role: Optional[str]) -> bool:
    """Return True if the caller is Superadmin OR the user who added/owns this GPS device."""
    if is_superadmin_user(username, role):
        return True
    uname = (username or "").strip().lower()
    if not uname:
        return False
    owner = str(cfg.get("owner_user") or "").strip().lower()
    return bool(owner and owner == uname)


def normalize_allowed_users(raw_list: Optional[List[str]], owner_user: Optional[str] = None) -> List[str]:
    """Deduplicate allowed_users and always include owner_user so the creator always sees their own GPS device."""
    cleaned: List[str] = []
    seen = set()
    owner_clean = str(owner_user or "").strip().lower()
    if owner_clean:
        seen.add(owner_clean)
        cleaned.append(owner_clean)
    for u in (raw_list or []):
        u_str = str(u or "").strip()
        if u_str and u_str.lower() not in seen:
            seen.add(u_str.lower())
            cleaned.append(u_str.lower() if u_str != "*" else "*")
    return cleaned


def can_user_view_device(cfg: Dict[str, Any], username: Optional[str], role: Optional[str]) -> bool:
    """Check whether a specific user is allowed to view a GPS device."""
    if is_superadmin_user(username, role):
        return True
    uname = (username or "").strip().lower()
    if not uname:
        return False
    owner = str(cfg.get("owner_user") or "").strip().lower()
    if owner and owner == uname:
        return True
    allowed_raw = cfg.get("allowed_users")
    if not isinstance(allowed_raw, list):
        return False
    allowed_set = {str(u).strip().lower() for u in allowed_raw if str(u).strip()}
    return ("*" in allowed_set) or (uname in allowed_set)


class GpsOneManager:
    """Manages GPSONE device credentials, session cookies, per-user permissions, unlimited trajectory storage, and background polling."""

    def __init__(self, storage_path: Path = DEVICES_FILE, history_db_path: Path = HISTORY_DB_FILE) -> None:
        self.storage_path = storage_path
        self.history_db_path = history_db_path
        self._lock = threading.RLock()
        self._db_lock = threading.RLock()
        self._devices: Dict[str, Dict[str, Any]] = {}
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._backfilled_imeis: set = set()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._backfill_thread: Optional[threading.Thread] = None
        self._poll_tick: int = 0
        self._init_history_db()
        self._load_from_disk()

    def _get_history_conn(self) -> sqlite3.Connection:
        self.history_db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.history_db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_history_db(self) -> None:
        with self._db_lock:
            try:
                with self._get_history_conn() as conn:
                    conn.execute("PRAGMA journal_mode=WAL")
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS gps_track_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            imei TEXT NOT NULL,
                            recorded_at TEXT NOT NULL,
                            lat REAL NOT NULL,
                            lng REAL NOT NULL,
                            lat_key INTEGER NOT NULL,
                            lng_key INTEGER NOT NULL,
                            speed REAL DEFAULT 0.0,
                            heading REAL,
                            is_stop INTEGER DEFAULT 0,
                            stop_minutes INTEGER DEFAULT 0,
                            data_type TEXT DEFAULT '1',
                            UNIQUE(imei, recorded_at, lat_key, lng_key)
                        )
                        """
                    )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_gps_track_imei_time ON gps_track_history(imei, recorded_at)"
                    )
                    conn.commit()
            except Exception as exc:
                logger.error("Failed to initialize GPS history DB %s: %s", self.history_db_path, exc)

    def _save_history_points(self, imei: str, points: List[Dict[str, Any]]) -> int:
        """Persist GPS trajectory points permanently into gps_track_history without any limit."""
        clean_imei = str(imei or "").strip()
        if not clean_imei or not points:
            return 0
        rows_to_insert = []
        for pt in points:
            if not isinstance(pt, dict):
                continue
            lat_raw = pt.get("lat") if pt.get("lat") is not None else pt.get("latitude")
            lng_raw = pt.get("lng") if pt.get("lng") is not None else pt.get("longitude")
            try:
                lat = float(lat_raw)
                lng = float(lng_raw)
            except (TypeError, ValueError):
                continue
            if lat in (0.0, -1.0) or lng in (0.0, -1.0) or not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
                continue
            rec_time = normalize_track_timestamp(
                pt.get("recorded_at") or pt.get("device_time") or pt.get("time") or ""
            )
            if not rec_time:
                continue
            spd = 0.0
            try:
                spd = float(pt.get("speed_kmh") if pt.get("speed_kmh") is not None else (pt.get("speed") or 0.0))
            except (TypeError, ValueError):
                spd = 0.0
            hdg = None
            raw_hdg = pt.get("heading") if pt.get("heading") is not None else pt.get("course")
            if raw_hdg is not None:
                try:
                    h_val = float(raw_hdg)
                    if 0.0 <= h_val <= 360.0:
                        hdg = h_val
                except (TypeError, ValueError):
                    hdg = None
            is_stop = 1 if bool(pt.get("is_stop", spd < 1.0)) else 0
            stop_min = 0
            try:
                stop_min = int(pt.get("stop_minutes") or 0)
            except (TypeError, ValueError):
                stop_min = 0
            dtype = str(pt.get("data_type") or "1").strip() or "1"
            lat_key = int(round(lat * 100000))
            lng_key = int(round(lng * 100000))
            rows_to_insert.append(
                (clean_imei, rec_time, lat, lng, lat_key, lng_key, spd, hdg, is_stop, stop_min, dtype)
            )
        if not rows_to_insert:
            return 0
        with self._db_lock:
            try:
                with self._get_history_conn() as conn:
                    before = conn.total_changes
                    conn.executemany(
                        """
                        INSERT OR IGNORE INTO gps_track_history
                        (imei, recorded_at, lat, lng, lat_key, lng_key, speed, heading, is_stop, stop_minutes, data_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        rows_to_insert,
                    )
                    conn.commit()
                    return max(0, conn.total_changes - before)
            except Exception as exc:
                logger.warning("Failed to save GPS history points for %s: %s", clean_imei, exc)
                return 0

    def _get_stored_history_points(
        self,
        imei: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        show_lbs: int = 1,
    ) -> List[Dict[str, Any]]:
        """Retrieve stored historical trajectory points for a device ordered chronologically with no row limit."""
        clean_imei = str(imei or "").strip()
        if not clean_imei:
            return []
        with self._db_lock:
            try:
                with self._get_history_conn() as conn:
                    params: List[Any] = [clean_imei]
                    clauses = ["imei = ?"]
                    if start_time:
                        s_norm = normalize_track_timestamp(start_time)
                        if s_norm:
                            clauses.append("recorded_at >= ?")
                            params.append(s_norm)
                    if end_time:
                        e_norm = normalize_track_timestamp(end_time)
                        if e_norm:
                            clauses.append("recorded_at <= ?")
                            params.append(e_norm)

                    # Prefer satellite GPS fixes (data_type = '1') when available so cell-tower LBS jumps don't distort road lines
                    sat_query = f"SELECT * FROM gps_track_history WHERE {' AND '.join(clauses + ['data_type = ?'])} ORDER BY recorded_at ASC, id ASC"
                    rows = conn.execute(sat_query, params + ["1"]).fetchall()
                    if not rows and show_lbs:
                        all_query = f"SELECT * FROM gps_track_history WHERE {' AND '.join(clauses)} ORDER BY recorded_at ASC, id ASC"
                        rows = conn.execute(all_query, params).fetchall()

                    out: List[Dict[str, Any]] = []
                    for r in rows:
                        lat_v = float(r["lat"])
                        lng_v = float(r["lng"])
                        spd_v = float(r["speed"] or 0.0)
                        hdg_v = float(r["heading"]) if r["heading"] is not None else None
                        rec_t = str(r["recorded_at"] or "")
                        out.append({
                            "lat": lat_v,
                            "lng": lng_v,
                            "latitude": lat_v,
                            "longitude": lng_v,
                            "speed": spd_v,
                            "speed_kmh": spd_v,
                            "heading": hdg_v,
                            "recorded_at": rec_t,
                            "device_time": rec_t,
                            "is_stop": bool(r["is_stop"]),
                            "stop_minutes": int(r["stop_minutes"] or 0),
                            "data_type": str(r["data_type"] or "1"),
                        })
                    return self._enrich_points_with_dwell(out)
            except Exception as exc:
                logger.warning("Failed to read stored GPS history for %s: %s", clean_imei, exc)
                return []

    @staticmethod
    def _parse_track_epoch(ts_str: str) -> Optional[float]:
        s = str(ts_str or "").strip()
        if not s:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                dt = datetime.datetime.strptime(s[:19], fmt).replace(tzinfo=TZ_TH)
                return dt.timestamp()
            except ValueError:
                continue
        return None

    def _enrich_points_with_dwell(self, points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Compute stationary dwell duration (stop_minutes, arrive_time, depart_time) for clusters of nearby points."""
        n = len(points)
        if n == 0:
            return points
        epochs: List[Optional[float]] = [
            self._parse_track_epoch(str(p.get("recorded_at") or p.get("device_time") or ""))
            for p in points
        ]
        i = 0
        while i < n:
            base_lat = float(points[i]["lat"])
            base_lng = float(points[i]["lng"])
            j = i
            max_reported_stop = int(points[i].get("stop_minutes") or 0)
            min_spd = float(points[i].get("speed_kmh") or 0.0)
            while j + 1 < n:
                nxt_lat = float(points[j + 1]["lat"])
                nxt_lng = float(points[j + 1]["lng"])
                nxt_spd = float(points[j + 1].get("speed_kmh") or 0.0)
                # Within ~38 meters (0.00035 deg), or slow/stationary within ~50 meters
                d_lat = abs(nxt_lat - base_lat)
                d_lng = abs(nxt_lng - base_lng)
                if (d_lat <= 0.00035 and d_lng <= 0.00035) or (
                    nxt_spd <= 2.0 and min_spd <= 2.0 and d_lat <= 0.00048 and d_lng <= 0.00048
                ):
                    j += 1
                    rep_s = int(points[j].get("stop_minutes") or 0)
                    if rep_s > max_reported_stop:
                        max_reported_stop = rep_s
                    if nxt_spd < min_spd:
                        min_spd = nxt_spd
                else:
                    break

            arrive_t = str(points[i].get("recorded_at") or points[i].get("device_time") or "")
            depart_t = str(points[j].get("recorded_at") or points[j].get("device_time") or arrive_t)
            t_start = epochs[i]
            t_end = epochs[j]

            # Also check if device parked at point j (speed <= 2 km/h) and only reported next point j+1 when departing
            if j + 1 < n and float(points[j].get("speed_kmh") or 0.0) <= 2.0:
                nxt_ep = epochs[j + 1]
                if t_start is not None and nxt_ep is not None and nxt_ep > (t_end or t_start):
                    d_next_lat = abs(float(points[j + 1]["lat"]) - base_lat)
                    d_next_lng = abs(float(points[j + 1]["lng"]) - base_lng)
                    # If next point is within 120m (just started moving out of parking spot), count until departure
                    if d_next_lat <= 0.0011 and d_next_lng <= 0.0011:
                        t_end = nxt_ep
                        depart_t = str(points[j + 1].get("recorded_at") or depart_t)

            calc_min = 0
            if t_start is not None and t_end is not None and t_end > t_start:
                calc_min = int(round((t_end - t_start) / 60.0))

            final_stop_min = max(max_reported_stop, calc_min)
            is_stationary = bool(final_stop_min >= 1 or min_spd <= 1.5 or (j > i))
            for k in range(i, j + 1):
                points[k]["arrive_time"] = arrive_t
                points[k]["depart_time"] = depart_t
                points[k]["stop_minutes"] = final_stop_min
                points[k]["dwell_minutes"] = final_stop_min
                if is_stationary:
                    points[k]["is_stop"] = True
            i = j + 1
        return points

    def _build_unlimited_live_trail(self, imei: str) -> List[Dict[str, Any]]:
        """Build an unlimited chronological breadcrumb trail from all stored history (preserving stationary dwell minutes)."""
        pts = self._get_stored_history_points(imei, start_time=None, end_time=None, show_lbs=1)
        trail: List[Dict[str, Any]] = []
        for pt in pts:
            lat = float(pt["lat"])
            lng = float(pt["lng"])
            rec_t = str(pt.get("recorded_at") or pt.get("device_time") or "")
            arr_t = str(pt.get("arrive_time") or rec_t)
            dep_t = str(pt.get("depart_time") or rec_t)
            spd = float(pt.get("speed_kmh") or 0.0)
            crs = pt.get("heading")
            stop_m = int(pt.get("stop_minutes") or 0)
            is_stp = bool(pt.get("is_stop") or stop_m >= 1 or spd <= 1.5)
            if not trail:
                trail.append({
                    "lat": lat,
                    "lng": lng,
                    "speed_kmh": spd,
                    "course": crs,
                    "time": rec_t,
                    "arrive_time": arr_t,
                    "depart_time": dep_t,
                    "stop_minutes": stop_m,
                    "is_stop": is_stp,
                })
            else:
                last_pt = trail[-1]
                d_lat = abs(float(last_pt.get("lat", 0.0)) - lat)
                d_lng = abs(float(last_pt.get("lng", 0.0)) - lng)
                if d_lat > 0.00003 or d_lng > 0.00003:
                    trail.append({
                        "lat": lat,
                        "lng": lng,
                        "speed_kmh": spd,
                        "course": crs,
                        "time": rec_t,
                        "arrive_time": arr_t,
                        "depart_time": dep_t,
                        "stop_minutes": stop_m,
                        "is_stop": is_stp,
                    })
                else:
                    # Merge stationary point dwell window into the collapsed trail node
                    if dep_t and dep_t > str(last_pt.get("depart_time") or ""):
                        last_pt["depart_time"] = dep_t
                    if stop_m > int(last_pt.get("stop_minutes") or 0):
                        last_pt["stop_minutes"] = stop_m
                    t0 = self._parse_track_epoch(str(last_pt.get("arrive_time") or last_pt.get("time") or ""))
                    t1 = self._parse_track_epoch(str(last_pt.get("depart_time") or rec_t))
                    if t0 is not None and t1 is not None and t1 > t0:
                        span_m = int(round((t1 - t0) / 60.0))
                        if span_m > int(last_pt.get("stop_minutes") or 0):
                            last_pt["stop_minutes"] = span_m
                    if int(last_pt.get("stop_minutes") or 0) >= 1 or is_stp:
                        last_pt["is_stop"] = True
        return trail

    def _load_from_disk(self) -> None:
        with self._lock:
            if not self.storage_path.exists():
                self._devices = {}
                return
            try:
                raw = json.loads(self.storage_path.read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    self._devices = {str(item["imei"]).strip(): item for item in raw if isinstance(item, dict) and item.get("imei")}
                elif isinstance(raw, dict):
                    self._devices = {str(k).strip(): v for k, v in raw.items() if isinstance(v, dict)}
                dirty = False
                for imei, cfg in self._devices.items():
                    owner_u = str(cfg.get("owner_user") or "").strip().lower()
                    norm_allowed = normalize_allowed_users(
                        cfg.get("allowed_users") if isinstance(cfg.get("allowed_users"), list) else [],
                        owner_user=owner_u,
                    )
                    if cfg.get("allowed_users") != norm_allowed:
                        cfg["allowed_users"] = norm_allowed
                        dirty = True
                    # Auto-disable offline GPS pins by default; keep online GPS pins enabled
                    if cfg.get("login_type") != "manual":
                        st = cfg.get("last_state") or {}
                        # Migrate any existing live_trail or last fix points into permanent SQLite storage
                        existing_trail = list(st.get("live_trail") or [])
                        seed_pts: List[Dict[str, Any]] = []
                        for t_pt in existing_trail:
                            if isinstance(t_pt, dict) and t_pt.get("lat") is not None and t_pt.get("lng") is not None:
                                seed_pts.append({
                                    "lat": t_pt.get("lat"),
                                    "lng": t_pt.get("lng"),
                                    "speed_kmh": t_pt.get("speed_kmh", 0.0),
                                    "course": t_pt.get("course"),
                                    "recorded_at": t_pt.get("time") or st.get("device_time") or "",
                                    "data_type": "1",
                                })
                        if st.get("latitude") is not None and st.get("longitude") is not None and (st.get("gps_fix_time") or st.get("device_time")):
                            seed_pts.append({
                                "lat": st.get("latitude"),
                                "lng": st.get("longitude"),
                                "speed_kmh": st.get("speed_kmh", 0.0),
                                "course": st.get("course"),
                                "recorded_at": st.get("gps_fix_time") or st.get("device_time") or "",
                                "data_type": "1",
                            })
                        if seed_pts:
                            self._save_history_points(imei, seed_pts)
                        rebuilt_trail = self._build_unlimited_live_trail(imei)
                        if len(rebuilt_trail) > 60:
                            self._backfilled_imeis.add(imei)
                        if rebuilt_trail and (
                            len(rebuilt_trail) != len(existing_trail)
                            or "stop_minutes" not in (existing_trail[-1] if existing_trail else {})
                        ):
                            st["live_trail"] = rebuilt_trail
                            cfg["last_state"] = st
                            dirty = True
                        status_raw = str(st.get("status") or "Unknown")
                        _, is_online = translate_status_th(status_raw) if status_raw != "Unknown" else ("", bool(st.get("is_online", False)))
                        if not is_online:
                            if cfg.get("enabled", True) or cfg.get("force_show_offline", False):
                                cfg["enabled"] = False
                                cfg["force_show_offline"] = False
                                dirty = True
                        else:
                            if not cfg.get("manual_hide_online", False) and not cfg.get("enabled", True):
                                cfg["enabled"] = True
                                dirty = True
                    if cfg.get("cookie_header") and (
                        cfg.get("user_id")
                        or cfg.get("device_id")
                        or cfg.get("resolved_protocol") in ("thaigpsdd_v2", "gpspos_uki")
                    ):
                        _, target_sn = split_account_and_target_imei(imei)
                        self._sessions[imei] = {
                            "protocol": str(cfg.get("resolved_protocol") or "aspx_gps903"),
                            "provider": str(cfg.get("provider") or "gpsone"),
                            "base_url": str(cfg.get("resolved_base_url") or GPS903_BASE_URL),
                            "cookie_header": cfg["cookie_header"],
                            "user_id": int(cfg.get("user_id") or 0),
                            "device_id": int(cfg.get("device_id") or 0),
                            "login_type_num": 2 if cfg.get("login_type") == "imei" else 1,
                            "is_imei_login": bool(cfg.get("login_type") == "imei"),
                            "target_imei": str((cfg.get("last_state") or {}).get("imei") or target_sn),
                            "updated_at": time.time(),
                        }
                if dirty:
                    self._save_to_disk()
            except Exception as exc:
                logger.warning("Failed to load GPSONE devices file %s: %s", self.storage_path, exc)
                self._devices = {}

    def _save_to_disk(self) -> None:
        with self._lock:
            try:
                self.storage_path.parent.mkdir(parents=True, exist_ok=True)
                items = list(self._devices.values())
                tmp_path = self.storage_path.with_suffix(".tmp")
                tmp_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
                tmp_path.replace(self.storage_path)
            except Exception as exc:
                logger.error("Failed to save GPSONE devices file %s: %s", self.storage_path, exc)

    def start_background_poller(self) -> None:
        if not (self._thread and self._thread.is_alive()):
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._poll_loop, name="gpsone-poller", daemon=True)
            self._thread.start()
            logger.info("GPSONE/DDGPS/YUKIGPS background poller started (interval=%.1fs)", POLL_INTERVAL_SEC)
        if not (self._backfill_thread and self._backfill_thread.is_alive()):
            self._backfill_thread = threading.Thread(
                target=self._background_backfill_all, name="gpsone-history-backfill", daemon=True
            )
            self._backfill_thread.start()

    def _background_backfill_all(self) -> None:
        """Background worker that recovers full historical routes from cloud servers for all registered GPS devices."""
        time.sleep(2.0)
        with self._lock:
            imeis = [
                k for k, v in self._devices.items()
                if v.get("login_type") != "manual" and k not in self._backfilled_imeis
            ]
        for imei in imeis:
            if self._stop_event.is_set():
                break
            try:
                self.backfill_device_history(imei, days_back=120)
            except Exception as exc:
                logger.debug("Background history backfill skipped for %s: %s", imei, exc)

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.poll_all_enabled()
            except Exception as exc:
                logger.warning("GPSONE/DDGPS/YUKIGPS poll loop error: %s", exc)
            self._stop_event.wait(POLL_INTERVAL_SEC)

    def _open_with_retry(self, opener: urllib.request.OpenerDirector, req_or_url: Any, data: Optional[bytes] = None, timeout: float = 10.0, retries: int = 3) -> bytes:
        last_err: Optional[Exception] = None
        for attempt in range(retries):
            try:
                return opener.open(req_or_url, data=data, timeout=timeout).read()
            except Exception as exc:
                last_err = exc
                if attempt < retries - 1:
                    time.sleep(0.6 * (attempt + 1))
        raise last_err or RuntimeError("Request to GPS cloud server failed")

    def _login_gps903(
        self,
        imei_or_account: str,
        password: str,
        login_type: str = "auto",
        known_user_id: int = 0,
        known_device_id: int = 0,
        base_url: str = GPS903_BASE_URL,
        provider_label: str = "gpsone",
    ) -> Dict[str, Any]:
        """Authenticate against gps903.net or gpsdd.net (ASP.NET WebForms) and return session dict."""
        clean_base = (base_url or GPS903_BASE_URL).rstrip("/")
        login_user, target_imei = split_account_and_target_imei(imei_or_account)

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        opener.addheaders = [
            ("User-Agent", USER_AGENT),
            ("Connection", "close"),
        ]

        login_url = f"{clean_base}/Login.aspx?language=en-us"
        html = self._open_with_retry(opener, login_url, timeout=10.0, retries=2).decode("utf-8", errors="ignore")

        vs_m = re.search(r'id="__VIEWSTATE"\s+value="([^"]*)"', html)
        vsg_m = re.search(r'id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"', html)
        ev_m = re.search(r'id="__EVENTVALIDATION"\s+value="([^"]*)"', html)
        if not vs_m or not ev_m:
            raise RuntimeError(f"ไม่สามารถอ่านฟอร์มล็อกอินจากเซิร์ฟเวอร์ ({clean_base})")

        is_imei = (login_type == "imei") or (
            login_type == "auto" and login_user.isdigit() and len(login_user) >= 10
        )
        form_data = {
            "__VIEWSTATE": vs_m.group(1),
            "__VIEWSTATEGENERATOR": vsg_m.group(1) if vsg_m else "",
            "__EVENTVALIDATION": ev_m.group(1),
            "txtUserName": "" if is_imei else login_user,
            "txtAccountPassword": "" if is_imei else password,
            "txtImeiNo": login_user if is_imei else "",
            "txtImeiPassword": password if is_imei else "",
        }
        if is_imei:
            form_data["btnLoginImei"] = ""
        else:
            form_data["btnLoginAccount"] = ""

        encoded = urllib.parse.urlencode(form_data).encode("utf-8")
        resp_html = self._open_with_retry(opener, login_url, data=encoded, timeout=10.0, retries=2).decode("utf-8", errors="ignore")

        cookies_dict = {c.name: c.value for c in cj}
        if ".ASPXAUTH" not in cookies_dict and "Monitor.aspx" not in resp_html:
            raise ValueError(f"เลข IMEI หรือรหัสผ่านไม่ถูกต้อง ({provider_label.upper()} ปฏิเสธการเข้าสู่ระบบ)")

        user_id = int(known_user_id or 0)
        device_id = int(known_device_id or 0)
        login_type_num = 2 if is_imei else 1

        if not user_id or (is_imei and not device_id):
            mon_html = self._open_with_retry(opener, f"{clean_base}/Monitor.aspx", timeout=10.0, retries=2).decode("utf-8", errors="ignore")
            uid_m = re.search(r'id="hidUserID"\s+value="([^"]*)"', mon_html)
            did_m = re.search(r'id="hidDeviceID"\s+value="([^"]*)"', mon_html)
            ltype_m = re.search(r'id="hidLoginType"\s+value="([^"]*)"', mon_html)

            user_id = int(uid_m.group(1)) if (uid_m and uid_m.group(1).strip().isdigit()) else user_id
            device_id = int(did_m.group(1)) if (did_m and did_m.group(1).strip().isdigit()) else device_id
            login_type_num = int(ltype_m.group(1)) if (ltype_m and ltype_m.group(1).strip().isdigit()) else login_type_num

        if not user_id and not device_id:
            raise RuntimeError("ล็อกอินสำเร็จแต่ไม่พบรหัสอุปกรณ์ (UserID/DeviceID) ในหน้า Monitor.aspx")

        cookie_header = "; ".join(f"{c.name}={c.value}" for c in cj)
        return {
            "protocol": "aspx_gps903",
            "provider": provider_label,
            "base_url": clean_base,
            "cookie_header": cookie_header,
            "user_id": user_id,
            "device_id": device_id,
            "login_type_num": login_type_num,
            "is_imei_login": is_imei,
            "target_imei": target_imei,
            "updated_at": time.time(),
        }

    def _login_thaigpsdd(
        self,
        imei_or_account: str,
        password: str,
        base_url: str = "https://gps.thaigpsdd.com",
    ) -> Dict[str, Any]:
        """Authenticate against ThaiGPSDD / IOPGPS / WanWay v2 Cloud (/login) and return session dict."""
        clean_base = (base_url or "https://gps.thaigpsdd.com").rstrip("/")
        login_user, target_imei = split_account_and_target_imei(imei_or_account)
        domain_host = urllib.parse.urlparse(clean_base).netloc or "gps.thaigpsdd.com"

        rand10 = "".join(random.choices(string.ascii_letters + string.digits, k=10))
        pwd_md5 = hashlib.md5(password.encode("utf-8")).hexdigest()
        salt_md5 = hashlib.md5(rand10.encode("utf-8")).hexdigest()
        combined_pwd = pwd_md5 + salt_md5

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        opener.addheaders = [
            ("User-Agent", USER_AGENT),
            ("Accept", "application/json, text/javascript, */*; q=0.01"),
            ("X-Requested-With", "XMLHttpRequest"),
            ("Origin", clean_base),
            ("Referer", f"{clean_base}/"),
            ("Connection", "close"),
        ]

        form_data = urllib.parse.urlencode({
            "username": login_user,
            "password": combined_pwd,
            "loginType": "ADMIN",
            "rememberMe": "false",
            "domain": domain_host,
        }).encode("utf-8")

        login_url = f"{clean_base}/login?_t={int(time.time() * 1000)}"
        raw_bytes = self._open_with_retry(opener, login_url, data=form_data, timeout=10.0, retries=2)
        resp_json = json.loads(raw_bytes.decode("utf-8", errors="ignore"))

        result_bean = resp_json.get("resultBean") or {}
        code = result_bean.get("code")
        cookies_dict = {c.name: c.value for c in cj}

        if code not in (0, 1) or ("USER_TOKEN" not in cookies_dict and not resp_json.get("accountId")):
            err_msg = str(result_bean.get("result") or "เลข IMEI หรือรหัสผ่านไม่ถูกต้อง (DDGPS ปฏิเสธการเข้าสู่ระบบ)")
            raise ValueError(err_msg)

        is_imei_login = (code == 1) or (login_user.isdigit() and len(login_user) >= 10 and not resp_json.get("accountId"))
        acc_id = int(resp_json.get("defaultTreeFirstOrgId") or resp_json.get("accountId") or 0)
        cookie_parts = [f"{c.name}={c.value}" for c in cj]
        cookie_parts.append("zoneId=Asia/Bangkok")
        cookie_parts.append("lang=th")
        cookie_header = "; ".join(cookie_parts)

        return {
            "protocol": "thaigpsdd_v2",
            "provider": "ddgps",
            "base_url": clean_base,
            "cookie_header": cookie_header,
            "user_id": acc_id,
            "device_id": 0,
            "login_type_num": 2 if is_imei_login else 1,
            "is_imei_login": is_imei_login,
            "target_imei": target_imei,
            "updated_at": time.time(),
        }

    def _call_gpspos_api(
        self,
        base_url: str,
        cmd: str,
        params: List[Any],
        user: str = "",
        field: str = "",
        timeout: float = 10.0,
    ) -> Dict[str, Any]:
        """Execute a signed command against UKI GPS / Yuki GPS (gpspos.net /APP/AppJson.asp)."""
        clean_base = (base_url or "http://www.gpspos.net").rstrip("/")
        ts = int(time.time() * 1000)
        rnd = str(random.randint(10000000000000, 99999999999999))
        srv = clean_base.lower().replace("http://", "").replace("https://", "").rstrip("/")
        while len(srv) % 3 != 0:
            srv += "/"
        app_id = base64.b64encode(srv.encode("utf-8")).decode("ascii")

        data_str = ",".join("N'" + str(p).replace("'", "''") + "'" for p in params)
        raw_tok = f"{cmd}\x11{data_str}\x11{field}\x11\x1b"
        while len(raw_tok.encode("utf-8")) % 3 != 0:
            raw_tok += "5"
        token = base64.b64encode(raw_tok.encode("utf-8")).decode("ascii")

        sign_src = f"{ts}{rnd}{user}{app_id}{token}"
        sign = hashlib.md5(sign_src.encode("utf-8")).hexdigest()

        body = urllib.parse.urlencode({
            "strAppID": app_id,
            "strUser": user,
            "nTimeStamp": str(ts),
            "strRandom": rnd,
            "strSign": sign,
            "strToken": token,
        }).encode("utf-8")

        opener = urllib.request.build_opener()
        req = urllib.request.Request(
            f"{clean_base}/APP/AppJson.asp",
            data=body,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Connection": "close",
            },
        )
        raw_text = self._open_with_retry(opener, req, timeout=timeout, retries=2).decode("utf-8", errors="ignore").strip()
        if "}{" in raw_text:
            raw_text = raw_text[: raw_text.index("}{") + 1]
        return json.loads(raw_text, strict=False)

    @staticmethod
    def _parse_gpspos_records(res: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not isinstance(res, dict) or not res.get("m_isResultOk"):
            return []
        fields = res.get("m_arrField") or []
        records = res.get("m_arrRecord") or []
        if not isinstance(fields, list) or not isinstance(records, list):
            return []
        return [dict(zip(fields, row)) for row in records if isinstance(row, list)]

    def _login_gpspos(
        self,
        imei_or_account: str,
        password: str,
        base_url: str = "http://www.gpspos.net",
    ) -> Dict[str, Any]:
        """Authenticate against UKI GPS / Yuki GPS (gpspos.net /APP/AppJson.asp) and return session dict."""
        clean_base = (base_url or "http://www.gpspos.net").rstrip("/")
        login_user, target_imei = split_account_and_target_imei(imei_or_account)

        type_res = self._call_gpspos_api(clean_base, "Proc_GetLoginType", [login_user, password], user=login_user)
        type_rows = self._parse_gpspos_records(type_res)
        if not type_rows:
            raise ValueError("เลข IMEI หรือรหัสผ่านไม่ถูกต้อง (YUKI GPS ปฏิเสธการเข้าสู่ระบบ)")

        try:
            n_type = int(type_rows[0].get("nType", -1))
        except (TypeError, ValueError):
            n_type = -1

        if n_type < 0 or n_type > 2:
            raise ValueError("เลข IMEI หรือรหัสผ่านไม่ถูกต้อง (YUKI GPS ปฏิเสธการเข้าสู่ระบบ)")

        login_cmd = "Proc_Login" if n_type == 0 else ("Proc_LoginAnother" if n_type == 1 else "Proc_LoginIMEI")
        login_res = self._call_gpspos_api(clean_base, login_cmd, [login_user, password], user=login_user)
        if not isinstance(login_res, dict) or not login_res.get("m_isResultOk"):
            raise ValueError("เลข IMEI หรือรหัสผ่านไม่ถูกต้อง (YUKI GPS ปฏิเสธการเข้าสู่ระบบ)")

        canonical_user = login_user
        login_records = login_res.get("m_arrRecord") or []
        if n_type == 1 and login_records and isinstance(login_records[0], list) and login_records[0]:
            canonical_user = str(login_records[0][0] or login_user).strip()

        digits = "".join(ch for ch in canonical_user if ch.isdigit())
        uid_num = int(digits[-9:]) if digits else 1
        cookie_header = f"GPSPOS_USER={canonical_user};NTYPE={n_type}"

        return {
            "protocol": "gpspos_uki",
            "provider": "yukigps",
            "base_url": clean_base,
            "cookie_header": cookie_header,
            "user_id": uid_num,
            "device_id": uid_num if n_type == 2 else 0,
            "login_type_num": 2 if n_type == 2 else 1,
            "is_imei_login": (n_type == 2),
            "target_imei": target_imei,
            "updated_at": time.time(),
        }

    def _authenticate_device(
        self,
        imei_or_account: str,
        password: str,
        login_type: str = "auto",
        provider: str = "auto",
        known_user_id: int = 0,
        known_device_id: int = 0,
        resolved_protocol: str = "",
        resolved_base_url: str = "",
    ) -> Dict[str, Any]:
        """Try authenticating against the configured GPS provider (or auto-detect across GPSONE, DDGPS, and YUKI GPS)."""
        prov = (provider or "auto").strip().lower()
        candidates: List[Tuple[str, str, str]] = []

        if resolved_protocol and resolved_base_url:
            if resolved_protocol == "gpspos_uki" or "gpspos" in resolved_base_url.lower():
                resolved_prov = "yukigps"
            elif resolved_protocol == "thaigpsdd_v2" or "gpsdd" in resolved_base_url.lower():
                resolved_prov = "ddgps"
            else:
                resolved_prov = "gpsone"
            if prov in ("auto", resolved_prov, "ddgps", "gpsone", "yukigps", "ukigps", "yuki", "gpspos", "thaigpsdd", "gpsdd_net"):
                candidates.append((resolved_protocol, resolved_base_url, resolved_prov))

        ddgps_candidates: List[Tuple[str, str, str]] = (
            [("thaigpsdd_v2", u, "ddgps") for u in THAIGPSDD_URLS]
            + [("aspx_gps903", u, "ddgps") for u in GPSDD_CLASSIC_URLS]
        )
        gpsone_candidates: List[Tuple[str, str, str]] = [
            ("aspx_gps903", GPS903_BASE_URL, "gpsone"),
        ]
        yukigps_candidates: List[Tuple[str, str, str]] = [
            ("gpspos_uki", u, "yukigps") for u in GPSPOS_UKI_URLS
        ]

        if prov in ("yukigps", "ukigps", "yuki", "gpspos"):
            ordered = yukigps_candidates + gpsone_candidates + ddgps_candidates
        elif prov == "thaigpsdd":
            ordered = [("thaigpsdd_v2", u, "ddgps") for u in THAIGPSDD_URLS] + [("aspx_gps903", u, "ddgps") for u in GPSDD_CLASSIC_URLS]
        elif prov == "gpsdd_net":
            ordered = [("aspx_gps903", u, "ddgps") for u in GPSDD_CLASSIC_URLS] + [("thaigpsdd_v2", u, "ddgps") for u in THAIGPSDD_URLS]
        elif prov == "ddgps":
            ordered = ddgps_candidates + gpsone_candidates + yukigps_candidates
        elif prov == "gpsone":
            ordered = gpsone_candidates + ddgps_candidates + yukigps_candidates
        else:
            ordered = gpsone_candidates + ddgps_candidates + yukigps_candidates

        seen = set()
        final_targets: List[Tuple[str, str, str]] = []
        for proto, b_url, p_lbl in candidates + ordered:
            key = (proto, b_url.rstrip("/"))
            if key not in seen:
                seen.add(key)
                final_targets.append((proto, b_url.rstrip("/"), p_lbl))

        last_val_err: Optional[ValueError] = None
        last_exc: Optional[Exception] = None

        for proto, b_url, p_lbl in final_targets:
            try:
                if proto == "gpspos_uki":
                    return self._login_gpspos(imei_or_account, password, base_url=b_url)
                if proto == "thaigpsdd_v2":
                    return self._login_thaigpsdd(imei_or_account, password, base_url=b_url)
                return self._login_gps903(
                    imei_or_account,
                    password,
                    login_type=login_type,
                    known_user_id=known_user_id if b_url == resolved_base_url else 0,
                    known_device_id=known_device_id if b_url == resolved_base_url else 0,
                    base_url=b_url,
                    provider_label=p_lbl,
                )
            except ValueError as verr:
                last_val_err = verr
            except Exception as exc:
                last_exc = exc

        if last_val_err is not None:
            raise last_val_err
        raise last_exc or RuntimeError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ GPSONE / DDGPS / YUKI GPS ได้")

    @staticmethod
    def _extract_gpspos_session_meta(session: Dict[str, Any]) -> Tuple[str, int]:
        cookie_hdr = str(session.get("cookie_header") or "")
        user_val = ""
        n_type = 2 if session.get("is_imei_login") else 0
        for part in cookie_hdr.split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                k_clean = k.strip().upper()
                if k_clean == "GPSPOS_USER":
                    user_val = v.strip()
                elif k_clean == "NTYPE":
                    try:
                        n_type = int(v.strip())
                    except ValueError:
                        pass
        if not user_val:
            user_val, _ = split_account_and_target_imei(str(session.get("target_imei") or ""))
        return user_val, n_type

    def _fetch_devices_from_session(self, session: Dict[str, Any], target_imei: str = "") -> List[Dict[str, Any]]:
        """Fetch raw device telemetry list from active session (supports ASP.NET gps903/gpsdd, ThaiGPSDD v2, and UKI GPS / GPSPOS)."""
        protocol = str(session.get("protocol") or "aspx_gps903")
        base_url = str(session.get("base_url") or GPS903_BASE_URL).rstrip("/")

        if protocol == "gpspos_uki":
            str_user, n_type = self._extract_gpspos_session_meta(session)
            _, clean_target = split_account_and_target_imei(target_imei or str(session.get("target_imei") or str_user))

            # 1. Direct TEID / IMEI query if logged in by IMEI or target_imei is specified
            if n_type == 2 or (clean_target and clean_target != str_user) or (clean_target.isdigit() and len(clean_target) >= 8):
                q_teid = clean_target or str_user
                pos_rows = self._parse_gpspos_records(
                    self._call_gpspos_api(base_url, "Proc_GetLastPosition", [q_teid], user=str_user)
                )
                if pos_rows:
                    car_meta: Dict[str, Any] = {}
                    try:
                        info_rows = self._parse_gpspos_records(
                            self._call_gpspos_api(base_url, "Proc_GetCarInfo", [q_teid], user=str_user)
                        )
                        if info_rows:
                            car_meta = info_rows[0]
                    except Exception:
                        pass
                    return [convert_gpspos_item(r, car_meta=car_meta) for r in pos_rows]

            # 2. Multi-device account query via Proc_GetChildrenPos
            cpos_rows = self._parse_gpspos_records(
                self._call_gpspos_api(base_url, "Proc_GetChildrenPos", [str_user, 1, 200, ""], user=str_user)
            )
            if cpos_rows:
                return [convert_gpspos_item(r) for r in cpos_rows]

            # 3. Fallback to Proc_GetChildrenCar + Proc_GetLastPosition
            ccar_rows = self._parse_gpspos_records(
                self._call_gpspos_api(base_url, "Proc_GetChildrenCar", [str_user, 200, 0], user=str_user)
            )
            if ccar_rows:
                out_items = []
                for c_meta in ccar_rows[:20]:
                    teid = str(c_meta.get("strTEID") or "").strip()
                    if not teid:
                        continue
                    p_rows = self._parse_gpspos_records(
                        self._call_gpspos_api(base_url, "Proc_GetLastPosition", [teid], user=str_user)
                    )
                    if p_rows:
                        out_items.append(convert_gpspos_item(p_rows[0], car_meta=c_meta))
                    else:
                        out_items.append(convert_gpspos_item(c_meta, car_meta=c_meta))
                if out_items:
                    return out_items

            raise RuntimeError("Empty or expired response from YUKI GPS (gpspos.net) session")

        if protocol == "thaigpsdd_v2":
            opener = urllib.request.build_opener()
            headers = {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/json; charset=utf-8",
                "Cookie": str(session.get("cookie_header") or ""),
                "Connection": "close",
            }
            _, clean_target = split_account_and_target_imei(target_imei or str(session.get("target_imei") or ""))
            acc_id = int(session.get("user_id") or 0)

            # 1. If we have a numeric IMEI, query single-device status endpoint for fast real-time WGS84 telemetry
            if clean_target and clean_target.isdigit() and len(clean_target) >= 8:
                status_url = f"{base_url}/rest/loadage/device/status?imei={urllib.parse.quote(clean_target)}&mapType=2&_t={int(time.time() * 1000)}"
                req = urllib.request.Request(status_url, headers=headers)
                raw_resp = self._open_with_retry(opener, req, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
                parsed = json.loads(raw_resp)
                if isinstance(parsed, dict) and parsed.get("code") == 0 and isinstance(parsed.get("data"), dict) and parsed["data"].get("1"):
                    return [convert_thaigpsdd_item(parsed["data"])]

                rt_url = f"{base_url}/rest/device/realtime/location?imei={urllib.parse.quote(clean_target)}&mapType=2&_t={int(time.time() * 1000)}"
                req_rt = urllib.request.Request(rt_url, headers=headers)
                raw_rt = self._open_with_retry(opener, req_rt, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
                parsed_rt = json.loads(raw_rt)
                if isinstance(parsed_rt, dict) and (parsed_rt.get("resultBean") or {}).get("code") == 0 and parsed_rt.get("deviceStatusBean"):
                    return [convert_thaigpsdd_item(parsed_rt)]

            # 2. Query account device status list
            list_url = f"{base_url}/rest/loadage/device/status/list?mapType=2&_t={int(time.time() * 1000)}"
            if acc_id:
                list_url += f"&accountId={acc_id}"
            req_list = urllib.request.Request(list_url, headers=headers)
            raw_list = self._open_with_retry(opener, req_list, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
            parsed_list = json.loads(raw_list)
            if isinstance(parsed_list, list) and parsed_list:
                return [convert_thaigpsdd_item(item) for item in parsed_list if isinstance(item, dict)]

            # 3. Fallback to /rest/device/list
            if acc_id:
                dev_list_url = f"{base_url}/rest/device/list?accountId={acc_id}&needCount=true&pageSize=100&status=-1&_t={int(time.time() * 1000)}"
                req_dl = urllib.request.Request(dev_list_url, headers=headers)
                raw_dl = self._open_with_retry(opener, req_dl, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
                parsed_dl = json.loads(raw_dl)
                data_arr = parsed_dl.get("data") if isinstance(parsed_dl, dict) else None
                if isinstance(data_arr, list) and data_arr:
                    return [convert_thaigpsdd_item(item) for item in data_arr if isinstance(item, dict)]

            raise RuntimeError("Empty or expired response from ThaiGPSDD v2 session")

        payload = json.dumps({
            "UserID": int(session["user_id"]),
            "isFirst": True,
            "TimeZones": "SE Asia Standard Time",
            "DeviceID": int(session["device_id"]),
        }).encode("utf-8")

        opener = urllib.request.build_opener()
        req = urllib.request.Request(
            f"{base_url}/Ajax/DevicesAjax.asmx/GetDevicesByUserID",
            data=payload,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json; charset=utf-8",
                "Cookie": session["cookie_header"],
                "Connection": "close",
            },
        )
        raw_resp = self._open_with_retry(opener, req, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
        outer = json.loads(raw_resp)
        d_str = outer.get("d") or ""
        if not d_str:
            raise RuntimeError("Empty response from GetDevicesByUserID (session expired)")
        parsed = parse_gps903_js(d_str)
        devices = parsed.get("devices")
        if not isinstance(devices, list):
            raise RuntimeError("Invalid devices array in GetDevicesByUserID")
        return devices

    def poll_single_device(self, imei: str, force_relogin: bool = False) -> Dict[str, Any]:
        """Poll a single registered GPSONE / DDGPS / YUKI GPS device and update its cached state."""
        with self._lock:
            dev_cfg = self._devices.get(imei)
            if not dev_cfg:
                raise KeyError(f"ไม่พบอุปกรณ์ IMEI {imei}")
            password = str(dev_cfg.get("password") or "")
            login_type = str(dev_cfg.get("login_type") or "auto")
            provider_cfg = str(dev_cfg.get("provider") or "auto")
            resolved_proto = str(dev_cfg.get("resolved_protocol") or "")
            resolved_base = str(dev_cfg.get("resolved_base_url") or "")
            cached_uid = int(dev_cfg.get("user_id") or 0)
            cached_did = int(dev_cfg.get("device_id") or 0)
            cfg_name = str(dev_cfg.get("name") or "").strip()
            prev_remote_sn = str((dev_cfg.get("last_state") or {}).get("imei") or "").strip()

        _, target_sn = split_account_and_target_imei(imei)
        preferred_sn = target_sn if (target_sn != imei or target_sn.isdigit()) else (prev_remote_sn or target_sn)

        session = None if force_relogin else self._sessions.get(imei)
        raw_devices: Optional[List[Dict[str, Any]]] = None

        if session and (session.get("user_id") or session.get("device_id") or session.get("protocol") in ("thaigpsdd_v2", "gpspos_uki")):
            try:
                raw_devices = self._fetch_devices_from_session(session, target_imei=preferred_sn)
            except Exception as exc:
                logger.debug("Cached GPS session expired for %s (%s), re-authenticating...", imei, exc)
                session = None

        if raw_devices is None:
            session = self._authenticate_device(
                imei,
                password,
                login_type=login_type,
                provider=provider_cfg,
                known_user_id=cached_uid,
                known_device_id=cached_did,
                resolved_protocol=resolved_proto,
                resolved_base_url=resolved_base,
            )
            self._sessions[imei] = session
            raw_devices = self._fetch_devices_from_session(session, target_imei=preferred_sn)

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        matched = None
        for d in raw_devices:
            d_sn = str(d.get("sn") or "").strip()
            d_name = str(d.get("name") or "").strip()
            if d_sn in (imei, target_sn, preferred_sn) or d_name in (imei, target_sn, cfg_name):
                matched = d
                break

        if not matched and raw_devices:
            # Prefer online devices with valid coordinates when logged in via multi-device account
            online_with_coords = [
                d for d in raw_devices
                if str(d.get("status") or "").lower() in ("move", "stop", "sleep", "online")
                and d.get("latitude") not in (None, "", "-1", 0, "0")
                and d.get("longitude") not in (None, "", "-1", 0, "0")
            ]
            with_coords = [
                d for d in raw_devices
                if d.get("latitude") not in (None, "", "-1", 0, "0")
                and d.get("longitude") not in (None, "", "-1", 0, "0")
            ]
            matched = (online_with_coords[0] if online_with_coords else (with_coords[0] if with_coords else raw_devices[0]))

        if not matched:
            raise RuntimeError("ไม่พบข้อมูลพิกัดของอุปกรณ์จากเซิร์ฟเวอร์ GPSONE / DDGPS / YUKI GPS")

        resolved_provider = str(
            session.get("provider")
            or ("yukigps" if session.get("protocol") == "gpspos_uki" else ("ddgps" if session.get("protocol") == "thaigpsdd_v2" else "gpsone"))
        )
        default_model = "YUKI GPS" if resolved_provider == "yukigps" else ("DDGPS" if resolved_provider == "ddgps" else "GPSONE")

        # Extract coordinates (prefer WGS84 latitude/longitude, fallback to oLat/oLng, then baiduLat/baiduLng)
        lat_raw = matched.get("latitude") or matched.get("oLat") or matched.get("baiduLat")
        lng_raw = matched.get("longitude") or matched.get("oLng") or matched.get("baiduLng")
        raw_lat = float(lat_raw) if lat_raw not in (None, "", "-1") else None
        raw_lng = float(lng_raw) if lng_raw not in (None, "", "-1") else None

        speed_kmh = 0.0
        try:
            speed_kmh = float(matched.get("speed") or 0.0)
        except ValueError:
            speed_kmh = 0.0

        course = None
        try:
            c_val = float(matched.get("course") or 999)
            if 0 <= c_val <= 360:
                course = c_val
        except ValueError:
            course = None

        distance_km = 0.0
        try:
            distance_km = round(float(matched.get("distance") or 0.0), 2)
        except ValueError:
            distance_km = 0.0

        ctx_info = parse_data_context(str(matched.get("dataContext") or ""))
        status_raw = str(matched.get("status") or "Offline")
        raw_dev_time = str(matched.get("deviceUtcDate") or "")
        raw_srv_time = str(matched.get("serverUtcDate") or "")
        data_type_code = str(matched.get("dataType") or "")
        matched_sn = str(matched.get("sn") or target_sn or imei)

        # When device reports LBS cell-tower coordinates (dataType != "1"),
        # look up the tracker's last real GPS satellite fix (dataType == "1", ShowLBS == 0)
        lat = raw_lat
        lng = raw_lng
        lbs_lat: Optional[float] = None
        lbs_lng: Optional[float] = None
        gps_fix_time: str = ""
        pos_mode = "GPS ดาวเทียม" if data_type_code == "1" else ("LBS สถานีฐาน" if data_type_code == "2" else "GPS/LBS")

        with self._lock:
            prev_st = dict((self._devices.get(imei) or {}).get("last_state") or {})

        if data_type_code != "1":
            lbs_lat = raw_lat
            lbs_lng = raw_lng
            if (
                not force_relogin
                and prev_st.get("lbs_raw_time") == raw_dev_time
                and prev_st.get("gps_fix_lat") is not None
                and prev_st.get("gps_fix_lng") is not None
            ):
                lat = float(prev_st["gps_fix_lat"])
                lng = float(prev_st["gps_fix_lng"])
                gps_fix_time = str(prev_st.get("gps_fix_time") or "")
                pos_mode = "GPS ดาวเทียม (พิกัดจริงล่าสุด)"
            else:
                cached_fix_time = str(prev_st.get("gps_fix_time") or "") if not force_relogin else ""
                gps_fix = self._fetch_latest_gps_satellite_fix(
                    session=session,
                    device_id=int(matched.get("id") or session["device_id"] or cached_did),
                    ref_time_str=raw_dev_time or raw_srv_time,
                    since_time_str=cached_fix_time,
                    remote_imei=matched_sn,
                )
                if gps_fix:
                    lat = gps_fix["lat"]
                    lng = gps_fix["lng"]
                    gps_fix_time = gps_fix["device_time"]
                    pos_mode = "GPS ดาวเทียม (พิกัดจริงล่าสุด)"
                elif (
                    cached_fix_time
                    and prev_st.get("gps_fix_lat") is not None
                    and prev_st.get("gps_fix_lng") is not None
                ):
                    lat = float(prev_st["gps_fix_lat"])
                    lng = float(prev_st["gps_fix_lng"])
                    gps_fix_time = cached_fix_time
                    pos_mode = "GPS ดาวเทียม (พิกัดจริงล่าสุด)"

        now_th = datetime.datetime.now(TZ_TH)
        time_info = compute_time_correlation(raw_dev_time or raw_srv_time, now_th=now_th)
        status_th, is_online = translate_status_th(status_raw, age_th=time_info["age_th"])

        # Maintain unlimited real-time breadcrumb trail and persist every movement point permanently in SQLite
        live_trail: List[Dict[str, Any]] = list(prev_st.get("live_trail") or [])
        if lat is not None and lng is not None:
            pt_time = time_info["device_time"] or raw_dev_time or time_info["real_time_th"]
            rep_stop_min = int(matched.get("stopTimeMinute") or 0)
            should_append = False
            if not live_trail:
                should_append = True
            else:
                last_pt = live_trail[-1]
                d_lat = abs(float(last_pt.get("lat", 0.0)) - float(lat))
                d_lng = abs(float(last_pt.get("lng", 0.0)) - float(lng))
                if d_lat > 0.00003 or d_lng > 0.00003:
                    should_append = True
            if should_append:
                live_trail.append({
                    "lat": float(lat),
                    "lng": float(lng),
                    "speed_kmh": speed_kmh,
                    "course": course,
                    "time": pt_time,
                    "arrive_time": pt_time,
                    "depart_time": pt_time,
                    "stop_minutes": rep_stop_min,
                    "is_stop": bool(rep_stop_min >= 1 or speed_kmh <= 1.5),
                })
                self._save_history_points(
                    imei,
                    [{
                        "lat": float(lat),
                        "lng": float(lng),
                        "speed_kmh": speed_kmh,
                        "course": course,
                        "recorded_at": pt_time,
                        "is_stop": speed_kmh < 1.0,
                        "stop_minutes": rep_stop_min,
                        "data_type": "1" if pos_mode.startswith("GPS ดาวเทียม") else (data_type_code or "1"),
                    }],
                )
            elif live_trail:
                last_pt = live_trail[-1]
                prev_dep = str(last_pt.get("depart_time") or last_pt.get("time") or "")
                arr_t = str(last_pt.get("arrive_time") or last_pt.get("time") or pt_time)
                last_pt["arrive_time"] = arr_t
                if pt_time and pt_time > prev_dep:
                    last_pt["depart_time"] = pt_time
                t0 = self._parse_track_epoch(arr_t)
                t1 = self._parse_track_epoch(str(last_pt.get("depart_time") or pt_time))
                calc_m = int(round((t1 - t0) / 60.0)) if (t0 is not None and t1 is not None and t1 > t0) else 0
                best_stop = max(int(last_pt.get("stop_minutes") or 0), rep_stop_min, calc_m)
                last_pt["stop_minutes"] = best_stop
                if best_stop >= 1 or speed_kmh <= 1.5:
                    last_pt["is_stop"] = True
                if pt_time and pt_time != prev_dep:
                    self._save_history_points(
                        imei,
                        [{
                            "lat": float(lat),
                            "lng": float(lng),
                            "speed_kmh": speed_kmh,
                            "course": course,
                            "recorded_at": pt_time,
                            "is_stop": True,
                            "stop_minutes": best_stop,
                            "data_type": "1" if pos_mode.startswith("GPS ดาวเทียม") else (data_type_code or "1"),
                        }],
                    )

        state = {
            "device_id": int(matched.get("id") or session["device_id"] or cached_did),
            "user_id": int(session["user_id"] or cached_uid),
            "imei": matched_sn,
            "remote_name": str(matched.get("name") or imei),
            "model_name": str(matched.get("modelName") or default_model),
            "provider": resolved_provider,
            "server_url": str(session.get("base_url") or ""),
            "latitude": lat,
            "longitude": lng,
            "gps_fix_lat": lat if pos_mode.startswith("GPS ดาวเทียม") else None,
            "gps_fix_lng": lng if pos_mode.startswith("GPS ดาวเทียม") else None,
            "gps_fix_time": gps_fix_time or (raw_dev_time if data_type_code == "1" else ""),
            "lbs_latitude": lbs_lat,
            "lbs_longitude": lbs_lng,
            "lbs_raw_time": raw_dev_time,
            "speed_kmh": speed_kmh,
            "course": course,
            "status": status_raw,
            "status_th": status_th,
            "is_online": is_online,
            "battery_pct": ctx_info["battery_pct"],
            "acc_on": ctx_info["acc_on"],
            "gsm_signal": ctx_info["gsm_signal"],
            "pos_mode": pos_mode,
            "distance_km": distance_km,
            "stop_minutes": int(matched.get("stopTimeMinute") or 0),
            "device_time": time_info["device_time"] or raw_dev_time,
            "server_time": raw_srv_time,
            "real_time_th": time_info["real_time_th"],
            "age_seconds": time_info["age_seconds"],
            "age_th": time_info["age_th"],
            "live_trail": live_trail,
            "polled_at": now_iso,
            "last_error": None,
        }

        with self._lock:
            if imei in self._devices:
                prev_cookie = self._devices[imei].get("cookie_header")
                prev_st_saved = self._devices[imei].get("last_state") or {}
                prev_time = prev_st_saved.get("device_time")
                prev_lat = prev_st_saved.get("latitude")
                prev_online = bool(prev_st_saved.get("is_online", False))
                prev_enabled = bool(self._devices[imei].get("enabled", True))
                # If the device is online and sends a brand new GPS satellite coordinate, auto-release manual override
                if (
                    is_online
                    and data_type_code == "1"
                    and raw_dev_time
                    and raw_dev_time != prev_st.get("lbs_raw_time")
                    and self._devices[imei].get("override_lat") is not None
                ):
                    self._devices[imei]["override_lat"] = None
                    self._devices[imei]["override_lng"] = None

                # Auto-manage pin visibility: online -> enabled (unless manually hidden), offline -> disabled (unless force_show_offline)
                if is_online:
                    if not self._devices[imei].get("manual_hide_online", False):
                        self._devices[imei]["enabled"] = True
                        self._devices[imei]["force_show_offline"] = False
                else:
                    if prev_online:
                        self._devices[imei]["force_show_offline"] = False
                        self._devices[imei]["enabled"] = False
                    elif not self._devices[imei].get("force_show_offline", False):
                        self._devices[imei]["enabled"] = False

                self._devices[imei]["provider"] = resolved_provider
                self._devices[imei]["resolved_protocol"] = str(session.get("protocol") or "aspx_gps903")
                self._devices[imei]["resolved_base_url"] = str(session.get("base_url") or GPS903_BASE_URL)
                self._devices[imei]["user_id"] = state["user_id"]
                self._devices[imei]["device_id"] = state["device_id"]
                self._devices[imei]["cookie_header"] = session["cookie_header"]
                self._devices[imei]["last_state"] = state
                if (
                    prev_cookie != session["cookie_header"]
                    or prev_time != state["device_time"]
                    or prev_lat != state["latitude"]
                    or prev_online != is_online
                    or prev_enabled != bool(self._devices[imei].get("enabled", True))
                ):
                    self._save_to_disk()

        return state

    def _fetch_latest_gps_satellite_fix(
        self,
        session: Dict[str, Any],
        device_id: int,
        ref_time_str: str,
        since_time_str: str = "",
        remote_imei: str = "",
    ) -> Optional[Dict[str, Any]]:
        """Query history with ShowLBS=0 / locationType=1 to retrieve the last accurate GPS satellite fix."""
        protocol = str(session.get("protocol") or "aspx_gps903")
        base_url = str(session.get("base_url") or GPS903_BASE_URL).rstrip("/")

        try:
            ref_dt = datetime.datetime.now(TZ_TH).replace(tzinfo=None)
            if ref_time_str:
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
                    try:
                        ref_dt = datetime.datetime.strptime(ref_time_str[:19], fmt)
                        break
                    except ValueError:
                        continue
            start_dt = ref_dt - datetime.timedelta(days=30)
            if since_time_str:
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
                    try:
                        parsed_since = datetime.datetime.strptime(since_time_str[:19], fmt)
                        if parsed_since <= ref_dt:
                            start_dt = parsed_since
                        break
                    except ValueError:
                        continue

            if protocol == "gpspos_uki":
                q_imei = str(remote_imei or session.get("target_imei") or "").strip()
                if not q_imei:
                    return None
                str_user = str(session.get("str_user") or q_imei)
                start_ts = int(start_dt.replace(tzinfo=TZ_TH).timestamp())
                end_ts = int((ref_dt + datetime.timedelta(days=1)).replace(tzinfo=TZ_TH).timestamp())
                resp = self._call_gpspos_api(base_url, "Proc_GetTrack", [q_imei, start_ts, end_ts, 3000], user=str_user)
                track_rows = self._parse_gpspos_records(resp)
                for pt in reversed(track_rows):
                    try:
                        te_st = int(pt.get("nTEState") or 0)
                        if (te_st & (8192 | 4096 | 128)) != 0:
                            continue
                        lat_v = float(pt.get("dbLat") or 0.0)
                        lng_v = float(pt.get("dbLon") or 0.0)
                    except (TypeError, ValueError):
                        continue
                    if lat_v not in (0.0, -1.0) and lng_v not in (0.0, -1.0):
                        return {
                            "lat": lat_v,
                            "lng": lng_v,
                            "device_time": ms_or_sec_to_thai_str(pt.get("nTime")),
                        }
                return None

            if protocol == "thaigpsdd_v2":
                q_imei = str(remote_imei or session.get("target_imei") or "").strip()
                if not q_imei:
                    return None
                start_ts = int(start_dt.replace(tzinfo=TZ_TH).timestamp())
                end_ts = int((ref_dt + datetime.timedelta(days=1)).replace(tzinfo=TZ_TH).timestamp())
                trk_url = (
                    f"{base_url}/rest/device/track/{urllib.parse.quote(q_imei)}/v3"
                    f"?startTime={start_ts}&endTime={end_ts}&locationType=1&mapType=2"
                    f"&filterNoise=1&filterStillPoints=0&needStay=1&stayThreshold=300"
                    f"&zoneId=Asia/Bangkok&lang=th&_t={int(time.time() * 1000)}"
                )
                opener = urllib.request.build_opener()
                req = urllib.request.Request(
                    trk_url,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept": "application/json",
                        "Cookie": str(session.get("cookie_header") or ""),
                        "Connection": "close",
                    },
                )
                raw_resp = self._open_with_retry(opener, req, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
                parsed = json.loads(raw_resp)
                histories = parsed.get("histories") or []
                for pt in reversed(histories):
                    try:
                        lat_v = float(pt.get("9"))
                        lng_v = float(pt.get("10"))
                    except (TypeError, ValueError):
                        continue
                    if lat_v not in (0.0, -1.0) and lng_v not in (0.0, -1.0):
                        return {
                            "lat": lat_v,
                            "lng": lng_v,
                            "device_time": ms_or_sec_to_thai_str(pt.get("7") or pt.get("8")),
                        }
                return None

            if not device_id:
                return None
            start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
            end_str = (ref_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
            payload = json.dumps({
                "DeviceID": int(device_id),
                "Start": start_str,
                "End": end_str,
                "TimeZone": "SE Asia Standard Time",
                "ShowLBS": 0,
            }).encode("utf-8")
            opener = urllib.request.build_opener()
            req = urllib.request.Request(
                f"{base_url}/Ajax/DevicesAjax.asmx/GetDevicesHistory",
                data=payload,
                headers={
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/json; charset=utf-8",
                    "Cookie": session["cookie_header"],
                    "Connection": "close",
                },
            )
            raw_resp = self._open_with_retry(opener, req, timeout=10.0, retries=2).decode("utf-8", errors="ignore")
            outer = json.loads(raw_resp)
            d_str = outer.get("d") or ""
            if not d_str:
                return None
            parsed = parse_gps903_js(d_str)
            pts = parsed.get("devices") or []
            for pt in reversed(pts):
                lat_r = pt.get("latitude") or pt.get("oLat") or pt.get("baiduLat")
                lng_r = pt.get("longitude") or pt.get("oLng") or pt.get("baiduLng")
                try:
                    lat_v = float(lat_r)
                    lng_v = float(lng_r)
                except (TypeError, ValueError):
                    continue
                if lat_v not in (0.0, -1.0) and lng_v not in (0.0, -1.0):
                    return {
                        "lat": lat_v,
                        "lng": lng_v,
                        "device_time": str(pt.get("deviceUtcDate") or pt.get("serverUtcTime") or ""),
                    }
        except Exception as exc:
            logger.debug("Failed to fetch latest GPS satellite fix for device %s: %s", device_id, exc)
        return None

    def poll_all_enabled(self) -> None:
        with self._lock:
            self._poll_tick = (self._poll_tick + 1) % 100000
            tick = self._poll_tick
            imeis = []
            for k, v in self._devices.items():
                if v.get("login_type") == "manual":
                    continue
                is_dev_online = bool((v.get("last_state") or {}).get("is_online", False))
                is_dev_enabled = bool(v.get("enabled", False))
                # Poll online/enabled devices every 1.5s; poll offline/disabled devices every 4th tick (~6s) to detect wakeup
                if is_dev_online or is_dev_enabled or (tick % 4 == 0):
                    imeis.append(k)

        for imei in imeis:
            if self._stop_event.is_set():
                break
            try:
                self.poll_single_device(imei)
            except Exception as exc:
                logger.warning("GPS poll failed for %s: %s", imei, exc)
                with self._lock:
                    if imei in self._devices:
                        last_st = dict(self._devices[imei].get("last_state") or {})
                        last_st["last_error"] = str(exc)
                        last_st["polled_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        self._devices[imei]["last_state"] = last_st

    def list_devices(
        self,
        include_disabled: bool = True,
        viewer_user: Optional[str] = None,
        viewer_role: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return configured GPSONE / DDGPS / YUKI GPS devices with their latest state (passwords masked), filtered by viewer permissions."""
        with self._lock:
            out = []
            now_th = datetime.datetime.now(TZ_TH)
            enforce_perm = (viewer_user is not None) or (viewer_role is not None)
            for imei, cfg in self._devices.items():
                if enforce_perm and not can_user_view_device(cfg, viewer_user, viewer_role):
                    continue
                st = cfg.get("last_state") or {}
                is_manual_pin = (cfg.get("login_type") == "manual") or (st.get("status") == "Pinned")
                raw_dev_time = str(st.get("device_time") or st.get("server_time") or "")
                time_info = compute_time_correlation(raw_dev_time, now_th=now_th)
                status_raw = str(st.get("status") or ("Pinned" if is_manual_pin else "Unknown"))
                if is_manual_pin:
                    status_th, is_online = "ปักหมุดพิกัด", True
                elif status_raw != "Unknown":
                    status_th, is_online = translate_status_th(status_raw, age_th=time_info["age_th"])
                else:
                    status_th, is_online = (st.get("status_th") or "รอซิงค์ข้อมูล..."), bool(st.get("is_online", False))

                # Ensure online trackers are automatically enabled on the map (unless manually hidden while online)
                if not is_manual_pin:
                    if is_online and not cfg.get("manual_hide_online", False) and not cfg.get("enabled", True):
                        cfg["enabled"] = True
                    elif not is_online and not cfg.get("force_show_offline", False) and cfg.get("enabled", True):
                        cfg["enabled"] = False

                if not include_disabled and not cfg.get("enabled", True):
                    continue

                override_lat = cfg.get("override_lat")
                override_lng = cfg.get("override_lng")
                final_lat = float(override_lat) if override_lat is not None else st.get("latitude")
                final_lng = float(override_lng) if override_lng is not None else st.get("longitude")
                pos_mode = "พิกัดปรับตั้งเอง" if (override_lat is not None and override_lng is not None) else (st.get("pos_mode") or "GPS/LBS")
                owner_user = str(cfg.get("owner_user") or "").strip().lower()
                allowed_users = normalize_allowed_users(cfg.get("allowed_users"), owner_user=owner_user)
                can_manage = can_user_manage_device(cfg, viewer_user, viewer_role)

                raw_prov = "manual" if is_manual_pin else str(cfg.get("provider") or st.get("provider") or "gpsone").lower()
                if raw_prov in ("yukigps", "ukigps", "yuki", "uki", "gpspos") or cfg.get("resolved_protocol") == "gpspos_uki":
                    prov_norm = "yukigps"
                    prov_label = "YUKI GPS"
                elif raw_prov in ("ddgps", "thaigpsdd", "gpsdd_net", "gpsdd") or cfg.get("resolved_protocol") == "thaigpsdd_v2":
                    prov_norm = "ddgps"
                    prov_label = "DDGPS"
                elif raw_prov == "manual":
                    prov_norm = "manual"
                    prov_label = "MANUAL"
                else:
                    prov_norm = "gpsone"
                    prov_label = "GPSONE"

                out.append({
                    "imei": imei,
                    "remote_imei": str(st.get("imei") or imei),
                    "name": cfg.get("name") or f"{prov_label} {imei[-4:]}",
                    "icon_type": cfg.get("icon_type") or "target",
                    "login_type": cfg.get("login_type") or "imei",
                    "mode": "manual" if is_manual_pin else "gpsone",
                    "provider": prov_norm,
                    "provider_label": prov_label,
                    "server_url": str(cfg.get("resolved_base_url") or st.get("server_url") or ""),
                    "enabled": bool(cfg.get("enabled", True)),
                    "owner_user": owner_user,
                    "can_manage": can_manage,
                    "allowed_users": allowed_users,
                    "notes": cfg.get("notes") or "",
                    "user_id": cfg.get("user_id") or st.get("user_id"),
                    "device_id": cfg.get("device_id") or st.get("device_id"),
                    "model_name": st.get("model_name") or ("พิกัดกำหนดเอง" if is_manual_pin else prov_label),
                    "latitude": final_lat,
                    "longitude": final_lng,
                    "override_lat": override_lat,
                    "override_lng": override_lng,
                    "gps_fix_lat": st.get("gps_fix_lat"),
                    "gps_fix_lng": st.get("gps_fix_lng"),
                    "gps_fix_time": st.get("gps_fix_time") or "",
                    "lbs_latitude": st.get("lbs_latitude"),
                    "lbs_longitude": st.get("lbs_longitude"),
                    "speed_kmh": st.get("speed_kmh", 0.0),
                    "course": st.get("course"),
                    "status": status_raw,
                    "status_th": status_th,
                    "is_online": is_online,
                    "battery_pct": st.get("battery_pct"),
                    "acc_on": st.get("acc_on"),
                    "gsm_signal": st.get("gsm_signal"),
                    "pos_mode": pos_mode,
                    "distance_km": st.get("distance_km", 0.0),
                    "stop_minutes": st.get("stop_minutes", 0),
                    "device_time": time_info["device_time"] or raw_dev_time,
                    "server_time": st.get("server_time") or "",
                    "real_time_th": time_info["real_time_th"],
                    "age_seconds": time_info["age_seconds"],
                    "age_th": time_info["age_th"],
                    "live_trail": (st.get("live_trail") or [])[-20:],
                    "live_trail_total": len(st.get("live_trail") or []),
                    "polled_at": st.get("polled_at") or "",
                    "last_error": st.get("last_error"),
                })
            return out

    def upsert_device(
        self,
        imei: str,
        password: Optional[str] = None,
        name: Optional[str] = None,
        icon_type: str = "target",
        enabled: bool = True,
        notes: str = "",
        verify_login: bool = True,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        mode: str = "gpsone",
        provider: str = "auto",
        allowed_users: Optional[List[str]] = None,
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add or update a GPSONE / DDGPS / YUKI GPS tracker (or manual GPS pin) and optionally verify credentials immediately."""
        clean_imei = str(imei or "").strip()
        actor_clean = str(actor_user or "").strip().lower()
        is_manual = (mode == "manual") or (latitude is not None and longitude is not None and not (password and password.strip()))

        if is_manual:
            if latitude is None or longitude is None:
                raise ValueError("กรุณาระบุพิกัดละติจูดและลองจิจูด (Latitude, Longitude)")
            if not clean_imei:
                clean_imei = f"GPS-{int(time.time())}"
            now_str = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S")
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            with self._lock:
                existing = self._devices.get(clean_imei, {})
                if existing and (actor_user or actor_role) and not can_user_manage_device(existing, actor_user, actor_role):
                    raise PermissionError("คุณสามารถแก้ไขได้เฉพาะหมุดหรืออุปกรณ์ GPS ที่คุณเป็นผู้เพิ่มเท่านั้น (หรือต้องเป็น Superadmin)")
                owner_user = str(existing.get("owner_user") or actor_clean or "").strip().lower()
                final_name = (name or "").strip() or existing.get("name") or f"หมุด GPS ({clean_imei[-4:]})"
                final_allowed = normalize_allowed_users(
                    allowed_users if allowed_users is not None else existing.get("allowed_users"),
                    owner_user=owner_user,
                )
                state = {
                    "device_id": 0,
                    "user_id": 0,
                    "imei": clean_imei,
                    "remote_name": final_name,
                    "model_name": "หมุดพิกัด GPS",
                    "provider": "manual",
                    "latitude": float(latitude),
                    "longitude": float(longitude),
                    "speed_kmh": 0.0,
                    "course": None,
                    "status": "Pinned",
                    "status_th": "ปักหมุดพิกัด",
                    "is_online": True,
                    "battery_pct": 100,
                    "acc_on": True,
                    "gsm_signal": 100,
                    "pos_mode": "พิกัดกำหนดเอง",
                    "distance_km": 0.0,
                    "stop_minutes": 0,
                    "device_time": now_str,
                    "server_time": now_str,
                    "polled_at": now_iso,
                    "last_error": None,
                }
                record = {
                    "imei": clean_imei,
                    "password": "",
                    "name": final_name,
                    "icon_type": icon_type or existing.get("icon_type") or "target",
                    "login_type": "manual",
                    "provider": "manual",
                    "enabled": bool(enabled),
                    "owner_user": owner_user,
                    "allowed_users": final_allowed,
                    "notes": notes if notes is not None else (existing.get("notes") or ""),
                    "user_id": 0,
                    "device_id": 0,
                    "cookie_header": "",
                    "last_state": state,
                    "updated_at": now_iso,
                }
                self._devices[clean_imei] = record
                self._save_to_disk()
            devices = [d for d in self.list_devices(include_disabled=True, viewer_user=actor_user, viewer_role=actor_role) if d["imei"] == clean_imei]
            return devices[0] if devices else record

        if not clean_imei:
            raise ValueError("กรุณาระบุเลข IMEI หรือชื่อบัญชี GPSONE / DDGPS / YUKI GPS")

        with self._lock:
            existing = self._devices.get(clean_imei, {})
            if existing and (actor_user or actor_role) and not can_user_manage_device(existing, actor_user, actor_role):
                raise PermissionError("คุณสามารถแก้ไขได้เฉพาะอุปกรณ์ GPS ที่คุณเป็นผู้เพิ่มเท่านั้น (หรือต้องเป็น Superadmin)")
            final_password = password.strip() if (password and password.strip()) else str(existing.get("password") or "")
            if not final_password:
                raise ValueError("กรุณาระบุรหัสผ่านของอุปกรณ์ GPSONE / DDGPS / YUKI GPS")

            owner_user = str(existing.get("owner_user") or actor_clean or "").strip().lower()
            final_name = (name or "").strip() or existing.get("name") or f"GPS ติดตาม ({clean_imei[-4:]})"
            final_allowed = normalize_allowed_users(
                allowed_users if allowed_users is not None else existing.get("allowed_users"),
                owner_user=owner_user,
            )
            override_lat = existing.get("override_lat")
            override_lng = existing.get("override_lng")
            if latitude is not None and longitude is not None:
                if float(latitude) == 0.0 and float(longitude) == 0.0:
                    override_lat = None
                    override_lng = None
                else:
                    override_lat = float(latitude)
                    override_lng = float(longitude)

            req_provider = (provider or "").strip().lower()
            if not req_provider or req_provider == "auto":
                req_provider = str(existing.get("provider") or "auto")

            login_user, _ = split_account_and_target_imei(clean_imei)
            record = {
                "imei": clean_imei,
                "password": final_password,
                "name": final_name,
                "icon_type": icon_type or existing.get("icon_type") or "target",
                "login_type": "imei" if (login_user.isdigit() and len(login_user) >= 10) else "account",
                "provider": req_provider,
                "resolved_protocol": existing.get("resolved_protocol") or "",
                "resolved_base_url": existing.get("resolved_base_url") or "",
                "enabled": bool(enabled),
                "owner_user": owner_user,
                "allowed_users": final_allowed,
                "force_show_offline": bool(enabled),
                "manual_hide_online": bool(not enabled),
                "notes": notes if notes is not None else (existing.get("notes") or ""),
                "override_lat": override_lat,
                "override_lng": override_lng,
                "user_id": existing.get("user_id"),
                "device_id": existing.get("device_id"),
                "cookie_header": existing.get("cookie_header"),
                "last_state": existing.get("last_state") or {},
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            self._devices[clean_imei] = record
            self._save_to_disk()

        if verify_login:
            try:
                self.poll_single_device(clean_imei, force_relogin=True)
                self._save_to_disk()
            except ValueError:
                if not existing:
                    with self._lock:
                        self._devices.pop(clean_imei, None)
                        self._save_to_disk()
                raise
            except Exception as exc:
                logger.warning("Initial poll warning for %s: %s", clean_imei, exc)

        devices = [d for d in self.list_devices(include_disabled=True, viewer_user=actor_user, viewer_role=actor_role) if d["imei"] == clean_imei]
        return devices[0] if devices else record

    def set_device_enabled(
        self,
        imei: str,
        enabled: Optional[bool] = None,
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Toggle or set enabled state for a single GPS device."""
        clean_imei = str(imei or "").strip()
        with self._lock:
            if clean_imei not in self._devices:
                raise KeyError(f"ไม่พบอุปกรณ์ IMEI {clean_imei}")
            cfg = self._devices[clean_imei]
            if (actor_user or actor_role) and not can_user_view_device(cfg, actor_user, actor_role):
                raise PermissionError("คุณไม่มีสิทธิ์เปิดหรือปิดอุปกรณ์ GPS นี้")
            current = bool(cfg.get("enabled", True))
            new_state = (not current) if enabled is None else bool(enabled)
            st = cfg.get("last_state") or {}
            is_manual_pin = (cfg.get("login_type") == "manual") or (st.get("status") == "Pinned")
            status_raw = str(st.get("status") or ("Pinned" if is_manual_pin else "Unknown"))
            _, is_online = ("ปักหมุดพิกัด", True) if is_manual_pin else translate_status_th(status_raw)

            cfg["enabled"] = new_state
            if new_state:
                cfg["manual_hide_online"] = False
                cfg["force_show_offline"] = bool(not is_online)
            else:
                cfg["force_show_offline"] = False
                cfg["manual_hide_online"] = True
            cfg["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self._save_to_disk()
        devices = [d for d in self.list_devices(include_disabled=True, viewer_user=actor_user, viewer_role=actor_role) if d["imei"] == clean_imei]
        return devices[0]

    def set_all_devices_enabled(
        self,
        enabled: bool,
        online_only: bool = False,
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> int:
        """Enable or disable all registered GPS devices visible to the caller at once (or enable only online devices)."""
        with self._lock:
            count = 0
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            enforce_perm = (actor_user is not None) or (actor_role is not None)
            for cfg in self._devices.values():
                if enforce_perm and not can_user_view_device(cfg, actor_user, actor_role):
                    continue
                st = cfg.get("last_state") or {}
                is_manual_pin = (cfg.get("login_type") == "manual") or (st.get("status") == "Pinned")
                status_raw = str(st.get("status") or ("Pinned" if is_manual_pin else "Unknown"))
                _, is_online = ("ปักหมุดพิกัด", True) if is_manual_pin else translate_status_th(status_raw)
                if online_only:
                    cfg["enabled"] = bool(is_online)
                    cfg["force_show_offline"] = False
                    cfg["manual_hide_online"] = False
                elif enabled:
                    cfg["enabled"] = True
                    cfg["force_show_offline"] = bool(not is_online)
                    cfg["manual_hide_online"] = False
                else:
                    cfg["enabled"] = False
                    cfg["force_show_offline"] = False
                    cfg["manual_hide_online"] = True
                cfg["updated_at"] = now_iso
                count += 1
            if count > 0:
                self._save_to_disk()
            return count

    def set_device_allowed_users(
        self,
        imei: str,
        allowed_users: List[str],
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Set the list of usernames allowed to view a specific GPS device (always preserving owner_user)."""
        clean_imei = str(imei or "").strip()
        with self._lock:
            if clean_imei not in self._devices:
                raise KeyError(f"ไม่พบอุปกรณ์ IMEI {clean_imei}")
            cfg = self._devices[clean_imei]
            if (actor_user or actor_role) and not can_user_manage_device(cfg, actor_user, actor_role):
                raise PermissionError("คุณสามารถกำหนดสิทธิ์การดูได้เฉพาะอุปกรณ์ GPS ที่คุณเป็นผู้เพิ่มเท่านั้น (หรือต้องเป็น Superadmin)")
            owner_u = str(cfg.get("owner_user") or "").strip().lower()
            cleaned = normalize_allowed_users(allowed_users, owner_user=owner_u)
            cfg["allowed_users"] = cleaned
            cfg["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self._save_to_disk()
        devices = [d for d in self.list_devices(include_disabled=True, viewer_user=actor_user, viewer_role=actor_role) if d["imei"] == clean_imei]
        return devices[0]

    def set_user_allowed_devices(
        self,
        username: str,
        imeis: List[str],
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Configure which GPS devices a specific user is allowed to view (scoped to devices manageable by actor)."""
        clean_user = str(username or "").strip()
        if not clean_user:
            raise ValueError("กรุณาระบุชื่อผู้ใช้งาน (username)")
        user_low = clean_user.lower()
        target_imeis = {str(x).strip() for x in (imeis or []) if str(x).strip()}
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        enforce_manage = (actor_user is not None) or (actor_role is not None)

        with self._lock:
            for dev_imei, cfg in self._devices.items():
                if enforce_manage and not can_user_manage_device(cfg, actor_user, actor_role):
                    continue
                owner_u = str(cfg.get("owner_user") or "").strip().lower()
                current_list = [str(u).strip() for u in (cfg.get("allowed_users") or []) if str(u).strip()]
                filtered = [u for u in current_list if u.lower() != user_low and u != "*"]
                if dev_imei in target_imeis or "*" in target_imeis:
                    filtered.append(user_low)
                cfg["allowed_users"] = normalize_allowed_users(filtered, owner_user=owner_u)
                cfg["updated_at"] = now_iso
            self._save_to_disk()

        visible_devs = self.list_devices(include_disabled=True, viewer_user=actor_user, viewer_role=actor_role)
        return {
            "username": clean_user,
            "allowed_imeis": [
                d["imei"]
                for d in visible_devs
                if user_low in {u.lower() for u in (d.get("allowed_users") or [])}
            ],
            "all_devices": visible_devs,
        }

    def get_permissions_matrix(
        self,
        viewer_user: Optional[str] = None,
        viewer_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return manageable GPS devices, system users, and per-user mapping of allowed GPS devices."""
        all_visible = self.list_devices(include_disabled=True, viewer_user=viewer_user, viewer_role=viewer_role)
        is_super = is_superadmin_user(viewer_user, viewer_role)
        if is_super:
            devices = all_visible
        else:
            devices = [d for d in all_visible if d.get("can_manage")]

        user_map: Dict[str, List[str]] = {}
        for d in devices:
            for u in (d.get("allowed_users") or []):
                u_key = str(u).strip().lower()
                if not u_key:
                    continue
                user_map.setdefault(u_key, []).append(d["imei"])

        users_list: List[Dict[str, Any]] = []
        try:
            secret = os.environ.get("MEDIA_COMPAT_PROXY_SHARED_SECRET", "bpp_dev_secret_2026_!@#")
            req = urllib.request.Request(
                "http://auth-service:5002/auth/internal/users",
                headers={"X-BPP-Proxy-Secret": secret},
            )
            raw = urllib.request.urlopen(req, timeout=3.0).read().decode("utf-8", errors="ignore")
            parsed_users = json.loads(raw)
            if isinstance(parsed_users, list):
                users_list = parsed_users
        except Exception as exc:
            logger.debug("Fallback user list in get_permissions_matrix: %s", exc)

        return {
            "devices": devices,
            "all_visible_devices": all_visible,
            "users": users_list,
            "user_map": user_map,
            "superadmin_users": sorted(SUPERADMIN_USERS),
            "viewer_user": (viewer_user or "").strip().lower(),
            "viewer_role": (viewer_role or "").strip().lower(),
            "is_superadmin": is_super,
        }

    def delete_device(
        self,
        imei: str,
        actor_user: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> bool:
        clean_imei = str(imei or "").strip()
        with self._lock:
            cfg = self._devices.get(clean_imei)
            if not cfg:
                return False
            if (actor_user or actor_role) and not can_user_manage_device(cfg, actor_user, actor_role):
                raise PermissionError("คุณสามารถลบได้เฉพาะอุปกรณ์ GPS ที่คุณเป็นผู้เพิ่มเท่านั้น (หรือต้องเป็น Superadmin)")
            self._devices.pop(clean_imei, None)
            self._sessions.pop(clean_imei, None)
            self._save_to_disk()
            return True

    def _fetch_cloud_history_window(
        self,
        clean_imei: str,
        session: Dict[str, Any],
        q_imei: str,
        start_time: str,
        end_time: str,
        lbs_flag: int = 0,
    ) -> List[Dict[str, Any]]:
        """Fetch a single time window of historical points from GPSONE, DDGPS, or YUKI GPS cloud."""
        opener = urllib.request.build_opener()
        protocol = str(session.get("protocol") or "aspx_gps903")
        base_url = str(session.get("base_url") or GPS903_BASE_URL).rstrip("/")

        def _parse_to_unix(s_str: str) -> int:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
                try:
                    dt = datetime.datetime.strptime(s_str[:19], fmt).replace(tzinfo=TZ_TH)
                    return int(dt.timestamp())
                except ValueError:
                    continue
            return int(time.time())

        if protocol == "gpspos_uki":
            s_ts = _parse_to_unix(start_time)
            e_ts = _parse_to_unix(end_time)
            str_user = str(session.get("str_user") or q_imei)
            resp = self._call_gpspos_api(base_url, "Proc_GetTrack", [q_imei, s_ts, e_ts, 10000], user=str_user)
            track_rows = self._parse_gpspos_records(resp)
            points: List[Dict[str, Any]] = []
            for pt in track_rows:
                try:
                    te_st = int(pt.get("nTEState") or 0)
                    is_lbs = (te_st & (8192 | 4096)) != 0
                    if not lbs_flag and is_lbs:
                        continue
                    lat = float(pt.get("dbLat") or 0.0)
                    lng = float(pt.get("dbLon") or 0.0)
                except (TypeError, ValueError):
                    continue
                if lat in (0.0, -1.0) or lng in (0.0, -1.0):
                    continue
                spd = 0.0
                try:
                    spd = float(pt.get("nSpeed") or 0.0)
                except (TypeError, ValueError):
                    pass
                crs = None
                try:
                    c_val = float(pt.get("nDirection") or 999)
                    if 0 <= c_val <= 360:
                        crs = c_val
                except (TypeError, ValueError):
                    pass
                rec_time = normalize_track_timestamp(ms_or_sec_to_thai_str(pt.get("nTime")))
                if not rec_time:
                    continue
                points.append({
                    "lat": lat,
                    "lng": lng,
                    "latitude": lat,
                    "longitude": lng,
                    "speed": spd,
                    "speed_kmh": spd,
                    "heading": crs,
                    "recorded_at": rec_time,
                    "device_time": rec_time,
                    "is_stop": spd < 2.0,
                    "stop_minutes": 0,
                    "data_type": "2" if is_lbs else "1",
                })
            return points

        if protocol == "thaigpsdd_v2":
            s_ts = _parse_to_unix(start_time)
            e_ts = _parse_to_unix(end_time)
            loc_param = "0,1,2" if lbs_flag else "1"
            url = (
                f"{base_url}/rest/device/track/{urllib.parse.quote(q_imei)}/v3"
                f"?startTime={s_ts}&endTime={e_ts}&locationType={loc_param}&mapType=2"
                f"&filterNoise=1&filterStillPoints=0&needStay=1&stayThreshold=300"
                f"&zoneId=Asia/Bangkok&lang=th&_t={int(time.time() * 1000)}"
            )
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                    "Cookie": str(session.get("cookie_header") or ""),
                    "Connection": "close",
                },
            )
            raw_resp = self._open_with_retry(opener, req, timeout=15.0, retries=2).decode("utf-8", errors="ignore")
            parsed = json.loads(raw_resp)
            if not isinstance(parsed, dict) or (parsed.get("resultBean") or {}).get("code") != 0:
                raise RuntimeError("Empty or invalid ThaiGPSDD history response")
            hist_items = parsed.get("histories") or []
            points = []
            for pt in hist_items:
                try:
                    lat = float(pt.get("9"))
                    lng = float(pt.get("10"))
                except (TypeError, ValueError):
                    continue
                if lat in (0.0, -1.0) or lng in (0.0, -1.0):
                    continue
                spd = 0.0
                try:
                    spd = float(pt.get("12") or 0.0)
                except (TypeError, ValueError):
                    pass
                crs = None
                try:
                    c_val = float(pt.get("4") or 999)
                    if 0 <= c_val <= 360:
                        crs = c_val
                except (TypeError, ValueError):
                    pass
                rec_time = normalize_track_timestamp(ms_or_sec_to_thai_str(pt.get("7") or pt.get("8")))
                if not rec_time:
                    continue
                loc_t = pt.get("11")
                points.append({
                    "lat": lat,
                    "lng": lng,
                    "latitude": lat,
                    "longitude": lng,
                    "speed": spd,
                    "speed_kmh": spd,
                    "heading": crs,
                    "recorded_at": rec_time,
                    "device_time": rec_time,
                    "is_stop": bool(pt.get("16")),
                    "stop_minutes": int(float(pt.get("17") or 0) // 60),
                    "data_type": "1" if str(loc_t) == "1" else "2",
                })
            return points

        req_payload = json.dumps({
            "DeviceID": int(session["device_id"]),
            "Start": start_time,
            "End": end_time,
            "TimeZone": "SE Asia Standard Time",
            "ShowLBS": int(lbs_flag),
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/Ajax/DevicesAjax.asmx/GetDevicesHistory",
            data=req_payload,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json; charset=utf-8",
                "Cookie": session["cookie_header"],
                "Connection": "close",
            },
        )
        raw_resp = self._open_with_retry(opener, req, timeout=15.0, retries=2).decode("utf-8", errors="ignore")
        outer = json.loads(raw_resp)
        d_str = outer.get("d") or ""
        if not d_str:
            raise RuntimeError("Empty history response")
        parsed = parse_gps903_js(d_str)
        raw_points = parsed.get("devices") or []
        points = []
        for pt in raw_points:
            lat_r = pt.get("latitude") or pt.get("oLat") or pt.get("baiduLat")
            lng_r = pt.get("longitude") or pt.get("oLng") or pt.get("baiduLng")
            try:
                lat = float(lat_r)
                lng = float(lng_r)
            except (TypeError, ValueError):
                continue
            if lat in (0.0, -1.0) or lng in (0.0, -1.0):
                continue
            spd = 0.0
            try:
                spd = float(pt.get("speed") or 0.0)
            except ValueError:
                pass
            crs = None
            try:
                c_val = float(pt.get("course") or 999)
                if 0 <= c_val <= 360:
                    crs = c_val
            except ValueError:
                pass
            rec_time = normalize_track_timestamp(str(pt.get("deviceUtcDate") or pt.get("serverUtcTime") or ""))
            if not rec_time:
                continue
            points.append({
                "lat": lat,
                "lng": lng,
                "latitude": lat,
                "longitude": lng,
                "speed": spd,
                "speed_kmh": spd,
                "heading": crs,
                "recorded_at": rec_time,
                "device_time": rec_time,
                "is_stop": bool(pt.get("IsStop") or pt.get("isStop")),
                "stop_minutes": int(pt.get("stopTimeMinute") or 0),
                "data_type": str(pt.get("dataType") or "1"),
            })
        return points

    def backfill_device_history(self, imei: str, days_back: int = 120) -> Dict[str, Any]:
        """Recover all available historical GPS tracks from the cloud across multi-week chunks and persist them permanently."""
        clean_imei = str(imei or "").strip()
        with self._lock:
            dev_cfg = self._devices.get(clean_imei)
            if not dev_cfg:
                raise KeyError(f"ไม่พบอุปกรณ์ IMEI {clean_imei}")
            if dev_cfg.get("login_type") == "manual":
                self._backfilled_imeis.add(clean_imei)
                return {"imei": clean_imei, "inserted": 0, "total_stored": 0, "live_trail_len": 0}
            password = str(dev_cfg.get("password") or "")
            login_type = str(dev_cfg.get("login_type") or "auto")
            provider_cfg = str(dev_cfg.get("provider") or "auto")
            resolved_proto = str(dev_cfg.get("resolved_protocol") or "")
            resolved_base = str(dev_cfg.get("resolved_base_url") or "")
            cached_uid = int(dev_cfg.get("user_id") or 0)
            cached_did = int(dev_cfg.get("device_id") or 0)
            st_cur = dict(dev_cfg.get("last_state") or {})
            remote_sn = str(st_cur.get("imei") or "").strip()
            existing_trail = list(st_cur.get("live_trail") or [])

        # 1. Seed any existing live_trail points into SQLite first so nothing is lost
        seed_pts: List[Dict[str, Any]] = []
        for t_pt in existing_trail:
            if isinstance(t_pt, dict) and t_pt.get("lat") is not None and t_pt.get("lng") is not None:
                seed_pts.append({
                    "lat": t_pt.get("lat"),
                    "lng": t_pt.get("lng"),
                    "speed_kmh": t_pt.get("speed_kmh", 0.0),
                    "course": t_pt.get("course"),
                    "recorded_at": t_pt.get("time") or st_cur.get("device_time") or "",
                    "data_type": "1",
                })
        if seed_pts:
            self._save_history_points(clean_imei, seed_pts)

        _, target_sn = split_account_and_target_imei(clean_imei)
        q_imei = remote_sn or target_sn

        session = self._sessions.get(clean_imei)
        if not session or (session.get("protocol") not in ("thaigpsdd_v2", "gpspos_uki") and not session.get("device_id")):
            session = self._authenticate_device(
                clean_imei,
                password,
                login_type=login_type,
                provider=provider_cfg,
                known_user_id=cached_uid,
                known_device_id=cached_did,
                resolved_protocol=resolved_proto,
                resolved_base_url=resolved_base,
            )
            self._sessions[clean_imei] = session

        protocol = str(session.get("protocol") or "aspx_gps903")
        now_th = datetime.datetime.now(TZ_TH).replace(tzinfo=None) + datetime.timedelta(hours=12)
        total_inserted = 0
        chunk_days = 7
        num_chunks = max(1, (days_back + chunk_days - 1) // chunk_days)

        def _fetch_with_reauth(s_str: str, e_str: str, lbs: int = 0) -> List[Dict[str, Any]]:
            nonlocal session
            try:
                return self._fetch_cloud_history_window(clean_imei, session, q_imei, s_str, e_str, lbs_flag=lbs)
            except Exception:
                session = self._authenticate_device(
                    clean_imei,
                    password,
                    login_type=login_type,
                    provider=provider_cfg,
                    known_user_id=cached_uid,
                    known_device_id=cached_did,
                    resolved_protocol=resolved_proto,
                    resolved_base_url=resolved_base,
                )
                self._sessions[clean_imei] = session
                return self._fetch_cloud_history_window(clean_imei, session, q_imei, s_str, e_str, lbs_flag=lbs)

        for idx in range(num_chunks):
            c_end = now_th - datetime.timedelta(days=idx * chunk_days)
            c_start = c_end - datetime.timedelta(days=chunk_days)
            s_str = c_start.strftime("%Y-%m-%d %H:%M:%S")
            e_str = c_end.strftime("%Y-%m-%d %H:%M:%S")
            try:
                pts = _fetch_with_reauth(s_str, e_str, lbs=0)
            except Exception as exc:
                logger.debug("Backfill chunk %s..%s failed for %s: %s", s_str, e_str, clean_imei, exc)
                continue

            if pts:
                total_inserted += self._save_history_points(clean_imei, pts)
                # gps903.net caps responses at ~500-620 points per call; subdivide dense 7-day chunks into 1-day windows
                if protocol == "aspx_gps903" and len(pts) >= 490:
                    for d_idx in range(chunk_days):
                        sub_end = c_end - datetime.timedelta(days=d_idx)
                        sub_start = sub_end - datetime.timedelta(days=1)
                        try:
                            sub_pts = _fetch_with_reauth(
                                sub_start.strftime("%Y-%m-%d %H:%M:%S"),
                                sub_end.strftime("%Y-%m-%d %H:%M:%S"),
                                lbs=0,
                            )
                            if sub_pts:
                                total_inserted += self._save_history_points(clean_imei, sub_pts)
                                if len(sub_pts) >= 490:
                                    for h_idx in range(4):
                                        h_end = sub_end - datetime.timedelta(hours=h_idx * 6)
                                        h_start = h_end - datetime.timedelta(hours=6)
                                        try:
                                            h_pts = _fetch_with_reauth(
                                                h_start.strftime("%Y-%m-%d %H:%M:%S"),
                                                h_end.strftime("%Y-%m-%d %H:%M:%S"),
                                                lbs=0,
                                            )
                                            if h_pts:
                                                total_inserted += self._save_history_points(clean_imei, h_pts)
                                        except Exception:
                                            pass
                        except Exception:
                            pass

        stored_all = self._get_stored_history_points(clean_imei, show_lbs=1)
        if not stored_all:
            # If device has 0 satellite fixes in its entire history, fallback to LBS points for recent 14 days
            for idx in range(2):
                c_end = now_th - datetime.timedelta(days=idx * 7)
                c_start = c_end - datetime.timedelta(days=7)
                try:
                    lbs_pts = _fetch_with_reauth(
                        c_start.strftime("%Y-%m-%d %H:%M:%S"),
                        c_end.strftime("%Y-%m-%d %H:%M:%S"),
                        lbs=1,
                    )
                    if lbs_pts:
                        total_inserted += self._save_history_points(clean_imei, lbs_pts)
                except Exception:
                    pass
            stored_all = self._get_stored_history_points(clean_imei, show_lbs=1)

        rebuilt_trail = self._build_unlimited_live_trail(clean_imei)
        with self._lock:
            self._backfilled_imeis.add(clean_imei)
            if clean_imei in self._devices:
                st = dict(self._devices[clean_imei].get("last_state") or {})
                if rebuilt_trail:
                    st["live_trail"] = rebuilt_trail
                    self._devices[clean_imei]["last_state"] = st
                    self._save_to_disk()

        logger.info(
            "Backfilled GPS history for %s: +%d new points (total stored=%d, live_trail=%d)",
            clean_imei,
            total_inserted,
            len(stored_all),
            len(rebuilt_trail),
        )
        return {
            "imei": clean_imei,
            "inserted": total_inserted,
            "total_stored": len(stored_all),
            "live_trail_len": len(rebuilt_trail),
        }

    def fetch_device_history(
        self,
        imei: str,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        show_lbs: int = 1,
        all_history: bool = True,
    ) -> Dict[str, Any]:
        """Fetch unlimited historical GPS trajectory (merging cloud history + local SQLite permanent archive)."""
        clean_imei = str(imei or "").strip()
        with self._lock:
            dev_cfg = self._devices.get(clean_imei)
            if not dev_cfg:
                raise KeyError(f"ไม่พบอุปกรณ์ IMEI {clean_imei}")
            is_manual = (dev_cfg.get("login_type") == "manual")
            password = str(dev_cfg.get("password") or "")
            login_type = str(dev_cfg.get("login_type") or "auto")
            provider_cfg = str(dev_cfg.get("provider") or "auto")
            resolved_proto = str(dev_cfg.get("resolved_protocol") or "")
            resolved_base = str(dev_cfg.get("resolved_base_url") or "")
            dev_name = str(dev_cfg.get("name") or clean_imei)
            cached_uid = int(dev_cfg.get("user_id") or 0)
            cached_did = int(dev_cfg.get("device_id") or 0)
            st_cur = dict(dev_cfg.get("last_state") or {})
            remote_sn = str(st_cur.get("imei") or "").strip()

        if is_manual:
            lat_m = st_cur.get("latitude")
            lng_m = st_cur.get("longitude")
            rec_m = str(st_cur.get("device_time") or "")
            pts_m = []
            if lat_m is not None and lng_m is not None:
                pts_m.append({
                    "lat": float(lat_m),
                    "lng": float(lng_m),
                    "latitude": float(lat_m),
                    "longitude": float(lng_m),
                    "speed": 0.0,
                    "speed_kmh": 0.0,
                    "heading": None,
                    "recorded_at": rec_m,
                    "device_time": rec_m,
                    "is_stop": True,
                    "stop_minutes": 0,
                    "data_type": "1",
                })
            return {
                "imei": clean_imei,
                "name": dev_name,
                "device_id": 0,
                "start": rec_m,
                "end": rec_m,
                "count": len(pts_m),
                "points": pts_m,
            }

        # 1. Check existing permanent archive in SQLite; run full 120-day backfill only if not yet recovered
        existing_all = self._get_stored_history_points(clean_imei, start_time=None, end_time=None, show_lbs=1)
        if len(existing_all) <= 60 and clean_imei not in self._backfilled_imeis:
            try:
                self.backfill_device_history(clean_imei, days_back=120)
                existing_all = self._get_stored_history_points(clean_imei, start_time=None, end_time=None, show_lbs=1)
            except Exception as exc:
                logger.warning("Initial backfill warning for %s: %s", clean_imei, exc)
        else:
            self._backfilled_imeis.add(clean_imei)

        # 2. Fast incremental delta sync from the latest stored timestamp (or last 24h) into SQLite
        _, target_sn = split_account_and_target_imei(clean_imei)
        q_imei = remote_sn or target_sn
        now_th = datetime.datetime.now(TZ_TH).replace(tzinfo=None)
        recent_end = end_time or (now_th + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
        if existing_all and existing_all[-1].get("recorded_at"):
            recent_start = str(existing_all[-1]["recorded_at"])
        else:
            recent_start = (now_th - datetime.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        session = self._sessions.get(clean_imei)
        try:
            if not session or (session.get("protocol") not in ("thaigpsdd_v2", "gpspos_uki") and not session.get("device_id")):
                session = self._authenticate_device(
                    clean_imei,
                    password,
                    login_type=login_type,
                    provider=provider_cfg,
                    known_user_id=cached_uid,
                    known_device_id=cached_did,
                    resolved_protocol=resolved_proto,
                    resolved_base_url=resolved_base,
                )
                self._sessions[clean_imei] = session
            recent_pts = self._fetch_cloud_history_window(clean_imei, session, q_imei, recent_start, recent_end, lbs_flag=0)
            if recent_pts:
                added = self._save_history_points(clean_imei, recent_pts)
                if added > 0:
                    rebuilt_trail = self._build_unlimited_live_trail(clean_imei)
                    with self._lock:
                        if clean_imei in self._devices and rebuilt_trail:
                            st = dict(self._devices[clean_imei].get("last_state") or {})
                            st["live_trail"] = rebuilt_trail
                            self._devices[clean_imei]["last_state"] = st
                            self._save_to_disk()
        except Exception as exc:
            logger.debug("Recent cloud history sync skipped for %s (using stored archive): %s", clean_imei, exc)

        # 3. Query unlimited points from SQLite archive
        if all_history:
            points = self._get_stored_history_points(clean_imei, start_time=None, end_time=None, show_lbs=show_lbs)
        else:
            points = self._get_stored_history_points(clean_imei, start_time=start_time, end_time=end_time, show_lbs=show_lbs)
            if not points:
                # Fallback to all-time history if the requested window has no movement
                points = self._get_stored_history_points(clean_imei, start_time=None, end_time=None, show_lbs=show_lbs)

        actual_start = points[0]["recorded_at"] if points else (start_time or "")
        actual_end = points[-1]["recorded_at"] if points else (end_time or "")

        return {
            "imei": clean_imei,
            "name": dev_name,
            "device_id": int((session or {}).get("device_id") or cached_did or 0),
            "start": actual_start,
            "end": actual_end,
            "count": len(points),
            "points": points,
        }


gpsone_manager = GpsOneManager()
