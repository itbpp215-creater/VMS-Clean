"""
Vehicle Intelligence & Ownership Manager (BPP-VMS)
--------------------------------------------------
Manages vehicle records, DLT registration documents, ALPR hits,
and suspect ownership binding for the Arrest Vault and Sloth AI Bot.

Data persistence: /data/nas-storage/Vehicles/vehicles_index.json
"""

import os
import json
import logging
import datetime
import re
from typing import Dict, Any, List, Optional

logger = logging.getLogger("nas-bot.vehicle_manager")

THAI_PROVINCE_ABBR_MAP = {
    "กทม": "กรุงเทพมหานคร",
    "กทม.": "กรุงเทพมหานคร",
    "กรุงเทพ": "กรุงเทพมหานคร",
    "บร": "บุรีรัมย์",
    "บร.": "บุรีรัมย์",
    "นม": "นครราชสีมา",
    "นม.": "นครราชสีมา",
    "อบ": "อุบลราชธานี",
    "สร": "สุรินทร์",
    "ศก": "ศรีสะเกษ",
    "ขก": "ขอนแก่น",
    "ชม": "เชียงใหม่",
    "ชบ": "ชลบุรี",
    "สป": "สมุทรปราการ",
    "นบ": "นนทบุรี",
    "ปท": "ปทุมธานี",
    "อย": "พระนครศรีอยุธยา"
}

CORPORATE_OWNER_REGEX = re.compile(
    r'(?:บริษัท|บจก\.|บมจ\.|ห้างหุ้นส่วน|หจก\.|ลิสซิ่ง|แคปปิตอล|ธนาคาร|ไฟแนนซ์|leasing|bank|capital|ลีสซิ่ง|โตโยต้า\s*ลีสซิ่ง|ฮอนด้า\s*ลีสซิ่ง)',
    re.IGNORECASE
)


def normalize_plate_key(plate: str, province: Optional[str] = None) -> str:
    """Creates a normalized storage key for a vehicle, e.g. 'ขฒ4719_กทม'."""
    clean_p = re.sub(r'[\s\-_.]', '', str(plate or '')).strip()
    norm_prov = normalize_province_name(province) if province else "ไม่ระบุจังหวัด"
    clean_prov = re.sub(r'[\s\-_.]', '', norm_prov)
    return f"{clean_p}_{clean_prov}"


def normalize_plate_display(plate: str) -> str:
    """Formats plate nicely with a space between series and digits, e.g. 'ขฒ 4719' or '1ฒฮ 8899'."""
    if not plate:
        return ""
    p = plate.strip()
    m = re.match(r'^([1-9]?[ก-ฮ]{1,2})\s*(\d{1,4})$', p)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return p


def normalize_province_name(province: Optional[str]) -> str:
    """Normalizes province abbreviations (e.g. 'กทม.' -> 'กรุงเทพมหานคร')."""
    if not province:
        return "กรุงเทพมหานคร"
    clean = province.strip().replace(" ", "")
    return THAI_PROVINCE_ABBR_MAP.get(clean, clean)


class VehicleManager:
    def __init__(self, root_storage_dir: str = "/data/nas-storage"):
        self.root_storage_dir = root_storage_dir
        self.vehicles_dir = os.path.join(root_storage_dir, "Vehicles")
        self.index_file = os.path.join(self.vehicles_dir, "vehicles_index.json")
        self._ensure_dir()

    def _ensure_dir(self):
        try:
            os.makedirs(self.vehicles_dir, exist_ok=True)
            if not os.path.exists(self.index_file):
                with open(self.index_file, "w", encoding="utf-8") as f:
                    json.dump({"vehicles": [], "updated_at": datetime.datetime.now().isoformat()}, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to initialize vehicle directory: {e}")

    def _load_index(self) -> Dict[str, Any]:
        try:
            if os.path.exists(self.index_file):
                with open(self.index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error loading vehicle index: {e}")
        return {"vehicles": [], "updated_at": datetime.datetime.now().isoformat()}

    def _save_index(self, data: Dict[str, Any]):
        try:
            data["updated_at"] = datetime.datetime.now().isoformat()
            temp_file = f"{self.index_file}.tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(temp_file, self.index_file)
        except Exception as e:
            logger.error(f"Error saving vehicle index: {e}")

    def upsert_vehicle(
        self,
        plate: str,
        province: Optional[str] = None,
        vehicle_type: Optional[str] = None,
        brand: Optional[str] = None,
        model: Optional[str] = None,
        color: Optional[str] = None,
        chassis_no: Optional[str] = None,
        engine_no: Optional[str] = None,
        owner_name: Optional[str] = None,
        owner_id: Optional[str] = None,
        finance_company: Optional[str] = None,
        dossier_id: Optional[str] = None,
        ownership_status: str = "verified",
        source: str = "manual",
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates or updates a vehicle record.
        Filters out corporate owners from owner_name and moves them to finance_company.
        """
        clean_plate = normalize_plate_display(plate)
        norm_province = normalize_province_name(province)
        plate_key = normalize_plate_key(clean_plate, norm_province)

        # Corporate Owner Filter Check
        final_owner = owner_name
        final_finance = finance_company
        if owner_name and CORPORATE_OWNER_REGEX.search(owner_name):
            if not final_finance:
                final_finance = owner_name.strip()
            final_owner = None
            if ownership_status == "verified" and not dossier_id:
                ownership_status = "unidentified"

        data = self._load_index()
        vehicles = data.get("vehicles", [])

        existing = next((v for v in vehicles if v.get("plate_key") == plate_key or (
            re.sub(r'\s', '', v.get("plate", '')) == re.sub(r'\s', '', clean_plate) and
            normalize_province_name(v.get("province")) == norm_province
        )), None)

        now_iso = datetime.datetime.now().isoformat()

        if existing:
            if clean_plate: existing["plate"] = clean_plate
            if norm_province: existing["province"] = norm_province
            if vehicle_type: existing["type"] = vehicle_type
            if brand: existing["brand"] = brand
            if model: existing["model"] = model
            if color: existing["color"] = color
            if chassis_no: existing["chassis_no"] = chassis_no
            if engine_no: existing["engine_no"] = engine_no
            if final_owner: existing["owner_name"] = final_owner
            if owner_id: existing["owner_id"] = owner_id
            if final_finance: existing["finance_company"] = final_finance
            if dossier_id: existing["dossier_id"] = dossier_id
            if ownership_status: existing["ownership_status"] = ownership_status
            if source: existing["source"] = source
            if notes:
                existing["notes"] = f"{existing.get('notes', '')}\n{notes}".strip() if existing.get("notes") else notes
            existing["updated_at"] = now_iso
            record = existing
        else:
            record = {
                "plate_key": plate_key,
                "plate": clean_plate,
                "province": norm_province,
                "type": vehicle_type or "รถยนต์",
                "brand": brand,
                "model": model,
                "color": color,
                "chassis_no": chassis_no,
                "engine_no": engine_no,
                "owner_name": final_owner,
                "owner_id": owner_id,
                "finance_company": final_finance,
                "dossier_id": dossier_id,
                "ownership_status": ownership_status,
                "source": source,
                "notes": notes,
                "created_at": now_iso,
                "updated_at": now_iso
            }
            vehicles.append(record)

        data["vehicles"] = vehicles
        self._save_index(data)
        logger.info(f"Upserted vehicle record: {clean_plate} {norm_province} (Dossier: {dossier_id or 'none'})")
        return record

    def find_vehicle(self, query: str) -> Optional[Dict[str, Any]]:
        """Finds a vehicle by exact plate match, plate key, or digits + letters."""
        if not query:
            return None
        clean_q = re.sub(r'[\s\-_.]', '', str(query).lower())
        data = self._load_index()
        for v in data.get("vehicles", []):
            v_key = re.sub(r'[\s\-_.]', '', v.get("plate_key", '').lower())
            v_plate = re.sub(r'[\s\-_.]', '', v.get("plate", '').lower())
            if clean_q == v_key or clean_q == v_plate:
                return v
            if len(clean_q) >= 4 and clean_q in v_plate:
                return v
        return None

    def search_vehicles(self, query: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """Returns list of vehicles filtered by query."""
        data = self._load_index()
        vehicles = data.get("vehicles", [])
        if not query:
            return vehicles[:limit]

        q = str(query).strip().lower()
        clean_q = re.sub(r'[\s\-_.]', '', q)

        results = []
        for v in vehicles:
            v_text = f"{v.get('plate', '')} {v.get('province', '')} {v.get('brand', '')} {v.get('model', '')} {v.get('owner_name', '')} {v.get('dossier_id', '')}".lower()
            v_clean = re.sub(r'[\s\-_.]', '', v_text)
            if q in v_text or clean_q in v_clean:
                results.append(v)
            if len(results) >= limit:
                break
        return results

    def bind_to_dossier(
        self,
        plate: str,
        province: Optional[str],
        dossier_id: str,
        owner_name: Optional[str] = None,
        owner_id: Optional[str] = None,
        status: str = "verified"
    ) -> Optional[Dict[str, Any]]:
        """Binds a vehicle directly to a suspect dossier."""
        return self.upsert_vehicle(
            plate=plate,
            province=province,
            dossier_id=dossier_id,
            owner_name=owner_name,
            owner_id=owner_id,
            ownership_status=status
        )

    def set_unidentified(self, plate: str, province: Optional[str], notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Marks vehicle as suspicious / unidentified owner."""
        return self.upsert_vehicle(
            plate=plate,
            province=province,
            dossier_id=None,
            owner_name=None,
            ownership_status="unidentified",
            notes=notes or "ไม่ทราบผู้ครอบครองแน่ชัด / อยู่ระหว่างสืบสวน"
        )
