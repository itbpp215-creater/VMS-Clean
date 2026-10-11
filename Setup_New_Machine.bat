@echo off
chcp 65001 >nul
title BPP-VMS - Setup New Machine
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\setup-new-machine.ps1" -InstallPath "%~dp0frigate-nvr"
if errorlevel 1 pause
