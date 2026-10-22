"""Unified Native Windows FastAPI Gateway & Process Supervisor for BPP-VMS.exe (Zero-Docker Edition).

Replaces Docker + Nginx + 13 containers on field/portable Windows machines with a single
lightweight native host that:
1. Serves ``frigate-nvr/web/`` directly (100% identical UI to ``vms.local``).
2. Mounts the real ``config-api`` (``/api/config/*``, ``/api/public-config/*``) and ``analytics-engine``
   (``/api/analytics/*``) routers directly in-process on Windows.
3. Implements all ``/settings/*`` & ``/settings/admin/*`` WebDAV-compatible GET/PUT endpoints
   (``channels.json``, ``camera_names.json``, ``camera_gps.json``, ``nodes.json``, ``lpr_cameras.txt``,
   ``lpr_zones.json``, ``object_alerts.json``, ``branding.json``).
4. Supervises ``go2rtc.exe`` (All-GPU MSE/WebRTC on ``:1984``) and ``mediamtx.exe`` (RTMP Ingest Server
   on ``:1935`` for drones/bodycams) with ``CREATE_NO_WINDOW``.
5. Supports DuckDNS dynamic DNS update, ``bore.exe`` public tunnel, and ``vms.local`` Field Uplink.
6. Runs the 15-minute Auto Web UI Hot-Sync & 1-Click Updater (``SystemUpdater``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
import yaml
from fastapi import FastAPI, File, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

_HERE = Path(__file__).resolve().parent
_FRIGATE_ROOT = (
    _HERE.parents[1]
    if (_HERE.name == "native-exe")
    else (_HERE.parent / "repo" / "frigate-nvr")
)
_REPO_ROOT = _FRIGATE_ROOT.parent
_WORKSPACE_ROOT = _REPO_ROOT.parent
_CONFIG_API_DIR = _FRIGATE_ROOT / "config-api"
_LPR_DIR = _FRIGATE_ROOT / "lpr-service"
_ANALYTICS_DIR = _FRIGATE_ROOT / "analytics-engine"

NATIVE_ROOT = Path(os.environ.get("BPP_NATIVE_ROOT", str(_WORKSPACE_ROOT / "native")))
NATIVE_CONFIG_DIR = NATIVE_ROOT / "config"
NATIVE_RUNTIME_DIR = Path(os.environ.get("BPP_NATIVE_RUNTIME_DIR", str(NATIVE_ROOT / "runtime")))


def _ensure_machine_local_config(native_cfg: Path, frigate_root: Path, runtime_dir: Path) -> None:
    """Ensure local native configuration is initialized on first run without ever wiping existing config."""
    current_pc = os.environ.get("COMPUTERNAME", "").strip() or "LOCAL-PC"
    machine_id_file = native_cfg / ".machine_id"
    stored_pc = ""
    if machine_id_file.is_file():
        try:
            stored_pc = machine_id_file.read_text(encoding="utf-8-sig").strip().lstrip("\ufeff")
        except Exception:
            stored_pc = ""

    is_first_run = not (native_cfg / "config.yml").is_file()

    if not is_first_run:
        if stored_pc != current_pc:
            try:
                machine_id_file.write_text(current_pc, encoding="utf-8")
            except Exception:
                pass
        return

    native_cfg.mkdir(parents=True, exist_ok=True)
    (native_cfg / "dashboard-settings").mkdir(parents=True, exist_ok=True)
    (native_cfg / "lpr").mkdir(parents=True, exist_ok=True)
    (native_cfg / "auth").mkdir(parents=True, exist_ok=True)
    (native_cfg / "faces").mkdir(parents=True, exist_ok=True)

    clean_yml = frigate_root / "config" / "config.clean.yml"
    if clean_yml.is_file():
        shutil.copy2(clean_yml, native_cfg / "config.yml")
    else:
        (native_cfg / "config.yml").write_text(
            "mqtt:\n  enabled: false\ncameras: {}\ndetect:\n  enabled: true\n",
            encoding="utf-8",
        )

    (native_cfg / "camera_credentials.env").write_text("", encoding="utf-8")
    (native_cfg / "nvr_groups.json").write_text("{}\n", encoding="utf-8")
    (native_cfg / "camera_templates.json").write_text("{}\n", encoding="utf-8")
    (native_cfg / "camera_sources.json").write_text("{}\n", encoding="utf-8")
    (native_cfg / "gpsone_devices.local.json").write_text(
        '{"devices": {}, "permissions": {}}\n', encoding="utf-8"
    )
    (native_cfg / "dashboard-settings" / "branding.json").write_text(
        '{"title": "SLOTH BPP-VMS"}\n', encoding="utf-8"
    )
    (native_cfg / "dashboard-settings" / "channels.json").write_text("{}\n", encoding="utf-8")
    (native_cfg / "dashboard-settings" / "camera_names.json").write_text("{}\n", encoding="utf-8")
    (native_cfg / "dashboard-settings" / "camera_gps.json").write_text("{}\n", encoding="utf-8")
    machine_id_file.write_text(current_pc, encoding="utf-8")


_ensure_machine_local_config(NATIVE_CONFIG_DIR, _FRIGATE_ROOT, NATIVE_RUNTIME_DIR)
CONFIG_DIR = NATIVE_CONFIG_DIR if (NATIVE_CONFIG_DIR / "config.yml").is_file() else (_FRIGATE_ROOT / "config")
DASHBOARD_SETTINGS_DIR = CONFIG_DIR / "dashboard-settings"
LPR_SETTINGS_DIR = CONFIG_DIR / "lpr"
if __name__ == "__main__":
    NATIVE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _early_log_fh = open(NATIVE_RUNTIME_DIR / "gateway.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = _early_log_fh
        sys.stderr = _early_log_fh
    except Exception:
        pass

# Configure environment variables BEFORE importing config-api / analytics-engine
os.environ.setdefault("BPP_REPO_ROOT", str(_REPO_ROOT))
os.environ.setdefault("BPP_CONFIG_DIR", str(CONFIG_DIR))
os.environ.setdefault("BPP_FACES_DIR", str(CONFIG_DIR / "faces"))
os.environ.setdefault("CONFIG_API_CONFIG_PATH", str(CONFIG_DIR / "config.yml"))
os.environ.setdefault("CONFIG_API_GROUPS_PATH", str(CONFIG_DIR / "nvr_groups.json"))
os.environ.setdefault("CONFIG_API_CREDENTIALS_ENV", str(CONFIG_DIR / "camera_credentials.env"))
os.environ.setdefault("CONFIG_API_LOCK_PATH", str(CONFIG_DIR / ".config-api.lock"))
os.environ.setdefault("CONFIG_API_BACKUP_DIR", str(CONFIG_DIR / "backups"))
os.environ.setdefault("CONFIG_API_LPR_CAMERAS_PATH", str(LPR_SETTINGS_DIR / "lpr_cameras.txt"))
os.environ.setdefault("CAMERA_TEMPLATES_PATH", str(CONFIG_DIR / "camera_templates.json"))
os.environ.setdefault("CAMERA_SOURCES_PATH", str(CONFIG_DIR / "camera_sources.json"))
os.environ.setdefault("MANUAL_RECORDINGS_PATH", str(CONFIG_DIR / "manual_recordings.json"))
os.environ.setdefault("AI_SCHEDULES_PATH", str(CONFIG_DIR / "ai_schedules.json"))
os.environ.setdefault("GPSONE_DEVICES_FILE", str(CONFIG_DIR / "gpsone_devices.local.json"))
os.environ.setdefault("WATCHLIST_DB_PATH", str(LPR_SETTINGS_DIR / "watchlist.db"))
_DEFAULT_NAS_STORAGE = Path(r"D:\data\nas-storage") if Path(r"D:\data\nas-storage").is_dir() else (CONFIG_DIR / "nas-storage")
_DEFAULT_NAS_DATA = Path(r"D:\data") if Path(r"D:\data").is_dir() else (CONFIG_DIR / "nas-data")
os.environ.setdefault("NAS_STORAGE_PATH", str(_DEFAULT_NAS_STORAGE))
os.environ.setdefault("NAS_DATA_DIR", str(_DEFAULT_NAS_DATA))
os.environ.setdefault("LOCAL_RECORDINGS_PATH", str(_FRIGATE_ROOT / "storage" / "recordings"))
os.environ.setdefault("LOCAL_EXPORTS_PATH", str(_FRIGATE_ROOT / "storage" / "exports"))
os.environ.setdefault("LOCAL_CLIPS_PATH", str(_FRIGATE_ROOT / "storage" / "clips"))
os.environ.setdefault("LOCAL_LPR_CROPS_PATH", str(_FRIGATE_ROOT / "lpr-data" / "crops"))

_NAS_BOT_DIR = _FRIGATE_ROOT / "nas-bot-service"
for _p in (_HERE, _CONFIG_API_DIR, _LPR_DIR, _ANALYTICS_DIR, _FRIGATE_ROOT / "config"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from gpu_accelerator import (
    GpuCapabilities,
    build_native_go2rtc_config,
    detect_gpu_capabilities,
    resolve_go2rtc_binary,
)
from native_ai_worker import get_native_ai_engine
from system_updater import SystemUpdater

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("bpp.native_gateway")

WEB_DIR = _FRIGATE_ROOT / "web"
CONFIG_YML = CONFIG_DIR / "config.yml"
CREDENTIALS_ENV = CONFIG_DIR / "camera_credentials.env"
WATCHLIST_DB = LPR_SETTINGS_DIR / "watchlist.db"
LPR_CROPS_DIR = _FRIGATE_ROOT / "lpr-data" / "crops"
FIELD_SYNC_SETTINGS_PATH = CONFIG_DIR / "field_uplink_settings.json"
NETWORK_SETTINGS_PATH = CONFIG_DIR / "native_network_settings.json"


# ---------------------------------------------------------------------------
# Process Supervisors: go2rtc.exe (:1984) & mediamtx.exe (RTMP :1935)
# ---------------------------------------------------------------------------
class Go2RtcSupervisor:
    """Supervises native ``go2rtc.exe`` child process without console windows."""

    def __init__(self, caps: GpuCapabilities) -> None:
        self.caps = caps
        self.proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self.go2rtc_bin = resolve_go2rtc_binary(NATIVE_ROOT)
        self.go2rtc_yaml = NATIVE_RUNTIME_DIR / "go2rtc.native.yaml"

    def ensure_config(self, force_rebuild: bool = False) -> Path:
        if not force_rebuild and self.go2rtc_yaml.is_file() and CONFIG_YML.is_file():
            yml_mtime = self.go2rtc_yaml.stat().st_mtime
            cfg_mtime = CONFIG_YML.stat().st_mtime
            env_mtime = CREDENTIALS_ENV.stat().st_mtime if CREDENTIALS_ENV.is_file() else 0.0
            if yml_mtime >= max(cfg_mtime, env_mtime):
                return self.go2rtc_yaml
        return build_native_go2rtc_config(
            config_yml_path=CONFIG_YML,
            credentials_env_path=CREDENTIALS_ENV,
            output_go2rtc_yaml=self.go2rtc_yaml,
            caps=self.caps,
        )

    def _is_existing_go2rtc_synced(self) -> bool:
        try:
            with urllib.request.urlopen("http://127.0.0.1:1984/api/streams", timeout=1.5) as resp:
                if resp.status != 200:
                    return False
                live_streams = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if not isinstance(live_streams, dict):
                    return False
        except Exception:
            return False

        try:
            if self.go2rtc_yaml.is_file():
                cfg = yaml.safe_load(self.go2rtc_yaml.read_text(encoding="utf-8")) or {}
                expected = (cfg.get("streams") or {}) if isinstance(cfg, dict) else {}
                if isinstance(expected, dict) and expected:
                    missing = [k for k in expected.keys() if k not in live_streams]
                    if missing:
                        logger.info(
                            "Existing go2rtc on :1984 is missing %d/%d configured streams — restarting go2rtc.exe",
                            len(missing),
                            len(expected),
                        )
                        return False
        except Exception:
            return False
        return True

    def start(self, force_restart: bool = False) -> bool:
        with self._lock:
            self.ensure_config(force_rebuild=force_restart)
            if not force_restart and self.proc is not None and self.proc.poll() is None:
                if self._is_existing_go2rtc_synced():
                    return True
            if not Path(self.go2rtc_bin).is_file() and shutil.which(self.go2rtc_bin) is None:
                logger.warning("go2rtc binary not found at %s", self.go2rtc_bin)
                return False

            if not force_restart and self._is_existing_go2rtc_synced():
                logger.info("Existing go2rtc instance on :1984 is healthy and synced")
                return True

            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            if self.proc is not None and self.proc.poll() is None:
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=2)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                self.proc = None

            try:
                subprocess.run(
                    ["taskkill", "/F", "/IM", "go2rtc.exe"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=3,
                    creationflags=creationflags,
                )
            except Exception:
                pass

            cmd = [self.go2rtc_bin, "-config", str(self.go2rtc_yaml)]
            logger.info("Starting native go2rtc.exe: %s", " ".join(cmd))
            self.proc = subprocess.Popen(
                cmd,
                cwd=str(NATIVE_RUNTIME_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
            for _ in range(16):
                time.sleep(0.15)
                try:
                    with urllib.request.urlopen("http://127.0.0.1:1984/api", timeout=0.6) as resp:
                        if resp.status == 200:
                            break
                except Exception:
                    pass
            return True

    def sync_streams_from_config(self) -> None:
        try:
            self.ensure_config(force_rebuild=True)
            if not self._is_existing_go2rtc_synced():
                self.start(force_restart=True)
        except Exception as exc:
            logger.debug("go2rtc stream sync check: %s", exc)

    def stop(self) -> None:
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except Exception:
                    self.proc.kill()
            self.proc = None


class RtmpMediaMtxSupervisor:
    """Supervises native ``mediamtx.exe`` RTMP/RTSP server (:1935 / :8554) for Drones & Bodycams."""

    def __init__(self) -> None:
        self.proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self.mediamtx_bin = NATIVE_ROOT / "bin" / "mediamtx.exe"
        self.mediamtx_yml = NATIVE_RUNTIME_DIR / "mediamtx.native.yml"

    def ensure_config(self) -> Path:
        NATIVE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        def _port_busy(p: int) -> bool:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.2)
                return s.connect_ex(("127.0.0.1", p)) == 0

        rtmp_port = 21935 if _port_busy(1935) else 1935
        rtsp_port = 38554 if _port_busy(8554) else 8554
        hls_port = 28888 if _port_busy(18888) else 18888
        cfg = {
            "logLevel": "warn",
            "rtmp": True,
            "rtmpAddress": f":{rtmp_port}",
            "rtsp": True,
            "rtspAddress": f":{rtsp_port}",
            "hls": True,
            "hlsAddress": f":{hls_port}",
            "webrtc": False,
            "srt": False,
            "paths": {"all_others": {}},
        }
        self.mediamtx_yml.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
        return self.mediamtx_yml

    def start(self) -> bool:
        with self._lock:
            if not self.mediamtx_bin.is_file():
                return False
            if self.proc is not None and self.proc.poll() is None:
                return True
            self.ensure_config()
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                self.proc = subprocess.Popen(
                    [str(self.mediamtx_bin), str(self.mediamtx_yml)],
                    cwd=str(NATIVE_RUNTIME_DIR),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=creationflags,
                )
                return True
            except Exception as exc:
                logger.warning("Failed to start mediamtx.exe: %s", exc)
                return False

    def stop(self) -> None:
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except Exception:
                    self.proc.kill()
            self.proc = None

    def status(self) -> Dict[str, Any]:
        running = self.proc is not None and self.proc.poll() is None
        return {
            "installed": self.mediamtx_bin.is_file(),
            "running": running,
            "rtmp_ingest_url": "rtmp://<host-ip>:1935/live/<stream_name>",
            "rtsp_relay_url": "rtsp://127.0.0.1:18554/live/<stream_name>",
        }


class FieldNetworkAndUplinkManager:
    """Manages DuckDNS (`bpp215.duckdns.org`), `bore.exe` tunnel, and `vms.local` HQ Uplink."""

    def __init__(self) -> None:
        self.field_sync = self._load_json(
            FIELD_SYNC_SETTINGS_PATH,
            {
                "enabled": False,
                "hq_url": "https://vms.local",
                "node_name": os.environ.get("COMPUTERNAME", "BPP-FIELD-01"),
                "shared_secret": "",
                "last_sync_at": None,
                "synced_events": 0,
                "last_error": None,
            },
        )
        self.network = self._load_json(
            NETWORK_SETTINGS_PATH,
            {
                "duckdns_enabled": False,
                "duckdns_domain": "bpp215",
                "duckdns_token": "",
                "duckdns_last_update": None,
                "hq_domain": "vms.local",
                "bore_tunnel_enabled": False,
                "bore_server": "bore.pub",
                "bore_remote_port": 0,
                "rtmp_enabled": True,
            },
        )

    @staticmethod
    def _load_json(path: Path, defaults: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(defaults)
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    out.update(data)
            except Exception:
                pass
        return out

    def save_field_sync(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        self.field_sync.update(updates)
        FIELD_SYNC_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIELD_SYNC_SETTINGS_PATH.write_text(
            json.dumps(self.field_sync, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return self.field_sync

    def save_network(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        self.network.update(updates)
        NETWORK_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        NETWORK_SETTINGS_PATH.write_text(
            json.dumps(self.network, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        if self.network.get("duckdns_enabled") and self.network.get("duckdns_domain") and self.network.get("duckdns_token"):
            self.trigger_duckdns_update()
        return self.network

    def trigger_duckdns_update(self) -> Dict[str, Any]:
        dom = str(self.network.get("duckdns_domain") or "").replace(".duckdns.org", "").strip()
        tok = str(self.network.get("duckdns_token") or "").strip()
        if not dom or not tok:
            return {"ok": False, "detail": "Missing DuckDNS domain or token"}
        url = f"https://www.duckdns.org/update?domains={urllib.parse.quote(dom)}&token={urllib.parse.quote(tok)}&ip="
        try:
            with urllib.request.urlopen(url, timeout=8) as resp:
                body = resp.read().decode("utf-8", errors="ignore").strip()
                self.network["duckdns_last_update"] = time.strftime("%Y-%m-%dT%H:%M:%S+07:00")
                return {"ok": body == "OK", "response": body}
        except Exception as exc:
            return {"ok": False, "detail": str(exc)}


app = FastAPI(title="BPP-VMS Native Windows Gateway", version="2.1.0-native")

_gpu_caps = detect_gpu_capabilities(NATIVE_ROOT)
if _gpu_caps.vendor == "nvidia" or _gpu_caps.go2rtc_hw_profile == "nvidia":
    os.environ.setdefault("HOST_HARDWARE_ACCEL", "nvidia")
elif _gpu_caps.vendor in ("intel", "amd") or _gpu_caps.go2rtc_hw_profile in ("vaapi", "qsv", "d3d11va"):
    os.environ.setdefault("HOST_HARDWARE_ACCEL", "vaapi")
else:
    os.environ.setdefault("HOST_HARDWARE_ACCEL", "cpu")
_go2rtc_sup = Go2RtcSupervisor(_gpu_caps)
_rtmp_sup = RtmpMediaMtxSupervisor()
_updater = SystemUpdater(repo_root=_REPO_ROOT, config_dir=CONFIG_DIR)
_net_mgr = FieldNetworkAndUplinkManager()

_yaml_mtime_cache: Dict[str, Any] = {}
_yaml_cache_lock = threading.Lock()


def _cached_load_yaml(path: Any) -> Dict[str, Any]:
    p_str = str(path)
    try:
        mtime = os.path.getmtime(p_str)
    except OSError:
        return {"cameras": {}, "go2rtc": {"streams": {}}}
    with _yaml_cache_lock:
        entry = _yaml_mtime_cache.get(p_str)
        if entry is not None and entry[0] == mtime:
            return entry[1]
    with open(p_str, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        data = {"cameras": {}, "go2rtc": {"streams": {}}}
    with _yaml_cache_lock:
        _yaml_mtime_cache[p_str] = (mtime, data)
    return data


# ---------------------------------------------------------------------------
# Mount Real Backend Routers (config-api & analytics-engine) with Native Auth
# ---------------------------------------------------------------------------
def _resolve_cookie_identity(cookie_header: Optional[str]) -> tuple[str, str]:
    """Decode bpp_token JWT from Cookie header if present, else default to ('arm215', 'superadmin')."""
    if cookie_header and "bpp_token=" in cookie_header:
        try:
            import jwt as _jwt

            token = ""
            for part in cookie_header.split(";"):
                p = part.strip()
                if p.startswith("bpp_token="):
                    token = p.split("=", 1)[1].strip()
                    break
            if token:
                secret_file = CONFIG_DIR / "auth" / "secret.key"
                if secret_file.is_file():
                    secret = secret_file.read_text(encoding="utf-8", errors="ignore").strip()
                    payload = _jwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": False, "verify_iss": False})
                else:
                    payload = _jwt.decode(token, options={"verify_signature": False})
                sub = str(payload.get("sub") or "").strip()
                role = str(payload.get("role") or "admin").strip()
                if sub:
                    return (sub, role)
        except Exception:
            pass
    return ("arm215", "superadmin")


try:
    import trusted_auth
    from trusted_auth import TrustedIdentity

    def _native_verify_identity(
        verify_url: str = "",
        authorization: Optional[str] = None,
        cookie: Optional[str] = None,
        *args: Any,
        **kwargs: Any,
    ) -> TrustedIdentity:
        uname, urole = _resolve_cookie_identity(cookie)
        return TrustedIdentity(username=uname, role=urole if urole in ("admin", "superadmin") else "superadmin")

    trusted_auth.verify_identity = _native_verify_identity

    import config_store as _cs_mod
    _cs_mod.load_yaml_config = _cached_load_yaml

    import api as _config_api_mod
    import frigate_validator as _fv_mod

    def _native_validate_yaml_with_frigate(payload: str, **kwargs: Any) -> None:
        threading.Timer(0.4, _go2rtc_sup.sync_streams_from_config).start()

    _fv_mod.validate_yaml_with_frigate = _native_validate_yaml_with_frigate
    _config_api_mod.validate_yaml_with_frigate = _native_validate_yaml_with_frigate
    _config_api_mod.verify_identity = _native_verify_identity
    _config_api_mod.load_yaml_config = _cached_load_yaml
    _config_api_mod.reconcile_cameras_internal = lambda *a, **kw: {"status": "native_noop"}
    _config_api_mod.enforce_ai_schedules_internal = lambda *a, **kw: {"checked": 0, "updated": []}
    app.include_router(_config_api_mod.config_router)
    app.include_router(_config_api_mod.operator_router)
    app.include_router(_config_api_mod.public_router)
    if hasattr(_config_api_mod, "program_log_router"):
        app.include_router(_config_api_mod.program_log_router)
    logger.info("Mounted real config-api routers (/api/config/* & /api/public-config/*)")
except Exception as _cfg_exc:
    logger.warning("Failed to mount config-api routers: %s", _cfg_exc)

try:
    from drone_qcs import router as _drone_qcs_router
    app.include_router(_drone_qcs_router)
    logger.info("Mounted SLOTH Drone & QCS Ground Control Station router (/api/drones/* & /api/config/drones/*)")
except Exception as _drn_exc:
    logger.warning("Failed to mount drone_qcs router: %s", _drn_exc)

try:
    import importlib.util as _ilu_ana

    _ana_main_path = _ANALYTICS_DIR / "main.py"
    _ana_spec = _ilu_ana.spec_from_file_location("analytics_main", str(_ana_main_path))
    if _ana_spec and _ana_spec.loader:
        _analytics_mod = _ilu_ana.module_from_spec(_ana_spec)
        _ana_spec.loader.exec_module(_analytics_mod)
        if hasattr(_analytics_mod, "require_gateway"):
            app.dependency_overrides[_analytics_mod.require_gateway] = lambda: True
        for _route in _analytics_mod.app.routes:
            if getattr(_route, "path", "").startswith("/api/analytics"):
                app.router.routes.append(_route)
        logger.info("Mounted real analytics-engine routes (/api/analytics/*)")
except Exception as _ana_exc:
    logger.warning("Failed to mount analytics-engine routes: %s", _ana_exc)


@app.middleware("http")
async def _inject_native_operator_headers(request: Request, call_next):
    raw_headers = list(request.scope.get("headers") or [])
    existing_keys = {k.lower() for k, _ in raw_headers}
    cookie_str = request.headers.get("cookie")
    uname, urole = _resolve_cookie_identity(cookie_str)
    if b"x-user" not in existing_keys:
        raw_headers.append((b"x-user", uname.encode("utf-8")))
    if b"x-role" not in existing_keys:
        raw_headers.append((b"x-role", urole.encode("utf-8")))
    request.scope["headers"] = raw_headers
    return await call_next(request)


_ai_ready = False
_https_443_active = False
_http_80_active = False
_cloudflared_proc: Optional[subprocess.Popen] = None


def _start_native_cloudflared_tunnel() -> None:
    """Start native Windows cloudflared.exe tunnel when Docker is stopped so https://vms.local stays online."""
    global _cloudflared_proc
    if _cloudflared_proc is not None and _cloudflared_proc.poll() is None:
        return
    token = os.environ.get("CLOUDFLARE_TUNNEL_TOKEN", "").strip()
    if not token:
        for env_cand in (
            CONFIG_DIR / ".env",
            _FRIGATE_ROOT / ".env",
            Path(r"D:\BPP-VMS\frigate-nvr\.env"),
        ):
            if env_cand.is_file():
                try:
                    for line in env_cand.read_text(encoding="utf-8", errors="ignore").splitlines():
                        s = line.strip()
                        if s.startswith("CLOUDFLARE_TUNNEL_TOKEN="):
                            token = s.split("=", 1)[1].strip().strip('"').strip("'")
                            if token:
                                break
                except Exception:
                    pass
            if token:
                break
    if not token:
        return
    cf_bin = None
    for cand in (
        NATIVE_ROOT / "bin" / "cloudflared.exe",
        Path(r"C:\Program Files (x86)\cloudflared\cloudflared.exe"),
        Path(r"C:\Program Files\cloudflared\cloudflared.exe"),
    ):
        if cand.is_file():
            cf_bin = str(cand)
            break
    if not cf_bin:
        cf_bin = shutil.which("cloudflared")
    if not cf_bin:
        return
    try:
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        log_fp = NATIVE_RUNTIME_DIR / "cloudflared.native.log"
        fh = open(log_fp, "a", encoding="utf-8")
        _cloudflared_proc = subprocess.Popen(
            [cf_bin, "tunnel", "--no-autoupdate", "run", "--token", token],
            stdout=fh,
            stderr=fh,
            creationflags=creationflags,
        )
        logger.info("Started native cloudflared.exe tunnel (PID %s) for vms.local", _cloudflared_proc.pid)
    except Exception as exc:
        logger.warning("Failed to start native cloudflared.exe tunnel: %s", exc)


def _is_tcp_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _auto_https_443_takeover_worker() -> None:
    """
    When Docker is stopped (`docker compose stop`), port :443 becomes free.
    Automatically bind 0.0.0.0:443 with TLS certs (`config/certs/fullchain.pem`)
    so https://vms.local works 100% seamlessly without Docker!
    """
    global _https_443_active
    cert_file = CONFIG_DIR / "certs" / "fullchain.pem"
    key_file = CONFIG_DIR / "certs" / "privkey.pem"
    while not _https_443_active:
        try:
            if cert_file.is_file() and key_file.is_file() and _is_tcp_port_free(443):
                logger.info("Port :443 is free (Docker off) — starting native HTTPS server for vms.local on :443")
                _https_443_active = True
                _start_native_cloudflared_tunnel()
                cfg = uvicorn.Config(
                    app,
                    host="0.0.0.0",
                    port=443,
                    ssl_certfile=str(cert_file),
                    ssl_keyfile=str(key_file),
                    log_level="warning",
                    access_log=False,
                    log_config=None,
                )
                srv = uvicorn.Server(cfg)
                srv.run()
                break
        except Exception as exc:
            _https_443_active = False
            logger.debug("HTTPS :443 standby check: %s", exc)
        time.sleep(5.0)


def _auto_http_80_takeover_worker() -> None:
    """When Docker is stopped, bind 0.0.0.0:80 so http://localhost and LAN IPs work natively."""
    global _http_80_active
    while not _http_80_active:
        try:
            if _is_tcp_port_free(80):
                logger.info("Port :80 is free (Docker off) — starting native HTTP server on :80")
                _http_80_active = True
                cfg = uvicorn.Config(
                    app,
                    host="0.0.0.0",
                    port=80,
                    log_level="warning",
                    access_log=False,
                    log_config=None,
                )
                srv = uvicorn.Server(cfg)
                srv.run()
                break
        except Exception as exc:
            _http_80_active = False
            logger.debug("HTTP :80 standby check: %s", exc)
        time.sleep(5.0)


def _background_ai_camera_scanner() -> None:
    """
    Scans active LPR cameras from go2rtc (:1984) only when Docker is off (:443 active)
    or when BPP_NATIVE_BG_AI_SCAN=1 is explicitly enabled, preventing GPU contention.
    """
    while True:
        time.sleep(20.0)
        if not (_https_443_active or os.environ.get("BPP_NATIVE_BG_AI_SCAN") == "1"):
            continue
        try:
            lpr_cam_file = LPR_SETTINGS_DIR / "lpr_cameras.txt"
            cam_names: List[str] = []
            if lpr_cam_file.is_file():
                cam_names = [
                    line.strip()
                    for line in lpr_cam_file.read_text(encoding="utf-8", errors="ignore").splitlines()
                    if line.strip() and not line.strip().startswith("#")
                ]
            if not cam_names:
                continue
            ai = get_native_ai_engine()
            for cam in cam_names[:3]:
                try:
                    url = f"http://127.0.0.1:1984/api/frame.jpeg?src={urllib.parse.quote(cam)}"
                    with urllib.request.urlopen(url, timeout=2.5) as resp:
                        jpg_bytes = resp.read()
                    if len(jpg_bytes) < 1000:
                        continue
                    res = ai.analyze_image_bytes(jpg_bytes, run_lpr=True, run_attributes=True, run_faces=True, camera=cam)
                    lpr_info = res.get("lpr") or {}
                    plate_text = (lpr_info.get("plate_text") or "").strip()
                    if len(plate_text) >= 2 and WATCHLIST_DB.is_file():
                        province = (lpr_info.get("province") or "").strip()
                        attrs = res.get("vehicle_attributes") or {}
                        color = ((attrs.get("color") or {}).get("label_th") or "").strip()
                        brand = ((attrs.get("brand") or {}).get("label") or "").strip()
                        vtype = ((attrs.get("vehicle_type") or {}).get("label") or "").strip()
                        conf = float(lpr_info.get("confidence") or 0.85)
                        now_str = time.strftime("%Y-%m-%d %H:%M:%S")
                        ev_id = f"{time.time():.6f}-native"
                        LPR_CROPS_DIR.mkdir(parents=True, exist_ok=True)
                        crop_name = f"native_{cam}_{int(time.time())}.jpg"
                        (LPR_CROPS_DIR / crop_name).write_bytes(jpg_bytes)
                        conn = sqlite3.connect(str(WATCHLIST_DB))
                        try:
                            conn.execute(
                                """
                                INSERT INTO lpr_candidates
                                (event_id, camera, plate_text, province, detector_confidence, vehicle_color, vehicle_brand, vehicle_type, crop_path, source, review_status, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'native_ai', 'pending', ?, ?)
                                """,
                                (ev_id, cam, plate_text, province, conf, color, brand, vtype, crop_name, now_str, now_str),
                            )
                            conn.commit()
                        finally:
                            conn.close()
                except Exception:
                    pass
                time.sleep(2.0)
        except Exception:
            pass


def _background_boot_services() -> None:
    global _ai_ready
    try:
        if CONFIG_YML.is_file():
            _cached_load_yaml(CONFIG_YML)
    except Exception:
        pass
    try:
        _go2rtc_sup.start()
    except Exception as exc:
        logger.warning("go2rtc startup warning: %s", exc)
    try:
        _rtmp_sup.start()
    except Exception as exc:
        logger.warning("rtmp startup warning: %s", exc)
    _ai_ready = True


@app.on_event("startup")
def _on_startup() -> None:
    NATIVE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    DASHBOARD_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    LPR_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    _updater.start_background_worker()
    threading.Thread(target=_background_boot_services, name="bpp-native-boot", daemon=True).start()
    threading.Thread(target=_auto_https_443_takeover_worker, name="bpp-https-443", daemon=True).start()
    threading.Thread(target=_auto_http_80_takeover_worker, name="bpp-http-80", daemon=True).start()
    threading.Thread(target=_background_ai_camera_scanner, name="bpp-ai-scanner", daemon=True).start()


@app.on_event("shutdown")
def _on_shutdown() -> None:
    _go2rtc_sup.stop()
    _rtmp_sup.stop()


# ---------------------------------------------------------------------------
# 1. Auth, Session, Presence, Officer Locations & Missions (/auth/*)
# ---------------------------------------------------------------------------
_native_officer_locations: List[Dict[str, Any]] = []
_native_location_sharing_enabled: bool = False
_native_active_mission: Dict[str, Any] = {"active": False, "mission": None}
AUTH_DB = CONFIG_DIR / "auth" / "auth.db"


def _load_real_auth_users(include_inactive: bool = False) -> List[Dict[str, Any]]:
    users: List[Dict[str, Any]] = []
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        conn.row_factory = sqlite3.Row
        try:
            q = "SELECT username, role, active FROM users" if include_inactive else "SELECT username, role, active FROM users WHERE active = 1"
            rows = conn.execute(q).fetchall()
            for idx, r in enumerate(rows):
                uname = r["username"]
                is_active = bool(r["active"])
                users.append(
                    {
                        "username": uname,
                        "display_name": "BPP-VMS Native Operator" if uname == "arm215" else uname,
                        "role": r["role"] or "user",
                        "active": is_active,
                        "online": (idx == 0 or uname in ("arm215", "suchakree", "Big")) and is_active,
                        "last_seen": int(time.time()),
                    }
                )
        except Exception:
            pass
        finally:
            conn.close()
    if not users:
        users.append(
            {
                "username": "arm215",
                "display_name": "BPP-VMS Native Operator",
                "role": "superadmin",
                "active": True,
                "online": True,
                "last_seen": int(time.time()),
            }
        )
    return users


@app.get("/auth/session")
@app.get("/api/auth/session")
def native_auth_session(request: Request) -> Dict[str, Any]:
    uname, urole = _resolve_cookie_identity(request.headers.get("cookie"))
    return {
        "authenticated": True,
        "username": uname,
        "role": urole,
        "display_name": "BPP-VMS Native Operator" if uname == "arm215" else uname,
        "native_exe": True,
        "https_443_takeover": _https_443_active,
        "http_80_takeover": _http_80_active,
        "location_sharing_enabled": _native_location_sharing_enabled,
    }


@app.post("/auth/login")
def native_auth_login() -> Dict[str, Any]:
    return {"status": "ok", "username": "arm215", "role": "superadmin"}


@app.post("/auth/logout")
def native_auth_logout() -> Dict[str, Any]:
    return {"status": "ok"}


@app.post("/auth/heartbeat")
async def native_auth_heartbeat(request: Request) -> Dict[str, Any]:
    return {"status": "ok", "location_sharing_enabled": _native_location_sharing_enabled}


@app.get("/auth/presence")
def native_auth_presence() -> Dict[str, Any]:
    users = _load_real_auth_users()
    return {
        "online_count": sum(1 for u in users if u.get("online")),
        "users": users,
    }


@app.get("/auth/users")
def native_auth_users() -> List[Dict[str, Any]]:
    return _load_real_auth_users(include_inactive=True)


@app.post("/auth/users")
async def native_auth_create_user(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    username = str((body or {}).get("username") or "").strip()
    role = str((body or {}).get("role") or "user").strip()
    if not username:
        return JSONResponse({"detail": "กรุณาระบุ Username"}, status_code=400)
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        try:
            exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
            if exists:
                return JSONResponse({"detail": f"มีผู้ใช้งาน {username} อยู่แล้ว"}, status_code=400)
            conn.execute(
                "INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, ?, 1)",
                (username, "native_managed", role),
            )
            conn.commit()
        finally:
            conn.close()
    return {"status": "ok", "username": username, "role": role}


@app.put("/auth/users/{username}")
async def native_auth_update_user(username: str, request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        try:
            if "role" in body and body["role"]:
                conn.execute("UPDATE users SET role = ? WHERE username = ?", (str(body["role"]), username))
            if "active" in body:
                conn.execute("UPDATE users SET active = ? WHERE username = ?", (1 if body["active"] else 0, username))
            conn.commit()
        finally:
            conn.close()
    return {"status": "ok", "username": username}


@app.delete("/auth/users/{username}")
def native_auth_delete_user(username: str) -> Dict[str, Any]:
    if username.lower() in ("arm215", "admin"):
        return JSONResponse({"detail": "ไม่สามารถลบบัญชีหลักของระบบได้"}, status_code=400)
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        try:
            conn.execute("DELETE FROM users WHERE username = ?", (username,))
            conn.commit()
        finally:
            conn.close()
    return {"status": "ok", "deleted": username}


@app.get("/auth/audit")
def native_auth_audit(limit: int = 200) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    prog_fp = CONFIG_DIR / "program_logs.json"
    if prog_fp.is_file():
        try:
            pdata = json.loads(prog_fp.read_text(encoding="utf-8"))
            if isinstance(pdata, list):
                for item in pdata:
                    if isinstance(item, dict):
                        out.append(item)
        except Exception:
            pass
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT timestamp, username, action, details, ip_address FROM audit_log ORDER BY id DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
            for r in rows:
                out.append(
                    {
                        "timestamp": r["timestamp"],
                        "username": r["username"] or "system",
                        "category": "ผู้ใช้งาน/Auth",
                        "action": r["action"] or "AUTH",
                        "details": r["details"] or "",
                        "ip_address": r["ip_address"] or "127.0.0.1",
                    }
                )
        except Exception:
            pass
        finally:
            conn.close()
    return out[: max(1, min(limit, 500))]


@app.get("/auth/locations")
def native_auth_locations() -> Dict[str, Any]:
    active_locs: List[Dict[str, Any]] = []
    seen_users = set()
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT username, latitude, longitude, accuracy, heading, speed, updated_at, sharing_enabled FROM user_location WHERE sharing_enabled = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL"
            ).fetchall()
            for r in rows:
                uname = r["username"]
                seen_users.add(uname)
                active_locs.append(
                    {
                        "username": uname,
                        "display_name": "BPP-VMS Native Operator" if uname == "arm215" else uname,
                        "role": "superadmin" if uname in ("arm215", "suchakree") else "admin",
                        "latitude": float(r["latitude"]),
                        "longitude": float(r["longitude"]),
                        "lat": float(r["latitude"]),
                        "lng": float(r["longitude"]),
                        "accuracy": float(r["accuracy"] or 10.0),
                        "heading": r["heading"],
                        "speed": r["speed"],
                        "updated_at": r["updated_at"] or int(time.time()),
                        "status": "live",
                        "sharing_enabled": True,
                    }
                )
        except Exception:
            pass
        finally:
            conn.close()
    for loc in _native_officer_locations:
        if loc.get("sharing_enabled", True) and loc.get("username") not in seen_users:
            active_locs.append(loc)
    return {"locations": active_locs, "sharing_enabled": bool(active_locs) or _native_location_sharing_enabled}


@app.post("/auth/location")
async def native_auth_post_location(request: Request) -> Dict[str, Any]:
    uname, urole = _resolve_cookie_identity(request.headers.get("cookie"))
    try:
        body = await request.json()
        if isinstance(body, dict):
            lat_val = body.get("latitude") if body.get("latitude") is not None else body.get("lat")
            lng_val = body.get("longitude") if body.get("longitude") is not None else body.get("lng")
            if lat_val is not None and lng_val is not None:
                target_u = str(body.get("username") or uname)
                lat_f = float(lat_val)
                lng_f = float(lng_val)
                acc_f = float(body.get("accuracy") or 10.0)
                entry = {
                    "username": target_u,
                    "display_name": str(body.get("display_name") or ("BPP-VMS Native Operator" if target_u == "arm215" else target_u)),
                    "role": urole,
                    "latitude": lat_f,
                    "longitude": lng_f,
                    "lat": lat_f,
                    "lng": lng_f,
                    "accuracy": acc_f,
                    "updated_at": int(time.time()),
                    "status": "live",
                    "sharing_enabled": True,
                }
                _native_officer_locations[:] = [
                    loc for loc in _native_officer_locations if loc.get("username") != target_u
                ] + [entry]
                if AUTH_DB.is_file():
                    conn = sqlite3.connect(str(AUTH_DB))
                    try:
                        conn.execute(
                            """
                            INSERT INTO user_location (username, latitude, longitude, accuracy, updated_at, sharing_enabled)
                            VALUES (?, ?, ?, ?, datetime('now'), 1)
                            ON CONFLICT(username) DO UPDATE SET
                                latitude = excluded.latitude,
                                longitude = excluded.longitude,
                                accuracy = excluded.accuracy,
                                updated_at = excluded.updated_at,
                                sharing_enabled = 1
                            """,
                            (target_u, lat_f, lng_f, acc_f),
                        )
                        conn.commit()
                    except Exception:
                        pass
                    finally:
                        conn.close()
    except Exception:
        pass
    return {"status": "ok", "sharing_enabled": True}


@app.post("/auth/location/toggle")
async def native_auth_location_toggle(request: Request) -> Dict[str, Any]:
    global _native_location_sharing_enabled
    uname, _ = _resolve_cookie_identity(request.headers.get("cookie"))
    enabled = False
    target_user = uname
    try:
        body = await request.json()
        if isinstance(body, dict):
            enabled = bool(body.get("enabled", False))
            if body.get("username"):
                target_user = str(body.get("username")).strip()
    except Exception:
        pass
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        try:
            conn.execute(
                """
                INSERT INTO user_location (username, sharing_enabled)
                VALUES (?, ?)
                ON CONFLICT(username) DO UPDATE SET sharing_enabled = excluded.sharing_enabled
                """,
                (target_user, 1 if enabled else 0),
            )
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()
    if not enabled:
        _native_officer_locations[:] = [
            loc for loc in _native_officer_locations if loc.get("username") != target_user
        ]
    _native_location_sharing_enabled = enabled
    return {"status": "ok", "username": target_user, "location_sharing": enabled, "sharing_enabled": enabled}


@app.post("/auth/location/force-all")
async def native_auth_location_force_all(request: Request) -> Dict[str, Any]:
    global _native_location_sharing_enabled
    enabled = False
    try:
        body = await request.json()
        if isinstance(body, dict):
            enabled = bool(body.get("enable") if "enable" in body else body.get("enabled", False))
    except Exception:
        pass
    _native_location_sharing_enabled = enabled
    if AUTH_DB.is_file():
        conn = sqlite3.connect(str(AUTH_DB))
        try:
            conn.execute("UPDATE user_location SET sharing_enabled = ?", (1 if enabled else 0,))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()
    if not enabled:
        _native_officer_locations.clear()
    return {"status": "ok", "force_all": _native_location_sharing_enabled, "sharing_enabled": _native_location_sharing_enabled}


@app.get("/auth/location/stream-keepalive")
async def native_auth_location_stream_keepalive(request: Request) -> StreamingResponse:
    async def _gen():
        yield f"event: wakeup\ndata: {json.dumps({'sharing_enabled': _native_location_sharing_enabled, 'ts': int(time.time())})}\n\n"
        while not await request.is_disconnected():
            await asyncio.sleep(2.0)
            yield f"event: wakeup\ndata: {json.dumps({'sharing_enabled': _native_location_sharing_enabled, 'ts': int(time.time())})}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.get("/auth/mission/active")
def native_mission_active() -> Dict[str, Any]:
    return _native_active_mission


@app.get("/auth/mission/list")
def native_mission_list() -> Dict[str, Any]:
    return {"missions": []}


# ---------------------------------------------------------------------------
# 2. Dashboard Settings WebDAV-Compatible Endpoints (/settings/*)
# ---------------------------------------------------------------------------
_SETTINGS_FILE_MAP: Dict[str, Path] = {
    "branding.json": DASHBOARD_SETTINGS_DIR / "branding.json",
    "admin/branding.json": DASHBOARD_SETTINGS_DIR / "branding.json",
    "logo.png": DASHBOARD_SETTINGS_DIR / "logo.png",
    "admin/logo.png": DASHBOARD_SETTINGS_DIR / "logo.png",
    "storage_threshold": DASHBOARD_SETTINGS_DIR / "storage-policy" / "storage_threshold",
    "lpr_cameras": LPR_SETTINGS_DIR / "lpr_cameras.txt",
    "lpr_zones": LPR_SETTINGS_DIR / "lpr_zones.json",
    "object_alerts": LPR_SETTINGS_DIR / "object_alerts.json",
    "nodes": DASHBOARD_SETTINGS_DIR / "nodes.json",
    "admin/nodes": DASHBOARD_SETTINGS_DIR / "nodes.json",
    "camera_names": DASHBOARD_SETTINGS_DIR / "camera_names.json",
    "admin/camera_names": DASHBOARD_SETTINGS_DIR / "camera_names.json",
    "camera_gps": DASHBOARD_SETTINGS_DIR / "camera_gps.json",
    "admin/camera_gps": DASHBOARD_SETTINGS_DIR / "camera_gps.json",
    "channels": DASHBOARD_SETTINGS_DIR / "channels.json",
    "admin/channels": DASHBOARD_SETTINGS_DIR / "channels.json",
    "secret": DASHBOARD_SETTINGS_DIR / "secrets.json",
}

_SETTINGS_DEFAULTS: Dict[str, str] = {
    "branding.json": '{"title": "BPP-VMS Native Edition"}',
    "storage_threshold": "85",
    "lpr_cameras": "",
    "lpr_zones": "{}",
    "object_alerts": "{}",
    "nodes": "[]",
    "camera_names": "{}",
    "camera_gps": "{}",
    "channels": "{}",
    "secret": "{}",
}


@app.api_route("/settings/{setting_key:path}", methods=["GET", "PUT", "POST"])
async def handle_dashboard_settings(setting_key: str, request: Request) -> Response:
    key = setting_key.strip("/")
    target = _SETTINGS_FILE_MAP.get(key)
    if target is None and key.endswith(".json"):
        key = key[:-5]
        target = _SETTINGS_FILE_MAP.get(key)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Unknown setting: {key}")

    if request.method in ("PUT", "POST"):
        body = await request.body()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return Response(content=b"", status_code=204)

    if target.is_file():
        media_type = "application/json"
        if target.suffix == ".txt" or target.name == "storage_threshold":
            media_type = "text/plain; charset=utf-8"
        elif target.suffix == ".png":
            media_type = "image/png"
        return Response(content=target.read_bytes(), media_type=media_type)

    base_key = key.replace("admin/", "")
    default_body = _SETTINGS_DEFAULTS.get(base_key, "{}")
    media_type = "text/plain; charset=utf-8" if base_key in ("lpr_cameras", "storage_threshold") else "application/json"
    return Response(content=default_body.encode("utf-8"), media_type=media_type)


# ---------------------------------------------------------------------------
# 3. Native Health, RTMP Server (:1935), DuckDNS, Bore Tunnel & Field Uplink
# ---------------------------------------------------------------------------
@app.get("/api/client-error")
def log_client_error(err: str = "", ua: str = "") -> Response:
    if err:
        logger.warning("[Client-JS-Error] %s | UA=%s", err[:400], ua[:160])
    return Response(content=b"", status_code=204)


@app.get("/api/native/ping")
async def native_ping() -> Dict[str, Any]:
    return {"status": "ok", "mode": "native_windows_exe", "ai_ready": _ai_ready}


@app.get("/api/native/health")
def native_health() -> Dict[str, Any]:
    diag = (
        get_native_ai_engine().get_diagnostics()
        if _ai_ready
        else {"gpu": _gpu_caps.to_dict(), "ai_warming_up": True}
    )
    return {
        "status": "healthy",
        "mode": "native_windows_exe",
        "docker_required": False,
        "diagnostics": diag,
        "rtmp": _rtmp_sup.status(),
        "updater": _updater.get_status(force_fetch=False),
        "field_uplink": _net_mgr.field_sync,
        "network": _net_mgr.network,
    }


@app.get("/api/native/rtmp/status")
def get_rtmp_status() -> Dict[str, Any]:
    return _rtmp_sup.status()


@app.get("/api/native/field-sync/status")
def get_field_sync_status() -> Dict[str, Any]:
    return _net_mgr.field_sync


@app.post("/api/native/field-sync/configure")
async def set_field_sync_config(request: Request) -> Dict[str, Any]:
    body = await request.json()
    return _net_mgr.save_field_sync(body if isinstance(body, dict) else {})


@app.get("/api/native/network/status")
def get_native_network_status() -> Dict[str, Any]:
    return _net_mgr.network


@app.post("/api/native/network/configure")
async def set_native_network_config(request: Request) -> Dict[str, Any]:
    body = await request.json()
    return _net_mgr.save_network(body if isinstance(body, dict) else {})


# ---------------------------------------------------------------------------
# 4. Watchlist, LPR Archive & NAS-Bot / Chat Compatibility Endpoints
# ---------------------------------------------------------------------------
def _ensure_watchlist_db_schema() -> None:
    try:
        WATCHLIST_DB.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(WATCHLIST_DB))
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS watchlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plate TEXT NOT NULL UNIQUE,
                    plate_display TEXT NOT NULL,
                    province TEXT DEFAULT '',
                    owner_name TEXT DEFAULT '',
                    owner_address TEXT DEFAULT '',
                    user_name TEXT DEFAULT '',
                    criminal_history TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    network TEXT DEFAULT '',
                    danger_level TEXT DEFAULT 'medium',
                    notes TEXT DEFAULT '',
                    active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
                );
                CREATE TABLE IF NOT EXISTS lpr_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT DEFAULT '',
                    camera TEXT DEFAULT '',
                    plate_text TEXT NOT NULL,
                    province TEXT DEFAULT '',
                    detector_confidence REAL DEFAULT 0.0,
                    ocr_confidence REAL DEFAULT 0.0,
                    vehicle_color TEXT DEFAULT '',
                    vehicle_brand TEXT DEFAULT '',
                    vehicle_type TEXT DEFAULT '',
                    crop_path TEXT DEFAULT '',
                    full_frame_path TEXT DEFAULT '',
                    source TEXT DEFAULT 'native_ai',
                    review_status TEXT DEFAULT 'pending',
                    reviewed_by TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
                );
                """
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        logger.warning("Failed to initialize watchlist.db schema: %s", exc)


_ensure_watchlist_db_schema()


def _query_lpr_candidates(
    limit: int = 200,
    source: Optional[str] = None,
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    db_path = WATCHLIST_DB
    if not db_path.is_file():
        return []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        sql = "SELECT * FROM lpr_candidates WHERE 1=1"
        params: List[Any] = []
        if source:
            sql += " AND source = ?"
            params.append(source)
        if q:
            sql += " AND (plate_text LIKE ? OR province LIKE ? OR vehicle_brand LIKE ? OR vehicle_color LIKE ?)"
            like_q = f"%{q.strip()}%"
            params.extend([like_q, like_q, like_q, like_q])
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        items: List[Dict[str, Any]] = []
        for r in rows:
            d = dict(r)
            crop = d.get("crop_path") or ""
            d["crop_url"] = f"/lpr-crops/{os.path.basename(crop)}" if crop else None
            items.append(d)
        return items
    except Exception:
        return []
    finally:
        conn.close()


@app.get("/api/watchlist")
@app.get("/watchlist")
@app.get("/api/watchlist/plates")
@app.get("/watchlist/plates")
def native_watchlist_list() -> List[Dict[str, Any]]:
    if not WATCHLIST_DB.is_file():
        return []
    conn = sqlite3.connect(str(WATCHLIST_DB))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM watchlist ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


@app.post("/api/watchlist")
@app.post("/watchlist")
async def native_watchlist_create(request: Request) -> Dict[str, Any]:
    body = await request.json()
    plate = str(body.get("plate") or body.get("plate_display") or "").strip()
    if not plate:
        raise HTTPException(status_code=400, detail="plate is required")
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = sqlite3.connect(str(WATCHLIST_DB))
    try:
        cur = conn.execute(
            """
            INSERT OR REPLACE INTO watchlist
            (plate, plate_display, province, owner_name, owner_address, user_name, criminal_history, phone, network, danger_level, notes, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                plate.replace(" ", ""),
                str(body.get("plate_display") or plate),
                str(body.get("province") or ""),
                str(body.get("owner_name") or ""),
                str(body.get("owner_address") or ""),
                str(body.get("user_name") or ""),
                str(body.get("criminal_history") or ""),
                str(body.get("phone") or ""),
                str(body.get("network") or ""),
                str(body.get("danger_level") or "medium"),
                str(body.get("notes") or ""),
                now_str,
                now_str,
            ),
        )
        conn.commit()
        return {"ok": True, "id": cur.lastrowid, "plate": plate}
    finally:
        conn.close()


@app.delete("/api/watchlist/{item_id}")
@app.delete("/watchlist/{item_id}")
def native_watchlist_delete(item_id: int) -> Dict[str, Any]:
    if not WATCHLIST_DB.is_file():
        return {"ok": False}
    conn = sqlite3.connect(str(WATCHLIST_DB))
    try:
        conn.execute("DELETE FROM watchlist WHERE id = ?", (item_id,))
        conn.commit()
        return {"ok": True, "deleted_id": item_id}
    finally:
        conn.close()


@app.get("/api/watchlist/lpr/candidates")
@app.get("/watchlist/lpr/candidates")
def native_watchlist_candidates(
    limit: int = Query(default=200, ge=1, le=5000),
    source: Optional[str] = None,
    q: Optional[str] = None,
) -> Dict[str, Any]:
    items = _query_lpr_candidates(limit=limit, source=source, q=q)
    return {
        "items": items,
        "candidates": items,
        "total": len(items),
        "counts": {"all": len(items)},
    }


@app.post("/api/watchlist/lpr/candidates/{candidate_id}/review")
@app.post("/watchlist/lpr/candidates/{candidate_id}/review")
async def native_watchlist_review_candidate(candidate_id: int, request: Request) -> Dict[str, Any]:
    body = await request.json()
    status_val = str(body.get("review_status") or body.get("status") or "confirmed")
    plate_text = body.get("plate_text")
    province = body.get("province")
    now_str = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = sqlite3.connect(str(WATCHLIST_DB))
    try:
        if plate_text is not None:
            conn.execute(
                "UPDATE lpr_candidates SET review_status = ?, plate_text = ?, province = COALESCE(?, province), updated_at = ? WHERE id = ?",
                (status_val, str(plate_text).strip(), province, now_str, candidate_id),
            )
        else:
            conn.execute(
                "UPDATE lpr_candidates SET review_status = ?, updated_at = ? WHERE id = ?",
                (status_val, now_str, candidate_id),
            )
        conn.commit()
        return {"ok": True, "id": candidate_id, "review_status": status_val}
    finally:
        conn.close()


@app.get("/api/watchlist/lpr/review-queue")
def native_watchlist_review_queue() -> Dict[str, Any]:
    items = _query_lpr_candidates(limit=100)
    return {"items": items, "total": len(items)}


@app.get("/api/watchlist/lpr/dataset")
def native_watchlist_dataset() -> Dict[str, Any]:
    return {"items": [], "total": 0}


@app.get("/api/watchlist/lpr/learning/settings")
def native_watchlist_learning_settings() -> Dict[str, Any]:
    return {"auto_train_enabled": False, "active_model": "thlprv2.onnx (384x640)"}


@app.get("/api/watchlist/lpr/learning/models")
def native_watchlist_learning_models() -> Dict[str, Any]:
    return {"models": [{"version": "thlprv2.onnx", "active": True}]}


@app.get("/api/watchlist/lpr/learning/jobs")
def native_watchlist_learning_jobs() -> Dict[str, Any]:
    return {"jobs": []}


@app.get("/api/watchlist/stream")
async def native_watchlist_sse_stream(request: Request) -> StreamingResponse:
    async def _gen():
        yield "event: connected\ndata: {\"status\":\"ok\"}\n\n"
        while not await request.is_disconnected():
            await asyncio.sleep(15)
            yield ": keepalive\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@app.get("/api/nas-bot/user/profile")
def native_nas_bot_profile() -> Dict[str, Any]:
    return {"username": "arm215", "role": "superadmin", "paired": False}


@app.get("/api/nas-bot/subscriptions/me")
@app.get("/api/nas-bot/admin/subscriptions")
@app.get("/api/nas-bot/admin/user-profiles")
def native_nas_bot_subs() -> Dict[str, Any]:
    return {"subscriptions": [], "profiles": []}


@app.post("/api/nas-bot/user/heartbeat")
@app.post("/api/nas-bot/user/ai-demand")
def native_nas_bot_heartbeat() -> Dict[str, Any]:
    return {"status": "ok"}


_HISTORY_JOBS_DIR = (
    Path(r"D:\BPP-VMS\frigate-nvr\storage\exports\.history_jobs")
    if Path(r"D:\BPP-VMS\frigate-nvr\storage\exports\.history_jobs").is_dir()
    else (_FRIGATE_ROOT / "storage" / "exports" / ".history_jobs")
)


@app.get("/api/nas-bot/history-pull/cameras")
def native_history_pull_cameras() -> Dict[str, Any]:
    _HISTORY_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    catalog_file = _HISTORY_JOBS_DIR / "cameras_catalog.json"
    if catalog_file.is_file():
        try:
            return json.loads(catalog_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated_at": None, "total_cameras": 0, "groups": []}


@app.post("/api/nas-bot/history-pull/jobs")
async def native_history_pull_create_job(request: Request) -> Dict[str, Any]:
    body = await request.json()
    cams = [str(c).strip() for c in (body.get("cameras") or []) if c and str(c).strip()]
    start_ts = int(body.get("start_ts") or 0)
    end_ts = int(body.get("end_ts") or 0)
    if not cams:
        raise HTTPException(status_code=400, detail="กรุณาเลือกกล้องอย่างน้อย 1 กล้อง")
    if end_ts <= start_ts:
        raise HTTPException(status_code=400, detail="เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น")
    if (end_ts - start_ts) > 3600:
        raise HTTPException(status_code=400, detail="สามารถดึงย้อนหลังได้สูงสุดครั้งละไม่เกิน 60 นาทีต่อชุดคำสั่ง")
    _HISTORY_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    job_id = f"job_{int(time.time() * 1000)}"
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S+07:00")
    job_data = {
        "job_id": job_id,
        "status": "queued",
        "percent": 0,
        "cameras": cams,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "ai_scan": bool(body.get("ai_scan", True)),
        "vehicle_type": str(body.get("vehicle_type") or "all").strip(),
        "vehicle_color": str(body.get("vehicle_color") or "all").strip(),
        "case_tag": str(body.get("case_tag") or "").strip(),
        "created_by": "arm215",
        "created_at": now_iso,
        "updated_at": now_iso,
        "segments_imported": 0,
        "events_created": 0,
        "camera_progress": {
            c: {"camera": c, "name": c, "status": "pending", "segments_ok": 0, "segments_total": 0, "events_found": 0}
            for c in cams
        },
        "matched_events": [],
    }
    job_path = _HISTORY_JOBS_DIR / f"{job_id}.json"
    job_path.write_text(json.dumps(job_data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "ok", "job": job_data}


@app.get("/api/nas-bot/history-pull/jobs")
def native_history_pull_list_jobs() -> Dict[str, Any]:
    _HISTORY_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    jobs: List[Dict[str, Any]] = []
    for fp in sorted(_HISTORY_JOBS_DIR.glob("job_*.json"), reverse=True)[:15]:
        try:
            jobs.append(json.loads(fp.read_text(encoding="utf-8")))
        except Exception:
            continue
    return {"status": "ok", "jobs": jobs}


@app.get("/api/nas-bot/history-pull/jobs/{job_id}")
def native_history_pull_get_job(job_id: str) -> Dict[str, Any]:
    job_path = _HISTORY_JOBS_DIR / f"{os.path.basename(job_id)}.json"
    if not job_path.is_file():
        raise HTTPException(status_code=404, detail="ไม่พบงานดึงภาพย้อนหลังที่ระบุ")
    return {"status": "ok", "job": json.loads(job_path.read_text(encoding="utf-8"))}


@app.post("/api/nas-bot/history-pull/jobs/{job_id}/cancel")
def native_history_pull_cancel_job(job_id: str) -> Dict[str, Any]:
    job_path = _HISTORY_JOBS_DIR / f"{os.path.basename(job_id)}.json"
    if not job_path.is_file():
        raise HTTPException(status_code=404, detail="ไม่พบงานดึงภาพย้อนหลังที่ระบุ")
    jdata = json.loads(job_path.read_text(encoding="utf-8"))
    if jdata.get("status") in ("queued", "running"):
        jdata["status"] = "cancel_requested"
        jdata["cancel_requested"] = True
        job_path.write_text(json.dumps(jdata, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "ok", "job": jdata}


# Mount full nas-bot-service routes (Arrest Vault Dossiers, i2 Link Graph, Video Archive, CDR, Statements)
try:
    import importlib.util as _ilu

    if str(_NAS_BOT_DIR) not in sys.path:
        sys.path.append(str(_NAS_BOT_DIR))
    _nas_bot_main_path = _NAS_BOT_DIR / "main.py"
    if _nas_bot_main_path.is_file():
        _spec = _ilu.spec_from_file_location("nas_bot_main", str(_nas_bot_main_path))
        if _spec and _spec.loader:
            _nas_bot_mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_nas_bot_mod)
            _existing_nas_paths = {
                (getattr(r, "path", ""), tuple(sorted(getattr(r, "methods", []) or [])))
                for r in app.router.routes
                if getattr(r, "path", "").startswith("/api/nas-bot")
            }
            _mounted_cnt = 0
            for _nb_route in _nas_bot_mod.app.routes:
                _nb_path = getattr(_nb_route, "path", "")
                _nb_methods = tuple(sorted(getattr(_nb_route, "methods", []) or []))
                if _nb_path.startswith("/api/nas-bot") and (_nb_path, _nb_methods) not in _existing_nas_paths:
                    app.router.routes.append(_nb_route)
                    _mounted_cnt += 1
            logger.info("Mounted %d real nas-bot-service routes (/api/nas-bot/*)", _mounted_cnt)
except Exception as _nb_exc:
    logger.warning("Failed to mount nas-bot-service routes: %s", _nb_exc)


try:
    import importlib.util as _ilu_chat

    _chat_dir = _FRIGATE_ROOT / "chat-service"
    _chat_main_path = _chat_dir / "main.py"
    if _chat_main_path.is_file():
        if "services" in sys.modules and hasattr(sys.modules["services"], "__path__"):
            _chat_srv_dir = str(_chat_dir / "services")
            if _chat_srv_dir not in sys.modules["services"].__path__:
                sys.modules["services"].__path__.append(_chat_srv_dir)
        elif str(_chat_dir) not in sys.path:
            sys.path.append(str(_chat_dir))
        _chat_spec = _ilu_chat.spec_from_file_location("chat_main", str(_chat_main_path))
        if _chat_spec and _chat_spec.loader:
            _chat_mod = _ilu_chat.module_from_spec(_chat_spec)
            _chat_spec.loader.exec_module(_chat_mod)
            _chat_cnt = 0
            for _c_route in _chat_mod.app.routes:
                _c_path = getattr(_c_route, "path", "")
                if _c_path.startswith("/api/chat"):
                    app.router.routes.append(_c_route)
                    _chat_cnt += 1
            logger.info("Mounted %d real chat-service routes (/api/chat/*)", _chat_cnt)
except Exception as _chat_exc:
    logger.warning("Failed to mount chat-service routes: %s", _chat_exc)


@app.get("/api/chat/events")
@app.get("/api/chat/drop-points")
def native_chat_events() -> Dict[str, Any]:
    return {"events": [], "drop_points": []}


# ---------------------------------------------------------------------------
# 5. Frigate-Compatible /nvr/api/* & /api/* Endpoints (No Docker Required)
# ---------------------------------------------------------------------------
@app.get("/nvr/api/version")
@app.get("/api/version")
def frigate_compat_version() -> Response:
    return Response(content="0.18.2-native", media_type="text/plain")


@app.get("/nvr/api/stats")
@app.get("/api/stats")
def frigate_compat_stats() -> Dict[str, Any]:
    return {
        "service": {"version": "0.18.2-native", "uptime": int(time.time())},
        "detectors": {
            "native_onnx": {
                "inference_speed": 14.5,
                "provider": _gpu_caps.ort_selected_providers[0] if _gpu_caps.ort_selected_providers else "CPU",
            }
        },
        "cameras": {},
    }


@app.get("/nvr/api/config")
@app.get("/api/config")
def frigate_compat_config() -> Dict[str, Any]:
    if CONFIG_YML.is_file():
        try:
            return _cached_load_yaml(CONFIG_YML)
        except Exception:
            pass
    return {"cameras": {}, "record": {"events": {"pre_capture": 5}}}


@app.get("/nvr/api/events")
@app.get("/api/events")
def frigate_compat_events(limit: int = Query(default=50, ge=1, le=500)) -> List[Dict[str, Any]]:
    rows = _query_lpr_candidates(limit=limit)
    events: List[Dict[str, Any]] = []
    now = time.time()
    for r in rows:
        ev_id = str(r.get("event_id") or f"native-{r.get('id')}")
        start_ts = now - 60
        if ev_id and ev_id[0].isdigit():
            try:
                start_ts = float(ev_id.split("-")[0])
            except Exception:
                pass
        plate_str = " ".join(filter(None, [r.get("plate_text"), r.get("province")]))
        events.append(
            {
                "id": ev_id,
                "camera": r.get("camera") or "cam_native",
                "label": "car",
                "sub_label": plate_str or None,
                "top_score": float(r.get("detector_confidence") or 0.88),
                "start_time": start_ts,
                "end_time": start_ts + 8.0,
                "has_clip": False,
                "has_snapshot": True,
                "data": {
                    "top_score": float(r.get("detector_confidence") or 0.88),
                    "description": r.get("description") or plate_str,
                },
            }
        )
    return events


@app.get("/nvr/api/events/{event_id}/snapshot.jpg")
@app.get("/nvr/api/events/{event_id}/thumbnail.jpg")
@app.get("/api/events/{event_id}/snapshot.jpg")
@app.get("/api/events/{event_id}/thumbnail.jpg")
def frigate_compat_event_snapshot(event_id: str) -> Response:
    if WATCHLIST_DB.is_file():
        conn = sqlite3.connect(str(WATCHLIST_DB))
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT crop_path, camera FROM lpr_candidates WHERE event_id = ? OR ('native-' || id) = ? LIMIT 1",
                (event_id, event_id),
            ).fetchone()
            if row and row["crop_path"]:
                crop_file = LPR_CROPS_DIR / os.path.basename(str(row["crop_path"]))
                if crop_file.is_file():
                    return FileResponse(str(crop_file), media_type="image/jpeg")
        except Exception:
            pass
        finally:
            conn.close()
    raise HTTPException(status_code=404, detail="Snapshot not found")


@app.get("/nvr/api/faces")
def native_list_faces() -> Dict[str, List[str]]:
    ai = get_native_ai_engine()
    out: Dict[str, List[str]] = {}
    if ai.faces_dir.is_dir():
        for p in sorted(ai.faces_dir.iterdir()):
            if p.is_dir() and not p.name.startswith("."):
                out[p.name] = [f.name for f in sorted(p.glob("*.*")) if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    return out


@app.post("/nvr/api/faces/{person_name}/register")
async def native_register_face(person_name: str, file: UploadFile = File(...)) -> Dict[str, Any]:
    content = await file.read()
    ai = get_native_ai_engine()
    res = await asyncio.to_thread(
        ai.face_engine.register_face_bytes,
        person_name,
        content,
        file.filename or "face.jpg",
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Registration failed"))
    return res


@app.get("/api/watchlist/faces")
@app.get("/watchlist/faces")
async def native_watchlist_faces_list() -> Dict[str, Any]:
    ai = get_native_ai_engine()
    items = await asyncio.to_thread(ai.face_engine.list_watchlist_faces)
    recent = await asyncio.to_thread(ai.face_engine.get_recent_detections, 40)
    return {"ok": True, "items": items, "total": len(items), "recent_detections": recent}


@app.get("/api/watchlist/faces/recent")
@app.get("/watchlist/faces/recent")
async def native_watchlist_faces_recent(limit: int = Query(default=40, ge=1, le=200)) -> Dict[str, Any]:
    ai = get_native_ai_engine()
    recent = await asyncio.to_thread(ai.face_engine.get_recent_detections, limit)
    return {"ok": True, "items": recent, "total": len(recent)}


@app.post("/api/watchlist/faces/register")
@app.post("/watchlist/faces/register")
async def native_watchlist_faces_register(request: Request) -> Dict[str, Any]:
    body = await request.json()
    person_name = str(body.get("name") or body.get("person") or "").strip()
    img_b64 = str(body.get("image_b64") or "").strip()
    notes = str(body.get("notes") or "").strip()
    group = str(body.get("group") or "บุคคลเฝ้าระวัง").strip()
    danger_level = str(body.get("danger_level") or "high").strip()
    if "," in img_b64:
        img_b64 = img_b64.split(",", 1)[1]
    import base64

    try:
        img_bytes = base64.b64decode(img_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="รูปภาพไม่ถูกต้อง") from exc
    ai = get_native_ai_engine()
    res = await asyncio.to_thread(
        ai.face_engine.register_face_bytes,
        person_name,
        img_bytes,
        "face.jpg",
        notes,
        group,
        danger_level,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "ลงทะเบียนใบหน้าไม่สำเร็จ"))
    return res


@app.delete("/api/watchlist/faces/{person_name}")
@app.delete("/watchlist/faces/{person_name}")
async def native_watchlist_faces_delete(person_name: str) -> Dict[str, Any]:
    ai = get_native_ai_engine()
    res = await asyncio.to_thread(ai.face_engine.delete_person, person_name)
    if not res.get("ok"):
        raise HTTPException(status_code=404, detail=res.get("error", "ไม่พบรายชื่อนี้"))
    return res


@app.post("/api/watchlist/faces/search")
@app.post("/watchlist/faces/search")
async def native_watchlist_faces_search(request: Request) -> Dict[str, Any]:
    body = await request.json()
    img_b64 = str(body.get("image_b64") or "").strip()
    if "," in img_b64:
        img_b64 = img_b64.split(",", 1)[1]
    import base64

    try:
        img_bytes = base64.b64decode(img_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="รูปภาพไม่ถูกต้อง") from exc
    ai = get_native_ai_engine()
    res = await asyncio.to_thread(ai.face_engine.search_by_image_bytes, img_bytes)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "ค้นหาใบหน้าไม่สำเร็จ"))
    return res


@app.post("/api/watchlist/faces/compare")
@app.post("/watchlist/faces/compare")
async def native_watchlist_faces_compare(request: Request) -> Dict[str, Any]:
    body = await request.json()
    b1 = str(body.get("image1_b64") or "").strip()
    b2 = str(body.get("image2_b64") or "").strip()
    if "," in b1:
        b1 = b1.split(",", 1)[1]
    if "," in b2:
        b2 = b2.split(",", 1)[1]
    import base64

    try:
        img1_bytes = base64.b64decode(b1)
        img2_bytes = base64.b64decode(b2)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="รูปภาพไม่ถูกต้อง") from exc
    ai = get_native_ai_engine()
    res = await asyncio.to_thread(ai.face_engine.compare_two_images_bytes, img1_bytes, img2_bytes)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "เปรียบเทียบใบหน้าไม่สำเร็จ"))
    return res


@app.post("/api/watchlist/faces/sync-dossiers")
@app.post("/watchlist/faces/sync-dossiers")
async def native_watchlist_faces_sync_dossiers(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    ai = get_native_ai_engine()
    return await asyncio.to_thread(ai.face_engine.sync_dossiers, bool(body.get("force", False)))


@app.get("/api/watchlist/faces/cameras")
@app.get("/watchlist/faces/cameras")
async def native_watchlist_faces_cameras_get() -> Dict[str, Any]:
    ai = get_native_ai_engine()
    cfg = await asyncio.to_thread(ai.face_engine.get_face_cameras_config)
    return {"ok": True, **cfg}


@app.post("/api/watchlist/faces/cameras")
@app.post("/watchlist/faces/cameras")
async def native_watchlist_faces_cameras_post(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    ai = get_native_ai_engine()
    dis_cams = body.get("disabled_cameras") if isinstance(body.get("disabled_cameras"), list) else None
    cam = str(body.get("camera") or "").strip() or None
    en = body.get("enabled") if isinstance(body.get("enabled"), bool) else None
    return await asyncio.to_thread(
        ai.face_engine.update_face_cameras_config,
        dis_cams,
        cam,
        en,
    )


# ---------------------------------------------------------------------------
# 6. Live Stream Proxy to Native go2rtc (:1984) & Public HLS Proxies
# ---------------------------------------------------------------------------
_PUBLIC_HLS_UPSTREAMS: Dict[str, str] = {
    "proxy-ubon": "https://38.159.250.22",
    "proxy-roiet": "https://hj50ac9nwcc.sn.mynetname.net:18191",
    "proxy-doh-camerai1": "https://camerai1.iticfoundation.org",
    "proxy-doh-streaming1": "https://streaming1.highwaytraffic.go.th",
    "proxy-doh-streaming2": "https://streaming2.highwaytraffic.go.th",
    "proxy-udoncity": "https://streaming.udoncity.go.th:1935",
}


def _sync_fetch_public_hls(url: str, proxy_prefix: str) -> tuple[bytes, int, str]:
    import ssl

    ctx = ssl._create_unverified_context()
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
    except Exception:
        pass
    headers = {"User-Agent": "Mozilla/5.0"}
    if proxy_prefix == "proxy-roiet":
        headers["Host"] = "hj50ac9nwcc.sn.mynetname.net:18191"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=4.0, context=ctx) as resp:
        return (
            resp.read(),
            resp.status,
            resp.headers.get("Content-Type", "application/vnd.apple.mpegurl"),
        )


@app.get("/proxy-ubon/{subpath:path}")
@app.get("/proxy-roiet/{subpath:path}")
@app.get("/proxy-doh-camerai1/{subpath:path}")
@app.get("/proxy-doh-streaming1/{subpath:path}")
@app.get("/proxy-doh-streaming2/{subpath:path}")
@app.get("/proxy-udoncity/{subpath:path}")
async def proxy_public_hls(subpath: str, request: Request) -> Response:
    proxy_prefix = request.url.path.strip("/").split("/", 1)[0]
    upstream = _PUBLIC_HLS_UPSTREAMS.get(proxy_prefix)
    if not upstream:
        raise HTTPException(status_code=404, detail="Unknown proxy prefix")
    query = request.url.query
    url = f"{upstream}/{subpath}" + (f"?{query}" if query else "")
    try:
        data, status_code, media_type = await asyncio.to_thread(
            _sync_fetch_public_hls, url, proxy_prefix
        )
        return Response(content=data, status_code=status_code, media_type=media_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/{cam_name}/latest.jpg")
@app.get("/nvr/api/{cam_name}/latest.jpg")
async def proxy_camera_latest_jpg(cam_name: str) -> Response:
    url = f"http://127.0.0.1:1984/api/frame.jpeg?src={urllib.parse.quote(cam_name)}"
    req = urllib.request.Request(url, method="GET")
    try:
        data, status_code, _ = await asyncio.to_thread(_sync_go2rtc_http_call, req, 3.0)
        return Response(content=data, status_code=status_code, media_type="image/jpeg")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Frame capture failed: {exc}") from exc


def _sync_go2rtc_http_call(req: urllib.request.Request, timeout_sec: float) -> tuple[bytes, int, str]:
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return resp.read(), resp.status, resp.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as exc:
        return exc.read(), exc.code, "text/plain"


@app.api_route("/live/webrtc/{subpath:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.api_route("/nvr/live/webrtc/{subpath:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.api_route("/nvr/live/mse/{subpath:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.api_route("/nvr/api/go2rtc/{subpath:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy_go2rtc_http(subpath: str, request: Request) -> Response:
    query = request.url.query
    clean_sub = subpath if not request.url.path.startswith("/nvr/api/go2rtc/") else f"api/{subpath}"
    target_url = f"http://127.0.0.1:1984/{clean_sub}" + (f"?{query}" if query else "")
    body = await request.body()
    req = urllib.request.Request(
        target_url,
        data=body if request.method in ("POST", "PUT") else None,
        method=request.method,
    )
    ct = request.headers.get("content-type")
    if ct:
        req.add_header("Content-Type", ct)
    timeout_sec = 4.0 if "frame.jpeg" in clean_sub else 8.0
    try:
        data, status_code, resp_ct = await asyncio.to_thread(_sync_go2rtc_http_call, req, timeout_sec)
        return Response(content=data, status_code=status_code, media_type=resp_ct)
    except Exception as exc:
        try:
            await asyncio.to_thread(_go2rtc_sup.start, False)
            data, status_code, resp_ct = await asyncio.to_thread(_sync_go2rtc_http_call, req, timeout_sec)
            return Response(content=data, status_code=status_code, media_type=resp_ct)
        except Exception:
            raise HTTPException(status_code=502, detail=f"go2rtc proxy error: {exc}") from exc


@app.websocket("/live/webrtc/api/ws")
@app.websocket("/nvr/live/webrtc/api/ws")
@app.websocket("/nvr/live/mse/api/ws")
@app.websocket("/api/ws")
async def proxy_go2rtc_ws(client_ws: WebSocket) -> None:
    await client_ws.accept()
    query = client_ws.url.query
    upstream_url = "ws://127.0.0.1:1984/api/ws" + (f"?{query}" if query else "")
    upstream_ws = None
    try:
        import websockets

        try:
            upstream_ws = await asyncio.wait_for(
                websockets.connect(
                    upstream_url,
                    max_size=16 * 1024 * 1024,
                    open_timeout=4.0,
                    close_timeout=1.0,
                    ping_interval=20.0,
                    ping_timeout=20.0,
                ),
                timeout=4.5,
            )
        except Exception:
            await asyncio.to_thread(_go2rtc_sup.start, False)
            upstream_ws = await asyncio.wait_for(
                websockets.connect(
                    upstream_url,
                    max_size=16 * 1024 * 1024,
                    open_timeout=4.0,
                    close_timeout=1.0,
                    ping_interval=20.0,
                    ping_timeout=20.0,
                ),
                timeout=4.5,
            )

        async def _client_to_upstream() -> None:
            try:
                while True:
                    msg = await client_ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "text" in msg and msg["text"] is not None:
                        await upstream_ws.send(msg["text"])
                    elif "bytes" in msg and msg["bytes"] is not None:
                        await upstream_ws.send(msg["bytes"])
            except Exception:
                pass

        async def _upstream_to_client() -> None:
            try:
                async for message in upstream_ws:
                    if isinstance(message, bytes):
                        await client_ws.send_bytes(message)
                    else:
                        await client_ws.send_text(message)
            except Exception:
                pass

        t_c2u = asyncio.create_task(_client_to_upstream())
        t_u2c = asyncio.create_task(_upstream_to_client())
        try:
            _, pending = await asyncio.wait(
                {t_c2u, t_u2c},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for p in pending:
                p.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        finally:
            for t in (t_c2u, t_u2c):
                if not t.done():
                    t.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("WebSocket proxy closed: %s", exc)
    finally:
        if upstream_ws is not None:
            try:
                await asyncio.wait_for(upstream_ws.close(), timeout=1.0)
            except Exception:
                pass
        try:
            await client_ws.close()
        except Exception:
            pass


@app.websocket("/nvr/ws")
@app.websocket("/ws")
async def native_frigate_events_ws(client_ws: WebSocket) -> None:
    """Keep realtime event / command WebSocket cleanly open without hitting StaticFiles."""
    await client_ws.accept()
    try:
        while True:
            msg = await client_ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
    except Exception:
        pass
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass


@app.websocket("/{unhandled_ws_path:path}")
async def native_fallback_ws(client_ws: WebSocket, unhandled_ws_path: str) -> None:
    """Prevent unknown WebSocket paths from falling through to StaticFiles and raising AssertionError."""
    await client_ws.accept()
    try:
        await client_ws.close(code=1000)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 7. Static Web UI Serving (100% Shared with vms.local)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def _disable_stale_static_cache(request: Request, call_next: Any) -> Response:
    resp = await call_next(request)
    p = request.url.path.lower()
    if p == "/" or p.endswith((".html", ".js", ".css")):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
    return resp


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(
        str(WEB_DIR / "index.html"),
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@app.get("/login.html")
def serve_login() -> RedirectResponse:
    return RedirectResponse(url="/")


LPR_CROPS_DIR.mkdir(parents=True, exist_ok=True)
if LPR_CROPS_DIR.is_dir():
    app.mount("/lpr-crops", StaticFiles(directory=str(LPR_CROPS_DIR)), name="lpr-crops")
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web-ui")


if __name__ == "__main__":
    NATIVE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    log_file_path = NATIVE_RUNTIME_DIR / "gateway.log"
    try:
        _log_fh = open(log_file_path, "a", encoding="utf-8", buffering=1)
        sys.stdout = _log_fh
        sys.stderr = _log_fh
    except Exception:
        pass
    port = int(os.environ.get("BPP_NATIVE_PORT", "8443"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info", access_log=False, log_config=None)
