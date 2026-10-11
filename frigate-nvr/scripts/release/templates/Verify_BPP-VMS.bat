@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "ARCHIVE=%~1"
if not defined ARCHIVE set "ARCHIVE=%~dp0BPP-VMS-FullBackup.tar"
if not exist "!ARCHIVE!" (
  set "COUNT=0"
  for %%F in ("%~dp0BPP-VMS-Update-v*.tar") do (
    set /a COUNT+=1
    set "ARCHIVE=%%~fF"
  )
  if not "!COUNT!"=="1" (
    echo ล้มเหลว: ไม่พบ TAR ที่ระบุ หรือมี Update TAR มากกว่า 1 ไฟล์
    pause
    exit /b 2
  )
)
set "WORKER=%~dp0tools\Test-BppRelease.ps1"
if not exist "!WORKER!" (
  echo ล้มเหลว: ไม่พบเครื่องมือตรวจสอบ "!WORKER!"
  pause
  exit /b 3
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!WORKER!" -ArchivePath "!ARCHIVE!" -Full
set "EXITCODE=%ERRORLEVEL%"
if "!EXITCODE!"=="0" (
  echo สำเร็จ: TAR, manifest, hash และขอบเขตข้อมูลผ่านทั้งหมด
) else (
  echo ล้มเหลว: ห้ามติดตั้งหรืออัปเดตจาก TAR นี้
)
pause
exit /b !EXITCODE!
