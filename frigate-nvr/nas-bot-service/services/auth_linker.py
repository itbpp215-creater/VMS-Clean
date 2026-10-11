"""
Auth Linker Module for nas-bot-service (BPP-VMS)

This module manages linking external chat bot accounts (Telegram Chat ID, Discord User ID)
with official BPP-VMS system user accounts in `auth-service` using 6-digit one-time pairing codes.

Inputs:
    - user_id_in_bot (str): Platform-specific user identifier
    - platform (str): 'telegram', 'discord'
    - username (str): System username in auth-service
Outputs:
    - str: Generated 6-digit pairing code or pairing status verification
Side effects:
    - Persists pairing map to disk (/data/bot_user_pairings.json).
"""

import os
import json
import random
import time
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger("nas-bot.auth_linker")

DATA_DIR = os.getenv("NAS_DATA_DIR", "/data")
PAIRING_FILE = os.path.join(DATA_DIR, "bot_user_pairings.json")
PENDING_CODES_FILE = os.path.join(DATA_DIR, "pending_pairing_codes.json")


class AuthLinker:
    """
    Manages generation and verification of pairing codes linking bot users to BPP-VMS auth accounts.
    """

    def __init__(self, data_dir: str = DATA_DIR):
        """
        Initialize AuthLinker with state persistence path.
        """
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        self.pairing_path = os.path.join(self.data_dir, "bot_user_pairings.json")
        self.pending_path = os.path.join(self.data_dir, "pending_pairing_codes.json")
        self._load_state()

    def _load_state(self) -> None:
        """Load persistent pairings and pending codes from disk."""
        self.pairings: Dict[str, str] = {}  # key format: "{platform}:{chat_id}" -> username
        self.pending_codes: Dict[str, Dict[str, Any]] = {}  # code -> {username, expires_at}

        if os.path.exists(self.pairing_path):
            try:
                with open(self.pairing_path, "r", encoding="utf-8") as f:
                    self.pairings = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load pairings file: {e}")

        if os.path.exists(self.pending_path):
            try:
                with open(self.pending_path, "r", encoding="utf-8") as f:
                    self.pending_codes = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load pending codes file: {e}")

    def _save_state(self) -> None:
        """Persist pairings and pending codes to disk."""
        try:
            with open(self.pairing_path, "w", encoding="utf-8") as f:
                json.dump(self.pairings, f, ensure_ascii=False, indent=2)
            with open(self.pending_path, "w", encoding="utf-8") as f:
                json.dump(self.pending_codes, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save auth linker state: {e}")

    def generate_pairing_code(self, username: str, expiry_seconds: int = 600) -> str:
        """
        Generate a 6-digit random pairing code for a system user (valid for 10 minutes).
        """
        self._load_state()
        code = str(random.randint(100000, 999999))
        expires_at = time.time() + expiry_seconds

        self.pending_codes[code] = {
            "username": username,
            "expires_at": expires_at
        }
        self._save_state()
        logger.info(f"Generated 6-digit pairing code for user '{username}'. Code expires in {expiry_seconds}s.")
        return code

    def pair_bot_user(self, platform: str, bot_user_id: str, code: str) -> Optional[str]:
        """
        Verify code and pair a bot user ID to a BPP-VMS username.
        """
        self._load_state()
        code = code.strip()
        pending_info = self.pending_codes.get(code)

        if not pending_info:
            logger.warning(f"Pairing attempt with unknown code '{code}' on platform '{platform}'")
            return None

        if time.time() > pending_info["expires_at"]:
            logger.warning(f"Pairing attempt with expired code '{code}' on platform '{platform}'")
            del self.pending_codes[code]
            self._save_state()
            return None

        username = pending_info["username"]
        key = f"{platform}:{bot_user_id}"
        self.pairings[key] = username

        # Remove used code
        del self.pending_codes[code]
        self._save_state()

        logger.info(f"Successfully paired bot user '{bot_user_id}' ({platform}) with username '{username}'")
        return username

    def get_user_pairings(self, username: str) -> list:
        """
        Get list of active bot pairings for a given system username (case-insensitive).
        Always reloads latest state from disk.
        """
        self._load_state()
        results = []
        clean_u = (username or "").strip().lower()
        for key, paired_user in self.pairings.items():
            if (paired_user or "").strip().lower() == clean_u:
                parts = key.split(":", 1)
                results.append({
                    "platform": parts[0],
                    "bot_user_id": parts[1] if len(parts) > 1 else ""
                })
        return results

    def get_paired_username(self, platform: str, bot_user_id: str) -> Optional[str]:
        """
        Lookup paired system username for a bot user ID.
        Always reloads latest state from disk.
        """
        self._load_state()
        key = f"{platform}:{bot_user_id}"
        return self.pairings.get(key)

    def direct_pair(self, platform: str, bot_user_id: str, username: str) -> bool:
        """Directly associate a bot user ID with a system username."""
        self._load_state()
        key = f"{platform}:{bot_user_id.strip()}"
        self.pairings[key] = username.strip()
        self._save_state()
        logger.info(f"Direct paired {key} -> {username}")
        return True

    def unpair_user(self, platform: str = "telegram", bot_user_id: str = None, username: str = None) -> int:
        """Remove pairings for a specific chat ID or all chat IDs of a username."""
        self._load_state()
        removed = 0
        keys_to_del = []
        clean_u = (username or "").strip().lower()
        
        for k, u in list(self.pairings.items()):
            parts = k.split(":", 1)
            plat = parts[0]
            uid = parts[1] if len(parts) > 1 else ""
            
            if platform and plat != platform:
                continue
            if bot_user_id and uid == bot_user_id.strip():
                keys_to_del.append(k)
            elif clean_u and u.strip().lower() == clean_u:
                keys_to_del.append(k)
                
        for k in keys_to_del:
            if k in self.pairings:
                del self.pairings[k]
                removed += 1
                
        if removed > 0:
            self._save_state()
        return removed
