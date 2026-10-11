"""
NAS Storage Manager Module for nas-bot-service (BPP-VMS)

This module handles creating structured case folders, saving uploaded files (photos, videos,
docs, field reports), generating metadata summaries, and retrieving files from NAS storage.

It uses a Storage Abstraction Layer (NASStorageAdapter) that writes to local Docker Volume storage
by default (when no physical NAS is present), and seamlessly connects to WebDAV/SMB NAS when configured.

Inputs:
    - case_id (str): Unique case identifier (e.g. Case_20260803_001)
    - files (list): File content bytes and metadata
    - report_data (dict): Case details, GPS coordinates, officer ID
Outputs:
    - dict: Saved case info and file paths
Side effects:
    - Writes files and metadata.json to disk/storage target.
"""

import os
import re
import json
import datetime
from functools import wraps
from typing import Dict, Any, List, Optional
import logging
from services.identity_sync import IDENTITY_TRANSACTION_LOCK
from services.person_registry import PersonRegistry

logger = logging.getLogger("nas-bot.nas_manager")

# Default local storage path for emulated NAS
DEFAULT_STORAGE_ROOT = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")


def _serialize_case_person_writer(function: Any) -> Any:
    """Wrap a native Case mutation in the shared identity transaction lock.

    ``function`` accepts arbitrary manager-method inputs and returns its original result. The wrapper owns the
    process-wide re-entrant boundary before any Case or Person side effect so coordinator planning/promotion cannot
    split a related metadata-write plus registry-update sequence.
    """
    # ``wraps`` preserves method metadata, while the RLock permits nested Person Registry writers in the same save.
    @wraps(function)
    def serialized_writer(*args: Any, **kwargs: Any) -> Any:
        """Invoke one wrapped Case writer while holding the common coordinator transaction lock."""
        # Acquiring outside the original body prevents even initial folder or metadata creation during a stale plan.
        with IDENTITY_TRANSACTION_LOCK:
            return function(*args, **kwargs)

    return serialized_writer


THAI_TITLE_PREFIX_PATTERN = re.compile(
    r'^(?:'
    r'พลตำรวจ(?:เอก|โท|ตรี)|พล\.ต\.[อทต]\.?|'
    r'พันตำรวจ(?:เอก|โท|ตรี)|พ\.ต\.[อทต]\.?|'
    r'ร้อยตำรวจ(?:เอก|โท|ตรี)|ร\.ต\.[อทต]\.?|'
    r'ดาบตำรวจ|ด\.ต\.?|'
    r'จ่าสิบ(?:ตำรวจ|เอก|โท|ตรี)|จ\.ส\.[ตอท]\.?|'
    r'สิบตำรวจ(?:เอก|โท|ตรี)|ส\.ต\.[อทต]\.?|'
    r'นายตำรวจ|นายร้อยตำรวจ|นายดาบ|'
    r'พล(?:เอก|โท|ตรี)|พล\.[อทต]\.?|'
    r'พัน(?:เอก|โท|ตรี)|พ\.[อทต]\.?|'
    r'ร้อย(?:เอก|โท|ตรี)|ร\.[อทต]\.?|'
    r'สิบ(?:เอก|โท|ตรี)|ส\.[อทต]\.?|'
    r'พลทหาร|'
    r'นางสาว|น\.ส\.?|นาง(?!รอง)|นาย|'
    r'เด็กชาย|เด็กหญิง|ด\.[ชญ]\.?|'
    r'นายแพทย์|นพ\.?|แพทย์หญิง|พญ\.?|ดร\.?|อาจารย์|อ\.?|คุณ|ท่าน|'
    r'mr\.?|mrs\.?|miss|ms\.?'
    r')\s*',
    re.IGNORECASE
)


class NASStorageManager:
    """
    Manager class responsible for structuring and persisting field case reports into NAS storage.
    """

    def __init__(self, root_path: str = DEFAULT_STORAGE_ROOT):
        """
        Initialize NAS Storage Manager with target root directory.
        
        Args:
            root_path (str): Root filesystem path for storing NAS cases.
        """
        self.root_path = root_path
        os.makedirs(self.root_path, exist_ok=True)
        self.person_registry = PersonRegistry(root_path=self.root_path)
        logger.info(f"Initialized NASStorageManager at root path: {self.root_path}")

    def create_case_folder(self, case_id: str, timestamp: Optional[datetime.datetime] = None) -> str:
        """
        Create a standardized case directory structure in NAS storage:
        /NAS/Cases/YYYY/MM/Case_ID/
           ├── Photos/
           ├── Videos/
           └── Documents/

        Args:
            case_id (str): Unique identifier for the case.
            timestamp (datetime.datetime, optional): Time of case creation.

        Returns:
            str: Absolute path to created case folder.
        """
        if not timestamp:
            timestamp = datetime.datetime.now()

        year_str = timestamp.strftime("%Y")
        month_str = timestamp.strftime("%m")

        case_dir = os.path.join(self.root_path, "Cases", year_str, month_str, case_id)
        os.makedirs(os.path.join(case_dir, "Photos"), exist_ok=True)
        os.makedirs(os.path.join(case_dir, "Videos"), exist_ok=True)
        os.makedirs(os.path.join(case_dir, "Documents"), exist_ok=True)

        logger.info(f"Created NAS case folder structure at: {case_dir}")
        return case_dir

    @_serialize_case_person_writer
    def save_case_report(
        self,
        case_id: str,
        officer_username: str,
        platform: str,
        notes: str,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        files: Optional[List[Dict[str, Any]]] = None,
        suspects: Optional[List[Dict[str, Any]]] = None,
        behavior: Optional[str] = None,
        incident_location: Optional[str] = None,
        district: Optional[str] = None,
        subdistrict: Optional[str] = None,
        case_drug_quantity: Optional[int] = None,
        **kwargs: Any
    ) -> Dict[str, Any]:
        """Persist one complete Case report and return its metadata with stable Person links.

        Case identity, officer/platform data, optional location/files/suspects, and behavior are written beneath the
        configured NAS root. The method creates attachments and metadata, upserts every suspect in Person Registry,
        and rewrites metadata with linked IDs; the outer shared lock keeps that complete sequence indivisible from
        coordinator snapshots and promotions.
        """
        # Timestamp, folder creation, both metadata writes, and all nested Person upserts share one outer transaction.
        now = datetime.datetime.now()
        case_dir = self.create_case_folder(case_id, now)

        saved_files = []
        if files:
            for file_item in files:
                filename = file_item.get("filename", "attachment.bin")
                category = file_item.get("category", "Documents")  # 'Photos', 'Videos', 'Documents'
                content = file_item.get("content", b"")

                target_dir = os.path.join(case_dir, category)
                os.makedirs(target_dir, exist_ok=True)

                # Ensure non-overwriting unique filenames if file with exact name exists
                file_path = os.path.join(target_dir, filename)
                if os.path.exists(file_path):
                    base, ext = os.path.splitext(filename)
                    filename = f"{base}_{now.strftime('%H%M%S')}{ext}"
                    file_path = os.path.join(target_dir, filename)

                with open(file_path, "wb") as f:
                    f.write(content)

                saved_files.append({
                    "filename": filename,
                    "category": category,
                    "rel_path": os.path.relpath(file_path, self.root_path),
                    "size_bytes": len(content)
                })

        # Extract district, subdistrict, and contraband aggregations
        # ADR 0009: Crime scene location takes precedence over suspects' home addresses
        dist_val = district
        subdist_val = subdistrict

        address_text = incident_location or ""
        if not address_text and behavior:
            m_scene = re.search(r'สถานที่เกิดเหตุ\s*[:\.]?\s*([^\n\r]+)', behavior)
            if m_scene:
                address_text = m_scene.group(1).strip()
            else:
                address_text = behavior
        elif not address_text and notes:
            address_text = notes
        elif not address_text and suspects and suspects[0].get("address"):
            address_text = suspects[0].get("address")

        if address_text:
            if not subdist_val:
                m_sub = re.search(r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)', address_text)
                if m_sub:
                    subdist_val = m_sub.group(1).strip()
            if not dist_val:
                m_dist = re.search(r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)', address_text)
                if m_dist:
                    dist_val = m_dist.group(1).strip()

        # ADR 0009: Case total represents authentic seizure total; do not multiply joint seizures
        if case_drug_quantity is not None:
            total_drugs = int(case_drug_quantity)
        elif suspects:
            quantities = [int(s.get("drug_quantity") or 0) for s in suspects if s.get("drug_quantity")]
            if quantities:
                if len(set(quantities)) == 1 and len(quantities) > 1:
                    total_drugs = quantities[0]
                else:
                    total_drugs = sum(quantities)
            else:
                total_drugs = 0
        else:
            total_drugs = 0

        w_quantities = [int(s.get("weapon_quantity") or 0) for s in (suspects or []) if s.get("weapon_quantity")]
        if w_quantities and len(set(w_quantities)) == 1 and len(w_quantities) > 1:
            total_weapons = w_quantities[0]
        else:
            total_weapons = sum(int(s.get("weapon_quantity") or 0) for s in (suspects or []))

        total_aliens = sum(int(s.get("alien_count") or 0) for s in (suspects or []))

        # Save metadata.json summary in case root folder
        metadata = {
            "case_id": case_id,
            "officer_username": officer_username,
            "platform": platform,
            "created_at": now.isoformat(),
            "notes": notes,
            "behavior": behavior,
            "district": dist_val,
            "subdistrict": subdist_val,
            "drug_quantity": total_drugs,
            "weapon_quantity": total_weapons,
            "alien_count": total_aliens,
            "suspects": suspects or [],
            "location": {
                "lat": lat,
                "lon": lon
            },
            "files": saved_files
        }

        meta_path = os.path.join(case_dir, "metadata.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        # Sync to Person Registry for each suspect
        linked_person_ids = []
        if suspects:
            for s in suspects:
                try:
                    person_profile = self.person_registry.upsert_person(
                        case_id=case_id,
                        platform=platform,
                        officer_username=officer_username,
                        suspect_name=s.get("suspect_name"),
                        id_card=s.get("id_card"),
                        age=s.get("age"),
                        address=s.get("address"),
                        notes=notes,
                        drug_quantity=s.get("drug_quantity", 0),
                        phone_number=s.get("phone_number"),
                        role_tag=s.get("role_tag"),
                        area_tag=s.get("area_tag"),
                        behavior=behavior
                    )
                    linked_person_ids.append(person_profile.get("person_id"))
                except Exception as e:
                    logger.error(f"Failed to upsert person profile for {s.get('suspect_name')}: {e}")
                    
        metadata["linked_person_ids"] = linked_person_ids

        # Persist the completed case metadata only after person registration so the
        # durable record and API response expose the same stable person identifiers.
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, ensure_ascii=False, indent=2)

        logger.info(f"Successfully saved case report {case_id} to NAS storage with {len(saved_files)} files.")
        return metadata

    def search_cases(self, query: str) -> List[Dict[str, Any]]:
        """
        Search NAS storage for case metadata matching query string.
        Supports Thai/Arabic numerals, ID Card, suspect names, notes, location, and phone numbers.
        """
        results = []
        cases_root = os.path.join(self.root_path, "Cases")
        if not os.path.exists(cases_root):
            return results

        # Helper: convert Thai digits to Arabic digits and lowercase
        def norm(txt: str) -> str:
            if not txt:
                return ""
            trans = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
            return str(txt).translate(trans).lower()

        # Helper: extract only digits
        def digits_only(txt: str) -> str:
            return "".join(c for c in norm(txt) if c.isdigit())

        q_norm = norm(query).strip()
        clean_q = THAI_TITLE_PREFIX_PATTERN.sub('', q_norm).strip()
        q_digits = digits_only(query) if len(digits_only(query)) >= 3 else None

        # Candidate search terms (original query and prefix-stripped version)
        search_terms = [q_norm]
        if clean_q and clean_q != q_norm and len(clean_q) >= 2:
            search_terms.append(clean_q)

        for root, dirs, files in os.walk(cases_root):
            if "metadata.json" in files:
                meta_path = os.path.join(root, "metadata.json")
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        data = json.load(f)

                    case_id = data.get("case_id", "")
                    officer = data.get("officer_username", "")
                    notes = data.get("notes", "")
                    suspects = data.get("suspects", [])

                    matched = False

                    # If query is empty, return all cases
                    if not q_norm:
                        matched = True
                    else:
                        # 1. Text search across root fields (including nickname)
                        for st in search_terms:
                            if (st in norm(case_id) or
                                st in norm(officer) or
                                st in norm(notes) or
                                st in norm(data.get("suspect_name", "")) or
                                st in norm(data.get("nickname", "")) or
                                st in norm(data.get("id_card", ""))):
                                matched = True
                                break

                        # 2. Text search across nested suspects array (including nickname)
                        if not matched and suspects:
                            for s in suspects:
                                for st in search_terms:
                                    if (st in norm(s.get("suspect_name", "")) or
                                        st in norm(s.get("nickname", "")) or
                                        st in norm(s.get("id_card", "")) or
                                        st in norm(s.get("address", "")) or
                                        st in norm(s.get("phone_number", ""))):
                                        matched = True
                                        break
                                if matched:
                                    break

                        # 3. Digits search (ID card, phone number, or Thai numerals in notes/case_id)
                        if not matched and q_digits:
                            if q_digits in digits_only(notes) or q_digits in digits_only(case_id):
                                matched = True
                            elif suspects:
                                for s in suspects:
                                    if (q_digits in digits_only(s.get("id_card", "")) or
                                        q_digits in digits_only(s.get("phone_number", ""))):
                                        matched = True
                                        break

                    if matched:
                        has_photo = False
                        photos_dir = os.path.join(root, "Photos")
                        if os.path.exists(photos_dir):
                            for f_img in os.listdir(photos_dir):
                                if f_img.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                                    has_photo = True
                                    break
                        data["has_photo"] = has_photo
                        results.append(data)
                except Exception as e:
                    logger.warning(f"Failed to read metadata file at {meta_path}: {e}")

        return results

    def get_all_cases(self) -> List[Dict[str, Any]]:
        """
        Retrieve all existing NAS cases sorted by created_at descending.
        """
        cases = self.search_cases("")
        cases.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return cases

    def find_case_folder(self, case_id: str) -> Optional[str]:
        """
        Find absolute directory path of a case by case_id.
        """
        cases_root = os.path.join(self.root_path, "Cases")
        if not os.path.exists(cases_root):
            return None

        for root, dirs, files in os.walk(cases_root):
            if os.path.basename(root) == case_id:
                return root
        return None

    def get_case_files(self, case_id: str) -> Dict[str, Any]:
        """
        List all attached files in a case folder, grouped by category (Photos, Documents, Videos).
        """
        case_folder = self.find_case_folder(case_id)
        if not case_folder:
            return {"case_id": case_id, "files": {"Photos": [], "Documents": [], "Videos": []}}

        res_files = {"Photos": [], "Documents": [], "Videos": []}
        for cat in ["Photos", "Documents", "Videos"]:
            cat_dir = os.path.join(case_folder, cat)
            if os.path.exists(cat_dir):
                for f in os.listdir(cat_dir):
                    fp = os.path.join(cat_dir, f)
                    if os.path.isfile(fp):
                        stat = os.stat(fp)
                        res_files[cat].append({
                            "filename": f,
                            "category": cat,
                            "size_bytes": stat.st_size,
                            "modified_at": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat()
                        })

        return {"case_id": case_id, "files": res_files}

    def get_case_file_path(self, case_id: str, category: str, filename: str) -> Optional[str]:
        """
        Get absolute path of a specific file in a case directory.
        """
        case_folder = self.find_case_folder(case_id)
        if not case_folder:
            return None
        target = os.path.join(case_folder, category, filename)
        if os.path.exists(target) and os.path.isfile(target):
            return target
        return None

    def get_primary_photo(self, case_id: str) -> Optional[str]:
        """
        Get absolute path of the primary TR.14/photo file for a case.
        """
        case_folder = self.find_case_folder(case_id)
        if not case_folder:
            return None
        photos_dir = os.path.join(case_folder, "Photos")
        if os.path.exists(photos_dir):
            for f in os.listdir(photos_dir):
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    return os.path.join(photos_dir, f)
        return None

    @_serialize_case_person_writer
    def delete_case(self, case_id: str) -> bool:
        """Delete one Case directory and remove its Person sources under the shared lock.

        ``case_id`` selects the stored Case. The method returns whether deletion succeeded and mutates both Case
        storage and, through the nested registry cleanup, ``persons_index.json`` without coordinator interleaving.
        """
        # Discovery, directory removal, and related Person source cleanup form one coordinated mutation boundary.
        cases_root = os.path.join(self.root_path, "Cases")
        if not os.path.exists(cases_root):
            return False

        for root, dirs, files in os.walk(cases_root):
            if os.path.basename(root) == case_id:
                try:
                    import shutil
                    shutil.rmtree(root)
                    self.person_registry.remove_case_source(case_id)
                    logger.info(f"Successfully deleted NAS case folder: {root}")
                    return True
                except Exception as e:
                    logger.error(f"Failed to delete case {case_id}: {e}")
                    return False
        return False

