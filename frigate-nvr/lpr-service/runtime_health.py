"""Atomic heartbeat writer and container health-check CLI for LPR workers.

The long-running LPR processes do not expose network ports. They publish small
JSON heartbeat files instead, allowing Docker to distinguish a live worker from
a process that exists but is stuck. Writes use ``os.replace`` so health checks
never observe partially written state.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
from pathlib import Path


class RuntimeHeartbeat:
    """Publish process liveness and readiness to one atomic JSON document.

    ``path`` is the persisted heartbeat location and ``service`` identifies its
    owner. ``update`` publishes caller state immediately; ``start`` also refreshes
    the timestamp in a daemon thread. The only side effect is replacing the
    configured heartbeat file.
    """

    def __init__(self, path: str | Path, service: str, interval: float = 10.0):
        """Initialize an unstarted heartbeat with a conservative not-ready state."""

        self.path = Path(path)
        self.service = service
        self.interval = max(1.0, float(interval))
        self._state: dict[str, object] = {"ready": False, "phase": "starting"}
        self._lock = threading.Lock()
        self._started = False

    def _write_locked(self) -> None:
        """Replace the heartbeat atomically while the caller holds ``_lock``."""

        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "service": self.service,
            "pid": os.getpid(),
            "heartbeat_epoch": time.time(),
            **self._state,
        }
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self.path.name}-", suffix=".tmp", dir=self.path.parent
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, self.path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    def update(self, **fields: object) -> None:
        """Merge state fields and publish them immediately for Docker and operators."""

        with self._lock:
            self._state.update(fields)
            self._write_locked()

    def start(self) -> None:
        """Start one daemon refresher; repeated calls are intentionally harmless."""

        if self._started:
            return
        self._started = True
        self.update()

        def refresh() -> None:
            """Refresh liveness without changing caller-owned readiness fields."""

            while True:
                time.sleep(self.interval)
                try:
                    self.update()
                except OSError:
                    # A missing or stale file deliberately makes Docker report
                    # unhealthy; the main service retains operational logging.
                    pass

        threading.Thread(
            target=refresh,
            name=f"{self.service}-heartbeat",
            daemon=True,
        ).start()


def check_heartbeat(path: str | Path, max_age: float, require_upstream: bool) -> int:
    """Return zero only for a fresh, ready heartbeat with optional upstream health."""

    heartbeat_path = Path(path)
    try:
        payload = json.loads(heartbeat_path.read_text(encoding="utf-8"))
        age = time.time() - float(payload["heartbeat_epoch"])
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return 1
    if age < 0 or age > max_age or payload.get("ready") is not True:
        return 1
    if require_upstream and payload.get("upstream_ok") is not True:
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    """Parse Docker health-check arguments and return a shell-compatible status."""

    parser = argparse.ArgumentParser(description="Validate an LPR worker heartbeat")
    parser.add_argument("path")
    parser.add_argument("--max-age", type=float, default=45.0)
    parser.add_argument("--require-upstream", action="store_true")
    args = parser.parse_args(argv)
    return check_heartbeat(args.path, args.max_age, args.require_upstream)


if __name__ == "__main__":
    raise SystemExit(main())
