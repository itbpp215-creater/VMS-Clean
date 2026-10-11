# Antigravity Project Directives & Strict Rules

- **Repository:** itbpp215-creater/VMS-215 (Git Root: D:\BPP-VMS, App Root: D:\BPP-VMS\frigate-nvr)
- **Knowledge Base Vault:** D:\obsidian
- **Main Hub:** D:\obsidian\00 - 🏠 Dashboard\BPP-VMS Hub.md

## ⚠️ MANDATORY DIRECTIVES (กฎเหล็กบังคับใช้ทุกครั้ง):
1. **Git Commit & Push:** ต้องทำการ git commit และ git push origin main ทุกครั้งหลังเสร็จสิ้นงานแต่ละส่วน
2. **Infrastructure & Scope:** ห้ามไปยุ่งหรือแก้ไข Infrastructure ของระบบโดยเด็ดขาด และแก้ไขเฉพาะส่วนที่ผู้ใช้สั่งเท่านั้น ห้ามไปแก้ไขส่วนอื่นโดยเด็ดขาด
3. **Dual Sync Handover Context:** อัปเดตทั้ง D:\BPP-VMS\AI_HANDOVER_CONTEXT.md (บน Git) และ D:\obsidian\05 - 📋 Development & Handover\AI Handover Context.md (ใน Obsidian) เสมอ
4. **Troubleshooting Runbook:** อัปเดต D:\obsidian\04 - 🛠️ Operations & Setup\Troubleshooting & Incident Runbook.md เมื่อแก้ไขปัญหาหรือบั๊กสำเร็จ
5. **Clean Release Distribution (เผยแพร่ระบบภายนอก):** ห้ามนำข้อมูลกล้อง, RTSP, IP, รหัสผ่าน NAS, Google API Key, Telegram Token, หรือข้อมูลเฉพาะของ ตชด.215 เข้าสู่ Clean Repo (`itbpp215-creater/VMS-Clean`) โดยเด็ดขาด การเผยแพร่หรือซิงค์โค้ดไปยัง VMS-Clean ต้องผ่านสคริปต์ `tools/release/Sync-CleanRelease.ps1` (Pre-Push Sanitizer Gate) เสมอ
6. **No Scratch/Ad-hoc Test Scripts (ห้ามสร้างหรือทิ้งไฟล์ทดสอบ):** ห้ามสร้างหรือทิ้งไฟล์สคริปต์ทดสอบชั่วคราว (`.py`, `.js`, `.ps1` เช่น `test_*.py`, `test*.js`, `scratch.py`, ฯลฯ) ไว้ใน Root ของโปรเจกต์ หรือในโฟลเดอร์ระบบโดยเด็ดขาด หากจำเป็นต้องทดสอบ ให้รัน inline ด้วย `python -c` / `node -e` หรือเขียนลง scratch folder ภายนอก repo และลบทิ้งทันทีหลังเสร็จสิ้น ห้าม commit เข้า Git อย่างเด็ดขาด


