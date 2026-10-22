"""
Intelligence Text Parser Module for nas-bot-service (BPP-VMS)
-------------------------------------------------------------
Parses intelligence text snippets shared by field officers via Telegram or Web Chat:
1. Carrier query summaries (เครือข่าย A / เครือข่าย T / Dtac)
2. Carrier service/SIM registration details (True Mobile, Prepay, Package, IMSI, SIM)
3. PEA Electricity meter lookups (CA, PEA NO, Customer name, Address, Coordinates, Google Maps)
4. Standalone Phone numbers, Thai National IDs, or Suspect Names
"""

import re
from typing import Dict, Any, List, Optional


def parse_intel_text(text: str) -> Optional[Dict[str, Any]]:
    """
    Analyzes input text and determines if it matches known intelligence data formats.
    Returns structured data dict if recognized, or None if it's ordinary conversational text.
    """
    if not text or not isinstance(text, str):
        return None

    cleaned_text = text.strip()
    if len(cleaned_text) < 3:
        return None

    # 0. Incident / Arrest / Seizure Report Guard:
    # If the text contains formal police report indicators, it must NOT be hijacked
    # by intelligence snippets. It must fall through to submit_plain_text_report!
    REPORT_INDICATORS = [
        "จับกุม", "ตรวจยึด", "ผู้ต้องหา", "ของกลาง", "ยาบ้า", "ไอซ์", "ยาเสพติด",
        "ข้อกล่าวหา", "นำของกลางนำส่ง", "ปจว.", "ประจำวัน", "สภ.", "ชปส.", "ร้อย ตชด.",
        "จึงเรียนมาเพื่อ", "พฤติการณ์", "เหตุเกิดที่", "พนักงานสอบสวน"
    ]
    matched_rep = [k for k in REPORT_INDICATORS if k in cleaned_text]
    if len(matched_rep) >= 2 or any(k in cleaned_text for k in ["จับกุม", "ตรวจยึด", "นำของกลางนำส่ง"]):
        return None

    result: Dict[str, Any] = {
        "intel_type": None,
        "id_card": None,
        "suspect_name": None,
        "phones": [],
        "primary_phone": None,
        "address": None,
        "district": None,
        "subdistrict": None,
        "pea_info": None,
        "carrier_info": None,
        "notes_addon": cleaned_text,
    }

    # 1. PEA Electricity Meter Lookup Detection
    # Example:
    # 1. 32 ม.5 ต.ห้วยหิน อ.หนองหงส์ จ.บุรีรัมย์ 31240
    # - CA: 020014274190
    # - วันที่: 2023-06-18 00:00:00.0
    # - ชื่อลูกค้า: สมบูรณ์
    # - นามสกุลลูกค้า: ทุเรศไธสง
    # - PEA NO: 5800946154
    # - พิกัด (X, Y): 883529.3251085, 1648974.486549
    # - Google Maps: https://maps.google.com/?q=14.887718545806,102.56360380082
    has_pea_ca = bool(re.search(r'\bCA\s*[:\s]\s*(\d+)', cleaned_text, re.IGNORECASE))
    has_pea_no = bool(re.search(r'\bPEA\s*(?:NO)?\s*[:\s]\s*(\d+)', cleaned_text, re.IGNORECASE))
    has_gmaps = bool(re.search(r'maps\.google\.com|google\.com/maps|\bพิกัด\b', cleaned_text, re.IGNORECASE))

    if has_pea_ca or has_pea_no or (has_gmaps and ("ลูกค้า" in cleaned_text or "ไฟฟ้า" in cleaned_text or "PEA" in cleaned_text)):
        result["intel_type"] = "pea_electricity"
        pea_dict: Dict[str, Any] = {}

        ca_m = re.search(r'CA\s*[:\s]\s*(\d+)', cleaned_text, re.IGNORECASE)
        if ca_m: pea_dict["ca"] = ca_m.group(1).strip()

        pea_m = re.search(r'PEA\s*(?:NO)?\s*[:\s]\s*(\d+)', cleaned_text, re.IGNORECASE)
        if pea_m: pea_dict["pea_no"] = pea_m.group(1).strip()

        cust_first = re.search(r'ชื่อลูกค้า\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        cust_last = re.search(r'นามสกุลลูกค้า\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        if cust_first:
            first_name = cust_first.group(1).strip()
            last_name = cust_last.group(1).strip() if cust_last else ""
            pea_dict["customer_name"] = f"{first_name} {last_name}".strip()

        gmap_m = re.search(r'https?://[^\s\)]+', cleaned_text)
        if gmap_m:
            pea_dict["maps_url"] = gmap_m.group(0).strip()
            coord_m = re.search(r'[?&]q=([\d\.\-]+),([\d\.\-]+)', pea_dict["maps_url"])
            if coord_m:
                try:
                    pea_dict["lat"] = float(coord_m.group(1))
                    pea_dict["lon"] = float(coord_m.group(2))
                except (ValueError, TypeError):
                    pass

        lines = [line.strip() for line in cleaned_text.splitlines() if line.strip()]
        for line in lines:
            if re.search(r'(?:ต\.|ตำบล|อ\.|อำเภอ|จ\.|จังหวัด)\s*[ก-๙]+', line):
                clean_addr = re.sub(r'^\d+\.\s*', '', line).strip()
                result["address"] = clean_addr
                d_m = re.search(r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)', clean_addr)
                sd_m = re.search(r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)', clean_addr)
                if d_m: result["district"] = d_m.group(1).strip()
                if sd_m: result["subdistrict"] = sd_m.group(1).strip()
                pea_dict["address"] = clean_addr
                break

        result["pea_info"] = pea_dict
        return result

    # 2. Carrier Summary Detection (เครือข่าย A / T / Dtac)
    is_carrier_summary = bool(re.search(r'เครือข่าย\s*[a-zA-Zก-๙]|\bเบอร์\s*Active\b|\bเบอร์ที่พบทั้งหมด\b', cleaned_text, re.IGNORECASE))
    if is_carrier_summary:
        result["intel_type"] = "carrier_summary"
        carrier_dict: Dict[str, Any] = {}

        net_m = re.search(r'เครือข่าย\s*([a-zA-Zก-๙]+)', cleaned_text, re.IGNORECASE)
        if net_m:
            carrier_dict["network"] = net_m.group(1).strip()

        cid_m = re.search(r'\b(\d{13})\b', cleaned_text)
        if cid_m:
            result["id_card"] = cid_m.group(1)

        name_m = re.search(r'(?:Name|ชื่อ)\s*[:\s]\s*([^\n\r]+)', cleaned_text, re.IGNORECASE)
        if name_m:
            cand_name = name_m.group(1).strip()
            result["suspect_name"] = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง)\s*', '', cand_name).strip()

        phone_matches = re.findall(r'(?:เบอร์\s*[:\s]*)?\b(0[689]\d{8})\b', cleaned_text)
        unique_phones = []
        for p in phone_matches:
            if p not in unique_phones:
                unique_phones.append(p)

        result["phones"] = unique_phones
        if unique_phones:
            result["primary_phone"] = unique_phones[0]

        result["carrier_info"] = carrier_dict
        return result

    # 3. Carrier Service / SIM Detail Lookup
    is_service_detail = bool(re.search(r'(?:Service\s*ID|ระบบ\s*:\s*\w+|สถานะ\s*:\s*Active|\bIMSI\b|\bSIM\s*:)', cleaned_text, re.IGNORECASE))
    if is_service_detail:
        result["intel_type"] = "carrier_detail"
        svc_dict: Dict[str, Any] = {}

        p_m = re.search(r'(?:เบอร์(?:/Service\s*ID)?)\s*[:\s]\s*(0[689]\d{8})', cleaned_text, re.IGNORECASE)
        if p_m:
            phone_num = p_m.group(1).strip()
            result["phones"] = [phone_num]
            result["primary_phone"] = phone_num

        net_m = re.search(r'ระบบ\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        if net_m: svc_dict["network"] = net_m.group(1).strip()

        pkg_m = re.search(r'แพ็กเกจ\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        if pkg_m: svc_dict["package"] = pkg_m.group(1).strip()

        sim_m = re.search(r'SIM\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        if sim_m: svc_dict["sim"] = sim_m.group(1).strip()

        imsi_m = re.search(r'IMSI\s*[:\s]\s*([^\n\r]+)', cleaned_text)
        if imsi_m: svc_dict["imsi"] = imsi_m.group(1).strip()

        result["carrier_info"] = svc_dict
        return result

    # 4. Vehicle Intelligence Detection (e.g. ขฒ 4719 กทม. รถเก๋ง, ทะเบียน 1ฒฮ 8899 บุรีรัมย์)
    # Strip dates / times / addresses / section numbers to prevent false positives (e.g. "ณ 11.00 น.", "กันยายน ๒๕๖๙")
    text_for_veh = re.sub(r'(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|[ยค]น|คม)\s*[\d๑-๙]{2,4}', ' ', cleaned_text)
    text_for_veh = re.sub(r'(?:พ\.ศ\.|ปี)\s*[\d๑-๙]{2,4}', ' ', text_for_veh)
    text_for_veh = re.sub(r'\b25\d{2}\b|\b๒๕[๐-๙]{2}\b', ' ', text_for_veh)
    text_for_veh = re.sub(r'(?:ณ|เวลา)\s*\d{1,2}[.:]\d{2}(?:\s*น\.)?', ' ', text_for_veh)
    text_for_veh = re.sub(r'(?:หมู่ที่?|ม\.)\s*\d{1,3}', ' ', text_for_veh)
    text_for_veh = re.sub(r'(?:บ้าน)?เลขที่\s*\d+(?:/\d+)?', ' ', text_for_veh)
    text_for_veh = re.sub(r'ข้อ\s*\d+', ' ', text_for_veh)

    cand_plate = None
    explicit_veh_m = re.search(r'(?:ทะเบียน(?:รถ)?|ป้ายทะเบียน|รถ(?:เก๋ง|กระบะ|ยนต์|ตู้|มอเตอร์ไซค์|จักรยานยนต์|บรรทุก)?)\s*[:\s]*([1-9]?[ก-ฮ]{1,2}\s*[0-9]{1,4})', text_for_veh)
    if explicit_veh_m:
        cand_plate = explicit_veh_m.group(1).strip()
    else:
        # Standard plate format (requires at least 2 letters, e.g. ขฒ 4719, or 1 digit + 2 letters, e.g. 1ฒฮ 8899)
        # Single letter alone is strictly forbidden without explicit vehicle prefix.
        has_veh_kw = any(k in cleaned_text for k in ["รถ", "ทะเบียน", "ป้ายทะเบียน", "เก๋ง", "กระบะ", "มอเตอร์ไซค์", "จักรยานยนต์", "สี", "คัน"])
        is_short = len(cleaned_text) <= 30
        if has_veh_kw or is_short:
            plate_m = re.search(r'\b([1-9][ก-ฮ]{1,2}|[ก-ฮ]{2})\s*([0-9]{1,4})\b', text_for_veh)
            if plate_m:
                cand_plate = f"{plate_m.group(1)} {plate_m.group(2)}".strip()

    if cand_plate and re.search(r'[ก-ฮ]', cand_plate) and re.search(r'[0-9]', cand_plate):
        cand_prov = None
        for prov in [
            "กรุงเทพมหานคร", "กรุงเทพ", "กทม", "บุรีรัมย์", "นครราชสีมา", "ขอนแก่น", "สุรินทร์", "ศรีสะเกษ",
            "อุบลราชธานี", "อุดรธานี", "เชียงใหม่", "ชลบุรี", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "พระนครศรีอยุธยา"
        ]:
            if prov in cleaned_text:
                cand_prov = "กรุงเทพมหานคร" if prov in ["กทม", "กรุงเทพ"] else prov
                break
        
        has_veh_keyword = any(k in cleaned_text for k in ["รถ", "ทะเบียน", "เก๋ง", "กระบะ", "มอเตอร์ไซค์", "จักรยานยนต์", "สี", "คัน"])
        is_short_plate_text = bool(re.fullmatch(r'^[1-9]?[ก-ฮ]{1,2}\s*[0-9]{1,4}(?:\s+[ก-๙]+)?$', cleaned_text))
        
        # In multi-word text, a vehicle keyword or explicit vehicle prefix is MANDATORY.
        # A province name alone cannot make ordinary text a vehicle.
        if is_short_plate_text or has_veh_keyword or explicit_veh_m:
            result["intel_type"] = "vehicle_intel"
            v_type = None
            for vt in ["รถเก๋ง", "รถกระบะ", "รถจักรยานยนต์", "มอเตอร์ไซค์", "รถตู้", "รถบรรทุก", "รถยนต์"]:
                if vt in cleaned_text:
                    v_type = vt
                    break
            
            v_color = None
            for vc in ["สีดำ", "สีขาว", "สีบรอนซ์", "สีเทา", "สีแดง", "สีน้ำเงิน", "สีเขียว", "สีเหลือง"]:
                if vc in cleaned_text:
                    v_color = vc.replace("สี", "")
                    break
            
            m_name = re.search(r'(?:ของ|เจ้าของ|ชื่อ)\s*((?:นาย|นางสาว|น\.ส\.|นาง)\s*[ก-๙]{2,}(?:\s+[ก-๙]{2,})?)', cleaned_text)
            owner = m_name.group(1).strip() if m_name else None

            result["vehicle_info"] = {
                "plate": cand_plate,
                "province": cand_prov or "กรุงเทพมหานคร",
                "type": v_type or "รถยนต์",
                "color": v_color,
                "owner_name": owner,
                "raw_text": cleaned_text
            }
            if owner:
                result["suspect_name"] = owner
            return result

    # 5. Standalone Phone Number or ID Card
    if re.fullmatch(r'0[689]\d{8}', cleaned_text):
        result["intel_type"] = "standalone_phone"
        result["phones"] = [cleaned_text]
        result["primary_phone"] = cleaned_text
        return result

    if re.fullmatch(r'\d{13}', cleaned_text):
        result["intel_type"] = "standalone_id"
        result["id_card"] = cleaned_text
        return result

    # 6. Standalone Thai Name
    name_clean = cleaned_text.strip()
    if re.fullmatch(r'(?:นาย|นางสาว|น\.ส\.|นาง)\s*[ก-๙]+(?:\s+[ก-๙]+){1,3}', name_clean):
        result["intel_type"] = "standalone_name"
        result["suspect_name"] = name_clean
        return result

    return None
