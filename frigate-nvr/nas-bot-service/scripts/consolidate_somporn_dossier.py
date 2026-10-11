#!/usr/bin/env python3
"""
Consolidation and cleanup script for Somporn Mekhee dossiers.
Merges 'เหาข้อหา2569' and 'สมพรเมซี2569' into canonical dossier 'นายสมพร เมฆี' (ID: 3310400362971).
"""

import os
import sys
import json
import logging
from pathlib import Path

# Add service directory to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = SCRIPT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from services.dossier_manager import DossierVaultManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("consolidate_somporn")

def consolidate_somporn(storage_root: str) -> None:
    logger.info(f"Scanning dossier storage at: {storage_root}")
    mgr = DossierVaultManager(root_path=storage_root)
    all_dossiers = mgr.get_all_dossiers()
    
    ha_id = None
    see_id = None
    khee_id = None

    for d in all_dossiers:
        did = str(d.get("dossier_id") or "")
        dname = str(d.get("suspect_name") or "")
        if "เหาข้อหา" in did or "เหา ข้อหา" in dname:
            ha_id = did
            logger.info(f"Found mis-extracted dossier: {did} ({dname})")
        elif "สมพรเมซี" in did or "เมซี" in dname:
            see_id = did
            logger.info(f"Found phonetic-typo dossier: {did} ({dname})")
        elif "สมพรเมฆี" in did or "เมฆี" in dname or d.get("id_card") == "3310400362971":
            khee_id = did
            logger.info(f"Found target canonical dossier: {did} ({dname})")

    target_id = khee_id or see_id or "สมพรเมฆี2569"

    # 1. Merge ha_id into target if present
    if ha_id and ha_id != target_id:
        logger.info(f"Merging '{ha_id}' into '{target_id}'...")
        res = mgr.merge_dossiers(ha_id, target_id, force=True)
        if res:
            logger.info(f"Successfully merged '{ha_id}' into '{target_id}'")
        else:
            logger.error(f"Failed to merge '{ha_id}' into '{target_id}'")

    # 2. Update canonical profile fields
    prof = mgr.get_dossier_detail(target_id)
    if prof:
        updates = {
            "suspect_name": "นายสมพร เมฆี",
            "id_card": "3310400362971",
            "address": "หมู่ 1 ต.สะเตา อ.นางรอง จ.บุรีรัมย์",
            "role_tag": "ผู้ต้องหา"
        }
        mgr.update_dossier_profile(target_id, updates)
        logger.info(f"Canonical dossier '{target_id}' updated successfully:")
        logger.info(f"  Name   : นายสมพร เมฆี")
        logger.info(f"  ID     : 3310400362971")
        logger.info(f"  Address: หมู่ 1 ต.สะเตา อ.นางรอง จ.บุรีรัมย์")
    else:
        logger.info(f"No existing dossier found to update at target '{target_id}'.")

if __name__ == "__main__":
    storage_path = os.getenv("NAS_STORAGE_PATH")
    if not storage_path or not os.path.exists(storage_path):
        if os.path.exists("D:/data/nas-storage"):
            storage_path = "D:/data/nas-storage"
        else:
            storage_path = "/data/nas-storage"

    consolidate_somporn(storage_path)
