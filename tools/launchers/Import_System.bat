@echo off
title BPP-VMS - Import System
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\run-import.ps1"
if errorlevel 1 pause
