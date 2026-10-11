#!/usr/bin/env python3
"""
stream_health_monitor.py — BPP-VMS Stream Health Monitor (Incident 1.56)

ตรวจสอบสถานะ producer ของกล้อง VIGI ทุก 5 วินาที ผ่าน go2rtc API
ถ้าสตรีมไหนมี consumers > 0 แต่ producers == 0 (สตรีม RTMP หลุด)
จะรีเซ็ตสตรีมด้วย DELETE /api/streams เพื่อให้ go2rtc ลอง re-init จาก config.yml

การใช้งาน:
  รันภายใน Docker container frigate-nvr:
  python3 /opt/stream_health_monitor.py

  หรือรันจาก host ด้วย:
  docker exec frigate-nvr python3 /opt/stream_health_monitor.py
"""

import json
import time
import sys
import urllib.request
import urllib.error
import logging

# =============================================================================
# Configuration
# =============================================================================
GO2RTC_API = "http://127.0.0.1:1984"
POLL_INTERVAL = 5            # ตรวจทุก 5 วินาที
GRACE_PERIOD = 15            # รอ 15 วินาทีหลังจาก start ก่อนเริ่มตรวจ (ให้กล้องต่อเสร็จ)
STALE_THRESHOLD = 2          # ต้องตรวจพบ producers=0 ติดต่อกัน N ครั้งก่อน reset (กัน false positive)

# คำนำหน้าของชื่อสตรีม VIGI ที่ต้องการ monitor
VIGI_PREFIXES = ("A04_", "A05_", "A06_", "A18_", "A19_", "A20_")

# =============================================================================
# Logging
# =============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [HEALTH] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("stream_health_monitor")


def api_get(path):
    """GET request to go2rtc API, returns parsed JSON or None on error."""
    try:
        req = urllib.request.Request(f"{GO2RTC_API}{path}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        log.warning("API GET %s failed: %s", path, e)
        return None


def api_delete(path):
    """DELETE request to go2rtc API to reset a stream."""
    try:
        req = urllib.request.Request(f"{GO2RTC_API}{path}", method="DELETE")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status
    except (urllib.error.URLError, OSError) as e:
        log.warning("API DELETE %s failed: %s", path, e)
        return None


def is_vigi_stream(name):
    """ตรวจว่าสตรีมนี้เป็นกล้อง VIGI หรือไม่"""
    return any(name.startswith(prefix) for prefix in VIGI_PREFIXES)


def main():
    log.info("=== BPP-VMS Stream Health Monitor started (Incident 1.56) ===")
    log.info("Monitoring VIGI prefixes: %s", VIGI_PREFIXES)
    log.info("Poll interval: %ds, Grace period: %ds, Stale threshold: %d checks",
             POLL_INTERVAL, GRACE_PERIOD, STALE_THRESHOLD)

    # นับจำนวนครั้งที่ตรวจพบ producers=0 ติดต่อกัน ต่อแต่ละสตรีม
    stale_counts = {}

    # รอ grace period ให้กล้องต่อ RTMP เสร็จก่อน
    log.info("Waiting %ds grace period for cameras to connect...", GRACE_PERIOD)
    time.sleep(GRACE_PERIOD)

    while True:
        try:
            streams = api_get("/api/streams")
            if streams is None:
                time.sleep(POLL_INTERVAL)
                continue

            for name, info in streams.items():
                if not is_vigi_stream(name):
                    continue

                producers = info.get("producers") or []
                consumers = info.get("consumers") or []
                n_prod = len(producers)
                n_cons = len(consumers)

                if n_prod == 0 and n_cons > 0:
                    # สตรีมมีคนดูแต่ไม่มี producer (RTMP หลุด)
                    stale_counts[name] = stale_counts.get(name, 0) + 1
                    log.warning(
                        "⚠️  %s: producers=0, consumers=%d (stale count: %d/%d)",
                        name, n_cons, stale_counts[name], STALE_THRESHOLD,
                    )

                    if stale_counts[name] >= STALE_THRESHOLD:
                        # รีเซ็ตสตรีมเพื่อให้ go2rtc ลอง re-init จาก config.yml
                        log.warning(
                            "🔄 Resetting stream '%s' — producers=0 for %d consecutive checks",
                            name, stale_counts[name],
                        )
                        status = api_delete(f"/api/streams?src={name}")
                        if status:
                            log.info("✅ Stream '%s' reset successful (HTTP %d)", name, status)
                        else:
                            log.error("❌ Stream '%s' reset failed", name)
                        stale_counts[name] = 0

                elif n_prod == 0 and n_cons == 0:
                    # ไม่มีทั้ง producer และ consumer — สตรีมนิ่งปกติ ไม่ต้องทำอะไร
                    stale_counts.pop(name, None)

                else:
                    # มี producer ปกติ — reset counter
                    if name in stale_counts:
                        if stale_counts[name] > 0:
                            log.info("✅ %s: producer recovered (was stale for %d checks)", name, stale_counts[name])
                        stale_counts.pop(name, None)

        except KeyboardInterrupt:
            log.info("Shutting down health monitor...")
            break
        except Exception as e:
            log.error("Unexpected error: %s", e, exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
