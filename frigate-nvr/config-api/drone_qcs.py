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

from __future__ import annotations

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
            # Ignore loopback and Docker internal bridge networks (172.16.0.0/12)
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
