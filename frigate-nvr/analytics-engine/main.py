"""
Main FastAPI Application for analytics-engine (BPP-VMS)

Provides real-time analytics REST endpoints for:
1. Interactive Heat Map & Risk Score Calculation (with checkpoint GPS coordinates)
2. Time Pattern Analytics (Hourly & Daily distributions)
3. Target Vehicle Route Trajectory Linking

Inputs:
    - HTTP REST API requests
Outputs:
    - Real-time JSON analytics responses dynamically queried from SQLite & NAS Storage
Side effects:
    - None (read-only analytical aggregation).
"""

import os
from fastapi import FastAPI, Depends, Header, HTTPException
import hmac
import os
import re
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional
import logging

from services.heatmap import generate_heatmap_data
from services.stats import calculate_time_stats
from services.data_loader import load_real_lpr_events, load_real_nas_reports
from buriram_admin import resolve_buriram_location, normalize_name

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("analytics.main")


def is_verified_arrest_record(item: dict) -> bool:
    """
    Strictly verifies if a document or event is an authentic Arrest Record or Arrest Report.
    Filters out arrest warrants (หมายจับ), civil registry profiles (ทร.14), bank statements, etc.
    """
    if not isinstance(item, dict):
        return False

    doc_type = (item.get("doc_type") or "").lower()
    title = (item.get("title") or "").lower()
    text_parts = [
        str(item.get("raw_text") or ""),
        str(item.get("details") or ""),
        str(item.get("notes") or ""),
        str(item.get("behavior") or ""),
        str(item.get("title") or "")
    ]
    raw_text = " ".join(text_parts).lower()

    # 1. Negative criteria: reject civil records and financial statements
    if any(k in raw_text for k in ["ทร.14", "ข้อมูลทะเบียนราษฎร", "รายการเดินบัญชี", "statement", "สิทธิรักษา", "จ่ายตรง"]):
        return False

    # 2. Warrant checks: reject warrant-only documents
    is_warrant = any(k in doc_type for k in ["warrant", "หมายจับ"]) or \
                 any(k in title for k in ["หมายจับ", "warrant"]) or \
                 any(k in raw_text for k in [
                     "ไฟล์หมายจับ", "ทะเบียนหมายจับ", "รายงานทะเบียนหมายจับ", 
                     "ผู้ต้องหาตามหมายจับ", "หมายจับ crimes", "หมายจับ/ตำหนิรูปพรรณ"
                 ])

    if is_warrant:
        if any(k in raw_text for k in ["ได้ร่วมกันจับกุม", "ผลการจับกุมตามหมายจับ", "จับกุมตัวผู้ต้องหาตามหมายจับ", "บันทึกจับกุมตามหมายจับ"]):
            return True
        return False

    # 3. Positive criteria: must have authentic arrest execution indicators
    arrest_keywords = [
        "บันทึกจับกุม", "รายงานการจับกุม", "รายงานจับกุม", "ผลการจับกุม", "บันทึกการจับกุม",
        "ร่วมกันจับกุม", "ได้ร่วมกันจับกุม", "จับกุมตัว", "ตรวจยึดของกลาง",
        "สถานที่จับกุม", "พฤติการณ์ในการจับกุม", "พฤติการณ์แห่งการจับกุม",
        "จับกุมผู้ต้องหา", "จับกุมบุคคล"
    ]
    return any(k in raw_text or k in title or k in doc_type for k in arrest_keywords)


# ── Checkpoint registry ────────────────────────────────────────────────────
# ปรับพิกัดให้ตรงกับตำแหน่งจุดตรวจของหน่วยงานจริง
# หน่วย: ละติจูด (lat), ลองจิจูด (lon) — WGS84
CHECKPOINT_REGISTRY: List[Dict[str, Any]] = [
    {"name": "Checkpoint Nongwang 01", "lat": 13.7563, "lon": 100.5018, "cameras": 4},
    {"name": "Checkpoint Nongwang 08", "lat": 13.7510, "lon": 100.4920, "cameras": 2},
    {"name": "Checkpoint Nongwang 12", "lat": 13.7620, "lon": 100.5100, "cameras": 3},
]


import hmac
import os
from fastapi import Depends, Header, HTTPException
import re

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
    raise HTTPException(status_code=403, detail="Gateway authentication failed")

app = FastAPI(
    title="BPP-VMS Data Analytics Engine",
    description="Microservice for Data Analytics, Heatmap & Drug Intelligence",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> Dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy", "service": "analytics-engine"}


@app.get("/api/analytics/heatmap", dependencies=[Depends(require_gateway)])
def get_heatmap_data() -> Dict[str, Any]:
    """
    Get weighted heatmap points and risk score metrics.
    Combines real LPR events and verified NAS arrest reports with checkpoint coordinates.
    """
    reports = [r for r in load_real_nas_reports() if is_verified_arrest_record(r)]
    lpr_events = load_real_lpr_events()

    # Seed checkpoint positions as baseline heatmap anchors
    seeded_reports = list(reports)
    seeded_lpr = list(lpr_events)
    for cp in CHECKPOINT_REGISTRY:
        seeded_lpr.append({"lat": cp["lat"], "lon": cp["lon"]})

    result = generate_heatmap_data(seeded_reports, seeded_lpr)

    # Add checkpoint registry to response for map markers
    result["checkpoints"] = CHECKPOINT_REGISTRY
    return result


@app.get("/api/analytics/time-stats", dependencies=[Depends(require_gateway)])
def get_time_stats(
    incident_type: str = "all",
    start_date: str = None,
    end_date: str = None
) -> Dict[str, Any]:
    """
    Get hourly and day-of-week incident statistics from real data.
    Includes chat events filtered by incident_type and verified arrest records.
    Timestamps are converted to ICT (UTC+7) before aggregation.
    """
    import httpx

    reports = [r for r in load_real_nas_reports() if is_verified_arrest_record(r)]
    lpr_events = load_real_lpr_events()

    # Fetch chat events
    chat_events = []
    chat_urls = [
        os.environ.get("CHAT_SERVICE_URL", "http://chat-service:5007"),
        "http://localhost:5007"
    ]
    for base_url in chat_urls:
        try:
            res = httpx.get(f"{base_url}/api/chat/events", timeout=2.0)
            if res.status_code == 200:
                raw_chat = res.json().get("events", [])
                chat_events = [e for e in raw_chat if is_verified_arrest_record(e)]
                break
        except Exception:
            continue

    # Filter chat events by incident_type
    if incident_type != "all":
        chat_events = [e for e in chat_events if (e.get("incident_type") or "general") == incident_type]

    # Filter NAS reports by incident_type
    filtered_reports = []
    for r in reports:
        raw_text = (r.get("raw_text") or r.get("details") or "").lower()
        r_type = r.get("incident_type")
        if not r_type:
            if any(k in raw_text for k in ["ต่างด้าว", "หลบหนีเข้าเมือง"]):
                r_type = "alien"
            elif any(k in raw_text for k in ["อาวุธ", "ปืน", "มีด"]):
                r_type = "weapon"
            elif any(k in raw_text for k in ["ยาบ้า", "ยาเสพติด", "ไอซ์"]):
                r_type = "drug"
            else:
                r_type = "general"
        if incident_type == "all" or r_type == incident_type:
            filtered_reports.append(r)

    # Filter by date range
    def in_range(ev):
        dt = (ev.get("created_at") or ev.get("timestamp") or "")[:10]
        if start_date and dt and dt < start_date:
            return False
        if end_date and dt and dt > end_date:
            return False
        return True

    all_events = (
        [r for r in filtered_reports if in_range(r)] +
        [e for e in chat_events if in_range(e) and not e.get("is_drop_point")] +
        [e for e in lpr_events if incident_type == "all"]
    )

    return calculate_time_stats(all_events)


@app.get("/api/analytics/risk-scores", dependencies=[Depends(require_gateway)])
def get_risk_scores() -> Dict[str, Any]:
    """
    Get real area risk scores and classified threat levels.
    Checkpoint scores include GPS coordinates for map markers.
    Excludes non-arrest records (warrants, civil profiles, etc.).
    """
    reports = [r for r in load_real_nas_reports() if is_verified_arrest_record(r)]
    lpr_events = load_real_lpr_events()

    total_incidents = len(reports) + len(lpr_events)
    risk_score = min(100, total_incidents * 12)

    if total_incidents == 0:
        classification = "Normal — ไม่พบเหตุการณ์ที่ต้องเฝ้าระวัง"
    elif risk_score > 70:
        classification = "High Attention Required"
    elif risk_score > 30:
        classification = "Moderate Monitoring"
    else:
        classification = "Low Threat Level"

    # Group LPR events by camera/checkpoint name
    checkpoint_counts: Dict[str, int] = {}
    for event in lpr_events:
        cp = event.get("checkpoint") or "Main Checkpoint"
        checkpoint_counts[cp] = checkpoint_counts.get(cp, 0) + 1

    for r in reports:
        cp = "Field Officers (NAS Reports)"
        checkpoint_counts[cp] = checkpoint_counts.get(cp, 0) + 1

    # Build scored checkpoints — merge with registry for GPS coordinates
    registry_by_name = {cp["name"]: cp for cp in CHECKPOINT_REGISTRY}
    checkpoint_scores = []

    for cp_name, cnt in checkpoint_counts.items():
        cp_score = min(100, cnt * 20)
        risk_label = "High" if cp_score > 70 else ("Medium" if cp_score > 30 else "Low")
        reg = registry_by_name.get(cp_name, {})
        checkpoint_scores.append({
            "checkpoint": cp_name,
            "score": cp_score,
            "risk": risk_label,
            "lat": reg.get("lat"),
            "lon": reg.get("lon"),
            "cameras": reg.get("cameras", 0)
        })

    # If no real data yet — show all registered checkpoints at zero risk
    if not checkpoint_scores:
        checkpoint_scores = [
            {
                "checkpoint": cp["name"],
                "score": 0,
                "risk": "Low",
                "lat": cp["lat"],
                "lon": cp["lon"],
                "cameras": cp["cameras"]
            }
            for cp in CHECKPOINT_REGISTRY
        ]

    return {
        "overall_risk_score": risk_score,
        "total_incidents_analyzed": total_incidents,
        "classification": classification,
        "checkpoint_scores": checkpoint_scores
    }

@app.get("/api/analytics/zone-risk", dependencies=[Depends(require_gateway)])
def get_zone_risk(level: str = "district", start_date: str = None, end_date: str = None, incident_type: str = "all"):
    """
    Aggregate incident counts and evidence quantities by district or subdistrict for choropleth map.
    Supports filtering by incident_type: 'all', 'drug', 'weapon', 'alien'.
    Strictly restricted to verified arrest records/reports (excluding warrants).
    Weighting formulas:
      - drug:   score = incidents + (drug_quantity / 50.0)
      - weapon: score = incidents + (weapon_quantity * 2.0)
      - alien:  score = incidents + (alien_count / 5.0)
      - all:    score = incidents + (drug_quantity / 50.0) + (weapon_quantity * 2.0) + (alien_count / 5.0)
    """
    import re
    import httpx

    reports = [r for r in load_real_nas_reports() if is_verified_arrest_record(r)]
    lpr_events = load_real_lpr_events()

    # Fetch Chat events from chat-service
    chat_events = []
    chat_urls = [
        os.environ.get("CHAT_SERVICE_URL", "http://chat-service:5007"),
        "http://localhost:5007"
    ]
    for base_url in chat_urls:
        try:
            res = httpx.get(f"{base_url}/api/chat/events", timeout=2.0)
            if res.status_code == 200:
                raw_chat = res.json().get("events", [])
                chat_events = [e for e in raw_chat if is_verified_arrest_record(e)]
                break
        except Exception:
            continue

    def normalize(name):
        if not name:
            return ""
        if isinstance(name, dict):
            name = name.get("name") or name.get("district") or name.get("subdistrict") or name.get("address") or ""
        if not isinstance(name, str):
            name = str(name)
        return re.sub(r"^(อำเภอ|ตำบล|อ\.|ต\.)\s*", "", name).strip()

    base_incidents: Dict[str, float] = {}
    drug_quantities: Dict[str, int] = {}
    weapon_quantities: Dict[str, int] = {}
    alien_counts: Dict[str, int] = {}
    cash_quantities: Dict[str, float] = {}
    vehicle_quantities: Dict[str, int] = {}
    zone_drugs: Dict[str, dict] = {}
    seen_keys = set()

    # Helper function to extract multi-drug breakdown (Ice kg, Ketamine kg, Yaba pills, etc.)
    def extract_drug_breakdown_from_item(item: dict) -> dict:
        raw = " ".join([
            str(item.get("raw_text") or ""),
            str(item.get("behavior") or ""),
            str(item.get("notes") or ""),
            str(item.get("details") or "")
        ])
        ev_items = item.get("evidence_items") or []
        
        breakdown = {
            "yaba_pills": 0,
            "ice_kg": 0.0,
            "ketamine_kg": 0.0,
            "heroin_kg": 0.0,
            "ecstasy_pills": 0,
            "evidence_items": list(ev_items)
        }
        
        text_to_scan = raw + " " + " ".join(ev_items)
        thai_digits = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
        text_to_scan = text_to_scan.translate(thai_digits)
        
        # 1. Ice (สารไอซ์)
        m_ice = re.search(r"(?:ไอซ์|สารไอซ์)[^\d]*?([0-9]+(?:[\.,][0-9]+)?)\s*(กิโลกรัม|กก\.|กรัม)", text_to_scan, re.IGNORECASE)
        if m_ice:
            try:
                val = float(m_ice.group(1).replace(",", "."))
                unit = m_ice.group(2).lower()
                if "กิโล" in unit or "กก" in unit:
                    breakdown["ice_kg"] = max(breakdown["ice_kg"], val)
                elif "กรัม" in unit:
                    breakdown["ice_kg"] = max(breakdown["ice_kg"], round(val / 1000.0, 3))
            except ValueError:
                pass

        # 2. Ketamine (เคตามีน / คีตามีน)
        m_keta = re.search(r"(?:คีตามีน|เคตามีน|ยาเค)[^\d]*?([0-9]+(?:[\.,][0-9]+)?)\s*(กิโลกรัม|กก\.|กรัม)", text_to_scan, re.IGNORECASE)
        if m_keta:
            try:
                val = float(m_keta.group(1).replace(",", "."))
                unit = m_keta.group(2).lower()
                if "กิโล" in unit or "กก" in unit:
                    breakdown["ketamine_kg"] = max(breakdown["ketamine_kg"], val)
                elif "กรัม" in unit:
                    breakdown["ketamine_kg"] = max(breakdown["ketamine_kg"], round(val / 1000.0, 3))
            except ValueError:
                pass

        # 3. Yaba (ยาบ้า)
        auth_drug_qty = int(item.get("drug_quantity") or 0)
        if auth_drug_qty > 0:
            breakdown["yaba_pills"] = auth_drug_qty
        else:
            m_yaba = re.search(r"(?:ยาบ้า|เมทแอมเฟตามีน)[^\d]*?([0-9]+(?:,[0-9]+)?)\s*เม็ด", text_to_scan, re.IGNORECASE)
            if m_yaba:
                try:
                    val = int(m_yaba.group(1).replace(",", ""))
                    breakdown["yaba_pills"] = max(breakdown["yaba_pills"], val)
                except ValueError:
                    pass
            elif any(k in text_to_scan for k in ["ยาบ้า", "เม็ด"]):
                breakdown["yaba_pills"] = auth_drug_qty
            elif breakdown["ice_kg"] == 0 and breakdown["ketamine_kg"] == 0:
                breakdown["yaba_pills"] = auth_drug_qty

        # 4. Weapons & Firearms
        if not any("ปืน" in x or "อาวุธ" in x for x in breakdown["evidence_items"]):
            m_gun = re.search(r"((?:อาวุธปืน|ปืน|เครื่องกระสุน)[^\n\r,;]{3,40}?(?:กระบอก|นัด|เล่ม|ชิ้น|อัน))", text_to_scan)
            if m_gun:
                breakdown["evidence_items"].append(f"🔫 {m_gun.group(1).strip()}")
            elif item.get("weapon_quantity"):
                breakdown["evidence_items"].append(f"🔫 อาวุธปืน {item['weapon_quantity']} กระบอก")
                
        return breakdown

    # Helper function to extract total seized vehicle count across all vehicle types
    def extract_vehicle_count_from_item(item: dict) -> int:
        v_cnt = int(item.get("vehicle_count") or 0)
        if v_cnt > 0:
            return v_cnt
        if item.get("vehicle_plates"):
            return len(item["vehicle_plates"])

        # 1. Inspect evidence_items first (avoid regex collision or double count)
        ev_items = item.get("evidence_items") or []
        ev_veh_texts = [str(x) for x in ev_items if any(k in str(x) for k in ["ยานพาหนะ", "รถยนต์", "รถกระบะ", "รถเก๋ง", "🚗"])]
        if ev_veh_texts:
            combined_ev = " ".join(ev_veh_texts)
            matches = re.findall(r'([0-9]+)\s*คัน', combined_ev)
            if matches:
                return sum(int(x) for x in matches)
            return len(ev_veh_texts)

        # 2. Inspect raw_text
        raw = (item.get("raw_text") or item.get("details") or item.get("title") or "").strip()
        if raw:
            thai_digits = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
            raw = raw.translate(thai_digits)
            matches = re.findall(r'(?:รถยนต์|รถกระบะ|รถเก๋ง|รถจักรยานยนต์|จยย\.|ยานพาหนะ|รถตู้|รถบรรทุก|รถสิบล้อ)[^\d\n\r,;]{0,30}?([0-9]+)\s*คัน', raw)
            if matches:
                return sum(int(x) for x in matches)
            if any(k in raw for k in ["รถยนต์", "รถกระบะ", "รถเก๋ง", "ยานพาหนะ", "รถจักรยานยนต์", "จยย."]):
                all_kan = re.findall(r'([0-9]+)\s*คัน', raw)
                if all_kan:
                    return sum(int(x) for x in all_kan)
                return 1
        return 0

    # Process LPR events (checkpoints) - only for 'all' or 'lpr_hit'
    if incident_type in ["all", "lpr_hit"]:
        for ev in lpr_events:
            cp = normalize(ev.get("checkpoint", ""))
            if cp:
                base_incidents[cp] = base_incidents.get(cp, 0) + 1

    # Combine NAS and Chat events for deduplicated processing
    raw_records = []

    for r in reports:
        dt = (r.get("created_at") or r.get("timestamp") or "")[:10]
        if start_date and dt and dt < start_date:
            continue
        if end_date and dt and dt > end_date:
            continue

        loc_val = r.get("location")
        if isinstance(loc_val, dict):
            loc_val = loc_val.get("name") or loc_val.get("district") or loc_val.get("address") or ""

        subdist = r.get("subdistrict") or r.get("tambon")
        dist = r.get("district")
        # Build comprehensive combined text for classification and location resolution
        text_parts = [
            str(r.get("raw_text") or ""),
            str(r.get("details") or ""),
            str(r.get("title") or ""),
            str(r.get("behavior") or ""),
            str(r.get("notes") or "")
        ]
        raw_text = " ".join(text_parts).strip().lower()

        # ADR 0009: Crime scene location takes precedence over suspects' home addresses
        addr_candidate = ""
        if r.get("incident_location"):
            addr_candidate = r.get("incident_location")
        elif r.get("behavior"):
            m_scene = re.search(r'สถานที่เกิดเหตุ\s*[:\.]?\s*([^\n\r]+)', r.get("behavior") or "")
            if m_scene:
                addr_candidate = m_scene.group(1).strip()
            else:
                addr_candidate = r.get("behavior")
        elif r.get("notes"):
            addr_candidate = r.get("notes")
        elif r.get("suspects") and len(r["suspects"]) > 0 and r["suspects"][0].get("address"):
            addr_candidate = r["suspects"][0]["address"]

        loc_info = resolve_buriram_location(
            subdist=subdist,
            dist=dist,
            raw_text=f"{loc_val} {addr_candidate} {raw_text}"
        )
        if not loc_info["is_buriram"]:
            continue

        if level == "subdistrict":
            if not loc_info["subdistrict"]:
                continue  # Skip district-only cases in subdistrict choropleth to avoid center-tambon pollution
            loc_key = loc_info["compound_key"]
            loc_name = loc_info["subdistrict"]
            loc_dist = loc_info["district"] or ""
            loc_full = loc_info["full_name"]
        else:
            if not loc_info["district"]:
                continue
            loc_key = loc_info["district"]
            loc_name = loc_info["district"]
            loc_dist = loc_info["district"]
            loc_full = f"อำเภอ{loc_info['district']}"

        name_parts = (r.get("first_name") or "").strip(), (r.get("last_name") or "").strip()
        suspect = r.get("suspect_name") or ""
        r_id_card = r.get("id_card") or r.get("citizen_id")
        if not name_parts[0] and suspect:
            sp = suspect.split()
            name_parts = (sp[0], sp[1] if len(sp) > 1 else "")
        elif not name_parts[0] and r.get("suspects") and len(r["suspects"]) > 0:
            first_s = r["suspects"][0]
            s_name = (first_s.get("suspect_name") or "").strip()
            if s_name:
                sp = s_name.split()
                name_parts = (sp[0], sp[1] if len(sp) > 1 else "")
            if not r_id_card and first_s.get("id_card"):
                r_id_card = first_s.get("id_card")

        case_id = str(r.get("case_id") or r.get("id") or "").strip()

        # Detect incident type from report
        r_type = r.get("incident_type")
        if not r_type:
            d_qty = int(r.get("drug_quantity") or r.get("pill_count") or 0)
            w_qty = int(r.get("weapon_quantity") or 0)
            a_qty = int(r.get("alien_count") or 0)
            if d_qty > 0 or any(k in raw_text for k in ["ยาบ้า", "ยาเสพติด", "ไอซ์", "คีตามีน", "เคตามีน", "เฮโรอีน"]):
                r_type = "drug"
            elif w_qty > 0 or any(k in raw_text for k in ["อาวุธ", "ปืน", "มีด", "ระเบิด"]):
                r_type = "weapon"
            elif a_qty > 0 or any(k in raw_text for k in ["ต่างด้าว", "หลบหนีเข้าเมือง", "คนต่างด้าว"]):
                r_type = "alien"
            else:
                r_type = "general"

        if incident_type != "all" and r_type != incident_type:
            continue

        # Extract cash and vehicles from NAS report
        r_cash = float(r.get("seized_cash") or 0)
        if r_cash == 0 and raw_text:
            m_c = re.search(r'(?:เงินสด|ตรวจยึดเงิน|ของกลางเงิน)[^\d]*?([0-9,]+(?:\.[0-9]+)?)\s*บาท', raw_text)
            if m_c:
                try: r_cash = float(m_c.group(1).replace(',', ''))
                except ValueError: pass

        r_veh = extract_vehicle_count_from_item(r)

        raw_records.append({
            "source": "NAS Report",
            "loc_key": loc_key,
            "loc_name": loc_name,
            "loc_dist": loc_dist,
            "loc_full": loc_full,
            "date": dt,
            "case_id": case_id,
            "raw_text": raw_text,
            "incident_type": r_type,
            "first_name": name_parts[0],
            "last_name": name_parts[1],
            "id_card": r_id_card,
            "drug_quantity": int(r.get("drug_quantity") or r.get("pill_count") or 0),
            "weapon_quantity": int(r.get("weapon_quantity") or 0),
            "alien_count": int(r.get("alien_count") or 0),
            "seized_cash": r_cash,
            "vehicle_count": r_veh,
            "evidence_items": r.get("evidence_items") or []
        })

    for ev in chat_events:
        if ev.get("is_drop_point"):
            continue  # ข้ามจุดวางงาน

        dt = (ev.get("created_at") or "")[:10]
        if start_date and dt and dt < start_date:
            continue
        if end_date and dt and dt > end_date:
            continue

        raw_text = (ev.get("raw_text") or "").strip().lower()
        ev_type = ev.get("incident_type")
        
        # Intelligent reclassification based on mission and legal statutes
        if any(k in raw_text for k in ["พ.ร.บ.อาวุธปืน", "ตรวจยึดอาวุธปืน", "อาวุธปืน", "ปืนปากกา", "ปืนลูกซอง", "ปืนพก", "ปืนแก๊ป", "ปืนรีวอลเวอร์", "เครื่องกระสุน", "แบลงค์กัน", "บีบีกัน"]):
            ev_type = "weapon"
        elif any(k in raw_text for k in ["พ.ร.บ.คนเข้าเมือง", "คนต่างด้าว", "หลบหนีเข้าเมือง", "สัญชาติกัมพูชา", "สัญชาติลาว", "สัญชาติเมียนมา"]):
            ev_type = "alien"
        elif any(k in raw_text for k in ["ยาบ้า", "สารไอซ์", "เคตามีน", "ยาเสพติด", "พ.ร.บ.ยาเสพติด"]):
            ev_type = "drug"
        else:
            ev_type = ev_type or "general"

        if incident_type != "all" and ev_type != incident_type:
            continue

        w_qty = int(ev.get("weapon_quantity") or 0)
        if w_qty == 0 and ev_type == "weapon":
            m_wq = re.search(r"([0-9๐-๙]+)\s*กระบอก", raw_text)
            if m_wq:
                try:
                    w_qty = int(m_wq.group(1))
                except ValueError:
                    w_qty = 1
            else:
                w_qty = 1

        subdist = ev.get("subdistrict")
        dist = ev.get("district")
        loc_name_val = ev.get("location_name") or ""

        loc_info = resolve_buriram_location(
            subdist=subdist,
            dist=dist,
            raw_text=f"{loc_name_val} {raw_text}"
        )
        if not loc_info["is_buriram"]:
            continue

        if level == "subdistrict":
            if not loc_info["subdistrict"]:
                continue
            loc_key = loc_info["compound_key"]
            loc_name = loc_info["subdistrict"]
            loc_dist = loc_info["district"] or ""
            loc_full = loc_info["full_name"]
        else:
            if not loc_info["district"]:
                continue
            loc_key = loc_info["district"]
            loc_name = loc_info["district"]
            loc_dist = loc_info["district"]
            loc_full = f"อำเภอ{loc_info['district']}"

        case_id = str(ev.get("case_id") or "").strip()

        # Extract cash and vehicles from chat event
        ev_cash = float(ev.get("seized_cash") or 0)
        if ev_cash == 0 and raw_text:
            m_c = re.search(r'(?:เงินสด|ตรวจยึดเงิน|ของกลางเงิน)[^\d]*?([0-9,]+(?:\.[0-9]+)?)\s*บาท', raw_text)
            if m_c:
                try: ev_cash = float(m_c.group(1).replace(',', ''))
                except ValueError: pass

        ev_veh = extract_vehicle_count_from_item(ev)

        raw_records.append({
            "source": "Chat Event",
            "loc_key": loc_key,
            "loc_name": loc_name,
            "loc_dist": loc_dist,
            "loc_full": loc_full,
            "date": dt,
            "case_id": case_id,
            "raw_text": raw_text,
            "incident_type": ev_type,
            "first_name": (ev.get("first_name") or "").strip(),
            "last_name": (ev.get("last_name") or "").strip(),
            "id_card": ev.get("id_card"),
            "drug_quantity": int(ev.get("drug_quantity") or 0),
            "weapon_quantity": w_qty,
            "alien_count": int(ev.get("alien_count") or 0),
            "seized_cash": ev_cash,
            "vehicle_count": ev_veh,
            "evidence_items": ev.get("evidence_items") or []
        })

    zone_meta: Dict[str, dict] = {}

    for item in raw_records:
        fn = item["first_name"].lower()
        ln = item["last_name"].lower()
        idc = (str(item["id_card"]).strip()) if item["id_card"] else None
        dt = item["date"]
        loc_key = item["loc_key"]
        case_id = str(item["case_id"]).lower() if item["case_id"] else ""
        raw_text = item["raw_text"]

        # Duplicate key includes person identity + incident signature
        person_id = idc if idc else (f"{fn}:{ln}" if (fn and ln) else None)

        is_dup = False
        ev_fingerprint = "|".join(sorted(item.get("evidence_items") or []))
        if case_id:
            dup_key = f"{person_id or 'case'}::{loc_key}::{case_id}"
            if dup_key in seen_keys:
                is_dup = True
                logger.warning(f"[Deduplication] ข้ามรายงานซ้ำคดีเดิม: {dup_key} จาก {item['source']}")
            else:
                seen_keys.add(dup_key)
        elif person_id:
            incident_sig = f"{loc_key}:{ev_fingerprint}" if ev_fingerprint else f"{loc_key}:{raw_text[:50]}"
            dup_key = f"{person_id}::{incident_sig}"
            if dup_key in seen_keys:
                is_dup = True
                logger.warning(f"[Deduplication] ข้ามรายงานซ้ำคดีเดิม: บุคคล {person_id} (ข้อมูล {incident_sig[:60]}) จาก {item['source']}")
            else:
                seen_keys.add(dup_key)
        else:
            if ev_fingerprint:
                dup_key = f"anon::{loc_key}::{ev_fingerprint}"
                if dup_key in seen_keys:
                    is_dup = True
                    logger.warning(f"[Deduplication] ข้ามรายงานซ้ำ (นิรนาม): {dup_key} จาก {item['source']}")
                else:
                    seen_keys.add(dup_key)
            elif raw_text:
                dup_key = f"anon::{loc_key}::{raw_text[:60]}"
                if dup_key in seen_keys:
                    is_dup = True
                else:
                    seen_keys.add(dup_key)

        if is_dup:
            continue

        if loc_key:
            zone_meta[loc_key] = {
                "name": item["loc_name"],
                "district": item["loc_dist"],
                "full_name": item["loc_full"]
            }
            base_incidents[loc_key] = base_incidents.get(loc_key, 0) + 1
            drug_quantities[loc_key] = drug_quantities.get(loc_key, 0) + item["drug_quantity"]
            weapon_quantities[loc_key] = weapon_quantities.get(loc_key, 0) + item["weapon_quantity"]
            alien_counts[loc_key] = alien_counts.get(loc_key, 0) + item["alien_count"]
            cash_quantities[loc_key] = cash_quantities.get(loc_key, 0.0) + item.get("seized_cash", 0.0)
            vehicle_quantities[loc_key] = vehicle_quantities.get(loc_key, 0) + item.get("vehicle_count", 0)

            # Aggregate structured drug breakdown
            bd = extract_drug_breakdown_from_item(item)
            if loc_key not in zone_drugs:
                zone_drugs[loc_key] = {
                    "yaba_pills": 0,
                    "ice_kg": 0.0,
                    "ketamine_kg": 0.0,
                    "heroin_kg": 0.0,
                    "ecstasy_pills": 0,
                    "evidence_items": []
                }
            z_drug = zone_drugs[loc_key]
            z_drug["yaba_pills"] += bd["yaba_pills"]
            z_drug["ice_kg"] += bd["ice_kg"]
            z_drug["ketamine_kg"] += bd["ketamine_kg"]
            z_drug["heroin_kg"] += bd["heroin_kg"]
            z_drug["ecstasy_pills"] += bd["ecstasy_pills"]
            for ev_it in bd["evidence_items"]:
                if ev_it not in z_drug["evidence_items"]:
                    z_drug["evidence_items"].append(ev_it)

    zones = []
    all_keys = set(list(base_incidents.keys()) + list(drug_quantities.keys()) + list(weapon_quantities.keys()) + list(alien_counts.keys()) + list(cash_quantities.keys()) + list(vehicle_quantities.keys()))
    for k in all_keys:
        if not k:
            continue
        inc_cnt = int(base_incidents.get(k, 0))
        d_qty = drug_quantities.get(k, 0)
        w_qty = weapon_quantities.get(k, 0)
        a_cnt = alien_counts.get(k, 0)
        c_qty = cash_quantities.get(k, 0.0)
        v_qty = vehicle_quantities.get(k, 0)

        z_drug = zone_drugs.get(k, {
            "yaba_pills": d_qty,
            "ice_kg": 0.0,
            "ketamine_kg": 0.0,
            "heroin_kg": 0.0,
            "ecstasy_pills": 0,
            "evidence_items": []
        })

        # Calculate drug weighted impact score
        # 50 pills yaba = 1.0, 1 kg Ice = 20.0, 1 kg Ketamine = 15.0, 1 kg Heroin = 30.0
        drug_score = (z_drug["yaba_pills"] / 50.0) + (z_drug["ice_kg"] * 20.0) + (z_drug["ketamine_kg"] * 15.0) + (z_drug["heroin_kg"] * 30.0)
        weapon_score = round(w_qty * 2.0, 1)
        cash_score = round(c_qty / 100000.0, 2)
        vehicle_score = round(v_qty * 0.5, 2)

        # Apply specific weighting formulas based on selected category
        if incident_type == "drug":
            score = round(inc_cnt + drug_score + cash_score, 1)
        elif incident_type == "weapon":
            score = round(inc_cnt + weapon_score + vehicle_score, 1)
        elif incident_type == "alien":
            score = round(inc_cnt + (a_cnt / 5.0) + vehicle_score, 1)
        else: # "all"
            score = round(inc_cnt + drug_score + weapon_score + (a_cnt / 5.0) + cash_score + vehicle_score, 1)

        meta = zone_meta.get(k, {"name": k, "district": "", "full_name": k})

        if score > 0 or inc_cnt > 0:
            zones.append({
                "key": k,
                "name": meta["name"],
                "district": meta.get("district", ""),
                "full_name": meta.get("full_name", meta["name"]),
                "count": score,
                "incidents": inc_cnt,
                "drug_quantity": z_drug["yaba_pills"] or d_qty,
                "drug_breakdown": {
                    "yaba_pills": int(z_drug["yaba_pills"]),
                    "ice_kg": round(float(z_drug["ice_kg"]), 2),
                    "ketamine_kg": round(float(z_drug["ketamine_kg"]), 2),
                    "heroin_kg": round(float(z_drug["heroin_kg"]), 2),
                    "ecstasy_pills": int(z_drug["ecstasy_pills"])
                },
                "evidence_items": z_drug["evidence_items"],
                "weapon_quantity": w_qty,
                "alien_count": a_cnt,
                "seized_cash": round(c_qty, 2),
                "vehicle_count": v_qty,
                "incident_type": incident_type
            })

    zones.sort(key=lambda z: z["count"], reverse=True)
    return {"level": level, "incident_type": incident_type, "zones": zones, "total_zones": len(zones)}


# ── GPSONE Hardware Tracker Integration (gps903.net) ──────────────────────
from pydantic import BaseModel
from services.gpsone_tracker import gpsone_manager, is_superadmin_user


class GpsOneDevicePayload(BaseModel):
    imei: str = ""
    password: Optional[str] = None
    name: Optional[str] = None
    icon_type: str = "target"
    enabled: bool = True
    notes: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    mode: str = "gpsone"
    provider: str = "auto"
    allowed_users: Optional[List[str]] = None


class GpsOneTogglePayload(BaseModel):
    enabled: Optional[bool] = None
    online_only: bool = False


class GpsOneUserPermissionsPayload(BaseModel):
    username: str
    imeis: List[str] = []


class GpsOneDevicePermissionsPayload(BaseModel):
    imei: str
    allowed_users: List[str] = []


@app.on_event("startup")
def _start_gpsone_poller() -> None:
    try:
        gpsone_manager.start_background_poller()
    except Exception as exc:
        logger.warning("Failed to start GPSONE background poller: %s", exc)


@app.get("/api/analytics/gpsone/locations", dependencies=[Depends(require_gateway)])
def get_gpsone_locations(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Return real-time cached positions for all enabled GPSONE / DDGPS trackers visible to the current user."""
    gpsone_manager.start_background_poller()
    active_devices = gpsone_manager.list_devices(
        include_disabled=False,
        viewer_user=x_user,
        viewer_role=x_role,
    )
    all_devices = gpsone_manager.list_devices(
        include_disabled=True,
        viewer_user=x_user,
        viewer_role=x_role,
    )
    return {
        "devices": active_devices,
        "all_devices": all_devices,
        "active_count": len(active_devices),
        "total_count": len(all_devices),
        "viewer_user": (x_user or "").strip().lower(),
        "viewer_role": (x_role or "").strip().lower(),
        "is_superadmin": is_superadmin_user(x_user, x_role),
    }


@app.get("/api/analytics/gpsone/devices", dependencies=[Depends(require_gateway)])
def list_gpsone_devices(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Return configured GPSONE / DDGPS trackers visible to the current user for management UI."""
    gpsone_manager.start_background_poller()
    devices = gpsone_manager.list_devices(
        include_disabled=True,
        viewer_user=x_user,
        viewer_role=x_role,
    )
    return {
        "devices": devices,
        "viewer_user": (x_user or "").strip().lower(),
        "viewer_role": (x_role or "").strip().lower(),
        "is_superadmin": is_superadmin_user(x_user, x_role),
    }


@app.post("/api/analytics/gpsone/devices", dependencies=[Depends(require_gateway)])
def upsert_gpsone_device(
    payload: GpsOneDevicePayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Register or update a GPSONE / DDGPS / YUKI GPS tracker by IMEI/Account+password or manual coordinates."""
    gpsone_manager.start_background_poller()
    try:
        device = gpsone_manager.upsert_device(
            imei=payload.imei,
            password=payload.password,
            name=payload.name,
            icon_type=payload.icon_type,
            enabled=payload.enabled,
            notes=payload.notes,
            verify_login=True,
            latitude=payload.latitude,
            longitude=payload.longitude,
            mode=payload.mode,
            provider=payload.provider,
            allowed_users=payload.allowed_users,
            actor_user=x_user,
            actor_role=x_role,
        )
        return {"status": "ok", "device": device}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ GPSONE / DDGPS / YUKI GPS ได้: {exc}")


@app.post("/api/analytics/gpsone/devices/toggle-all", dependencies=[Depends(require_gateway)])
def toggle_all_gpsone_devices(
    payload: GpsOneTogglePayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Enable or disable all GPSONE trackers visible to the caller at once (or enable online-only)."""
    target_state = True if payload.enabled is None else bool(payload.enabled)
    affected = gpsone_manager.set_all_devices_enabled(
        target_state,
        online_only=bool(payload.online_only),
        actor_user=x_user,
        actor_role=x_role,
    )
    return {
        "status": "ok",
        "enabled": target_state,
        "online_only": bool(payload.online_only),
        "affected": affected,
        "all_devices": gpsone_manager.list_devices(
            include_disabled=True,
            viewer_user=x_user,
            viewer_role=x_role,
        ),
    }


@app.post("/api/analytics/gpsone/devices/{imei}/toggle", dependencies=[Depends(require_gateway)])
def toggle_gpsone_device(
    imei: str,
    payload: Optional[GpsOneTogglePayload] = None,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Toggle or set enabled/disabled state for a single GPSONE tracker."""
    try:
        target = payload.enabled if payload is not None else None
        dev = gpsone_manager.set_device_enabled(imei, enabled=target, actor_user=x_user, actor_role=x_role)
        return {"status": "ok", "device": dev}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.delete("/api/analytics/gpsone/devices/{imei}", dependencies=[Depends(require_gateway)])
def delete_gpsone_device(
    imei: str,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Remove a GPSONE tracker from the system (allowed for device owner or Superadmin)."""
    try:
        deleted = gpsone_manager.delete_device(imei, actor_user=x_user, actor_role=x_role)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not deleted:
        raise HTTPException(status_code=404, detail="ไม่พบอุปกรณ์ GPS ที่ระบุ")
    return {"status": "ok", "deleted": imei}


@app.get("/api/analytics/gpsone/permissions", dependencies=[Depends(require_gateway)])
def get_gpsone_permissions(
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Return GPS device permission matrix (all devices for Superadmin, own added devices for regular users)."""
    return gpsone_manager.get_permissions_matrix(viewer_user=x_user, viewer_role=x_role)


@app.post("/api/analytics/gpsone/permissions/user", dependencies=[Depends(require_gateway)])
def set_gpsone_user_permissions(
    payload: GpsOneUserPermissionsPayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Set which GPS devices a specific user is allowed to view (scoped to caller's manageable devices)."""
    try:
        result = gpsone_manager.set_user_allowed_devices(
            payload.username,
            payload.imeis,
            actor_user=x_user,
            actor_role=x_role,
        )
        return {
            "status": "ok",
            **result,
            "all_devices": gpsone_manager.list_devices(
                include_disabled=True,
                viewer_user=x_user,
                viewer_role=x_role,
            ),
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/analytics/gpsone/permissions/device", dependencies=[Depends(require_gateway)])
def set_gpsone_device_permissions(
    payload: GpsOneDevicePermissionsPayload,
    x_user: Optional[str] = Header(None, alias="X-User"),
    x_role: Optional[str] = Header(None, alias="X-Role"),
) -> Dict[str, Any]:
    """Set which users are allowed to view a specific GPS device (allowed for device owner or Superadmin)."""
    try:
        dev = gpsone_manager.set_device_allowed_users(
            payload.imei,
            payload.allowed_users,
            actor_user=x_user,
            actor_role=x_role,
        )
        return {
            "status": "ok",
            "device": dev,
            "all_devices": gpsone_manager.list_devices(
                include_disabled=True,
                viewer_user=x_user,
                viewer_role=x_role,
            ),
        }
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/api/analytics/gpsone/devices/{imei}/refresh", dependencies=[Depends(require_gateway)])
def refresh_gpsone_device(imei: str) -> Dict[str, Any]:
    """Force an immediate live poll from GPSONE cloud for a specific tracker."""
    try:
        state = gpsone_manager.poll_single_device(imei, force_relogin=False)
        devices = [d for d in gpsone_manager.list_devices(include_disabled=True) if d["imei"] == imei]
        return {"status": "ok", "device": devices[0] if devices else state}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ซิงค์ข้อมูลจาก GPSONE ไม่สำเร็จ: {exc}")


@app.get("/api/analytics/gpsone/devices/{imei}/history", dependencies=[Depends(require_gateway)])
def get_gpsone_device_history(
    imei: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    hours: int = 0,
    show_lbs: int = 1,
) -> Dict[str, Any]:
    """Retrieve historical movement trajectory for a GPSONE tracker (unlimited by default when hours <= 0)."""
    import datetime as _dt

    ict = _dt.timezone(_dt.timedelta(hours=7))
    now_ict = _dt.datetime.now(ict)
    end_str = end or now_ict.strftime("%Y-%m-%d %H:%M:%S")
    all_history = (hours <= 0 and not start)
    start_str = start or (
        None if all_history else (now_ict - _dt.timedelta(hours=max(1, hours))).strftime("%Y-%m-%d %H:%M:%S")
    )
    try:
        return gpsone_manager.fetch_device_history(
            imei,
            start_time=start_str,
            end_time=end_str,
            show_lbs=show_lbs,
            all_history=all_history,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ดึงประวัติเส้นทางจาก GPSONE ไม่สำเร็จ: {exc}")

