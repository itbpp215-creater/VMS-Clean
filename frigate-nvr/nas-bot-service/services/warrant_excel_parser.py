"""
Warrant Excel Registry Parser Module (BPP-VMS)
-----------------------------------------------
Extracts structured warrant records, suspect profiles, countdowns, and crime charges
directly from OpenXML (.xlsx) warrant spreadsheets using Python standard libraries (zipfile + xml.etree.ElementTree).
"""

import os
import re
import zipfile
import logging
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("warrant_excel_parser")

COLUMN_HEADER_MAP = {
    "สถานะอายุหมายจับ": "warrant_status_age",
    "สถานะหมายจับ": "warrant_status",
    "วันที่หมายมีผล": "effective_date",
    "วันที่หมายสิ้นสุด": "expiration_date",
    "อายุความ": "statute_years",
    "เลขบัตรประชาชนผู้ต้องหา": "id_card",
    "ชื่อสกุลผู้ต้องหา": "suspect_name",
    "สัญชาติผู้ต้องหา": "nationality",
    "เชื้อชาติผู้ต้องหา": "ethnicity",
    "จังหวัด": "province",
    "อำเภอ": "district",
    "ตำบล": "subdistrict",
    "ประเภทคดี": "crime_category",
    "เลขคดี": "case_no",
    "เลขหมายจับ": "warrant_no",
    "ชื่อสถานี": "station_name",
    "บช./ภาค": "division",
    "สถานะการจับกุม": "arrest_status",
    "วันที่จับกุม": "arrest_date",
    "ศาล": "court",
    "ข้อหา": "charge",
    "ผู้ออกหมาย": "issuer",
    "วันที่ปรับปรุงข้อมูล": "update_date",
    "จำนวนวันที่เหลือก่อนหมดอายุ (วัน)": "remaining_days",
    "เวลานับถอยหลังคงเหลือ": "countdown_text",
    "ระดับความเร่งด่วน": "urgency_level",
    "ชื่อไฟล์รูปภาพ ทร.14": "photo_filename"
}


def parse_warrant_excel(file_path_or_bytes: Any) -> Dict[str, Any]:
    """
    Parse an OpenXML (.xlsx) warrant spreadsheet and return structured records and summary analytics.
    Accepts a filepath string or bytes buffer.
    """
    try:
        if isinstance(file_path_or_bytes, (str, os.PathLike)):
            zf = zipfile.ZipFile(file_path_or_bytes, 'r')
        else:
            import io
            zf = zipfile.ZipFile(io.BytesIO(file_path_or_bytes), 'r')

        ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        
        # 1. Load shared strings if available
        shared_strings: List[str] = []
        if 'xl/sharedStrings.xml' in zf.namelist():
            s_tree = ET.fromstring(zf.read('xl/sharedStrings.xml'))
            for si in s_tree.findall('.//s:si', ns):
                t_elem = si.find('s:t', ns)
                if t_elem is not None and t_elem.text:
                    shared_strings.append(t_elem.text)
                else:
                    # Multi-run text inside <r><t>
                    full_txt = "".join(t.text for t in si.findall('.//s:t', ns) if t.text)
                    shared_strings.append(full_txt)

        # 2. Parse sheet1.xml
        sheet_name = 'xl/worksheets/sheet1.xml'
        if sheet_name not in zf.namelist():
            for name in zf.namelist():
                if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                    sheet_name = name
                    break

        tree = ET.fromstring(zf.read(sheet_name))
        rows = tree.findall('.//s:row', ns)
        if not rows:
            return {"status": "empty", "records": [], "count": 0, "summary": "ไม่พบแถวข้อมูลในไฟล์ Excel"}

        # 3. Read Header Row
        header_row = rows[0]
        col_to_field: Dict[str, str] = {}
        for c in header_row.findall('s:c', ns):
            cell_ref = c.attrib.get('r', '')
            col_letter = ''.join([ch for ch in cell_ref if ch.isalpha()])
            val = _get_cell_value(c, ns, shared_strings).strip()
            if val in COLUMN_HEADER_MAP:
                col_to_field[col_letter] = COLUMN_HEADER_MAP[val]
            else:
                # Fuzzy header matching
                for th_name, en_key in COLUMN_HEADER_MAP.items():
                    if th_name in val or val in th_name:
                        col_to_field[col_letter] = en_key
                        break

        # 4. Read Data Rows
        warrant_records: List[Dict[str, Any]] = []
        for row in rows[1:]:
            r_idx = row.attrib.get('r')
            rec: Dict[str, Any] = {}
            has_data = False

            for c in row.findall('s:c', ns):
                cell_ref = c.attrib.get('r', '')
                col_letter = ''.join([ch for ch in cell_ref if ch.isalpha()])
                field_name = col_to_field.get(col_letter)
                if field_name:
                    cell_val = _get_cell_value(c, ns, shared_strings).strip()
                    if cell_val:
                        rec[field_name] = cell_val
                        has_data = True

            if has_data and (rec.get("suspect_name") or rec.get("id_card") or rec.get("warrant_no")):
                # Clean and normalize ID card
                raw_cid = rec.get("id_card", "")
                clean_cid = re.sub(r'[^0-9]', '', raw_cid)
                rec["clean_id_card"] = clean_cid if len(clean_cid) == 13 else raw_cid

                # Clean suspect name
                s_name = rec.get("suspect_name", "")
                clean_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', s_name).strip()
                rec["clean_name"] = clean_name

                # Parse remaining days if numeric
                rem_days = rec.get("remaining_days")
                if rem_days:
                    try:
                        rec["remaining_days_int"] = int(float(rem_days))
                    except ValueError:
                        rec["remaining_days_int"] = None
                else:
                    rec["remaining_days_int"] = None

                warrant_records.append(rec)

        # 5. Compute Statistics & Analytics
        total_count = len(warrant_records)
        active_warrants = [w for w in warrant_records if "มีผล" in (w.get("warrant_status") or "") or "ไม่หมดอายุ" in (w.get("warrant_status_age") or "")]
        arrested_warrants = [w for w in warrant_records if "จับกุมแล้ว" in (w.get("arrest_status") or "") or "จับกุม" in (w.get("warrant_status") or "")]
        
        # Expiring Soon (< 365 days or high urgency)
        urgent_warrants = []
        for w in warrant_records:
            rem = w.get("remaining_days_int")
            urgency = w.get("urgency_level", "")
            if (rem is not None and rem <= 365) or "ด่วน" in urgency or "วิกฤต" in urgency:
                urgent_warrants.append(w)

        # Group by police station
        stations_count: Dict[str, int] = {}
        for w in warrant_records:
            st = w.get("station_name") or "ไม่ระบุ สภ."
            stations_count[st] = stations_count.get(st, 0) + 1
        top_stations = sorted(stations_count.items(), key=lambda x: x[1], reverse=True)[:5]

        # Group by crime category
        categories_count: Dict[str, int] = {}
        for w in warrant_records:
            cat = w.get("crime_category") or "ทั่วไป"
            categories_count[cat] = categories_count.get(cat, 0) + 1
        top_categories = sorted(categories_count.items(), key=lambda x: x[1], reverse=True)[:5]

        # 6. Build Rich Thai Summary Text
        summary_lines = [
            f"📋 **สรุปรายงานทะเบียนหมายจับอัจฉริยะ (Warrant Intelligence)**",
            f"📊 **สถิติภาพรวม:**",
            f"• 📁 **จำนวนหมายจับทั้งหมด:** `{total_count:,}` รายการ",
            f"• ⚖️ **มีผลบังคับใช้ตามกฎหมาย:** `{len(active_warrants):,}` รายการ",
            f"• ⏳ **หมายจับเร่งด่วน / ใกล้หมดอายุความ (< 1 ปี):** `{len(urgent_warrants):,}` รายการ",
            f"• 👮 **สถานะจับกุมแล้ว:** `{len(arrested_warrants):,}` รายการ",
            ""
        ]

        if top_stations:
            summary_lines.append("🏛️ **หน่วยงาน / สภ. ที่ออกหมายจับสูงสุด:**")
            for st_name, cnt in top_stations:
                summary_lines.append(f"• {st_name}: `{cnt:,}` หมาย")
            summary_lines.append("")

        if top_categories:
            summary_lines.append("🏷️ **หมวดหมู่คดีหลัก:**")
            for cat_name, cnt in top_categories:
                summary_lines.append(f"• {cat_name}: `{cnt:,}` คดี")
            summary_lines.append("")

        if urgent_warrants:
            summary_lines.append("🚨 **ตัวอย่างหมายจับเร่งด่วน (นับถอยหลังหมดอายุความ):**")
            for idx, uw in enumerate(urgent_warrants[:5], 1):
                s_name = uw.get("suspect_name", "ไม่ระบุ")
                cid = uw.get("clean_id_card", "-")
                w_no = uw.get("warrant_no", "-")
                st = uw.get("station_name", "-")
                rem_txt = uw.get("countdown_text") or (f"{uw.get('remaining_days_int')} วัน" if uw.get("remaining_days_int") is not None else "-")
                summary_lines.append(f"{idx}. 👤 **{s_name}** (`{cid}`)")
                summary_lines.append(f"   📜 หมายจับ: `{w_no}` | 🏛️ {st}")
                summary_lines.append(f"   ⏳ คงเหลือ: **{rem_txt}** (สิ้นสุด: {uw.get('expiration_date', '-')})")
            summary_lines.append("")

        summary_lines.append("💡 **คำแนะนำ:** สามารถพิมพ์ค้นหาชื่อ หรือเลขบัตร ปชช. ในช่องแชทเพื่อดูรายละเอียดแฟ้มและผัง i2 ได้ทันทีครับ!")

        return {
            "status": "success",
            "total_count": total_count,
            "active_count": len(active_warrants),
            "urgent_count": len(urgent_warrants),
            "arrested_count": len(arrested_warrants),
            "top_stations": top_stations,
            "top_categories": top_categories,
            "records": warrant_records,
            "urgent_warrants": urgent_warrants,
            "summary_text": "\n".join(summary_lines)
        }

    except Exception as e:
        logger.error(f"Failed to parse warrant excel: {e}", exc_info=True)
        return {
            "status": "error",
            "message": str(e),
            "records": [],
            "count": 0,
            "summary_text": f"⚠️ ไม่สามารถประมวลผลไฟล์ Excel หมายจับได้: {e}"
        }


def _get_cell_value(c_elem: ET.Element, ns: Dict[str, str], shared_strings: List[str]) -> str:
    """Helper to extract string value from a cell element."""
    t_attr = c_elem.attrib.get('t')
    v_elem = c_elem.find('s:v', ns)
    is_elem = c_elem.find('s:is', ns)

    if t_attr == 's' and v_elem is not None and v_elem.text:
        try:
            s_idx = int(v_elem.text)
            if 0 <= s_idx < len(shared_strings):
                return shared_strings[s_idx]
        except (ValueError, IndexError):
            pass
        return v_elem.text or ''

    if is_elem is not None:
        t_tag = is_elem.find('s:t', ns)
        if t_tag is not None and t_tag.text:
            return t_tag.text
        return "".join(t.text for t in is_elem.findall('.//s:t', ns) if t.text)

    if v_elem is not None and v_elem.text:
        return v_elem.text

    return ''
