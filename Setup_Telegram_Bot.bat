@echo off
title BPP-VMS - Setup Telegram Bot
cd /d "%~dp0frigate-nvr"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0frigate-nvr\scripts\setup-telegram-bot.ps1" -InstallPath "%~dp0frigate-nvr" %*
if errorlevel 1 pause
