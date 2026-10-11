#!/usr/bin/env python3
"""Recover missing Frigate recording-index rows from retained MP4 files.

The script is deliberately opt-in: without ``--apply`` it only reports the
records it could safely reconstruct. With ``--apply`` it makes a SQLite backup,
then inserts rows only for files with no matching path in Frigate's index. It
never deletes, renames, or transcodes original recording files.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from typing import Iterator


# Frigate names retained segments in UTC as YYYY-MM-DD/HH/camera/MM.SS.mp4.
# Parsing only this fixed structure prevents arbitrary files becoming trusted rows.
RECORDING_SUFFIX = ".mp4"


def parse_args() -> argparse.Namespace:
    """Read explicit recovery options; ``--apply`` is the only write switch."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", default="/db/frigate.db", help="Frigate SQLite database path")
    parser.add_argument("--recordings-root", default="/media/frigate/recordings", help="Retained recording root")
    parser.add_argument("--backup", default="", help="SQLite backup path required by --apply")
    parser.add_argument("--ffprobe", default="", help="ffprobe binary used to read MP4 duration")
    parser.add_argument("--date", default="", help="UTC YYYY-MM-DD to recover in one controlled batch")
    parser.add_argument("--apply", action="store_true", help="Insert validated missing rows after backup")
    return parser.parse_args()


def resolve_ffprobe(preferred: str) -> str:
    """Return an available ffprobe binary, failing closed if media cannot be read."""

    candidates = [preferred, shutil.which("ffprobe"), "/usr/lib/ffmpeg/7.0/bin/ffprobe", "/usr/lib/ffmpeg/5.0/bin/ffprobe"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("ffprobe was not found; refusing to infer MP4 durations")


def iter_recordings(root: Path, selected_date: str) -> Iterator[tuple[Path, str, float]]:
    """Yield only canonical Frigate MP4 paths with camera and UTC start time."""

    for path in root.rglob(f"*{RECORDING_SUFFIX}"):
        try:
            date_part, hour_part, camera, file_name = path.relative_to(root).parts
            # A date filter lets production recovery run in reviewed batches,
            # avoiding a long SQLite write while recent cameras are recording.
            if selected_date and date_part != selected_date:
                continue
            minute_part, second_part, extension = file_name.split(".")
            if extension != "mp4" or not camera or len(minute_part) != 2 or len(second_part) != 2:
                continue
            start = dt.datetime.strptime(
                f"{date_part} {hour_part}:{minute_part}:{second_part}", "%Y-%m-%d %H:%M:%S"
            ).replace(tzinfo=dt.timezone.utc).timestamp()
        except (ValueError, AttributeError):
            # Ignore malformed or manually copied files rather than indexing them.
            continue
        yield path, camera, start


def read_duration(ffprobe: str, path: Path) -> float:
    """Return a verified positive duration from MP4 metadata for one segment."""

    completed = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    duration = float(json.loads(completed.stdout)["format"]["duration"])
    if duration <= 0:
        raise ValueError("duration must be positive")
    return duration


def recording_id(path: Path) -> str:
    """Produce a stable 30-character ID so repeated recoveries remain idempotent."""

    return "recovered-" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:20]


def validated_missing_rows(database: Path, root: Path, ffprobe: str, selected_date: str) -> list[dict[str, object]]:
    """Build rows for extant, unindexed MP4 files without changing SQLite state."""

    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        indexed_paths = {row[0] for row in connection.execute("SELECT path FROM recordings")}
    finally:
        connection.close()

    rows: list[dict[str, object]] = []
    for path, camera, start_time in iter_recordings(root, selected_date):
        path_text = str(path)
        if path_text in indexed_paths:
            continue
        try:
            duration = read_duration(ffprobe, path)
        except (OSError, KeyError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            # A corrupt MP4 is reported but never indexed as available playback.
            print(f"SKIP unreadable {path_text}: {error}", file=sys.stderr)
            continue
        rows.append(
            {
                "id": recording_id(path),
                "camera": camera,
                "path": path_text,
                "start_time": start_time,
                "end_time": start_time + duration,
                "duration": duration,
                # Historical files lack transient detector statistics, so zero means unknown.
                "objects": 0,
                "motion": 0,
                "segment_size": round(path.stat().st_size / (1024 * 1024), 2),
                "dBFS": 0,
                "regions": 0,
            }
        )
    return rows


def backup_and_insert(database: Path, backup: Path, rows: list[dict[str, object]]) -> int:
    """Back up SQLite then insert recovery rows atomically; source media is untouched."""

    backup.parent.mkdir(parents=True, exist_ok=True)
    if backup.exists():
        raise RuntimeError(f"backup already exists: {backup}")
    source = sqlite3.connect(database, timeout=30)
    destination = sqlite3.connect(backup)
    try:
        source.backup(destination)
    finally:
        destination.close()
    columns = "id,camera,path,start_time,end_time,duration,objects,motion,segment_size,dBFS,regions"
    placeholders = ",".join(f":{name}" for name in columns.split(","))
    try:
        source.execute("BEGIN IMMEDIATE")
        source.executemany(f"INSERT OR IGNORE INTO recordings ({columns}) VALUES ({placeholders})", rows)
        source.commit()
        return len(rows)
    except Exception:
        source.rollback()
        raise
    finally:
        source.close()


def main() -> int:
    """Report or apply reconstruction after validating each file and backup path."""

    args = parse_args()
    database, root = Path(args.database), Path(args.recordings_root)
    if not database.is_file() or not root.is_dir():
        raise RuntimeError("database or recordings root is unavailable")
    if args.apply and not args.backup:
        raise RuntimeError("--apply requires --backup so the original index can be restored")
    # Emit this before the full recursive scan so operators can distinguish a
    # large retained archive from a stalled recovery process.
    print("scanning retained MP4 files for missing index rows...", flush=True)
    rows = validated_missing_rows(database, root, resolve_ffprobe(args.ffprobe), args.date)
    print(f"validated_missing_rows={len(rows)}")
    for row in rows:
        print(f"{row['camera']}|{row['start_time']:.3f}|{row['duration']:.3f}|{row['path']}")
    if not args.apply:
        print("dry-run only; pass --apply with --backup after reviewing this report")
        return 0
    inserted = backup_and_insert(database, Path(args.backup), rows)
    print(f"inserted_rows={inserted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
