@echo off
title BPP-VMS - Restore Cameras from Backup
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\restore-main-cameras.ps1" -InstallPath "%~dp0..\..\frigate-nvr"
if errorlevel 1 pause
