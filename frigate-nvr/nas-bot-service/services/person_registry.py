"""
Person Registry Service for nas-bot-service (BPP-VMS / Sloth BPP215)

Manages person-centric intelligence records, merging multi-source case data
by ID Card or Suspect Name, tracking address history, and matching address neighbors.
"""

import os
import json
import logging
import datetime
from functools import wraps
from typing import Dict, Any, List, Optional
import re

from services.identity_sync import IDENTITY_TRANSACTION_LOCK

logger = logging.getLogger("nas-bot.person_registry")

DEFAULT_STORAGE_ROOT = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")

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


def _serialize_person_registry_writer(function: Any) -> Any:
    """Wrap one Person Registry mutation in the shared identity transaction lock.

    ``function`` accepts arbitrary bound-method inputs and returns its original result. The wrapper holds the
    process-wide re-entrant lock across every read-modify-write side effect so coordinator plans cannot overwrite
    native initialization, reindex, upsert, direct index-save, or source-removal changes.
    """
    # Metadata preservation keeps decorated methods introspectable while nested registry calls safely reuse the RLock.
    @wraps(function)
    def serialized_writer(*args: Any, **kwargs: Any) -> Any:
        """Invoke the wrapped Person writer only while owning the common transaction boundary."""
        # Lock acquisition precedes all reads so each whole-index replacement is based on current committed bytes.
        with IDENTITY_TRANSACTION_LOCK:
            return function(*args, **kwargs)

    return serialized_writer


class PersonRegistry:
    """
    Manages Person Profiles, deduplication, cross-source linking, address history, and neighbor search.
    """

    @_serialize_person_registry_writer
    def __init__(self, root_path: str = DEFAULT_STORAGE_ROOT):
        """Initialize and reindex one Person store under the shared transaction boundary.

        ``root_path`` selects the NAS tree. Construction creates missing Person storage/index files and scans Case
        metadata as side effects, returning no value; the outer lock keeps the complete initial snapshot consistent.
        """
        # Directory creation and nested ensure/reindex calls form one initialization transaction through the RLock.
        self.root_path = root_path
        self.persons_dir = os.path.join(self.root_path, "Persons")
        self.index_file = os.path.join(self.persons_dir, "persons_index.json")
        os.makedirs(self.persons_dir, exist_ok=True)
        self._ensure_index()

    @_serialize_person_registry_writer
    def _ensure_index(self):
        """Create a missing Person index and reindex Case metadata, returning no value after durable writes."""
        # The lock covers the existence check through nested save/reindex calls so no coordinator plan can interleave.
        if not os.path.exists(self.index_file):
            self._save_index([])
        self.reindex_all_cases()

    @_serialize_person_registry_writer
    def reindex_all_cases(self):
        """Reindex all stored Dossiers and non-test Cases into clean Person profiles.

        Authoritative dossiers under /Dossiers/ form the baseline identity records. Valid non-test cases
        are merged by ID Card or normalized name. Junk records ('ไม่ระบุชื่อ', 'สายเบอร์...') are rejected.
        """
        now_iso = datetime.datetime.now().isoformat()
        index_entries: List[Dict[str, Any]] = []
        dossiers_root = os.path.join(self.root_path, "Dossiers")

        # 1. Primary Source: Authoritative Dossier Folders
        if os.path.exists(dossiers_root):
            for d_name in sorted(os.listdir(dossiers_root)):
                d_dir = os.path.join(dossiers_root, d_name)
                if not os.path.isdir(d_dir):
                    continue
                prof_path = os.path.join(d_dir, "profile.json")
                if not os.path.exists(prof_path):
                    continue
                try:
                    with open(prof_path, "r", encoding="utf-8") as f:
                        prof = json.load(f)
                    
                    s_name = (prof.get("suspect_name") or "").strip()
                    if not s_name or s_name == "ไม่ระบุชื่อ" or s_name.startswith("สายเบอร์"):
                        continue
                    
                    cid = (prof.get("id_card") or "").strip() or None
                    phones = prof.get("phones", []) or []
                    if prof.get("phone_number") and prof.get("phone_number") not in phones:
                        phones.insert(0, prof.get("phone_number"))
                    
                    pid = f"PERSON_{cid if cid else d_name}"
                    person = {
                        "person_id": pid,
                        "dossier_id": d_name,
                        "suspect_name": s_name,
                        "id_card": cid,
                        "age": prof.get("age"),
                        "phone_number": phones[0] if phones else None,
                        "phones": phones,
                        "role_tag": prof.get("role_tag") or "ผู้ต้องหา",
                        "area_tag": prof.get("area_tag"),
                        "address": prof.get("address"),
                        "address_history": prof.get("address_history", []),
                        "nickname": prof.get("nickname"),
                        "aliases": prof.get("aliases", []),
                        "behavior": prof.get("behavior"),
                        "notes": prof.get("notes"),
                        "personal_files": prof.get("personal_files", []),
                        "sources": [{
                            "case_id": d_name,
                            "platform": "dossier",
                            "officer_username": prof.get("officer_username", "admin"),
                            "notes": prof.get("notes") or s_name
                        }],
                        "created_at": prof.get("created_at") or now_iso,
                        "updated_at": prof.get("updated_at") or now_iso
                    }
                    index_entries.append(person)
                except Exception as e:
                    logger.warning(f"Error reading dossier profile for {d_name}: {e}")

        # 2. Secondary Source: Valid Cases (Skip test suites and dummy suspects)
        cases_root = os.path.join(self.root_path, "Cases")
        if os.path.exists(cases_root):
            for root, dirs, files in os.walk(cases_root):
                folder_name = os.path.basename(root)
                # Skip known test cases and OCR scrap folders
                if (folder_name.startswith("Case_TEST_") or 
                    folder_name.startswith("Case_img") or 
                    folder_name in {"คดีก", "คดียาเสพต", "คดีตามกฎหมายต", "รี_ร้อย_2569", "รอง_กรร_2569"}):
                    continue

                if "metadata.json" in files:
                    meta_path = os.path.join(root, "metadata.json")
                    try:
                        with open(meta_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        
                        case_id = data.get("case_id", folder_name)
                        platform = data.get("platform", "telegram")
                        officer = data.get("officer_username", "admin")
                        notes = data.get("notes", "")

                        suspects = list(data.get("suspects", []))
                        if not suspects and (data.get("suspect_name") or data.get("id_card")):
                            suspects.append({
                                "suspect_name": data.get("suspect_name"),
                                "id_card": data.get("id_card"),
                                "age": data.get("age"),
                                "address": data.get("address"),
                                "phone_number": data.get("phone_number"),
                                "drug_quantity": data.get("drug_quantity", 0)
                            })

                        for s in suspects:
                            s_name = (s.get("suspect_name") or "").strip()
                            s_id = (s.get("id_card") or "").strip()
                            if not s_name or s_name == "ไม่ระบุชื่อ" or s_name.startswith("สายเบอร์"):
                                continue

                            # Match with existing dossier person
                            matched = None
                            if s_id and len(s_id) >= 10:
                                matched = next((p for p in index_entries if p.get("id_card") == s_id), None)
                            if not matched and s_name:
                                clean_s = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', s_name).strip()
                                for p in index_entries:
                                    clean_p = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', p.get("suspect_name", "")).strip()
                                    if clean_s and clean_p and (clean_s == clean_p or clean_s in clean_p or clean_p in clean_s):
                                        matched = p
                                        break

                            if matched:
                                if not any(src.get("case_id") == case_id for src in matched.get("sources", [])):
                                    matched.setdefault("sources", []).append({
                                        "case_id": case_id,
                                        "platform": platform,
                                        "officer_username": officer,
                                        "notes": notes,
                                        "saved_at": now_iso
                                    })
                            else:
                                pid = f"PERSON_{s_id if s_id else case_id}"
                                new_person = {
                                    "person_id": pid,
                                    "dossier_id": None,
                                    "suspect_name": s_name,
                                    "id_card": s_id or None,
                                    "age": s.get("age"),
                                    "phone_number": s.get("phone_number"),
                                    "phones": [s.get("phone_number").strip()] if s.get("phone_number") else [],
                                    "role_tag": "ผู้ต้องหา",
                                    "area_tag": None,
                                    "address": s.get("address"),
                                    "address_history": [],
                                    "behavior": data.get("behavior"),
                                    "notes": notes,
                                    "personal_files": [],
                                    "sources": [{
                                        "case_id": case_id,
                                        "platform": platform,
                                        "officer_username": officer,
                                        "notes": notes,
                                        "saved_at": now_iso
                                    }],
                                    "created_at": now_iso,
                                    "updated_at": now_iso
                                }
                                index_entries.append(new_person)
                    except Exception as e:
                        logger.warning(f"Error reindexing case at {meta_path}: {e}")

        # Save clean index
        self._save_index(index_entries)
        logger.info(f"Person Registry reindexed cleanly with {len(index_entries)} verified profiles.")

    def _load_index(self) -> List[Dict[str, Any]]:
        try:
            if os.path.exists(self.index_file):
                with open(self.index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error loading person index: {e}")
        return []

    @_serialize_person_registry_writer
    def _save_index(self, data: List[Dict[str, Any]]):
        """Replace the Person index with ``data`` under the shared lock, logging failures and returning no value."""
        # Even direct helper callers cannot perform a whole-index replacement outside coordinator serialization.
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving person index: {e}")

    def find_person(self, id_card: Optional[str] = None, suspect_name: Optional[str] = None, phone_number: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Find existing person profile by exact ID Card, phone number, or normalized Suspect Name.
        """
        index = self._load_index()

        # 1. Primary key match: ID Card
        if id_card and len(id_card.strip()) >= 10:
            clean_id = id_card.strip()
            for p in index:
                if p.get("id_card") and p.get("id_card").strip() == clean_id:
                    return p

        # 2. Match by Phone Number
        if phone_number:
            clean_phone = re.sub(r'\D', '', str(phone_number))
            if len(clean_phone) >= 9:
                for p in index:
                    if p.get("phone_number") and re.sub(r'\D', '', str(p.get("phone_number"))) == clean_phone:
                        return p
                    if clean_phone in [re.sub(r'\D', '', str(ph)) for ph in p.get("phones", [])]:
                        return p
                    if clean_phone in [re.sub(r'\D', '', str(ph)) for ph in p.get("all_phones", [])]:
                        return p

        # 3. Secondary match: Suspect Name & Nickname & Aliases
        if suspect_name and len(suspect_name.strip()) >= 2:
            s_clean = suspect_name.strip().lower()
            clean_name = THAI_TITLE_PREFIX_PATTERN.sub('', s_clean).strip()
            name_terms = [s_clean]
            if clean_name and clean_name != s_clean and len(clean_name) >= 2:
                name_terms.append(clean_name)
            name_tokens = [t.strip() for t in clean_name.split() if len(t.strip()) >= 2]

            for p in index:
                existing_name = (p.get("suspect_name") or "").strip().lower()
                clean_exist = THAI_TITLE_PREFIX_PATTERN.sub('', existing_name).strip()
                exist_terms = [existing_name]
                if clean_exist and clean_exist != existing_name:
                    exist_terms.append(clean_exist)

                p_aliases = [str(a).strip().lower() for a in p.get("aliases", []) if a]
                p_nick = (p.get("nickname") or "").strip().lower()

                all_candidate_terms = exist_terms + p_aliases
                if p_nick:
                    all_candidate_terms.append(p_nick)

                if any(nt in et or et in nt for nt in name_terms for et in all_candidate_terms if nt and et):
                    return p

                p_text = f"{existing_name} {p_nick} {' '.join(p_aliases)}"
                if len(name_tokens) >= 2 and all(t in p_text for t in name_tokens):
                    return p

                if name_tokens:
                    p_words = re.findall(r'[\u0E00-\u0E7F]+', p_text)
                    for t in name_tokens:
                        if len(t) >= 4:
                            sorted_t = sorted(t)
                            if any(len(w) >= 4 and sorted(w) == sorted_t for w in p_words):
                                if len(name_tokens) == 1 or any(other_t in p_text for other_t in name_tokens if other_t != t):
                                    return p

        return None

    @_serialize_person_registry_writer
    def upsert_person(
        self,
        case_id: str,
        platform: str,
        officer_username: str,
        suspect_name: Optional[str] = None,
        id_card: Optional[str] = None,
        age: Optional[str] = None,
        address: Optional[str] = None,
        notes: Optional[str] = None,
        drug_quantity: int = 0,
        phone_number: Optional[str] = None,
        role_tag: Optional[str] = None,
        area_tag: Optional[str] = None,
        behavior: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create or merge one Person and return its profile after persisting the whole index.

        Case/source identity, optional profile values, and tags are merged while address and phone history are
        preserved. The method rewrites ``persons_index.json`` as a side effect under the common transaction lock,
        preventing a coordinator plan from replacing a source added after its snapshot.
        """
        # Load and match only after lock acquisition so this read-modify-write begins from committed coordinator state.
        index = self._load_index()
        now_iso = datetime.datetime.now().isoformat()

        # Locate existing profile or create new ID
        person = self.find_person(id_card=id_card, suspect_name=suspect_name, phone_number=phone_number)
        
        if not person:
            person_id_val = id_card.strip() if (id_card and len(id_card.strip()) >= 10) else f"PERSON_{int(datetime.datetime.now().timestamp() * 1000)}"
            person = {
                "person_id": f"PERSON_{person_id_val}",
                "suspect_name": suspect_name or "ไม่ระบุชื่อ",
                "id_card": id_card or None,
                "age": age or None,
                "phone_number": phone_number or None,
                "role_tag": role_tag or None,
                "area_tag": area_tag or None,
                "address": address or None,
                "address_history": [],
                "phones": [phone_number.strip()] if phone_number else [],
                "behavior": None,
                "sources": [],
                "created_at": now_iso,
                "updated_at": now_iso
            }
            index.append(person)
        
        # Merge basic fields if provided
        if suspect_name and suspect_name.strip():
            person["suspect_name"] = suspect_name.strip()
        if id_card and id_card.strip():
            person["id_card"] = id_card.strip()
        if age and age.strip():
            person["age"] = age.strip()
        if role_tag and role_tag.strip():
            person["role_tag"] = role_tag.strip()
        if area_tag and area_tag.strip():
            person["area_tag"] = area_tag.strip()

        # Merge new fields
        if behavior and behavior.strip():
            person["behavior"] = behavior.strip()
            
        if phone_number and phone_number.strip():
            clean_phone = phone_number.strip()
            phones = person.get("phones", [])
            if clean_phone not in phones:
                phones.append(clean_phone)
            person["phones"] = phones
            person["phone_number"] = clean_phone

        # Handle Address & Address History
        if address and address.strip():
            new_addr = address.strip()
            old_addr = person.get("address")
            if old_addr and old_addr != new_addr:
                # Store previous address in history if not already recorded
                history = person.get("address_history", [])
                if not any(h.get("address") == old_addr for h in history):
                    history.append({
                        "address": old_addr,
                        "recorded_at": person.get("updated_at") or now_iso
                    })
                person["address_history"] = history
            person["address"] = new_addr

        # Append source case if not already linked
        sources = person.get("sources", [])
        if not any(s.get("case_id") == case_id for s in sources):
            sources.append({
                "case_id": case_id,
                "platform": platform,
                "officer_username": officer_username,
                "notes": notes or "",
                "drug_quantity": drug_quantity,
                "saved_at": now_iso
            })
        person["sources"] = sources
        person["updated_at"] = now_iso

        # Update item in index
        for i, p in enumerate(index):
            if p["person_id"] == person["person_id"]:
                index[i] = person
                break

        self._save_index(index)
        logger.info(f"Upserted Person Profile {person['person_id']} ({person['suspect_name']}) with {len(person['sources'])} linked cases.")
        return person

    def find_address_neighbors(self, target_address: str, exclude_person_id: str = "") -> List[Dict[str, Any]]:
        """
        Find other persons residing in the same address, subdistrict, or village.
        """
        if not target_address or len(target_address.strip()) < 4:
            return []

        clean_target = target_address.strip().lower()
        # Extract subdistrict / district / house number keywords
        keywords = re.findall(r'(?:บ้านเลขที่\s*\d+/\d+|\d+/\d+|ตำบล\s*[\u0E00-\u0E7F]+|ต\.\s*[\u0E00-\u0E7F]+|หมู่ที่\s*\d+|หมู่\s*\d+)', clean_target)
        
        index = self._load_index()
        neighbors = []

        for p in index:
            if p.get("person_id") == exclude_person_id:
                continue
            
            p_addr = (p.get("address") or "").lower()
            if not p_addr:
                continue

            # Direct address match or keyword overlap
            matched = False
            if clean_target in p_addr or p_addr in clean_target:
                matched = True
            elif keywords:
                matches_count = sum(1 for kw in keywords if kw in p_addr)
                if matches_count >= 1:
                    matched = True

            if matched:
                neighbors.append({
                    "person_id": p.get("person_id"),
                    "suspect_name": p.get("suspect_name"),
                    "id_card": p.get("id_card"),
                    "address": p.get("address"),
                    "linked_cases_count": len(p.get("sources", []))
                })

        return neighbors

    def get_all_persons(self) -> List[Dict[str, Any]]:
        """
        Retrieve list of all verified Person Profiles (Filtered and Thai Sorted).
        """
        raw = self._load_index()
        valid = [
            p for p in raw
            if p.get("suspect_name") 
            and p.get("suspect_name") != "ไม่ระบุชื่อ" 
            and not str(p.get("suspect_name")).startswith("สายเบอร์")
            and not str(p.get("suspect_name")).startswith("สายส่ง")
        ]
        def sort_key(p):
            n = p.get("suspect_name") or ""
            return re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', n).strip()
        valid.sort(key=sort_key)
        return valid

    def get_person_by_id(self, person_id: str) -> Optional[Dict[str, Any]]:
        """
        Get single Person Profile by person_id.
        """
        for p in self._load_index():
            if p.get("person_id") == person_id:
                # Include address neighbors
                neighbors = self.find_address_neighbors(p.get("address") or "", exclude_person_id=person_id)
                res = dict(p)
                res["address_neighbors"] = neighbors
                return res
        return None

    @_serialize_person_registry_writer
    def remove_case_source(self, case_id: str):
        """Remove ``case_id`` from every Person source list and persist any changes.

        The method returns no value and may replace the full Person index. Its shared lock keeps Case deletion cleanup
        from being overwritten by, or interleaved with, a coordinator snapshot and promotion.
        """
        # Load, filter, and optional replacement form one locked read-modify-write over the registry index.
        index = self._load_index()
        changed = False

        for p in index:
            sources = p.get("sources", [])
            new_sources = [s for s in sources if s.get("case_id") != case_id]
            if len(new_sources) != len(sources):
                p["sources"] = new_sources
                p["updated_at"] = datetime.datetime.now().isoformat()
                changed = True

        if changed:
            self._save_index(index)
            logger.info(f"Removed source reference {case_id} from Person Registry.")
