"""
Bank Statement Parser & Financial Intelligence Engine (BPP-VMS)
--------------------------------------------------------------
Parses encrypted and unencrypted Bank Statement PDFs from Thai banks
(SCB, KBank, KTB, BAY, GSB, TTB, PromptPay, etc.).
Extracts account ownership, transaction ledger tables, counterparty money flows,
detects suspicious transaction patterns (mule accounts, rapid pass-through),
and correlates financial links with suspect dossiers.
"""

import os
import io
import csv
import re
import json
import uuid
import datetime
import logging
from typing import List, Dict, Any, Optional, Tuple

try:
    import pypdf
except ImportError:
    pypdf = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

logger = logging.getLogger("nas.statement")

KNOWN_BANKS = {
    "SCB": ["ไทยพาณิชย์", "SIAM COMMERCIAL", "SCB"],
    "KBANK": ["กสิกรไทย", "KASIKORN", "KBANK", "KBNK"],
    "KTB": ["กรุงไทย", "KRUNGTHAI", "KTB"],
    "BAY": ["กรุงศรี", "AYUDHYA", "BAY"],
    "GSB": ["ออมสิน", "GOVERNMENT SAVINGS", "GSB"],
    "TTB": ["ทหารไทยธนชาต", "TMBTHANACHART", "TTB", "TMB"],
    "BBL": ["กรุงเทพ", "BANGKOK BANK", "BBL"],
    "KKP": ["เกียรตินาคิน", "KIATNAKIN", "KKP"],
    "CIMB": ["ซีไอเอ็มบี", "CIMB"],
    "UOB": ["ยูโอบี", "UOB"],
    "PROMPTPAY": ["พร้อมเพย์", "PROMPTPAY", "PROMPT PAY"]
}


class BankStatementParser:
    def __init__(self, storage_dir: str = "/data/nas-storage/Statements"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self.index_file = os.path.join(self.storage_dir, "statement_index.json")

    def parse_statement_file(
        self,
        file_bytes: bytes,
        filename: str,
        password: Optional[str] = None,
        candidate_passwords: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Unified entry point for Bank Statement file import (PDF, XLSX, XLS, CSV)."""
        fn_lower = filename.lower()
        if fn_lower.endswith(".pdf") or file_bytes.startswith(b"%PDF"):
            return self.parse_statement_pdf(file_bytes, filename, password=password, candidate_passwords=candidate_passwords)
        elif fn_lower.endswith((".xlsx", ".xls")) or file_bytes.startswith(b"PK\x03\x04") or file_bytes.startswith(b"\xd0\xcf\x11\xe0"):
            return self.parse_statement_excel(file_bytes, filename)
        elif fn_lower.endswith((".csv", ".txt")):
            return self.parse_statement_csv(file_bytes, filename)
        else:
            # Fallback: try PDF first, then Excel, then CSV
            if file_bytes.startswith(b"%PDF"):
                return self.parse_statement_pdf(file_bytes, filename, password=password, candidate_passwords=candidate_passwords)
            try:
                return self.parse_statement_excel(file_bytes, filename)
            except Exception:
                return self.parse_statement_csv(file_bytes, filename)

    def parse_statement_pdf(
        self,
        file_bytes: bytes,
        filename: str,
        password: Optional[str] = None,
        candidate_passwords: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Decrypt and parse bank statement PDF into structured account and transaction data.
        Falls back to OCR if the document is a scanned image PDF.
        """
        # 1. Determine and test decryption password
        valid_password = None
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        
        if reader.is_encrypted:
            if not password:
                # Immediately notify caller/frontend that password is required
                raise ValueError("ไฟล์ Statement ถูกเข้ารหัสผ่าน (Password Protected) กรุณาระบุรหัสผ่านเพื่อปลดล็อก")

            try:
                decrypted = reader.decrypt(str(password).strip())
                if not decrypted:
                    raise ValueError("รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านใหม่เพื่อปลดล็อกไฟล์")
                valid_password = str(password).strip()
            except Exception:
                raise ValueError("รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านใหม่เพื่อปลดล็อกไฟล์")

        # 2. Extract Text & Tables using pdfplumber
        extracted_text_pages = []
        raw_table_rows = []

        with pdfplumber.open(io.BytesIO(file_bytes), password=valid_password) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                extracted_text_pages.append(page_text)
                
                tables = page.extract_tables()
                for table in tables:
                    if table:
                        raw_table_rows.extend(table)

        full_doc_text = "\n".join(extracted_text_pages)

        # Scanned PDF OCR Fallback
        if len(full_doc_text.strip()) < 50:
            logger.info("PDF '%s' has low text density; attempting OCR on scanned pages...", filename)
            ocr_pages = self._ocr_pdf_pages(file_bytes, valid_password)
            if ocr_pages:
                full_doc_text = "\n".join(ocr_pages)

        if not full_doc_text.strip():
            raise ValueError(f"ไม่สามารถอ่านข้อมูลตัวอักษรจากไฟล์ Statement '{filename}' ได้")

        # 3. Parse Account Header
        account_info = self._extract_account_header(full_doc_text, filename)

        # 4. Parse Transactions Ledger
        transactions = self._extract_transactions(full_doc_text, raw_table_rows)

        # 5. Financial Flow Aggregations & Counterparty Mapping
        flow_data = self._aggregate_financial_flows(account_info, transactions)

        return self._save_statement_session(
            filename=filename,
            is_encrypted=reader.is_encrypted,
            account_info=account_info,
            transactions=transactions,
            flow_data=flow_data,
            file_bytes=file_bytes
        )

    def parse_statement_excel(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """Parse bank statement from Excel (.xlsx or .xls) table grid."""
        raw_grid: List[List[Any]] = []

        # Try openpyxl
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            for sname in wb.sheetnames:
                sheet = wb[sname]
                rows = list(sheet.iter_rows(values_only=True))
                if rows and any(rows):
                    raw_grid = [list(r) for r in rows if r and any(r)]
                    break
        except Exception as e:
            logger.info("openpyxl statement parse failed: %s", e)

        # Try xlrd
        if not raw_grid:
            try:
                import xlrd
                book = xlrd.open_workbook(file_contents=file_bytes)
                for sidx in range(book.nsheets):
                    sheet = book.sheet_by_index(sidx)
                    rows = [sheet.row_values(r) for r in range(sheet.nrows)]
                    if rows and any(rows):
                        raw_grid = rows
                        break
            except Exception as e:
                logger.info("xlrd statement parse failed: %s", e)

        if not raw_grid:
            raise ValueError(f"ไม่สามารถอ่านข้อมูลจากไฟล์ Excel Statement '{filename}' ได้ หรือไฟล์ว่างเปล่า")

        account_info, transactions = self._parse_statement_table_grid(raw_grid, filename)
        if not transactions:
            raise ValueError(f"ไม่พบตารางรายการเดินบัญชีในไฟล์ Excel Statement '{filename}'")

        flow_data = self._aggregate_financial_flows(account_info, transactions)
        return self._save_statement_session(
            filename=filename,
            is_encrypted=False,
            account_info=account_info,
            transactions=transactions,
            flow_data=flow_data,
            file_bytes=file_bytes
        )

    def parse_statement_csv(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """Parse bank statement from CSV or TXT file."""
        raw_grid: List[List[Any]] = []
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
                if raw_grid:
                    break
            except UnicodeDecodeError:
                continue
            except Exception:
                continue

        if not raw_grid:
            raise ValueError(f"ไม่สามารถอ่านข้อมูลจากไฟล์ CSV Statement '{filename}' ได้ หรือไฟล์ว่างเปล่า")

        account_info, transactions = self._parse_statement_table_grid(raw_grid, filename)
        if not transactions:
            raise ValueError(f"ไม่พบตารางรายการเดินบัญชีในไฟล์ CSV Statement '{filename}'")

        flow_data = self._aggregate_financial_flows(account_info, transactions)
        return self._save_statement_session(
            filename=filename,
            is_encrypted=False,
            account_info=account_info,
            transactions=transactions,
            flow_data=flow_data,
            file_bytes=file_bytes
        )

    def _ocr_pdf_pages(self, file_bytes: bytes, password: Optional[str] = None) -> List[str]:
        """Convert scanned PDF pages to images and run Tesseract OCR with Thai+Eng."""
        ocr_pages = []
        try:
            import pypdfium2 as pdfium
            import pytesseract
            pdf = pdfium.PdfDocument(io.BytesIO(file_bytes), password=password)
            for page in pdf:
                image = page.render(scale=2).to_pil()
                text = pytesseract.image_to_string(image, lang="tha+eng")
                if text.strip():
                    ocr_pages.append(text)
            if ocr_pages:
                return ocr_pages
        except Exception as e:
            logger.warning("pypdfium2 OCR failed, trying pdf2image: %s", e)

        try:
            from pdf2image import convert_from_bytes, pdfinfo_from_bytes
            import pytesseract
            try:
                info = pdfinfo_from_bytes(file_bytes, userpw=password)
                total_pages = int(info.get("Pages", 1))
            except Exception:
                total_pages = 1
            for p_num in range(1, total_pages + 1):
                page_imgs = convert_from_bytes(file_bytes, dpi=200, userpw=password, first_page=p_num, last_page=p_num)
                for img in page_imgs:
                    text = pytesseract.image_to_string(img, lang="tha+eng")
                    if text.strip():
                        ocr_pages.append(text)
                del page_imgs
        except Exception as e2:
            logger.error("pdf2image OCR failed: %s", e2)
        return ocr_pages

    def _save_statement_session(
        self,
        filename: str,
        is_encrypted: bool,
        account_info: Dict[str, Any],
        transactions: List[Dict[str, Any]],
        flow_data: Dict[str, Any],
        file_bytes: bytes
    ) -> Dict[str, Any]:
        """Save statement analysis session metadata, transactions, binary copy, and update index."""
        session_id = f"STMT_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        now_iso = datetime.datetime.now().isoformat()

        session_data = {
            "status": "success",
            "session_id": session_id,
            "filename": filename,
            "uploaded_at": now_iso,
            "is_encrypted": is_encrypted,
            "account_info": account_info,
            "total_transactions": len(transactions),
            "summary": flow_data["summary"],
            "counterparty_flows": flow_data["counterparties"],
            "suspicious_flags": flow_data["suspicious_flags"],
            "transactions": transactions[:200]  # Store top 200 sample transactions
        }

        # Save session file
        session_file = os.path.join(self.storage_dir, f"{session_id}.json")
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session_data, f, ensure_ascii=False, indent=2)

        # Save binary copy
        ext = os.path.splitext(filename)[1] or ".pdf"
        saved_path = os.path.join(self.storage_dir, f"{session_id}{ext}")
        with open(saved_path, "wb") as f:
            f.write(file_bytes)

        # Update index
        self._update_index(
            session_id=session_id,
            filename=filename,
            bank_name=account_info.get("bank_name", "UNKNOWN"),
            account_number=account_info.get("account_number", "UNKNOWN"),
            account_holder=account_info.get("account_holder", "UNKNOWN"),
            total_txns=len(transactions),
            inflow_amount=flow_data["summary"]["total_inflow"],
            outflow_amount=flow_data["summary"]["total_outflow"],
            uploaded_at=now_iso
        )

        return session_data

    def _parse_statement_table_grid(
        self,
        raw_rows: List[List[Any]],
        filename: str
    ) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Parse structured table rows from Excel or CSV statement."""
        DATE_SYNONYMS = ["วันที่", "date", "txn_date", "posting_date", "transaction_date", "วัน/เวลา", "datetime"]
        TIME_SYNONYMS = ["เวลา", "time", "txn_time"]
        WITHDRAW_SYNONYMS = ["ถอน", "ถอนเงิน", "debit", "withdrawal", "จำนวนเงินถอน", "ยอดเงินออก", "เงินออก", "จ่าย"]
        DEPOSIT_SYNONYMS = ["ฝาก", "ฝากเงิน", "credit", "deposit", "จำนวนเงินฝาก", "ยอดเงินเข้า", "เงินเข้า", "รับเงิน", "รับโอน"]
        AMOUNT_SYNONYMS = ["จำนวนเงิน", "ยอดเงิน", "amount", "txn_amount", "ยอดทำรายการ"]
        BALANCE_SYNONYMS = ["คงเหลือ", "ยอดคงเหลือ", "balance", "ledger_balance", "outstanding_balance", "ยอดเงินคงเหลือ"]
        CHANNEL_SYNONYMS = ["ช่องทาง", "รหัส", "code", "channel", "service", "txn_code", "ประเภท"]
        DESC_SYNONYMS = ["รายการ", "คำอธิบาย", "รายละเอียด", "คู่โอน", "บัญชีคู่โอน", "description", "particulars", "remarks", "remark", "counterparty", "ชื่อบัญชี"]

        scan_limit = min(20, len(raw_rows))
        header_row_idx = -1
        best_score = 0
        col_map: Dict[str, int] = {}
        header_text_accumulator: List[str] = [filename]

        for r_idx in range(scan_limit):
            row = raw_rows[r_idx]
            if not row or not any(row):
                continue

            r_text = " ".join(str(c or "") for c in row)
            header_text_accumulator.append(r_text)

            cur_map: Dict[str, int] = {}
            score = 0
            for c_idx, cell in enumerate(row):
                if cell is None:
                    continue
                val = str(cell).strip().lower().replace(" ", "_").replace("-", "_")
                if not val:
                    continue

                if "date" not in cur_map and any(k in val for k in DATE_SYNONYMS):
                    cur_map["date"] = c_idx
                    score += 2
                elif "time" not in cur_map and any(k in val for k in TIME_SYNONYMS):
                    cur_map["time"] = c_idx
                    score += 1
                elif "withdraw" not in cur_map and (any(k in val for k in WITHDRAW_SYNONYMS) or val in ["dr", "out"]):
                    cur_map["withdraw"] = c_idx
                    score += 2
                elif "deposit" not in cur_map and (any(k in val for k in DEPOSIT_SYNONYMS) or val in ["cr", "in"]):
                    cur_map["deposit"] = c_idx
                    score += 2
                elif "amount" not in cur_map and any(k in val for k in AMOUNT_SYNONYMS):
                    cur_map["amount"] = c_idx
                    score += 1
                elif "balance" not in cur_map and any(k in val for k in BALANCE_SYNONYMS):
                    cur_map["balance"] = c_idx
                    score += 1
                elif "channel" not in cur_map and any(k in val for k in CHANNEL_SYNONYMS):
                    cur_map["channel"] = c_idx
                    score += 1
                elif "desc" not in cur_map and any(k in val for k in DESC_SYNONYMS):
                    cur_map["desc"] = c_idx
                    score += 1

            if score > best_score and score >= 2:
                best_score = score
                header_row_idx = r_idx
                col_map = cur_map

        if header_row_idx == -1 or not col_map or "date" not in col_map:
            # Fallback: take row 0 as header
            header_row_idx = 0

        # Extract account info from header lines
        header_blob = "\n".join(header_text_accumulator[:header_row_idx + 1])
        account_info = self._extract_account_header(header_blob, filename)

        transactions: List[Dict[str, Any]] = []
        d_idx = col_map.get("date", 0)
        t_idx = col_map.get("time")
        w_idx = col_map.get("withdraw")
        dep_idx = col_map.get("deposit")
        amt_idx = col_map.get("amount")
        bal_idx = col_map.get("balance")
        ch_idx = col_map.get("channel")
        desc_idx = col_map.get("desc")

        for r_idx in range(header_row_idx + 1, len(raw_rows)):
            row = raw_rows[r_idx]
            if not row or not any(row):
                continue

            dt_val = str(row[d_idx] or "").strip() if d_idx < len(row) else ""
            if not dt_val or not re.search(r'\d', dt_val):
                continue

            tm_val = str(row[t_idx] or "").strip() if (t_idx is not None and t_idx < len(row)) else ""
            
            # Amount & Type calculation
            amount = 0.0
            txn_type = "OUT"
            type_label = "รายการเดินบัญชี"

            w_raw = str(row[w_idx] or "").replace(",", "").strip() if (w_idx is not None and w_idx < len(row)) else ""
            dep_raw = str(row[dep_idx] or "").replace(",", "").strip() if (dep_idx is not None and dep_idx < len(row)) else ""

            w_amt = 0.0
            dep_amt = 0.0
            try:
                w_amt = float(w_raw) if w_raw else 0.0
            except Exception:
                w_amt = 0.0
            try:
                dep_amt = float(dep_raw) if dep_raw else 0.0
            except Exception:
                dep_amt = 0.0

            if dep_amt > 0:
                amount = dep_amt
                txn_type = "IN"
                type_label = "รับโอนเงิน (Inflow)"
            elif w_amt > 0:
                amount = w_amt
                txn_type = "OUT"
                type_label = "โอนเงินออก (Outflow)"
            elif amt_idx is not None and amt_idx < len(row):
                amt_raw = str(row[amt_idx] or "").replace(",", "").strip()
                try:
                    raw_val = float(amt_raw)
                    amount = abs(raw_val)
                    if raw_val < 0 or any(k in str(row) for k in ["ถอน", "โอนไป", "out", "debit"]):
                        txn_type = "OUT"
                        type_label = "โอนเงินออก (Outflow)"
                    else:
                        txn_type = "IN"
                        type_label = "รับโอนเงิน (Inflow)"
                except Exception:
                    amount = 0.0

            if amount <= 0:
                continue

            # Balance
            balance = None
            if bal_idx is not None and bal_idx < len(row) and row[bal_idx] is not None:
                bal_raw = str(row[bal_idx]).replace(",", "").strip()
                try:
                    balance = float(bal_raw)
                except Exception:
                    balance = None

            ch_val = str(row[ch_idx] or "").strip() if (ch_idx is not None and ch_idx < len(row)) else "TRANSFER"
            desc_val = str(row[desc_idx] or "").strip() if (desc_idx is not None and desc_idx < len(row)) else f"รายการ {ch_val}"

            counterparty = self._parse_counterparty(desc_val, txn_type)

            transactions.append({
                "index": len(transactions) + 1,
                "date": dt_val,
                "time": tm_val,
                "datetime": f"{dt_val} {tm_val}".strip(),
                "code": ch_val,
                "channel": ch_val,
                "type": txn_type,
                "type_label": type_label,
                "amount": amount,
                "balance": balance,
                "description": desc_val,
                "counterparty": counterparty
            })

        return account_info, transactions

    def _extract_account_header(self, text: str, filename: str) -> Dict[str, Any]:
        """Detect bank, account holder, account number, branch, and address from statement header."""
        info = {
            "bank_name": "ธนาคารไทยพาณิชย์ (SCB)",
            "bank_code": "SCB",
            "account_number": None,
            "account_holder": None,
            "account_type": "ออมทรัพย์ (Savings)",
            "branch": None,
            "address": None,
            "period": None,
            "currency": "THB"
        }

        # Detect Bank
        for b_code, synonyms in KNOWN_BANKS.items():
            if any(syn.lower() in text.lower() for syn in synonyms):
                info["bank_code"] = b_code
                if b_code == "SCB": info["bank_name"] = "ธนาคารไทยพาณิชย์ (SCB)"
                elif b_code == "KBANK": info["bank_name"] = "ธนาคารกสิกรไทย (KBank)"
                elif b_code == "KTB": info["bank_name"] = "ธนาคารกรุงไทย (KTB)"
                elif b_code == "BAY": info["bank_name"] = "ธนาคารกรุงศรีอยุธยา (BAY)"
                elif b_code == "GSB": info["bank_name"] = "ธนาคารออมสิน (GSB)"
                elif b_code == "TTB": info["bank_name"] = "ธนาคารทหารไทยธนชาต (TTB)"
                elif b_code == "BBL": info["bank_name"] = "ธนาคารกรุงเทพ (BBL)"
                break

        # Extract Account Number (e.g. 503-428325-6, 123-4-56789-0, or 9876543210)
        acc_match = re.search(r'(?:เลขที่บัญชี|เลขบัญชี|Account\s*No\.?|A/C\s*No\.?)\s*[:\.]?\s*([\d\-\s]{10,18})', text, re.IGNORECASE)
        if acc_match:
            cand_acc = acc_match.group(1).strip()
            if 10 <= len(re.sub(r'\D', '', cand_acc)) <= 15:
                info["account_number"] = cand_acc

        if not info["account_number"]:
            # Fallback pattern for account numbers with hyphens or 10-12 digits
            raw_acc = re.search(r'\b(\d{3}[\-]\d{1,2}[\-]\d{5,6}[\-]\d|\d{3}[\-]\d{6,7}[\-]\d|\d{10,12})\b', text)
            if raw_acc:
                info["account_number"] = raw_acc.group(1)

        # Extract Account Holder Name
        name_match = re.search(r'(?:ชื่อ\s*[\-\–]?\s*สกุล|ชื่อบัญชี|Account\s*Name|Name)\s*[:\.]?\s*([^\n\r]+)', text, re.IGNORECASE)
        if name_match:
            cand = name_match.group(1).strip()
            # Clean unwanted tokens
            cand = re.split(r'(?:STATEMENT|ที่อยู่|Address|เลขที่บัญชี|Account)', cand)[0].strip()
            cand = re.sub(r'\s*(?:เพศ\s*(?:ชาย|หญิง)|สัญชาติ\s*\S+|เชื้อชาติ\s*\S+).*$', '', cand).strip()
            if len(cand) >= 3 and not cand.startswith("STATEMENT"):
                info["account_holder"] = cand

        # Extract Branch
        branch_match = re.search(r'(?:สาขา|Branch)\s*[:\.]?\s*([^\n\r]+)', text, re.IGNORECASE)
        if branch_match:
            b_cand = branch_match.group(1).strip()
            b_cand = re.split(r'(?:ใบแจ้ง|STATEMENT|ชื่อ)', b_cand)[0].strip()
            if b_cand:
                info["branch"] = b_cand

        # Extract Address
        addr_match = re.search(r'(?:ที่อยู่|Address)\s*[:\.]?\s*(.*?)(?=\s+(?:วันที่|Date|หน้า|Page|Date\s+Time))', text, re.DOTALL | re.IGNORECASE)
        if addr_match:
            info["address"] = " ".join(addr_match.group(1).split())

        # Extract Date Period
        period_match = re.search(r'(?:วันที่|Date|Period)\s*[:\.]?\s*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}\s*[\-\–]\s*\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})', text)
        if period_match:
            info["period"] = period_match.group(1).strip()

        return info

    def _extract_transactions(self, full_text: str, table_rows: List[List[Any]]) -> List[Dict[str, Any]]:
        """Parse structured rows of transactions from PDF tables with 1-to-1 description alignment."""
        transactions = []
        
        # 1. Primary: Extract from structured table columns (pdfplumber)
        for row in table_rows:
            if not row or len(row) < 7 or not row[0]:
                continue
            
            # Check if this row contains multi-line transactions
            col0 = str(row[0])
            if "BALANCE BROUGHT" in col0 or "ยอดเงินคงเหลือ" in col0 or re.search(r'\d{1,2}/\d{1,2}/\d{2,4}', col0):
                col0_lines = [l.strip() for l in col0.split("\n") if l.strip()]
                col5_lines = [l.strip() for l in (str(row[5]) if row[5] else "").split("\n") if l.strip()]
                col6_lines = [l.strip() for l in (str(row[6]) if row[6] else "").split("\n") if l.strip()]

                tx_lines = [l for l in col0_lines if not ("BALANCE BROUGHT" in l or "ยอดเงินคงเหลือยกมา" in l)]
                
                for i, t_line in enumerate(tx_lines):
                    # Match "01/04/26 00:24 X2 ENET 200.00"
                    m = re.search(r'(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+([A-Z0-9]+)\s+([A-Z0-9]+)\s+([\d,]+\.\d{2})', t_line)
                    if m:
                        dt = m.group(1)
                        tm = m.group(2)
                        code = m.group(3)
                        channel = m.group(4)
                        amount = float(m.group(5).replace(",", ""))

                        # SCB / Thai bank code rules: X1 = Credit (IN), X2 = Debit (OUT)
                        if code == "X1" or code.startswith("CR"):
                            txn_type = "IN"
                            type_label = "รับโอนเงิน (Inflow)"
                        elif code == "X2" or code.startswith("DR"):
                            txn_type = "OUT"
                            type_label = "โอนเงินออก (Outflow)"
                        else:
                            txn_type = "OUT" if "โอนไป" in t_line else "IN"
                            type_label = "รายการเดินบัญชี"

                        desc = col6_lines[i] if i < len(col6_lines) else ""
                        bal_str = col5_lines[i + 1] if (i + 1) < len(col5_lines) else (col5_lines[i] if i < len(col5_lines) else None)
                        balance = float(bal_str.replace(",", "")) if bal_str and re.match(r'^[\d,]+\.\d{2}$', bal_str) else None

                        counterparty = self._parse_counterparty(desc, txn_type)

                        transactions.append({
                            "index": len(transactions) + 1,
                            "date": dt,
                            "time": tm,
                            "datetime": f"{dt} {tm}",
                            "code": code,
                            "channel": channel,
                            "type": txn_type,
                            "type_label": type_label,
                            "amount": amount,
                            "balance": balance,
                            "description": desc or f"รายการ {channel} ({code})",
                            "counterparty": counterparty
                        })

        if transactions:
            return transactions

        # 2. Fallback: Text Regex Extraction
        txn_pattern = re.compile(
            r'(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+([A-Z0-9]+)\s+([A-Z0-9]+)\s+([\d,]+\.\d{2})',
            re.MULTILINE
        )
        matches = list(txn_pattern.finditer(full_text))
        desc_lines = [l.strip() for l in full_text.split("\n") if any(k in l for k in ["รับโอนจาก", "โอนไป", "PromptPay", "เติมเงิน", "รายการผ่าน", "โอนเงิน"])]

        for idx, m in enumerate(matches):
            dt, tm, code, channel = m.group(1), m.group(2), m.group(3), m.group(4)
            amount = float(m.group(5).replace(",", ""))
            txn_type = "IN" if (code == "X1" or code.startswith("CR")) else "OUT"
            desc = desc_lines[idx] if idx < len(desc_lines) else ""
            counterparty = self._parse_counterparty(desc, txn_type)

            transactions.append({
                "index": idx + 1,
                "date": dt,
                "time": tm,
                "datetime": f"{dt} {tm}",
                "code": code,
                "channel": channel,
                "type": txn_type,
                "type_label": "รับโอนเงิน (Inflow)" if txn_type == "IN" else "โอนเงินออก (Outflow)",
                "amount": amount,
                "balance": None,
                "description": desc or f"รายการ {channel} ({code})",
                "counterparty": counterparty
            })

        return transactions

    def _parse_counterparty(self, desc: str, txn_type: str) -> Dict[str, Any]:
        """Extract counterparty bank, masked account, and counterparty person/org name."""
        cp = {
            "name": None,
            "bank": None,
            "account_mask": None,
            "direction": txn_type,
            "raw": desc
        }
        if not desc:
            return cp

        # 1. Pattern: "รับโอนจาก KBANK x8745 นาย อัมรินทร์ บุญขาว"
        m_in = re.search(r'รับโอนจาก\s+([A-Za-z0-9]+)\s+([xX\d]+)\s*(.*)', desc)
        if m_in:
            cp["bank"] = m_in.group(1).upper()
            cp["account_mask"] = m_in.group(2)
            cp["name"] = m_in.group(3).strip()
            cp["direction"] = "IN"
            return cp

        # 2. Pattern: "โอนไป GSB x1977 นาย วิทูร สมศรี"
        m_out = re.search(r'โอนไป\s+([A-Za-z0-9]+)\s+([xX\d]+)\s*(.*)', desc)
        if m_out:
            cp["bank"] = m_out.group(1).upper()
            cp["account_mask"] = m_out.group(2)
            cp["name"] = m_out.group(3).strip()
            cp["direction"] = "OUT"
            return cp

        # 3. Pattern: "PromptPay x1560 น.ส.นริษรา สีทา"
        m_pp = re.search(r'PromptPay\s+([xX\d]+)\s*(.*)', desc, re.IGNORECASE)
        if m_pp:
            cp["bank"] = "PROMPTPAY"
            cp["account_mask"] = m_pp.group(1)
            cp["name"] = m_pp.group(2).strip()
            return cp

        # 4. Pattern: "เติมเงิน WIDx1398/K Plus W"
        m_topup = re.search(r'เติมเงิน\s+([^\s]+)', desc)
        if m_topup:
            cp["bank"] = "WALLET"
            cp["account_mask"] = m_topup.group(1)
            cp["name"] = "เติมเงินกระเป๋าอิเล็กทรอนิกส์ / Wallet"
            return cp

        return cp

    def _aggregate_financial_flows(self, account_info: Dict[str, Any], transactions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Aggregate transaction statistics, counterparties ranking, and detect suspicious patterns."""
        total_inflow = 0.0
        total_outflow = 0.0
        inflow_count = 0
        outflow_count = 0

        cp_map: Dict[str, Dict[str, Any]] = {}
        suspicious_flags = []

        for t in transactions:
            amt = t.get("amount", 0.0)
            t_type = t.get("type", "IN")
            cp = t.get("counterparty", {})
            cp_name = cp.get("name") or cp.get("raw") or "ไม่ระบุคู่โอน"
            cp_bank = cp.get("bank") or "UNKNOWN"
            cp_acc = cp.get("account_mask") or ""

            if t_type == "IN":
                total_inflow += amt
                inflow_count += 1
            else:
                total_outflow += amt
                outflow_count += 1

            # Large transaction flag (>= 10,000 THB)
            if amt >= 10000.0:
                suspicious_flags.append({
                    "type": "LARGE_TRANSACTION",
                    "amount": amt,
                    "date": t.get("datetime"),
                    "direction": t_type,
                    "counterparty": cp_name,
                    "description": f"รายการเงินโอนยอดสูงผิดปกติ: {amt:,.2f} บาท ({cp_name})"
                })

            # Counterparty aggregation key
            cp_key = f"{cp_name}_{cp_bank}_{cp_acc}".strip("_")
            if cp_key not in cp_map:
                cp_map[cp_key] = {
                    "key": cp_key,
                    "name": cp_name,
                    "bank": cp_bank,
                    "account_mask": cp_acc,
                    "inflow_amount": 0.0,
                    "inflow_count": 0,
                    "outflow_amount": 0.0,
                    "outflow_count": 0,
                    "total_amount": 0.0,
                    "total_count": 0,
                    "last_transaction": t.get("datetime")
                }

            if t_type == "IN":
                cp_map[cp_key]["inflow_amount"] += amt
                cp_map[cp_key]["inflow_count"] += 1
            else:
                cp_map[cp_key]["outflow_amount"] += amt
                cp_map[cp_key]["outflow_count"] += 1

            cp_map[cp_key]["total_amount"] += amt
            cp_map[cp_key]["total_count"] += 1

            # Store itemized transaction record
            if "transactions" not in cp_map[cp_key]:
                cp_map[cp_key]["transactions"] = []
            cp_map[cp_key]["transactions"].append({
                "date": t.get("date"),
                "time": t.get("time"),
                "datetime": t.get("datetime"),
                "type": "inflow" if t_type == "IN" else "outflow",
                "direction": "IN" if t_type == "IN" else "OUT",
                "amount": amt,
                "channel": t.get("channel"),
                "description": t.get("description"),
                "balance": t.get("balance"),
                "counterparty_name": cp_name,
                "counterparty_account": cp_acc,
                "counterparty_bank": cp_bank
            })

        # Sort counterparties by total transaction volume
        sorted_cps = sorted(cp_map.values(), key=lambda x: x["total_amount"], reverse=True)

        return {
            "summary": {
                "total_inflow": round(total_inflow, 2),
                "inflow_count": inflow_count,
                "total_outflow": round(total_outflow, 2),
                "outflow_count": outflow_count,
                "net_change": round(total_inflow - total_outflow, 2),
                "total_transactions": len(transactions),
                "unique_counterparties": len(sorted_cps)
            },
            "counterparties": sorted_cps,
            "suspicious_flags": suspicious_flags
        }

    def _update_index(
        self,
        session_id: str,
        filename: str,
        bank_name: str,
        account_number: str,
        account_holder: str,
        total_txns: int,
        inflow_amount: float,
        outflow_amount: float,
        uploaded_at: str
    ):
        index = []
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    index = json.load(f)
            except Exception:
                index = []

        index.insert(0, {
            "session_id": session_id,
            "filename": filename,
            "bank_name": bank_name,
            "account_number": account_number,
            "account_holder": account_holder,
            "total_txns": total_txns,
            "inflow_amount": inflow_amount,
            "outflow_amount": outflow_amount,
            "uploaded_at": uploaded_at
        })

        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

    def get_all_sessions(self) -> List[Dict[str, Any]]:
        """List all stored bank statement analysis sessions."""
        if not os.path.exists(self.index_file):
            return []
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def get_session_detail(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full structured analysis of a specific Statement session."""
        session_path = os.path.join(self.storage_dir, f"{session_id}.json")
        if not os.path.exists(session_path):
            return None
        try:
            with open(session_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading Statement session {session_id}: {e}")
            return None

    def delete_session(self, session_id: str) -> bool:
        """Delete a single Statement session and its files."""
        session_path = os.path.join(self.storage_dir, f"{session_id}.json")
        pdf_path = os.path.join(self.storage_dir, f"{session_id}.pdf")
        deleted = False
        for p in [session_path, pdf_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                    deleted = True
                except Exception as e:
                    logger.error(f"Failed to delete {p}: {e}")

        # Update index
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    index = json.load(f)
                index = [s for s in index if s.get("session_id") != session_id]
                with open(self.index_file, "w", encoding="utf-8") as f:
                    json.dump(index, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.error(f"Error updating statement index: {e}")
        return deleted

    def clear_all_sessions(self) -> int:
        """Clear all stored Statement sessions."""
        count = 0
        if os.path.exists(self.storage_dir):
            for fn in os.listdir(self.storage_dir):
                if fn.endswith((".json", ".pdf")):
                    try:
                        os.remove(os.path.join(self.storage_dir, fn))
                        count += 1
                    except Exception:
                        pass
        return count

    def get_all_active_financial_flows(self) -> List[Dict[str, Any]]:
        """Aggregate bank accounts and money transfers across all stored Statement sessions for i2 Graph."""
        accounts_map: Dict[str, Dict[str, Any]] = {}
        if not os.path.exists(self.storage_dir):
            return []

        for fn in os.listdir(self.storage_dir):
            if fn.endswith(".json") and fn != "statement_index.json":
                try:
                    with open(os.path.join(self.storage_dir, fn), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    acc_info = data.get("account_info", {})
                    acc_num = acc_info.get("account_number") or data.get("session_id")
                    
                    period = acc_info.get("period") or ""
                    txns = data.get("transactions", [])
                    if acc_num not in accounts_map:
                        accounts_map[acc_num] = {
                            "account_number": acc_num,
                            "bank_name": acc_info.get("bank_name"),
                            "bank_code": acc_info.get("bank_code"),
                            "account_holder": acc_info.get("account_holder"),
                            "branch": acc_info.get("branch"),
                            "address": acc_info.get("address"),
                            "period": period,
                            "statement_period": period,
                            "total_inflow": data.get("summary", {}).get("total_inflow", 0.0),
                            "total_outflow": data.get("summary", {}).get("total_outflow", 0.0),
                            "transactions": list(txns),
                            "counterparties": {}
                        }
                    else:
                        accounts_map[acc_num]["total_inflow"] += data.get("summary", {}).get("total_inflow", 0.0)
                        accounts_map[acc_num]["total_outflow"] += data.get("summary", {}).get("total_outflow", 0.0)
                        if period and not accounts_map[acc_num].get("period"):
                            accounts_map[acc_num]["period"] = period
                            accounts_map[acc_num]["statement_period"] = period
                        accounts_map[acc_num].setdefault("transactions", []).extend(txns)

                    # Merge counterparties
                    for cp in data.get("counterparty_flows", []):
                        cp_key = cp.get("key")
                        if cp_key:
                            if cp_key not in accounts_map[acc_num]["counterparties"]:
                                accounts_map[acc_num]["counterparties"][cp_key] = dict(cp)
                            else:
                                accounts_map[acc_num]["counterparties"][cp_key]["inflow_amount"] += cp.get("inflow_amount", 0.0)
                                accounts_map[acc_num]["counterparties"][cp_key]["inflow_count"] += cp.get("inflow_count", 0)
                                accounts_map[acc_num]["counterparties"][cp_key]["outflow_amount"] += cp.get("outflow_amount", 0.0)
                                accounts_map[acc_num]["counterparties"][cp_key]["outflow_count"] += cp.get("outflow_count", 0)
                                accounts_map[acc_num]["counterparties"][cp_key]["total_amount"] += cp.get("total_amount", 0.0)
                                accounts_map[acc_num]["counterparties"][cp_key]["total_count"] += cp.get("total_count", 0)
                                accounts_map[acc_num]["counterparties"][cp_key].setdefault("transactions", []).extend(cp.get("transactions", []))
                except Exception as err:
                    logger.error(f"Error loading statement session {fn}: {err}")
                    continue

        results = []
        for acc_num, acc_data in accounts_map.items():
            acc_copy = dict(acc_data)
            acc_copy["counterparties"] = list(acc_copy["counterparties"].values())
            results.append(acc_copy)

        return results
