@echo off
title BPP-VMS - Enable Auto NAS Sync (Background Real-Time)
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\sync-to-nas.ps1" -RegisterAutoSync -TargetLocation "Z:\nas-storage"
if errorlevel 1 pause