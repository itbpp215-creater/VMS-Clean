@echo off
title BPP-VMS - Sync Intelligence & Dossiers to NAS
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\sync-to-nas.ps1"
if errorlevel 1 pause
