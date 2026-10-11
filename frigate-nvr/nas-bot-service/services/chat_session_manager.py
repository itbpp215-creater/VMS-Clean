"""
Chat Session Manager Module for nas-bot-service (BPP-VMS)
----------------------------------------------------------
Tracks active dossier context per chat_id / operator to support smart follow-up intelligence ingestion:
- Follow-up texts within 30 minutes (carrier queries, PEA meters, photos) can automatically attach to the active dossier.
- Expiration window defaults to 1800 seconds (30 minutes).
- Thread-safe and in-memory.
"""

import time
import threading
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("nas-bot.chat_session")

DEFAULT_SESSION_TIMEOUT_SEC = 1800  # 30 minutes


class ChatSessionManager:
    """
    Manages short-lived active dossier sessions for Telegram and Web Chat users.
    """

    def __init__(self, timeout_sec: int = DEFAULT_SESSION_TIMEOUT_SEC):
        self.timeout_sec = timeout_sec
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def set_active_dossier(
        self,
        chat_id: Any,
        dossier_id: str,
        suspect_name: str,
        id_card: Optional[str] = None,
        phone_number: Optional[str] = None,
        officer_username: Optional[str] = None
    ) -> None:
        """
        Record or refresh the currently active dossier for this chat/operator.
        """
        key = str(chat_id)
        with self._lock:
            self._sessions[key] = {
                "dossier_id": dossier_id,
                "suspect_name": suspect_name,
                "id_card": id_card,
                "phone_number": phone_number,
                "officer_username": officer_username,
                "timestamp": time.time(),
            }
            logger.info(
                f"Activated chat session for chat_id={key}: dossier_id={dossier_id} ({suspect_name})"
            )

    def get_active_dossier(self, chat_id: Any) -> Optional[Dict[str, Any]]:
        """
        Return the active session if within timeout, or None if expired.
        """
        key = str(chat_id)
        with self._lock:
            session = self._sessions.get(key)
            if not session:
                return None

            elapsed = time.time() - session.get("timestamp", 0)
            if elapsed > self.timeout_sec:
                logger.info(f"Chat session expired for chat_id={key} after {int(elapsed)}s")
                self._sessions.pop(key, None)
                return None

            return dict(session)

    def touch_session(self, chat_id: Any) -> None:
        """
        Reset timeout timer when a follow-up interaction occurs.
        """
        key = str(chat_id)
        with self._lock:
            if key in self._sessions:
                self._sessions[key]["timestamp"] = time.time()

    def clear_session(self, chat_id: Any) -> None:
        """
        Manually clear session (e.g. on /done or when starting an unrelated case).
        """
        key = str(chat_id)
        with self._lock:
            self._sessions.pop(key, None)
