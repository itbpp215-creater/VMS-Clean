"""
BPP-VMS | chat-service | services/intent_parser.py
---------------------------------------------------
Intent Parser สำหรับสกัดข้อมูลเหตุการณ์และบุคคลต้องสงสัยจากข้อความภาษาไทย/อังกฤษ
สกัดข้อมูล:
- ข้อมูลบุคคล: ชื่อ, นามสกุล, ชื่อเล่น, เบอร์โทร
- โซเชียลมีเดีย: Facebook, Line ID, Instagram
- สถานที่: ตำบล, อำเภอ, จังหวัด, พิกัด GPS, ที่อยู่, สถานที่จับกุม
- ข้อมูลยานพาหนะ: หมายเลขทะเบียน
---------------------------------------------------
Author : BPP-VMS Team
Created: 2026-08-04
"""

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Keyword mappings สำหรับประเภทเหตุการณ์
# ---------------------------------------------------------------------------
_INCIDENT_KEYWORDS: list[tuple[list[str], str]] = [
    (["พ.ร.บ.อาวุธปืน", "ตรวจยึดอาวุธปืน", "อาวุธปืน", "ปืนลูกซอง", "ปืนปากกา", "ปืนรีวอลเวอร์", "ปืนแก๊ป", "ปืนพก", "ปืน", "อาวุธ", "วัตถุระเบิด", "ระเบิด", "กระสุน", "เครื่องกระสุน", "แบลงค์กัน", "บีบีกัน"], "weapon"),
    (["พ.ร.บ.คนเข้าเมือง", "คนต่างด้าว", "ต่างด้าว", "หลบหนีเข้าเมือง", "เข้าเมืองโดยผิดกฎหมาย", "เข้ามาในราชอาณาจักรโดยไม่ได้รับอนุญาต", "สัญชาติกัมพูชา", "สัญชาติลาว", "สัญชาติเมียนมา", "สัญชาติพม่า", "พม่า", "กัมพูชา", "ลาว"], "alien"),
    (["พ.ร.บ.ยาเสพติด", "คดียาเสพติด", "ยาบ้า", "ยาเสพติด", "สารเสพติด", "กัญชา", "สารไอซ์", "ยาไอซ์", "ไอซ์", "เฮโรอีน", "เคตามีน", "คีตามีน", "ยาเค", "ยาอี", "เสพยา", "เสพยาบ้า", "เสพสารเสพติด"], "drug"),
    (["ผู้ต้องสงสัย", "น่าสงสัย", "ต้องสงสัย", "คนต้องสงสัย", "ผู้ต้องหา"], "suspect"),
    (["ผ่านด่าน", "ด่านตรวจ", "lpr", "ป้ายทะเบียน"], "lpr_hit"),
    (["บันทึกจับกุม", "รายงานการจับกุม", "รายงานจับกุม", "ผลการจับกุม", "บันทึกการจับกุม", "ร่วมกันจับกุม", "จับกุมตัว", "คดีอาญา", "ลักทรัพย์", "ชิงทรัพย์", "ปล้นทรัพย์", "ทำร้ายร่างกาย", "ฉ้อโกง", "การพนัน", "บันทึกคดี"], "general"),
]

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
_RE_GPS = re.compile(r"(\d{1,2}[.,]\d+)[,\s]+(\d{2,3}[.,]\d+)")
_RE_UNPLATED = re.compile(
    r"(?:ไม่ติด|ไม่มี|ไม่สวม|ไม่พบ|ไร้)\s*(?:แผ่น)?ป้าย(?:ทะเบียน)?|ไม่ติด\s*(?:แผ่น)?ป้าย",
    re.IGNORECASE,
)
_RE_PLATE_TH = re.compile(
    r"(?<![ก-ฮ\u0E30-\u0E4E])(?:[1-9][ก-ฮ]{2}|[ก-ฮ]{1,3})[-\s]?\d{1,4}(?!\d)"
)
_RE_PLATE_EN = re.compile(r"[A-Z]{1,2}[-\s]?\d{4}")
_RE_COUNT = re.compile(r"(\d+)\s*(?:ครั้ง|เหตุ|คดี|ราย)")
_RE_SUBDISTRICT = re.compile(r"(?:\s|^)(?:ต\.|ตำบล)\s*([ก-ฮa-zA-Z\u0E00-\u0E7F]+)")
_RE_DISTRICT = re.compile(r"(?:\s|^)(?:อ\.|อำเภอ)\s*([ก-ฮa-zA-Z\u0E00-\u0E7F]+)")
_RE_PROVINCE = re.compile(r"(?:\s|^)(?:จ\.|จังหวัด)\s*([ก-ฮa-zA-Z\u0E00-\u0E7F]+)")

# Intel Extractions (บุคคล, ติดต่อ, โซเชียล, ที่อยู่, สถานที่จับกุม)
_RE_PHONE = re.compile(r"(?:เบอร์|โทร|เบอร์โทร|โทรศัพท์|tel)?\s*:?\s*\b(0[689]\d[-.\s]?\d{3}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3}[-.\s]?\d{4})\b")
_RE_NICK = re.compile(r"(?:ชื่อเล่น|ฉายา|ชื่อแฝง)\s*:?\s*[\"\'“]?([ก-ฮa-zA-Z\u0E00-\u0E7F]+)[\"\'”]?")
_RE_FB = re.compile(r"(?:fb|facebook|เฟส|เฟสบุ๊ค|เฟสบุ๊ก)\s*:?\s*([a-zA-Z0-9._-]+|[\u0E00-\u0E7F\s]+?)(?=\s+(?:line|ไลน์|ig|ไอจี|เบอร์|โทร|ที่อยู่|จับกุม)|$|\n)")
_RE_LINE = re.compile(r"(?:line|ไลน์|line\s*id)\s*:?\s*([a-zA-Z0-9._-]+)")
_RE_IG = re.compile(r"(?:ig|instagram|ไอจี)\s*:?\s*([a-zA-Z0-9._-]+)")
_RE_ARREST = re.compile(r"(?:จับกุมได้ที่|สถานที่จับกุม|สถานที่เกิดเหตุ/จับกุม|สถานที่เกิดเหตุ|จับกุมบริเวณ|จับที่|จับบริเวณ|จุดจับกุม|จับกุมได้บริเวณ)\s*:?\s*([^\n,;]+?)(?=\s+(?:เวลา|ทะเบียน|พร้อมด้วยของกลาง|ของกลาง|\d+\.)|$|\n)")
_RE_HOME = re.compile(r"(?:ที่อยู่|บ้านเลขที่|ภูมิลำเนา|พักอาศัยอยู่|อยู่บ้านเลขที่)\s*:?\s*([^\n,;]+?)(?=\s+(?:สถานที่เกิดเหตุ|สถานที่จับกุม|จับกุม|จุดจับกุม|เบอร์|โทร|เฟส|ไลน์|เลขประจำตัว|บัตรประชาชน|\d+\.)|$|\n)")
_RE_IDCARD = re.compile(r"\b\d{1}-\d{4}-\d{5}-\d{2}-\d{1}\b|\b\d{13}\b")


_THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")


def _parse_qty(num_str: str) -> Optional[int]:
    if not num_str:
        return None
    clean = num_str.translate(_THAI_DIGITS).replace(",", "").replace(" ", "").strip()
    try:
        return int(clean)
    except ValueError:
        return None


def _extract_drug_quantity(text: str) -> int:
    # 1. ให้ความสำคัญกับยอดรวมใหญ่เป็นหลัก: "รวมจำนวน 19,380 เม็ด" หรือ "รวม 19,380 เม็ด"
    m_total = re.search(r"(?:รวมจำนวน|รวมทั้งสิ้น|รวมยอด|รวม)\s*([0-9๐-๙,]+)\s*(?:เม็ด|ถุง|กิโลกรัม|กก\.|กรัม|ม้วน|แท่ง|แผง)", text)
    if m_total:
        qty = _parse_qty(m_total.group(1))
        if qty is not None:
            return qty

    # 2. รูปแบบทั่วไปที่มีหน่วยนับกำกับ (รองรับคอมม่าและตัวเลขไทย)
    m = re.search(r"([0-9๐-๙,]+)\s*(?:เม็ด|ถุง|กิโลกรัม|กก\.|กรัม|ม้วน|แท่ง|แผง)", text)
    if m:
        qty = _parse_qty(m.group(1))
        if qty is not None:
            return qty

    # 3. รูปแบบสำรองตามคีย์เวิร์ด: "ยาบ้า 19,380" หรือ "ของกลาง 19,380"
    m2 = re.search(r"(?:ยาบ้า|ของกลาง|ยา)\s*([0-9๐-๙,]+)", text)
    if m2:
        qty = _parse_qty(m2.group(1))
        if qty is not None:
            return qty

    return 0


def _extract_weapon_quantity(text: str) -> int:
    # 1. ยอดรวมใหญ่: "รวมจำนวน 2 กระบอก", "รวม 1 เล่ม"
    m_total = re.search(r"(?:รวมจำนวน|รวมทั้งสิ้น|รวมยอด|รวม)\s*([0-9๐-๙,]+)\s*(?:กระบอก|เล่ม|ลูก|ชิ้น|อัน|ด้าม)", text)
    if m_total:
        qty = _parse_qty(m_total.group(1))
        if qty is not None:
            return qty

    # 2. รูปแบบระบุอาวุธและหน่วยนับ (กระบอกสำหรับปืน, เล่มสำหรับมีด, ลูกสำหรับระเบิด)
    m = re.search(r"(?:ปืน|อาวุธปืน|อาวุธ|มีด|ระเบิด|ของกลาง)[^\n,;]{0,40}?([0-9๐-๙,]+)\s*(?:กระบอก|เล่ม|ลูก|ชิ้น|อัน|ด้าม)", text)
    if m:
        qty = _parse_qty(m.group(1))
        if qty is not None:
            return qty

    # 3. รูปแบบตรวจจับหน่วยนับโดยตรง
    m3 = re.search(r"([0-9๐-๙,]+)\s*(?:กระบอก|เล่ม|ลูก)", text)
    if m3:
        qty = _parse_qty(m3.group(1))
        if qty is not None:
            return qty

    return 0


def _extract_alien_count(text: str) -> int:
    alien_kws = ["ต่างด้าว", "คนต่างด้าว", "หลบหนีเข้าเมือง", "เข้าเมือง", "สัญชาติ", "กัมพูชา", "ลาว", "เมียนมา", "พม่า", "พ.ร.บ.คนเข้าเมือง"]
    if not any(k in text for k in alien_kws):
        return 0

    # 1. ยอดรวมใหญ่: "รวมจำนวน 12 คน", "ต่างด้าว รวม 10 คน"
    m_total = re.search(r"(?:รวมจำนวน|รวมทั้งสิ้น|รวมยอด|รวม)\s*([0-9๐-๙,]+)\s*(?:คน|ราย)", text)
    if m_total:
        qty = _parse_qty(m_total.group(1))
        if qty is not None:
            return qty

    # 2. รูปแบบระบุบุคคลต่างด้าว/หลบหนีเข้าเมือง
    m = re.search(r"(?:ต่างด้าว|คนต่างด้าว|หลบหนีเข้าเมือง|ผู้ถูกจับ|ผู้ต้องหา)[^\n,;]{0,35}?([0-9๐-๙,]+)\s*(?:คน|ราย)", text)
    if m:
        qty = _parse_qty(m.group(1))
        if qty is not None:
            return qty

    # 3. รูปแบบตรวจจับหน่วยนับคน/ราย
    m3 = re.search(r"([0-9๐-๙,]+)\s*(?:คน|ราย)", text)
    if m3:
        qty = _parse_qty(m3.group(1))
        if qty is not None:
            return qty

    return 0


def _extract_nationality(text: str) -> Optional[str]:
    """สกัดสัญชาติของบุคคลต่างด้าวอย่างแม่นยำ (ป้องกันคำในชื่อจังหวัดเช่น ปราจีนบุรี)"""
    m = re.search(r"(?:สัญชาติ|เชื้อชาติ|nationality|ชาว|คนสัญชาติ)\s*:?\s*([ก-ฮa-zA-Z\u0E00-\u0E7F]+)", text, re.IGNORECASE)
    if m:
        nat = m.group(1).strip()
        if nat not in ("ไทย", "ต่างด้าว", "ไม่ระบุ", "ของกลาง", "บุรี", "บุรีรัมย์", "ปราจีนบุรี"):
            return nat
    for nat in ["อินเดีย", "กัมพูชา", "ลาว", "เมียนมา", "พม่า", "เวียดนาม", "มาเลเซีย"]:
        if re.search(rf"\b(?:ชาว|สัญชาติ)\s*{nat}\b", text):
            return nat
    return None


def _extract_passport(text: str) -> Optional[str]:
    """สกัดหมายเลขหนังสือเดินทาง (Passport)"""
    m = re.search(r"(?:หมายเลขหนังสือเดินทาง|หนังสือเดินทาง|พาสปอร์ต|passport(?:\s*no\.?)?)\s*:?\s*([a-zA-Z0-9]{6,12})", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def _extract_id_card(text: str) -> Optional[str]:
    m = _RE_IDCARD.search(text)
    if m:
        clean = re.sub(r"\D", "", m.group(0))
        if len(clean) == 13:
            return clean
    return None


def _extract_police_suspects(text: str) -> list[dict]:
    """
    Extract all suspects from police report Section 4 / 5 or numbered lists.
    """
    suspects = []
    sec_match = re.search(
        r"(?:4|5)\s*[.:]\s*(?:จับกุมผู้ต้องหา|ผู้ต้องหา)\s*:\s*(.+?)(?=\n\s*\d+\.|\b(?:6|7)\s*[.:]|\bพร้อมด้วยของกลาง|\bพร้อมของกลาง|\bโดยกล่าวหา|$)",
        text,
        re.DOTALL | re.IGNORECASE
    )
    target_block = sec_match.group(1).strip() if sec_match else text

    suspect_pattern = re.compile(
        r"(?:\d+\.\s*)?(?:นาย|นาง(?!รอง)|นางสาว|น\.ส\.)\s*([ก-ฮa-zA-Z\u0E00-\u0E7F]+(?:\s*หรือ\s*[ก-ฮa-zA-Z\u0E00-\u0E7F]+)?)\s+([ก-ฮa-zA-Z\u0E00-\u0E7F]+)"
        r"(?:\s*อายุ\s*([0-9๐-๙]+)\s*ปี)?"
        r"(?:\s*(?:ที่อยู่บ้านเลขที่|อยู่บ้านเลขที่|ที่อยู่|บ้านเลขที่)\s*([^\n\r]+?)(?=\s*\d+\.|\s*(?:นาย|นาง|นางสาว)|\s*6\.|\s*7\.|\s*พร้อม|$))?",
        re.IGNORECASE
    )

    for m in suspect_pattern.finditer(target_block):
        first_raw = m.group(1).strip()
        last = m.group(2).strip()
        age_raw = m.group(3)
        addr = m.group(4)

        nick = None
        if "หรือ" in first_raw:
            parts = first_raw.split("หรือ")
            first = parts[0].strip()
            nick = parts[1].strip()
        else:
            first = first_raw

        age = _parse_qty(age_raw) if age_raw else None
        clean_addr = addr.strip() if addr else None

        suspects.append({
            "first_name": first,
            "last_name": last,
            "full_name": f"{first} {last}".strip(),
            "nickname": nick,
            "age": age,
            "address": clean_addr
        })

    return suspects


def _extract_drug_breakdown(text: str) -> dict:
    """
    Extract accurate categorized narcotics and evidence items with proper units.
    """
    evidence_list = []
    yaba_qty = 0
    ice_qty_kg = 0.0
    ice_bags = 0
    ketamine_qty_kg = 0.0
    ketamine_bags = 0
    phones_count = 0

    # 1. Yaba (ยาบ้า / เมทแอมเฟตามีนเม็ด)
    m_yaba = re.search(r"(?:เมทแอมเฟตามีนหรือยาบ้า|ยาบ้า|ยาเสพติดให้โทษประเภท\s*1\s*\(เมทแอมเฟตามีนหรือยาบ้า\))[^\n,;]{0,50}?([0-9๐-๙,]+)\s*(?:เม็ด|ถุง)", text)
    if m_yaba:
        yaba_qty = _parse_qty(m_yaba.group(1)) or 0
        if yaba_qty > 0:
            evidence_list.append(f"💊 ยาบ้า: {yaba_qty:,} เม็ด")
    else:
        if "ยาบ้า" in text:
            m_gen = re.search(r"([0-9๐-๙,]+)\s*เม็ด", text)
            if m_gen:
                yaba_qty = _parse_qty(m_gen.group(1)) or 0
                if yaba_qty > 0:
                    evidence_list.append(f"💊 ยาบ้า: {yaba_qty:,} เม็ด")

    # 2. Ice (สารไอซ์ / ยาไอซ์)
    m_ice = re.search(r"(?:สารไอซ์|ยาไอซ์|เมทแอมเฟตามีนหรือสารไอซ์)[^\n\r]{0,150}?(?:จำนวน\s*([0-9๐-๙]+)\s*กระสอบ)?[^\n\r]{0,80}?(?:รวมประมาณ|รวม|จำนวน)?\s*([0-9๐-๙,.]+)\s*(?:กิโลกรัม|กก\.|กรัม)", text)
    if m_ice:
        if m_ice.group(1):
            ice_bags = _parse_qty(m_ice.group(1)) or 0
        if m_ice.group(2):
            try:
                ice_qty_kg = float(m_ice.group(2).translate(_THAI_DIGITS).replace(",", ""))
            except:
                pass
    elif "สารไอซ์" in text or "ยาไอซ์" in text:
        m_ice_bag = re.search(r"(?:สารไอซ์|ยาไอซ์)[^\n\r]{0,50}?([0-9๐-๙]+)\s*กระสอบ", text)
        if m_ice_bag:
            ice_bags = _parse_qty(m_ice_bag.group(1)) or 0

    if ice_qty_kg > 0 or ice_bags > 0:
        bag_str = f" ({ice_bags} กระสอบ)" if ice_bags > 0 else ""
        kg_str = f"{ice_qty_kg:g} กิโลกรัม" if ice_qty_kg > 0 else f"{ice_bags} กระสอบ"
        evidence_list.append(f"🧊 สารไอซ์: {kg_str}{bag_str if ice_qty_kg > 0 else ''}")

    # 3. Ketamine (เคตามีน / คีตามีน)
    m_k = re.search(r"(?:คีตามีน|เคตามีน|ยาเค)[^\n\r]{0,150}?(?:จำนวน\s*([0-9๐-๙]+)\s*กระสอบ)?[^\n\r]{0,80}?(?:รวมประมาณ|รวม|จำนวน)?\s*([0-9๐-๙,.]+)\s*(?:กิโลกรัม|กก\.|กรัม)", text)
    if m_k:
        if m_k.group(1):
            ketamine_bags = _parse_qty(m_k.group(1)) or 0
        if m_k.group(2):
            try:
                ketamine_qty_kg = float(m_k.group(2).translate(_THAI_DIGITS).replace(",", ""))
            except:
                pass
    elif "คีตามีน" in text or "เคตามีน" in text:
        m_k_bag = re.search(r"(?:คีตามีน|เคตามีน)[^\n\r]{0,50}?([0-9๐-๙]+)\s*กระสอบ", text)
        if m_k_bag:
            ketamine_bags = _parse_qty(m_k_bag.group(1)) or 0

    if ketamine_qty_kg > 0 or ketamine_bags > 0:
        bag_str = f" ({ketamine_bags} กระสอบ)" if ketamine_bags > 0 else ""
        kg_str = f"{ketamine_qty_kg:g} กิโลกรัม" if ketamine_qty_kg > 0 else f"{ketamine_bags} กระสอบ"
        evidence_list.append(f"🧪 คีตามีน: {kg_str}{bag_str if ketamine_qty_kg > 0 else ''}")

    # 4. Phones
    m_phone = re.search(r"(?:โทรศัพท์มือถือ|โทรศัพท์)[^\n,;]{0,30}?([0-9๐-๙]+)\s*เครื่อง", text)
    if m_phone:
        phones_count = _parse_qty(m_phone.group(1)) or 0
        if phones_count > 0:
            evidence_list.append(f"📱 โทรศัพท์มือถือ: {phones_count} เครื่อง")

    # 5. Vehicles
    v_matches = re.findall(r"(รถยนต์กระบะ|รถยนต์เก๋ง|รถจักรยานยนต์|รถกระบะ|รถเก๋ง|รถยนต์)\s*(?:จำนวน)?\s*([0-9๐-๙]+)?\s*(?:คัน)?", text)
    if v_matches:
        v_desc = []
        for v_type, v_cnt in v_matches:
            c = _parse_qty(v_cnt) or 1
            v_desc.append(f"{v_type} {c} คัน")
        if v_desc:
            evidence_list.append(f"🚗 ยานพาหนะ: {', '.join(v_desc)}")

    # 6. Weapons & Firearms (อาวุธปืน / เครื่องกระสุน)
    m_gun_items = re.findall(r"(?:พร้อมด้วยของกลาง|ของกลาง|พบ|ตรวจยึด)?\s*:?\s*(?:[0-9๐-๙]\.\s*)?((?:อาวุธปืน|ปืน|เครื่องกระสุน|ลูกกระสุน|กระสุนปืน|ซองกระสุน)[^\n\r]{2,80}?(?:กระบอก|นัด|อัน|ชิ้น|กล่อง))", text)
    if m_gun_items:
        for g_item in m_gun_items:
            g_clean = g_item.strip().lstrip("1234567890. :")
            if g_clean:
                evidence_list.append(f"🔫 {g_clean}")
    elif "อาวุธปืน" in text or "ปืน" in text:
        m_gun_simple = re.search(r"((?:อาวุธปืน|ปืน)[^\n\r,;]{3,60})", text)
        if m_gun_simple:
            evidence_list.append(f"🔫 {m_gun_simple.group(1).strip()}")

    return {
        "yaba_tablets": yaba_qty,
        "ice_kg": ice_qty_kg,
        "ice_bags": ice_bags,
        "ketamine_kg": ketamine_qty_kg,
        "ketamine_bags": ketamine_bags,
        "evidence_items": evidence_list
    }


def _extract_person_name(text: str) -> tuple[Optional[str], Optional[str]]:
    """สกัดชื่อและนามสกุลบุคคลจากข้อความ รองรับทั้งชื่อไทยและชาวต่างชาติสากล"""
    # Check police suspects first
    sec_suspects = _extract_police_suspects(text)
    if sec_suspects:
        return sec_suspects[0]["first_name"], sec_suspects[0]["last_name"]

    stop_words = (
        "คดี", "ยาเสพติด", "ชปส", "ตชด", "รายงาน", "อำนวยการ", "ผู้จับกุม", "ผู้ต้องสงสัย",
        "ผู้ต้องหา", "ชื่อเล่น", "ที่อยู่", "จับกุม", "เบอร์", "อายุ", "สัญชาติ", "ของกลาง",
        "ต.", "อ.", "จ.", "ตำบล", "อำเภอ", "จังหวัด", "ร้อย", "นางรอง", "โนนสุวรรณ", "หนองกี่",
        "ผบก", "ผกก", "รอง", "สภ", "เจ้าหน้าที่", "ทหาร", "ปกครอง", "ศปก", "กอ", "รมน",
        "กรมทหารพราน", "สขว", "หน่วย", "ผบ.", "ผู้บังคับบัญชา", "จะสมัครใจ", "จะ", "ได้", "นำ"
    )

    # Rule 0: Specific Thai Police Report Section 4 rule ("4. จับกุมผู้ต้องหา :นายศราวุฒิหรือเบนซ์ จอมทอง")
    m_police_sec4 = re.search(
        r"(?:4\.\s*)?(?:จับกุมผู้ต้องหา|จับกุมผู้ต้องสงสัย|ผู้ถูกจับ|ผู้ต้องหา)\s*:?\s*(?:นาย|นาง(?!รอง)|นางสาว|น\.ส\.|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|miss|ms\.?)?\s*([a-zA-Z\u0E00-\u0E7F]{2,}(?:หรือ[a-zA-Z\u0E00-\u0E7F]{2,})?)\s+([a-zA-Z\u0E00-\u0E7F]{2,})",
        text,
        re.IGNORECASE
    )
    if m_police_sec4:
        first, last = m_police_sec4.group(1).strip(), m_police_sec4.group(2).strip()
        if not any(first.startswith(sw) for sw in stop_words) and not any(last.startswith(sw) for sw in stop_words):
            return first, last

    # Rule 1: Specific Arrest / Suspect label
    m_label = re.search(
        r"(?<!รายงาน)(?:ผู้ต้องหา|ผู้ถูกจับ|ร่วมกันจับกุม|กล่าวโทษ|ชื่อ-สกุล|ชื่อ)\s*:?\s*(?:นาย|นาง(?!รอง)|นางสาว|น\.ส\.|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|miss|ms\.?)?\s*([a-zA-Z\u0E00-\u0E7F]{2,})\s+([a-zA-Z\u0E00-\u0E7F]{2,})",
        text,
        re.IGNORECASE
    )
    if m_label:
        first, last = m_label.group(1).strip(), m_label.group(2).strip()
        if not any(first.startswith(sw) for sw in stop_words) and not any(last.startswith(sw) for sw in stop_words):
            m_eng_prefix = re.search(r"(?i)\b(mr|mrs|miss|ms)\.?\s*" + re.escape(first) + r"\s+" + re.escape(last), text)
            if m_eng_prefix:
                return f"{m_eng_prefix.group(1).title()}.{first}", last
            return first, last

    # Rule 2: English Title prefix (Mr. / Mrs. / Miss / Ms.)
    m_en = re.search(r"(?i)\b(mr|mrs|miss|ms)\.?\s*([a-zA-Z]{2,})\s+([a-zA-Z]{2,})", text)
    if m_en:
        title, first, last = m_en.group(1).title(), m_en.group(2).strip(), m_en.group(3).strip()
        if not any(first.startswith(sw) for sw in stop_words) and not any(last.startswith(sw) for sw in stop_words):
            return f"{title}.{first}", last

    # Rule 3: Thai Title prefix
    m_th = re.search(r"(?:นาย|นาง(?!รอง)|นางสาว|น\.ส\.|เด็กชาย|เด็กหญิง)\s*([ก-ฮ\u0E00-\u0E7F]{2,})\s+([ก-ฮ\u0E00-\u0E7F]{2,})", text)
    if m_th:
        first, last = m_th.group(1).strip(), m_th.group(2).strip()
        if not any(first.startswith(sw) for sw in stop_words) and not any(last.startswith(sw) for sw in stop_words):
            return first, last

    return None, None


def _extract_charges(text: str) -> Optional[str]:
    """สกัดข้อกล่าวหา (section 6 ของรายงานตำรวจ)"""
    m = re.search(
        r"(?:6|8)\s*[.:]\s*(?:ข้อกล่าวหาว่า|ข้อกล่าวหา|ข้อหาว่า|ข้อหา|โดยกล่าวหาว่า|โดยกล่าวหา)\s*:?\s*[\"\'“]?([^\"\n\r]+?)(?=[\"\'”]?\s*(?:7\.|8\.|9\.|สถานที่เกิดเหตุ|นำของกลาง|นำส่ง|ผลการปฏิบัติ|$))",
        text,
        re.DOTALL
    )
    if m:
        charges = m.group(1).strip()
        return charges[:300]
    return None


def _extract_gps(text: str) -> tuple[Optional[float], Optional[float]]:
    match = _RE_GPS.search(text)
    if match:
        try:
            lat = float(match.group(1).replace(",", "."))
            lon = float(match.group(2).replace(",", "."))
            if 5.0 <= lat <= 21.0 and 97.0 <= lon <= 106.0:
                return lat, lon
        except ValueError:
            pass
    return None, None


def _extract_plates(text: str) -> list[str]:
    plates: list[str] = []

    # 1. Check for explicit unplated vehicle indicators
    is_unplated = bool(_RE_UNPLATED.search(text))

    safe_text = _RE_UNPLATED.sub(" ", text)

    # 2. Strip Thai months with years
    months = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
        "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
    ]
    for m in months:
        safe_text = re.sub(fr"{m}\s*(?:พ\.ศ\.)?\s*\d{{2,4}}", " ", safe_text)

    # 3. Strip administrative / case / date / vehicle words that cause false plate suffixes (e.g. ทะเบียน 2569 -> ยน 2569)
    safe_text = re.sub(
        r"(?:ทะเบียนอาวุธปืน|ทะเบียนบ้าน|สำนักทะเบียน|นายทะเบียน|แผ่นป้ายทะเบียน|ป้ายทะเบียน|ทะเบียน|รถยนต์|รถจักรยานยนต์|จักรยานยนต์|ยานยนต์|เครื่องยนต์)",
        " ",
        safe_text,
    )
    safe_text = re.sub(
        r"(?:ประจำปี|ปีงบประมาณ|พ\.ศ\.|พ\.ศ|พศ|เมื่อปี|เมื่อ|ปี|คดีที่|คดี|วันที่|เวลา)\s*\.?\s*\d{2,4}",
        " ",
        safe_text,
    )
    safe_text = re.sub(r"/(?:25\d{2}|20\d{2})", " ", safe_text)

    # 4. Strip highways, house numbers, dates, times, passports, IMEI, citizen IDs, phones, tracking
    safe_text = re.sub(r"(?:ถนนหมายเลข|ทางหลวงหมายเลข|ทางหลวงสาย|ถนนสาย|หมายเลข|สาย|ห้องพักหมายเลข|ห้องพัก)\s*\d+", " ", safe_text, flags=re.IGNORECASE)
    safe_text = re.sub(r"(?:บ้านเลขที่|เลขที่)\s*[0-9/-]+", " ", safe_text, flags=re.IGNORECASE)
    safe_text = re.sub(r"\b202[0-9]-[0-9]{2}-[0-9]{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b202[0-9]\b|\b256[0-9]\b", " ", safe_text)
    safe_text = re.sub(r"\b\d{1,2}:\d{2}\b|\b\d{1,2}\.\d{2}\s*น\.?", " ", safe_text)
    safe_text = re.sub(r"(?:หนังสือเดินทาง|พาสปอร์ต|passport(?:\s*no\.?)?|หมายเลขหนังสือเดินทาง)\s*:?\s*[a-zA-Z0-9]+", " ", safe_text, flags=re.IGNORECASE)
    safe_text = re.sub(r"(?:อีมี่|imei|หมายเลขประจำตัว|บัตรประชาชน|โทร|เบอร์)\s*:?\s*[0-9/-]+", " ", safe_text, flags=re.IGNORECASE)
    safe_text = re.sub(r"(?:PNO\s*:?\s*|Flash\s+Tracking\s*:?\s*|TH[0-9A-Z]{8,}|THT[0-9A-Z]{8,})", " ", safe_text, flags=re.IGNORECASE)

    plates.extend(_RE_PLATE_TH.findall(safe_text))
    plates.extend(_RE_PLATE_EN.findall(safe_text.upper()))

    seen: set[str] = set()
    unique: list[str] = []
    for p in plates:
        p_clean = re.sub(r"\s+", " ", p).strip()
        if "\n" in p or "\r" in p:
            continue
        normalized = re.sub(r"[\s-]", "", p_clean).upper()
        # Ensure it's not a standalone year or administrative suffix
        if normalized in {"2567", "2568", "2569", "2570", "2024", "2025", "2026"}:
            continue
        if normalized not in seen and len(normalized) >= 4 and not normalized.isdigit():
            seen.add(normalized)
            unique.append(p_clean)

    if is_unplated:
        unique.append("ไม่ติดแผ่นป้ายทะเบียน")

    return unique


def _extract_incident_count(text: str) -> int:
    match = _RE_COUNT.search(text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return 1


def _extract_address(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    subdistrict, district, province = None, None, None
    
    arrest_idx = 0
    m_arrest = re.search(r"(?:สถานที่เกิดเหตุ|สถานที่จับกุม|จับกุมบริเวณ|จับกุมได้ที่|จุดจับกุม)", text)
    if m_arrest:
        arrest_idx = m_arrest.end()
        
    search_text = text[arrest_idx:]
    
    m = _RE_SUBDISTRICT.search(search_text)
    if not m and arrest_idx > 0: m = _RE_SUBDISTRICT.search(text)
    if m: subdistrict = m.group(1).strip()
    
    m = _RE_DISTRICT.search(search_text)
    if not m and arrest_idx > 0: m = _RE_DISTRICT.search(text)
    if m: district = m.group(1).strip()
    
    m = _RE_PROVINCE.search(search_text)
    if not m and arrest_idx > 0: m = _RE_PROVINCE.search(text)
    if m: province = m.group(1).strip()
    
    return subdistrict, district, province


def _extract_incident_type(text: str) -> Optional[str]:
    for keywords, incident_type in _INCIDENT_KEYWORDS:
        for kw in keywords:
            if kw.lower() in text.lower():
                return incident_type
    return None


def _build_location_name(
    subdistrict: Optional[str],
    district: Optional[str],
    province: Optional[str],
) -> Optional[str]:
    parts: list[str] = []
    if subdistrict: parts.append(f"ต.{subdistrict}")
    if district: parts.append(f"อ.{district}")
    if province: parts.append(f"จ.{province}")
    return " ".join(parts) if parts else None


def parse_flash_parcels(text: str) -> list[dict]:
    """
    สกัดข้อมูลรายการพัสดุ Flash Express จากข้อความรายงาน
    """
    if "Flash Tracking" not in text and "PNO:" not in text:
        return []

    pno_blocks = re.findall(r'(?:🔖\s*)?PNO:\s*([A-Za-z0-9]+)(.*?)(?=(?:🔖\s*)?PNO:|$)', text, re.DOTALL)
    parcels = []
    for pno, content in pno_blocks:
        # Parcel identity is receiver-only. Sender text remains available in raw_text,
        # but it must never become a person, phone owner, or i2 graph participant.
        recv_m = re.search(r'ผู้รับ\s*:\s*([^\r\n]+)', content)
        receiver_line = recv_m.group(1).strip() if recv_m else ""
        phone_m = re.search(r'\((0[689]\d{8})\)\s*$', receiver_line)
        r_phone = phone_m.group(1) if phone_m else None
        r_name = receiver_line[: phone_m.start()].strip() if phone_m else receiver_line
        if r_name:
            r_name = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง)\s*', '', r_name).strip()
        else:
            r_name = None
            
        addr_m = re.search(
            r'ที่อยู่ผู้รับ\s*:\s*(.*?)(?=\r?\n\s*(?:ผู้ส่ง|ผู้รับ|PNO:|👷|📍|📷)|\Z)',
            content,
            re.DOTALL,
        )
        recv_addr = addr_m.group(1).strip().replace('\n', ' ') if addr_m else None
        
        gps_m = re.search(r'google\.com/maps\?q=([0-9.,]+),\s*([0-9.,]+)', content)
        lat = float(gps_m.group(1).replace(",", ".")) if gps_m else None
        lon = float(gps_m.group(2).replace(",", ".")) if gps_m else None
        
        photos = re.findall(r'https?://[^\s]+\.(?:jpg|jpeg|png|webp)', content)
        
        parcels.append({
            "pno": pno,
            "receiver_name": r_name,
            "receiver_phone": r_phone,
            "receiver_address": recv_addr,
            "lat": lat,
            "lon": lon,
            "photos": photos
        })
    return parcels


def parse_message(text: str) -> dict:
    """
    สกัดข้อมูลบุคคล เหตุการณ์ และสถานที่จากข้อความภาษาไทย/อังกฤษ
    """
    if not text or not text.strip():
        return _empty_result(text)

    lat, lon = _extract_gps(text)
    plates = _extract_plates(text)
    incident_count = _extract_incident_count(text)
    subdistrict, district, province = _extract_address(text)
    incident_type = _extract_incident_type(text)
    location_name = _build_location_name(subdistrict, district, province)

    # Intel Field Extractions
    first_name, last_name = _extract_person_name(text)

    m_nick = _RE_NICK.search(text)
    nickname = m_nick.group(1).strip() if m_nick else None

    m_phone = _RE_PHONE.search(text)
    phone = m_phone.group(1).strip() if m_phone else None

    m_fb = _RE_FB.search(text)
    facebook = m_fb.group(1).strip() if m_fb else None

    m_line = _RE_LINE.search(text)
    line = m_line.group(1).strip() if m_line else None

    m_ig = _RE_IG.search(text)
    instagram = m_ig.group(1).strip() if m_ig else None

    m_arrest = _RE_ARREST.search(text)
    arrest_location = m_arrest.group(1).strip() if m_arrest else None

    m_home = _RE_HOME.search(text)
    home_address = m_home.group(1).strip() if m_home else None

    # Drop Point (จุดวางงาน / Dead Drop) Detection
    is_drop_point = False
    stash_type = None
    drop_kws = ["วางงาน", "จุดวางงาน", "จุดส่งมอบ", "จุดซ่อน", "จุดทิ้ง", "dead drop", "dead-drop", "stash", "ฝากของ", "วางของ"]
    if any(kw in text.lower() for kw in drop_kws):
        is_drop_point = True
        if "หลักกิโล" in text or "หลักกิโลเมตร" in text:
            stash_type = "หลักกิโลเมตร"
        elif any(k in text for k in ["ข้างทาง", "ริมถนน", "ข้างถนน"]):
            stash_type = "ข้างทาง/ริมถนน"
        elif any(k in text for k in ["ต้นไม้", "โคนต้นไม้", "พุ่มไม้"]):
            stash_type = "โคนต้นไม้/พุ่มไม้"
        elif "ป้าย" in text:
            stash_type = "ป้ายจราจร"
        elif "ร้าง" in text:
            stash_type = "อาคารร้าง"
        else:
            stash_type = "จุดวางงานทั่วไป"

    # Extract structured suspects from police report
    police_suspects = _extract_police_suspects(text)
    if police_suspects:
        if not first_name:
            first_name = police_suspects[0]["first_name"]
            last_name = police_suspects[0]["last_name"]
        if not nickname and police_suspects[0].get("nickname"):
            nickname = police_suspects[0]["nickname"]
        if not home_address and police_suspects[0].get("address"):
            home_address = police_suspects[0]["address"]

    # Extract accurate narcotics & evidence breakdown
    drug_breakdown = _extract_drug_breakdown(text)
    drug_quantity = drug_breakdown["yaba_tablets"] or _extract_drug_quantity(text)
    evidence_items = drug_breakdown.get("evidence_items", [])

    weapon_quantity = _extract_weapon_quantity(text)
    alien_count = _extract_alien_count(text)
    id_card = _extract_id_card(text)
    passport = _extract_passport(text)
    nationality = _extract_nationality(text)
    charges = _extract_charges(text)

    # Flash Parcel Intelligence Detection
    parcels = parse_flash_parcels(text)
    if parcels:
        incident_type = "flash_parcel"
        incident_count = len(parcels)
        if lat is None or lon is None:
            lat = parcels[0].get("lat")
            lon = parcels[0].get("lon")
        # Receiver data is authoritative for parcel messages regardless of which
        # titled name or phone appeared first in the original report.
        first_name = None
        last_name = None
        receiver_name = parcels[0].get("receiver_name")
        if receiver_name:
            parts = receiver_name.split(None, 1)
            first_name = parts[0]
            if len(parts) > 1:
                last_name = parts[1]
        phone = parcels[0].get("receiver_phone")
        home_address = parcels[0].get("receiver_address")
        police_suspects = []

    # ปรับปรุง incident_count กรณีคดีต่างด้าวที่ระบุจำนวนคน
    if incident_type == "alien" and alien_count > 0:
        incident_count = alien_count

    return {
        "location_name": location_name,
        "subdistrict": subdistrict,
        "district": district,
        "province": province,
        "lat": lat,
        "lon": lon,
        "incident_count": incident_count,
        "plates": plates,
        "incident_type": incident_type,
        "drug_quantity": drug_quantity,
        "weapon_quantity": weapon_quantity,
        "alien_count": alien_count,

        # Detailed Evidence and Breakdown
        "evidence_items": evidence_items,
        "ice_kg": drug_breakdown.get("ice_kg", 0.0),
        "ketamine_kg": drug_breakdown.get("ketamine_kg", 0.0),

        # Drop Point & Stash Fields
        "is_drop_point": is_drop_point,
        "stash_type": stash_type,

        # Personal & Intelligence Fields
        "first_name": first_name,
        "last_name": last_name,
        "suspects": police_suspects,
        "id_card": id_card,
        "passport": passport,
        "nationality": nationality,
        "nickname": nickname,
        "phone": phone,
        "facebook": facebook,
        "line": line,
        "instagram": instagram,
        "home_address": home_address,
        "arrest_location": arrest_location,
        "charges": charges,
        "parcels": parcels,

        "timestamp": None,
        "raw_text": text,
    }


def _empty_result(text: str) -> dict:
    return {
        "location_name": None,
        "subdistrict": None,
        "district": None,
        "province": None,
        "lat": None,
        "lon": None,
        "incident_count": 1,
        "plates": [],
        "incident_type": None,
        "drug_quantity": 0,
        "weapon_quantity": 0,
        "alien_count": 0,
        "evidence_items": [],
        "ice_kg": 0.0,
        "ketamine_kg": 0.0,
        "is_drop_point": False,
        "stash_type": None,
        "parcels": [],

        "first_name": None,
        "last_name": None,
        "suspects": [],
        "id_card": None,
        "passport": None,
        "nationality": None,
        "nickname": None,
        "phone": None,
        "facebook": None,
        "line": None,
        "instagram": None,
        "home_address": None,
        "arrest_location": None,

        "timestamp": None,
        "raw_text": text or "",
    }
