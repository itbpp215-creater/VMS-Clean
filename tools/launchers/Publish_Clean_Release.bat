@echo off
chcp 65001 >nul
title BPP-VMS - Publish Clean Release to VMS-Clean
cd /d "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\release\Sync-CleanRelease.ps1" %*
if errorlevel 1 pause
pause
