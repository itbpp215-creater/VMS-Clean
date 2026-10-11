import copy
import json
import os
import threading
import time
from typing import Dict, Any, List, Set, Optional

class UserProfileManager:
    """
    Manages per-user personal dashboard preferences (camera visibility, AI detect, LPR, grid layout)
    Persisted in /data/user_profiles.json.
    """
    def __init__(self, storage_path: str = "/data/user_profiles.json"):
        self.storage_path = storage_path
        self._lock = threading.Lock()
        self.profiles: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        with self._lock:
            if os.path.exists(self.storage_path):
                try:
                    with open(self.storage_path, "r", encoding="utf-8") as f:
                        self.profiles = json.load(f)
                except Exception as e:
                    print(f"Error loading user_profiles.json: {e}")
                    self.profiles = {}
            else:
                self.profiles = {}

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(self.profiles, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving user_profiles.json: {e}")

    def get_profile(self, username: str) -> Dict[str, Any]:
        with self._lock:
            if username not in self.profiles:
                # Default profile: All active channels visible, AI & LPR enabled by default
                self.profiles[username] = {
                    "username": username,
                    "layout": "2x2",
                    "visible_channels": [],
                    "hidden_channels": [],
                    "disabled_ai_cameras": [],
                    "disabled_lpr_cameras": [],
                    "events_open": True,
                    "channels": None,
                    "grid_revision": 0
                }
            return dict(self.profiles[username])

    def get_all_profiles(self) -> Dict[str, Any]:
        """Return a copy of all user profiles for Superadmin inspection (ADR-0022)."""
        with self._lock:
            return {u: dict(p) for u, p in self.profiles.items()}

    def update_profile(self, username: str, data: Dict[str, Any], by_admin: bool = False,
                       client_revision: Optional[int] = None) -> Dict[str, Any]:
        """
        Update a profile. ADR-0024:
        - by_admin=True (a Superadmin wrote another account's grid) bumps grid_revision
          and mirrors the new grid into active_channels so demand provisioning sees it at once.
        - A user's own write carrying a stale client_revision never overwrites `channels`.
        """
        with self._lock:
            current = self.profiles.get(username, {
                "username": username,
                "layout": "2x2",
                "visible_channels": [],
                "hidden_channels": [],
                "disabled_ai_cameras": [],
                "disabled_lpr_cameras": [],
                "events_open": True,
                "channels": None,
                "grid_revision": 0
            })
            
            if "layout" in data and isinstance(data["layout"], str):
                current["layout"] = data["layout"]
            if "visible_channels" in data and isinstance(data["visible_channels"], list):
                current["visible_channels"] = [str(x) for x in data["visible_channels"]]
            if "hidden_channels" in data and isinstance(data["hidden_channels"], list):
                current["hidden_channels"] = [str(x) for x in data["hidden_channels"]]
            if "disabled_ai_cameras" in data and isinstance(data["disabled_ai_cameras"], list):
                current["disabled_ai_cameras"] = [str(x) for x in data["disabled_ai_cameras"]]
            if "disabled_lpr_cameras" in data and isinstance(data["disabled_lpr_cameras"], list):
                current["disabled_lpr_cameras"] = [str(x) for x in data["disabled_lpr_cameras"]]
            if "events_open" in data:
                current["events_open"] = bool(data["events_open"])
            stale = (
                not by_admin
                and client_revision is not None
                and int(client_revision) < int(current.get("grid_revision", 0))
            )
            if "channels" in data and not stale:
                if data["channels"] is None:
                    current["channels"] = None
                elif isinstance(data["channels"], list):
                    current["channels"] = [dict(x) for x in data["channels"] if isinstance(x, dict)]
                if by_admin:
                    current["grid_revision"] = int(current.get("grid_revision", 0)) + 1
                    self._mirror_active(current)

            self.profiles[username] = current
            self._save()
            result = dict(current)
            result["stale"] = stale
            return result

    def get_aggregated_ai_cameras(self, all_cameras: List[str]) -> List[str]:
        """
        Dynamic Aggregated State (OR Logic) for AI Detect:
        A camera is active for AI if at least ONE user has NOT disabled it.
        It is disabled only if ALL registered profiles have explicitly disabled it.
        """
        with self._lock:
            if not self.profiles:
                return list(all_cameras)
            
            # For each camera, check if at least one profile keeps it enabled
            active_cams = []
            for cam in all_cameras:
                # If any user does NOT have cam in disabled_ai_cameras -> active
                if any(cam not in p.get("disabled_ai_cameras", []) for p in self.profiles.values()):
                    active_cams.append(cam)
            return active_cams

    def get_aggregated_lpr_cameras(self, all_cameras: List[str]) -> List[str]:
        """
        Dynamic Aggregated State (OR Logic) for LPR:
        A camera is active for LPR if at least ONE user has NOT disabled it.
        """
        with self._lock:
            if not self.profiles:
                return list(all_cameras)
            
            active_cams = []
            for cam in all_cameras:
                if any(cam not in p.get("disabled_lpr_cameras", []) for p in self.profiles.values()):
                    active_cams.append(cam)
            return active_cams

    def update_heartbeat(self, username: str, channels: Optional[List[Dict[str, Any]]] = None,
                         client_revision: Optional[int] = None) -> Dict[str, Any]:
        """
        Update last_seen and optionally the active channel layout for a user.
        ADR-0024: a client whose grid_revision is older than the server's is stale; its
        reported channels are ignored so a Superadmin change is not overwritten.
        Returns {"grid_revision": int, "stale": bool}.
        """
        with self._lock:
            current = self.profiles.setdefault(username, {
                "username": username,
                "layout": "2x2",
                "visible_channels": [],
                "hidden_channels": [],
                "disabled_ai_cameras": [],
                "disabled_lpr_cameras": [],
                "events_open": True,
                "channels": None
            })
            current["last_seen"] = time.time()
            server_rev = int(current.get("grid_revision", 0))
            stale = client_revision is not None and int(client_revision) < server_rev
            if channels is not None and not stale:
                current["active_channels"] = [dict(x) for x in channels if isinstance(x, dict)]
            self._save()
            return {"grid_revision": server_rev, "stale": stale}

    def logout(self, username: str) -> None:
        """Mark user as offline immediately."""
        with self._lock:
            if username in self.profiles:
                self.profiles[username]["last_seen"] = 0
                self._save()

    def get_online_users(self, timeout_sec: int = 300) -> List[Dict[str, Any]]:
        """Return list of profiles active within timeout_sec."""
        with self._lock:
            now = time.time()
            return [
                dict(p) for p in self.profiles.values()
                if (now - float(p.get("last_seen", 0))) < timeout_sec
            ]

    def get_demand_camera_pool(self, timeout_sec: int = 300) -> Dict[str, Any]:
        """
        Demand-Driven Camera Provisioning (ADR-0020):
        Computes the Aggregated Camera Pool as the union set of active cameras
        demanded by all currently online users.
        """
        with self._lock:
            now = time.time()
            online_profiles = [
                p for p in self.profiles.values()
                if (now - float(p.get("last_seen", 0))) < timeout_sec
            ]
            cams = set()
            online_users = []
            for p in online_profiles:
                online_users.append(p.get("username", "unknown"))
                ch_list = p.get("active_channels") or p.get("channels") or []
                for ch in ch_list:
                    if isinstance(ch, dict):
                        src = ch.get("src")
                        if src and ch.get("enabled", True) is not False:
                            cams.add(str(src))
            return {
                "cameras": sorted(list(cams)),
                "online_users": len(online_profiles),
                "users": online_users
            }


    # ------------------------------------------------------------------
    # ADR-0024: per-account AI demand, Global Layout Broadcast, Kill-Switches
    # ------------------------------------------------------------------
    @staticmethod
    def _mirror_active(current: Dict[str, Any]) -> None:
        """Mirror the saved grid into active_channels (heartbeat format)."""
        chans = current.get("channels")
        if isinstance(chans, list):
            current["active_channels"] = [
                {"src": str(c["src"]), "enabled": True}
                for c in chans
                if isinstance(c, dict) and c.get("src") and c.get("enabled", True) is not False
            ]

    @staticmethod
    def _demanded_cameras(profiles: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
        """camera -> accounts demanding AI (channel streaming AND detect == True)."""
        demand: Dict[str, List[str]] = {}
        for user, p in profiles.items():
            for c in (p.get("channels") or []):
                if (
                    isinstance(c, dict) and c.get("src")
                    and c.get("enabled", True) is not False
                    and c.get("detect") is True
                ):
                    users = demand.setdefault(str(c["src"]), [])
                    if user not in users:
                        users.append(user)
        return demand

    def get_ai_demand(self) -> Dict[str, List[str]]:
        with self._lock:
            return self._demanded_cameras(self.profiles)

    def _grid_targets(self, scope: str, target_user: Optional[str], issuer: str) -> List[str]:
        if scope == "account":
            return [target_user] if target_user in self.profiles else []
        return [u for u in self.profiles if u != issuer]

    def apply_grid_action(self, action: str, scope: str, issuer: str,
                          target_user: Optional[str] = None,
                          source_channels: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        action: broadcast | stream_off | ai_off | stream_on
        scope : account (target_user) | all (every account except the issuer)
        Returns affected users plus AI demand deltas (cameras whose Frigate AI must change).
        """
        if action not in ("broadcast", "stream_off", "ai_off", "stream_on"):
            raise ValueError("unknown action")
        if scope not in ("account", "all"):
            raise ValueError("unknown scope")
        if action == "broadcast" and not isinstance(source_channels, list):
            raise ValueError("broadcast requires channels")
        with self._lock:
            before = set(self._demanded_cameras(self.profiles))
            updated, skipped = [], []
            for user in self._grid_targets(scope, target_user, issuer):
                p = self.profiles[user]
                if action == "broadcast":
                    if not isinstance(p.get("channels"), list):
                        # No personal grid: inherits the System Master Grid, which the caller updates.
                        skipped.append(user)
                        continue
                    p["channels"] = [copy.deepcopy(c) for c in source_channels if isinstance(c, dict)]
                else:
                    chans = p.get("channels")
                    if not isinstance(chans, list):
                        skipped.append(user)
                        continue
                    for c in chans:
                        if not isinstance(c, dict) or not c.get("src"):
                            continue
                        if action == "stream_off":
                            c["enabled"] = False
                        elif action == "stream_on":
                            c["enabled"] = True
                        elif action == "ai_off":
                            c["detect"] = False
                p["grid_revision"] = int(p.get("grid_revision", 0)) + 1
                self._mirror_active(p)
                updated.append(user)
            after = set(self._demanded_cameras(self.profiles))
            if updated:
                self._save()
            return {
                "updated_users": updated,
                "skipped_no_grid": skipped,
                "ai_release": sorted(before - after),
                "ai_acquire": sorted(after - before),
            }

    def delete_profile(self, username: str) -> bool:
        with self._lock:
            if username in self.profiles:
                del self.profiles[username]
                self._save()
                return True
            return False
