"""Coordinate safe i2 Analyst's Notebook import jobs across Docker and Windows.

The Linux nas-bot container archives uploads and publishes small JSON job descriptors
to a bind-mounted bridge directory.  A Windows helper running under the licensed i2
user opens ``.anb`` files through IBM's registered COM Automation API and writes a
normalized JSON result.  This manager validates that result, exposes a review preview,
and applies or rolls back each dataset without editing dossiers automatically.
"""

from __future__ import annotations

import copy
import datetime as dt
try:
    from _sha256 import sha256
except ImportError:  # Windows builds expose SHA-256 through hashlib instead.
    from hashlib import sha256
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, BinaryIO, Dict, Iterable, List, Mapping, Optional, Tuple

from services.i2_graph_store import I2GraphStateError, I2GraphStore


_CFB_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
_MAX_UPLOAD_BYTES = int(os.getenv("I2_IMPORT_MAX_BYTES", str(100 * 1024 * 1024)))
_MAX_GRAPH_ITEMS = int(os.getenv("I2_IMPORT_MAX_ITEMS", "250000"))
_JOB_TIMEOUT_HOURS = int(os.getenv("I2_BRIDGE_JOB_TIMEOUT_HOURS", "24"))


def _utc_now() -> str:
    """Return an ISO UTC timestamp shared by import and bridge state records."""

    return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_filename(filename: str) -> str:
    """Remove path/control characters while retaining a useful audit display name."""

    base = Path(filename or "chart.anb").name
    clean = re.sub(r"[^\w.()\- ]+", "_", base, flags=re.UNICODE).strip(" .")
    return (clean or "chart.anb")[:180]


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    """Publish one complete bridge descriptor/result metadata file atomically."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staged_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(staged_name, path)
    finally:
        if os.path.exists(staged_name):
            os.unlink(staged_name)


class I2UploadWriter:
    """Stream one upload to permanent NAS archive and Windows bridge staging.

    The caller writes chunks, then calls ``finish`` exactly once.  On failure ``abort``
    closes handles but intentionally retains any raw archive fragment for forensic review;
    the job metadata marks it failed and never exposes it to the graph.
    """

    def __init__(self, archive_path: Path, staging_path: Path) -> None:
        """Open the two isolated destinations and initialize hash/size accounting."""

        archive_path.parent.mkdir(parents=True, exist_ok=True)
        staging_path.parent.mkdir(parents=True, exist_ok=True)
        self.archive_path = archive_path
        self.staging_path = staging_path
        self._archive: BinaryIO = archive_path.open("wb")
        self._staging: BinaryIO = staging_path.open("wb")
        self._hash = sha256()
        self.size = 0
        self._closed = False
        self._head = bytearray()

    def write(self, chunk: bytes) -> None:
        """Write one bounded chunk to both copies and update integrity metadata."""

        if self._closed:
            raise RuntimeError("upload writer is closed")
        if not chunk:
            return
        self.size += len(chunk)
        if self.size > _MAX_UPLOAD_BYTES:
            raise I2GraphStateError("i2 upload exceeds configured size limit")
        if len(self._head) < len(_CFB_SIGNATURE):
            needed = len(_CFB_SIGNATURE) - len(self._head)
            self._head.extend(chunk[:needed])
        self._hash.update(chunk)
        self._archive.write(chunk)
        self._staging.write(chunk)

    def finish(self) -> Tuple[int, str]:
        """Validate CFB signature, fsync both copies, and return size plus SHA-256."""

        if bytes(self._head) != _CFB_SIGNATURE:
            self.abort()
            raise I2GraphStateError("uploaded file is not an IBM i2 .anb compound document")
        for handle in (self._archive, self._staging):
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
        self._closed = True
        return self.size, self._hash.hexdigest()

    def abort(self) -> None:
        """Close both handles after a failed upload without publishing a bridge job."""

        if self._closed:
            return
        for handle in (self._archive, self._staging):
            try:
                handle.close()
            except OSError:
                pass
        self._closed = True


class I2ImportManager:
    """Own upload queue, normalized datasets, preview/apply, and batch rollback."""

    def __init__(
        self,
        graph_store: I2GraphStore,
        nas_root: str,
        bridge_root: Optional[str] = None,
    ) -> None:
        """Create required private roots without launching i2 or processing a job."""

        self.graph_store = graph_store
        self.archive_root = Path(nas_root) / "I2Imports"
        self.bridge_root = Path(bridge_root or os.getenv("I2_BRIDGE_ROOT", "/i2-bridge"))
        self.jobs_root = self.bridge_root / "jobs"
        self.inbox_root = self.bridge_root / "inbox"
        self.outbox_root = self.bridge_root / "outbox"
        self._lock = threading.RLock()
        self._normalized_cache: OrderedDict[str, Tuple[float, Dict[str, Any]]] = OrderedDict()
        self._normalized_cache_max = 5
        for path in (
            self.archive_root,
            self.jobs_root / "pending",
            self.jobs_root / "processing",
            self.jobs_root / "done",
            self.inbox_root,
            self.outbox_root,
        ):
            path.mkdir(parents=True, exist_ok=True)

    def begin_upload(self, filename: str, actor: str) -> Tuple[str, I2UploadWriter]:
        """Allocate a stable import ID and return a streaming dual-destination writer."""

        safe_name = _safe_filename(filename)
        if Path(safe_name).suffix.lower() != ".anb":
            raise I2GraphStateError("phase one accepts .anb files only")
        import_id = f"i2_{uuid.uuid4().hex}"
        archive_dir = self.archive_root / import_id
        archive_path = archive_dir / safe_name
        staging_path = self.inbox_root / f"{import_id}.anb"
        record = {
            "import_id": import_id,
            "filename": safe_name,
            "status": "uploading",
            "created_at": _utc_now(),
            "created_by": actor,
            "archive_relative_path": str(archive_path.relative_to(self.archive_root)),
        }
        self.graph_store.set_import_record(import_id, record, actor)
        return import_id, I2UploadWriter(archive_path, staging_path)

    def finalize_upload(self, import_id: str, size: int, sha256: str, actor: str) -> Dict[str, Any]:
        """Deduplicate by content hash or publish a pending Windows bridge descriptor."""

        with self._lock:
            snapshot = self.graph_store.snapshot()
            existing = snapshot.get("imports", {})
            duplicate_of = next(
                (
                    other_id
                    for other_id, item in existing.items()
                    if other_id != import_id
                    and item.get("sha256") == sha256
                    and item.get("status") in {"queued", "processing", "ready_preview", "applied"}
                ),
                None,
            )
            base = dict(existing.get(import_id, {}))
            base.update({"size": size, "sha256": sha256, "uploaded_at": _utc_now()})
            if duplicate_of:
                base.update({"status": "duplicate", "duplicate_of": duplicate_of})
                return self.graph_store.set_import_record(import_id, base, actor)
            descriptor = {
                "schema_version": 1,
                "job_id": import_id,
                "input_file": f"inbox/{import_id}.anb",
                "output_file": f"outbox/{import_id}.json",
                "created_at": _utc_now(),
                "timeout_hours": _JOB_TIMEOUT_HOURS,
                "max_items": _MAX_GRAPH_ITEMS,
            }
            _atomic_json(self.jobs_root / "pending" / f"{import_id}.json", descriptor)
            base.update({"status": "queued", "queued_at": _utc_now()})
            return self.graph_store.set_import_record(import_id, base, actor)

    def fail_upload(self, import_id: str, actor: str) -> None:
        """Mark a partial raw upload failed without exposing lower-level exception text."""

        snapshot = self.graph_store.snapshot()
        record = dict(snapshot.get("imports", {}).get(import_id, {}))
        record.update({"status": "upload_failed", "failed_at": _utc_now()})
        self.graph_store.set_import_record(import_id, record, actor)

    @staticmethod
    def _validate_bridge_payload(payload: Any, import_id: str) -> Dict[str, Any]:
        """Validate bridge JSON shape/counts before it can become a reviewable dataset."""

        if not isinstance(payload, dict) or payload.get("schema_version") not in (1, 2):
            raise I2GraphStateError("unsupported i2 bridge result")
        if payload.get("job_id") != import_id or payload.get("status") != "converted":
            raise I2GraphStateError("i2 bridge result does not match the import job")
        nodes = payload.get("nodes")
        edges = payload.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise I2GraphStateError("i2 bridge result has invalid graph collections")
        if len(nodes) + len(edges) > _MAX_GRAPH_ITEMS:
            raise I2GraphStateError("i2 bridge result exceeds configured item limit")
        node_ids = set()
        for node in nodes:
            if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
                raise I2GraphStateError("i2 bridge result contains an invalid node")
            if node["id"] in node_ids:
                raise I2GraphStateError("i2 bridge result contains duplicate node IDs")
            node_ids.add(node["id"])
            photo_path = node.get("photo_path")
            if photo_path:
                norm_photo = str(photo_path).replace("\\", "/").strip()
                if ".." in norm_photo or norm_photo.startswith("/"):
                    node["photo_path"] = None
                else:
                    node["photo_path"] = norm_photo
        for edge in edges:
            if not isinstance(edge, dict) or edge.get("from") not in node_ids or edge.get("to") not in node_ids:
                raise I2GraphStateError("i2 bridge result contains an invalid edge")
        return copy.deepcopy(payload)

    def reconcile(self, import_id: str, actor: str = "system") -> Dict[str, Any]:
        """Observe bridge progress/result and update only sanitized import metadata."""

        with self._lock:
            snapshot = self.graph_store.snapshot()
            record = dict(snapshot.get("imports", {}).get(import_id, {}))
            if not record:
                raise KeyError(import_id)

            normalized_path = self.archive_root / import_id / "normalized-graph.json"
            result_path = self.outbox_root / f"{import_id}.json"
            if result_path.exists() and normalized_path.exists():
                try:
                    if result_path.stat().st_mtime > normalized_path.stat().st_mtime:
                        with result_path.open("r", encoding="utf-8") as handle:
                            payload = self._validate_bridge_payload(json.load(handle), import_id)
                        _atomic_json(normalized_path, payload)
                        record["node_count"] = len(payload["nodes"])
                        record["edge_count"] = len(payload["edges"])
                        self.graph_store.set_import_record(import_id, record, actor)
                except Exception:
                    pass

            if record.get("status") in {"applied", "rolled_back", "duplicate", "bridge_failed"}:
                return record
            processing_path = self.jobs_root / "processing" / f"{import_id}.json"
            result_path = self.outbox_root / f"{import_id}.json"
            error_path = self.outbox_root / f"{import_id}.error.json"
            if error_path.exists():
                record.update({"status": "bridge_failed", "failed_at": _utc_now(), "retryable": True})
                return self.graph_store.set_import_record(import_id, record, actor)
            if result_path.exists():
                try:
                    with result_path.open("r", encoding="utf-8") as handle:
                        payload = self._validate_bridge_payload(json.load(handle), import_id)
                except (OSError, json.JSONDecodeError) as exc:
                    raise I2GraphStateError("i2 bridge result is unreadable") from exc
                normalized_path = self.archive_root / import_id / "normalized-graph.json"
                _atomic_json(normalized_path, payload)
                record.update(
                    {
                        "status": "ready_preview",
                        "converted_at": payload.get("converted_at") or _utc_now(),
                        "node_count": len(payload["nodes"]),
                        "edge_count": len(payload["edges"]),
                        "warnings": list(payload.get("warnings") or [])[:100],
                        "normalized_relative_path": str(normalized_path.relative_to(self.archive_root)),
                    }
                )
                return self.graph_store.set_import_record(import_id, record, actor)
            if processing_path.exists() and record.get("status") != "processing":
                record.update({"status": "processing", "processing_at": _utc_now()})
                return self.graph_store.set_import_record(import_id, record, actor)
            queued_at = record.get("queued_at")
            if queued_at:
                try:
                    queued_time = dt.datetime.fromisoformat(queued_at)
                    age = dt.datetime.now(dt.timezone.utc) - queued_time
                    if age >= dt.timedelta(hours=_JOB_TIMEOUT_HOURS):
                        record.update({"status": "bridge_failed", "failed_at": _utc_now(), "retryable": True})
                        return self.graph_store.set_import_record(import_id, record, actor)
                except ValueError:
                    pass
            if record.get("status") == "processing":
                progress_path = self.bridge_root / "progress.json"
                if progress_path.exists():
                    try:
                        with progress_path.open("r", encoding="utf-8") as pf:
                            prog = json.load(pf)
                            if prog.get("job_id") == import_id:
                                record["progress"] = prog
                    except Exception:
                        pass
                processing_at = record.get("processing_at")
                if processing_at:
                    try:
                        proc_time = dt.datetime.fromisoformat(processing_at)
                        age = dt.datetime.now(dt.timezone.utc) - proc_time
                        if age >= dt.timedelta(hours=_JOB_TIMEOUT_HOURS):
                            record.update({"status": "bridge_failed", "failed_at": _utc_now(), "retryable": True, "error_type": "ProcessingWatchdogTimeout"})
                            return self.graph_store.set_import_record(import_id, record, actor)
                    except ValueError:
                        pass
            return record

    def get_import(self, import_id: str, actor: str = "system") -> Dict[str, Any]:
        """Return current sanitized job metadata after reconciling observable bridge state."""

        return self.reconcile(import_id, actor=actor)

    def list_imports(self, actor: str = "system") -> List[Dict[str, Any]]:
        """Reconcile and return newest-first jobs without normalized graph contents."""

        snapshot = self.graph_store.snapshot()
        records = []
        for import_id, stored in snapshot.get("imports", {}).items():
            try:
                records.append(self.reconcile(import_id, actor=actor))
            except I2GraphStateError:
                # One malformed bridge result must not hide the other import jobs.
                records.append(copy.deepcopy(stored))
        return sorted(records, key=lambda item: item.get("created_at", ""), reverse=True)

    def retry(self, import_id: str, actor: str) -> Dict[str, Any]:
        """Republish a retryable failed job while retaining the prior error file."""

        with self._lock:
            snapshot = self.graph_store.snapshot()
            record = dict(snapshot.get("imports", {}).get(import_id, {}))
            if not record:
                raise KeyError(import_id)
            if record.get("status") != "bridge_failed" or not record.get("retryable"):
                raise I2GraphStateError("i2 import is not retryable")
            if not (self.inbox_root / f"{import_id}.anb").exists():
                raise I2GraphStateError("i2 bridge input is unavailable")
            error_path = self.outbox_root / f"{import_id}.error.json"
            if error_path.exists():
                retained = self.outbox_root / f"{import_id}.{uuid.uuid4().hex[:8]}.previous-error.json"
                error_path.replace(retained)
            descriptor = {
                "schema_version": 1, "job_id": import_id,
                "input_file": f"inbox/{import_id}.anb",
                "output_file": f"outbox/{import_id}.json",
                "created_at": _utc_now(), "timeout_hours": _JOB_TIMEOUT_HOURS,
                "max_items": _MAX_GRAPH_ITEMS,
            }
            _atomic_json(self.jobs_root / "pending" / f"{import_id}.json", descriptor)
            record.update({
                "status": "queued", "queued_at": _utc_now(), "retryable": False,
                "retry_count": int(record.get("retry_count", 0)) + 1,
            })
            return self.graph_store.set_import_record(import_id, record, actor)

    def preview(self, import_id: str, actor: str) -> Dict[str, Any]:
        """Return counts, warnings, and bounded samples without applying graph entities."""

        record = self.reconcile(import_id, actor=actor)
        if record.get("status") != "ready_preview":
            raise I2GraphStateError("i2 import is not ready for preview")
        payload = self._read_normalized(record)
        return {
            "import": record,
            "node_sample": payload["nodes"][:50],
            "edge_sample": payload["edges"][:50],
            "style_summary": payload.get("style_summary", {}),
            "mapping_warnings": payload.get("warnings", []),
        }

    def _read_normalized(self, record: Mapping[str, Any]) -> Dict[str, Any]:
        """Resolve and validate one normalized payload strictly beneath the archive root."""

        relative = record.get("normalized_relative_path")
        if not relative:
            raise I2GraphStateError("i2 import has no normalized dataset")
        path = (self.archive_root / str(relative)).resolve()
        archive_root = self.archive_root.resolve()
        if archive_root not in path.parents:
            raise I2GraphStateError("invalid normalized dataset path")
        cache_key = str(path)
        try:
            mtime = path.stat().st_mtime
            if hasattr(self, "_normalized_cache") and cache_key in self._normalized_cache:
                cached_mtime, cached_payload = self._normalized_cache[cache_key]
                if cached_mtime == mtime:
                    self._normalized_cache.move_to_end(cache_key)
                    return cached_payload
            with path.open("r", encoding="utf-8") as handle:
                payload = self._validate_bridge_payload(json.load(handle), str(record.get("import_id")))
                if not hasattr(self, "_normalized_cache"):
                    self._normalized_cache = OrderedDict()
                self._normalized_cache[cache_key] = (mtime, payload)
                self._normalized_cache.move_to_end(cache_key)
                while len(self._normalized_cache) > getattr(self, "_normalized_cache_max", 5):
                    self._normalized_cache.popitem(last=False)
                return payload
        except (OSError, json.JSONDecodeError) as exc:
            raise I2GraphStateError("normalized i2 dataset is unreadable") from exc

    def apply(self, import_id: str, actor: str) -> Dict[str, Any]:
        """Make a reviewed or rolled-back normalized dataset visible without reconverting evidence."""

        record = self.reconcile(import_id, actor=actor)
        if record.get("status") == "applied":
            return record
        if record.get("status") not in {"ready_preview", "rolled_back"}:
            raise I2GraphStateError("i2 import is not ready to apply")
        self._read_normalized(record)
        applied_at = _utc_now()
        # A Restore reuses the retained reviewed JSON, preserving its original
        # evidence and recording the separate authorization to make it visible again.
        if record.get("status") == "rolled_back":
            record.update({"restored_at": applied_at, "restored_by": actor})
        record.update({"status": "applied", "applied_at": applied_at, "applied_by": actor})
        return self.graph_store.set_import_record(import_id, record, actor)

    def rollback_preview(self, import_id: str) -> Dict[str, Any]:
        """Report the exact imported batch hidden by rollback; shared data stays intact."""

        snapshot = self.graph_store.snapshot()
        record = dict(snapshot.get("imports", {}).get(import_id, {}))
        if not record:
            raise KeyError(import_id)
        if record.get("status") != "applied":
            raise I2GraphStateError("only an applied i2 import has rollback impact")
        payload = self._read_normalized(record)
        return {
            "import_id": import_id, "node_count": len(payload.get("nodes", [])),
            "edge_count": len(payload.get("edges", [])), "raw_retained": True,
            "normalized_retained": True, "shared_dossiers_and_cdr_retained": True,
        }

    def rollback(self, import_id: str, actor: str) -> Dict[str, Any]:
        """Deactivate one applied dataset while retaining raw/normalized archive and audit."""

        snapshot = self.graph_store.snapshot()
        record = dict(snapshot.get("imports", {}).get(import_id, {}))
        if not record:
            raise KeyError(import_id)
        if record.get("status") != "applied":
            raise I2GraphStateError("only an applied i2 import can be rolled back")
        record.update({"status": "rolled_back", "rolled_back_at": _utc_now(), "rolled_back_by": actor})
        return self.graph_store.set_import_record(import_id, record, actor)

    def applied_graphs(self) -> Iterable[Tuple[Mapping[str, Any], Dict[str, Any]]]:
        """Yield validated applied datasets with their provenance metadata for graph assembly."""

        snapshot = self.graph_store.snapshot()
        for record in snapshot.get("imports", {}).values():
            if record.get("status") == "applied":
                import_id = record.get("import_id")
                if import_id:
                    result_path = self.outbox_root / f"{import_id}.json"
                    normalized_path = self.archive_root / import_id / "normalized-graph.json"
                    if result_path.exists() and normalized_path.exists():
                        try:
                            if result_path.stat().st_mtime > normalized_path.stat().st_mtime:
                                with result_path.open("r", encoding="utf-8") as handle:
                                    payload = self._validate_bridge_payload(json.load(handle), import_id)
                                _atomic_json(normalized_path, payload)
                        except Exception:
                            pass
                try:
                    yield record, self._read_normalized(record)
                except Exception:
                    continue

    def get_import_payload(self, import_id: str) -> Tuple[Optional[Mapping[str, Any]], Optional[Dict[str, Any]]]:
        """Return (record, payload) for an import by ID, reading its normalized JSON."""

        snapshot = self.graph_store.snapshot()
        record = dict(snapshot.get("imports", {}).get(import_id, {}))
        if not record:
            return None, None
        try:
            payload = self._read_normalized(record)
            return record, payload
        except Exception:
            return record, None

    def delete_import(self, import_id: str, actor: str) -> Dict[str, Any]:
        """Permanently delete one import job, raw/normalized datasets, media, and audit record."""

        with self._lock:
            snapshot = self.graph_store.snapshot()
            record = snapshot.get("imports", {}).get(import_id)
            if not record:
                raise KeyError(import_id)

            # 1. Remove archive directory (normalized json and raw copy)
            archive_dir = self.archive_root / import_id
            if archive_dir.exists():
                shutil.rmtree(archive_dir, ignore_errors=True)

            # 2. Remove bridge inbox staging
            staging_file = self.inbox_root / f"{import_id}.anb"
            if staging_file.exists():
                try: staging_file.unlink()
                except OSError: pass

            # 3. Remove outbox result / error files
            for p in self.outbox_root.glob(f"{import_id}.*"):
                try: p.unlink()
                except OSError: pass

            # 4. Remove jobs pending / processing / done descriptors
            for folder in ("pending", "processing", "done"):
                job_file = self.jobs_root / folder / f"{import_id}.json"
                if job_file.exists():
                    try: job_file.unlink()
                    except OSError: pass

            # 5. Remove media directory (extracted suspect photos)
            media_dir = self.bridge_root / "media" / import_id
            if media_dir.exists():
                shutil.rmtree(media_dir, ignore_errors=True)

            # 6. Delete from graph store
            self.graph_store.delete_import_record(import_id, actor)

            # 7. Purge from normalized memory cache
            if hasattr(self, "_normalized_cache"):
                self._normalized_cache = {
                    k: v for k, v in self._normalized_cache.items()
                    if import_id not in k
                }

            return {"status": "success", "deleted": True, "import_id": import_id}

