"""
BPP-VMS | chat-service | services/event_store.py
-------------------------------------------------
EventStore & RequestStore — จัดเก็บเหตุการณ์และคำขอแก้ไข (thread-safe, JSON persistence, singleton)
- รองรับการบันทึกข้อมูลลงไฟล์ JSON ป้องกันข้อมูลหายเมื่อรีสตาร์ตคอนเทนเนอร์
- รองรับการแยกแยะสิทธิ์ตามบทบาท (admin vs officer/user)
-------------------------------------------------
Author : BPP-VMS Team
Created: 2026-08-04
"""

import json
import os
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
EVENTS_FILE = os.path.join(DATA_DIR, "events.json")
REQUESTS_FILE = os.path.join(DATA_DIR, "requests.json")


def is_valid_incident(ev: dict) -> bool:
    """
    ตรวจสอบความสมบูรณ์ของรายงานเหตุการณ์:
    1. จุดวางงาน (drop_point) หรือ พัสดุ (parcels) อนุญาตเสมอ
    2. ต้องระบุประเภทคดี (incident_type) ที่ถูกต้อง (ไม่ใช่ None, null, หรือว่าง)
    3. ต้องมีข้อมูลเนื้อหาที่สอดคล้องอย่างน้อย 1 เงื่อนไข:
       - มีสถานที่เกิดเหตุ (has_loc) และมีข้อมูลบุคคล/ผู้ต้องหา (has_person)
       - มีสถานที่เกิดเหตุ (has_loc) และมีของกลาง (has_evidence)
       - มีข้อมูลบุคคล (has_person) พร้อมเลขบัตรประชาชน (has_id_card) และ (มีสถานที่ หรือ ของกลาง)
    ป้องกันไม่ให้ข้อความทั่วไป, ข้อความค้นหา, หรือเบอร์โทรศัพท์สั้นๆ ถูกบันทึกเป็นเหตุการณ์
    """
    if not isinstance(ev, dict):
        return False

    if ev.get("is_drop_point") or bool(ev.get("parcels")):
        return True

    inc_type = ev.get("incident_type")
    if not inc_type or str(inc_type).lower() in ("none", "null", ""):
        return False

    has_loc = bool(
        ev.get("location_name")
        or ev.get("arrest_location")
        or ev.get("subdistrict")
        or ev.get("district")
        or ev.get("province")
        or (ev.get("lat") is not None and ev.get("lon") is not None)
    )
    has_person = bool(
        ev.get("first_name")
        or ev.get("last_name")
        or (ev.get("suspects") and len(ev.get("suspects")) > 0)
    )
    has_evidence = bool(
        ev.get("evidence_items")
        or (ev.get("drug_quantity") or 0) > 0
        or (ev.get("weapon_quantity") or 0) > 0
        or (ev.get("alien_count") or 0) > 0
    )
    has_id_card = bool(ev.get("id_card"))

    # Lock 2: A valid criminal incident requires genuine crime substance (evidence, arrest scene, charges)
    # Pure person profile + home address without crime context is a dossier, NEVER an incident on the heatmap
    has_crime_substance = bool(
        has_evidence
        or ev.get("arrest_location")
        or ev.get("charges")
        or (ev.get("raw_text") and any(kw in str(ev.get("raw_text")) for kw in ["จับกุม", "ตรวจยึด", "ของกลาง", "ยาบ้า", "ไอซ์", "อาวุธ", "ยาเสพติด"]))
    )

    if has_evidence and (has_loc or has_person):
        return True
    if has_loc and has_crime_substance:
        return True
    if has_person and has_crime_substance and (has_loc or has_evidence):
        return True

    return False


class EventStore:
    """
    Singleton class สำหรับจัดเก็บเหตุการณ์ที่ได้รับจาก chat (พร้อม JSON persistence)
    """

    _instance: Optional["EventStore"] = None
    _lock: threading.Lock = threading.Lock()

    MAX_EVENTS: int = 500

    def __new__(cls) -> "EventStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    instance = super().__new__(cls)
                    instance._events: deque[dict] = deque(maxlen=cls.MAX_EVENTS)
                    instance._rw_lock = threading.RLock()
                    instance._load_from_disk()
                    cls._instance = instance
        return cls._instance

    def _load_from_disk(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        if os.path.exists(EVENTS_FILE):
            try:
                with open(EVENTS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        normalized = []
                        for ev in data:
                            if isinstance(ev, dict):
                                eid = ev.get("id") or ev.get("event_id") or str(uuid.uuid4())
                                ev["id"] = eid
                                ev["event_id"] = eid
                                normalized.append(ev)
                        self._events = deque(normalized, maxlen=self.MAX_EVENTS)
            except Exception as e:
                print(f"[EventStore] Load error: {e}")

    def _save_to_disk(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        try:
            with open(EVENTS_FILE, "w", encoding="utf-8") as f:
                json.dump(list(self._events), f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[EventStore] Save error: {e}")

    def cleanup_empty_events(self) -> int:
        """Purge invalid/empty/query events that contain no actionable incident info."""
        with self._rw_lock:
            original_len = len(self._events)
            cleaned = [ev for ev in self._events if is_valid_incident(ev)]
            self._events = deque(cleaned, maxlen=self.MAX_EVENTS)
            self._save_to_disk()
            return original_len - len(self._events)

    def add_event(self, parsed: dict, created_by: str = "admin", created_role: str = "admin") -> str:
        # Validate that parsed represents a genuine, actionable incident
        if not is_valid_incident(parsed):
            return ""

        event_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

        event = {
            "id": event_id,
            "event_id": event_id,
            "created_at": created_at,
            "created_by": created_by,
            "created_role": created_role,
            **parsed,
        }

        with self._rw_lock:
            self._events.append(event)
            self._save_to_disk()

        return event_id

    def get_all(self, username: Optional[str] = None, role: Optional[str] = None) -> list:
        with self._rw_lock:
            events = list(self._events)

        # Allow all authenticated roles (superadmin, admin, officer, user)
        # to view shared field intelligence events across dashboard & heatmap
        if role in ("admin", "superadmin", "officer", "user") or not username:
            return events

        return events

    def get_by_id(self, event_id: str) -> Optional[dict]:
        with self._rw_lock:
            for ev in self._events:
                if ev.get("event_id") == event_id or ev.get("id") == event_id:
                    return dict(ev)
        return None

    def get_drop_points(self) -> list:
        with self._rw_lock:
            events = list(self._events)
        return [ev for ev in events if ev.get("is_drop_point")]

    def get_zone_summary(
        self, start_date: Optional[str] = None, end_date: Optional[str] = None
    ) -> dict:
        summary: dict[str, int] = {}

        with self._rw_lock:
            events = list(self._events)

        for event in events:
            if event.get("is_drop_point"):
                continue  # จุดวางงานจะไม่ถูกนำมานับรวมในดัชนีความเสี่ยงโซนพื้นที่และ Leaderboard

            created_at = (event.get("created_at") or "")[:10]
            if start_date and created_at and created_at < start_date:
                continue
            if end_date and created_at and created_at > end_date:
                continue

            district = event.get("district")
            if not district:
                continue  # ข้ามกรณีที่ไม่ระบุอำเภอออกจากการจัดลำดับความเสี่ยงโซน

            count = event.get("incident_count") or 1
            summary[district] = summary.get(district, 0) + count

        return dict(sorted(summary.items(), key=lambda x: x[1], reverse=True))

    def delete_event(self, event_id: str) -> bool:
        with self._rw_lock:
            for i, ev in enumerate(self._events):
                if ev.get("event_id") == event_id or ev.get("id") == event_id:
                    del self._events[i]
                    self._save_to_disk()
                    return True
        return False

    def update_event(self, event_id: str, new_parsed: dict) -> bool:
        with self._rw_lock:
            for i, ev in enumerate(self._events):
                if ev.get("event_id") == event_id or ev.get("id") == event_id:
                    created_at = ev.get("created_at")
                    created_by = ev.get("created_by")
                    created_role = ev.get("created_role")
                    self._events[i] = {
                        "event_id": event_id,
                        "created_at": created_at,
                        "created_by": created_by,
                        "created_role": created_role,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        **new_parsed,
                    }
                    self._save_to_disk()
                    return True
        return False

    def clear(self) -> None:
        with self._rw_lock:
            self._events.clear()
            self._save_to_disk()

    def __len__(self) -> int:
        with self._rw_lock:
            return len(self._events)


class RequestStore:
    """
    Singleton class สำหรับจัดเก็บคำขอแก้ไข/ลบเหตุการณ์จากเจ้าหน้าที่ (พร้อม JSON persistence)
    """

    _instance: Optional["RequestStore"] = None
    _lock: threading.Lock = threading.Lock()

    def __new__(cls) -> "RequestStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    instance = super().__new__(cls)
                    instance._requests: list[dict] = []
                    instance._rw_lock = threading.RLock()
                    instance._load_from_disk()
                    cls._instance = instance
        return cls._instance

    def _load_from_disk(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        if os.path.exists(REQUESTS_FILE):
            try:
                with open(REQUESTS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        self._requests = data
            except Exception as e:
                print(f"[RequestStore] Load error: {e}")

    def _save_to_disk(self) -> None:
        os.makedirs(DATA_DIR, exist_ok=True)
        try:
            with open(REQUESTS_FILE, "w", encoding="utf-8") as f:
                json.dump(self._requests, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[RequestStore] Save error: {e}")

    def add_request(
        self,
        action: str,
        event_id: str,
        requested_by: str,
        proposed_text: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> str:
        req_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

        req = {
            "req_id": req_id,
            "action": action,
            "event_id": event_id,
            "requested_by": requested_by,
            "proposed_text": proposed_text,
            "reason": reason,
            "status": "pending",
            "created_at": created_at,
        }

        with self._rw_lock:
            self._requests.append(req)
            self._save_to_disk()

        return req_id

    def get_all(self, status: Optional[str] = "pending") -> list:
        with self._rw_lock:
            if not status:
                return list(self._requests)
            return [r for r in self._requests if r.get("status") == status]

    def update_status(self, req_id: str, status: str) -> Optional[dict]:
        with self._rw_lock:
            for r in self._requests:
                if r.get("req_id") == req_id:
                    if r.get("status") != "pending":
                        return None
                    r["status"] = status
                    r["resolved_at"] = datetime.now(timezone.utc).isoformat()
                    self._save_to_disk()
                    return dict(r)
        return None
