@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "ARCHIVE="
set "COUNT=0"
for %%F in ("%~dp0BPP-VMS-Update-v*.tar") do (
  set /a COUNT+=1
  set "ARCHIVE=%%~fF"
)
set "WORKER=%~dp0tools\Update-BppRelease.ps1"
if not "!COUNT!"=="1" (
  echo ล้มเหลว: ต้องมี Update TAR เพียง 1 ไฟล์ในโฟลเดอร์นี้
  pause
  exit /b 2
)
if not exist "!WORKER!" (
  echo ล้มเหลว: ไม่พบเครื่องมืออัปเดต "!WORKER!"
  pause
  exit /b 3
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!WORKER!" -ArchivePath "!ARCHIVE!"
set "EXITCODE=%ERRORLEVEL%"
if "!EXITCODE!"=="0" (
  echo สำเร็จ: อัปเดตและตรวจสอบ BPP-VMS ผ่านแล้ว
) else (
  echo ล้มเหลว: ระบบคืนรุ่นเดิมอัตโนมัติแล้ว หรือคงปิดไว้หาก rollback ไม่ผ่าน
)
pause
exit /b !EXITCODE!
