@echo off
title BPP-VMS - Restore Video From NAS
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\restore-video-from-nas.ps1"
if errorlevel 1 pause
