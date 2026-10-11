"""Create deterministic, stopped-by-default Clone and NewSite configurations.

The builder copies only reviewed environment keys. It never prints values and it
always clears node identity, external integration, and federation credentials.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any, NamedTuple

from ruamel.yaml import YAML


class Profile(NamedTuple):
    """One installable configuration, scrubbed environment, and non-secret scope."""

    config: dict[str, Any]
    env: dict[str, str]
    scope: dict[str, Any]


CAMERA_CREDENTIAL = re.compile(r"^FRIGATE_[A-Z0-9_]+_(?:USER|PASS|PASSWORD)$")
RETAINED_ENV_KEYS = {
    "AUTH_COOKIE_SECURE",
    "LPR_ALERT_COOLDOWN",
    "LPR_ALERT_LOCATION",
    "LPR_CAMERAS",
    "LPR_SUSPECT_PLATES",
    "NAS_STORAGE_PATH",
    "STORAGE_MIN_FREE_PERCENT",
}
CLEARED_ENV_KEYS = {
    "AUTH_AUDIT_SHARED_SECRET",
    "BPP_FEDERATION_ALLOW_CIDR",
    "COMPOSE_PROJECT_NAME",
    "DISCORD_BOT_TOKEN",
    "DISCORD_WEBHOOK_URL",
    "DUCKDNS_SUBDOMAIN",
    "DUCKDNS_TOKEN",
    "JWT_SECRET_KEY",
    "LPR_DISCORD_WEBHOOK_URL",
    "LPR_FEDERATION_CA_BUNDLE",
    "LPR_TELEGRAM_BOT_TOKEN",
    "LPR_TELEGRAM_CHAT_ID",
    "NODE_ID",
    "SITE_NAME",
    "TELEGRAM_BOT_TOKEN",
    "WATCHLIST_ALLOWED_ORIGINS",
    "WATCHLIST_FEDERATION_SHARED_SECRET",
    "WATCHLIST_PROXY_SHARED_SECRET",
    "WATCHLIST_SERVICE_SHARED_SECRET",
}


def _validated_config(source: Mapping[str, Any]) -> dict[str, Any]:
    """Return a deep copy only when camera/stream shapes are safe to transform."""

    config = copy.deepcopy(dict(source))
    if not isinstance(config.get("cameras"), dict):
        raise ValueError("source config must contain a cameras mapping")
    go2rtc = config.get("go2rtc")
    if not isinstance(go2rtc, dict) or not isinstance(go2rtc.get("streams"), dict):
        raise ValueError("source config must contain a go2rtc.streams mapping")
    return config


def _disabled_clone_config(source: Mapping[str, Any]) -> dict[str, Any]:
    """Preserve definitions but force every camera writer and detector toggle off."""

    config = _validated_config(source)
    for name, camera in config["cameras"].items():
        if not isinstance(camera, dict):
            raise ValueError(f"camera {name!r} must be a mapping")
        camera["enabled"] = False
        detect = camera.setdefault("detect", {})
        record = camera.setdefault("record", {})
        if not isinstance(detect, dict) or not isinstance(record, dict):
            raise ValueError(f"camera {name!r} detect/record settings must be mappings")
        detect["enabled"] = False
        record["enabled"] = False
    if isinstance(config.get("record"), dict):
        config["record"]["enabled"] = False
    if isinstance(config["go2rtc"].get("webrtc"), dict):
        config["go2rtc"]["webrtc"]["candidates"] = []
    return config


def _new_site_config(source: Mapping[str, Any]) -> dict[str, Any]:
    """Remove every source camera and producer while retaining generic NVR tuning."""

    config = _validated_config(source)
    config["cameras"] = {}
    config["go2rtc"]["streams"] = {}
    if isinstance(config["go2rtc"].get("webrtc"), dict):
        config["go2rtc"]["webrtc"]["candidates"] = []
    if isinstance(config.get("record"), dict):
        config["record"]["enabled"] = False
    return config


def _profile_env(source: Mapping[str, str], *, include_cameras: bool) -> dict[str, str]:
    """Copy reviewed operational values and blank every target-owned integration key."""

    result: dict[str, str] = {}
    for key in sorted(source):
        if key in RETAINED_ENV_KEYS or (include_cameras and CAMERA_CREDENTIAL.fullmatch(key)):
            value = str(source[key])
            if "\r" in value or "\n" in value:
                raise ValueError(f"environment value for {key} contains a newline")
            result[key] = value
    for key in sorted(CLEARED_ENV_KEYS):
        result[key] = ""
    return result


def build_profiles(config: dict[str, Any], env: Mapping[str, str]) -> tuple[Profile, Profile]:
    """Build Clone/NewSite outputs without mutating inputs or revealing values."""

    clone_config = _disabled_clone_config(config)
    new_site_config = _new_site_config(config)
    clone = Profile(
        clone_config,
        _profile_env(env, include_cameras=True),
        {
            "schema": "bpp-site-profile/v1",
            "profile": "clone",
            "cameraCount": len(clone_config["cameras"]),
            "camerasDisabled": True,
            "externalIntegrationsConfigured": False,
        },
    )
    new_site = Profile(
        new_site_config,
        _profile_env(env, include_cameras=False),
        {
            "schema": "bpp-site-profile/v1",
            "profile": "new-site",
            "cameraCount": 0,
            "camerasDisabled": True,
            "externalIntegrationsConfigured": False,
        },
    )
    return clone, new_site


def _read_env(path: Path) -> dict[str, str]:
    """Parse literal dotenv assignments without interpolation or output."""

    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            raise ValueError("source environment contains a malformed assignment")
        key, value = line.split("=", 1)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            raise ValueError("source environment contains an invalid key")
        values[key.strip()] = value
    return values


def _write_profile(root: Path, profile: Profile) -> None:
    """Write one profile atomically enough for a fresh package staging directory."""

    root.mkdir(parents=True, exist_ok=False)
    yaml_writer = YAML()
    yaml_writer.default_flow_style = False
    yaml_writer.allow_unicode = True
    with (root / "config.yml").open("w", encoding="utf-8", newline="\n") as config_file:
        yaml_writer.dump(profile.config, config_file)
    env_text = "\r\n".join(f"{key}={value}" for key, value in profile.env.items()) + "\r\n"
    (root / ".env").write_text(env_text, encoding="utf-8", newline="")
    (root / "scope.json").write_text(
        json.dumps(profile.scope, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    """Transform source files into two separate profile directories."""

    parser = argparse.ArgumentParser(description="Build scrubbed BPP site profiles.")
    parser.add_argument("--source-config", type=Path, required=True)
    parser.add_argument("--source-env", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.output_directory.exists():
        raise FileExistsError("profile output directory already exists")
    yaml_reader = YAML(typ="safe")
    config = yaml_reader.load(args.source_config.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict):
        raise ValueError("source config must be a YAML mapping")
    clone, new_site = build_profiles(config, _read_env(args.source_env))
    args.output_directory.mkdir(parents=True)
    _write_profile(args.output_directory / "clone", clone)
    _write_profile(args.output_directory / "new-site", new_site)
    print("Created scrubbed Clone and NewSite profiles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
