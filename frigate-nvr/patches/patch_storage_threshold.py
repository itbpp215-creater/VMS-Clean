"""Patch Frigate's storage maintainer with the BPP free-space guard.

The project deliberately applies this small, version-pinned source patch at image
build time.  It retains Frigate's own deletion path while allowing an operator
to reserve a percentage of the recording disk.
"""

from __future__ import annotations

import sys
from pathlib import Path


# The pinned Frigate image keeps this module at a stable path.  The patch fails
# closed if either this path or the expected source block changes on an upgrade.
TARGET_PATH = Path("/opt/frigate/frigate/storage.py")

# This exact upstream block is the 0.17.2 cleanup decision.  Matching it as one
# block prevents a partially applied patch from silently weakening protection.
UPSTREAM_BLOCK = '''        remaining_storage = round(shutil.disk_usage(RECORD_DIR).free / pow(2, 20), 1)
        logger.debug(
            f"Storage cleanup check: {hourly_bandwidth} hourly with remaining storage: {remaining_storage}."
        )
        return remaining_storage < hourly_bandwidth
'''

# The replacement reads the dashboard override every five-minute maintenance
# cycle, clamps unsafe input, and otherwise preserves Frigate's one-hour floor.
PATCHED_BLOCK = '''        disk_usage = shutil.disk_usage(RECORD_DIR)
        remaining_storage = round(disk_usage.free / pow(2, 20), 1)
        storage_percent = _bpp_storage_min_free_percent()
        percentage_reserve = round(disk_usage.total * storage_percent / 100 / pow(2, 20), 1)
        cleanup_threshold = max(hourly_bandwidth, percentage_reserve)
        logger.debug(
            "Storage cleanup check: "
            f"{hourly_bandwidth} hourly, {storage_percent}% reserve "
            f"({percentage_reserve} MiB), with remaining storage: {remaining_storage}."
        )
        return remaining_storage < cleanup_threshold
'''

# The helper is inserted below the logger declaration, which exists in the pinned
# 0.17.2 source. Unlike a newer bandwidth constant, this anchor is available in
# the actual image and keeps StorageMaintainer free of new services or mounts.
HELPER_INSERTION_ANCHOR = "logger = logging.getLogger(__name__)\n"

HELPER_BLOCK = '''\n\ndef _bpp_storage_min_free_percent() -> float:
    """Return the safe cleanup reserve from runtime file, env, or default.

    The dashboard file wins because it is the operator-facing runtime setting.
    Invalid or unavailable values fall through to the next source, and clamping
    prevents a typo from reserving nearly all storage or disabling protection.
    """

    import os

    candidates = (
        Path("/config/dashboard-settings/storage_threshold"),
        os.environ.get("STORAGE_MIN_FREE_PERCENT", "15"),
    )
    for candidate in candidates:
        try:
            raw_value = candidate.read_text(encoding="utf-8") if isinstance(candidate, Path) else candidate
            return min(90.0, max(5.0, float(raw_value.strip())))
        except (OSError, ValueError, AttributeError):
            continue
    return 15.0
'''


def patch_storage_threshold(target_path: Path = TARGET_PATH) -> None:
    """Apply the exact BPP reserve patch to one Frigate ``storage.py`` file.

    ``target_path`` defaults to the image's pinned source location.  The
    function writes only after every required anchor is present and raises on
    drift, which intentionally stops Docker builds rather than shipping a
    Frigate image without the percentage-reserve behavior.
    """

    source = target_path.read_text(encoding="utf-8")
    if "def _bpp_storage_min_free_percent()" in source:
        raise RuntimeError(f"BPP storage threshold patch is already present: {target_path}")
    if UPSTREAM_BLOCK not in source:
        raise RuntimeError(
            "Frigate storage cleanup source no longer matches the pinned 0.17.2 "
            f"pattern: {target_path}"
        )
    if HELPER_INSERTION_ANCHOR not in source:
        raise RuntimeError(f"Frigate storage helper anchor is missing: {target_path}")

    # Replace the complete decision block and inject the helper atomically in
    # memory so a failed compatibility check leaves upstream source untouched.
    patched = source.replace(UPSTREAM_BLOCK, PATCHED_BLOCK, 1).replace(
        HELPER_INSERTION_ANCHOR,
        HELPER_INSERTION_ANCHOR + HELPER_BLOCK,
        1,
    )
    target_path.write_text(patched, encoding="utf-8")


def main() -> int:
    """Patch the pinned Frigate source and return a shell-compatible status."""

    try:
        patch_storage_threshold()
    except (OSError, RuntimeError) as error:
        print(f"Storage threshold patch failed: {error}", file=sys.stderr)
        return 1
    print("Storage threshold patch applied.")
    return 0


if __name__ == "__main__":
    # Keep the importable patch function testable while Docker invokes this file
    # directly during image construction.
    raise SystemExit(main())
