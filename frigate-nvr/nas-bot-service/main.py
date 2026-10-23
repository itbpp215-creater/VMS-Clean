"""
Main FastAPI Application for nas-bot-service (BPP-VMS)

This microservice provides endpoints for:
1. Multi-Platform Bot Webhook Ingestion (Telegram, Discord, Dashboard Chat Widget)
2. Photo EXIF GPS Metadata Extraction
3. Automated NAS Case Storage and Report PDF Generation
4. One-Time Pairing Code authentication linking bot accounts to auth-service

Inputs:
    - HTTP REST API requests, bot Webhook payloads, file uploads
Outputs:
    - JSON responses, status codes, bot reply messages
Side effects:
    - Writes to NAS storage, persists pairing states.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Header, Depends, Query, Body
from fastapi.responses import FileResponse, Response, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import os
import time
import json
import base64
import logging
import datetime
import asyncio
import httpx
import re
import urllib.parse
import hashlib

from services.metadata_extractor import extract_photo_metadata
from services.nas_manager import NASStorageManager, THAI_TITLE_PREFIX_PATTERN
from services.auth_linker import AuthLinker
from services.user_subscriptions import UserSubscriptionManager
from services.user_profile import UserProfileManager
from services.dossier_manager import DossierVaultManager, generate_clean_dossier_id
from services.identity_sync import (
    IdentityConflictError,
    IdentityNotFoundError,
    IdentityRollbackError,
    IdentitySyncCoordinator,
    IdentityTransactionError,
    IdentityValidationError,
)
from services.cdr_parser import CDRParser
from services.bank_statement_parser import BankStatementParser
from services.warrant_excel_parser import parse_warrant_excel
from services.graph_engine import LinkGraphEngine
from services.i2_graph_store import I2GraphStore
from services.i2_import_manager import I2ImportManager
from services.i2_api import create_i2_router, require_i2_role
from services.intel_parser import parse_intel_text
from services.chat_session_manager import ChatSessionManager
from services.nas_sync_service import nas_sync_service
from services.tiered_storage_archiver import tiered_archiver

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("nas-bot.main")

# httpx logs every request line at INFO, and the Telegram API carries the bot token
# inside the URL path (https://api.telegram.org/bot<TOKEN>/getUpdates). With a 30s
# long-poll that wrote the full credential into the container log roughly 2,800 times
# a day, readable by anyone with `docker logs` or a log shipper — outside the ACL
# hardening that protects .env. WARNING keeps transport errors visible without the URL.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

app = FastAPI(
    title="BPP-VMS NAS Bot Service",
    description="Microservice for Multi-Platform Bot & NAS Storage Integration",
    version="1.0.0"
)

# Enable CORS for Dashboard API requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress payloads > 1KB with GZip
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Instantiate core managers
nas_manager = NASStorageManager()
# The coordinator and dossier manager share NASStorageManager's root so identity changes remain one transaction.
identity_sync_coordinator = IdentitySyncCoordinator(nas_manager.root_path)
dossier_mgr = DossierVaultManager(nas_manager.root_path, identity_sync_coordinator)
chat_session_mgr = ChatSessionManager()
from services.vehicle_manager import VehicleManager
vehicle_mgr = VehicleManager(nas_manager.root_path)
cdr_parser = CDRParser()
statement_parser = BankStatementParser()
# Graph decisions/layouts live outside dossiers; raw i2 archives remain under the NAS root.
i2_graph_store = I2GraphStore()
i2_import_manager = I2ImportManager(i2_graph_store, nas_manager.root_path)
graph_engine = LinkGraphEngine(dossier_mgr, cdr_parser, i2_graph_store, i2_import_manager, statement_parser)
auth_linker = AuthLinker()
sub_manager = UserSubscriptionManager()
profile_manager = UserProfileManager()

# Bind authenticated i2 layout, review, and .anb import routes to the shared stores.
app.include_router(create_i2_router(i2_graph_store, i2_import_manager, on_invalidate_cache=graph_engine.invalidate_cache))


class PairRequest(BaseModel):
    username: str


class PairVerify(BaseModel):
    platform: str
    bot_user_id: str
    code: str


class WebChatReport(BaseModel):
    notes: str
    lat: Optional[float] = None
    lon: Optional[float] = None

from services.ai_ocr import extract_tr14_data

TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

async def forward_to_n8n_master_webhook(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Non-blocking forwarder to n8n Master Bot Workflow (AI Agent + Alert + Ingest).
    Ensures zero disruption if n8n is offline or unreachable.
    """
    n8n_urls = [
        os.getenv("N8N_WEBHOOK_URL", "http://n8n:5678/webhook/bpp-vms-master"),
        "http://n8n:5678/webhook/bpp-vms-master",
        "http://host.docker.internal:5678/webhook/bpp-vms-master",
        "http://172.17.0.1:5678/webhook/bpp-vms-master",
        "http://localhost:5678/webhook/bpp-vms-master",
        "http://127.0.0.1:5678/webhook/bpp-vms-master",
    ]
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            for n8n_url in n8n_urls:
                try:
                    res = await client.post(n8n_url, json=payload)
                    if res.status_code == 200:
                        logger.info(f"Successfully bridged event to n8n Master Webhook via {n8n_url}")
                        try:
                            return res.json()
                        except Exception:
                            return {"status": "ok"}
                except Exception:
                    continue
    except Exception as err:
        logger.debug(f"n8n webhook forwarding skipped: {err}")
    return None

async def sync_to_chat_service(
    case_id: str,
    officer_username: str,
    notes: str,
    extracted: Dict[str, Any],
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    suspects_list: Optional[List[Dict[str, Any]]] = None
):
    """
    Forward processed NAS case report event to chat-service
    so it appears in chat history, incident lists, and risk analytics maps.
    Supports single or multiple suspects and detailed evidence summaries.
    """
    suspects = suspects_list or ([extracted] if extracted and extracted.get("suspect_name") else [])
    seized = extracted.get("seized_items") if isinstance(extracted.get("seized_items"), dict) else {}

    # Trigger background mirroring to n8n Master Bot
    try:
        n8n_payload = {
            "source": "telegram",
            "type": "photo" if (extracted.get("is_image") or not notes) else "chat",
            "case_id": case_id,
            "officer": officer_username,
            "message": notes,
            "suspect": extracted.get("suspect_name") or (suspects[0].get("suspect_name") if suspects else None),
            "total_suspects": len(suspects),
            "drugs": ", ".join(seized.get("summary", [])) if seized.get("summary") else (f"ยาบ้า {extracted.get('drug_quantity')} เม็ด" if extracted.get("drug_quantity") else None),
            "metadata": {"gps": {"lat": lat, "lng": lon}} if (lat is not None and lon is not None) else {}
        }
        asyncio.create_task(forward_to_n8n_master_webhook(n8n_payload))
    except Exception as e:
        logger.debug(f"Could not spawn n8n mirror task: {e}")

    chat_service_urls = [
        "http://127.0.0.1:8443/api/chat/send",
        "http://chat-service:5007/api/chat/send",
        "http://localhost:5007/api/chat/send",
        "http://127.0.0.1:5007/api/chat/send"
    ]
    
    parts = [f"บันทึกคดี {case_id}"]
    if extracted.get("case_number"):
        parts.append(f"คดีที่: {extracted['case_number']}")

    # Format suspects (Single or Multi-suspects)
    if len(suspects) == 1:
        s0 = suspects[0]
        if s0.get("suspect_name"):
            parts.append(f"ชื่อ: {s0['suspect_name']}")
        if s0.get("id_card"):
            parts.append(f"เลขบัตร: {s0['id_card']}")
        if s0.get("address"):
            parts.append(f"ที่อยู่: {s0['address']}")
    elif len(suspects) > 1:
        s_parts = []
        for idx, s in enumerate(suspects, 1):
            s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
            s_cid = f" (เลขบัตร: {s['id_card']})" if s.get("id_card") else ""
            s_parts.append(f"{idx}. {s_name}{s_cid}")
        parts.append(f"ผู้ต้องหา {len(suspects)} คน: " + ", ".join(s_parts))
        # Include primary suspect address if present
        if suspects[0].get("address"):
            parts.append(f"ที่อยู่ผู้ต้องหา: {suspects[0]['address']}")
    elif extracted.get("suspect_name"):
        parts.append(f"ชื่อ: {extracted['suspect_name']}")
        if extracted.get("id_card"):
            parts.append(f"เลขบัตร: {extracted['id_card']}")
        if extracted.get("address"):
            parts.append(f"ที่อยู่: {extracted['address']}")

    # Format incident location & scene
    if extracted.get("incident_location"):
        parts.append(f"สถานที่เกิดเหตุ: {extracted['incident_location']}")
    elif extracted.get("district") and any(kw in str(notes) for kw in ["จับกุม", "ตรวจยึด", "เกิดเหตุ", "ของกลาง", "ยาบ้า", "ไอซ์"]):
        dist_desc = f"ต.{extracted.get('subdistrict')} " if extracted.get('subdistrict') else ""
        dist_desc += f"อ.{extracted['district']}"
        parts.append(f"สถานที่เกิดเหตุ: {dist_desc}")

    # Format seized items
    if seized.get("summary"):
        parts.append("ของกลาง: " + ", ".join(seized["summary"]))
    elif extracted.get("drug_quantity"):
        parts.append(f"ยาบ้า {extracted['drug_quantity']} เม็ด")

    if extracted.get("seized_weapons"):
        weapons_desc = ", ".join(extracted["seized_weapons"])
        parts.append(f"ของกลางอาวุธปืน: {weapons_desc}")
    elif seized.get("weapons"):
        w_strs = [f"{w['name']} {w['quantity']} {w['unit']}" for w in seized["weapons"]]
        parts.append("ของกลางอาวุธปืน: " + ", ".join(w_strs))

    if extracted.get("seized_cash"):
        cash_val = extracted["seized_cash"]
        cash_str = f"{cash_val:,} บาท" if isinstance(cash_val, (int, float)) else f"{cash_val} บาท"
        parts.append(f"ตรวจยึดเงินสด: {cash_str}")
    elif seized.get("cash"):
        parts.append(f"ตรวจยึดเงินสด: {seized['cash']:,.0f} บาท")

    if extracted.get("vehicle_plates"):
        plates_desc = ", ".join(extracted["vehicle_plates"])
        parts.append(f"ยานพาหนะของกลาง: {plates_desc}")

    if notes:
        parts.append(f"หมายเหตุ: {notes}")
    if lat is not None and lon is not None:
        parts.append(f"พิกัด {lat},{lon}")

    msg_text = " | ".join(parts)

    async with httpx.AsyncClient(timeout=5.0) as client:
        for url in chat_service_urls:
            try:
                resp = await client.post(
                    url,
                    json={"message": msg_text},
                    headers={"X-User": officer_username, "X-Role": "officer"}
                )
                if resp.status_code == 200:
                    logger.info(f"Successfully synced case {case_id} to chat-service via {url}")
                    break
            except Exception as e:
                logger.debug(f"Could not sync to {url}: {e}")


async def submit_plain_text_report(
    message_text: str,
    officer_username: str,
    user_role: str,
) -> Optional[Dict[str, Any]]:
    """Submit Telegram plain text through the same parser contract as Web Chat.

    ``message_text`` is forwarded unchanged to chat-service so intent extraction is
    channel-neutral. On success, the function also archives the original report in
    NAS and returns the chat-service response; network failure returns ``None``.
    Side effects are one chat event and one text-only NAS case on successful sync.
    """
    # Trigger background mirroring to n8n Master Bot
    try:
        n8n_chat_payload = {
            "source": "telegram",
            "type": "chat",
            "message": message_text,
            "officer": officer_username,
            "role": user_role
        }
        asyncio.create_task(forward_to_n8n_master_webhook(n8n_chat_payload))
    except Exception as e:
        logger.debug(f"Could not spawn n8n chat mirror task: {e}")

    # Use the same endpoint fallback order as document/image synchronization while
    # preserving the original report instead of decorating it with NAS metadata.
    chat_service_urls = [
        "http://127.0.0.1:8443/api/chat/send",
        "http://chat-service:5007/api/chat/send",
        "http://localhost:5007/api/chat/send",
        "http://127.0.0.1:5007/api/chat/send",
    ]
    # Try each supported runtime address until chat-service accepts the report.
    async with httpx.AsyncClient(timeout=5.0) as client:
        for chat_service_url in chat_service_urls:
            try:
                response = await client.post(
                    chat_service_url,
                    json={"message": message_text},
                    headers={"X-User": officer_username, "X-Role": user_role},
                )
                # Only archive after the authoritative event store confirms success.
                if response.status_code == 200:
                    response_data = response.json()
                    case_id = f"Case_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
                    # NAS is a secondary archive: a storage error must never retry the
                    # already accepted chat request and create a duplicate event.
                    try:
                        nas_manager.save_case_report(
                            case_id=case_id,
                            officer_username=officer_username,
                            platform="telegram",
                            notes=message_text,
                            lat=None,
                            lon=None,
                            files=[],
                        )
                        # Expose the identifier only when the secondary archive succeeded.
                        response_data["case_id"] = case_id
                    except Exception as storage_error:
                        # Log only the exception type so report text and paths stay private.
                        logger.warning(
                            "Telegram text report accepted but NAS archive failed (%s)",
                            type(storage_error).__name__,
                        )
                    logger.info(
                        "Successfully submitted Telegram text report via %s",
                        chat_service_url,
                    )
                    return response_data
            except Exception as error:
                # Do not expose service URLs or message contents in user-facing replies.
                logger.debug(
                    "Could not submit Telegram text report via chat-service (%s)",
                    type(error).__name__,
                )
    # The caller turns a total transport failure into a concise Telegram error.
    return None


def format_web_chat_reply_for_telegram(reply_text: str) -> str:
    """Convert chat-service's small HTML reply subset into Telegram Markdown.

    The input is the trusted formatter output from chat-service and the returned
    string preserves line breaks, bold, italic, and code emphasis without showing
    literal Web Chat tags. This function has no side effects.
    """
    # Normalize Web Chat line-break tags before translating its supported inline tags.
    telegram_text = re.sub(r"<br\s*/?>", "\n", reply_text, flags=re.IGNORECASE)
    # Translate only tags emitted by chat-service's reply builder; unknown tags remain
    # visible so data is never silently discarded from an operational acknowledgement.
    tag_replacements = {
        "<b>": "*",
        "</b>": "*",
        "<i>": "_",
        "</i>": "_",
        "<code>": "`",
        "</code>": "`",
    }
    # Apply deterministic replacements without interpreting operator-provided content.
    for html_tag, markdown_marker in tag_replacements.items():
        telegram_text = telegram_text.replace(html_tag, markdown_marker)
    return telegram_text


def extract_explicit_case_id(text: Optional[str]) -> Optional[str]:
    """
    Extracts explicit case ID (e.g. Case_20261001_160322, Case-01, คดีที่ 123/2569, คดี 45/69).
    Excludes generic prefixes or descriptions like ภาพประกอบคดี, สำนวนคดี, เอกสารคดี, คดีนาย...
    """
    if not text:
        return None
    m = re.search(r'(?<![ก-๙a-zA-Z0-9])(?:Case[_\-\s][A-Za-z0-9_\-]+|คดี(?:ที่)?[_\-\s]?(?:\d+[A-Za-z0-9_\-/]*|Case\S+))', text, re.IGNORECASE)
    if m:
        c_id = m.group(0).strip().replace(" ", "_").replace("-", "_")
        if re.search(r'\d', c_id):
            return c_id
    return None


def get_user_role(username: str) -> str:
    """Helper to resolve system role ('admin' vs 'officer') for a paired user."""
    db_path = os.getenv("AUTH_DB_PATH", "/data/auth.db")
    if os.path.exists(db_path):
        try:
            import sqlite3
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute("SELECT role FROM users WHERE username = ?", (username,))
            row = cur.fetchone()
            conn.close()
            if row and row[0]:
                return row[0]
        except Exception as err:
            logger.debug(f"Could not read auth.db role: {err}")
    if username in ["admin", "bpp215", "bpp21_01", "winai", "wichai", "suwat", "suchakree"]:
        return "admin"
    return "officer"

async def send_safe_telegram_reply(client, url: str, chat_id: Any, text: str, photo_path: Optional[str] = None):
    """
    Safely sends Telegram messages handling long text chunking (2000 char limit)
    and robust fallback to plain text if Markdown/HTML parsing fails.
    """
    if not text:
        return

    # Split text into safe chunks of at most 2000 characters
    chunks = []
    lines = text.split("\n")
    curr = []
    curr_len = 0

    for l in lines:
        # If a single line itself exceeds 2000 chars, break it down safely
        while len(l) > 2000:
            sub = l[:2000]
            l = l[2000:]
            if curr:
                chunks.append("\n".join(curr))
                curr = []
                curr_len = 0
            chunks.append(sub)
            
        if curr_len + len(l) + 1 > 2000:
            chunks.append("\n".join(curr))
            curr = [l]
            curr_len = len(l)
        else:
            curr.append(l)
            curr_len += len(l) + 1

    if curr:
        chunks.append("\n".join(curr))

    for idx, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
            
        target_photo = photo_path if (idx == 0 and photo_path and os.path.exists(photo_path)) else None
        
        if target_photo:
            try:
                with open(target_photo, "rb") as pf:
                    photo_bytes = pf.read()
                    res = await client.post(
                        f"{url}/sendPhoto",
                        data={"chat_id": chat_id, "caption": chunk[:1024], "parse_mode": "Markdown"},
                        files={"photo": (os.path.basename(target_photo), photo_bytes, "image/jpeg")}
                    )
                    if res.status_code == 200:
                        continue
                    
                    logger.warning(f"Telegram photo Markdown send failed ({res.status_code}): {res.text}. Retrying plain text caption fallback...")
                    clean_cap = chunk[:1024].replace("*", "").replace("`", "").replace("_", "").replace("[", "").replace("]", "")
                    res_fb = await client.post(
                        f"{url}/sendPhoto",
                        data={"chat_id": chat_id, "caption": clean_cap},
                        files={"photo": (os.path.basename(target_photo), photo_bytes, "image/jpeg")}
                    )
                    if res_fb.status_code == 200:
                        continue
            except Exception as p_err:
                logger.warning(f"Failed to send photo reply: {p_err}")

        # Send text via sendMessage
        try:
            res = await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"})
            if res.status_code != 200:
                logger.warning(f"Telegram Markdown send failed ({res.status_code}): {res.text}. Retrying plain text fallback...")
                # Strip markdown symbols for 100% reliable plain text fallback
                clean_t = chunk.replace("*", "").replace("`", "").replace("_", "").replace("[", "").replace("]", "")
                r_fallback = await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": clean_t[:3800]})
                if r_fallback.status_code != 200:
                    logger.error(f"Fallback send failed: {r_fallback.text}")
        except Exception as t_err:
            logger.error(f"Failed to send Telegram message: {t_err}")


async def execute_telegram_search(client, url: str, chat_id: Any, q_term: str, username: str) -> bool:
    """
    Executes search across Person Registry, NAS Cases, and Chat Events,
    and sends formatted results to Telegram using send_safe_telegram_reply.
    Returns True if at least one match was found, False otherwise.
    """
    search_q = q_term
    clean_q = THAI_TITLE_PREFIX_PATTERN.sub('', search_q.strip()).strip()
    search_terms = [search_q]
    if clean_q and clean_q != search_q and len(clean_q) >= 2:
        search_terms.append(clean_q)

    matched_person = nas_manager.person_registry.find_person(id_card=search_q, suspect_name=search_q)
    cases = nas_manager.search_cases(search_q)
    
    chat_events_matched = []
    async def search_events(q):
        matched = []
        try:
            c_resp = await client.get(
                (os.environ.get("CHAT_SERVICE_URL", "http://127.0.0.1:8443").rstrip("/") + "/api/chat/events"),
                headers={"X-User": username or "admin", "X-Role": "admin"},
                timeout=5.0
            )
            if c_resp.status_code == 200:
                all_c_events = c_resp.json().get("events", [])
                def norm_t(txt):
                    if not txt: return ""
                    tr = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
                    return str(txt).translate(tr).lower()
                def dig_t(txt):
                    return "".join(c for c in norm_t(txt) if c.isdigit())
                
                terms_to_check = [norm_t(t) for t in search_terms if norm_t(t)]
                q_d = dig_t(q) if len(dig_t(q)) >= 3 else None
                
                for ev in all_c_events:
                    ev_str = norm_t(json.dumps(ev, ensure_ascii=False))
                    m_ev = False
                    if any(t in ev_str for t in terms_to_check):
                        m_ev = True
                    elif q_d and q_d in dig_t(ev_str):
                        m_ev = True
                    if m_ev:
                        matched.append(ev)
        except Exception as err:
            logger.warning(f"Failed to search chat-service events: {err}")
        return matched

    try:
        chat_events_matched = await search_events(search_q)
    except Exception as err:
        logger.warning(f"Error calling search_events: {err}")

    # Fallback: If 0 results, strip Thai titles/prefixes with full pattern
    if not matched_person and not cases and not chat_events_matched:
        if clean_q and clean_q != search_q and len(clean_q) >= 2:
            search_q = clean_q
            matched_person = nas_manager.person_registry.find_person(id_card=search_q, suspect_name=search_q)
            cases = nas_manager.search_cases(search_q)
            chat_events_matched = await search_events(search_q)

    reply_parts = []
    photo_path_to_send = None
    case_photos_to_send = []
    has_any_match = False
    # 1. Person Profile & Dossier Vault Section
    dossier_matches = dossier_mgr.get_all_dossiers(query=search_q)
    if not dossier_matches and clean_q and clean_q != search_q:
        dossier_matches = dossier_mgr.get_all_dossiers(query=clean_q)
    docs_to_send = []

    if dossier_matches:
        has_any_match = True
        reply_parts.append(f"🗂️ **พบถังแฟ้มประวัติบุคคล ({len(dossier_matches)} แฟ้ม):** 🦥✨")
        for dm in dossier_matches[:3]:
            d_id = dm.get("dossier_id")
            d_full = dossier_mgr.get_dossier_detail(d_id) or dm
            s_name = d_full.get("suspect_name") or "ไม่ระบุชื่อ"
            s_id = d_full.get("id_card") or "ไม่ระบุ"
            s_phone = d_full.get("phone_number") or "ไม่ระบุ"
            s_role = d_full.get("role_tag") or "ผู้ต้องหา"
            
            reply_parts.append(
                f"📁 **รหัสถัง: {d_id}**\n"
                f"👤 ผู้ต้องหา/บุคคล: **{s_name}**\n"
                f"🪪 เลขบัตร: `{s_id}` | 📞 เบอร์: `{s_phone}`\n"
                f"🏷️ สถานะ/บทบาท: **{s_role}**\n"
            )

            parcels = d_full.get("parcels", [])
            if parcels:
                reply_parts.append(f"  📦 **ประวัติรับพัสดุ Flash ({len(parcels)} รายการ):**")
                for p_item in parcels:
                    p_pno = p_item.get("pno", "-")
                    p_gps = p_item.get("gps_url", "")
                    p_lat = p_item.get("lat", "")
                    p_lon = p_item.get("lon", "")
                    p_time = p_item.get("time", "-")
                    p_rec_addr = p_item.get("receiver_address", "-")
                    reply_parts.append(f"    • 🔖 **PNO:** `{p_pno}` ({p_time})")
                    reply_parts.append(f"      🏠 ที่อยู่ส่ง: {p_rec_addr}")
                    if p_gps:
                        reply_parts.append(f"      📍 **พิกัดรับของ:** [เปิด Google Maps ({p_lat}, {p_lon})]({p_gps})")
                reply_parts.append("")

            linked = d_full.get("linked_dossiers", [])
            if linked:
                reply_parts.append(f"  🔗 **เชื่อมโยงเครือข่าย ({len(linked)} คน):**")
                for l in linked[:4]:
                    reply_parts.append(f"    • **{l.get('suspect_name')}** ({l.get('role_tag') or 'บุคคลเกี่ยวข้อง'}) - {l.get('link_reason')}")
                reply_parts.append("")

            # Queue documents for sending
            for pf in d_full.get("personal_files", []):
                fname = pf.get("filename", "")
                fpath = dossier_mgr.get_file_path(d_id, fname)
                if fpath and os.path.exists(fpath):
                    if fname.lower().endswith((".docx", ".doc", ".pdf")):
                        docs_to_send.append((fpath, fname))
                    elif fname.lower().endswith((".jpg", ".jpeg", ".png")) and not photo_path_to_send:
                        photo_path_to_send = fpath

        reply_parts.append("───────────────────\n")

    elif matched_person:
        has_any_match = True
        p_id = matched_person.get("person_id")
        p_full = nas_manager.person_registry.get_person_by_id(p_id) or matched_person
        
        s_name = p_full.get("suspect_name") or "ไม่ระบุชื่อ"
        s_id = p_full.get("id_card") or "ไม่ระบุ"
        s_age = f"{p_full.get('age')} ปี" if p_full.get("age") else "ไม่ระบุ"
        s_addr = p_full.get("address") or "ไม่ระบุ"
        
        reply_parts.append(
            f"👤 **พบประวัติบุคคล: {s_name}** 🦥✨\n"
            f"🪪 เลขบัตร: `{s_id}` | อายุ: {s_age}\n"
            f"🏠 ที่อยู่ปัจจุบัน: {s_addr}\n"
        )

        addr_hist = p_full.get("address_history", [])
        if addr_hist:
            reply_parts.append("📍 **ประวัติที่อยู่เก่า:**")
            for h in addr_hist:
                reply_parts.append(f"  • {h.get('address')} (บันทึกเมื่อ: {h.get('recorded_at')[:10]})")
            reply_parts.append("")

        srcs = p_full.get("sources", [])
        if srcs:
            reply_parts.append(f"📁 **สำนวนคดีที่เชื่อมโยง ({len(srcs)} รายการ):**")
            for s in srcs:
                c_id = s.get("case_id")
                c_notes = s.get("notes") or ""
                reply_parts.append(f"  • **{c_id}** ({s.get('platform')}) - {c_notes[:80]}")
                if not photo_path_to_send:
                    photo_path_to_send = nas_manager.get_primary_photo(c_id)
            reply_parts.append("")

        neighbors = p_full.get("address_neighbors", [])
        if neighbors:
            reply_parts.append(f"👥 **คนที่อยู่ในที่อยู่ใกล้เคียงกัน ({len(neighbors)} คน):**")
            for n in neighbors:
                reply_parts.append(f"  • {n.get('suspect_name')} (`{n.get('id_card') or 'ไม่ระบุบัตร'}`)")
            reply_parts.append("")
            reply_parts.append("")

    # 2. NAS Storage Cases Section
    if cases:
        has_any_match = True
        reply_parts.append(f"📁 **พบสำนวนคดีในคลัง NAS ({len(cases)} รายการ):** 🦥✨")
        for c in cases[:5]:
            c_id = c.get('case_id')
            c_notes = c.get('notes') or 'ไม่มีรายละเอียด'
            c_user = c.get('officer_username') or ''
            reply_parts.append(f"🔹 **{c_id}** {'[ผู้บันทึก: ' + c_user + ']' if c_user else ''}\n  📝 {c_notes[:300]}\n")
            c_photo = nas_manager.get_primary_photo(c_id)
            if c_photo and os.path.exists(c_photo):
                c_suspects = c.get('suspects', [])
                s_label = c.get('suspect_name') or (c_suspects[0].get('suspect_name') if c_suspects else 'ไม่ระบุ')
                case_photos_to_send.append((c_photo, c_id, s_label))
        reply_parts.append("")

    # 3. Chat Intelligence Events Section
    if chat_events_matched:
        has_any_match = True
        reply_parts.append(f"📋 **พบเหตุการณ์ในฐานข้อมูลแชต ({len(chat_events_matched)} รายการ):** 🦥✨\n")
        for i, ev in enumerate(chat_events_matched[:5], 1):
            loc = ev.get('location_name') or ev.get('arrest_location') or 'ไม่ระบุพื้นที่'
            inc = ev.get('incident_type') or 'ทั่วไป'
            created_by = ev.get('created_by') or ''
            created_at = (ev.get('created_at') or '')[:16].replace("T", " ")
            
            reply_parts.append(f"🔹 **รายการที่ #{i}** (คดี: `{ev.get('event_id')[:8]}`) | 📍 **{loc}** ({inc})")
            if created_at or created_by:
                reply_parts.append(f"🕒 บันทึกเมื่อ: {created_at} {'[ผู้บันทึก: ' + created_by + ']' if created_by else ''}")
            
            # Concise 5-Key Fields
            full_name = f"{ev.get('first_name','') } {ev.get('last_name','')}".strip()
            if ev.get('nickname'):
                full_name = f"{full_name} ({ev.get('nickname')})" if full_name else ev.get('nickname')
            
            reply_parts.append(f"  1️⃣ 👤 **ผู้ต้องหา:** {full_name or 'ไม่ระบุ'}")
            reply_parts.append(f"  2️⃣ 🪪 **เลขบัตร ปชช:** `{ev.get('id_card') or 'ไม่ระบุ'}`")
            
            ev_evidence = []
            if ev.get('drug_quantity'):
                ev_evidence.append(f"💊 ยาบ้า: {ev.get('drug_quantity'):,} เม็ด")
            if ev.get('weapon_type') or ev.get('weapon_quantity'):
                ev_evidence.append(f"🔫 อาวุธ: {ev.get('weapon_type') or 'ปืน'} ({ev.get('weapon_quantity') or 1})")
            reply_parts.append(f"  3️⃣ 📦 **ของกลาง:** {', '.join(ev_evidence) if ev_evidence else 'ไม่ระบุ'}")
            
            reply_parts.append(f"  4️⃣ 📍 **สถานที่เกิดเหตุ:** {loc}")
            if ev.get('charges'):
                reply_parts.append(f"  5️⃣ ⚖️ **ข้อกล่าวหา:** {ev.get('charges')[:150]}")
            
            reply_parts.append("───────────────────")

    # Determine cover photo for main search text:
    # If a person/dossier photo exists, use it. If NOT, only use case photo if NO dossiers/persons matched at all!
    cover_photo_for_main = photo_path_to_send
    if not cover_photo_for_main and not dossier_matches and not matched_person and case_photos_to_send:
        cover_photo_for_main = case_photos_to_send[0][0]
        # Remove the first case photo since it is now sent with the main message
        case_photos_to_send = case_photos_to_send[1:]

    final_text = "\n".join(reply_parts)
    await send_safe_telegram_reply(client, url, chat_id, final_text, cover_photo_for_main)

    # Send separate case photos (if any) with distinct header so they never look like dossier cover photos
    for c_photo_path, c_id, s_name in case_photos_to_send[:3]:
        try:
            with open(c_photo_path, "rb") as cpf:
                c_photo_bytes = cpf.read()
            c_caption = f"📁 **ภาพจากสำนวนคดี:** `{c_id}`\n👤 **ผู้ต้องหา/บุคคล:** {s_name}"
            res_photo = await client.post(
                f"{url}/sendPhoto",
                data={"chat_id": chat_id, "caption": c_caption, "parse_mode": "Markdown"},
                files={"photo": (os.path.basename(c_photo_path), c_photo_bytes, "image/jpeg")}
            )
            if res_photo.status_code != 200:
                plain_cap = c_caption.replace("*", "").replace("`", "")
                await client.post(
                    f"{url}/sendPhoto",
                    data={"chat_id": chat_id, "caption": plain_cap},
                    files={"photo": (os.path.basename(c_photo_path), c_photo_bytes, "image/jpeg")}
                )
        except Exception as cp_err:
            logger.warning(f"Failed to send separate case photo for {c_id}: {cp_err}")

    # Send attached Word/PDF documents if present
    for doc_path, doc_fname in docs_to_send:
        try:
            with open(doc_path, "rb") as f:
                doc_bytes = f.read()
            await client.post(
                f"{url}/sendDocument",
                data={"chat_id": chat_id, "caption": f"📄 เอกสารแนบ: {doc_fname}"},
                files={"document": (doc_fname, doc_bytes)}
            )
            logger.info(f"Successfully sent attached document {doc_fname} to Telegram chat {chat_id}")
        except Exception as doc_err:
            logger.error(f"Failed to send telegram document {doc_fname}: {doc_err}")

    return has_any_match


# ---------------------------------------------------------
# Telegram Media Group (Album) & Multi-Photo Batch Buffer
# ---------------------------------------------------------
MEDIA_GROUP_LOCK = asyncio.Lock()
MEDIA_GROUP_BUFFERS: Dict[str, Dict[str, Any]] = {}
MEDIA_GROUP_TIMERS: Dict[str, Any] = {}
TELEGRAM_CALLBACK_MAP: Dict[str, str] = {}


def make_safe_cb_data(prefix: str, payload: str) -> str:
    """
    Ensure Telegram callback_data never exceeds Telegram's strict 64-byte limit.
    If full string exceeds 64 bytes (common with Thai names/dossier IDs),
    hashes payload and stores mapping in memory.
    """
    raw_full = f"{prefix}:{payload}"
    if len(raw_full.encode("utf-8")) <= 64:
        return raw_full
    h = hashlib.md5(payload.encode("utf-8")).hexdigest()[:12]
    if len(TELEGRAM_CALLBACK_MAP) > 1000:
        TELEGRAM_CALLBACK_MAP.clear()
    TELEGRAM_CALLBACK_MAP[h] = payload
    return f"{prefix}:#h:{h}"


def resolve_cb_payload(raw_payload: str) -> str:
    """Resolve callback payload if it was hashed to satisfy Telegram 64-byte limit."""
    if raw_payload.startswith("#h:"):
        h = raw_payload.split("#h:", 1)[1]
        return TELEGRAM_CALLBACK_MAP.get(h, raw_payload)
    return raw_payload

def auto_detect_and_link_relations(
    dossier_ids: List[str],
    case_id: str,
    text_context: str = "",
    suspects: List[Dict[str, Any]] = None,
    source_files: List[str] = None
) -> int:
    """
    Auto-detects family, spouse, and cross-case network relationships between batch dossiers
    or with existing dossiers in the vault.
    Strictly verifies full names, national ID card numbers, or explicit aliases to prevent false positives.
    Extracts document context snippets and source files for transparent audit trail.
    """
    spouse_keywords = ["สามี", "ภรรยา", "เมีย", "ผัว", "คู่สมรส", "แฟน"]
    family_keywords = ["ลูกสาว", "ลูกชาย", "บุตร", "บิดา", "มารดา", "พ่อ", "แม่", "ครอบครัว"]
    has_spouse_context = any(k in (text_context or "") for k in spouse_keywords)
    has_family_context = any(k in (text_context or "") for k in family_keywords)
    links_count = 0
    first_file = source_files[0] if source_files else None

    # 1. Cross-link between batch dossiers ONLY when explicit relationship evidence exists
    # Strict matching prevents chaotic all-to-all (clique) over-linking among co-uploaded files
    if len(dossier_ids) >= 2:
        for i in range(len(dossier_ids)):
            for j in range(i + 1, len(dossier_ids)):
                id_a, id_b = dossier_ids[i], dossier_ids[j]
                prof_a = dossier_mgr.get_dossier_detail(id_a) or {}
                prof_b = dossier_mgr.get_dossier_detail(id_b) or {}

                phone_a = prof_a.get("phone_number")
                phone_b = prof_b.get("phone_number")
                addr_a = (prof_a.get("address") or "").strip()
                addr_b = (prof_b.get("address") or "").strip()
                fam_a = prof_a.get("family_info") or {}
                fam_b = prof_b.get("family_info") or {}
                cid_a = str(prof_a.get("id_card") or "").strip()
                cid_b = str(prof_b.get("id_card") or "").strip()

                is_parent_child = False
                parent_child_label = ""
                if (cid_a and (fam_b.get("father_id") == cid_a or fam_b.get("mother_id") == cid_a)) or \
                   (cid_b and (fam_a.get("father_id") == cid_b or fam_a.get("mother_id") == cid_b)):
                    is_parent_child = True
                    if "ลูกสาว" in (text_context or "") or "บุตรสาว" in (text_context or ""):
                        parent_child_label = "บิดา - บุตรสาว"
                    elif "ลูกชาย" in (text_context or "") or "บุตรชาย" in (text_context or ""):
                        parent_child_label = "บิดา - บุตรชาย"
                    else:
                        parent_child_label = "บิดา/มารดา - บุตร"
                elif has_family_context and (addr_a == addr_b or (len(addr_a) >= 15 and addr_a in addr_b)):
                    is_parent_child = True
                    if "ลูกสาว" in (text_context or "") or "บุตรสาว" in (text_context or ""):
                        parent_child_label = "บิดา - บุตรสาว"
                    elif "ลูกชาย" in (text_context or "") or "บุตรชาย" in (text_context or ""):
                        parent_child_label = "บิดา - บุตรชาย"
                    else:
                        parent_child_label = "ครอบครัว"

                should_link = False
                rel_type = "network"
                reason_txt = ""

                if is_parent_child:
                    should_link = True
                    rel_type = "family"
                    reason_txt = f"👨‍👧 {parent_child_label} (ครอบครัว) ในคดี {case_id}" if case_id else f"👨‍👧 {parent_child_label}"
                elif has_spouse_context and len(dossier_ids) == 2:
                    should_link = True
                    rel_type = "spouse"
                    reason_txt = f"💍 สามี-ภรรยา (คู่สมรส) ในคดี {case_id}" if case_id else "💍 สามี-ภรรยา (คู่สมรส)"
                elif phone_a and phone_b and phone_a == phone_b:
                    should_link = True
                    rel_type = "network"
                    reason_txt = f"📞 ใช้เบอร์เดียวกัน ({phone_a}) ในคดี {case_id}" if case_id else f"📞 ใช้เบอร์เดียวกัน ({phone_a})"
                elif addr_a and addr_b and len(addr_a) >= 15 and addr_a == addr_b:
                    should_link = True
                    rel_type = "network"
                    reason_txt = f"🏠 อยู่บ้านเดียวกัน ({addr_a[:30]}) ในคดี {case_id}" if case_id else f"🏠 อยู่บ้านเดียวกัน ({addr_a[:30]})"

                if not should_link:
                    continue
                
                snippet = (text_context.strip()[:200] + "...") if len(text_context.strip()) > 200 else text_context.strip()
                ok = dossier_mgr.link_two_dossiers(
                    id_a, id_b,
                    reason=reason_txt,
                    relationship_type=rel_type,
                    is_current=True,
                    evidence_snippet=snippet or f"ตรวจพบร่วมกันในสำนวนคดี {case_id}",
                    source_file=first_file,
                    case_id=case_id,
                    shared_files=source_files
                )
                if ok:
                    links_count += 1

    # 2. Check if any dossier references an existing dossier in the system (by FULL name, ID card, or distinct alias)
    all_dossiers = dossier_mgr.get_all_dossiers()
    for d_id in dossier_ids:
        prof = dossier_mgr.get_dossier_detail(d_id)
        if not prof:
            continue
        # Search document text and behaviors
        combined_ref = f"{text_context} {prof.get('area_tag', '')} {prof.get('notes', '')} {prof.get('behavior', '')}"
        
        # Don't match own name
        current_name = prof.get("suspect_name", "")
        current_clean_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', current_name).strip()

        for other in all_dossiers:
            other_id = other.get("dossier_id")
            if other_id == d_id or other_id in dossier_ids:
                continue
            other_name = other.get("suspect_name", "")
            if not other_name or other_name == "ไม่ระบุชื่อ":
                continue

            clean_other_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', other_name).strip()
            other_cid = other.get("id_card", "")

            # STRICT MATCHING RULES:
            # 1. Full name match (must have distinct name, not just a common single first name)
            is_full_name_match = False
            matched_term = None
            if clean_other_name and len(clean_other_name) >= 5 and clean_other_name in combined_ref:
                if clean_other_name != current_clean_name:
                    is_full_name_match = True
                    matched_term = clean_other_name

            # 2. National ID Card match
            is_cid_match = False
            if other_cid and len(other_cid) >= 13 and other_cid in combined_ref:
                is_cid_match = True
                matched_term = f"เลขบัตร {other_cid}"

            # 3. Explicit alias / nickname match (e.g. "หรือต่อ", "หรือบอล", "หรือแมว")
            is_alias_match = False
            if "หรือ" in clean_other_name:
                parts = clean_other_name.split("หรือ")
                alias_part = parts[1].split()[0] if len(parts) > 1 else ""
                if len(alias_part) >= 2 and f"หรือ{alias_part}" in combined_ref:
                    is_alias_match = True
                    matched_term = f"ฉายาหรือ{alias_part}"

            if is_full_name_match or is_cid_match or is_alias_match:
                # Extract context snippet around the matched term
                snippet = ""
                if matched_term and matched_term in combined_ref:
                    idx = combined_ref.find(matched_term)
                    start_pos = max(0, idx - 60)
                    end_pos = min(len(combined_ref), idx + len(matched_term) + 80)
                    snippet = "..." + combined_ref[start_pos:end_pos].strip() + "..."
                elif text_context:
                    snippet = text_context[:160] + "..."

                # Determine specific relationship type and label
                if any(k in snippet for k in spouse_keywords):
                    rel_type = "spouse"
                    reason_txt = f"💍 สามี-ภรรยา (คู่สมรส) อ้างถึงในคดี {case_id}" if case_id else "💍 สามี-ภรรยา (คู่สมรส)"
                elif is_cid_match:
                    rel_type = "network"
                    reason_txt = f"🪪 ตรวจพบเลขบัตร ปชช. ตรงกัน ({matched_term}) ในคดี {case_id}"
                elif is_alias_match:
                    rel_type = "network"
                    reason_txt = f"🎯 ระบุฉายาตรงกัน ({matched_term}) ในคดี {case_id}"
                elif any(k in snippet for k in ["ผู้สั่งการ", "สั่งการ", "หัวหน้า", "ตัวการ"]):
                    rel_type = "network"
                    reason_txt = f"👑 ระบุเป็นผู้สั่งการในคดี {case_id}"
                elif any(k in snippet for k in ["รับยา", "ส่งยา", "วางยา", "นักบิน"]):
                    rel_type = "network"
                    reason_txt = f"📦 ระบุเป็นเครือข่ายรับ-ส่งยาในคดี {case_id}"
                elif any(k in snippet for k in ["โอนเงิน", "บัญชี", "สลิป"]):
                    rel_type = "network"
                    reason_txt = f"💰 ระบุเส้นทางการเงิน/โอนเงินในคดี {case_id}"
                elif any(k in snippet for k in ["บิดา", "มารดา", "พ่อ", "แม่", "ครอบครัว", "ลูกสาว", "ลูกชาย", "บุตร"]):
                    rel_type = "family"
                    reason_txt = f"👨‍👩‍👦 ข้อมูลครอบครัว (บิดา/มารดา/บุตร) ในคดี {case_id}"
                else:
                    rel_type = "network"
                    reason_txt = f"📄 ระบุชื่อในสำนวนคดี {case_id}"

                ok = dossier_mgr.link_two_dossiers(
                    d_id, other_id,
                    reason=reason_txt,
                    relationship_type=rel_type,
                    is_current=True,
                    evidence_snippet=snippet,
                    source_file=first_file,
                    case_id=case_id,
                    shared_files=source_files
                )
                if ok:
                    links_count += 1

    return links_count


async def debounced_process_media_group(batch_key: str, delay: float = 2.2):
    """
    Debounced processor for Telegram Media Groups (albums) & rapid multi-photo uploads.
    Bundles all photos in the batch into 1 Unified Case, extracts all suspects,
    upserts dossiers, auto cross-links all suspects in the network, and responds.
    """
    await asyncio.sleep(delay)
    async with MEDIA_GROUP_LOCK:
        group_data = MEDIA_GROUP_BUFFERS.pop(batch_key, None)
        MEDIA_GROUP_TIMERS.pop(batch_key, None)

    if not group_data or not group_data.get("items"):
        return

    chat_id = group_data["chat_id"]
    username = group_data["username"]
    caption = group_data.get("caption") or ""
    items = group_data["items"]

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

    all_suspects: List[Dict[str, Any]] = []
    files_to_save: List[Dict[str, Any]] = []
    all_behaviors: List[str] = []

    # 1. Determine unified Case ID
    explicit_case = extract_explicit_case_id(caption)
    if explicit_case:
        case_id = explicit_case
    else:
        case_id = f"คดี_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

    from services.ai_ocr import extract_document_data

    # 2. Process AI OCR on each image in the album
    has_any_tr14 = False
    has_any_phonelist = False
    has_any_bank_slip = False
    has_any_veh_doc = False
    bank_slip_records: List[Dict[str, Any]] = []
    batch_vehicles: List[Dict[str, Any]] = []

    # Check caption for vehicle mentions
    cap_intel = parse_intel_text(caption or "")
    if cap_intel and cap_intel.get("intel_type") == "vehicle_intel" and cap_intel.get("vehicle_info"):
        batch_vehicles.append(cap_intel["vehicle_info"])

    # Check text notes in group_data
    for note in group_data.get("text_notes", []):
        t_intel = parse_intel_text(note)
        if t_intel and t_intel.get("intel_type") == "vehicle_intel" and t_intel.get("vehicle_info"):
            batch_vehicles.append(t_intel["vehicle_info"])

    for idx, item in enumerate(items, 1):
        img_bytes = item["bytes"]
        file_path = item.get("file_path", f"photo_{idx}.jpg")

        extracted_res = extract_document_data(img_bytes, file_path, caption=caption)
        suspects = extracted_res.get("suspects", [])
        behavior = extracted_res.get("behavior")
        is_phone_list = extracted_res.get("is_phone_list", False)
        is_bank_slip = extracted_res.get("is_bank_slip", False)
        bank_slip_data = extracted_res.get("bank_slip_data")
        is_veh_doc = extracted_res.get("is_vehicle_doc", False)
        veh_data = extracted_res.get("vehicle_data")

        if is_bank_slip and bank_slip_data:
            has_any_bank_slip = True
            tag_prefix = "Slip"
            bank_slip_records.append(bank_slip_data)
        elif is_veh_doc and veh_data:
            has_any_veh_doc = True
            tag_prefix = "Vehicle"
            batch_vehicles.append(veh_data)
        elif suspects and not is_phone_list:
            has_any_tr14 = True
            tag_prefix = "TR14"
        elif is_phone_list:
            has_any_phonelist = True
            tag_prefix = "PhoneList"
        else:
            tag_prefix = "Evidence"

        photo_filename = f"Doc_{idx}_{tag_prefix}_{case_id}.jpg"
        files_to_save.append({
            "filename": photo_filename,
            "category": "Financial" if tag_prefix == "Slip" else ("Vehicles" if tag_prefix == "Vehicle" else ("TR14" if tag_prefix == "TR14" else "Photos")),
            "content": img_bytes,
            "tag_prefix": tag_prefix
        })

        # Save OCR raw text as .txt to enable AutoLink scanning
        ocr_txt = extracted_res.get("ocr_raw_text")
        if ocr_txt and len(ocr_txt.strip()) >= 20:
            txt_filename = f"Doc_{idx}_{tag_prefix}_{case_id}_ocr.txt"
            files_to_save.append({
                "filename": txt_filename,
                "category": "Documents",
                "content": ocr_txt.encode("utf-8"),
                "tag_prefix": "OCR_Text"
            })

        if behavior:
            all_behaviors.append(behavior)

        for s in suspects:
            s_name = s.get("suspect_name")
            if s_name and not any(existing.get("suspect_name") == s_name for existing in all_suspects):
                all_suspects.append(s)

    # If Bank Slip, bind directly to target suspect from caption or sender/receiver
    target_dossier_profile = None
    if has_any_bank_slip:
        matched_target = None
        for d in dossier_mgr.get_all_dossiers():
            d_name = d.get("suspect_name") or ""
            clean_d_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง)\s*', '', d_name).strip()
            first_name = clean_d_name.split()[0] if clean_d_name else ""
            if (d_name and d_name in (caption or "")) or (len(first_name) >= 3 and first_name in (caption or "")):
                matched_target = d
                break
        
        if matched_target:
            target_dossier_profile = matched_target
            case_id = matched_target.get("dossier_id") or case_id
            # Save financial records to target dossier
            fin_records = target_dossier_profile.get("financial_records", [])
            for b_rec in bank_slip_records:
                b_rec_copy = dict(b_rec)
                b_rec_copy["slip_file"] = files_to_save[0]["filename"] if files_to_save else ""
                b_rec_copy["recorded_at"] = datetime.datetime.now().isoformat()
                fin_records.append(b_rec_copy)
            target_dossier_profile["financial_records"] = fin_records
            
            # Save file to personal_files
            pfiles = target_dossier_profile.get("personal_files", [])
            for f in files_to_save:
                pfiles.append({
                    "filename": f["filename"],
                    "category": f.get("category", "Financial"),
                    "saved_at": datetime.datetime.now().isoformat()
                })
                # Write file directly to dossier personal directory
                try:
                    d_dir = os.path.join(dossier_mgr.dossiers_dir, target_dossier_profile["dossier_id"], "Personal")
                    os.makedirs(d_dir, exist_ok=True)
                    with open(os.path.join(d_dir, f["filename"]), "wb") as pf_out:
                        pf_out.write(f["content"])
                except Exception as save_err:
                    logger.error(f"Error saving financial slip file to dossier: {save_err}")
                    
            target_dossier_profile["personal_files"] = pfiles
            dossier_mgr.save_dossier_profile(target_dossier_profile)

    # If OCR didn't detect TR.14 suspects, check if caption specifies who the files belong to!
    matched_from_caption = False
    if not all_suspects and not has_any_bank_slip and caption:
        # Search for suspect name in caption (e.g. "ของ นายสุทธิพงษ์", "ไฟล์นายสุทธิพงษ์", "สุทธิพงษ์ ตองดำ")
        matched_existing = None
        for d in dossier_mgr.get_all_dossiers():
            d_name = d.get("suspect_name") or ""
            clean_d_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง)\s*', '', d_name).strip()
            first_name = clean_d_name.split()[0] if clean_d_name else ""
            if (d_name and d_name in caption) or (len(first_name) >= 3 and first_name in caption):
                matched_existing = d
                break

        if matched_existing:
            matched_from_caption = True
            all_suspects.append({
                "suspect_name": matched_existing.get("suspect_name"),
                "id_card": matched_existing.get("id_card"),
                "phone_number": matched_existing.get("phone_number"),
                "role_tag": matched_existing.get("role_tag") or "บุคคลเป้าหมาย",
                "area_tag": matched_existing.get("area_tag"),
                "address": matched_existing.get("address"),
                "age": matched_existing.get("age"),
                "from_caption_match": True
            })
            case_id = matched_existing.get("dossier_id") or case_id
        else:
            # Check if caption mentions a new name with Thai prefixes
            name_match = re.search(r'(?:นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*([ก-๙]{2,}(?:\s+[ก-๙]{2,})?)', caption)
            if name_match:
                extracted_name = name_match.group(0).strip()
                matched_from_caption = True
                all_suspects.append({
                    "suspect_name": extracted_name,
                    "id_card": None,
                    "phone_number": None,
                    "role_tag": "บุคคลเป้าหมาย",
                    "area_tag": None,
                    "address": None,
                    "age": None,
                    "from_caption_match": True
                })
                case_id = generate_clean_dossier_id(extracted_name)

    # Check if caption contains a clean Thai name matching suspect first name to fix OCR typos (e.g. พรมพิ๊บาล -> พรมพิบาล)
    if caption and all_suspects:
        cap_name_m = re.search(r'(?:นาย|นางสาว|น\.ส\.|นาง)\s*([ก-๙]{2,}\s+[ก-๙]{2,})', caption)
        if cap_name_m:
            cap_full_name = cap_name_m.group(0).strip()
            cap_first = cap_name_m.group(1).split()[0].strip()
            for s in all_suspects:
                s_raw = s.get("suspect_name") or ""
                s_first = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง)\s*', '', s_raw).strip().split()[0] if s_raw else ""
                if cap_first and s_first and (cap_first in s_first or s_first in cap_first):
                    s["suspect_name"] = cap_full_name

    # If first suspect has clean name and no custom case was given, use it for case_id
    if not explicit_case and all_suspects and all_suspects[0].get("suspect_name"):
        case_id = generate_clean_dossier_id(all_suspects[0].get("suspect_name"))

    # Caption drug quantity override
    cap_drug_match = re.search(r'(ยาบ้า|ยาเสพติด|จำนวน)\s*(\d+[,.]?\d*)', caption)
    drug_qty = 0
    if cap_drug_match:
        try:
            drug_qty = int(float(cap_drug_match.group(2).replace(",", "")))
        except:
            pass
    if drug_qty > 0 and all_suspects:
        for s in all_suspects:
            if not s.get("drug_quantity"):
                s["drug_quantity"] = drug_qty

    combined_behavior = "\n".join(all_behaviors) if all_behaviors else (caption or f"ชุดภาพหลักฐาน ({len(items)} ภาพ)")

    # 3. Save as Single Unified Case in NAS
    first_item = items[0] if items else {}
    nas_manager.save_case_report(
        case_id=case_id,
        officer_username=username,
        platform="telegram",
        notes=caption or f"Telegram Media Group ({len(items)} ภาพ)",
        lat=first_item.get("lat"),
        lon=first_item.get("lon"),
        files=files_to_save,
        suspects=all_suspects,
        behavior=combined_behavior
    )

    # 4. Upsert each suspect to Person Dossier Vault & collect dossier_ids
    created_dossier_ids = []
    if all_suspects:
        for s in all_suspects:
            s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
            d_profile = dossier_mgr.upsert_dossier(
                suspect_name=s_name,
                id_card=s.get("id_card"),
                phone_number=s.get("phone_number"),
                role_tag=s.get("role_tag") or "ผู้ต้องหา",
                area_tag=s.get("area_tag"),
                address=s.get("address"),
                age=s.get("age"),
                category="drug" if "ยา" in (caption or combined_behavior or "") else "general",
                behavior=combined_behavior,
                notes=caption or f"ชุดเอกสารคดี {case_id} (จำนวน {len(items)} ภาพ)",
                officer_username=username,
                platform="telegram",
                files=[{"filename": f["filename"], "content": f["content"]} for f in files_to_save]
            )
            if d_profile and d_profile.get("dossier_id"):
                d_id = d_profile["dossier_id"]
                if d_id not in created_dossier_ids:
                    created_dossier_ids.append(d_id)
                chat_session_mgr.set_active_dossier(
                    chat_id=chat_id,
                    dossier_id=d_id,
                    suspect_name=d_profile.get("suspect_name") or s_name,
                    id_card=d_profile.get("id_card"),
                    phone_number=d_profile.get("phone_number"),
                    officer_username=username
                )

                # Bind any batch vehicles to this suspect dossier
                if batch_vehicles:
                    d_vehicles = d_profile.get("vehicles", []) or []
                    for bv in batch_vehicles:
                        v_rec = vehicle_mgr.upsert_vehicle(
                            plate=bv.get("plate"),
                            province=bv.get("province"),
                            vehicle_type=bv.get("type") or bv.get("vehicle_type"),
                            brand=bv.get("brand"),
                            model=bv.get("model"),
                            color=bv.get("color"),
                            chassis_no=bv.get("chassis_no"),
                            engine_no=bv.get("engine_no"),
                            owner_name=s_name,
                            owner_id=s.get("id_card"),
                            finance_company=bv.get("finance_company"),
                            dossier_id=d_id,
                            ownership_status="verified",
                            source="batch_case",
                            notes=f"ชุดเอกสาร/ภาพถ่ายคดี {case_id}"
                        )
                        clean_new_p = re.sub(r'\s', '', v_rec.get("plate", ''))
                        if not any(re.sub(r'\s', '', ex_v.get("plate", '')) == clean_new_p for ex_v in d_vehicles):
                            d_vehicles.append({
                                "plate": v_rec.get("plate"),
                                "province": v_rec.get("province"),
                                "type": v_rec.get("type"),
                                "color": v_rec.get("color"),
                                "ownership_status": "verified"
                            })
                    d_profile["vehicles"] = d_vehicles
                    dossier_mgr.save_dossier_profile(d_profile)

    # 5. 🔗 AUTO CROSS-LINK & DETECT SPOUSE/FAMILY RELATIONS!
    total_linked = 0
    if created_dossier_ids:
        total_linked = auto_detect_and_link_relations(
            dossier_ids=created_dossier_ids,
            case_id=case_id,
            text_context=f"{caption} {combined_behavior}",
            suspects=all_suspects,
            source_files=[f.get("filename") for f in files_to_save if f.get("filename")]
        )

    # Sync case to chat-service so Telegram photo events appear in event feed & heatmap ONLY if explicit crime/seizure report
    has_crime_report = any(kw in (caption or combined_behavior or "") for kw in ["จับกุม", "ตรวจยึด", "ของกลาง", "ยาบ้า", "ไอซ์", "อาวุธ", "ยาเสพติด"])
    if has_crime_report:
        first_s = all_suspects[0] if all_suspects else {}
        asyncio.create_task(sync_to_chat_service(
            case_id=case_id,
            officer_username=username,
            notes=caption or combined_behavior or f"ชุดเอกสารคดี {case_id}",
            extracted=first_s,
            lat=first_item.get("lat"),
            lon=first_item.get("lon"),
            suspects_list=all_suspects
        ))

    # 6. Send Rich Telegram Summary Response with 4 clear categories
    now_dt = datetime.datetime.now()
    nas_subpath = f"/Cases/{now_dt.year}/{now_dt.strftime('%m')}/{case_id}"

    title_emoji = "🎉"
    title_text = "ประมวลผลชุดข้อมูลคดีเรียบร้อยแล้วครับ! 🦥✨"
    if has_any_bank_slip:
        title_emoji = "💳"
        title_text = "บันทึกเส้นทางการเงินและหลักฐานสลิปเรียบร้อยแล้ว! 🦥✨"
    elif has_any_tr14:
        title_emoji = "🎉"
        title_text = "ประมวลผลชุดเอกสาร ทร.14 และสำนวนคดีเรียบร้อยแล้ว! 🦥✨"

    summary_parts = [
        f"{title_emoji} **{title_text}**",
        f"📁 **รหัสคดี/แฟ้มหลัก:** `{case_id}`",
    ]
    if caption:
        summary_parts.append(f"💬 **บันทึกกำกับ:** {caption}")

    # Category 1: 🗂️ บันทึกลงถังข้อมูลบุคคล (Dossier Vault)
    summary_parts.append("\n🗂️ **1. บันทึกลงถังข้อมูลบุคคล (Dossier Vault):**")
    if all_suspects:
        for idx, s in enumerate(all_suspects, 1):
            s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
            cid_str = f" | 🪪 `{s.get('id_card')}`" if s.get("id_card") else ""
            ph_str = f" | 📞 `{s.get('phone_number')}`" if s.get("phone_number") else ""
            role_str = f" ({s.get('role_tag')})" if s.get("role_tag") else ""
            summary_parts.append(f"• 👤 **{s_name}**{role_str}{cid_str}{ph_str}")
            if s.get("address"):
                summary_parts.append(f"  └ 🏠 {s.get('address')}")
    elif has_any_bank_slip and target_dossier_profile:
        t_name = target_dossier_profile.get("suspect_name") or "บุคคลเป้าหมาย"
        t_cid = target_dossier_profile.get("id_card") or ""
        cid_s = f" | 🪪 `{t_cid}`" if t_cid else ""
        summary_parts.append(f"• 👤 **{t_name}**{cid_s} (เชื่อมโยงเข้าแฟ้มเป้าหมาย)")
    else:
        summary_parts.append("• บันทึกเป็นแฟ้มสำนวนคดีทั่วไป (ยังไม่ระบุตัวบุคคลเฉพาะเจาะจง)")

    # Bank slip details if any
    if has_any_bank_slip and bank_slip_records:
        summary_parts.append("\n🧾 **รายการสลิปโอนเงินที่ตรวจพบ:**")
        for b_idx, b_rec in enumerate(bank_slip_records, 1):
            b_details = []
            if b_rec.get("sender_name"):
                s_bank_str = f" ({b_rec.get('sender_bank') or ''} {b_rec.get('sender_account') or ''})".strip()
                b_details.append(f"• 👤 ผู้โอน: **{b_rec.get('sender_name')}**{s_bank_str}")
            if b_rec.get("receiver_name"):
                r_bank_str = f" ({b_rec.get('receiver_bank') or ''} {b_rec.get('receiver_account') or ''})".strip()
                b_details.append(f"• 🏦 ผู้รับ: **{b_rec.get('receiver_name')}**{r_bank_str}")
            if b_rec.get("amount"):
                b_details.append(f"• 💰 ยอดเงิน: **{b_rec.get('amount')}** บาท")
            summary_parts.append(f"**[สลิป #{b_idx}]**\n" + "\n".join(b_details))

    # Category 2: 📁 คลังจัดเก็บหลักฐาน (NAS Storage)
    summary_parts.append("\n📁 **2. คลังจัดเก็บหลักฐาน (NAS Storage):**")
    summary_parts.append(f"• 📂 โฟลเดอร์: `{nas_subpath}`")
    summary_parts.append(f"• 📑 ไฟล์หลักฐาน: จัดเก็บเข้าคลัง {len(items)} ไฟล์ (Photos/Documents)")

    # Category 3: 🕸️ ผังข้อมูลความสัมพันธ์ (i2 Graph)
    summary_parts.append("\n🕸️ **3. ผังข้อมูลความสัมพันธ์ (i2 Graph):**")
    if total_linked > 0:
        summary_parts.append(f"• 🔗 สร้างเส้นโยงความสัมพันธ์เครือข่าย/ครอบครัว **{total_linked}** เส้น")
    if has_any_bank_slip:
        summary_parts.append("• 💳 สร้างโหนดบัญชีธนาคารและเส้นทางการเงินลงผังเรียบร้อย")
    summary_parts.append("• 🌐 อัปเดตโหนดบุคคล ข้อมูลหลักฐาน และเชื่อมโยงลงบน Dashboard แล้ว")

    # Category 4: 🚘 ข้อมูลยานพาหนะ (Central Vehicles)
    if batch_vehicles:
        summary_parts.append("\n🚘 **4. ข้อมูลยานพาหนะ (Central Vehicles):**")
        for bv in batch_vehicles:
            p_str = bv.get("plate") or "-"
            pr_str = bv.get("province") or ""
            vt_str = bv.get("type") or bv.get("vehicle_type") or "รถยนต์"
            bm_str = f" {bv.get('brand', '')} {bv.get('model', '')}".strip()
            if bm_str:
                bm_str = f" - {bm_str}"
            summary_parts.append(f"• 🚗 ทะเบียน: **{p_str} {pr_str}** ({vt_str}){bm_str}")
            if all_suspects:
                summary_parts.append(f"  └ 👤 ผูกกับผู้ครอบครอง: **{all_suspects[0].get('suspect_name')}**")

    summary_text = "\n".join(summary_parts)

    # Build inline buttons for direct access
    keyboard_buttons = []

    # 1. Buttons to view suspect dossiers
    dossier_row = []
    seen_dids = set()
    for did in created_dossier_ids:
        if did in seen_dids:
            continue
        seen_dids.add(did)
        prof = dossier_mgr.get_dossier_profile(did)
        s_name = prof.get("suspect_name") if prof else did
        short_name = s_name[:14] + ".." if len(s_name) > 16 else s_name
        dossier_row.append({"text": f"👤 ดูถังข้อมูล: {short_name}", "callback_data": make_safe_cb_data("view_dossier", did)})
        if len(dossier_row) == 2:
            keyboard_buttons.append(dossier_row)
            dossier_row = []
    if dossier_row:
        keyboard_buttons.append(dossier_row)

    # 2. Button to view vehicle if detected
    if batch_vehicles:
        veh_row = []
        for bv in batch_vehicles[:2]:
            raw_p = bv.get("plate", "")
            plate_k = re.sub(r'[\s\-_.]', '', str(raw_p))
            if plate_k:
                veh_row.append({"text": f"🚘 ดูข้อมูลรถ: {raw_p}", "callback_data": make_safe_cb_data("view_veh", plate_k)})
        if veh_row:
            keyboard_buttons.append(veh_row)

    # 3. Confirmation button
    if created_dossier_ids:
        primary_did = created_dossier_ids[0]
        keyboard_buttons.append([{"text": "✅ ข้อมูลถูกต้องครบถ้วน", "callback_data": make_safe_cb_data("confirm_dossier", primary_did)}])

    reply_markup = {"inline_keyboard": keyboard_buttons} if keyboard_buttons else None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            send_payload: Dict[str, Any] = {"chat_id": chat_id, "text": summary_text, "parse_mode": "Markdown"}
            if reply_markup:
                send_payload["reply_markup"] = reply_markup
            resp = await client.post(f"{url}/sendMessage", json=send_payload)
            if resp.status_code != 200:
                logger.warning(f"Telegram summary sendMessage returned status {resp.status_code}: {resp.text}. Retrying plain text fallback...")
                send_payload.pop("parse_mode", None)
                send_payload.pop("reply_markup", None)
                await client.post(f"{url}/sendMessage", json=send_payload)
    except Exception as send_err:
        logger.error(f"Failed to send debounced media group summary: {send_err}")


async def handle_intelligence_text(
    client: httpx.AsyncClient,
    url: str,
    chat_id: Any,
    username: str,
    text: str
) -> bool:
    """
    Parses intelligence text snippets (Carrier checks, PEA meters, SIM details)
    and merges them into the matched or active session dossier using Hybrid Matching.
    Returns True if handled, False if ordinary conversation.
    """
    intel = parse_intel_text(text)
    if not intel:
        return False

    # Hybrid Matching Strategy:
    # 1. Match by 13-digit Citizen ID
    target_dossier_id = None
    if intel.get("id_card"):
        target_dossier_id = dossier_mgr.find_dossier_id(id_card=intel["id_card"])

    # 2. Match by any phone number in intel
    if not target_dossier_id and intel.get("phones"):
        for ph in intel["phones"]:
            found_id = dossier_mgr.find_dossier_id(phone=ph)
            if found_id:
                target_dossier_id = found_id
                break

    # 3. Match by Active Session in Chat (within 30 minutes)
    session = chat_session_mgr.get_active_dossier(chat_id)
    if not target_dossier_id and session:
        target_dossier_id = session.get("dossier_id")

    # 4. Match by Suspect Name if present
    if not target_dossier_id and intel.get("suspect_name"):
        target_dossier_id = dossier_mgr.find_dossier_id(suspect_name=intel["suspect_name"])

    if not target_dossier_id:
        if intel.get("intel_type") == "vehicle_intel":
            v_info = intel.get("vehicle_info") or {}
            veh_rec = vehicle_mgr.upsert_vehicle(
                plate=v_info.get("plate"),
                province=v_info.get("province"),
                vehicle_type=v_info.get("type"),
                ownership_status="unidentified",
                source="telegram_intel",
                notes="ไม่ทราบผู้ครอบครองแน่ชัด / อยู่ระหว่างสืบสวน"
            )
            plate_k = re.sub(r'[\s\-_.]', '', str(veh_rec.get("plate", "")))
            prompt_msg = (
                f"🚘 **ตรวจพบข้อมูลยานพาหนะ: {veh_rec.get('plate')} {veh_rec.get('province')} ({veh_rec.get('type')})** 🦥\n\n"
                f"⚠️ ยังไม่ได้ผูกกับบุคคลเป้าหมายในระบบ กรุณาเลือกการดำเนินการครับผม:"
            )
            reply_markup = {
                "inline_keyboard": [
                    [{"text": "❓ บันทึกเป็นรถต้องสงสัย (ไม่ทราบเจ้าของ)", "callback_data": make_safe_cb_data("unidentified_veh", plate_k)}],
                    [{"text": "👤 ระบุชื่อเจ้าของ / เปลี่ยนเจ้าของ", "callback_data": make_safe_cb_data("reassign_veh", plate_k)}]
                ]
            }
            await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": prompt_msg, "reply_markup": reply_markup, "parse_mode": "Markdown"})
            return True

        # If it's an explicit intelligence lookup result but has no match/session
        if intel.get("intel_type") in ["carrier_summary", "carrier_detail", "pea_electricity"]:
            warn_msg = (
                "⚠️ **ตรวจพบข้อมูลผลสืบสวน แต่ไม่พบแฟ้มบุคคลที่เชื่อมโยงในระบบ** 🦥\n\n"
                "💡 ไม่พบแฟ้มที่เลขบัตร/เบอร์โทรตรงกัน และไม่มีแฟ้มบุคคลที่เปิดค้างไว้ล่าสุดในห้องแชทนี้ครับ\n"
                "กรุณาส่งรูป ทร.14 หรือพิมพ์ระบุชื่อแฟ้มก่อนส่งผลสืบสวนครับผม ✨"
            )
            await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": warn_msg, "parse_mode": "Markdown"})
            return True
        return False

    # Load dossier profile
    target_profile = dossier_mgr.get_dossier_detail(target_dossier_id)
    if not target_profile:
        return False

    updates_applied: Dict[str, Any] = {}
    new_phones_count = 0

    # 1. Merge phone numbers
    existing_phones = target_profile.get("phones", []) or []
    if target_profile.get("phone_number") and target_profile.get("phone_number") not in existing_phones:
        existing_phones.insert(0, target_profile.get("phone_number"))

    for p in intel.get("phones", []):
        if p not in existing_phones:
            existing_phones.append(p)
            new_phones_count += 1

    if new_phones_count > 0:
        target_profile["phones"] = existing_phones
        if not target_profile.get("phone_number"):
            target_profile["phone_number"] = existing_phones[0]
        updates_applied["phones"] = f"เพิ่มใหม่ {new_phones_count} เบอร์"

    # 2. Update ID Card if dossier is missing one
    if intel.get("id_card") and not target_profile.get("id_card"):
        target_profile["id_card"] = intel["id_card"]
        updates_applied["id_card"] = intel["id_card"]

    # 3. Update Address / District / Subdistrict if PEA provides one and current address is weak
    if intel.get("address"):
        cur_addr = target_profile.get("address") or ""
        if not cur_addr or "ไม่ระบุ" in cur_addr or len(cur_addr) < 10:
            target_profile["address"] = intel["address"]
            if intel.get("district"): target_profile["district"] = intel["district"]
            if intel.get("subdistrict"): target_profile["subdistrict"] = intel["subdistrict"]
            updates_applied["address"] = intel["address"]

    # 4. Append structured intelligence notes
    cur_notes = target_profile.get("notes") or ""
    addon = ""
    intel_type = intel.get("intel_type")
    now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M")

    if intel_type == "pea_electricity" and intel.get("pea_info"):
        pea = intel["pea_info"]
        addon = (
            f"\n\n[ข้อมูลการไฟฟ้า PEA - อัปเดต {now_str}]\n"
            f"- ที่อยู่: {pea.get('address') or intel.get('address') or '-'}\n"
            f"- CA: {pea.get('ca') or '-'}\n"
            f"- PEA NO: {pea.get('pea_no') or '-'}\n"
            f"- ชื่อลูกค้า: {pea.get('customer_name') or '-'}\n"
            f"- พิกัด (Google Maps): {pea.get('maps_url') or '-'}"
        )
        updates_applied["pea"] = f"PEA NO {pea.get('pea_no') or '-'}"

    elif intel_type == "carrier_detail" and intel.get("carrier_info"):
        ci = intel["carrier_info"]
        addon = (
            f"\n\n[ข้อมูลบริการซิม {ci.get('network') or ''} - อัปเดต {now_str}]\n"
            f"- เบอร์: {intel.get('primary_phone') or '-'}\n"
            f"- แพ็กเกจ: {ci.get('package') or '-'}\n"
            f"- SIM: {ci.get('sim') or '-'}\n"
            f"- IMSI: {ci.get('imsi') or '-'}"
        )
        updates_applied["carrier_detail"] = f"ซิม {ci.get('network') or ''}"

    elif intel_type == "carrier_summary":
        net = (intel.get("carrier_info") or {}).get("network", "")
        addon = (
            f"\n\n[ข้อมูลตรวจค้นเครือข่าย {net} - อัปเดต {now_str}]\n"
            f"- เลขบัตร: {intel.get('id_card') or '-'}\n"
            f"- เบอร์ที่พบ ({len(intel.get('phones', []))} เบอร์): {', '.join(intel.get('phones', []))}"
        )
        updates_applied["carrier_summary"] = f"เครือข่าย {net}"

    elif intel_type == "vehicle_intel" and intel.get("vehicle_info"):
        v_info = intel["vehicle_info"]
        plate_str = v_info.get("plate")
        prov_str = v_info.get("province")
        v_type_str = v_info.get("type") or "รถยนต์"
        color_str = v_info.get("color")
        
        veh_rec = vehicle_mgr.upsert_vehicle(
            plate=plate_str,
            province=prov_str,
            vehicle_type=v_type_str,
            color=color_str,
            owner_name=target_profile.get("suspect_name"),
            owner_id=target_profile.get("id_card"),
            dossier_id=target_dossier_id,
            ownership_status="verified",
            source="telegram_intel",
            notes=f"บันทึกผ่านแชทสืบสวน {now_str}"
        )
        d_vehicles = target_profile.get("vehicles", []) or []
        clean_new_p = re.sub(r'\s', '', veh_rec.get("plate", ''))
        if not any(re.sub(r'\s', '', ex_v.get("plate", '')) == clean_new_p for ex_v in d_vehicles):
            d_vehicles.append({
                "plate": veh_rec.get("plate"),
                "province": veh_rec.get("province"),
                "type": veh_rec.get("type"),
                "color": veh_rec.get("color"),
                "ownership_status": "verified"
            })
            target_profile["vehicles"] = d_vehicles
            updates_applied["vehicles"] = f"{plate_str} {prov_str}"
        
        addon = (
            f"\n\n[ข้อมูลยานพาหนะที่ใช้ - อัปเดต {now_str}]\n"
            f"- ทะเบียน: {plate_str} {prov_str}\n"
            f"- ประเภท: {v_type_str}\n"
            f"- สี: {color_str or '-'}"
        )

    elif intel_type == "standalone_name":
        new_name = intel.get("suspect_name")
        target_profile["suspect_name"] = new_name
        target_profile["name_source"] = "officer_correction"
        updates_applied["name"] = new_name

    if addon and addon not in cur_notes:
        target_profile["notes"] = (cur_notes + addon).strip()

    target_profile["updated_at"] = datetime.datetime.now().isoformat()

    # Save updated profile
    prof_path = os.path.join(dossier_mgr.dossiers_dir, target_dossier_id, "profile.json")
    try:
        with open(prof_path, "w", encoding="utf-8") as pf:
            json.dump(target_profile, pf, ensure_ascii=False, indent=2)
    except Exception as save_err:
        logger.error(f"Failed to save profile for {target_dossier_id}: {save_err}")
        return False

    # Rebuild indexes
    dossier_mgr.rebuild_index()
    try:
        nas_manager.person_registry.reindex_all_cases()
    except Exception as reindex_err:
        logger.warning(f"Reindex error: {reindex_err}")

    # Refresh active chat session
    chat_session_mgr.set_active_dossier(
        chat_id=chat_id,
        dossier_id=target_dossier_id,
        suspect_name=target_profile.get("suspect_name", ""),
        id_card=target_profile.get("id_card"),
        phone_number=target_profile.get("phone_number"),
        officer_username=username
    )

    # Send Rich Telegram Confirmation
    reply_lines = [
        "🗂️ **อัปเดตข้อมูลเข้าแฟ้มบุคคลเรียบร้อยแล้วครับ!** 🦥✨\n",
        f"👤 **ชื่อเป้าหมาย:** {target_profile.get('suspect_name')}",
        f"📁 **รหัสแฟ้ม:** `{target_dossier_id}`"
    ]
    if target_profile.get("id_card"):
        reply_lines.append(f"🪪 **เลขบัตรประชาชน:** `{target_profile.get('id_card')}`")
    if target_profile.get("phones"):
        all_p = target_profile.get("phones", [])
        p_str = ", ".join(f"`{p}`" for p in all_p[:5])
        if len(all_p) > 5:
            p_str += f" (+{len(all_p) - 5} เบอร์)"
        reply_lines.append(f"📞 **เบอร์โทรศัพท์ ({len(all_p)} เบอร์):** {p_str}")
    if target_profile.get("address"):
        reply_lines.append(f"🏠 **ที่อยู่:** {target_profile.get('address')}")
    if intel_type == "pea_electricity" and intel.get("pea_info"):
        pea = intel["pea_info"]
        reply_lines.append(f"⚡ **มิเตอร์ไฟฟ้า PEA:** `{pea.get('pea_no') or '-'}` (CA: `{pea.get('ca') or '-'}`)")
        if pea.get("maps_url"):
            reply_lines.append(f"📍 **พิกัด Google Maps:** [กดเพื่อเปิดแผนที่]({pea.get('maps_url')})")
    
    reply_markup = None
    if intel_type == "vehicle_intel" and intel.get("vehicle_info"):
        v_info = intel["vehicle_info"]
        reply_lines.append(f"🚘 **ยานพาหนะที่ผูก:** `{v_info.get('plate')} {v_info.get('province')}` ({v_info.get('type') or 'รถยนต์'})")
        plate_k = re.sub(r'[\s\-_.]', '', str(v_info.get("plate", "")))
        reply_markup = {
            "inline_keyboard": [
                [
                    {"text": "👤 เปลี่ยนเจ้าของ", "callback_data": make_safe_cb_data("reassign_veh", plate_k)},
                    {"text": "❓ ไม่ทราบเจ้าของ (รถต้องสงสัย)", "callback_data": make_safe_cb_data("unidentified_veh", plate_k)}
                ]
            ]
        }

    reply_text = "\n".join(reply_lines)
    send_body = {"chat_id": chat_id, "text": reply_text, "parse_mode": "Markdown", "disable_web_page_preview": True}
    if reply_markup:
        send_body["reply_markup"] = reply_markup
    await client.post(f"{url}/sendMessage", json=send_body)
    return True


async def telegram_polling_loop():
    global TELEGRAM_TOKEN
    while not (os.getenv("TELEGRAM_BOT_TOKEN") or TELEGRAM_TOKEN):
        await asyncio.sleep(5.0)
    TELEGRAM_TOKEN = (os.getenv("TELEGRAM_BOT_TOKEN") or TELEGRAM_TOKEN or "").strip()
    offset = 0
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
    file_url = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/"

    # Set Telegram Bot Commands menu
    async with httpx.AsyncClient(timeout=30.0) as init_client:
        try:
            bot_cmds = [
                {"command": "start", "description": "เริ่มใช้งาน / ผูกบัญชี"},
                {"command": "help", "description": "คำแนะนำการใช้งานทั้งหมด"},
                {"command": "list", "description": "ดูรายการเหตุการณ์ย้อนหลัง (จำแนกสิทธิ์)"},
                {"command": "search", "description": "ค้นหาบุคคล / สำนวนคดีใน NAS (พร้อมรูปภาพ ทร.14)"},
                {"command": "persons", "description": "ดูรายชื่อบุคคลทั้งหมดในฐานข้อมูล"},
                {"command": "delete", "description": "ลบสำนวนคดีออกจาก NAS (เช่น /delete Case_ID)"},
                {"command": "clear", "description": "ล้างข้อมูลเหตุการณ์และแผนที่ความเสี่ยง (Admin)"}
            ]
            await init_client.post(f"{url}/setMyCommands", json={"commands": bot_cmds})
            logger.info("Successfully registered Telegram bot command menu.")
        except Exception as err:
            logger.warning(f"Could not set Telegram commands: {err}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            try:
                cur_tok = (os.getenv("TELEGRAM_BOT_TOKEN") or TELEGRAM_TOKEN or "").strip()
                if not cur_tok:
                    await asyncio.sleep(5.0)
                    continue
                if cur_tok != TELEGRAM_TOKEN:
                    TELEGRAM_TOKEN = cur_tok
                    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
                    file_url = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/"
                resp = await client.get(f"{url}/getUpdates", params={"offset": offset, "timeout": 30})
                if resp.status_code == 200:
                    data = resp.json()
                    for update in data.get("result", []):
                        offset = update["update_id"] + 1

                        # Handle Telegram Inline Button Callbacks
                        callback_query = update.get("callback_query")
                        if callback_query:
                            cb_id = callback_query.get("id")
                            cb_data = callback_query.get("data", "")
                            cb_msg = callback_query.get("message", {})
                            cb_chat_id = cb_msg.get("chat", {}).get("id")

                            if cb_data.startswith("finish_batch:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "⏳ กำลังเริ่มประมวลผลชุดข้อมูล กรุณารอสักครู่ครับ... 🦥",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass

                                cb_msg_id = cb_msg.get("message_id")
                                if cb_chat_id and cb_msg_id:
                                    try:
                                        await client.post(f"{url}/editMessageText", json={
                                            "chat_id": cb_chat_id,
                                            "message_id": cb_msg_id,
                                            "text": "⏳ **กำลังประมวลผลชุดข้อมูล...**\n\nระบบกำลังอ่านเอกสาร (AI OCR) สกัดข้อมูลบุคคล และจัดระเบียบข้อมูลลงถัง กรุณารอสักครู่ครับผม 🦥✨",
                                            "parse_mode": "Markdown"
                                        })
                                    except Exception:
                                        pass

                                b_key = resolve_cb_payload(cb_data.split("finish_batch:", 1)[1])
                                if b_key in MEDIA_GROUP_TIMERS:
                                    MEDIA_GROUP_TIMERS[b_key].cancel()
                                asyncio.create_task(debounced_process_media_group(b_key, delay=0.0))
                                continue
                            elif cb_data.startswith("view_dossier:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "📂 กำลังเปิดถังข้อมูลบุคคล... 🦥",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass

                                d_id = resolve_cb_payload(cb_data.split("view_dossier:", 1)[1])
                                d_profile = dossier_mgr.get_dossier_profile(d_id)
                                if d_profile:
                                    d_name = d_profile.get("suspect_name") or "ไม่ระบุชื่อ"
                                    d_cid = d_profile.get("id_card") or "-"
                                    d_phones = d_profile.get("phones") or ([d_profile["phone_number"]] if d_profile.get("phone_number") else [])
                                    phones_str = ", ".join(d_phones) if d_phones else "-"
                                    d_addr = d_profile.get("address") or "-"

                                    d_vehs = d_profile.get("vehicles", [])
                                    veh_lines = []
                                    for v in d_vehs:
                                        veh_lines.append(f"• 🚗 {v.get('plate', '')} {v.get('province', '')} ({v.get('type') or 'รถยนต์'})")
                                    veh_text = "\n".join(veh_lines) if veh_lines else "ยังไม่มีข้อมูลรถที่ผูก"

                                    pea_info = d_profile.get("pea_info") or {}
                                    pea_text = "ไม่มีข้อมูลมิเตอร์"
                                    if pea_info.get("pea_no"):
                                        pea_no = pea_info.get("pea_no")
                                        ca_no = pea_info.get("ca") or "-"
                                        maps_url = pea_info.get("google_maps_url") or ""
                                        map_link_str = f"\n  └ 🗺️ [เปิดดูพิกัดบน Google Maps]({maps_url})" if maps_url else ""
                                        pea_text = f"PEA NO: `{pea_no}` (CA: {ca_no}){map_link_str}"

                                    p_files = d_profile.get("personal_files", [])
                                    file_cnt = len(p_files)

                                    dossier_card_text = (
                                        f"👤 **ถังข้อมูลบุคคล: {d_name}** 🦥✨\n\n"
                                        f"• 🪪 **เลขบัตร ปชช.:** `{d_cid}`\n"
                                        f"• 📞 **เบอร์โทรศัพท์:** {phones_str}\n"
                                        f"• 🏠 **ที่อยู่/ภูมิลำเนา:** {d_addr}\n"
                                        f"• ⚡ **มิเตอร์ไฟฟ้า PEA:** {pea_text}\n"
                                        f"• 🚘 **ยานพาหนะที่ครอบครอง:**\n{veh_text}\n"
                                        f"• 📑 **จำนวนหลักฐานในถัง:** {file_cnt} ไฟล์\n"
                                        f"• 📁 **รหัสแฟ้มในคลัง:** `{d_id}`\n"
                                    )
                                else:
                                    dossier_card_text = f"❌ ไม่พบข้อมูลแฟ้มบุคคล `{d_id}` ในระบบครับผม"

                                try:
                                    d_resp = await client.post(f"{url}/sendMessage", json={
                                        "chat_id": cb_chat_id,
                                        "text": dossier_card_text,
                                        "parse_mode": "Markdown",
                                        "disable_web_page_preview": True
                                    })
                                    if d_resp.status_code != 200:
                                        await client.post(f"{url}/sendMessage", json={
                                             "chat_id": cb_chat_id,
                                             "text": dossier_card_text,
                                             "disable_web_page_preview": True
                                        })
                                except Exception as d_send_err:
                                    logger.error(f"Failed to send dossier card: {d_send_err}")
                                continue
                            elif cb_data.startswith("confirm_dossier:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "✅ บันทึกยืนยันข้อมูลเรียบร้อยแล้ว",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass
                                d_id = resolve_cb_payload(cb_data.split("confirm_dossier:", 1)[1])
                                await client.post(f"{url}/sendMessage", json={
                                    "chat_id": cb_chat_id,
                                    "text": f"✅ ข้อมูลแฟ้ม `{d_id}` ได้รับการยืนยันความถูกต้องเรียบร้อยแล้วครับผม 💙"
                                })
                                continue
                            elif cb_data.startswith("unidentified_veh:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "❓ ทำเครื่องหมายรถต้องสงสัย",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass
                                plate_k = resolve_cb_payload(cb_data.split("unidentified_veh:", 1)[1])
                                vehicle_mgr.set_unidentified(plate_k, None, notes="เจ้าหน้าที่ระบุไม่ทราบผู้ครอบครองผ่านปุ่ม Telegram")
                                await client.post(f"{url}/sendMessage", json={
                                    "chat_id": cb_chat_id,
                                    "text": f"❓ กำหนดสถานะยานพาหนะ `{plate_k}` เป็น 'ยานพาหนะต้องสงสัย (ไม่ทราบเจ้าของ)' เรียบร้อยแล้วครับ 🦥"
                                })
                                continue
                            elif cb_data.startswith("reassign_veh:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "✏️ เตรียมเปลี่ยนเจ้าของรถ",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass
                                plate_k = resolve_cb_payload(cb_data.split("reassign_veh:", 1)[1])
                                await client.post(f"{url}/sendMessage", json={
                                    "chat_id": cb_chat_id,
                                    "text": f"✏️ **เปลี่ยนเจ้าของรถ `{plate_k}`**:\n\nกรุณาพิมพ์ส่งชื่อเจ้าของใหม่ เช่น:\n`รถ {plate_k} ของ นายสมชาย ใจดี`",
                                    "parse_mode": "Markdown"
                                })
                                continue
                            elif cb_data.startswith("view_veh:"):
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={
                                        "callback_query_id": cb_id,
                                        "text": "🚘 กำลังดึงข้อมูลยานพาหนะ... 🦥",
                                        "show_alert": False
                                    })
                                except Exception:
                                    pass
                                plate_k = resolve_cb_payload(cb_data.split("view_veh:", 1)[1])
                                v_rec = vehicle_mgr.find_vehicle(plate_k)
                                if v_rec:
                                    v_text = (
                                        f"🚘 **ข้อมูลยานพาหนะในระบบ** 🦥✨\n\n"
                                        f"• **ทะเบียน:** `{v_rec.get('plate')} {v_rec.get('province')}`\n"
                                        f"• **ประเภท:** {v_rec.get('type')}\n"
                                        f"• **ยี่ห้อ/รุ่น:** {v_rec.get('brand') or '-'} {v_rec.get('model') or ''}\n"
                                        f"• **สี:** {v_rec.get('color') or '-'}\n"
                                        f"• **ผู้ครอบครอง:** {v_rec.get('owner_name') or 'ไม่ทราบเจ้าของ (รถต้องสงสัย)'}\n"
                                        f"• **แฟ้มคดี:** `{v_rec.get('dossier_id') or 'ยังไม่ผูกกับแฟ้ม'}`\n"
                                        f"• **สถานะ:** {v_rec.get('ownership_status')}\n"
                                    )
                                else:
                                    v_text = f"ไม่พบข้อมูลรถ `{plate_k}` ในระบบครับ"

                                try:
                                    v_resp = await client.post(f"{url}/sendMessage", json={"chat_id": cb_chat_id, "text": v_text, "parse_mode": "Markdown"})
                                    if v_resp.status_code != 200:
                                        await client.post(f"{url}/sendMessage", json={"chat_id": cb_chat_id, "text": v_text})
                                except Exception as v_err:
                                    logger.error(f"Failed to send vehicle card: {v_err}")
                                continue
                            else:
                                try:
                                    await client.post(f"{url}/answerCallbackQuery", json={"callback_query_id": cb_id})
                                except Exception:
                                    pass

                        message = update.get("message", {})
                        chat_id = message.get("chat", {}).get("id")
                        if not chat_id:
                            continue
                            
                        text = message.get("text", "").strip()
                        photos = message.get("photo", [])
                        caption = message.get("caption", "").strip()

                        # 1. Check Authentication FIRST for all messages, commands & uploads
                        paired_username = auth_linker.get_paired_username("telegram", str(chat_id))

                        if not paired_username:
                            # User is NOT yet paired with system account
                            if text:
                                # Strict match: exactly 6 digits, optionally preceded by /pair
                                m_code = re.match(r"^\s*(?:/pair\s+)?(\d{6})\s*$", text)
                                if m_code:
                                    clean_code = m_code.group(1)
                                    paired_u = auth_linker.pair_bot_user("telegram", str(chat_id), clean_code)
                                    if paired_u:
                                        reply = (
                                            f"✅ ยืนยันการผูกบัญชีสำเร็จเรียบร้อยแล้ว ยินดีต้อนรับ {paired_u}!\n\n"
                                            f"ท่านได้เชื่อมต่อกับ Sloth AI Bot 🦥 ของระบบ Sloth BPP215 สำเร็จแล้ว\n\n"
                                            f"สามารถพิมพ์ค้นหา ป.14 หรือส่งเอกสาร/รูปภาพเพื่อบันทึกคดีได้ทันทีครับ! 🎯"
                                        )
                                    else:
                                        reply = (
                                            "❌ รหัสผูกบัญชีไม่ถูกต้อง หรือหมดอายุแล้ว (อายุ 10 นาที)\n\n"
                                            "กรุณากด 'ขอรหัสผูกบัญชีใหม่' จากหน้า Dashboard แล้วส่งมาอีกครั้งครับ"
                                        )
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply})
                                    continue
                                elif text.startswith("/start") or text.startswith("/pair"):
                                    reply = (
                                        "สวัสดีครับ! 🦥 ยินดีต้อนรับสู่ Sloth AI Bot\n\n"
                                        "กรุณาส่งรหัส 6 หลักจากหน้า Dashboard เพื่อผูกบัญชีเข้ากับระบบ (เช่น 123456 หรือ /pair 123456)\n\n"
                                        "เมื่อผูกสำเร็จแล้ว จะสามารถใช้งานค้นหา ป.14 และรับการแจ้งเตือนได้ทันที! 🚀"
                                    )
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply})
                                    continue

                            # If unauthenticated user sends any other text, command, photo, or document
                            reply = "⚠️ บัญชีของคุณยังไม่ได้ผูกกับระบบครับผม 🥺\n\nรบกวนกดปุ่ม 'ผูกบัญชี' บนหน้าเว็บ Dashboard แล้วนำรหัส 6 หลักมาส่งให้ผมก่อนนะครับผม ✨"
                            await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply})
                            continue

                        # User IS authenticated!
                        username = paired_username
                        user_role = get_user_role(username)

                        # If an already authenticated user explicitly wants to switch accounts via "/pair 123456"
                        if text:
                            m_explicit_pair = re.match(r"^\s*/pair\s+(\d{6})\s*$", text)
                            if m_explicit_pair:
                                clean_code = m_explicit_pair.group(1)
                                new_username = auth_linker.pair_bot_user("telegram", str(chat_id), clean_code)
                                if new_username:
                                    reply = f"✅ ยืนยันการเปลี่ยนการผูกบัญชีสำเร็จ ยินดีต้อนรับ {new_username}! 🦥✨"
                                else:
                                    reply = "❌ รหัสผูกบัญชีไม่ถูกต้อง หรือหมดอายุแล้ว (อายุ 10 นาที) ครับผม"
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply})
                                continue

                        # 3. Handle Authenticated Commands
                        if text:
                            # Handle /help
                            if text.startswith("/help") or text.startswith("/คำแนะนำ"):
                                help_msg = (
                                    "📌 **คำแนะนำการใช้งาน Sloth AI Bot** 🦥✨\n\n"
                                    "1️⃣ **ส่งรูปภาพ ทร.14 หรือเอกสาร Word (`.docx`)**: ส่งรูปถ่ายหรือไฟล์เอกสารรายงานจับกุมเข้ามาได้ทันที ระบบจะ AI OCR อ่านชื่อ เลขบัตร ที่อยู่ และจัดเก็บเข้า NAS อัตโนมัติครับ\n"
                                    "2️⃣ **ดูรายการเหตุการณ์ (`/list`)**: แสดงรายการเหตุการณ์ย้อนหลัง (แยกสิทธิ์ Admin เห็นทั้งหมด / Officer เห็นเฉพาะรายการของตนเอง)\n"
                                    "3️⃣ **ค้นหาบุคคล/คดี (`/search <ชื่อ/เลขบัตร/คดี>`)**: ค้นหาประวัติบุคคล พร้อมส่งภาพ ทร.14 และรายชื่อคนที่อยู่บ้านเดียวกันกลับมาให้ครับ\n"
                                    "4️⃣ **ดูบุคคลทั้งหมด (`/persons`)**: แสดงรายชื่อบุคคลที่มีประวัติในระบบ\n"
                                    "5️⃣ **ลบสำนวนคดี (`/delete <Case_ID>`)**: สั่งลบสำนวนคดีออกจากคลัง NAS\n"
                                    "6️⃣ **ล้างข้อมูลแผนที่ (`/clear`)**: รีเซ็ตสถิติและดัชนีแผนที่ความเสี่ยง (จำกัดเฉพาะสิทธิ์ Admin)\n"
                                    "7️⃣ **ผูกบัญชี (`/start` หรือส่งรหัส 6 หลัก)**: เชื่อมต่อบัญชี Telegram กับระบบ Sloth BPP215 ถาวรครับ 💙"
                                )
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": help_msg, "parse_mode": "Markdown"})
                                continue

                            # Handle case deletion e.g. "/delete Case_20260807_065803" or "/delete"
                            del_match = re.match(r"^(?:/delete|/del|ลบ)(?:\s+(.*))?$", text, re.IGNORECASE)
                            if del_match:
                                target = (del_match.group(1) or "").strip()
                                if not target:
                                    reply = (
                                        "🗑️ **รบกวนระบุเลขคดีที่ต้องการลบครับผม!** 🦥✨\n\n"
                                        "ตัวอย่างการใช้งาน:\n"
                                        "• `/delete Case_20260807_065803`\n"
                                        "• `ลบ Case_20260807_065803`\n\n"
                                        "💡 คัดลอกเลขคดีมาวางต่อจากคำสั่งได้เลยนะครับ"
                                    )
                                else:
                                    target_case_id = target.replace(" ", "_").replace("-", "_")
                                    ok = nas_manager.delete_case(target_case_id)
                                    if ok:
                                        reply = f"🗑️ **ลบสำนวนคดี {target_case_id} ออกจากคลัง NAS เรียบร้อยแล้วครับ!** 🦥✨"
                                    else:
                                        reply = f"🥺 ไม่พบสำนวนคดี '{target_case_id}' ในระบบ NAS ครับผม รบกวนตรวจสอบเลขคดีอีกครั้งนะครับ"
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply, "parse_mode": "Markdown"})
                                continue

                            # Handle /search <query> or /search
                            search_match = re.match(r"^(?:/search|ค้นหา)(?:\s+(.*))?$", text, re.IGNORECASE)
                            if search_match:
                                q_term = (search_match.group(1) or "").strip()
                                if not q_term:
                                    prompt_msg = (
                                        "🔍 **รบกวนพิมพ์ระบุชื่อ เลขบัตร หรือเลขคดีที่ต้องการค้นหาครับผม!** 🦥✨\n\n"
                                        "ตัวอย่างการใช้งาน:\n"
                                        "• `/search เดชิต` (ค้นหาด้วยชื่อ)\n"
                                        "• `/search 3720800479961` (ค้นหาด้วยเลขบัตรประชาชน)\n"
                                        "• `/search Case_20260807` (ค้นหาด้วยเลขคดี)\n"
                                        "• `/search หนองหงส์` (ค้นหาด้วยสถานที่/คำในรายงาน)\n\n"
                                        "💡 สามารถพิมพ์คำค้นหาต่อท้ายคำสั่ง `/search ` ได้ทันทีเลยนะครับผม 💙"
                                    )
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": prompt_msg, "parse_mode": "Markdown"})
                                    continue
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": f"🔍 กำลังค้นหาข้อมูล '{q_term}' ในคลัง NAS และฐานข้อมูลเหตุการณ์สักครู่นะครับ... 🦥"})
                                await execute_telegram_search(client, url, chat_id, q_term, username)
                                continue

                            # Handle /vehicle or /รถ <plate>
                            veh_cmd_match = re.match(r"^(?:/vehicle|/veh|/รถ|รถ)(?:\s+(.*))?$", text, re.IGNORECASE)
                            if veh_cmd_match:
                                q_v = (veh_cmd_match.group(1) or "").strip()
                                if not q_v:
                                    prompt_v = (
                                        "🚘 **รบกวนระบุเลขทะเบียนที่ต้องการค้นหาครับผม!** 🦥✨\n\n"
                                        "ตัวอย่างการใช้งาน:\n"
                                        "• `/vehicle ขฒ 4719`\n"
                                        "• `/รถ 4719`\n"
                                        "• `/vehicle 1ฒฮ 8899`"
                                    )
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": prompt_v, "parse_mode": "Markdown"})
                                    continue
                                v_found = vehicle_mgr.find_vehicle(q_v)
                                if v_found:
                                    plate_k = re.sub(r'[\s\-_.]', '', str(v_found.get("plate", "")))
                                    v_card = (
                                        f"🚘 **ข้อมูลยานพาหนะในระบบ** 🦥✨\n\n"
                                        f"• **ทะเบียน:** `{v_found.get('plate')} {v_found.get('province')}`\n"
                                        f"• **ประเภท:** {v_found.get('type')}\n"
                                        f"• **ยี่ห้อ/รุ่น:** {v_found.get('brand') or '-'} {v_found.get('model') or ''}\n"
                                        f"• **สี:** {v_found.get('color') or '-'}\n"
                                        f"• **ผู้ครอบครอง:** {v_found.get('owner_name') or 'ไม่ทราบเจ้าของ (รถต้องสงสัย)'}\n"
                                        f"• **แฟ้มคดี:** `{v_found.get('dossier_id') or 'ยังไม่ผูกกับแฟ้ม'}`\n"
                                        f"• **สถานะ:** {v_found.get('ownership_status')}\n"
                                    )
                                    if v_found.get("notes"):
                                        v_card += f"• **หมายเหตุ:** {v_found.get('notes')}\n"
                                    
                                    reply_markup = {
                                        "inline_keyboard": [
                                            [{"text": "👤 เปลี่ยนเจ้าของ", "callback_data": make_safe_cb_data("reassign_veh", plate_k)}],
                                            [{"text": "❓ ทำเครื่องหมายไม่ทราบเจ้าของ", "callback_data": make_safe_cb_data("unidentified_veh", plate_k)}]
                                        ]
                                    }
                                    v_res = await client.post(f"{url}/sendMessage", json={
                                        "chat_id": chat_id,
                                        "text": v_card,
                                        "reply_markup": reply_markup,
                                        "parse_mode": "Markdown"
                                    })
                                    if v_res.status_code != 200:
                                        await client.post(f"{url}/sendMessage", json={
                                            "chat_id": chat_id,
                                            "text": v_card
                                        })
                                else:
                                    await client.post(f"{url}/sendMessage", json={
                                        "chat_id": chat_id,
                                        "text": f"🥺 ไม่พบข้อมูลยานพาหนะ '{q_v}' ในระบบครับผม"
                                    })
                                continue

                            # Handle /persons
                            if text.startswith("/persons") or text.startswith("/บุคคล"):
                                persons_list = nas_manager.person_registry.get_all_persons()
                                if not persons_list:
                                    reply = "📭 ยังไม่มีประวัติบุคคลในฐานข้อมูลครับผม"
                                else:
                                    p_lines = [f"👥 **รายชื่อบุคคลในระบบ ({len(persons_list)} คน):** 🦥✨\n"]
                                    for p in persons_list:
                                        p_lines.append(f"• **{p.get('suspect_name')}** (`{p.get('id_card') or 'ไม่ระบุบัตร'}`) | เชื่อมโยง {len(p.get('sources', []))} คดี")
                                    p_lines.append("\n💡 พิมพ์ `/search <ชื่อหรือเลขบัตร>` เพื่อดูรายละเอียดเต็มครับ")
                                    reply = "\n".join(p_lines)
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply, "parse_mode": "Markdown"})
                                continue

                            # Handle /link <person1> <person2> [reason]
                            link_match = re.match(r"^/link\s+([^\s]+)\s+([^\s]+)(?:\s+(.*))?$", text, re.IGNORECASE)
                            if link_match:
                                d_a = link_match.group(1).strip()
                                d_b = link_match.group(2).strip()
                                reason_txt = (link_match.group(3) or "เจ้าหน้าที่เชื่อมโยงผ่านคำสั่ง Telegram").strip()

                                matches_a = dossier_mgr.get_all_dossiers(query=d_a)
                                matches_b = dossier_mgr.get_all_dossiers(query=d_b)
                                target_a = matches_a[0]["dossier_id"] if matches_a else d_a
                                target_b = matches_b[0]["dossier_id"] if matches_b else d_b

                                ok = dossier_mgr.link_two_dossiers(target_a, target_b, reason_txt)
                                if ok:
                                    reply = (
                                        f"🔗 **เชื่อมโยงบุคคลเรียบร้อยแล้วครับ!** 🦥✨\n\n"
                                        f"👤 **บุคคลที่ 1:** `{target_a}`\n"
                                        f"👤 **บุคคลที่ 2:** `{target_b}`\n"
                                        f"📝 **เหตุผล:** {reason_txt}\n\n"
                                        f"🕸️ ปรากฏเส้นเชื่อมโยงบนผังเครือข่าย i2 และแท็บเครือข่ายเรียบร้อยครับผม 💙"
                                    )
                                else:
                                    reply = f"⚠️ ไม่สามารถเชื่อมโยงได้ (ไม่พบถังข้อมูล '{d_a}' หรือ '{d_b}')"
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply, "parse_mode": "Markdown"})
                                continue

                        # Handle authenticated commands (/list, /clear)
                        if text:
                            if text.startswith("/list") or text.startswith("/รายการ"):
                                try:
                                    chat_service_url = (os.environ.get("CHAT_SERVICE_URL", "http://127.0.0.1:8443").rstrip("/") + "/api/chat/events")
                                    events_resp = await client.get(
                                        chat_service_url,
                                        headers={"X-User": username, "X-Role": user_role},
                                        timeout=10.0
                                    )
                                    if events_resp.status_code == 200:
                                        events_data = events_resp.json()
                                        events_list = events_data.get("events", [])
                                        if not events_list:
                                            reply = f"📭 **ยังไม่มีรายการเหตุการณ์ที่บันทึกไว้ครับ** {'(แสดงเฉพาะของคุณ: ' + username + ')' if user_role != 'admin' else ''}"
                                        else:
                                            e_lines = [f"📋 **รายการเหตุการณ์ {'ทั้งหมดในระบบ' if user_role == 'admin' else 'ของคุณ (' + username + ')'} ({len(events_list)} รายการ):** 🦥✨\n"]
                                            for i, ev in enumerate(list(reversed(events_list))[:10], 1):
                                                loc = ev.get('location_name') or ev.get('arrest_location') or 'ไม่ระบุพื้นที่'
                                                inc_type = ev.get('incident_type') or 'ทั่วไป'
                                                owner = f" [ผู้บันทึก: {ev.get('created_by')}]" if ev.get('created_by') else ""
                                                created = (ev.get('created_at') or '')[:16].replace("T", " ")
                                                e_lines.append(f"• **#{i}** `{ev.get('event_id')}` | 📍 **{loc}** ({inc_type}){owner}\n  🕒 {created}")
                                                if ev.get('first_name') or ev.get('last_name'):
                                                    e_lines.append(f"  👤 ผู้ต้องสงสัย: **{ev.get('first_name','')} {ev.get('last_name','')}**".strip())
                                                if ev.get('drug_quantity'):
                                                    e_lines.append(f"  💊 ของกลางยาบ้า: **{ev.get('drug_quantity'):,} เม็ด**")
                                            e_lines.append("\n💡 ลบหรือแจ้งแก้ไขรายการได้ผ่านหน้าเว็บ Dashboard ครับผม")
                                            reply = "\n".join(e_lines)
                                    else:
                                        reply = "⚠️ ไม่สามารถดึงรายการเหตุการณ์ได้ในขณะนี้ครับ"
                                except Exception as err:
                                    logger.error(f"Failed to fetch events for /list: {err}")
                                    reply = "⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อบริการรายการเหตุการณ์ครับ"
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply, "parse_mode": "Markdown"})
                                continue

                            if text.startswith("/clear") or text == "ล้างข้อมูล":
                                if user_role != "admin":
                                    reply = "⚠️ **สิทธิ์ไม่เพียงพอ!** การล้างข้อมูลสถิติทั้งหมดจำกัดเฉพาะสิทธิ์ **Admin** เท่านั้นครับ"
                                else:
                                    try:
                                        clear_resp = await client.delete(
                                            (os.environ.get("CHAT_SERVICE_URL", "http://127.0.0.1:8443").rstrip("/") + "/api/chat/clear"),
                                            headers={"X-User": username, "X-Role": "admin"},
                                            timeout=10.0
                                        )
                                        if clear_resp.status_code == 200:
                                            reply = "🗑️ **ล้างข้อมูลเหตุการณ์และแผนที่ความเสี่ยงเรียบร้อยแล้วครับ!** 🦥✨"
                                        else:
                                            reply = "⚠️ เกิดข้อผิดพลาดในการสั่งล้างข้อมูลครับ"
                                    except Exception as err:
                                        logger.error(f"Failed to clear events: {err}")
                                        reply = "⚠️ ไม่สามารถเชื่อมต่อบริการล้างข้อมูลได้ครับ"
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": reply, "parse_mode": "Markdown"})
                                continue

                        # 3. Handle Document (.docx / .doc / .pdf / .csv / .xlsx / .xls) Uploads + OCR + CDR
                        document = message.get("document")
                        if document:
                            doc_name = document.get("file_name", "document.docx")
                            doc_mime = document.get("mime_type", "")

                            # Handle CDR Call Detail Records (.csv, .xlsx, .xls)
                            if doc_name.lower().endswith((".csv", ".xlsx", ".xls")) or "spreadsheet" in doc_mime.lower() or "csv" in doc_mime.lower():
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": f"📊 ตรวจพบไฟล์ประวัติการโทร '{doc_name}' กำลังประมวลผลและจับคู่สายเครือข่ายสักครู่นะครับ... 🦥"})
                                file_id = document["file_id"]
                                file_resp = await client.get(f"{url}/getFile", params={"file_id": file_id})
                                if file_resp.status_code == 200:
                                    file_path = file_resp.json()["result"]["file_path"]
                                    doc_dl = await client.get(f"{file_url}{file_path}")
                                    if doc_dl.status_code == 200:
                                        doc_bytes = doc_dl.content
                                        try:
                                            cdr_res = cdr_parser.parse_cdr_file(
                                                doc_bytes,
                                                doc_name,
                                                dossier_manager=dossier_mgr,
                                                operator="telegram_user"
                                            )
                                            if cdr_res.get("report_type") == "SPNI_PHONE_REPORT":
                                                dev = cdr_res.get("device_info", {})
                                                top_pairs = cdr_res.get("call_pairs", [])[:5]
                                                pair_lines = []
                                                for p in top_pairs:
                                                    dur_m = round(p.get('total_duration_sec', 0) / 60, 1)
                                                    c_name = f" ({p['contact_name']})" if p.get('contact_name') else ""
                                                    pair_lines.append(f"  • `{p['party_a']}` <-> `{p['party_b']}`{c_name} : โทร {p['total_calls']} ครั้ง ({dur_m} นาที)")

                                                dossier_sync_info = cdr_res.get("dossier_sync", {})
                                                d_line = f"📂 **บันทึกเข้าถังข้อมูล (Arrest Vault):** `{dossier_sync_info.get('suspect_name')}` (ID: `{dossier_sync_info.get('dossier_id')}`)\n" if dossier_sync_info.get("synced") else ""

                                                cdr_msg = (
                                                    f"📱 **วิเคราะห์รายงานประวัติการโทร SPNI เรียบร้อยแล้วครับ!** 🦥✨\n\n"
                                                    f"👤 **เจ้าของเครื่อง/เป้าหมาย:** {dev.get('owner_name') or 'ไม่ระบุ'}\n"
                                                    f"📞 **เบอร์โทรเป้าหมาย:** `{dev.get('target_phone') or '-'}`\n"
                                                    f"📁 **เลขที่คดี:** `{dev.get('case_no') or '-'}` ({dev.get('case_type') or 'คดียาเสพติด'})\n"
                                                    f"📲 **อุปกรณ์:** {dev.get('brand')} {dev.get('model')} (IMEI: `{dev.get('imei') or '-'}`)\n"
                                                    f"{d_line}"
                                                    f"📈 **ยอดโทรทั้งหมด:** {cdr_res['total_records']:,} สาย\n"
                                                    f"👥 **เบอร์ที่ติดต่อ:** {cdr_res['unique_phone_numbers']} หมายเลข ({cdr_res.get('total_contacts', 0)} รายชื่อในสมุดโทรศัพท์)\n"
                                                    f"🎯 **คู่สายทั้งหมด:** {cdr_res['unique_pairs_count']} คู่สาย\n"
                                                    f"🕒 **ยอดรวมเวลาคุย:** {round(cdr_res['total_duration_sec']/60, 1)} นาที | ✉️ **SMS:** {cdr_res.get('total_sms', 0)} ข้อความ\n\n"
                                                    f"🔝 **คู่สายสำคัญ/โทรหากันบ่อยที่สุด:**\n"
                                                    f"{chr(10).join(pair_lines) if pair_lines else '  • ไม่มีคู่สาย'}\n\n"
                                                    f"🕸️ **ซิงค์โครงข่ายความเชื่อมโยงลงในผัง i2 และถังข้อมูลเรียบร้อยแล้วครับผม 💙**"
                                                )
                                            else:
                                                top_pairs = cdr_res.get("call_pairs", [])[:4]
                                                pair_lines = []
                                                for p in top_pairs:
                                                    dur_m = round(p.get('total_duration_sec', 0) / 60, 1)
                                                    pair_lines.append(f"  • `{p['party_a']}` <-> `{p['party_b']}` : โทร {p['total_calls']} ครั้ง ({dur_m} นาที)")

                                                cdr_msg = (
                                                    f"🎉 **บันทึกและวิเคราะห์ประวัติการโทร (CDR) เรียบร้อยแล้วครับ!** 🦥✨\n\n"
                                                    f"📄 **ไฟล์:** `{doc_name}`\n"
                                                    f"📈 **ยอดโทรทั้งหมด:** {cdr_res['total_records']:,} สาย\n"
                                                    f"👥 **เบอร์โทรที่เกี่ยวข้อง:** {cdr_res['unique_phone_numbers']} หมายเลข\n"
                                                    f"🎯 **คู่สายทั้งหมด:** {cdr_res['unique_pairs_count']} คู่สาย\n"
                                                    f"🕒 **ยอดรวมเวลาคุย:** {round(cdr_res['total_duration_sec']/60, 1)} นาที\n\n"
                                                    f"🔝 **คู่สายที่โทรหากันบ่อยที่สุด:**\n"
                                                    f"{chr(10).join(pair_lines) if pair_lines else '  • ไม่มีคู่สาย'}\n\n"
                                                    f"🕸️ **พล็อตเส้นความสัมพันธ์ลงในผังเครือข่าย i2 บน Dashboard เรียบร้อยแล้วครับผม 💙**"
                                                )
                                            await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": cdr_msg, "parse_mode": "Markdown"})
                                        except Exception as cdr_err:
                                            logger.error(f"Telegram CDR parse error: {cdr_err}")
                                            await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": f"⚠️ ไม่สามารถประมวลผลไฟล์ประวัติการโทรได้: {cdr_err}"})
                                continue

                            if (doc_name.lower().endswith((".docx", ".doc", ".pdf", ".jpg", ".jpeg", ".png", ".webp")) or
                                "word" in doc_mime.lower() or
                                "pdf" in doc_mime.lower() or
                                "document" in doc_mime.lower() or
                                "image" in doc_mime.lower()):
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": f"⏳ กำลังอ่านเอกสารรายงาน '{doc_name}' ด้วย AI OCR สักครู่นะครับผม... 🦥"})
                                file_id = document["file_id"]
                                file_resp = await client.get(f"{url}/getFile", params={"file_id": file_id})
                                if file_resp.status_code == 200:
                                    file_path = file_resp.json()["result"]["file_path"]
                                    doc_dl = await client.get(f"{file_url}{file_path}")
                                    if doc_dl.status_code == 200:
                                        doc_bytes = doc_dl.content

                                        # ---------------------------------------------------------
                                        # Check if document is Bank Statement (PDF)
                                        # ---------------------------------------------------------
                                        if doc_name.lower().endswith(".pdf"):
                                            # Look for password in caption (e.g. รหัส 12082000, pass: ..., or 6-8 digits)
                                            pw_match = re.search(r'(?:รหัส|pass(?:word)?|pin)\s*[:\s]?\s*([A-Za-z0-9]+)', caption or "", re.IGNORECASE)
                                            raw_pw = pw_match.group(1) if pw_match else None
                                            if not raw_pw:
                                                num_match = re.search(r'\b(\d{6,8})\b', caption or "")
                                                if num_match:
                                                    raw_pw = num_match.group(1)

                                            candidate_pws = [raw_pw] if raw_pw else []
                                            for d in dossier_mgr.get_all_dossiers():
                                                id_c = d.get("id_card")
                                                if id_c:
                                                    clean_id = re.sub(r'\D', '', str(id_c))
                                                    if clean_id: candidate_pws.append(clean_id[-8:])
                                                age = d.get("age")
                                                if age: candidate_pws.append(str(age))

                                            try:
                                                stmt_res = statement_parser.parse_statement_pdf(
                                                    file_bytes=doc_bytes,
                                                    filename=doc_name,
                                                    password=raw_pw,
                                                    candidate_passwords=candidate_pws
                                                )
                                                acc = stmt_res.get("account_info", {})
                                                summ = stmt_res.get("summary", {})
                                                cps = stmt_res.get("counterparty_flows", [])
                                                holder = acc.get("account_holder") or "ไม่ระบุชื่อ"
                                                acc_num = acc.get("account_number") or ""
                                                b_name = acc.get("bank_name") or "ธนาคาร"

                                                # Upsert holder to dossier vault
                                                dossier_mgr.upsert_dossier(
                                                    suspect_name=holder,
                                                    id_card=None,
                                                    phone_number=None,
                                                    role_tag="เจ้าของบัญชี (Statement)",
                                                    area_tag=None,
                                                    address=acc.get("address"),
                                                    age=None,
                                                    category="drug" if "ยา" in (caption or "") else "general",
                                                    behavior=f"รายการเดินบัญชี {b_name} {acc_num} ยอดเงินเข้า ฿{summ.get('total_inflow', 0):,.2f} ยอดเงินออก ฿{summ.get('total_outflow', 0):,.2f}",
                                                    notes=caption or f"Statement {doc_name}",
                                                    officer_username=username,
                                                    platform="telegram",
                                                    files=[{"filename": doc_name, "content": doc_bytes}]
                                                )

                                                top_cps_lines = []
                                                for idx, cp in enumerate(cps[:4], 1):
                                                    top_cps_lines.append(f"  {idx}. **{cp['name']}** ({cp['bank']}) — ยอดรวม `฿{cp['total_amount']:,.2f}` ({cp['total_count']} ครั้ง)")

                                                stmt_summary = (
                                                    f"🎉 **บันทึกและวิเคราะห์ Statement เรียบร้อยแล้วครับ!** 🦥🏦✨\n\n"
                                                    f"📄 **ไฟล์:** `{doc_name}`\n"
                                                    f"🏦 **บัญชี:** **{b_name}** `{acc_num}`\n"
                                                    f"👤 **ชื่อบัญชี:** **{holder}**\n"
                                                    f"📍 **สาขา/ที่อยู่:** {acc.get('branch') or ''} {acc.get('address') or ''}\n"
                                                    f"📅 **ช่วงเวลา:** {acc.get('period') or 'ไม่ระบุ'}\n\n"
                                                    f"📊 **สรุปความเคลื่อนไหวทางการเงิน:**\n"
                                                    f"  🟢 ยอดเงินเข้าทั้งหมด: `฿{summ.get('total_inflow', 0):,.2f}` ({summ.get('inflow_count', 0)} รายการ)\n"
                                                    f"  🔴 ยอดเงินออกทั้งหมด: `฿{summ.get('total_outflow', 0):,.2f}` ({summ.get('outflow_count', 0)} รายการ)\n"
                                                    f"  ⚖️ ยอดสุทธิ (Net): `฿{summ.get('net_change', 0):,.2f}`\n\n"
                                                    + (f"👥 **คู่โอนหลักที่มีมูลค่าสูงสุด:**\n" + "\n".join(top_cps_lines) + "\n\n" if top_cps_lines else "")
                                                    + f"🕸️ **เชื่อมโยงบัญชีและเส้นทางการเงินลงในผัง i2 เรียบร้อยแล้วครับผม 💙**"
                                                )
                                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": stmt_summary, "parse_mode": "Markdown"})
                                                continue
                                            except Exception as stmt_err:
                                                logger.info(f"PDF '{doc_name}' statement parse attempt: {stmt_err}. Proceeding with standard document OCR.")

                                        from services.ai_ocr import extract_document_data
                                        extracted_res = extract_document_data(doc_bytes, doc_name, caption=caption)
                                        suspects = extracted_res.get("suspects", [])
                                        behavior = extracted_res.get("behavior")
                                        first_suspect = suspects[0] if suspects else {}
                                        
                                        explicit_case = extract_explicit_case_id(caption)
                                        if explicit_case:
                                            case_id = explicit_case
                                        elif first_suspect.get("suspect_name"):
                                            case_id = generate_clean_dossier_id(first_suspect.get("suspect_name"))
                                        else:
                                            case_id = f"คดี_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

                                        files_to_save = [{
                                            "filename": doc_name,
                                            "category": "Documents",
                                            "content": doc_bytes
                                        }]

                                        nas_manager.save_case_report(
                                            case_id=case_id,
                                            officer_username=username,
                                            platform="telegram",
                                            notes=caption or f"Docx Submission via Telegram ({doc_name})",
                                            lat=None,
                                            lon=None,
                                            files=files_to_save,
                                            suspects=suspects,
                                            behavior=behavior,
                                            incident_location=extracted_res.get("incident_location"),
                                            district=extracted_res.get("district"),
                                            subdistrict=extracted_res.get("subdistrict"),
                                            case_drug_quantity=extracted_res.get("seized_items", {}).get("total_drug_quantity")
                                        )

                                        # Upsert to Person Dossier Vault & collect dossier_ids
                                        created_dossier_ids = []
                                        targets = suspects if suspects else ([first_suspect] if first_suspect else [])
                                        
                                        # Prepare OCR text file for AutoLink scanning
                                        doc_files_to_save = [{"filename": doc_name, "content": doc_bytes}]
                                        ocr_raw = extracted_res.get("ocr_raw_text")
                                        if ocr_raw and len(ocr_raw.strip()) >= 20:
                                            txt_fname = f"{os.path.splitext(doc_name)[0]}_ocr.txt"
                                            doc_files_to_save.append({
                                                "filename": txt_fname,
                                                "content": ocr_raw.encode("utf-8")
                                            })

                                        for s in targets:
                                            s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
                                            d_profile = dossier_mgr.upsert_dossier(
                                                suspect_name=s_name,
                                                id_card=s.get("id_card"),
                                                phone_number=s.get("phone_number"),
                                                role_tag=s.get("role_tag") or "ผู้ต้องหา",
                                                area_tag=s.get("area_tag"),
                                                address=s.get("address"),
                                                age=s.get("age"),
                                                category="drug" if "ยา" in (behavior or "") else "general",
                                                behavior=behavior,
                                                notes=caption or f"เอกสารรายงานจับกุม {doc_name}",
                                                officer_username=username,
                                                platform="telegram",
                                                files=doc_files_to_save,
                                                family_info=s.get("family_info")
                                            )
                                            if d_profile and d_profile.get("dossier_id"):
                                                created_dossier_ids.append(d_profile["dossier_id"])

                                        # Auto Cross-Link relations across batch and vault
                                        if created_dossier_ids:
                                            auto_detect_and_link_relations(
                                                dossier_ids=created_dossier_ids,
                                                case_id=case_id,
                                                text_context=f"{caption or ''} {behavior or ''}",
                                                suspects=suspects,
                                                source_files=[doc_name]
                                            )

                                        # Include extracted case details in sync
                                        sync_extracted = dict(first_suspect or {})
                                        if extracted_res.get("seized_items"):
                                            sync_extracted["seized_items"] = extracted_res["seized_items"]
                                        if extracted_res.get("vehicle_plates"):
                                            sync_extracted["vehicle_plates"] = extracted_res["vehicle_plates"]
                                        if extracted_res.get("case_number"):
                                            sync_extracted["case_number"] = extracted_res["case_number"]
                                        if extracted_res.get("incident_location"):
                                            sync_extracted["incident_location"] = extracted_res["incident_location"]
                                        if extracted_res.get("district"):
                                            sync_extracted["district"] = extracted_res["district"]
                                        if extracted_res.get("subdistrict"):
                                            sync_extracted["subdistrict"] = extracted_res["subdistrict"]

                                        has_crime_doc = any(kw in (behavior or caption or "") for kw in ["จับกุม", "ตรวจยึด", "ของกลาง", "ยาบ้า", "ไอซ์", "อาวุธ", "ยาเสพติด"])
                                        if has_crime_doc:
                                            await sync_to_chat_service(
                                                case_id=case_id,
                                                officer_username=username,
                                                notes=behavior or caption or f"เอกสาร {doc_name}",
                                                extracted=sync_extracted,
                                                suspects_list=suspects
                                            )

                                        # Format rich Telegram response matching Web Chat
                                        summary_parts = [
                                            f"🎉 **บันทึกคดีและเอกสาร {case_id} เรียบร้อยแล้วครับ!** 🦥✨",
                                            f"📄 ไฟล์เอกสาร: `{doc_name}`",
                                        ]

                                        if suspects:
                                            summary_parts.append(f"\n👥 **ผลการอ่านเอกสาร (AI OCR): พบผู้ต้องหา {len(suspects)} คน**")
                                            for i, s in enumerate(suspects, 1):
                                                s_details = []
                                                if s.get("suspect_name"): s_details.append(f"👤 ชื่อ-สกุล: **{s.get('suspect_name')}**")
                                                if s.get("id_card"): s_details.append(f"🪪 เลขบัตร: `{s.get('id_card')}`")
                                                if s.get("age"): s_details.append(f"🛡️ อายุ: {s.get('age')} ปี")
                                                if s.get("address"): s_details.append(f"🏠 ที่อยู่: {s.get('address')}")
                                                if s.get("phone_number"): s_details.append(f"📞 เบอร์โทร: `{s.get('phone_number')}`")
                                                if s.get("drug_quantity"): s_details.append(f"💊 ของกลาง: **{s.get('drug_quantity'):,} เม็ด**")
                                                
                                                if s_details:
                                                    summary_parts.append(f"\n**[ผู้ต้องหาคนที่ #{i}]**\n" + "\n".join(s_details))

                                        seized_info = extracted_res.get("seized_items", {})
                                        plates_list = extracted_res.get("vehicle_plates", [])
                                        social_list = extracted_res.get("social_media", [])

                                        if seized_info.get("summary"):
                                            summary_parts.append(f"\n📦 **ของกลางที่ตรวจยึด:**\n• " + "\n• ".join(seized_info["summary"]))
                                        if plates_list:
                                            summary_parts.append(f"\n🚗 **ยานพาหนะที่เกี่ยวข้อง:**\n• " + "\n• ".join(plates_list))
                                        if social_list:
                                            summary_parts.append(f"\n🌐 **บัญชีโซเชียลมีเดีย:**\n• " + "\n• ".join([f"{sm['platform']}: `{sm['account']}`" for sm in social_list]))

                                        if behavior:
                                            summary_parts.append(f"\n📝 **พฤติการณ์การจับกุม:**\n_{behavior[:500]}_")

                                        summary_parts.append("\n📁 ข้อมูลและไฟล์เอกสารจัดเก็บเข้าคลัง NAS และซิงค์ลงแผนที่ความเสี่ยงเรียบร้อยครับผม 💙")

                                        summary = "\n".join(summary_parts)
                                        await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": summary, "parse_mode": "Markdown"})
                                    else:
                                        await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": "❌ เกิดข้อผิดพลาดในการดาวน์โหลดเอกสารครับผม"})
                                else:
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": "❌ เกิดข้อผิดพลาดในการขอเส้นทางไฟล์เอกสารจาก Telegram ครับผม"})
                                continue
                        if photos:
                            media_group_id = message.get("media_group_id")
                            batch_key = f"mg_{media_group_id}" if media_group_id else f"chat_{chat_id}"

                            # Get the highest resolution photo (last in the array)
                            best_photo = photos[-1]
                            file_id = best_photo["file_id"]

                            # Get file path from Telegram
                            file_resp = await client.get(f"{url}/getFile", params={"file_id": file_id})
                            if file_resp.status_code == 200:
                                file_path = file_resp.json()["result"]["file_path"]
                                img_resp = await client.get(f"{file_url}{file_path}")
                                if img_resp.status_code == 200:
                                    img_bytes = img_resp.content
                                    meta = extract_photo_metadata(img_bytes)
                                    lat, lon = meta.get("lat"), meta.get("lon")

                                    async with MEDIA_GROUP_LOCK:
                                        if batch_key not in MEDIA_GROUP_BUFFERS:
                                            MEDIA_GROUP_BUFFERS[batch_key] = {
                                                "chat_id": chat_id,
                                                "username": username,
                                                "caption": caption or "",
                                                "items": [],
                                                "ack_sent": False
                                            }
                                        elif caption and not MEDIA_GROUP_BUFFERS[batch_key].get("caption"):
                                            MEDIA_GROUP_BUFFERS[batch_key]["caption"] = caption

                                        MEDIA_GROUP_BUFFERS[batch_key]["items"].append({
                                            "bytes": img_bytes,
                                            "file_path": file_path,
                                            "lat": lat,
                                            "lon": lon
                                        })

                                        item_cnt = len(MEDIA_GROUP_BUFFERS[batch_key]["items"])
                                        cap_text = MEDIA_GROUP_BUFFERS[batch_key].get("caption") or caption or ""
                                        name_hint = ""
                                        name_m = re.search(r'(?:ของ|ไฟล์ของ|รูปของ|คดี|นาย|นางสาว|น\.ส\.|นาง)\s*([ก-๙]{2,}(?:\s+[ก-๙]{2,})?)', cap_text)
                                        if name_m:
                                            name_hint = f"ของ '{name_m.group(0).strip()}' "

                                        ack_txt = (
                                            f"⏳ ได้รับแล้ว {item_cnt} รายการ... กำลังรวบรวมชุดข้อมูล {name_hint}🦥\n"
                                            f"👉 หากส่งครบแล้ว สามารถกดปุ่มด้านล่างเพื่อประมวลผลทันทีครับผม"
                                        )
                                        reply_markup = {
                                            "inline_keyboard": [
                                                [{"text": f"✅ เสร็จสิ้นการส่ง / ประมวลผล ({item_cnt} รายการ)", "callback_data": make_safe_cb_data("finish_batch", batch_key)}]
                                            ]
                                        }
                                        ack_msg_id = MEDIA_GROUP_BUFFERS[batch_key].get("ack_msg_id")
                                        if ack_msg_id:
                                            try:
                                                await client.post(f"{url}/editMessageText", json={
                                                    "chat_id": chat_id,
                                                    "message_id": ack_msg_id,
                                                    "text": ack_txt,
                                                    "reply_markup": reply_markup
                                                })
                                            except Exception:
                                                pass
                                        else:
                                            ack_res = await client.post(f"{url}/sendMessage", json={
                                                "chat_id": chat_id,
                                                "text": ack_txt,
                                                "reply_markup": reply_markup
                                            })
                                            if ack_res.status_code == 200:
                                                MEDIA_GROUP_BUFFERS[batch_key]["ack_msg_id"] = ack_res.json()["result"]["message_id"]

                                        # Reset debounce timer
                                        if batch_key in MEDIA_GROUP_TIMERS:
                                            MEDIA_GROUP_TIMERS[batch_key].cancel()

                                        # 5.0s debounce allows multiple photos/texts over mobile network to all be gathered together
                                        MEDIA_GROUP_TIMERS[batch_key] = asyncio.create_task(
                                            debounced_process_media_group(batch_key, delay=5.0)
                                        )
                                else:
                                    await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": "❌ เกิดข้อผิดพลาดในการดาวน์โหลดรูปภาพครับผม"})
                            else:
                                await client.post(f"{url}/sendMessage", json={"chat_id": chat_id, "text": "❌ เกิดข้อผิดพลาดในการขอเส้นทางไฟล์จาก Telegram ครับผม"})
                            continue

                        # 4. Handle Text Messages: Attach to active batch if pending, or parse intelligence / report
                        if text and not document and not photos:
                            active_batch_key = None
                            for bk in list(MEDIA_GROUP_BUFFERS.keys()):
                                if bk == f"chat_{chat_id}" or (MEDIA_GROUP_BUFFERS[bk].get("chat_id") == chat_id):
                                    active_batch_key = bk
                                    break

                            if active_batch_key and active_batch_key in MEDIA_GROUP_BUFFERS:
                                async with MEDIA_GROUP_LOCK:
                                    cur_cap = MEDIA_GROUP_BUFFERS[active_batch_key].get("caption", "")
                                    MEDIA_GROUP_BUFFERS[active_batch_key]["caption"] = f"{cur_cap}\n{text}".strip()
                                    MEDIA_GROUP_BUFFERS[active_batch_key].setdefault("text_notes", []).append(text)

                                    if active_batch_key in MEDIA_GROUP_TIMERS:
                                        MEDIA_GROUP_TIMERS[active_batch_key].cancel()
                                    MEDIA_GROUP_TIMERS[active_batch_key] = asyncio.create_task(
                                        debounced_process_media_group(active_batch_key, delay=4.0)
                                    )

                                    # Send a quick text reply without a button
                                    await client.post(f"{url}/sendMessage", json={
                                        "chat_id": chat_id,
                                        "text": f"📝 ได้รับข้อมูลเพิ่มเติม: `{text}`",
                                        "parse_mode": "Markdown",
                                        "reply_to_message_id": message.get("message_id")
                                    })
                                    
                                    # Edit the main ack message's button
                                    ack_msg_id = MEDIA_GROUP_BUFFERS[active_batch_key].get("ack_msg_id")
                                    cnt = len(MEDIA_GROUP_BUFFERS[active_batch_key]["items"])
                                    notes_cnt = len(MEDIA_GROUP_BUFFERS[active_batch_key].get("text_notes", []))
                                    btn_txt = f"✅ เสร็จสิ้นการส่ง / ประมวลผล ({cnt} ไฟล์ + {notes_cnt} ข้อความ)"
                                    ack_txt = f"⏳ ได้รับแล้ว {cnt} ไฟล์ และ {notes_cnt} ข้อความ... กำลังรวบรวมชุดข้อมูล🦥\n👉 หากส่งครบแล้ว สามารถกดปุ่มด้านล่างเพื่อประมวลผลทันทีครับผม"
                                    
                                    if ack_msg_id:
                                        await client.post(f"{url}/editMessageText", json={
                                            "chat_id": chat_id,
                                            "message_id": ack_msg_id,
                                            "text": ack_txt,
                                            "reply_markup": {
                                                "inline_keyboard": [[{"text": btn_txt, "callback_data": make_safe_cb_data("finish_batch", active_batch_key)}]]
                                            }
                                        })
                                    continue
                            # Guard: Check if message is a police incident / arrest / seizure report
                            report_indicators = ["จับกุม", "ตรวจยึด", "ผู้ต้องหา", "ของกลาง", "ของกลางยาบ้า", "ยาบ้า", "ข้อกล่าวหา", "นำของกลางนำส่ง", "ปจว.", "ประจำวัน", "สภ.", "ชปส.", "ร้อย ตชด.", "จึงเรียนมาเพื่อ"]
                            matched_rep = [k for k in report_indicators if k in text]
                            is_incident_report = len(matched_rep) >= 2 or any(k in text for k in ["จับกุม", "ตรวจยึด", "นำของกลางนำส่ง"])

                            if not is_incident_report:
                                try:
                                    handled_intel = await handle_intelligence_text(
                                        client=client,
                                        url=url,
                                        chat_id=chat_id,
                                        username=username,
                                        text=text
                                    )
                                    if handled_intel:
                                        continue
                                except Exception as intel_err:
                                    logger.error(f"Intelligence text handling error: {intel_err}")

                            report_result = await submit_plain_text_report(
                                message_text=text,
                                officer_username=username,
                                user_role=user_role,
                            )
                            # Reuse chat-service's parsed acknowledgement so both channels
                            # communicate the same extracted incident fields to the operator.
                            if report_result:
                                reply_text = report_result.get("reply") or "✅ บันทึกรายงานสำเร็จ!"
                                telegram_reply = format_web_chat_reply_for_telegram(reply_text)
                                await send_safe_telegram_reply(client, url, chat_id, telegram_reply)
                            else:
                                await client.post(
                                    f"{url}/sendMessage",
                                    json={
                                        "chat_id": chat_id,
                                        "text": "⚠️ ไม่สามารถเชื่อมต่อบริการบันทึกรายงานได้ในขณะนี้ครับ กรุณาลองใหม่อีกครั้ง",
                                    },
                                )
                            continue
                        
            except Exception as e:
                logger.error(f"Telegram polling error: {e}")
                
            await asyncio.sleep(1)

async def notify_i2_admins(record: Dict[str, Any]) -> None:
    """Send one PII-minimized i2 job transition to paired administrator chats."""

    if not TELEGRAM_TOKEN:
        return
    status = str(record.get("status") or "")
    labels = {
        "ready_preview": "พร้อมให้ Admin ตรวจ Preview",
        "bridge_failed": "Bridge ไม่สำเร็จ (ลองใหม่ได้)",
        "applied": "Admin นำเข้าผังแล้ว",
        "rolled_back": "Admin ย้อนกลับชุดนำเข้าแล้ว",
        "duplicate": "ไฟล์ซ้ำ — ไม่ประมวลผลซ้ำ",
    }
    if status not in labels:
        return
    recipients = set()
    for pairing_key, username in auth_linker.pairings.items():
        if not pairing_key.startswith("telegram:"):
            continue
        if get_user_role(username).lower() not in {"admin", "superadmin"}:
            continue
        recipients.add(pairing_key.split(":", 1)[1])
    if not recipients:
        return
    message = (
        "สถานะงานนำเข้า i2\n"
        f"สถานะ: {labels[status]}\n"
        f"Job ID: {str(record.get('import_id') or '')[:80]}\n"
        f"ไฟล์: {str(record.get('filename') or 'chart.anb')[:180]}\n"
        f"จำนวน: {int(record.get('node_count') or 0)} โหนด / {int(record.get('edge_count') or 0)} เส้น"
    )
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    async with httpx.AsyncClient(timeout=20.0) as client:
        for chat_id in sorted(recipients):
            try:
                response = await client.post(url, json={"chat_id": chat_id, "text": message})
                if response.status_code != 200:
                    logger.warning("i2 admin notification failed status=%s", response.status_code)
            except Exception as exc:
                logger.warning("i2 admin notification error_type=%s", type(exc).__name__)


async def i2_import_status_monitor() -> None:
    """Reconcile bridge jobs and notify only on new terminal/reviewable transitions."""

    try:
        seen = {item.get("import_id"): item.get("status") for item in i2_import_manager.list_imports()}
    except Exception:
        logger.exception("Could not initialize i2 import status monitor")
        seen = {}
    while True:
        await asyncio.sleep(10)
        try:
            for record in i2_import_manager.list_imports():
                import_id = record.get("import_id")
                status = record.get("status")
                previous = seen.get(import_id)
                seen[import_id] = status
                if previous is not None and previous != status:
                    await notify_i2_admins(record)
        except Exception as exc:
            logger.warning("i2 status monitor error_type=%s", type(exc).__name__)


def notify_merge_to_telegram(source_id: str, target_id: str, target_name: str, file_count: int = 0):
    """
    Sends an immediate Telegram alert to paired admins/officers when dossiers are auto-merged.
    """
    if not TELEGRAM_TOKEN:
        return

    recipients = set()
    for pairing_key, username in auth_linker.pairings.items():
        if pairing_key.startswith("telegram:"):
            recipients.add(pairing_key.split(":", 1)[1])

    if not recipients:
        return

    msg = (
        "🦥✨ *ระบบจัดการแฟ้มคดีอัตโนมัติ (Auto-Merge)*\n\n"
        f"🔗 *ยุบรวมแฟ้มและหลักฐานสำเร็จแล้วครับ!* 💙\n"
        f"👤 *บุคคลเป้าหมายหลัก:* `{target_name}`\n"
        f"📁 *แฟ้มเดิม:* `{source_id}` ➡️ *แฟ้มหลัก:* `{target_id}`\n"
    )
    if file_count > 0:
        msg += f"🖼️ *รวมไฟล์หลักฐาน/ภาพถ่าย:* {file_count} ไฟล์\n"
    msg += "\nผังความสัมพันธ์ (i2) และถังข้อมูลถูกผสานเป็นบุคคลเดียวกันเรียบร้อยครับผม 💙"

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"

    def _sync_send():
        import urllib.request
        for chat_id in sorted(recipients):
            try:
                payload = json.dumps({"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"}).encode("utf-8")
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                logger.warning(f"Telegram auto-merge notify error: {e}")

    try:
        import threading
        threading.Thread(target=_sync_send, daemon=True).start()
    except Exception as e:
        logger.warning(f"Failed to spawn Telegram notify thread: {e}")


def auto_consolidate_duplicate_dossiers():
    """
    Auto-consolidates legacy mis-extracted dossiers (Somporn)
    AND auto-merges any dossiers sharing the exact same Thai ID card or suspect name.
    """
    try:
        from scripts.consolidate_somporn_dossier import consolidate_somporn
        consolidate_somporn(dossier_mgr.root_path)
    except Exception as e:
        logger.warning(f"Somporn dossier consolidation check: {e}")

    try:
        from collections import defaultdict
        all_dossiers = dossier_mgr.get_all_dossiers()
        by_id_card = defaultdict(list)
        by_name = defaultdict(list)
        for d in all_dossiers:
            did = str(d.get("dossier_id") or "")
            if not did:
                continue
            card = str(d.get("id_card") or "").strip()
            name = str(d.get("suspect_name") or "").strip()
            clean_card = re.sub(r"\D", "", card)
            if clean_card and len(clean_card) == 13:
                by_id_card[clean_card].append(did)
            norm_name = re.sub(r"^(นาย|นางสาว|น\.ส\.|นาง)\s*", "", name).strip()
            if norm_name and norm_name not in {"ไม่ทราบชื่อ", "ไม่ระบุชื่อ"}:
                by_name[norm_name].append(did)

        def _dossier_priority_key(did: str):
            detail = dossier_mgr.get_dossier_detail(did) or {}
            # Priority 1: Warrant dossiers must NEVER be the source being wiped out
            has_warrant = 0 if (detail.get("category") == "warrant" or bool(detail.get("warrant_info"))) else 1
            # Priority 2: Prefer clean dossier IDs over auto-generated CID/บุคคล prefixes
            is_clean_id = 0 if not (did.startswith("บุคคล_") or re.match(r'^\d{13}', did)) else 1
            # Priority 3: Prefer dossiers with photos
            has_photo = 0 if bool(detail.get("photo_url") or detail.get("photo_path")) else 1
            # Priority 4: Prefer dossiers with more files
            file_count = -len(detail.get("personal_files") or [])
            return (has_warrant, is_clean_id, has_photo, file_count)

        # 1. Merge by 13-digit ID Card
        for cid, dids in by_id_card.items():
            active_dids = [did for did in dids if dossier_mgr.get_dossier_detail(did)]
            if len(active_dids) > 1:
                sorted_dids = sorted(active_dids, key=_dossier_priority_key)
                target = sorted_dids[0]
                t_detail = dossier_mgr.get_dossier_detail(target) or {}
                t_name = t_detail.get("suspect_name") or target
                for src in sorted_dids[1:]:
                    logger.info(f"Auto-merging duplicate dossier by ID card {cid}: {src} -> {target}")
                    res = dossier_mgr.merge_dossiers(src, target, force=True)
                    if res:
                        fc = len(res.get("personal_files") or [])
                        notify_merge_to_telegram(src, target, t_name, fc)

        # 2. Merge by exact normalized name
        for nname, dids in by_name.items():
            active_dids = [did for did in dids if dossier_mgr.get_dossier_detail(did)]
            if len(active_dids) > 1:
                sorted_dids = sorted(active_dids, key=_dossier_priority_key)
                target = sorted_dids[0]
                t_detail = dossier_mgr.get_dossier_detail(target) or {}
                t_name = t_detail.get("suspect_name") or target
                for src in sorted_dids[1:]:
                    logger.info(f"Auto-merging duplicate dossier by Name {nname}: {src} -> {target}")
                    res = dossier_mgr.merge_dossiers(src, target, force=True)
                    if res:
                        fc = len(res.get("personal_files") or [])
                        notify_merge_to_telegram(src, target, t_name, fc)
    except Exception as e:
        logger.warning(f"auto_consolidate_duplicate_dossiers error: {e}")


@app.on_event("startup")
async def startup_event():
    """Start independent bot polling, sanitized i2 status monitoring, autonomous NAS sync, and tiered storage archiver."""
    auto_consolidate_duplicate_dossiers()
    asyncio.create_task(telegram_polling_loop())
    asyncio.create_task(i2_import_status_monitor())
    try:
        nas_sync_service.start()
    except Exception as e:
        logger.error(f"Failed to start NASSyncService: {e}")
    try:
        tiered_archiver.start()
    except Exception as e:
        logger.error(f"Failed to start TieredStorageArchiver: {e}")


@app.on_event("shutdown")
def shutdown_event():
    """Gracefully terminate background workers."""
    try:
        nas_sync_service.stop()
    except Exception as e:
        logger.error(f"Error stopping NASSyncService: {e}")
    try:
        tiered_archiver.stop()
    except Exception as e:
        logger.error(f"Error stopping TieredStorageArchiver: {e}")


@app.get("/")
def root_redirect(request: Request):
    """
    Root endpoint for port 5005.
    Redirects browser visitors directly to the BPP-VMS Web Dashboard (https://localhost)
    and provides JSON service info for API clients.
    """
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        html_content = """<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="2; url=https://localhost">
    <title>Sloth BPP-VMS — NAS Bot Service</title>
    <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body {
            background-color: #070913;
            color: #f1f5f9;
            font-family: 'Kanit', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .card {
            background: linear-gradient(135deg, rgba(20, 27, 48, 0.9) 0%, rgba(14, 19, 36, 0.95) 100%);
            border: 1px solid rgba(168, 85, 247, 0.35);
            border-radius: 16px;
            padding: 32px;
            max-width: 520px;
            width: 100%;
            text-align: center;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(168, 85, 247, 0.2);
        }
        .icon {
            font-size: 48px;
            margin-bottom: 12px;
            display: inline-block;
        }
        h2 {
            margin: 0 0 8px 0;
            color: #fff;
            font-size: 22px;
        }
        p {
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.6;
            margin: 0 0 20px 0;
        }
        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(52, 211, 153, 0.15);
            border: 1px solid rgba(52, 211, 153, 0.4);
            color: #34d399;
            padding: 4px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 20px;
        }
        .btn {
            background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
            color: #fff;
            text-decoration: none;
            padding: 12px 28px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 15px;
            display: inline-block;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(168, 85, 247, 0.4);
        }
        .btn:hover {
            filter: brightness(1.15);
            transform: translateY(-2px);
        }
        .footer-hint {
            margin-top: 20px;
            font-size: 12px;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">🤖</div>
        <div class="status-pill">
            <span style="width:8px; height:8px; border-radius:50%; background:#34d399; display:inline-block;"></span>
            NAS Bot & Tailscale Mesh Active
        </div>
        <h2>ระบบ BPP-VMS กำลังทำงาน</h2>
        <p>
            พอร์ต 5005 คือบริการหลังบ้าน (NAS Bot & Tailscale Bridge)<br>
            ระบบกำลังนำท่านเข้าสู่หน้าจอควบคุมหลัก (Web Dashboard)...
        </p>
        <a href="https://localhost" class="btn">เข้าสู่ Dashboard ทันที ➔</a>
        <div class="footer-hint">กำลังเปลี่ยนเส้นทางอัตโนมัติภายใน 2 วินาที (https://localhost)</div>
    </div>
</body>
</html>"""
        return HTMLResponse(content=html_content)

    return JSONResponse(content={
        "status": "healthy",
        "service": "nas-bot-service",
        "tailscale_ip": "100.117.170.13",
        "web_dashboard": "https://localhost",
        "message": "Nas Bot Service is active. Access BPP-VMS Web Dashboard via https://localhost or https://100.117.170.13"
    })


@app.get("/health")
def health_check() -> Dict[str, str]:
    """Health check endpoint for Docker / K8s probes."""
    return {"status": "healthy", "service": "nas-bot-service"}


# ---------------------------------------------------------------------------
# NAS Storage & Auto-Sync / Video Archive Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/nas-bot/sync/status")
def api_get_nas_sync_status() -> Dict[str, Any]:
    """Get live auto-sync and video archive status."""
    return nas_sync_service.get_status()


@app.post("/api/nas-bot/sync/test-connection")
def api_test_nas_connection() -> Dict[str, Any]:
    """Force test connection to Synology NAS."""
    return nas_sync_service.test_connection()


@app.get("/api/nas-bot/video-archive/dates")
def api_get_video_archive_dates(camera: Optional[str] = None) -> List[Dict[str, Any]]:
    """List available recording dates and hours across SSD and NAS."""
    return nas_sync_service.list_available_dates(camera=camera)


class VideoRestoreRequest(BaseModel):
    camera: str
    date: str
    start_hour: int
    end_hour: int
    mode: str = "evidence"  # 'evidence' or 'timeline'


@app.post("/api/nas-bot/video-archive/restore")
def api_start_video_restore(req: VideoRestoreRequest) -> Dict[str, Any]:
    """Trigger on-demand background video restoration from NAS."""
    if req.start_hour < 0 or req.start_hour > 23 or req.end_hour < 0 or req.end_hour > 23:
        raise HTTPException(status_code=400, detail="ชั่วโมงต้องอยู่ระหว่าง 0 ถึง 23")
    if req.start_hour > req.end_hour:
        raise HTTPException(status_code=400, detail="ชั่วโมงเริ่มต้นต้องน้อยกว่าหรือเท่ากับชั่วโมงสิ้นสุด")
    if req.mode not in ("evidence", "timeline"):
        raise HTTPException(status_code=400, detail="mode ต้องเป็น 'evidence' หรือ 'timeline'")

    task_id = nas_sync_service.start_restore(
        camera=req.camera,
        date=req.date,
        start_hour=req.start_hour,
        end_hour=req.end_hour,
        mode=req.mode
    )
    return {"status": "accepted", "task_id": task_id}


@app.get("/api/nas-bot/video-archive/status/{task_id}")
def api_get_video_restore_status(task_id: str) -> Dict[str, Any]:
    """Poll status of an active video restore task."""
    task = nas_sync_service.get_restore_status(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="ไม่พบรหัสงานกู้คืนวิดีโอที่ระบุ")
    return task


@app.api_route("/api/nas-bot/video-archive/download/{filename}", methods=["GET", "HEAD"])
def api_download_video_archive(filename: str):
    """Download or stream exported evidence MP4 file."""
    clean_name = os.path.basename(filename)
    if not clean_name.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="อนุญาตเฉพาะไฟล์ .mp4 เท่านั้น")

    file_path = os.path.join(nas_sync_service.local_exports_path, clean_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์วิดีโอหลักฐานที่ส่งออก")

    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=clean_name
    )


@app.get("/api/nas-bot/video-archive/cameras")
def api_get_archive_cameras():
    """Return all system cameras organized by organizational group with Thai names."""
    groups_data = {}
    for p in ["/config/nvr_groups.json", "/settings-data/nvr_groups.json", "config/nvr_groups.json"]:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    groups_data = json.load(f)
                break
            except Exception:
                pass

    names_data = {}
    for p in ["/settings-data/camera_names.json", "config/dashboard-settings/camera_names.json"]:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    names_data = json.load(f)
                break
            except Exception:
                pass

    group_map: Dict[str, List[Dict[str, str]]] = {}
    all_camera_ids = set(groups_data.keys()) | set(names_data.keys())

    for cam_id in sorted(all_camera_ids):
        grp = groups_data.get(cam_id, "อื่นๆ")
        thai_name = names_data.get(cam_id, cam_id)
        if grp not in group_map:
            group_map[grp] = []
        group_map[grp].append({
            "id": cam_id,
            "thai_name": thai_name,
            "display": f"{thai_name} ({cam_id})" if thai_name != cam_id else cam_id
        })

    priority_order = [
        "ทางเข้ากองร้อย", "BPP215", "กก.ตชด.23", "ทต.โกรกแก้ว", "เมืองขอนแก่น",
        "อุดรธานี", "อุบลราชธานี", "ร้อยเอ็ด", "กรมทางหลวง (DOH)"
    ]

    def sort_key(g):
        for idx, prefix in enumerate(priority_order):
            if prefix in g:
                return (0, idx, g)
        return (1, 0, g)

    sorted_groups = []
    for g in sorted(group_map.keys(), key=sort_key):
        sorted_groups.append({
            "group_name": g,
            "cameras": sorted(group_map[g], key=lambda x: x["id"])
        })

    return {
        "groups": sorted_groups,
        "total_cameras": len(all_camera_ids)
    }


@app.get("/api/nas-bot/tiered-archive/status")
def api_get_tiered_archive_status():
    """Get operational status of Tiered Storage Archiver (Drive D -> Drive E)."""
    return tiered_archiver.get_status()


@app.post("/api/nas-bot/tiered-archive/trigger")
def api_trigger_tiered_archive():
    """Manually trigger Tiered Storage archival scan."""
    return tiered_archiver.trigger_archive_now()


@app.api_route("/api/nas-bot/archive/events/{event_id}/{media_file}", methods=["GET", "HEAD"])
def api_get_archived_event_media(event_id: str, media_file: str, request: Request):
    """
    Fallback retrieval for event snapshots, thumbnails, and video clips.
    When Frigate returns 404 on SSD D: (retention expired), Nginx falls back here.
    Searches Tier 2 (Drive E: Archive), local SSD, and Tier 3 (Synology NAS).
    """
    clean_id = re.sub(r'[^a-zA-Z0-9_.-]', '', event_id)
    clean_media = os.path.basename(media_file)

    is_video = clean_media.endswith(".mp4")
    is_snapshot = clean_media.endswith(".jpg") or clean_media.endswith(".png") or clean_media.endswith(".webp")

    search_dirs = [
        os.path.join(nas_sync_service.archive_base, "clips"),
        nas_sync_service.archive_recordings_path,
        os.getenv("LOCAL_CLIPS_PATH", "/media/clips"),
        "/media/clips",
        "/storage/clips"
    ]

    found_path = None
    for base_dir in search_dirs:
        if not os.path.exists(base_dir):
            continue

        for root, _, files in os.walk(base_dir):
            for f in files:
                if clean_id in f:
                    if is_video and f.endswith(".mp4"):
                        found_path = os.path.join(root, f)
                        break
                    elif is_snapshot and (f.endswith(".jpg") or f.endswith(".webp") or f.endswith(".png")):
                        found_path = os.path.join(root, f)
                        break
            if found_path:
                break
        if found_path:
            break

    # If not found on local disks, check Synology NAS SMB
    if not found_path and nas_sync_service._is_connected:
        try:
            import smbclient
            remote_clips_unc = nas_sync_service._smb_path("clips")
            if smbclient.path.exists(remote_clips_unc):
                for f in smbclient.listdir(remote_clips_unc):
                    if clean_id in f:
                        if (is_video and f.endswith(".mp4")) or (is_snapshot and (f.endswith(".jpg") or f.endswith(".webp"))):
                            temp_target = os.path.join(nas_sync_service.temp_path, "event_cache", f)
                            os.makedirs(os.path.dirname(temp_target), exist_ok=True)
                            if not os.path.exists(temp_target):
                                nas_sync_service._download_file(f"{remote_clips_unc}\\{f}", temp_target)
                            if os.path.exists(temp_target):
                                found_path = temp_target
                                break
        except Exception as e:
            logger.debug(f"NAS event search error: {e}")

    if not found_path or not os.path.exists(found_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์สื่อเหตุการณ์ในคลังจัดเก็บข้อมูล")

    if is_video:
        return FileResponse(path=found_path, media_type="video/mp4", filename=os.path.basename(found_path))
    elif found_path.endswith(".webp"):
        return FileResponse(path=found_path, media_type="image/webp")
    else:
        return FileResponse(path=found_path, media_type="image/jpeg")


@app.api_route("/api/nas-bot/crops/{filename}", methods=["GET", "HEAD"])
def api_get_crop_image(filename: str):
    """
    Multi-tier resolver for LPR detection crops.
    Searches:
    1. Tier 1 (SSD): /media/lpr-crops/{filename}
    2. Tier 2 (Drive E: Archive): /media/archive-e/lpr-crops/{filename}
    3. Tier 3 (Synology NAS SMB): crops/{filename}
    """
    clean_name = os.path.basename(filename)
    # Tier 1 (SSD)
    p1 = os.path.join(nas_sync_service.local_lpr_crops_path, clean_name)
    if os.path.exists(p1):
        media_t = "image/webp" if clean_name.endswith(".webp") else "image/jpeg"
        return FileResponse(p1, media_type=media_t)

    # Tier 2 (Drive E: Archive)
    p2 = os.path.join(nas_sync_service.archive_crops_path, clean_name)
    if os.path.exists(p2):
        media_t = "image/webp" if clean_name.endswith(".webp") else "image/jpeg"
        return FileResponse(p2, media_type=media_t)

    # Tier 3 (Synology NAS SMB)
    if nas_sync_service._is_connected:
        try:
            import smbclient
            remote_unc = f"{nas_sync_service._smb_path('crops')}\\{clean_name}"
            if smbclient.path.exists(remote_unc):
                temp_target = os.path.join(nas_sync_service.temp_path, "crop_cache", clean_name)
                os.makedirs(os.path.dirname(temp_target), exist_ok=True)
                if not os.path.exists(temp_target):
                    nas_sync_service._download_file(remote_unc, temp_target)
                if os.path.exists(temp_target):
                    media_t = "image/webp" if clean_name.endswith(".webp") else "image/jpeg"
                    return FileResponse(temp_target, media_type=media_t)
        except Exception as e:
            logger.debug(f"NAS crop search error: {e}")

    raise HTTPException(status_code=404, detail="ไม่พบไฟล์ภาพครอปในคลังจัดเก็บข้อมูล")


@app.post("/api/nas-bot/pair/request")
def request_pairing_code(payload: PairRequest) -> Dict[str, Any]:
    """
    Request a 6-digit pairing code for a system username.
    Used by Dashboard UI when user wants to pair their Telegram account.
    """
    if not payload.username:
        raise HTTPException(status_code=400, detail="Username is required")

    existing_pairings = auth_linker.get_user_pairings(payload.username)
    is_already_paired = len(existing_pairings) > 0

    code = auth_linker.generate_pairing_code(payload.username)
    return {
        "status": "success",
        "username": payload.username,
        "is_already_paired": is_already_paired,
        "existing_pairings": existing_pairings,
        "pairing_code": code,
        "instructions": f"Send the code '{code}' to the Telegram Bot @Sloth_bpp215bot to link your account."
    }


@app.post("/api/nas-bot/pair/verify")
def verify_pairing(payload: PairVerify) -> Dict[str, Any]:
    """
    Verify 6-digit pairing code sent by user in bot chat.
    """
    username = auth_linker.pair_bot_user(payload.platform, payload.bot_user_id, payload.code)
    if not username:
        raise HTTPException(status_code=400, detail="Invalid or expired pairing code")

    return {
        "status": "success",
        "message": f"Successfully linked {payload.platform} account ({payload.bot_user_id}) with user '{username}'",
        "paired_username": username
    }


class SubscriptionPayload(BaseModel):
    master_enabled: Optional[bool] = None
    broadcast_to_all: Optional[bool] = None
    cameras: Optional[Dict[str, Any]] = None


@app.get("/api/nas-bot/subscriptions/me")
def get_my_subscription(
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    username = x_user or "admin"
    sub = sub_manager.get_subscription(username)
    pairings = auth_linker.get_user_pairings(username)
    
    # Fallback to system pairings if exact username match has no entries
    if not pairings and len(auth_linker.pairings) > 0:
        for k, u in auth_linker.pairings.items():
            if k.startswith("telegram:"):
                pairings.append({"platform": "telegram", "bot_user_id": k.split(":", 1)[1]})

    return {
        "status": "success",
        "username": username,
        "role": x_role,
        "bot_username": "@Sloth_bpp215bot",
        "is_paired": len(pairings) > 0,
        "pairings": pairings,
        "subscription": sub
    }


@app.put("/api/nas-bot/subscriptions/me")
def update_my_subscription(
    payload: SubscriptionPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    username = x_user or "admin"
    is_admin = (x_role == "admin")
    updated = sub_manager.update_subscription(username, payload.dict(exclude_none=True), is_admin=is_admin)
    return {
        "status": "success",
        "username": username,
        "subscription": updated
    }


class UserProfilePayload(BaseModel):
    layout: Optional[str] = None
    visible_channels: Optional[List[str]] = None
    hidden_channels: Optional[List[str]] = None
    disabled_ai_cameras: Optional[List[str]] = None
    disabled_lpr_cameras: Optional[List[str]] = None
    events_open: Optional[bool] = None
    channels: Optional[List[Dict[str, Any]]] = None
    grid_revision: Optional[int] = None


@app.get("/api/nas-bot/user/profile")
def get_user_profile(
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    Get personal dashboard profile (layout, visible cameras) for the authenticated caller.
    """
    username = x_user or "admin"
    profile = profile_manager.get_profile(username)
    return {
        "status": "success",
        "username": username,
        "role": x_role,
        "profile": profile
    }


@app.put("/api/nas-bot/user/profile")
def update_user_profile(
    payload: UserProfilePayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    Update personal dashboard preferences (layout, visible cameras) for the authenticated caller.
    """
    username = x_user or "admin"
    data = payload.dict(exclude_none=True)
    client_rev = data.pop("grid_revision", None)
    updated = profile_manager.update_profile(username, data, client_revision=client_rev)
    return {
        "status": "success",
        "username": username,
        "profile": updated,
        "stale": bool(updated.get("stale", False))
    }

@app.get("/api/nas-bot/admin/user-profiles")
def get_all_user_profiles(
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    Get all user profiles for Superadmin inspection (ADR-0022).
    """
    if x_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {
        "status": "success",
        "profiles": profile_manager.get_all_profiles()
    }

@app.put("/api/nas-bot/admin/user-profile/{target_user}")
def update_other_user_profile(
    target_user: str,
    payload: UserProfilePayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    Update another user's personal dashboard preferences (ADR-0022).
    """
    if x_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    data = payload.dict(exclude_none=True)
    data.pop("grid_revision", None)
    updated = profile_manager.update_profile(target_user, data, by_admin=True)
    return {
        "status": "success",
        "username": target_user,
        "profile": updated
    }

@app.delete("/api/nas-bot/admin/user-profile/{target_user}")
def delete_other_user_profile(
    target_user: str,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """Delete a user profile from nas-bot cache when auth deletes the user."""
    if x_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    ok = profile_manager.delete_profile(target_user)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบโปรไฟล์")
    return {
        "status": "success",
        "username": target_user,
        "message": "ลบโปรไฟล์สำเร็จ"
    }


# ---- ADR-0024: AI demand, Global Layout Broadcast, Account/Global Kill-Switch ----
class GridBroadcastPayload(BaseModel):
    channels: List[Dict[str, Any]]


class GridBatchPayload(BaseModel):
    action: str  # stream_off | ai_off | stream_on
    scope: str   # account | all
    target_user: Optional[str] = None


def _require_superadmin(x_role: str) -> None:
    if x_role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin or Superadmin only")


def _compute_effective_ai_demand() -> Dict[str, List[str]]:
    """
    Combines per-account grid AI demand with active paired Telegram alert subscriptions
    (unless the user explicitly disabled AI for that camera in their profile).
    """
    demand = {cam: list(users) for cam, users in profile_manager.get_ai_demand().items()}
    try:
        sub_manager._load()
        auth_linker._load_state()
        paired_users = set(auth_linker.pairings.values())
        all_profiles = profile_manager.get_all_profiles()
        for uname, sub in sub_manager.subscriptions.items():
            if not isinstance(sub, dict) or not sub.get("master_enabled", False):
                continue
            if uname not in paired_users and not sub.get("broadcast_to_all", False):
                continue
            if uname not in all_profiles:
                # ADR-0024: Skip orphaned subscriptions for accounts that have no profile in the system
                continue
            prof = all_profiles.get(uname, {})
            disabled_ai = set(str(x) for x in (prof.get("disabled_ai_cameras") or []))
            prof_channels = prof.get("channels") if isinstance(prof.get("channels"), list) else []
            explicit_off_in_grid = {
                str(c.get("src"))
                for c in prof_channels
                if isinstance(c, dict) and c.get("src") and (c.get("enabled") is False or c.get("detect") is False)
            }
            cams_dict = sub.get("cameras") if isinstance(sub.get("cameras"), dict) else {}
            for cam_id, obj_map in cams_dict.items():
                if not cam_id or not isinstance(obj_map, dict):
                    continue
                if any(v is True for v in obj_map.values()):
                    if cam_id not in disabled_ai and cam_id not in explicit_off_in_grid:
                        users = demand.setdefault(str(cam_id), [])
                        if uname not in users:
                            users.append(uname)
    except Exception as e:
        logger.warning(f"Error merging subscription AI demand: {e}")
    return demand


@app.get("/api/nas-bot/admin/ai-demand")
def get_ai_demand(x_role: str = Header(default="officer")) -> Dict[str, Any]:
    """Cameras whose AI is demanded by at least one account, with the demanding accounts."""
    if x_role not in ["admin", "superadmin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"status": "success", "demand": _compute_effective_ai_demand()}


@app.get("/api/nas-bot/user/ai-demand")
def get_ai_demand_counts() -> Dict[str, Any]:
    """Per-camera count of accounts demanding AI (ADR-0024). Includes demanding account names."""
    demand = _compute_effective_ai_demand()
    return {
        "status": "success",
        "counts": {cam: len(users) for cam, users in demand.items()},
        "users": demand,
    }


@app.post("/api/nas-bot/admin/grid/broadcast")
def broadcast_grid(
    payload: GridBroadcastPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """Global Layout Broadcast: overwrite every other account's grid with the given channels."""
    _require_superadmin(x_role)
    result = profile_manager.apply_grid_action(
        "broadcast", "all", issuer=x_user or "admin", source_channels=payload.channels
    )
    return {"status": "success", **result}


@app.post("/api/nas-bot/admin/grid/batch")
def batch_grid_action(
    payload: GridBatchPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """Account / Global Kill-Switch: stream_off, ai_off or stream_on for one account or all (except issuer)."""
    _require_superadmin(x_role)
    if payload.action not in ("stream_off", "ai_off", "stream_on"):
        raise HTTPException(status_code=400, detail="invalid action")
    if payload.scope == "account" and not payload.target_user:
        raise HTTPException(status_code=400, detail="target_user required")
    try:
        result = profile_manager.apply_grid_action(
            payload.action, payload.scope, issuer=x_user or "admin", target_user=payload.target_user
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "success", **result}



class UserHeartbeatPayload(BaseModel):
    channels: Optional[List[Dict[str, Any]]] = None
    grid_revision: Optional[int] = None


@app.post("/api/nas-bot/user/heartbeat")
def post_user_heartbeat(
    payload: UserHeartbeatPayload = Body(default_factory=UserHeartbeatPayload),
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """Record user presence and active camera layout for demand-driven camera provisioning."""
    username = x_user or "admin"
    hb = profile_manager.update_heartbeat(username, payload.channels, payload.grid_revision)
    return {
        "status": "ok",
        "username": username,
        "grid_revision": hb["grid_revision"],
        "stale": hb["stale"],
    }


@app.post("/api/nas-bot/user/logout")
def post_user_logout(
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """Mark user as offline immediately to trigger camera deprovisioning if unreferenced."""
    username = x_user or "admin"
    profile_manager.logout(username)
    return {"status": "ok", "username": username}


@app.get("/api/nas-bot/user/demand-pool")
def get_user_demand_pool(timeout_sec: int = 300) -> Dict[str, Any]:
    """
    Demand-Driven Camera Provisioning (ADR-0020):
    Returns the Aggregated Camera Pool as the union set of active cameras demanded by all online users
    plus cameras with active AI / Telegram alert demand.
    """
    pool = profile_manager.get_demand_camera_pool(timeout_sec=timeout_sec)
    eff_ai = _compute_effective_ai_demand()
    merged_cams = sorted(list(set(pool.get("cameras", [])) | set(eff_ai.keys())))
    return {
        "status": "success",
        "cameras": merged_cams,
        "ai_demand_cameras": sorted(list(eff_ai.keys())),
        "online_users": pool.get("online_users", 0),
        "users": pool.get("users", [])
    }


class AdminUserTogglePayload(BaseModel):
    master_enabled: bool

class AdminUserCamerasPayload(BaseModel):
    master_enabled: Optional[bool] = None
    cameras: Optional[Dict[str, Dict[str, bool]]] = None


class DirectPairPayload(BaseModel):
    username: str
    chat_id: str
    platform: Optional[str] = "telegram"

class UnpairPayload(BaseModel):
    username: Optional[str] = None
    chat_id: Optional[str] = None
    platform: Optional[str] = "telegram"

@app.post("/api/nas-bot/admin/pair/direct")
def admin_direct_pair(
    payload: DirectPairPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูงเท่านั้น")

    auth_linker.direct_pair(payload.platform or "telegram", payload.chat_id, payload.username)
    return {
        "status": "success",
        "message": f"Successfully paired {payload.platform}:{payload.chat_id} with user '{payload.username}'",
        "username": payload.username,
        "chat_id": payload.chat_id
    }

@app.post("/api/nas-bot/admin/pair/unpair")
def admin_unpair(
    payload: UnpairPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูงเท่านั้น")

    removed = auth_linker.unpair_user(payload.platform or "telegram", payload.chat_id, payload.username)
    return {
        "status": "success",
        "message": f"Removed {removed} pairing(s)",
        "removed_count": removed
    }


@app.get("/api/nas-bot/admin/subscriptions")
async def get_admin_user_subscriptions(
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    (Super Admin only) Get alert subscriptions and Telegram pair status for all users.
    """
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูง (Super Admin) เท่านั้น")

    users_list = []
    auth_urls = [
        os.environ.get("AUTH_SERVICE_URL", "http://auth-service:5002"),
        "http://auth-service:5002",
        "http://127.0.0.1:8443", "http://localhost:5002"
    ]
    for b_url in auth_urls:
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                res = await client.get(f"{b_url}/auth/internal/users")
                if res.status_code == 200:
                    raw_data = res.json()
                    users_list = raw_data if isinstance(raw_data, list) else raw_data.get("users", [])
                    if users_list:
                        break
        except Exception as e:
            logger.warning(f"Failed to fetch internal users from {b_url}: {e}")
            continue

    auth_linker._load_state()
    all_subs = sub_manager.get_all_user_subscriptions(
        pairings=auth_linker.pairings,
        users=users_list
    )
    return {
        "status": "success",
        "users": all_subs
    }


@app.put("/api/nas-bot/admin/subscriptions/{target_user}")
def toggle_user_subscription(
    target_user: str,
    payload: AdminUserTogglePayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    (Super Admin only) Toggle master alert subscription on/off for a specific user.
    """
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูง (Super Admin) เท่านั้น")

    updated = sub_manager.update_user_master_alert(target_user, payload.master_enabled)
    return {
        "status": "success",
        "username": target_user,
        "subscription": updated
    }


@app.get("/api/nas-bot/admin/subscriptions/{target_user}/cameras")
def get_user_cameras_subscription(
    target_user: str,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    (Super Admin only) Get specific camera/object alert settings for a target user.
    """
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูง (Super Admin) เท่านั้น")

    sub = sub_manager.get_subscription(target_user)
    pairings = auth_linker.get_user_pairings(target_user)
    return {
        "status": "success",
        "username": target_user,
        "is_paired": len(pairings) > 0,
        "pairings": pairings,
        "subscription": sub
    }


@app.put("/api/nas-bot/admin/subscriptions/{target_user}/cameras")
def update_user_cameras_subscription(
    target_user: str,
    payload: AdminUserCamerasPayload,
    x_user: str = Header(default="admin"),
    x_role: str = Header(default="officer")
) -> Dict[str, Any]:
    """
    (Super Admin only) Update specific camera/object alert settings for a target user.
    """
    if x_role not in ["superadmin", "admin"] and x_user not in ["arm215", "suchakree", "bpp215"]:
        raise HTTPException(status_code=403, detail="เฉพาะผู้ดูแลระบบระดับสูง (Super Admin) เท่านั้น")

    update_data = {}
    if payload.master_enabled is not None:
        update_data["master_enabled"] = payload.master_enabled
    if payload.cameras is not None:
        update_data["cameras"] = payload.cameras

    updated = sub_manager.update_subscription(target_user, update_data, is_admin=True)
    return {
        "status": "success",
        "username": target_user,
        "subscription": updated
    }


@app.post("/api/nas-bot/dispatch-alert")
async def dispatch_multi_user_alert(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Called by lpr-service / Frigate event listeners to dispatch alerts to matching paired Telegram user accounts.
    """
    camera = payload.get("camera", "")
    label = payload.get("label", "")
    message = payload.get("message", "")

    target_chats = sub_manager.resolve_target_chats(
        pairings=auth_linker.pairings,
        camera=camera,
        label=label,
        user_roles_fn=get_user_role
    )

    default_alert_chat = (os.getenv("LPR_TELEGRAM_CHAT_ID") or "").strip()
    if default_alert_chat and default_alert_chat not in [str(c) for c in target_chats]:
        target_chats.append(default_alert_chat)
    if not target_chats:
        return {"status": "skipped", "reason": "No user accounts subscribed for this camera and object"}

    event_id = payload.get("event_id", "")
    image_b64 = payload.get("image_b64", "")
    snapshot_bytes = None
    if image_b64:
        try:
            snapshot_bytes = base64.b64decode(image_b64)
        except Exception:
            pass
    if not snapshot_bytes and event_id:
        try:
            async with httpx.AsyncClient(timeout=5.0) as img_client:
                for snap_u in [
                    f"http://127.0.0.1:8443/api/events/{event_id}/snapshot.jpg",
                    f"http://frigate:5000/api/events/{event_id}/snapshot.jpg",
                ] + ([f"http://127.0.0.1:1984/api/frame.jpeg?src={camera}", f"http://frigate:5000/api/{camera}/latest.jpg"] if camera else []):
                    try:
                        res = await img_client.get(snap_u)
                        if res.status_code == 200 and len(res.content) > 1000:
                            snapshot_bytes = res.content
                            break
                    except Exception:
                        continue
        except Exception as img_err:
            logger.debug(f"Failed to fetch event snapshot: {img_err}")

    logger.info(f"Dispatching alert for {camera}/{label}: snapshot_bytes={len(snapshot_bytes) if snapshot_bytes else 0} bytes to {len(target_chats)} chats: {target_chats}")

    sent_count = 0
    active_tok = (os.getenv("TELEGRAM_BOT_TOKEN") or TELEGRAM_TOKEN or "").strip()
    url = f"https://api.telegram.org/bot{active_tok}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        for chat_id in target_chats:
            try:
                if snapshot_bytes:
                    res = await client.post(
                        f"{url}/sendPhoto",
                        data={"chat_id": str(chat_id), "caption": message[:1024], "parse_mode": "HTML"},
                        files={"photo": ("snapshot.jpg", snapshot_bytes, "image/jpeg")}
                    )
                    if res.status_code == 200:
                        logger.info(f"Telegram sendPhoto SUCCESS to chat {chat_id}")
                    else:
                        logger.warning(f"Telegram sendPhoto HTML failed ({res.status_code}) for chat {chat_id}: {res.text}. Retrying plain text...")
                        plain_caption = re.sub(r'<[^>]+>', '', message)
                        res2 = await client.post(
                            f"{url}/sendPhoto",
                            data={"chat_id": str(chat_id), "caption": plain_caption[:1024]},
                            files={"photo": ("snapshot.jpg", snapshot_bytes, "image/jpeg")}
                        )
                        if res2.status_code == 200:
                            logger.info(f"Telegram sendPhoto plain text retry SUCCESS to chat {chat_id}")
                        else:
                            logger.error(f"Telegram sendPhoto plain text failed ({res2.status_code}) for chat {chat_id}: {res2.text}")
                else:
                    logger.warning(f"No photo bytes available for {camera}/{label} alert! Sending text-only fallback to chat {chat_id}")
                    res = await client.post(
                        f"{url}/sendMessage",
                        json={"chat_id": str(chat_id), "text": message[:4000], "parse_mode": "HTML", "disable_web_page_preview": False}
                    )
                    if res.status_code != 200:
                        plain_m = re.sub(r'<[^>]+>', '', message)
                        await client.post(f"{url}/sendMessage", json={"chat_id": str(chat_id), "text": plain_m[:3800]})
                sent_count += 1
            except Exception as exc:
                logger.error(f"Failed to dispatch alert to chat {chat_id}: {exc}")

    return {"status": "success", "sent_count": sent_count, "target_chats": target_chats}


@app.post("/api/nas-bot/webhook/{platform}")
async def bot_webhook(platform: str, request: Request) -> Dict[str, Any]:
    """
    Generic webhook endpoint receiving incoming messages from Telegram or Discord.
    Processes photos, extracts EXIF GPS, and stores case reports into NAS.
    """
    if platform not in ["telegram", "discord"]:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

    try:
        body = await request.json()
        logger.info(f"Received webhook payload from {platform}: {str(body)[:200]}...")

        # Basic echo / acknowledgement for webhook validation
        return {
            "status": "received",
            "platform": platform,
            "timestamp": datetime.datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error handling {platform} webhook: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/nas-bot/cases")
def list_all_cases() -> Dict[str, Any]:
    """
    Retrieve all NAS cases list for case selection dropdown.
    """
    cases = nas_manager.get_all_cases()
    return {"cases": cases, "total": len(cases)}


@app.post("/api/nas-bot/upload")
async def upload_case_report(
    notes: str = Form(...),
    target_case_id: Optional[str] = Form(None),
    lat: Optional[float] = Form(None),
    lon: Optional[float] = Form(None),
    x_user: Optional[str] = Header(None, alias="X-User"),
    files: List[UploadFile] = File(None)
) -> Dict[str, Any]:
    """
    Upload endpoint for Dashboard Web Chat Widget to submit field reports directly into NAS.
    Performs OCR extraction on uploaded images (TR.14) and syncs event with chat-service.
    """
    username = x_user or "anonymous_officer"
    
    # Check explicitly passed target_case_id first or custom case in notes
    if target_case_id and target_case_id.strip() and target_case_id != "new":
        case_id = target_case_id.strip()
    else:
        explicit_case = extract_explicit_case_id(notes)
        if explicit_case:
            case_id = explicit_case
        else:
            case_id = f"Case_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

    processed_files = []
    final_lat = lat
    final_lon = lon
    exif_info = {}
    
    all_suspects = []
    created_dossier_ids = []
    behavior = None

    if files:
        from services.ai_ocr import extract_document_data
        for file_obj in files:
            content = await file_obj.read()
            filename = file_obj.filename or "file.bin"

            # Determine category based on extension
            ext = filename.split(".")[-1].lower() if "." in filename else ""
            category = "Documents"
            if ext in ["jpg", "jpeg", "png", "webp"]:
                category = "Photos"
                # Extract EXIF GPS & metadata
                meta = extract_photo_metadata(content)
                if meta.get("has_gps") and (final_lat is None or final_lon is None):
                    final_lat = meta.get("lat")
                    final_lon = meta.get("lon")
                if meta.get("make") or meta.get("model") or meta.get("timestamp"):
                    exif_info = {
                        "make": meta.get("make"),
                        "model": meta.get("model"),
                        "timestamp": meta.get("timestamp"),
                        "has_gps": meta.get("has_gps")
                    }

                # Smart Photo Auto-Routing: check if photo matches an existing warrant/dossier
                routed = dossier_mgr.route_photo_to_dossier(filename, content)
                if routed:
                    if routed["dossier_id"] not in created_dossier_ids:
                        created_dossier_ids.append(routed["dossier_id"])
                    if not behavior:
                        behavior = f"📸 จับคู่รูปภาพ ทร.14 เข้าแฟ้ม '{routed.get('suspect_name')}' (เลขบัตร {routed.get('id_card') or '-'}) เรียบร้อยแล้ว"

            elif ext in ["mp4", "mkv", "avi", "mov"]:
                category = "Videos"
                
            # Perform AI Extraction for documents and images
            if category in ["Photos", "Documents"]:
                if ext == "pdf":
                    # Check if it's a Bank Statement PDF
                    pw_match = re.search(r'(?:รหัส|pass(?:word)?|pin)\s*[:\s]?\s*([A-Za-z0-9]+)', notes or "", re.IGNORECASE)
                    raw_pw = pw_match.group(1) if pw_match else None
                    if not raw_pw:
                        num_match = re.search(r'\b(\d{6,8})\b', notes or "")
                        if num_match: raw_pw = num_match.group(1)

                    candidate_pws = [raw_pw] if raw_pw else []
                    for d in dossier_mgr.get_all_dossiers():
                        id_c = d.get("id_card")
                        if id_c:
                            clean_id = re.sub(r'\D', '', str(id_c))
                            if clean_id: candidate_pws.append(clean_id[-8:])

                    try:
                        stmt_res = statement_parser.parse_statement_pdf(
                            file_bytes=content,
                            filename=filename,
                            password=raw_pw,
                            candidate_passwords=candidate_pws
                        )
                        acc = stmt_res.get("account_info", {})
                        if acc.get("account_holder"):
                            all_suspects.append({
                                "suspect_name": acc.get("account_holder"),
                                "id_card": None,
                                "phone_number": None,
                                "role_tag": "เจ้าของบัญชี (Statement)",
                                "area_tag": None,
                                "address": acc.get("address")
                            })
                        if not behavior:
                            summ = stmt_res.get("summary", {})
                            behavior = f"รายการเดินบัญชี {acc.get('bank_name')} เลขที่ {acc.get('account_number')} ยอดเงินเข้า ฿{summ.get('total_inflow', 0):,.2f} ยอดเงินออก ฿{summ.get('total_outflow', 0):,.2f}"
                    except Exception as err:
                        logger.info(f"PDF {filename} is not a statement or failed decrypt: {err}")

                elif ext in ["xlsx", "xls", "csv"]:
                    # 1. Check if it's a Warrant Registry Excel sheet
                    is_warrant = False
                    try:
                        w_res = parse_warrant_excel(content)
                        if w_res.get("status") == "success" and w_res.get("total_count", 0) > 0:
                            is_warrant = True
                            for rec in w_res.get("records", []):
                                p = dossier_mgr.upsert_warrant_record(rec, case_id=case_id)
                                if p and p.get("dossier_id"):
                                    if p["dossier_id"] not in created_dossier_ids:
                                        created_dossier_ids.append(p["dossier_id"])
                            
                            # Add sample suspects to all_suspects
                            for rec in w_res.get("records", [])[:10]:
                                all_suspects.append({
                                    "suspect_name": rec.get("suspect_name"),
                                    "id_card": rec.get("clean_id_card"),
                                    "phone_number": None,
                                    "role_tag": "ผู้ต้องหาตามหมายจับ",
                                    "area_tag": rec.get("station_name"),
                                    "address": f"{rec.get('subdistrict', '')} {rec.get('district', '')} {rec.get('province', '')}".strip() or None
                                })
                            
                            behavior = w_res.get("summary_text")
                    except Exception as err:
                        logger.info(f"File {filename} is not Warrant Excel: {err}")

                    # 2. Check if it's a SPNI / CDR Phone report
                    if not is_warrant:
                        try:
                            cdr_res = cdr_parser.parse_cdr_file(
                                content,
                                filename,
                                dossier_manager=dossier_mgr,
                                operator=username
                            )
                            if cdr_res.get("report_type") == "SPNI_PHONE_REPORT":
                                dev = cdr_res.get("device_info", {})
                                if dev.get("owner_name"):
                                    all_suspects.append({
                                        "suspect_name": dev.get("owner_name"),
                                        "id_card": None,
                                        "phone_number": dev.get("target_phone"),
                                        "role_tag": "เป้าหมาย (SPNI)",
                                        "area_tag": None,
                                        "address": None
                                    })
                                if not behavior:
                                    behavior = f"รายงานประวัติการโทร SPNI ({dev.get('brand')} {dev.get('model')}) ยอดโทร {cdr_res['total_records']:,} สาย ({cdr_res['unique_pairs_count']} คู่สาย)"
                            else:
                                if not behavior:
                                    behavior = f"บันทึกประวัติการโทร CDR ยอดโทร {cdr_res['total_records']:,} สาย ({cdr_res['unique_pairs_count']} คู่สาย)"
                        except Exception as err:
                            logger.info(f"File {filename} is not SPNI/CDR: {err}")

                extracted_res = extract_document_data(content, filename)
                if extracted_res.get("suspects"):
                    all_suspects.extend(extracted_res["suspects"])
                if extracted_res.get("behavior") and not behavior:
                    behavior = extracted_res["behavior"]

            processed_files.append({
                "filename": filename,
                "category": category,
                "content": content
            })

    # Extract case metadata from OCR if available
    last_ocr_incident_location = None
    last_ocr_district = None
    last_ocr_subdistrict = None
    last_ocr_drug_qty = None
    if 'extracted_res' in locals() and isinstance(extracted_res, dict):
        last_ocr_incident_location = extracted_res.get("incident_location")
        last_ocr_district = extracted_res.get("district")
        last_ocr_subdistrict = extracted_res.get("subdistrict")
        last_ocr_drug_qty = extracted_res.get("seized_items", {}).get("total_drug_quantity")

    # Save to NAS
    result = nas_manager.save_case_report(
        case_id=case_id,
        officer_username=username,
        platform="web_chat",
        notes=notes,
        lat=final_lat,
        lon=final_lon,
        files=processed_files,
        suspects=all_suspects,
        behavior=behavior,
        incident_location=last_ocr_incident_location,
        district=last_ocr_district,
        subdistrict=last_ocr_subdistrict,
        case_drug_quantity=last_ocr_drug_qty
    )

    # Upsert each suspect to Person Dossier Vault & collect dossier_ids
    for s in (all_suspects if all_suspects else []):
        s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
        d_profile = dossier_mgr.upsert_dossier(
            suspect_name=s_name,
            id_card=s.get("id_card"),
            phone_number=s.get("phone_number"),
            role_tag=s.get("role_tag") or "ผู้ต้องหา",
            area_tag=s.get("area_tag"),
            address=s.get("address"),
            age=s.get("age"),
            category="drug" if "ยา" in (notes or behavior or "") else "general",
            behavior=behavior,
            notes=notes or f"สำนวนคดี {case_id}",
            officer_username=username,
            platform="web_chat",
            files=[{"filename": f["filename"], "content": f["content"]} for f in processed_files]
        )
        if d_profile and d_profile.get("dossier_id"):
            d_id = d_profile["dossier_id"]
            if d_id not in created_dossier_ids:
                created_dossier_ids.append(d_id)

    # Auto Cross-Link & Detect Spouse/Family Relations
    total_linked = auto_detect_and_link_relations(
        dossier_ids=created_dossier_ids,
        case_id=case_id,
        text_context=f"{notes or ''} {behavior or ''}",
        suspects=all_suspects,
        source_files=[f["filename"] for f in processed_files] if processed_files else []
    )

    # Sync case to chat-service so it appears in event feed & heatmap ONLY if explicit crime/seizure report
    has_crime_report = any(kw in (notes or behavior or "") for kw in ["จับกุม", "ตรวจยึด", "ของกลาง", "ยาบ้า", "ไอซ์", "อาวุธ", "ยาเสพติด"])
    if has_crime_report:
        first_s = all_suspects[0] if all_suspects else {}
        sync_notes = behavior if (behavior and ("อัปโหลดไฟล์" in (notes or ""))) else (notes or behavior or f"สำนวนคดี {case_id}")
        asyncio.create_task(sync_to_chat_service(
            case_id=case_id,
            officer_username=username,
            notes=sync_notes,
            extracted=extracted_res if 'extracted_res' in locals() else first_s,
            lat=final_lat,
            lon=final_lon,
            suspects_list=all_suspects
        ))

    return {
        "status": "success",
        "case_id": case_id,
        "suspects": all_suspects,
        "suspects_count": len(all_suspects),
        "linked_network_count": len(created_dossier_ids),
        "location": {"lat": final_lat, "lon": final_lon},
        "exif": exif_info,
        "behavior": behavior,
        "response_text": behavior or f"บันทึกสำนวนคดี {case_id} เรียบร้อยแล้ว (จำนวน {len(processed_files)} ไฟล์)",
        "files_count": len(processed_files),
        "files": [{"filename": f["filename"], "category": f["category"]} for f in processed_files],
        "metadata": result
    }


@app.get("/api/nas-bot/search")
def search_cases(q: str) -> Dict[str, Any]:
    """
    Search NAS cases, Dossier Vaults, and Person Registry by query keyword, Case ID, name, ID card, or phone.
    """
    if not q:
        return {"results": [], "dossiers": [], "persons": [], "count": 0}

    results = nas_manager.search_cases(q)
    
    clean_q = THAI_TITLE_PREFIX_PATTERN.sub('', q.strip()).strip()

    # 1. Search Dossier Vaults (with Thai title normalization fallback)
    dossier_matches = dossier_mgr.get_all_dossiers(query=q)
    if not dossier_matches and clean_q and clean_q != q:
        dossier_matches = dossier_mgr.get_all_dossiers(query=clean_q)

    full_dossiers = []
    for dm in dossier_matches:
        d_id = dm.get("dossier_id")
        full_d = dossier_mgr.get_dossier_detail(d_id) or dm
        full_dossiers.append(full_d)

    # 2. Search Person Registry
    all_persons = nas_manager.person_registry.get_all_persons()
    matched_persons = []
    q_lower = q.lower().strip()
    clean_q_lower = clean_q.lower() if clean_q else ""
    search_q_terms = [q_lower]
    if clean_q_lower and clean_q_lower != q_lower and len(clean_q_lower) >= 2:
        search_q_terms.append(clean_q_lower)

    p_tokens = [t.strip().lower() for t in (clean_q_lower or q_lower).split() if len(t.strip()) >= 2]

    for p in all_persons:
        p_name = (p.get("suspect_name") or "").lower()
        p_cid = (p.get("id_card") or "")
        p_phones = [str(ph) for ph in p.get("phones", [])]
        p_nick = (p.get("nickname") or "").lower()
        p_sources = " ".join(str(s.get("notes") or "") for s in p.get("sources", [])).lower()
        p_aliases = " ".join(str(a) for a in p.get("aliases", [])).lower()
        
        matched_p = False
        for sq in search_q_terms:
            if (sq in p_name or sq in p_cid or any(sq in ph for ph in p_phones) or
                sq in p_nick or sq in p_sources or sq in p_aliases):
                matched_p = True
                break

        if not matched_p and len(p_tokens) >= 2:
            combined_p = f"{p_name} {p_nick} {p_aliases} {p_sources}"
            if all(t in combined_p for t in p_tokens):
                matched_p = True

        if matched_p:
            matched_persons.append(p)

    return {
        "status": "success",
        "query": q,
        "count": len(results) + len(full_dossiers) + len(matched_persons),
        "results": results,
        "dossiers": full_dossiers,
        "persons": matched_persons
    }


@app.delete("/api/nas-bot/cases/{case_id}")
def delete_case_report(case_id: str) -> Dict[str, Any]:
    """
    Delete a case report from NAS storage by Case ID.
    """
    ok = nas_manager.delete_case(case_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"ไม่พบสำนวนคดี '{case_id}' ในระบบ NAS")
    return {
        "status": "success",
        "message": f"ลบสำนวนคดี {case_id} ออกจาก NAS เรียบร้อยแล้ว",
        "case_id": case_id
    }


# ==========================================
# Person Registry & File Streaming Endpoints
# ==========================================

@app.get("/api/nas-bot/persons")
def get_persons_list() -> Dict[str, Any]:
    """
    Retrieve all Person Profiles from Person Registry.
    """
    persons = nas_manager.person_registry.get_all_persons()
    return {
        "status": "success",
        "count": len(persons),
        "persons": persons
    }


@app.get("/api/nas-bot/persons/{person_id}")
def get_person_detail(person_id: str) -> Dict[str, Any]:
    """
    Retrieve single Person Profile details including address history and address neighbors.
    """
    person = nas_manager.person_registry.get_person_by_id(person_id)
    if not person:
        raise HTTPException(status_code=404, detail=f"ไม่พบประวัติบุคคล ID '{person_id}'")
        
    primary_case = person.get("sources", [{}])[0].get("case_id") if person.get("sources") else None
    person["has_primary_photo"] = bool(nas_manager.get_primary_photo(primary_case)) if primary_case else False

    return {
        "status": "success",
        "person": person
    }


@app.get("/api/nas-bot/cases/{case_id}/photo")
def get_case_photo(case_id: str):
    """
    Stream the primary TR.14/photo image of a case.
    """
    photo_path = nas_manager.get_primary_photo(case_id)
    if not photo_path or not os.path.exists(photo_path):
        raise HTTPException(status_code=404, detail="ไม่พบรูปภาพในสำนวนคดีนี้")
    return FileResponse(photo_path, media_type="image/jpeg")


@app.get("/api/nas-bot/cases/{case_id}/files")
def list_case_files(case_id: str) -> Dict[str, Any]:
    """
    List all attached files in a case folder grouped by category.
    """
    return nas_manager.get_case_files(case_id)


@app.get("/api/nas-bot/cases/{case_id}/files/{category}/{filename}")
def stream_case_file(case_id: str, category: str, filename: str):
    """
    Download or stream a specific file from NAS storage.
    """
    file_path = nas_manager.get_case_file_path(case_id, category, filename)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์ที่ต้องการ")
    
    # Determine media type
    ext = filename.split(".")[-1].lower()
    media_types = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "pdf": "application/pdf", "mp4": "video/mp4", "txt": "text/plain"
    }
    mt = media_types.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=mt, filename=filename)


# ==========================================
# Person Dossier Vault (ถังแฟ้มประวัติรายบุคคล)
# ==========================================

@app.get("/api/nas-bot/dossiers/filter-options")
def get_dossier_filter_options() -> Dict[str, Any]:
    """
    Return unique station names and district-province pairs from warrant dossiers
    for populating filter dropdowns on the Arrest Vault UI.
    """
    all_warrant = dossier_mgr.get_all_dossiers(category="warrant")
    stations: set = set()
    districts: set = set()

    for d in all_warrant:
        wi = d.get("warrant_info") or {}
        # Station name from warrant_info or area_tag
        st = wi.get("station_name") or d.get("area_tag", "")
        if st:
            stations.add(st)
        # District-province from warrant_info fields or address
        dist = wi.get("district", "")
        prov = wi.get("province", "")
        if not dist:
            # Fallback: extract district/province from address ("ตำบล อำเภอ จังหวัด")
            addr = d.get("address", "")
            parts = addr.strip().split() if addr else []
            if len(parts) >= 2:
                dist = parts[-2]
                prov = parts[-1]
        if dist:
            label = f"{dist} - {prov}" if prov else dist
            districts.add(label)

    return {
        "status": "success",
        "stations": sorted(stations),
        "districts": sorted(districts)
    }


@app.get("/api/nas-bot/dossiers")
def list_dossiers(
    year: Optional[int] = Query(None, description="กรองตามปี พ.ศ. เช่น 2569"),
    month: Optional[str] = Query(None, description="กรองตามเดือน (01-12)"),
    category: Optional[str] = Query(None, description="กรองตามประเภทคดี เช่น drug, weapon, alien, general"),
    q: Optional[str] = Query(None, description="ค้นหาตามชื่อ, เลขบัตร, เบอร์โทร, หรือรหัสคดี"),
    sort_by: str = Query("newest", description="การเรียงลำดับ (newest, oldest)"),
    station: Optional[str] = Query(None, description="กรองตาม สถานีตำรวจ/สภ. ที่ออกหมาย"),
    district: Optional[str] = Query(None, description="กรองตาม อำเภอ - จังหวัด ภูมิลำเนาผู้มีหมาย")
) -> Dict[str, Any]:
    """
    Retrieve all Person Dossiers from the vault with optional Year, Month, Category, and Keyword filters.
    Supports additional warrant-specific filters: station and district.
    """
    actual_year = year if isinstance(year, int) else None
    actual_month = month if isinstance(month, str) else None
    actual_category = category if isinstance(category, str) else None
    actual_q = q if isinstance(q, str) else None
    actual_sort_by = sort_by if isinstance(sort_by, str) else "newest"

    dossiers = dossier_mgr.get_all_dossiers(year=actual_year, month=actual_month, category=actual_category, query=actual_q, sort_by=actual_sort_by)

    # Post-filter by station (warrant-specific, case-insensitive substring match, None-safe)
    if station and station.strip():
        st_term = station.strip().lower()
        dossiers = [
            d for d in dossiers
            if st_term in (((d.get("warrant_info") or {}).get("station_name") or "")).lower()
            or st_term in (d.get("area_tag") or "").lower()
        ]

    # Post-filter by district-province (warrant-specific, case-insensitive substring match, None-safe)
    if district and district.strip():
        dist_term = district.strip().lower()
        dist_parts = [p.strip() for p in dist_term.split(" - ") if p.strip()] if " - " in dist_term else [dist_term]
        filtered = []
        for d in dossiers:
            wi = d.get("warrant_info") or {}
            w_dist = (wi.get("district") or "").lower()
            w_prov = (wi.get("province") or "").lower()
            addr = (d.get("address") or "").lower()
            match = True
            for part in dist_parts:
                if not (part in w_dist or part in w_prov or part in addr):
                    match = False
                    break
            if match:
                filtered.append(d)
        dossiers = filtered

    return {
        "status": "success",
        "count": len(dossiers),
        "year_filter": year,
        "category_filter": category,
        "station_filter": station,
        "district_filter": district,
        "dossiers": dossiers
    }


@app.post("/api/nas-bot/dossiers/sync-all")
def sync_all_dossiers() -> Dict[str, Any]:
    """
    Sync all historical cases and intelligence documents into Dossier Vaults.
    """
    return dossier_mgr.sync_all_existing_cases()


@app.get("/api/nas-bot/dossiers/{dossier_id}")
def get_dossier_detail(dossier_id: str) -> Dict[str, Any]:
    """
    Retrieve detailed dossier including personal files and cross-linked network dossiers.
    Supports direct Dossier ID, Thai unquoted/quoted names, Case IDs (Case_...), and Person IDs.
    """
    import urllib.parse
    clean_id = urllib.parse.unquote(dossier_id).strip()

    # 1. Try direct lookup by dossier ID or clean unquoted ID
    dossier = dossier_mgr.get_dossier_detail(clean_id) or dossier_mgr.get_dossier_detail(dossier_id)

    # 2. If not found and input is a Case ID (e.g. Case_20260902_...), find linked dossier
    if not dossier and (clean_id.lower().startswith("case_") or clean_id.startswith("CASE-")):
        case_matches = nas_manager.search_cases(clean_id)
        if case_matches:
            c = case_matches[0]
            # Check suspects list
            for s in c.get("suspects", []):
                s_name = s.get("suspect_name")
                s_cid = s.get("id_card")
                if s_name and s_name != "ไม่ระบุชื่อ":
                    d_matches = dossier_mgr.get_all_dossiers(query=s_name)
                    if d_matches:
                        dossier = dossier_mgr.get_dossier_detail(d_matches[0].get("dossier_id"))
                        if dossier:
                            break
                if not dossier and s_cid:
                    d_matches = dossier_mgr.get_all_dossiers(query=s_cid)
                    if d_matches:
                        dossier = dossier_mgr.get_dossier_detail(d_matches[0].get("dossier_id"))
                        if dossier:
                            break

        # Fallback: check Person Registry
        if not dossier:
            for p in nas_manager.person_registry.get_all_persons():
                p_sources = p.get("sources", [])
                if any(s.get("case_id") == clean_id for s in p_sources):
                    p_name = p.get("suspect_name")
                    p_cid = p.get("id_card")
                    if p_name and p_name != "ไม่ระบุชื่อ":
                        d_matches = dossier_mgr.get_all_dossiers(query=p_name)
                        if d_matches:
                            dossier = dossier_mgr.get_dossier_detail(d_matches[0].get("dossier_id"))
                            if dossier:
                                break
                    if not dossier and p_cid:
                        d_matches = dossier_mgr.get_all_dossiers(query=p_cid)
                        if d_matches:
                            dossier = dossier_mgr.get_dossier_detail(d_matches[0].get("dossier_id"))
                            if dossier:
                                break

    # 3. If not found, try lookup by suspect name or query
    if not dossier:
        d_matches = dossier_mgr.get_all_dossiers(query=clean_id)
        if d_matches:
            dossier = dossier_mgr.get_dossier_detail(d_matches[0].get("dossier_id"))

    if not dossier:
        raise HTTPException(status_code=404, detail=f"ไม่พบถังข้อมูลแฟ้มประวัติ '{dossier_id}'")
    return {
        "status": "success",
        "dossier": dossier
    }


class DossierUpdatePayload(BaseModel):
    suspect_name: Optional[str] = None
    id_card: Optional[str] = None
    phone_number: Optional[str] = None
    role_tag: Optional[str] = None
    area_tag: Optional[str] = None
    address: Optional[str] = None
    behavior: Optional[str] = None
    category: Optional[str] = None


@app.post("/api/nas-bot/dossiers/{dossier_id}/update")
def update_dossier(
    dossier_id: str,
    payload: DossierUpdatePayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
) -> Dict[str, Any]:
    """Update a dossier with optional operator provenance and safe typed identity-error statuses.

    ``dossier_id`` and the validated payload select permitted profile changes; ``X-User`` becomes
    correction provenance or the stable ``system`` fallback. The manager writes the profile and any
    identity propagation, while this boundary returns the authorized dossier and sanitized sync summary.
    Typed failures raise fixed HTTP errors; rollback-verification failure also emits a PII-free CRITICAL audit.
    """
    # Build the existing sparse update map once and keep the actor separate from potentially personal payload values.
    updates = payload.dict(exclude_unset=True)
    actor = x_user or "system"
    try:
        res = dossier_mgr.update_dossier_profile(dossier_id, updates, actor=actor)
    except IdentityValidationError as exc:
        # Typed validation failures must not reflect lower-layer text because it can contain submitted identity data.
        raise HTTPException(status_code=400, detail="Invalid identity update") from exc
    except IdentityNotFoundError as exc:
        # A stable-target miss has an explicit client status without exposing path or identifier diagnostics.
        raise HTTPException(status_code=404, detail="Identity dossier not found") from exc
    except IdentityConflictError as exc:
        # Candidate conflicts are actionable to the caller but their registry details remain internal.
        raise HTTPException(status_code=409, detail="Identity update conflict") from exc
    except IdentityTransactionError as exc:
        # A verified rollback leaves a safe generic server failure response.
        raise HTTPException(status_code=500, detail="Identity update could not be completed") from exc
    except IdentityRollbackError as exc:
        # Record only the approved stable target/operator/status/type; never serialize the exception or request fields.
        logger.critical(
            "Identity rollback verification failed dossier_id=%r actor=%r status=503 error_type=%s",
            dossier_id,
            actor,
            type(exc).__name__,
        )
        # Verification failure needs operator attention, but the fixed response reveals no transaction/profile details.
        raise HTTPException(status_code=503, detail="Identity update recovery required") from exc
    if not res:
        # The legacy narrow manager reports a missing dossier as ``None`` rather than a typed identity error.
        raise HTTPException(status_code=404, detail="Dossier not found or could not be updated")

    # The standardized manager envelope preserves the authorized dossier and adds only a sanitized coordinator result.
    return {
        "status": "success",
        "message": "Dossier updated successfully",
        "dossier": res["dossier"],
        "identity_sync": res["identity_sync"],
    }


class DossierLinkPayload(BaseModel):
    dossier_id_a: str
    dossier_id_b: str
    reason: Optional[str] = "เจ้าหน้าที่ระบุความเชื่อมโยง"


@app.post("/api/nas-bot/dossiers/link")
def link_dossiers(payload: DossierLinkPayload) -> Dict[str, Any]:
    """
    Explicitly link two dossiers bidirectionally.
    """
    ok = dossier_mgr.link_two_dossiers(payload.dossier_id_a, payload.dossier_id_b, payload.reason or "เจ้าหน้าที่ระบุความเชื่อมโยง")
    if not ok:
        raise HTTPException(status_code=400, detail="ไม่สามารถเชื่อมโยงถังข้อมูลได้ (โปรดตรวจสอบรหัสถัง)")
    return {
        "status": "success",
        "message": f"เชื่อมโยง '{payload.dossier_id_a}' และ '{payload.dossier_id_b}' เรียบร้อยแล้ว",
        "reason": payload.reason
    }


@app.post("/api/nas-bot/dossiers/unlink")
def unlink_dossiers(payload: DossierLinkPayload) -> Dict[str, Any]:
    """
    Remove link between two dossiers.
    """
    ok = dossier_mgr.unlink_two_dossiers(payload.dossier_id_a, payload.dossier_id_b)
    if not ok:
        raise HTTPException(status_code=400, detail="ไม่สามารถตัดการเชื่อมโยงได้")
    return {
        "status": "success",
        "message": f"ตัดการเชื่อมโยงระหว่าง '{payload.dossier_id_a}' และ '{payload.dossier_id_b}' เรียบร้อยแล้ว"
    }


class DossierMergePayload(BaseModel):
    source_dossier_id: str
    target_dossier_id: str
    force: Optional[bool] = True


@app.post("/api/nas-bot/dossiers/merge")
def merge_dossiers_endpoint(payload: DossierMergePayload) -> Dict[str, Any]:
    """
    Consolidate source dossier into target dossier, moving all files and evidence,
    merging metadata, retargeting all graph edges, and deleting the source dossier.
    """
    res = dossier_mgr.merge_dossiers(payload.source_dossier_id, payload.target_dossier_id, force=bool(payload.force))
    if not res:
        raise HTTPException(status_code=400, detail="ไม่สามารถรวมแฟ้มข้อมูลได้ (โปรดตรวจสอบรหัสแฟ้มต้นทางและปลายทาง)")
    t_name = (res or {}).get("suspect_name") or payload.target_dossier_id
    fc = len((res or {}).get("personal_files") or [])
    notify_merge_to_telegram(payload.source_dossier_id, payload.target_dossier_id, t_name, fc)
    return {
        "status": "success",
        "message": f"รวมแฟ้ม '{payload.source_dossier_id}' เข้าสู่ '{payload.target_dossier_id}' เรียบร้อยแล้ว",
        "dossier": res
    }



@app.get("/api/nas-bot/dossiers/{dossier_id}/download/{filename}")
def download_dossier_file(dossier_id: str, filename: str):
    """
    Download or stream a file from the person's dossier Personal folder or associated Cases.
    Supports Thai characters, UTF-8 filenames, and extended MIME types.
    """
    clean_dossier_id = urllib.parse.unquote(dossier_id)
    clean_filename = urllib.parse.unquote(filename)

    file_path = dossier_mgr.get_file_path(clean_dossier_id, clean_filename)
    if not file_path or not os.path.exists(file_path):
        # Fallback to direct name search
        file_path = dossier_mgr.get_file_path(dossier_id, filename)

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"ไม่พบไฟล์ '{clean_filename}' ในถังข้อมูล {clean_dossier_id}")

    ext = clean_filename.split(".")[-1].lower() if "." in clean_filename else ""
    media_types = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "bmp": "image/bmp",
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "csv": "text/csv",
        "txt": "text/plain; charset=utf-8",
        "zip": "application/zip",
        "rar": "application/vnd.rar",
        "7z": "application/x-7z-compressed",
        "mp4": "video/mp4",
        "mp3": "audio/mpeg"
    }
    mt = media_types.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=mt, filename=clean_filename)


@app.get("/api/nas-bot/preview-doc")
def preview_document(
    dossier_id: Optional[str] = Query(None),
    filename: Optional[str] = Query(None),
    case_id: Optional[str] = Query(None),
    category: Optional[str] = Query("Documents")
) -> Dict[str, Any]:
    """
    Extract and preview document text/tables/structure for in-app reading without downloading.
    Supports Word (.docx), Excel (.xlsx), and plain text / JSON / CSV.
    """
    file_path = None
    clean_fn = urllib.parse.unquote(filename) if filename else ""

    if dossier_id and filename:
        clean_did = urllib.parse.unquote(dossier_id)
        file_path = dossier_mgr.get_file_path(clean_did, clean_fn)
    elif case_id and filename:
        clean_cid = urllib.parse.unquote(case_id)
        cases_root = os.path.join(dossier_mgr.root_path, "Cases")
        for root, dirs, files in os.walk(cases_root):
            if clean_cid in root and clean_fn in files:
                file_path = os.path.join(root, clean_fn)
                break

    if not file_path or not os.path.exists(file_path):
        # Global fallback scan
        for root, dirs, files in os.walk(dossier_mgr.root_path):
            if clean_fn in files:
                file_path = os.path.join(root, clean_fn)
                break

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="ไม่พบไฟล์เอกสารที่ต้องการดูตัวอย่าง")

    ext = file_path.split(".")[-1].lower() if "." in file_path else ""

    # 1. Word Document (.docx)
    if ext == "docx":
        try:
            import docx
            doc = docx.Document(file_path)
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            tables_data = []
            for t in doc.tables:
                t_rows = []
                for row in t.rows:
                    t_rows.append([cell.text.strip() for cell in row.cells])
                if t_rows:
                    tables_data.append(t_rows)
            return {
                "status": "success",
                "file_type": "docx",
                "filename": os.path.basename(file_path),
                "paragraphs": paragraphs,
                "tables": tables_data,
                "total_paragraphs": len(paragraphs)
            }
        except Exception as e:
            return {"status": "error", "message": f"ไม่สามารถอ่านไฟล์ Word: {e}"}

    # 2. Excel Spreadsheet (.xlsx)
    elif ext in ["xlsx", "xls"]:
        try:
            w_res = parse_warrant_excel(file_path)
            if w_res.get("status") == "success":
                return {
                    "status": "success",
                    "file_type": "warrant_excel",
                    "filename": os.path.basename(file_path),
                    "summary_text": w_res.get("summary_text"),
                    "total_count": w_res.get("total_count"),
                    "urgent_count": w_res.get("urgent_count"),
                    "records_sample": w_res.get("records", [])[:30]
                }
        except Exception as e:
            logger.info(f"Failed to preview excel: {e}")

    # 3. Plain Text / CSV / JSON
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read(50000)
        return {
            "status": "success",
            "file_type": "text",
            "filename": os.path.basename(file_path),
            "text": content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ไม่สามารถเปิดอ่านไฟล์ได้: {e}")



class RemarkPayload(BaseModel):
    remark: str

@app.post("/api/nas-bot/dossiers/{dossier_id}/remarks")
def add_dossier_remark(dossier_id: str, payload: RemarkPayload) -> Dict[str, Any]:
    """Append a remark to a dossier's notes (Incident 2.61 / ADR 0023)."""
    with identity_sync_coordinator:
        profile = dossier_mgr.get_dossier(dossier_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Dossier not found")
        
        current_notes = profile.get("notes") or ""
        import datetime
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        appended_remark = f"\n[{now_str}] {payload.remark}"
        
        if current_notes:
            profile["notes"] = current_notes + appended_remark
        else:
            profile["notes"] = appended_remark
            
        profile["updated_at"] = datetime.datetime.now().isoformat()
        
        # Save back using upsert to maintain index sync
        dossier_mgr.upsert_dossier(
            suspect_name=profile.get("suspect_name"),
            id_card=profile.get("id_card"),
            phone_number=profile.get("phone_number"),
            role_tag=profile.get("role_tag"),
            area_tag=profile.get("area_tag"),
            address=profile.get("address"),
            age=profile.get("age"),
            category=profile.get("category"),
            behavior=profile.get("behavior"),
            notes=profile["notes"],
            officer_username=profile.get("officer_username", "admin"),
            platform=profile.get("platform", "web"),
            year=profile.get("year"),
            name_source=profile.get("name_source", "manual")
        )
        return {"status": "success"}

@app.post("/api/nas-bot/dossiers/{dossier_id}/attachments")
async def upload_dossier_attachment(dossier_id: str, file: UploadFile = File(...)) -> Dict[str, Any]:
    """Upload an attachment directly to a dossier and auto-parse via AI (ADR 0023)."""
    with identity_sync_coordinator:
        profile = dossier_mgr.get_dossier(dossier_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Dossier not found")
            
        file_bytes = await file.read()
        
        # Save file to Personal
        import datetime
        import os
        now_iso = datetime.datetime.now().isoformat()
        dossier_folder = dossier_mgr.get_safe_dossier_path(dossier_id)
        personal_folder = os.path.join(dossier_folder, "Personal")
        os.makedirs(personal_folder, exist_ok=True)
        
        target_path = os.path.join(personal_folder, file.filename)
        with open(target_path, "wb") as f:
            f.write(file_bytes)
            
        # Update profile personal_files
        file_entry = {
            "filename": file.filename,
            "size_bytes": len(file_bytes),
            "saved_at": now_iso
        }
        if not any(pf.get("filename") == file.filename for pf in profile.setdefault("personal_files", [])):
            profile["personal_files"].append(file_entry)
            
        profile["updated_at"] = now_iso
        profile_path = os.path.join(dossier_folder, "profile.json")
        import json
        with open(profile_path, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)
            
    # Process AI OCR outside the coordinator lock so it doesn't block other users
    from services.ai_ocr import extract_document_data
    try:
        res = extract_document_data(file_bytes, file.filename)
        # If it extracted any suspects, we should upsert them and auto-link!
        suspects = res.get("suspects", [])
        if suspects:
            # Re-enter lock to apply AI discoveries
            with identity_sync_coordinator:
                for s in suspects:
                    # Upsert new dossier (or update existing)
                    s_profile = dossier_mgr.upsert_dossier(
                        suspect_name=s.get("name"),
                        id_card=s.get("id_card"),
                        phone_number=s.get("phone"),
                        role_tag=s.get("role_tag", "เครือข่ายเพิ่มเติม"),
                        behavior=res.get("behavior")
                    )
                    
                    # If this suspect is NOT the main dossier, link them
                    if s_profile.get("dossier_id") != dossier_id:
                        dossier_mgr.link_dossiers(
                            dossier_a=dossier_id,
                            dossier_b=s_profile.get("dossier_id"),
                            reason="พบบุคคลเชื่อมโยงในเอกสารแนบ",
                            shared_files=[file.filename]
                        )
                        
    except Exception as e:
        import logging
        logging.error(f"Error parsing attachment {file.filename}: {e}")
        
    return {"status": "success", "filename": file.filename}

@app.delete("/api/nas-bot/dossiers/{dossier_id}")
def delete_dossier(
    dossier_id: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """
    Delete a person's dossier vault.
    Strictly restricted to Admin / Super Admin only.
    """
    role = (x_role or "officer").lower()
    if role not in ["admin", "superadmin", "super_admin"]:
        raise HTTPException(
            status_code=403,
            detail="⚠️ ปฏิเสธการเข้าถึง: สิทธิ์การลบถังข้อมูลและสำนวนคดีจำกัดเฉพาะ Admin / Super Admin เท่านั้น"
        )

    ok = dossier_mgr.delete_dossier(dossier_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"ไม่พบถังข้อมูล '{dossier_id}' หรือไม่สามารถลบได้")

    return {
        "status": "success",
        "message": f"ลบถังข้อมูลและแฟ้มประวัติ '{dossier_id}' ออกจากระบบเรียบร้อยแล้ว",
        "deleted_by": x_user or "admin",
        "dossier_id": dossier_id
    }


@app.delete("/api/nas-bot/dossiers/{dossier_id}/files/{filename:path}")
def delete_dossier_file(
    dossier_id: str,
    filename: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """
    Delete a specific file/photo from a person's dossier and disk storage.
    Strictly restricted to Admin / Super Admin only.
    """
    role = (x_role or "officer").lower()
    if role not in ["admin", "superadmin", "super_admin"]:
        raise HTTPException(
            status_code=403,
            detail="⚠️ ปฏิเสธการเข้าถึง: สิทธิ์การลบไฟล์และพยานหลักฐานจำกัดเฉพาะ Admin / Super Admin เท่านั้น"
        )

    try:
        res = dossier_mgr.delete_dossier_file(dossier_id, filename)
        return {
            "status": "success",
            "message": f"ลบไฟล์ '{filename}' ออกจากแฟ้ม '{dossier_id}' เรียบร้อยแล้ว",
            "deleted_by": x_user or "admin",
            **res
        }
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        logger.error(f"Failed to delete dossier file {filename} in {dossier_id}: {e}")
        raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการลบไฟล์: {str(e)}")


@app.post("/api/nas-bot/dossiers/upload")
async def upload_to_dossier_vault(
    notes: Optional[str] = Form(None),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
    files: List[UploadFile] = File(...)
) -> Dict[str, Any]:
    """
    Upload endpoint for Drag & Drop in Arrest Vault UI.
    Performs AI OCR to extract suspect names, ID card, and clean dossier ID (ชื่อ_สกุล_ปี).
    """
    from services.ai_ocr import extract_document_data
    username = x_user or "admin"
    created_dossiers = []
    all_extracted_suspects = []
    behavior = None

    try:
        for file_obj in files:
            content = await file_obj.read()
            filename = file_obj.filename or "file.bin"
            ext = os.path.splitext(filename)[1].lower()

            # 1. Smart Photo Auto-Routing for Image Files
            # Directly match portrait photos into existing dossiers by 13-digit CID, TR.14 filename, or suspect name
            if ext in {".jpg", ".jpeg", ".png", ".webp"}:
                routed = dossier_mgr.route_photo_to_dossier(filename, content)
                if routed and routed.get("dossier_id"):
                    matched_id = routed["dossier_id"]
                    if matched_id not in created_dossiers:
                        created_dossiers.append(matched_id)
                    logger.info(f"Smart auto-routed photo '{filename}' into existing dossier: {matched_id}")
                    continue

                # Check if filename has 13-digit CID that matches an existing dossier
                cids_in_fn = re.findall(r'\d{13}', filename)
                if cids_in_fn:
                    cid_dossier_id = dossier_mgr.find_dossier_id(id_card=cids_in_fn[0])
                    if cid_dossier_id:
                        # Save into matched dossier Personal directory
                        p_dir = os.path.join(dossier_mgr.dossiers_dir, cid_dossier_id, "Personal")
                        os.makedirs(p_dir, exist_ok=True)
                        with open(os.path.join(p_dir, filename), "wb") as f_out:
                            f_out.write(content)
                        
                        # Update photo url & path in profile
                        d_prof = dossier_mgr.get_dossier_detail(cid_dossier_id) or {}
                        d_prof["photo_path"] = filename
                        d_prof["photo_url"] = f"/api/nas-bot/dossiers/{cid_dossier_id}/download/{filename}"
                        d_prof["updated_at"] = datetime.datetime.now().isoformat()
                        pfiles = d_prof.setdefault("personal_files", [])
                        if not any(pf.get("filename") == filename for pf in pfiles):
                            pfiles.insert(0, {
                                "filename": filename,
                                "size_bytes": len(content),
                                "saved_at": datetime.datetime.now().isoformat(),
                                "category": "Mugshot"
                            })
                        prof_path = os.path.join(dossier_mgr.dossiers_dir, cid_dossier_id, "profile.json")
                        with open(prof_path, "w", encoding="utf-8") as f_prof:
                            json.dump(d_prof, f_prof, ensure_ascii=False, indent=2)
                        
                        dossier_mgr.rebuild_index()
                        if cid_dossier_id not in created_dossiers:
                            created_dossiers.append(cid_dossier_id)
                        logger.info(f"Matched photo '{filename}' by CID {cids_in_fn[0]} into dossier {cid_dossier_id}")
                        continue

            try:
                extracted = extract_document_data(content, filename)
            except Exception as ocr_err:
                logger.error(f"OCR extraction error for '{filename}': {ocr_err}", exc_info=True)
                extracted = {"suspects": [], "behavior": None}

            suspects = extracted.get("suspects", [])
            behavior = extracted.get("behavior") or behavior

            if not suspects:
                # Fallback for general file with custom name or default
                cids_in_fn = re.findall(r'\d{13}', filename)
                extracted_cid = cids_in_fn[0] if cids_in_fn else None
                clean_base_name = re.sub(r'^\d{13}[_\-\s]*', '', os.path.splitext(filename)[0]).strip()
                custom_name = notes or clean_base_name or os.path.splitext(filename)[0]
                custom_name = custom_name[:40].strip()
                suspects = [{
                    "suspect_name": custom_name,
                    "id_card": extracted_cid,
                    "phone_number": None,
                    "role_tag": "ผู้ต้องหา",
                    "area_tag": None,
                    "address": None
                }]

            all_extracted_suspects.extend(suspects)

            # File items (including OCR text for AutoLink scanning)
            dossier_files = [{"filename": filename, "content": content}]
            ocr_raw = extracted.get("ocr_raw_text")
            if ocr_raw and len(ocr_raw.strip()) >= 20:
                dossier_files.append({
                    "filename": f"{os.path.splitext(filename)[0]}_ocr.txt",
                    "content": ocr_raw.encode("utf-8")
                })

            for s in suspects:
                s_name = s.get("suspect_name") or "ไม่ระบุชื่อ"
                if len(s_name) > 40:
                    s_name = s_name[:40].strip()

                dossier_profile = dossier_mgr.upsert_dossier(
                    suspect_name=s_name,
                    id_card=s.get("id_card"),
                    phone_number=s.get("phone_number"),
                    role_tag=s.get("role_tag") or "ผู้ต้องหา",
                    area_tag=s.get("area_tag"),
                    address=s.get("address"),
                    age=s.get("age"),
                    category="drug" if "ยา" in (behavior or "") else "general",
                    behavior=behavior,
                    notes=notes or f"อัปโหลดเอกสารจับกุม {filename}",
                    officer_username=username,
                    platform="web_vault",
                    files=dossier_files,
                    family_info=s.get("family_info")
                )
                d_id = dossier_profile.get("dossier_id")
                if d_id and d_id not in created_dossiers:
                    created_dossiers.append(d_id)

        case_id = os.path.splitext(files[0].filename or "case")[0] if files else "Vault_Upload"

        # Auto Cross-Link & Detect Relations across batch and existing vault dossiers
        if created_dossiers and all_extracted_suspects:
            try:
                auto_detect_and_link_relations(
                    dossier_ids=created_dossiers,
                    case_id=case_id,
                    text_context=f"{notes or ''} {behavior or ''}",
                    suspects=all_extracted_suspects,
                    source_files=[f.filename for f in files if f.filename]
                )
            except Exception as link_err:
                logger.warning(f"Auto-link relations warning: {link_err}")

        # Background sync to Chat Service so Vault Uploads appear on Heatmap
        try:
            has_crime_report = any(kw in (notes or behavior or "") for kw in ["จับกุม", "ตรวจยึด", "ของกลาง", "ยาบ้า", "ไอซ์", "อาวุธ", "ยาเสพติด"])
            if has_crime_report or (behavior and len(behavior) > 10):
                sync_notes = notes or behavior or f"อัปโหลดแฟ้มประวัติ {case_id}"
                # Use the 'extracted' dict from the loop which contains district/subdistrict for location parsing
                asyncio.create_task(sync_to_chat_service(
                    case_id=case_id,
                    officer_username=username,
                    notes=sync_notes,
                    extracted=extracted if 'extracted' in locals() else {},
                    lat=None,
                    lon=None,
                    suspects_list=all_extracted_suspects
                ))
        except Exception as e:
            logger.error(f"Background sync to chat service failed: {e}", exc_info=True)

        return {
            "status": "success",
            "message": f"บันทึกและสกัดเอกสารเข้าถังข้อมูลเรียบร้อยแล้ว ({len(created_dossiers)} แฟ้ม)",
            "dossier_ids": created_dossiers
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload to dossier vault failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=f"เกิดข้อผิดพลาดในการประมวลผลไฟล์เข้าถังข้อมูล: {str(e)}"
        )



# ---------------------------------------------------------
# Modern i2 Link Analysis Graph & CDR Telecom Endpoints
# ---------------------------------------------------------

@app.get("/api/nas-bot/graph/edge-records")
def get_edge_records(
    edge_id: Optional[str] = Query(None),
    node_id: Optional[str] = Query(None),
    from_id: Optional[str] = Query(None),
    to_id: Optional[str] = Query(None),
    record_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Retrieve full itemized communication records (Call logs / SMS) or Financial transactions (Bank Statement / Slips)
    for a specific connection edge or all transactions associated with a specific node.
    """
    require_i2_role(x_user, x_role)

    # 1. Fetch graph data
    g_data = graph_engine.generate_graph()
    nodes_map = {n.get("id"): n for n in g_data.get("nodes", [])}
    records = []

    # If querying by node_id (Bank Account node or Person node)
    if node_id:
        target_node = nodes_map.get(node_id, {})
        connected_edges = [
            e for e in g_data.get("edges", [])
            if e.get("from") == node_id or e.get("to") == node_id
        ]
        
        # Collect from all connected edges
        for ce in connected_edges:
            ce_type = ce.get("type", "")
            ce_prov = ce.get("provenance", "")
            ce_from = nodes_map.get(ce.get("from"), {})
            ce_to = nodes_map.get(ce.get("to"), {})
            
            if "bank_transfer" in ce_type or ce_prov == "financial_record":
                for t in ce.get("transactions", []):
                    item = {
                        "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                        "date": t.get("date"),
                        "time": t.get("time"),
                        "type": "bank_transfer",
                        "direction": "outflow" if ce.get("from") == node_id else "inflow",
                        "amount": t.get("amount", 0.0),
                        "balance": t.get("balance"),
                        "channel": t.get("channel", "สลิปโอนเงิน"),
                        "description": t.get("description", "สลิปหลักฐานการโอนเงิน"),
                        "sender_name": t.get("sender_name") or ce_from.get("label"),
                        "counterparty_name": t.get("counterparty_name") or ce_to.get("account_holder") or ce_to.get("label"),
                        "counterparty_account": t.get("counterparty_account") or ce_to.get("account_number"),
                        "counterparty_bank": t.get("counterparty_bank") or ce_to.get("bank_name"),
                        "slip_file": t.get("slip_file") or ce.get("slip_file") or ce_to.get("slip_file") or "",
                        "slip_url": t.get("slip_url") or ce.get("slip_url") or ce_to.get("slip_url") or "",
                    }
                    records.append(item)
            elif "money_transfer" in ce_type or ce_prov == "statement":
                for t in ce.get("transactions", []):
                    t_cp = t.get("counterparty", {}) if isinstance(t.get("counterparty"), dict) else {}
                    is_in = t.get("direction") == "IN" or t.get("type") == "inflow"
                    item = {
                        "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                        "date": t.get("date"),
                        "time": t.get("time"),
                        "type": "money_transfer",
                        "direction": "inflow" if is_in else "outflow",
                        "amount": t.get("amount", 0.0),
                        "balance": t.get("balance"),
                        "channel": t.get("channel", "Online"),
                        "description": t.get("description", "-"),
                        "counterparty_name": t.get("counterparty_name") or t_cp.get("name") or (ce_from.get("label") if is_in else ce_to.get("label")),
                        "counterparty_account": t.get("counterparty_account") or t_cp.get("account_mask") or ce_to.get("account_number"),
                        "counterparty_bank": t.get("counterparty_bank") or t_cp.get("bank") or ce_to.get("bank_name"),
                    }
                    records.append(item)
            elif "owns_bank_account" in ce_type:
                bank_n = ce_to if ce.get("from") == node_id else ce_from
                for t in bank_n.get("transactions_sample", []):
                    t_cp = t.get("counterparty", {}) if isinstance(t.get("counterparty"), dict) else {}
                    is_in = t.get("direction") == "IN" or t.get("type") == "inflow" or t.get("type") == "IN"
                    item = {
                        "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                        "date": t.get("date"),
                        "time": t.get("time"),
                        "type": "money_transfer",
                        "direction": "inflow" if is_in else "outflow",
                        "amount": t.get("amount", 0.0),
                        "balance": t.get("balance"),
                        "channel": t.get("channel", "Online"),
                        "description": t.get("description", "-"),
                        "counterparty_name": t.get("counterparty_name") or t_cp.get("name") or bank_n.get("label"),
                        "counterparty_account": t.get("counterparty_account") or t_cp.get("account_mask") or bank_n.get("account_number"),
                        "counterparty_bank": t.get("counterparty_bank") or t_cp.get("bank") or bank_n.get("bank_name"),
                    }
                    records.append(item)

        # If node is a bank_account itself and records is empty, pull transactions_sample
        if (target_node.get("group") == "bank_account" or target_node.get("type") == "bank_account") and not records:
            for t in target_node.get("transactions_sample", []):
                t_cp = t.get("counterparty", {}) if isinstance(t.get("counterparty"), dict) else {}
                is_in = t.get("direction") == "IN" or t.get("type") == "inflow" or t.get("type") == "IN"
                item = {
                    "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                    "date": t.get("date"),
                    "time": t.get("time"),
                    "type": "money_transfer",
                    "direction": "inflow" if is_in else "outflow",
                    "amount": t.get("amount", 0.0),
                    "balance": t.get("balance"),
                    "channel": t.get("channel", "Online"),
                    "description": t.get("description", "-"),
                    "counterparty_name": t.get("counterparty_name") or t_cp.get("name") or target_node.get("label"),
                    "counterparty_account": t.get("counterparty_account") or t_cp.get("account_mask") or target_node.get("account_number"),
                    "counterparty_bank": t.get("counterparty_bank") or t_cp.get("bank") or target_node.get("bank_name"),
                    "slip_file": t.get("slip_file", ""),
                    "slip_url": t.get("slip_url", ""),
                }
                records.append(item)

        # Deduplicate records
        seen_keys = set()
        unique_records = []
        for r in records:
            k = f"{r.get('datetime')}_{r.get('amount')}_{r.get('counterparty_name')}_{r.get('direction')}"
            if k not in seen_keys:
                seen_keys.add(k)
                unique_records.append(r)
        records = unique_records

        if q:
            q_lower = q.lower()
            records = [r for r in records if any(q_lower in str(v).lower() for v in r.values() if v is not None)]
        if direction:
            dir_lower = direction.lower()
            records = [r for r in records if dir_lower in str(r.get("direction", "")).lower()]

        return {
            "status": "success",
            "node_id": node_id,
            "node_label": target_node.get("label"),
            "records": records,
            "total_count": len(records),
            "summary": {
                "total_inflow": sum(float(str(r.get("amount", 0)).replace(",", "")) for r in records if r.get("direction") == "inflow" and str(r.get("amount", "")).replace(",", "").replace(".", "").isdigit()),
                "total_outflow": sum(float(str(r.get("amount", 0)).replace(",", "")) for r in records if r.get("direction") == "outflow" and str(r.get("amount", "")).replace(",", "").replace(".", "").isdigit()),
                "total_transfers": len(records)
            }
        }

    target_edge = None
    for e in g_data.get("edges", []):
        if edge_id and e.get("id") == edge_id:
            target_edge = e
            break
        if from_id and to_id:
            e_from, e_to = e.get("from"), e.get("to")
            if (e_from == from_id and e_to == to_id) or (e_from == to_id and e_to == from_id):
                target_edge = e
                break

    if not target_edge:
        return {
            "status": "success",
            "edge": None,
            "records": [],
            "total_count": 0,
            "summary": {}
        }

    e_type = target_edge.get("type", "")
    node_from = nodes_map.get(target_edge.get("from"), {})
    node_to = nodes_map.get(target_edge.get("to"), {})

    phone_from = node_from.get("phone_number") or node_from.get("phone") or node_from.get("label", "")
    phone_to = node_to.get("phone_number") or node_to.get("phone") or node_to.get("label", "")

    clean_from = re.sub(r"\D", "", str(phone_from))
    clean_to = re.sub(r"\D", "", str(phone_to))

    if "call" in e_type or target_edge.get("provenance") == "cdr":
        raw_records = target_edge.get("records", [])

        # If empty on edge, dynamically scan stored CDR sessions
        if not raw_records and os.path.exists(cdr_parser.storage_dir):
            for fn in os.listdir(cdr_parser.storage_dir):
                if fn.endswith(".json") and fn != "cdr_index.json":
                    try:
                        with open(os.path.join(cdr_parser.storage_dir, fn), "r", encoding="utf-8") as f_s:
                            s_data = json.load(f_s)
                        for r in s_data.get("records", []):
                            r_c = re.sub(r"\D", "", str(r.get("caller") or ""))
                            r_d = re.sub(r"\D", "", str(r.get("callee") or ""))
                            if (r_c == clean_from and r_d == clean_to) or (r_c == clean_to and r_d == clean_from):
                                raw_records.append(r)
                    except Exception:
                        continue

        for r in raw_records:
            item = {
                "datetime": r.get("datetime") or "-",
                "type": "call",
                "direction": r.get("call_type") or ("incoming" if str(r.get("caller") or "").strip() != clean_from else "outgoing"),
                "caller": r.get("caller"),
                "callee": r.get("callee"),
                "duration_sec": r.get("duration_sec", 0),
                "channel": r.get("channel", "Cellular"),
                "cell_site": r.get("cell_site", "-"),
                "contact_name": target_edge.get("contact_name", "")
            }
            records.append(item)

    elif "bank_transfer" in e_type or target_edge.get("provenance") == "financial_record":
        raw_txs = list(target_edge.get("transactions", []))
        if not raw_txs:
            txn_dt = target_edge.get("transaction_datetime") or target_edge.get("date") or target_edge.get("recorded_at") or "-"
            amt = target_edge.get("amount") or node_to.get("amount") or 0.0
            slip_f = target_edge.get("slip_file") or node_to.get("slip_file") or ""
            slip_u = target_edge.get("slip_url") or node_to.get("slip_url") or ""
            raw_txs = [{
                "datetime": txn_dt,
                "date": txn_dt.split(" ")[0] if " " in str(txn_dt) else txn_dt,
                "time": txn_dt.split(" ")[-1] if " " in str(txn_dt) else "",
                "type": "bank_transfer",
                "direction": "outflow",
                "amount": amt,
                "balance": None,
                "channel": "สลิปโอนเงิน",
                "description": target_edge.get("label") or node_to.get("notes") or "สลิปหลักฐานการโอนเงิน",
                "sender_name": target_edge.get("sender_name") or node_from.get("label") or "",
                "counterparty_name": node_to.get("account_holder") or node_to.get("label") or "",
                "counterparty_account": node_to.get("account_number") or "",
                "counterparty_bank": node_to.get("bank_name") or "",
                "slip_file": slip_f,
                "slip_url": slip_u,
            }]
        for t in raw_txs:
            item = {
                "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                "date": t.get("date"),
                "time": t.get("time"),
                "type": "bank_transfer",
                "direction": t.get("direction") or "outflow",
                "amount": t.get("amount", 0.0),
                "balance": t.get("balance"),
                "channel": t.get("channel", "สลิปโอนเงิน"),
                "description": t.get("description", "สลิปหลักฐานการโอนเงิน"),
                "sender_name": t.get("sender_name") or target_edge.get("sender_name") or node_from.get("label"),
                "counterparty_name": t.get("counterparty_name") or node_to.get("account_holder") or node_to.get("label"),
                "counterparty_account": t.get("counterparty_account") or node_to.get("account_number"),
                "counterparty_bank": t.get("counterparty_bank") or node_to.get("bank_name"),
                "slip_file": t.get("slip_file") or target_edge.get("slip_file") or node_to.get("slip_file") or "",
                "slip_url": t.get("slip_url") or target_edge.get("slip_url") or node_to.get("slip_url") or "",
            }
            records.append(item)

    elif "money_transfer" in e_type or target_edge.get("provenance") == "statement":
        raw_txs = list(target_edge.get("transactions", []))

        # If empty on edge, dynamically scan stored Statement sessions
        if not raw_txs and statement_parser and os.path.exists(statement_parser.storage_dir):
            acc_num = node_from.get("account_number") or node_from.get("label", "")
            cp_name = node_to.get("name") or node_to.get("label", "")
            for fn in os.listdir(statement_parser.storage_dir):
                if fn.endswith(".json") and fn != "statement_index.json":
                    try:
                        with open(os.path.join(statement_parser.storage_dir, fn), "r", encoding="utf-8") as f_s:
                            s_data = json.load(f_s)
                        for t in s_data.get("transactions", []):
                            t_cp = t.get("counterparty", {}) if isinstance(t.get("counterparty"), dict) else {}
                            t_cp_name = t_cp.get("name") or t.get("counterparty_name") or ""
                            t_desc = t.get("description") or ""
                            if (cp_name and (cp_name in t_cp_name or cp_name in t_desc)) or (acc_num and acc_num in t_desc):
                                raw_txs.append(t)
                    except Exception:
                        continue

        for t in raw_txs:
            t_cp = t.get("counterparty", {}) if isinstance(t.get("counterparty"), dict) else {}
            item = {
                "datetime": t.get("datetime") or f"{t.get('date', '')} {t.get('time', '')}".strip() or "-",
                "date": t.get("date"),
                "time": t.get("time"),
                "type": "money_transfer",
                "direction": t.get("direction") or t.get("type", "inflow"),
                "amount": t.get("amount", 0.0),
                "balance": t.get("balance"),
                "channel": t.get("channel", "Online"),
                "description": t.get("description", "-"),
                "counterparty_name": t.get("counterparty_name") or t_cp.get("name") or node_to.get("label"),
                "counterparty_account": t.get("counterparty_account") or t_cp.get("account_mask") or node_to.get("account_number"),
                "counterparty_bank": t.get("counterparty_bank") or t_cp.get("bank") or node_to.get("bank_name"),
            }
            records.append(item)

    # Filter by search keyword if provided
    if q:
        q_lower = q.lower()
        records = [
            r for r in records
            if any(q_lower in str(v).lower() for v in r.values() if v is not None)
        ]

    # Filter by direction if provided
    if direction:
        dir_lower = direction.lower()
        records = [
            r for r in records
            if dir_lower in str(r.get("direction", "")).lower()
        ]

    return {
        "status": "success",
        "edge_id": target_edge.get("id"),
        "edge_type": e_type,
        "edge_label": target_edge.get("label"),
        "from": target_edge.get("from"),
        "to": target_edge.get("to"),
        "records": records,
        "total_count": len(records),
        "summary": {
            "total_calls": target_edge.get("call_count", len(records) if "call" in e_type else 0),
            "total_duration_sec": target_edge.get("duration_sec", 0),
            "total_amount": target_edge.get("total_amount", 0.0),
            "total_transfers": target_edge.get("total_count", len(records) if "money" in e_type else 0)
        }
    }


@app.get("/api/nas-bot/graph")
def get_link_graph(
    request: Request,
    response: Response,
    focus: Optional[str] = Query(None, description="Focus on specific dossier_id"),
    depth: Optional[int] = Query(None, ge=0, le=10, description="Hop depth; omit for full component"),
    import_id: Optional[str] = Query(None, description="Filter to specific i2 import_id for isolated chart view"),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Any:
    """Return the shared evidence graph only to officer/admin roles."""

    require_i2_role(x_user, x_role)
    result = graph_engine.generate_graph(focus_dossier_id=focus, depth=depth, import_id=import_id)
    fingerprint = result.get("fingerprint")
    if fingerprint:
        response.headers["ETag"] = f'"{fingerprint}"'
        response.headers["Cache-Control"] = "private, no-cache"
        client_etag = request.headers.get("if-none-match")
        if client_etag and client_etag.strip('"') == fingerprint:
            return Response(status_code=304)
    return result


class PruneAutoLinksPayload(BaseModel):
    case_id: Optional[str] = None
    dry_run: bool = False


@app.post("/api/nas-bot/graph/prune-auto-links")
def prune_graph_auto_links(
    payload: Optional[PruneAutoLinksPayload] = None,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Prune generic batch auto-links and sanitize bloated labels across all dossiers."""
    require_i2_role(x_user, x_role)
    cid = payload.case_id if payload else None
    dry = payload.dry_run if payload else False
    result = dossier_mgr.prune_auto_generated_links(case_id=cid, dry_run=dry)
    return result


class NodeUpdatePayload(BaseModel):
    label: Optional[str] = None
    sublabel: Optional[str] = None
    phone: Optional[str] = None
    id_card: Optional[str] = None
    photo_url: Optional[str] = None


@app.get("/api/nas-bot/graph/node-photos/{filename}")
def get_graph_node_photo(filename: str):
    """Serve uploaded graph node photos for standalone/i2 nodes."""
    clean_fn = urllib.parse.unquote(filename)
    safe_fn = os.path.basename(clean_fn)
    photo_path = os.path.join(nas_manager.root_path, "media", "node_photos", safe_fn)
    if not os.path.exists(photo_path):
        raise HTTPException(status_code=404, detail="Photo not found")
    ext = safe_fn.split(".")[-1].lower() if "." in safe_fn else "jpg"
    mt = "image/png" if ext == "png" else ("image/webp" if ext == "webp" else "image/jpeg")
    return FileResponse(photo_path, media_type=mt, filename=safe_fn)


@app.post("/api/nas-bot/graph/nodes/{node_id}")
def update_graph_node(
    node_id: str,
    payload: NodeUpdatePayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Update node metadata in graph and synchronize back to underlying Dossier profile.
    If the new label matches an existing dossier name, informs the caller about the potential merge.
    """
    # ── i2 Node Fast-Path ──────────────────────────────────────────────────────
    # i2 nodes (id starts with 'i2_') are NOT dossier records. They come from
    # IBM i2 .anb charts and the i2 chart is the source of truth. Just persist
    # the user's label/photo/phone override in i2_graph_store and return immediately
    # without any dossier lookup or auto-merge logic.
    if node_id.startswith("i2_"):
        override: Dict[str, Any] = {}
        if payload.label:
            override["label"] = payload.label
        if payload.sublabel is not None:
            override["sublabel"] = payload.sublabel
        if payload.phone is not None:
            override["phone"] = payload.phone
        if payload.id_card is not None:
            override["id_card"] = payload.id_card

        saved_photo_url_i2 = None
        if payload.photo_url and payload.photo_url.startswith("data:image/"):
            try:
                header, b64_data = payload.photo_url.split(",", 1)
                ext = "jpg"
                if "png" in header:
                    ext = "png"
                elif "webp" in header:
                    ext = "webp"
                img_bytes = base64.b64decode(b64_data)
                ts = int(time.time())
                media_dir = os.path.join(nas_manager.root_path, "media", "node_photos")
                os.makedirs(media_dir, exist_ok=True)
                safe_name = re.sub(r"[^\w\-]", "_", node_id)
                fname = f"{safe_name}_{ts}.{ext}"
                with open(os.path.join(media_dir, fname), "wb") as f_out:
                    f_out.write(img_bytes)
                saved_photo_url_i2 = f"/api/nas-bot/graph/node-photos/{fname}"
            except Exception as e:
                logger.error("Failed to save i2 node photo for %s: %s", node_id, e)
                saved_photo_url_i2 = payload.photo_url
        elif payload.photo_url:
            saved_photo_url_i2 = payload.photo_url

        if saved_photo_url_i2:
            override["photo_url"] = saved_photo_url_i2

        if override:
            try:
                i2_graph_store.update_node_override(
                    node_id=node_id,
                    payload=override,
                    actor=x_user or "system"
                )
            except Exception as gs_err:
                logger.warning("Failed to record i2_graph_store node override for %s: %s", node_id, gs_err)

        graph_engine.invalidate_cache()
        return {
            "status": "success",
            "node_id": node_id,
            "photo_url": saved_photo_url_i2 or payload.photo_url
        }
    # ── End i2 Node Fast-Path ──────────────────────────────────────────────────

    dossier_id = node_id.replace("person_", "") if node_id.startswith("person_") else node_id
    existing_dossier = dossier_mgr.get_dossier_detail(dossier_id)


    # Handle photo save if provided
    saved_photo_url = None
    if payload.photo_url:
        if payload.photo_url.startswith("data:image/"):
            try:
                header, b64_data = payload.photo_url.split(",", 1)
                ext = "jpg"
                if "png" in header:
                    ext = "png"
                elif "webp" in header:
                    ext = "webp"
                img_bytes = base64.b64decode(b64_data)
                ts = int(time.time())

                if existing_dossier:
                    fname = f"photo_{ts}.{ext}"
                    p_dir = os.path.join(dossier_mgr.dossiers_dir, dossier_id, "Personal")
                    os.makedirs(p_dir, exist_ok=True)
                    fpath = os.path.join(p_dir, fname)
                    with open(fpath, "wb") as f_out:
                        f_out.write(img_bytes)

                    saved_photo_url = f"/api/nas-bot/dossiers/{dossier_id}/download/{fname}"

                    profile_json_path = os.path.join(dossier_mgr.dossiers_dir, dossier_id, "profile.json")
                    if os.path.exists(profile_json_path):
                        try:
                            with open(profile_json_path, "r", encoding="utf-8") as pf_f:
                                pj_data = json.load(pf_f)
                            pfiles = list(pj_data.get("personal_files") or [])
                            pfiles.insert(0, {
                                "filename": fname,
                                "category": "Mugshot",
                                "is_image": True,
                                "size_bytes": len(img_bytes),
                                "saved_at": datetime.datetime.now().isoformat()
                            })
                            pj_data["personal_files"] = pfiles
                            pj_data["photo_url"] = saved_photo_url
                            pj_data["updated_at"] = datetime.datetime.now().isoformat()
                            with open(profile_json_path, "w", encoding="utf-8") as pf_f:
                                json.dump(pj_data, pf_f, ensure_ascii=False, indent=2)
                        except Exception as pf_err:
                            logger.error("Failed to update profile.json for personal_files: %s", pf_err)

                    dossier_mgr.update_dossier_profile(dossier_id, {"photo_url": saved_photo_url}, actor=x_user or "system")
                else:
                    media_dir = os.path.join(nas_manager.root_path, "media", "node_photos")
                    os.makedirs(media_dir, exist_ok=True)
                    safe_name = re.sub(r'[^\w\-]', '_', node_id)
                    fname = f"{safe_name}_{ts}.{ext}"
                    with open(os.path.join(media_dir, fname), "wb") as f_out:
                        f_out.write(img_bytes)
                    saved_photo_url = f"/api/nas-bot/graph/node-photos/{fname}"
            except Exception as e:
                logger.error("Failed to decode and save photo for %s: %s", node_id, e)
                saved_photo_url = payload.photo_url
        else:
            saved_photo_url = payload.photo_url
            if existing_dossier:
                dossier_mgr.update_dossier_profile(dossier_id, {"photo_url": saved_photo_url}, actor=x_user or "system")

        if saved_photo_url:
            try:
                i2_graph_store.update_node_override(
                    node_id=node_id,
                    payload={"photo_url": saved_photo_url},
                    actor=x_user or "system"
                )
            except Exception as gs_err:
                logger.warning("Failed to record i2_graph_store node override: %s", gs_err)

    matched_target_id = None
    clean_id = re.sub(r"\D", "", payload.id_card) if payload.id_card else ""
    norm_label = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง)\s*', '', payload.label).strip() if payload.label else ""

    for d in dossier_mgr.get_all_dossiers():
        other_id = d.get("dossier_id")
        if other_id and other_id != dossier_id:
            other_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง)\s*', '', d.get("suspect_name") or "").strip()
            other_card = re.sub(r"\D", "", str(d.get("id_card") or ""))
            match_name = norm_label and (norm_label == other_name or payload.label == d.get("suspect_name"))
            match_card = clean_id and len(clean_id) == 13 and clean_id == other_card
            if match_name or match_card:
                matched_target_id = other_id
                break

    if existing_dossier:
        updates: Dict[str, Any] = {}
        if payload.label:
            updates["suspect_name"] = payload.label
        if payload.phone is not None:
            updates["phone_number"] = payload.phone
        if payload.id_card is not None:
            updates["id_card"] = payload.id_card
        if updates:
            dossier_mgr.update_dossier_profile(dossier_id, updates, actor=x_user or "system")

    # 100% Immediate Auto-Merge Policy (No confirmation needed)
    if matched_target_id:
        logger.info(f"100% Auto-merge policy: Merging '{dossier_id}' into matched target '{matched_target_id}'")
        res = dossier_mgr.merge_dossiers(dossier_id, matched_target_id, force=True)
        t_detail = dossier_mgr.get_dossier_detail(matched_target_id) or {}
        t_name = t_detail.get("suspect_name") or matched_target_id
        fc = len((res or {}).get("personal_files") or [])
        notify_merge_to_telegram(dossier_id, matched_target_id, t_name, fc)
        graph_engine.invalidate_cache()
        return {
            "status": "merged",
            "node_id": f"person_{matched_target_id}",
            "dossier_id": matched_target_id,
            "merged_into": matched_target_id,
            "photo_url": saved_photo_url or payload.photo_url
        }

    graph_engine.invalidate_cache()
    return {
        "status": "success",
        "node_id": node_id,
        "dossier_id": dossier_id,
        "photo_url": saved_photo_url or payload.photo_url
    }



@app.post("/api/nas-bot/graph/import-cdr")
async def import_cdr_file(
    file: UploadFile = File(...),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Upload and parse Call Detail Records (CDR) CSV or Excel file,
    correlate with suspect dossiers, and generate link graph call edges.
    """
    require_i2_role(x_user, x_role)
    try:
        file_bytes = await file.read()
        res = cdr_parser.parse_cdr_file(
            file_bytes,
            file.filename,
            dossier_manager=dossier_mgr,
            operator=x_user or "admin"
        )
        graph_engine.invalidate_cache()
        return {
            "status": "success",
            "message": f"นำเข้าประวัติการโทรจากไฟล์ '{file.filename}' เรียบร้อยแล้ว",
            "session": res
        }
    except Exception:
        logger.exception("Failed to import CDR file for actor=%s", x_user)
        raise HTTPException(status_code=400, detail="ไฟล์ประวัติการโทรไม่ถูกต้องหรืออ่านไม่ได้")


@app.get("/api/nas-bot/cdr/sessions")
def get_cdr_sessions(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    List all uploaded CDR analysis sessions.
    """
    require_i2_role(x_user, x_role)
    sessions = cdr_parser.get_all_cdr_sessions()
    return {"status": "success", "sessions": sessions}


@app.get("/api/nas-bot/cdr/sessions/{session_id}")
def get_cdr_session_detail(
    session_id: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Get detailed records and call pairs for a specific CDR session.
    """
    require_i2_role(x_user, x_role)
    session = cdr_parser.get_cdr_session_detail(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="ไม่พบบันทึกประวัติการโทรที่ระบุ")
    return {"status": "success", "session": session}


@app.delete("/api/nas-bot/cdr/sessions/{session_id}")
def delete_cdr_session(
    session_id: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Delete a specific CDR session.
    """
    require_i2_role(x_user, x_role)
    ok = cdr_parser.delete_cdr_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบประวัติการโทรที่ต้องการลบ")
    return {"status": "success", "message": f"ลบประวัติการโทร {session_id} เรียบร้อยแล้ว"}


@app.delete("/api/nas-bot/cdr/clear-all")
def clear_all_cdr_sessions(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Clear all stored CDR sessions.
    """
    require_i2_role(x_user, x_role)
    count = cdr_parser.clear_all_cdr_sessions()
    return {"status": "success", "message": f"ล้างประวัติการโทรทั้งหมดเรียบร้อยแล้ว ({count} ไฟล์)"}


# ---------------------------------------------------------
# Bank Statement Financial Intelligence REST Endpoints
# ---------------------------------------------------------

@app.post("/api/nas-bot/statements/import")
async def import_statement_file(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Upload and parse Bank Statement (PDF) with optional decryption password.
    Extracts account info, transaction ledger, counterparties, and correlates with i2 Graph.
    """
    require_i2_role(x_user, x_role)
    try:
        file_bytes = await file.read()
        
        # Collect candidate passwords from existing dossiers (DOBs, ID card numbers)
        candidate_passwords = []
        for d in dossier_mgr.get_all_dossiers():
            id_c = d.get("id_card")
            if id_c:
                clean_id = re.sub(r'\D', '', str(id_c))
                if clean_id: candidate_passwords.append(clean_id[-8:])
            age = d.get("age")
            if age: candidate_passwords.append(str(age))

        res = statement_parser.parse_statement_file(
            file_bytes=file_bytes,
            filename=file.filename or "statement.pdf",
            password=password,
            candidate_passwords=candidate_passwords,
            operator=x_user or "admin"
        )
        return {
            "status": "success",
            "message": f"นำเข้าและวิเคราะห์ Statement จากไฟล์ '{file.filename}' เรียบร้อยแล้ว",
            "session": res
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Failed to parse statement: %s", exc)
        raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการประมวลผลไฟล์ Statement: {str(exc)}")


@app.get("/api/nas-bot/statements/sessions")
def get_statement_sessions(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    List all uploaded Bank Statement analysis sessions.
    """
    require_i2_role(x_user, x_role)
    sessions = statement_parser.get_all_sessions()
    return {"status": "success", "sessions": sessions}


@app.get("/api/nas-bot/statements/sessions/{session_id}")
def get_statement_session_detail(
    session_id: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Get detailed records, ledger, counterparties, and suspicious flags for a Statement session.
    """
    require_i2_role(x_user, x_role)
    session = statement_parser.get_session_detail(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูล Statement ที่ระบุ")
    return {"status": "success", "session": session}


@app.delete("/api/nas-bot/statements/sessions/{session_id}")
def delete_statement_session(
    session_id: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Delete a specific Statement session and remove it from i2 financial flow.
    """
    require_i2_role(x_user, x_role)
    ok = statement_parser.delete_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ Statement ที่ต้องการลบ")
    return {"status": "success", "message": f"ลบรายการ Statement {session_id} เรียบร้อยแล้ว"}


@app.delete("/api/nas-bot/statements/clear-all")
def clear_all_statement_sessions(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """
    Clear all stored Statement sessions.
    """
    require_i2_role(x_user, x_role)
    count = statement_parser.clear_all_sessions()
    return {"status": "success", "message": f"ล้างข้อมูล Statement ทั้งหมดเรียบร้อยแล้ว ({count} ไฟล์)"}


# ---------------------------------------------------------
# Central Vehicle Intelligence & Ownership REST Endpoints
# ---------------------------------------------------------

@app.get("/api/nas-bot/vehicles")
def api_list_vehicles(
    query: Optional[str] = Query(None),
    limit: int = Query(50),
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """List or search all tracked vehicles."""
    vehicles = vehicle_mgr.search_vehicles(query=query, limit=limit)
    return {"status": "success", "total": len(vehicles), "vehicles": vehicles}


@app.get("/api/nas-bot/vehicles/{plate}")
def api_get_vehicle(
    plate: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """Get single vehicle detail by plate."""
    v = vehicle_mgr.find_vehicle(plate)
    if not v:
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลยานพาหนะในระบบ")
    return {"status": "success", "vehicle": v}


@app.post("/api/nas-bot/vehicles")
def api_upsert_vehicle(
    payload: Dict[str, Any],
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """Create or edit a vehicle record."""
    plate = payload.get("plate")
    if not plate:
        raise HTTPException(status_code=400, detail="กรุณาระบุเลขทะเบียนรถ")
    rec = vehicle_mgr.upsert_vehicle(
        plate=plate,
        province=payload.get("province"),
        vehicle_type=payload.get("type"),
        brand=payload.get("brand"),
        model=payload.get("model"),
        color=payload.get("color"),
        chassis_no=payload.get("chassis_no"),
        engine_no=payload.get("engine_no"),
        owner_name=payload.get("owner_name"),
        owner_id=payload.get("owner_id"),
        dossier_id=payload.get("dossier_id"),
        ownership_status=payload.get("ownership_status", "verified"),
        notes=payload.get("notes")
    )
    return {"status": "success", "vehicle": rec}


@app.post("/api/nas-bot/vehicles/bind")
def api_bind_vehicle_to_dossier(
    payload: Dict[str, Any],
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role")
) -> Dict[str, Any]:
    """Bind a vehicle to a suspect dossier."""
    plate = payload.get("plate")
    dossier_id = payload.get("dossier_id")
    if not plate or not dossier_id:
        raise HTTPException(status_code=400, detail="กรุณาระบุทั้งทะเบียนรถและรหัสแฟ้มบุคคล")

    prof = dossier_mgr.get_dossier_detail(dossier_id)
    if not prof:
        raise HTTPException(status_code=404, detail="ไม่พบแฟ้มบุคคลที่ระบุ")

    s_name = prof.get("suspect_name")
    s_id = prof.get("id_card")

    rec = vehicle_mgr.bind_to_dossier(
        plate=plate,
        province=payload.get("province"),
        dossier_id=dossier_id,
        owner_name=s_name,
        owner_id=s_id,
        status=payload.get("status", "verified")
    )

    # Sync with dossier profile vehicles array
    d_vehicles = prof.get("vehicles", []) or []
    clean_p = re.sub(r'\s', '', rec.get("plate", ''))
    if not any(re.sub(r'\s', '', v.get("plate", '')) == clean_p for v in d_vehicles):
        d_vehicles.append({
            "plate": rec.get("plate"),
            "province": rec.get("province"),
            "type": rec.get("type"),
            "color": rec.get("color"),
            "ownership_status": "verified"
        })
        prof["vehicles"] = d_vehicles
        dossier_mgr.save_dossier_profile(prof)
        dossier_mgr.rebuild_index()

    return {"status": "success", "message": f"ผูกรถ {plate} เข้ากับแฟ้ม '{s_name}' เรียบร้อยแล้ว", "vehicle": rec}


# =============================================================================
# Multi-Camera Historical Pull & AI Vehicle Scanner API (/api/nas-bot/history-pull/*)
# =============================================================================

HISTORY_JOBS_DIR = os.path.join(os.environ.get("LOCAL_EXPORTS_PATH", "/media/exports"), ".history_jobs")


class HistoryPullJobCreateRequest(BaseModel):
    cameras: List[str]
    start_ts: int
    end_ts: int
    ai_scan: bool = True
    vehicle_type: str = "all"
    vehicle_color: str = "all"
    case_tag: Optional[str] = ""


@app.get("/api/nas-bot/history-pull/cameras")
def api_history_pull_cameras() -> Dict[str, Any]:
    """Return all historical-capable cameras grouped by NVR."""
    os.makedirs(HISTORY_JOBS_DIR, exist_ok=True)
    catalog_file = os.path.join(HISTORY_JOBS_DIR, "cameras_catalog.json")
    if os.path.isfile(catalog_file):
        try:
            with open(catalog_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed reading cameras_catalog.json: {e}")
    return {"updated_at": None, "total_cameras": 0, "groups": []}


@app.post("/api/nas-bot/history-pull/jobs")
def api_history_pull_create_job(
    body: HistoryPullJobCreateRequest,
    x_user: Optional[str] = Header(None, alias="X-User"),
) -> Dict[str, Any]:
    """Enqueue a new multi-camera historical video pull and AI vehicle scan job."""
    cams = [c.strip() for c in (body.cameras or []) if c and c.strip()]
    if not cams:
        raise HTTPException(status_code=400, detail="กรุณาเลือกกล้องอย่างน้อย 1 กล้อง")
    if body.end_ts <= body.start_ts:
        raise HTTPException(status_code=400, detail="เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น")
    if (body.end_ts - body.start_ts) > 3600:
        raise HTTPException(status_code=400, detail="สามารถดึงย้อนหลังได้สูงสุดครั้งละไม่เกิน 60 นาทีต่อชุดคำสั่ง")

    os.makedirs(HISTORY_JOBS_DIR, exist_ok=True)
    now_ms = int(time.time() * 1000)
    job_id = f"job_{now_ms}"
    tz_th = datetime.timezone(datetime.timedelta(hours=7))
    now_iso = datetime.datetime.now(tz_th).isoformat()

    job_data = {
        "job_id": job_id,
        "status": "queued",
        "percent": 0,
        "cameras": cams,
        "start_ts": int(body.start_ts),
        "end_ts": int(body.end_ts),
        "ai_scan": bool(body.ai_scan),
        "vehicle_type": (body.vehicle_type or "all").strip(),
        "vehicle_color": (body.vehicle_color or "all").strip(),
        "case_tag": (body.case_tag or "").strip(),
        "created_by": x_user or "operator",
        "created_at": now_iso,
        "updated_at": now_iso,
        "segments_imported": 0,
        "events_created": 0,
        "camera_progress": {
            c: {"camera": c, "name": c, "status": "pending", "segments_ok": 0, "segments_total": 0, "events_found": 0}
            for c in cams
        },
        "matched_events": [],
    }

    job_path = os.path.join(HISTORY_JOBS_DIR, f"{job_id}.json")
    tmp_path = job_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(job_data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, job_path)
    return {"status": "ok", "job": job_data}


@app.get("/api/nas-bot/history-pull/jobs")
def api_history_pull_list_jobs() -> Dict[str, Any]:
    """List recent historical pull jobs."""
    os.makedirs(HISTORY_JOBS_DIR, exist_ok=True)
    jobs = []
    try:
        files = [
            os.path.join(HISTORY_JOBS_DIR, fn)
            for fn in os.listdir(HISTORY_JOBS_DIR)
            if fn.startswith("job_") and fn.endswith(".json")
        ]
        files.sort(reverse=True)
        for fp in files[:15]:
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    jobs.append(json.load(f))
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"Failed listing history pull jobs: {e}")
    return {"status": "ok", "jobs": jobs}


@app.get("/api/nas-bot/history-pull/jobs/{job_id}")
def api_history_pull_get_job(job_id: str) -> Dict[str, Any]:
    """Return live progress for a specific historical pull job."""
    if not re.fullmatch(r"job_[0-9A-Za-z_]+", job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id")
    job_path = os.path.join(HISTORY_JOBS_DIR, f"{job_id}.json")
    if not os.path.isfile(job_path):
        raise HTTPException(status_code=404, detail="ไม่พบงานดึงภาพย้อนหลังที่ระบุ")
    try:
        with open(job_path, "r", encoding="utf-8") as f:
            return {"status": "ok", "job": json.load(f)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/nas-bot/history-pull/jobs/{job_id}/cancel")
def api_history_pull_cancel_job(job_id: str) -> Dict[str, Any]:
    """Request cancellation of a running/queued historical pull job."""
    if not re.fullmatch(r"job_[0-9A-Za-z_]+", job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id")
    job_path = os.path.join(HISTORY_JOBS_DIR, f"{job_id}.json")
    if not os.path.isfile(job_path):
        raise HTTPException(status_code=404, detail="ไม่พบงานดึงภาพย้อนหลังที่ระบุ")
    try:
        with open(job_path, "r", encoding="utf-8") as f:
            jdata = json.load(f)
        if jdata.get("status") in ("queued", "running"):
            jdata["status"] = "cancel_requested"
            jdata["cancel_requested"] = True
            tmp_path = job_path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as fw:
                json.dump(jdata, fw, ensure_ascii=False, indent=2)
            os.replace(tmp_path, job_path)
        return {"status": "ok", "job": jdata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




