#!/usr/bin/env python3
"""
BPP-VMS UniEase / Uniview EZCloud P2P RTSP Bridge Service
=========================================================
Maintains a persistent direct UDP STUN hole-punched P2P tunnel to a Uniview NVR
via the EZCloud OpenAPI and local P2P tunnel engine, exposing a static local
RTSP proxy port (0.0.0.0:18554) for go2rtc / Frigate NVR inside Docker.

Key protocol features handled transparently:
1. Dynamic NVR Password Injection: Automatically signs RTSP Digest/Basic
   Authorization headers using the latest `dynamicPasswordNew` issued by
   EZCloud `/openapi/device/network/nat/list`.
2. ONVIF Backchannel SDP Fix: Strips `Require: www.onvif.org/ver20/backchannel`
   from `DESCRIBE` requests so Uniview NVR302 returns the full Video + Audio SDP
   instead of a two-way-talk audio-only SDP.
3. Continuous 25s NAT Hole-Punch Keepalive & Auto-Heal: Sends periodic RTSP
   `OPTIONS` probes across the P2P tunnel and automatically re-establishes
   `/tunnelStart` if the remote router changes IP or drops the UDP session.
"""

import base64
import hashlib
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from logging.handlers import RotatingFileHandler

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP_ROOT = os.path.join(BASE_DIR, "frigate-nvr")
CRED_ENV_PATH = os.path.join(APP_ROOT, "config", "camera_credentials.env")
RUNTIME_DIR = os.path.join(APP_ROOT, "runtime", "uniease-p2p")
BIN_DIR = os.path.join(RUNTIME_DIR, "bin")
LOG_FILE = os.path.join(RUNTIME_DIR, "uniease_bridge.log")

EZCLOUD_API_BASE = "https://ap.ezcloud.uniview.com"
LOCAL_HTTP_SERVER_URL = "http://127.0.0.1:9999"
PROXY_RTSP_PORT = int(os.environ.get("UNIEASE_PROXY_RTSP_PORT", "18554"))
PROXY_HTTP_PORT = int(os.environ.get("UNIEASE_PROXY_HTTP_PORT", "18080"))

os.makedirs(RUNTIME_DIR, exist_ok=True)
logger = logging.getLogger("UniEaseBridge")
logger.setLevel(logging.INFO)
fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
fh = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8")
fh.setFormatter(fmt)
logger.addHandler(fh)
if sys.stdout is not None:
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)


def load_env_credentials():
    env_vars = {}
    if os.path.exists(CRED_ENV_PATH):
        with open(CRED_ENV_PATH, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip()
    user = os.environ.get("FRIGATE_NONBURI_USER") or env_vars.get("FRIGATE_NONBURI_USER", "")
    password = os.environ.get("FRIGATE_NONBURI_PASS") or env_vars.get("FRIGATE_NONBURI_PASS", "")
    sn = os.environ.get("FRIGATE_NONBURI_SN") or env_vars.get("FRIGATE_NONBURI_SN", "")
    return user, password, sn


class UniEaseTunnelManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.access_token = None
        self.token_time = 0.0
        self.dynamic_password = ""
        self.rtsp_port = 0
        self.http_port = 0
        self.proc = None

    def _post_json(self, url, payload, token=None, timeout=15):
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        }
        if token:
            headers["Authorization"] = token
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def ensure_cloud_token(self, force=False):
        user, password, _ = load_env_credentials()
        if not user or not password:
            raise RuntimeError("Missing FRIGATE_NONBURI_USER / FRIGATE_NONBURI_PASS in camera_credentials.env")
        if not force and self.access_token and (time.time() - self.token_time) < 3600:
            return self.access_token

        m1 = hashlib.md5(password.encode("utf-8")).hexdigest()
        pwd_hash = hashlib.md5((m1 + m1[:8]).encode("utf-8")).hexdigest()
        res = self._post_json(
            f"{EZCLOUD_API_BASE}/openapi/user/account/token/get",
            {
                "username": user,
                "password": pwd_hash,
                "passwordVersion": 1,
                "hardId": "a1b2c3d4e5f60718293a4b5c6d7e8f90Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "platform": "Windows NT 10.0; Win64; x64",
            },
        )
        if res.get("code") != 200:
            raise RuntimeError(f"EZCloud login failed: {res}")
        self.access_token = res["data"]["accessToken"]
        self.token_time = time.time()
        return self.access_token

    def fetch_nat_info(self):
        _, _, sn = load_env_credentials()
        token = self.ensure_cloud_token()
        res = self._post_json(
            f"{EZCLOUD_API_BASE}/openapi/device/network/nat/list",
            {"deviceSerialList": [sn]},
            token=token,
        )
        if res.get("code") != 200:
            token = self.ensure_cloud_token(force=True)
            res = self._post_json(
                f"{EZCLOUD_API_BASE}/openapi/device/network/nat/list",
                {"deviceSerialList": [sn]},
                token=token,
            )
        dev_list = res.get("data", {}).get("deviceList", [])
        if not dev_list:
            raise RuntimeError(f"No NAT info returned for {sn}: {res}")
        nat = dev_list[0]
        if nat.get("dynamicPasswordNew"):
            self.dynamic_password = nat["dynamicPasswordNew"]
        return nat

    def ensure_engine_process(self, force_restart=False):
        exe_path = os.path.join(BIN_DIR, "CloudHttpServer_notime.exe")
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"Missing P2P engine binary: {exe_path}")

        if force_restart:
            if self.proc and self.proc.poll() is None:
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=3)
                except Exception:
                    pass
            subprocess.run(
                ["taskkill", "/F", "/IM", "CloudHttpServer_notime.exe"],
                capture_output=True,
            )
            time.sleep(0.5)

        # Check if port 9999 is already listening
        try:
            with socket.create_connection(("127.0.0.1", 9999), timeout=1.0):
                return
        except OSError:
            pass

        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        self.proc = subprocess.Popen(
            [exe_path],
            cwd=BIN_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        for _ in range(20):
            time.sleep(0.25)
            try:
                with socket.create_connection(("127.0.0.1", 9999), timeout=1.0):
                    logger.info("Started CloudHttpServer_notime.exe (port 9999 ready)")
                    return
            except OSError:
                continue
        raise RuntimeError("CloudHttpServer_notime.exe failed to bind port 9999")

    def establish_tunnel(self, force_restart_engine=False):
        with self.lock:
            self.ensure_engine_process(force_restart=force_restart_engine)
            nat = self.fetch_nat_info()
            sn = nat["deviceSerial"]
            tunnel_req = {
                "deviceSerial": sn,
                "p2pToken": nat["p2pToken"],
                "stunKey": nat["stunKey"],
                "stunServer": nat["stunServer"],
                "connectMode": int(nat["connectMode"]),
                "p2pVersion": nat.get("tunnelExtendParam", {}).get("p2pVersion", "2.2.4.2"),
                "iRequiredPort": 3,
                "checkcode": "749627a5cc96121605f71d78ee83cd21",
                "timestamp": int(time.time()),
                "serverip": "ap.ezcloud.uniview.com",
            }
            t_res = self._post_json(f"{LOCAL_HTTP_SERVER_URL}/tunnelStart", tunnel_req, timeout=15)
            rtsp_port = int(t_res.get("RtspPort") or 0)
            http_port = int(t_res.get("HttpPort") or 0)
            if rtsp_port <= 0:
                raise RuntimeError(f"tunnelStart failed: {t_res}")
            self.rtsp_port = rtsp_port
            self.http_port = http_port
            logger.info(
                "P2P tunnel established -> RtspPort=%d, HttpPort=%d",
                self.rtsp_port,
                self.http_port,
            )
            return self.rtsp_port

    def probe_rtsp_alive(self):
        port = self.rtsp_port
        if port <= 0:
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=4.0) as s:
                s.settimeout(4.0)
                req = f"OPTIONS rtsp://127.0.0.1:{port}/unicast/c1/s1/live RTSP/1.0\r\nCSeq: 1\r\n\r\n"
                s.sendall(req.encode("latin1"))
                data = s.recv(1024)
                return b"RTSP/1.0" in data
        except Exception:
            return False

    def rewrite_client_rtsp(self, data: bytes, conn_state: dict) -> bytes:
        if not data.startswith(
            (
                b"OPTIONS ",
                b"DESCRIBE ",
                b"SETUP ",
                b"PLAY ",
                b"TEARDOWN ",
                b"GET_PARAMETER ",
                b"SET_PARAMETER ",
            )
        ):
            return data
        try:
            text = data.decode("latin1")
            # Strip ONVIF backchannel header so Uniview NVR returns video+audio SDP
            text = text.replace("Require: www.onvif.org/ver20/backchannel\r\n", "")

            # Detect /fast16/ or /fast8/ prefix for high-speed RTSP replay
            m_fast = re.search(r"/fast(4|8|16)/", text)
            if m_fast:
                conn_state["fast_scale"] = f"{m_fast.group(1)}.0"
                text = re.sub(r"/fast(?:4|8|16)/", "/", text)

            first_line = text.split("\r\n", 1)[0]
            parts = first_line.split(" ")
            if len(parts) >= 2:
                method = parts[0]
                req_uri = parts[1]
                if method in ("DESCRIBE", "PLAY"):
                    conn_state["uri"] = req_uri
                if method == "TEARDOWN":
                    conn_state["teardown_sent"] = True

            m_cseq = re.search(r"CSeq:\s*(\d+)", text, re.I)
            if m_cseq:
                conn_state["cseq"] = int(m_cseq.group(1))

            m_sess = re.search(r"Session:\s*([^\r\n;]+)", text, re.I)
            if m_sess:
                conn_state["session"] = m_sess.group(1).strip()

            dyn_pwd = self.dynamic_password
            if dyn_pwd:
                if "Authorization: Digest " in text and 'response="' in text:
                    method = text.split(" ", 1)[0]
                    m_realm = re.search(r'realm="([^"]+)"', text)
                    m_nonce = re.search(r'nonce="([^"]+)"', text)
                    m_uri = re.search(r'uri="([^"]+)"', text)
                    m_resp = re.search(r'response="([^"]+)"', text)
                    if m_realm and m_nonce and m_uri and m_resp:
                        realm = m_realm.group(1)
                        nonce = m_nonce.group(1)
                        uri = m_uri.group(1)
                        old_resp = m_resp.group(1)
                        conn_state["realm"] = realm
                        conn_state["nonce"] = nonce
                        ha1 = hashlib.md5(f"admin:{realm}:{dyn_pwd}".encode("utf-8")).hexdigest()
                        ha2 = hashlib.md5(f"{method}:{uri}".encode("utf-8")).hexdigest()
                        new_resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode("utf-8")).hexdigest()
                        text = text.replace(f'response="{old_resp}"', f'response="{new_resp}"')
                        text = re.sub(r'username="[^"]+"', 'username="admin"', text)
                elif "Authorization: Basic " in text:
                    b64 = base64.b64encode(f"admin:{dyn_pwd}".encode("utf-8")).decode("ascii")
                    text = re.sub(r"Authorization: Basic [^\r\n]+", f"Authorization: Basic {b64}", text)

            if text.startswith("PLAY ") and conn_state.get("fast_scale") and "Scale:" not in text:
                scale = conn_state["fast_scale"]
                text = text[:-2] + f"Scale: {scale}\r\nSpeed: {scale}\r\n\r\n"

            return text.encode("latin1")
        except Exception as e:
            logger.debug("rewrite_client_rtsp error: %s", e)
            return data

    def rewrite_server_rtsp(self, data: bytes, conn_state: dict) -> bytes:
        if data.startswith(b"RTSP/1.0 "):
            try:
                text = data.decode("latin1")
                m_sess = re.search(r"Session:\s*([^\r\n;]+)", text, re.I)
                if m_sess:
                    conn_state["session"] = m_sess.group(1).strip()
                if data.startswith(b"RTSP/1.0 401"):
                    # Force Digest Auth so clients always include realm/nonce/uri
                    text = re.sub(r"WWW-Authenticate: Basic [^\r\n]+\r\n", "", text)
                    return text.encode("latin1")
            except Exception:
                return data
        return data


def handle_client(cli_sock: socket.socket, mgr: UniEaseTunnelManager):
    up_sock = None
    conn_state = {
        "fast_scale": None,
        "uri": None,
        "session": None,
        "cseq": 1,
        "realm": None,
        "nonce": None,
        "teardown_sent": False,
    }
    try:
        if mgr.rtsp_port <= 0:
            mgr.establish_tunnel()
        try:
            up_sock = socket.create_connection(("127.0.0.1", mgr.rtsp_port), timeout=5.0)
        except OSError:
            mgr.establish_tunnel(force_restart_engine=True)
            up_sock = socket.create_connection(("127.0.0.1", mgr.rtsp_port), timeout=5.0)

        def c2s():
            try:
                while True:
                    buf = cli_sock.recv(8192)
                    if not buf:
                        break
                    up_sock.sendall(mgr.rewrite_client_rtsp(buf, conn_state))
            except Exception:
                pass
            finally:
                # Ensure replay sessions always send TEARDOWN and wait briefly so NVR frees the slot
                try:
                    uri = conn_state.get("uri") or ""
                    sess = conn_state.get("session")
                    if "/replay" in uri and sess:
                        if not conn_state.get("teardown_sent"):
                            cseq = conn_state.get("cseq", 5) + 1
                            auth_hdr = ""
                            if conn_state.get("realm") and conn_state.get("nonce") and mgr.dynamic_password:
                                realm = conn_state["realm"]
                                nonce = conn_state["nonce"]
                                ha1 = hashlib.md5(f"admin:{realm}:{mgr.dynamic_password}".encode("utf-8")).hexdigest()
                                ha2 = hashlib.md5(f"TEARDOWN:{uri}".encode("utf-8")).hexdigest()
                                resp = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode("utf-8")).hexdigest()
                                auth_hdr = f'Authorization: Digest username="admin", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{resp}"\r\n'
                            td_req = f"TEARDOWN {uri} RTSP/1.0\r\nCSeq: {cseq}\r\n{auth_hdr}Session: {sess}\r\n\r\n"
                            up_sock.sendall(td_req.encode("latin1"))
                        time.sleep(0.25)
                except Exception:
                    pass
                try:
                    up_sock.shutdown(socket.SHUT_WR)
                except Exception:
                    pass

        def s2c():
            try:
                while True:
                    buf = up_sock.recv(65536)
                    if not buf:
                        break
                    cli_sock.sendall(mgr.rewrite_server_rtsp(buf, conn_state))
            except Exception:
                pass
            finally:
                try:
                    cli_sock.shutdown(socket.SHUT_WR)
                except Exception:
                    pass

        t1 = threading.Thread(target=c2s, daemon=True)
        t2 = threading.Thread(target=s2c, daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception as e:
        logger.warning("Client proxy error: %s", e)
    finally:
        for s in (cli_sock, up_sock):
            if s:
                try:
                    s.close()
                except Exception:
                    pass


def handle_http_client(cli_sock: socket.socket, mgr: UniEaseTunnelManager):
    up_sock = None
    try:
        if mgr.http_port <= 0:
            mgr.establish_tunnel()
        try:
            up_sock = socket.create_connection(("127.0.0.1", mgr.http_port), timeout=5.0)
        except OSError:
            mgr.establish_tunnel(force_restart_engine=True)
            up_sock = socket.create_connection(("127.0.0.1", mgr.http_port), timeout=5.0)

        def c2s():
            try:
                while True:
                    buf = cli_sock.recv(16384)
                    if not buf:
                        break
                    up_sock.sendall(buf)
            except Exception:
                pass
            finally:
                try:
                    up_sock.shutdown(socket.SHUT_WR)
                except Exception:
                    pass

        def s2c():
            try:
                while True:
                    buf = up_sock.recv(65536)
                    if not buf:
                        break
                    cli_sock.sendall(buf)
            except Exception:
                pass
            finally:
                try:
                    cli_sock.shutdown(socket.SHUT_WR)
                except Exception:
                    pass

        t1 = threading.Thread(target=c2s, daemon=True)
        t2 = threading.Thread(target=s2c, daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except Exception:
        pass
    finally:
        for s in (cli_sock, up_sock):
            if s:
                try:
                    s.close()
                except Exception:
                    pass


def http_proxy_loop(mgr: UniEaseTunnelManager):
    try:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", PROXY_HTTP_PORT))
        srv.listen(64)
        logger.info("UniEase HTTP Proxy listening on 0.0.0.0:%d", PROXY_HTTP_PORT)
        while True:
            cli_sock, _ = srv.accept()
            threading.Thread(target=handle_http_client, args=(cli_sock, mgr), daemon=True).start()
    except Exception as e:
        logger.error("HTTP proxy loop error: %s", e)


def watchdog_loop(mgr: UniEaseTunnelManager):
    last_nat_refresh = time.time()
    while True:
        time.sleep(25)
        try:
            if time.time() - last_nat_refresh >= 50:
                mgr.fetch_nat_info()
                last_nat_refresh = time.time()
            if not mgr.probe_rtsp_alive():
                logger.warning("RTSP tunnel probe failed; re-establishing P2P tunnel...")
                try:
                    mgr.establish_tunnel(force_restart_engine=False)
                    if not mgr.probe_rtsp_alive():
                        mgr.establish_tunnel(force_restart_engine=True)
                except Exception:
                    mgr.establish_tunnel(force_restart_engine=True)
        except Exception as e:
            logger.error("Watchdog error: %s", e)


def main():
    logger.info("Starting BPP-VMS UniEase P2P RTSP Bridge on 0.0.0.0:%d", PROXY_RTSP_PORT)
    mgr = UniEaseTunnelManager()
    try:
        mgr.establish_tunnel(force_restart_engine=True)
    except Exception as e:
        logger.error("Initial tunnel setup error (will retry in watchdog): %s", e)

    threading.Thread(target=watchdog_loop, args=(mgr,), daemon=True).start()
    threading.Thread(target=http_proxy_loop, args=(mgr,), daemon=True).start()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", PROXY_RTSP_PORT))
    srv.listen(64)
    logger.info("UniEase RTSP Proxy listening on 0.0.0.0:%d", PROXY_RTSP_PORT)

    while True:
        cli_sock, _ = srv.accept()
        threading.Thread(target=handle_client, args=(cli_sock, mgr), daemon=True).start()


if __name__ == "__main__":
    main()

