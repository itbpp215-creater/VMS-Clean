"""
User Subscriptions Manager for nas-bot-service (BPP-VMS)

Manages independent per-user Telegram alert subscriptions and Super Admin global broadcast controls.
Persists settings to `/data/user_subscriptions.json`.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger("nas-bot.user_subscriptions")

def is_time_in_range(start_str: str, end_str: str, current_time: datetime = None) -> bool:
    if not current_time:
        current_time = datetime.now()
    try:
        start_t = datetime.strptime(start_str, "%H:%M").time()
        end_t = datetime.strptime(end_str, "%H:%M").time()
        curr_t = current_time.time()
        
        if start_t <= end_t:
            return start_t <= curr_t <= end_t
        else:
            # Crosses midnight
            return start_t <= curr_t or curr_t <= end_t
    except ValueError:
        return True

DATA_DIR = os.getenv("NAS_DATA_DIR", "/data")
SUBSCRIPTIONS_FILE = os.path.join(DATA_DIR, "user_subscriptions.json")


class UserSubscriptionManager:
    """
    Manages per-user Telegram notification preferences and target chat resolution.
    """

    def __init__(self, data_dir: str = DATA_DIR):
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        self.filepath = os.path.join(self.data_dir, "user_subscriptions.json")
        self.subscriptions: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.subscriptions = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load user subscriptions: {e}")
                self.subscriptions = {}

    def _save(self) -> None:
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.subscriptions, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save user subscriptions: {e}")

    def get_subscription(self, username: str) -> Dict[str, Any]:
        """
        Get user subscription settings with default fallback (OFF by default until enabled & saved).
        """
        self._load()
        default_sub = {
            "username": username,
            "master_enabled": False,
            "broadcast_to_all": False,
            "cameras": {},
            "schedule_enabled": False,
            "schedule_start": "00:00",
            "schedule_end": "23:59"
        }
        return self.subscriptions.get(username, default_sub)

    def update_subscription(self, username: str, data: Dict[str, Any], is_admin: bool = False) -> Dict[str, Any]:
        """
        Update user subscription settings. Only admin can set broadcast_to_all.
        """
        current = self.get_subscription(username)
        
        if "master_enabled" in data:
            current["master_enabled"] = bool(data["master_enabled"])
            
        if is_admin and "broadcast_to_all" in data:
            current["broadcast_to_all"] = bool(data["broadcast_to_all"])
            
        if "cameras" in data and isinstance(data["cameras"], dict):
            current["cameras"] = data["cameras"]
            
        if "schedule_enabled" in data:
            current["schedule_enabled"] = bool(data["schedule_enabled"])
        if "schedule_start" in data:
            current["schedule_start"] = str(data["schedule_start"])
        if "schedule_end" in data:
            current["schedule_end"] = str(data["schedule_end"])
            
        self.subscriptions[username] = current
        self._save()
        return current

    def get_all_user_subscriptions(self, pairings: Dict[str, str], users: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Get subscription overview for all system users (Admin mode).
        """
        self._load()
        user_pairs = {}
        for pair_key, uname in pairings.items():
            if pair_key.startswith("telegram:"):
                cid = pair_key.split("telegram:", 1)[1]
                user_pairs.setdefault(uname, []).append(cid)
        
        # Build map of existing user records from auth-service (active accounts)
        user_dict = {u.get("username"): u for u in users if u.get("username")}
        
        # If active users list from auth-service is provided, prioritize showing active accounts
        if user_dict:
            all_usernames = set(user_dict.keys())
        else:
            all_usernames = set(self.subscriptions.keys()) | set(user_pairs.keys())
        
        results = []
        for uname in sorted(all_usernames):
            if not uname:
                continue
            u_info = user_dict.get(uname, {})
            sub = self.get_subscription(uname)
            results.append({
                "username": uname,
                "role": u_info.get("role", "admin" if uname in ["admin", "arm215", "suchakree"] else "officer"),
                "is_paired": bool(user_pairs.get(uname)),
                "chat_ids": user_pairs.get(uname, []),
                "master_enabled": sub.get("master_enabled", False),
                "broadcast_to_all": sub.get("broadcast_to_all", False),
                "cameras_count": len(sub.get("cameras", {}))
            })
        return results

    def update_user_master_alert(self, username: str, master_enabled: bool) -> Dict[str, Any]:
        """
        Admin action to toggle master alert state for a specific user.
        """
        current = self.get_subscription(username)
        current["master_enabled"] = bool(master_enabled)
        self.subscriptions[username] = current
        self._save()
        return current

    def resolve_target_chats(
        self,
        pairings: Dict[str, str], # "{platform}:{chat_id}" -> username
        camera: str,
        label: str,
        user_roles_fn = None
    ) -> List[str]:
        """
        Resolves list of Telegram chat IDs that should receive an alert for (camera, label).
        Rules:
        1. If any Admin user has broadcast_to_all == True and master_enabled == True, broadcast to ALL paired chat IDs.
        2. Otherwise, match EACH paired Telegram chat ID strictly against THAT paired user's personal subscription matrix!
        """
        self._load()
        target_chats = []
        
        def cam_matches(cam_dict, cam_target, obj_label):
            if not isinstance(cam_dict, dict):
                return False
            for k, v in cam_dict.items():
                if not isinstance(v, dict):
                    continue
                # Match exact, substring, or case-insensitive alias
                if k == cam_target or cam_target in k or k in cam_target or k.lower() == cam_target.lower():
                    if v.get(obj_label) is True:
                        return True
            return False

        # 1. Check if any admin user has global broadcast_to_all turned on
        admin_broadcast_active = False
        for username, sub in self.subscriptions.items():
            if sub.get("broadcast_to_all") and sub.get("master_enabled", False):
                if not user_roles_fn or user_roles_fn(username) == "admin":
                    admin_broadcast_active = True
                    break

        # 2. Iterate paired chat IDs and check THAT SPECIFIC USER'S subscription
        for pair_key, username in pairings.items():
            if not pair_key.startswith("telegram:"):
                continue
            chat_id = pair_key.split("telegram:", 1)[1]

            # Rule A: Global Super Admin Broadcast Mode
            if admin_broadcast_active:
                target_chats.append(chat_id)
                continue

            # Rule B: Per-User Personal Subscription Mode
            user_sub = self.subscriptions.get(username, {})
            if not user_sub and username == "admin":
                user_sub = self.subscriptions.get("arm215", {})

            if user_sub.get("master_enabled", False):
                # Apply Schedule Logic
                if user_sub.get("schedule_enabled", False):
                    s_start = user_sub.get("schedule_start", "00:00")
                    s_end = user_sub.get("schedule_end", "23:59")
                    if not is_time_in_range(s_start, s_end):
                        continue # Outside of scheduled hours, skip this user
                
                cams = user_sub.get("cameras", {})
                if cam_matches(cams, camera, label):
                    target_chats.append(chat_id)

        return list(set(target_chats))
