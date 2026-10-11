@echo off
title BPP-VMS - Start i2 Bridge (Background)
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\i2-bridge\start-i2-bridge.ps1"
pause