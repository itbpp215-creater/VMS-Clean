"""
Auto Link Network Engine for nas-bot-service (BPP-VMS)
-------------------------------------------------------
Automatically discovers relationships between suspect dossiers by scanning:
1. Document text (PDFs, text files, notes, behavior)
2. 13-digit Thai ID Cards (exact match)
3. Phone numbers (normalized match)
4. Full suspect names (exact/segmented regex match)

Guarantees:
- Accurate, localized evidence snippets around each individual suspect (no generic header fallbacks)
- Granular, role-specific relationship labels (ผู้สั่งการ, รับจ้างวางยาบ้า, ดูแลจุดพัก, รายการส่งมอบ, etc.)
- Automatic cleanup of stray quotation marks and punctuation in names
- Persists bidirectional active links directly via DossierVaultManager.link_two_dossiers()
"""

import os
import re
import json
import logging
from typing import Dict, Any, List, Optional, Set, Tuple
from pathlib import Path

logger = logging.getLogger("nas-bot.auto_link_network")

try:
    import pypdf
except ImportError:
    pypdf = None


def normalize_digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_phone(value: Any) -> str:
    digits = normalize_digits(value)
    if len(digits) == 11 and digits.startswith("66"):
        return "0" + digits[2:]
    return digits


def clean_name_str(value: Any) -> str:
    """Strip title prefixes, whitespace, quotes, and punctuation."""
    text = str(value or "").strip()
    # Strip common quotes / brackets
    text = text.strip(" \t\n\r\"'”’“‘()[]{}")
    # Strip Thai title prefixes
    cleaned = re.sub(r"^(?:นาย|นางสาว|น\.ส\.|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)\s*", "", text).strip()
    cleaned = cleaned.strip(" \t\n\r\"'”’“‘()[]{}")
    return cleaned


def is_gibberish_text(text: str) -> bool:
    """Detect if text extracted from PDF is corrupted/unreadable font glyph encoding."""
    if not text or len(text.strip()) < 10:
        return False
    thai_chars = sum(1 for c in text if '\u0e00' <= c <= '\u0e7f')
    strange_chars = sum(1 for c in text if c in r'$^~{}[]\|`_#*')
    if thai_chars < 5 and strange_chars >= 3:
        return True
    if len(text) > 20 and (strange_chars / len(text)) > 0.05:
        return True
    return False


def extract_text_from_pdf(pdf_path: str) -> List[Tuple[int, str]]:
    """Extract page number and text for each page in a PDF file."""
    pages = []
    if not pypdf or not os.path.isfile(pdf_path):
        return pages
    try:
        reader = pypdf.PdfReader(pdf_path)
        for idx, page in enumerate(reader.pages):
            txt = page.extract_text() or ""
            if txt.strip() and not is_gibberish_text(txt):
                pages.append((idx + 1, txt))
    except Exception as e:
        logger.warning(f"Error reading PDF {pdf_path}: {e}")
    return pages


def classify_context_reason(snippet: str, source_name: str, match_type: str, match_value: str) -> Tuple[int, str]:
    """
    Analyzes snippet and returns (priority_score, reason_label).
    Higher priority scores represent more specific roles.
    """
    ctx = snippet.replace("\n", " ")

    # 1. ผู้สั่งการ / หัวหน้าขบวนการ (Score 100)
    if any(k in ctx for k in ["ผู้สั่งการ", "ผู้สั+งการ", "สั่งการ", "สั+งการ", "ตัวการ", "ผู้บงการ", "หัวหน้า"]):
        return 100, "ผู้สั่งการ (เครือข่ายยาเสพติด)"

    # 2. รับจ้างวางยาบ้า / นำยาไปวาง (Score 95)
    if any(k in ctx for k in ["รับจ้างนำยา", "รับจ้างนํายา", "นำยาบ้าไปวาง", "นํายาบ้าไปวาง", "ไปวางตามจุด", "วางยาบ้า", "วางของ", "วางส่ง"]):
        return 95, "รับจ้างวางยาบ้า (เครือข่าย)"

    # 3. ดูแลจุดพักสินค้า / ซุกซ่อนยา (Score 90)
    if any(k in ctx for k in ["พักสินค้า", "จุดพัก", "ซุกซ่อน", "เก็บยาบ้า", "รอเก็บยาบ้า", "แหล่งซุกซ่อน"]):
        return 90, "ดูแลจุดพัก/ซุกซ่อนยาเสพติด"

    # 4. นักบินส่งยา (Score 85)
    if "นักบิน" in ctx:
        return 85, "เครือข่ายนักบินส่งยา"

    # 5. รายการส่งมอบยาเสพติด (Score 80)
    if any(k in ctx for k in ["ส่งมอบยา", "รับยาบ้า", "ส่งยาบ้า", "ส่งมอบยาเสพติด", "รายการส่งมอบ", "ซื(อยาบ้า", "ซื้อยาบ้า"]):
        return 80, "รายการส่งมอบยาเสพติด"

    # 6. ธุรกรรมทางการเงิน / บัญชีที่เกี่ยวข้อง (Score 75)
    if any(k in ctx for k in ["โอนเงิน", "ค่ายาเสพติด", "ยอดเงิน", "ธนาคาร", "สลิป", "เลขบัญชี", "เลขที+บัญชี", "ชื+อบัญชี", "ชื่อบัญชี"]):
        return 75, "ธุรกรรมทางการเงิน / บัญชีที่เกี่ยวข้อง"

    # 7. คู่สมรส / ครอบครัว (Score 70)
    if any(k in ctx for k in ["สามี", "ภรรยา", "คู่สมรส", "ลูกชาย", "ลูกสาว", "บิดา", "มารดา"]):
        return 70, "คู่สมรส / ครอบครัว"

    # 8. เครือข่ายรับ/ส่งพัสดุ (Score 65)
    if any(k in ctx for k in ["พัสดุ", "Flash", "Kerry", "ส่งพัสดุ"]):
        return 65, "เครือข่ายรับ/ส่งพัสดุ"

    # 9. ถูกจับกุม / ของกลาง / ยาเสพติด (Score 50)
    if any(k in ctx for k in ["ยาบ้า", "ยาเสพติด", "มัด", "ถุง", "เม็ด", "จับกุม", "ของกลาง", "เครือข่าย", "หลบหนีคดี"]):
        return 50, "เครือข่ายผู้ค้ายาเสพติด"

    # 10. Fallback ตามประเภท match
    if match_type == "id_card":
        return 20, f"พบเลขบัตรประชาชน {match_value} ในเอกสาร"
    elif match_type == "phone":
        return 15, f"พบเบอร์โทร {match_value} ในเอกสาร"
    return 10, "ความสัมพันธ์ตามเอกสาร"


class AutoLinkNetworkEngine:
    def __init__(self, dossier_manager: Any):
        self.dossier_manager = dossier_manager
        self.dossiers_dir = getattr(dossier_manager, "dossiers_dir", "")
        if not self.dossiers_dir and hasattr(dossier_manager, "root_path"):
            self.dossiers_dir = os.path.join(dossier_manager.root_path, "Dossiers")

    def build_lookup_index(self) -> Tuple[Dict[str, str], Dict[str, str], List[Tuple[str, str, str]]]:
        """
        Build fast reverse-lookup maps:
        - id_to_dossier: {13_digit_id: dossier_id}
        - phone_to_dossier: {phone: dossier_id}
        - name_targets: [(dossier_id, clean_name, suspect_name)]
        """
        id_to_dossier: Dict[str, str] = {}
        phone_to_dossier: Dict[str, str] = {}
        name_targets: List[Tuple[str, str, str]] = []

        for summary in self.dossier_manager.get_all_dossiers():
            d_id = str(summary.get("dossier_id") or "")
            if not d_id or "ไม่ระบุ" in d_id or "ไม่ทราบ" in d_id:
                continue

            # ID Card
            card = normalize_digits(summary.get("id_card"))
            if len(card) == 13:
                id_to_dossier[card] = d_id

            # Phones
            ph = normalize_phone(summary.get("phone_number"))
            if ph and len(ph) in (9, 10):
                phone_to_dossier[ph] = d_id
            for p_alias in (summary.get("phones") or []):
                p_norm = normalize_phone(p_alias)
                if p_norm and len(p_norm) in (9, 10):
                    phone_to_dossier[p_norm] = d_id

            # Names (exclude generic titles and very short strings)
            s_name = clean_name_str(summary.get("suspect_name") or "")
            if len(s_name) >= 4 and "ไม่ทราบ" not in s_name and "ไม่ระบุ" not in s_name:
                name_targets.append((d_id, s_name, str(summary.get("suspect_name") or "")))

        return id_to_dossier, phone_to_dossier, name_targets

    def scan_dossier_and_link(self, current_dossier_id: str) -> List[Dict[str, Any]]:
        """Scan a single dossier's files and metadata for cross-references to other dossiers."""
        if not current_dossier_id or "ไม่ระบุ" in current_dossier_id or "ไม่ทราบ" in current_dossier_id:
            return []

        profile = self.dossier_manager.get_dossier_detail(current_dossier_id)
        if not profile:
            return []

        id_map, phone_map, name_targets = self.build_lookup_index()
        linked_events: List[Dict[str, Any]] = []

        dossier_folder = os.path.join(self.dossiers_dir, current_dossier_id)
        personal_folder = os.path.join(dossier_folder, "Personal")

        # 1. Collect all text sources from profile
        text_sources: List[Tuple[str, str]] = []  # (source_label, text)
        if profile.get("notes"):
            text_sources.append(("notes", str(profile["notes"])))
        if profile.get("behavior"):
            text_sources.append(("behavior", str(profile["behavior"])))
        if profile.get("address"):
            text_sources.append(("address", str(profile["address"])))

        # 2. Collect files in Personal folder
        if os.path.isdir(personal_folder):
            for fname in os.listdir(personal_folder):
                fpath = os.path.join(personal_folder, fname)
                if fname.lower().endswith(".pdf"):
                    pdf_pages = extract_text_from_pdf(fpath)
                    for pnum, ptext in pdf_pages:
                        if not is_gibberish_text(ptext):
                            text_sources.append((f"{fname} (หน้า {pnum})", ptext))
                elif fname.lower().endswith((".txt", ".json", ".csv")):
                    try:
                        with open(fpath, "r", encoding="utf-8", errors="ignore") as tf:
                            txt_content = tf.read()
                            if not is_gibberish_text(txt_content):
                                text_sources.append((fname, txt_content))
                    except Exception:
                        pass

        # 3. Check for matches against other dossiers across all collected sources
        for source_name, content in text_sources:
            if not content or len(content.strip()) < 5 or is_gibberish_text(content):
                continue

            # Accumulate best match per target dossier for this document
            best_target_matches: Dict[str, Dict[str, Any]] = {}

            # (A) Check 13-digit Thai ID Cards in content
            raw_ids = re.findall(r"\b\d{13}\b", content)
            cand_ids = re.findall(r"\b\d[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2}[-\s]?\d\b", content)
            for raw in set(raw_ids + cand_ids):
                clean_id = normalize_digits(raw)
                if len(clean_id) == 13 and clean_id in id_map:
                    target_id = id_map[clean_id]
                    if target_id == current_dossier_id:
                        continue

                    # Regex to find exact occurrence position
                    id_pat = (
                        re.escape(clean_id[0])
                        + r"[-\s]?"
                        + re.escape(clean_id[1:5])
                        + r"[-\s]?"
                        + re.escape(clean_id[5:10])
                        + r"[-\s]?"
                        + re.escape(clean_id[10:12])
                        + r"[-\s]?"
                        + re.escape(clean_id[12])
                    )
                    matches = list(re.finditer(id_pat, content)) or list(re.finditer(re.escape(raw), content))
                    for m in matches:
                        s_start = max(0, m.start() - 80)
                        s_end = min(len(content), m.end() + 180)
                        snippet = content[s_start:s_end].strip()
                        score, reason = classify_context_reason(snippet, source_name, "id_card", clean_id)
                        if target_id not in best_target_matches or score > best_target_matches[target_id]["score"]:
                            best_target_matches[target_id] = {
                                "score": score,
                                "reason": reason,
                                "snippet": snippet,
                                "match_type": "id_card",
                                "match_value": clean_id,
                                "source_file": source_name,
                            }

            # (B) Check Phone Numbers in content
            phone_candidates = re.findall(r"\b0[689][0-9\s-]{8,12}\b", content)
            for p_raw in set(phone_candidates):
                p_clean = normalize_phone(p_raw)
                if len(p_clean) in (9, 10) and p_clean in phone_map:
                    target_id = phone_map[p_clean]
                    if target_id == current_dossier_id:
                        continue

                    for m in re.finditer(re.escape(p_raw), content):
                        s_start = max(0, m.start() - 80)
                        s_end = min(len(content), m.end() + 180)
                        snippet = content[s_start:s_end].strip()
                        score, reason = classify_context_reason(snippet, source_name, "phone", p_clean)
                        if target_id not in best_target_matches or score > best_target_matches[target_id]["score"]:
                            best_target_matches[target_id] = {
                                "score": score,
                                "reason": reason,
                                "snippet": snippet,
                                "match_type": "phone",
                                "match_value": p_clean,
                                "source_file": source_name,
                            }

            # (C) Check Full Suspect Names in content
            for target_id, clean_name, raw_name in name_targets:
                if target_id == current_dossier_id:
                    continue

                # Build flexible whitespace pattern between name parts
                parts = clean_name.split()
                if len(parts) >= 2:
                    name_pat = re.escape(parts[0]) + r"[\s\n]*" + re.escape(" ".join(parts[1:]))
                elif len(clean_name) >= 5:
                    name_pat = re.escape(clean_name)
                else:
                    continue  # Skip ambiguous 1-word short tokens

                for m in re.finditer(name_pat, content):
                    s_start = max(0, m.start() - 80)
                    s_end = min(len(content), m.end() + 180)
                    snippet = content[s_start:s_end].strip()
                    score, reason = classify_context_reason(snippet, source_name, "name", clean_name)
                    if target_id not in best_target_matches or score > best_target_matches[target_id]["score"]:
                        best_target_matches[target_id] = {
                            "score": score,
                            "reason": reason,
                            "snippet": snippet,
                            "match_type": "name",
                            "match_value": clean_name,
                            "source_file": source_name,
                        }

            # (D) Apply all discovered best links
            for target_id, info in best_target_matches.items():
                r_type = "spouse" if any(k in info["reason"] for k in ["คู่สมรส", "สามี", "ภรรยา"]) else "network"
                ok = self.dossier_manager.link_two_dossiers(
                    current_dossier_id,
                    target_id,
                    reason=info["reason"],
                    relationship_type=r_type,
                    is_current=True,
                    status="current",
                    evidence_snippet=info["snippet"],
                    source_file=info["source_file"],
                )
                if ok:
                    linked_events.append({
                        "source": current_dossier_id,
                        "target": target_id,
                        "reason": info["reason"],
                        "match_type": info["match_type"],
                        "match_value": info["match_value"],
                        "source_file": info["source_file"],
                    })
                    logger.info(
                        f"Auto-linked {current_dossier_id} <--> {target_id} via {info['match_type']} "
                        f"({info['reason']}) [{info['source_file']}]"
                    )

        return linked_events

    def sanitize_all_dossier_names(self) -> int:
        """Strip surrounding quotes and trailing punctuation from suspect_name in all profiles."""
        fixed_count = 0
        if not os.path.isdir(self.dossiers_dir):
            return 0

        for folder_name in os.listdir(self.dossiers_dir):
            p_path = os.path.join(self.dossiers_dir, folder_name, "profile.json")
            if not os.path.isfile(p_path):
                continue
            try:
                with open(p_path, "r", encoding="utf-8") as f:
                    prof = json.load(f)
                orig_name = prof.get("suspect_name", "")
                cleaned = clean_name_str(orig_name)
                # Re-add Title prefix if originally present, but ensure quotes are removed
                if orig_name.startswith("นาย") and not cleaned.startswith("นาย"):
                    cleaned = "นาย" + cleaned
                elif orig_name.startswith("น.ส.") and not cleaned.startswith("น.ส."):
                    cleaned = "น.ส." + cleaned
                elif orig_name.startswith("นางสาว") and not cleaned.startswith("นางสาว"):
                    cleaned = "นางสาว" + cleaned
                elif orig_name.startswith("นาง") and not cleaned.startswith("นาง"):
                    cleaned = "นาง" + cleaned

                if cleaned and cleaned != orig_name:
                    prof["suspect_name"] = cleaned
                    with open(p_path, "w", encoding="utf-8") as f:
                        json.dump(prof, f, ensure_ascii=False, indent=2)
                    fixed_count += 1
            except Exception as e:
                logger.warning(f"Failed sanitizing name in {p_path}: {e}")

        if fixed_count > 0:
            self.dossier_manager.rebuild_index()
            logger.info(f"Sanitized suspect names in {fixed_count} dossiers.")
        return fixed_count

    def scan_all_dossiers(self) -> Dict[str, Any]:
        """Run batch auto-link discovery across all dossiers in the vault."""
        # Step 1: Clean dirty names first
        cleaned_names = self.sanitize_all_dossier_names()

        all_dossiers = self.dossier_manager.get_all_dossiers()
        logger.info(f"Starting batch auto-link scan across {len(all_dossiers)} dossiers...")
        total_links = 0
        all_events = []

        for summary in all_dossiers:
            d_id = str(summary.get("dossier_id") or "")
            if not d_id:
                continue
            events = self.scan_dossier_and_link(d_id)
            if events:
                total_links += len(events)
                all_events.extend(events)

        logger.info(f"Batch auto-link scan completed! Created {total_links} new bidirectional links.")
        return {
            "status": "success",
            "cleaned_names_count": cleaned_names,
            "total_dossiers_scanned": len(all_dossiers),
            "new_links_count": total_links,
            "events": all_events,
        }
