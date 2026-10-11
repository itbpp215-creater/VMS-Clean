@echo off
title BPP-VMS - Setup NAS Storage and Sync
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\setup-nas-storage.ps1" %*
if errorlevel 1 pause