"""FastAPI router for authenticated i2 layout, review, and import operations.

The dashboard gateway supplies trusted ``X-User``/``X-Role`` headers after session
verification.  This router still enforces officer/admin roles at every method boundary;
apply and rollback remain admin-only.  Error responses never echo bridge exceptions or
uploaded PII.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from services.i2_graph_store import I2GraphStateError, I2GraphStore
from services.i2_import_manager import I2ImportManager


logger = logging.getLogger("nas-bot.i2-api")


class LayoutPayload(BaseModel):
    """Carry one account's positions, viewport, and last graph fingerprint."""

    positions: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    transform: Dict[str, Any] = Field(default_factory=dict)
    graph_fingerprint: str = ""
    custom_edges: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    edge_bend_points: Optional[Dict[str, List[Dict[str, Any]]]] = Field(default_factory=dict)


class ManualEdgePayload(BaseModel):
    """Describe a reviewed manual relationship plus its evidence reason."""

    source_id: str
    target_id: str
    relationship_type: str
    reason: str


class ReasonPayload(BaseModel):
    """Require a human reason for reversible graph actions."""

    reason: str


class ProposalDecisionPayload(BaseModel):
    """Carry an explicit approved/rejected weak-evidence decision."""

    decision: str


class ComponentNamePayload(BaseModel):
    """Carry a shared component name while positions remain account-specific."""

    name: str


class PersonNamePayload(BaseModel):
    """Carry the latest reviewed parcel/import display name and source ID."""

    display_name: str
    source_id: str


class NodeUpdatePayload(BaseModel):
    """Carry operator-reviewed node attribute updates (label, sublabel, phone, id_card, photo, remarks)."""

    label: Optional[str] = None
    sublabel: Optional[str] = None
    phone: Optional[str] = None
    phone_number: Optional[str] = None
    id_card: Optional[str] = None
    photo_url: Optional[str] = None
    remarks: Optional[str] = None
    role: Optional[str] = None
    address: Optional[str] = None


def _model_dict(payload: BaseModel) -> Dict[str, Any]:
    """Support the Pydantic v1/v2 runtimes used by existing production and tests."""

    return payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()


def require_i2_role(x_user: Optional[str], x_role: Optional[str], *, admin_only: bool = False) -> str:
    """Fail closed unless the gateway-authenticated identity has an allowed i2 role.
    
    Allow 'user', 'officer', 'admin', 'superadmin' for normal access (auth.db default is 'user').
    Privileged operations (such as save_master_layout) strictly require 'admin' or 'superadmin'.
    """

    username = (x_user or "").strip()
    role = (x_role or "").strip().lower()
    allowed = {"admin", "superadmin"} if admin_only else {"user", "officer", "admin", "superadmin"}
    if not username or role not in allowed:
        raise HTTPException(status_code=403, detail="ไม่มีสิทธิ์ใช้งานระบบวิเคราะห์ความสัมพันธ์")
    return username


def create_i2_router(
    graph_store: I2GraphStore,
    import_manager: I2ImportManager,
    on_invalidate_cache: Optional[Callable[[], None]] = None,
) -> APIRouter:
    """Create routes bound to the process's graph store and import manager instances."""

    router = APIRouter(prefix="/api/nas-bot/graph", tags=["i2-link-analysis"])

    @router.get("/layout")
    def get_layout(
        import_id: Optional[str] = Query(None),
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Return the authenticated account's persisted layout or system master layout."""

        username = require_i2_role(x_user, x_role)
        return {"status": "success", "layout": graph_store.get_layout(username, import_id=import_id)}

    @router.put("/layout")
    @router.post("/layout")
    def save_layout(
        payload: LayoutPayload,
        import_id: Optional[str] = Query(None),
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Replace only the current account's node positions and viewport."""

        username = require_i2_role(x_user, x_role)
        try:
            layout = graph_store.save_layout(username, _model_dict(payload), import_id=import_id)
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ข้อมูลตำแหน่งผังไม่ถูกต้อง")
        return {"status": "success", "layout": layout}

    @router.get("/master-layout")
    def get_master_layout(
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Return the system-wide master template layout."""

        require_i2_role(x_user, x_role)
        return {"status": "success", "master_layout": graph_store.get_master_layout()}

    @router.put("/master-layout")
    @router.post("/master-layout")
    def save_master_layout(
        payload: LayoutPayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Save the system-wide master layout template (Superadmin / Admin only)."""

        username = require_i2_role(x_user, x_role, admin_only=True)
        try:
            layout = graph_store.save_master_layout(_model_dict(payload), actor=username)
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ข้อมูลตำแหน่งผังไม่ถูกต้อง")
        return {"status": "success", "master_layout": layout}

    @router.put("/components/{component_id}/name")
    def rename_component(
        component_id: str,
        payload: ComponentNamePayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Rename one shared component without changing anyone's personal layout."""

        username = require_i2_role(x_user, x_role)
        try:
            component = graph_store.rename_component(component_id, payload.name, username)
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ชื่อกลุ่มไม่ถูกต้อง")
        return {"status": "success", "component": component}

    @router.post("/relationships")
    def create_relationship(
        payload: ManualEdgePayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Create an audited manual edge without merging person identities."""

        username = require_i2_role(x_user, x_role)
        try:
            edge = graph_store.create_manual_edge(
                source_id=payload.source_id,
                target_id=payload.target_id,
                relationship_type=payload.relationship_type,
                reason=payload.reason,
                actor=username,
            )
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ข้อมูลความสัมพันธ์ไม่ถูกต้อง")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "edge": edge}

    @router.delete("/relationships/{edge_id}")
    def cancel_relationship(
        edge_id: str,
        payload: ReasonPayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Soft-cancel a manual edge while retaining its audit history."""

        username = require_i2_role(x_user, x_role)
        try:
            edge = graph_store.cancel_manual_edge(edge_id, payload.reason, username)
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบความสัมพันธ์")
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ต้องระบุเหตุผลการยกเลิก")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "edge": edge}

    @router.post("/proposals/{proposal_id}/decision")
    def decide_proposal(
        proposal_id: str,
        payload: ProposalDecisionPayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Approve/reject weak evidence; only approval may merge components."""

        username = require_i2_role(x_user, x_role)
        try:
            proposal = graph_store.decide_proposal(proposal_id, payload.decision, username)
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบข้อเสนอความสัมพันธ์")
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="คำตัดสินไม่ถูกต้อง")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "proposal": proposal}

    @router.post("/person-names/{person_node_id}/approve")
    def approve_person_name(
        person_node_id: str,
        payload: PersonNamePayload,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Use the latest reviewed source name as the graph display name."""

        username = require_i2_role(x_user, x_role)
        try:
            record = graph_store.approve_person_name(
                person_node_id=person_node_id,
                display_name=payload.display_name,
                source_id=payload.source_id,
                actor=username,
            )
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="ชื่อบุคคลไม่ถูกต้อง")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "approved_name": record}

    @router.post("/import-i2")
    async def upload_chart(
        file: UploadFile = File(...),
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Stream a .anb upload to permanent NAS archive and Windows bridge queue."""

        username = require_i2_role(x_user, x_role)
        try:
            import_id, writer = import_manager.begin_upload(file.filename or "chart.anb", username)
        except I2GraphStateError:
            raise HTTPException(status_code=422, detail="รองรับไฟล์ IBM i2 .anb เท่านั้น")
        try:
            while chunk := await file.read(1024 * 1024):
                writer.write(chunk)
            size, sha256 = writer.finish()
            record = import_manager.finalize_upload(import_id, size, sha256, username)
        except I2GraphStateError as exc:
            writer.abort()
            import_manager.fail_upload(import_id, username)
            too_large = "size limit" in str(exc)
            raise HTTPException(status_code=413 if too_large else 422, detail="ไฟล์ i2 ใหญ่เกิน 1 GB" if too_large else "ไฟล์ i2 ไม่ถูกต้อง")
        except Exception:
            writer.abort()
            import_manager.fail_upload(import_id, username)
            logger.exception("i2 upload failed import_id=%s actor=%s", import_id, username)
            raise HTTPException(status_code=500, detail="จัดเก็บไฟล์ i2 ไม่สำเร็จ")
        return {"status": "success", "import": record}

    @router.get("/imports")
    def list_imports(
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """List jobs without returning raw chart or normalized graph content."""

        username = require_i2_role(x_user, x_role)
        return {"status": "success", "imports": import_manager.list_imports(actor=username)}

    @router.get("/imports/{import_id}")
    def get_import(
        import_id: str,
        preview: bool = Query(False),
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Reconcile bridge state and optionally return a bounded preview."""

        username = require_i2_role(x_user, x_role)
        try:
            if preview:
                return import_manager.preview(import_id, username)
            return {"status": "success", "import": import_manager.get_import(import_id, username)}
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except I2GraphStateError:
            raise HTTPException(status_code=409, detail="งานนำเข้า i2 ยังไม่พร้อมพรีวิว")

    @router.post("/imports/{import_id}/retry")
    def retry_import(
        import_id: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Retry a bridge timeout/error without deleting raw input or prior errors."""

        username = require_i2_role(x_user, x_role)
        try:
            record = import_manager.retry(import_id, username)
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except I2GraphStateError:
            raise HTTPException(status_code=409, detail="งานนำเข้า i2 นี้ยังลองใหม่ไม่ได้")
        return {"status": "success", "import": record}

    @router.post("/imports/{import_id}/apply")
    def apply_import(
        import_id: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Apply one reviewed dataset; admin/superadmin is final authority."""

        username = require_i2_role(x_user, x_role, admin_only=True)
        try:
            record = import_manager.apply(import_id, username)
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except I2GraphStateError:
            raise HTTPException(status_code=409, detail="งานนำเข้า i2 ยังไม่พร้อมใช้งาน")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "import": record}

    @router.get("/imports/{import_id}/rollback-preview")
    def preview_rollback(
        import_id: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Show an admin the batch impact before explicit rollback."""

        require_i2_role(x_user, x_role, admin_only=True)
        try:
            return {"status": "success", "impact": import_manager.rollback_preview(import_id)}
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except I2GraphStateError:
            raise HTTPException(status_code=409, detail="งานนำเข้า i2 ไม่อยู่ในสถานะที่พรีวิวย้อนกลับได้")

    @router.post("/imports/{import_id}/rollback")
    def rollback_import(
        import_id: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Deactivate one applied dataset while retaining raw and normalized archive."""

        username = require_i2_role(x_user, x_role, admin_only=True)
        try:
            record = import_manager.rollback(import_id, username)
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except I2GraphStateError:
            raise HTTPException(status_code=409, detail="งานนำเข้า i2 ไม่อยู่ในสถานะที่ย้อนกลับได้")
        if on_invalidate_cache:
            on_invalidate_cache()
        return {"status": "success", "import": record}

    @router.delete("/imports/{import_id}")
    def delete_import(
        import_id: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ) -> Dict[str, Any]:
        """Permanently delete one import dataset, files, photos, and state record."""

        username = require_i2_role(x_user, x_role, admin_only=True)
        try:
            res = import_manager.delete_import(import_id, username)
            if on_invalidate_cache:
                on_invalidate_cache()
            return res
        except KeyError:
            raise HTTPException(status_code=404, detail="ไม่พบงานนำเข้า i2")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการลบงานนำเข้า: {e}")

    @router.get("/i2-media/{import_id}/{filename}")
    def get_i2_media(
        import_id: str,
        filename: str,
        x_user: Optional[str] = Header(None, alias="X-User"),
        x_role: Optional[str] = Header(None, alias="X-Role"),
    ):
        """Serve extracted i2 entity photos safely with path traversal protection."""
        require_i2_role(x_user, x_role)
        clean_name = Path(filename).name
        if not clean_name or clean_name != filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        media_path = (import_manager.bridge_root / "media" / import_id / clean_name).resolve()
        bridge_root = import_manager.bridge_root.resolve()
        if bridge_root not in media_path.parents or not media_path.exists():
            raise HTTPException(status_code=404, detail="Media not found")
        return FileResponse(media_path)

    return router
