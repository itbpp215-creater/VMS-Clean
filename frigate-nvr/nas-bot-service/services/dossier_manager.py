"""
Dossier Vault Manager Module for nas-bot-service (BPP-VMS)
----------------------------------------------------------
Manages Person Dossier Vaults (ถังแฟ้มประวัติและบันทึกจับกุมรายบุคคล)
- Folder Structure: /data/nas-storage/Dossiers/<ชื่อ_สกุล_ปี>/
- Separates: [1] Personal files and [2] Cross-linked shared evidence & dossiers
- Clean Human-Readable Case/Dossier IDs: e.g. สมชาย_ใจดี_2569
- Safe Unlinking on deletion
"""

import os
import io
import time
import json
import re
import datetime
import shutil
import logging
from functools import wraps
from typing import Dict, Any, List, Optional

from services.identity_sync import IDENTITY_TRANSACTION_LOCK, IdentitySyncCoordinator

logger = logging.getLogger("nas-bot.dossier_manager")

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

DEFAULT_STORAGE_ROOT = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")

# These are the established dossier-list response fields; internal lookup aliases must never cross this boundary.
_PUBLIC_DOSSIER_LIST_FIELDS = (
    "dossier_id",
    "suspect_name",
    "id_card",
    "phone_number",
    "role_tag",
    "area_tag",
    "year",
    "category",
    "address",
    "nickname",
    "name_source",
    "created_at",
    "updated_at",
)


def _serialize_identity_artifact_writer(function: Any) -> Any:
    """Wrap one manager mutation in the shared dossier/index transaction lock.

    ``function`` is a bound-compatible manager callable with arbitrary inputs and return type. The wrapper
    returns the callable's result unchanged while holding the process-wide re-entrant lock across every
    profile/index/evidence side effect, so coordinator snapshots cannot interleave with historical or API writes.
    """
    # ``wraps`` preserves method metadata while the RLock permits nested writer helpers in one manager operation.
    @wraps(function)
    def serialized_writer(*args: Any, **kwargs: Any) -> Any:
        """Invoke the wrapped manager writer under the shared re-entrant identity transaction boundary."""
        # Acquiring before any read prevents stale read-modify-write plans from overwriting a coordinated commit.
        with IDENTITY_TRANSACTION_LOCK:
            return function(*args, **kwargs)

    return serialized_writer


def _normalized_phone_aliases(
    phone_number: Optional[Any],
    historical_phones: Optional[Any],
) -> List[str]:
    """Return sorted unique exact-match phone keys from primary and historical stored values.

    Inputs may contain legacy punctuation or malformed non-list history. The function returns only digit strings
    of at least nine characters, performs no writes, and never uses partial matching that could merge identities.
    """
    # The primary value and every list-backed alias share one normalization rule for index rebuild and lookup.
    values = [phone_number]
    if isinstance(historical_phones, list):
        values.extend(historical_phones)
    normalized = {
        re.sub(r"\D", "", str(value))
        for value in values
        if value is not None
    }
    return sorted(phone for phone in normalized if len(phone) >= 9)


def _extract_loc_token(text: Optional[str], pattern: str) -> Optional[str]:
    """Extract first matching group from regex pattern if text is provided."""
    if not text or not isinstance(text, str):
        return None
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def get_current_thai_year() -> int:
    """Return current Buddhist Era (พ.ศ.) year."""
    return datetime.datetime.now().year + 543


def normalize_person_name(name: str) -> str:
    """Clean title prefix, whitespace, nicknames (หรือ/ชื่อเล่น), and stray quotes/punctuation from Thai name."""
    if not name:
        return "ไม่ระบุชื่อ"
    clean = re.sub(r'^(?:นาย|นางสาว|น\.ส\.|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|หาาย|บาย|ทาย|มาย|ผาย)\s*', '', str(name).strip()).strip()
    clean = re.sub(r'(?:[\s\(]+)?(?:หรือ|ชื่อเล่น)\s*[^\s\)]+[\)]?', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    clean = clean.strip(" \t\n\r\"'”’“‘()[]{}:;,./-")
    return clean or str(name).strip()


def generate_clean_dossier_id(name: str, year: Optional[int] = None) -> str:
    """
    Format clean dossier ID: <ชื่อ_นามสกุล_ปีพศ>
    e.g. 'น.ส.อรอุมา วายทุกข์' -> 'อรอุมา_วายทุกข์_2569'
    """
    import uuid
    th_year = year or get_current_thai_year()
    norm_name = normalize_person_name(name)
    unknown_placeholders = {
        "ไม่ระบุชื่อ", "ไม่ระบุ", "unknown", "บุคคลไม่ระบุชื่อ", "นิรนาม", "บุคคลนิรนาม", "none", "null", ""
    }
    if not norm_name or norm_name.lower() in unknown_placeholders:
        return f"ไม่ระบุชื่อ_{uuid.uuid4().hex[:6]}_{th_year}"
    safe_name = re.sub(r'\s+', '_', norm_name)
    safe_name = re.sub(r'[^\w\u0E00-\u0E7F]', '', safe_name)
    # Fail-safe limit: truncate safe_name to max 40 chars to prevent OS filesystem limits (255 bytes)
    safe_name = safe_name[:40].rstrip('_')
    return f"{safe_name}_{th_year}"


class DossierVaultManager:
    """
    Manages Person Dossier folders, profile metadata, personal files,
    cross-references to linked network dossiers, and safe deletion.
    """

    def __init__(
        self,
        root_path: str = DEFAULT_STORAGE_ROOT,
        identity_sync_coordinator: Optional[IdentitySyncCoordinator] = None,
    ):
        """Initialize dossier storage and one coordinator rooted at the same NAS location.

        ``root_path`` selects the dossier filesystem, while an optional injected coordinator lets
        the application share one prebuilt identity transaction boundary. Construction creates missing
        dossier storage, rebuilds its index from existing profiles, and never changes profile contents.
        """
        # Retain the manager's configured root and create its existing dossier storage boundary first.
        self.root_path = root_path
        self.dossiers_dir = os.path.join(self.root_path, "Dossiers")
        self.index_file = os.path.join(self.dossiers_dir, "dossiers_index.json")
        os.makedirs(self.dossiers_dir, exist_ok=True)

        # Standalone callers get one same-root coordinator, while main injects its shared-root instance explicitly.
        self.identity_sync_coordinator = identity_sync_coordinator or IdentitySyncCoordinator(self.root_path)
        self._ensure_index()

    @_serialize_identity_artifact_writer
    def get_safe_dossier_path(self, dossier_id: str) -> str:
        return os.path.join(self.dossiers_dir, dossier_id)

    def _ensure_index(self):
        """Create a missing dossier index and rebuild it under the shared lock, returning no value."""
        # Initialization must not interleave its empty/rebuilt index writes with a coordinator transaction.
        if not os.path.exists(self.index_file):
            self._save_index([])
        self.rebuild_index()

    def _load_index(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error reading dossier index: {e}")
        return []

    @_serialize_identity_artifact_writer
    def _save_index(self, data: List[Dict[str, Any]]):
        """Persist supplied index entries under the shared lock, logging failures and returning no value."""
        # All callers use the same lock so this whole-file replacement cannot split a coordinator profile/index view.
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving dossier index: {e}")

    @_serialize_identity_artifact_writer
    def rebuild_index(self):
        """Scan all dossier profiles and rewrite the lookup index under the shared transaction lock."""
        # Rebuild reads every coordinated profile before one index write, so the lock preserves a consistent snapshot.
        if not os.path.exists(self.dossiers_dir):
            return

        index_entries = []
        for item in os.listdir(self.dossiers_dir):
            item_path = os.path.join(self.dossiers_dir, item)
            if os.path.isdir(item_path) and item != "dossiers_index.json":
                profile_path = os.path.join(item_path, "profile.json")
                if os.path.exists(profile_path):
                    try:
                        with open(profile_path, "r", encoding="utf-8") as f:
                            profile = json.load(f)
                            index_entries.append({
                                "dossier_id": profile.get("dossier_id", item),
                                "suspect_name": profile.get("suspect_name"),
                                "id_card": profile.get("id_card"),
                                "phone_number": profile.get("phone_number"),
                                # Exact normalized aliases preserve lookup reachability after a primary phone change.
                                "phones": _normalized_phone_aliases(
                                    profile.get("phone_number"),
                                    profile.get("phones"),
                                ),
                                "role_tag": profile.get("role_tag"),
                                "area_tag": profile.get("area_tag"),
                                "year": profile.get("year", get_current_thai_year()),
                                "category": profile.get("category", "general"),
                                "address": profile.get("address"),
                                "district": profile.get("district") or (_extract_loc_token(profile.get("address"), r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)') if profile.get("address") else None),
                                "subdistrict": profile.get("subdistrict") or (_extract_loc_token(profile.get("address"), r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)') if profile.get("address") else None),
                                # สกัดข้อหาจาก warrant_info หรือพฤติการณ์/บันทึก เพื่อเก็บใน index ให้สามารถค้นหา/กรองตามหมวดหมู่ได้เร็ว
                                "charge": str(profile.get("warrant_info", {}).get("charge") or profile.get("behavior") or profile.get("notes") or ""),
                                # Index provenance makes authoritative-name lookup decisions without exposing extra profile data.
                                "name_source": profile.get("name_source", "ocr"),
                                "nickname": profile.get("nickname"),
                                "aliases": profile.get("aliases", []),
                                "created_at": profile.get("created_at"),
                                "updated_at": profile.get("updated_at")
                            })
                    except Exception as e:
                        logger.warning(f"Error reading profile for {item}: {e}")
        self._save_index(index_entries)

    def find_dossier_id(self, suspect_name: Optional[str] = None, id_card: Optional[str] = None, phone: Optional[str] = None) -> Optional[str]:
        """Return a dossier ID matched by strong identifiers or a non-authoritative legacy name.

        Inputs are optional OCR-derived name, national ID, and phone values.  The method reads the
        durable dossier index only and returns a stable dossier ID or ``None`` without changing data.
        Officer-corrected profiles deliberately exclude weak name matching so a historical OCR fragment
        cannot select an authoritative identity without an exact national ID or phone number.
        """
        index = self._load_index()
        
        # 0. Pre-process: Extract embedded 13-digit ID from suspect_name if id_card was omitted
        target_id_card = id_card
        if not target_id_card and suspect_name:
            extracted_cids = re.findall(r'^\d{13}', suspect_name.strip()) or re.findall(r'\b\d{13}\b', suspect_name)
            if extracted_cids:
                target_id_card = extracted_cids[0]

        # 1. Match ID card
        if target_id_card and len(target_id_card.strip()) >= 10:
            cid = target_id_card.strip()
            for d in index:
                if d.get("id_card") and d.get("id_card").strip() == cid:
                    return d["dossier_id"]

        # 2. Match phone
        if phone:
            cphone = re.sub(r'\D', '', phone)
            if len(cphone) >= 9:
                for d in index:
                    # Both the primary value and historical aliases are normalized before exact-only comparison.
                    indexed_phones = _normalized_phone_aliases(
                        d.get("phone_number"),
                        d.get("phones"),
                    )
                    if cphone in indexed_phones:
                        return d["dossier_id"]

        # 3. Match Name
        if suspect_name:
            # Strip 13-digit ID prefix from name candidate if present
            clean_sname = re.sub(r'^\d{13}[_\-\s]*', '', suspect_name.strip())
            norm_name = normalize_person_name(clean_sname)
            unknown_placeholders = {
                "ไม่ระบุชื่อ", "ไม่ระบุ", "unknown", "บุคคลไม่ระบุชื่อ", "นิรนาม", "บุคคลนิรนาม", "none", "null", ""
            }
            if norm_name and norm_name.lower() not in unknown_placeholders and len(norm_name) >= 3:
                for d in index:
                    # Officer corrections are authoritative, so only the preceding strong ID or phone paths may select them.
                    if d.get("name_source") == "officer_correction":
                        continue
                    exist_norm = normalize_person_name(d.get("suspect_name") or "")
                    if not exist_norm or exist_norm.lower() in unknown_placeholders:
                        continue
                    # Legacy OCR records retain the existing relaxed compatibility matching until they gain authoritative provenance.
                    if norm_name and exist_norm and (norm_name in exist_norm or exist_norm in norm_name):
                        return d["dossier_id"]

        return None

    @_serialize_identity_artifact_writer
    def upsert_dossier(
        self,
        suspect_name: str,
        id_card: Optional[str] = None,
        phone_number: Optional[str] = None,
        role_tag: Optional[str] = None,
        area_tag: Optional[str] = None,
        address: Optional[str] = None,
        age: Optional[str] = None,
        category: str = "general",
        behavior: Optional[str] = None,
        notes: Optional[str] = None,
        officer_username: str = "admin",
        platform: str = "web",
        files: Optional[List[Dict[str, Any]]] = None,
        year: Optional[int] = None,
        name_source: str = "ocr",
        family_info: Optional[Dict[str, Any]] = None,
        district: Optional[str] = None,
        subdistrict: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create or update a person's dossier vault while retaining authoritative officer-corrected names.

        Inputs describe an OCR or officer-provided identity, optional evidence files, and ``name_source``
        provenance. The returned profile is persisted at ``/Dossiers/<dossier_id>/profile.json``; supplied
        evidence is written under ``Personal/`` and related dossiers may be cross-linked. An existing officer-corrected
        name changes only when an explicitly officer-corrected input supersedes it, while other provided
        identity fields and evidence continue to merge. The shared transaction lock serializes all filesystem effects.
        """
        th_year = year or get_current_thai_year()
        now_iso = datetime.datetime.now().isoformat()

        # Extract embedded 13-digit citizen ID from suspect_name if id_card is not given
        if not id_card and suspect_name:
            extracted_cids = re.findall(r'^\d{13}', suspect_name.strip()) or re.findall(r'\b\d{13}\b', suspect_name)
            if extracted_cids:
                id_card = extracted_cids[0]

        # Strip 13-digit ID from suspect_name for clean display and clean folder ID
        clean_input_name = suspect_name
        if clean_input_name:
            stripped = re.sub(r'^\d{13}[_\-\s]*', '', clean_input_name.strip()).strip()
            if stripped:
                clean_input_name = stripped

        # Find existing or generate new clean dossier_id
        dossier_id = self.find_dossier_id(suspect_name=suspect_name, id_card=id_card, phone=phone_number)
        if not dossier_id:
            unknown_placeholders = {
                "ไม่ระบุชื่อ", "ไม่ระบุ", "unknown", "บุคคลไม่ระบุชื่อ", "นิรนาม", "บุคคลนิรนาม", "none", "null", ""
            }
            norm = normalize_person_name(clean_input_name) if clean_input_name else ""
            if not norm or norm.lower() in unknown_placeholders:
                if id_card and len(str(id_card).strip()) >= 10:
                    clean_cid = re.sub(r'\D', '', str(id_card))
                    base_id = f"บุคคล_{clean_cid}_{th_year}"
                else:
                    import uuid
                    base_id = f"ไม่ระบุชื่อ_{uuid.uuid4().hex[:6]}_{th_year}"
            else:
                base_id = generate_clean_dossier_id(clean_input_name, th_year)
            dossier_id = base_id
            counter = 2
            while os.path.exists(os.path.join(self.dossiers_dir, dossier_id)):
                dossier_id = f"{base_id}_{counter}"
                counter += 1

        # Guard against any excessive dossier_id length
        if len(dossier_id) > 55:
            dossier_id = dossier_id[:45].rstrip('_') + f"_{th_year}"

        dossier_folder = self.get_safe_dossier_path(dossier_id)
        personal_folder = os.path.join(dossier_folder, "Personal")
        try:
            os.makedirs(personal_folder, exist_ok=True)
        except OSError as os_err:
            if os_err.errno == 36 or "too long" in str(os_err).lower():
                import uuid
                dossier_id = f"บุคคล_{uuid.uuid4().hex[:8]}_{th_year}"
                dossier_folder = self.get_safe_dossier_path(dossier_id)
                personal_folder = os.path.join(dossier_folder, "Personal")
                os.makedirs(personal_folder, exist_ok=True)
            else:
                raise

        profile_path = os.path.join(dossier_folder, "profile.json")
        profile: Dict[str, Any] = {
            "dossier_id": dossier_id,
            "suspect_name": suspect_name or "ไม่ระบุชื่อ",
            # New dossier names inherit the caller's declared source so later ingestion can apply the same authority rule.
            "name_source": name_source,
            "id_card": id_card,
            "phone_number": phone_number,
            "phones": [phone_number.strip()] if phone_number else [],
            "role_tag": role_tag,
            "area_tag": area_tag,
            "address": address,
            "district": district or _extract_loc_token(address, r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)'),
            "subdistrict": subdistrict or _extract_loc_token(address, r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)'),
            "age": age,
            "category": category,
            "behavior": behavior,
            "year": th_year,
            "officer_username": officer_username,
            "platform": platform,
            "created_at": now_iso,
            "updated_at": now_iso,
            "notes": notes,
            "personal_files": [],
            "linked_dossiers": []
        }

        if os.path.exists(profile_path):
            try:
                with open(profile_path, "r", encoding="utf-8") as f:
                    existing_profile = json.load(f)
                    profile.update({k: v for k, v in existing_profile.items() if v is not None})
                    profile["updated_at"] = now_iso
            except Exception as e:
                logger.warning(f"Error loading existing profile: {e}")

        # Update fields if provided
        # Older profiles predate provenance and therefore retain their historical OCR behavior until a correction is recorded.
        stored_name_source = profile.get("name_source") or "ocr"
        stored_name = profile.get("suspect_name") or ""
        unknown_placeholders = {
            "ไม่ระบุชื่อ", "ไม่ระบุ", "unknown", "บุคคลไม่ระบุชื่อ", "นิรนาม", "บุคคลนิรนาม", "none", "null", ""
        }
        is_incoming_unknown = not suspect_name or suspect_name.strip().lower() in unknown_placeholders
        is_stored_valid = stored_name and stored_name.strip().lower() not in unknown_placeholders

        if suspect_name and suspect_name.strip():
            # Historical OCR may enrich evidence but cannot silently restore a name an officer has corrected,
            # and never downgrade a known valid name to an unknown placeholder.
            if is_stored_valid and is_incoming_unknown:
                pass
            elif stored_name_source != "officer_correction" or name_source == "officer_correction":
                assigned_name = clean_input_name or suspect_name.strip()
                clean_name = assigned_name.strip().rstrip(')]}_"\' ')
                if clean_name:
                    profile["suspect_name"] = clean_name
                    # The name source changes only with the accepted name assignment, preserving corrected provenance on OCR merges.
                    profile["name_source"] = name_source
        if id_card and id_card.strip(): profile["id_card"] = id_card.strip()
        if phone_number and phone_number.strip():
            clean_ph = phone_number.strip()
            profile["phone_number"] = clean_ph
            if clean_ph not in profile.get("phones", []):
                profile.setdefault("phones", []).append(clean_ph)

        # Warrant Immutable Protection:
        # Never downgrade an authoritative warrant profile to general / generic suspect on default inputs.
        is_existing_warrant = profile.get("category") == "warrant" or bool(profile.get("warrant_info"))

        if role_tag and role_tag.strip():
            clean_rt = role_tag.strip()
            if is_existing_warrant and clean_rt in {"ผู้ต้องหา", "ผู้ถูกกล่าวหา", "พยาน"}:
                # Maintain authoritative role tag if profile is already warrant suspect
                if profile.get("role_tag") != "ผู้ต้องหาตามหมายจับ":
                    profile["role_tag"] = clean_rt
            else:
                profile["role_tag"] = clean_rt

        if area_tag and area_tag.strip(): profile["area_tag"] = area_tag.strip()
        if address and address.strip():
            profile["address"] = address.strip()
            profile["district"] = district or _extract_loc_token(profile["address"], r'(?:อ\.|อำเภอ)\s*([ก-๙a-zA-Z]+)')
            profile["subdistrict"] = subdistrict or _extract_loc_token(profile["address"], r'(?:ต\.|ตำบล)\s*([ก-๙a-zA-Z]+)')
        else:
            if district and district.strip(): profile["district"] = district.strip()
            if subdistrict and subdistrict.strip(): profile["subdistrict"] = subdistrict.strip()

        if category and category.strip():
            clean_cat = category.strip()
            if is_existing_warrant and clean_cat == "general":
                # Do not downgrade warrant category to general default
                pass
            else:
                profile["category"] = clean_cat

        if behavior and behavior.strip(): profile["behavior"] = behavior.strip()
        if family_info and isinstance(family_info, dict):
            profile.setdefault("family_info", {}).update(family_info)

        # Save Personal Files
        if files:
            for file_item in files:
                fname = file_item.get("filename", "file.bin")
                content = file_item.get("content", b"")
                target_path = os.path.join(personal_folder, fname)
                with open(target_path, "wb") as f:
                    f.write(content)
                
                file_entry = {
                    "filename": fname,
                    "size_bytes": len(content),
                    "saved_at": now_iso
                }
                if not any(pf.get("filename") == fname for pf in profile.get("personal_files", [])):
                    profile.setdefault("personal_files", []).append(file_entry)

        # TR.14 Node Avatar Guard: If TR.14 exists among files, automatically set as primary photo_url
        if not profile.get("photo_url") or not any(k in profile.get("photo_url", "").lower() for k in ("tr14", "ทร14", "ทร.14")):
            for pf in profile.get("personal_files", []):
                fn = pf.get("filename", "")
                if any(k in fn.lower() for k in ("tr14", "ทร14", "ทร.14")):
                    profile["photo_url"] = f"/api/nas-bot/dossiers/{dossier_id}/download/{fn}"
                    break

        # Save profile
        with open(profile_path, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)

        # Cross Link Detection: establish bi-directional links with other dossiers
        self._cross_link_dossiers(dossier_id)

        # Update index
        self.rebuild_index()
        logger.info(f"Successfully upserted dossier: {dossier_id}")
        return profile

    @_serialize_identity_artifact_writer
    def _cross_link_dossiers(self, current_dossier_id: str):
        """Persist bidirectional dossier links only for normalized exact phone overlap.

        ``current_dossier_id`` selects the source profile. The method may rewrite source and peer
        profiles under the shared identity lock. Area tags and addresses are intentionally excluded:
        the i2 graph exposes them as weak proposals requiring Officer/Admin review.
        """
        # Nested calls from upsert remain safe because the shared boundary is deliberately re-entrant.
        cur_path = os.path.join(self.dossiers_dir, current_dossier_id, "profile.json")
        if not os.path.exists(cur_path):
            return

        with open(cur_path, "r", encoding="utf-8") as f:
            cur_profile = json.load(f)

        # Only normalized exact phones are strong enough to create a persisted dossier link.
        cur_phones = set(_normalized_phone_aliases(
            cur_profile.get("phone_number"), cur_profile.get("phones")
        ))

        for other_id in os.listdir(self.dossiers_dir):
            if other_id == current_dossier_id or not os.path.isdir(os.path.join(self.dossiers_dir, other_id)):
                continue

            other_path = os.path.join(self.dossiers_dir, other_id, "profile.json")
            if not os.path.exists(other_path):
                continue

            try:
                with open(other_path, "r", encoding="utf-8") as f:
                    other_profile = json.load(f)

                # Area/address matches remain graph proposals and never become dossier links here.
                other_phones = set(_normalized_phone_aliases(
                    other_profile.get("phone_number"), other_profile.get("phones")
                ))
                phone_intersect = cur_phones.intersection(other_phones)
                if not phone_intersect:
                    continue
                link_reason = "เบอร์โทรศัพท์ตรงกัน: " + ", ".join(sorted(phone_intersect))

                # Persist each direction once; existing legacy links remain untouched for review.
                if not any(ld.get("dossier_id") == other_id for ld in cur_profile.get("linked_dossiers", [])):
                    cur_profile.setdefault("linked_dossiers", []).append({
                        "dossier_id": other_id,
                        "suspect_name": other_profile.get("suspect_name"),
                        "role_tag": other_profile.get("role_tag"),
                        "phone_number": other_profile.get("phone_number"),
                        "link_reason": link_reason,
                        "shared_files": [item.get("filename") for item in other_profile.get("personal_files", [])]
                    })

                if not any(ld.get("dossier_id") == current_dossier_id for ld in other_profile.get("linked_dossiers", [])):
                    other_profile.setdefault("linked_dossiers", []).append({
                        "dossier_id": current_dossier_id,
                        "suspect_name": cur_profile.get("suspect_name"),
                        "role_tag": cur_profile.get("role_tag"),
                        "phone_number": cur_profile.get("phone_number"),
                        "link_reason": link_reason,
                        "shared_files": [item.get("filename") for item in cur_profile.get("personal_files", [])]
                    })
                    with open(other_path, "w", encoding="utf-8") as f:
                        json.dump(other_profile, f, ensure_ascii=False, indent=2)

            except Exception as e:
                logger.error(f"Error cross-linking {current_dossier_id} with {other_id}: {e}")

        with open(cur_path, "w", encoding="utf-8") as f:
            json.dump(cur_profile, f, ensure_ascii=False, indent=2)

        # Deep document and entity cross-linking (AutoLinkNetworkEngine)
        try:
            from services.auto_link_network import AutoLinkNetworkEngine
            AutoLinkNetworkEngine(self).scan_dossier_and_link(current_dossier_id)
        except Exception as err:
            logger.warning(f"Auto-link network scan error for {current_dossier_id}: {err}")

    def get_all_dossiers(
        self,
        year: Optional[int] = None,
        month: Optional[str] = None,
        category: Optional[str] = None,
        query: Optional[str] = None,
        sort_by: str = "newest"
    ) -> List[Dict[str, Any]]:
        """Return public dossier summaries filtered by year, category, and keyword.

        Optional filters select internal index entries; the returned dictionaries contain only the established
        public summary fields plus computed file/link counts. Reading profiles for counts has no storage side effect,
        and normalized historical phone aliases remain available only to exact internal lookup.
        """
        # Filtering may inspect internal search metadata, but response construction later applies an explicit whitelist.
        index = self._load_index()
        results = []

        q_clean = query.strip().lower() if query else ""
        clean_q = THAI_TITLE_PREFIX_PATTERN.sub('', q_clean).strip() if q_clean else ""
        search_terms = [q_clean] if q_clean else []
        if clean_q and clean_q != q_clean and len(clean_q) >= 2:
            search_terms.append(clean_q)
        tokens = [t.strip() for t in clean_q.split() if len(t.strip()) >= 2]

        for item in index:
            if year and item.get("year") != year:
                continue
            if month and isinstance(month, str) and month != "all":
                created_at = item.get("created_at") or ""
                if not created_at or f"-{str(month).zfill(2)}-" not in created_at:
                    continue
            # ตรวจสอบตัวกรองหมวดหมู่คดี: รองรับทั้งค่าตรง (warrant, drug, weapon, alien, general)
            # และการวิเคราะห์คำสำคัญ (keywords) จากข้อหา/พฤติการณ์ เพื่อให้แฟ้มคดีที่ลงหมวดทั่วไปแต่มีข้อมูลยาเสพติด/อาวุธถูกค้นพบได้ถูกต้อง
            if category and category not in ("all", "ทั้งหมด", ""):
                cat = (item.get("category") or "").lower()
                role = (item.get("role_tag") or "").lower()
                charge = str(item.get("charge") or "").lower()

                # หากใน index ยังไม่มี charge ให้โหลด profile.json ชั่วคราวมาตรวจสอบ
                if not charge:
                    d_folder = os.path.join(self.dossiers_dir, item["dossier_id"])
                    profile_path = os.path.join(d_folder, "profile.json")
                    if os.path.exists(profile_path):
                        try:
                            with open(profile_path, "r", encoding="utf-8") as f_lazy:
                                p_lazy = json.load(f_lazy)
                                winfo = p_lazy.get("warrant_info") or {}
                                charge = (str(winfo.get("charge") or "") + " " + str(p_lazy.get("behavior") or "") + " " + str(p_lazy.get("notes") or "")).lower()
                        except Exception:
                            pass

                matched_cat = False
                c_target = category.lower().strip()
                # หมวดหมายจับ: ตรวจสอบ category หรือ role_tag ที่ระบุหมายจับ
                if c_target == "warrant":
                    matched_cat = cat == "warrant" or "หมายจับ" in role or "หมายจับ" in cat
                # หมวดยาเสพติด: ตรวจสอบทั้ง category ตรง หรือคำสำคัญในข้อหา/พฤติการณ์คดี
                elif c_target == "drug":
                    if cat in ("drug", "คดียาเสพติด") or "ยาเสพติด" in cat:
                        matched_cat = True
                    else:
                        matched_cat = any(w in charge for w in ("ยาเสพติด", "ยาบ้า", "ไอซ์", "เมทแอมเฟตามีน", "กัญชา", "เคตามีน", "มัด", "ส่งมอบยา"))
                # หมวดอาวุธปืน/วัตถุระเบิด: ตรวจสอบคำสำคัญเรื่องอาวุธและลูกกระสุน
                elif c_target == "weapon":
                    if cat in ("weapon", "อาวุธปืน") or "อาวุธ" in cat:
                        matched_cat = True
                    else:
                        matched_cat = any(w in charge for w in ("อาวุธ", "ปืน", "กระสุน", "ระเบิด"))
                # หมวดคนต่างด้าว/หลบหนีเข้าเมือง: ตรวจสอบทั้งข้อหา พฤติการณ์ สัญชาติ เลขประจำตัวคนต่างด้าว/ไม่มีสถานะทางทะเบียน (ขึ้นต้นด้วย 0 หรือ 00) หรือคำนำหน้านามต่างชาติ (Mr., Mrs., Miss)
                elif c_target == "alien":
                    cid_str = str(item.get("id_card") or "").strip()
                    name_str = str(item.get("suspect_name") or "").strip().lower()
                    if cat in ("alien", "คนต่างด้าว") or "ต่างด้าว" in cat:
                        matched_cat = True
                    elif any(w in charge for w in ("คนต่างด้าว", "หลบหนีเข้าเมือง", "สัญชาติ", "เข้าเมืองโดยผิดกฎหมาย", "พ.ร.บ.คนเข้าเมือง", "บุคคลต่างด้าว")):
                        matched_cat = True
                    elif cid_str.startswith("00") or (len(cid_str) == 13 and cid_str.startswith("0")):
                        matched_cat = True
                    elif any(name_str.startswith(p) for p in ("mr.", "mr ", "mrs.", "mrs ", "miss.", "miss ")):
                        matched_cat = True
                # หมวดทั่วไป: แฟ้มทั่วไปที่ไม่ใช่หมายจับ
                elif c_target == "general":
                    if cat in ("general", "ทั่วไป"):
                        matched_cat = not (cat == "warrant" or "หมายจับ" in role)
                else:
                    matched_cat = cat == c_target

                # หากไม่ตรงกับหมวดหมู่ที่เลือก ให้ข้ามรายการนี้ไป
                if not matched_cat:
                    continue
            if search_terms:
                matched = False
                aliases = item.get("aliases") or []
                aliases_str = " ".join(str(a) for a in aliases).lower()
                for field in ["dossier_id", "suspect_name", "id_card", "phone_number", "role_tag", "area_tag", "address", "nickname", "notes", "behavior"]:
                    val = str(item.get(field) or "").lower()
                    if any(st in val for st in search_terms):
                        matched = True
                        break

                # Check indexed aliases
                if not matched and aliases_str:
                    if any(st in aliases_str for st in search_terms):
                        matched = True

                # Multi-token & syllable-transposition matching
                if not matched and tokens:
                    searchable = (
                        f"{item.get('dossier_id')} {item.get('suspect_name')} {item.get('id_card')} "
                        f"{item.get('nickname')} {aliases_str} {item.get('address')} {item.get('charge')}"
                    ).lower()
                    if len(tokens) >= 2 and all(t in searchable for t in tokens):
                        matched = True

                    if not matched:
                        # Syllable swap / anagram check (e.g. 'เวชวัช' <-> 'วัชเวช')
                        name_words = re.findall(r'[\u0E00-\u0E7F]+', f"{item.get('suspect_name', '')} {item.get('dossier_id', '')} {aliases_str}")
                        for t in tokens:
                            if len(t) >= 4:
                                sorted_t = sorted(t)
                                if any(len(w) >= 4 and sorted(w) == sorted_t for w in name_words):
                                    if len(tokens) == 1 or any(other_t in searchable for other_t in tokens if other_t != t):
                                        matched = True
                                        break

                if not matched:
                    d_folder = os.path.join(self.dossiers_dir, item["dossier_id"])
                    profile_path = os.path.join(d_folder, "profile.json")
                    if os.path.exists(profile_path):
                        try:
                            with open(profile_path, "r", encoding="utf-8") as pf:
                                p_data = json.load(pf)
                                p_aliases = " ".join(str(a) for a in p_data.get("aliases", []))
                                p_str = (
                                    str(p_data.get("nickname") or "") + " " +
                                    str(p_data.get("notes") or "") + " " +
                                    str(p_data.get("behavior") or "") + " " +
                                    p_aliases
                                ).lower()
                                if any(st in p_str for st in search_terms):
                                    matched = True
                                elif len(tokens) >= 2 and all(t in p_str for t in tokens):
                                    matched = True
                        except Exception:
                            pass
                if not matched:
                    continue

            # Enrich with files count and links count
            d_folder = os.path.join(self.dossiers_dir, item["dossier_id"])
            p_folder = os.path.join(d_folder, "Personal")
            files_count = len(os.listdir(p_folder)) if os.path.exists(p_folder) else 0
            
            profile_path = os.path.join(d_folder, "profile.json")
            links_count = 0
            if os.path.exists(profile_path):
                try:
                    with open(profile_path, "r", encoding="utf-8") as f:
                        links_count = len(json.load(f).get("linked_dossiers", []))
                except:
                    pass

            # Copy only the established public contract so ``phones`` and future internal lookup keys cannot leak.
            item_copy = {field: item.get(field) for field in _PUBLIC_DOSSIER_LIST_FIELDS}
            item_copy["files_count"] = files_count
            item_copy["links_count"] = links_count
            results.append(item_copy)

        if sort_by == "newest":
            results.sort(key=lambda x: x.get("created_at") or x.get("updated_at") or "", reverse=True)
        elif sort_by == "oldest":
            results.sort(key=lambda x: x.get("created_at") or x.get("updated_at") or "", reverse=False)

        return results

    def _get_case_folder_map(self) -> Dict[str, str]:
        """Cache the mapping of case_id -> folder_path to avoid walking the entire NAS storage on every dossier detail lookup."""
        now = time.time()
        cached = getattr(self, "_case_folder_cache", None)
        if cached is not None and (now - getattr(self, "_case_folder_cache_time", 0) < 60.0):
            return cached

        case_map: Dict[str, str] = {}
        cases_root = os.path.join(self.root_path, "Cases")
        if os.path.exists(cases_root):
            for root, dirs, _ in os.walk(cases_root):
                bname = os.path.basename(root)
                if bname.startswith(("Case_", "คดี_")) or "_256" in bname:
                    case_map[bname] = root
        self._case_folder_cache = case_map
        self._case_folder_cache_time = now
        return case_map

    def get_dossier_detail(self, dossier_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve complete dossier profile, documents vs photos breakdown, and linked network dossiers."""
        d_folder = self.get_safe_dossier_path(dossier_id)
        profile_path = os.path.join(d_folder, "profile.json")
        if not os.path.exists(profile_path):
            return None

        try:
            with open(profile_path, "r", encoding="utf-8") as f:
                profile = json.load(f)

            image_exts = {'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'}
            doc_exts = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx', 'zip', 'rar', '7z', 'tar', 'gz'}

            all_files_map = {}

            # 1. Scan Personal folder
            personal_folder = os.path.join(d_folder, "Personal")
            if os.path.exists(personal_folder):
                for f in os.listdir(personal_folder):
                    fp = os.path.join(personal_folder, f)
                    if os.path.isfile(fp):
                        stat = os.stat(fp)
                        ext = f.split('.')[-1].lower() if '.' in f else ''
                        is_img = ext in image_exts
                        all_files_map[f] = {
                            "filename": f,
                            "size_bytes": stat.st_size,
                            "ext": ext,
                            "source": "personal",
                            "source_label": "แฟ้มส่วนบุคคล",
                            "is_image": is_img,
                            "category": "image" if is_img else "document",
                            "mtime": stat.st_mtime
                        }

            # Also check root dossier directory for stray files
            if os.path.exists(d_folder):
                for f in os.listdir(d_folder):
                    if f in ("profile.json", "Personal"):
                        continue
                    fp = os.path.join(d_folder, f)
                    if os.path.isfile(fp) and f not in all_files_map:
                        stat = os.stat(fp)
                        ext = f.split('.')[-1].lower() if '.' in f else ''
                        is_img = ext in image_exts
                        all_files_map[f] = {
                            "filename": f,
                            "size_bytes": stat.st_size,
                            "ext": ext,
                            "source": "personal",
                            "source_label": "แฟ้มส่วนบุคคล",
                            "is_image": is_img,
                            "category": "image" if is_img else "document",
                            "mtime": stat.st_mtime
                        }

            # 2. Scan linked cases (if any shared_files or case files reference this person)
            linked_dossiers = profile.get("linked_dossiers") or []
            linked_cases = profile.get("linked_cases") or []
            case_ids = set()
            
            for ld in linked_dossiers:
                if ld.get("case_id"):
                    case_ids.add(ld.get("case_id"))
                if ld.get("link_reason") and "Case_" in ld.get("link_reason"):
                    m = re.search(r'Case_\w+', ld.get("link_reason"))
                    if m:
                        case_ids.add(m.group(0))
                        
            for lc in linked_cases:
                if isinstance(lc, dict) and lc.get("case_id"):
                    case_ids.add(lc.get("case_id"))
                elif isinstance(lc, str):
                    case_ids.add(lc)

            cases_root = os.path.join(self.root_path, "Cases")
            if os.path.exists(cases_root) and case_ids:
                case_map = self._get_case_folder_map()
                for c_id in case_ids:
                    case_folder = case_map.get(c_id)
                    if not case_folder or not os.path.exists(case_folder):
                        continue
                    for root, dirs, files in os.walk(case_folder):
                        for c_file in files:
                            if c_file in ("metadata.json", "profile.json", "manifest.json"):
                                continue
                            c_fp = os.path.join(root, c_file)
                            if os.path.isfile(c_fp) and c_file not in all_files_map:
                                c_stat = os.stat(c_fp)
                                c_ext = c_file.split('.')[-1].lower() if '.' in c_file else ''
                                c_is_img = c_ext in image_exts
                                all_files_map[c_file] = {
                                    "filename": c_file,
                                    "size_bytes": c_stat.st_size,
                                    "ext": c_ext,
                                    "source": f"case:{c_id}",
                                    "source_label": f"สำนวนคดี {c_id}",
                                    "is_image": c_is_img,
                                    "category": "image" if c_is_img else "document",
                                    "mtime": c_stat.st_mtime
                                }

            file_list = list(all_files_map.values())
            profile["personal_files"] = file_list
            profile["all_files"] = file_list
            profile["documents"] = [f for f in file_list if not f.get("is_image")]
            profile["photos"] = [f for f in file_list if f.get("is_image")]

            # Ensure pea_info is populated from notes/behavior
            if not profile.get("pea_info"):
                from services.graph_engine import _extract_pea_info
                p_info = _extract_pea_info(f"{profile.get('notes') or ''}\n{profile.get('behavior') or ''}")
                if p_info:
                    profile["pea_info"] = p_info

            return profile
        except Exception as e:
            logger.error(f"Failed to read dossier detail for {dossier_id}: {e}")
            return None

    def get_dossier_profile(self, dossier_id: str) -> Optional[Dict[str, Any]]:
        """Alias for get_dossier_detail returning full dossier profile dictionary."""
        return self.get_dossier_detail(dossier_id)

    @_serialize_identity_artifact_writer
    def save_dossier_profile(self, profile: Dict[str, Any]) -> bool:
        """Persist dossier profile dictionary back to disk and refresh index."""
        d_id = profile.get("dossier_id")
        if not d_id:
            return False
        d_folder = self.get_safe_dossier_path(d_id)
        os.makedirs(d_folder, exist_ok=True)
        profile_path = os.path.join(d_folder, "profile.json")
        try:
            profile["updated_at"] = datetime.datetime.now().isoformat()
            with open(profile_path, "w", encoding="utf-8") as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)
            self.rebuild_index()
            return True
        except Exception as e:
            logger.error(f"Failed to save dossier profile for {d_id}: {e}")
            return False

    def get_file_path(self, dossier_id: str, filename: str) -> Optional[str]:
        """Get absolute path to a file inside dossier personal folder or linked cases."""
        # 1. Check Personal folder
        d_folder = self.get_safe_dossier_path(dossier_id)
        file_path = os.path.abspath(os.path.join(d_folder, "Personal", os.path.basename(filename)))
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return file_path

        # 2. Check root dossier folder
        d_folder = self.get_safe_dossier_path(dossier_id)
        root_path = os.path.abspath(os.path.join(d_folder, os.path.basename(filename)))
        if os.path.exists(root_path) and os.path.isfile(root_path):
            return root_path

        # 3. Check Cases folder
        cases_root = os.path.join(self.root_path, "Cases")
        if os.path.exists(cases_root):
            for root, dirs, files in os.walk(cases_root):
                if filename in files:
                    fp = os.path.join(root, filename)
                    if os.path.isfile(fp):
                        return fp

        return None

    @_serialize_identity_artifact_writer
    def upsert_warrant_record(self, warrant: Dict[str, Any], case_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Upsert a warrant record into a person's dossier.
        Finds existing dossier by ID card (13 digits) or full name, or creates a new dossier.
        """
        raw_name = warrant.get("suspect_name") or "ไม่ระบุชื่อ"
        raw_cid = warrant.get("id_card") or warrant.get("clean_id_card")
        clean_cid = re.sub(r'[^0-9]', '', raw_cid) if raw_cid else None
        if clean_cid and len(clean_cid) != 13:
            clean_cid = None

        clean_name = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', raw_name).strip()
        year = 2569

        # 1. Search for existing dossier
        target_dossier_id = None
        if clean_cid:
            matches = self.get_all_dossiers(query=clean_cid)
            if matches:
                target_dossier_id = matches[0].get("dossier_id")
        
        if not target_dossier_id and clean_name and clean_name != "ไม่ระบุชื่อ":
            matches = self.get_all_dossiers(query=clean_name)
            for m in matches:
                if m.get("suspect_name") and clean_name in m.get("suspect_name"):
                    target_dossier_id = m.get("dossier_id")
                    break

        if not target_dossier_id:
            safe_name = re.sub(r'[\\/*?:"<>| ]+', '_', clean_name)
            target_dossier_id = f"{safe_name}_{year}"
            d_folder = self.get_safe_dossier_path(target_dossier_id)
            os.makedirs(os.path.join(d_folder, "Personal"), exist_ok=True)
            prof = {
                "dossier_id": target_dossier_id,
                "suspect_name": raw_name,
                "name_source": "warrant_registry",
                "id_card": clean_cid,
                "phone_number": None,
                "phones": [],
                "role_tag": "ผู้ต้องหาตามหมายจับ",
                "area_tag": warrant.get("station_name"),
                "address": f"{warrant.get('subdistrict', '')} {warrant.get('district', '')} {warrant.get('province', '')}".strip() or None,
                "age": None,
                "category": "warrant",
                "behavior": f"หมายจับเลขที่ {warrant.get('warrant_no', '-')} ({warrant.get('charge', '-')})",
                "year": year,
                "officer_username": "system",
                "platform": "excel_warrant_import",
                "created_at": datetime.datetime.now().isoformat(),
                "updated_at": datetime.datetime.now().isoformat(),
                "notes": f"นำเข้าจากทะเบียนหมายจับ (สภ. {warrant.get('station_name', '-')})",
                "personal_files": [],
                "linked_dossiers": []
            }
        else:
            prof = self.get_dossier_detail(target_dossier_id)
            if not prof:
                prof = {}

        # Update warrant details in profile
        prof["role_tag"] = "ผู้ต้องหาตามหมายจับ"
        if not prof.get("id_card") and clean_cid:
            prof["id_card"] = clean_cid
        
        warrant_info = {
            "warrant_no": warrant.get("warrant_no"),
            "case_no": warrant.get("case_no"),
            "court": warrant.get("court"),
            "station_name": warrant.get("station_name"),
            "charge": warrant.get("charge"),
            "effective_date": warrant.get("effective_date"),
            "expiration_date": warrant.get("expiration_date"),
            "statute_years": warrant.get("statute_years"),
            "remaining_days": warrant.get("remaining_days_int"),
            "countdown_text": warrant.get("countdown_text"),
            "urgency_level": warrant.get("urgency_level"),
            "status": warrant.get("warrant_status") or "มีผลบังคับใช้",
            "photo_filename": warrant.get("photo_filename")
        }
        prof["warrant_info"] = warrant_info
        if case_id:
            linked_cases = prof.setdefault("linked_cases", [])
            if case_id not in linked_cases:
                linked_cases.append(case_id)

        prof_path = os.path.join(self.dossiers_dir, target_dossier_id, "profile.json")
        os.makedirs(os.path.dirname(prof_path), exist_ok=True)
        with open(prof_path, "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, indent=2)

        return prof

    @_serialize_identity_artifact_writer
    def route_photo_to_dossier(self, filename: str, file_content: bytes) -> Optional[Dict[str, Any]]:
        """
        Smart Auto-Routing:
        Matches uploaded photo filename by:
        1. 13-digit Citizen ID in filename (e.g. 3250200835303_... or 3250200835303.jpg)
        2. Exact TR14 photo filename from warrant sheet (warrant_info.photo_filename)
        3. Clean Suspect Name in filename
        If matched, saves the photo into Dossiers/<dossier_id>/Personal/<filename>, sets as photo_path, and updates profile.
        """
        all_dossiers = self.get_all_dossiers()
        if not all_dossiers:
            return None

        # 1. Check for 13-digit ID in filename
        cid_matches = re.findall(r'\d{13}', filename)
        matched_dossier_id = None
        matched_profile = None

        if cid_matches:
            target_cid = cid_matches[0]
            for d in all_dossiers:
                d_id = d.get("dossier_id")
                prof = self.get_dossier_detail(d_id)
                if prof and prof.get("id_card") == target_cid:
                    matched_dossier_id = d_id
                    matched_profile = prof
                    break

        # 2. Check by exact TR14 photo filename or warrant photo_filename
        if not matched_dossier_id:
            for d in all_dossiers:
                d_id = d.get("dossier_id")
                prof = self.get_dossier_detail(d_id)
                if prof:
                    w_info = prof.get("warrant_info") or {}
                    w_photo = w_info.get("photo_filename")
                    if w_photo and (w_photo == filename or filename.startswith(w_photo.split('.')[0])):
                        matched_dossier_id = d_id
                        matched_profile = prof
                        break

        # 3. Check by suspect name in filename
        if not matched_dossier_id:
            clean_fn = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', filename).replace('_', ' ')
            for d in all_dossiers:
                d_id = d.get("dossier_id")
                prof = self.get_dossier_detail(d_id)
                if prof:
                    s_name = prof.get("suspect_name", "")
                    clean_sname = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', s_name).strip()
                    if clean_sname and len(clean_sname) >= 5 and clean_sname in clean_fn:
                        matched_dossier_id = d_id
                        matched_profile = prof
                        break

        if matched_dossier_id and matched_profile:
            # Save physical file to Personal folder
            personal_dir = os.path.join(self.dossiers_dir, matched_dossier_id, "Personal")
            os.makedirs(personal_dir, exist_ok=True)
            target_path = os.path.join(personal_dir, filename)
            with open(target_path, "wb") as f:
                f.write(file_content)

            # Set as primary photo_path and photo_url in profile
            matched_profile["photo_path"] = filename
            matched_profile["photo_url"] = f"/api/nas-bot/dossiers/{matched_dossier_id}/download/{filename}"
            matched_profile["updated_at"] = datetime.datetime.now().isoformat()

            # Record in personal_files if not already listed
            pfiles = matched_profile.setdefault("personal_files", [])
            if not any(pf.get("filename") == filename for pf in pfiles):
                pfiles.insert(0, {
                    "filename": filename,
                    "size_bytes": len(file_content),
                    "saved_at": datetime.datetime.now().isoformat(),
                    "category": "Mugshot"
                })
            
            prof_path = os.path.join(self.dossiers_dir, matched_dossier_id, "profile.json")
            with open(prof_path, "w", encoding="utf-8") as f:
                json.dump(matched_profile, f, ensure_ascii=False, indent=2)

            self.rebuild_index()
            logger.info(f"Smart Auto-Routed photo '{filename}' into Dossier '{matched_dossier_id}' ({matched_profile.get('suspect_name')})")
            return {
                "matched": True,
                "dossier_id": matched_dossier_id,
                "suspect_name": matched_profile.get("suspect_name"),
                "id_card": matched_profile.get("id_card"),
                "photo_path": filename,
                "photo_url": matched_profile["photo_url"]
            }

        return None

    @_serialize_identity_artifact_writer
    def delete_dossier(self, dossier_id: str) -> bool:
        """Delete one stable dossier, unlink peer profiles, and rebuild the index under the shared lock.

        ``dossier_id`` selects the managed folder. The method returns success status and removes dossier metadata,
        Personal evidence, cached peer links, and index membership only when the existing legacy workflow succeeds.
        """
        # Deletion owns the transaction boundary so a coordinator cannot snapshot profiles during unlink/removal.
        d_folder = self.get_safe_dossier_path(dossier_id)
        if not os.path.exists(d_folder):
            return False

        try:
            # 1. Unlink from all other dossiers
            for other_id in os.listdir(self.dossiers_dir):
                if other_id == dossier_id or not os.path.isdir(os.path.join(self.dossiers_dir, other_id)):
                    continue
                other_profile_path = os.path.join(self.dossiers_dir, other_id, "profile.json")
                if os.path.exists(other_profile_path):
                    try:
                        with open(other_profile_path, "r", encoding="utf-8") as f:
                            other_data = json.load(f)
                        
                        original_len = len(other_data.get("linked_dossiers", []))
                        other_data["linked_dossiers"] = [
                            ld for ld in other_data.get("linked_dossiers", [])
                            if ld.get("dossier_id") != dossier_id
                        ]
                        if len(other_data["linked_dossiers"]) != original_len:
                            with open(other_profile_path, "w", encoding="utf-8") as f:
                                json.dump(other_data, f, ensure_ascii=False, indent=2)
                    except Exception as e:
                        logger.warning(f"Error unlinking {dossier_id} from {other_id}: {e}")

            # 2. Delete folder
            shutil.rmtree(d_folder)
            self.rebuild_index()
            logger.info(f"Successfully deleted dossier: {dossier_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete dossier {dossier_id}: {e}")
            return False

    @_serialize_identity_artifact_writer
    def merge_dossiers(self, source_dossier_id: str, target_dossier_id: str, force: bool = False, **kwargs) -> Optional[Dict[str, Any]]:
        """
        Merge source dossier into target dossier:
        1. Validates both dossiers exist.
        2. Consolidates personal_files, cases, and evidence files.
        3. Merges metadata (id_card, phones, address, age, behavior, notes, financial_records).
        4. Re-links all peer links pointing to source_dossier_id so they point to target_dossier_id.
        5. Saves target profile.
        6. Removes source dossier directory.
        7. Rebuilds index and returns the merged profile.
        """
        if not source_dossier_id or not target_dossier_id or source_dossier_id == target_dossier_id:
            logger.warning(f"Invalid merge request: source={source_dossier_id}, target={target_dossier_id}")
            return None

        src_folder = self.get_safe_dossier_path(source_dossier_id)
        dst_folder = self.get_safe_dossier_path(target_dossier_id)
        if not os.path.isdir(src_folder) or not os.path.isdir(dst_folder):
            logger.warning(f"Cannot merge: one or both folders do not exist ({src_folder}, {dst_folder})")
            return None

        src_profile_path = os.path.join(src_folder, "profile.json")
        dst_profile_path = os.path.join(dst_folder, "profile.json")
        if not os.path.exists(src_profile_path) or not os.path.exists(dst_profile_path):
            return None

        try:
            with open(src_profile_path, "r", encoding="utf-8") as sf:
                src_data = json.load(sf)
            with open(dst_profile_path, "r", encoding="utf-8") as df:
                dst_data = json.load(df)

            # 1. Merge Identity Fields
            if not dst_data.get("id_card") and src_data.get("id_card"):
                dst_data["id_card"] = src_data["id_card"]

            # Merge phone numbers
            phones = set()
            for ph in [dst_data.get("phone_number"), *(dst_data.get("phones") or [])]:
                if ph: phones.add(str(ph).strip())
            for ph in [src_data.get("phone_number"), *(src_data.get("phones") or [])]:
                if ph: phones.add(str(ph).strip())
            dst_data["phones"] = sorted(list(phones))
            if not dst_data.get("phone_number") and dst_data["phones"]:
                dst_data["phone_number"] = dst_data["phones"][0]

            # Merge address (prefer more detailed address)
            dst_addr = dst_data.get("address") or ""
            src_addr = src_data.get("address") or ""
            if len(src_addr) > len(dst_addr):
                dst_data["address"] = src_addr

            # Merge age
            if not dst_data.get("age") and src_data.get("age"):
                dst_data["age"] = src_data["age"]

            # Merge role / area tags
            if not dst_data.get("area_tag") and src_data.get("area_tag"):
                dst_data["area_tag"] = src_data["area_tag"]

            # Merge notes & behavior
            src_notes = src_data.get("notes") or ""
            dst_notes = dst_data.get("notes") or ""
            if src_notes and src_notes not in dst_notes:
                dst_data["notes"] = f"{dst_notes}\n[รวมจากแฟ้ม {source_dossier_id}]: {src_notes}".strip()

            src_behav = src_data.get("behavior") or ""
            dst_behav = dst_data.get("behavior") or ""
            if src_behav and src_behav not in dst_behav:
                dst_data["behavior"] = f"{dst_behav}\n[พฤติการณ์เดิม]: {src_behav}".strip()

            # Merge financial records
            dst_fin = dst_data.get("financial_records") or []
            src_fin = src_data.get("financial_records") or []
            for item in src_fin:
                if item not in dst_fin:
                    dst_fin.append(item)
            dst_data["financial_records"] = dst_fin

            # Merge cases
            dst_cases = set(dst_data.get("cases") or [])
            for c in (src_data.get("cases") or []):
                dst_cases.add(c)
            dst_data["cases"] = sorted(list(dst_cases))

            # Merge and preserve Warrant information
            src_warrant = src_data.get("warrant_info")
            dst_warrant = dst_data.get("warrant_info")
            if src_warrant and not dst_warrant:
                dst_data["warrant_info"] = src_warrant
            elif src_warrant and dst_warrant:
                w_list = dst_data.setdefault("warrants", [])
                if dst_warrant not in w_list:
                    w_list.append(dst_warrant)
                if src_warrant not in w_list:
                    w_list.append(src_warrant)

            # Preserve warrant category and role tag
            if src_data.get("category") == "warrant" or dst_data.get("category") == "warrant":
                dst_data["category"] = "warrant"
            if src_data.get("role_tag") == "ผู้ต้องหาตามหมายจับ" or dst_data.get("role_tag") == "ผู้ต้องหาตามหมายจับ":
                dst_data["role_tag"] = "ผู้ต้องหาตามหมายจับ"

            # Prefer valid name over placeholder or CID-prefixed name
            unknown_placeholders = {
                "ไม่ระบุชื่อ", "ไม่ระบุ", "unknown", "บุคคลไม่ระบุชื่อ", "นิรนาม", "บุคคลนิรนาม", "none", "null", ""
            }
            dst_curr_name = (dst_data.get("suspect_name") or "").strip()
            src_curr_name = (src_data.get("suspect_name") or "").strip()
            if src_curr_name and src_curr_name.lower() not in unknown_placeholders:
                if (not dst_curr_name or dst_curr_name.lower() in unknown_placeholders or
                    dst_curr_name.startswith("บุคคล_") or re.match(r'^\d{13}', dst_curr_name)):
                    dst_data["suspect_name"] = re.sub(r'^\d{13}[_\-\s]*', '', src_curr_name).strip() or src_curr_name
                    if src_data.get("name_source"):
                        dst_data["name_source"] = src_data["name_source"]

            # Preserve avatar / photo_url
            if not dst_data.get("photo_url") and src_data.get("photo_url"):
                dst_data["photo_url"] = src_data["photo_url"]
            if not dst_data.get("photo_path") and src_data.get("photo_path"):
                dst_data["photo_path"] = src_data["photo_path"]

            # 2. Copy and merge Personal files & photos
            src_pdir = os.path.join(src_folder, "Personal")
            dst_pdir = os.path.join(dst_folder, "Personal")
            os.makedirs(dst_pdir, exist_ok=True)

            dst_pfiles = dst_data.get("personal_files") or []
            dst_filenames = {pf.get("filename") for pf in dst_pfiles if pf.get("filename")}

            if os.path.isdir(src_pdir):
                for fname in os.listdir(src_pdir):
                    sf_path = os.path.join(src_pdir, fname)
                    if os.path.isfile(sf_path):
                        target_fname = fname
                        df_path = os.path.join(dst_pdir, target_fname)
                        if os.path.exists(df_path):
                            target_fname = f"merged_{source_dossier_id}_{fname}"
                            df_path = os.path.join(dst_pdir, target_fname)
                        shutil.copy2(sf_path, df_path)

                        if target_fname not in dst_filenames:
                            dst_pfiles.append({
                                "filename": target_fname,
                                "category": "Evidence",
                                "saved_at": datetime.datetime.now().isoformat()
                            })
                            dst_filenames.add(target_fname)

            dst_data["personal_files"] = dst_pfiles
            dst_data["updated_at"] = datetime.datetime.now().isoformat()

            # 3. Retarget peer linkages in other dossiers
            for other_id in os.listdir(self.dossiers_dir):
                if other_id in (source_dossier_id, target_dossier_id):
                    continue
                oth_folder = self.get_safe_dossier_path(other_id)
                if not os.path.isdir(oth_folder):
                    continue
                oth_prof = os.path.join(oth_folder, "profile.json")
                if os.path.exists(oth_prof):
                    try:
                        with open(oth_prof, "r", encoding="utf-8") as of:
                            odata = json.load(of)
                        changed = False
                        new_links = []
                        existing_linked_ids = set()
                        for ld in odata.get("linked_dossiers", []):
                            lid = ld.get("dossier_id")
                            if lid == source_dossier_id:
                                changed = True
                                if target_dossier_id not in existing_linked_ids:
                                    ld_copy = dict(ld)
                                    ld_copy["dossier_id"] = target_dossier_id
                                    new_links.append(ld_copy)
                                    existing_linked_ids.add(target_dossier_id)
                            else:
                                if lid not in existing_linked_ids:
                                    new_links.append(ld)
                                    existing_linked_ids.add(lid)
                        if changed:
                            odata["linked_dossiers"] = new_links
                            with open(oth_prof, "w", encoding="utf-8") as of:
                                json.dump(odata, of, ensure_ascii=False, indent=2)
                    except Exception as le:
                        logger.warning(f"Error retargeting links in {other_id}: {le}")

            # Merge source's linked_dossiers into target
            dst_links = dst_data.get("linked_dossiers") or []
            dst_linked_ids = {ld.get("dossier_id") for ld in dst_links if ld.get("dossier_id")}
            for s_link in (src_data.get("linked_dossiers") or []):
                s_lid = s_link.get("dossier_id")
                if s_lid and s_lid != target_dossier_id and s_lid not in dst_linked_ids:
                    dst_links.append(s_link)
                    dst_linked_ids.add(s_lid)
            dst_data["linked_dossiers"] = dst_links

            # Save updated target profile
            with open(dst_profile_path, "w", encoding="utf-8") as df:
                json.dump(dst_data, df, ensure_ascii=False, indent=2)

            # 4. Remove source dossier directory
            shutil.rmtree(src_folder)
            self.rebuild_index()
            logger.info(f"Successfully merged dossier '{source_dossier_id}' into '{target_dossier_id}'")
            return dst_data
        except Exception as e:
            logger.error(f"Error merging dossiers '{source_dossier_id}' into '{target_dossier_id}': {e}")
            return None

    @_serialize_identity_artifact_writer
    def update_dossier_profile(
        self,
        dossier_id: str,
        updates: Dict[str, Any],
        *,
        actor: str = "system",
    ) -> Optional[Dict[str, Any]]:
        """Update allowed dossier fields and return one envelope for identity and narrow writes.

        ``dossier_id`` is the stable storage key, ``updates`` supplies editable profile fields, and
        ``actor`` records the operator for name corrections. Name-bearing requests delegate the whole
        allowed update map to the atomic coordinator, which writes linked identity stores; non-name
        requests retain the legacy profile/index/link side effects. Success returns the authorized full
        dossier plus a sanitized sync summary or ``None``; a missing/non-name failure returns ``None``. The
        shared outer lock also keeps the post-commit response reload in the same snapshot as identity promotion.
        """
        # Name-bearing requests use one coordinated plan so mixed fields cannot commit apart from identity labels.
        if "suspect_name" in updates:
            identity_sync = self.identity_sync_coordinator.apply_update(dossier_id, updates, actor)
            stable_dossier_id = identity_sync["dossier_id"]
            profile = self.get_dossier_detail(stable_dossier_id)
            if profile is None:
                return None

            # Log only approved stable operational fields and aggregate counts; never include profile/update values.
            logger.info(
                "Identity dossier update succeeded dossier_id=%r actor=%r changed_files=%s",
                stable_dossier_id,
                actor,
                identity_sync.get("affected_counts", {}).get("files", 0),
            )
            return {"dossier": profile, "identity_sync": identity_sync}

        # Non-name updates keep the existing narrow write and cross-link behavior on this manager's NAS root.
        d_folder = self.get_safe_dossier_path(dossier_id)
        profile_path = os.path.join(d_folder, "profile.json")
        if not os.path.exists(profile_path):
            return None

        try:
            with open(profile_path, "r", encoding="utf-8") as f:
                profile = json.load(f)

            allowed_fields = [
                "suspect_name", "id_card", "phone_number", "role_tag",
                "area_tag", "address", "age", "category", "behavior", "notes", "photo_url"
            ]
            for field in allowed_fields:
                if field in updates:
                    val = updates[field]
                    profile[field] = val.strip() if isinstance(val, str) else val

            if "phone_number" in updates and updates["phone_number"]:
                ph = str(updates["phone_number"]).strip()
                if ph and ph not in profile.get("phones", []):
                    profile.setdefault("phones", []).append(ph)

            profile["updated_at"] = datetime.datetime.now().isoformat()

            with open(profile_path, "w", encoding="utf-8") as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)

            # Re-evaluate cross-linking with updated network code / area tag
            self._cross_link_dossiers(dossier_id)
            self.rebuild_index()
            # Operational logging includes only stable routing identity and status, never payload/profile contents.
            logger.info(
                "Non-identity dossier update succeeded dossier_id=%r actor=%r",
                dossier_id,
                actor,
            )
            return {"dossier": profile, "identity_sync": None}
        except Exception as exc:
            # Exception text may contain filesystem or private values, so record only its safe type and stable context.
            logger.error(
                "Non-identity dossier update failed dossier_id=%r actor=%r error_type=%s",
                dossier_id,
                actor,
                type(exc).__name__,
            )
            return None

    @_serialize_identity_artifact_writer
    def link_two_dossiers(
        self,
        dossier_id_a: str,
        dossier_id_b: str,
        reason: str = "เจ้าหน้าที่ระบุความเชื่อมโยง",
        relationship_type: Optional[str] = None,
        is_current: bool = True,
        status: str = "current",
        evidence_snippet: Optional[str] = None,
        source_file: Optional[str] = None,
        case_id: Optional[str] = None,
        shared_files: Optional[List[str]] = None
    ) -> bool:
        """Link two stable dossier IDs bidirectionally and rebuild their index under the shared transaction lock.
        
        Handles spouse transitions automatically: if a new current spouse is linked, prior active spouses transition to past/ghost status.
        Stores rich evidence metadata (document text snippet, source file, case_id) if provided.
        """
        # Stable self-links remain rejected before any profile or index side effect occurs.
        if dossier_id_a == dossier_id_b:
            return False

        path_a = os.path.join(self.dossiers_dir, dossier_id_a, "profile.json")
        path_b = os.path.join(self.dossiers_dir, dossier_id_b, "profile.json")
        if not os.path.exists(path_a) or not os.path.exists(path_b):
            return False

        try:
            with open(path_a, "r", encoding="utf-8") as f:
                prof_a = json.load(f)
            with open(path_b, "r", encoding="utf-8") as f:
                prof_b = json.load(f)

            spouse_keywords = ["สามี", "ภรรยา", "เมีย", "ผัว", "คู่สมรส", "แฟน"]
            is_spouse_rel = (
                relationship_type == "spouse" or
                any(k in reason for k in spouse_keywords)
            )
            is_past_rel = (
                not is_current or
                status == "past" or
                any(k in reason for k in ["อดีต", "เคย", "เลิกรา"])
            )

            rel_status = "past" if is_past_rel else "current"
            final_is_current = not is_past_rel

            # Link B into A
            linked_a = prof_a.setdefault("linked_dossiers", [])
            
            # If new active spouse, demote previous active spouse(s) to past status bidirectionally
            if is_spouse_rel and final_is_current:
                for existing in linked_a:
                    ex_id = existing.get("dossier_id")
                    if ex_id and ex_id != dossier_id_b:
                        ex_reason = existing.get("link_reason", "")
                        if (existing.get("relationship_type") == "spouse" or any(k in ex_reason for k in spouse_keywords)) and existing.get("is_current", True):
                            existing["is_current"] = False
                            existing["status"] = "past"
                            existing["relationship_status"] = "past"
                            if "อดีต" not in ex_reason:
                                existing["link_reason"] = f"อดีตคู่สมรส ({ex_reason})"
                            # Also update the counterpart profile
                            ex_path = os.path.join(self.dossiers_dir, ex_id, "profile.json")
                            if os.path.exists(ex_path):
                                try:
                                    with open(ex_path, "r", encoding="utf-8") as f_ex:
                                        p_ex = json.load(f_ex)
                                    for item in p_ex.get("linked_dossiers", []):
                                        if item.get("dossier_id") == dossier_id_a:
                                            item["is_current"] = False
                                            item["status"] = "past"
                                            item["relationship_status"] = "past"
                                            if "อดีต" not in item.get("link_reason", ""):
                                                item["link_reason"] = f"อดีตคู่สมรส ({item.get('link_reason', 'คู่สมรสเดิม')})"
                                    with open(ex_path, "w", encoding="utf-8") as f_ex:
                                        json.dump(p_ex, f_ex, ensure_ascii=False, indent=2)
                                except Exception as err_ex:
                                    logger.warning(f"Failed to demote counterpart spouse {ex_id}: {err_ex}")

            existing_entry_a = next((l for l in linked_a if l.get("dossier_id") == dossier_id_b), None)
            if existing_entry_a:
                existing_entry_a["link_reason"] = reason
                existing_entry_a["is_current"] = final_is_current
                existing_entry_a["status"] = rel_status
                existing_entry_a["relationship_status"] = rel_status
                if is_spouse_rel:
                    existing_entry_a["relationship_type"] = "spouse"
                if evidence_snippet:
                    existing_entry_a["evidence_snippet"] = evidence_snippet
                if source_file:
                    existing_entry_a["source_file"] = source_file
                if case_id:
                    existing_entry_a["case_id"] = case_id
                if shared_files:
                    existing_entry_a["shared_files"] = list(set(existing_entry_a.get("shared_files", []) + shared_files))
            else:
                entry_a = {
                    "dossier_id": dossier_id_b,
                    "suspect_name": str(prof_b.get("suspect_name") or dossier_id_b).strip(" \t\n\r\"'”’“‘"),
                    "role_tag": prof_b.get("role_tag") or "บุคคลเกี่ยวข้อง",
                    "phone_number": prof_b.get("phone_number"),
                    "link_reason": reason,
                    "relationship_type": "spouse" if is_spouse_rel else (relationship_type or "network"),
                    "is_current": final_is_current,
                    "status": rel_status,
                    "relationship_status": rel_status,
                    "shared_files": list(shared_files) if shared_files else []
                }
                if evidence_snippet:
                    entry_a["evidence_snippet"] = evidence_snippet
                if source_file:
                    entry_a["source_file"] = source_file
                if case_id:
                    entry_a["case_id"] = case_id
                linked_a.append(entry_a)

            with open(path_a, "w", encoding="utf-8") as f:
                json.dump(prof_a, f, ensure_ascii=False, indent=2)

            # Link A into B
            linked_b = prof_b.setdefault("linked_dossiers", [])
            
            if is_spouse_rel and final_is_current:
                for existing in linked_b:
                    ex_id = existing.get("dossier_id")
                    if ex_id and ex_id != dossier_id_a:
                        ex_reason = existing.get("link_reason", "")
                        if (existing.get("relationship_type") == "spouse" or any(k in ex_reason for k in spouse_keywords)) and existing.get("is_current", True):
                            existing["is_current"] = False
                            existing["status"] = "past"
                            existing["relationship_status"] = "past"
                            if "อดีต" not in ex_reason:
                                existing["link_reason"] = f"อดีตคู่สมรส ({ex_reason})"
                            # Also update the counterpart profile
                            ex_path = os.path.join(self.dossiers_dir, ex_id, "profile.json")
                            if os.path.exists(ex_path):
                                try:
                                    with open(ex_path, "r", encoding="utf-8") as f_ex:
                                        p_ex = json.load(f_ex)
                                    for item in p_ex.get("linked_dossiers", []):
                                        if item.get("dossier_id") == dossier_id_b:
                                            item["is_current"] = False
                                            item["status"] = "past"
                                            item["relationship_status"] = "past"
                                            if "อดีต" not in item.get("link_reason", ""):
                                                item["link_reason"] = f"อดีตคู่สมรส ({item.get('link_reason', 'คู่สมรสเดิม')})"
                                    with open(ex_path, "w", encoding="utf-8") as f_ex:
                                        json.dump(p_ex, f_ex, ensure_ascii=False, indent=2)
                                except Exception as err_ex:
                                    logger.warning(f"Failed to demote counterpart spouse {ex_id}: {err_ex}")

            existing_entry_b = next((l for l in linked_b if l.get("dossier_id") == dossier_id_a), None)
            if existing_entry_b:
                existing_entry_b["link_reason"] = reason
                existing_entry_b["is_current"] = final_is_current
                existing_entry_b["status"] = rel_status
                existing_entry_b["relationship_status"] = rel_status
                if is_spouse_rel:
                    existing_entry_b["relationship_type"] = "spouse"
                if evidence_snippet:
                    existing_entry_b["evidence_snippet"] = evidence_snippet
                if source_file:
                    existing_entry_b["source_file"] = source_file
                if case_id:
                    existing_entry_b["case_id"] = case_id
                if shared_files:
                    existing_entry_b["shared_files"] = list(set(existing_entry_b.get("shared_files", []) + shared_files))
            else:
                entry_b = {
                    "dossier_id": dossier_id_a,
                    "suspect_name": str(prof_a.get("suspect_name") or dossier_id_a).strip(" \t\n\r\"'”’“‘"),
                    "role_tag": prof_a.get("role_tag") or "บุคคลเกี่ยวข้อง",
                    "phone_number": prof_a.get("phone_number"),
                    "link_reason": reason,
                    "relationship_type": "spouse" if is_spouse_rel else (relationship_type or "network"),
                    "is_current": final_is_current,
                    "status": rel_status,
                    "relationship_status": rel_status,
                    "shared_files": list(shared_files) if shared_files else []
                }
                if evidence_snippet:
                    entry_b["evidence_snippet"] = evidence_snippet
                if source_file:
                    entry_b["source_file"] = source_file
                if case_id:
                    entry_b["case_id"] = case_id
                linked_b.append(entry_b)

            with open(path_b, "w", encoding="utf-8") as f:
                json.dump(prof_b, f, ensure_ascii=False, indent=2)

            self.rebuild_index()
            logger.info(f"Explicitly linked dossiers {dossier_id_a} <-> {dossier_id_b} with reason: {reason} (status={rel_status})")
            return True
        except Exception as e:
            logger.error(f"Failed to link dossiers {dossier_id_a} and {dossier_id_b}: {e}")
            return False

    @_serialize_identity_artifact_writer
    def unlink_two_dossiers(self, dossier_id_a: str, dossier_id_b: str) -> bool:
        """Remove cached links between two stable dossiers and rebuild the index under the shared lock.

        The two IDs select managed profiles; the method returns legacy success status and may rewrite both profiles
        plus the dossier index while preserving the dossier folders and all evidence content.
        """
        # The lock covers both profile edits and the rebuild so identity planning cannot observe a one-sided unlink.
        path_a = os.path.join(self.dossiers_dir, dossier_id_a, "profile.json")
        path_b = os.path.join(self.dossiers_dir, dossier_id_b, "profile.json")

        try:
            if os.path.exists(path_a):
                with open(path_a, "r", encoding="utf-8") as f:
                    prof_a = json.load(f)
                prof_a["linked_dossiers"] = [l for l in prof_a.get("linked_dossiers", []) if l.get("dossier_id") != dossier_id_b]
                with open(path_a, "w", encoding="utf-8") as f:
                    json.dump(prof_a, f, ensure_ascii=False, indent=2)

            if os.path.exists(path_b):
                with open(path_b, "r", encoding="utf-8") as f:
                    prof_b = json.load(f)
                prof_b["linked_dossiers"] = [l for l in prof_b.get("linked_dossiers", []) if l.get("dossier_id") != dossier_id_a]
                with open(path_b, "w", encoding="utf-8") as f:
                    json.dump(prof_b, f, ensure_ascii=False, indent=2)

            self.rebuild_index()
            logger.info(f"Unlinked dossiers {dossier_id_a} <-> {dossier_id_b}")
            return True
        except Exception as e:
            logger.error(f"Failed to unlink dossiers {dossier_id_a} and {dossier_id_b}: {e}")
            return False

    @_serialize_identity_artifact_writer
    def prune_auto_generated_links(
        self,
        case_id: Optional[str] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """Prune generic batch auto-links (e.g. 'ร่วมสำนวนคดีเดียวกัน', 'อยู่ในชุดเอกสารคดีเดียวกัน')
        created by multi-document ingestion cliques, while preserving explicit family, spouse,
        phone, and custom relations.
        Also cleans up any bloated (ไฟล์: ...) substrings in remaining link reasons.
        """
        pruned_count = 0
        cleaned_count = 0
        affected_dossiers: Set[str] = set()
        details: List[Dict[str, Any]] = []

        try:
            if not os.path.isdir(self.dossiers_dir):
                return {"status": "success", "pruned_count": 0, "cleaned_count": 0, "affected_dossiers": 0, "details": []}

            for entry in os.listdir(self.dossiers_dir):
                d_dir = os.path.join(self.dossiers_dir, entry)
                if not os.path.isdir(d_dir):
                    continue
                prof_path = os.path.join(d_dir, "profile.json")
                if not os.path.exists(prof_path):
                    continue

                try:
                    with open(prof_path, "r", encoding="utf-8") as f:
                        prof = json.load(f)
                except Exception as e:
                    logger.warning(f"Could not read profile {entry}: {e}")
                    continue

                linked = prof.get("linked_dossiers") or []
                if not linked:
                    continue

                new_linked = []
                profile_changed = False

                for link in linked:
                    target_id = link.get("dossier_id")
                    rel_type = (link.get("relationship_type") or "").strip()
                    reason = (link.get("link_reason") or "").strip()
                    link_case = (link.get("case_id") or "").strip()

                    # Check if generic batch link or bogus batch spouse cross-link
                    is_bogus_batch_spouse = (
                        "ชีวานนต์_ความหมั่น_2569" in reason and
                        ("อดีตคู่สมรส" in reason or "คู่สมรส" in reason) and
                        not ((entry == "เอกลักษณ์_ความหมั่น_2569" and target_id == "พรรัตน์_พันเทศ_2569") or
                             (entry == "พรรัตน์_พันเทศ_2569" and target_id == "เอกลักษณ์_ความหมั่น_2569"))
                    )

                    is_generic_batch = (
                        is_bogus_batch_spouse or (
                            rel_type not in ["spouse", "family", "parent_child"] and
                            ("ร่วมสำนวนคดีเดียวกัน" in reason or "อยู่ในชุดเอกสารคดีเดียวกัน" in reason)
                        )
                    )

                    matches_case = True
                    if case_id:
                        matches_case = (link_case == case_id or case_id in reason)

                    if is_generic_batch and matches_case:
                        pruned_count += 1
                        affected_dossiers.add(entry)
                        profile_changed = True
                        details.append({
                            "from": entry,
                            "to": target_id,
                            "reason": reason[:80],
                            "rel_type": rel_type
                        })
                    else:
                        # Retain link, but clean up bloated file strings if present
                        if "(ไฟล์:" in reason:
                            cleaned_reason = re.sub(r'\s*\(ไฟล์:[^)]*\)', '', reason).strip()
                            if cleaned_reason != reason:
                                link["link_reason"] = cleaned_reason
                                cleaned_count += 1
                                profile_changed = True
                        new_linked.append(link)

                if profile_changed and not dry_run:
                    prof["linked_dossiers"] = new_linked
                    with open(prof_path, "w", encoding="utf-8") as f:
                        json.dump(prof, f, ensure_ascii=False, indent=2)

            if not dry_run and (pruned_count > 0 or cleaned_count > 0):
                self.rebuild_index()
                logger.info(f"Pruned {pruned_count} auto-links, cleaned {cleaned_count} reasons across {len(affected_dossiers)} dossiers.")

            return {
                "status": "success",
                "pruned_count": pruned_count,
                "cleaned_count": cleaned_count,
                "affected_dossiers": len(affected_dossiers),
                "details": details[:50]
            }
        except Exception as e:
            logger.error(f"Error in prune_auto_generated_links: {e}")
            return {"status": "error", "error": str(e), "pruned_count": 0}

    @_serialize_identity_artifact_writer
    def delete_dossier_file(self, dossier_id: str, filename: str) -> Dict[str, Any]:
        """Delete an individual file/photo from a dossier and disk storage under shared lock."""
        d_dir = os.path.join(self.dossiers_dir, dossier_id)
        if not os.path.isdir(d_dir):
            raise FileNotFoundError(f"ไม่พบแฟ้มข้อมูล {dossier_id}")

        prof_path = os.path.join(d_dir, "profile.json")
        if not os.path.exists(prof_path):
            raise FileNotFoundError(f"ไม่พบไฟล์ประวัติของแฟ้ม {dossier_id}")

        with open(prof_path, "r", encoding="utf-8") as f:
            prof = json.load(f)

        # 1. Search and delete the physical file on disk (Root, Personal/, Evidence/, etc.)
        deleted_path = None
        for root, dirs, files in os.walk(d_dir):
            for fn in files:
                if fn == filename:
                    target_file = os.path.join(root, fn)
                    try:
                        os.remove(target_file)
                        deleted_path = target_file
                        logger.info(f"Deleted physical file {target_file}")
                    except Exception as err:
                        logger.error(f"Failed to delete physical file {target_file}: {err}")

        # 2. Clean references in profile.json
        if "photos" in prof:
            prof["photos"] = [p for p in prof["photos"] if p != filename and not p.endswith("/" + filename)]
        if "evidence_files" in prof:
            prof["evidence_files"] = [e for e in prof["evidence_files"] if e != filename and not e.endswith("/" + filename)]
        if "personal_files" in prof:
            prof["personal_files"] = [pf for pf in prof["personal_files"] if pf.get("filename") != filename]

        # Check photo_path
        cur_photo = prof.get("photo_path")
        if cur_photo and (cur_photo == filename or cur_photo.endswith("/" + filename)):
            if prof.get("photos") and len(prof["photos"]) > 0:
                prof["photo_path"] = prof["photos"][0]
            else:
                prof["photo_path"] = None

        with open(prof_path, "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, indent=2)

        self.rebuild_index()
        return {
            "success": True,
            "deleted_file": filename,
            "deleted_path": deleted_path,
            "dossier": self.get_dossier_detail(dossier_id)
        }

    @_serialize_identity_artifact_writer
    def sync_all_existing_cases(self) -> Dict[str, Any]:
        """Ingest historical cases/demo images and return counts after serialized dossier/index updates.

        The configured NAS root and existing demonstration-image locations supply OCR metadata and evidence. The
        method returns sync status/counts and may create or enrich dossier profiles, Personal files, links, parcels,
        and the index; one shared lock prevents the batch from interleaving with an officer correction transaction.
        """
        # Holding one re-entrant boundary across the batch also covers nested upsert, cross-link, and rebuild calls.
        synced_count = 0
        from services.ai_ocr import extract_document_data

        # 1. Sync from /tmp images (the 5 intelligence test images)
        tmp_img_map = {
            "img1.jpg": "TR14_อรอุมา_วายทุกข์.jpg",
            "img2.jpg": "TR14_ณัฐชัย_แปลงดี.jpg",
            "img3.jpg": "TR14_สุภาพ_งึดเกาะ.jpg",
            "img4.jpg": "สมุดจดเบอร์เครือข่าย.jpg",
            "img5.jpg": "TR14_ประสิทธิ์พร_ศรีฮาด.jpg"
        }
        for img_name, target_fname in tmp_img_map.items():
            img_path = os.path.join("/tmp", img_name)
            if os.path.exists(img_path):
                try:
                    with open(img_path, "rb") as f:
                        img_bytes = f.read()
                    res = extract_document_data(img_bytes, img_name)
                    suspects = res.get("suspects", [])
                    behavior = res.get("behavior")
                    
                    if res.get("is_phone_list"):
                        # Record into structured phone sheets rather than creating dummy dossiers
                        sheets_file = os.path.join(self.root_path, "phone_sheets.json")
                        sheets_data = {}
                        if os.path.exists(sheets_file):
                            try:
                                with open(sheets_file, "r", encoding="utf-8") as sf:
                                    sheets_data = json.load(sf)
                            except Exception:
                                sheets_data = {}
                        
                        for s in suspects:
                            ph = s.get("phone_number")
                            tag = s.get("area_tag") or "ทั่วไป"
                            idx = s.get("index") or 1
                            sheet_key = tag
                            if sheet_key not in sheets_data:
                                sheets_data[sheet_key] = {
                                    "sheet_id": f"sheet_{sheet_key}",
                                    "sheet_name": f"โพยชุด {sheet_key}",
                                    "tag": sheet_key,
                                    "items": []
                                }
                            existing_item = next((it for it in sheets_data[sheet_key]["items"] if it.get("phone_number") == ph), None)
                            if not existing_item:
                                sheets_data[sheet_key]["items"].append({
                                    "index": idx,
                                    "phone_number": ph,
                                    "aliases": [],
                                    "actual_user_dossier": None,
                                    "actual_user_name": None,
                                    "role_tag": "เบอร์ในโพย"
                                })
                        try:
                            with open(sheets_file, "w", encoding="utf-8") as sf:
                                json.dump(sheets_data, sf, ensure_ascii=False, indent=2)
                        except Exception as e:
                            logger.error(f"Failed to save phone_sheets.json: {e}")
                        synced_count += 1
                    else:
                        for s in suspects:
                            self.upsert_dossier(
                                suspect_name=s.get("suspect_name") or "ไม่ระบุชื่อ",
                                id_card=s.get("id_card"),
                                phone_number=s.get("phone_number"),
                                role_tag=s.get("role_tag") or "ผู้ต้องหา",
                                area_tag=s.get("area_tag"),
                                address=s.get("address"),
                                age=s.get("age"),
                                category="drug",
                                behavior=behavior,
                                notes=f"เอกสาร ทร.14 นำเข้าอัตโนมัติ ({target_fname})",
                                officer_username="admin",
                                platform="sync",
                                files=[{"filename": target_fname, "content": img_bytes}]
                            )
                            synced_count += 1
                except Exception as err:
                    logger.error(f"Failed to sync {img_name}: {err}")

        # 2. Sync from historical NAS Cases folder
        cases_root = os.path.join(self.root_path, "Cases")
        if os.path.exists(cases_root):
            for root, dirs, files in os.walk(cases_root):
                if "metadata.json" in files:
                    try:
                        meta_file = os.path.join(root, "metadata.json")
                        with open(meta_file, "r", encoding="utf-8") as f:
                            meta = json.load(f)

                        suspects = meta.get("suspects", [])
                        notes = meta.get("notes", "")
                        behavior = meta.get("behavior", "")
                        officer = meta.get("officer_username", "admin")
                        
                        # Collect real file contents
                        case_files = []
                        for cat in ["Documents", "Photos", "Videos"]:
                            cat_dir = os.path.join(root, cat)
                            if os.path.exists(cat_dir):
                                for fn in os.listdir(cat_dir):
                                    fp = os.path.join(cat_dir, fn)
                                    if os.path.isfile(fp):
                                        with open(fp, "rb") as cf:
                                            case_files.append({"filename": fn, "content": cf.read()})

                        for s in (suspects if suspects else [{}]):
                            s_name = s.get("suspect_name")
                            if not s_name or s_name == "ไม่ระบุชื่อ":
                                for cf in case_files:
                                    m_fn = re.search(r'(นาย|นางสาว|นาง|น\.ส\.)\s*([^\s.]+)', cf.get("filename", ""))
                                    if m_fn:
                                        s_name = f"{m_fn.group(1)}{m_fn.group(2)}"
                                        break
                            if not s_name:
                                continue

                            self.upsert_dossier(
                                suspect_name=s_name,
                                id_card=s.get("id_card"),
                                phone_number=s.get("phone_number"),
                                role_tag=s.get("role_tag") or "ผู้ต้องหา",
                                area_tag=s.get("area_tag"),
                                address=s.get("address"),
                                age=s.get("age"),
                                category="drug" if "ยา" in (notes + behavior) else "general",
                                behavior=behavior,
                                notes=notes,
                                officer_username=officer,
                                platform="sync",
                                files=case_files
                            )
                            synced_count += 1
                    except Exception as err:
                        logger.error(f"Error syncing case at {root}: {err}")

        self.rebuild_index()
        return {"status": "success", "synced_count": synced_count, "total_dossiers": len(self._load_index())}

