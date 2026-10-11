# 🚨 STRICT ENGINEERING DIRECTIVES & BOUNDARIES (กฎเหล็กในการทำงาน)

> **MANDATORY PROTOCOL FOR ANTIGRAVITY AGENT (ต้องปฏิบัติตามอย่างเคร่งครัด 100%):**

1. 🔄 **Git Auto Commit & Push (ต้องทำทุกครั้งหลังเสร็จงาน):**
   - หลังเสร็จสิ้นงานแต่ละส่วน ต้องรันคำสั่ง git add ., git commit -m "...", และ git push origin main ในโฟลเดอร์ D:\BPP-VMS เสมอ

2. 🛡️ **ห้ามยุ่งกับ Infrastructure & แก้ไขเฉพาะส่วนที่สั่งเท่านั้น (Strict Scope):**
   - **ห้ามไปยุ่งหรือแก้ไข Infrastructure ของระบบโดยเด็ดขาด** (ห้ามปรับแก้เครือข่ายระดับ Host, Docker Network, Compose Architecture หลัก หรือสภาพแวดล้อมนอกเหนือขอบเขตงาน)
   - **แก้ไขเฉพาะส่วนที่ผู้ใช้สั่งเท่านั้น ห้ามไปแก้ไขส่วนอื่นโดยเด็ดขาด** (Strictly modify ONLY what is requested)

3. 📝 **Dual Handover Context Sync (อัปเดตเอกสาร Handover คู่ขนานตลอดเวลา):**
   - ต้องอัปเดตไฟล์ D:\BPP-VMS\AI_HANDOVER_CONTEXT.md ใน Git Repo ทุกครั้งที่มีการพัฒนาหรือแก้ไข
   - ต้องอัปเดตไฟล์ D:\obsidian\05 - 📋 Development & Handover\AI Handover Context.md และ Daily Dev Logs ใน Obsidian ไปพร้อมกันเสมอ

4. 🚨 **Troubleshooting Runbook Auto-Update:**
   - เมื่อแก้ปัญหา บั๊ก หรือ Incident ข้อผิดพลาดของระบบสำเร็จ ต้องบันทึกลง D:\obsidian\04 - 🛠️ Operations & Setup\Troubleshooting & Incident Runbook.md ทันที