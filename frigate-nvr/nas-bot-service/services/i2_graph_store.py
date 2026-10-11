"""Persist operator-reviewed i2 graph state without mixing it into dossier files.

The store owns per-account layouts, manual relationships, weak-evidence proposals,
shared component names, import metadata, and a compact audit trail.  Dossier and CDR
records remain authoritative for their own facts; this file stores only graph-specific
decisions and presentation state.  Every mutation is serialized and atomically replaced
so a crash cannot leave a partially written JSON document.
"""

from __future__ import annotations

import copy
import datetime as dt
import json
import math
import os
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional


_STATE_VERSION = 1
_MAX_LAYOUT_NODES = int(os.getenv("I2_LAYOUT_MAX_NODES", "250000"))
_MAX_COORDINATE = 10_000_000.0


class I2GraphStateError(ValueError):
    """Report invalid graph-state input without exposing persisted private values."""


def _utc_now() -> str:
    """Return a stable UTC timestamp for provenance and optimistic refresh checks."""

    return dt.datetime.now(dt.timezone.utc).isoformat()


def _new_state() -> Dict[str, Any]:
    """Create the versioned empty state used for first boot and corrupt-state recovery."""

    return {
        "version": _STATE_VERSION,
        "revision": 0,
        "layouts": {},
        "component_names": {},
        "manual_edges": {},
        "proposals": {},
        "imports": {},
        "approved_person_names": {},
        "audit": [],
    }


class I2GraphStore:
    """Own durable graph decisions and per-user views under the nas-bot data volume.

    Inputs are authenticated usernames, stable graph identifiers, and validated JSON-like
    payloads.  Outputs are defensive copies.  Side effects are atomic writes to one state
    file; no dossier, case, CDR, or evidence file is modified by this class.
    """

    def __init__(self, data_dir: Optional[str] = None) -> None:
        """Bind the store to ``NAS_DATA_DIR`` or an isolated test directory."""

        root = Path(data_dir or os.getenv("NAS_DATA_DIR", "/data"))
        self.path = root / "i2-graph-state.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._state_cache: Optional[Tuple[float, Dict[str, Any]]] = None

    def _load_unlocked(self) -> Dict[str, Any]:
        """Read and minimally validate the state while the caller holds the lock."""

        if not self.path.exists():
            return _new_state()
        try:
            mtime = self.path.stat().st_mtime
            if self._state_cache is not None and self._state_cache[0] == mtime:
                return copy.deepcopy(self._state_cache[1])
            with self.path.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            raise I2GraphStateError("i2 graph state is unreadable") from exc
        if not isinstance(state, dict) or state.get("version") != _STATE_VERSION:
            raise I2GraphStateError("unsupported i2 graph state version")
        # Forward-compatible defaults allow a new field to be deployed before first mutation.
        for key, default in _new_state().items():
            state.setdefault(key, copy.deepcopy(default))
        self._state_cache = (mtime, copy.deepcopy(state))
        return state

    def _write_unlocked(self, state: Mapping[str, Any]) -> None:
        """Flush a complete sibling file before atomically replacing current state."""

        payload = json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True)
        descriptor, staged_name = tempfile.mkstemp(
            prefix=".i2-graph-state-",
            suffix=".json.tmp",
            dir=str(self.path.parent),
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(staged_name, self.path)
            try:
                self._state_cache = (self.path.stat().st_mtime, copy.deepcopy(dict(state)))
            except OSError:
                self._state_cache = None
        finally:
            if os.path.exists(staged_name):
                os.unlink(staged_name)

    @staticmethod
    def _record_audit(
        state: Dict[str, Any],
        *,
        actor: str,
        action: str,
        object_id: str,
        details: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """Append bounded audit metadata without logging graph PII to process output."""

        entry = {
            "timestamp": _utc_now(),
            "actor": actor,
            "action": action,
            "object_id": object_id,
            "details": dict(details or {}),
        }
        audit = state.setdefault("audit", [])
        audit.append(entry)
        # Keep enough operational history in the live file while backups retain older revisions.
        if len(audit) > 10_000:
            del audit[:-10_000]

    @staticmethod
    def _bump_revision(state: Dict[str, Any]) -> int:
        """Advance the shared graph revision after a data-affecting decision."""

        state["revision"] = int(state.get("revision", 0)) + 1
        return state["revision"]

    def get_revision(self) -> int:
        """Return the current revision without deep-copying the entire state."""
        with self._lock:
            if not self.path.exists():
                return 0
            try:
                mtime = self.path.stat().st_mtime
                if self._state_cache is not None and self._state_cache[0] == mtime:
                    return int(self._state_cache[1].get("revision", 0))
                with self.path.open("r", encoding="utf-8") as handle:
                    state = json.load(handle)
                self._state_cache = (mtime, state)
                return int(state.get("revision", 0))
            except Exception:
                return 0

    def snapshot(self) -> Dict[str, Any]:
        """Return an isolated snapshot suitable for graph generation and API responses."""

        with self._lock:
            return copy.deepcopy(self._load_unlocked())

    def get_layout(self, username: str, import_id: Optional[str] = None) -> Dict[str, Any]:
        """Return one account's positions, pins, viewport, or fallback to the master layout template."""

        with self._lock:
            state = self._load_unlocked()
            slot_key = f"{username}:{import_id}" if import_id else username
            user_layout = state.get("layouts", {}).get(slot_key)

            # For isolated i2 imports, return the specific chart layout or empty
            if import_id:
                return copy.deepcopy(user_layout or {})

            master_layout = state.get("master_layout")
            user_custom_edges = user_layout.get("custom_edges") if user_layout else None
            user_bend_points = user_layout.get("edge_bend_points") if user_layout else None

            # If master_layout exists and is newer than or equal to the user's personal layout, serve master_layout
            if master_layout and isinstance(master_layout.get("positions"), dict) and len(master_layout["positions"]) > 0:
                master_time = master_layout.get("updated_at") or ""
                user_time = (user_layout.get("updated_at") or "") if user_layout else ""
                if not user_layout or (master_time >= user_time and not user_custom_edges and not user_bend_points):
                    result = copy.deepcopy(master_layout)
                    result["is_master_template"] = True
                    return result

            has_user_data = user_layout and (
                (isinstance(user_layout.get("positions"), dict) and len(user_layout["positions"]) > 0)
                or user_custom_edges
                or user_bend_points
            )

            if has_user_data:
                # Always ensure master_layout nodes are present in user_layout so original graph is never missing nodes
                if master_layout and isinstance(master_layout.get("positions"), dict):
                    combined_positions = dict(master_layout["positions"])
                    if isinstance(user_layout.get("positions"), dict):
                        combined_positions.update(user_layout["positions"])
                    res = copy.deepcopy(user_layout)
                    res["positions"] = combined_positions
                    return res
                return copy.deepcopy(user_layout)
            if master_layout and isinstance(master_layout.get("positions"), dict) and len(master_layout["positions"]) > 0:
                result = copy.deepcopy(master_layout)
                result["is_master_template"] = True
                return result
            return copy.deepcopy(user_layout or {})

    def get_master_layout(self) -> Dict[str, Any]:
        """Return the system-wide master layout template."""

        with self._lock:
            state = self._load_unlocked()
            master_layout = state.get("master_layout", {})
            return copy.deepcopy(master_layout)

    def save_master_layout(self, payload: Mapping[str, Any], actor: str = "superadmin") -> Dict[str, Any]:
        """Save system-wide master layout template (Superadmin/Admin only) and force-sync to all accounts."""

        positions = payload.get("positions", {})
        transform = payload.get("transform", {})
        if not isinstance(positions, Mapping) or len(positions) > _MAX_LAYOUT_NODES:
            raise I2GraphStateError("invalid layout positions")
        clean_positions: Dict[str, Dict[str, Any]] = {}
        for node_id, point in positions.items():
            if not isinstance(node_id, str) or not node_id or not isinstance(point, Mapping):
                raise I2GraphStateError("invalid layout node")
            try:
                x_value = float(point.get("x"))
                y_value = float(point.get("y"))
            except (TypeError, ValueError) as exc:
                raise I2GraphStateError("invalid layout coordinate") from exc
            if not math.isfinite(x_value) or not math.isfinite(y_value):
                raise I2GraphStateError("invalid layout coordinate")
            if abs(x_value) > _MAX_COORDINATE or abs(y_value) > _MAX_COORDINATE:
                raise I2GraphStateError("layout coordinate out of range")
            clean_positions[node_id] = {
                "x": round(x_value, 2),
                "y": round(y_value, 2),
                "pinned": bool(point.get("pinned", False)),
            }
        clean_transform = {"x": 0.0, "y": 0.0, "scale": 1.0}
        if isinstance(transform, Mapping):
            for key, minimum, maximum in (
                ("x", -_MAX_COORDINATE, _MAX_COORDINATE),
                ("y", -_MAX_COORDINATE, _MAX_COORDINATE),
                ("scale", 0.001, 8.0),
            ):
                try:
                    value = float(transform.get(key, clean_transform[key]))
                except (TypeError, ValueError) as exc:
                    raise I2GraphStateError("invalid layout viewport") from exc
                if not math.isfinite(value) or value < minimum or value > maximum:
                    raise I2GraphStateError("invalid layout viewport")
                clean_transform[key] = round(value, 4)
        now_ts = _utc_now()
        layout = {
            "positions": clean_positions,
            "transform": clean_transform,
            "graph_fingerprint": str(payload.get("graph_fingerprint") or "")[:128],
            "updated_at": now_ts,
            "updated_by": actor,
            "is_master_template": True,
        }
        with self._lock:
            state = self._load_unlocked()
            existing_master = state.get("master_layout", {})
            existing_positions = existing_master.get("positions", {}) if isinstance(existing_master, dict) else {}
            # Defensive merge: Preserve existing master positions so partial updates never drop nodes
            merged_positions = dict(existing_positions)
            merged_positions.update(clean_positions)
            layout["positions"] = merged_positions

            state["revision"] = int(state.get("revision", 0)) + 1
            layout["revision"] = state["revision"]
            layout["master_version"] = now_ts
            state["master_layout"] = layout

            # Force Sync: Reset personal overrides on the main graph so all accounts immediately
            # adopt this newly published Master Template.
            # Preserve isolated .anb chart layouts (keys formatted as "username:import_id").
            preserved_isolated = {k: v for k, v in state.get("layouts", {}).items() if ":" in k}
            state["layouts"] = preserved_isolated

            self._record_audit(
                state,
                actor=actor,
                action="master_layout_saved",
                object_id="system_master_layout",
                details={"node_count": len(clean_positions), "revision": state["revision"]},
            )
            self._write_unlocked(state)
        return copy.deepcopy(layout)

    def save_layout(self, username: str, payload: Mapping[str, Any], import_id: Optional[str] = None) -> Dict[str, Any]:
        """Validate and atomically replace only the authenticated account's layout.

        ``positions`` maps stable node IDs to finite x/y coordinates and optional pin state.
        ``transform`` stores the canvas viewport.  No other account or shared graph fact changes.
        """

        positions = payload.get("positions", {})
        transform = payload.get("transform", {})
        if not isinstance(positions, Mapping) or len(positions) > _MAX_LAYOUT_NODES:
            raise I2GraphStateError("invalid layout positions")
        clean_positions: Dict[str, Dict[str, Any]] = {}
        for node_id, point in positions.items():
            if not isinstance(node_id, str) or not node_id or not isinstance(point, Mapping):
                raise I2GraphStateError("invalid layout node")
            try:
                x_value = float(point.get("x"))
                y_value = float(point.get("y"))
            except (TypeError, ValueError) as exc:
                raise I2GraphStateError("invalid layout coordinate") from exc
            if not math.isfinite(x_value) or not math.isfinite(y_value):
                raise I2GraphStateError("invalid layout coordinate")
            if abs(x_value) > _MAX_COORDINATE or abs(y_value) > _MAX_COORDINATE:
                raise I2GraphStateError("layout coordinate out of range")
            clean_positions[node_id] = {
                "x": round(x_value, 2),
                "y": round(y_value, 2),
                "pinned": bool(point.get("pinned", False)),
            }
        clean_transform = {"x": 0.0, "y": 0.0, "scale": 1.0}
        if isinstance(transform, Mapping):
            for key, minimum, maximum in (
                ("x", -_MAX_COORDINATE, _MAX_COORDINATE),
                ("y", -_MAX_COORDINATE, _MAX_COORDINATE),
                ("scale", 0.001, 8.0),
            ):
                try:
                    value = float(transform.get(key, clean_transform[key]))
                except (TypeError, ValueError) as exc:
                    raise I2GraphStateError("invalid layout viewport") from exc
                if not math.isfinite(value) or value < minimum or value > maximum:
                    raise I2GraphStateError("invalid layout viewport")
        # Clean custom edges
        raw_custom_edges = payload.get("custom_edges", [])
        clean_custom_edges = []
        if isinstance(raw_custom_edges, list):
            for ce in raw_custom_edges[:1000]:
                if isinstance(ce, Mapping) and ce.get("from") and ce.get("to"):
                    clean_custom_edges.append({
                        "id": str(ce.get("id") or f"custom_{uuid.uuid4().hex[:12]}"),
                        "from": str(ce["from"]),
                        "to": str(ce["to"]),
                        "label": str(ce.get("label") or "ความสัมพันธ์")[:100],
                        "type": str(ce.get("type") or "custom_link")[:50],
                        "color": str(ce.get("color") or "#a855f7")[:20],
                        "created_at": str(ce.get("created_at") or _utc_now()),
                    })

        # Clean edge bend points
        raw_bend_points = payload.get("edge_bend_points", {})
        clean_bend_points = {}
        if isinstance(raw_bend_points, Mapping):
            for edge_id, pts in raw_bend_points.items():
                if isinstance(pts, list) and len(pts) <= 50:
                    valid_pts = []
                    for pt in pts:
                        if isinstance(pt, Mapping):
                            try:
                                px = float(pt.get("x", 0))
                                py = float(pt.get("y", 0))
                                if math.isfinite(px) and math.isfinite(py):
                                    valid_pts.append({"x": round(px, 1), "y": round(py, 1)})
                            except (TypeError, ValueError):
                                pass
                    if valid_pts:
                        clean_bend_points[str(edge_id)] = valid_pts

        layout = {
            "positions": clean_positions,
            "transform": clean_transform,
            "custom_edges": clean_custom_edges,
            "edge_bend_points": clean_bend_points,
            "graph_fingerprint": str(payload.get("graph_fingerprint") or "")[:128],
            "updated_at": _utc_now(),
        }
        slot_key = f"{username}:{import_id}" if import_id else username
        with self._lock:
            state = self._load_unlocked()
            state.setdefault("layouts", {})[slot_key] = layout
            self._record_audit(
                state,
                actor=username,
                action="layout_saved",
                object_id=slot_key,
                details={"node_count": len(clean_positions), "import_id": import_id},
            )
            self._write_unlocked(state)
        return copy.deepcopy(layout)

    def rename_component(self, component_key: str, name: str, actor: str) -> Dict[str, Any]:
        """Set a shared operator-approved group label while layouts remain per account."""

        clean_name = " ".join(str(name).split()).strip()
        if not component_key or not clean_name or len(clean_name) > 120:
            raise I2GraphStateError("invalid component name")
        record = {"name": clean_name, "updated_at": _utc_now(), "updated_by": actor}
        with self._lock:
            state = self._load_unlocked()
            state.setdefault("component_names", {})[component_key] = record
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action="component_renamed",
                object_id=component_key,
            )
            self._write_unlocked(state)
        return copy.deepcopy(record)

    def create_manual_edge(
        self,
        *,
        source_id: str,
        target_id: str,
        relationship_type: str,
        reason: str,
        actor: str,
    ) -> Dict[str, Any]:
        """Create an active reviewed relationship between two distinct stable nodes."""

        if not source_id or not target_id or source_id == target_id:
            raise I2GraphStateError("invalid relationship endpoints")
        clean_type = "_".join(str(relationship_type).strip().lower().split())
        clean_reason = " ".join(str(reason).split()).strip()
        if not clean_type or len(clean_type) > 64 or not clean_reason or len(clean_reason) > 500:
            raise I2GraphStateError("relationship type and reason are required")
        edge_id = f"manual_{uuid.uuid4().hex}"
        edge = {
            "id": edge_id,
            "from": source_id,
            "to": target_id,
            "label": clean_reason,
            "type": clean_type,
            "status": "active",
            "provenance": "manual",
            "confidence": "reviewed",
            "created_at": _utc_now(),
            "created_by": actor,
        }
        with self._lock:
            state = self._load_unlocked()
            state.setdefault("manual_edges", {})[edge_id] = edge
            self._bump_revision(state)
            self._record_audit(state, actor=actor, action="manual_edge_created", object_id=edge_id)
            self._write_unlocked(state)
        return copy.deepcopy(edge)

    def cancel_manual_edge(self, edge_id: str, reason: str, actor: str) -> Dict[str, Any]:
        """Soft-delete a manual edge and retain its full audit history for later review."""

        clean_reason = " ".join(str(reason).split()).strip()
        if not clean_reason or len(clean_reason) > 500:
            raise I2GraphStateError("cancellation reason is required")
        with self._lock:
            state = self._load_unlocked()
            edge = state.setdefault("manual_edges", {}).get(edge_id)
            if not edge:
                raise KeyError(edge_id)
            edge["status"] = "cancelled"
            edge["cancelled_at"] = _utc_now()
            edge["cancelled_by"] = actor
            edge["cancellation_reason"] = clean_reason
            self._bump_revision(state)
            self._record_audit(state, actor=actor, action="manual_edge_cancelled", object_id=edge_id)
            self._write_unlocked(state)
            return copy.deepcopy(edge)

    def ensure_proposals(self, proposals: Iterable[Mapping[str, Any]]) -> None:
        """Persist new deterministic weak-evidence proposals without resetting prior decisions."""

        changed = False
        with self._lock:
            state = self._load_unlocked()
            proposal_state = state.setdefault("proposals", {})
            for candidate in proposals:
                proposal_id = str(candidate.get("id") or "")
                if not proposal_id or proposal_id in proposal_state:
                    continue
                proposal_state[proposal_id] = {
                    **dict(candidate),
                    "status": "pending",
                    "created_at": _utc_now(),
                }
                changed = True
            if changed:
                self._bump_revision(state)
                self._write_unlocked(state)

    def decide_proposal(self, proposal_id: str, decision: str, actor: str) -> Dict[str, Any]:
        """Approve or reject a weak-evidence proposal and retain the reviewer provenance."""

        if decision not in {"approved", "rejected"}:
            raise I2GraphStateError("invalid proposal decision")
        with self._lock:
            state = self._load_unlocked()
            proposal = state.setdefault("proposals", {}).get(proposal_id)
            if not proposal:
                raise KeyError(proposal_id)
            proposal["status"] = decision
            proposal["reviewed_at"] = _utc_now()
            proposal["reviewed_by"] = actor
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action=f"proposal_{decision}",
                object_id=proposal_id,
            )
            self._write_unlocked(state)
            return copy.deepcopy(proposal)

    def set_import_record(self, import_id: str, record: Mapping[str, Any], actor: str) -> Dict[str, Any]:
        """Upsert sanitized import metadata; normalized graph payloads remain separate files."""

        stored = copy.deepcopy(dict(record))
        with self._lock:
            state = self._load_unlocked()
            state.setdefault("imports", {})[import_id] = stored
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action=f"import_{stored.get('status', 'updated')}",
                object_id=import_id,
            )
            self._write_unlocked(state)
        return copy.deepcopy(stored)

    def delete_import_record(self, import_id: str, actor: str) -> bool:
        """Permanently remove one import metadata record and record audit."""

        with self._lock:
            state = self._load_unlocked()
            imports = state.setdefault("imports", {})
            if import_id not in imports:
                return False
            imports.pop(import_id, None)
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action="import_deleted",
                object_id=import_id,
            )
            self._write_unlocked(state)
        return True

    def approve_person_name(
        self,
        *,
        person_node_id: str,
        display_name: str,
        source_id: str,
        actor: str,
    ) -> Dict[str, Any]:
        """Record the latest reviewed parcel/import name used by the graph presentation layer."""

        clean_name = " ".join(str(display_name).split()).strip()
        if not person_node_id or not clean_name or len(clean_name) > 200:
            raise I2GraphStateError("invalid approved person name")
        record = {
            "display_name": clean_name,
            "source_id": source_id,
            "approved_at": _utc_now(),
            "approved_by": actor,
        }
        with self._lock:
            state = self._load_unlocked()
            state.setdefault("approved_person_names", {})[person_node_id] = record
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action="person_name_approved",
                object_id=person_node_id,
                details={"source_id": source_id},
            )
            self._write_unlocked(state)
        return copy.deepcopy(record)

    def update_node_override(
        self,
        *,
        node_id: str,
        payload: Mapping[str, Any],
        actor: str,
    ) -> Dict[str, Any]:
        """Record reviewed node attributes (label, sublabel, phone, id_card, photo_url, remarks)."""

        if not node_id:
            raise I2GraphStateError("invalid node id")
        clean_payload = {
            k: v for k, v in payload.items()
            if k in {"label", "sublabel", "phone", "phone_number", "id_card", "photo_url", "remarks", "role", "address"} and v is not None
        }
        clean_payload["updated_at"] = _utc_now()
        clean_payload["updated_by"] = actor

        with self._lock:
            state = self._load_unlocked()
            overrides = state.setdefault("node_overrides", {})
            current = overrides.get(node_id, {})
            current.update(clean_payload)
            overrides[node_id] = current
            self._bump_revision(state)
            self._record_audit(
                state,
                actor=actor,
                action="node_override_updated",
                object_id=node_id,
            )
            self._write_unlocked(state)
        return copy.deepcopy(current)
