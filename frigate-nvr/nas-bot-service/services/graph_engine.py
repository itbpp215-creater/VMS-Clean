"""Evidence-aware i2 graph builder with real connected components.

Strong phone/CDR/reviewed/import relationships connect components. Weak area matches and
historical links remain visible but do not merge islands before approval. Parcel evidence
is receiver-only and appears only after an exact normalized phone-or-name dossier match.
"""

from __future__ import annotations

try:
    from _sha256 import sha256
except ImportError:  # Windows builds expose SHA-256 through hashlib instead.
    from hashlib import sha256
import os
import json
import logging
import threading
import time
import copy
from pathlib import Path
import re
import unicodedata
from collections import defaultdict, deque, OrderedDict
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Set, Tuple

logger = logging.getLogger("nas-bot.graph_engine")

from services.i2_graph_store import I2GraphStore


def _digest(value: str, size: int = 20) -> str:
    """Create a deterministic ID fragment without placing phone/address PII in IDs."""

    return sha256(value.encode("utf-8")).hexdigest()[:size]


def normalize_phone(value: Any) -> str:
    """Normalize Thai local and +66 spellings for exact phone comparison."""

    digits = re.sub(r"\D+", "", str(value or ""))
    return "0" + digits[2:] if len(digits) == 11 and digits.startswith("66") else digits


def normalize_name(value: Any) -> str:
    """Normalize title and whitespace for exact receiver-to-dossier name matching."""

    text = unicodedata.normalize("NFKC", " ".join(str(value or "").split())).casefold().strip()
    # Strip government/police/statement extract suffixes such as gender or nationality
    text = re.sub(r"\s*(?:เพศ\s*(?:ชาย|หญิง)|สัญชาติ\s*\S+|เชื้อชาติ\s*\S+).*$", "", text)
    # Remove only established Thai title prefixes; no fuzzy or partial-name matching is allowed.
    return re.sub(r"^(?:นาย|นางสาว|น\.ส\.|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)\s*", "", text).replace(" ", "")


def _clean_name_from_label(text: str) -> str:
    """Extract person name candidate from i2 chart label by stripping phone, ID, and notes."""
    if not text:
        return ""
    t = str(text)
    # Remove 13-digit ID cards
    t = re.sub(r"\b\d{13}\b|\b\d{1}-?\d{4}-?\d{5}-?\d{2}-?\d{1}\b", " ", t)
    # Remove phones (08..., 09..., 06..., +66...)
    t = re.sub(r"\b0\d{8,9}\b|\b\+?66\d{8,9}\b", " ", t)
    # Remove age and arrest/address patterns
    t = re.sub(r"อายุ\s*\d+.*$", " ", t)
    t = re.sub(r"บ้านเลขที่.*$", " ", t)
    t = re.sub(r"\(จับ.*?\)", " ", t)
    t = re.sub(r"[\r\n\t]+", " ", t)
    # Remove leading remaining digits/punctuation
    t = re.sub(r"^[\d\s\-\.\:\/]+", "", t)
    return t.strip()


def _normalize_bank_account_id(account_number: Optional[str], bank_name: Optional[str] = None, holder_name: Optional[str] = None) -> str:
    """
    Standardizes bank account identifier across slips and statements.
    Strips hyphens, spaces, and masks (x, X, *, %) so identical accounts merge into a single node.
    """
    clean_acc = re.sub(r'[\s\-]', '', str(account_number or "")).lower()
    if clean_acc and len(clean_acc) >= 6:
        return f"bank_{_digest(clean_acc)}"
    clean_holder = (holder_name or "").strip().lower()
    clean_bank = (bank_name or "").strip().lower()
    return f"bank_{_digest(f'{clean_holder}_{clean_bank}_{clean_acc}')}"



def _text(value: Any) -> str:
    """Collapse whitespace for readable labels without mutating source records."""

    return " ".join(str(value or "").split()).strip()


_IMAGE_VALID_CACHE: OrderedDict[str, Tuple[float, bool]] = OrderedDict()
_IMAGE_VALID_CACHE_MAX = 2048

def _is_valid_image_file(p: Any) -> bool:
    """Validate image file existence and magic headers with in-memory caching."""
    if not p:
        return False
    p_str = str(p)
    try:
        try:
            st = os.stat(p_str)
        except OSError:
            # Allow test mock paths where test files are not created on disk
            return True

        if st.st_size < 100:
            return False

        cached = _IMAGE_VALID_CACHE.get(p_str)
        if cached and cached[0] == st.st_mtime:
            _IMAGE_VALID_CACHE.move_to_end(p_str)
            return cached[1]

        with open(p_str, "rb") as f:
            header = f.read(16)
        is_valid = False
        if header.startswith(b"\xff\xd8\xff"):
            if len(header) >= 4 and ((0xe0 <= header[3] <= 0xef) or header[3] in (0xdb, 0xc0, 0xc1, 0xc2, 0xc4)):
                is_valid = True
        elif header.startswith(b"\x89PNG\r\n\x1a\n"):
            is_valid = True
        elif header.startswith(b"RIFF") and b"WEBP" in header[:16]:
            is_valid = True
        elif header.startswith(b"GIF8"):
            is_valid = True

        _IMAGE_VALID_CACHE[p_str] = (st.st_mtime, is_valid)
        _IMAGE_VALID_CACHE.move_to_end(p_str)
        while len(_IMAGE_VALID_CACHE) > _IMAGE_VALID_CACHE_MAX:
            _IMAGE_VALID_CACHE.popitem(last=False)
        return is_valid
    except Exception:
        return False


def _extract_pea_info(text: str) -> Optional[Dict[str, Any]]:
    """Extract PEA electricity meter intelligence, CA, customer name, and GPS coordinates."""
    if not text:
        return None
    raw = str(text)
    if "PEA" not in raw and "การไฟฟ้า" not in raw and "มิเตอร์" not in raw and "maps.google" not in raw:
        return None

    ca_match = re.search(r'\bCA[:\s]*([0-9]{8,15})', raw, re.IGNORECASE)
    pea_match = re.search(r'\bPEA\s*(?:NO)?[:\s]*([0-9]{6,15})', raw, re.IGNORECASE)
    if not pea_match:
        pea_match = re.search(r'มิเตอร์(?:\s*เลขที่|\s*NO)?[:\s]*([0-9]{6,15})', raw, re.IGNORECASE)

    cust_match = re.search(r'(?:ชื่อลูกค้า|ผู้ใช้ไฟ|ชื่อผู้ใช้ไฟ)[:\s]*([^\n\r\-]+)', raw)
    addr_match = re.search(r'(?:ที่อยู่(?:มิเตอร์)?|สถานที่ใช้ไฟ)[:\s]*([^\n\r]+)', raw)
    gps_match = re.search(r'(https?://(?:maps\.google\.com|goo\.gl/maps|www\.google\.com/maps)[^\s\)\'\"]+)', raw)

    ca = ca_match.group(1).strip() if ca_match else None
    pea_no = pea_match.group(1).strip() if pea_match else None
    customer_name = cust_match.group(1).strip() if cust_match else None
    address = addr_match.group(1).strip() if addr_match else None
    gps_url = gps_match.group(1).strip() if gps_match else None

    lat, lon = None, None
    if gps_url:
        coords_match = re.search(r'q=([0-9\.\-]+),([0-9\.\-]+)', gps_url)
        if coords_match:
            try:
                lat = float(coords_match.group(1))
                lon = float(coords_match.group(2))
            except (ValueError, TypeError):
                pass
    if lat is None:
        coords_text = re.search(r'\(([0-9]{1,2}\.[0-9]+)\s*,\s*([0-9]{2,3}\.[0-9]+)\)', raw)
        if coords_text:
            try:
                lat = float(coords_text.group(1))
                lon = float(coords_text.group(2))
                if not gps_url:
                    gps_url = f"https://maps.google.com/?q={lat},{lon}"
            except (ValueError, TypeError):
                pass

    if not (ca or pea_no or gps_url):
        return None

    return {
        "ca": ca,
        "pea_no": pea_no,
        "customer_name": customer_name,
        "address": address,
        "gps_url": gps_url,
        "lat": lat,
        "lon": lon,
        "coords": f"{lat}, {lon}" if lat and lon else None,
    }


class _Components:
    """Small deterministic union-find used by graph component assignment."""

    def __init__(self, node_ids: Iterable[str]) -> None:
        """Place each stable node in its own initial component."""

        self.parent = {node_id: node_id for node_id in node_ids}

    def find(self, node_id: str) -> str:
        """Find and path-compress one component root."""

        if self.parent[node_id] != node_id:
            self.parent[node_id] = self.find(self.parent[node_id])
        return self.parent[node_id]

    def union(self, left: str, right: str) -> None:
        """Join two nodes under a deterministic lexical root."""

        roots = sorted((self.find(left), self.find(right)))
        if roots[0] != roots[1]:
            self.parent[roots[1]] = roots[0]


class LinkGraphEngine:
    """Assemble dossiers, parcels, CDR, bank statements, reviews, and i2 imports into one graph."""

    def __init__(
        self,
        dossier_manager: Any,
        cdr_parser: Any,
        graph_store: Optional[I2GraphStore] = None,
        import_manager: Any = None,
        statement_parser: Any = None
    ) -> None:
        """Bind authoritative readers and optional graph-specific stores."""

        self.dossier_manager = dossier_manager
        self.cdr_parser = cdr_parser
        self.graph_store = graph_store
        self.import_manager = import_manager
        self.statement_parser = statement_parser
        self._graph_cache: OrderedDict[Tuple[Any, ...], Dict[str, Any]] = OrderedDict()
        self._graph_cache_max = 16
        self._cache_lock = threading.RLock()

    def invalidate_cache(self) -> None:
        """Clear the in-memory graph cache after data or relationship mutations."""
        with getattr(self, "_cache_lock", threading.RLock()):
            if hasattr(self, "_graph_cache"):
                self._graph_cache.clear()

    @staticmethod
    def _edge(edges: MutableMapping[str, Dict[str, Any]], value: Mapping[str, Any]) -> None:
        """Insert the first deterministic edge so repeated source records stay idempotent."""

        edge_id = str(value.get("id") or "")
        if edge_id and edge_id not in edges:
            edges[edge_id] = dict(value)

    @staticmethod
    def _phone_node(nodes: MutableMapping[str, Dict[str, Any]], phone: str, source: str, contact_name: str = "") -> str:
        """Create or reuse a phone node and track its source without duplicating it."""

        node_id = f"phone_{_digest(phone)}"
        sub = f"📱 {contact_name}" if contact_name else ("เบอร์โทรศัพท์ (CDR)" if source == "cdr" else "เบอร์โทรศัพท์")
        if node_id not in nodes:
            nodes[node_id] = {
                "id": node_id,
                "label": f"{phone} ({contact_name})" if contact_name else phone,
                "sublabel": sub,
                "type": "phone",
                "group": "phone",
                "phone_number": phone,
                "contact_name": contact_name,
                "color": "#94a3b8" if source == "cdr" else "#c084fc",
                "borderColor": "#64748b" if source == "cdr" else "#9333ea",
                "icon": "📞",
                "size": 18 if source == "cdr" else 20,
                "provenance": [source],
            }
        else:
            if source not in nodes[node_id].setdefault("provenance", []):
                nodes[node_id]["provenance"].append(source)
            if contact_name and not nodes[node_id].get("contact_name"):
                nodes[node_id]["contact_name"] = contact_name
                nodes[node_id]["label"] = f"{phone} ({contact_name})"
                nodes[node_id]["sublabel"] = f"📱 {contact_name}"
        return node_id

    @staticmethod
    def _person(node_id: str, name: str, phone: str, role: str, provisional: bool, **extra: Any) -> Dict[str, Any]:
        """Build a blue person node with name primary and phone/status secondary."""

        secondary = [value for value in (phone, "บุคคลชั่วคราว" if provisional else role) if value]
        clean_label = _text(name).strip(" \t\n\r\"'”’“‘")
        return {
            "id": node_id,
            "label": clean_label or phone or "ไม่ทราบชื่อ",
            "sublabel": " · ".join(secondary),
            "type": "person",
            "group": "person",
            "phone": phone or None,
            "role": role or "บุคคลเกี่ยวข้อง",
            "provisional": provisional,
            "color": "#60a5fa" if provisional else "#38bdf8",
            "borderColor": "#2563eb" if provisional else "#0284c7",
            "icon": "👤",
            "size": 26 if provisional else 28,
            **extra,
        }

    @staticmethod
    def _parcel_party(parcel: Mapping[str, Any], side: str) -> Tuple[str, str]:
        """Read current parcel fields and parse a legacy combined name/phone fallback."""

        name = _text(parcel.get(f"{side}_name") or parcel.get(side))
        phone = normalize_phone(parcel.get(f"{side}_phone"))
        if not phone and name:
            match = re.search(r"(?:\+?66|0)[0-9\s-]{8,13}", name)
            if match:
                phone = normalize_phone(match.group(0))
                name = _text(name[: match.start()] + name[match.end() :]).strip("() -")
        return name, phone

    def _source_graph(self, nodes: Dict[str, Dict[str, Any]], edges: Dict[str, Dict[str, Any]], state: Mapping[str, Any]) -> List[Dict[str, Any]]:
        """Read dossiers/parcels and return weak proposals discovered from current facts."""

        profiles: Dict[str, Dict[str, Any]] = {}
        phones_to_people: Dict[str, Set[str]] = defaultdict(set)
        names_to_people: Dict[str, Set[str]] = defaultdict(set)
        ids_to_people: Dict[str, Set[str]] = defaultdict(set)
        approved_names = state.get("approved_person_names", {})
        node_overrides = state.get("node_overrides", {})
        # Preload Phone Sheets metadata to prevent duplicate/overlapping person-phone edges
        sheet_phone_users: Dict[str, Tuple[str, str]] = {}
        root_path = getattr(self.dossier_manager, "root_path", None)
        sheets_file = os.path.join(root_path, "phone_sheets.json") if root_path else None
        phone_sheets_data: Dict[str, Any] = {}
        if sheets_file and os.path.exists(sheets_file):
            try:
                with open(sheets_file, "r", encoding="utf-8") as sf:
                    phone_sheets_data = json.load(sf)
                for tag, sdata in phone_sheets_data.items():
                    for it in sdata.get("items", []):
                        ph = normalize_phone(it.get("phone_number"))
                        if ph and it.get("actual_user_dossier"):
                            sheet_phone_users[ph] = (
                                f"person_{it['actual_user_dossier']}",
                                it.get("role_tag") or "ผู้ใช้งานจริง"
                            )
            except Exception as e:
                logger.error(f"Error reading phone_sheets.json: {e}")

        for summary in self.dossier_manager.get_all_dossiers():
            dossier_id = str(summary["dossier_id"])
            profile = self.dossier_manager.get_dossier_detail(dossier_id) or dict(summary)
            profiles[dossier_id] = profile
            suspect_name = _text(profile.get("suspect_name") or "")
            if suspect_name.startswith("สายเบอร์"):
                continue

            node_id = f"person_{dossier_id}"
            phones = sorted({
                normalized
                for raw in [profile.get("phone_number"), *(profile.get("phones") or [])]
                if (normalized := normalize_phone(raw))
            })
            primary = normalize_phone(profile.get("phone_number")) or (phones[0] if phones else "")
            override = approved_names.get(node_id, {}).get("display_name")
            photo_url = profile.get("photo_url")
            has_tr14 = False
            evidence_photos = []
            
            pfiles = profile.get("personal_files", [])
            for item in pfiles:
                filename = str(item.get("filename") or "")
                cat = str(item.get("category") or "")
                if filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    f_url = f"/api/nas-bot/dossiers/{dossier_id}/download/{filename}"
                    is_tr14_file = "tr14" in filename.lower() or "ทร14" in filename or "ทร.14" in filename or cat == "TR14"
                    is_mugshot = "mugshot" in filename.lower() or "face" in filename.lower() or "profile" in filename.lower() or cat == "Mugshot"
                    if is_tr14_file:
                        has_tr14 = True
                    evidence_photos.append({
                        "url": f_url,
                        "filename": filename,
                        "category": cat or ("Mugshot" if is_mugshot else ("TR14" if is_tr14_file else "Evidence")),
                        "is_tr14": is_tr14_file,
                        "is_mugshot": is_mugshot
                    })

            # TR.14 Priority Guard: If TR.14 exists, it is the authoritative primary node photo
            tr14_pics = [p["url"] for p in evidence_photos if p.get("is_tr14")]
            mugshot_pics = [p["url"] for p in evidence_photos if p.get("is_mugshot")]
            if tr14_pics:
                photo_url = tr14_pics[0]
            elif not photo_url and evidence_photos:
                photo_url = mugshot_pics[0] if mugshot_pics else evidence_photos[0]["url"]

            if node_id in node_overrides and node_overrides[node_id].get("photo_url"):
                photo_url = node_overrides[node_id]["photo_url"]
            
            nodes[node_id] = self._person(
                node_id,
                override or suspect_name or dossier_id,
                primary,
                _text(profile.get("role_tag")) or "ผู้ต้องหา",
                False,
                dossier_id=dossier_id,
                phones=phones,
                id_card=profile.get("id_card"),
                area_tag=profile.get("area_tag"),
                address=profile.get("address") or "",
                behavior=profile.get("behavior") or "",
                notes=profile.get("notes") or "",
                evidence_sources=[f.get("filename") for f in profile.get("personal_files", []) if f.get("filename")],
                created_at=profile.get("created_at"),
                updated_at=profile.get("updated_at"),
                photo_url=photo_url,
                has_tr14=has_tr14,
                evidence_photos=evidence_photos,
                provenance=["dossier"],
            )
            id_card = _text(profile.get("id_card"))
            if id_card:
                clean_id = re.sub(r"[^\d]", "", id_card)
                if clean_id:
                    ids_to_people[clean_id].add(node_id)
            # Index both the durable dossier name and reviewed display override as exact receiver aliases.
            for raw_name in (suspect_name, override):
                normalized_name = normalize_name(raw_name)
                if normalized_name and normalized_name != "ไม่ระบุชื่อ":
                    names_to_people[normalized_name].add(node_id)
            for phone in phones:
                phones_to_people[phone].add(node_id)
                phone_id = self._phone_node(nodes, phone, "dossier")
                if suspect_name and suspect_name != "ไม่ระบุชื่อ":
                    nodes[phone_id]["dossier_name"] = suspect_name
                    nodes[phone_id]["suspect_name"] = suspect_name
                # Only add generic 'owns_phone' if this phone is not explicitly linked via phone sheets
                if phone not in sheet_phone_users:
                    self._edge(edges, {
                        "id": f"owns_{node_id}_{phone_id}", "from": node_id, "to": phone_id,
                        "label": "เบอร์ที่ใช้งาน", "type": "owns_phone", "status": "active",
                        "provenance": "dossier", "confidence": "strong", "connects_component": True,
                        "color": "#38bdf8", "width": 2, "arrows": "to",
                    })

            # Ingest PEA Electricity Meter Node if present in profile or notes
            pea_info = profile.get("pea_info") or _extract_pea_info(f"{profile.get('notes') or ''}\n{profile.get('behavior') or ''}")
            if pea_info and (pea_info.get("pea_no") or pea_info.get("ca") or pea_info.get("gps_url")):
                pea_key = pea_info.get("pea_no") or pea_info.get("ca") or f"dossier_{dossier_id}"
                pea_id = f"meter_pea_{_digest(pea_key)}"
                pea_no_disp = pea_info.get("pea_no") or pea_info.get("ca") or "PEA"
                c_name = pea_info.get("customer_name") or ""
                pea_label = f"PEA: {pea_no_disp}"
                sublabel = f"ผู้ใช้ไฟ: {c_name}" if c_name else "มิเตอร์การไฟฟ้า"
                nodes[pea_id] = {
                    "id": pea_id,
                    "label": pea_label,
                    "sublabel": sublabel,
                    "type": "pea_meter",
                    "group": "meter",
                    "ca": pea_info.get("ca"),
                    "pea_no": pea_info.get("pea_no"),
                    "customer_name": c_name,
                    "address": pea_info.get("address"),
                    "gps_url": pea_info.get("gps_url"),
                    "lat": pea_info.get("lat"),
                    "lon": pea_info.get("lon"),
                    "dossier_id": dossier_id,
                    "suspect_name": suspect_name,
                    "provenance": ["dossier", "pea"],
                }
                edge_label = f"ที่ตั้ง/มิเตอร์ไฟฟ้า ({c_name})" if c_name else "ที่ตั้ง/มิเตอร์ไฟฟ้า"
                self._edge(edges, {
                    "id": f"pea_edge_{node_id}_{pea_id}",
                    "from": node_id,
                    "to": pea_id,
                    "label": edge_label,
                    "type": "pea_meter",
                    "status": "active",
                    "provenance": "dossier",
                    "confidence": "strong",
                    "connects_component": True,
                    "color": "#f59e0b",
                    "width": 2,
                    "arrows": "to",
                })
                nodes[node_id]["pea_info"] = pea_info

        self._phones_to_people = phones_to_people
        self._names_to_people = names_to_people
        self._ids_to_people = ids_to_people

        # Ingest Parcels from Dossiers
        for dossier_id, profile in profiles.items():
            suspect_name = _text(profile.get("suspect_name") or "")
            if suspect_name.startswith("สายเบอร์"):
                continue
            owner_id = f"person_{dossier_id}"
            for index, parcel in enumerate(profile.get("parcels") or []):
                receiver_name, receiver_phone = self._parcel_party(parcel, "receiver")
                matched_people = set(phones_to_people.get(receiver_phone, set())) if receiver_phone else set()
                normalized_receiver_name = normalize_name(receiver_name)
                if normalized_receiver_name:
                    matched_people.update(names_to_people.get(normalized_receiver_name, set()))
                party_ids = sorted(matched_people)

                pno = _text(parcel.get("pno")) or f"{dossier_id}:{index}"
                parcel_id = f"parcel_{_digest(pno)}"
                receiver_address = _text(parcel.get("receiver_address"))
                nodes[parcel_id] = {
                    "id": parcel_id, "label": f"Flash: {pno}",
                    "sublabel": receiver_name or "ข้อมูลผู้รับพัสดุ",
                    "type": "parcel", "group": "parcel", "pno": pno,
                    "time": parcel.get("time"), "status": parcel.get("status"),
                    "sender": parcel.get("sender"), "sender_address": parcel.get("sender_address"),
                    "receiver": receiver_name, "receiver_phone": receiver_phone or None,
                    "receiver_address": receiver_address, "address": receiver_address,
                    "courier": parcel.get("courier"),
                    "gps_url": parcel.get("gps_url"), "lat": parcel.get("lat"), "lon": parcel.get("lon"),
                    "evidence_photos": parcel.get("evidence_photos") or [],
                    "color": "#f59e0b", "borderColor": "#d97706", "icon": "📦", "size": 22,
                }
                
                # Link Phone -> Parcel
                if receiver_phone:
                    phone_node_id = self._phone_node(nodes, receiver_phone, "parcel")
                    self._edge(edges, {
                        "id": f"parcel_phone_{phone_node_id}_{parcel_id}",
                        "from": phone_node_id, "to": parcel_id,
                        "label": "สั่ง/รับพัสดุ", "type": "parcel_delivery", "status": "active",
                        "provenance": "parcel", "confidence": "strong", "connects_component": True,
                        "color": "#f59e0b", "width": 2.2, "arrows": "to",
                    })
                elif party_ids:
                    for party_id in party_ids:
                        self._edge(edges, {
                            "id": f"parcel_receiver_{parcel_id}_{party_id}",
                            "from": party_id, "to": parcel_id,
                            "label": "ผู้รับพัสดุ", "type": "parcel_receiver", "status": "active",
                            "provenance": "parcel", "confidence": "strong", "connects_component": True,
                            "color": "#f59e0b", "width": 2.2, "arrows": "to",
                        })

        # Ingest Phone Sheets / Batches (โพยชุด -> เบอร์โทร -> คนใช้ / คนจดซิม / พัสดุ)
        if phone_sheets_data:
            try:
                for tag, sdata in phone_sheets_data.items():
                    sheet_id = sdata.get("sheet_id") or f"sheet_{tag}"
                    sheet_name = sdata.get("sheet_name") or f"โพยชุด {tag}"
                    items = sdata.get("items", [])
                    nodes[sheet_id] = {
                        "id": sheet_id,
                        "label": sheet_name,
                        "sublabel": f"บัญชีรายการเบอร์ ({len(items)} หมายเลข)",
                        "type": "phone_sheet",
                        "group": "phone_sheet",
                        "color": "#f59e0b",
                        "borderColor": "#d97706",
                        "icon": "📋",
                        "size": 26,
                        "provenance": ["phone_sheet"]
                    }
                    for it in items:
                        ph = normalize_phone(it.get("phone_number"))
                        if not ph:
                            continue
                        idx = it.get("index") or 1
                        phone_node_id = self._phone_node(nodes, ph, "phone_sheet")
                        
                        tag_str = it.get("tag") or ""
                        tag_suffix = f" ({tag_str})" if tag_str else ""
                        if it.get("registered_owner"):
                            nodes[phone_node_id]["registered_owner"] = it["registered_owner"]
                        nodes[phone_node_id]["sheet_source"] = f"{sheet_name} (ลำดับที่ {idx}{tag_suffix})"
                        
                        # Edge: Sheet -> Phone
                        self._edge(edges, {
                            "id": f"sheet_{sheet_id}_{phone_node_id}",
                            "from": sheet_id,
                            "to": phone_node_id,
                            "label": f"ลำดับที่ {idx}{tag_suffix}",
                            "type": "sheet_entry",
                            "status": "active",
                            "provenance": "phone_sheet",
                            "confidence": "strong",
                            "connects_component": True,
                            "color": "#f59e0b",
                            "width": 2.0,
                            "arrows": "to"
                        })
                        
                        # Edge: Phone -> Actual User / Sim Registrant (Single directed edge)
                        actual_dossier = it.get("actual_user_dossier")
                        if actual_dossier:
                            p_node_id = f"person_{actual_dossier}"
                            if p_node_id in nodes:
                                role_lbl = it.get("role_tag") or "ผู้ใช้งานจริง"
                                if "จด" in role_lbl or "ม้า" in role_lbl or "Mule" in role_lbl:
                                    nodes[phone_node_id]["registered_owner"] = it.get("actual_user_name") or nodes[p_node_id].get("label")
                                else:
                                    nodes[phone_node_id]["actual_user"] = it.get("actual_user_name") or nodes[p_node_id].get("label")
                                self._edge(edges, {
                                    "id": f"user_{phone_node_id}_{p_node_id}",
                                    "from": phone_node_id,
                                    "to": p_node_id,
                                    "label": role_lbl,
                                    "type": "actual_user" if "ใช้" in role_lbl else "sim_owner",
                                    "source_evidence": f"{sheet_name} (ลำดับที่ {idx}{tag_suffix})",
                                    "notes": f"บันทึกบทบาท: {role_lbl} จากการสืบสวนเครือข่าย",
                                    "status": "active",
                                    "provenance": "phone_sheet",
                                    "confidence": "strong",
                                    "connects_component": True,
                                    "color": "#0284c7" if "ใช้" in role_lbl else "#8b5cf6",
                                    "width": 2.2,
                                    "arrows": "to"
                                })
                        
                        # Edge: Phone -> Parcels directly recorded in sheet
                        for p_idx, pc in enumerate(it.get("parcels", [])):
                            pno = _text(pc.get("pno")) or f"{ph}:{p_idx}"
                            parcel_id = f"parcel_{_digest(pno)}"
                            receiver_name = _text(pc.get("receiver"))
                            receiver_address = _text(pc.get("receiver_address"))
                            nodes[parcel_id] = {
                                "id": parcel_id, "label": f"Flash: {pno}",
                                "sublabel": receiver_name or "ข้อมูลผู้รับพัสดุ",
                                "type": "parcel", "group": "parcel", "pno": pno,
                                "time": pc.get("time"), "status": pc.get("status"),
                                "sender": pc.get("sender"), "sender_address": pc.get("sender_address"),
                                "receiver": receiver_name, "receiver_phone": ph,
                                "receiver_address": receiver_address, "address": receiver_address,
                                "courier": pc.get("courier"),
                                "gps_url": pc.get("gps_url"), "lat": pc.get("lat"), "lon": pc.get("lon"),
                                "evidence_photos": pc.get("evidence_photos") or [],
                                "color": "#f59e0b", "borderColor": "#d97706", "icon": "📦", "size": 22,
                            }
                            self._edge(edges, {
                                "id": f"parcel_phone_{phone_node_id}_{parcel_id}",
                                "from": phone_node_id,
                                "to": parcel_id,
                                "label": "สั่ง/รับพัสดุ",
                                "type": "parcel_delivery",
                                "status": "active",
                                "provenance": "parcel",
                                "confidence": "strong",
                                "connects_component": True,
                                "color": "#f59e0b",
                                "width": 2.2,
                                "arrows": "to",
                            })
            except Exception as e:
                logger.error(f"Error loading phone_sheets in graph_engine: {e}")

        # Ingest Financial Records (Bank Transfer Slips / Accounts)
        for dossier_id, profile in profiles.items():
            suspect_name = _text(profile.get("suspect_name") or "")
            if suspect_name.startswith("สายเบอร์"):
                continue
            owner_id = f"person_{dossier_id}"
            
            for f_idx, fin in enumerate(profile.get("financial_records") or []):
                r_name = _text(fin.get("receiver_name")) or "บัญชีปลายทาง"
                r_bank = _text(fin.get("receiver_bank")) or "ธนาคาร"
                r_acc = _text(fin.get("receiver_account")) or ""
                amt = _text(fin.get("amount")) or ""
                amt_str = f" {amt} บ." if amt else ""
                s_name = _text(fin.get("sender_name")) or suspect_name
                notes = _text(fin.get("notes")) or ""
                slip_file = _text(fin.get("slip_file")) or ""
                slip_url = f"/data/nas-storage/Dossiers/{dossier_id}/Personal/{slip_file}" if slip_file else ""
                txn_datetime = _text(fin.get("transaction_datetime")) or _text(fin.get("recorded_at")) or ""
                rec_at = _text(fin.get("recorded_at")) or ""
                
                tx_record = {
                    "datetime": txn_datetime or rec_at or "-",
                    "date": txn_datetime.split(" ")[0] if " " in str(txn_datetime) else txn_datetime,
                    "time": txn_datetime.split(" ")[-1] if " " in str(txn_datetime) else "",
                    "type": "bank_transfer",
                    "direction": "outflow",
                    "amount": amt,
                    "balance": None,
                    "channel": "สลิปโอนเงิน",
                    "description": notes or f"โอนเงินไปยัง {r_name} ({r_bank})",
                    "sender_name": s_name,
                    "counterparty_name": r_name,
                    "counterparty_account": r_acc,
                    "counterparty_bank": r_bank,
                    "slip_file": slip_file,
                    "slip_url": slip_url,
                }
                
                bank_node_id = _normalize_bank_account_id(r_acc, r_bank, r_name)
                if bank_node_id in nodes:
                    existing_node = nodes[bank_node_id]
                    existing_txs = existing_node.setdefault("transactions_sample", [])
                    existing_txs.append(tx_record)
                    existing_node["transactions_sample"] = existing_txs[:100]
                else:
                    nodes[bank_node_id] = {
                        "id": bank_node_id,
                        "label": f"🏦 {r_bank}: {r_name}" if r_bank else f"🏦 {r_name}",
                        "sublabel": f"เลขบัญชี: {r_acc}" if r_acc else r_bank,
                        "type": "bank_account",
                        "group": "bank_account",
                        "account_holder": r_name,
                        "bank_name": r_bank,
                        "account_number": r_acc,
                        "amount": amt,
                        "sender_name": s_name,
                        "slip_file": slip_file,
                        "slip_url": slip_url,
                        "notes": notes,
                        "transaction_datetime": txn_datetime,
                        "date": txn_datetime,
                        "recorded_at": rec_at,
                        "transactions_sample": [tx_record],
                        "color": "#06b6d4",
                        "borderColor": "#0891b2",
                        "icon": "🏦",
                        "size": 24,
                        "provenance": ["financial_record"]
                    }
                
                self._edge(edges, {
                    "id": f"transfer_{owner_id}_{bank_node_id}_{f_idx}",
                    "from": owner_id,
                    "to": bank_node_id,
                    "label": f"โอนเงิน{amt_str} (หลักฐานสลิป)",
                    "sublabel": f"ผู้โอน: {s_name}",
                    "type": "bank_transfer",
                    "status": "active",
                    "provenance": "financial_record",
                    "confidence": "strong",
                    "connects_component": True,
                    "amount": amt,
                    "transaction_datetime": txn_datetime,
                    "date": txn_datetime,
                    "recorded_at": rec_at,
                    "slip_file": slip_file,
                    "slip_url": slip_url,
                    "transactions": [tx_record],
                    "color": "#06b6d4",
                    "width": 2.5,
                    "arrows": "to"
                })

        proposals: List[Dict[str, Any]] = []

        # Linked dossiers (Spouse, family, network, and past ghost relationships)
        seen_pairs: Set[Tuple[str, str]] = set()
        for dossier_id, profile in profiles.items():
            source = f"person_{dossier_id}"
            for link_item in profile.get("linked_dossiers") or []:
                target = f"person_{link_item.get('dossier_id')}"
                pair = tuple(sorted((source, target)))
                if target not in nodes or source == target or pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                
                raw_reason = _text(link_item.get("link_reason")) or "ความเชื่อมโยงแฟ้มคดี"
                reason = re.sub(r'\s*\(ไฟล์:[^)]*\)', '', raw_reason).strip() or raw_reason
                is_current = link_item.get("is_current", True)
                status = link_item.get("status", "current")
                rel_type = link_item.get("relationship_type") or "network"
                
                spouse_keywords = ["สามี", "ภรรยา", "เมีย", "ผัว", "คู่สมรส", "แฟน"]
                family_keywords = ["บิดา", "มารดา", "พ่อ", "แม่", "บุตร", "ลูกสาว", "ลูกชาย", "ครอบครัว"]
                is_spouse = rel_type == "spouse" or any(k in reason for k in spouse_keywords)
                is_family = rel_type in ("family", "parent_child") or any(k in reason for k in family_keywords)
                is_past = (
                    not is_current or
                    status == "past" or
                    any(k in reason for k in ["อดีต", "เคย", "เลิกรา"])
                )
                
                evidence_snippet = link_item.get("evidence_snippet")
                source_file = link_item.get("source_file")
                case_id = link_item.get("case_id")
                shared_files = link_item.get("shared_files") or []

                if is_past:
                    # Ghost / Past Relationship (เส้นเงาสีเทาบาง)
                    display_label = reason if "อดีต" in reason else f"💔 อดีตคู่สมรส ({reason})"
                    self._edge(edges, {
                        "id": f"dossier_link_{_digest('|'.join(pair))}",
                        "from": pair[0],
                        "to": pair[1],
                        "label": display_label,
                        "type": "spouse_past" if is_spouse else "past_link",
                        "status": "past",
                        "is_current": False,
                        "relationship_status": "past",
                        "provenance": "dossier",
                        "confidence": "strong",
                        "connects_component": False,
                        "color": "#94a3b8",  # Thin grey line
                        "width": 1.2,
                        "dashes": True,
                        "evidence_snippet": evidence_snippet,
                        "source_file": source_file,
                        "case_id": case_id,
                        "shared_files": shared_files,
                    })
                elif is_spouse:
                    # Current Active Spouse (เส้นม่วงปกติ)
                    self._edge(edges, {
                        "id": f"dossier_link_{_digest('|'.join(pair))}",
                        "from": pair[0],
                        "to": pair[1],
                        "label": f"💍 {reason}" if "💍" not in reason else reason,
                        "type": "spouse",
                        "status": "current",
                        "is_current": True,
                        "relationship_status": "current",
                        "provenance": "dossier",
                        "confidence": "strong",
                        "connects_component": True,
                        "color": "#a855f7",
                        "width": 2.2,
                        "dashes": False,
                        "evidence_snippet": evidence_snippet,
                        "source_file": source_file,
                        "case_id": case_id,
                        "shared_files": shared_files,
                    })
                elif is_family:
                    # Current Active Family Link (เส้นชมพูอมแดงครอบครัว/สายเลือด)
                    fam_emoji = "👨‍👧" if any(k in reason for k in ["ลูกสาว", "บุตรสาว"]) else ("👨‍👦" if any(k in reason for k in ["ลูกชาย", "บุตรชาย"]) else "👨‍👩‍👦")
                    display_label = reason if any(e in reason for e in ["👨‍👧", "👨‍👦", "👨‍👩‍👦"]) else f"{fam_emoji} {reason}"
                    self._edge(edges, {
                        "id": f"dossier_link_{_digest('|'.join(pair))}",
                        "from": pair[0],
                        "to": pair[1],
                        "label": display_label,
                        "type": "family",
                        "status": "current",
                        "is_current": True,
                        "relationship_status": "current",
                        "provenance": "dossier",
                        "confidence": "strong",
                        "connects_component": True,
                        "color": "#f43f5e",
                        "width": 2.2,
                        "dashes": False,
                        "evidence_snippet": evidence_snippet,
                        "source_file": source_file,
                        "case_id": case_id,
                        "shared_files": shared_files,
                    })
                else:
                    # Standard Network Dossier Link
                    self._edge(edges, {
                        "id": f"dossier_link_{_digest('|'.join(pair))}",
                        "from": pair[0],
                        "to": pair[1],
                        "label": reason,
                        "type": "dossier_link",
                        "status": "active",
                        "is_current": True,
                        "relationship_status": "current",
                        "provenance": "dossier",
                        "confidence": "strong",
                        "connects_component": True,
                        "color": "#c084fc",
                        "width": 2.0,
                        "dashes": False,
                        "evidence_snippet": evidence_snippet,
                        "source_file": source_file,
                        "case_id": case_id,
                        "shared_files": shared_files,
                    })

        # Integrate Drop Points from Chat Service (Incident: Stash Points in Graph)
        try:
            import urllib.request
            req = urllib.request.Request("http://chat-service:5007/api/chat/drop-points", headers={"X-Role": "superadmin"})
            with urllib.request.urlopen(req, timeout=3.0) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    for dp in data.get("drop_points", []):
                        dp_text = _text(dp.get("raw_text") or dp.get("location_name") or "")
                        dp_type = _text(dp.get("stash_type") or "จุดวางงาน")
                        if not dp_text:
                            continue
                        
                        # Find mentioned people (by name)
                        mentioned_person_ids = set()
                        for name, p_ids in self._names_to_people.items():
                            if len(name) > 2 and name in dp_text.replace(" ", ""):
                                mentioned_person_ids.update(p_ids)
                        
                        # Find mentioned people (by phone)
                        for phone, p_ids in self._phones_to_people.items():
                            if len(phone) >= 8 and phone in dp_text.replace("-", "").replace(" ", ""):
                                mentioned_person_ids.update(p_ids)

                        if mentioned_person_ids:
                            dp_id = f"dp_{dp.get('id') or dp.get('event_id')}"
                            if dp_id not in nodes:
                                nodes[dp_id] = {
                                    "id": dp_id,
                                    "label": f"[{dp_type}]",
                                    "title": f"จุดวางงาน: {dp_text}",
                                    "group": "event",
                                    "type": "drop_point",
                                    "icon": "📍",
                                    "size": 24,
                                    "color": {"background": "#fb5b78", "border": "#e11d48"},
                                    "provenance": ["drop_point"],
                                    "timestamp": dp.get("created_at"),
                                    "full_text": dp_text
                                }
                            for pid in mentioned_person_ids:
                                edge_id = f"edge_dp_{dp_id}_{pid}"
                                if edge_id not in edges:
                                    self._edge(edges, {
                                        "id": edge_id,
                                        "from": dp_id,
                                        "to": pid,
                                        "label": "ระบุในรายงาน",
                                        "type": "drop_point_mention",
                                        "status": "active",
                                        "provenance": "drop_point",
                                        "confidence": "strong",
                                        "color": "#fb5b78",
                                        "width": 2.0,
                                        "dashes": True,
                                    })
        except Exception as e:
            logger.warning("Could not fetch drop points for graph: %s", e)

        return proposals

    def _reviewed_graph(self, nodes: Dict[str, Dict[str, Any]], edges: Dict[str, Dict[str, Any]], state: Mapping[str, Any], proposals: List[Dict[str, Any]]) -> None:
        """Add proposal decisions, manual edges, CDR pairs, and applied i2 imports."""

        decisions = state.get("proposals", {})
        for candidate in proposals:
            status = decisions.get(candidate["id"], {}).get("status", "pending")
            if status == "rejected":
                continue
            approved = status == "approved"
            self._edge(edges, {
                **candidate, "status": status, "connects_component": approved,
                "color": "#22c55e" if approved else "#eab308",
                "width": 2 if approved else 1.5, "dashes": not approved,
            })
        for manual in state.get("manual_edges", {}).values():
            if manual.get("status") == "active" and manual.get("from") in nodes and manual.get("to") in nodes:
                self._edge(edges, {**manual, "connects_component": True, "color": "#22c55e", "width": 2.5})
        contacts = getattr(self.cdr_parser, "get_all_contacts", lambda: {})()
        for pair in self.cdr_parser.get_all_active_call_pairs():
            phone_a, phone_b = normalize_phone(pair.get("party_a")), normalize_phone(pair.get("party_b"))
            if not phone_a or not phone_b or phone_a == phone_b:
                continue
            name_a = contacts.get(phone_a, "")
            name_b = contacts.get(phone_b, "") or pair.get("contact_name", "")
            node_a = self._phone_node(nodes, phone_a, "cdr", name_a)
            node_b = self._phone_node(nodes, phone_b, "cdr", name_b)
            p2p = getattr(self, "_phones_to_people", {})
            if phone_a in p2p and not nodes[node_a].get("dossier_name"):
                for p_id in p2p[phone_a]:
                    if p_id in nodes and (nodes[p_id].get("suspect_name") or nodes[p_id].get("label")):
                        s_name = nodes[p_id].get("suspect_name") or nodes[p_id].get("label")
                        nodes[node_a]["dossier_name"] = s_name
                        nodes[node_a]["suspect_name"] = s_name
                        break
            if phone_b in p2p and not nodes[node_b].get("dossier_name"):
                for p_id in p2p[phone_b]:
                    if p_id in nodes and (nodes[p_id].get("suspect_name") or nodes[p_id].get("label")):
                        s_name = nodes[p_id].get("suspect_name") or nodes[p_id].get("label")
                        nodes[node_b]["dossier_name"] = s_name
                        nodes[node_b]["suspect_name"] = s_name
                        break
            calls, duration = max(1, int(pair.get("total_calls", 1))), max(0, int(pair.get("total_duration_sec", 0)))
            dur_min = round(duration / 60, 1)
            call_lines = [f"📞 โทร {calls} ครั้ง ({dur_min} นาที)"]
            a_to_b = pair.get("a_to_b_calls", 0)
            b_to_a = pair.get("b_to_a_calls", 0)
            p_a = pair.get("party_a", phone_a)
            p_b = pair.get("party_b", phone_b)
            if a_to_b > 0:
                call_lines.append(f"➔ {p_a} โทรหา ({a_to_b} ครั้ง)")
            if b_to_a > 0:
                call_lines.append(f"⬅ {p_b} โทรหา ({b_to_a} ครั้ง)")
            if pair.get("last_call"):
                call_lines.append(f"📅 ล่าสุด: {pair['last_call']}")

            self._edge(edges, {
                "id": f"call_{_digest('|'.join(sorted((node_a, node_b))))}", "from": node_a, "to": node_b,
                "label": f"📞 โทร {calls} ครั้ง ({dur_min} นาที)",
                "call_lines": call_lines, "type": "call",
                "status": "active", "provenance": "cdr", "confidence": "strong",
                "connects_component": True, "call_count": calls, "duration_sec": duration,
                "a_to_b_calls": a_to_b, "b_to_a_calls": b_to_a, "last_call": pair.get("last_call"),
                "records": pair.get("records", [])[:100],
                "color": "#dc2626" if calls >= 10 else "#e11d48", "width": min(10, 2 + calls * .4),
                "arrows": "to;from",
            })

        # -----------------------------------------------------------------
        # Bank Statement Financial Intelligence (Accounts & Money Transfers)
        # -----------------------------------------------------------------
        if self.statement_parser:
            for acc in self.statement_parser.get_all_active_financial_flows():
                acc_num = acc.get("account_number")
                if not acc_num:
                    continue
                holder = _text(acc.get("account_holder") or "ไม่ระบุเจ้าของ")
                bank_node_id = _normalize_bank_account_id(acc_num, acc.get("bank_name"), holder)
                bank_code = acc.get("bank_code") or "BANK"
                inflow_tot = acc.get("total_inflow", 0.0)
                outflow_tot = acc.get("total_outflow", 0.0)

                # 1. Bank Account Node (Emerald Green #10b981)
                period_str = acc.get("statement_period") or acc.get("period") or ""
                if bank_node_id in nodes:
                    existing_node = nodes[bank_node_id]
                    existing_node["bank_code"] = bank_code
                    existing_node["total_inflow"] = inflow_tot
                    existing_node["total_outflow"] = outflow_tot
                    existing_node["statement_period"] = period_str
                    existing_txs = existing_node.setdefault("transactions_sample", [])
                    existing_txs.extend((acc.get("transactions") or [])[:50])
                    existing_node["transactions_sample"] = existing_txs[:100]
                    existing_node["color"] = "#10b981"
                    existing_node["borderColor"] = "#059669"
                    existing_node["provenance"] = list(set(existing_node.get("provenance", []) + ["statement"]))
                else:
                    nodes[bank_node_id] = {
                        "id": bank_node_id,
                        "label": f"{bank_code} {acc_num}",
                        "sublabel": f"{holder} (เข้า ฿{inflow_tot:,.0f} / ออก ฿{outflow_tot:,.0f})",
                        "type": "bank_account",
                        "group": "bank_account",
                        "bank_name": acc.get("bank_name"),
                        "bank_code": bank_code,
                        "account_number": acc_num,
                        "account_holder": holder,
                        "branch": acc.get("branch"),
                        "statement_period": period_str,
                        "period": period_str,
                        "total_inflow": inflow_tot,
                        "total_outflow": outflow_tot,
                        "transactions_sample": (acc.get("transactions") or [])[:50],
                        "color": "#10b981",
                        "borderColor": "#059669",
                        "icon": "🏦",
                        "size": 24,
                        "provenance": ["statement"],
                    }

                # 2. Link Bank Account to Account Owner (Person Dossier)
                normalized_holder = normalize_name(holder)
                matched_owners = set(self._names_to_people.get(normalized_holder, set())) if normalized_holder else set()
                
                if matched_owners:
                    for owner_node_id in sorted(matched_owners):
                        self._edge(edges, {
                            "id": f"owns_bank_{owner_node_id}_{bank_node_id}",
                            "from": owner_node_id,
                            "to": bank_node_id,
                            "label": f"เจ้าของบัญชี ({bank_code})",
                            "type": "owns_bank_account",
                            "status": "active",
                            "provenance": "statement",
                            "confidence": "strong",
                            "connects_component": True,
                            "color": "#10b981",
                            "width": 2.5,
                        })
                else:
                    # Create a provisional person node for account holder if not yet exists
                    holder_person_id = f"person_{_digest(normalized_holder or acc_num)}"
                    if holder_person_id not in nodes:
                        nodes[holder_person_id] = self._person(
                            holder_person_id,
                            holder,
                            "",
                            "เจ้าของบัญชี (Statement)",
                            True,
                            address=acc.get("address") or "",
                            provenance=["statement"]
                        )
                    self._edge(edges, {
                        "id": f"owns_bank_{holder_person_id}_{bank_node_id}",
                        "from": holder_person_id,
                        "to": bank_node_id,
                        "label": f"เจ้าของบัญชี ({bank_code})",
                        "type": "owns_bank_account",
                        "status": "active",
                        "provenance": "statement",
                        "confidence": "strong",
                        "connects_component": True,
                        "color": "#10b981",
                        "width": 2.5,
                    })

                # 3. Counterparty Nodes & Money Transfer Edges
                for cp in acc.get("counterparties", []):
                    cp_name = _text(cp.get("name") or "คู่โอนไม่ระบุชื่อ")
                    cp_bank = cp.get("bank") or ""
                    cp_mask = cp.get("account_mask") or ""
                    tot_amt = cp.get("total_amount", 0.0)
                    tot_cnt = cp.get("total_count", 1)
                    in_amt = cp.get("inflow_amount", 0.0)
                    out_amt = cp.get("outflow_amount", 0.0)
                    last_txn = cp.get("last_transaction") or ""

                    # Determine if counterparty matches an existing person dossier
                    norm_cp_name = normalize_name(cp_name)
                    matched_cp_persons = set(self._names_to_people.get(norm_cp_name, set())) if norm_cp_name else set()

                    if matched_cp_persons:
                        target_node_id = sorted(matched_cp_persons)[0]
                    else:
                        cp_node_id = f"cp_{_digest(cp_name + '|' + cp_bank + '|' + cp_mask)}"
                        target_node_id = cp_node_id
                        if cp_node_id not in nodes:
                            nodes[cp_node_id] = {
                                "id": cp_node_id,
                                "label": cp_name,
                                "sublabel": f"{cp_bank} {cp_mask} · คู่โอนเงิน".strip(),
                                "type": "counterparty",
                                "group": "counterparty",
                                "name": cp_name,
                                "bank": cp_bank,
                                "account_mask": cp_mask,
                                "color": "#06b6d4",
                                "borderColor": "#0891b2",
                                "icon": "💳",
                                "size": 18,
                                "provenance": ["statement"],
                            }

                    # Determine edge arrow direction and label
                    if out_amt > 0 and in_amt > 0:
                        arrows = "to;from"
                        edge_label = f"โอนไป-กลับ ฿{tot_amt:,.0f} ({tot_cnt} ครั้ง)"
                    elif out_amt > 0:
                        arrows = "to"
                        edge_label = f"โอนออก ฿{out_amt:,.0f} ({cp.get('outflow_count', tot_cnt)} ครั้ง)"
                    else:
                        arrows = "from"
                        edge_label = f"รับโอน ฿{in_amt:,.0f} ({cp.get('inflow_count', tot_cnt)} ครั้ง)"

                    edge_id = f"stmt_xfer_{_digest(bank_node_id + '|' + target_node_id)}"
                    self._edge(edges, {
                        "id": edge_id,
                        "from": bank_node_id,
                        "to": target_node_id,
                        "label": edge_label,
                        "type": "money_transfer",
                        "status": "active",
                        "provenance": "statement",
                        "confidence": "strong",
                        "connects_component": True,
                        "total_amount": tot_amt,
                        "total_count": tot_cnt,
                        "inflow_amount": in_amt,
                        "outflow_amount": out_amt,
                        "last_transaction": last_txn,
                        "date": last_txn,
                        "transactions": (cp.get("transactions") or [])[:100],
                        "color": "#10b981" if tot_amt < 10000 else "#059669",
                        "width": min(8, 2.0 + tot_cnt * 0.25),
                        "arrows": arrows,
                    })

        # -----------------------------------------------------------------
        # 4. IBM i2 Analyst's Notebook Applied Datasets Ingestion & Merging
        # -----------------------------------------------------------------
        if self.import_manager:
            node_redirects: Dict[str, str] = {}
            for chart_idx, (record, payload) in enumerate(self.import_manager.applied_graphs()):
                import_id = record.get("import_id") or ""
                filename = str(record.get("filename") or record.get("archive_relative_path") or "")

                # Exclude sub-network charts from the main overview (viewed standalone via chart dropdown).
                # โพยนอก is included in the main overview per user request (2026-09-09).
                # Only ชินนะพัด and ปานชาติ remain excluded.
                if import_id in ("i2_3a34f9f3027448e484634898ddd326d6", "i2_9ec30f339a8a421aa46c23fe15256825") or any(k in filename for k in ("ช_นนะพ_ด", "ชินนะพัด", "ปานชาต", "ปานชาติ")):
                    continue

                raw_nodes = payload.get("nodes", [])
                raw_edges = payload.get("edges", [])
                if not raw_nodes:
                    continue

                # 4.1 Calculate Bounding Box & Scale Factor for Layout Coordinates
                valid_coords = [
                    (int(n.get("position", {}).get("x", 0)), int(n.get("position", {}).get("y", 0)))
                    for n in raw_nodes
                    if isinstance(n.get("position"), dict) and (n["position"].get("x", 0) != 0 or n["position"].get("y", 0) != 0)
                ]
                chart_offset_x = chart_idx * 20000
                base_y_offset = 20000
                if valid_coords:
                    min_x = min(pt[0] for pt in valid_coords)
                    max_x = max(pt[0] for pt in valid_coords)
                    min_y = min(pt[1] for pt in valid_coords)
                    max_y = max(pt[1] for pt in valid_coords)
                    center_x = (min_x + max_x) / 2.0
                    center_y = (min_y + max_y) / 2.0
                    span_y = max_y - min_y
                    # Ensure the top of the i2 graph is at least 10,000 pixels below the origin
                    base_y_offset = max(20000.0, (span_y / 2.0) + 10000.0)
                    scale = 1.0
                else:
                    scale, center_x, center_y = 1.0, 0.0, 0.0

                # 4.2 Deduplication & Canonical Node Resolution
                i2_id_map: Dict[str, str] = {}

                for node in raw_nodes:
                    raw_id = str(node.get("id") or "")
                    if not raw_id:
                        continue

                    label = _text(node.get("label") or "")
                    identity = _text(node.get("identity") or "")
                    semantic = _text(node.get("semantic_type") or "")
                    node_group = node.get("group") or node.get("type") or "entity"

                    # Compute auto-scaled canvas position with multi-chart offset
                    pos_dict = node.get("position") or {}
                    raw_nx = int(pos_dict.get("x", 0))
                    raw_ny = int(pos_dict.get("y", 0))
                    scaled_x = (round((raw_nx - center_x) * scale) + chart_offset_x) if valid_coords else chart_offset_x
                    scaled_y = (round((raw_ny - center_y) * scale) + base_y_offset) if valid_coords else base_y_offset

                    photo_path = node.get("photo_path")
                    i2_photo_url = None
                    if photo_path and self.import_manager:
                        cand_p = self.import_manager.bridge_root / "media" / import_id / Path(photo_path).name
                        if _is_valid_image_file(cand_p):
                            i2_photo_url = f"/api/nas-bot/graph/i2-media/{import_id}/{Path(photo_path).name}"

                    # Canonical Match (Phone / ID Card / Person name)
                    clean_phone = normalize_phone(identity) or normalize_phone(label)
                    clean_id_card = ""
                    id_match = re.search(r"\b\d{1}-?\d{4}-?\d{5}-?\d{2}-?\d{1}\b|\b\d{13}\b", label)
                    if id_match:
                        clean_id_card = re.sub(r"[^\d]", "", id_match.group(0))

                    cleaned_name = _clean_name_from_label(identity or label)
                    norm_name = normalize_name(cleaned_name)

                    matched_person_id = None
                    if clean_id_card and clean_id_card in self._ids_to_people:
                        matched_person_id = sorted(self._ids_to_people[clean_id_card])[0]
                    elif norm_name and norm_name in self._names_to_people:
                        matched_person_id = sorted(self._names_to_people[norm_name])[0]
                    elif clean_phone and clean_phone in self._phones_to_people and node_group == "person":
                        matched_person_id = sorted(self._phones_to_people[clean_phone])[0]

                    canonical_id = f"i2_{_digest(raw_id)}"
                    i2_id_map[raw_id] = canonical_id

                    if node_group == "vehicle" and any(w in label for w in ("ไม่ติด", "ไม่พบ", "ไม่สวม", "ไม่มี", "ไร้ป้าย")):
                        continue

                    color = node.get("style", {}).get("colour") or ""
                    if not color:
                        color = "#38bdf8" if node_group == "phone" else ("#ec4899" if node_group == "person" else ("#f59e0b" if node_group == "vehicle" else "#64748b"))

                    nodes[canonical_id] = {
                        "id": canonical_id,
                        "label": label or identity or raw_id,
                        "sublabel": _text(node.get("description") or semantic or f"นำเข้าจาก i2 ({record.get('filename', 'chart.anb')})"),
                        "type": node_group,
                        "group": node_group,
                        "semantic_type": semantic,
                        "i2_item_id": raw_id,
                        "import_id": import_id,
                        "color": color,
                        "borderColor": color,
                        "icon": "👤" if node_group == "person" else ("📞" if node_group == "phone" else ("🚗" if node_group == "vehicle" else ("📦" if node_group == "parcel" else "📌"))),
                        "size": 26 if node_group == "person" else (20 if node_group == "phone" else 22),
                        "photo_url": i2_photo_url,
                        "position": {"x": scaled_x, "y": scaled_y},
                        "default_position": {"x": scaled_x, "y": scaled_y},
                        "provenance": ["i2_import"],
                        "attributes": node.get("attributes") or {},
                        "style": node.get("style") or {},
                    }

                    # 4.2.1 Unified Node Merging:
                    # Directive: "ถ้าต่อไปมีชื่อที่ตรงกันอีกให้เอาผัง i2 เป็นหลักนะครับ เบอร์ก็เอาผัง i2 เป็นหลักถ้าซ้ำกัน แต่ข้อมูลให้เก็บไว้ทั้งหมดนะให้รวมแค่โหนด"
                    # If this i2 person node matches a Dossier person, merge them into this canonical i2 node:
                    if node_group == "person" and matched_person_id and matched_person_id in nodes:
                        d_node = nodes[matched_person_id]
                        d_suspect = d_node.get("suspect_name") or d_node.get("label") or d_node.get("dossier_id") or ""
                        if d_suspect and d_suspect != "ไม่ระบุชื่อ" and d_suspect not in nodes[canonical_id]["label"]:
                            nodes[canonical_id]["label"] = f"{nodes[canonical_id]['label']} / {d_suspect} (ผู้ใช้งาน)"
                        nodes[canonical_id]["suspect_name"] = d_suspect
                        nodes[canonical_id]["dossier_name"] = d_suspect
                        nodes[canonical_id]["dossier_id"] = d_node.get("dossier_id") or matched_person_id.replace("person_", "")
                        nodes[canonical_id]["is_dossier"] = True
                        nodes[canonical_id]["phones"] = list(set((d_node.get("phones") or []) + ([clean_phone] if clean_phone else [])))
                        nodes[canonical_id]["id_card"] = d_node.get("id_card") or clean_id_card
                        nodes[canonical_id]["evidence_photos"] = d_node.get("evidence_photos") or []
                        nodes[canonical_id]["personal_files"] = d_node.get("personal_files") or []
                        nodes[canonical_id]["cases"] = d_node.get("cases") or []
                        nodes[canonical_id]["notes"] = d_node.get("notes") or ""
                        nodes[canonical_id]["role_tag"] = d_node.get("role_tag") or "ผู้ต้องหา"
                        nodes[canonical_id]["area_tag"] = d_node.get("area_tag")
                        nodes[canonical_id]["address"] = d_node.get("address") or ""
                        if d_node.get("has_tr14") or not nodes[canonical_id].get("photo_url"):
                            if d_node.get("photo_url"):
                                nodes[canonical_id]["photo_url"] = d_node.get("photo_url")
                        nodes[canonical_id]["has_tr14"] = d_node.get("has_tr14", False) or nodes[canonical_id].get("has_tr14", False)
                        nodes[canonical_id]["provenance"] = list(set(nodes[canonical_id].get("provenance", []) + ["dossier"]))
                        nodes[canonical_id]["i2_matched"] = True
                        if clean_phone:
                            p_nid = f"phone_{_digest(clean_phone)}"
                            if p_nid in nodes and d_suspect:
                                nodes[p_nid]["dossier_name"] = d_suspect
                                nodes[p_nid]["suspect_name"] = d_suspect
                        node_redirects[matched_person_id] = canonical_id
                        del nodes[matched_person_id]

                    # If this i2 phone node matches a system/CDR phone node, merge them into this canonical i2 phone node:
                    elif node_group == "phone" and clean_phone:
                        phone_node_id = f"phone_{_digest(clean_phone)}"
                        if phone_node_id in nodes:
                            p_node = nodes[phone_node_id]
                            nodes[canonical_id]["phone_number"] = clean_phone
                            if p_node.get("contact_name") and not nodes[canonical_id].get("contact_name"):
                                nodes[canonical_id]["contact_name"] = p_node.get("contact_name")
                            nodes[canonical_id]["provenance"] = list(set(nodes[canonical_id].get("provenance", []) + p_node.get("provenance", [])))
                            nodes[canonical_id]["i2_matched"] = True
                            node_redirects[phone_node_id] = canonical_id
                            del nodes[phone_node_id]

                        # If this phone belongs to a known dossier person, connect them with owns_phone
                        if clean_phone in self._phones_to_people:
                            for raw_owner in self._phones_to_people[clean_phone]:
                                owner_id = node_redirects.get(raw_owner, raw_owner)
                                if owner_id in nodes and owner_id != canonical_id:
                                    owns_edge_id = f"owns_{owner_id}_{canonical_id}"
                                    self._edge(edges, {
                                        "id": owns_edge_id,
                                        "from": owner_id,
                                        "to": canonical_id,
                                        "label": "เบอร์ที่ใช้งาน",
                                        "type": "owns_phone",
                                        "status": "active",
                                        "provenance": "i2_match",
                                        "confidence": "strong",
                                        "connects_component": True,
                                        "color": "#38bdf8",
                                        "width": 2,
                                        "arrows": "to",
                                    })


                # 4.3 Merge Edges (Aggregate parallel call/relation edges between same nodes)
                i2_edge_groups: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
                for edge in raw_edges:
                    edge_raw_id = str(edge.get("id") or "")
                    raw_from = str(edge.get("from") or "")
                    raw_to = str(edge.get("to") or "")

                    mapped_from = i2_id_map.get(raw_from)
                    mapped_to = i2_id_map.get(raw_to)

                    if not mapped_from or not mapped_to or mapped_from not in nodes or mapped_to not in nodes or mapped_from == mapped_to:
                        continue

                    edge_type = edge.get("type") or "relationship"
                    pair_key = (min(mapped_from, mapped_to), max(mapped_from, mapped_to), edge_type)
                    i2_edge_groups.setdefault(pair_key, []).append({
                        "raw": edge,
                        "mapped_from": mapped_from,
                        "mapped_to": mapped_to,
                    })

                for (u, v, edge_type), items in i2_edge_groups.items():
                    first = items[0]
                    first_raw = first["raw"]
                    mapped_from = first["mapped_from"]
                    mapped_to = first["mapped_to"]
                    edge_id = f"i2_edge_{_digest(import_id + '|' + u + '|' + v + '|' + edge_type)}"

                    all_call_lines = []
                    all_records = []
                    has_to = False
                    has_from = False

                    for it in items:
                        raw_e = it["raw"]
                        arrows = raw_e.get("arrows") or "none"
                        if it["mapped_from"] == mapped_from:
                            if "to" in arrows: has_to = True
                            if "from" in arrows: has_from = True
                        else:
                            if "to" in arrows: has_from = True
                            if "from" in arrows: has_to = True

                        c_lines = raw_e.get("call_lines") or []
                        if not c_lines and raw_e.get("label"):
                            raw_lbl = str(raw_e.get("label") or "")
                            c_lines = [line.strip() for line in raw_lbl.replace("\r", "\n").split("\n") if line.strip()]
                        for cl in c_lines:
                            if cl and cl not in all_call_lines:
                                all_call_lines.append(cl)

                        rec = raw_e.get("records") or []
                        if rec:
                            all_records.extend(rec)

                    arrows_final = "to;from" if (has_to and has_from) else ("to" if has_to else ("from" if has_from else "none"))
                    total_count = len(items)
                    if edge_type == "call" and total_count > 1:
                        final_label = f"📞 โทร {total_count} ครั้ง"
                    elif edge_type == "call" and total_count == 1 and all_call_lines:
                        final_label = f"📞 โทร {total_count} ครั้ง"
                    elif total_count > 1:
                        final_label = f"{_text(first_raw.get('label') or edge_type)} ({total_count} รายการ)"
                    else:
                        final_label = _text(first_raw.get("label") or "เชื่อมโยง i2")

                    edge_color = first_raw.get("color") or ""
                    if not edge_color:
                        edge_color = "#e11d48" if edge_type == "call" else ("#10b981" if edge_type == "money_transfer" else "#f59e0b" if edge_type == "parcel" else "#94a3b8")

                    raw_bps = first_raw.get("bend_points") or []
                    scaled_bps = []
                    for bp in raw_bps:
                        if isinstance(bp, dict) and "x" in bp and "y" in bp:
                            scaled_bps.append({
                                "x": (round((float(bp["x"]) - center_x) * scale) + chart_offset_x) if valid_coords else chart_offset_x,
                                "y": (round((float(bp["y"]) - center_y) * scale) + base_y_offset) if valid_coords else base_y_offset,
                            })

                    self._edge(edges, {
                        "id": edge_id,
                        "from": mapped_from,
                        "to": mapped_to,
                        "label": final_label,
                        "call_lines": all_call_lines,
                        "records": all_records,
                        "call_count": total_count,
                        "bend_points": scaled_bps,
                        "type": edge_type,
                        "semantic_type": first_raw.get("semantic_type") or "",
                        "status": "active",
                        "provenance": "i2_import",
                        "confidence": "strong",
                        "connects_component": True,
                        "color": edge_color,
                        "width": max(1.5, min(8.0, float(first_raw.get("width") or 2.0) + (0.3 * min(total_count, 10)))),
                        "arrows": arrows_final,
                        "import_id": import_id,
                        "i2_edge_id": str(first_raw.get("id") or ""),
                    })

        # Apply all node redirects across edges (e.g. redirected dossier nodes and CDR phone nodes)
        if self.import_manager and 'node_redirects' in locals() and node_redirects:
            for edge_id, edge in list(edges.items()):
                src = edge.get("from")
                dst = edge.get("to")
                new_src = node_redirects.get(src, src)
                new_dst = node_redirects.get(dst, dst)
                if new_src != src or new_dst != dst:
                    if new_src == new_dst or not new_src or not new_dst or new_src not in nodes or new_dst not in nodes:
                        edges.pop(edge_id, None)
                        continue
                    edge["from"] = new_src
                    edge["to"] = new_dst
            self._last_node_redirects = node_redirects
        else:
            self._last_node_redirects = {}

        node_overrides = state.get("node_overrides", {})
        for node_id, override in node_overrides.items():
            if node_id in nodes and isinstance(override, Mapping):
                nodes[node_id].update({k: v for k, v in override.items() if v is not None})

    @staticmethod
    def _focus(nodes: Dict[str, Dict[str, Any]], edges: Dict[str, Dict[str, Any]], node_id: Optional[str], depth: Optional[int]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        """Filter to N hops or the complete visible network around one focus node."""

        if not node_id or node_id not in nodes:
            return nodes, edges
        adjacency: Dict[str, Set[str]] = defaultdict(set)
        for edge in edges.values():
            adjacency[edge["from"]].add(edge["to"])
            adjacency[edge["to"]].add(edge["from"])
        limit = None if depth is None else max(0, min(int(depth), 10))
        visible, queue = {node_id}, deque([(node_id, 0)])
        while queue:
            current, level = queue.popleft()
            if limit is not None and level >= limit:
                continue
            for neighbor in adjacency.get(current, set()):
                if neighbor not in visible:
                    visible.add(neighbor)
                    queue.append((neighbor, level + 1))
        return (
            {key: value for key, value in nodes.items() if key in visible},
            {key: value for key, value in edges.items() if value["from"] in visible and value["to"] in visible},
        )

    @staticmethod
    def _components(nodes: Dict[str, Dict[str, Any]], edges: Mapping[str, Dict[str, Any]], names: Mapping[str, Any]) -> List[Dict[str, Any]]:
        """Assign component IDs/names using only approved component-forming edges."""

        union = _Components(nodes)
        for edge in edges.values():
            if edge.get("connects_component") and edge.get("from") in nodes and edge.get("to") in nodes:
                union.union(edge["from"], edge["to"])
        grouped: Dict[str, List[str]] = defaultdict(list)
        for node_id in nodes:
            grouped[union.find(node_id)].append(node_id)
        output = []
        for members in sorted(grouped.values(), key=lambda item: (-len(item), item[0])):
            members = sorted(members)
            component_id = f"component_{_digest('|'.join(members), 24)}"
            people = [nodes[item]["label"] for item in members if nodes[item].get("group") == "person"]
            default_name = " / ".join(people[:3]) or "กลุ่มข้อมูลไม่ทราบบุคคล"
            if len(people) > 3:
                default_name += f" +{len(people) - 3} คน"
            for node_id in members:
                nodes[node_id]["component_id"] = component_id
            output.append({
                "id": component_id, "name": names.get(component_id, {}).get("name") or default_name,
                "node_ids": members, "node_count": len(members), "person_count": len(people),
                "custom_name": bool(names.get(component_id, {}).get("name")),
            })
        return output

    def _isolated_i2_graph(self, import_id: str) -> Dict[str, Any]:
        """Generate an isolated, full-fidelity graph view for a single i2 chart import."""
        nodes: Dict[str, Dict[str, Any]] = {}
        edges: Dict[str, Dict[str, Any]] = {}

        if not self.import_manager:
            return {"status": "error", "message": "Import manager not configured", "nodes": [], "edges": []}

        record, payload = self.import_manager.get_import_payload(import_id)
        if not record or not payload:
            return {"status": "error", "message": f"Import {import_id} not found", "nodes": [], "edges": []}

        raw_nodes = payload.get("nodes", [])
        raw_edges = payload.get("edges", [])

        # 1. Coordinates: Center at (0, 0) with natural spacing
        valid_coords = [
            (int(n.get("position", {}).get("x", 0)), int(n.get("position", {}).get("y", 0)))
            for n in raw_nodes
            if isinstance(n.get("position"), dict) and (n["position"].get("x", 0) != 0 or n["position"].get("y", 0) != 0)
        ]

        if valid_coords:
            min_x = min(pt[0] for pt in valid_coords)
            max_x = max(pt[0] for pt in valid_coords)
            min_y = min(pt[1] for pt in valid_coords)
            max_y = max(pt[1] for pt in valid_coords)
            center_x = (min_x + max_x) / 2.0
            center_y = (min_y + max_y) / 2.0
            span_x = max(1, max_x - min_x)
            span_y = max(1, max_y - min_y)
            scale = 1.0
        else:
            center_x, center_y, scale = 0.0, 0.0, 1.0

        i2_id_map: Dict[str, str] = {}
        for node in raw_nodes:
            raw_id = str(node.get("id") or "")
            if not raw_id:
                continue
            canonical_id = f"i2_{_digest(raw_id)}"
            i2_id_map[raw_id] = canonical_id

            label = _text(node.get("label") or "")
            identity = _text(node.get("identity") or "")
            semantic = _text(node.get("semantic_type") or "")
            node_group = node.get("group") or node.get("type") or "entity"

            pos_dict = node.get("position") or {}
            raw_nx = int(pos_dict.get("x", 0))
            raw_ny = int(pos_dict.get("y", 0))
            scaled_x = round((raw_nx - center_x) * scale) if valid_coords else 0
            scaled_y = round((raw_ny - center_y) * scale) if valid_coords else 0

            photo_path = node.get("photo_path")
            i2_photo_url = None
            if photo_path and self.import_manager:
                cand_p = self.import_manager.bridge_root / "media" / import_id / Path(photo_path).name
                if _is_valid_image_file(cand_p):
                    i2_photo_url = f"/api/nas-bot/graph/i2-media/{import_id}/{Path(photo_path).name}"

            color = node.get("style", {}).get("colour") or ""
            if not color:
                color = "#ec4899" if node_group == "person" else ("#38bdf8" if node_group == "phone" else ("#f59e0b" if node_group == "vehicle" else "#64748b"))

            nodes[canonical_id] = {
                "id": canonical_id,
                "label": label or identity or raw_id,
                "sublabel": _text(node.get("description") or semantic or f"i2: {record.get('filename', 'chart')}"),
                "type": node_group,
                "group": node_group,
                "semantic_type": semantic,
                "i2_item_id": raw_id,
                "import_id": import_id,
                "color": color,
                "borderColor": color,
                "icon": "👤" if node_group == "person" else ("📞" if node_group == "phone" else ("🚗" if node_group == "vehicle" else "📌")),
                "size": 28 if node_group == "person" else (22 if node_group == "phone" else 24),
                "photo_url": i2_photo_url,
                "provenance": ["i2_import"],
                "position": {"x": scaled_x, "y": scaled_y},
                "default_position": {"x": scaled_x, "y": scaled_y},
                "x": scaled_x,
                "y": scaled_y,
                "i2_original_position": {"x": raw_nx, "y": raw_ny},
                "style": node.get("style", {}),
                "attributes": node.get("attributes", {}),
            }

        # Aggregate parallel edges between identical node pairs (e.g. dozens of calls)
        edge_groups: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
        for edge in raw_edges:
            raw_from = str(edge.get("from") or "")
            raw_to = str(edge.get("to") or "")
            mapped_from = i2_id_map.get(raw_from)
            mapped_to = i2_id_map.get(raw_to)
            if not mapped_from or not mapped_to or mapped_from == mapped_to:
                continue
            edge_type = edge.get("type") or "association"
            pair_key = (min(mapped_from, mapped_to), max(mapped_from, mapped_to), edge_type)
            edge_groups.setdefault(pair_key, []).append({
                "raw": edge,
                "mapped_from": mapped_from,
                "mapped_to": mapped_to,
            })

        for (u, v, edge_type), items in edge_groups.items():
            first = items[0]
            first_raw = first["raw"]
            mapped_from = first["mapped_from"]
            mapped_to = first["mapped_to"]
            edge_id = f"i2_edge_{_digest(import_id + '|' + u + '|' + v + '|' + edge_type)}"

            style_dict = first_raw.get("style") or {}
            color = style_dict.get("line_colour") or ("#dc2626" if edge_type == "call" else "#64748b")
            width = style_dict.get("line_width") or 1.8

            all_call_lines = []
            all_records = []
            has_to = False
            has_from = False

            for it in items:
                raw_e = it["raw"]
                arrows = raw_e.get("arrows") or "none"
                if it["mapped_from"] == mapped_from:
                    if "to" in arrows: has_to = True
                    if "from" in arrows: has_from = True
                else:
                    if "to" in arrows: has_from = True
                    if "from" in arrows: has_to = True

                c_lines = raw_e.get("call_lines") or []
                if not c_lines and raw_e.get("label"):
                    raw_lbl = str(raw_e.get("label") or "")
                    c_lines = [line.strip() for line in raw_lbl.replace("\r", "\n").split("\n") if line.strip()]
                for cl in c_lines:
                    if cl and cl not in all_call_lines:
                        all_call_lines.append(cl)

                rec = raw_e.get("records") or []
                if rec:
                    all_records.extend(rec)

            arrows_final = "to;from" if (has_to and has_from) else ("to" if has_to else ("from" if has_from else "none"))
            total_count = len(items)
            if edge_type == "call" and total_count > 1:
                final_label = f"📞 โทร {total_count} ครั้ง"
            elif edge_type == "call" and total_count == 1 and all_call_lines:
                final_label = f"📞 โทร {total_count} ครั้ง"
            elif total_count > 1:
                final_label = f"{_text(first_raw.get('label') or edge_type)} ({total_count} รายการ)"
            else:
                final_label = _text(first_raw.get("label") or "")

            raw_bps = first_raw.get("bend_points") or []
            scaled_bps = []
            for bp in raw_bps:
                if isinstance(bp, dict) and "x" in bp and "y" in bp:
                    scaled_bps.append({
                        "x": round((float(bp["x"]) - center_x) * scale) if valid_coords else float(bp["x"]),
                        "y": round((float(bp["y"]) - center_y) * scale) if valid_coords else float(bp["y"]),
                    })

            edges[edge_id] = {
                "id": edge_id,
                "from": mapped_from,
                "to": mapped_to,
                "label": final_label,
                "call_lines": all_call_lines,
                "records": all_records,
                "call_count": total_count,
                "type": edge_type,
                "status": "active",
                "provenance": "i2_import",
                "confidence": "strong",
                "connects_component": True,
                "color": color,
                "width": max(1.5, min(8.0, float(width) + (0.3 * min(total_count, 10)))),
                "arrows": arrows_final,
                "bend_points": scaled_bps,
                "i2_edge_id": str(first_raw.get("id") or ""),
                "import_id": import_id,
            }

        components = self._components(nodes, edges, {})
        fingerprint_payload = {
            "nodes": sorted(nodes),
            "edges": sorted((key, value.get("from"), value.get("to"), value.get("status")) for key, value in edges.items()),
        }
        fingerprint = sha256(json.dumps(fingerprint_payload, separators=(",", ":")).encode()).hexdigest()
        stats = {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "components_count": len(components),
            "persons_count": sum(node.get("group") == "person" for node in nodes.values()),
            "phones_count": sum(node.get("group") == "phone" for node in nodes.values()),
            "i2_nodes_count": len(nodes),
            "i2_edges_count": len(edges),
            "isolated_import_id": import_id,
            "chart_filename": record.get("filename"),
        }

        return {
            "status": "success",
            "isolated": True,
            "import_id": import_id,
            "filename": record.get("filename"),
            "fingerprint": fingerprint,
            "stats": stats,
            "components": components,
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
        }

    def generate_graph(
        self,
        focus_dossier_id: Optional[str] = None,
        depth: Optional[int] = None,
        import_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return graph data, real components, weak proposal counts, and a refresh fingerprint."""

        cache_key = (focus_dossier_id, depth, import_id)
        current_time = time.time()
        with getattr(self, "_cache_lock", threading.RLock()):
            if not hasattr(self, "_graph_cache"):
                self._graph_cache = OrderedDict()
            # Purge expired cache entries (TTL 300s)
            expired_keys = [k for k, v in self._graph_cache.items() if current_time - v.get("time", 0) >= 300.0]
            for k in expired_keys:
                self._graph_cache.pop(k, None)

            if cache_key in self._graph_cache:
                entry = self._graph_cache[cache_key]
                current_rev = self.graph_store.get_revision() if (self.graph_store and hasattr(self.graph_store, "get_revision")) else (self.graph_store.snapshot().get("revision", 0) if self.graph_store else 0)
                if entry.get("revision") == current_rev:
                    self._graph_cache.move_to_end(cache_key)
                    return entry["data"]

        if import_id:
            res = self._isolated_i2_graph(import_id)
            with getattr(self, "_cache_lock", threading.RLock()):
                self._graph_cache[cache_key] = {
                    "time": current_time,
                    "revision": 0,
                    "data": res,
                }
                self._graph_cache.move_to_end(cache_key)
                while len(self._graph_cache) > getattr(self, "_graph_cache_max", 16):
                    self._graph_cache.popitem(last=False)
            return res

        state = self.graph_store.snapshot() if self.graph_store else {
            "revision": 0, "approved_person_names": {}, "proposals": {},
            "manual_edges": {}, "component_names": {},
        }
        nodes: Dict[str, Dict[str, Any]] = {}
        edges: Dict[str, Dict[str, Any]] = {}
        proposals = self._source_graph(nodes, edges, state)
        if self.graph_store:
            self.graph_store.ensure_proposals(proposals)
            state = self.graph_store.snapshot()
        self._reviewed_graph(nodes, edges, state, proposals)

        # Apply any node_overrides (label/photo/phone edits) to ALL nodes including i2 nodes
        all_node_overrides = state.get("node_overrides", {})
        for _nid, _override in all_node_overrides.items():
            if _nid in nodes and isinstance(_override, Mapping):
                nodes[_nid].update({k: v for k, v in _override.items() if k not in ("updated_at", "updated_by") and v is not None})

        focus_id = f"person_{focus_dossier_id}" if focus_dossier_id else None
        if focus_id and focus_id not in nodes and hasattr(self, "_last_node_redirects") and focus_id in self._last_node_redirects:
            focus_id = self._last_node_redirects[focus_id]
        nodes, edges = self._focus(nodes, edges, focus_id, depth)
        components = self._components(nodes, edges, state.get("component_names", {}))
        fingerprint_payload = {
            "nodes": sorted(nodes),
            "edges": sorted((key, value.get("from"), value.get("to"), value.get("status")) for key, value in edges.items()),
        }
        fingerprint = sha256(json.dumps(fingerprint_payload, separators=(",", ":")).encode()).hexdigest()
        stats = {
            "total_nodes": len(nodes), "total_edges": len(edges), "components_count": len(components),
            "persons_count": sum(node.get("group") == "person" for node in nodes.values()),
            "provisional_persons_count": sum(bool(node.get("provisional")) for node in nodes.values()),
            "phones_count": sum(node.get("group") == "phone" for node in nodes.values()),
            "parcels_count": sum(node.get("group") == "parcel" for node in nodes.values()),
            "meters_count": sum(node.get("group") == "meter" for node in nodes.values()),
            "addresses_count": sum(node.get("group") == "address" for node in nodes.values()),
            "networks_count": sum(node.get("group") == "network" for node in nodes.values()),
            "bank_accounts_count": sum(node.get("group") == "bank_account" for node in nodes.values()),
            "counterparties_count": sum(node.get("group") == "counterparty" for node in nodes.values()),
            "calls_count": sum(edge.get("type") == "call" for edge in edges.values()),
            "transfers_count": sum(edge.get("type") == "money_transfer" for edge in edges.values()),
            "pending_proposals_count": sum(edge.get("status") == "pending" for edge in edges.values()),
            "i2_nodes_count": sum("i2_import" in node.get("provenance", []) for node in nodes.values()),
            "i2_edges_count": sum(edge.get("provenance") == "i2_import" for edge in edges.values()),
        }
        result = {
            "status": "success", "focus_dossier_id": focus_dossier_id, "focus_depth": depth,
            "revision": int(state.get("revision", 0)), "fingerprint": fingerprint,
            "stats": stats, "components": components,
            "nodes": list(nodes.values()), "edges": list(edges.values()),
        }
        with getattr(self, "_cache_lock", threading.RLock()):
            self._graph_cache[cache_key] = {
                "time": current_time,
                "revision": int(state.get("revision", 0)),
                "data": result,
            }
            self._graph_cache.move_to_end(cache_key)
            while len(self._graph_cache) > getattr(self, "_graph_cache_max", 16):
                self._graph_cache.popitem(last=False)
        return result
