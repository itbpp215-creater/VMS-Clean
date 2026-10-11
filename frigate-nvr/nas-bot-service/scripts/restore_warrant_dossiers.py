"""
Warrant Dossier Recovery & Consolidation Script
-----------------------------------------------
1. Restores วิทยา_บินรัมย์_2569 with full warrant_info from master Excel registry.
2. Unbundles and distributes portrait photos from บุคคล_4990925690906_2569 into their proper warrant dossiers.
3. Consolidates the 70 duplicate folders (13..._2569 and บุคคล_..._2569) back into their original warrant dossiers.
4. Removes corrupted/duplicate empty folders and rebuilds dossiers index.
"""

import os
import sys
import re
import json
import shutil
import datetime
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("restore_warrant_dossiers")

# Add service directory to sys.path
sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.dossier_manager import DossierVaultManager
from services.warrant_excel_parser import parse_warrant_excel

DOSSIERS_DIR = "/data/nas-storage/Dossiers"
EXCEL_PATH = "/data/nas-storage/Cases/2026/09/Case_20260902_135839/Documents/รายงานหมายจับ_มีผลบังคับใช้_พร้อมนับถอยหลังอายุความ.xlsx"


def run_recovery():
    logger.info("=== Starting Warrant Dossier Recovery & Consolidation ===")
    dossier_mgr = DossierVaultManager(root_path="/data/nas-storage")

    # -------------------------------------------------------------
    # Step 1: Restore วิทยา บินรัมย์ (1100201743822) from Excel
    # -------------------------------------------------------------
    logger.info("Step 1: Restoring วิทยา บินรัมย์ (1100201743822) from warrant Excel...")
    if os.path.exists(EXCEL_PATH):
        parsed = parse_warrant_excel(EXCEL_PATH)
        records = parsed.get("records", [])
        vittaya_records = [
            r for r in records
            if (r.get("clean_id_card") == "1100201743822" or "วิทยา" in (r.get("suspect_name") or ""))
        ]
        if vittaya_records:
            v_rec = vittaya_records[0]
            logger.info(f"Found master warrant record for: {v_rec.get('suspect_name')} (ID: {v_rec.get('clean_id_card')})")
            p = dossier_mgr.upsert_warrant_record(v_rec)
            target_id = p.get("dossier_id") if p else "วิทยา_บินรัมย์_2569"
            logger.info(f"Successfully upserted warrant dossier: {target_id}")

            # Ensure profile has correct warrant category and role_tag
            prof_path = os.path.join(DOSSIERS_DIR, target_id, "profile.json")
            if os.path.exists(prof_path):
                with open(prof_path, "r", encoding="utf-8") as f:
                    prof = json.load(f)
                prof["category"] = "warrant"
                prof["role_tag"] = "ผู้ต้องหาตามหมายจับ"
                with open(prof_path, "w", encoding="utf-8") as f:
                    json.dump(prof, f, ensure_ascii=False, indent=2)
        else:
            logger.warning("No Excel record found for วิทยา บินรัมย์")
    else:
        logger.warning(f"Excel file not found at {EXCEL_PATH}")

    # -------------------------------------------------------------
    # Step 2: Distribute photos from บุคคล_4990925690906_2569
    # -------------------------------------------------------------
    corrupted_folder = os.path.join(DOSSIERS_DIR, "บุคคล_4990925690906_2569")
    if os.path.isdir(corrupted_folder):
        logger.info("Step 2: Distributing photos from corrupted dossier 'บุคคล_4990925690906_2569'...")
        c_personal = os.path.join(corrupted_folder, "Personal")
        if os.path.isdir(c_personal):
            for fname in os.listdir(c_personal):
                fpath = os.path.join(c_personal, fname)
                if not os.path.isfile(fpath):
                    continue

                # Read image content
                with open(fpath, "rb") as img_f:
                    img_bytes = img_f.read()

                # Clean filename if it has "merged_..."
                real_fname = re.sub(r'^merged_[^_]+_\d+_', '', fname)
                real_fname = re.sub(r'^merged_[^_]+_', '', real_fname)

                # Extract CID
                cids = re.findall(r'\d{13}', real_fname)
                target_dossier_id = None

                if cids:
                    cid = cids[0]
                    # Find dossier by CID
                    target_dossier_id = dossier_mgr.find_dossier_id(id_card=cid)

                if not target_dossier_id:
                    # Try finding by name
                    clean_name = re.sub(r'^\d{13}[_\-\s]*', '', real_fname)
                    clean_name = os.path.splitext(clean_name)[0]
                    target_dossier_id = dossier_mgr.find_dossier_id(suspect_name=clean_name)

                if target_dossier_id and target_dossier_id != "บุคคล_4990925690906_2569":
                    # Copy to target dossier Personal
                    dst_personal = os.path.join(DOSSIERS_DIR, target_dossier_id, "Personal")
                    os.makedirs(dst_personal, exist_ok=True)
                    dst_file = os.path.join(dst_personal, real_fname)
                    with open(dst_file, "wb") as out_f:
                        out_f.write(img_bytes)

                    # Update target profile
                    t_prof_path = os.path.join(DOSSIERS_DIR, target_dossier_id, "profile.json")
                    if os.path.exists(t_prof_path):
                        with open(t_prof_path, "r", encoding="utf-8") as pf:
                            t_prof = json.load(pf)
                        t_prof["photo_path"] = real_fname
                        t_prof["photo_url"] = f"/api/nas-bot/dossiers/{target_dossier_id}/download/{real_fname}"
                        t_prof["updated_at"] = datetime.datetime.now().isoformat()
                        pfiles = t_prof.setdefault("personal_files", [])
                        if not any(pf_item.get("filename") == real_fname for pf_item in pfiles):
                            pfiles.insert(0, {
                                "filename": real_fname,
                                "size_bytes": len(img_bytes),
                                "saved_at": datetime.datetime.now().isoformat(),
                                "category": "Mugshot"
                            })
                        with open(t_prof_path, "w", encoding="utf-8") as pf:
                            json.dump(t_prof, pf, ensure_ascii=False, indent=2)

                    logger.info(f"  [OK] Restored photo '{real_fname}' into '{target_dossier_id}'")
                else:
                    logger.warning(f"  [!] Could not match photo '{real_fname}' (CID: {cids}) to any dossier")

    # -------------------------------------------------------------
    # Step 3: Consolidate 70 duplicate dossiers (13..._2569 & บุคคล_..._2569)
    # -------------------------------------------------------------
    logger.info("Step 3: Consolidating duplicate dossiers into original warrant dossiers...")
    all_dossiers = [d for d in os.listdir(DOSSIERS_DIR) if os.path.isdir(os.path.join(DOSSIERS_DIR, d))]
    
    removed_count = 0
    photos_moved = 0

    for d_name in sorted(all_dossiers):
        # Target only auto-created duplicate dossiers starting with digits or บุคคล_
        if not (d_name.startswith(('1', '2', '3', '4', '5', '6', '7', '8', '9', 'บุคคล_'))):
            continue

        d_folder = os.path.join(DOSSIERS_DIR, d_name)
        d_personal = os.path.join(d_folder, "Personal")
        files_to_move = os.listdir(d_personal) if os.path.isdir(d_personal) else []

        # Find target original dossier
        target_dossier_id = None
        cids_in_name = re.findall(r'\b\d{13}\b', d_name) or re.findall(r'^\d{13}', d_name)
        
        # Check files inside for CID
        if not cids_in_name and files_to_move:
            for fn in files_to_move:
                c_fn = re.findall(r'\d{13}', fn)
                if c_fn:
                    cids_in_name = c_fn
                    break

        if cids_in_name:
            cid = cids_in_name[0]
            # Look for an existing warrant or clean dossier with this CID
            for other_d in all_dossiers:
                if other_d == d_name:
                    continue
                prof_p = os.path.join(DOSSIERS_DIR, other_d, "profile.json")
                if os.path.exists(prof_p):
                    try:
                        with open(prof_p, "r", encoding="utf-8") as f:
                            op = json.load(f)
                        if op.get("id_card") == cid and (op.get("category") == "warrant" or not other_d.startswith(('1', 'บุคคล_'))):
                            target_dossier_id = other_d
                            break
                    except Exception:
                        pass

        # If still not found, try matching by clean suspect name
        if not target_dossier_id:
            clean_sname = re.sub(r'^\d{13}[_\-\s]*', '', d_name)
            clean_sname = re.sub(r'_\d{4}(?:_\d+)?$', '', clean_sname)
            clean_sname = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', clean_sname).strip()
            if len(clean_sname) >= 3:
                for other_d in all_dossiers:
                    if other_d == d_name:
                        continue
                    prof_p = os.path.join(DOSSIERS_DIR, other_d, "profile.json")
                    if os.path.exists(prof_p):
                        try:
                            with open(prof_p, "r", encoding="utf-8") as f:
                                op = json.load(f)
                            o_sname = op.get("suspect_name") or ""
                            o_clean = re.sub(r'^(นาย|นางสาว|น\.ส\.|นาง|ด\.ช\.|ด\.ญ\.)\s*', '', o_sname).strip()
                            if clean_sname in o_clean or o_clean in clean_sname:
                                if op.get("category") == "warrant" or not other_d.startswith(('1', 'บุคคล_')):
                                    target_dossier_id = other_d
                                    break
                        except Exception:
                            pass

        if target_dossier_id and target_dossier_id != d_name:
            # Move all files to target dossier Personal
            target_personal = os.path.join(DOSSIERS_DIR, target_dossier_id, "Personal")
            os.makedirs(target_personal, exist_ok=True)
            for fn in files_to_move:
                src_f = os.path.join(d_personal, fn)
                dst_f = os.path.join(target_personal, fn)
                if os.path.isfile(src_f):
                    shutil.copy2(src_f, dst_f)
                    photos_moved += 1

            # Update target profile photo if needed
            t_prof_p = os.path.join(DOSSIERS_DIR, target_dossier_id, "profile.json")
            if os.path.exists(t_prof_p):
                with open(t_prof_p, "r", encoding="utf-8") as f:
                    t_prof = json.load(f)
                img_files = [fn for fn in files_to_move if os.path.splitext(fn)[1].lower() in {".jpg", ".jpeg", ".png", ".webp"}]
                if img_files and (not t_prof.get("photo_url") or not t_prof.get("photo_path")):
                    t_prof["photo_path"] = img_files[0]
                    t_prof["photo_url"] = f"/api/nas-bot/dossiers/{target_dossier_id}/download/{img_files[0]}"
                
                # Add to personal_files
                t_pfiles = t_prof.setdefault("personal_files", [])
                for fn in files_to_move:
                    if not any(pf.get("filename") == fn for pf in t_pfiles):
                        t_pfiles.append({
                            "filename": fn,
                            "category": "Evidence" if fn.endswith(".txt") else "Mugshot",
                            "saved_at": datetime.datetime.now().isoformat()
                        })
                t_prof["updated_at"] = datetime.datetime.now().isoformat()
                with open(t_prof_p, "w", encoding="utf-8") as f:
                    json.dump(t_prof, f, ensure_ascii=False, indent=2)

            # Safely remove duplicate folder
            shutil.rmtree(d_folder)
            removed_count += 1
            logger.info(f"  [Merged & Removed] Duplicate '{d_name}' -> Target '{target_dossier_id}' (files: {len(files_to_move)})")

        elif d_name.startswith("บุคคล_"):
            # Empty or invalid บุคคล_ folders
            if not files_to_move or d_name == "บุคคล_4990925690906_2569":
                shutil.rmtree(d_folder)
                removed_count += 1
                logger.info(f"  [Removed] Corrupted/Empty '{d_name}'")

    # -------------------------------------------------------------
    # Step 4: Rebuild dossiers index
    # -------------------------------------------------------------
    logger.info("Step 4: Rebuilding dossiers index...")
    dossier_mgr.rebuild_index()

    # -------------------------------------------------------------
    # Step 5: Verification & Statistics
    # -------------------------------------------------------------
    remaining = [d for d in os.listdir(DOSSIERS_DIR) if os.path.isdir(os.path.join(DOSSIERS_DIR, d))]
    warrants = []
    generals = []
    for d in remaining:
        prof_p = os.path.join(DOSSIERS_DIR, d, "profile.json")
        if os.path.exists(prof_p):
            with open(prof_p, "r", encoding="utf-8") as f:
                prof = json.load(f)
            if prof.get("category") == "warrant" or prof.get("warrant_info"):
                warrants.append(d)
            else:
                generals.append(d)

    logger.info("=== Recovery Summary ===")
    logger.info(f"Total Dossiers Remaining: {len(remaining)}")
    logger.info(f"Warrant Dossiers: {len(warrants)}")
    logger.info(f"General Dossiers: {len(generals)}")
    logger.info(f"Duplicate Folders Removed: {removed_count}")
    logger.info(f"Photos Successfully Moved: {photos_moved}")

    # Check วิทยา บินรัมย์ specifically
    v_prof_p = os.path.join(DOSSIERS_DIR, "วิทยา_บินรัมย์_2569", "profile.json")
    if os.path.exists(v_prof_p):
        with open(v_prof_p, "r", encoding="utf-8") as f:
            vp = json.load(f)
        logger.info("วิทยา_บินรัมย์_2569 Status:")
        logger.info(f"  - Category: {vp.get('category')}")
        logger.info(f"  - Role Tag: {vp.get('role_tag')}")
        logger.info(f"  - Warrant Info: {bool(vp.get('warrant_info'))} ({vp.get('warrant_info', {}).get('warrant_no')})")
        logger.info(f"  - Photo Path: {vp.get('photo_path')}")
        logger.info(f"  - Photo URL: {vp.get('photo_url')}")
        logger.info(f"  - Personal Files: {[pf.get('filename') for pf in vp.get('personal_files', [])]}")
    else:
        logger.error("วิทยา_บินรัมย์_2569 profile not found!")


if __name__ == "__main__":
    run_recovery()
