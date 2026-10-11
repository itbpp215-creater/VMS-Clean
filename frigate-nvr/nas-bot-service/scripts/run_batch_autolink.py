#!/usr/bin/env python3
"""
Batch Auto-Link Discovery Script
Scans all 775+ dossiers and discovers hidden relationships across documents,
ID cards, phone numbers, and bank accounts.
"""

import sys
import os
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = SCRIPT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from services.dossier_manager import DossierVaultManager
from services.auto_link_network import AutoLinkNetworkEngine

def run():
    storage_root = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")
    print(f"Initializing DossierVaultManager with storage root: {storage_root}")
    mgr = DossierVaultManager(root_path=storage_root)
    engine = AutoLinkNetworkEngine(mgr)
    
    print("Running batch auto-link scan across all dossiers...")
    res = engine.scan_all_dossiers()
    
    print("=" * 60)
    print("BATCH SCAN COMPLETED!")
    print(f"Total dossiers scanned: {res['total_dossiers_scanned']}")
    print(f"New bidirectional links created: {res['new_links_count']}")
    print("=" * 60)
    for ev in res['events']:
        src = ev.get('source')
        dst = ev.get('target')
        reason = ev.get('reason')
        m_type = ev.get('match_type')
        m_val = ev.get('match_value')
        print(f"Link: {src} <-> {dst} | {reason} ({m_type}: {m_val})")

if __name__ == "__main__":
    run()
