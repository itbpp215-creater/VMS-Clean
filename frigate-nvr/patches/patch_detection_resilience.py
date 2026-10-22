"""Patch Frigate's object processing and tracked object persistence with resilience guards.

Prevents TrackedObjectProcessor thread crash when file writes or callbacks encounter
transient disk/mmap I/O errors (e.g. OSError: [Errno 12] Cannot allocate memory on 9p mounts).
"""

from __future__ import annotations

import sys
from pathlib import Path

OBJECT_PROCESSING_PATH = Path("/opt/frigate/frigate/track/object_processing.py")
TRACKED_OBJECT_PATH = Path("/opt/frigate/frigate/track/tracked_object.py")

# 1. object_processing.py: Wrap camera_state.update in try-except in run() loop
# 0.17 pattern
OP_UPDATE_UPSTREAM_017 = '''            camera_state = self.camera_states[camera]

            camera_state.update(
                frame_name, frame_time, current_tracked_objects, motion_boxes, regions
            )'''

OP_UPDATE_PATCHED_017 = '''            camera_state = self.camera_states[camera]

            try:
                camera_state.update(
                    frame_name, frame_time, current_tracked_objects, motion_boxes, regions
                )
            except Exception as e:
                logger.error(
                    f"Error updating camera state for {camera}: {e}",
                    exc_info=True,
                )'''

# 0.18 pattern
OP_UPDATE_UPSTREAM_018 = '''            camera_state = self.camera_states.get(camera)
            if camera_state is None:
                continue

            camera_state.update(
                frame_name, frame_time, current_tracked_objects, motion_boxes, regions
            )'''

OP_UPDATE_PATCHED_018 = '''            camera_state = self.camera_states.get(camera)
            if camera_state is None:
                continue

            try:
                camera_state.update(
                    frame_name, frame_time, current_tracked_objects, motion_boxes, regions
                )
            except Exception as e:
                logger.error(
                    f"Error updating camera state for {camera}: {e}",
                    exc_info=True,
                )'''

# 2. object_processing.py: Wrap disk write calls in end() callback (0.17 & 0.18)
OP_END_UPSTREAM = '''            # write thumbnail to disk if it will be saved as an event
            if obj.has_snapshot or obj.has_clip:
                obj.write_thumbnail_to_disk()

            # write the snapshot to disk
            if obj.has_snapshot:
                obj.write_snapshot_to_disk()'''

OP_END_PATCHED = '''            # write thumbnail to disk if it will be saved as an event
            if obj.has_snapshot or obj.has_clip:
                try:
                    obj.write_thumbnail_to_disk()
                except Exception as e:
                    logger.error(f"Error writing thumbnail for {obj.obj_data.get('id')}: {e}")

            # write the snapshot to disk
            if obj.has_snapshot:
                try:
                    obj.write_snapshot_to_disk()
                except Exception as e:
                    logger.error(f"Error writing snapshot for {obj.obj_data.get('id')}: {e}")'''

# 3. tracked_object.py: Wrap write_snapshot_to_disk body in try-except
# 0.17 pattern
TO_SNAPSHOT_UPSTREAM_017 = '''    def write_snapshot_to_disk(self) -> None:
        snapshot_config: SnapshotsConfig = self.camera_config.snapshots'''

TO_SNAPSHOT_PATCHED_017 = '''    def write_snapshot_to_disk(self) -> None:
        try:
            self._write_snapshot_to_disk_internal()
        except Exception as e:
            logger.error(f"Unable to write snapshot to disk for {self.obj_data.get('id')}: {e}")

    def _write_snapshot_to_disk_internal(self) -> None:
        snapshot_config: SnapshotsConfig = self.camera_config.snapshots'''

# 0.18 pattern
TO_SNAPSHOT_UPSTREAM_018 = '''    def write_snapshot_to_disk(self) -> None:
        webp_bytes = self.get_clean_webp()'''

TO_SNAPSHOT_PATCHED_018 = '''    def write_snapshot_to_disk(self) -> None:
        try:
            self._write_snapshot_to_disk_internal()
        except Exception as e:
            logger.error(f"Unable to write snapshot to disk for {self.obj_data.get('id')}: {e}")

    def _write_snapshot_to_disk_internal(self) -> None:
        webp_bytes = self.get_clean_webp()'''

# 4. tracked_object.py: Wrap write_thumbnail_to_disk body in try-except (0.17 & 0.18)
TO_THUMB_UPSTREAM = '''    def write_thumbnail_to_disk(self) -> None:
        if not self.camera_config.name:'''

TO_THUMB_PATCHED = '''    def write_thumbnail_to_disk(self) -> None:
        try:
            self._write_thumbnail_to_disk_internal()
        except Exception as e:
            logger.error(f"Unable to write thumbnail to disk for {self.obj_data.get('id')}: {e}")

    def _write_thumbnail_to_disk_internal(self) -> None:
        if not self.camera_config.name:'''


def patch_detection_resilience(
    op_path: Path = OBJECT_PROCESSING_PATH, to_path: Path = TRACKED_OBJECT_PATH
) -> None:
    # Patch object_processing.py
    op_source = op_path.read_text(encoding="utf-8")
    if "Error updating camera state for" in op_source:
        print(f"object_processing.py already patched: {op_path}")
    else:
        op_update_matched = None
        op_update_replacement = None
        if OP_UPDATE_UPSTREAM_018 in op_source:
            op_update_matched = OP_UPDATE_UPSTREAM_018
            op_update_replacement = OP_UPDATE_PATCHED_018
        elif OP_UPDATE_UPSTREAM_017 in op_source:
            op_update_matched = OP_UPDATE_UPSTREAM_017
            op_update_replacement = OP_UPDATE_PATCHED_017
        else:
            raise RuntimeError(f"OP_UPDATE_UPSTREAM anchor not found in {op_path}")

        if OP_END_UPSTREAM not in op_source:
            raise RuntimeError(f"OP_END_UPSTREAM anchor not found in {op_path}")

        op_patched = op_source.replace(op_update_matched, op_update_replacement, 1)
        op_patched = op_patched.replace(OP_END_UPSTREAM, OP_END_PATCHED, 1)
        op_path.write_text(op_patched, encoding="utf-8")
        print(f"Patched {op_path}")

    # Patch tracked_object.py
    to_source = to_path.read_text(encoding="utf-8")
    if "_write_snapshot_to_disk_internal" in to_source:
        print(f"tracked_object.py already patched: {to_path}")
    else:
        to_snapshot_matched = None
        to_snapshot_replacement = None
        if TO_SNAPSHOT_UPSTREAM_018 in to_source:
            to_snapshot_matched = TO_SNAPSHOT_UPSTREAM_018
            to_snapshot_replacement = TO_SNAPSHOT_PATCHED_018
        elif TO_SNAPSHOT_UPSTREAM_017 in to_source:
            to_snapshot_matched = TO_SNAPSHOT_UPSTREAM_017
            to_snapshot_replacement = TO_SNAPSHOT_PATCHED_017
        else:
            raise RuntimeError(f"TO_SNAPSHOT_UPSTREAM anchor not found in {to_path}")

        if TO_THUMB_UPSTREAM not in to_source:
            raise RuntimeError(f"TO_THUMB_UPSTREAM anchor not found in {to_path}")

        to_patched = to_source.replace(to_snapshot_matched, to_snapshot_replacement, 1)
        to_patched = to_patched.replace(TO_THUMB_UPSTREAM, TO_THUMB_PATCHED, 1)
        to_path.write_text(to_patched, encoding="utf-8")
        print(f"Patched {to_path}")


def main() -> int:
    try:
        patch_detection_resilience()
    except (OSError, RuntimeError) as error:
        print(f"Detection resilience patch failed: {error}", file=sys.stderr)
        return 1
    print("Detection resilience patch successfully applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
