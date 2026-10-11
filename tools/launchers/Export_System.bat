@echo off
title BPP-VMS - Export System
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\run-export.ps1"
if errorlevel 1 pause
