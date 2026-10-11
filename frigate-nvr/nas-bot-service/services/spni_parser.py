"""
SPNI Phone Report Parser & Telecom Intelligence Engine (BPP-VMS)
----------------------------------------------------------------
Specialized multi-sheet extractor for SPNI forensic phone reports (.xlsx).
Zero-dependency XML-based Excel workbook parser for high reliability.

Extracted Data Layers:
1. ข้อมูลอุปกรณ์ (Device & Case): Owner name, Case ID, Case Type, Officer, Unit, IMEI, Phone Model
2. ประวัติการโทรทั้งหมด (Call History): Caller, Callee, Direction, DateTime, Duration, SIM, Channel
3. สมุดโทรศัพท์ (Phonebook Contacts): Phone to Contact Name tagging
4. ข้อความ SMS (SMS Messages): Message count & party analysis
5. Correlation with Dossier Vault & i2 Graph Engine
"""

import os
import io
import re
import json
import uuid
import zipfile
import datetime
import logging
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional, Tuple, Set

logger = logging.getLogger("nas.spni")

DEFAULT_STORAGE_ROOT = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")


def clean_phone_number(raw: Any) -> Optional[str]:
    """Clean and normalize a phone number string to standard Thai 10-digit format (08x, 09x, 06x)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if "e+" in s.lower():
        try:
            s = f"{int(float(s))}"
        except:
            pass
    s = re.sub(r"[^\d+]", "", s)
    if s.startswith("+66"):
        s = "0" + s[3:]
    elif s.startswith("66") and len(s) >= 11:
        s = "0" + s[2:]
    
    if len(s) == 9 and s.startswith(("8", "9", "6", "2", "3", "4", "5", "7")):
        s = "0" + s

    if re.match(r"^0\d{8,9}$", s):
        return s
    return s if len(s) >= 8 else None


def parse_duration_to_seconds(raw_dur: Any) -> int:
    """Parse 'HH:MM:SS' or numeric duration to total seconds."""
    if not raw_dur:
        return 0
    s = str(raw_dur).strip()
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(float(parts[2]))
            elif len(parts) == 2:
                return int(parts[0]) * 60 + int(float(parts[1]))
        except:
            return 0
    try:
        return int(float(s))
    except:
        return 0


class SPNIParser:
    """
    Parser for SPNI Phone Report Excel workbooks.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = storage_dir or os.path.join(DEFAULT_STORAGE_ROOT, "CDR")
        os.makedirs(self.storage_dir, exist_ok=True)
        self.index_file = os.path.join(self.storage_dir, "cdr_index.json")

    def is_spni_file(self, file_bytes: bytes, filename: str) -> bool:
        """
        Check if given file bytes represent a valid SPNI Phone Report Excel workbook.
        """
        fname_lower = filename.lower()
        if not fname_lower.endswith((".xlsx", ".xls")):
            return False
        
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as z:
                if "xl/workbook.xml" not in z.namelist():
                    return False
                wb_xml = z.read("xl/workbook.xml").decode("utf-8", errors="ignore")
                # SPNI workbooks contain specific Thai sheet names
                spni_signatures = ["ข้อมูลอุปกรณ์", "ประวัติการโทรทั้งหมด", "สมุดโทรศัพท์", "ข้อความ SMS", "SPNI"]
                return any(sig in wb_xml for sig in spni_signatures)
        except Exception:
            return False

    def parse_spni_file(
        self,
        file_bytes: bytes,
        filename: str,
        dossier_manager: Any = None,
        operator: str = "admin"
    ) -> Dict[str, Any]:
        """
        Parse complete SPNI Phone Report workbook and return structured intelligence payload.
        """
        with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as z:
            sheet_map = self._get_sheet_map(z)
            shared_strings = self._get_shared_strings(z)

            dev_rows = self._read_sheet_rows(z, sheet_map.get("ข้อมูลอุปกรณ์"), shared_strings)
            call_rows = self._read_sheet_rows(z, sheet_map.get("ประวัติการโทรทั้งหมด"), shared_strings)
            if not call_rows:
                # Fallback to individual in/out sheets if total sheet missing
                call_rows = self._read_sheet_rows(z, sheet_map.get("โทรออก"), shared_strings)
            contact_rows = self._read_sheet_rows(z, sheet_map.get("สมุดโทรศัพท์"), shared_strings)
            sms_rows = self._read_sheet_rows(z, sheet_map.get("ข้อความ SMS"), shared_strings)

            # 1. Device & Case Metadata
            device_info = self._parse_device_sheet(dev_rows)

            # 2. Contacts / Phonebook
            contacts_map = self._parse_contacts_sheet(contact_rows)

            # 3. Call Records & Aggregations
            call_data = self._parse_calls_sheet(call_rows, device_info.get("target_phone"), contacts_map)

            # If target phone wasn't in device sheet, use target from call sheet
            if not device_info.get("target_phone") and call_data.get("target_phone"):
                device_info["target_phone"] = call_data.get("target_phone")

            # 4. SMS Statistics
            sms_stats = self._parse_sms_sheet(sms_rows)

            session_id = f"CDR_SPNI_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
            now_iso = datetime.datetime.now().isoformat()

            session_payload = {
                "session_id": session_id,
                "report_type": "SPNI_PHONE_REPORT",
                "filename": filename,
                "uploaded_at": now_iso,
                "operator": operator,
                "device_info": device_info,
                "total_records": call_data["total_records"],
                "unique_phone_numbers": call_data["unique_phone_numbers"],
                "unique_pairs_count": len(call_data["call_pairs"]),
                "total_duration_sec": call_data["total_duration_sec"],
                "total_contacts": len(contacts_map),
                "total_sms": sms_stats.get("total_sms", 0),
                "call_pairs": call_data["call_pairs"],
                "records": call_data["records"][:500],
                "contacts": contacts_map
            }

            # Save session JSON
            session_file = os.path.join(self.storage_dir, f"{session_id}.json")
            with open(session_file, "w", encoding="utf-8") as f:
                json.dump(session_payload, f, ensure_ascii=False, indent=2)

            # Update index
            self._update_index(
                session_id=session_id,
                filename=filename,
                records_count=call_data["total_records"],
                phones_count=call_data["unique_phone_numbers"],
                pairs_count=len(call_data["call_pairs"]),
                uploaded_at=now_iso,
                owner_name=device_info.get("owner_name"),
                target_phone=device_info.get("target_phone")
            )

            # 5. Auto-sync with Dossier Vault if available
            dossier_res = None
            if dossier_manager and device_info.get("owner_name"):
                try:
                    dossier_res = self._sync_with_dossier(
                        dossier_manager=dossier_manager,
                        device_info=device_info,
                        operator=operator,
                        filename=filename
                    )
                    session_payload["dossier_sync"] = dossier_res
                except Exception as e:
                    logger.error(f"Failed to auto-sync SPNI report with Dossier Vault: {e}")

            return session_payload

    def _get_sheet_map(self, z: zipfile.ZipFile) -> Dict[str, str]:
        """Map sheet display names to internal worksheet XML file paths."""
        sheet_map = {}
        if "xl/workbook.xml" not in z.namelist():
            return sheet_map

        wb_tree = ET.fromstring(z.read("xl/workbook.xml"))
        rId_name = {}
        for s in wb_tree.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet"):
            name = s.attrib.get("name")
            rId = s.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            if name and rId:
                rId_name[rId] = name

        # Map rId to target XML
        if "xl/_rels/workbook.xml.rels" in z.namelist():
            rels_tree = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
            for rel in rels_tree.findall(".//{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
                rId = rel.attrib.get("Id")
                target = rel.attrib.get("Target", "").lstrip("/")
                if not target.startswith("xl/"):
                    target = "xl/" + target
                if rId in rId_name:
                    sheet_map[rId_name[rId]] = target

        return sheet_map

    def _get_shared_strings(self, z: zipfile.ZipFile) -> List[str]:
        """Extract shared strings table if present."""
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
            ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            for si in tree.findall(f".//{ns}si"):
                texts = [elem.text for elem in si.iter(f"{ns}t") if elem.text]
                strings.append("".join(texts))
        return strings

    def _read_sheet_rows(self, z: zipfile.ZipFile, sheet_file: Optional[str], shared_strings: List[str]) -> List[List[str]]:
        """Read worksheet XML rows into 2D string list with inlineStr and shared string resolution."""
        if not sheet_file or sheet_file not in z.namelist():
            return []

        tree = ET.fromstring(z.read(sheet_file))
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        rows = []

        for row_elem in tree.iter(f"{ns}row"):
            row_vals = []
            for c in row_elem.findall(f"{ns}c"):
                t = c.attrib.get("t")
                t_elem = c.find(f".//{ns}t")
                val = t_elem.text if t_elem is not None else None
                
                if val is None:
                    v_elem = c.find(f"{ns}v")
                    val = v_elem.text if v_elem is not None else ""
                    if t == "s" and val != "":
                        try:
                            idx = int(val)
                            val = shared_strings[idx] if idx < len(shared_strings) else val
                        except:
                            pass
                row_vals.append(str(val or "").strip())

            if any(row_vals):
                rows.append(row_vals)

        return rows

    def _parse_device_sheet(self, rows: List[List[str]]) -> Dict[str, Any]:
        """Extract metadata from 'ข้อมูลอุปกรณ์' sheet."""
        info = {
            "owner_name": "",
            "case_no": "",
            "case_name": "",
            "case_type": "คดียาเสพติด",
            "officer": "",
            "unit": "",
            "contact_phone": "",
            "brand": "",
            "model": "",
            "imei": "",
            "target_phone": "",
            "os_type": "",
            "report_date": ""
        }

        for r in rows:
            if not r:
                continue
            line = " ".join(r)
            if "สร้างเมื่อ:" in line:
                m = re.search(r"สร้างเมื่อ:\s*([^\s|]+(?:\s+[^\s|]+)?)", line)
                if m:
                    info["report_date"] = m.group(1).strip()
            if "ประเภทอุปกรณ์:" in line:
                m = re.search(r"ประเภทอุปกรณ์:\s*([^|]+)", line)
                if m:
                    info["os_type"] = m.group(1).strip()

            if len(r) >= 2:
                key = r[0].strip()
                val = r[1].strip()
                if "ชื่อเจ้าของเครื่อง" in key:
                    info["owner_name"] = val
                elif "เลขคดี" in key:
                    info["case_no"] = val
                elif "ชื่อคดี" in key:
                    info["case_name"] = val
                elif "ประเภทคดี" in key:
                    info["case_type"] = val
                elif "เจ้าหน้าที่ผู้ดึงข้อมูล" in key:
                    info["officer"] = val
                elif "สังกัด" in key:
                    info["unit"] = val
                elif "เบอร์ติดต่อประสานงาน" in key:
                    info["contact_phone"] = clean_phone_number(val) or val
                elif "ยี่ห้อ" in key:
                    info["brand"] = val
                elif "รุ่น" in key:
                    info["model"] = val
                elif "IMEI" in key:
                    info["imei"] = (info["imei"] + " " + val).strip()

        return info

    def _parse_contacts_sheet(self, rows: List[List[str]]) -> Dict[str, str]:
        """Extract phone -> contact name dictionary from 'สมุดโทรศัพท์' sheet."""
        contacts = {}
        header_passed = False

        for r in rows:
            if len(r) < 2:
                continue
            if "ชื่อ-นามสกุล" in r[0] or "หมายเลขโทรศัพท์" in r[1]:
                header_passed = True
                continue
            if not header_passed:
                continue

            name = r[0].strip()
            # Clean dot prefix like '. AIS Call Center' -> 'AIS Call Center'
            name = re.sub(r"^\.\s*", "", name)
            raw_phone = r[1].strip()
            phone = clean_phone_number(raw_phone)
            if phone and name:
                contacts[phone] = name

        return contacts

    def _parse_calls_sheet(
        self,
        rows: List[List[str]],
        known_target_phone: Optional[str],
        contacts_map: Dict[str, str]
    ) -> Dict[str, Any]:
        """Extract all call history records and compute aggregations."""
        target_phone = known_target_phone
        parsed_records: List[Dict[str, Any]] = []
        pair_aggregations: Dict[str, Dict[str, Any]] = {}
        unique_numbers: Set[str] = set()
        total_duration = 0

        # Try to find target phone from subheader if not supplied
        if not target_phone and len(rows) >= 2:
            for r in rows[:3]:
                line = " ".join(r)
                if "หมายเลข:" in line:
                    m = re.search(r"หมายเลข:\s*([0-9+]+)", line)
                    if m:
                        target_phone = clean_phone_number(m.group(1))

        # Find column header row
        header_idx = -1
        col_map = {}
        for idx, r in enumerate(rows):
            r_str = " ".join(r)
            if "เบอร์เครื่อง" in r_str and "เบอร์โทร" in r_str:
                header_idx = idx
                for c_idx, col_name in enumerate(r):
                    c_clean = col_name.strip()
                    if "เบอร์เครื่อง" in c_clean:
                        col_map["device_phone"] = c_idx
                    elif "เบอร์โทร" in c_clean:
                        col_map["other_phone"] = c_idx
                    elif "ชื่อ" in c_clean:
                        col_map["name"] = c_idx
                    elif "ประเภท" in c_clean:
                        col_map["call_type"] = c_idx
                    elif "ช่องทาง" in c_clean:
                        col_map["channel"] = c_idx
                    elif "วันที่" in c_clean:
                        col_map["date"] = c_idx
                    elif "เวลา" in c_clean:
                        col_map["time"] = c_idx
                    elif "ระยะเวลา" in c_clean:
                        col_map["duration"] = c_idx
                    elif "SIM" in c_clean:
                        col_map["sim"] = c_idx
                break

        if header_idx != -1:
            data_rows = rows[header_idx + 1:]
        else:
            data_rows = rows[3:] if len(rows) > 3 else []

        for r in data_rows:
            if not r or len(r) < 2:
                continue

            raw_dev = r[col_map.get("device_phone", 0)] if len(r) > col_map.get("device_phone", 0) else ""
            raw_oth = r[col_map.get("other_phone", 1)] if len(r) > col_map.get("other_phone", 1) else ""

            dev_num = clean_phone_number(raw_dev) or target_phone
            oth_num = clean_phone_number(raw_oth)

            if not oth_num:
                continue
            if not dev_num:
                dev_num = "0000000000"

            if not target_phone and dev_num != "0000000000":
                target_phone = dev_num

            # Call Type & Direction
            raw_type = r[col_map.get("call_type", 3)] if len(r) > col_map.get("call_type", 3) else ""
            c_type = raw_type.strip() or "โทรเข้า"

            if any(x in c_type for x in ["โทรออก", "outgoing", "out"]):
                caller = dev_num
                callee = oth_num
                direction = "outgoing"
            else:
                caller = oth_num
                callee = dev_num
                direction = "incoming" if any(x in c_type for x in ["โทรเข้า", "incoming", "in"]) else "missed"

            # Name tagging
            row_name = r[col_map.get("name", 2)].strip() if len(r) > col_map.get("name", 2) else ""
            contact_name = row_name or contacts_map.get(oth_num) or ""

            # Duration
            raw_dur = r[col_map.get("duration", 7)] if len(r) > col_map.get("duration", 7) else "00:00:00"
            dur_sec = parse_duration_to_seconds(raw_dur)
            total_duration += dur_sec

            # Date & Time
            d_val = r[col_map.get("date", 5)].strip() if len(r) > col_map.get("date", 5) else ""
            t_val = r[col_map.get("time", 6)].strip() if len(r) > col_map.get("time", 6) else ""
            dt_val = f"{d_val} {t_val}".strip()

            channel = r[col_map.get("channel", 4)].strip() if len(r) > col_map.get("channel", 4) else "Cellular"
            sim = r[col_map.get("sim", 8)].strip() if len(r) > col_map.get("sim", 8) else "SIM 1"

            unique_numbers.add(caller)
            unique_numbers.add(callee)

            record = {
                "caller": caller,
                "callee": callee,
                "direction": direction,
                "call_type": c_type,
                "contact_name": contact_name,
                "datetime": dt_val,
                "duration_sec": dur_sec,
                "channel": channel or "Cellular",
                "sim": sim
            }
            parsed_records.append(record)

            # Aggregate pair
            p_key = " <-> ".join(sorted([caller, callee]))
            if p_key not in pair_aggregations:
                pair_aggregations[p_key] = {
                    "party_a": min(caller, callee),
                    "party_b": max(caller, callee),
                    "contact_name": contact_name,
                    "total_calls": 0,
                    "total_duration_sec": 0,
                    "a_to_b_calls": 0,
                    "b_to_a_calls": 0,
                    "missed_calls": 0,
                    "first_call": dt_val,
                    "last_call": dt_val,
                }

            p_entry = pair_aggregations[p_key]
            p_entry["total_calls"] += 1
            p_entry["total_duration_sec"] += dur_sec
            if not p_entry.get("contact_name") and contact_name:
                p_entry["contact_name"] = contact_name

            if caller == p_entry["party_a"]:
                p_entry["a_to_b_calls"] += 1
            else:
                p_entry["b_to_a_calls"] += 1

            if direction == "missed" or "ไม่รับ" in c_type:
                p_entry["missed_calls"] += 1

            if dt_val:
                p_entry["last_call"] = dt_val

            # Store itemized call records for this pair
            if "records" not in p_entry:
                p_entry["records"] = []
            p_entry["records"].append(record)

        call_pairs = list(pair_aggregations.values())
        call_pairs.sort(key=lambda x: x["total_calls"], reverse=True)

        return {
            "target_phone": target_phone,
            "total_records": len(parsed_records),
            "unique_phone_numbers": len(unique_numbers),
            "total_duration_sec": total_duration,
            "call_pairs": call_pairs,
            "records": parsed_records
        }

    def _parse_sms_sheet(self, rows: List[List[str]]) -> Dict[str, Any]:
        """Extract summary counts from 'ข้อความ SMS' sheet."""
        if not rows:
            return {"total_sms": 0}
        count = len(rows) - 3 if len(rows) > 3 else max(0, len(rows) - 1)
        return {"total_sms": count}

    def _sync_with_dossier(
        self,
        dossier_manager: Any,
        device_info: Dict[str, Any],
        operator: str,
        filename: str
    ) -> Dict[str, Any]:
        """Auto-create or enrich suspect dossier in Arrest Vault."""
        owner_name = device_info.get("owner_name")
        if not owner_name:
            return {"synced": False, "reason": "No owner name"}

        target_phone = device_info.get("target_phone")
        case_no = device_info.get("case_no") or "SPNI-REPORT"
        case_type = device_info.get("case_type") or "คดียาเสพติด"
        brand_model = f"{device_info.get('brand', '')} {device_info.get('model', '')}".strip()

        notes = (
            f"📱 ข้อมูลโทรศัพท์ SPNI: {brand_model} (IMEI: {device_info.get('imei', '-')})\n"
            f"เลขที่คดี: {case_no} | หน่วยงาน: {device_info.get('unit', '-')}\n"
            f"ไฟล์ต้นฉบับ: {filename}"
        )

        dossier = dossier_manager.upsert_dossier(
            suspect_name=owner_name,
            phone_number=target_phone,
            role_tag="เป้าหมาย (SPNI)",
            category=case_type,
            notes=notes,
            officer_username=operator,
            platform="telegram_spni",
            name_source="spni_report"
        )

        return {
            "synced": True,
            "dossier_id": dossier.get("dossier_id"),
            "suspect_name": dossier.get("suspect_name")
        }

    def _update_index(
        self,
        session_id: str,
        filename: str,
        records_count: int,
        phones_count: int,
        pairs_count: int,
        uploaded_at: str,
        owner_name: Optional[str] = None,
        target_phone: Optional[str] = None
    ) -> None:
        """Update or create central CDR index with SPNI metadata."""
        index_data = []
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    index_data = json.load(f)
            except Exception:
                index_data = []

        index_data = [item for item in index_data if item.get("session_id") != session_id]

        index_data.insert(0, {
            "session_id": session_id,
            "filename": filename,
            "source_type": "SPNI_PHONE_REPORT",
            "owner_name": owner_name or "",
            "target_phone": target_phone or "",
            "total_records": records_count,
            "unique_phone_numbers": phones_count,
            "unique_pairs_count": pairs_count,
            "uploaded_at": uploaded_at
        })

        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump(index_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to update CDR index for SPNI session: {e}")
