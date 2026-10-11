"""
Batch SPNI Phone Report Ingestion Script for BPP-VMS
----------------------------------------------------
Ingests 12 SPNI Phone Report Excel files, populates Dossier Vault,
stores CDR Sessions, and builds the unified cross-target network graph.
"""

import os
import glob
import logging
from services.cdr_parser import CDRParser
from services.dossier_manager import DossierVaultManager
from services.nas_manager import NASStorageManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("batch_spni")

def run_batch_import():
    nas_root = os.getenv("NAS_STORAGE_PATH", "/data/nas-storage")
    dossier_mgr = DossierVaultManager(root_path=nas_root)
    cdr_parser = CDRParser(storage_dir=os.path.join(nas_root, "CDR"))

    sample_dir = "/app/scratch/spni_samples"
    files = sorted(glob.glob(os.path.join(sample_dir, "*.xlsx")))

    print(f"==================================================")
    print(f"🚀 เริ่มการนำเข้าไฟล์รายงาน SPNI ทั้งหมด {len(files)} ไฟล์...")
    print(f"==================================================")

    results = []
    for filepath in files:
        filename = os.path.basename(filepath)
        print(f"\n📥 กำลังประมวลผลไฟล์: {filename}")
        with open(filepath, "rb") as f:
            file_bytes = f.read()

        res = cdr_parser.parse_cdr_file(
            file_bytes=file_bytes,
            filename=filename,
            dossier_manager=dossier_mgr,
            operator="admin"
        )
        
        dev = res.get("device_info", {})
        d_sync = res.get("dossier_sync", {})
        print(f"  ✅ สกัดข้อมูลสำเร็จ:")
        print(f"     👤 เจ้าของเครื่อง: {dev.get('owner_name')}")
        print(f"     📞 เบอร์เป้าหมาย: {dev.get('target_phone')}")
        print(f"     📁 เลขคดี: {dev.get('case_no')}")
        print(f"     📲 อุปกรณ์: {dev.get('brand')} {dev.get('model')} (IMEI: {dev.get('imei')})")
        print(f"     📂 ถังข้อมูล (Arrest Vault): {d_sync.get('suspect_name')} (ID: {d_sync.get('dossier_id')})")
        print(f"     📊 บันทึกการโทร: {res.get('total_records')} รายการ ({res.get('unique_pairs_count')} คู่สาย)")
        print(f"     👥 สมุดโทรศัพท์: {res.get('total_contacts')} รายชื่อ")
        print(f"     ✉️ SMS: {res.get('total_sms')} ข้อความ")
        results.append(res)

    print(f"\n==================================================")
    print(f"🎉 นำเข้าและประมวลผลสำเร็จครบทั้ง {len(results)} ไฟล์!")
    print(f"==================================================")

    # Summary of all active call pairs in graph
    active_pairs = cdr_parser.get_all_active_call_pairs()
    all_contacts = cdr_parser.get_all_contacts()
    print(f"🕸️ สรุปภาพรวมโครงข่ายในระบบ:")
    print(f"   • รวมคู่สายทั้งหมดในระบบ: {len(active_pairs)} คู่สาย")
    print(f"   • รวมรายชื่อที่จับคู่เบอร์โทรได้: {len(all_contacts)} รายชื่อ")
    print(f"   • แฟ้มบุคคลในถังข้อมูล: {len(dossier_mgr.get_all_dossiers())} แฟ้ม")

if __name__ == "__main__":
    run_batch_import()
