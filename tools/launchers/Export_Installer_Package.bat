@echo off
chcp 65001 >nul
title BPP-VMS - Export Installer Package
cd /d "%~dp0..\..\frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\frigate-nvr\scripts\export-installer-package.ps1" -InstallPath "%~dp0..\..\frigate-nvr"
if errorlevel 1 pause
