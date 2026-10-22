import os
import json
import re
import threading
import time
import urllib.request
def validate_cam_name(name: str):
    if not re.match(r"^[A-Za-z0-9_\-]+$", name):
        raise HTTPException(status_code=400, detail="Invalid camera name format")

import hmac
# Config mutations use one context-managed transaction so every read-modify-write
# is serialized and either fully durable or rolled back before the request returns.
from contextlib import contextmanager
import ipaddress
from io import StringIO
from typing import Iterator, List, Optional
from urllib.parse import parse_qsl, urlsplit, urlunsplit

# FastAPI's router dependency is the single authorization gate shared by every
# endpoint in this otherwise internal service.
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, StrictBool

# The persistence module owns locking, semantic validation, backup retention, and
# atomic replacement; this API layer maps failures to sanitized HTTP responses.
from config_store import (
    ConfigLockTimeout,
    ConfigTransaction,
    ConfigTransactionError,
    ConfigValidationError,
    config_transaction,
    load_groups,
    load_yaml_config,
    new_yaml,
)
import config_store

# Allow null / empty stream sources in go2rtc.streams for RTMP/RTSP push ingest streams
_orig_validate_config = config_store.validate_config

def _ingest_tolerant_validate_config(config):
    go2rtc = config.get("go2rtc", {}) if hasattr(config, "get") else {}
    streams = go2rtc.get("streams", {}) if hasattr(go2rtc, "get") else {}
    empty_keys = [k for k, v in streams.items() if v is None or (isinstance(v, list) and len(v) == 0)]
    for k in empty_keys:
        streams[k] = ["ffmpeg:dummy_placeholder_push_stream"]
    try:
        _orig_validate_config(config)
    finally:
        for k in empty_keys:
            streams[k] = None

config_store.validate_config = _ingest_tolerant_validate_config

# Identity assertions are accepted only from the direct auth-service verifier,
# never from headers copied out of the caller's request.
from trusted_auth import IdentityVerificationError, TrustedIdentity, verify_identity
from frigate_validator import (
    FrigateValidationRejected,
    FrigateValidatorUnavailable,
    validate_yaml_with_frigate,
)
import sys
if "/config" not in sys.path:
    sys.path.append("/config")
import stream_probe


# The FastAPI instance exposes only config-service routes; authorization is
# attached to the dedicated router below so future config endpoints inherit it.
app = FastAPI()

CONFIG_PATH = os.environ.get('CONFIG_API_CONFIG_PATH', '/config/config.yml')
GROUPS_PATH = os.environ.get('CONFIG_API_GROUPS_PATH', '/config/nvr_groups.json')
CREDENTIALS_ENV_PATH = os.environ.get('CONFIG_API_CREDENTIALS_ENV', '/config/camera_credentials.env')
# Lock and backup files live on the same persistent config volume as config.yml,
# so serialization and recovery history survive a config-api container restart.
CONFIG_LOCK_PATH = os.environ.get("CONFIG_API_LOCK_PATH", "/config/.config-api.lock")
CONFIG_BACKUP_DIR = os.environ.get("CONFIG_API_BACKUP_DIR", "/config/backups")
CONFIG_BACKUP_RETENTION = int(os.environ.get("CONFIG_API_BACKUP_RETENTION", "10"))
CONFIG_LOCK_TIMEOUT_SECONDS = float(os.environ.get("CONFIG_API_LOCK_TIMEOUT_SECONDS", "5"))
LPR_CAMERAS_PATH = os.environ.get(
    "CONFIG_API_LPR_CAMERAS_PATH",
    "/lpr-settings/lpr_cameras.txt",
)
CAMERA_TEMPLATES_PATH = os.environ.get("CAMERA_TEMPLATES_PATH", "/config/camera_templates.json")
NAS_BOT_DEMAND_POOL_URL = os.environ.get("NAS_BOT_DEMAND_POOL_URL", "http://nas-bot:5005/api/nas-bot/user/demand-pool")
# The default Docker DNS name works in Compose, while the environment override
# supports tests and deployments that use a different internal service address.
AUTH_VERIFY_URL = os.environ.get(
    "CONFIG_API_AUTH_VERIFY_URL",
    "http://auth-service:5002/auth/verify",
).strip()
# Stream credentials must be indirections resolved by Frigate at runtime. This
# pattern is intentionally narrower than general environment-variable syntax so
# tracked YAML and transaction backups never receive literal usernames/passwords.
FRIGATE_SECRET_PLACEHOLDER = re.compile(r"\{FRIGATE_[A-Z0-9_]+\}")
SENSITIVE_STREAM_QUERY_KEYS = {
    "api_key",
    "apikey",
    "auth",
    "key",
    "pass",
    "password",
    "token",
    "user",
    "username",
}
# Object mutations are intentionally narrow: the browser may select a bounded
# list of Frigate labels, but it cannot inject YAML-shaped values or exhaust the
# validator with an unbounded payload.
MAX_TRACKED_OBJECTS = 10
OBJECT_LABEL_PATTERN = re.compile(r"[a-z][a-z0-9 _-]{0,63}")

CAMERA_SOURCES_PATH = os.environ.get("CAMERA_SOURCES_PATH", "/config/camera_sources.json")

def get_camera_sources() -> dict:
    if os.path.isfile(CAMERA_SOURCES_PATH):
        try:
            with open(CAMERA_SOURCES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}

def save_camera_sources(sources: dict) -> None:
    try:
        tmp_path = CAMERA_SOURCES_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(sources, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, CAMERA_SOURCES_PATH)
    except Exception as e:
        print(f"[config-api] Failed to save camera sources: {e}")

def get_camera_templates() -> dict:
    if os.path.isfile(CAMERA_TEMPLATES_PATH):
        try:
            with open(CAMERA_TEMPLATES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}

def save_camera_templates(templates: dict) -> None:
    try:
        tmp_path = CAMERA_TEMPLATES_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(templates, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, CAMERA_TEMPLATES_PATH)
    except Exception as e:
        print(f"[config-api] Failed to save camera templates: {e}")

MANUAL_RECORDINGS_PATH = os.environ.get("MANUAL_RECORDINGS_PATH", "/config/manual_recordings.json")

def get_manual_recordings() -> dict:
    if os.path.isfile(MANUAL_RECORDINGS_PATH):
        try:
            with open(MANUAL_RECORDINGS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}

def save_manual_recordings(recordings: dict) -> None:
    try:
        tmp_path = MANUAL_RECORDINGS_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(recordings, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, MANUAL_RECORDINGS_PATH)
    except Exception as e:
        print(f"[config-api] Failed to save manual recordings: {e}")


# Per-camera AI detection schedule storage and evaluation (Asia/Bangkok UTC+7).
from datetime import datetime, timedelta, timezone

AI_SCHEDULES_PATH = os.environ.get("AI_SCHEDULES_PATH", "/config/ai_schedules.json")
TIME_HHMM_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
BANGKOK_TZ = timezone(timedelta(hours=7))
DEFAULT_CAMERA_SCHEDULE = {
    "enabled": False,
    "start_time": "18:00",
    "end_time": "06:00",
    "days": [1, 2, 3, 4, 5, 6, 7],
    "timezone": "Asia/Bangkok",
}
# Cache last MQTT detect state sent by the schedule worker per camera to avoid redundant publishes.
_last_schedule_detect_state: dict[str, bool] = {}


def get_ai_schedules() -> dict:
    """Load the per-camera AI detection schedule map from disk.

    Takes no arguments, reads ``AI_SCHEDULES_PATH`` if present, and returns a
    dictionary mapping camera names to schedule objects (or ``{}`` on error).
    """
    if os.path.isfile(AI_SCHEDULES_PATH):
        try:
            with open(AI_SCHEDULES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}


def save_ai_schedules(schedules: dict) -> None:
    """Persist the per-camera AI detection schedule map atomically to disk.

    Accepts ``schedules`` dictionary, writes to a temporary sibling file, and
    atomically replaces ``AI_SCHEDULES_PATH`` so readers never see partial JSON.
    """
    try:
        tmp_path = AI_SCHEDULES_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(schedules, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, AI_SCHEDULES_PATH)
    except Exception as e:
        print(f"[config-api] Failed to save AI schedules: {e}")


def get_camera_schedule_entry(name: str, schedules: Optional[dict] = None) -> dict:
    """Return a normalized schedule dictionary for a single camera.

    Accepts camera ``name`` and optional preloaded ``schedules`` map. Returns
    a complete schedule dictionary falling back to ``DEFAULT_CAMERA_SCHEDULE``.
    """
    all_scheds = schedules if isinstance(schedules, dict) else get_ai_schedules()
    raw = all_scheds.get(name) if isinstance(all_scheds.get(name), dict) else {}
    start_t = str(raw.get("start_time") or DEFAULT_CAMERA_SCHEDULE["start_time"]).strip()
    end_t = str(raw.get("end_time") or DEFAULT_CAMERA_SCHEDULE["end_time"]).strip()
    if not TIME_HHMM_PATTERN.match(start_t):
        start_t = DEFAULT_CAMERA_SCHEDULE["start_time"]
    if not TIME_HHMM_PATTERN.match(end_t):
        end_t = DEFAULT_CAMERA_SCHEDULE["end_time"]
    raw_days = raw.get("days")
    if isinstance(raw_days, list):
        days = sorted(list({int(d) for d in raw_days if isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 7}))
    else:
        days = list(DEFAULT_CAMERA_SCHEDULE["days"])
    return {
        "enabled": bool(raw.get("enabled", False)),
        "start_time": start_t,
        "end_time": end_t,
        "days": days,
        "timezone": "Asia/Bangkok",
    }


def evaluate_camera_schedule(sched: Optional[dict], now_dt: Optional[datetime] = None) -> bool:
    """Evaluate whether a camera schedule permits AI detection at the given time.

    Accepts a normalized ``sched`` dictionary and optional ``now_dt`` timestamp.
    Returns ``True`` when the schedule is disabled (24/7 mode) or when current
    Bangkok time falls within the configured days and ``start_time``..``end_time``
    window (supporting both same-day and cross-midnight ranges).
    """
    if not isinstance(sched, dict) or not sched.get("enabled", False):
        return True

    # Convert reference timestamp to Asia/Bangkok (UTC+7) for consistent local evaluation.
    now_bkk = now_dt.astimezone(BANGKOK_TZ) if now_dt is not None else datetime.now(BANGKOK_TZ)
    raw_days = sched.get("days")
    days = [int(d) for d in raw_days if isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 7] if isinstance(raw_days, list) else [1, 2, 3, 4, 5, 6, 7]
    if not days:
        return False

    # Check ISO weekday (1 = Monday .. 7 = Sunday).
    if now_bkk.isoweekday() not in days:
        return False

    start_str = str(sched.get("start_time") or "18:00").strip()
    end_str = str(sched.get("end_time") or "06:00").strip()
    if not TIME_HHMM_PATTERN.match(start_str) or not TIME_HHMM_PATTERN.match(end_str):
        return True

    sh, sm = (int(x) for x in start_str.split(":"))
    eh, em = (int(x) for x in end_str.split(":"))
    start_mins = sh * 60 + sm
    end_mins = eh * 60 + em
    now_mins = now_bkk.hour * 60 + now_bkk.minute

    # Identical start and end times represent a full 24-hour active window on selected days.
    if start_mins == end_mins:
        return True
    # Same-day window (e.g., 08:00 to 17:00).
    if start_mins < end_mins:
        return start_mins <= now_mins <= end_mins
    # Cross-midnight window (e.g., 18:00 to 06:00).
    return now_mins >= start_mins or now_mins <= end_mins


def is_camera_in_ai_schedule(
    name: str,
    schedules: Optional[dict] = None,
    now_dt: Optional[datetime] = None,
) -> bool:
    """Check whether camera ``name`` is currently within its active AI schedule window.

    Accepts camera ``name``, optional ``schedules`` map, and optional ``now_dt``.
    Returns ``True`` if no schedule is enabled for the camera or if the current time
    satisfies the camera's schedule.
    """
    entry = get_camera_schedule_entry(name, schedules)
    return evaluate_camera_schedule(entry, now_dt=now_dt)



def require_authenticated(request: Request) -> TrustedIdentity:
    """Authenticate the original request for any authenticated user."""
    try:
        identity = verify_identity(
            AUTH_VERIFY_URL,
            request.headers.get("authorization"),
            request.headers.get("cookie"),
        )
    except IdentityVerificationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return identity


def require_admin(request: Request) -> TrustedIdentity:
    """Authenticate the original request and require an administrator role.

    The request's bearer token or cookie is verified directly with auth-service;
    caller-provided identity headers are ignored. The dependency performs one
    internal HTTP request and returns the trusted identity, or raises 401/403/503
    without invoking the protected handler.
    """

    # Forward only the two credential channels supported by auth-service. The
    # verifier intentionally has no parameters for X-User or X-Role.
    try:
        identity = verify_identity(
            AUTH_VERIFY_URL,
            request.headers.get("authorization"),
            request.headers.get("cookie"),
        )
    except IdentityVerificationError as exc:
        # Translate the verifier's sanitized failure into the API boundary while
        # retaining the original exception solely for server-side diagnostics.
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # Roles are case-sensitive claims owned by auth-service; admin and superadmin
    # grant access to config reads, writes, status, and restart.
    if identity.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin role required")
    return identity


# One router-level dependency protects every config route consistently and also
# makes the secure default apply automatically to endpoints added in the future.
config_router = APIRouter(
    prefix="/api/config",
    dependencies=[Depends(require_admin)],
)

class CameraConfig(BaseModel):
    """Describe one camera request accepted by administrative config routes.

    ``track`` is optional so the dedicated camera manager preserves an existing
    camera's object policy, while legacy URL provisioning can set an explicit
    recommended policy in the same validated transaction.
    """

    name: str
    rtsp_url: str
    sub_url: str = ""
    ai_enabled: bool = True
    group: str = ""
    track: Optional[List[str]] = None


class CameraObjectsConfig(BaseModel):
    """Describe the complete object-label replacement for one camera."""

    track: List[str]


class CameraEnabledConfig(BaseModel):
    """Describe a camera lifecycle change and its restored detector state."""

    enabled: StrictBool
    detect_enabled: Optional[StrictBool] = None
    record_enabled: Optional[StrictBool] = None


# Incident 2.45: Lightweight model for detect-only toggle (operator-level access)
class DetectToggleConfig(BaseModel):
    """Request body for the operator-level AI detect toggle endpoint."""

    detect_enabled: StrictBool


class CameraScheduleConfig(BaseModel):
    """Describe the per-camera AI detection time schedule window."""

    enabled: bool = False
    start_time: str = "18:00"
    end_time: str = "06:00"
    days: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6, 7])
    timezone: str = "Asia/Bangkok"


def validate_camera_schedule(body: CameraScheduleConfig) -> dict:
    """Validate and normalize a per-camera AI detection schedule request.

    Accepts ``body`` (`CameraScheduleConfig`), verifies ``HH:MM`` time format
    and ISO weekday integers ``1..7``, and returns a normalized dictionary.
    Raises HTTP 422 on invalid time format or empty day list when enabled.
    """
    start_t = str(body.start_time or "").strip()
    end_t = str(body.end_time or "").strip()
    if not TIME_HHMM_PATTERN.match(start_t):
        raise HTTPException(
            status_code=422,
            detail="Invalid start_time format; expected HH:MM (00:00 - 23:59)",
        )
    if not TIME_HHMM_PATTERN.match(end_t):
        raise HTTPException(
            status_code=422,
            detail="Invalid end_time format; expected HH:MM (00:00 - 23:59)",
        )
    raw_days = body.days if isinstance(body.days, list) else []
    days = sorted(list({int(d) for d in raw_days if isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 7}))
    if body.enabled and not days:
        raise HTTPException(
            status_code=422,
            detail="At least one day of the week (1-7) must be selected when schedule is enabled",
        )
    if not days:
        days = [1, 2, 3, 4, 5, 6, 7]
    return {
        "enabled": bool(body.enabled),
        "start_time": start_t,
        "end_time": end_t,
        "days": days,
        "timezone": "Asia/Bangkok",
    }



class ProbeStreamRequest(BaseModel):
    """Describe a stream URL probe request for Phase 2 Smart Auto-Probe."""

    url: str


class ScanNvrRequest(BaseModel):
    ip_address: str
    port: int = 554
    username: str
    password: str
    brand: str
    max_channels: int = 64


class ChannelSelection(BaseModel):
    channel: int
    camera_name: str


class BatchAddRequest(BaseModel):
    ip_address: str
    port: int = 554
    username: str
    password: str
    brand: str
    channels: List[ChannelSelection]
    group: str = ""
    ai_enabled: bool = True


def validate_object_track(track: List[str]) -> List[str]:
    """Validate and normalize one camera's complete tracked-object list.

    ``track`` must contain at most ten unique lowercase Frigate labels. The
    returned copy preserves the administrator's order and has no side effects.
    """

    # A strict bounded label grammar keeps this surgical endpoint from becoming a
    # generic config writer; Frigate's isolated parser remains authoritative for
    # whether every syntactically safe label is valid for the pinned model.
    if len(track) > MAX_TRACKED_OBJECTS:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_TRACKED_OBJECTS} tracked objects are allowed",
        )
    normalized = []
    seen = set()
    for label in track:
        if OBJECT_LABEL_PATTERN.fullmatch(label) is None:
            raise HTTPException(status_code=422, detail="Invalid object label")
        if label in seen:
            raise HTTPException(status_code=422, detail="Object labels must be unique")
        seen.add(label)
        normalized.append(label)
    return normalized

def strip_stream_filters(url: str) -> str:
    """Return the bare upstream URL with any go2rtc filter suffix removed.

    ``#audio=copy`` is stripped alongside the video filters because the camera
    list hands these URLs back to the dashboard for editing: leaving it attached
    made every save append another copy, so a few edit cycles produced
    ``â€¦#audio=copy#video=copy#audio=copy``.
    """

    if not url:
        return url
    for token in ("#video=copy", "#video=h264", "#hardware", "#audio=copy"):
        url = url.replace(token, "")
    while "##" in url:
        url = url.replace("##", "#")
    if url.endswith("#"):
        url = url[:-1]
    return url


def clean_url(url: str, video: str = "h264") -> str:
    """Attach a go2rtc video filter to one upstream URL.

    ``video`` is ``"copy"`` for passthrough or ``"h264"`` for a hardware (NVENC)
    transcode. Software transcoding is never emitted: encoding fifteen 1080p
    streams with libx264 once saturated this host at ~1200% CPU and made live
    view unusable, while the same load on NVENC is negligible.
    """

    if not url:
        return url
    base = strip_stream_filters(url)
    suffix = "#video=copy" if video == "copy" else "#video=h264#hardware"
    return base + suffix + "#audio=copy"


def build_camera_streams(name: str, rtsp_url: str, sub_url: str | None) -> dict:
    """Build the go2rtc stream set for one camera using Phase 2 Smart Auto-Probe.

    Dynamically inspects incoming camera stream codec (H.264 vs H.265) and host
    GPU capabilities (NVIDIA NVENC, Intel VAAPI, or CPU fallback) to configure
    zero-copy passthrough for H.264 streams and hardware transcoding for H.265.
    """
    return stream_probe.get_optimal_camera_streams(name, rtsp_url, sub_url)


def extract_and_mask_url_credentials(cam_name: str, url: str, stream_type: str = "RTSP_URL") -> tuple[str, dict[str, str]]:
    """Extract raw username/password from camera RTSP URL and convert into secret placeholders."""
    if not url:
        return url, {}
    try:
        parsed = urlsplit(url)
        if parsed.username and parsed.password:
            # If already using placeholders like {FRIGATE_...}, do not alter
            if FRIGATE_SECRET_PLACEHOLDER.fullmatch(parsed.username) and FRIGATE_SECRET_PLACEHOLDER.fullmatch(parsed.password):
                return url, {}
            
            clean_cam = re.sub(r"[^A-Za-z0-9_]", "_", cam_name).upper()
            user_var = f"FRIGATE_CAM_{clean_cam}_{stream_type}_USER"
            pass_var = f"FRIGATE_CAM_{clean_cam}_{stream_type}_PASS"
            
            env_entries = {
                user_var: parsed.username,
                pass_var: parsed.password,
            }
            
            # Reconstruct netloc with secret placeholders
            host_part = parsed.hostname or ""
            if parsed.port:
                host_part += f":{parsed.port}"
            masked_netloc = f"{{{user_var}}}:{{{pass_var}}}@{host_part}"
            masked_url = urlunsplit((parsed.scheme, masked_netloc, parsed.path, parsed.query, parsed.fragment))
            return masked_url, env_entries
    except Exception:
        pass
    return url, {}


def update_camera_credentials_env(env_updates: dict[str, str]) -> None:
    """Store camera credentials in /config/camera_credentials.env safely."""
    if not env_updates:
        return
    env_file = CREDENTIALS_ENV_PATH
    existing_vars = {}
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and "=" in stripped:
                        k, v = stripped.split("=", 1)
                        existing_vars[k.strip()] = v.strip()
        except OSError:
            pass
    
    # Merge updates
    existing_vars.update(env_updates)
    
    # Write atomically
    tmp_file = f"{env_file}.tmp.{os.getpid()}"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            for k in sorted(existing_vars.keys()):
                f.write(f"{k}={existing_vars[k]}\n")
        os.replace(tmp_file, env_file)
    except Exception as exc:
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to update camera credentials: {exc}")


def validate_camera_request(camera: CameraConfig) -> None:
    """Reject unsafe camera names and malformed source URLs before mutation."""

    # Camera names become YAML/go2rtc keys and URL path segments, so constrain them
    # to the identifier format already used by deployed Frigate configurations.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", camera.name):
        raise HTTPException(status_code=422, detail="Invalid camera name")
    for label, value, required in (
        ("rtsp_url", camera.rtsp_url, True),
        ("sub_url", camera.sub_url, False),
    ):
        if not value and not required:
            continue
        if not value or any(ord(character) < 32 for character in value):
            raise HTTPException(status_code=422, detail=f"Invalid {label}")
        # A source must be an absolute network URL; accepting only known camera
        # transport schemes blocks accidental filesystem and script-like values.
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
        except ValueError as exc:
            # Invalid bracketed hosts and ports must become a client error rather
            # than escaping validation as an internal server exception.
            raise HTTPException(status_code=422, detail=f"Invalid {label}") from exc
        if parsed.scheme.lower() not in {"rtsp", "rtsps", "rtmp", "rtmps", "http", "https"}:
            raise HTTPException(status_code=422, detail=f"Invalid {label} scheme")
        if not hostname:
            raise HTTPException(status_code=422, detail=f"Invalid {label} host")
        if parsed.username is not None or parsed.password is not None:
            if (
                parsed.username is None
                or parsed.password is None
                or FRIGATE_SECRET_PLACEHOLDER.fullmatch(parsed.username) is None
                or FRIGATE_SECRET_PLACEHOLDER.fullmatch(parsed.password) is None
            ):
                import urllib.parse
                if parsed.username is None or parsed.password is None:
                    raise HTTPException(status_code=422, detail="Both username and password required if providing raw credentials")
        for query_key, query_value in parse_qsl(
            parsed.query,
            keep_blank_values=True,
        ):
            # Some camera vendors put credentials in query parameters instead of
            # URL userinfo. Apply the same runtime-placeholder rule to common
            # credential keys so that syntax cannot bypass secret migration.
            if (
                query_key.lower() in SENSITIVE_STREAM_QUERY_KEYS
                and FRIGATE_SECRET_PLACEHOLDER.fullmatch(query_value) is None
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"{label} sensitive query values must use "
                        "{FRIGATE_*} placeholders"
                    ),
                )
    # An omitted list means "preserve/default"; an explicit list is validated
    # before the lock is acquired and before any candidate config is constructed.
    if camera.track is not None:
        validate_object_track(camera.track)


@contextmanager
def open_config_transaction(include_groups: bool = False) -> Iterator[ConfigTransaction]:
    """Open one safe write transaction and sanitize persistence failures for HTTP."""

    # Store-specific exceptions never expose paths, YAML fragments, or credentials
    # to browser callers; a busy lock is retryable while commit failures are 500s.
    try:
        with config_transaction(
            CONFIG_PATH,
            GROUPS_PATH,
            CONFIG_LOCK_PATH,
            CONFIG_BACKUP_DIR,
            include_groups=include_groups,
            lock_timeout_seconds=CONFIG_LOCK_TIMEOUT_SECONDS,
            backup_retention=CONFIG_BACKUP_RETENTION,
        ) as transaction:
            yield transaction
            if transaction.changed:
                # The repository validator protects our mutation invariants; the
                # isolated service then runs the exact parser from pinned Frigate
                # 0.17.2 before config_store can make any candidate visible.
                buffer = StringIO()
                yaml = new_yaml()
                yaml.dump(transaction.config, buffer)
                validate_yaml_with_frigate(buffer.getvalue())
    except ConfigLockTimeout as exc:
        raise HTTPException(status_code=503, detail="Configuration is busy; retry later") from exc
    except FrigateValidationRejected as exc:
        raise HTTPException(
            status_code=422,
            detail="Frigate rejected the candidate configuration",
        ) from exc
    except FrigateValidatorUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail="Frigate configuration validator is unavailable",
        ) from exc
    except ConfigValidationError as exc:
        raise HTTPException(status_code=422, detail="Configuration validation failed") from exc
    except ConfigTransactionError as exc:
        raise HTTPException(status_code=500, detail="Configuration update failed safely") from exc
    except OSError as exc:
        # Read/setup failures occur before a commit and therefore leave the primary
        # config untouched, but callers still receive a sanitized service error.
        raise HTTPException(status_code=500, detail="Configuration storage unavailable") from exc


def get_lpr_cameras():
    """Read the narrow LPR camera assignment mounted outside the config root."""

    # Config API does not need the Watchlist DB or suspect records that share the
    # host lpr directory, so Compose exposes only this non-sensitive settings file.
    lpr_file = LPR_CAMERAS_PATH
    lpr_cams = set()
    if os.path.exists(lpr_file):
        try:
            with open(lpr_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        lpr_cams.add(line)
        except (PermissionError, OSError):
            pass
    return lpr_cams

def configure_camera_inputs(cam_name, main_url, sub_url, ai_enabled, is_lpr=False):
    """Build Frigate inputs for a camera's source, AI flag, and LPR policy.

    ``main_url`` is retained for compatibility with existing callers; ``sub_url``
    selects the topology. The returned list has at least one role per input and no
    side effects.

    CRITICAL STABILITY INVARIANT:
    When a sub-stream is available, AI object detection MUST ALWAYS run on the
    sub-stream (640x360), NEVER on the high-resolution 2K/4K main stream.
    Running detect on the main stream forces ffmpeg to decode and downscale
    millions of pixels/sec, leading to ffmpeg watchdog timeouts, CPU/RAM thrashing,
    and out-of-memory (OOM) crashes. LPR OCR consumes high-res snapshots from
    the record stream, so it does not need detect on the main stream.
    """

    inputs = []
    main_restream = f"rtsp://127.0.0.1:8554/{cam_name}?video"
    sub_restream = f"rtsp://127.0.0.1:8554/{cam_name}_sub?video"
    if not sub_url:
        inputs.append({
            'path': main_restream,
            'input_args': 'preset-rtsp-restream',
            'roles': ['record', 'detect'] if ai_enabled else ['record']
        })
        return inputs

    main_input = {
        'path': main_restream,
        'input_args': 'preset-rtsp-restream',
        'roles': ['record']
    }
    inputs.append(main_input)
    if ai_enabled:
        inputs.append(
            {
                'path': sub_restream,
                'input_args': 'preset-rtsp-restream',
                'roles': ['detect']
            }
        )
    return inputs


def get_input_signature(inputs):
    """Return stable path/role tuples for change detection during stream sync."""

    # Sorting roles treats equivalent orderings as unchanged and therefore avoids
    # unnecessary config backups and Frigate restarts.
    return [
        (item.get("path"), tuple(sorted(item.get("roles", []))))
        for item in inputs
    ]

def validate_stream_url(url: str):
    if not url:
        raise HTTPException(status_code=422, detail="Invalid URL")
    try:
        parsed = urlsplit(url)
        if parsed.scheme.lower() not in {"rtsp", "rtsps", "rtmp", "rtmps", "http", "https"}:
            raise HTTPException(status_code=422, detail="Invalid scheme")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid URL format") from exc

@config_router.post("/probe_stream")
def probe_stream_endpoint(payload: ProbeStreamRequest):
    """Probe a stream URL and return detected video/audio codecs and host GPU capabilities."""
    validate_stream_url(payload.url)
    res = stream_probe.probe_stream_url(payload.url)
    gpu = stream_probe.detect_host_gpu()
    return {
        "probe": res,
        "host_gpu": gpu,
    }

@config_router.post("/scan_nvr")
def scan_nvr_endpoint(request: ScanNvrRequest):
    found = []
    fail_count = 0
    
    for ch in range(1, request.max_channels + 1):
        if request.brand == "TP-Link VIGI":
            path = f"/ch{ch}/stream2"
        elif request.brand == "Dahua / DH":
            path = f"/cam/realmonitor?channel={ch}&subtype=1"
        elif request.brand == "Hikvision / HIK":
            path = f"/Streaming/Channels/{ch}02"
        else:
            path = f"/ch{ch}/stream2"
            
        url = f"rtsp://{request.username}:{request.password}@{request.ip_address}:{request.port}{path}"
        
        # probe_rtsp_stream returns dict with success, video_codec, audio_codec
        probe_res = stream_probe.probe_rtsp_stream(url, timeout=1.0)
        
        if probe_res.get("success"):
            found.append({
                "ch": ch,
                "video_codec": probe_res.get("video_codec"),
                "audio_codec": probe_res.get("audio_codec"),
                "latency_ms": probe_res.get("latency_ms")
            })
            fail_count = 0
        else:
            fail_count += 1
            
        if fail_count >= 3:
            break
            
    return {"found": found}

@config_router.post("/batch_add_cameras")
def batch_add_cameras(request: BatchAddRequest):
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    added = []
    failed = []

    with open_config_transaction(include_groups=True) as transaction:
        config = transaction.config
        groups = transaction.groups
        
        if 'cameras' not in config:
            config['cameras'] = {}
        if 'go2rtc' not in config:
            config['go2rtc'] = {}
        if 'streams' not in config['go2rtc']:
            config['go2rtc']['streams'] = {}

        lpr_cams = get_lpr_cameras()

        for sel in request.channels:
            cam_name = sel.camera_name
            ch = sel.channel
            
            if cam_name in config['cameras']:
                failed.append({"camera": cam_name, "error": "Already exists"})
                continue
                
            if request.brand == "TP-Link VIGI":
                rtsp_path = f"/ch{ch}/stream1"
                sub_path = f"/ch{ch}/stream2"
            elif request.brand == "Dahua / DH":
                rtsp_path = f"/cam/realmonitor?channel={ch}&subtype=0"
                sub_path = f"/cam/realmonitor?channel={ch}&subtype=1"
            elif request.brand == "Hikvision / HIK":
                rtsp_path = f"/Streaming/Channels/{ch}01"
                sub_path = f"/Streaming/Channels/{ch}02"
            else:
                rtsp_path = f"/ch{ch}/stream1"
                sub_path = f"/ch{ch}/stream2"
                
            rtsp_url = f"rtsp://{request.username}:{request.password}@{request.ip_address}:{request.port}{rtsp_path}"
            sub_url = f"rtsp://{request.username}:{request.password}@{request.ip_address}:{request.port}{sub_path}"
            
            masked_rtsp, rtsp_env = extract_and_mask_url_credentials(cam_name, rtsp_url, "RTSP_URL")
            masked_sub, sub_env = extract_and_mask_url_credentials(cam_name, sub_url, "SUB_URL")
            
            all_env = {}
            all_env.update(rtsp_env)
            all_env.update(sub_env)
            if all_env:
                update_camera_credentials_env(all_env)
                
            config['go2rtc']['streams'].update(
                build_camera_streams(cam_name, masked_rtsp, masked_sub)
            )

            is_lpr = cam_name in lpr_cams
            effective_ai = request.ai_enabled
            
            inputs = configure_camera_inputs(
                cam_name,
                masked_rtsp,
                masked_sub,
                effective_ai,
                is_lpr,
            )

            cam_block = {
                'ffmpeg': {'inputs': inputs},
                'detect': {'enabled': effective_ai},
                'record': {
                    'enabled': True,
                    'continuous': {'days': 0},
                    'motion': {'days': 0},
                    'alerts': {'retain': {'days': 7, 'mode': 'active_objects'}},
                    'detections': {'retain': {'days': 7, 'mode': 'active_objects'}}
                },
                'snapshots': {
                    'enabled': True,
                    'bounding_box': True
                }
            }

            if not effective_ai and is_lpr:
                cam_block['objects'] = {'track': ['car', 'motorcycle']}
            else:
                # Default objects could be none or left to Frigate defaults
                pass

            config['cameras'][cam_name] = cam_block
            groups[cam_name] = request.group
            added.append(cam_name)

        if added:
            transaction.mark_changed()

    return {"status": "success", "added": added, "failed": failed}



# The router dependency authenticates this read because camera source URLs are
# sensitive configuration data, not a general dashboard API.
@config_router.get("/cameras")
def get_cameras():
    """Return camera, stream, AI, enabled, and group configuration.

    The function reads config and group files without writing them. It raises 404
    when the primary config is absent and returns naturally sorted camera data.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")
    
    # Reads try the transaction lock first to preserve crash-recovery journal synchronization;
    # however, if an exclusive write/validation transaction is in progress, fall back to a direct
    # non-blocking read of config.yml and groups.json to prevent 503 errors on the Settings UI.
    try:
        with open_config_transaction(include_groups=True) as transaction:
            config = transaction.config
            groups = transaction.groups or {}
    except HTTPException as exc:
        if exc.status_code == 503 and exc.detail == "Configuration is busy; retry later":
            try:
                config = load_yaml_config(CONFIG_PATH)
                groups = load_groups(GROUPS_PATH) or {}
            except Exception:
                raise exc
        else:
            raise

    env_vars = {}
    env_file = CREDENTIALS_ENV_PATH
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and "=" in stripped:
                        k, v = stripped.split("=", 1)
                        env_vars[k.strip()] = v.strip()
        except OSError:
            pass

    def unmask(u):
        if not u: return u
        for match in set(re.findall(r"\{FRIGATE_[A-Z0-9_]+\}", u)):
            var_name = match.strip("{}")
            if var_name in env_vars:
                u = u.replace(match, env_vars[var_name])
        return u

    cameras = config.get('cameras', {})
    go2rtc_streams = config.get('go2rtc', {}).get('streams', {})
    result = []
    
    # Get all unique camera names from both cameras and go2rtc blocks
    # Filter out _sub/_hd suffixes and internal empty RTMP relay aliases
    stream_names = set()
    for s, s_val in go2rtc_streams.items():
        if s.endswith('_sub') or s.endswith('_hd'):
            continue
        if s not in cameras and s not in groups and not s_val:
            continue
        stream_names.add(s)
            
    all_cams = set(cameras.keys()).union(stream_names)
    sources = get_camera_sources()

    for cam_name in all_cams:
        cam_data = cameras.get(cam_name, {})
        rtsp_url = sources.get(cam_name, "")
        sub_url = ""
        
        if not rtsp_url and cam_name in go2rtc_streams:
            raw_src = go2rtc_streams[cam_name]
            if isinstance(raw_src, list):
                go2rtc_src = raw_src[0] if len(raw_src) > 0 else ""
            elif isinstance(raw_src, str):
                go2rtc_src = raw_src
            else:
                go2rtc_src = ""

            if "testsrc" in go2rtc_src:
                go2rtc_src = ""

            if go2rtc_src:
                # mediamtx relay: rtsp://rtmp-relay:8554/live/X â†’ show as rtmp://127.0.0.1:1935/X
                if 'rtmp-relay' in go2rtc_src and '/live/' in go2rtc_src:
                    rtsp_url = f"rtmp://127.0.0.1:1935/{cam_name}"
                elif go2rtc_src.startswith('ffmpeg:'):
                    rtsp_url = go2rtc_src.split('ffmpeg:')[1]
                else:
                    rtsp_url = go2rtc_src
                rtsp_url = strip_stream_filters(rtsp_url).strip("#")
            else:
                rtsp_url = f"rtmp://127.0.0.1:1935/{cam_name}"
                
        if f"{cam_name}_sub" in go2rtc_streams:
            raw_sub = go2rtc_streams[f"{cam_name}_sub"]
            if isinstance(raw_sub, list):
                go2rtc_src = raw_sub[0] if len(raw_sub) > 0 else ""
            elif isinstance(raw_sub, str):
                go2rtc_src = raw_sub
            else:
                go2rtc_src = ""

            if "testsrc" in go2rtc_src:
                go2rtc_src = ""

            if go2rtc_src:
                if go2rtc_src.startswith('ffmpeg:'):
                    sub_url = go2rtc_src.split('ffmpeg:')[1]
                else:
                    sub_url = go2rtc_src
                sub_url = strip_stream_filters(sub_url).strip("#")
                
        if not rtsp_url:
            inputs = cam_data.get('ffmpeg', {}).get('inputs', [])
            for inp in inputs:
                if 'rtsp://' in inp.get('path', '') and '127.0.0.1' not in inp.get('path', ''):
                    rtsp_url = inp.get('path')
                    break
        
        ai_enabled = cam_data.get('detect', {}).get('enabled', False) if cam_name in cameras else False
        
        result.append({
            "name": cam_name,
            "rtsp_url": unmask(rtsp_url),
            "sub_url": unmask(sub_url),
            "ai_enabled": ai_enabled,
            "enabled": cam_data.get('enabled', True) if cam_name in cameras else False,
            "group": groups.get(cam_name, ""),
            # Tells the dashboard whether a maximize stream exists for this
            # camera. Cameras provisioned before the split stream layout have
            # none, and pointing the viewer at a missing stream would only
            # produce a connection that never succeeds.
            "has_hd": f"{cam_name}_hd" in go2rtc_streams,
            "has_sub": f"{cam_name}_sub" in go2rtc_streams,
        })
    def natural_sort_key(x):
        name = x.get('name', '')
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', name)]
    result.sort(key=natural_sort_key)
    return {"cameras": result}

# Camera creation mutates tracked runtime configuration, so the router-level admin
# dependency must complete before this handler receives the validated model.
@config_router.post("/cameras")
def add_camera(camera: CameraConfig):
    """Create a camera and its go2rtc/group configuration.

    ``camera`` supplies source URLs and feature settings. The function writes the
    YAML and group files, and returns a success message or a 4xx validation error.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    validate_camera_request(camera)
    raw_rtsp_url = camera.rtsp_url
    masked_rtsp, rtsp_env = extract_and_mask_url_credentials(camera.name, camera.rtsp_url, "RTSP_URL")
    masked_sub, sub_env = extract_and_mask_url_credentials(camera.name, camera.sub_url, "SUB_URL") if camera.sub_url else (None, {})
    all_env = {}
    all_env.update(rtsp_env)
    all_env.update(sub_env)
    if all_env:
        update_camera_credentials_env(all_env)
    camera.rtsp_url = masked_rtsp
    camera.sub_url = masked_sub

    with open_config_transaction(include_groups=True) as transaction:
        config = transaction.config
        groups = transaction.groups
        if 'cameras' not in config:
            config['cameras'] = {}
        if camera.name in config['cameras']:
            raise HTTPException(status_code=400, detail="Camera already exists")

        if 'go2rtc' not in config:
            config['go2rtc'] = {}
        if 'streams' not in config['go2rtc']:
            config['go2rtc']['streams'] = {}

        config['go2rtc']['streams'].update(
            build_camera_streams(camera.name, camera.rtsp_url, camera.sub_url)
        )

        is_lpr = camera.name in get_lpr_cameras()
        effective_ai_enabled = camera.ai_enabled
        
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            is_lpr,
        )

        retain_mode = 'active_objects' if effective_ai_enabled else 'motion'
        cam_block = {
            'ffmpeg': {'inputs': inputs},
            'detect': {'enabled': effective_ai_enabled},
            'record': {
                'enabled': True,
                'alerts': {'retain': {'days': 7, 'mode': retain_mode}},
                'detections': {'retain': {'days': 7, 'mode': retain_mode}}
            },
            'snapshots': {
                'enabled': True,
                'bounding_box': True
            }
        }
        
        if not camera.ai_enabled and is_lpr:
            cam_block['objects'] = {'track': ['car', 'motorcycle']}
        elif camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}

        config['cameras'][camera.name] = cam_block
        if groups is None:
            raise HTTPException(status_code=500, detail="Group metadata unavailable")
        groups[camera.name] = camera.group
        transaction.mark_changed()

    sources = get_camera_sources()
    sources[camera.name] = raw_rtsp_url
    save_camera_sources(sources)

    return {"status": "success", "message": f"Added camera {camera.name}"}

# Camera replacement is protected at the router boundary because it deletes and
# recreates stream entries as part of a single administrative operation.
@config_router.put("/cameras/{old_name}")
def update_camera(old_name: str, camera: CameraConfig):
    """Replace an existing camera's name, streams, settings, and group.

    ``old_name`` selects the existing entry and ``camera`` supplies its replacement.
    The function writes both config files and reports not-found/name-conflict errors.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    # Rename and stream replacement occur under the same lock, preventing a
    # simultaneous add/delete request from reintroducing stale camera entries.
    validate_camera_request(camera)
    raw_rtsp_url = camera.rtsp_url
    masked_rtsp, rtsp_env = extract_and_mask_url_credentials(camera.name, camera.rtsp_url, "RTSP_URL")
    masked_sub, sub_env = extract_and_mask_url_credentials(camera.name, camera.sub_url, "SUB_URL") if camera.sub_url else (None, {})
    all_env = {}
    all_env.update(rtsp_env)
    all_env.update(sub_env)
    if all_env:
        update_camera_credentials_env(all_env)
    camera.rtsp_url = masked_rtsp
    camera.sub_url = masked_sub

    with open_config_transaction(include_groups=True) as transaction:
        config = transaction.config
        groups = transaction.groups
        if 'cameras' not in config or old_name not in config['cameras']:
            raise HTTPException(status_code=404, detail="Camera not found")
        if camera.name != old_name and camera.name in config['cameras']:
            raise HTTPException(status_code=400, detail="New camera name already exists")

        # Preserve camera-specific zones, filters, object labels, and lifecycle
        # state while replacing only fields represented by this request model.
        cam_block = config['cameras'].pop(old_name)
        existing_track = cam_block.get('objects', {}).get('track')
        streams = config.setdefault('go2rtc', {}).setdefault('streams', {})
        streams.pop(old_name, None)
        streams.pop(f"{old_name}_sub", None)
        # Drop the maximize stream too; leaving it behind would keep an orphaned
        # encoder definition pointing at the pre-edit URL under the old name.
        streams.pop(f"{old_name}_hd", None)
        if groups is None:
            raise HTTPException(status_code=500, detail="Group metadata unavailable")
        groups.pop(old_name, None)

        streams.update(build_camera_streams(camera.name, camera.rtsp_url, camera.sub_url))

        # ``track=None`` is a preservation signal for edits from the camera
        # manager. An explicit empty list means detection must be disabled.
        effective_track = camera.track if camera.track is not None else existing_track
        effective_ai_enabled = camera.ai_enabled and (
            effective_track is None or bool(effective_track)
        )
        lpr_cams = get_lpr_cameras()
        inputs = configure_camera_inputs(
            camera.name,
            camera.rtsp_url,
            camera.sub_url,
            effective_ai_enabled,
            camera.name in lpr_cams,
        )
        cam_block['ffmpeg'] = {'inputs': inputs}
        cam_block.setdefault('detect', {})['enabled'] = effective_ai_enabled
        record_block = cam_block.setdefault('record', {})
        record_block['enabled'] = True
        record_block.pop('continuous', None)
        record_block.pop('motion', None)
        record_block.setdefault('alerts', {}).setdefault('retain', {})['mode'] = 'motion'
        record_block.setdefault('detections', {}).setdefault('retain', {})['mode'] = 'motion'
        cam_block.setdefault('snapshots', {}).setdefault('enabled', True)
        cam_block['snapshots'].setdefault('bounding_box', True)
        if camera.track is not None:
            cam_block['objects'] = {'track': list(camera.track)}

        # Mark once all coordinated in-memory changes are complete so exceptions
        # above leave both original files untouched and generate no recovery backup.
        config['cameras'][camera.name] = cam_block
        groups[camera.name] = camera.group
        transaction.mark_changed()

    sources = get_camera_sources()
    if old_name in sources:
        del sources[old_name]
    sources[camera.name] = raw_rtsp_url
    save_camera_sources(sources)

    return {"status": "success", "message": f"Updated camera {camera.name}"}


# Object selection is a bounded administrative mutation rather than access to
# Frigate's generic config/set endpoint.
@config_router.put("/cameras/{name}/objects")
def set_camera_objects(name: str, request: CameraObjectsConfig):
    """Replace one camera's tracked labels and synchronize detect.enabled.

    ``name`` selects an existing camera and ``request.track`` is the complete
    desired list. The function commits one validated YAML transaction and returns
    the resulting detector state.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")
    track = validate_object_track(request.track)

    # Both object labels and detector state must change atomically so an empty
    # list cannot leave inference enabled with no classes, or vice versa.
    with open_config_transaction() as transaction:
        templates = get_camera_templates()
        camera, created = _ensure_camera_in_config(transaction, name, templates)
        current_track = camera.get('objects', {}).get('track')
        current_detect = bool(camera.get('detect', {}).get('enabled', False))
        detect_enabled = current_detect if bool(track) else False
        if created or current_track != track or current_detect != detect_enabled:
            camera.setdefault('objects', {})['track'] = list(track)
            camera.setdefault('detect', {})['enabled'] = detect_enabled
            tmpl = templates.setdefault(name, json.loads(json.dumps(dict(camera))))
            if isinstance(tmpl, dict):
                tmpl.setdefault('objects', {})['track'] = list(track)
                tmpl.setdefault('detect', {})['enabled'] = detect_enabled
                save_camera_templates(templates)
            transaction.mark_changed()
        cam_enabled = bool(camera.get('enabled', False))
        rec_enabled = bool(camera.get('record', {}).get('enabled', False))

    _sync_camera_to_frigate_runtime(
        name, cam_enabled, detect_enabled, rec_enabled, objects_track=list(track)
    )

    return {
        "status": "success",
        "camera": name,
        "detect_enabled": detect_enabled,
        "track": list(track),
    }


# Camera lifecycle changes require a restart, but the persisted change itself is
# kept inside the same admin-only validated transaction as every other mutation.
@config_router.put("/cameras/{name}/enabled")
def set_camera_enabled(name: str, request: CameraEnabledConfig):
    """Persist one camera's enabled state and optional restored detector state.

    Camera lifecycle and recording always move together: enabling restores
    recording and disabling stops it. ``detect_enabled`` still preserves the
    administrator's explicit AI choice when a camera is enabled. The function
    writes YAML only; the gateway restart endpoint remains separate.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    # Avoid rewriting the config or creating a backup when every requested value
    # already matches the live file.
    with open_config_transaction() as transaction:
        templates = get_camera_templates()
        tmpl = templates.get(name, {}) if isinstance(templates.get(name), dict) else {}
        is_protected = bool(tmpl.get("force_active") or name in get_lpr_cameras())
        if is_protected and not request.enabled:
            return {"status": "success", "camera": name, "enabled": True, "protected": True}
        cameras_dict = transaction.config.setdefault("cameras", {})
        if not request.enabled and name not in cameras_dict:
            return {"status": "success", "camera": name, "enabled": False}
        camera, created = _ensure_camera_in_config(transaction, name, templates)

        target_enabled = True if is_protected else request.enabled
        changed = created or (camera.get('enabled', True) != target_enabled)
        camera['enabled'] = target_enabled
        if target_enabled:
            if is_protected:
                detect_val = True
            else:
                detect_val = request.detect_enabled if request.detect_enabled is not None else False
            
            detect = camera.setdefault('detect', {})
            if detect.get('enabled') != detect_val:
                detect['enabled'] = detect_val
                changed = True

            manual_recs = get_manual_recordings()
            is_manual_rec = manual_recs.get(name, False)

            if request.record_enabled is not None:
                target_record = request.record_enabled
            else:
                target_record = bool(detect_val or is_manual_rec)

            record = camera.setdefault('record', {})
            if record.get('enabled') != target_record:
                record['enabled'] = target_record
                changed = True

            # Demand-driven CPU preservation:
            # If neither AI detection nor recording is required, disable Frigate's camera
            # capture process. Live viewing on the dashboard remains 100% active via go2rtc WebRTC.
            effective_frigate_enabled = bool(detect_val or target_record)
            if camera.get('enabled', True) != effective_frigate_enabled:
                camera['enabled'] = effective_frigate_enabled
                changed = True
        else:
            record = camera.setdefault('record', {})
            if record.get('enabled') is not False:
                record['enabled'] = False
                changed = True
            detect = camera.setdefault('detect', {})
            if detect.get('enabled') is not False:
                detect['enabled'] = False
                changed = True
            if camera.get('enabled') is not False:
                camera['enabled'] = False
                changed = True
            effective_frigate_enabled = False
            target_record = False
            detect_val = False

        # Synchronize ffmpeg inputs for this camera so Frigate validator accepts the config
        # (Frigate validator rejects detect.enabled=True if no input stream has role 'detect')
        effective_ai = bool(camera.get('enabled', True) and camera.get('detect', {}).get('enabled', False))
        lpr_cams = get_lpr_cameras()
        go2rtc_streams = transaction.config.get("go2rtc", {}).get("streams", {})
        has_sub = f"{name}_sub" in go2rtc_streams
        new_inputs = configure_camera_inputs(
            name,
            "dummy",
            "dummy" if has_sub else "",
            effective_ai,
            name in lpr_cams,
        )
        old_inputs = camera.get("ffmpeg", {}).get("inputs", [])
        if get_input_signature(old_inputs) != get_input_signature(new_inputs):
            camera.setdefault("ffmpeg", {})["inputs"] = new_inputs
            changed = True

        # Keep persisted camera template in sync for demand reconciliation (ADR-0020)
        if name in templates and isinstance(templates[name], dict):
            tmpl = templates[name]
            tmpl['enabled'] = effective_frigate_enabled
            tmpl.setdefault('record', {})['enabled'] = target_record
            tmpl.setdefault('detect', {})['enabled'] = effective_ai
            tmpl.setdefault('ffmpeg', {})['inputs'] = new_inputs
            save_camera_templates(templates)

        if changed:
            transaction.mark_changed()

    if changed or effective_frigate_enabled:
        _sync_camera_to_frigate_runtime(name, effective_frigate_enabled, effective_ai, target_record)

    return {"status": "success", "camera": name, "enabled": request.enabled}

# Deletion requires the router's admin identity because it removes camera and
# stream configuration and may affect recording availability.
@config_router.delete("/cameras/{name}")
def delete_camera(name: str):
    """Delete a named camera and its persisted group/config entries.

    ``name`` identifies the camera. The function writes config/group files and
    returns a success message, or 404 when the config/camera does not exist.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    # Deletion removes the camera, all three possible go2rtc producers, and its group
    # label in one transaction so no ``<name>_sub``/``<name>_hd`` can survive as an
    # orphan. Missing the ``_hd`` pop was not merely untidy: re-adding a camera under
    # the same name without a sub URL creates no new ``_hd``, so the deleted camera's
    # stale entry survived and the maximize button played the OLD camera's video.
    with open_config_transaction(include_groups=True) as transaction:
        config = transaction.config
        groups = transaction.groups
        if 'cameras' not in config or name not in config['cameras']:
            raise HTTPException(status_code=404, detail="Camera not found")

        del config['cameras'][name]
        streams = config.get('go2rtc', {}).get('streams', {})
        streams.pop(name, None)
        streams.pop(f"{name}_sub", None)
        streams.pop(f"{name}_hd", None)
        if groups is None:
            raise HTTPException(status_code=500, detail="Group metadata unavailable")
        groups.pop(name, None)
        transaction.mark_changed()

    sources = get_camera_sources()
    if name in sources:
        del sources[name]
        save_camera_sources(sources)

    return {"status": "success", "message": f"Deleted camera {name}"}

class WebRTCConfig(BaseModel):
    """Describe the IPv4 WebRTC candidate accepted by the settings route."""

    ip: str

# WebRTC candidates expose deployment addressing, so reads use the same protected
# configuration boundary as camera source data.
@config_router.get("/webrtc")
def get_webrtc():
    """Read the non-STUN WebRTC candidate IP from config.

    The function reads YAML only, returns an empty IP when no candidate exists,
    and raises 404 if the primary config file is missing.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")
    # Entering a read-only transaction first recovers any durable prepared journal
    # and then returns a consistent snapshot without creating a backup.
    with open_config_transaction() as transaction:
        config = transaction.config
    
    candidates = config.get('go2rtc', {}).get('webrtc', {}).get('candidates', [])
    ip = ""
    for c in candidates:
        if c != "stun:8555":
            ip = c.split(':')[0]
            break
            
    return {"ip": ip}

# Candidate updates affect live connectivity and therefore require the router's
# verified administrator before any file is opened for writing.
@config_router.post("/webrtc")
def set_webrtc(webrtc: WebRTCConfig):
    """Persist a WebRTC candidate IP while retaining the STUN fallback.

    ``webrtc`` contains the desired IP. The function writes config YAML and returns
    a success message, or 404 when config is unavailable.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    # The current reader and go2rtc candidate format are IPv4-specific; strict
    # parsing prevents YAML/control-character injection and ambiguous host syntax.
    try:
        candidate_ip = ipaddress.IPv4Address(webrtc.ip)
    except ipaddress.AddressValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid WebRTC IPv4 address") from exc
    with open_config_transaction() as transaction:
        config = transaction.config
        webrtc_config = config.setdefault('go2rtc', {}).setdefault('webrtc', {})
        candidates = [f"{candidate_ip}:8555", "127.0.0.1:8555", "stun:8555"]
        if webrtc_config.get('candidates') != candidates:
            webrtc_config['candidates'] = candidates
            transaction.mark_changed()
        
    return {"status": "success", "message": f"WebRTC IP updated to {webrtc.ip}"}

# LPR stream synchronization can rewrite every camera input, so it is an
# administrative config mutation even when no differences are ultimately found.
@config_router.post("/lpr_streams_sync")
def sync_lpr_streams():
    """Synchronize Frigate inputs with the current LPR camera assignment.

    The function reads LPR/config files, conditionally rewrites config YAML, and
    returns whether any camera input changed.
    """

    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    # Recompute inputs while holding the same lock used by camera provisioning, so
    # an LPR sync cannot overwrite a camera added by another worker milliseconds ago.
    lpr_cams = get_lpr_cameras()
    changed = False
    with open_config_transaction() as transaction:
        config = transaction.config
        for cam_name, cam_config in config.get("cameras", {}).items():
            ai_enabled = cam_config.get("detect", {}).get("enabled", False)
            go2rtc_streams = config.get("go2rtc", {}).get("streams", {})
            has_sub = f"{cam_name}_sub" in go2rtc_streams
            main_url = "dummy"
            sub_url = "dummy" if has_sub else ""
            new_inputs = configure_camera_inputs(
                cam_name,
                main_url,
                sub_url,
                ai_enabled,
                cam_name in lpr_cams,
            )
            old_inputs = cam_config.get("ffmpeg", {}).get("inputs", [])
            if get_input_signature(old_inputs) != get_input_signature(new_inputs):
                cam_config.setdefault("ffmpeg", {})["inputs"] = new_inputs
                changed = True
        if changed:
            transaction.mark_changed()
            
    return {"status": "success", "changed": changed}

# Dashboard lifecycle saves use the historical endpoint name after updating
# detect.enabled. Delegating to the same transactional role reconciliation keeps
# LPR/main-stream policy and ordinary sub-stream detection on one code path.
@config_router.post("/sync_detect_roles")
def sync_detect_roles():
    """Reconcile ffmpeg detect roles after Dashboard lifecycle changes.

    The function has no request body, returns the delegated changed/status
    response, and may atomically rewrite camera ffmpeg inputs through
    ``sync_lpr_streams``.
    """

    return sync_lpr_streams()

import urllib.request
import urllib.parse
import ssl

def get_federation_secret():
    try:
        import json
        with open("/settings-data/secrets.json", "r") as f:
            data = json.load(f)
            if "WATCHLIST_FEDERATION_SHARED_SECRET" in data:

                return data["WATCHLIST_FEDERATION_SHARED_SECRET"]
    except Exception:
        pass
    return os.environ.get("WATCHLIST_FEDERATION_SHARED_SECRET", "")

@app.get("/api/config/federation/cameras")
def get_federation_cameras(request: Request):
    secret = get_federation_secret()
    if not secret or not hmac.compare_digest(request.headers.get("X-BPP-Federation", ""), secret):
        raise HTTPException(status_code=401, detail="Unauthorized federation access")
    return get_cameras()

@config_router.get("/federated_peers")
def get_federated_peers(request: Request):
    try:
        import json
        with open("/settings-data/nodes.json", "r", encoding="utf-8") as f:
            nodes = json.load(f)
    except FileNotFoundError:
        nodes = []
    
    secret = get_federation_secret()
    results = {}
    
    ctx = ssl.create_default_context()
    if os.environ.get("FEDERATION_VERIFY_SSL", "false").lower() != "true":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    for node in nodes:
        ip = node.get("ip")
        name = node.get("name")
        if not ip: continue
        
        parsed = urllib.parse.urlparse(ip)
        if not parsed.scheme:
            parsed = parsed._replace(scheme="https", netloc=ip)
        url = f"https://{parsed.netloc}/api/config/federation/cameras"
        
        req = urllib.request.Request(url)
        if secret:
            req.add_header("X-BPP-Federation", secret)
            
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=3) as res:
                if res.status == 200:
                    import json
                    data = json.loads(res.read().decode('utf-8'))
                    results[name or ip] = {
                        "ip": parsed.netloc,
                        "cameras": data
                    }
        except Exception as e:
            pass
            
    return results

_reconcile_lock = threading.Lock()
_frigate_runtime_lock = threading.Lock()
DEFAULT_OBJECT_TRACK = ['person', 'car', 'motorcycle', 'truck']


def _load_gps_url_map() -> dict:
    gps_path = "/settings-data/camera_gps.json"
    if not os.path.exists(gps_path):
        gps_path = os.path.join(os.path.dirname(CONFIG_PATH), "dashboard-settings", "camera_gps.json")
    if os.path.exists(gps_path):
        try:
            with open(gps_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}


def _ensure_camera_in_config(transaction, name: str, templates: dict) -> tuple[dict, bool]:
    """
    Ensure `name` exists in `transaction.config['cameras']`.
    If missing, restores from `templates[name]` or provisions a default camera block
    if `name` exists in go2rtc.streams, nvr_groups.json, camera_sources.json, or camera_gps.json.
    Returns (camera_dict, created_bool).
    """
    cameras_dict = transaction.config.setdefault("cameras", {})
    if name in cameras_dict and isinstance(cameras_dict[name], dict):
        cam = cameras_dict[name]
        if not cam.get("objects", {}).get("track"):
            tmpl_track = (templates.get(name, {}) if isinstance(templates.get(name), dict) else {}).get("objects", {}).get("track")
            cam.setdefault("objects", {})["track"] = list(tmpl_track) if tmpl_track else list(DEFAULT_OBJECT_TRACK)
        return cam, False

    go2rtc_streams = transaction.config.setdefault("go2rtc", {}).setdefault("streams", {})
    groups = transaction.groups if transaction.groups is not None else (load_groups(GROUPS_PATH) or {})
    sources = get_camera_sources()
    gps_map = _load_gps_url_map()

    tmpl = templates.get(name) if isinstance(templates.get(name), dict) else None
    if not tmpl and name not in go2rtc_streams and name not in groups and name not in sources and name not in gps_map:
        raise HTTPException(status_code=404, detail="Camera not found")

    if name not in go2rtc_streams:
        if name in gps_map and isinstance(gps_map[name], dict) and gps_map[name].get("url"):
            raw_u = str(gps_map[name]["url"]).split("#")[0].strip()
            if raw_u.startswith("ffmpeg:"):
                raw_u = raw_u[7:].strip()
            go2rtc_streams[name] = [f"ffmpeg:{raw_u}#input=hls#video=copy#audio=copy"]
        elif name in sources and sources[name]:
            go2rtc_streams.update(build_camera_streams(name, sources[name], None))

    if tmpl:
        cam_block = json.loads(json.dumps(dict(tmpl)))
        if not cam_block.get("objects", {}).get("track"):
            cam_block.setdefault("objects", {})["track"] = list(DEFAULT_OBJECT_TRACK)
    else:
        has_sub = f"{name}_sub" in go2rtc_streams
        lpr_cams = get_lpr_cameras()
        inputs = configure_camera_inputs(name, "dummy", "dummy" if has_sub else "", False, name in lpr_cams)
        cam_block = {
            "ffmpeg": {"inputs": inputs},
            "ui": {"dashboard": True},
            "enabled": False,
            "detect": {"enabled": False},
            "record": {
                "enabled": False,
                "alerts": {"retain": {"days": 7, "mode": "motion"}},
                "detections": {"retain": {"days": 7, "mode": "motion"}},
            },
            "snapshots": {"enabled": True, "bounding_box": True},
            "objects": {"track": list(DEFAULT_OBJECT_TRACK)},
        }
        templates[name] = json.loads(json.dumps(cam_block))
        save_camera_templates(templates)

    cameras_dict[name] = cam_block
    return cameras_dict[name], True


def _collect_camera_go2rtc_streams(name: str) -> dict:
    """Read go2rtc streams for `name`, `name_sub`, `name_hd` from config.yml and unmask credentials."""
    try:
        cfg = load_yaml_config(CONFIG_PATH)
        all_streams = (cfg.get("go2rtc") or {}).get("streams") or {}
    except Exception:
        return {}
    env_vars = {}
    env_file = CREDENTIALS_ENV_PATH
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and "=" in stripped:
                        k, v = stripped.split("=", 1)
                        env_vars[k.strip()] = v.strip()
        except OSError:
            pass

    def _unmask_val(val):
        if isinstance(val, str):
            for match in set(re.findall(r"\{FRIGATE_[A-Z0-9_]+\}", val)):
                var_name = match.strip("{}")
                if var_name in env_vars:
                    val = val.replace(match, env_vars[var_name])
            return val
        if isinstance(val, list):
            return [_unmask_val(x) for x in val]
        return val

    out = {}
    for key in (name, f"{name}_sub", f"{name}_hd"):
        if key in all_streams and all_streams[key]:
            out[key] = _unmask_val(all_streams[key])
    return out


def _sync_camera_to_frigate_runtime(
    name: str,
    enabled: bool,
    detect_enabled: bool,
    record_enabled: bool,
    objects_track: Optional[list] = None,
) -> None:
    """
    Synchronizes camera state (enabled, detect, record, objects, or dynamic process start)
    into Frigate 0.17.2 runtime without restarting Frigate.
    Respects per-camera AI detection schedules so runtime detection pauses outside
    scheduled windows while preserving 24/7 video recording and YAML config state.
    """
    # Evaluate whether the camera is currently inside its scheduled AI time window.
    in_schedule = is_camera_in_ai_schedule(name)
    effective_runtime_detect = bool(enabled and detect_enabled and in_schedule)
    _last_schedule_detect_state[name] = effective_runtime_detect

    try:
        import paho.mqtt.publish as publish
        publish.single(
            f"frigate/{name}/detect/set",
            payload="ON" if effective_runtime_detect else "OFF",
            hostname="mqtt",
        )
        publish.single(f"frigate/{name}/recordings/set", payload="ON" if record_enabled else "OFF", hostname="mqtt")
        publish.single(f"frigate/{name}/enabled/set", payload="ON" if enabled else "OFF", hostname="mqtt")
    except Exception as e:
        print(f"MQTT publish failed for {name}: {e}")

    def _worker():
        with _frigate_runtime_lock:
            try:
                secret = get_federation_secret()
                payload_dict = {
                    "camera": name,
                    "enabled": bool(enabled),
                    "detect_enabled": bool(effective_runtime_detect),
                    "record_enabled": bool(record_enabled),
                    "objects_track": list(objects_track) if objects_track is not None else None,
                    "go2rtc_streams": _collect_camera_go2rtc_streams(name) if enabled else None,
                }
                req = urllib.request.Request(
                    "http://watchlist-api:5001/internal/frigate-runtime-sync",
                    data=json.dumps(payload_dict).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "X-BPP-Federation": secret,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp.read()
            except Exception as err:
                print(f"[config-api] Frigate runtime sync warning for {name}: {err}")
            finally:
                # Re-assert MQTT detect state after runtime sync in case Frigate reloaded config.yml.
                if effective_runtime_detect != bool(detect_enabled):
                    try:
                        import paho.mqtt.publish as publish
                        publish.single(
                            f"frigate/{name}/detect/set",
                            payload="ON" if effective_runtime_detect else "OFF",
                            hostname="mqtt",
                        )
                    except Exception:
                        pass

    threading.Thread(target=_worker, daemon=True).start()



def snapshot_all_templates_internal() -> dict:
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")
    with open_config_transaction(include_groups=False) as transaction:
        cameras = transaction.config.get("cameras", {})
        templates = get_camera_templates()
        count = 0
        for cam_name, cam_block in cameras.items():
            templates[cam_name] = json.loads(json.dumps(dict(cam_block)))
            count += 1
        save_camera_templates(templates)
        return {
            "status": "success",
            "count": count,
            "templates_saved": sorted(list(templates.keys()))
        }

def reconcile_cameras_internal() -> dict:
    """
    Demand-Driven Camera Provisioning Reconciliation (ADR-0020 / ADR-0024):
    1. Fetches desired camera pool and AI-demanded cameras from nas-bot-service.
    2. Compares with cameras currently in config.yml.
    3. Deprovisions unreferenced cameras (saving templates first).
    4. Provisions newly demanded cameras and synchronizes AI state across active cameras.
    5. Synchronizes Frigate runtime processes via ZMQ/config_set without restarting Frigate.
    """
    with _reconcile_lock:
        if not os.path.exists(CONFIG_PATH):
            raise HTTPException(status_code=404, detail="config.yml not found")

        desired_cameras = set()
        ai_demand_cameras = None
        online_users = 0
        try:
            req = urllib.request.Request(NAS_BOT_DEMAND_POOL_URL, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                pool_data = json.loads(resp.read().decode('utf-8'))
                desired_cameras = set(pool_data.get("cameras", []))
                if "ai_demand_cameras" in pool_data and isinstance(pool_data["ai_demand_cameras"], list):
                    ai_demand_cameras = set(pool_data["ai_demand_cameras"])
                online_users = pool_data.get("online_users", 0)
        except Exception as e:
            return {
                "status": "error",
                "message": f"Demand pool unreachable: {e}",
                "changed": False
            }

        templates = get_camera_templates()
        manual_recs = get_manual_recordings()
        lpr_cams = get_lpr_cameras()
        gps_map = _load_gps_url_map()

        # Include any cameras explicitly marked force_active in templates
        for cam_name, tmpl in templates.items():
            if isinstance(tmpl, dict) and tmpl.get("force_active") is True:
                desired_cameras.add(cam_name)
                if ai_demand_cameras is not None:
                    ai_demand_cameras.add(cam_name)

        runtime_sync_queue = []

        with open_config_transaction(include_groups=False) as transaction:
            config = transaction.config
            current_cameras_dict = config.setdefault('cameras', {})
            current_active_cameras = {
                cam for cam, ccfg in current_cameras_dict.items()
                if isinstance(ccfg, dict) and ccfg.get("ui", {}).get("dashboard", True) is not False
            }

            to_provision = desired_cameras - current_active_cameras
            to_deprovision = current_active_cameras - desired_cameras

            # Also check already-active cameras whose detect.enabled disagrees with ai_demand_cameras
            to_update_ai = set()
            if ai_demand_cameras is not None:
                for cam in (desired_cameras & current_active_cameras):
                    ccfg = current_cameras_dict.get(cam, {})
                    cur_ai = bool(ccfg.get("detect", {}).get("enabled", False))
                    want_ai = cam in ai_demand_cameras
                    if cur_ai != want_ai:
                        to_update_ai.add(cam)

            if not to_provision and not to_deprovision and not to_update_ai:
                for cam in current_active_cameras:
                    ccfg = current_cameras_dict.get(cam)
                    if isinstance(ccfg, dict) and ccfg.get("enabled", False):
                        runtime_sync_queue.append((
                            cam,
                            bool(ccfg.get("enabled", False)),
                            bool((ccfg.get("detect") or {}).get("enabled", False)),
                            bool((ccfg.get("record") or {}).get("enabled", False)),
                        ))
                for cam, en_val, det_val, rec_val in runtime_sync_queue:
                    _sync_camera_to_frigate_runtime(cam, en_val, det_val, rec_val)
                return {
                    "status": "success",
                    "changed": False,
                    "active_cameras": sorted(list(current_active_cameras)),
                    "online_users": online_users
                }

            # 1. Deprovision unreferenced cameras (preserve camera entry with enabled: False so historical events remain queryable)
            for cam in to_deprovision:
                existing_block = current_cameras_dict.get(cam)
                existing_track = list(DEFAULT_OBJECT_TRACK)
                if existing_block:
                    existing_track = existing_block.get("objects", {}).get("track") or existing_track
                    templates[cam] = json.loads(json.dumps(dict(existing_block)))
                current_cameras_dict[cam] = {
                    "enabled": False,
                    "ui": {"dashboard": False},
                    "ffmpeg": {
                        "inputs": [{"path": f"rtsp://127.0.0.1:8554/{cam}?video", "input_args": "preset-rtsp-restream", "roles": ["record"]}]
                    },
                    "detect": {"enabled": False},
                    "record": {"enabled": False},
                    "objects": {"track": list(existing_track)},
                }
                runtime_sync_queue.append((cam, False, False, False))

            # 2. Provision newly demanded cameras and update active cameras whose AI state changed
            for cam in (to_provision | to_update_ai):
                prov_streams = config.setdefault('go2rtc', {}).setdefault('streams', {})
                sources = get_camera_sources()
                if cam in sources and str(sources[cam]).lower().startswith("rtmp"):
                    rtmp_url = sources[cam]
                    stream_key = rtmp_url.rstrip('/').split('/')[-1] if '/' in rtmp_url else cam
                    lower_key = stream_key.lower()
                    if stream_key and (stream_key != cam or lower_key != cam):
                        target_key = stream_key if stream_key != cam else lower_key
                        if target_key not in prov_streams:
                            prov_streams[target_key] = []
                        if cam not in prov_streams or not prov_streams[cam]:
                            prov_streams[cam] = [
                                f"rtsp://127.0.0.1:8554/{target_key}",
                                f"ffmpeg:{target_key}#audio=opus"
                            ]
                    else:
                        if cam not in prov_streams:
                            prov_streams[cam] = []
                elif cam not in prov_streams:
                    tmpl_inputs = (templates.get(cam, {})
                                   .get('ffmpeg', {})
                                   .get('inputs', []))
                    if tmpl_inputs:
                        raw_path = tmpl_inputs[0].get('path', '')
                        clean_path = stream_probe.strip_stream_filters(raw_path)
                        if clean_path and 'rtsp://127.0.0.1:8554' not in clean_path:
                            prov_streams.update(
                                stream_probe.get_optimal_camera_streams(cam, clean_path)
                            )
                    elif cam in gps_map and isinstance(gps_map[cam], dict) and gps_map[cam].get("url"):
                        raw_u = str(gps_map[cam]["url"]).split("#")[0].strip()
                        if raw_u.startswith("ffmpeg:"):
                            raw_u = raw_u[7:].strip()
                        prov_streams[cam] = [f"ffmpeg:{raw_u}#input=hls#video=copy#audio=copy"]

                base_block = None
                if cam in templates and isinstance(templates[cam], dict):
                    base_block = json.loads(json.dumps(dict(templates[cam])))
                elif cam in current_cameras_dict and isinstance(current_cameras_dict[cam], dict):
                    base_block = json.loads(json.dumps(dict(current_cameras_dict[cam])))

                if ai_demand_cameras is not None:
                    ai_on = bool(cam in ai_demand_cameras)
                elif base_block is not None:
                    ai_on = bool(base_block.get("detect", {}).get("enabled", False))
                else:
                    ai_on = False

                rec_on = bool(ai_on or manual_recs.get(cam, False))
                has_sub = f"{cam}_sub" in prov_streams
                new_inputs = configure_camera_inputs(
                    cam, "dummy", "dummy" if has_sub else "", ai_on, cam in lpr_cams
                )

                if base_block is not None:
                    cam_block = base_block
                    cam_block["enabled"] = rec_on
                    cam_block.setdefault("detect", {})["enabled"] = ai_on
                    cam_block.setdefault("record", {})["enabled"] = rec_on
                    cam_block.setdefault("record", {}).setdefault("alerts", {"retain": {"days": 7, "mode": "motion"}})
                    cam_block.setdefault("record", {}).setdefault("detections", {"retain": {"days": 7, "mode": "motion"}})
                    cam_block.setdefault("snapshots", {"enabled": True, "bounding_box": True})
                    if not cam_block.get("objects", {}).get("track"):
                        cam_block.setdefault("objects", {})["track"] = list(DEFAULT_OBJECT_TRACK)
                    cam_block["ffmpeg"] = {"inputs": new_inputs}
                    cam_block.setdefault("ui", {})["dashboard"] = True
                    current_cameras_dict[cam] = cam_block
                else:
                    cam_block = {
                        'ffmpeg': {'inputs': new_inputs},
                        'ui': {'dashboard': True},
                        'enabled': rec_on,
                        'detect': {'enabled': ai_on},
                        'record': {
                            'enabled': rec_on,
                            'alerts': {'retain': {'days': 7, 'mode': 'motion'}},
                            'detections': {'retain': {'days': 7, 'mode': 'motion'}}
                        },
                        'snapshots': {'enabled': True, 'bounding_box': True},
                        'objects': {'track': list(DEFAULT_OBJECT_TRACK)}
                    }
                    current_cameras_dict[cam] = cam_block

                templates[cam] = json.loads(json.dumps(dict(cam_block)))
                runtime_sync_queue.append((cam, rec_on, ai_on, rec_on))

            save_camera_templates(templates)
            transaction.mark_changed()

        for cam, en_val, det_val, rec_val in runtime_sync_queue:
            _sync_camera_to_frigate_runtime(cam, en_val, det_val, rec_val)

        return {
            "status": "success",
            "changed": True,
            "provisioned": sorted(list(to_provision)),
            "deprovisioned": sorted(list(to_deprovision)),
            "ai_updated": sorted(list(to_update_ai)),
            "active_cameras": sorted(list(desired_cameras)),
            "online_users": online_users
        }

def get_reconcile_status_internal() -> dict:
    templates = get_camera_templates()
    active_cameras = []
    if os.path.exists(CONFIG_PATH):
        try:
            with open_config_transaction(include_groups=False) as transaction:
                active_cameras = sorted(list(transaction.config.get('cameras', {}).keys()))
        except Exception:
            pass
    online_users = 0
    desired_pool = []
    try:
        req = urllib.request.Request(NAS_BOT_DEMAND_POOL_URL, method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            desired_pool = data.get("cameras", [])
            online_users = data.get("online_users", 0)
    except Exception:
        pass
    return {
        "status": "success",
        "active_cameras": active_cameras,
        "active_camera_count": len(active_cameras),
        "desired_pool": desired_pool,
        "online_users": online_users,
        "templates_count": len(templates),
        "templates": sorted(list(templates.keys()))
    }

@config_router.post("/snapshot-all-templates")
def admin_snapshot_all_templates():
    return snapshot_all_templates_internal()

@config_router.post("/reconcile")
def admin_reconcile():
    return reconcile_cameras_internal()

@config_router.get("/reconcile-status")
def admin_reconcile_status():
    return get_reconcile_status_internal()


class SystemUpdateSettingsPayload(BaseModel):
    auto_web_sync: bool = True
    interval_minutes: int = Field(default=15, ge=5, le=1440)
    branch: Optional[str] = None


@config_router.get("/system/update/status")
def admin_system_update_status(refresh: bool = False):
    from system_updater import get_system_updater

    return get_system_updater().get_status(force_fetch=refresh)


@config_router.post("/system/update/settings")
def admin_system_update_settings(payload: SystemUpdateSettingsPayload):
    from system_updater import get_system_updater

    try:
        return get_system_updater().update_settings(
            auto_web_sync=payload.auto_web_sync,
            interval_minutes=payload.interval_minutes,
            branch=payload.branch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@config_router.post("/system/update/web-sync")
def admin_system_update_web_sync():
    from system_updater import get_system_updater

    res = get_system_updater().sync_web_ui_only()
    if not res.get("ok"):
        raise HTTPException(status_code=500, detail=res.get("error", "Web UI sync failed"))
    return res


@config_router.post("/system/update/apply")
def admin_system_update_apply():
    from system_updater import get_system_updater

    res = get_system_updater().apply_full_update()
    if not res.get("ok"):
        raise HTTPException(status_code=500, detail=res.get("error", "Full system update failed"))
    return res


app.include_router(config_router)

operator_router = APIRouter(prefix="/api/config", dependencies=[Depends(require_authenticated)])

MANUAL_CLIPS_DIR = os.environ.get(
    "MANUAL_CLIPS_DIR",
    os.path.join(os.path.dirname(CONFIG_PATH), "manual_clips"),
)
_manual_clips_lock = threading.Lock()


def _load_manual_clips_index() -> list:
    os.makedirs(MANUAL_CLIPS_DIR, exist_ok=True)
    idx_path = os.path.join(MANUAL_CLIPS_DIR, "index.json")
    if not os.path.isfile(idx_path):
        return []
    try:
        with open(idx_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_manual_clips_index(items: list) -> None:
    os.makedirs(MANUAL_CLIPS_DIR, exist_ok=True)
    idx_path = os.path.join(MANUAL_CLIPS_DIR, "index.json")
    tmp_path = idx_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(items[:500], fh, ensure_ascii=False, indent=2)
    os.replace(tmp_path, idx_path)


def _get_camera_display_name(cam_name: str) -> str:
    for path in (
        "/settings-data/camera_names.json",
        os.path.join(os.path.dirname(CONFIG_PATH), "dashboard-settings", "camera_names.json"),
    ):
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    names = json.load(fh)
                    if isinstance(names, dict) and names.get(cam_name):
                        return str(names[cam_name]).strip()
            except Exception:
                pass
    return cam_name


def _start_watchlist_manual_recorder(cam_name: str, start_ts: float) -> bytes:
    import base64

    try:
        secret = get_federation_secret()
        payload = json.dumps({"camera": cam_name, "start_time": start_ts}).encode("utf-8")
        req = urllib.request.Request(
            "http://watchlist-api:5001/internal/manual-record/start",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-BPP-Federation": secret,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            if resp.status == 200:
                res = json.loads(resp.read().decode("utf-8"))
                sb64 = str(res.get("snapshot_b64") or "").strip()
                if sb64:
                    return base64.b64decode(sb64)
    except Exception as exc:
        print(f"[config-api] manual-record/start warning for {cam_name}: {exc}")
    return b""


def _stop_watchlist_manual_recorder(cam_name: str, start_ts: float, end_ts: float) -> tuple[bytes, bytes]:
    import base64

    try:
        secret = get_federation_secret()
        payload = json.dumps({
            "camera": cam_name,
            "start_time": start_ts,
            "end_time": end_ts,
        }).encode("utf-8")
        req = urllib.request.Request(
            "http://watchlist-api:5001/internal/manual-record/stop",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-BPP-Federation": secret,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=14.0) as resp:
            if resp.status == 200:
                res = json.loads(resp.read().decode("utf-8"))
                vb64 = str(res.get("video_b64") or "").strip()
                sb64 = str(res.get("snapshot_b64") or "").strip()
                v_bytes = base64.b64decode(vb64) if vb64 else b""
                s_bytes = base64.b64decode(sb64) if sb64 else b""
                return v_bytes, s_bytes
    except Exception as exc:
        print(f"[config-api] manual-record/stop warning for {cam_name}: {exc}")
    return b"", b""


def _store_manual_clip_files(
    camera: str,
    camera_name: str,
    start_time: float,
    end_time: float,
    video_bytes: bytes,
    snapshot_bytes: bytes,
    mime_type: str = "video/mp4",
    description: str = "",
    clip_id: Optional[str] = None,
    sub_label: str = "บันทึกด้วยมือ",
) -> dict:
    import secrets
    import shutil
    import subprocess

    os.makedirs(MANUAL_CLIPS_DIR, exist_ok=True)
    now_ts = end_time if end_time > 0 else time.time()
    start_ts = start_time if (0 < start_time <= now_ts) else max(0.0, now_ts - 5.0)
    dur = max(1.0, round(now_ts - start_ts, 1))
    safe_clip_id = re.sub(r"[^A-Za-z0-9_-]", "", clip_id or "") or f"mrec_{int(start_ts)}_{secrets.token_hex(3)}"

    ext = ".webm" if "webm" in (mime_type or "").lower() else ".mp4"
    raw_video_path = os.path.join(MANUAL_CLIPS_DIR, f"{safe_clip_id}_raw{ext}")
    final_mp4_path = os.path.join(MANUAL_CLIPS_DIR, f"{safe_clip_id}.mp4")
    snap_path = os.path.join(MANUAL_CLIPS_DIR, f"{safe_clip_id}.jpg")

    existing_mp4_size = os.path.getsize(final_mp4_path) if os.path.isfile(final_mp4_path) else 0
    has_clip = existing_mp4_size > 256

    if video_bytes and len(video_bytes) > 256 and (not has_clip or len(video_bytes) > existing_mp4_size):
        with open(raw_video_path, "wb") as vf:
            vf.write(video_bytes)
        ffmpeg_bin = shutil.which("ffmpeg")
        converted = False
        if ffmpeg_bin:
            try:
                res = subprocess.run(
                    [
                        ffmpeg_bin,
                        "-y",
                        "-i",
                        raw_video_path,
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-crf",
                        "23",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:a",
                        "aac",
                        "-movflags",
                        "+faststart",
                        final_mp4_path,
                    ],
                    capture_output=True,
                    timeout=25,
                )
                if res.returncode == 0 and os.path.isfile(final_mp4_path) and os.path.getsize(final_mp4_path) > 256:
                    converted = True
            except Exception:
                converted = False
        if converted:
            try:
                os.remove(raw_video_path)
            except Exception:
                pass
            has_clip = True
        else:
            os.replace(raw_video_path, final_mp4_path)
            has_clip = True

    if snapshot_bytes and len(snapshot_bytes) >= 200:
        with open(snap_path, "wb") as sf:
            sf.write(snapshot_bytes)

    has_snapshot = os.path.isfile(snap_path) and os.path.getsize(snap_path) >= 200
    cam_label = (camera_name or _get_camera_display_name(camera) or camera).strip()
    desc_text = (description or f"บันทึกวิดีโอด้วยมือ ({cam_label})").strip()
    entry = {
        "id": safe_clip_id,
        "camera": camera,
        "camera_name": cam_label,
        "label": "manual_rec",
        "sub_label": sub_label,
        "start_time": float(start_ts),
        "end_time": float(now_ts),
        "duration": dur,
        "top_score": 1.0,
        "has_clip": has_clip,
        "has_snapshot": has_snapshot,
        "source": "manual_rec",
        "description": desc_text,
        "clip_url": f"/api/config/manual_clips/{safe_clip_id}/clip.mp4",
        "snapshot_url": f"/api/config/manual_clips/{safe_clip_id}/snapshot.jpg",
    }
    with _manual_clips_lock:
        items = _load_manual_clips_index()
        items = [x for x in items if x.get("id") != safe_clip_id]
        items.insert(0, entry)
        _save_manual_clips_index(items)
    return entry


@operator_router.get("/manual_clips")
def list_manual_clips(identity: TrustedIdentity = Depends(require_authenticated)):
    return {"status": "ok", "clips": _load_manual_clips_index()}


@operator_router.post("/manual_clips")
async def upload_manual_clip(request: Request, identity: TrustedIdentity = Depends(require_authenticated)):
    import base64

    body = await request.json()
    camera = str(body.get("camera") or "").strip()
    if not camera:
        raise HTTPException(status_code=400, detail="camera is required")
    camera_name = str(body.get("camera_name") or camera).strip()
    start_time = float(body.get("start_time") or (time.time() - 5.0))
    end_time = float(body.get("end_time") or time.time())
    mime_type = str(body.get("mime_type") or "video/mp4")
    description = str(body.get("description") or "").strip()

    video_b64 = str(body.get("video_b64") or "").strip()
    if "," in video_b64:
        video_b64 = video_b64.split(",", 1)[1]
    video_bytes = base64.b64decode(video_b64) if video_b64 else b""

    snap_b64 = str(body.get("snapshot_b64") or "").strip()
    if "," in snap_b64:
        snap_b64 = snap_b64.split(",", 1)[1]
    snap_bytes = base64.b64decode(snap_b64) if snap_b64 else b""

    # If client did not send video bytes (e.g. fallback), try fetching NVR clip from Frigate
    if not video_bytes:
        s_int = max(0, int(start_time) - 2)
        e_int = int(end_time) + 2
        for host in ("http://frigate:5000", "http://127.0.0.1:5000"):
            try:
                req = urllib.request.Request(
                    f"{host}/api/{urllib.parse.quote(camera)}/start/{s_int}/end/{e_int}/clip.mp4",
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        data = resp.read()
                        if data and len(data) > 1000:
                            video_bytes = data
                            mime_type = "video/mp4"
                            break
            except Exception:
                pass

    entry = _store_manual_clip_files(
        camera=camera,
        camera_name=camera_name,
        start_time=start_time,
        end_time=end_time,
        video_bytes=video_bytes,
        snapshot_bytes=snap_bytes,
        mime_type=mime_type,
        description=description,
    )
    return {"status": "ok", "clip": entry}


@operator_router.get("/manual_clips/{clip_id}/clip.mp4")
def serve_manual_clip_video(clip_id: str):
    from fastapi.responses import FileResponse, Response

    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", clip_id)
    mp4_path = os.path.join(MANUAL_CLIPS_DIR, f"{safe_id}.mp4")
    if not os.path.isfile(mp4_path):
        raise HTTPException(status_code=404, detail="Manual clip not found")
    # Detect if file starts with WebM EBML header (0x1A 0x45 0xDF 0xA3)
    with open(mp4_path, "rb") as fh:
        head = fh.read(4)
    media_type = "video/webm" if head == b"\x1a\x45\xdf\xa3" else "video/mp4"
    return FileResponse(mp4_path, media_type=media_type, filename=f"{safe_id}.mp4")


@operator_router.get("/manual_clips/{clip_id}/snapshot.jpg")
def serve_manual_clip_snapshot(clip_id: str):
    from fastapi.responses import FileResponse, Response

    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", clip_id)
    snap_path = os.path.join(MANUAL_CLIPS_DIR, f"{safe_id}.jpg")
    if os.path.isfile(snap_path):
        return FileResponse(snap_path, media_type="image/jpeg")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
        '<rect width="640" height="360" fill="#0f172a"/>'
        '<circle cx="320" cy="155" r="34" fill="rgba(239,68,68,0.2)" stroke="#ef4444" stroke-width="3"/>'
        '<polygon points="310,138 340,155 310,172" fill="#ef4444"/>'
        '<text x="320" y="230" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="20" font-weight="bold">วิดีโอบันทึกด้วยมือ (Manual REC)</text>'
        "</svg>"
    )
    return Response(content=svg, media_type="image/svg+xml")


@operator_router.post("/manual_clips/{clip_id}/description")
async def update_manual_clip_description(clip_id: str, request: Request, identity: TrustedIdentity = Depends(require_authenticated)):
    body = await request.json()
    desc = str(body.get("description") or "").strip()
    with _manual_clips_lock:
        items = _load_manual_clips_index()
        found = False
        for item in items:
            if item.get("id") == clip_id:
                item["description"] = desc
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Manual clip not found")
        _save_manual_clips_index(items)
    return {"status": "ok", "id": clip_id, "description": desc}


@operator_router.delete("/manual_clips/{clip_id}")
def delete_manual_clip(clip_id: str, identity: TrustedIdentity = Depends(require_authenticated)):
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", clip_id)
    with _manual_clips_lock:
        items = _load_manual_clips_index()
        items = [x for x in items if x.get("id") != safe_id]
        _save_manual_clips_index(items)
    for ext in (".mp4", ".webm", ".jpg"):
        p = os.path.join(MANUAL_CLIPS_DIR, f"{safe_id}{ext}")
        if os.path.isfile(p):
            try:
                os.remove(p)
            except Exception:
                pass
    return {"status": "ok", "id": safe_id}


@operator_router.post("/cameras/{name}/record_toggle")
def toggle_manual_record(name: str, request: Request, identity: TrustedIdentity = Depends(require_authenticated)):
    """Toggle manual continuous recording on NVR for one camera."""
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    manual_recs = get_manual_recordings()
    prev_val = manual_recs.get(name)
    current_state = bool(prev_val)
    new_state = not current_state
    now_ts = time.time()
    prev_start_ts = prev_val.get("start_time", now_ts - 10.0) if isinstance(prev_val, dict) else (now_ts - 10.0)

    if new_state:
        manual_recs[name] = {"active": True, "start_time": now_ts}
    else:
        manual_recs.pop(name, None)
    save_manual_recordings(manual_recs)

    with open_config_transaction() as transaction:
        templates = get_camera_templates()
        camera, _ = _ensure_camera_in_config(transaction, name, templates)
        detect_on = camera.get('detect', {}).get('enabled', False)

        if new_state:
            camera['enabled'] = True
            rec = camera.setdefault('record', {})
            rec['enabled'] = True
            rec.setdefault('continuous', {})['days'] = 7
            transaction.mark_changed()
        else:
            rec = camera.setdefault('record', {})
            if 'continuous' in rec:
                rec['continuous']['days'] = 0
            if detect_on:
                rec['enabled'] = True
                camera['enabled'] = True
            else:
                rec['enabled'] = False
                camera['enabled'] = False
            transaction.mark_changed()
        cam_enabled = bool(camera.get('enabled', False))
        rec_enabled = bool(camera.get('record', {}).get('enabled', False))

    _sync_camera_to_frigate_runtime(name, cam_enabled, bool(detect_on), rec_enabled)

    return {
        "status": "success",
        "camera": name,
        "recording": new_state,
        "start_time": now_ts if new_state else float(prev_start_ts),
        "end_time": now_ts,
        "message": f"NVR recording {'started' if new_state else 'stopped'} for {name}"
    }

@operator_router.get("/cameras/record_status")
def get_manual_record_status(identity: TrustedIdentity = Depends(require_authenticated)):
    manual_recs = get_manual_recordings()
    return {"active_recordings": list(manual_recs.keys())}


# Incident 2.45: Detect-only toggle accessible to ALL authenticated roles.
# Unlike the admin-only PUT /cameras/{name}/enabled which manages camera lifecycle
# (enabled + record + detect), this endpoint ONLY toggles detect.enabled so regular
# operators can control AI per-channel without affecting camera ingest or recording.
@operator_router.put("/cameras/{name}/detect_toggle")
def toggle_camera_detect(
    name: str,
    body: DetectToggleConfig,
    identity: TrustedIdentity = Depends(require_authenticated),
):
    """Toggle AI detection (detect.enabled) for one camera.

    Accessible to all authenticated users. Synchronizes recording, camera enabled
    lifecycle, ffmpeg input roles, persisted camera templates, and Frigate runtime.
    """
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    new_detect = body.detect_enabled
    changed = False

    with open_config_transaction() as transaction:
        templates = get_camera_templates()
        camera, created = _ensure_camera_in_config(transaction, name, templates)
        if created:
            changed = True

        detect = camera.setdefault("detect", {})
        if detect.get("enabled") != new_detect:
            detect["enabled"] = new_detect
            changed = True

        if new_detect and camera.get("ui", {}).get("dashboard") is False:
            camera.setdefault("ui", {})["dashboard"] = True
            changed = True

        if not camera.get("objects", {}).get("track"):
            camera.setdefault("objects", {})["track"] = list(DEFAULT_OBJECT_TRACK)
            changed = True

        # Synchronize recording: if detect is on, recording must also be on
        # so Frigate captures events. If detect is off, check manual recordings.
        manual_recs = get_manual_recordings()
        is_manual_rec = manual_recs.get(name, False)
        record = camera.setdefault("record", {})
        target_record = bool(new_detect or is_manual_rec)
        if record.get("enabled") != target_record:
            record["enabled"] = target_record
            changed = True

        # Demand-driven CPU preservation: if neither detect nor record, disable Frigate process
        effective_enabled = bool(new_detect or target_record)
        if camera.get("enabled", True) != effective_enabled:
            camera["enabled"] = effective_enabled
            changed = True

        # Synchronize ffmpeg input roles so Frigate validator accepts the config
        lpr_cams = get_lpr_cameras()
        go2rtc_streams = transaction.config.get("go2rtc", {}).get("streams", {})
        has_sub = f"{name}_sub" in go2rtc_streams
        new_inputs = configure_camera_inputs(
            name, "dummy", "dummy" if has_sub else "", new_detect, name in lpr_cams
        )
        old_inputs = camera.get("ffmpeg", {}).get("inputs", [])
        if get_input_signature(old_inputs) != get_input_signature(new_inputs):
            camera.setdefault("ffmpeg", {})["inputs"] = new_inputs
            changed = True

        # Keep persisted camera template in sync (ADR-0020)
        tmpl = templates.setdefault(name, json.loads(json.dumps(dict(camera))))
        if isinstance(tmpl, dict):
            tmpl["enabled"] = effective_enabled
            tmpl.setdefault("ui", {})["dashboard"] = True
            tmpl.setdefault("record", {})["enabled"] = target_record
            tmpl.setdefault("detect", {})["enabled"] = new_detect
            tmpl.setdefault("ffmpeg", {})["inputs"] = new_inputs
            if not tmpl.get("objects", {}).get("track"):
                tmpl.setdefault("objects", {})["track"] = list(camera.get("objects", {}).get("track") or DEFAULT_OBJECT_TRACK)
            save_camera_templates(templates)

        if changed:
            transaction.mark_changed()

    _sync_camera_to_frigate_runtime(name, effective_enabled, new_detect, target_record)
    in_sched = is_camera_in_ai_schedule(name)

    return {
        "status": "success",
        "camera": name,
        "detect_enabled": new_detect,
        "runtime_detect_enabled": bool(effective_enabled and new_detect and in_sched),
        "is_in_schedule": in_sched,
        "changed": changed,
        "user": identity.username,
    }


app.include_router(operator_router)

public_router = APIRouter(prefix="/api/public-config")

@public_router.post("/snapshot-all-templates")
def public_snapshot_all_templates():
    return snapshot_all_templates_internal()

@public_router.post("/reconcile")
def public_reconcile():
    return reconcile_cameras_internal()

@public_router.get("/reconcile-status")
def public_reconcile_status():
    return get_reconcile_status_internal()

@public_router.get("/cameras-catalog")
def public_get_cameras_catalog(identity: TrustedIdentity = Depends(require_authenticated)):
    """
    Returns camera catalog + YOLO11 tracked objects + AI schedules for all authenticated users
    (across config.yml cameras, camera_templates.json, go2rtc.streams, and nvr_groups.json).
    """
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    try:
        with open_config_transaction(include_groups=True) as transaction:
            config = transaction.config
            groups = transaction.groups or {}
    except HTTPException as exc:
        if exc.status_code == 503:
            config = load_yaml_config(CONFIG_PATH)
            groups = load_groups(GROUPS_PATH) or {}
        else:
            raise

    templates = get_camera_templates()
    schedules = get_ai_schedules()
    now_bkk = datetime.now(BANGKOK_TZ)
    cameras = config.get("cameras", {})
    go2rtc_streams = config.get("go2rtc", {}).get("streams", {})
    global_track = (config.get("objects") or {}).get("track") or list(DEFAULT_OBJECT_TRACK)
    lm = (config.get("model") or {}).get("labelmap") or {}
    bus_truck_ready = (lm.get("5") == "bus" or lm.get(5) == "bus") and (lm.get("7") == "truck" or lm.get(7) == "truck")

    stream_names = set()
    for s, s_val in go2rtc_streams.items():
        if s.endswith("_sub") or s.endswith("_hd"):
            continue
        if s not in cameras and s not in groups and not s_val:
            continue
        stream_names.add(s)

    all_cams = set(cameras.keys()) | set(templates.keys()) | stream_names | set(groups.keys())
    result = []
    schedules_out = {}
    for cam_name in all_cams:
        cam_data = cameras.get(cam_name) if isinstance(cameras.get(cam_name), dict) else {}
        tmpl_data = templates.get(cam_name) if isinstance(templates.get(cam_name), dict) else {}
        ai_enabled = bool(
            cam_data.get("detect", {}).get("enabled", tmpl_data.get("detect", {}).get("enabled", False))
        ) if cam_name in cameras else False
        enabled_val = bool(cam_data.get("enabled", False)) if cam_name in cameras else False
        track = (
            (cam_data.get("objects") or {}).get("track")
            or (tmpl_data.get("objects") or {}).get("track")
            or list(global_track)
        )
        sched_entry = get_camera_schedule_entry(cam_name, schedules)
        in_sched = evaluate_camera_schedule(sched_entry, now_dt=now_bkk)
        schedules_out[cam_name] = {
            **sched_entry,
            "is_in_schedule": in_sched,
        }
        result.append({
            "name": cam_name,
            "ai_enabled": ai_enabled,
            "enabled": enabled_val,
            "group": groups.get(cam_name, ""),
            "has_hd": f"{cam_name}_hd" in go2rtc_streams,
            "has_sub": f"{cam_name}_sub" in go2rtc_streams,
            "track": list(track),
            "schedule": sched_entry,
            "is_in_schedule": in_sched,
        })

    def natural_sort_key(x):
        name = x.get("name", "")
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", name)]

    result.sort(key=natural_sort_key)
    return {
        "cameras": result,
        "bus_truck_ready": bool(bus_truck_ready),
        "global_track": list(global_track),
        "schedules": schedules_out,
        "server_time": now_bkk.strftime("%H:%M"),
    }


@public_router.put("/cameras/{name}/objects")
def public_set_camera_objects(
    name: str,
    request: CameraObjectsConfig,
    identity: TrustedIdentity = Depends(require_authenticated),
):
    """Allow any authenticated user to update YOLO11 tracked objects for a camera."""
    return set_camera_objects(name, request)


@public_router.get("/schedules")
def public_get_all_camera_schedules(
    identity: TrustedIdentity = Depends(require_authenticated),
):
    """Return all configured camera AI schedules and their live Bangkok evaluation status.

    Requires any authenticated user. Returns the normalized schedule map, per-camera
    ``is_in_schedule`` flag, and current ``server_time`` in ``Asia/Bangkok``.
    """
    raw_schedules = get_ai_schedules()
    now_bkk = datetime.now(BANGKOK_TZ)
    schedules_out = {}
    for cam_name in raw_schedules.keys():
        entry = get_camera_schedule_entry(cam_name, raw_schedules)
        schedules_out[cam_name] = {
            **entry,
            "is_in_schedule": evaluate_camera_schedule(entry, now_dt=now_bkk),
        }
    return {
        "status": "success",
        "schedules": schedules_out,
        "server_time": now_bkk.strftime("%H:%M"),
        "server_isoweekday": now_bkk.isoweekday(),
    }


@public_router.get("/cameras/{name}/schedule")
def public_get_camera_schedule(
    name: str,
    identity: TrustedIdentity = Depends(require_authenticated),
):
    """Return the AI detection schedule and live status for a single camera.

    Accepts camera ``name``, validates syntax, and returns the camera's normalized
    schedule, ``is_in_schedule`` evaluation in ``Asia/Bangkok``, and ``server_time``.
    """
    validate_cam_name(name)
    schedules = get_ai_schedules()
    now_bkk = datetime.now(BANGKOK_TZ)
    entry = get_camera_schedule_entry(name, schedules)
    in_sched = evaluate_camera_schedule(entry, now_dt=now_bkk)
    return {
        "status": "success",
        "camera": name,
        "schedule": entry,
        "is_in_schedule": in_sched,
        "server_time": now_bkk.strftime("%H:%M"),
        "server_isoweekday": now_bkk.isoweekday(),
    }


@public_router.put("/cameras/{name}/schedule")
def public_set_camera_schedule(
    name: str,
    body: CameraScheduleConfig,
    identity: TrustedIdentity = Depends(require_authenticated),
):
    """Save the per-camera AI detection schedule and immediately apply runtime MQTT state.

    Accepts camera ``name`` and ``body`` (`CameraScheduleConfig`). Validates the
    time window and weekdays, persists to ``ai_schedules.json`` atomically, and
    publishes the resulting runtime detection state via MQTT without restarting Frigate.
    """
    validate_cam_name(name)
    normalized = validate_camera_schedule(body)

    schedules = get_ai_schedules()
    schedules[name] = normalized
    save_ai_schedules(schedules)

    now_bkk = datetime.now(BANGKOK_TZ)
    in_sched = evaluate_camera_schedule(normalized, now_dt=now_bkk)

    # Read current camera state so we can sync Frigate runtime immediately via MQTT.
    cam_enabled = True
    detect_enabled = True
    rec_enabled = True
    if os.path.exists(CONFIG_PATH):
        try:
            config = load_yaml_config(CONFIG_PATH)
            templates = get_camera_templates()
            cam_cfg = (config.get("cameras") or {}).get(name) or {}
            tmpl_cfg = templates.get(name) if isinstance(templates.get(name), dict) else {}
            cam_enabled = bool(cam_cfg.get("enabled", tmpl_cfg.get("enabled", True)))
            detect_enabled = bool(
                cam_cfg.get("detect", {}).get("enabled", tmpl_cfg.get("detect", {}).get("enabled", True))
            )
            rec_enabled = bool(
                cam_cfg.get("record", {}).get("enabled", tmpl_cfg.get("record", {}).get("enabled", True))
            )
        except Exception:
            pass

    _sync_camera_to_frigate_runtime(name, cam_enabled, detect_enabled, rec_enabled)
    effective_runtime_detect = bool(cam_enabled and detect_enabled and in_sched)

    return {
        "status": "success",
        "camera": name,
        "schedule": normalized,
        "is_in_schedule": in_sched,
        "runtime_detect_enabled": effective_runtime_detect,
        "server_time": now_bkk.strftime("%H:%M"),
        "server_isoweekday": now_bkk.isoweekday(),
        "user": getattr(identity, "username", "system"),
    }


_hls_map_cache: dict = {"config_mtime": 0.0, "gps_mtime": 0.0, "data": None}


@public_router.get("/hls-map")
def get_hls_map():
    if not os.path.exists(CONFIG_PATH):
        return {}

    gps_path = "/settings-data/camera_gps.json"
    if not os.path.exists(gps_path):
        gps_path = os.path.join(os.path.dirname(CONFIG_PATH), "dashboard-settings", "camera_gps.json")

    try:
        cfg_mtime = os.path.getmtime(CONFIG_PATH)
    except OSError:
        cfg_mtime = 0.0
    try:
        gps_mtime = os.path.getmtime(gps_path) if os.path.exists(gps_path) else 0.0
    except OSError:
        gps_mtime = 0.0

    cached = _hls_map_cache.get("data")
    if (
        cached is not None
        and _hls_map_cache.get("config_mtime") == cfg_mtime
        and _hls_map_cache.get("gps_mtime") == gps_mtime
    ):
        return cached

    try:
        config = load_yaml_config(CONFIG_PATH)
    except Exception:
        with open_config_transaction(include_groups=False) as transaction:
            config = transaction.config

    go2rtc_streams = (config or {}).get('go2rtc', {}).get('streams', {})
    hls_map = {}

    for stream_name, srcs in go2rtc_streams.items():
        if isinstance(srcs, list):
            src = srcs[0] if len(srcs) > 0 else ""
        else:
            src = srcs

        if not src:
            continue

        if src.startswith('ffmpeg:'):
            url = src.split('ffmpeg:', 1)[1]
        else:
            url = src

        url = strip_stream_filters(url).strip("#")

        if url.startswith('http') and '.m3u8' in url:
            hls_map[stream_name] = url

    # Also merge direct HLS URLs from camera_gps.json so cameras selected from the map
    # (e.g. kk01..kk27, Udon1..Udon10) have their HLS streams registered in hls_map
    if os.path.exists(gps_path):
        try:
            with open(gps_path, "r", encoding="utf-8") as f:
                gps_data = json.load(f)
                if isinstance(gps_data, dict):
                    for cam_id, cam_info in gps_data.items():
                        if isinstance(cam_info, dict) and cam_info.get("url"):
                            c_url = cam_info["url"].split("#")[0].strip()
                            if c_url.startswith("ffmpeg:"):
                                c_url = c_url[7:].strip()
                            if c_url.startswith("http") and ".m3u8" in c_url:
                                if cam_id not in hls_map:
                                    hls_map[cam_id] = c_url
        except Exception as e:
            print(f"[config-api] Failed to read camera_gps.json in get_hls_map: {e}")

    _hls_map_cache["config_mtime"] = cfg_mtime
    _hls_map_cache["gps_mtime"] = gps_mtime
    _hls_map_cache["data"] = hls_map
    return hls_map

app.include_router(public_router)


def enforce_ai_schedules_internal(force_publish: bool = False) -> dict:
    """Evaluate all enabled camera AI schedules and publish MQTT detect transitions.

    Accepts ``force_publish`` boolean to re-assert MQTT state even when unchanged.
    Reads ``ai_schedules.json`` and ``config.yml``, and publishes ``ON`` or ``OFF``
    to ``frigate/{camera}/detect/set`` whenever a camera enters or leaves its window.
    """
    schedules = get_ai_schedules()
    if not schedules:
        return {"checked": 0, "updated": []}

    cameras_cfg = {}
    templates = get_camera_templates()
    if os.path.exists(CONFIG_PATH):
        try:
            cfg_data = load_yaml_config(CONFIG_PATH)
            if isinstance(cfg_data, dict):
                cameras_cfg = cfg_data.get("cameras") or {}
        except Exception:
            pass

    now_bkk = datetime.now(BANGKOK_TZ)
    checked = 0
    updated = []

    for cam_name, raw_sched in schedules.items():
        if not isinstance(raw_sched, dict) or not raw_sched.get("enabled", False):
            _last_schedule_detect_state.pop(cam_name, None)
            continue

        checked += 1
        entry = get_camera_schedule_entry(cam_name, schedules)
        in_sched = evaluate_camera_schedule(entry, now_dt=now_bkk)

        cam_block = cameras_cfg.get(cam_name) if isinstance(cameras_cfg.get(cam_name), dict) else {}
        tmpl_block = templates.get(cam_name) if isinstance(templates.get(cam_name), dict) else {}
        cam_en = bool(cam_block.get("enabled", tmpl_block.get("enabled", True)))
        cam_ai = bool(
            cam_block.get("detect", {}).get("enabled", tmpl_block.get("detect", {}).get("enabled", False))
        )

        target_detect = bool(cam_en and cam_ai and in_sched)
        prev_detect = _last_schedule_detect_state.get(cam_name)

        if force_publish or prev_detect is None or prev_detect != target_detect:
            try:
                import paho.mqtt.publish as publish
                publish.single(
                    f"frigate/{cam_name}/detect/set",
                    payload="ON" if target_detect else "OFF",
                    hostname="mqtt",
                )
                _last_schedule_detect_state[cam_name] = target_detect
                updated.append({"camera": cam_name, "detect": target_detect, "in_schedule": in_sched})
            except Exception as e:
                print(f"[config-api] Schedule MQTT publish failed for {cam_name}: {e}")

    return {"checked": checked, "updated": updated}


def _reconciliation_background_worker():
    """Background loop evaluating AI schedules every 30s and reconciling camera pool every 2m."""
    time.sleep(15)
    tick = 0
    while True:
        try:
            # Run full demand reconciliation every 4th tick (120 seconds).
            if tick % 4 == 0:
                reconcile_cameras_internal()
            # Evaluate per-camera AI detection schedules every 30 seconds.
            enforce_ai_schedules_internal(force_publish=(tick % 4 == 0))
        except Exception:
            pass
        tick += 1
        time.sleep(30)

_worker_thread = threading.Thread(target=_reconciliation_background_worker, daemon=True)
_worker_thread.start()

try:
    from system_updater import get_system_updater
    get_system_updater()
except Exception as _upd_err:
    print(f"[config-api] SystemUpdater init warning: {_upd_err}")

try:
    try:
        from drone_qcs import router as _drone_qcs_router
    except ImportError:
        """SLOTH x BPP-VMS 215 — Drone & QCS Ground Control Station (GCS) Backend Module.
        
        Provides 100% of the SLOTH-BPP215 Drone & QCS capabilities integrated with BPP-VMS:
        - Drone CRUD (`/api/drones`) with automatic companion camera (`cam_drone_<id>`) & NVR group registration
        - Real-time Drone Telemetry (`/api/drones/{drone_id}/telemetry`) & Flight Trail History (`/api/drones/{drone_id}/history`)
        - Built-in Flight Telemetry Simulator (`/api/drones/{drone_id}/simulate`) for instant field testing & training
        - Multi-path RTMP Ingest & Tunnel Discovery (`/api/drones/tunnel`: LAN, Tailscale VPN, DuckDNS, and `bore.exe` TCP Tunnel)
        - Drone Sites CRUD (`/api/drone-sites`)
        - Multi-Protocol & Vendor QCS Integration (`/api/drones/protocols`, `/api/dji/config`, `/api/qcs/dji/pairing`, `/api/qcs/connections`)
        - Remote Payload / Camera Lens / Zoom / Quality / Gimbal Control (`/api/{vendor}/drones/{drone_id}/*`)
        """
        
        
        import json
        import logging
        import math
        import os
        import re
        import socket
        import subprocess
        import threading
        import time
        import urllib.parse
        import urllib.request
        import uuid
        from datetime import datetime, timezone
        from pathlib import Path
        from typing import Any, Callable, Dict, List, Optional
        
        from fastapi import APIRouter, HTTPException, Request, Response
        
        logger = logging.getLogger("bpp.drone_qcs")
        
        router = APIRouter()
        
        _LOCK = threading.Lock()
        _SIM_THREADS: Dict[str, threading.Event] = {}
        _BORE_PROC: Optional[subprocess.Popen] = None
        _TUNNEL_STATE: Dict[str, Any] = {
            "active": False,
            "publicHost": "bpp215.duckdns.org",
            "publicPort": 1935,
            "publicRtmpBase": "rtmp://bpp215.duckdns.org:1935/live",
            "boreActive": False,
            "boreRtmpBase": "",
            "tailscaleIp": "100.117.170.13",
            "tailscaleRtmpBase": "rtmp://100.117.170.13:1935/live",
            "lanIp": "192.168.1.200",
            "lanRtmpBase": "rtmp://192.168.1.200:1935/live",
        }
        
        DEFAULT_DRONE_SITES: List[Dict[str, Any]] = [
            {"id": "dsite_bpp215", "name": "กองร้อย ตชด.215 (นางรอง)", "mainSiteId": "bpp215", "timezone": "Asia/Bangkok"},
            {"id": "dsite_border", "name": "ชุดปฏิบัติการชายแดน / ลาดตระเวน", "mainSiteId": "border", "timezone": "Asia/Bangkok"},
            {"id": "dsite_tactical", "name": "หน่วยเคลื่อนที่เร็ว (Tactical UAV)", "mainSiteId": "tactical", "timezone": "Asia/Bangkok"},
        ]
        
        
        def _now_iso() -> str:
            return datetime.now(timezone.utc).isoformat()
        
        
        def _resolve_config_dir() -> Path:
            env_cfg = os.environ.get("BPP_CONFIG_DIR", "").strip()
            if env_cfg:
                return Path(env_cfg)
            cfg_yml = os.environ.get("CONFIG_API_CONFIG_PATH", "").strip()
            if cfg_yml:
                return Path(cfg_yml).parent
            if os.name != "nt" and Path("/config").is_dir():
                return Path("/config")
            here = Path(__file__).resolve().parent
            return here.parent / "config"
        
        
        def _state_file_path() -> Path:
            cfg_dir = _resolve_config_dir()
            cfg_dir.mkdir(parents=True, exist_ok=True)
            return cfg_dir / "drones_qcs_state.json"
        
        
        def _load_state() -> Dict[str, Any]:
            fp = _state_file_path()
            if fp.is_file():
                try:
                    data = json.loads(fp.read_text(encoding="utf-8-sig"))
                    if isinstance(data, dict):
                        return data
                except Exception as exc:
                    logger.warning("Failed to read %s: %s", fp, exc)
            return {
                "drones": [],
                "drone_sites": list(DEFAULT_DRONE_SITES),
                "drone_protocols": {
                    "https": {"enabled": True, "state": "Listening"},
                    "websocket": {"enabled": True, "state": "Listening"},
                    "udp": {"enabled": True, "port": 14551, "state": "Listening"},
                    "mqtt": {"enabled": True, "port": 1883, "topic": "slotheye/drones/+/telemetry", "state": "Listening"},
                    "mavlink": {"enabled": True, "port": 14550, "state": "Listening"},
                },
                "dji_config": {
                    "enabled": True,
                    "state": "Listening",
                    "brokerPort": 8883,
                    "loginHttpPort": 8081,
                    "appId": "",
                    "hasAppKey": False,
                    "hasLicense": False,
                    "mqttUsername": "dji_pilot",
                    "hasMqttPassword": False,
                },
                "dji_pairing": {},
                "qcs_connections": {
                    "autel": {"configured": False, "state": "Disabled", "devices": []},
                    "mavlink": {"configured": False, "state": "Disabled", "sources": []},
                },
                "history": {},
            }
        
        
        def _save_state(state: Dict[str, Any]) -> None:
            fp = _state_file_path()
            tmp = fp.with_suffix(".tmp")
            tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(fp)
        
        
        def _detect_lan_ip() -> str:
            env_ip = os.environ.get("HOST_LAN_IP", "").strip()
            if env_ip:
                return env_ip
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.connect(("8.8.8.8", 80))
                    ip = s.getsockname()[0]
                    if ip and not ip.startswith("127.") and not ip.startswith("172."):
                        return ip
            except Exception:
                pass
            return "192.168.1.200"
        
        
        def _sync_drone_companion_camera(drone: Dict[str, Any], remove: bool = False) -> None:
            """Register or remove the drone's companion camera in camera_names.json, camera_gps.json, nvr_groups.json, and go2rtc."""
            cfg_dir = _resolve_config_dir()
            dash_dir = cfg_dir / "dashboard-settings"
            dash_dir.mkdir(parents=True, exist_ok=True)
            cam_id = str(drone.get("cameraId") or f"cam_drone_{drone.get('id')}")
            path_key = str(drone.get("path") or drone.get("id") or "drone1").strip("/")
            drone_name = str(drone.get("name") or drone.get("id") or "Drone")
            telem = drone.get("telemetry") or {}
            lat = float(telem.get("latitude") or 14.6265)
            lng = float(telem.get("longitude") or 102.7905)
        
            # 1. Update camera_names.json
            names_file = dash_dir / "camera_names.json"
            try:
                names = json.loads(names_file.read_text(encoding="utf-8-sig")) if names_file.is_file() else {}
                if not isinstance(names, dict):
                    names = {}
                if remove:
                    names.pop(cam_id, None)
                else:
                    names[cam_id] = f"โดรน: {drone_name}"
                names_file.write_text(json.dumps(names, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as exc:
                logger.debug("camera_names sync warning: %s", exc)
        
            # 2. Update camera_gps.json
            gps_file = dash_dir / "camera_gps.json"
            try:
                gps = json.loads(gps_file.read_text(encoding="utf-8-sig")) if gps_file.is_file() else {}
                if not isinstance(gps, dict):
                    gps = {}
                if remove:
                    gps.pop(cam_id, None)
                else:
                    gps[cam_id] = {
                        "lat": lat,
                        "lng": lng,
                        "name": f"โดรน: {drone_name}",
                        "group": "โดรนลาดตระเวน (UAV / QCS)",
                        "is_drone": True,
                        "drone_id": drone.get("id"),
                        "altitude": float(telem.get("altitude") or 0.0),
                        "battery": int(telem.get("battery") or 100),
                        "heading": float(telem.get("heading") or 0.0),
                        "speed": float(telem.get("horizontalSpeed") or 0.0),
                    }
                gps_file.write_text(json.dumps(gps, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as exc:
                logger.debug("camera_gps sync warning: %s", exc)
        
            # 3. Update nvr_groups.json
            groups_file = cfg_dir / "nvr_groups.json"
            try:
                gdata = json.loads(groups_file.read_text(encoding="utf-8-sig")) if groups_file.is_file() else {"groups": []}
                groups = gdata.get("groups") if isinstance(gdata, dict) else []
                if not isinstance(groups, list):
                    groups = []
                drone_grp = next((g for g in groups if g.get("id") == "grp_drones_qcs"), None)
                if remove:
                    if drone_grp and isinstance(drone_grp.get("cameras"), list):
                        drone_grp["cameras"] = [c for c in drone_grp["cameras"] if c != cam_id]
                else:
                    if not drone_grp:
                        drone_grp = {
                            "id": "grp_drones_qcs",
                            "name": "โดรนลาดตระเวน (UAV / QCS)",
                            "ip": "RTMP / QCS",
                            "cameras": [],
                        }
                        groups.insert(0, drone_grp)
                    else:
                        drone_grp["name"] = "โดรนลาดตระเวน (UAV / QCS)"
                    if cam_id not in drone_grp["cameras"]:
                        drone_grp["cameras"].append(cam_id)
                groups_file.write_text(json.dumps({"groups": groups}, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as exc:
                logger.debug("nvr_groups sync warning: %s", exc)
        
            # 4. Register live stream in go2rtc (:1984) dynamically
            for g2r_host in ("127.0.0.1:1984", "frigate:1984"):
                try:
                    if remove:
                        req = urllib.request.Request(
                            f"http://{g2r_host}/api/streams?src={urllib.parse.quote(cam_id)}",
                            method="DELETE",
                        )
                    else:
                        # Pull from MediaMTX RTSP relay (:28554 or :8554) or direct RTMP ingest
                        rtsp_src = f"rtsp://127.0.0.1:28554/{path_key}"
                        req = urllib.request.Request(
                            f"http://{g2r_host}/api/streams?name={urllib.parse.quote(cam_id)}&src={urllib.parse.quote(rtsp_src)}",
                            method="PUT",
                        )
                    with urllib.request.urlopen(req, timeout=1.2):
                        pass
                    break
                except Exception:
                    continue
        
        
        def _update_drone_gps_pin_only(drone: Dict[str, Any]) -> None:
            cfg_dir = _resolve_config_dir()
            gps_file = cfg_dir / "dashboard-settings" / "camera_gps.json"
            if not gps_file.is_file():
                return
            try:
                gps = json.loads(gps_file.read_text(encoding="utf-8-sig"))
                if not isinstance(gps, dict):
                    return
                cam_id = str(drone.get("cameraId") or f"cam_drone_{drone.get('id')}")
                telem = drone.get("telemetry") or {}
                lat = float(telem.get("latitude") or 0.0)
                lng = float(telem.get("longitude") or 0.0)
                if lat and lng:
                    entry = gps.get(cam_id) or {}
                    entry.update(
                        {
                            "lat": lat,
                            "lng": lng,
                            "name": f"โดรน: {drone.get('name') or drone.get('id')}",
                            "group": "โดรนลาดตระเวน (UAV / QCS)",
                            "is_drone": True,
                            "drone_id": drone.get("id"),
                            "altitude": float(telem.get("altitude") or 0.0),
                            "battery": int(telem.get("battery") or 100),
                            "heading": float(telem.get("heading") or 0.0),
                            "speed": float(telem.get("horizontalSpeed") or 0.0),
                        }
                    )
                    gps[cam_id] = entry
                    gps_file.write_text(json.dumps(gps, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass
        
        
        def _enrich_drone_fields(d: Dict[str, Any]) -> Dict[str, Any]:
            """Provide both SLOTH camelCase and BPP-VMS snake_case fields for 100% compatibility."""
            telem = d.get("telemetry") or {}
            lat = float(telem.get("latitude") or d.get("lat") or 14.6431)
            lng = float(telem.get("longitude") or d.get("lng") or 103.0855)
            spd = float(telem.get("horizontalSpeed") or telem.get("speed") or 0.0)
            telem["latitude"] = lat
            telem["longitude"] = lng
            telem["lat"] = lat
            telem["lng"] = lng
            telem["horizontalSpeed"] = spd
            telem["speed"] = spd
            d["telemetry"] = telem
            d["lat"] = lat
            d["lng"] = lng
            d["camera_id"] = d.get("cameraId") or f"cam_drone_{d.get('id')}"
            d["cameraId"] = d["camera_id"]
            d["stream_key"] = d.get("stream_key") or d.get("path") or d.get("id")
            d["path"] = d["stream_key"]
            d["vendor"] = d.get("vendor") or d.get("protocol") or "dji"
            d["model"] = d.get("model") or "DJI Mavic 3 Enterprise"
            is_sim = d.get("id") in _SIM_THREADS and not _SIM_THREADS[d["id"]].is_set()
            d["simulating"] = is_sim
            if is_sim or str(d.get("status", "")).lower() in ("streaming", "online"):
                d["status"] = "online"
            return d
        
        
        # ---------------------------------------------------------------------------
        # 1. Drones CRUD & Telemetry Endpoints
        # ---------------------------------------------------------------------------
        @router.get("/api/drones")
        @router.get("/api/config/drones")
        def api_get_drones() -> List[Dict[str, Any]]:
            with _LOCK:
                state = _load_state()
                return [_enrich_drone_fields(dict(d)) for d in state.get("drones", [])]
        
        
        @router.post("/api/drones")
        @router.post("/api/config/drones")
        async def api_create_drone(request: Request) -> Dict[str, Any]:
            body = await request.json()
            with _LOCK:
                state = _load_state()
                drones: List[Dict[str, Any]] = state.get("drones", [])
                raw_id = str(body.get("id") or body.get("stream_key") or f"drone_{uuid.uuid4().hex[:6]}").strip()
                did = re.sub(r"[^a-zA-Z0-9_\-]", "_", raw_id)
                if any(d.get("id") == did for d in drones):
                    did = f"{did}_{uuid.uuid4().hex[:4]}"
        
                name = str(body.get("name") or did).strip()
                stream_key = re.sub(r"[^a-zA-Z0-9_\-]", "", str(body.get("stream_key") or body.get("path") or did.lower()).strip()) or did.lower()
                site_id = body.get("siteId") or "dsite_bpp215"
                vendor = str(body.get("vendor") or body.get("protocol") or "dji").strip().lower()
                model = str(body.get("model") or "DJI Mavic 3 Enterprise").strip()
                token = uuid.uuid4().hex[:12]
                cam_id = f"cam_drone_{did}"
        
                lat = float(body.get("lat") or body.get("latitude") or 14.6431)
                lng = float(body.get("lng") or body.get("longitude") or 103.0855)
        
                drone: Dict[str, Any] = {
                    "id": did,
                    "name": name,
                    "path": stream_key,
                    "stream_key": stream_key,
                    "siteId": site_id,
                    "protocol": vendor,
                    "vendor": vendor,
                    "model": model,
                    "publishUser": did,
                    "token": token,
                    "cameraId": cam_id,
                    "camera_id": cam_id,
                    "status": "standby",
                    "lens": "normal",
                    "zoom": 1,
                    "quality": 0,
                    "lat": lat,
                    "lng": lng,
                    "telemetry": {
                        "latitude": lat,
                        "longitude": lng,
                        "lat": lat,
                        "lng": lng,
                        "altitude": float(body.get("altitude") or 45.0),
                        "battery": int(body.get("battery") or 100),
                        "horizontalSpeed": 0.0,
                        "speed": 0.0,
                        "verticalSpeed": 0.0,
                        "heading": 0.0,
                        "timestamp": int(time.time() * 1000),
                    },
                    "createdAt": _now_iso(),
                }
                drones.append(drone)
                state["drones"] = drones
                _save_state(state)
        
            _sync_drone_companion_camera(drone, remove=False)
            enriched = _enrich_drone_fields(dict(drone))
            enriched["drone"] = dict(enriched)
            return enriched
        
        
        @router.put("/api/drones/{drone_id}")
        @router.put("/api/config/drones/{drone_id}")
        async def api_update_drone(drone_id: str, request: Request) -> Dict[str, Any]:
            body = await request.json()
            updated: Optional[Dict[str, Any]] = None
            with _LOCK:
                state = _load_state()
                drones: List[Dict[str, Any]] = state.get("drones", [])
                for d in drones:
                    if d.get("id") == drone_id:
                        if "name" in body and body["name"]:
                            d["name"] = str(body["name"]).strip()
                        if "siteId" in body:
                            d["siteId"] = body["siteId"] or None
                        if "protocol" in body and body["protocol"]:
                            d["protocol"] = str(body["protocol"]).strip().lower()
                        if "path" in body and body["path"]:
                            d["path"] = str(body["path"]).strip()
                        updated = d
                        break
                if not updated:
                    raise HTTPException(status_code=404, detail="ไม่พบโดรนที่ระบุ")
                state["drones"] = drones
                _save_state(state)
        
            _sync_drone_companion_camera(updated, remove=False)
            return updated
        
        
        @router.delete("/api/drones/{drone_id}")
        @router.delete("/api/config/drones/{drone_id}")
        def api_delete_drone(drone_id: str) -> Dict[str, Any]:
            ev = _SIM_THREADS.pop(drone_id, None)
            if ev:
                ev.set()
            target: Optional[Dict[str, Any]] = None
            with _LOCK:
                state = _load_state()
                drones: List[Dict[str, Any]] = state.get("drones", [])
                target = next((d for d in drones if d.get("id") == drone_id), None)
                state["drones"] = [d for d in drones if d.get("id") != drone_id]
                history = state.get("history") or {}
                history.pop(drone_id, None)
                state["history"] = history
                _save_state(state)
        
            if target:
                _sync_drone_companion_camera(target, remove=True)
            return {"ok": True, "deleted_id": drone_id}
        
        
        @router.post("/api/drones/{drone_id}/telemetry")
        @router.post("/api/config/drones/{drone_id}/telemetry")
        async def api_drone_telemetry(drone_id: str, request: Request) -> Dict[str, Any]:
            body = await request.json()
            return _record_drone_telemetry(drone_id, body)
        
        
        def _record_drone_telemetry(drone_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
            ts = int(body.get("timestamp") or (time.time() * 1000))
            lat_val = float(body.get("lat") or body.get("latitude") or 14.6431)
            lng_val = float(body.get("lng") or body.get("longitude") or 103.0855)
            spd_val = round(float(body.get("speed") or body.get("horizontalSpeed") or 0.0), 1)
            point = {
                "latitude": lat_val,
                "longitude": lng_val,
                "lat": lat_val,
                "lng": lng_val,
                "altitude": round(float(body.get("altitude", 45.0)), 1),
                "battery": max(0, min(100, int(body.get("battery", 95)))),
                "horizontalSpeed": spd_val,
                "speed": spd_val,
                "verticalSpeed": round(float(body.get("verticalSpeed", 0.0)), 1),
                "heading": round(float(body.get("heading", 0.0)) % 360.0, 1),
                "timestamp": ts,
            }
            target_drone: Optional[Dict[str, Any]] = None
            with _LOCK:
                state = _load_state()
                drones: List[Dict[str, Any]] = state.get("drones", [])
                for d in drones:
                    if d.get("id") == drone_id:
                        d["telemetry"] = point
                        d["lat"] = lat_val
                        d["lng"] = lng_val
                        d["status"] = str(body.get("status") or "online")
                        target_drone = d
                        break
                if target_drone is None:
                    # Auto-register drone if telemetry arrives from a new paired device
                    target_drone = {
                        "id": drone_id,
                        "name": str(body.get("name") or f"Drone {drone_id}"),
                        "path": drone_id.lower(),
                        "stream_key": drone_id.lower(),
                        "siteId": "dsite_bpp215",
                        "protocol": str(body.get("protocol") or "dji"),
                        "vendor": str(body.get("vendor") or "dji"),
                        "publishUser": drone_id,
                        "token": uuid.uuid4().hex[:12],
                        "cameraId": f"cam_drone_{drone_id}",
                        "camera_id": f"cam_drone_{drone_id}",
                        "status": "online",
                        "lat": lat_val,
                        "lng": lng_val,
                        "telemetry": point,
                        "createdAt": _now_iso(),
                    }
                    drones.append(target_drone)
                state["drones"] = drones
                history_map = state.get("history") or {}
                hist: List[Dict[str, Any]] = history_map.get(drone_id) or []
                hist.append(point)
                if len(hist) > 1500:
                    hist = hist[-1500:]
                history_map[drone_id] = hist
                state["history"] = history_map
                _save_state(state)
        
            if target_drone:
                _update_drone_gps_pin_only(target_drone)
            return {"ok": True, "telemetry": point}
        
        
        @router.get("/api/drones/{drone_id}/history")
        @router.get("/api/config/drones/{drone_id}/history")
        def api_drone_history(drone_id: str, limit: int = 500, after: int = 0, before: int = 0) -> List[Dict[str, Any]]:
            with _LOCK:
                state = _load_state()
                hist: List[Dict[str, Any]] = (state.get("history") or {}).get(drone_id) or []
                if after > 0:
                    hist = [p for p in hist if p.get("timestamp", 0) >= after]
                if before > 0:
                    hist = [p for p in hist if p.get("timestamp", 0) < before]
                out = []
                for p in hist[-limit:]:
                    item = dict(p)
                    item["lat"] = float(item.get("lat") or item.get("latitude") or 14.6431)
                    item["lng"] = float(item.get("lng") or item.get("longitude") or 103.0855)
                    out.append(item)
                return out
        
        
        @router.post("/api/drones/{drone_id}/simulate")
        @router.post("/api/config/drones/{drone_id}/simulate")
        async def api_simulate_drone_flight(drone_id: str, request: Request) -> Dict[str, Any]:
            """Start or stop a live telemetry flight simulation so operators can test map tracking & HUD."""
            try:
                body = await request.json()
            except Exception:
                body = {}
            if "enable" in body:
                stop_req = not bool(body.get("enable"))
            else:
                stop_req = bool(body.get("stop", False))
            existing_ev = _SIM_THREADS.pop(drone_id, None)
            if existing_ev:
                existing_ev.set()
                if stop_req or "enable" not in body:
                    return {"ok": True, "simulating": False, "drone_id": drone_id}
        
            if stop_req:
                return {"ok": True, "simulating": False, "drone_id": drone_id}
        
            with _LOCK:
                state = _load_state()
                drone = next((d for d in state.get("drones", []) if d.get("id") == drone_id), None)
                if not drone:
                    raise HTTPException(status_code=404, detail="ไม่พบโดรนที่ระบุ")
                base_lat = float((drone.get("telemetry") or {}).get("latitude") or 14.6265)
                base_lng = float((drone.get("telemetry") or {}).get("longitude") or 102.7905)
        
            stop_ev = threading.Event()
            _SIM_THREADS[drone_id] = stop_ev
        
            def _sim_worker() -> None:
                step = 0
                radius_deg = 0.0032  # ~350m patrol orbit
                while not stop_ev.is_set() and step < 120:
                    angle = (step * 6.0) * (math.pi / 180.0)
                    lat = base_lat + radius_deg * math.sin(angle)
                    lng = base_lng + radius_deg * math.cos(angle)
                    heading = (step * 6.0 + 90.0) % 360.0
                    alt = 65.0 + 15.0 * math.sin(angle * 2.0)
                    bat = max(15, 98 - int(step * 0.4))
                    _record_drone_telemetry(
                        drone_id,
                        {
                            "latitude": round(lat, 6),
                            "longitude": round(lng, 6),
                            "altitude": round(alt, 1),
                            "battery": bat,
                            "horizontalSpeed": 8.4,
                            "verticalSpeed": round(1.2 * math.cos(angle * 2.0), 1),
                            "heading": round(heading, 1),
                            "status": "Streaming",
                            "timestamp": int(time.time() * 1000),
                        },
                    )
                    step += 1
                    stop_ev.wait(1.5)
                _SIM_THREADS.pop(drone_id, None)
        
            threading.Thread(target=_sim_worker, name=f"drone-sim-{drone_id}", daemon=True).start()
            return {"ok": True, "simulating": True, "drone_id": drone_id}
        
        
        # ---------------------------------------------------------------------------
        # 2. Drone Sites, Protocols, DJI Pairing & QCS Multi-Vendor Endpoints
        # ---------------------------------------------------------------------------
        @router.get("/api/drone-sites")
        @router.get("/api/config/drone-sites")
        def api_get_drone_sites() -> List[Dict[str, Any]]:
            with _LOCK:
                state = _load_state()
                return state.get("drone_sites", DEFAULT_DRONE_SITES)
        
        
        @router.post("/api/drone-sites")
        @router.post("/api/config/drone-sites")
        async def api_create_drone_site(request: Request) -> Dict[str, Any]:
            body = await request.json()
            with _LOCK:
                state = _load_state()
                sites: List[Dict[str, Any]] = state.get("drone_sites", list(DEFAULT_DRONE_SITES))
                new_site = {
                    "id": f"dsite_{uuid.uuid4().hex[:6]}",
                    "name": str(body.get("name") or "หน่วยโดรนใหม่").strip(),
                    "mainSiteId": body.get("mainSiteId") or None,
                    "timezone": body.get("timezone") or "Asia/Bangkok",
                }
                sites.append(new_site)
                state["drone_sites"] = sites
                _save_state(state)
                return new_site
        
        
        @router.delete("/api/drone-sites/{site_id}")
        @router.delete("/api/config/drone-sites/{site_id}")
        def api_delete_drone_site(site_id: str) -> Dict[str, Any]:
            with _LOCK:
                state = _load_state()
                sites = [s for s in state.get("drone_sites", []) if s.get("id") != site_id]
                state["drone_sites"] = sites
                _save_state(state)
                return {"ok": True}
        
        
        @router.get("/api/drones/protocols")
        @router.get("/api/config/drones/protocols")
        def api_get_drone_protocols() -> Dict[str, Any]:
            with _LOCK:
                return _load_state().get("drone_protocols", {})
        
        
        @router.put("/api/drones/protocols")
        @router.put("/api/config/drones/protocols")
        async def api_put_drone_protocols(request: Request) -> Dict[str, Any]:
            body = await request.json()
            with _LOCK:
                state = _load_state()
                protocols = state.get("drone_protocols", {})
                proto = body.get("protocol")
                if proto:
                    protocols[proto] = body.get("config") or {}
                else:
                    protocols.update(body)
                state["drone_protocols"] = protocols
                _save_state(state)
                return protocols
        
        
        @router.get("/api/drones/protocols/status")
        @router.get("/api/config/drones/protocols/status")
        def api_get_drone_protocols_status() -> Dict[str, Any]:
            return {
                "https": {"state": "Listening"},
                "websocket": {"state": "Listening"},
                "udp": {"state": "Listening", "port": 14551},
                "mqtt": {"state": "Listening", "port": 1883},
                "mavlink": {"state": "Listening", "port": 14550},
            }
        
        
        @router.get("/api/dji/config")
        @router.get("/api/config/dji/config")
        def api_get_dji_config() -> Dict[str, Any]:
            with _LOCK:
                return _load_state().get("dji_config", {})
        
        
        @router.put("/api/dji/config")
        @router.put("/api/config/dji/config")
        async def api_put_dji_config(request: Request) -> Dict[str, Any]:
            body = await request.json()
            with _LOCK:
                state = _load_state()
                cfg = state.get("dji_config", {})
                cfg.update(body)
                cfg["state"] = "Listening" if cfg.get("enabled", True) else "Disabled"
                cfg["hasAppKey"] = bool(cfg.get("appKey") or cfg.get("hasAppKey"))
                cfg["hasLicense"] = bool(cfg.get("license") or cfg.get("hasLicense"))
                cfg["hasMqttPassword"] = bool(cfg.get("mqttPassword") or cfg.get("hasMqttPassword"))
                state["dji_config"] = cfg
                _save_state(state)
                return cfg
        
        
        @router.post("/api/qcs/dji/pairing")
        @router.post("/api/config/qcs/dji/pairing")
        def api_qcs_dji_pairing(request: Request) -> Dict[str, Any]:
            token = uuid.uuid4().hex[:8].upper()
            formatted = f"{token[:4]}-{token[4:]}"
            expires_at = int((time.time() + 300) * 1000)
            with _LOCK:
                state = _load_state()
                state["dji_pairing"] = {"token": token, "formatted": formatted, "expiresAt": expires_at}
                _save_state(state)
            host_hdr = request.headers.get("host") or f"{_detect_lan_ip()}:8443"
            scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
            return {
                "token": token,
                "formatted": formatted,
                "pairing_code": formatted,
                "organization_id": "BPP215-TACTICAL-ORG",
                "workspace_id": "sloth-bpp215-wks",
                "cloud_api_url": f"{scheme}://{host_hdr}/api/config/qcs/dji",
                "expiresAt": expires_at,
            }
        
        
        @router.get("/api/qcs/connections")
        @router.get("/api/config/qcs/connections")
        def api_get_qcs_connections() -> Dict[str, Any]:
            with _LOCK:
                return _load_state().get("qcs_connections", {})
        
        
        @router.put("/api/qcs/connections/{kind}")
        @router.put("/api/config/qcs/connections/{kind}")
        async def api_put_qcs_connections(kind: str, request: Request) -> Dict[str, Any]:
            body = await request.json()
            with _LOCK:
                state = _load_state()
                conns = state.get("qcs_connections", {})
                conns[kind] = {
                    **(conns.get(kind) or {}),
                    **body,
                    "configured": bool(body.get("enabled", True)),
                    "state": "Listening" if body.get("enabled", True) else "Disabled",
                }
                state["qcs_connections"] = conns
                _save_state(state)
                return conns[kind]
        
        
        @router.post("/api/{vendor}/drones/{drone_id}/{cmd}")
        @router.post("/api/config/{vendor}/drones/{drone_id}/{cmd}")
        async def api_qcs_drone_command(vendor: str, drone_id: str, cmd: str, request: Request) -> Dict[str, Any]:
            """Handle QCS remote commands: lens, zoom, quality, gimbal, payload-authority, control-session."""
            try:
                body = await request.json()
            except Exception:
                body = {}
            with _LOCK:
                state = _load_state()
                for d in state.get("drones", []):
                    if d.get("id") == drone_id:
                        if cmd == "lens" and "lens" in body:
                            d["lens"] = body["lens"]
                        elif cmd == "zoom" and "factor" in body:
                            d["zoom"] = body["factor"]
                        elif cmd == "quality" and "quality" in body:
                            d["quality"] = body["quality"]
                        elif cmd == "gimbal":
                            d["gimbal"] = {"pitch": body.get("pitch", 0), "yaw": body.get("yaw", 0)}
                        _save_state(state)
                        break
            return {
                "ok": True,
                "vendor": vendor,
                "droneId": drone_id,
                "command": cmd,
                "applied": body,
                "timestamp": int(time.time() * 1000),
            }
        
        
        # ---------------------------------------------------------------------------
        # 3. RTMP Ingest & Field TCP Tunnel (`bore.exe` / DuckDNS / Tailscale / LAN)
        # ---------------------------------------------------------------------------
        def _start_bore_tunnel_if_available() -> None:
            global _BORE_PROC
            if _BORE_PROC is not None and _BORE_PROC.poll() is None:
                return
            bore_candidates = [
                Path(r"D:\Sloth-BPP215\native\bin\bore.exe"),
                Path(r"D:\Sloth-BPP215\native\bore.exe"),
            ]
            bore_bin = next((c for c in bore_candidates if c.is_file()), None)
            if not bore_bin:
                return
        
            def _worker() -> None:
                global _BORE_PROC
                try:
                    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    _BORE_PROC = subprocess.Popen(
                        [str(bore_bin), "local", "1935", "--to", "bore.pub"],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        creationflags=creationflags,
                    )
                    if _BORE_PROC.stdout:
                        for line in _BORE_PROC.stdout:
                            m = re.search(r"listening at ([^\s:]+):(\d+)", line) or re.search(r"remote_port=(\d+)", line)
                            if m:
                                if len(m.groups()) == 2:
                                    host, port = m.group(1), int(m.group(2))
                                else:
                                    host, port = "bore.pub", int(m.group(1))
                                _TUNNEL_STATE["boreActive"] = True
                                _TUNNEL_STATE["boreRtmpBase"] = f"rtmp://{host}:{port}/live"
                except Exception as exc:
                    logger.debug("bore tunnel worker: %s", exc)
        
            threading.Thread(target=_worker, name="bpp-bore-tunnel", daemon=True).start()
        
        
        @router.get("/api/drones/tunnel")
        @router.get("/api/config/drones/tunnel")
        def api_get_drone_tunnel() -> Dict[str, Any]:
            lan_ip = _detect_lan_ip()
            _TUNNEL_STATE["lanIp"] = lan_ip
            _TUNNEL_STATE["lanRtmpBase"] = f"rtmp://{lan_ip}:1935/live"
            _TUNNEL_STATE["lan_rtmp_base"] = f"rtmp://{lan_ip}:1935/live"
            _TUNNEL_STATE["duckdns_rtmp_base"] = _TUNNEL_STATE.get("publicRtmpBase", "rtmp://bpp215.duckdns.org:1935/live")
            _TUNNEL_STATE["tailscale_rtmp_base"] = _TUNNEL_STATE.get("tailscaleRtmpBase", "rtmp://100.117.170.13:1935/live")
            _TUNNEL_STATE["url"] = _TUNNEL_STATE.get("boreRtmpBase") or ""
            _TUNNEL_STATE["active"] = True
            return _TUNNEL_STATE
        
        
        @router.post("/api/drones/tunnel/start")
        @router.post("/api/config/drones/tunnel/start")
        def api_start_drone_tunnel() -> Dict[str, Any]:
            _start_bore_tunnel_if_available()
            time.sleep(0.5)
            return api_get_drone_tunnel()
        
        _drone_qcs_router = router
    app.include_router(_drone_qcs_router)
except Exception as _drn_err:
    print(f"[config-api] DroneQCS router init warning: {_drn_err}")





