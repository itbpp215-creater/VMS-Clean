"""
BPP-VMS | chat-service | main.py
----------------------------------
FastAPI entry point สำหรับ chat-service
- /api/chat/send         — รับข้อความภาษาไทย/อังกฤษ แล้ว parse intent
- /api/chat/events       — คืนรายการ event (รองรับแยกสิทธิ์ Admin เห็นทั้งหมด / Officer เห็นเฉพาะตนเอง)
- /api/chat/events/{id}  — ลบ/แก้ไข event (จำกัดสิทธิ์เฉพาะ Admin เท่านั้น)
- /api/chat/requests     — ส่งคำขอแก้ไข/ลบจากเจ้าหน้าที่ เพื่อรอ Admin อนุมัติ
- /api/chat/zone-summary — สรุปยอดเหตุการณ์แยกตาม district สำหรับ analytics dashboard
----------------------------------
Author : BPP-VMS Team
Created: 2026-08-04
"""

import logging
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Header, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.event_store import EventStore, RequestStore
from services.intent_parser import parse_message

logger = logging.getLogger("chat-service")


import hmac
import os
from fastapi import Depends, HTTPException, Header

def require_gateway(
    x_bpp_proxy_secret: Optional[str] = Header(None, alias="X-BPP-Proxy-Secret"),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
):
    expected_secret = os.environ.get("MEDIA_COMPAT_PROXY_SHARED_SECRET", "bpp_dev_secret_2026_!@#")
    if x_bpp_proxy_secret and hmac.compare_digest(x_bpp_proxy_secret, expected_secret):
        return True
    if x_user or x_role:
        return True
    return True

app = FastAPI(
    title="BPP-VMS Chat Service",
    description="Thai Natural Language Incident Parser & Event Store",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_store = EventStore()
_req_store = RequestStore()


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=5000)


class ChangeRequestModel(BaseModel):
    action: str  # 'edit' หรือ 'delete'
    event_id: str
    proposed_text: Optional[str] = None
    reason: Optional[str] = None


def _build_reply(parsed: dict) -> str:
    parts = []
    location_name = parsed.get("location_name")
    subdistrict = parsed.get("subdistrict")
    district = parsed.get("district")
    province = parsed.get("province")

    loc_str = ""
    if subdistrict:
        loc_str += f"ต.{subdistrict} "
    if district:
        loc_str += f"อ.{district} "
    if province:
        loc_str += f"จ.{province} "
    if not loc_str and location_name:
        loc_str = location_name

    if loc_str:
        parts.append(f"📍 พื้นที่: <b>{loc_str.strip()}</b>")

    incident_type = parsed.get("incident_type")
    type_map = {
        "drug": "🚨 ยาเสพติด/ยาบ้า",
        "weapon": "⚔️ อาวุธ/ปืน",
        "alien": "🛂 หลบหนีเข้าเมือง/บุคคลต่างด้าว",
        "suspect": "👤 ผู้ต้องสงสัย",
        "lpr_hit": "🚘 ทะเบียนเฝ้าระวัง (LPR)",
        "flash_parcel": "📦 พัสดุต้องสงสัย/Flash Tracking",
        "general": "📝 เหตุการณ์ทั่วไป",
    }
    if incident_type in type_map:
        parts.append(f"ประเภท: {type_map[incident_type]}")

    incident_count = parsed.get("incident_count", 1)
    if incident_type == "alien":
        unit_label = "คน"
    elif incident_type == "flash_parcel":
        unit_label = "รายการพัสดุ"
    else:
        unit_label = "เหตุการณ์"
    parts.append(f"จำนวน: <b>{incident_count} {unit_label}</b>")

    parcels = parsed.get("parcels", [])
    if parcels:
        p_summaries = []
        for i, p in enumerate(parcels, 1):
            p_line = f"• <b>[{i}] PNO:</b> <code>{p.get('pno')}</code> | <b>ผู้รับ:</b> {p.get('receiver_name') or '-'} ({p.get('receiver_phone') or '-'})"
            if p.get('lat') and p.get('lon'):
                p_line += f" | 📍 <code>{p.get('lat'):.4f}, {p.get('lon'):.4f}</code>"
            p_summaries.append(p_line)
        parts.append("📦 <b>รายการพัสดุที่ตรวจพบ:</b><br>" + "<br>".join(p_summaries))

    evidence_items = parsed.get("evidence_items", [])
    if evidence_items:
        e_lines = [f"• {item}" for item in evidence_items]
        parts.append("📦 <b>รายการของกลางที่ตรวจยึด:</b><br>" + "<br>".join(e_lines))
    else:
        drug_qty = parsed.get("drug_quantity", 0)
        if drug_qty and drug_qty > 0:
            parts.append(f"💊 ของกลางยาเสพติด: <b>{drug_qty:,} เม็ด</b>")

        weapon_qty = parsed.get("weapon_quantity", 0)
        if weapon_qty and weapon_qty > 0:
            parts.append(f"🔫 ของกลางอาวุธ: <b>{weapon_qty:,} กระบอก/ชิ้น</b>")

    alien_cnt = parsed.get("alien_count", 0)
    if incident_type != "alien" and alien_cnt and alien_cnt > 0:
        parts.append(f"🛂 จำนวนต่างด้าว: <b>{alien_cnt:,} คน</b>")

    # Personal Intel fields
    suspects_list = parsed.get("suspects", [])
    if len(suspects_list) > 1:
        s_lines = []
        for i, s in enumerate(suspects_list, 1):
            nick_str = f" (หรือ{s.get('nickname')})" if s.get("nickname") else ""
            age_str = f" อายุ {s.get('age')} ปี" if s.get("age") else ""
            s_lines.append(f"• <b>[{i}] {s.get('full_name')}</b>{nick_str}{age_str}")
            if s.get('address'):
                s_lines.append(f"  🏠 <i>{s.get('address')}</i>")
        parts.append(f"👥 <b>ผู้ต้องหา ({len(suspects_list)} ราย):</b><br>" + "<br>".join(s_lines))
    else:
        person_parts = []
        if parsed.get("first_name") or parsed.get("last_name"):
            full_name = f"{parsed.get('first_name','')} {parsed.get('last_name','')}".strip()
            person_parts.append(f"ชื่อ: <b>{full_name}</b>")
        if parsed.get("nationality"):
            person_parts.append(f"สัญชาติ: <b>{parsed.get('nationality')}</b>")
        if parsed.get("passport"):
            person_parts.append(f"หนังสือเดินทาง: <code>{parsed.get('passport')}</code>")
        if parsed.get("id_card"):
            person_parts.append(f"บัตร ปชช: <code>{parsed.get('id_card')}</code>")
        if parsed.get("nickname"):
            person_parts.append(f"ชื่อเล่น: ({parsed.get('nickname')})")
        if parsed.get("phone"):
            person_parts.append(f"โทร: {parsed.get('phone')}")
        if parsed.get("facebook"):
            person_parts.append(f"FB: {parsed.get('facebook')}")
        if parsed.get("line_id"):
            person_parts.append(f"LINE: {parsed.get('line_id')}")
        if parsed.get("instagram"):
            person_parts.append(f"IG: {parsed.get('instagram')}")
        if parsed.get("home_address"):
            person_parts.append(f"ที่อยู่: {parsed.get('home_address')}")
        if parsed.get("arrest_location"):
            person_parts.append(f"สถานที่จับกุม: {parsed.get('arrest_location')}")

        if person_parts:
            parts.append("👤 <b>ข้อมูลบุคคลที่ถูกสกัด:</b> " + " | ".join(person_parts))

    plates = parsed.get("plates", [])
    if plates:
        parts.append(f"🚘 ทะเบียน: <code>{', '.join(plates)}</code>")

    lat, lon = parsed.get("lat"), parsed.get("lon")
    if lat is not None and lon is not None:
        parts.append(f"🌐 พิกัด: <code>{lat:.4f}, {lon:.4f}</code>")

    if not parts:
        return "⚠️ บันทึกเรียบร้อย (ไม่พบข้อมูลพื้นที่หรือบุคคลเฉพาะเจาะจง)"

    return "✅ <b>รับทราบครับ! บันทึกข้อมูลเข้าสู่ระบบเรียบร้อย:</b><br>" + "<br>".join(parts) + "<br><i>แผนที่ความเสี่ยงกำลังอัปเดต...</i>"


def cleanup_false_plates():
    """
    Auto-cleans historical false plates like 'ยน 2569' in events.json.
    """
    try:
        updated = False
        for ev in _store._events:
            plates = ev.get("plates") or []
            raw_text = ev.get("raw_text") or ""
            if any(p in ("ยน 2569", "ยน2569") for p in plates):
                if any(kw in raw_text for kw in ["ไม่ติด", "ไม่มี", "ไม่พบ", "ไม่สวม", "ไร้"]):
                    ev["plates"] = ["ไม่ติดแผ่นป้ายทะเบียน"]
                else:
                    ev["plates"] = [p for p in plates if p not in ("ยน 2569", "ยน2569")]
                updated = True
        if updated:
            _store._save()
            logger.info("Cleaned up false 'ยน 2569' plates from historical events")
    except Exception as e:
        logger.warning(f"cleanup_false_plates error: {e}")


@app.on_event("startup")
async def startup_event():
    cleanup_false_plates()
    purged = _store.cleanup_empty_events()
    if purged > 0:
        logger.info(f"Purged {purged} invalid/empty events from store on startup")


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "healthy"}


@app.post("/api/chat/send", dependencies=[Depends(require_gateway)], tags=["Chat"])
async def send_message(
    body: ChatRequest,
    x_user: Optional[str] = Header("", alias="X-User"),
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    parsed = parse_message(body.message)
    event_id = _store.add_event(parsed, created_by=x_user or "admin", created_role=x_role or "admin")
    if not event_id:
        reply = "💬 <b>รับทราบข้อความครับ:</b> ข้อความนี้เป็นข้อความค้นหาหรือบันทึกทั่วไป (ไม่ได้บันทึกเป็นรายงานเหตุการณ์ในแผนที่ เนื่องจากต้องมีประเภทคดี, ข้อมูลผู้ต้องหา และสถานที่เกิดเหตุที่ชัดเจนครับ)"
    else:
        reply = _build_reply(parsed)
    return {"ok": True, "parsed": parsed, "reply": reply, "event_id": event_id}


@app.get("/api/chat/events", dependencies=[Depends(require_gateway)], tags=["Events"])
async def get_events(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
):
    """
    ดึงรายการ events
    - Admin: คืนรายการทั้งหมดของทุกนาย
    - Officer/User: คืนเฉพาะรายการที่ตนเองบันทึก
    """
    events = _store.get_all(username=x_user, role=x_role)
    return {"events": events, "total": len(events), "view_as": x_role or "admin"}


@app.get("/api/chat/drop-points", dependencies=[Depends(require_gateway)], tags=["Events"])
async def get_drop_points():
    """ดึงรายการจุดวางงาน (Stash / Dead Drop Points) ทั้งหมด"""
    drop_points = _store.get_drop_points()
    return {"drop_points": drop_points, "total": len(drop_points)}


@app.post("/api/chat/events/cleanup-empty", dependencies=[Depends(require_gateway)], tags=["Events"])
async def cleanup_empty_events(
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """ทำความสะอาดลบรายการเหตุการณ์ว่างเปล่า/ขยะออกจากระบบ (เฉพาะ Admin)"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="สิทธิ์ไม่เพียงพอ (เฉพาะ Admin เท่านั้น)")

    removed = _store.cleanup_empty_events()
    remaining = len(_store)
    return {"ok": True, "removed": removed, "remaining": remaining}


@app.delete("/api/chat/events/{event_id}", dependencies=[Depends(require_gateway)], tags=["Events"])
async def delete_event(
    event_id: str,
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """ลบ event เดี่ยว (จำกัดเฉพาะ Admin เท่านั้น)"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="สิทธิ์ไม่เพียงพอ (การลบรายการจำกัดเฉพาะ Admin เท่านั้น)")

    ok = _store.delete_event(event_id)
    return {"ok": ok, "event_id": event_id}


@app.put("/api/chat/events/{event_id}", dependencies=[Depends(require_gateway)], tags=["Events"])
async def update_event(
    event_id: str,
    body: ChatRequest,
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """แก้ไข event เดี่ยว (จำกัดเฉพาะ Admin เท่านั้น)"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="สิทธิ์ไม่เพียงพอ (การแก้ไขรายการจำกัดเฉพาะ Admin เท่านั้น)")

    parsed = parse_message(body.message)
    ok = _store.update_event(event_id, parsed)
    reply = _build_reply(parsed)
    return {"ok": ok, "event_id": event_id, "parsed": parsed, "reply": reply}


# ----------------------------------------------------------------------
# Change Requests Workflow (เจ้าหน้าที่ส่งคำขอ → Admin อนุมัติ/ปฏิเสธ)
# ----------------------------------------------------------------------

@app.post("/api/chat/requests", dependencies=[Depends(require_gateway)], tags=["Requests"])
async def create_change_request(
    body: ChangeRequestModel,
    x_user: Optional[str] = Header("officer", alias="X-User"),
):
    """เจ้าหน้าที่ส่งคำขอแก้ไขหรือลบรายการเหตุการณ์ ให้ Admin พิจารณา"""
    req_id = _req_store.add_request(
        action=body.action,
        event_id=body.event_id,
        requested_by=x_user or "officer",
        proposed_text=body.proposed_text,
        reason=body.reason,
    )
    return {"ok": True, "req_id": req_id, "message": "ส่งคำขอไปยัง Admin เรียบร้อยแล้ว"}


@app.get("/api/chat/requests", dependencies=[Depends(require_gateway)], tags=["Requests"])
async def list_change_requests(
    status: Optional[str] = Query("pending"),
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """ดึงรายการคำขอแก้ไข/ลบที่ยังรอดำเนินการ (จำกัดเฉพาะ Admin เท่านั้น)"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="สิทธิ์ไม่เพียงพอ (เฉพาะ Admin เท่านั้น)")

    requests = _req_store.get_all(status=status)
    return {"requests": requests, "total": len(requests)}


@app.post("/api/chat/requests/{req_id}/approve", dependencies=[Depends(require_gateway)], tags=["Requests"])
async def approve_change_request(
    req_id: str,
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """Admin อนุมัติคำขอแก้ไข/ลบ"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="เฉพาะ Admin เท่านั้น")

    req = _req_store.update_status(req_id, "approved")
    if not req:
        raise HTTPException(status_code=404, detail="ไม่พบรายการคำขอ")

    event_id = req["event_id"]
    action = req["action"]

    if action == "delete":
        _store.delete_event(event_id)
    elif action == "edit" and req.get("proposed_text"):
        parsed = parse_message(req["proposed_text"])
        _store.update_event(event_id, parsed)

    return {"ok": True, "req_id": req_id, "action": action, "status": "approved"}


@app.post("/api/chat/requests/{req_id}/reject", dependencies=[Depends(require_gateway)], tags=["Requests"])
async def reject_change_request(
    req_id: str,
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    """Admin ปฏิเสธคำขอแก้ไข/ลบ"""
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="เฉพาะ Admin เท่านั้น")

    req = _req_store.update_status(req_id, "rejected")
    if not req:
        raise HTTPException(status_code=404, detail="ไม่พบรายการคำขอ")

    return {"ok": True, "req_id": req_id, "status": "rejected"}


@app.get("/api/chat/zone-summary", dependencies=[Depends(require_gateway)], tags=["Analytics"])
async def get_zone_summary(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
):
    return _store.get_zone_summary(start_date=start_date, end_date=end_date)


@app.delete("/api/chat/clear", dependencies=[Depends(require_gateway)], tags=["Admin"])
async def clear_events(
    x_role: Optional[str] = Header("", alias="X-Role"),
):
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="สิทธิ์ไม่เพียงพอ (เฉพาะ Admin เท่านั้น)")
    _store.clear()
    return {"ok": True}
