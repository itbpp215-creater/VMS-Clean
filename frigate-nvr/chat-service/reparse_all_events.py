import json
import os
from services.intent_parser import parse_message
from services.event_store import EventStore

store = EventStore()
events = store.get_all(role="admin")
print(f"Loaded {len(events)} events.")

updated_count = 0
for ev in events:
    raw = ev.get("raw_text")
    if raw:
        parsed = parse_message(raw)
        # Preserve original metadata
        event_id = ev.get("event_id")
        created_at = ev.get("created_at")
        created_by = ev.get("created_by")
        created_role = ev.get("created_role")
        
        parsed["event_id"] = event_id
        parsed["created_at"] = created_at
        parsed["created_by"] = created_by
        parsed["created_role"] = created_role
        
        store.update_event(event_id, parsed)
        updated_count += 1
        print(f"Reparsed event {event_id}: name={parsed.get('first_name')} {parsed.get('last_name')} | suspects={len(parsed.get('suspects', []))} | evidence={parsed.get('evidence_items')}")

print(f"Successfully re-parsed and updated {updated_count} events in database.")
