import json
import os
import re
import logging

logger = logging.getLogger("buriram_admin")

GEOJSON_PATH = os.path.join(os.path.dirname(__file__), "buriram_subdistrict.geojson")

BURIRAM_DISTRICTS = []
DISTRICT_NORM_MAP = {}
SUBDISTRICTS_MAP = {}       # subdistrict_norm -> list of parent_district_norms
COMPOUND_KEYS = set()       # "subdistrict_norm::district_norm"
UNIQUE_SUBDISTRICTS = set() # subdistricts that exist in exactly one district

TYPO_CORRECTIONS = {
    "ปะดำ": "ปะคำ",
    "ประดำ": "ปะคำ",
    "ประคำ": "ปะคำ",
    "นางรี": "นางรอง",
    "โตกมะม่วง": "โคกมะม่วง",
    "สะเตา": "สะเดา",
    "โกรกแกว": "โกรกแก้ว",
    "สระแกว": "สระแก้ว",
    "โนนค้นแดง": "โนนดินแดง",
    "ทุงกระตาดพัฒนา": "ทุ่งกระตาดพัฒนา",
    "ละหานทร": "ละหานทราย",
    "เฉลิมพระเกียร": "เฉลิมพระเกียรติ",
    "เมืองไผ": "เมืองไผ่",
    "ไทยสามัคคีอ": "ไทยสามัคคี"
}

IGNORED_WORDS = {
    "ชื่อสกุล", "บครราคธิมา", "บางเขน", "พนมไพร", "หน้าพระลาน",
    "พลสงคราม", "หนองหลุม", "ไผ่", "นายโศก", "ไม่ระบุ", "ไม่ทราบ",
    "สภ", "สภ.", "ตำรวจ", "สถานีตำรวจ", "ตำบล", "อำเภอ"
}

def normalize_name(name) -> str:
    if not name:
        return ""
    if isinstance(name, dict):
        name = name.get("subdistrict") or name.get("name") or name.get("district") or ""
    name_str = str(name).strip()
    name_str = re.sub(r"^(อำเภอ|กิ่งอำเภอ|ตำบล|อ\.|ต\.|จ\.|จังหวัด)\s*", "", name_str)
    name_str = re.sub(r"^(บุรีรัมย์|จังหวัดบุรีรัมย์)\s*", "", name_str)
    name_str = name_str.strip()

    # Strip accidental trailing 'อ' from unspaced 'ต.ตำบลอ.อำเภอ' (e.g. ไทยสามัคคีอ -> ไทยสามัคคี)
    if name_str.endswith("อ") and len(name_str) > 3:
        cand = name_str[:-1].strip()
        if cand in TYPO_CORRECTIONS or (globals().get("SUBDISTRICTS_MAP") and cand in SUBDISTRICTS_MAP) or (globals().get("DISTRICT_NORM_MAP") and cand in DISTRICT_NORM_MAP):
            name_str = cand

    return TYPO_CORRECTIONS.get(name_str, name_str)

def _init_buriram_data():
    global BURIRAM_DISTRICTS, DISTRICT_NORM_MAP, SUBDISTRICTS_MAP, COMPOUND_KEYS, UNIQUE_SUBDISTRICTS
    if not os.path.exists(GEOJSON_PATH):
        logger.warning(f"Buriram GeoJSON file not found at {GEOJSON_PATH}")
        return

    try:
        with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        dist_set = set()
        sub_dict = {}

        for feat in data.get("features", []):
            p = feat.get("properties", {})
            sub_th = normalize_name(p.get("subdistrictNameTh") or p.get("NL_NAME_3") or "")
            dist_th = normalize_name(p.get("districtNameTh") or p.get("NL_NAME_2") or "")

            if dist_th:
                dist_set.add(dist_th)
                DISTRICT_NORM_MAP[dist_th] = dist_th

            if sub_th and dist_th:
                if sub_th not in sub_dict:
                    sub_dict[sub_th] = []
                if dist_th not in sub_dict[sub_th]:
                    sub_dict[sub_th].append(dist_th)
                COMPOUND_KEYS.add(f"{sub_th}::{dist_th}")

        BURIRAM_DISTRICTS = sorted(list(dist_set))
        SUBDISTRICTS_MAP = sub_dict
        UNIQUE_SUBDISTRICTS = {k for k, v in sub_dict.items() if len(v) == 1}

        logger.info(f"Loaded {len(BURIRAM_DISTRICTS)} Buriram districts and {len(SUBDISTRICTS_MAP)} subdistricts.")
    except Exception as e:
        logger.error(f"Error initializing Buriram admin data: {e}")

_init_buriram_data()

def resolve_buriram_location(subdist=None, dist=None, raw_text: str = "") -> dict:
    """
    Validates and resolves a location to an official Buriram district and/or subdistrict.
    Guarantees no false center-tambon fallback and no hallucinated zones.
    """
    sub_n = normalize_name(subdist)
    dist_n = normalize_name(dist)

    # If subdist or dist missing, scan raw_text
    if (not sub_n or not dist_n) and raw_text:
        text_clean = str(raw_text)
        if not sub_n:
            m_s = re.search(r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)', text_clean)
            if m_s:
                sub_n = normalize_name(m_s.group(1))
        if not dist_n:
            m_d = re.search(r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)', text_clean)
            if m_d:
                dist_n = normalize_name(m_d.group(1))

    # Reject known noise
    if sub_n in IGNORED_WORDS:
        sub_n = ""
    if dist_n in IGNORED_WORDS:
        dist_n = ""

    # Special check: If raw_text mentions specific police stations e.g. สภ.นางรอง
    if not dist_n and raw_text:
        m_police = re.search(r'สภ\.\s*([ก-๙a-zA-Z]+)', raw_text)
        if m_police:
            p_name = normalize_name(m_police.group(1))
            if p_name in BURIRAM_DISTRICTS:
                dist_n = p_name

    res_sub = None
    res_dist = None

    # Step 1: Validate subdistrict
    if sub_n and sub_n in SUBDISTRICTS_MAP:
        parents = SUBDISTRICTS_MAP[sub_n]
        if dist_n and dist_n in parents:
            # Exact compound match!
            res_sub = sub_n
            res_dist = dist_n
        elif len(parents) == 1:
            # Sub-district is unique in Buriram -> auto-infer parent district
            res_sub = sub_n
            res_dist = parents[0]
        else:
            # Sub-district is ambiguous across multiple districts (e.g. สะเดา, ชุมแสง)
            if dist_n and dist_n in parents:
                res_sub = sub_n
                res_dist = dist_n
            else:
                # Discard ambiguous subdistrict if district does not match to prevent cross-district ghosting
                res_sub = None
                if dist_n in BURIRAM_DISTRICTS:
                    res_dist = dist_n

    # Step 2: Validate district if subdistrict was not found or was district-only
    if not res_sub and dist_n and dist_n in BURIRAM_DISTRICTS:
        res_dist = dist_n

    # Compute compound keys and display labels
    compound_key = ""
    full_name = ""
    if res_sub and res_dist:
        compound_key = f"{res_sub}::{res_dist}"
        full_name = f"ตำบล{res_sub} (อ.{res_dist})"
    elif res_dist:
        compound_key = res_dist
        full_name = f"อำเภอ{res_dist}"

    return {
        "is_buriram": bool(res_dist or res_sub),
        "district": res_dist,
        "subdistrict": res_sub,
        "full_name": full_name,
        "compound_key": compound_key
    }
