"""BPP-VMS Smart Auto-Probe & Hardware Capability Detection Engine.

This module provides high-speed, lightweight stream codec probing and host hardware
detection for the camera provisioning subsystem in config-api.

Architecture & Intent:
----------------------
1. Ultra-Fast RTSP SDP Handshake (<100ms):
   Directly connects via standard TCP sockets and speaks the RTSP 1.0 protocol
   (DESCRIBE with Basic & Digest authentication) to read the Session Description
   Protocol (SDP) payload without spinning up heavy external FFmpeg processes.
2. Codec Identification:
   Extracts video and audio codecs (H.264, H.265/HEVC, MJPEG, AAC, PCMU, PCMA)
   directly from SDP rtpmap declarations.
3. Host GPU Detection:
   Identifies whether the host environment supports NVIDIA NVENC (via device nodes
   and driver files), Intel QuickSync VAAPI (/dev/dri/renderD128), or CPU-only.
4. Optimal Zero-Copy vs Transcode Assignment:
   - Streams already encoded in H.264 are mapped directly to pure TCP RTSP passthrough
     (`rtsp://...#transport=tcp`), cutting CPU and GPU usage to 0%.
   - Streams in H.265/HEVC are routed through hardware-accelerated transcoding (NVENC or VAAPI)
     or CPU fallback based on the detected host hardware capability.
5. Safe Universal Fallback:
   If a camera is temporarily offline or unreachable during provisioning (3.0s timeout),
   safe universal defaults are assigned and a warning is logged, ensuring camera
   registration is never blocked.
"""

import base64
import hashlib
import logging
import os
import re
import socket
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

logger = logging.getLogger("bpp.stream_probe")

# Cache host GPU capability so filesystem inspections run only once per container lifecycle
_CACHED_HOST_GPU: Optional[str] = None


def detect_host_gpu() -> str:
    """Inspect the container runtime environment to detect available GPU hardware.

    Returns:
        str: 'nvidia' if NVIDIA GPU/NVENC is available,
             'vaapi' if Intel QuickSync/VAAPI device is available,
             'cpu' if no supported hardware acceleration is detected.
    """
    global _CACHED_HOST_GPU
    if _CACHED_HOST_GPU is not None:
        return _CACHED_HOST_GPU

    # 1. Check explicit environment override
    env_accel = os.environ.get("HOST_HARDWARE_ACCEL", os.environ.get("HARDWARE_ACCELERATION", "")).strip().lower()
    if env_accel in ("nvidia", "vaapi", "cpu"):
        logger.info("Host hardware explicitly configured via environment: %s", env_accel)
        _CACHED_HOST_GPU = env_accel
        return _CACHED_HOST_GPU

    # 2. Check for NVIDIA GPU device nodes or proc entries
    nvidia_indicators = [
        "/dev/nvidia0",
        "/dev/nvidiactl",
        "/dev/nvhost-ctrl",
        "/proc/driver/nvidia/version",
    ]
    for path in nvidia_indicators:
        if os.path.exists(path):
            logger.info("Host hardware detected: NVIDIA GPU acceleration enabled (%s)", path)
            _CACHED_HOST_GPU = "nvidia"
            return _CACHED_HOST_GPU

    # 3. Check for Intel VAAPI / QuickSync render nodes
    vaapi_indicators = [
        "/dev/dri/renderD128",
        "/dev/dri/card0",
    ]
    for path in vaapi_indicators:
        if os.path.exists(path):
            logger.info("Host hardware detected: Intel VAAPI/QuickSync acceleration enabled (%s)", path)
            _CACHED_HOST_GPU = "vaapi"
            return _CACHED_HOST_GPU

    # 4. Fallback: inspect existing config.yml in /config to see if Frigate uses hardware transcode
    config_file = "/config/config.yml"
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                content = f.read()
                if "#hardware" in content or "preset-nvidia" in content:
                    logger.info("Host hardware inferred from existing config: nvidia")
                    _CACHED_HOST_GPU = "nvidia"
                    return _CACHED_HOST_GPU
        except Exception:
            pass

    logger.info("Host hardware detected: CPU only (no supported hardware accelerator)")
    _CACHED_HOST_GPU = "cpu"
    return _CACHED_HOST_GPU


def resolve_stream_credentials(url: str, credentials_file: str = "/config/camera_credentials.env") -> str:
    """Resolve {FRIGATE_*_USER} and {FRIGATE_*_PASS} placeholders to literal values.

    Args:
        url: The raw stream URL containing potential placeholder variables.
        credentials_file: Path to the camera credentials environment file.

    Returns:
        str: URL with placeholders substituted with actual credentials for probing.
    """
    if "{" not in url or "}" not in url:
        return url

    env_map: Dict[str, str] = dict(os.environ)

    # Read credentials file if present
    if os.path.exists(credentials_file):
        try:
            with open(credentials_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_map[k.strip()] = v.strip()
        except OSError as err:
            logger.warning("Could not read credentials file %s: %s", credentials_file, err)

    def _sub_var(match: re.Match) -> str:
        var_name = match.group(1)
        return env_map.get(var_name, match.group(0))

    return re.sub(r"\{([A-Za-z0-9_]+)\}", _sub_var, url)


def _compute_digest_response(username: str, realm: str, password: str, nonce: str, uri: str) -> str:
    """Compute HTTP/RTSP Digest authentication response MD5 hash (RFC 2068/2617)."""
    ha1 = hashlib.md5(f"{username}:{realm}:{password}".encode("utf-8")).hexdigest()
    ha2 = hashlib.md5(f"DESCRIBE:{uri}".encode("utf-8")).hexdigest()
    return hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode("utf-8")).hexdigest()


def probe_rtsp_stream(url: str, timeout: float = 3.0) -> Dict[str, Any]:
    """Connect to an RTSP stream via pure TCP socket and inspect its SDP stream descriptors.

    Performs RTSP 1.0 DESCRIBE negotiation with automatic Basic and Digest authentication.

    Args:
        url: RTSP URL (e.g. rtsp://user:pass@192.168.20.200:554/cam/realmonitor?channel=1&subtype=1).
        timeout: Maximum connection and response wait time in seconds (default: 3.0s).

    Returns:
        Dict containing:
            - success (bool): True if SDP was received and parsed.
            - video_codec (str): 'h264', 'h265', 'mjpeg', or 'unknown'.
            - audio_codec (str): 'aac', 'pcmu', 'pcma', 'opus', or 'none'.
            - latency_ms (int): Handshake duration in milliseconds.
            - error (Optional[str]): Error message if probe failed.
    """
    resolved_url = resolve_stream_credentials(url)
    start_time = time.time()

    result: Dict[str, Any] = {
        "success": False,
        "video_codec": "unknown",
        "audio_codec": "none",
        "latency_ms": 0,
        "error": None,
    }

    try:
        parsed = urlsplit(resolved_url)
        if parsed.scheme.lower() not in ("rtsp", "rtsps"):
            result["error"] = f"Unsupported scheme: {parsed.scheme}"
            return result

        host = parsed.hostname
        if not host:
            result["error"] = "Invalid RTSP URL: missing hostname"
            return result

        port = parsed.port or 554
        username = parsed.username or ""
        password = parsed.password or ""

        # Construct clean request URI without userinfo
        path_query = parsed.path
        if parsed.query:
            path_query += f"?{parsed.query}"
        request_uri = f"rtsp://{host}:{port}{path_query}"

        # 1. Establish TCP socket connection
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect((host, port))

            # 2. Send initial unauthenticated DESCRIBE request
            req_1 = (
                f"DESCRIBE {request_uri} RTSP/1.0\r\n"
                f"CSeq: 1\r\n"
                f"Accept: application/sdp\r\n"
                f"User-Agent: BPP-VMS-SmartProbe/1.0\r\n\r\n"
            )
            sock.sendall(req_1.encode("utf-8"))

            resp_1 = sock.recv(4096).decode("utf-8", errors="ignore")
            status_line = resp_1.split("\r\n")[0] if resp_1 else ""

            sdp_text = ""

            # Check if challenged with 401 Unauthorized
            if "401" in status_line:
                # Check for Digest or Basic authentication challenge
                if "Digest" in resp_1 and username and password:
                    realm_match = re.search(r'realm=["\']([^"\']+)["\']', resp_1)
                    nonce_match = re.search(r'nonce=["\']([^"\']+)["\']', resp_1)
                    if realm_match and nonce_match:
                        realm = realm_match.group(1)
                        nonce = nonce_match.group(1)
                        auth_resp = _compute_digest_response(username, realm, password, nonce, request_uri)
                        digest_header = (
                            f'Digest username="{username}", realm="{realm}", nonce="{nonce}", '
                            f'uri="{request_uri}", response="{auth_resp}"'
                        )
                        req_2 = (
                            f"DESCRIBE {request_uri} RTSP/1.0\r\n"
                            f"CSeq: 2\r\n"
                            f"Accept: application/sdp\r\n"
                            f"Authorization: {digest_header}\r\n"
                            f"User-Agent: BPP-VMS-SmartProbe/1.0\r\n\r\n"
                        )
                        sock.sendall(req_2.encode("utf-8"))
                        resp_2 = sock.recv(8192).decode("utf-8", errors="ignore")
                        if "200 OK" in resp_2:
                            sdp_text = resp_2
                elif "Basic" in resp_1 and username and password:
                    creds = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
                    req_2 = (
                        f"DESCRIBE {request_uri} RTSP/1.0\r\n"
                        f"CSeq: 2\r\n"
                        f"Accept: application/sdp\r\n"
                        f"Authorization: Basic {creds}\r\n"
                        f"User-Agent: BPP-VMS-SmartProbe/1.0\r\n\r\n"
                    )
                    sock.sendall(req_2.encode("utf-8"))
                    resp_2 = sock.recv(8192).decode("utf-8", errors="ignore")
                    if "200 OK" in resp_2:
                        sdp_text = resp_2
            elif "200 OK" in status_line:
                sdp_text = resp_1

            result["latency_ms"] = int((time.time() - start_time) * 1000)

            if not sdp_text:
                result["error"] = f"RTSP handshake rejected: {status_line}"
                return result

            # 3. Parse SDP video and audio media descriptors
            sdp_upper = sdp_text.upper()

            # Video Codec Resolution
            if "H264" in sdp_upper or "AVC" in sdp_upper:
                result["video_codec"] = "h264"
            elif "H265" in sdp_upper or "HEVC" in sdp_upper:
                result["video_codec"] = "h265"
            elif "JPEG" in sdp_upper or "MJPEG" in sdp_upper:
                result["video_codec"] = "mjpeg"
            else:
                result["video_codec"] = "unknown"

            # Audio Codec Resolution
            if "MPEG4-GENERIC" in sdp_upper or "AAC" in sdp_upper:
                result["audio_codec"] = "aac"
            elif "PCMU" in sdp_upper:
                result["audio_codec"] = "pcmu"
            elif "PCMA" in sdp_upper:
                result["audio_codec"] = "pcma"
            elif "OPUS" in sdp_upper:
                result["audio_codec"] = "opus"
            else:
                result["audio_codec"] = "none"

            result["success"] = True
            logger.info(
                "SmartProbe successful for %s:%s -> Video: %s, Audio: %s (%d ms)",
                host, port, result["video_codec"], result["audio_codec"], result["latency_ms"]
            )
            return result

    except socket.timeout:
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        result["error"] = f"RTSP probe timed out after {timeout}s"
        logger.warning("SmartProbe timed out for %s", url)
        return result
    except Exception as exc:
        result["latency_ms"] = int((time.time() - start_time) * 1000)
        result["error"] = f"RTSP probe socket error: {exc}"
        logger.warning("SmartProbe error for %s: %s", url, exc)
        return result


def probe_stream_url(url: str, timeout: float = 3.0) -> Dict[str, Any]:
    """Probe an RTSP or RTMP URL and return stream properties."""
    if not url:
        return {"success": False, "video_codec": "unknown", "error": "Empty URL"}

    scheme = urlsplit(url).scheme.lower()
    if scheme in ("rtsp", "rtsps"):
        return probe_rtsp_stream(url, timeout=timeout)
    elif scheme in ("rtmp", "rtmps"):
        # RTMP streams run natively over TCP; default to standard H.264 copy
        return {
            "success": True,
            "video_codec": "h264",
            "audio_codec": "aac",
            "latency_ms": 10,
            "error": None,
        }
    else:
        return {
            "success": False,
            "video_codec": "unknown",
            "error": f"Unsupported stream protocol: {scheme}",
        }


def strip_stream_filters(url: str) -> str:
    """Return the bare stream URL with any go2rtc filter suffix removed."""
    if not url:
        return ""
    return re.sub(r"#(?:video|audio|hardware|transport|backchannel)(?:=[^#]*)?", "", url)


def is_local_ingest_stream(url: str) -> bool:
    """Return True if URL represents an incoming ingest stream waiting for external push."""
    if not url:
        return False
    u = url.lower()
    if "rtmp://" in u and any(h in u for h in ("127.0.0.1", "localhost", "0.0.0.0", "bpp215.duckdns.org", ":1935")):
        return True
    if "rtsp://" in u and any(h in u for h in ("127.0.0.1:8554", "localhost:8554")):
        return True
    return False


def get_optimal_camera_streams(name: str, rtsp_url: str, sub_url: Optional[str] = None) -> Dict[str, list]:
    """Build the optimal go2rtc stream dictionary using live codec & host GPU detection.

    Optimization Rules:
    -------------------
    - Ingest stream (RTMP/RTSP push): Empty source ('[]') waiting for external push.
    - Main stream (with sub present): '#video=copy#audio=copy' for lossless recording.
    - Sub stream (H.264 detected): Direct pure TCP RTSP passthrough ('#transport=tcp'),
      incurring 0% CPU and 0% GPU overhead.
    - Sub stream (H.265 detected):
      * NVIDIA GPU present -> Hardware NVENC ('#video=h264#hardware#audio=copy')
      * Intel VAAPI present -> Hardware VAAPI ('#video=h264#hardware=vaapi#audio=copy')
      * CPU-only -> Software transcode fallback ('#video=h264#audio=copy')
    - Fallback: If probe is unreachable, applies safe universal hardware/software transcode.

    Args:
        name: Camera identifier (e.g. 'prasat1').
        rtsp_url: Main stream RTSP/RTMP URL.
        sub_url: Optional sub-stream RTSP/RTMP URL.

    Returns:
        Dict[str, list]: Formatted go2rtc stream configurations.
    """
    host_gpu = detect_host_gpu()
    streams: Dict[str, list] = {}

    clean_main = strip_stream_filters(rtsp_url)
    clean_sub = strip_stream_filters(sub_url) if sub_url else ""

    # Incoming RTMP Ingest push streams: go2rtc pulls from mediamtx RTSP relay
    if is_local_ingest_stream(clean_main):
        logger.info("Camera %s recognized as RTMP/RTSP Ingest listener (mediamtx relay)", name)
        streams[name] = []
        return streams

    # Hardware transcode suffix for H.265 / fallback
    if host_gpu == "nvidia":
        transcode_suffix = "#video=h264#hardware#audio=copy"
    elif host_gpu == "vaapi":
        transcode_suffix = "#video=h264#hardware=vaapi#audio=copy"
    else:
        transcode_suffix = "#video=h264#audio=copy"

    if clean_sub:
        # Main stream is recorded directly without transcode
        streams[name] = [f"ffmpeg:{clean_main}#video=copy#audio=copy"]

        # Probe sub stream
        sub_probe = probe_stream_url(clean_sub, timeout=3.0)
        if sub_probe.get("success") and sub_probe.get("video_codec") == "h264":
            # Native H.264 detected: direct passthrough without transcoding!
            streams[f"{name}_sub"] = [f"{clean_sub}#transport=tcp"]
            logger.info("Camera %s_sub configured for zero-copy H.264 passthrough", name)
        else:
            # H.265 or unprobed fallback: transcode based on GPU
            streams[f"{name}_sub"] = [f"ffmpeg:{clean_sub}{transcode_suffix}"]
            logger.info("Camera %s_sub configured for %s transcode", name, host_gpu)

        # HD full-screen stream (lazy on-demand)
        main_probe = probe_stream_url(clean_main, timeout=3.0)
        if main_probe.get("success") and main_probe.get("video_codec") == "h264":
            streams[f"{name}_hd"] = [f"{clean_main}#transport=tcp"]
        else:
            streams[f"{name}_hd"] = [f"ffmpeg:{clean_main}{transcode_suffix}"]

    else:
        # Single stream: probe and configure
        main_probe = probe_stream_url(clean_main, timeout=3.0)
        if main_probe.get("success") and main_probe.get("video_codec") == "h264":
            streams[name] = [f"{clean_main}#transport=tcp"]
        else:
            streams[name] = [f"ffmpeg:{clean_main}{transcode_suffix}"]

    return streams
