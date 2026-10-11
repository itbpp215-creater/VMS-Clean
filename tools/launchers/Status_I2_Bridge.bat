@echo off
title BPP-VMS - Status i2 Bridge
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\i2-bridge\status-i2-bridge.ps1"
pause