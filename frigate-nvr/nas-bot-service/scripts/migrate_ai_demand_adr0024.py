"""ADR-0024 one-time migration: align every saved channel's `detect` flag with live Frigate AI state.

Run inside nas-bot-service:  python /app/scripts/migrate_ai_demand_adr0024.py [--apply]
Without --apply it only prints what would change.
"""
import json
import os
import shutil
import sys
import time
import urllib.request

PROFILES = "/data/user_profiles.json"
FRIGATE_CONFIG = os.environ.get("FRIGATE_CONFIG_URL", "http://frigate:5000/api/config")


def live_ai_state():
    # nas-bot-service is not on Frigate's network; accept an exported /api/config JSON instead.
    live_json = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--live-json=")), None)
    if live_json:
        cfg = json.load(open(live_json, encoding="utf-8"))
    else:
        with urllib.request.urlopen(FRIGATE_CONFIG, timeout=15) as r:
            cfg = json.loads(r.read().decode("utf-8"))
    state = {}
    for name, cam in (cfg.get("cameras") or {}).items():
        enabled = cam.get("enabled", True) is not False
        detect = (cam.get("detect") or {}).get("enabled", True) is not False
        state[name] = bool(enabled and detect)
    return state


def main():
    apply = "--apply" in sys.argv
    live = live_ai_state()
    profiles = json.load(open(PROFILES, encoding="utf-8"))
    changes = []
    for user, p in profiles.items():
        for i, c in enumerate(p.get("channels") or []):
            if not isinstance(c, dict) or not c.get("src"):
                continue
            want = live.get(str(c["src"]), False)
            if c.get("detect") is not want:
                changes.append((user, i, c["src"], c.get("detect"), want))
                if apply:
                    c["detect"] = want
    print(f"live cameras: {len(live)}  AI-on in Frigate: {sum(live.values())}")
    print(f"channel flags to change: {len(changes)}")
    for user, i, src, old, new in changes[:80]:
        print(f"  {user} ch{i + 1:02d} {src}: {old} -> {new}")
    if apply and changes:
        backup = f"{PROFILES}.bak-adr0024-{int(time.time())}"
        shutil.copy2(PROFILES, backup)
        json.dump(profiles, open(PROFILES, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("backup:", backup)
        print("APPLIED")
    elif not apply:
        print("dry-run only (use --apply)")


if __name__ == "__main__":
    main()
