"""Patch Frigate's go2rtc config generator to read /config/camera_credentials.env dynamically.

Ensures that whenever an operator adds a new camera via the Web UI, go2rtc can
resolve new {FRIGATE_CAM_*} placeholders without requiring a manual Docker container recreate.
"""

from __future__ import annotations

import sys
from pathlib import Path

CREATE_CONFIG_PATH = Path("/usr/local/go2rtc/create_config.py")

ANCHOR_UPSTREAM = '''# read docker secret files as env vars too
if os.path.isdir("/run/secrets"):
    for secret_file in os.listdir("/run/secrets"):
        if secret_file.startswith("FRIGATE_"):
            FRIGATE_ENV_VARS[secret_file] = (
                Path(os.path.join("/run/secrets", secret_file)).read_text().strip()
            )'''

ANCHOR_PATCHED = '''# read docker secret files as env vars too
if os.path.isdir("/run/secrets"):
    for secret_file in os.listdir("/run/secrets"):
        if secret_file.startswith("FRIGATE_"):
            FRIGATE_ENV_VARS[secret_file] = (
                Path(os.path.join("/run/secrets", secret_file)).read_text().strip()
            )

# read camera_credentials.env from /config if available (dynamic reload without container recreate)
camera_env_path = Path("/config/camera_credentials.env")
if camera_env_path.is_file():
    for line in camera_env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip("\'\\\"")
            if k.startswith("FRIGATE_"):
                FRIGATE_ENV_VARS[k] = v'''


def patch_go2rtc_env_reload(target_path: Path = CREATE_CONFIG_PATH) -> None:
    source = target_path.read_text(encoding="utf-8")
    if "camera_credentials.env from /config" in source:
        print(f"create_config.py already patched: {target_path}")
        return

    if ANCHOR_UPSTREAM not in source:
        raise RuntimeError(f"ANCHOR_UPSTREAM not found in {target_path}")

    patched = source.replace(ANCHOR_UPSTREAM, ANCHOR_PATCHED, 1)
    target_path.write_text(patched, encoding="utf-8")
    print(f"Successfully patched {target_path}")


def main() -> int:
    try:
        patch_go2rtc_env_reload()
    except (OSError, RuntimeError) as error:
        print(f"go2rtc env reload patch failed: {error}", file=sys.stderr)
        return 1
    print("go2rtc env reload patch successfully applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
