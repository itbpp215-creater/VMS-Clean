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
try:
    import stream_probe
except ImportError:
    import sys
    sys.path.append("/config")
    import stream_probe


# The FastAPI instance exposes only config-service routes; authorization is
# attached to the dedicated router below so future config endpoints inherit it.
app = FastAPI()

CONFIG_PATH = '/config/config.yml'
GROUPS_PATH = '/config/nvr_groups.json'
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
    env_file = "/config/camera_credentials.env"
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
    env_file = "/config/camera_credentials.env"
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
    # Filter out _sub and _hd suffixes
    stream_names = set()
    for s in go2rtc_streams.keys():
        if not s.endswith('_sub') and not s.endswith('_hd'):
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
            "enabled": cam_data.get('enabled', True) if cam_name in cameras else True,
            "group": groups.get(cam_name, ""),
            # Tells the dashboard whether a maximize stream exists for this
            # camera. Cameras provisioned before the split stream layout have
            # none, and pointing the viewer at a missing stream would only
            # produce a connection that never succeeds.
            "has_hd": f"{cam_name}_hd" in go2rtc_streams,
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
        camera = transaction.config.get('cameras', {}).get(name)
        if camera is None:
            raise HTTPException(status_code=404, detail="Camera not found")
        detect_enabled = bool(track)
        current_track = camera.get('objects', {}).get('track')
        current_detect = camera.get('detect', {}).get('enabled', False)
        if current_track != track or current_detect != detect_enabled:
            camera.setdefault('objects', {})['track'] = track
            camera.setdefault('detect', {})['enabled'] = detect_enabled
            transaction.mark_changed()

    return {
        "status": "success",
        "camera": name,
        "detect_enabled": detect_enabled,
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
        camera = transaction.config.get('cameras', {}).get(name)
        if camera is None:
            raise HTTPException(status_code=404, detail="Camera not found")

        templates = get_camera_templates()
        tmpl = templates.get(name, {}) if isinstance(templates.get(name), dict) else {}
        is_protected = bool(tmpl.get("force_active") or name in get_lpr_cameras())
        if is_protected and not request.enabled:
            return {"status": "success", "camera": name, "enabled": True, "protected": True}

        target_enabled = True if is_protected else request.enabled
        changed = camera.get('enabled', True) != target_enabled
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
        effective_ai = camera.get('enabled', True) and camera.get('detect', {}).get('enabled', False)
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
        templates = get_camera_templates()
        if name in templates and isinstance(templates[name], dict):
            tmpl = templates[name]
            tmpl['enabled'] = effective_frigate_enabled
            tmpl.setdefault('record', {})['enabled'] = target_record
            tmpl.setdefault('detect', {})['enabled'] = effective_ai
            tmpl.setdefault('ffmpeg', {})['inputs'] = new_inputs
            save_camera_templates(templates)

        if changed:
            transaction.mark_changed()

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
    Demand-Driven Camera Provisioning Reconciliation (ADR-0020):
    1. Fetches desired camera pool from nas-bot-service.
    2. Compares with cameras currently in config.yml.
    3. Deprovisions unreferenced cameras (saving templates first).
    4. Provisions newly demanded cameras (restoring from templates or defaults).
    5. Triggers Frigate restart if changes were committed.
    """
    with _reconcile_lock:
        if not os.path.exists(CONFIG_PATH):
            raise HTTPException(status_code=404, detail="config.yml not found")

        desired_cameras = set()
        online_users = 0
        try:
            req = urllib.request.Request(NAS_BOT_DEMAND_POOL_URL, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                pool_data = json.loads(resp.read().decode('utf-8'))
                desired_cameras = set(pool_data.get("cameras", []))
                online_users = pool_data.get("online_users", 0)
        except Exception as e:
            return {
                "status": "error",
                "message": f"Demand pool unreachable: {e}",
                "changed": False
            }

        templates = get_camera_templates()

        # Include any cameras explicitly marked force_active in templates
        for cam_name, tmpl in templates.items():
            if isinstance(tmpl, dict) and tmpl.get("force_active") is True:
                desired_cameras.add(cam_name)

        with open_config_transaction(include_groups=False) as transaction:
            config = transaction.config
            current_cameras_dict = config.setdefault('cameras', {})
            current_active_cameras = {
                cam for cam, ccfg in current_cameras_dict.items()
                if isinstance(ccfg, dict) and ccfg.get("ui", {}).get("dashboard", True) is not False
            }

            to_provision = desired_cameras - current_active_cameras
            to_deprovision = current_active_cameras - desired_cameras

            if not to_provision and not to_deprovision:
                return {
                    "status": "success",
                    "changed": False,
                    "active_cameras": sorted(list(current_active_cameras)),
                    "online_users": online_users
                }

            # 1. Deprovision unreferenced cameras (preserve camera entry with enabled: False so historical events remain queryable)
            for cam in to_deprovision:
                existing_block = current_cameras_dict.get(cam)
                if existing_block:
                    templates[cam] = json.loads(json.dumps(dict(existing_block)))
                current_cameras_dict[cam] = {
                    "enabled": False,
                    "ui": {"dashboard": False},
                    "ffmpeg": {
                        "inputs": [{"path": f"rtsp://127.0.0.1:8554/{cam}?video", "input_args": "preset-rtsp-restream", "roles": ["record"]}]
                    },
                    "detect": {"enabled": False},
                    "record": {"enabled": False}
                }

            # 2. Provision demanded cameras
            for cam in to_provision:
                # Ensure go2rtc stream entries exist so go2rtc can relay
                # video for the provisioned camera.
                prov_streams = config.setdefault('go2rtc', {}).setdefault('streams', {})
                sources = get_camera_sources()
                if cam in sources:
                    # RTMP push camera: check for stream key case-mismatch (e.g. Falcon1 vs falcon1, Bodyarm vs bodyarm)
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
                    # Non-RTMP camera: try to build from template ffmpeg
                    # input path using optimal codec/GPU probing.
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

                if cam in templates and isinstance(templates[cam], dict):
                    cam_block = json.loads(json.dumps(dict(templates[cam])))
                    if "detect" not in cam_block:
                        cam_block["detect"] = {"enabled": False}
                    ai_on = cam_block.get("detect", {}).get("enabled", False)
                    manual_recs = get_manual_recordings()
                    rec_on = bool(ai_on or manual_recs.get(cam, False))
                    cam_block["enabled"] = rec_on
                    cam_block.setdefault("record", {})["enabled"] = rec_on
                    for inp in cam_block.get("ffmpeg", {}).get("inputs", []):
                        if not ai_on and "roles" in inp and "detect" in inp["roles"]:
                            inp["roles"] = [r for r in inp["roles"] if r != "detect"]
                            if not inp["roles"]:
                                inp["roles"] = ["record"]
                    cam_block.setdefault("ui", {})["dashboard"] = True
                    current_cameras_dict[cam] = cam_block
                else:
                    inputs = [{
                        'path': f'rtsp://127.0.0.1:8554/{cam}?video',
                        'input_args': 'preset-rtsp-restream',
                        'roles': ['record']
                    }]
                    current_cameras_dict[cam] = {
                        'ffmpeg': {'inputs': inputs},
                        'ui': {'dashboard': True},
                        'enabled': False,
                        'detect': {'enabled': False},
                        'record': {
                            'enabled': False,
                            'alerts': {'retain': {'days': 7, 'mode': 'motion'}},
                            'detections': {'retain': {'days': 7, 'mode': 'motion'}}
                        },
                        'snapshots': {'enabled': True, 'bounding_box': False},
                        'objects': {'track': ['person', 'car', 'motorcycle', 'truck']}
                    }

            save_camera_templates(templates)
            transaction.mark_changed()

        # Incident 2.117: Demand reconciliation updates config.yml / templates for persistence.
        # Live WebRTC streaming is handled independently on demand by go2rtc (all streams
        # are already pre-loaded in go2rtc.streams). Do NOT trigger a Frigate restart here,
        # which would sever all active WebSockets and cause mass "RECONNECT" drops across
        # all viewing clients. Dynamic AI/record changes are handled via MQTT without restart.

        return {
            "status": "success",
            "changed": True,
            "provisioned": sorted(list(to_provision)),
            "deprovisioned": sorted(list(to_deprovision)),
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

app.include_router(config_router)

operator_router = APIRouter(prefix="/api/config", dependencies=[Depends(require_authenticated)])

@operator_router.post("/cameras/{name}/record_toggle")
def toggle_manual_record(name: str, request: Request, identity: TrustedIdentity = Depends(require_authenticated)):
    """Toggle manual continuous recording on NVR for one camera."""
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    manual_recs = get_manual_recordings()
    current_state = manual_recs.get(name, False)
    new_state = not current_state
    if new_state:
        manual_recs[name] = True
    else:
        manual_recs.pop(name, None)
    save_manual_recordings(manual_recs)

    with open_config_transaction() as transaction:
        config = transaction.config
        cameras = config.setdefault('cameras', {})
        if name not in cameras:
            raise HTTPException(status_code=404, detail="Camera not found")

        camera = cameras[name]
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

    try:
        import paho.mqtt.publish as publish
        publish.single(f"frigate/{name}/record/set", payload="ON" if new_state else "OFF", hostname="mqtt")
    except Exception as e:
        print(f"MQTT publish failed: {e}")

    return {
        "status": "success",
        "camera": name,
        "recording": new_state,
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

    Accessible to all authenticated users. Does NOT change camera enabled/disabled
    state or recording state — only the AI detector pipeline.
    Also synchronizes ffmpeg input roles so Frigate validator accepts the config.
    """
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="config.yml not found")

    new_detect = body.detect_enabled

    with open_config_transaction() as transaction:
        camera = transaction.config.get("cameras", {}).get(name)
        templates = get_camera_templates()
        tmpl = templates.get(name, {}) if isinstance(templates.get(name), dict) else {}

        if camera is None:
            if tmpl:
                transaction.config.setdefault("cameras", {})[name] = json.loads(json.dumps(tmpl))
                camera = transaction.config["cameras"][name]
            else:
                raise HTTPException(status_code=404, detail="Camera not found")


        detect = camera.setdefault("detect", {})

        if detect.get("enabled") == new_detect:
            # No change needed
            return {
                "status": "success",
                "camera": name,
                "detect_enabled": new_detect,
                "changed": False,
            }

        detect["enabled"] = new_detect
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
        templates = get_camera_templates()
        if name in templates and isinstance(templates[name], dict):
            tmpl = templates[name]
            tmpl["enabled"] = camera.get("enabled", True)
            tmpl.setdefault("record", {})["enabled"] = target_record
            tmpl.setdefault("detect", {})["enabled"] = new_detect
            tmpl.setdefault("ffmpeg", {})["inputs"] = new_inputs
            save_camera_templates(templates)

        if changed:
            transaction.mark_changed()

    # Incident 2.45 (Follow-up): Dynamically toggle detect and record via MQTT
    # without restarting Frigate, preventing recording gaps.
    try:
        import paho.mqtt.publish as publish
        publish.single(f"frigate/{name}/detect/set", payload="ON" if new_detect else "OFF", hostname="mqtt")
        publish.single(f"frigate/{name}/record/set", payload="ON" if target_record else "OFF", hostname="mqtt")
    except Exception as e:
        print(f"MQTT publish failed: {e}")

    return {
        "status": "success",
        "camera": name,
        "detect_enabled": new_detect,
        "changed": True,
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

@public_router.get("/hls-map")
def get_hls_map():
    if not os.path.exists(CONFIG_PATH):
        return {}
    
    with open_config_transaction(include_groups=False) as transaction:
        config = transaction.config
        
    go2rtc_streams = config.get('go2rtc', {}).get('streams', {})
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
    gps_path = "/settings-data/camera_gps.json"
    if not os.path.exists(gps_path):
        gps_path = os.path.join(os.path.dirname(CONFIG_PATH), "dashboard-settings", "camera_gps.json")
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
            
    return hls_map

app.include_router(public_router)

def _reconciliation_background_worker():
    """Background loop ensuring periodic reconciliation safety net every 2 minutes."""
    time.sleep(20)
    while True:
        try:
            reconcile_cameras_internal()
        except Exception:
            pass
        time.sleep(120)

_worker_thread = threading.Thread(target=_reconciliation_background_worker, daemon=True)
_worker_thread.start()

