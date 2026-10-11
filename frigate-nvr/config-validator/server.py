"""Minimal internal HTTP wrapper around Frigate's canonical config parser."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


MAX_CONFIG_BYTES = 2 * 1024 * 1024
LISTEN_PORT = int(os.environ.get("FRIGATE_VALIDATOR_PORT", "5004"))


def validate_payload(payload: str, parser=None) -> bool:
    """Return whether the pinned Frigate parser accepts one YAML document."""

    # Import lazily so lightweight unit tests can inject a fake parser without
    # installing the multi-gigabyte Frigate runtime on the host.
    if parser is None:
        from frigate.config import FrigateConfig

        parser = FrigateConfig.parse_yaml
    try:
        parser(payload)
    except Exception:
        # Parser details may include expanded stream credentials or local paths;
        # only the boolean decision crosses this isolated boundary.
        return False
    return True


class ValidationHandler(BaseHTTPRequestHandler):
    """Serve a bounded validation endpoint without logging candidate content."""

    server_version = "BPPFrigateValidator/1"

    def _write_json(self, status: int, body: dict) -> None:
        """Write one small deterministic JSON response."""

        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        """Expose only a content-free health probe."""

        if self.path != "/health":
            self._write_json(404, {"ok": False})
            return
        self._write_json(200, {"ok": True})

    def do_POST(self) -> None:
        """Validate one YAML body with Frigate's canonical Pydantic parser."""

        if self.path != "/validate":
            self._write_json(404, {"valid": False})
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._write_json(400, {"valid": False})
            return
        if content_length <= 0 or content_length > MAX_CONFIG_BYTES:
            self._write_json(413, {"valid": False})
            return
        try:
            payload = self.rfile.read(content_length).decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            self._write_json(422, {"valid": False})
            return
        if validate_payload(payload):
            self._write_json(200, {"valid": True})
            return
        self._write_json(422, {"valid": False})

    def log_message(self, format_string: str, *args) -> None:
        """Suppress request-line logs at this credential-adjacent boundary."""

        # Even a rejected path can contain attacker-controlled query text. Container
        # health and Config API's sanitized status are sufficient diagnostics.
        del format_string, args


def main() -> None:
    """Run the validator on its internal Compose-only interface."""

    server = HTTPServer(("0.0.0.0", LISTEN_PORT), ValidationHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
