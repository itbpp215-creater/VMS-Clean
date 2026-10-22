# api.py — watchlist-api : FastAPI REST service สำหรับจัดการฐานข้อมูลทะเบียนเฝ้าระวัง
#
# หลักการทำงาน:
#   - ใช้ SQLite (stdlib) เก็บข้อมูลทะเบียนเฝ้าระวังเป็นไฟล์บน host machine
#     ที่ path /data/watchlist.db (mount มาจาก config/lpr/ บนเครื่อง Windows)
#   - ให้บริการ REST API ผ่านพอร์ต 5001 ภายใน docker compose network
#   - nginx proxy /api/watchlist/ → service นี้และลงนาม trusted auth headers
#   - dashboard เรียก read ผ่านผู้ใช้ที่ login และ CRUD ผ่าน admin เท่านั้น
#   - lpr-service อ่าน watchlist.db โดยตรง (ไม่ผ่าน API) เพื่อลด latency
#   - lpr-service เขียน history ด้วย service credential ที่แยกจาก browser identity
#
# Endpoints:
#   GET    /watchlist         → authenticated list (active=1; admin ใช้ ?all=1 ได้)
#   GET    /watchlist/{id}    → authenticated item
#   POST   /watchlist         → admin เพิ่มรายการใหม่
#   PUT    /watchlist/{id}    → admin แก้ไขรายการ
#   DELETE /watchlist/{id}    → admin soft delete (ใช้ ?hard=1 เพื่อลบถาวร)
#   GET    /watchlist/export  → admin export ข้อมูลเต็ม
#   GET    /federation/watchlist → federated peer รับเฉพาะข้อมูลขั้นต่ำ
#
# เอกสาร owner: docs/features/watchlist.md (สร้างหลัง deploy สำเร็จ)

import base64
import binascii
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import datetime
import email
import email.policy
import hmac
import ipaddress
import json
import os
import re
import secrets
import shutil
import sqlite3
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional, Tuple, Dict, Any, List

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import asyncio

import lpr_learning

# ---------------------------------------------------------------------------
# ตั้งค่า
# ---------------------------------------------------------------------------

# path ของ SQLite db — mount มาจาก host ที่ config/lpr/watchlist.db
# ทำให้ข้อมูลอยู่บนเครื่อง Windows ไม่หายเมื่อ container rebuild
DB_PATH = os.environ.get("WATCHLIST_DB_PATH", "/data/watchlist.db")
DATASET_DIR = os.environ.get("LPR_DATASET_DIR", "/data/dataset")
CROPS_DIR = os.environ.get("LPR_CROPS_DIR", "/lpr-data/crops")
RESTRICTED_DATASET_DIR = os.environ.get(
    "LPR_RESTRICTED_DATASET_DIR", os.path.join(DATASET_DIR, "restricted")
)
FRIGATE_URL = os.environ.get("FRIGATE_URL", "http://frigate:5000")
# Crop uploads are bounded before disk writes so an authenticated caller cannot
# exhaust the shared LPR volume with a single review request.
MAX_CROP_BYTES = int(os.environ.get("LPR_MAX_CROP_BYTES", str(10 * 1024 * 1024)))
# The approved installation has one high-level adjudicator.  Keeping the name
# configurable supports restores while failing closed on a role-only spoof.
SUPERADMIN_USERNAME = os.environ.get("LPR_SUPERADMIN_USERNAME", "arm215").strip()

# Secret ทั้งสามแยกสิทธิ์กันเพื่อให้หมุน/เพิกถอน Federation, reverse proxy และ
# lpr-service ได้โดยไม่ทำให้ trust boundary อื่นหยุดทำงานพร้อมกัน
def get_federation_secret():
    try:
        with open("/settings-data/secrets.json", "r") as f:
            data = json.load(f)
            if "WATCHLIST_FEDERATION_SHARED_SECRET" in data:
                return data["WATCHLIST_FEDERATION_SHARED_SECRET"]
    except Exception:
        pass
    return os.environ.get("WATCHLIST_FEDERATION_SHARED_SECRET", "")

PROXY_SHARED_SECRET = os.environ.get("WATCHLIST_PROXY_SHARED_SECRET", "")
SERVICE_SHARED_SECRET = os.environ.get("WATCHLIST_SERVICE_SHARED_SECRET", "")
# Audit ingestion has its own credential so compromise of a Federation or LPR
# secret cannot forge administrator activity in auth-service.
AUTH_AUDIT_SHARED_SECRET = os.environ.get("AUTH_AUDIT_SHARED_SECRET", "")

# CORS ปิดโดยปริยายเพราะ dashboard เรียก API แบบ same-origin ผ่าน nginx;
# deployment ที่มี trusted cross-origin UI ต้องระบุ origin แบบเจาะจงด้วย comma-separated URL
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("WATCHLIST_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app = FastAPI(
    title="Sloth BPP 215 - Watchlist API",
    description="REST API สำหรับจัดการข้อมูลบุคคล/ทะเบียนรถเฝ้าระวัง และเหตุการณ์จาก LPR",
    # version ถูกตรวจสอบโดย security contract ระหว่าง trusted proxy และ Federation
    version="1.2.0",
)

event_queues = []

@app.get("/watchlist/stream")
async def sse_stream(request: Request):
    """Server-Sent Events endpoint for pushing real-time VIGI events to the dashboard."""
    queue = asyncio.Queue()
    event_queues.append(queue)
    async def event_generator():
        try:
            while True:
                # If client disconnects, request.is_disconnected() might be true, but wait on queue blocks
                msg = await queue.get()
                yield f"data: {msg}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in event_queues:
                event_queues.remove(queue)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# โหลด CORS จากตัวแปรตาม operator กำหนดเป็น allowlist; หากไม่มีให้ fallback เป็น wildcard
# เพราะ response มีข้อมูลส่วนบุคคลและ browser ไม่จำเป็นต้องเรียกข้าม origin ใน topology ปกติ
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=True,
    )

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _legacy_polygon(bbox_json: Optional[str]) -> Optional[list[list[float]]]:
    """Convert the old rectangle/list representation into four review corners."""

    if not bbox_json:
        return None
    try:
        value = json.loads(bbox_json)
        if len(value) == 4 and all(isinstance(point, (list, tuple)) for point in value):
            return lpr_learning.validate_polygon(value)
        if len(value) == 4 and all(isinstance(number, (int, float)) for number in value):
            x1, y1, x2, y2 = value
            return lpr_learning.validate_polygon(
                [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
            )
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return None


def _migrate_legacy_confirmed_samples(conn: sqlite3.Connection) -> int:
    """Import the latest old human label per event into reviewed truth.

    The migration is idempotent and never treats an AI-only Frigate result as
    human truth.  Existing old form rows contain ``created_by`` and therefore
    remain useful; unconfirmed AI results are migrated separately by lpr-service
    into the pending queue.
    """

    rows = conn.execute(
        """
        SELECT old.* FROM lpr_training_samples old
        JOIN (
            SELECT event_id, MAX(id) AS latest_id
            FROM lpr_training_samples GROUP BY event_id
        ) latest ON latest.latest_id = old.id
        ORDER BY old.id
        """
    ).fetchall()
    migrated = 0
    for row in rows:
        existing = conn.execute(
            "SELECT 1 FROM lpr_candidates WHERE event_id = ? AND source = 'legacy-human'",
            (row["event_id"],),
        ).fetchone()
        if existing:
            continue
        plate_text = _normalize_plate(row["plate"] or "")
        province = (row["province"] or "").strip()
        if not plate_text:
            continue
        decision = "readable" if province else "partial"
        status = "readable" if province else "partial"
        polygon = _legacy_polygon(row["bbox_json"])
        timestamp = row["created_at"] or lpr_learning.utc_now()
        crop_name = os.path.basename(row["crop_path"] or f"{row['event_id']}.jpg")
        source_crop = _operational_crop_path(crop_name)
        cursor = conn.execute(
            """
            INSERT INTO lpr_candidates
                (event_id, camera, status, review_state, plate_text, province,
                 polygon_json, crop_path, operational_visible, human_confirmed,
                 source, model_version, created_at, updated_at)
            VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, 1, 1,
                    'legacy-human', 'legacy-human-label', ?, ?)
            """,
            (
                row["event_id"],
                row["camera"],
                status,
                plate_text,
                province or None,
                json.dumps(polygon, separators=(",", ":")) if polygon else None,
                crop_name if source_crop and os.path.isfile(source_crop) else None,
                timestamp,
                timestamp,
            ),
        )
        candidate_id = int(cursor.lastrowid)
        conn.execute(
            "INSERT INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'primary')",
            (candidate_id, row["event_id"]),
        )
        conn.execute(
            """
            INSERT INTO lpr_reviews
                (candidate_id, decision, plate_text, province, polygon_json,
                 reviewer, reviewer_role, is_adjudication, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'admin', 0, ?)
            """,
            (
                candidate_id,
                decision,
                plate_text,
                province or None,
                json.dumps(polygon, separators=(",", ":")) if polygon else None,
                row["created_by"] or "legacy-admin",
                timestamp,
            ),
        )
        if source_crop and os.path.isfile(source_crop):
            approved_path = _copy_training_image(candidate_id, source_crop, restricted=False)
            kinds = [("plate_detection", None, None), ("ocr_registration", plate_text, None)]
            if province:
                kinds.append(("ocr_province", province, province))
            for kind, label_text, label_province in kinds:
                conn.execute(
                    """
                    INSERT INTO lpr_training_examples
                        (candidate_id, kind, image_path, label_text, province, approved, created_at)
                    VALUES (?, ?, ?, ?, ?, 1, ?)
                    """,
                    (candidate_id, kind, approved_path, label_text, label_province, timestamp),
                )
        migrated += 1
    return migrated


def init_db():
    """สร้าง schema ถ้ายังไม่มี — เรียกครั้งเดียวตอน startup
    ออกแบบให้ idempotent: รันซ้ำกี่ครั้งก็ได้โดยไม่ลบข้อมูลเดิม"""
    os.makedirs(os.path.dirname(DB_PATH) if os.path.dirname(DB_PATH) else ".", exist_ok=True)
    os.makedirs(DATASET_DIR, exist_ok=True)
    os.makedirs(CROPS_DIR, exist_ok=True)
    # Negative examples are intentionally separated from operational crops;
    # only privileged API endpoints expose their metadata.
    os.makedirs(os.path.join(RESTRICTED_DATASET_DIR, "negative"), exist_ok=True)
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                plate            TEXT NOT NULL UNIQUE,
                plate_display    TEXT,
                owner_name       TEXT,
                owner_address    TEXT,
                user_name        TEXT,
                criminal_history TEXT,
                phone            TEXT,
                network          TEXT,
                danger_level     TEXT DEFAULT 'medium'
                    CHECK (danger_level IN ('low','medium','high','critical')),
                notes            TEXT,
                active           INTEGER DEFAULT 1 CHECK (active IN (0,1)),
                created_at       TEXT,
                updated_at       TEXT
            )
        """)
        # index เพื่อให้ lpr-service lookup ทะเบียนเร็ว
        conn.execute("CREATE INDEX IF NOT EXISTS idx_plate ON watchlist(plate)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_active ON watchlist(active)")

        # ตรวจสอบและเพิ่มคอลัมน์ province หากยังไม่มี (Schema Migration)
        col_names = [col["name"] for col in conn.execute("PRAGMA table_info(watchlist)").fetchall()]
        if "province" not in col_names:
            conn.execute("ALTER TABLE watchlist ADD COLUMN province TEXT")

        # ซ่อมแซมข้อมูลเก่าที่ผู้ใช้เคยกรอกแยกตัวอักษรไว้ใน plate และตัวเลขใน plate_display
        conn.execute("""
            UPDATE watchlist
            SET plate = 'ฆท1959', plate_display = 'ฆท 1959'
            WHERE id = 2 AND plate = 'ฆท' AND plate_display = '1959'
        """)
        
        # ตารางประวัติการตรวจพบรถเป้าหมาย
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist_history (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                plate            TEXT NOT NULL,
                camera           TEXT NOT NULL,
                detected_at      TEXT NOT NULL,
                confidence       REAL,
                observed_plate   TEXT,
                match_tier       TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_history_plate ON watchlist_history(plate)")
        # ADR-0031 migration: ensure observed_plate and match_tier exist on existing DB
        hist_cols = {row[1] for row in conn.execute("PRAGMA table_info(watchlist_history)").fetchall()}
        if "observed_plate" not in hist_cols:
            conn.execute("ALTER TABLE watchlist_history ADD COLUMN observed_plate TEXT")
        if "match_tier" not in hist_cols:
            conn.execute("ALTER TABLE watchlist_history ADD COLUMN match_tier TEXT")
        
        # ตารางคลังข้อมูลฝึกสอนโมเดลป้ายทะเบียน (Interactive LPR Training Dataset)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lpr_training_samples (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id         TEXT NOT NULL,
                camera           TEXT,
                plate            TEXT NOT NULL,
                province         TEXT,
                bbox_json        TEXT,
                crop_path        TEXT,
                created_at       TEXT,
                created_by       TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_train_event ON lpr_training_samples(event_id)")
        # Install the reviewed multi-candidate, immutable-review, and model
        # lifecycle schema without deleting the legacy sample table.
        lpr_learning.ensure_schema(conn)
        # Old administrator answers remain authoritative; only their latest row
        # per event is imported and AI-only Frigate labels are intentionally absent.
        _migrate_legacy_confirmed_samples(conn)
        conn.commit()


@contextmanager
def get_conn():
    """context manager คืน sqlite3 connection พร้อม row_factory
    row_factory=sqlite3.Row ทำให้เข้าถึงคอลัมน์ด้วยชื่อได้ (เหมือน dict)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Foreign keys protect candidate/review/training ownership and are enabled
    # per SQLite connection rather than assumed from the database file.
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row):
    """แปลง sqlite3.Row เป็น dict ธรรมดาเพื่อส่งกลับเป็น JSON"""
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Trust boundary helpers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TrustedIdentity:
    """Identity ที่ยืนยันแล้วว่าออกโดย reverse proxy ที่ service ไว้ใจ

    username และ role มาจาก auth-service ผ่าน nginx ส่วน client_ip ใช้เฉพาะ
    audit trail; object นี้ไม่ควรถูกสร้างจาก header ก่อนตรวจ proxy secret
    """

    username: str
    role: str
    client_ip: str


def _secret_matches(provided: Optional[str], expected: str) -> bool:
    """เปรียบเทียบ shared secret แบบ constant-time และ fail closed

    provided มาจาก request header และ expected มาจาก environment; คืน False
    เมื่อค่าใดว่างหรือ secret ฝั่ง server สั้นกว่า 32 ตัวอักษร เพื่อไม่ยอมรับ
    deployment ที่ยังไม่ได้ bootstrap secret ที่มี entropy เพียงพอ
    """

    # ตรวจรูปแบบก่อน compare เพื่อให้ค่าที่ไม่ได้ configure ไม่มีทางกลายเป็น credential ที่ใช้ได้
    if not provided or len(expected) < 32:
        return False
    # compare_digest ป้องกันการเดาค่าทีละ byte จากเวลาตอบสนองของ equality ปกติ
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def _require_configured_secret(secret: str, variable_name: str) -> None:
    """ยืนยันว่า secret สำหรับ trust boundary ถูก bootstrap แล้ว

    secret คือค่าจาก environment และ variable_name ใช้เฉพาะข้อความ operational;
    ฟังก์ชันไม่คืน secret และตอบ 503 เพื่อแยก misconfiguration ออกจาก credential ผิด
    """

    # ความยาวขั้นต่ำช่วยกัน placeholder/default สั้น ๆ แต่ operator ยังต้องสร้างค่าแบบสุ่ม
    if len(secret) < 32:
        raise HTTPException(
            status_code=503,
            detail=f"{variable_name} ยังไม่ได้ตั้งค่าเป็น secret อย่างน้อย 32 ตัวอักษร",
        )


def _trusted_client_ip(request: Request, x_real_ip: Optional[str]) -> str:
    """คืน IP สำหรับ audit หลัง proxy ผ่านการยืนยันแล้ว

    x_real_ip ต้องเป็น address เดี่ยวที่ nginx เขียนทับจาก $remote_addr; หาก header
    ผิดรูปแบบจะ fallback เป็น peer IP ของ ASGI แทนการเก็บ input ที่ปลอมรูปแบบได้
    """

    # peer IP เป็น fallback ที่เชื่อถือได้ในระดับ transport ของ container network
    peer_ip = request.client.host if request.client else ""
    if not x_real_ip:
        return peer_ip
    try:
        # canonical string ลดรูปแบบกำกวมทั้ง IPv4 และ IPv6 ใน audit log
        return str(ipaddress.ip_address(x_real_ip.strip()))
    except ValueError:
        return peer_ip


def require_trusted_identity(
    request: Request,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
    x_proxy_secret: Optional[str] = Header(None, alias="X-BPP-Proxy-Secret"),
    x_real_ip: Optional[str] = Header(None, alias="X-Real-IP"),
) -> TrustedIdentity:
    """ตรวจ identity ที่ nginx ส่งหลัง auth_request สำเร็จ

    Header X-User/X-Role จะเชื่อได้ต่อเมื่อ X-BPP-Proxy-Secret ตรงกับ secret
    ของ service เท่านั้น; คืน TrustedIdentity สำหรับ authorization/audit และไม่มี
    side effect นอกจากตอบ 401/503 เมื่อ request หรือ deployment ไม่น่าเชื่อถือ
    """

    # fail closed เมื่อ operator ยังไม่ได้ bootstrap proxy secret
    _require_configured_secret(PROXY_SHARED_SECRET, "WATCHLIST_PROXY_SHARED_SECRET")
    # ปฏิเสธ header identity ที่ client ส่งเองหรือมาจาก proxy ที่ไม่ใช่ตัวที่กำหนด
    if not _secret_matches(x_proxy_secret, PROXY_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="ไม่สามารถยืนยัน trusted proxy ได้")

    # username และ role ต้องมีค่าหลัง auth-service ตรวจ token แล้ว; จำกัดความยาวกัน log abuse
    username = (x_user or "").strip()
    role = (x_role or "").strip()
    if not username or len(username) > 128 or not role or len(role) > 32:
        raise HTTPException(status_code=401, detail="identity จาก trusted proxy ไม่สมบูรณ์")

    # สร้าง identity หลังตรวจทุก trust input แล้วเท่านั้น
    return TrustedIdentity(
        username=username,
        role=role,
        client_ip=_trusted_client_ip(request, x_real_ip),
    )


require_authenticated = require_trusted_identity


def require_admin(
    identity: TrustedIdentity = Depends(require_trusted_identity),
) -> TrustedIdentity:
    """บังคับ role admin สำหรับ mutation และ export ที่มีข้อมูลเต็ม

    identity ต้องผ่าน proxy authentication มาก่อน; คืน object เดิมให้ handler
    ใช้ username/IP ทำ audit และตอบ 403 เมื่อผู้ใช้ยืนยันตัวแล้วแต่สิทธิ์ไม่พอ
    """

    # role ใช้ค่า canonical แบบ case-sensitive จาก auth-service เพื่อไม่เปิด alias โดยไม่ตั้งใจ
    if identity.role not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="ต้องเป็นแอดมินเท่านั้น")
    return identity


def require_superadmin(
    identity: TrustedIdentity = Depends(require_trusted_identity),
) -> TrustedIdentity:
    """Require the singular high-level reviewer for adjudication and models.

    Both the database-backed role propagated by auth-service and the configured
    username must match.  Ordinary administrators retain annotation rights but
    cannot promote, roll back, or decide a conflict.
    """

    # The paired checks implement the user-approved single-account boundary.
    if identity.role != "superadmin" or identity.username != SUPERADMIN_USERNAME:
        raise HTTPException(
            status_code=403,
            detail="ต้องเป็นผู้ดูแลระบบระดับสูงที่กำหนดเท่านั้น",
        )
    return identity


def require_internal_service(
    x_service_secret: Optional[str] = Header(None, alias="X-BPP-Service-Secret"),
) -> None:
    """ยืนยัน lpr-service ก่อนอนุญาตให้เพิ่มประวัติการตรวจพบ

    ใช้ secret แยกจาก admin/proxy เพื่อให้ service account เขียนเฉพาะ endpoint
    history ได้โดยไม่สามารถปลอม role หรือเรียก CRUD ของ watchlist
    """

    # fail closed ทั้งเมื่อยังไม่ตั้งค่าและเมื่อ credential จาก caller ไม่ตรง
    _require_configured_secret(SERVICE_SHARED_SECRET, "WATCHLIST_SERVICE_SHARED_SECRET")
    if not _secret_matches(x_service_secret, SERVICE_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="ไม่สามารถยืนยัน service caller ได้")


def require_federation_peer(
    x_federation_secret: Optional[str] = Header(None, alias="X-BPP-Federation"),
    x_proxy_secret: Optional[str] = Header(None, alias="X-BPP-Proxy-Secret"),
    x_mtls_verified: Optional[str] = Header(None, alias="X-BPP-mTLS-Verified"),
    x_vpn_verified: Optional[str] = Header(None, alias="X-BPP-VPN-Verified"),
) -> None:
    """ยืนยัน federation peer ด้วย application secret และ transport assertion

    nginx ต้องยืนยัน mTLS หรือบังคับ VPN ACL ก่อนเขียน assertion header แล้วลงนาม
    ความน่าเชื่อถือของ header ด้วย proxy secret; service จึงไม่เชื่อ signal ที่ remote
    client ใส่มาเอง และตอบ fail closed หากขาดชั้นใดชั้นหนึ่ง
    """

    # federation secret และ proxy secret เป็นคนละ credential เพื่อจำกัด blast radius
    current_federation_secret = get_federation_secret()
    _require_configured_secret(
        current_federation_secret,
        "WATCHLIST_FEDERATION_SHARED_SECRET",
    )
    _require_configured_secret(PROXY_SHARED_SECRET, "WATCHLIST_PROXY_SHARED_SECRET")
    if not _secret_matches(x_federation_secret, current_federation_secret):
        raise HTTPException(status_code=401, detail="Federation credential ไม่ถูกต้อง")
    if not _secret_matches(x_proxy_secret, PROXY_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="ไม่สามารถยืนยัน Federation proxy ได้")

    # รับเฉพาะค่าที่ nginx สร้างจากผลตรวจจริง; proxy ต้องล้าง header จาก client ก่อนตั้งค่าใหม่
    mtls_ok = hmac.compare_digest((x_mtls_verified or "").upper(), "SUCCESS")
    vpn_ok = hmac.compare_digest((x_vpn_verified or ""), "1")
    if not (mtls_ok or vpn_ok):
        raise HTTPException(
            status_code=403,
            detail="Federation ต้องผ่าน mTLS หรือ VPN ACL ที่ trusted proxy ยืนยัน",
        )


# ---------------------------------------------------------------------------
# Pydantic models — validation input
# ---------------------------------------------------------------------------

def _normalize_plate(text: str) -> str:
    """normalize ทะเบียน: เหลือเฉพาะไทย/อังกฤษ/ตัวเลข uppercase
    logic เดียวกับ normalize_plate() ใน lpr-service/app.py เพื่อให้เทียบกันได้"""
    return re.sub(r"[^ก-ฮA-Z0-9]", "", (text or "").strip().upper())


class WatchlistItem(BaseModel):
    """schema สำหรับ POST (สร้างใหม่) — plate บังคับ, ที่เหลือ optional"""
    plate: str                              # ทะเบียน (required)
    plate_display: Optional[str] = None    # ทะเบียนสำหรับแสดง (เช่น "กข 1234")
    province: Optional[str] = Field(None, max_length=128)         # จังหวัด
    owner_name: Optional[str] = Field(None, max_length=255)       # ชื่อผู้ครอบครอง
    owner_address: Optional[str] = Field(None, max_length=512)    # ที่อยู่
    user_name: Optional[str] = Field(None, max_length=255)        # ชื่อผู้ใช้งาน
    criminal_history: Optional[str] = Field(None, max_length=1000) # ประวัติอาชญากรรม
    phone: Optional[str] = Field(None, max_length=64)            # เบอร์โทร
    network: Optional[str] = Field(None, max_length=128)          # เครือข่าย/กลุ่ม
    danger_level: str = "medium"           # low / medium / high / critical
    notes: Optional[str] = Field(None, max_length=1000)            # หมายเหตุ
    active: int = 1                        # 1=ใช้งาน, 0=ปิด

    @field_validator("plate")
    @classmethod
    def validate_plate(cls, v):
        """ตรวจสอบและ normalize ทะเบียน — ต้องมีตัวอักษรอย่างน้อย 2 ตัวหลัง normalize"""
        normalized = _normalize_plate(v)
        if len(normalized) < 2:
            raise ValueError("plate ต้องมีตัวอักษรอย่างน้อย 2 ตัว (หลัง normalize)")
        return normalized  # เก็บ normalized เสมอ

    @field_validator("danger_level")
    @classmethod
    def validate_danger(cls, v):
        allowed = ("low", "medium", "high", "critical")
        if v not in allowed:
            raise ValueError(f"danger_level ต้องเป็นหนึ่งใน: {allowed}")
        return v


class WatchlistUpdate(BaseModel):
    """schema สำหรับ PUT (แก้ไข) — ทุก field optional (partial update)"""
    plate: Optional[str] = None
    plate_display: Optional[str] = None
    province: Optional[str] = Field(None, max_length=128)
    owner_name: Optional[str] = Field(None, max_length=255)
    owner_address: Optional[str] = Field(None, max_length=512)
    user_name: Optional[str] = Field(None, max_length=255)
    criminal_history: Optional[str] = Field(None, max_length=1000)
    phone: Optional[str] = Field(None, max_length=64)
    network: Optional[str] = Field(None, max_length=128)
    danger_level: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=1000)
    active: Optional[int] = None

    @field_validator("plate")
    @classmethod
    def validate_plate(cls, v):
        if v is None:
            return v
        normalized = _normalize_plate(v)
        if len(normalized) < 2:
            raise ValueError("plate ต้องมีตัวอักษรอย่างน้อย 2 ตัว (หลัง normalize)")
        return normalized

    @field_validator("danger_level")
    @classmethod
    def validate_danger(cls, v):
        if v is None:
            return v
        allowed = ("low", "medium", "high", "critical")
        if v not in allowed:
            raise ValueError(f"danger_level ต้องเป็นหนึ่งใน: {allowed}")
        return v


class WatchlistHistoryItem(BaseModel):
    """schema สำหรับ POST ประวัติการตรวจพบ"""
    plate: str
    camera: str
    detected_at: Optional[str] = None
    confidence: Optional[float] = None
    observed_plate: Optional[str] = None
    match_tier: Optional[str] = "exact"


class FederationWatchlistItem(BaseModel):
    """ข้อมูลขั้นต่ำที่ node ปลายทางต้องใช้ match ทะเบียนและจัดระดับแจ้งเตือน

    จงใจไม่รวมชื่อ ที่อยู่ เบอร์โทร ประวัติอาชญากรรม เครือข่าย หมายเหตุ ID และ
    timestamp เพื่อจำกัด PII ที่ออกข้าม trust boundary ของหน่วยงาน
    """

    plate: str
    plate_display: Optional[str] = None
    province: Optional[str] = Field(None, max_length=128)
    danger_level: str



# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def send_audit(username: str, action: str, details: str, ip_address: str):
    """ส่ง audit event ไป auth-service ด้วย service credential ที่แยกสิทธิ์

    username/action/details/ip_address มาจาก trusted identity และ operation ที่
    สำเร็จแล้ว; ฟังก์ชันมี side effect เป็น internal HTTP POST แต่ไม่ทำให้ CRUD
    หลักล้มเมื่อ audit backend ชั่วคราวใช้ไม่ได้
    """

    # ไม่มี verified username หรือ secret ที่ bootstrap ไม่ครบต้องไม่ยิง request
    # ซึ่งอาจถูกตีความเป็น audit ที่ยืนยันแล้วจาก service นี้
    if not username or len(AUTH_AUDIT_SHARED_SECRET.encode("utf-8")) < 32:
        return
    try:
        data = json.dumps({"action": action, "details": details}).encode('utf-8')
        req = urllib.request.Request(
            "http://auth-service:5002/auth/audit",
            data=data,
            headers={
                "Content-Type": "application/json",
                "X-User": username,
                "X-Real-IP": ip_address,
                "X-BPP-Audit-Secret": AUTH_AUDIT_SHARED_SECRET,
            },

        )
        urllib.request.urlopen(req, timeout=2)
    except Exception as e:
        print(f"Audit log failed: {e}")

@app.on_event("startup")
def startup():
    """สร้าง database schema ตอน container เริ่มทำงาน"""
    init_db()
    
    import threading
    import time
    def _cleanup_loop():
        while True:
            try:
                cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=90)).isoformat() + "Z"
                with get_conn() as conn:
                    # ลบ crop files ก่อน
                    rows = conn.execute(
                        "SELECT crop_path FROM lpr_candidates WHERE source = 'vigi_edge_ai' AND created_at < ?",
                        (cutoff,)
                    ).fetchall()
                    for row in rows:
                        if row["crop_path"]:
                            path = os.path.join("/lpr-data/crops", row["crop_path"])
                            try: os.remove(path)
                            except: pass
                    # ลบ DB rows
                    conn.execute(
                        "DELETE FROM lpr_candidates WHERE source = 'vigi_edge_ai' AND created_at < ?",
                        (cutoff,)
                    )
            except Exception as e:
                print(f"[Cleanup] Error cleaning up vigi candidates: {e}")
            time.sleep(21600)  # 6 hours
    
    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/watchlist")
def list_watchlist(
    all: bool = Query(False, description="true = รวม record ที่ปิดใช้งาน (active=0) ด้วย"),
    search: Optional[str] = Query(None, description="ค้นหาในทะเบียน/ชื่อ/เครือข่าย"),
    identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """ดึงรายการทะเบียนให้ผู้ใช้ที่ trusted proxy ยืนยันแล้ว

    all ควบคุม inactive records (admin เท่านั้น), search กรองหลายคอลัมน์ และ
    identity มาจาก dependency; คืน list ของ record เต็มที่ตรงเงื่อนไขโดยไม่แก้ DB
    เพราะ response มี PII จึงห้ามเรียกตรงข้าม proxy
    """
    # รายการ inactive ใช้สำหรับงานจัดการ จึงจำกัด admin แม้ endpoint เป็น GET
    if all and identity.role not in {"admin", "superadmin"}:
        raise HTTPException(status_code=403, detail="รายการที่ปิดใช้งานดูได้เฉพาะแอดมิน")
    with get_conn() as conn:
        conditions = []
        params = []
        if not all:
            conditions.append("active = 1")
        if search:
            # ค้นหาแบบ case-insensitive ในหลายคอลัมน์
            like = f"%{search}%"
            conditions.append(
                "(plate LIKE ? OR plate_display LIKE ? OR owner_name LIKE ? OR network LIKE ?)"
            )
            params.extend([like, like, like, like])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = conn.execute(
            f"SELECT * FROM watchlist {where} ORDER BY created_at DESC",
            params
        ).fetchall()
        return [row_to_dict(r) for r in rows]


@app.get("/watchlist/export")
def export_watchlist(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """Export รายการเต็มสำหรับ backup โดยอนุญาตเฉพาะ trusted admin

    _admin เป็นผลจาก dependency ที่ตรวจ proxy identity/role; คืน list รวม active
    และ inactive records ทุกคอลัมน์โดยไม่แก้ DB เนื่องจากมี PII จึงห้ามใช้กับ Federation
    """

    # export เป็น privileged read เพราะมีข้อมูลส่วนบุคคลครบทุกคอลัมน์
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM watchlist ORDER BY id").fetchall()
        return [row_to_dict(r) for r in rows]


@app.get(
    "/federation/watchlist",
    response_model=list[FederationWatchlistItem],
)
def export_federation_watchlist(
    response: Response,
    _peer: None = Depends(require_federation_peer),
):
    """ส่งเฉพาะข้อมูล active ขั้นต่ำให้ peer ที่ผ่าน Federation trust contract

    response ใช้ตั้ง no-store และ _peer บังคับ application secret + signed mTLS/VPN
    assertion; คืน list ที่มีเพียง plate/plate_display/danger_level และไม่แก้ DB
    """

    # ข้อมูล plate จำเป็นต่อ matching และ danger_level จำเป็นต่อ severity เท่านั้น
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT plate, plate_display, province, danger_level
            FROM watchlist
            WHERE active = 1
            ORDER BY plate
            """
        ).fetchall()
    # ข้อมูล Federation ไม่ควรค้างใน browser/proxy cache หลังสิทธิ์ถูกเพิกถอน
    response.headers["Cache-Control"] = "no-store"
    return [row_to_dict(row) for row in rows]


@app.get("/watchlist/{item_id}")
def get_watchlist_item(
    item_id: int,
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """ดึง record เต็มตาม item_id หลัง trusted proxy ยืนยัน _identity

    คืน dict ของ record โดยไม่แก้ DB หรือยก 404 เมื่อไม่มี id; response มี PII
    จึงอาศัย dependency เดียวกับ list ปกติ
    """

    # รายการเดี่ยวมี PII เหมือน list endpoint จึงห้ามเรียกตรงข้าม proxy
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM watchlist WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"ไม่พบ id {item_id}")
        return row_to_dict(row)


@app.post("/watchlist", status_code=201)
def create_watchlist_item(
    item: WatchlistItem,
    admin: TrustedIdentity = Depends(require_admin),
):
    """เพิ่ม WatchlistItem โดย trusted admin แล้วคืน record ที่สร้าง

    item ผ่าน Pydantic validation และ admin มาจาก signed proxy identity; side effects
    คือ insert/commit SQLite และส่ง audit หลัง commit โดยยก 409 เมื่อ plate ซ้ำ
    """

    # ใช้เวลาฝั่ง server เพื่อไม่ให้ caller ปลอม audit timestamp ของข้อมูลหลัก
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        try:
            cur = conn.execute("""
                INSERT INTO watchlist
                    (plate, plate_display, province, owner_name, owner_address, user_name,
                     criminal_history, phone, network, danger_level, notes, active,
                     created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                item.plate, item.plate_display, item.province, item.owner_name, item.owner_address,
                item.user_name, item.criminal_history, item.phone, item.network,
                item.danger_level, item.notes, item.active, now, now,
            ))
            conn.commit()
            new_id = cur.lastrowid
            # identity จาก dependency ป้องกัน client ปลอม username/role ใน audit
            send_audit(
                admin.username,
                "ADD_WATCHLIST",
                f"Added plate {item.plate}",
                admin.client_ip,
            )
            row = conn.execute("SELECT * FROM watchlist WHERE id = ?", (new_id,)).fetchone()
            return row_to_dict(row)
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=409,
                detail=f"ทะเบียน '{item.plate}' มีอยู่ในระบบแล้ว"
            )


@app.put("/watchlist/{item_id}")
def update_watchlist_item(
    item_id: int,
    item: WatchlistUpdate,
    admin: TrustedIdentity = Depends(require_admin),
):
    """แก้ item_id ด้วย partial WatchlistUpdate จาก trusted admin แล้วคืน record ใหม่

    side effects คือ update/commit SQLite และส่ง audit หลัง commit; ยก 404 เมื่อไม่มี
    record และ 400 เมื่อ payload ไม่มี field ที่เปลี่ยน
    """

    # ตรวจ record ก่อนสร้าง dynamic SET clause เพื่อคืน 404 ที่ชัดเจน
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM watchlist WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"ไม่พบ id {item_id}")

        updates = item.model_dump(exclude_none=True)
        if not updates:
            raise HTTPException(status_code=400, detail="ไม่มี field ที่จะแก้ไข")

        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updates["updated_at"] = now
        allowed_keys = {"plate_display", "province", "danger_level", "owner_name", "user_name", "owner_address", "phone", "network", "criminal_history", "notes", "active"}
        safe_updates = {k: v for k, v in updates.items() if k in allowed_keys}
        if not safe_updates: return True
        updates = safe_updates
        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [item_id]
        try:
            conn.execute(f"UPDATE watchlist SET {set_clause} WHERE id = ?", values)
            conn.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=409,
                detail=f"ทะเบียน '{updates.get('plate')}' มีอยู่ในระบบแล้ว"
            )
        # ใช้ verified identity เท่านั้นเพื่อให้ audit attribution เชื่อถือได้
        send_audit(
            admin.username,
            "UPDATE_WATCHLIST",
            f"Updated ID {item_id}",
            admin.client_ip,
        )
        row = conn.execute("SELECT * FROM watchlist WHERE id = ?", (item_id,)).fetchone()
        return row_to_dict(row)


@app.delete("/watchlist/{item_id}")
def delete_watchlist_item(
    item_id: int,
    hard: bool = Query(False, description="true = ลบถาวร, false = soft delete"),
    admin: TrustedIdentity = Depends(require_admin),
):
    """ลบ item_id แบบ soft delete หรือ hard delete ตาม hard โดย trusted admin

    side effects คือ update/delete แล้ว commit SQLite พร้อม audit; คืนข้อความ action
    ที่สำเร็จและยก 404 เมื่อไม่มี record เป้าหมาย
    """

    # authorization ทำก่อนเปิด transaction เพื่อให้ผู้ไม่มีสิทธิ์แตะฐานข้อมูลไม่ได้
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM watchlist WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"ไม่พบ id {item_id}")
        if hard:
            conn.execute("DELETE FROM watchlist WHERE id = ?", (item_id,))
        else:
            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                "UPDATE watchlist SET active = 0, updated_at = ? WHERE id = ?",
                (now, item_id)
            )
        conn.commit()
        action = "DELETE" if hard else "SOFT_DELETE"
        # ผูก audit กับ verified admin และ client IP ที่ trusted proxy ส่งมา
        send_audit(admin.username, action, f"ID {item_id}", admin.client_ip)
    return {"message": f"{action} id {item_id} สำเร็จ"}


@app.post("/watchlist/history", status_code=201)
def add_history(
    item: WatchlistHistoryItem,
    _service: None = Depends(require_internal_service),
):
    """บันทึกประวัติจาก lpr-service ที่ผ่าน service credential แล้ว
    ADR-0031: 3-minute cooldown per (watchlist plate + camera) to prevent frame duplicate counts.
    """
    now = item.detected_at or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    normalized = _normalize_plate(item.plate)
    observed = _normalize_plate(item.observed_plate or item.plate)
    tier = item.match_tier or "exact"
    conf = item.confidence
    if conf is not None and conf <= 1.0:
        conf = conf * 100.0

    with get_conn() as conn:
        cutoff = (datetime.datetime.now() - datetime.timedelta(minutes=3)).strftime("%Y-%m-%d %H:%M:%S")
        recent = conn.execute(
            """
            SELECT 1 FROM watchlist_history
            WHERE plate = ? AND camera = ? AND detected_at >= ?
            LIMIT 1
            """,
            (normalized, item.camera, cutoff),
        ).fetchone()
        if not recent:
            conn.execute("""
                INSERT INTO watchlist_history (plate, camera, detected_at, confidence, observed_plate, match_tier)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (normalized, item.camera, now, conf, observed, tier))
            conn.commit()
    return {"message": "บันทึกประวัติสำเร็จ"}


@app.get("/watchlist/{plate}/history")
def get_history(
    plate: str,
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """ดึง detection history สูงสุด 500 รายการของ plate ให้ verified _identity

    คืน list เรียงเวลาล่าสุดก่อนและไม่แก้ DB; ข้อมูลตำแหน่ง/เวลาอ่อนไหวจึงห้าม
    bypass trusted proxy แม้ caller อยู่ใน container network
    """

    # ประวัติตำแหน่ง/เวลาเป็นข้อมูลอ่อนไหวจึงต้องผ่าน identity boundary เดียวกับ watchlist
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM watchlist_history WHERE plate = ? ORDER BY detected_at DESC LIMIT 500",
            (plate,)
        ).fetchall()
        return [row_to_dict(r) for r in rows]


@app.get("/watchlist/{plate}/stats")
def get_stats(
    plate: str,
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """คำนวณสถิติของ plate ตามกล้อง ชั่วโมง และวันให้ verified _identity

    คืน dict ของ aggregate สามชุดโดยไม่แก้ DB; aggregate ยังเปิดเผยรูปแบบการเดินทาง
    จึงใช้ authentication boundary เดียวกับ raw history
    """

    # aggregate ยังเปิดเผยรูปแบบการเดินทาง จึงใช้ authentication เท่ากับ raw history
    with get_conn() as conn:
        # สถิติแยกตามกล้อง
        cam_rows = conn.execute("""
            SELECT camera, COUNT(*) as count 
            FROM watchlist_history 
            WHERE plate = ? 
            GROUP BY camera 
            ORDER BY count DESC
        """, (plate,)).fetchall()
        
        # สถิติแยกตามช่วงเวลา (ชั่วโมง 00-23)
        # detected_at format: YYYY-MM-DD HH:MM:SS
        hour_rows = conn.execute("""
            SELECT substr(detected_at, 12, 2) as hour, COUNT(*) as count 
            FROM watchlist_history 
            WHERE plate = ? 
            GROUP BY hour 
            ORDER BY hour ASC
        """, (plate,)).fetchall()
        
        # สถิติแยกตามวันในสัปดาห์ (0=Sunday, 1=Monday... แต่ใน SQLite strftime('%w') จะคืน 0-6)
        day_rows = conn.execute("""
            SELECT strftime('%w', detected_at) as dow, COUNT(*) as count 
            FROM watchlist_history 
            WHERE plate = ? 
            GROUP BY dow 
            ORDER BY dow ASC
        """, (plate,)).fetchall()

        return {
            "by_camera": [row_to_dict(r) for r in cam_rows],
            "by_hour": [row_to_dict(r) for r in hour_rows],
            "by_day": [row_to_dict(r) for r in day_rows],
        }


# ---------------------------------------------------------------------------
# Interactive LPR Training & Labeling API
# ---------------------------------------------------------------------------

class LPREventLink(BaseModel):
    """Associate one physical candidate with another Frigate event."""

    event_id: str = Field(min_length=1, max_length=128)
    relation: str = Field(pattern="^(vehicle|person)$")


class LPRCandidateRequest(BaseModel):
    """Machine-only observation submitted by lpr-service for human review."""

    event_id: str = Field(min_length=1, max_length=128)
    observation_key: Optional[str] = Field(default=None, min_length=1, max_length=200)
    camera: Optional[str] = Field(default="", max_length=128)
    status: str
    plate_text: Optional[str] = Field(default=None, max_length=100)
    province: Optional[str] = Field(default=None, max_length=100)
    detector_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    ocr_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    polygon: Optional[list[list[float]]] = None
    crop_base64: Optional[str] = None
    model_version: Optional[str] = Field(default=None, max_length=128)
    vehicle_color: Optional[str] = Field(default=None, max_length=64)
    vehicle_type: Optional[str] = Field(default=None, max_length=64)
    vehicle_brand: Optional[str] = Field(default=None, max_length=64)
    vehicle_model: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = Field(default=None, max_length=512)
    linked_events: list[LPREventLink] = Field(default_factory=list, max_length=32)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        """Reject machine states outside the explicit operational vocabulary."""

        try:
            return lpr_learning.validate_status(value)
        except ValueError as error:
            raise ValueError(str(error)) from error

    @field_validator("polygon")
    @classmethod
    def validate_polygon(cls, value):
        """Require four finite crop corners when a plate area is present."""

        try:
            return lpr_learning.validate_polygon(value)
        except ValueError as error:
            raise ValueError(str(error)) from error


class LPRReviewRequest(BaseModel):
    """Human answer and optional corrected perspective/text labels."""

    decision: str
    plate_text: Optional[str] = Field(default=None, max_length=100)
    province: Optional[str] = Field(default=None, max_length=100)
    non_plate_reason: Optional[str] = Field(default=None, max_length=64)
    non_plate_reason_detail: Optional[str] = Field(default=None, max_length=300)
    polygon: Optional[list[list[float]]] = None
    crop_base64: Optional[str] = None

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, value: str) -> str:
        """Reject labels that cannot be mapped to a reviewed model target."""

        try:
            return lpr_learning.validate_decision(value)
        except ValueError as error:
            raise ValueError(str(error)) from error

    @field_validator("polygon")
    @classmethod
    def validate_polygon(cls, value):
        """Apply the same perspective geometry contract as machine ingestion."""

        try:
            return lpr_learning.validate_polygon(value)
        except ValueError as error:
            raise ValueError(str(error)) from error


class LPRManualCandidateRequest(BaseModel):
    """Create a reviewable candidate for a legacy event missing AI metadata."""

    camera: Optional[str] = Field(default=None, max_length=200)
    plate_text: Optional[str] = Field(default=None, max_length=100)
    province: Optional[str] = Field(default=None, max_length=100)


class LPRLearningSettingsRequest(BaseModel):
    """Validated settings controlled only by the singular superadministrator."""

    min_new_samples: int = Field(ge=50, le=100000)


class LPRTrainingRequest(BaseModel):
    """Manual training request; automatic requests use the same job schema."""

    detail: Optional[str] = Field(default="manual administrator request", max_length=500)


class LPRRollbackRequest(BaseModel):
    """Select an already validated version for an auditable rollback request."""

    version_id: str = Field(min_length=1, max_length=128)


def _decode_crop(crop_base64: Optional[str]) -> tuple[bytes, str] | None:
    """Decode one bounded raster upload and return bytes plus safe extension.

    The helper accepts a plain base64 body or browser data URL.  Only JPEG, PNG,
    and WebP signatures are persisted; malformed or oversized input is a 422
    client error rather than a silently missing training image.
    """

    if not crop_base64:
        return None
    encoded = crop_base64.split(",", 1)[1] if "," in crop_base64 else crop_base64
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=422, detail="ข้อมูลภาพ crop ไม่ใช่ base64 ที่ถูกต้อง") from error
    if not image_bytes or len(image_bytes) > MAX_CROP_BYTES:
        raise HTTPException(status_code=422, detail="ขนาดภาพ crop ไม่ถูกต้องหรือใหญ่เกินกำหนด")
    if image_bytes.startswith(b"\xff\xd8\xff"):
        extension = ".jpg"
    elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        extension = ".png"
    elif image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        extension = ".webp"
    else:
        raise HTTPException(status_code=422, detail="รองรับเฉพาะภาพ JPEG, PNG หรือ WebP")
    return image_bytes, extension


def _write_unique_image(directory: str, prefix: str, image: tuple[bytes, str]) -> str:
    """Persist one image under a generated non-user-controlled filename."""

    os.makedirs(directory, exist_ok=True)
    image_bytes, extension = image
    # Exclusive creation prevents accidental overwrite even if a random token
    # collides during concurrent machine ingestion.
    for _attempt in range(4):
        filename = f"{prefix}-{secrets.token_hex(12)}{extension}"
        full_path = os.path.join(directory, filename)
        try:
            with open(full_path, "xb") as image_file:
                image_file.write(image_bytes)
            return full_path
        except FileExistsError:
            continue
    raise HTTPException(status_code=503, detail="ไม่สามารถสร้างชื่อไฟล์ภาพที่ไม่ซ้ำได้")


def _operational_crop_path(stored_path: Optional[str]) -> Optional[str]:
    """Resolve a stored crop only when it remains inside the crop directory."""

    if not stored_path:
        return None
    crop_root = os.path.realpath(CROPS_DIR)
    candidate_path = os.path.realpath(
        stored_path if os.path.isabs(stored_path) else os.path.join(CROPS_DIR, stored_path)
    )
    try:
        if os.path.commonpath([crop_root, candidate_path]) != crop_root:
            return None
    except ValueError:
        return None
    return candidate_path


ARCHIVE_CROPS_DIR = os.environ.get("LOCAL_ARCHIVE_CROPS_PATH", "/lpr-archive")


def _crop_media_exists(crop_path: Optional[str]) -> bool:
    """Return True if crop file exists on SSD (/lpr-data/crops) or Tier 2 Archive (/lpr-archive)."""
    if not crop_path:
        return False
    fname = os.path.basename(crop_path)
    p1 = os.path.join(CROPS_DIR, fname)
    if os.path.exists(p1):
        return True
    p2 = os.path.join(ARCHIVE_CROPS_DIR, fname)
    if os.path.exists(p2):
        return True
    return False


def _candidate_payloads_batch(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict]:
    """Return candidates with decoded geometry, links, and reviews using batched SQL queries to avoid N+1 queries."""
    if not rows:
        return []

    candidates = [lpr_learning.decode_json_columns(row) or {} for row in rows]
    candidate_ids = [c["id"] for c in candidates if "id" in c]
    if not candidate_ids:
        return candidates

    links_by_cid = defaultdict(list)
    reviews_by_cid = defaultdict(list)
    alerts_by_cid = defaultdict(list)

    chunk_size = 500
    for i in range(0, len(candidate_ids), chunk_size):
        chunk = candidate_ids[i:i + chunk_size]
        placeholders = ",".join("?" * len(chunk))

        links = conn.execute(
            f"SELECT candidate_id, event_id, relation FROM lpr_candidate_event_links WHERE candidate_id IN ({placeholders}) ORDER BY event_id, relation",
            chunk,
        ).fetchall()
        for link in links:
            links_by_cid[link["candidate_id"]].append({"event_id": link["event_id"], "relation": link["relation"]})

        reviews = conn.execute(
            f"""
            SELECT candidate_id, id, decision, plate_text, province, non_plate_reason,
                   non_plate_reason_detail, polygon_json, reviewer,
                   reviewer_role, is_adjudication, created_at
            FROM lpr_reviews WHERE candidate_id IN ({placeholders}) ORDER BY id
            """,
            chunk,
        ).fetchall()
        for review in reviews:
            reviews_by_cid[review["candidate_id"]].append(lpr_learning.decode_json_columns(review))

        alerts = conn.execute(
            f"""
            SELECT candidate_id, alert_type, watchlist_plate, state, created_at, sent_at
            FROM lpr_alert_outbox WHERE candidate_id IN ({placeholders}) ORDER BY id
            """,
            chunk,
        ).fetchall()
        for alert in alerts:
            alerts_by_cid[alert["candidate_id"]].append({
                "alert_type": alert["alert_type"],
                "watchlist_plate": alert["watchlist_plate"],
                "state": alert["state"],
                "created_at": alert["created_at"],
                "sent_at": alert["sent_at"],
            })

    for candidate in candidates:
        cid = candidate.get("id")
        candidate["event_links"] = links_by_cid.get(cid, [])
        candidate["reviews"] = reviews_by_cid.get(cid, [])
        candidate["watchlist_matches"] = alerts_by_cid.get(cid, [])

    return candidates


def _candidate_payload(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """Return one candidate with decoded geometry, links, and immutable reviews."""
    res = _candidate_payloads_batch(conn, [row])
    return res[0] if res else {}


def _validate_review_content(data: LPRReviewRequest) -> tuple[str, str, str, str]:
    """Normalize text and enforce positive/negative review semantics."""

    plate_text = _normalize_plate(data.plate_text or "")
    province = (data.province or "").strip()
    reason = (data.non_plate_reason or "").strip()
    reason_detail = (data.non_plate_reason_detail or "").strip()
    if data.decision == "readable" and (len(plate_text) < 3 or not province):
        raise HTTPException(
            status_code=422,
            detail="คำตอบอ่านได้ครบถ้วนต้องมีทะเบียนอย่างน้อย 3 ตัวและจังหวัด",
        )
    if data.decision == "partial" and not (plate_text or province):
        raise HTTPException(
            status_code=422,
            detail="คำตอบอ่านได้บางส่วนต้องมีข้อความหรือจังหวัดที่มองเห็นจริง",
        )
    if data.decision in {"non_plate", "unreadable"} and (plate_text or province):
        raise HTTPException(
            status_code=422,
            detail="คำตอบนี้ต้องไม่ใส่ข้อความทะเบียนหรือจังหวัดที่เดา",
        )
    if data.decision == "non_plate":
        try:
            reason = lpr_learning.validate_non_plate_reason(reason)
        except ValueError as error:
            raise HTTPException(
                status_code=422,
                detail="คำตอบไม่ใช่ป้ายทะเบียนต้องระบุสาเหตุจากรายการ",
            ) from error
        if reason == "other" and not reason_detail:
            raise HTTPException(status_code=422, detail="สาเหตุอื่น ๆ ต้องระบุรายละเอียด")
    elif reason or reason_detail:
        raise HTTPException(
            status_code=422,
            detail="ระบุสาเหตุได้เฉพาะคำตอบไม่ใช่ป้ายทะเบียน",
        )
    return plate_text, province, reason, reason_detail


def _post_frigate_json(event_id: str, endpoint: str, payload: dict) -> Optional[str]:
    """Write one Frigate event field and return a visible error message on failure."""

    request_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{FRIGATE_URL}/api/events/{event_id}/{endpoint}",
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            if getattr(response, "status", 200) >= 400:
                return f"{event_id}:{endpoint}:HTTP {response.status}"
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # The review remains durable and the response exposes that Frigate needs
        # a retry; network failure is never silently reported as synchronized.
        return f"{event_id}:{endpoint}:{error}"
    return None


def _sync_frigate_events(
    conn: sqlite3.Connection,
    candidate_id: int,
    decision: str,
    plate_text: str,
    province: str,
) -> list[str]:
    """Synchronize confirmed truth to every linked Frigate event.

    Partial and unreadable answers are intentionally cleared from Frigate's
    searchable plate field.  This function never calls a retain endpoint, so a
    non-plate decision cannot disable or delete the event video.
    """

    rows = conn.execute(
        "SELECT DISTINCT event_id FROM lpr_candidate_event_links WHERE candidate_id = ?",
        (candidate_id,),
    ).fetchall()
    errors: list[str] = []
    for row in rows:
        event_id = row["event_id"]
        if decision == "readable":
            score = 1.0
            display = f"{plate_text} {province}".strip()
            recognized = {"recognizedLicensePlate": plate_text[:100], "recognizedLicensePlateScore": score}
            sub_label = {"subLabel": display[:100], "subLabelScore": score}
        else:
            recognized = {"recognizedLicensePlate": "", "recognizedLicensePlateScore": 1.0}
            # A single space is the existing dashboard's explicit deletion marker.
            sub_label = {"subLabel": " ", "subLabelScore": 1.0}
        for endpoint, payload in (
            ("recognized_license_plate", recognized),
            ("sub_label", sub_label),
        ):
            error = _post_frigate_json(event_id, endpoint, payload)
            if error:
                errors.append(error)
    return errors


def _review_signature(review: sqlite3.Row | dict) -> tuple:
    """Return the fields that determine whether two human answers conflict."""

    # Geometry is an annotation refinement, not a disagreement about truth.
    # Two reviewers who enter the same decision/text/province may choose
    # slightly different perspective corners without escalating to arm215.
    return (
        review["decision"],
        review["plate_text"] or "",
        review["province"] or "",
        review["non_plate_reason"] or "",
        review["non_plate_reason_detail"] or "",
    )


def _latest_reviewer_signatures(conn: sqlite3.Connection, candidate_id: int) -> set[tuple]:
    """Return each ordinary reviewer's latest immutable answer signature."""

    rows = conn.execute(
        """
        SELECT decision, plate_text, province, non_plate_reason,
               non_plate_reason_detail, polygon_json, reviewer
        FROM lpr_reviews
        WHERE candidate_id = ? AND is_adjudication = 0
        ORDER BY id DESC
        """,
        (candidate_id,),
    ).fetchall()
    latest_by_reviewer: dict[str, sqlite3.Row] = {}
    for row in rows:
        latest_by_reviewer.setdefault(row["reviewer"], row)
    return {_review_signature(row) for row in latest_by_reviewer.values()}


def _copy_training_image(
    candidate_id: int,
    source_path: str,
    restricted: bool,
) -> str:
    """Copy a confirmed crop into its durable approved or restricted dataset."""

    target_dir = (
        os.path.join(RESTRICTED_DATASET_DIR, "negative")
        if restricted
        else os.path.join(DATASET_DIR, "approved")
    )
    os.makedirs(target_dir, exist_ok=True)
    extension = os.path.splitext(source_path)[1].lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        extension = ".jpg"
    target = os.path.join(
        target_dir,
        f"candidate-{candidate_id}-{secrets.token_hex(12)}{extension}",
    )
    shutil.copyfile(source_path, target)
    return target


def _materialize_training_examples(
    conn: sqlite3.Connection,
    candidate: sqlite3.Row,
    decision: str,
    plate_text: str,
    province: str,
    non_plate_reason: str,
    non_plate_reason_detail: str,
) -> None:
    """Build approved examples only after one authoritative human decision."""

    candidate_id = int(candidate["id"])
    # Previous examples remain immutable records but are disabled whenever a
    # reviewer corrects or the superadministrator adjudicates the candidate.
    conn.execute(
        "UPDATE lpr_training_examples SET approved = 0 WHERE candidate_id = ?",
        (candidate_id,),
    )
    source_path = _operational_crop_path(candidate["crop_path"])
    if not source_path or not os.path.isfile(source_path):
        return
    restricted = decision == "non_plate"
    training_path = _copy_training_image(candidate_id, source_path, restricted)
    created_at = lpr_learning.utc_now()
    if restricted:
        kinds = [("negative_non_plate", None, None)]
    else:
        kinds = [("plate_detection", None, None)]
        if plate_text:
            kinds.append(("ocr_registration", plate_text, None))
        if province:
            kinds.append(("ocr_province", province, province))
    for kind, label_text, label_province in kinds:
        conn.execute(
            """
            INSERT INTO lpr_training_examples
                (candidate_id, kind, image_path, label_text, province,
                 non_plate_reason, non_plate_reason_detail, approved, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                candidate_id,
                kind,
                training_path,
                label_text,
                label_province,
                non_plate_reason or None,
                non_plate_reason_detail or None,
                created_at,
            ),
        )
    if restricted:
        # The negative copy survives in restricted training storage while the
        # operational crop is removed.  Video retention is deliberately untouched.
        os.remove(source_path)


def _queue_watchlist_alerts(
    conn: sqlite3.Connection,
    candidate: sqlite3.Row,
    decision: str,
    plate_text: str,
    province: str,
) -> None:
    """Queue exact or explicitly tentative watchlist matches after human review.

    A partial answer is never promoted to a confirmed hit.  It can only create
    a ``possible_partial_match`` message for a human to inspect.  Unreadable and
    non-plate answers cancel any alert that has not already left the outbox.
    """

    candidate_id = int(candidate["id"])
    conn.execute(
        """
        UPDATE lpr_alert_outbox SET state = 'cancelled'
        WHERE candidate_id = ? AND state IN ('queued','sending','failed')
        """,
        (candidate_id,),
    )
    if decision not in {"readable", "partial"} or not plate_text:
        return

    rows = conn.execute(
        """
        SELECT plate, plate_display, danger_level
        FROM watchlist WHERE active = 1 ORDER BY id
        """
    ).fetchall()
    if decision == "readable":
        matches = [row for row in rows if _normalize_plate(row["plate"]) == plate_text]
        alert_type = "confirmed_match"
    else:
        # Two visible characters is the minimum useful partial comparison.  We
        # only use contiguous text, avoiding fuzzy edits that would turn a weak
        # crop into an invented match.
        matches = [
            row for row in rows
            if len(plate_text) >= 2 and plate_text in _normalize_plate(row["plate"])
        ][:20]
        alert_type = "possible_partial_match"

    image_path = _operational_crop_path(candidate["crop_path"])
    for row in matches:
        normalized = _normalize_plate(row["plate"])
        payload = {
            "candidate_id": candidate_id,
            "event_id": candidate["event_id"],
            "camera": candidate["camera"] or "unknown",
            "observed_plate": plate_text,
            "province": province,
            "watchlist_plate": normalized,
            "watchlist_display": row["plate_display"] or normalized,
            "danger_level": row["danger_level"] or "medium",
            "confirmed": alert_type == "confirmed_match",
        }
        conn.execute(
            """
            INSERT INTO lpr_alert_outbox
                (candidate_id, alert_type, watchlist_plate, payload_json,
                 image_path, state, attempts, created_at)
            VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)
            ON CONFLICT(candidate_id, alert_type, watchlist_plate) DO UPDATE SET
                payload_json = excluded.payload_json,
                image_path = excluded.image_path,
                state = CASE
                    WHEN lpr_alert_outbox.state = 'sent' THEN 'sent'
                    ELSE 'queued'
                END,
                last_error = NULL
            """,
            (
                candidate_id,
                alert_type,
                normalized,
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                image_path,
                lpr_learning.utc_now(),
            ),
        )
        if alert_type == "confirmed_match":
            already_logged = conn.execute(
                """
                SELECT 1 FROM watchlist_history
                WHERE plate = ? AND camera = ? AND detected_at = ? LIMIT 1
                """,
                (normalized, payload["camera"], candidate["created_at"]),
            ).fetchone()
            if not already_logged:
                conn.execute(
                    """
                    INSERT INTO watchlist_history (plate, camera, detected_at, confidence)
                    VALUES (?, ?, ?, 1.0)
                    """,
                    (normalized, payload["camera"], candidate["created_at"]),
                )


def _apply_authoritative_review(
    conn: sqlite3.Connection,
    candidate: sqlite3.Row,
    data: LPRReviewRequest,
    plate_text: str,
    province: str,
    non_plate_reason: str,
    non_plate_reason_detail: str,
    review_state: str,
) -> list[str]:
    """Apply one confirmed/adjudicated answer and synchronize linked events."""

    candidate_id = int(candidate["id"])
    status_by_decision = {
        "non_plate": "not_found",
        "unreadable": "detected_unreadable",
        "partial": "partial",
        "readable": "readable",
    }
    polygon = data.polygon
    conn.execute(
        """
        UPDATE lpr_candidates
        SET status = ?, review_state = ?, plate_text = ?, province = ?,
            non_plate_reason = ?, non_plate_reason_detail = ?,
            polygon_json = COALESCE(?, polygon_json), operational_visible = ?,
            human_confirmed = 1, updated_at = ?
        WHERE id = ?
        """,
        (
            status_by_decision[data.decision],
            review_state,
            plate_text or None,
            province or None,
            non_plate_reason or None,
            non_plate_reason_detail or None,
            json.dumps(polygon, separators=(",", ":")) if polygon else None,
            0 if data.decision == "non_plate" else 1,
            lpr_learning.utc_now(),
            candidate_id,
        ),
    )
    _materialize_training_examples(
        conn,
        candidate,
        data.decision,
        plate_text,
        province,
        non_plate_reason,
        non_plate_reason_detail,
    )
    _queue_watchlist_alerts(conn, candidate, data.decision, plate_text, province)
    if data.decision == "non_plate":
        conn.execute("UPDATE lpr_candidates SET crop_path = NULL WHERE id = ?", (candidate_id,))
    return _sync_frigate_events(conn, candidate_id, data.decision, plate_text, province)


@app.get("/watchlist/lpr/pending_vigi_lpr")
def get_pending_vigi_lpr(_service: None = Depends(require_internal_service)):
    """Fetch VIGI events that need server-side LPR processing."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, event_id, camera, crop_path
            FROM lpr_candidates
            WHERE source = 'vigi_edge_ai' AND status = 'pending_review' AND review_state = 'pending'
            LIMIT 50
            """
        ).fetchall()
        return [row_to_dict(r) for r in rows]


WEAK_ALERT_COOLDOWN_MINUTES = 5


def _watchlist_matches(
    conn: sqlite3.Connection, plate_text: str
) -> list[tuple[sqlite3.Row, str]]:
    """Active watchlist rows matched by ``plate_text`` with their alert tier.

    ADR 0030: exact (letters+digits), letters_partial (full digit group plus at
    least one letter in place) and digits_only (full digit group, >= 3 digits).
    Province is deliberately ignored.  No substring or fuzzy digit comparison.
    Exact matches are returned first so the strongest evidence leads.
    """

    if not plate_text or len(plate_text) < 3:
        return []
    rows = conn.execute(
        "SELECT plate, plate_display, danger_level FROM watchlist WHERE active = 1 ORDER BY id"
    ).fetchall()
    matches = []
    for row in rows:
        tier = lpr_learning.match_tier(plate_text, _normalize_plate(row["plate"]))
        if tier:
            matches.append((row, tier))
    matches.sort(key=lambda item: item[1] != lpr_learning.TIER_EXACT)
    return matches[:20]


def _queue_ai_unconfirmed_alerts(
    conn: sqlite3.Connection,
    candidate_id: int,
    event_id: str,
    camera: str,
    plate_text: str,
    image_path: Optional[str],
    matches: list[tuple[sqlite3.Row, str]],
    province: str = "",
    confidence: Optional[float] = None,
) -> None:
    """Queue immediate, clearly unconfirmed alerts for an AI watchlist match.

    Weak tiers (letters_partial / digits_only) are rate limited per watchlist
    plate and camera because one passing vehicle is read slightly differently
    in every frame; the exact tier is never suppressed.

    ADR-0031: Ingests exact and letters_partial observations into watchlist_history
    with a 3-minute cooldown per (watchlist_plate + camera).
    """

    for row, tier in matches:
        normalized = _normalize_plate(row["plate"])
        if tier in lpr_learning.WEAK_TIERS:
            recent = conn.execute(
                """
                SELECT 1 FROM lpr_alert_outbox
                WHERE watchlist_plate = ? AND state != 'cancelled'
                  AND json_extract(payload_json, '$.camera') = ?
                  AND json_extract(payload_json, '$.tier') IN ('letters_partial', 'digits_only')
                  AND datetime(created_at) >= datetime('now', ?)
                LIMIT 1
                """,
                (normalized, camera or "unknown", f"-{WEAK_ALERT_COOLDOWN_MINUTES} minutes"),
            ).fetchone()
            if recent:
                continue
        payload = {
            "candidate_id": candidate_id,
            "event_id": event_id,
            "camera": camera or "unknown",
            "observed_plate": plate_text,
            "province": province or "",
            "watchlist_plate": normalized,
            "watchlist_display": row["plate_display"] or normalized,
            "danger_level": row["danger_level"] or "medium",
            "confirmed": False,
            "unconfirmed_ai": True,
            "tier": tier,
        }
        conn.execute(
            """
            INSERT INTO lpr_alert_outbox
                (candidate_id, alert_type, watchlist_plate, payload_json,
                 image_path, state, attempts, created_at)
            VALUES (?, 'possible_partial_match', ?, ?, ?, 'queued', 0, ?)
            ON CONFLICT(candidate_id, alert_type, watchlist_plate) DO NOTHING
            """,
            (
                candidate_id,
                normalized,
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                image_path,
                lpr_learning.utc_now(),
            ),
        )

        # ADR-0031: Ingest into watchlist_history for exact and letters_partial tiers
        if tier in (lpr_learning.TIER_EXACT, lpr_learning.TIER_LETTERS):
            cutoff_hist = (datetime.datetime.now() - datetime.timedelta(minutes=3)).strftime("%Y-%m-%d %H:%M:%S")
            recent_hist = conn.execute(
                """
                SELECT 1 FROM watchlist_history
                WHERE plate = ? AND camera = ? AND detected_at >= ?
                LIMIT 1
                """,
                (normalized, camera or "unknown", cutoff_hist),
            ).fetchone()
            if not recent_hist:
                now_ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                conf_val = float(confidence) if confidence is not None else 0.85
                if conf_val <= 1.0:
                    conf_val = conf_val * 100.0
                conn.execute(
                    """
                    INSERT INTO watchlist_history (plate, camera, detected_at, confidence, observed_plate, match_tier)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (normalized, camera or "unknown", now_ts, conf_val, plate_text or normalized, tier),
                )



@app.post("/watchlist/lpr/candidates", status_code=201)
def create_lpr_candidate(
    data: LPRCandidateRequest,
    _service: None = Depends(require_internal_service),
):
    """Persist an AI observation as pending, never as approved training truth."""

    plate_text = _normalize_plate(data.plate_text or "")
    province = (data.province or "").strip()
    if data.status == "readable" and (len(plate_text) < 3 or not province):
        raise HTTPException(status_code=422, detail="AI readable ต้องมีทะเบียนและจังหวัดที่สมเหตุสมผล")
    if data.status == "partial" and not (plate_text or province):
        raise HTTPException(status_code=422, detail="AI partial ต้องมีส่วนที่อ่านได้จริง")
    if data.status in {"not_found", "detected_unreadable"}:
        plate_text, province = "", ""
    polygon = lpr_learning.validate_polygon(data.polygon)
    if data.status != "not_found" and polygon is None:
        raise HTTPException(status_code=422, detail="รายการที่พบป้ายต้องมีกรอบสี่มุม")
    decoded_crop = _decode_crop(data.crop_base64)
    if data.status != "not_found" and decoded_crop is None:
        raise HTTPException(status_code=422, detail="รายการที่พบป้ายต้องมีภาพ crop")
    try:
        if data.status != "not_found" and not (data.event_id.startswith("vigi_") or data.event_id.startswith("ext_")):
            try:
                req = urllib.request.Request(f"{FRIGATE_URL}/api/events/{data.event_id}/clip.mp4", method="HEAD")
                with urllib.request.urlopen(req, timeout=2) as r:
                    if getattr(r, "status", 200) == 404:
                        raise HTTPException(status_code=422, detail="เหตุการณ์นี้ไม่มีไฟล์วิดีโอ ไม่สามารถบันทึก candidate ได้")
            except urllib.error.HTTPError as he:
                if he.code == 404:
                    raise HTTPException(status_code=422, detail="เหตุการณ์นี้ไม่มีไฟล์วิดีโอ ไม่สามารถบันทึก candidate ได้")
    except HTTPException:
        raise
    except Exception:
        pass
    crop_path = None
    if decoded_crop:
        stored = _write_unique_image(CROPS_DIR, "candidate", decoded_crop)
        crop_path = os.path.basename(stored)
    timestamp = lpr_learning.utc_now()
    committed = False
    try:
        with get_conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            # ADR 0025 (amended) + ADR 0030: a Partial Plate (no province) is
            # archived as logged-only unless it matches an active watchlist
            # plate at any alert tier; then it waits for review and alerts.  A
            # Readable Plate always waits for review, and now also alerts
            # immediately (unconfirmed) when it matches the watchlist.
            review_state = "pending"
            watch_hits = []
            if data.status in ("partial", "readable"):
                watch_hits = _watchlist_matches(conn, plate_text)
                if data.status == "partial" and not watch_hits:
                    review_state = "adjudicated"
            existing = None
            if data.observation_key:
                existing = conn.execute(
                    """
                    SELECT c.* FROM lpr_candidates c
                    JOIN lpr_candidate_observation_keys k ON k.candidate_id = c.id
                    WHERE k.observation_key = ?
                    """,
                    (data.observation_key,),
                ).fetchone()
            if not existing:
                existing = conn.execute(
                    """
                    SELECT * FROM lpr_candidates
                    WHERE event_id = ? AND review_state IN ('pending', 'pending_lpr')
                    """,
                    (data.event_id,),
                ).fetchone()
            # ADR-0029: Cooldown deduplication for identical plate on same camera within 45 seconds
            if not existing and plate_text:
                existing = conn.execute(
                    """
                    SELECT * FROM lpr_candidates
                    WHERE camera = ? AND plate_text = ?
                      AND datetime(created_at) >= datetime(?, '-45 seconds')
                    ORDER BY id DESC LIMIT 1
                    """,
                    (data.camera, plate_text, timestamp),
                ).fetchone()
            if existing:
                candidate_id = int(existing["id"])
                # If existing candidate is already adjudicated or confirmed, link this new event ID without creating duplicate candidate row
                if int(existing["human_confirmed"]) == 1 or existing["review_state"] not in {"pending", "pending_lpr"}:
                    conn.execute(
                        "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'vehicle')",
                        (candidate_id, data.event_id),
                    )
                    conn.commit()
                    committed = True
                    orphan_path = _operational_crop_path(crop_path)
                    if orphan_path and os.path.isfile(orphan_path):
                        os.remove(orphan_path)
                    return _candidate_payload(conn, existing)
                conn.execute(
                    """
                    UPDATE lpr_candidates
                    SET camera = ?, status = ?, plate_text = ?, province = ?,
                        detector_confidence = ?, ocr_confidence = ?, polygon_json = ?,
                        crop_path = ?, operational_visible = ?, model_version = ?,
                        review_state = ?,
                        vehicle_color = COALESCE(?, vehicle_color),
                        vehicle_type = COALESCE(?, vehicle_type),
                        vehicle_brand = COALESCE(?, vehicle_brand),
                        vehicle_model = COALESCE(?, vehicle_model),
                        description = COALESCE(?, description),
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        data.camera,
                        data.status,
                        plate_text or None,
                        province or None,
                        data.detector_confidence,
                        data.ocr_confidence,
                        json.dumps(polygon, separators=(",", ":")) if polygon else None,
                        crop_path,
                        0 if data.status == "not_found" else 1,
                        data.model_version,
                        review_state,
                        data.vehicle_color,
                        data.vehicle_type,
                        data.vehicle_brand,
                        data.vehicle_model,
                        data.description,
                        timestamp,
                        candidate_id,
                    ),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'primary')",
                    (candidate_id, data.event_id),
                )
                for link in data.linked_events:
                    conn.execute(
                        "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, ?)",
                        (candidate_id, link.event_id, link.relation),
                    )
                if watch_hits:
                    _queue_ai_unconfirmed_alerts(
                        conn, candidate_id, data.event_id, data.camera, plate_text,
                        _operational_crop_path(crop_path), watch_hits, province,
                        confidence=data.ocr_confidence or data.detector_confidence,
                    )
                conn.commit()
                committed = True
                old_path = _operational_crop_path(existing["crop_path"])
                new_path = _operational_crop_path(crop_path)
                if old_path and old_path != new_path and os.path.isfile(old_path):
                    os.remove(old_path)
                row = conn.execute(
                    "SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)
                ).fetchone()
                return _candidate_payload(conn, row)
            cursor = conn.execute(
                """
                INSERT INTO lpr_candidates
                    (event_id, camera, status, plate_text, province,
                     detector_confidence, ocr_confidence, polygon_json, crop_path,
                     operational_visible, source, model_version,
                     vehicle_color, vehicle_type, vehicle_brand, vehicle_model, description,
                     created_at, updated_at, review_state)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data.event_id,
                    data.camera,
                    data.status,
                    plate_text or None,
                    province or None,
                    data.detector_confidence,
                    data.ocr_confidence,
                    json.dumps(polygon, separators=(",", ":")) if polygon else None,
                    crop_path,
                    0 if data.status == "not_found" else 1,
                    data.model_version,
                    data.vehicle_color,
                    data.vehicle_type,
                    data.vehicle_brand,
                    data.vehicle_model,
                    data.description,
                    timestamp,
                    timestamp,
                    review_state,
                ),
            )
            candidate_id = int(cursor.lastrowid)
            if data.observation_key:
                conn.execute(
                    "INSERT INTO lpr_candidate_observation_keys (observation_key, candidate_id) VALUES (?, ?)",
                    (data.observation_key, candidate_id),
                )
            conn.execute(
                "INSERT INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'primary')",
                (candidate_id, data.event_id),
            )
            for link in data.linked_events:
                conn.execute(
                    "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, ?)",
                    (candidate_id, link.event_id, link.relation),
                )
            if watch_hits:
                _queue_ai_unconfirmed_alerts(
                    conn, candidate_id, data.event_id, data.camera, plate_text,
                    _operational_crop_path(crop_path), watch_hits, province,
                    confidence=data.ocr_confidence or data.detector_confidence,
                )
            conn.commit()
            committed = True
            row = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
            return _candidate_payload(conn, row)
    except Exception:
        # A database failure must not leave an orphaned operational crop.
        orphan_path = _operational_crop_path(crop_path)
        if not committed and orphan_path and os.path.isfile(orphan_path):
            os.remove(orphan_path)
        raise


@app.post("/watchlist/lpr/alerts/recover")
def recover_lpr_alerts(_service: None = Depends(require_internal_service)):
    """Return alerts interrupted mid-delivery (worker restart) to the queue."""

    with get_conn() as conn:
        changed = conn.execute(
            "UPDATE lpr_alert_outbox SET state = 'queued' WHERE state = 'sending'"
        ).rowcount
        conn.commit()
    return {"recovered": changed}


@app.post("/watchlist/lpr/alerts/claim")
def claim_lpr_alert(_service: None = Depends(require_internal_service)):
    """Atomically claim the oldest queued alert for the delivery worker.

    Uses the same ``queued -> sending`` compare-and-set as the training worker,
    so two consumers can never deliver one alert twice.  The crop is returned
    inline (bounded) because only this service can read the crop directory.
    """

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            """
            SELECT * FROM lpr_alert_outbox
            WHERE state = 'queued' AND attempts < 5 ORDER BY id LIMIT 1
            """
        ).fetchone()
        if not row:
            conn.rollback()
            return {"alert": None}
        changed = conn.execute(
            """
            UPDATE lpr_alert_outbox SET state = 'sending', attempts = attempts + 1
            WHERE id = ? AND state = 'queued'
            """,
            (row["id"],),
        ).rowcount
        if changed != 1:
            conn.rollback()
            return {"alert": None}
        conn.commit()
        image_b64 = ""
        image_path = _operational_crop_path(row["image_path"])
        if image_path and os.path.isfile(image_path):
            try:
                with open(image_path, "rb") as handle:
                    raw = handle.read(2_000_000)
                image_b64 = base64.b64encode(raw).decode("ascii")
            except OSError:
                image_b64 = ""
        return {
            "alert": {
                "id": int(row["id"]),
                "alert_type": row["alert_type"],
                "payload": json.loads(row["payload_json"]),
                "image_b64": image_b64,
                "attempts": int(row["attempts"]) + 1,
                "discord_sent": int(row["discord_sent"]),
                "telegram_sent": int(row["telegram_sent"]),
            }
        }


class LPRAlertResult(BaseModel):
    ok: bool
    discord_sent: bool = False
    telegram_sent: bool = False
    error: Optional[str] = Field(default=None, max_length=300)


@app.post("/watchlist/lpr/alerts/{alert_id}/result")
def report_lpr_alert_result(
    alert_id: int,
    data: LPRAlertResult,
    _service: None = Depends(require_internal_service),
):
    """Persist per-channel delivery so a retry never repeats a sent channel."""

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT attempts FROM lpr_alert_outbox WHERE id = ? AND state = 'sending'",
            (alert_id,),
        ).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="ไม่พบรายการแจ้งเตือนที่กำลังส่ง")
        if data.ok:
            conn.execute(
                """
                UPDATE lpr_alert_outbox
                SET state = 'sent', sent_at = ?, last_error = NULL,
                    discord_sent = MAX(discord_sent, ?), telegram_sent = MAX(telegram_sent, ?)
                WHERE id = ?
                """,
                (lpr_learning.utc_now(), int(data.discord_sent), int(data.telegram_sent), alert_id),
            )
        else:
            state = "queued" if int(row["attempts"]) < 5 else "failed"
            conn.execute(
                """
                UPDATE lpr_alert_outbox
                SET state = ?, last_error = ?,
                    discord_sent = MAX(discord_sent, ?), telegram_sent = MAX(telegram_sent, ?)
                WHERE id = ?
                """,
                (
                    state,
                    (data.error or "delivery failed")[:300],
                    int(data.discord_sent),
                    int(data.telegram_sent),
                    alert_id,
                ),
            )
        conn.commit()
    return {"status": "ok"}


@app.get("/watchlist/lpr/events/{event_id}/candidates")
def list_event_lpr_candidates(
    event_id: str,
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """List visible candidates linked to one event, including multiple plates."""

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT c.* FROM lpr_candidates c
            JOIN lpr_candidate_event_links l ON l.candidate_id = c.id
            WHERE l.event_id = ? AND c.operational_visible = 1
            ORDER BY c.id
            """,
            (event_id,),
        ).fetchall()
        if not rows:
            # Fallback 1: Direct match on lpr_candidates table
            rows = conn.execute(
                "SELECT * FROM lpr_candidates WHERE event_id = ? AND operational_visible = 1 ORDER BY id",
                (event_id,),
            ).fetchall()
        if not rows:
            # Fallback 2: Co-temporal vehicle pass fallback (split tracks e.g. car + truck)
            match = re.match(r"^(\d+(\.\d+)?)", event_id)
            if match:
                event_ts = float(match.group(1))
                
                # Retrieve camera for the current event_id from Frigate
                target_camera = None
                try:
                    event_req = urllib.request.Request(f"{FRIGATE_URL}/api/events/{event_id}", method="GET")
                    with urllib.request.urlopen(event_req, timeout=2) as r:
                        event_data = json.loads(r.read().decode("utf-8"))
                        target_camera = event_data.get("camera")
                except Exception:
                    pass
                
                if target_camera:
                    fallback_rows = conn.execute(
                        """
                        SELECT DISTINCT c.* FROM lpr_candidates c
                        WHERE c.operational_visible = 1
                          AND c.camera = ?
                          AND abs(strftime('%s', c.created_at) - ?) <= 45
                        ORDER BY abs(strftime('%s', c.created_at) - ?) ASC
                        LIMIT 1
                        """,
                        (target_camera, int(event_ts), int(event_ts)),
                    ).fetchall()
                else:
                    fallback_rows = []
                    
                if fallback_rows:
                    rows = fallback_rows
                    conn.execute(
                        "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'vehicle')",
                        (fallback_rows[0]["id"], event_id),
                    )
                    conn.commit()
        return [_candidate_payload(conn, row) for row in rows]


@app.post("/watchlist/lpr/events/{event_id}/manual-candidate", status_code=201)
def create_manual_lpr_candidate(
    event_id: str,
    data: LPRManualCandidateRequest,
    identity: TrustedIdentity = Depends(require_admin),
):
    """Make a legacy event reviewable without inventing an AI observation.

    The browser supplies the actual crop with the subsequent immutable review.
    Repeated clicks return the same pending candidate so an administrator cannot
    accidentally create duplicate training examples for one legacy event.
    """

    timestamp = lpr_learning.utc_now()
    plate_text = _normalize_plate(data.plate_text or "")
    province = (data.province or "").strip()
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            """
            SELECT c.* FROM lpr_candidates c
            JOIN lpr_candidate_event_links l ON l.candidate_id = c.id
            WHERE l.event_id = ? AND c.operational_visible = 1
            ORDER BY c.id LIMIT 1
            """,
            (event_id,),
        ).fetchone()
        if existing:
            conn.commit()
            return _candidate_payload(conn, existing)
        cursor = conn.execute(
            """
            INSERT INTO lpr_candidates
                (event_id, camera, status, review_state, plate_text, province,
                 operational_visible, human_confirmed, source, created_at, updated_at)
            VALUES (?, ?, 'pending_review', 'pending', ?, ?, 1, 0,
                    'manual-review', ?, ?)
            """,
            (
                event_id,
                data.camera,
                plate_text or None,
                province or None,
                timestamp,
                timestamp,
            ),
        )
        candidate_id = int(cursor.lastrowid)
        conn.execute(
            """
            INSERT INTO lpr_candidate_event_links (candidate_id, event_id, relation)
            VALUES (?, ?, 'primary')
            """,
            (candidate_id, event_id),
        )
        conn.commit()
        candidate = conn.execute(
            "SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)
        ).fetchone()
        payload = _candidate_payload(conn, candidate)
    send_audit(
        identity.username,
        "CREATE_MANUAL_LPR_CANDIDATE",
        f"event={event_id} candidate={candidate_id}",
        identity.client_ip,
    )
    return payload


@app.get("/watchlist/lpr/review-queue")
def list_lpr_review_queue(
    state: Optional[str] = Query(default=None),
    _admin: TrustedIdentity = Depends(require_admin),
):
    """Return AI-only pending/conflicting items for the administrator queue."""

    if state and state not in {"pending", "conflict"}:
        raise HTTPException(status_code=422, detail="state ต้องเป็น pending หรือ conflict")
    with get_conn() as conn:
        # A conflict remains in the queue even after an earlier matching answer
        # temporarily confirmed it; human confirmation is revoked on conflict.
        conditions = ["human_confirmed = 0"]
        parameters: list[object] = []
        if state:
            conditions.append("review_state = ?")
            parameters.append(state)
        rows = conn.execute(
            f"SELECT * FROM lpr_candidates WHERE {' AND '.join(conditions)} ORDER BY updated_at, id",
            parameters,
        ).fetchall()
        return _candidate_payloads_batch(conn, rows)


@app.get("/watchlist/lpr/candidates")
def list_lpr_candidates_for_archive(
    bucket: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=2000, ge=1, le=5000),
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """Return bounded candidate metadata for same-page archive filtering and search."""

    bucket_conditions = {
        "ai_pending": "human_confirmed = 0 AND review_state = 'pending' AND status = 'readable'",
        "partial": "status = 'partial'",
        "unreadable": "status = 'detected_unreadable'",
        "confirmed": "human_confirmed = 1 AND status = 'readable'",
        "non_plate": "status = 'not_found' OR operational_visible = 0",
        "conflict": "review_state = 'conflict'",
    }
    if bucket and bucket not in bucket_conditions:
        raise HTTPException(status_code=422, detail="bucket ของ LPR ไม่ถูกต้อง")
    
    conditions = []
    params = []
    if bucket:
        conditions.append(bucket_conditions[bucket])
    else:
        conditions.append("operational_visible = 1")
    if source and source.strip():
        conditions.append("source = ?")
        params.append(source.strip())
    if q and q.strip():
        tokens = [t.strip() for t in q.strip().split() if t.strip()]
        for token in tokens:
            term = f"%{token}%"
            conditions.append(
                "(plate_text LIKE ? OR province LIKE ? OR camera LIKE ? OR event_id LIKE ? OR "
                "vehicle_color LIKE ? OR vehicle_type LIKE ? OR vehicle_brand LIKE ? OR "
                "vehicle_model LIKE ? OR description LIKE ?)"
            )
            params.extend([term, term, term, term, term, term, term, term, term])
    
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM lpr_candidates {where} ORDER BY updated_at DESC, id DESC LIMIT ?",
            tuple(params),
        ).fetchall()
        batch = _candidate_payloads_batch(conn, rows)
        return [c for c in batch if _crop_media_exists(c.get("crop_path"))]


@app.get("/watchlist/lpr/candidates/{candidate_id}")
def get_lpr_candidate(
    candidate_id: int,
    _identity: TrustedIdentity = Depends(require_trusted_identity),
):
    """Return one candidate and its complete review audit trail."""

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="ไม่พบรายการป้ายทะเบียน")
        return _candidate_payload(conn, row)


@app.post("/watchlist/lpr/candidates/{candidate_id}/reviews")
def review_lpr_candidate(
    candidate_id: int,
    data: LPRReviewRequest,
    identity: TrustedIdentity = Depends(require_admin),
):
    """Append an immutable admin answer and train only when answers agree."""

    plate_text, province, non_plate_reason, non_plate_reason_detail = (
        _validate_review_content(data)
    )
    decoded_crop = _decode_crop(data.crop_base64)
    sync_errors: list[str] = []
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        candidate = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not candidate:
            raise HTTPException(status_code=404, detail="ไม่พบรายการป้ายทะเบียน")
        crop_path = candidate["crop_path"]
        if decoded_crop:
            stored = _write_unique_image(CROPS_DIR, f"candidate-{candidate_id}-review", decoded_crop)
            replacement = os.path.basename(stored)
            conn.execute(
                "UPDATE lpr_candidates SET crop_path = ?, updated_at = ? WHERE id = ?",
                (replacement, lpr_learning.utc_now(), candidate_id),
            )
            old_path = _operational_crop_path(crop_path)
            if old_path and os.path.isfile(old_path):
                os.remove(old_path)
            crop_path = replacement
            candidate = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not _operational_crop_path(crop_path):
            raise HTTPException(status_code=422, detail="ต้องมีภาพตัวอย่างก่อนยืนยันคำตอบ")
        polygon_json = json.dumps(data.polygon, separators=(",", ":")) if data.polygon else candidate["polygon_json"]
        conn.execute(
            """
            INSERT INTO lpr_reviews
                (candidate_id, decision, plate_text, province, non_plate_reason,
                 non_plate_reason_detail, polygon_json,
                 reviewer, reviewer_role, is_adjudication, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                candidate_id,
                data.decision,
                plate_text or None,
                province or None,
                non_plate_reason or None,
                non_plate_reason_detail or None,
                polygon_json,
                identity.username,
                identity.role,
                lpr_learning.utc_now(),
            ),
        )
        signatures = _latest_reviewer_signatures(conn, candidate_id)
        if len(signatures) > 1:
            conn.execute(
                """
                UPDATE lpr_candidates
                SET review_state = 'conflict', human_confirmed = 0, updated_at = ?
                WHERE id = ?
                """,
                (lpr_learning.utc_now(), candidate_id),
            )
            conn.execute(
                "UPDATE lpr_training_examples SET approved = 0 WHERE candidate_id = ?",
                (candidate_id,),
            )
            conn.execute(
                """
                UPDATE lpr_alert_outbox SET state = 'cancelled'
                WHERE candidate_id = ? AND state IN ('queued','sending','failed')
                """,
                (candidate_id,),
            )
        else:
            sync_errors = _apply_authoritative_review(
                conn,
                candidate,
                data,
                plate_text,
                province,
                non_plate_reason,
                non_plate_reason_detail,
                "confirmed",
            )
        conn.commit()
        result = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        payload = _candidate_payload(conn, result)
    send_audit(
        identity.username,
        "REVIEW_LPR_CANDIDATE",
        f"candidate={candidate_id} decision={data.decision} state={payload['review_state']}",
        identity.client_ip,
    )
    payload["frigate_sync_errors"] = sync_errors
    return payload


@app.post("/watchlist/lpr/candidates/{candidate_id}/adjudicate")
def adjudicate_lpr_candidate(
    candidate_id: int,
    data: LPRReviewRequest,
    identity: TrustedIdentity = Depends(require_superadmin),
):
    """Let the singular superadministrator resolve a conflicting answer."""

    plate_text, province, non_plate_reason, non_plate_reason_detail = (
        _validate_review_content(data)
    )
    decoded_crop = _decode_crop(data.crop_base64)
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        candidate = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        if not candidate:
            raise HTTPException(status_code=404, detail="ไม่พบรายการป้ายทะเบียน")
        if candidate["review_state"] != "conflict":
            raise HTTPException(status_code=409, detail="รายการนี้ไม่มีคำตอบขัดแย้งที่ต้องตัดสิน")
        if decoded_crop:
            stored = _write_unique_image(CROPS_DIR, f"candidate-{candidate_id}-adjudicated", decoded_crop)
            replacement = os.path.basename(stored)
            old_path = _operational_crop_path(candidate["crop_path"])
            conn.execute("UPDATE lpr_candidates SET crop_path = ? WHERE id = ?", (replacement, candidate_id))
            if old_path and os.path.isfile(old_path):
                os.remove(old_path)
            candidate = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        polygon_json = json.dumps(data.polygon, separators=(",", ":")) if data.polygon else candidate["polygon_json"]
        conn.execute(
            """
            INSERT INTO lpr_reviews
                (candidate_id, decision, plate_text, province, non_plate_reason,
                 non_plate_reason_detail, polygon_json,
                 reviewer, reviewer_role, is_adjudication, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                candidate_id,
                data.decision,
                plate_text or None,
                province or None,
                non_plate_reason or None,
                non_plate_reason_detail or None,
                polygon_json,
                identity.username,
                identity.role,
                lpr_learning.utc_now(),
            ),
        )
        sync_errors = _apply_authoritative_review(
            conn,
            candidate,
            data,
            plate_text,
            province,
            non_plate_reason,
            non_plate_reason_detail,
            "adjudicated",
        )
        conn.commit()
        result = conn.execute("SELECT * FROM lpr_candidates WHERE id = ?", (candidate_id,)).fetchone()
        payload = _candidate_payload(conn, result)
    send_audit(
        identity.username,
        "ADJUDICATE_LPR_CANDIDATE",
        f"candidate={candidate_id} decision={data.decision}",
        identity.client_ip,
    )
    payload["frigate_sync_errors"] = sync_errors
    return payload


@app.get("/watchlist/lpr/dataset")
def get_lpr_dataset(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """List only human-approved training metadata for privileged users."""

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT e.id, e.candidate_id, e.kind, e.label_text, e.province,
                   e.non_plate_reason, e.non_plate_reason_detail,
                   e.approved, e.used_model_version, e.created_at,
                   c.event_id, c.camera, c.review_state
            FROM lpr_training_examples e
            JOIN lpr_candidates c ON c.id = e.candidate_id
            ORDER BY e.id DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


@app.get("/watchlist/lpr/learning/settings")
def get_lpr_learning_settings(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """Expose current learning thresholds without revealing credentials or files."""

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT key, value, updated_at, updated_by FROM lpr_learning_settings ORDER BY key"
        ).fetchall()
        return {row["key"]: row_to_dict(row) for row in rows}


@app.put("/watchlist/lpr/learning/settings")
def update_lpr_learning_settings(
    data: LPRLearningSettingsRequest,
    identity: TrustedIdentity = Depends(require_superadmin),
):
    """Update the adjustable sample threshold under superadmin control."""

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO lpr_learning_settings (key, value, updated_at, updated_by)
            VALUES ('min_new_samples', ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (str(data.min_new_samples), lpr_learning.utc_now(), identity.username),
        )
        conn.commit()
    send_audit(
        identity.username,
        "UPDATE_LPR_LEARNING_SETTINGS",
        f"min_new_samples={data.min_new_samples}",
        identity.client_ip,
    )
    return {"status": "ok", "min_new_samples": data.min_new_samples}


@app.post("/watchlist/lpr/learning/jobs", status_code=202)
def queue_lpr_training_job(
    data: LPRTrainingRequest,
    identity: TrustedIdentity = Depends(require_admin),
):
    """Queue training from unused, approved human examples without claiming success."""

    with get_conn() as conn:
        sample_count = int(
            conn.execute(
                "SELECT COUNT(*) AS count FROM lpr_training_examples WHERE approved = 1 AND used_model_version IS NULL"
            ).fetchone()["count"]
        )
        if sample_count == 0:
            raise HTTPException(status_code=409, detail="ยังไม่มีตัวอย่างที่คนยืนยันและยังไม่ถูกใช้")
        cursor = conn.execute(
            """
            INSERT INTO lpr_training_jobs
                (state, sample_count, requested_by, progress, detail, created_at)
            VALUES ('queued', ?, ?, 0, ?, ?)
            """,
            (sample_count, identity.username, data.detail, lpr_learning.utc_now()),
        )
        conn.commit()
        job_id = int(cursor.lastrowid)
        try:
            trigger_file = os.path.join(os.path.dirname(DB_PATH), "train.trigger")
            with open(trigger_file, "w", encoding="utf-8") as f:
                f.write(str(job_id))
        except Exception:
            pass
    return {"status": "queued", "job_id": job_id, "sample_count": sample_count}


@app.get("/watchlist/lpr/learning/jobs")
def list_lpr_training_jobs(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """Show queued/running/validated training progress in the administrator UI."""

    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM lpr_training_jobs ORDER BY id DESC LIMIT 200").fetchall()
        return [dict(row) for row in rows]


@app.get("/watchlist/lpr/learning/models")
def list_lpr_model_versions(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """List retained model generations and validation metrics."""

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM lpr_model_versions ORDER BY created_at DESC"
        ).fetchall()
        return [lpr_learning.decode_json_columns(row) for row in rows]


@app.post("/watchlist/lpr/learning/rollback", status_code=202)
def request_lpr_model_rollback(
    data: LPRRollbackRequest,
    identity: TrustedIdentity = Depends(require_superadmin),
):
    """Queue an explicit rollback for the worker instead of swapping files in API."""

    with get_conn() as conn:
        target = conn.execute(
            "SELECT version_id, state FROM lpr_model_versions WHERE version_id = ?",
            (data.version_id,),
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="ไม่พบรุ่นโมเดลที่ต้องการย้อนกลับ")
        if target["state"] == "active":
            raise HTTPException(status_code=409, detail="โมเดลรุ่นนี้ใช้งานอยู่แล้ว")
        if target["state"] != "rolled_back":
            raise HTTPException(status_code=409, detail="ย้อนกลับได้เฉพาะรุ่นที่เคยผ่าน validation และใช้งานแล้ว")
        cursor = conn.execute(
            """
            INSERT INTO lpr_training_jobs
                (state, sample_count, requested_by, progress, candidate_version, detail, created_at)
            VALUES ('queued', 0, ?, 0, ?, 'rollback_requested', ?)
            """,
            (identity.username, data.version_id, lpr_learning.utc_now()),
        )
        conn.commit()
        job_id = int(cursor.lastrowid)
    send_audit(
        identity.username,
        "REQUEST_LPR_MODEL_ROLLBACK",
        f"version={data.version_id} job={job_id}",
        identity.client_ip,
    )
    return {"status": "queued", "job_id": job_id, "version_id": data.version_id}


@app.post("/watchlist/lpr/train-sample")
def reject_legacy_train_sample(
    _admin: TrustedIdentity = Depends(require_admin),
):
    """Reject the obsolete endpoint that bypassed human review semantics."""

    raise HTTPException(
        status_code=410,
        detail="ให้สร้างรายการ candidate แล้วกดยืนยันผลจากหน้าตรวจสอบแทน",
    )


@app.delete("/watchlist/lpr/event/{event_id}")
def delete_lpr_event_crop(
    event_id: str,
    identity: TrustedIdentity = Depends(require_admin),
):
    """Remove legacy operational crops without changing video retention state.

    Reviewed candidates use the explicit ``non_plate`` decision so a restricted
    negative example is created.  This compatibility cleanup only targets old
    one-file-per-event artifacts and never calls Frigate's retain endpoint.
    """

    legacy_path = _operational_crop_path(f"{event_id}.jpg")
    if legacy_path and os.path.isfile(legacy_path):
        os.remove(legacy_path)
    errors: list[str] = []
    for endpoint, payload in (
        ("recognized_license_plate", {"recognizedLicensePlate": "", "recognizedLicensePlateScore": 1.0}),
        ("sub_label", {"subLabel": " ", "subLabelScore": 1.0}),
    ):
        error = _post_frigate_json(event_id, endpoint, payload)
        if error:
            errors.append(error)
    with get_conn() as conn:
        conn.execute("DELETE FROM lpr_training_samples WHERE event_id = ?", (event_id,))
        conn.commit()
    send_audit(
        identity.username,
        "DELETE_LEGACY_LPR_CROP",
        f"event={event_id}",
        identity.client_ip,
    )
    return {"status": "ok", "event_id": event_id, "frigate_sync_errors": errors}




LPR_FACE_RPC_URL = os.environ.get("LPR_FACE_RPC_URL", "http://lpr:5008")


def _call_lpr_face_rpc(method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{LPR_FACE_RPC_URL.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            err_body = json.loads(exc.read().decode("utf-8"))
            raise HTTPException(status_code=exc.code, detail=err_body.get("error", str(exc)))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=exc.code, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Face AI engine unavailable: {exc}")


@app.get("/watchlist/faces")
def watchlist_faces_list(_identity: TrustedIdentity = Depends(require_authenticated)):
    return _call_lpr_face_rpc("GET", "/faces")


@app.get("/watchlist/faces/recent")
def watchlist_faces_recent(_identity: TrustedIdentity = Depends(require_authenticated)):
    return _call_lpr_face_rpc("GET", "/faces/recent")


@app.post("/watchlist/faces/register")
async def watchlist_faces_register(request: Request, _identity: TrustedIdentity = Depends(require_admin)):
    body = await request.json()
    return _call_lpr_face_rpc("POST", "/faces/register", body if isinstance(body, dict) else {})


@app.delete("/watchlist/faces/{person_name}")
def watchlist_faces_delete(person_name: str, _identity: TrustedIdentity = Depends(require_admin)):
    import urllib.parse
    return _call_lpr_face_rpc("DELETE", f"/faces/{urllib.parse.quote(person_name)}")


@app.post("/watchlist/faces/search")
async def watchlist_faces_search(request: Request, _identity: TrustedIdentity = Depends(require_authenticated)):
    body = await request.json()
    return _call_lpr_face_rpc("POST", "/faces/search", body if isinstance(body, dict) else {})


@app.post("/watchlist/faces/compare")
async def watchlist_faces_compare(request: Request, _identity: TrustedIdentity = Depends(require_authenticated)):
    body = await request.json()
    return _call_lpr_face_rpc("POST", "/faces/compare", body if isinstance(body, dict) else {})


@app.post("/watchlist/faces/sync-dossiers")
async def watchlist_faces_sync_dossiers(request: Request, _identity: TrustedIdentity = Depends(require_authenticated)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    return _call_lpr_face_rpc("POST", "/faces/sync-dossiers", body if isinstance(body, dict) else {})


@app.get("/watchlist/faces/cameras")
def watchlist_faces_cameras_get(_identity: TrustedIdentity = Depends(require_authenticated)):
    return _call_lpr_face_rpc("GET", "/faces/cameras")


@app.post("/watchlist/faces/cameras")
async def watchlist_faces_cameras_post(request: Request, _identity: TrustedIdentity = Depends(require_authenticated)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    return _call_lpr_face_rpc("POST", "/faces/cameras", body if isinstance(body, dict) else {})


@app.get("/health")
def health():
    """Health check endpoint — ใช้โดย docker-compose healthcheck"""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Edge LPR & Smart VIGI AI Webhook Gatekeeper Endpoints
# ---------------------------------------------------------------------------
CHANNELS_SETTINGS_FILE = os.environ.get("CHANNELS_SETTINGS_FILE", "/settings-data/channels.json")
CAMERA_WEBHOOK_SECRET = os.environ.get("CAMERA_WEBHOOK_SECRET", "bpp_secret_2026")
BLOCKED_WEBHOOK_CAMERAS_FILE = os.environ.get("BLOCKED_WEBHOOK_CAMERAS_FILE", "/data/blocked_webhook_cameras.json")

# Default blocked cameras list (includes A04_Chanod, A18_Tautain, A17_CHYU and all cameras under กก.ตชด.23)
DEFAULT_BLOCKED_WEBHOOK_CAMERAS: List[str] = [
    "A04_Chanod",
    "A05_Manorom",
    "A06_Wanyai",
    "A08_Namkum",
    "A08_Namgum",
    "A08_Saimoon",
    "A09_Pakhuay",
    "A11_Donnanghong",
    "A12_Banhorm",
    "A14_Donpucha",
    "A15_Yeakbannard",
    "A17_CHYU",
    "A18_Tautain",
    "A19_Nakhonruang",
    "A20_Nongtao",
]

DEFAULT_BLOCKED_KEYWORDS: List[str] = [
    "ชะโนด", "chanod",
    "มโนรมย์", "manorom",
    "หว้านใหญ่", "wanyai",
    "น้ำก่ำ", "namkum", "namgum", "นาคำ",
    "ทรายมูล", "saimoon",
    "ปากห้วย", "pakhuay",
    "ดอนนางหง", "donnanghong",
    "บ้านห้อม", "banhorm",
    "ดอนปู่ชะโ", "donpucha",
    "นาดอกไม้", "yeakbannard",
    "เชียงยืน", "chyu",
    "ท่าอุเทน", "tautain",
    "นครหลวง", "nakhonruang",
    "หนองเทา", "nongtao",
]


def load_blocked_webhook_config() -> dict:
    """Load blocked webhook cameras configuration from disk or return default."""
    blocked_file = os.environ.get("BLOCKED_WEBHOOK_CAMERAS_FILE", "/data/blocked_webhook_cameras.json")
    if os.path.isfile(blocked_file):
        try:
            with open(blocked_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Gatekeeper] Error reading blocked webhook cameras file: {e}")

    return {
        "description": "Blocklist for incoming camera webhooks (VIGI Edge AI, Dahua ITC, LPR triggers)",
        "blocked_groups": ["กก.ตชด.23"],
        "blocked_cameras": DEFAULT_BLOCKED_WEBHOOK_CAMERAS,
        "blocked_keywords": DEFAULT_BLOCKED_KEYWORDS,
        "reason": "Operator disabled webhooks for A04_Chanod, A18_Tautain, A17_CHYU and group กก.ตชด.23"
    }


def is_webhook_blocked(camera_name_or_src: str) -> Tuple[bool, str]:
    """Check if camera is administratively blocked from sending webhooks.
    Matches against explicit camera IDs, keywords (Thai/English), and regex pattern for A-series (กก.ตชด.23).
    Returns (True, reason) if blocked, else (False, '')."""
    if not camera_name_or_src:
        return False, ""

    raw_str = str(camera_name_or_src).strip()
    clean_target = raw_str.lower()

    cfg = load_blocked_webhook_config()
    blocked_cams = [str(c).strip().lower() for c in cfg.get("blocked_cameras", DEFAULT_BLOCKED_WEBHOOK_CAMERAS)]
    blocked_keywords = [str(k).strip().lower() for k in cfg.get("blocked_keywords", DEFAULT_BLOCKED_KEYWORDS)]

    # 1. Exact or prefix match against blocked cameras
    for b_cam in blocked_cams:
        if clean_target == b_cam or clean_target.startswith(b_cam) or b_cam.startswith(clean_target):
            return True, f"Camera '{raw_str}' is blocked from sending webhooks (กก.ตชด.23 / operator disabled)"

    # 2. Check keywords (Thai / English substrings)
    for kw in blocked_keywords:
        if kw and kw in clean_target:
            return True, f"Camera '{raw_str}' matches blocked keyword '{kw}' (กก.ตชด.23)"

    # 3. Pattern match for A-series border patrol cameras: A04 - A20
    # e.g., a04, a05, a06, a08, a09, a11, a12, a14, a15, a17, a18, a19, a20
    if re.match(r"^a(0[4-9]|1[1-9]|20)($|[^0-9])", clean_target):
        return True, f"Camera '{raw_str}' matches กก.ตชด.23 A-series pattern"

    return False, ""


def is_camera_ai_enabled(camera_name_or_src: str) -> bool:
    """Check if camera is active on the dashboard (channels.json) or provisioned in Frigate NVR.
    Acts as a central Gatekeeper: if camera is unassigned from dashboard or explicitly
    administratively disabled (enabled=False), or in the blocked webhook cameras list, drop incoming edge alerts/events immediately."""
    if not camera_name_or_src:
        return False

    # Blocklist check: Immediately drop if in blocked webhook list (e.g. กก.ตชด.23)
    blocked, _ = is_webhook_blocked(camera_name_or_src)
    if blocked:
        return False

    clean_target = str(camera_name_or_src).strip().lower()
    channels_path = os.environ.get("CHANNELS_SETTINGS_FILE", "/settings-data/channels.json")

    found_channel = False
    channel_enabled = False
    if os.path.isfile(channels_path):
        try:
            with open(channels_path, "r", encoding="utf-8") as f:
                channels = json.load(f)
            if isinstance(channels, list):
                for ch in channels:
                    if not isinstance(ch, dict):
                        continue
                    c_src = str(ch.get("src", "")).strip().lower()
                    c_name = str(ch.get("name", "")).strip().lower()
                    c_sub = str(ch.get("sub", "")).strip().lower()

                    # Skip empty/unassigned channel slots
                    if not c_src and not c_name:
                        continue

                    # Match camera name or source identifier
                    if (clean_target == c_src) or (clean_target == c_name) or (c_sub and clean_target == c_sub) or \
                       (c_src and (clean_target.startswith(c_src) or c_src.startswith(clean_target))) or \
                       (c_name and (clean_target in c_name or c_name in clean_target)):
                        found_channel = True
                        if ch.get("enabled", True) is not False:
                            channel_enabled = True
                            break
        except Exception as e:
            print(f"[Gatekeeper] Error reading channels file: {e}")

    # If camera was found in dashboard channels and explicitly disabled by admin -> drop
    if found_channel and not channel_enabled:
        return False

    # If camera is assigned and enabled on dashboard -> allow edge alerts
    if found_channel and channel_enabled:
        return True

    # Fallback Check: Check if camera exists in Frigate NVR cameras configuration
    try:
        cfg_req = urllib.request.Request("http://frigate:5000/api/config", method="GET")
        with urllib.request.urlopen(cfg_req, timeout=2) as r:
            frigate_config = json.loads(r.read().decode("utf-8"))
            frigate_cams = frigate_config.get("cameras", {})

            for f_cam_id in frigate_cams.keys():
                f_clean = str(f_cam_id).strip().lower()
                if f_clean == clean_target or clean_target.startswith(f_clean) or f_clean.startswith(clean_target):
                    return True
    except Exception:
        pass

    return False


LPR_CAMERAS_FILE = os.environ.get("LPR_CAMERAS_FILE", "/data/lpr_cameras.txt")

def is_lpr_enabled_for_camera(camera_name_or_src: str) -> bool:
    """Check if LPR (License Plate Recognition) is explicitly enabled for this camera in lpr_cameras.txt."""
    if not camera_name_or_src:
        return False
    clean_target = str(camera_name_or_src).strip().lower()
    lpr_file = os.environ.get("LPR_CAMERAS_FILE", "/data/lpr_cameras.txt")
    if not os.path.isfile(lpr_file):
        return False
    try:
        with open(lpr_file, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                s_clean = s.lower()
                if s_clean == clean_target or clean_target.startswith(s_clean) or s_clean.startswith(clean_target):
                    return True
        return False
    except Exception as e:
        print(f"[Gatekeeper] Error reading lpr_cameras.txt: {e}")
        return False


_telegram_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="edge_alert")


def _send_edge_telegram_alert(message: str, photo_bytes: Optional[bytes] = None):
    """Fire-and-forget Telegram notification for edge camera LPR hits via bounded worker pool."""
    bot_token = os.environ.get("LPR_TELEGRAM_BOT_TOKEN", "").strip() or os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("LPR_TELEGRAM_CHAT_ID", "").strip() or os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not bot_token or not chat_id:
        return

    def _worker():
        try:
            if photo_bytes:
                boundary = f"----WebKitFormBoundary{secrets.token_hex(16)}"
                body = bytearray()
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}\r\n'.encode())
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="caption"\r\n\r\n{message[:1024]}\r\n'.encode())
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n'.encode())
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(f'Content-Disposition: form-data; name="photo"; filename="plate.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode())
                body.extend(photo_bytes)
                body.extend(f"\r\n--{boundary}--\r\n".encode())
                req = urllib.request.Request(
                    f"https://api.telegram.org/bot{bot_token}/sendPhoto",
                    data=bytes(body),
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                    method="POST"
                )
            else:
                req_data = json.dumps({"chat_id": chat_id, "text": message[:4096], "parse_mode": "HTML"}).encode("utf-8")
                req = urllib.request.Request(
                    f"https://api.telegram.org/bot{bot_token}/sendMessage",
                    data=req_data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
            urllib.request.urlopen(req, timeout=15)
        except Exception:
            pass

    _telegram_executor.submit(_worker)


def parse_multipart_body(raw_body: bytes, content_type_header: str) -> dict:
    """Parse multipart/form-data payload without third-party dependencies using Python's stdlib email package."""
    result = {"fields": {}, "files": {}}
    if not raw_body or "multipart" not in (content_type_header or "").lower():
        return result
    try:
        raw_header = f"Content-Type: {content_type_header}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8")
        msg = email.message_from_bytes(raw_header + raw_body, policy=email.policy.default)
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            payload = part.get_payload(decode=True)
            filename = part.get_filename()
            if filename or part.get_content_type().startswith("image/"):
                result["files"][name] = payload
            else:
                try:
                    result["fields"][name] = payload.decode("utf-8")
                except Exception:
                    result["files"][name] = payload
    except Exception as e:
        print(f"[Webhook] Multipart parse error: {e}")
    return result


def dispatch_vigi_alarm_event(
    camera_id: str,
    event_type: str,
    event_time: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
    extra_info: Optional[str] = None
) -> dict:
    """Process an edge AI alarm event from TP-Link VIGI cameras and dispatch alert to nas-bot-service."""
    blocked, block_reason = is_webhook_blocked(camera_id)
    if blocked:
        print(f"[Gatekeeper] Dropped VIGI alarm for '{camera_id}': {block_reason}")
        return {
            "status": "ignored",
            "reason": block_reason,
            "camera_id": camera_id
        }

    if not is_camera_ai_enabled(camera_id):
        print(f"[Gatekeeper] Dropped VIGI alarm for '{camera_id}': Camera is disabled or not assigned on dashboard")
        return {
            "status": "ignored",
            "reason": f"Camera '{camera_id}' is disabled or not assigned on dashboard",
            "camera_id": camera_id
        }

    event_map = {
        "human_detection": ("person", "ตรวจพบบุคคล (Human Detection)"),
        "human": ("person", "ตรวจพบบุคคล (Human Detection)"),
        "vehicle_detection": ("car", "ตรวจพบยานพาหนะ (Vehicle Detection)"),
        "vehicle": ("car", "ตรวจพบยานพาหนะ (Vehicle Detection)"),
        "line_crossing": ("person", "ตรวจพบบุกรุกข้ามเส้นตรวจการณ์ (Line Crossing)"),
        "intrusion": ("person", "ตรวจพบบุกรุกพื้นที่หวงห้าม (Intrusion Detection)"),
        "region_entrance": ("person", "ตรวจพบการเข้าสู่พื้นที่ (Area Entrance)"),
        "region_exit": ("person", "ตรวจพบการออกจากพื้นที่ (Area Exit)"),
        "motion": ("motion", "ตรวจพบความเคลื่อนไหว (Motion Detection)"),
        "tampering": ("motion", "กล้องถูกบดบัง/ตัดสัญญาณ (Camera Tampering)"),
    }
    norm_type = str(event_type).lower().replace(" ", "_").replace("-", "_")
    label, th_desc = event_map.get(norm_type, ("person", f"ตรวจพบเหตุการณ์ ({event_type})"))
    timestamp = event_time or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    alert_msg = (
        f"🚨 <b>แจ้งเตือนเหตุการณ์อัจฉริยะ (VIGI Edge AI)</b>\n"
        f"📷 <b>กล้อง:</b> <code>{camera_id}</code>\n"
        f"⚠️ <b>ประเภท:</b> {th_desc}\n"
        f"🕒 <b>เวลา:</b> {timestamp}"
    )
    if extra_info:
        alert_msg += f"\nℹ️ <b>ข้อมูลเพิ่มเติม:</b> {extra_info}"

    image_b64 = base64.b64encode(image_bytes).decode("utf-8") if image_bytes else ""
    
    # === DB Insert and Snapshot Save ===
    import secrets
    import os
    import re

    frigate_event_id = None
    try:
        f_payload = json.dumps({
            "sub_label": th_desc,
            "duration": 30,
            "include_recording": False,
            "score": 0.9
        }).encode("utf-8")
        f_req = urllib.request.Request(
            f"http://frigate:5000/api/events/{camera_id}/{label}/create",
            data=f_payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(f_req, timeout=5) as f_resp:
            res_data = json.loads(f_resp.read().decode("utf-8"))
            if res_data.get("success") and res_data.get("event_id"):
                frigate_event_id = res_data["event_id"]
                print(f"[VIGI Alarm] Created Frigate event {frigate_event_id} for {camera_id} ({label})")
    except Exception as e:
        print(f"[VIGI Alarm] Could not create Frigate event for {camera_id}: {e}")

    safe_cam = re.sub(r'[^A-Za-z0-9_-]', '_', camera_id)
    ts = int(datetime.datetime.now().timestamp())
    token = secrets.token_hex(4)
    event_id = frigate_event_id or f"vigi_{safe_cam}_{ts}_{token}"
    now_str = datetime.datetime.utcnow().isoformat() + "Z"
    
    crop_filename = f"{event_id}.jpg"
    if image_bytes:
        crop_path = os.path.join("/lpr-data/crops", crop_filename)
        os.makedirs(os.path.dirname(crop_path), exist_ok=True)
        try:
            with open(crop_path, "wb") as f:
                f.write(image_bytes)
        except Exception as e:
            print(f"[VIGI Alarm] Error saving snapshot {crop_path}: {e}")
            crop_filename = None
    else:
        crop_filename = None

    # LPR Gating Policy:
    # A VIGI Edge Alarm (human/vehicle/motion/intrusion) is an edge smart event, NOT an LPR detection.
    # We ONLY create an LPR candidate record IF:
    #   1. The source camera is explicitly enabled in lpr_cameras.txt whitelist.
    #   2. The event is a vehicle-related event (not human, not intrusion, not motion).
    #   3. A valid license plate text was detected/provided.
    # Generic vehicle/human detections must NEVER create empty-plate candidates.
    should_process_lpr = is_lpr_enabled_for_camera(camera_id) and label == "car"
    clean_plate = _normalize_plate(extra_info) if extra_info else None

    if should_process_lpr and clean_plate:
        try:
            with get_conn() as conn:
                conn.execute("""
                    INSERT INTO lpr_candidates
                        (event_id, camera, status, review_state, plate_text,
                         operational_visible, human_confirmed, source,
                         crop_path, description, created_at, updated_at)
                    VALUES (?, ?, 'pending_review', 'pending', ?,
                            1, 0, 'vigi_edge_ai',
                            ?, ?, ?, ?)
                """, (event_id, camera_id, clean_plate, crop_filename, th_desc, now_str, now_str))
                
                cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute("""
                    INSERT INTO lpr_candidate_event_links
                        (candidate_id, event_id, relation)
                    VALUES (?, ?, 'primary')
                """, (cid, event_id))
                conn.commit()
                print(f"[VIGI Alarm] Saved LPR candidate {cid} for {camera_id} ({clean_plate})")
        except Exception as e:
            print(f"[VIGI Alarm] Error inserting LPR candidate: {e}")
    else:
        print(f"[VIGI Alarm] Edge event {event_id} ({norm_type}) for {camera_id} recorded as smart event (no LPR candidate)")

    # Push SSE event to connected clients for real-time UI update
    try:
        loop = asyncio.get_running_loop()
        for q in event_queues:
            loop.call_soon_threadsafe(q.put_nowait, "new_vigi_event")
    except Exception as e:
        pass
    # ===================================

    def _worker():
        try:
            payload = {
                "camera": camera_id,
                "label": label,
                "message": alert_msg,
                "image_b64": image_b64,
            }
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                "http://nas-bot:5005/api/nas-bot/dispatch-alert",
                data=data,
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=8)
        except Exception as e:
            print(f"[VIGI Alarm] Error dispatching to nas-bot: {e}")

    _telegram_executor.submit(_worker)
    _send_edge_telegram_alert(alert_msg, image_bytes)

    return {
        "status": "ok",
        "event": "vigi_alarm",
        "event_id": event_id,
        "camera_id": camera_id,
        "type": event_type,
        "dispatched": True,
        "has_image": bool(image_bytes)
    }


@app.post("/watchlist/lpr/webhook")
async def receive_camera_lpr_webhook(
    request: Request,
    token: Optional[str] = Query(default=None),
    x_camera_token: Optional[str] = Header(default=None, alias="X-Camera-Token"),
):
    """Receive LPR capture events (plate text + cropped picture + vehicle snapshot)
    and VIGI Alarm Server events (Human/Vehicle/Line Crossing) directly from edge cameras."""
    provided_token = token or x_camera_token or request.headers.get("x-camera-token", "")
    expected_secret = os.environ.get("CAMERA_WEBHOOK_SECRET", "bpp_secret_2026")
    proxy_secret = os.environ.get("MEDIA_COMPAT_PROXY_SHARED_SECRET", "")
    
    # Verify token if configured
    if expected_secret:
        valid_token = False
        if provided_token and hmac.compare_digest(provided_token, expected_secret):
            valid_token = True
        elif proxy_secret and provided_token and hmac.compare_digest(provided_token, proxy_secret):
            valid_token = True
        if not valid_token:
            raise HTTPException(status_code=403, detail="Invalid camera webhook token")

    plate_text = ""
    province = ""
    camera_id = "external_camera"
    crop_bytes: Optional[bytes] = None
    vehicle_bytes: Optional[bytes] = None
    vigi_event_type = None
    vigi_event_time = None
    vigi_extra = None

    query_cam = request.query_params.get("camera_id") or request.query_params.get("camera")
    if query_cam:
        camera_id = str(query_cam).strip()
        blocked, block_reason = is_webhook_blocked(camera_id)
        if blocked:
            print(f"[Gatekeeper] Dropped webhook for query camera '{camera_id}': {block_reason}")
            return {
                "status": "ignored",
                "reason": block_reason,
                "camera_id": camera_id
            }

    raw_content_type = request.headers.get("content-type", "")
    content_type_lower = raw_content_type.lower()
    print(f"[Webhook] Inbound request: Content-Type='{raw_content_type}', query_cam='{query_cam}', client={request.client.host if request.client else 'unknown'}")

    if "application/json" in content_type_lower:
        try:
            data = await request.json()
            if isinstance(data, dict):
                # VIGI format detection: data.get("messages") or data.get("events")
                msgs = data.get("messages") or data.get("events")
                if isinstance(msgs, list) and len(msgs) > 0:
                    first_msg = msgs[0]
                    if isinstance(first_msg, dict):
                        vigi_event_type = first_msg.get("type") or first_msg.get("event_type")
                        vigi_event_time = first_msg.get("localtime") or first_msg.get("time")
                        vigi_extra = first_msg.get("extra_text")
                        if not query_cam:
                            camera_id = str(first_msg.get("camera_name") or data.get("device_name") or data.get("device_id") or camera_id)

                # --- VIGI Alarm Server real format: event_list ---
                if not vigi_event_type:
                    ev_list = data.get("event_list")
                    if isinstance(ev_list, list) and len(ev_list) > 0:
                        first_ev = ev_list[0]
                        if isinstance(first_ev, dict):
                            raw_et = first_ev.get("event_type")
                            if isinstance(raw_et, list):
                                non_motion = [e for e in raw_et if e.upper() != "MOTION"]
                                vigi_event_type = non_motion[0] if non_motion else raw_et[0]
                            elif isinstance(raw_et, str):
                                vigi_event_type = raw_et
                            vigi_event_time = first_ev.get("dateTime") or first_ev.get("localtime") or first_ev.get("time")
                            vigi_extra = first_ev.get("extra_text")
                        if not query_cam:
                            camera_id = str(data.get("device_name") or data.get("device_id") or camera_id)

                if not vigi_event_type:
                    if "event_type" in data or "type" in data:
                        vigi_event_type = data.get("event_type") or data.get("type")
                        vigi_event_time = data.get("time") or data.get("localtime")
                        if not query_cam and (data.get("camera_name") or data.get("device_name")):
                            camera_id = str(data.get("camera_name") or data.get("device_name") or camera_id)

                plate_text = str(data.get("plate_text") or data.get("plate") or data.get("PlateNumber") or data.get("license_plate") or "")
                province = str(data.get("province") or data.get("Province") or "")
                if not query_cam and (data.get("camera_id") or data.get("device_id") or data.get("CameraID")):
                    camera_id = str(data.get("camera_id") or data.get("device_id") or data.get("CameraID"))
                if "plate_crop_base64" in data:
                    try:
                        crop_bytes = base64.b64decode(data["plate_crop_base64"])
                    except Exception:
                        pass
                if "vehicle_photo_base64" in data:
                    try:
                        vehicle_bytes = base64.b64decode(data["vehicle_photo_base64"])
                    except Exception:
                        pass
                if "image_base64" in data or "snapshot_base64" in data:
                    try:
                        vehicle_bytes = base64.b64decode(data.get("image_base64") or data.get("snapshot_base64"))
                    except Exception:
                        pass
        except Exception:
            pass
        # --- Debug logging: show what JSON data was parsed ---
        if 'data' in dir() and isinstance(data, dict):
            print(f"[Webhook] JSON: cam={camera_id}, event={vigi_event_type}, time={vigi_event_time}, plate='{plate_text}', keys={list(data.keys())[:10]}")
    else:
        # Multipart form data (Standard Dahua ITC / VIGI LPR / VIGI Alarm upload)
        try:
            raw_body = await request.body()
            mp = parse_multipart_body(raw_body, raw_content_type)
            form_fields = mp.get("fields", {})
            form_files = mp.get("files", {})

            # 1. Look for VIGI or Dahua JSON block inside form fields
            for ev_field in ("event", "info", "json", "message", "PlateResult"):
                raw_ev = form_fields.get(ev_field)
                if raw_ev and isinstance(raw_ev, str) and (raw_ev.strip().startswith("{") or raw_ev.strip().startswith("[")):
                    try:
                        d_parsed = json.loads(raw_ev)
                        msgs = d_parsed.get("messages") or d_parsed.get("events")
                        if isinstance(msgs, list) and len(msgs) > 0:
                            first_msg = msgs[0]
                            if isinstance(first_msg, dict):
                                vigi_event_type = first_msg.get("type") or first_msg.get("event_type")
                                vigi_event_time = first_msg.get("localtime") or first_msg.get("time")
                                vigi_extra = first_msg.get("extra_text")
                                if not query_cam:
                                    camera_id = str(first_msg.get("camera_name") or d_parsed.get("device_name") or d_parsed.get("device_id") or camera_id)

                        # --- VIGI Alarm Server real format: event_list ---
                        # Example: {"ip":"...","device_name":"A18 ท่าอุเทน","event_list":[{"dateTime":"20260917172207","event_type":["MOTION","VEHICLE"]}]}
                        if not vigi_event_type:
                            ev_list = d_parsed.get("event_list")
                            if isinstance(ev_list, list) and len(ev_list) > 0:
                                first_ev = ev_list[0]
                                if isinstance(first_ev, dict):
                                    raw_et = first_ev.get("event_type")
                                    if isinstance(raw_et, list):
                                        # Pick the most specific event type (skip MOTION if others exist)
                                        non_motion = [e for e in raw_et if e.upper() != "MOTION"]
                                        vigi_event_type = non_motion[0] if non_motion else raw_et[0]
                                    elif isinstance(raw_et, str):
                                        vigi_event_type = raw_et
                                    vigi_event_time = first_ev.get("dateTime") or first_ev.get("localtime") or first_ev.get("time")
                                    vigi_extra = first_ev.get("extra_text")
                                if not query_cam:
                                    camera_id = str(d_parsed.get("device_name") or d_parsed.get("device_id") or camera_id)

                        if not vigi_event_type:
                            if "PlateResult" in d_parsed:
                                res = d_parsed.get("PlateResult")
                                plate_text = res.get("PlateNumber") or res.get("plate_number") or plate_text
                                province = res.get("Province") or res.get("province") or province
                                if not query_cam:
                                    camera_id = res.get("DeviceID") or res.get("device_id") or camera_id
                            elif "event_type" in d_parsed or "type" in d_parsed:
                                vigi_event_type = d_parsed.get("event_type") or d_parsed.get("type")
                                vigi_event_time = d_parsed.get("time") or d_parsed.get("localtime")
                    except Exception:
                        pass

            # Also check direct form text fields
            if form_fields.get("event_type"):
                vigi_event_type = form_fields.get("event_type")
            if form_fields.get("localtime") or form_fields.get("time"):
                vigi_event_time = form_fields.get("localtime") or form_fields.get("time")

            plate_text = str(form_fields.get("plate_text") or form_fields.get("plate_number") or form_fields.get("plate") or form_fields.get("PlateNumber") or plate_text)
            province = str(form_fields.get("province") or form_fields.get("Province") or province)
            if not query_cam and (form_fields.get("camera_id") or form_fields.get("device_id") or form_fields.get("CameraID")):
                camera_id = str(form_fields.get("camera_id") or form_fields.get("device_id") or form_fields.get("CameraID"))

            # Extract uploaded picture files
            for img_key in ("file", "image", "snapshot", "picture", "plate_crop", "PlatePicture", "vehicle_photo", "Picture"):
                b = form_files.get(img_key)
                if not b and img_key in form_fields and isinstance(form_fields[img_key], bytes):
                    b = form_fields[img_key]
                if b and isinstance(b, (bytes, bytearray)) and len(b) > 100:
                    if not vehicle_bytes:
                        vehicle_bytes = bytes(b)
                    if not crop_bytes and img_key in ("plate_crop", "PlatePicture"):
                        crop_bytes = bytes(b)
            # Fallback: VIGI Alarm Server uses dateTime as the file part name (e.g. "20260917172748")
            # Pick up any file > 100 bytes if no image was found by standard keys
            if not vehicle_bytes:
                for fk, fb in form_files.items():
                    if isinstance(fb, (bytes, bytearray)) and len(fb) > 100:
                        vehicle_bytes = bytes(fb)
                        break
            print(f"[Webhook] Multipart: cam={camera_id}, event={vigi_event_type}, time={vigi_event_time}, plate='{plate_text}', img={len(vehicle_bytes) if vehicle_bytes else 0}B")
        except Exception as e:
            print(f"[Webhook] Multipart form processing error: {e}")

    # Central Gatekeeper Check: Drop if camera is in blocked webhook list or disabled on dashboard
    blocked, block_reason = is_webhook_blocked(camera_id)
    if blocked:
        print(f"[Gatekeeper] Dropped webhook for '{camera_id}': {block_reason}")
        return {
            "status": "ignored",
            "reason": block_reason,
            "camera_id": camera_id
        }

    if not is_camera_ai_enabled(camera_id):
        print(f"[Gatekeeper] Dropped webhook for '{camera_id}': Camera is disabled or not assigned on dashboard")
        return {
            "status": "ignored",
            "reason": f"Camera '{camera_id}' is disabled or not assigned on dashboard",
            "camera_id": camera_id
        }

    clean_plate = _normalize_plate(plate_text)
    if not clean_plate:
        # Check if this is a VIGI Edge AI Alarm Event (Human / Vehicle / Intrusion / Motion)
        if vigi_event_type:
            return dispatch_vigi_alarm_event(
                camera_id=camera_id,
                event_type=vigi_event_type,
                event_time=vigi_event_time,
                image_bytes=vehicle_bytes or crop_bytes,
                extra_info=vigi_extra
            )
        return {"status": "ok", "message": "No valid plate characters detected", "camera_id": camera_id}

    frigate_event_id = None
    try:
        f_payload = json.dumps({
            "sub_label": f"ทะเบียน {clean_plate} {province or ''}".strip(),
            "duration": 30,
            "include_recording": False,
            "score": 0.95
        }).encode("utf-8")
        f_req = urllib.request.Request(
            f"http://frigate:5000/api/events/{camera_id}/car/create",
            data=f_payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(f_req, timeout=5) as f_resp:
            res_data = json.loads(f_resp.read().decode("utf-8"))
            if res_data.get("success") and res_data.get("event_id"):
                frigate_event_id = res_data["event_id"]
                print(f"[Webhook LPR] Created Frigate event {frigate_event_id} for {camera_id} ({clean_plate})")
    except Exception as e:
        print(f"[Webhook LPR] Could not create Frigate event for {camera_id}: {e}")

    timestamp_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    safe_cam = re.sub(r"[^A-Za-z0-9_]", "_", camera_id)
    event_id = frigate_event_id or f"ext_{safe_cam}_{int(datetime.datetime.now().timestamp())}_{secrets.token_hex(4)}"

    # Save crop to /lpr-data/crops/<event_id>.jpg if provided
    saved_crop_filename = None
    if crop_bytes and len(crop_bytes) > 100:
        try:
            os.makedirs(CROPS_DIR, exist_ok=True)
            saved_crop_filename = f"{event_id}.jpg"
            target_path = os.path.join(CROPS_DIR, saved_crop_filename)
            with open(target_path, "wb") as f_crop:
                f_crop.write(crop_bytes)
        except Exception:
            saved_crop_filename = None

    # Check Watchlist Database
    is_hit = False
    hit_info = None
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM watchlist
            WHERE (plate = ? OR plate = ? OR plate_display = ?) AND active = 1
            LIMIT 1
            """,
            (plate_text, clean_plate, plate_text)
        ).fetchone()

        if row:
            is_hit = True
            hit_info = dict(row)

        # Record into lpr_candidates (accessible in Review Queue)
        try:
            conn.execute(
                """
                INSERT INTO lpr_candidates
                    (event_id, camera, status, review_state, plate_text, province,
                     operational_visible, human_confirmed, source, crop_path, created_at, updated_at)
                VALUES (?, ?, 'pending_review', 'pending', ?, ?, 1, 0, 'vigi_edge_ai', ?, ?, ?)
                """,
                (event_id, camera_id, clean_plate, province or None, saved_crop_filename, timestamp_str, timestamp_str)
            )
            candidate_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            conn.execute(
                """
                INSERT INTO lpr_candidate_event_links (candidate_id, event_id, relation)
                VALUES (?, ?, 'primary')
                """,
                (candidate_id, event_id)
            )
            conn.commit()
        except Exception:
            pass

    # If Watchlist Hit -> Dispatch Telegram Alert immediately!
    if is_hit and hit_info:
        danger_emoji = "🔴" if hit_info.get("danger_level") == "critical" else "🟠" if hit_info.get("danger_level") == "high" else "🟡"
        alert_msg = (
            f"🚨 <b>[แจ้งเตือนทะเบียนเป้าหมาย / เฝ้าระวัง]</b>\n"
            f"🚗 <b>ทะเบียน:</b> {hit_info.get('plate_display') or clean_plate} {province}\n"
            f"📹 <b>กล้อง:</b> {camera_id}\n"
            f"{danger_emoji} <b>ระดับความอันตราย:</b> {hit_info.get('danger_level') or 'ปกติ'}\n"
            f"👤 <b>เจ้าของ/ผู้ครอบครอง:</b> {hit_info.get('owner_name') or '-'}\n"
            f"📝 <b>หมายเหตุ/คดี:</b> {hit_info.get('notes') or hit_info.get('criminal_history') or '-'}\n"
            f"⏰ <b>เวลาตรวจพบ:</b> {timestamp_str}"
        )
        _send_edge_telegram_alert(alert_msg, crop_bytes or vehicle_bytes)

    return {
        "status": "ok",
        "hit": is_hit,
        "event_id": event_id,
        "plate": clean_plate,
        "province": province,
        "camera_id": camera_id
    }


@app.post("/watchlist/lpr/vehicle-trigger")
async def receive_vehicle_trigger(
    request: Request,
    token: Optional[str] = Query(default=None),
    x_camera_token: Optional[str] = Header(default=None, alias="X-Camera-Token"),
):
    """Receive Smart Event vehicle detection trigger from standard TP-Link VIGI AI cameras
    to wake up on-demand LPR snapshot without running 24/7 video detection."""
    provided_token = token or x_camera_token or request.headers.get("x-camera-token", "")
    expected_secret = os.environ.get("CAMERA_WEBHOOK_SECRET", "bpp_secret_2026")
    if expected_secret and provided_token != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid trigger token")

    try:
        data = await request.json()
    except Exception:
        data = {}

    camera_id = str(data.get("camera_id") or data.get("camera") or "vigi_smart_ai")

    # Gatekeeper check
    blocked, block_reason = is_webhook_blocked(camera_id)
    if blocked:
        print(f"[Gatekeeper] Dropped vehicle trigger for '{camera_id}': {block_reason}")
        return {
            "status": "ignored",
            "reason": block_reason,
            "camera_id": camera_id
        }

    if not is_camera_ai_enabled(camera_id):
        print(f"[Gatekeeper] Dropped vehicle trigger for '{camera_id}': Camera is disabled or not assigned on dashboard")
        return {
            "status": "ignored",
            "reason": f"Camera '{camera_id}' is disabled or not assigned on dashboard",
            "camera_id": camera_id
        }

    return {
        "status": "ok",
        "trigger": "vehicle_detected",
        "camera_id": camera_id,
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }


@app.get("/watchlist/lpr/blocked-cameras")
def get_blocked_cameras():
    """Return the list of cameras and rules currently blocked from webhook ingestion."""
    cfg = load_blocked_webhook_config()
    return {
        "status": "ok",
        "config": cfg
    }


@app.delete("/watchlist/lpr/event/{event_id}")
def delete_lpr_event(
    event_id: str,
    identity: TrustedIdentity = Depends(require_admin),
):
    """Remove candidate and event from watchlist database, crops, and Frigate NVR."""
    deleted_files = []
    crop_targets = [f"{event_id}.jpg"]
    with get_conn() as conn:
        cands = conn.execute(
            "SELECT id, crop_path FROM lpr_candidates WHERE event_id = ? OR id = ?",
            (event_id, event_id)
        ).fetchall()
        for cand in cands:
            cid, cpath = cand[0], cand[1]
            if cpath:
                crop_targets.append(cpath)
            conn.execute("DELETE FROM lpr_candidate_event_links WHERE candidate_id = ?", (cid,))
            conn.execute("DELETE FROM lpr_candidates WHERE id = ?", (cid,))
        conn.execute("DELETE FROM lpr_training_samples WHERE event_id = ?", (event_id,))
        conn.commit()

    for cname in set(crop_targets):
        if not cname:
            continue
        cpath = os.path.join(CROPS_DIR, cname) if not os.path.isabs(cname) else cname
        if os.path.isfile(cpath):
            try:
                os.remove(cpath)
                deleted_files.append(cname)
            except Exception:
                pass

    frigate_err = None
    try:
        f_req = urllib.request.Request(f"http://frigate:5000/api/events/{event_id}", method="DELETE")
        with urllib.request.urlopen(f_req, timeout=5) as f_resp:
            pass
    except Exception as fe:
        frigate_err = str(fe)

    send_audit(
        identity.username,
        "DELETE_LPR_EVENT",
        f"event={event_id} deleted_files={deleted_files} frigate_err={frigate_err}",
        identity.client_ip,
    )
    return {
        "status": "ok",
        "event_id": event_id,
        "deleted_files": deleted_files,
        "frigate_error": frigate_err
    }


class FrigateRuntimeSyncRequest(BaseModel):
    camera: str
    enabled: bool
    detect_enabled: bool
    record_enabled: bool
    objects_track: Optional[List[str]] = None
    go2rtc_streams: Optional[Dict[str, Any]] = None


def _frigate_put_config_set(query: str, update_topic: str, timeout: float = 12.0) -> bool:
    url = f"{FRIGATE_URL}/api/config/set?{query}"
    payload = json.dumps({"requires_restart": 0, "update_topic": update_topic}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Forwarded-User": "admin",
            "remote-role": "admin",
        },
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status == 200


@app.post("/internal/frigate-runtime-sync")
def internal_frigate_runtime_sync(request: Request, body: FrigateRuntimeSyncRequest):
    """Internal bridge for config-api to sync go2rtc streams and Frigate runtime camera state."""
    secret = get_federation_secret()
    provided = request.headers.get("X-BPP-Federation", "")
    if not secret or not hmac.compare_digest(provided, secret):
        raise HTTPException(status_code=401, detail="Unauthorized internal sync")

    name = body.camera
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", name):
        raise HTTPException(status_code=422, detail="Invalid camera name")

    actions = []
    if body.go2rtc_streams:
        existing_streams = {}
        try:
            with urllib.request.urlopen("http://frigate:1984/api/streams", timeout=4) as gs_resp:
                existing_streams = json.loads(gs_resp.read().decode("utf-8")) or {}
        except Exception:
            pass
        for s_name, s_src in body.go2rtc_streams.items():
            if not s_name or not s_src or s_name in existing_streams:
                continue
            try:
                srcs = s_src if isinstance(s_src, list) else [s_src]
                srcs = [str(x) for x in srcs if x]
                if not srcs:
                    continue
                q_name = urllib.parse.quote(str(s_name), safe="")
                q_srcs = "&".join(f"src={urllib.parse.quote(s, safe='')}" for s in srcs)
                g_req = urllib.request.Request(
                    f"http://frigate:1984/api/streams?name={q_name}&{q_srcs}",
                    method="PUT",
                )
                with urllib.request.urlopen(g_req, timeout=5) as g_resp:
                    if g_resp.status in (200, 201):
                        actions.append(f"go2rtc:{s_name}")
            except Exception:
                pass

    try:
        stats_req = urllib.request.Request(f"{FRIGATE_URL}/api/stats", method="GET")
        with urllib.request.urlopen(stats_req, timeout=5) as sr:
            f_stats = json.loads(sr.read().decode("utf-8"))
        cfg_req = urllib.request.Request(f"{FRIGATE_URL}/api/config", method="GET")
        with urllib.request.urlopen(cfg_req, timeout=5) as cr:
            f_cfg = json.loads(cr.read().decode("utf-8"))

        cam_stats = (f_stats.get("cameras") or {}).get(name) or {}
        has_capture = bool(cam_stats.get("capture_pid"))
        f_cam = (f_cfg.get("cameras") or {}).get(name)

        if body.enabled and not has_capture:
            _frigate_put_config_set(
                f"cameras.{name}.enabled=True",
                f"config/cameras/{name}/add",
            )
            actions.append("add")
            # Also force enabled/record/detect topics so Frigate's persisted SQLite
            # runtime state (e.g. Restored runtime state: camera.enabled=OFF) never
            # blocks capture or recording startup after `add`.
            try:
                _frigate_put_config_set(
                    f"cameras.{name}.enabled=True",
                    f"config/cameras/{name}/enabled",
                )
                actions.append("enabled")
            except Exception:
                pass
            try:
                _frigate_put_config_set(
                    f"cameras.{name}.record.enabled={'True' if body.record_enabled else 'False'}",
                    f"config/cameras/{name}/record",
                )
                actions.append("record")
            except Exception:
                pass
            try:
                _frigate_put_config_set(
                    f"cameras.{name}.detect.enabled={'True' if body.detect_enabled else 'False'}",
                    f"config/cameras/{name}/detect",
                )
                actions.append("detect")
            except Exception:
                pass
            return {"status": "ok", "camera": name, "actions": actions}

        if f_cam is not None:
            if body.objects_track is not None:
                _frigate_put_config_set(
                    f"cameras.{name}.enabled={'True' if body.enabled else 'False'}",
                    f"config/cameras/{name}/objects",
                )
                actions.append("objects")
            cur_det = bool((f_cam.get("detect") or {}).get("enabled", False))
            cur_rec = bool((f_cam.get("record") or {}).get("enabled", False))
            cur_en = bool(f_cam.get("enabled", False))
            if cur_det != body.detect_enabled:
                _frigate_put_config_set(
                    f"cameras.{name}.detect.enabled={'True' if body.detect_enabled else 'False'}",
                    f"config/cameras/{name}/detect",
                )
                actions.append("detect")
            if cur_rec != body.record_enabled:
                _frigate_put_config_set(
                    f"cameras.{name}.record.enabled={'True' if body.record_enabled else 'False'}",
                    f"config/cameras/{name}/record",
                )
                actions.append("record")
            if cur_en != body.enabled or (not body.enabled and has_capture):
                _frigate_put_config_set(
                    f"cameras.{name}.enabled={'True' if body.enabled else 'False'}",
                    f"config/cameras/{name}/enabled",
                )
                actions.append("enabled")
    except Exception as exc:
        return {"status": "warning", "camera": name, "error": str(exc), "actions": actions}

    return {"status": "ok", "camera": name, "actions": actions}


class HistoryPullCandidateRequest(BaseModel):
    event_id: str
    camera: str
    plate_text: Optional[str] = None
    province: Optional[str] = None
    vehicle_type: Optional[str] = None
    vehicle_color: Optional[str] = None
    vehicle_brand: Optional[str] = None
    vehicle_model: Optional[str] = None
    description: Optional[str] = None
    detector_confidence: Optional[float] = 0.88
    crop_base64: Optional[str] = None
    created_at: Optional[str] = None


@app.post("/internal/history-pull-candidate")
def register_history_pull_candidate(body: HistoryPullCandidateRequest):
    """Internal endpoint for history-pull-worker to register AI-scanned historical vehicle events into watchlist.db."""
    crop_path = None
    if body.crop_base64:
        decoded = _decode_crop(body.crop_base64)
        if decoded:
            stored = _write_unique_image(CROPS_DIR, f"hist_{body.camera}", decoded)
            crop_path = os.path.basename(stored)
    ts = body.created_at or lpr_learning.utc_now()
    plate_val = (body.plate_text or "").strip() or "ไม่พบทะเบียน"
    prov_val = (body.province or "").strip()
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT id FROM lpr_candidates WHERE event_id = ? LIMIT 1",
            (body.event_id,),
        ).fetchone()
        if existing:
            cid = int(existing["id"])
            conn.execute(
                """
                UPDATE lpr_candidates
                SET camera = ?, plate_text = ?, province = ?,
                    vehicle_type = COALESCE(?, vehicle_type),
                    vehicle_color = COALESCE(?, vehicle_color),
                    vehicle_brand = COALESCE(?, vehicle_brand),
                    vehicle_model = COALESCE(?, vehicle_model),
                    description = COALESCE(?, description),
                    crop_path = COALESCE(?, crop_path),
                    operational_visible = 1, human_confirmed = 1,
                    review_state = 'adjudicated', updated_at = ?
                WHERE id = ?
                """,
                (
                    body.camera, plate_val, prov_val,
                    body.vehicle_type, body.vehicle_color,
                    body.vehicle_brand, body.vehicle_model,
                    body.description, crop_path, ts, cid,
                ),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO lpr_candidates (
                    event_id, camera, status, review_state,
                    plate_text, province, detector_confidence, ocr_confidence,
                    polygon_json, crop_path, operational_visible, human_confirmed,
                    source, model_version, created_at, updated_at,
                    vehicle_color, vehicle_type, vehicle_brand, vehicle_model, description
                ) VALUES (?, ?, 'readable', 'adjudicated', ?, ?, ?, 0.90, '[[0,0],[100,0],[100,100],[0,100]]', ?, 1, 1, 'history-ai-scan', 'yolov9c-mmcr', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    body.event_id, body.camera, plate_val, prov_val,
                    float(body.detector_confidence or 0.88), crop_path,
                    ts, ts,
                    body.vehicle_color, body.vehicle_type,
                    body.vehicle_brand, body.vehicle_model, body.description,
                ),
            )
            cid = int(cur.lastrowid)
        conn.execute(
            "INSERT OR IGNORE INTO lpr_candidate_event_links (candidate_id, event_id, relation) VALUES (?, ?, 'primary')",
            (cid, body.event_id),
        )
        conn.commit()
    return {"status": "ok", "candidate_id": cid, "event_id": body.event_id, "crop_path": crop_path}

