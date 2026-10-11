"""
CDR (Call Detail Records) Parser & Telecom Intelligence Engine (BPP-VMS)
-------------------------------------------------------------------------
Parses telecommunication call records from CSV, XLSX, XLS, and TXT files.
Auto-detects Thai and English column headers, normalizes 10-digit phone numbers,
aggregates caller-callee communication graphs, and correlates with suspect dossiers.
"""

import os
import io
import re
import csv
import json
import uuid
import datetime
import logging
from typing import List, Dict, Any, Optional, Tuple, Set

logger = logging.getLogger("nas.cdr")

# Column header synonyms for automatic detection
CALLER_SYNONYMS = [
    "caller", "calling", "calling_number", "calling_no", "calling_party", "a_party", "a_number", "anumber", "source", "from",
    "เบอร์โทรออก", "หมายเลขต้นทาง", "เบอร์ต้นทาง", "ผู้โทร", "ต้นทาง", "เบอร์ผู้โทร", "a_party_no", "source_no", "msisdn",
    "เบอร์หลัก", "เบอร์เป้าหมาย", "party_a", "party a", "เบอร์โทร", "เบอร์"
]

CALLEE_SYNONYMS = [
    "callee", "called", "called_number", "called_no", "called_party", "b_party", "b_number", "bnumber", "destination", "to",
    "เบอร์รับสาย", "หมายเลขปลายทาง", "เบอร์ปลายทาง", "ผู้รับสาย", "ปลายทาง", "เบอร์ผู้รับ", "b_party_no", "destination_no",
    "dialed_digits", "party_b", "party b"
]

# For Single-Target CDR formats (where table only has "peer/counterparty" + "direction")
PARTY_SYNONYMS = [
    "คู่สนทนา", "หมายเลขคู่สนทนา", "เบอร์คู่สนทนา", "เบอร์คู่กรณี", "เบอร์ที่ติดต่อ", "เบอร์ปลายทาง", "ปลายทาง",
    "other_party", "peer_number", "peer", "counterparty", "b_party", "called", "contact_number"
]

DIRECTION_SYNONYMS = [
    "ทิศทาง", "ประเภท", "ประเภทการโทร", "ประเภทการใช้งาน", "call_type", "direction", "in_out", "traffic", "บริการ",
    "เข้า/ออก", "traffic_type", "call_direction", "flow"
]

INCOMING_KEYWORDS = ["รับสาย", "เข้า", "in", "incoming", "mt", "terminating", "receive", "inbound", "รับ"]
OUTGOING_KEYWORDS = ["โทรออก", "ออก", "out", "outgoing", "mo", "originating", "dial", "outbound", "โทร"]

DATETIME_SYNONYMS = [
    "datetime", "date_time", "timestamp", "call_date", "call_time", "time", "date",
    "วันเวลา", "วันที่และเวลา", "วันและเวลา", "เวลาโทร", "เวลาเริ่มต้น", "วัน_เวลา", "start_time", "date_and_time"
]

DATE_SYNONYMS = ["date", "call_date", "วันที่", "วัน"]
TIME_SYNONYMS = ["time", "call_time", "เวลา", "เวลาโทร"]

DURATION_SYNONYMS = [
    "duration", "call_duration", "seconds", "sec", "duration_sec", "dur",
    "ระยะเวลา", "เวลาสนทนา", "ระยะเวลาสนทนา", "วินาที", "นาที", "ระยะเวลา(วินาที)", "ระยะเวลา (วินาที)", "duration(sec)"
]

CELL_SYNONYMS = [
    "cell_site", "cellsite", "tower", "cell_id", "cgi", "location", "site_name", "lac_ci", "lac/ci",
    "เสาสัญญาณ", "พิกัดเสา", "สถานีฐาน", "ชื่อเสา", "พื้นที่เสา", "สถานที่", "สถานี"
]

TYPE_SYNONYMS = [
    "type", "call_type", "direction", "service_type", "ประเภท", "ประเภทการโทร", "ทิศทาง", "บริการ"
]


def clean_phone_number(raw: Any) -> Optional[str]:
    """Clean and normalize a phone number string to standard Thai 10-digit format (08x, 09x, 06x)."""
    if raw is None:
        return None
    s = str(raw).strip()
    # Remove scientific notation if float from excel
    if "e+" in s.lower():
        try:
            s = f"{int(float(s))}"
        except Exception:
            pass
    # Remove special chars, spaces, dashes
    s = re.sub(r"[^\d+]", "", s)
    if s.startswith("+66"):
        s = "0" + s[3:]
    elif s.startswith("66") and len(s) >= 11:
        s = "0" + s[2:]

    # If 9 digits (missing leading zero), prepend 0
    if len(s) == 9 and s.startswith(("8", "9", "6", "2", "3", "4", "5", "7")):
        s = "0" + s

    # Ensure 9-10 digits standard Thai phone
    if re.match(r"^0\d{8,9}$", s):
        return s
    return s if len(s) >= 8 else None


def extract_potential_phone_number(text: Any) -> Optional[str]:
    """Extract first valid Thai mobile/landline phone number from arbitrary text string."""
    if not text:
        return None
    s = str(text)
    match = re.search(r"(?:\+?66|0)[0-9\s-]{8,14}", s)
    if match:
        return clean_phone_number(match.group(0))
    return None


class CDRParser:
    def __init__(self, storage_dir: str = "/data/nas-storage/CDR"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self.index_file = os.path.join(self.storage_dir, "cdr_index.json")

    def parse_cdr_file(
        self,
        file_bytes: bytes,
        filename: str,
        dossier_manager: Any = None,
        operator: str = "admin"
    ) -> Dict[str, Any]:
        """
        Parse raw bytes of CSV, XLSX, XLS, or SPNI Phone Report file into structured CDR call records.
        Supports multi-sheet workbooks, single-target formats, and dynamic table header offsets.
        """
        from services.spni_parser import SPNIParser

        spni = SPNIParser(self.storage_dir)
        if spni.is_spni_file(file_bytes, filename):
            return spni.parse_spni_file(file_bytes, filename, dossier_manager=dossier_manager, operator=operator)

        fname_lower = filename.lower()
        file_target_phone = extract_potential_phone_number(filename)

        # List of parsed sheets: each element is (sheet_name, parsed_records)
        sheets_data = []

        if fname_lower.endswith((".xlsx", ".xls")):
            sheets_data = self._parse_excel_workbook(file_bytes, filename, file_target_phone)
        elif fname_lower.endswith((".csv", ".txt")):
            single_sheet = self._parse_csv_file(file_bytes, filename, file_target_phone)
            if single_sheet:
                sheets_data = [single_sheet]
        else:
            # Fallback: try Excel first, then CSV
            try:
                sheets_data = self._parse_excel_workbook(file_bytes, filename, file_target_phone)
            except Exception:
                single_sheet = self._parse_csv_file(file_bytes, filename, file_target_phone)
                if single_sheet:
                    sheets_data = [single_sheet]

        if not sheets_data:
            raise ValueError(f"ไม่สามารถอ่านข้อมูลบันทึกการโทรจากไฟล์ '{filename}' ได้ หรือไม่พบตารางประวัติการโทร")

        # Aggregate across all valid sheets
        all_records: List[Dict[str, Any]] = []
        pair_aggregations: Dict[str, Dict[str, Any]] = {}
        unique_numbers: Set[str] = set()
        total_duration = 0
        sheets_processed: List[str] = []

        for sheet_name, records in sheets_data:
            if not records:
                continue
            sheets_processed.append(sheet_name)
            for r in records:
                all_records.append(r)
                caller = r["caller"]
                callee = r["callee"]
                dur_sec = r.get("duration_sec", 0)
                dt_val = r.get("datetime", "")
                cell_val = r.get("cell_site", "")

                unique_numbers.add(caller)
                unique_numbers.add(callee)
                total_duration += dur_sec

                p_key = " <-> ".join(sorted([caller, callee]))
                if p_key not in pair_aggregations:
                    pair_aggregations[p_key] = {
                        "party_a": min(caller, callee),
                        "party_b": max(caller, callee),
                        "total_calls": 0,
                        "total_duration_sec": 0,
                        "a_to_b_calls": 0,
                        "b_to_a_calls": 0,
                        "first_call": dt_val,
                        "last_call": dt_val,
                        "cell_sites": set(),
                        "records": []
                    }

                p_entry = pair_aggregations[p_key]
                p_entry["total_calls"] += 1
                p_entry["total_duration_sec"] += dur_sec
                if caller == p_entry["party_a"]:
                    p_entry["a_to_b_calls"] += 1
                else:
                    p_entry["b_to_a_calls"] += 1

                if dt_val:
                    if not p_entry["first_call"] or dt_val < p_entry["first_call"]:
                        p_entry["first_call"] = dt_val
                    if not p_entry["last_call"] or dt_val > p_entry["last_call"]:
                        p_entry["last_call"] = dt_val

                if cell_val:
                    p_entry["cell_sites"].add(cell_val)
                p_entry["records"].append(r)

        if not all_records:
            raise ValueError(f"ไม่พบรายการโทรที่ถูกต้องในไฟล์ '{filename}' (ตรวจสอบคอลัมน์หมายเลขโทรศัพท์)")

        call_pairs = []
        for k, v in pair_aggregations.items():
            entry_copy = dict(v)
            entry_copy["cell_sites"] = list(entry_copy["cell_sites"])
            call_pairs.append(entry_copy)

        call_pairs.sort(key=lambda x: x["total_calls"], reverse=True)

        session_id = f"CDR_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        now_iso = datetime.datetime.now().isoformat()

        session_data = {
            "session_id": session_id,
            "filename": filename,
            "uploaded_at": now_iso,
            "total_records": len(all_records),
            "unique_phone_numbers": len(unique_numbers),
            "unique_pairs_count": len(call_pairs),
            "total_duration_sec": total_duration,
            "sheets_processed": sheets_processed,
            "call_pairs": call_pairs,
            "records": all_records[:500]  # Store top 500 sample records
        }

        # Save session file
        session_file = os.path.join(self.storage_dir, f"{session_id}.json")
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session_data, f, ensure_ascii=False, indent=2)

        # Update index
        self._update_index(session_id, filename, len(all_records), len(unique_numbers), len(call_pairs), now_iso)

        return session_data

    def _parse_excel_workbook(
        self,
        file_bytes: bytes,
        filename: str,
        file_target_phone: Optional[str]
    ) -> List[Tuple[str, List[Dict[str, Any]]]]:
        """Parse all sheets from an Excel workbook (.xlsx or .xls)."""
        results = []

        # Try openpyxl for .xlsx
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                sheet_rows = list(sheet.iter_rows(values_only=True))
                if not sheet_rows:
                    continue
                parsed = self._extract_records_from_raw_grid(sheet_rows, sheet_name, file_target_phone)
                if parsed:
                    results.append((sheet_name, parsed))
            if results:
                return results
        except Exception as e:
            logger.info("openpyxl parse failed or file is not xlsx: %s", e)

        # Try xlrd for legacy .xls files
        try:
            import xlrd
            book = xlrd.open_workbook(file_contents=file_bytes)
            for sheet_idx in range(book.nsheets):
                sheet = book.sheet_by_index(sheet_idx)
                sheet_name = sheet.name
                sheet_rows = [sheet.row_values(r) for r in range(sheet.nrows)]
                if not sheet_rows:
                    continue
                parsed = self._extract_records_from_raw_grid(sheet_rows, sheet_name, file_target_phone)
                if parsed:
                    results.append((sheet_name, parsed))
            if results:
                return results
        except Exception as e:
            logger.info("xlrd parse failed: %s", e)

        return results

    def _parse_csv_file(
        self,
        file_bytes: bytes,
        filename: str,
        file_target_phone: Optional[str]
    ) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
        """Parse CSV or TXT file with automatic encoding & delimiter detection."""
        for encoding in ["utf-8-sig", "utf-8", "cp874", "tis-620", "latin1"]:
            try:
                text = file_bytes.decode(encoding)
                lines = [ln for ln in text.splitlines() if ln.strip()]
                if not lines:
                    continue

                sample = "\n".join(lines[:30])
                delimiter = ","
                for d in ["\t", ";", "|", ","]:
                    if sample.count(d) > sample.count(delimiter):
                        delimiter = d

                reader = csv.reader(io.StringIO(text), delimiter=delimiter)
                raw_grid = [row for row in reader if any(row)]
                if not raw_grid:
                    continue

                parsed = self._extract_records_from_raw_grid(raw_grid, "CSV", file_target_phone)
                if parsed:
                    return ("CSV", parsed)
            except UnicodeDecodeError:
                continue
            except Exception as exc:
                logger.debug("CSV parse try with %s failed: %s", encoding, exc)
                continue
        return None

    def _extract_records_from_raw_grid(
        self,
        raw_rows: List[List[Any]],
        sheet_name: str,
        file_target_phone: Optional[str]
    ) -> List[Dict[str, Any]]:
        """
        Dynamically finds the table header row (scanning up to row 20), detects column schema
        (both caller/callee or single-target format), and parses records.
        """
        if not raw_rows:
            return []

        # 1. Search first 20 rows for potential target phone mentions in header text
        sheet_target_phone = extract_potential_phone_number(sheet_name) or file_target_phone
        header_row_idx = -1
        col_map: Dict[str, int] = {}
        is_single_target = False

        scan_limit = min(20, len(raw_rows))
        best_score = 0

        for r_idx in range(scan_limit):
            row = raw_rows[r_idx]
            if not row or not any(row):
                continue

            row_str = " ".join(str(c or "") for c in row)
            if not sheet_target_phone:
                cand_phone = extract_potential_phone_number(row_str)
                if cand_phone:
                    sheet_target_phone = cand_phone

            # Evaluate this row as a potential header
            detected_map, score, single_target_flag = self._score_header_row(row)
            if score > best_score and score >= 2:
                best_score = score
                header_row_idx = r_idx
                col_map = detected_map
                is_single_target = single_target_flag

        if header_row_idx == -1 or not col_map:
            return []

        # Check column requirements
        caller_idx = col_map.get("caller")
        callee_idx = col_map.get("callee")
        party_idx = col_map.get("party")
        dir_idx = col_map.get("direction")
        datetime_idx = col_map.get("datetime")
        date_idx = col_map.get("date")
        time_idx = col_map.get("time")
        dur_idx = col_map.get("duration")
        cell_idx = col_map.get("cell_site")
        type_idx = col_map.get("call_type")

        # Must have either (caller AND callee) OR (party + target_phone)
        if (caller_idx is None or callee_idx is None) and (party_idx is None or not sheet_target_phone):
            # If we have party_idx but no target phone, try to find a dominant caller in rows
            if party_idx is not None:
                sheet_target_phone = self._infer_target_phone_from_rows(raw_rows[header_row_idx + 1:])
            if not sheet_target_phone:
                return []

        parsed_records: List[Dict[str, Any]] = []

        for r_idx in range(header_row_idx + 1, len(raw_rows)):
            row = raw_rows[r_idx]
            if not row or not any(row):
                continue

            caller = None
            callee = None

            if caller_idx is not None and callee_idx is not None and caller_idx < len(row) and callee_idx < len(row):
                caller = clean_phone_number(row[caller_idx])
                callee = clean_phone_number(row[callee_idx])
            elif party_idx is not None and party_idx < len(row) and sheet_target_phone:
                peer_phone = clean_phone_number(row[party_idx])
                if peer_phone:
                    direction_str = str(row[dir_idx] if (dir_idx is not None and dir_idx < len(row)) else "").lower()
                    if any(k in direction_str for k in INCOMING_KEYWORDS):
                        caller = peer_phone
                        callee = sheet_target_phone
                    else:
                        # Default to Outgoing
                        caller = sheet_target_phone
                        callee = peer_phone

            if not caller or not callee or caller == callee:
                continue

            # Parse datetime
            dt_str = ""
            if datetime_idx is not None and datetime_idx < len(row) and row[datetime_idx] is not None:
                dt_str = str(row[datetime_idx]).strip()
            elif date_idx is not None and date_idx < len(row):
                d_val = str(row[date_idx] or "").strip()
                t_val = str(row[time_idx] or "").strip() if (time_idx is not None and time_idx < len(row)) else ""
                dt_str = f"{d_val} {t_val}".strip()

            # Parse duration
            dur_sec = 0
            if dur_idx is not None and dur_idx < len(row):
                dur_raw = row[dur_idx]
                try:
                    dur_sec = int(float(dur_raw)) if dur_raw is not None else 0
                except Exception:
                    dur_sec = 0

            # Parse cell / tower
            cell_val = str(row[cell_idx] or "").strip() if (cell_idx is not None and cell_idx < len(row)) else ""
            type_val = str(row[type_idx] or "Voice").strip() if (type_idx is not None and type_idx < len(row)) else "Voice"

            parsed_records.append({
                "caller": caller,
                "callee": callee,
                "datetime": dt_str,
                "duration_sec": dur_sec,
                "cell_site": cell_val,
                "call_type": type_val,
                "sheet_name": sheet_name
            })

        return parsed_records

    def _score_header_row(self, row: List[Any]) -> Tuple[Dict[str, int], int, bool]:
        """Examine a row and score its likelihood of being a CDR table header."""
        col_map: Dict[str, int] = {}
        score = 0
        single_target_flag = False

        for idx, cell in enumerate(row):
            if cell is None:
                continue
            text = str(cell).strip().lower().replace(" ", "_").replace("-", "_")
            if not text:
                continue

            if "caller" not in col_map and any(syn in text for syn in CALLER_SYNONYMS):
                col_map["caller"] = idx
                score += 2
            elif "callee" not in col_map and any(syn in text for syn in CALLEE_SYNONYMS):
                col_map["callee"] = idx
                score += 2
            elif "party" not in col_map and any(syn in text for syn in PARTY_SYNONYMS):
                col_map["party"] = idx
                score += 2
            elif "direction" not in col_map and any(syn in text for syn in DIRECTION_SYNONYMS):
                col_map["direction"] = idx
                score += 1
            elif "datetime" not in col_map and any(syn in text for syn in DATETIME_SYNONYMS):
                col_map["datetime"] = idx
                score += 1
            elif "date" not in col_map and any(syn in text for syn in DATE_SYNONYMS):
                col_map["date"] = idx
                score += 1
            elif "time" not in col_map and any(syn in text for syn in TIME_SYNONYMS):
                col_map["time"] = idx
                score += 1
            elif "duration" not in col_map and any(syn in text for syn in DURATION_SYNONYMS):
                col_map["duration"] = idx
                score += 1
            elif "cell_site" not in col_map and any(syn in text for syn in CELL_SYNONYMS):
                col_map["cell_site"] = idx
                score += 1
            elif "call_type" not in col_map and any(syn in text for syn in TYPE_SYNONYMS):
                col_map["call_type"] = idx
                score += 1

        if "caller" in col_map and "callee" in col_map:
            single_target_flag = False
        elif "party" in col_map or ("callee" in col_map and "caller" not in col_map):
            if "party" not in col_map and "callee" in col_map:
                col_map["party"] = col_map["callee"]
            single_target_flag = True

        return col_map, score, single_target_flag

    def _infer_target_phone_from_rows(self, rows: List[List[Any]]) -> Optional[str]:
        """If caller column is missing, inspect row values to find any phone repeated constantly."""
        phone_freq: Dict[str, int] = {}
        for r in rows[:100]:
            for cell in r:
                p = clean_phone_number(cell)
                if p:
                    phone_freq[p] = phone_freq.get(p, 0) + 1
        if phone_freq:
            top_p = max(phone_freq.items(), key=lambda x: x[1])
            if top_p[1] >= 10:
                return top_p[0]
        return None

    def _update_index(self, session_id: str, filename: str, records_count: int, phones_count: int, pairs_count: int, uploaded_at: str):
        index = []
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    index = json.load(f)
            except:
                index = []

        index.insert(0, {
            "session_id": session_id,
            "filename": filename,
            "records_count": records_count,
            "phones_count": phones_count,
            "pairs_count": pairs_count,
            "uploaded_at": uploaded_at
        })

        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

    def get_all_cdr_sessions(self) -> List[Dict[str, Any]]:
        """List all uploaded CDR analysis sessions."""
        if not os.path.exists(self.index_file):
            return []
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []

    def get_cdr_session_detail(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full details of a specific CDR session."""
        session_path = os.path.join(self.storage_dir, f"{session_id}.json")
        if not os.path.exists(session_path):
            return None
        try:
            with open(session_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading CDR session {session_id}: {e}")
            return None

    def get_all_active_call_pairs(self) -> List[Dict[str, Any]]:
        """Aggregate call pairs from all stored CDR sessions."""
        aggregated: Dict[str, Dict[str, Any]] = {}
        for fn in os.listdir(self.storage_dir):
            if fn.endswith(".json") and fn != "cdr_index.json":
                try:
                    with open(os.path.join(self.storage_dir, fn), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for cp in data.get("call_pairs", []):
                        pair_key = f"{cp['party_a']} <-> {cp['party_b']}"
                        if pair_key not in aggregated:
                            aggregated[pair_key] = dict(cp)
                            aggregated[pair_key]["records"] = list(cp.get("records", []))
                        else:
                            aggregated[pair_key]["total_calls"] += cp.get("total_calls", 0)
                            aggregated[pair_key]["total_duration_sec"] += cp.get("total_duration_sec", 0)
                            aggregated[pair_key]["a_to_b_calls"] += cp.get("a_to_b_calls", 0)
                            aggregated[pair_key]["b_to_a_calls"] += cp.get("b_to_a_calls", 0)
                            if not aggregated[pair_key].get("contact_name") and cp.get("contact_name"):
                                aggregated[pair_key]["contact_name"] = cp.get("contact_name")
                            aggregated[pair_key].setdefault("records", []).extend(cp.get("records", []))
                except:
                    continue
        return list(aggregated.values())

    def get_all_contacts(self) -> Dict[str, str]:
        """Aggregate phone -> contact name dictionary from all stored SPNI/CDR sessions."""
        contacts: Dict[str, str] = {}
        for fn in os.listdir(self.storage_dir):
            if fn.endswith(".json") and fn != "cdr_index.json":
                try:
                    with open(os.path.join(self.storage_dir, fn), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    c_map = data.get("contacts", {})
                    for p, n in c_map.items():
                        if p and n and p not in contacts:
                            contacts[p] = n
                except Exception:
                    continue
        return contacts

    def delete_cdr_session(self, session_id: str) -> bool:
        """Delete a single CDR analysis session and its stored data."""
        session_path = os.path.join(self.storage_dir, f"{session_id}.json")
        deleted = False
        if os.path.exists(session_path):
            try:
                os.remove(session_path)
                deleted = True
            except Exception as e:
                logger.error(f"Error removing {session_path}: {e}")

        # Update index
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    index = json.load(f)
                index = [s for s in index if s.get("session_id") != session_id]
                with open(self.index_file, "w", encoding="utf-8") as f:
                    json.dump(index, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.error(f"Error updating index: {e}")
        return deleted

    def clear_all_cdr_sessions(self) -> int:
        """Clear all stored CDR sessions."""
        count = 0
        if os.path.exists(self.storage_dir):
            for fn in os.listdir(self.storage_dir):
                if fn.endswith(".json"):
                    try:
                        os.remove(os.path.join(self.storage_dir, fn))
                        count += 1
                    except:
                        pass
        return count
