"""All-GPU Hardware Accelerator & Dynamic go2rtc Configurator for BPP-VMS Native Windows Edition.

Automatically detects:
1. ONNX Runtime Execution Providers:
   - NVIDIA: ``TensorrtExecutionProvider`` -> ``CUDAExecutionProvider``
   - AMD / Intel / Windows GPU: ``DmlExecutionProvider`` (DirectML) / ``OpenVINOExecutionProvider``
   - CPU Fallback: ``CPUExecutionProvider``
2. FFmpeg Hardware Decode & Encode Pipeline:
   - NVIDIA: ``-hwaccel cuda`` + ``h264_nvenc``
   - AMD: ``-hwaccel d3d11va`` + ``h264_amf``
   - Intel: ``-hwaccel d3d11va`` + ``h264_qsv``
   - Windows MediaFoundation / CPU Fallback: ``libx264 -preset ultrafast -tune zerolatency``
3. Generates ``go2rtc.yaml`` for ``go2rtc.exe`` from ``config/config.yml`` + ``camera_credentials.env``
   with RTMP ingest (`:1935`), WebRTC (`:8555`), and API (`:1984`) ready out of the box.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml


@dataclass
class GpuCapabilities:
    vendor: str = "cpu"
    gpu_names: List[str] = field(default_factory=list)
    ort_available_providers: List[str] = field(default_factory=list)
    ort_selected_providers: List[str] = field(default_factory=list)
    ffmpeg_path: str = "ffmpeg"
    ffmpeg_hwaccel: str = "none"
    ffmpeg_h264_encoder: str = "libx264"
    go2rtc_hw_profile: str = "cpu"

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


def _run_quiet(cmd: List[str], timeout: int = 8) -> str:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=creationflags,
        )
        return (res.stdout or "") + "\n" + (res.stderr or "")
    except Exception:
        return ""


def detect_windows_gpus() -> List[str]:
    """Query Windows WMI / CIM for installed display adapters."""
    out = _run_quiet(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ],
        timeout=8,
    )
    names = [line.strip() for line in out.splitlines() if line.strip()]
    return names


def resolve_ffmpeg_binary(native_root: Optional[Path] = None) -> str:
    """Find ffmpeg.exe in native bin directory, SLOTH bundle, or system PATH."""
    candidates: List[Path] = []
    if native_root:
        candidates.extend(
            [
                native_root / "bin" / "ffmpeg.exe",
                native_root / "ffmpeg.exe",
            ]
        )
    sloth_ffmpeg = Path(r"D:\sloth-bpp215\SLOTH-BPP215\ffmpeg.exe")
    if sloth_ffmpeg.is_file():
        candidates.append(sloth_ffmpeg)

    for cand in candidates:
        if cand.is_file():
            return str(cand.resolve())

    which_ff = shutil.which("ffmpeg")
    return which_ff or "ffmpeg"


def resolve_go2rtc_binary(native_root: Optional[Path] = None) -> str:
    """Find go2rtc.exe in native bin directory, SLOTH bundle, or system PATH."""
    candidates: List[Path] = []
    if native_root:
        candidates.extend(
            [
                native_root / "bin" / "go2rtc.exe",
                native_root / "go2rtc.exe",
            ]
        )
    sloth_g2r = Path(r"D:\sloth-bpp215\SLOTH-BPP215\go2rtc.exe")
    if sloth_g2r.is_file():
        candidates.append(sloth_g2r)

    for cand in candidates:
        if cand.is_file():
            return str(cand.resolve())

    which_g2r = shutil.which("go2rtc")
    return which_g2r or "go2rtc"


_CACHED_GPU_CAPS: Optional[GpuCapabilities] = None


def detect_gpu_capabilities(native_root: Optional[Path] = None, force_refresh: bool = False) -> GpuCapabilities:
    """Probe ONNX Runtime providers, Windows GPU adapters, and FFmpeg encoders (cached)."""
    global _CACHED_GPU_CAPS
    if not force_refresh and _CACHED_GPU_CAPS is not None:
        return _CACHED_GPU_CAPS

    _here = Path(__file__).resolve().parent
    default_native_root = (
        (_here.parents[2] / "native")
        if (_here.name == "native-exe" and len(_here.parents) >= 3)
        else _here
    )
    root = native_root or Path(os.environ.get("BPP_NATIVE_ROOT", str(default_native_root)))
    cache_file = root / "runtime" / "gpu_caps_cache.json"
    current_pc = os.environ.get("COMPUTERNAME", "")
    if not force_refresh and cache_file.is_file():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("vendor") and data.get("computer_name", current_pc) == current_pc:
                clean_data = {k: v for k, v in data.items() if k != "computer_name"}
                _CACHED_GPU_CAPS = GpuCapabilities(**clean_data)
                return _CACHED_GPU_CAPS
        except Exception:
            pass

    gpu_names = detect_windows_gpus()
    joined_gpus = " ".join(gpu_names).lower()

    if "nvidia" in joined_gpus or "geforce" in joined_gpus or "rtx" in joined_gpus or "quadro" in joined_gpus:
        vendor = "nvidia"
    elif "amd" in joined_gpus or "radeon" in joined_gpus:
        vendor = "amd"
    elif "intel" in joined_gpus or "arc" in joined_gpus or "iris" in joined_gpus or "uhd" in joined_gpus:
        vendor = "intel"
    elif gpu_names:
        vendor = "directml"
    else:
        vendor = "cpu"

    ort_avail: List[str] = []
    try:
        import onnxruntime as ort

        ort_avail = list(ort.get_available_providers())
    except Exception:
        ort_avail = ["CPUExecutionProvider"]

    preferred_order = [
        "TensorrtExecutionProvider",
        "CUDAExecutionProvider",
        "DmlExecutionProvider",
        "OpenVINOExecutionProvider",
        "CPUExecutionProvider",
    ]
    ort_selected = [p for p in preferred_order if p in ort_avail]
    if not ort_selected:
        ort_selected = ["CPUExecutionProvider"]

    ffmpeg_bin = resolve_ffmpeg_binary(root)
    enc_out = _run_quiet([ffmpeg_bin, "-hide_banner", "-encoders"], timeout=8)

    ffmpeg_hwaccel = "none"
    ffmpeg_encoder = "libx264"
    go2rtc_hw = "cpu"

    if vendor == "nvidia" and "h264_nvenc" in enc_out:
        ffmpeg_hwaccel = "cuda"
        ffmpeg_encoder = "h264_nvenc"
        go2rtc_hw = "cuda"
    elif vendor == "amd" and "h264_amf" in enc_out:
        ffmpeg_hwaccel = "d3d11va"
        ffmpeg_encoder = "h264_amf"
        go2rtc_hw = "d3d11va"
    elif vendor == "intel" and "h264_qsv" in enc_out:
        ffmpeg_hwaccel = "d3d11va"
        ffmpeg_encoder = "h264_qsv"
        go2rtc_hw = "d3d11va"
    elif "h264_mf" in enc_out and vendor != "cpu":
        ffmpeg_hwaccel = "d3d11va"
        ffmpeg_encoder = "h264_mf"
        go2rtc_hw = "d3d11va"

    _CACHED_GPU_CAPS = GpuCapabilities(
        vendor=vendor,
        gpu_names=gpu_names,
        ort_available_providers=ort_avail,
        ort_selected_providers=ort_selected,
        ffmpeg_path=ffmpeg_bin,
        ffmpeg_hwaccel=ffmpeg_hwaccel,
        ffmpeg_h264_encoder=ffmpeg_encoder,
        go2rtc_hw_profile=go2rtc_hw,
    )
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        payload = _CACHED_GPU_CAPS.to_dict()
        payload["computer_name"] = current_pc
        cache_file.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass
    return _CACHED_GPU_CAPS


def _load_env_file(env_path: Path) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not env_path.is_file():
        return result
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        result[k.strip()] = v.strip().strip('"').strip("'")
    return result


def _substitute_placeholders(value: str, env_map: Dict[str, str]) -> str:
    def _repl(match: re.Match) -> str:
        key = match.group(1)
        return env_map.get(key, os.environ.get(key, match.group(0)))

    resolved = re.sub(r"\{([A-Za-z0-9_]+)\}", _repl, value)
    return resolved.replace("host.docker.internal", "127.0.0.1")


def _get_local_lan_ips() -> List[str]:
    ips: List[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def build_native_go2rtc_config(
    config_yml_path: Path,
    credentials_env_path: Path,
    output_go2rtc_yaml: Path,
    caps: GpuCapabilities,
) -> Path:
    """Generate runtime ``go2rtc.yaml`` for native Windows execution from ``config.yml``."""
    env_map = _load_env_file(credentials_env_path)
    raw_cfg: Dict[str, object] = {}
    if config_yml_path.is_file():
        loaded = yaml.safe_load(config_yml_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            raw_cfg = loaded

    go2rtc_sec = raw_cfg.get("go2rtc") if isinstance(raw_cfg.get("go2rtc"), dict) else {}
    raw_streams = go2rtc_sec.get("streams") if isinstance(go2rtc_sec.get("streams"), dict) else {}

    resolved_streams: Dict[str, object] = {}
    for stream_name, sources in raw_streams.items():
        if sources is None:
            resolved_streams[stream_name] = None
            continue
        if isinstance(sources, str):
            s = _substitute_placeholders(sources, env_map)
            if caps.go2rtc_hw_profile == "cpu":
                s = s.replace("#hardware", "")
            resolved_streams[stream_name] = [s]
        elif isinstance(sources, list):
            out_list = []
            for item in sources:
                if isinstance(item, str):
                    s = _substitute_placeholders(item, env_map)
                    if caps.go2rtc_hw_profile == "cpu":
                        s = s.replace("#hardware", "")
                    out_list.append(s)
                else:
                    out_list.append(item)
            resolved_streams[stream_name] = out_list
        else:
            resolved_streams[stream_name] = sources

    def _is_port_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            return s.connect_ex(("127.0.0.1", port)) == 0

    webrtc_port = 18555 if _is_port_in_use(8555) else 8555
    rtsp_port = 28554 if _is_port_in_use(8554) else 8554
    rtmp_port = 11935 if _is_port_in_use(1935) else 1935

    # Merge WebRTC candidates from config.yml + local LAN IPs
    webrtc_sec = go2rtc_sec.get("webrtc") if isinstance(go2rtc_sec.get("webrtc"), dict) else {}
    raw_candidates = webrtc_sec.get("candidates") if isinstance(webrtc_sec.get("candidates"), list) else []
    candidates: List[str] = []
    for c in raw_candidates:
        if isinstance(c, str) and c not in candidates:
            if webrtc_port != 8555 and c.endswith(":8555") and not c.startswith("stun:"):
                c = c[:-5] + f":{webrtc_port}"
            candidates.append(c)
    for ip in _get_local_lan_ips():
        cand = f"{ip}:{webrtc_port}"
        if cand not in candidates:
            candidates.insert(0, cand)
    if f"127.0.0.1:{webrtc_port}" not in candidates:
        candidates.append(f"127.0.0.1:{webrtc_port}")
    if "stun:8555" not in candidates:
        candidates.append("stun:8555")

    native_go2rtc = {
        "api": {
            "listen": ":1984",
            "origin": "*",
        },
        "rtsp": {
            "listen": f":{rtsp_port}",
        },
        "rtmp": {
            "listen": f":{rtmp_port}",
        },
        "webrtc": {
            "listen": f":{webrtc_port}",
            "candidates": candidates,
        },
        "ffmpeg": {
            "bin": caps.ffmpeg_path.replace("\\", "/"),
            "hls": "-hide_banner -v error -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 -fflags +discardcorrupt -i {input}",
            "rtsp": "-hide_banner -v error -fflags +genpts+discardcorrupt -timeout 30000000 -user_agent go2rtc/ffmpeg -rtsp_transport tcp -i {input}",
        },
        "streams": resolved_streams,
    }

    output_go2rtc_yaml.parent.mkdir(parents=True, exist_ok=True)
    output_go2rtc_yaml.write_text(
        yaml.safe_dump(native_go2rtc, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return output_go2rtc_yaml


if __name__ == "__main__":
    caps = detect_gpu_capabilities()
    print(json.dumps(caps.to_dict(), ensure_ascii=False, indent=2))
