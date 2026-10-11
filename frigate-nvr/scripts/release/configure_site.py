"""Apply target-local network settings to an already scrubbed site profile."""

from __future__ import annotations

import argparse
import ipaddress
from pathlib import Path

from ruamel.yaml import YAML


def configure_site(config_path: Path, lan_ip_address: str) -> None:
    """Set only the new LAN WebRTC candidate while preserving disabled cameras."""

    address = ipaddress.ip_address(lan_ip_address)
    if address.version != 4 or address.is_loopback or address.is_unspecified:
        raise ValueError("LAN IP address must be a non-loopback IPv4 address")
    yaml = YAML()
    with config_path.open("r", encoding="utf-8-sig") as config_file:
        config = yaml.load(config_file)
    if not isinstance(config, dict) or not isinstance(config.get("go2rtc"), dict):
        raise ValueError("site config must contain go2rtc settings")
    webrtc = config["go2rtc"].setdefault("webrtc", {})
    if not isinstance(webrtc, dict):
        raise ValueError("go2rtc.webrtc must be a mapping")
    webrtc["candidates"] = [f"{address}:8555"]
    with config_path.open("w", encoding="utf-8", newline="\n") as config_file:
        yaml.dump(config, config_file)


def main(argv: list[str] | None = None) -> int:
    """Parse the explicit config/IP interface used by the Windows installer."""

    parser = argparse.ArgumentParser(description="Apply BPP target LAN settings.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--lan-ip-address", required=True)
    args = parser.parse_args(argv)
    configure_site(args.config, args.lan_ip_address)
    print("Applied target-local network settings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
