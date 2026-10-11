@echo off
chcp 65001 >nul
setlocal

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "ARCHIVE=%~dp0BPP-VMS-FullBackup.tar"
set "WORKER=%~dp0tools\Install-BppRelease.ps1"
if not exist "%ARCHIVE%" (
  echo ล้มเหลว: ไม่พบไฟล์ "%ARCHIVE%"
  pause
  exit /b 2
)
if not exist "%WORKER%" (
  echo ล้มเหลว: ไม่พบเครื่องมือติดตั้ง "%WORKER%"
  pause
  exit /b 3
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%WORKER%" -ArchivePath "%ARCHIVE%"
set "EXITCODE=%ERRORLEVEL%"
if "%EXITCODE%"=="0" (
  echo สำเร็จ: ติดตั้งและตรวจสอบ BPP-VMS ผ่านแล้ว
) else (
  echo ล้มเหลว: ระบบยังปิดอยู่ กรุณาแก้สาเหตุแล้วกดติดตั้งซ้ำ
)
pause
exit /b %EXITCODE%
