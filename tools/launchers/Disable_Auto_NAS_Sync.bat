@echo off
title BPP-VMS - Disable Auto NAS Sync
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\sync-to-nas.ps1" -UnregisterAutoSync
if errorlevel 1 pause