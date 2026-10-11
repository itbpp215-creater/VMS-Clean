@echo off
chcp 65001 >nul
title BPP-VMS — ศูนย์รวมคำสั่งปฏิบัติการ (Control Center)

:MENU
cls
echo ================================================================================
echo         กองร้อยตำรวจตระเวนชายแดนที่ ๒๑๕ (BPP 215)
echo         ศูนย์รวมคำสั่งและตัวช่วยปฏิบัติการ BPP-VMS Control Center
echo ================================================================================
echo.
echo   [ การดูแลและอัปเดตระบบ ]
echo     1. 🔄 อัปเดตโค้ดและระบบ (Update System - Git Pull ^& Build)
echo     2. 🤖 ตั้งค่า Telegram Bot สำหรับเครื่องนี้ (Setup Telegram Bot)
echo     3. 🧪 ทดสอบบอท Telegram / Webhook (Test Telegram Bot)
echo     4. ⚡ ติดตั้ง/อัปเดต n8n AI Master Workflow (Install n8n Workflow)
echo.
echo   [ จัดการคลังข้อมูลและสำรอง NAS ]
echo     5. 🖥️ ตั้งค่าและทดสอบเชื่อมต่อ Synology NAS Storage (Setup NAS)
echo     6. ☁️ สั่งซิงค์วิดีโอและแฟ้มคดีเข้า NAS ทันที (Sync to NAS Now)
echo     7. ⏰ เปิดระบบ Auto-Sync NAS อัตโนมัติทุกวัน (Enable Auto NAS Sync)
echo     8. ⏸️ ปิดระบบ Auto-Sync NAS ชั่วคราว (Disable Auto NAS Sync)
echo     9. 📼 กู้คืนคลิปวิดีโอย้อนหลังจาก NAS สู่ SSD (Restore Video from NAS)
echo    10. 📹 กู้คืนการตั้งค่ากล้องวงจรปิดหลัก (Restore Main Cameras)
echo.
echo   [ เครื่องมือวิเคราะห์และการสำรองกู้คืน ]
echo    11. 🌐 เริ่มระบบสะพานผังความสัมพันธ์ i2 (Start i2 Bridge)
echo    12. 📊 ตรวจสอบสถานะสะพาน i2 Bridge (Status i2 Bridge)
echo    13. 📦 ส่งออกแพ็กเกจตัวติดตั้ง bpp-vms-installer.zip (Export Installer)
echo    14. 💾 สำรองข้อมูลระบบทั้งหมด Full Backup (Export System)
echo    15. 📥 นำเข้าข้อมูลระบบจากไฟล์สำรอง (Import System)
echo    16. 🛠️ ตัวช่วยติดตั้งเครื่องใหม่ตั้งแต่ต้น (Setup New Machine)
echo.
echo     0. 🚪 ออกจากโปรแกรม (Exit)
echo.
echo ================================================================================
set /p "CHOICE=กรุณาเลือกหมายเลขคำสั่ง (0-16): "

if "%CHOICE%"=="1" goto OP_UPDATE
if "%CHOICE%"=="2" goto OP_BOT_SETUP
if "%CHOICE%"=="3" goto OP_BOT_TEST
if "%CHOICE%"=="4" goto OP_N8N
if "%CHOICE%"=="5" goto OP_NAS_SETUP
if "%CHOICE%"=="6" goto OP_NAS_SYNC
if "%CHOICE%"=="7" goto OP_NAS_AUTO_ON
if "%CHOICE%"=="8" goto OP_NAS_AUTO_OFF
if "%CHOICE%"=="9" goto OP_NAS_RESTORE
if "%CHOICE%"=="10" goto OP_CAM_RESTORE
if "%CHOICE%"=="11" goto OP_I2_START
if "%CHOICE%"=="12" goto OP_I2_STATUS
if "%CHOICE%"=="13" goto OP_EXPORT_INSTALLER
if "%CHOICE%"=="14" goto OP_EXPORT_SYS
if "%CHOICE%"=="15" goto OP_IMPORT_SYS
if "%CHOICE%"=="16" goto OP_NEW_MACHINE
if "%CHOICE%"=="0" goto EXIT
goto INVALID

:OP_UPDATE
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\update-system.ps1" -InstallPath "%~dp0frigate-nvr"
echo.
pause
goto MENU

:OP_BOT_SETUP
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\setup-telegram-bot.ps1"
echo.
pause
goto MENU

:OP_BOT_TEST
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\test-bot.ps1"
echo.
pause
goto MENU

:OP_N8N
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0n8n\install-workflow.ps1"
echo.
pause
goto MENU

:OP_NAS_SETUP
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\setup-nas-storage.ps1"
echo.
pause
goto MENU

:OP_NAS_SYNC
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\sync-to-nas.ps1"
echo.
pause
goto MENU

:OP_NAS_AUTO_ON
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\enable-auto-nas-sync.ps1"
echo.
pause
goto MENU

:OP_NAS_AUTO_OFF
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\disable-auto-nas-sync.ps1"
echo.
pause
goto MENU

:OP_NAS_RESTORE
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\restore-video-from-nas.ps1"
echo.
pause
goto MENU

:OP_CAM_RESTORE
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\restore-main-cameras.ps1"
echo.
pause
goto MENU

:OP_I2_START
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\i2-bridge\i2-bridge.ps1" -Action Start
echo.
pause
goto MENU

:OP_I2_STATUS
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\i2-bridge\i2-bridge.ps1" -Action Status
echo.
pause
goto MENU

:OP_EXPORT_INSTALLER
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\export-installer-package.ps1"
echo.
pause
goto MENU

:OP_EXPORT_SYS
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\export-system.ps1"
echo.
pause
goto MENU

:OP_IMPORT_SYS
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\import-system.ps1"
echo.
pause
goto MENU

:OP_NEW_MACHINE
echo.
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\setup-new-machine.ps1" -InstallPath "%~dp0frigate-nvr"
echo.
pause
goto MENU

:INVALID
echo.
echo [!] หมายเลขคำสั่งไม่ถูกต้อง กรุณาระบุ 0-16
timeout /t 2 >nul
goto MENU

:EXIT
echo.
echo ขอบคุณสำหรับการใช้งาน BPP-VMS Control Center
timeout /t 1 >nul
exit /b 0