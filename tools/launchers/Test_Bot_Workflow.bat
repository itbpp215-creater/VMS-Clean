@echo off
title BPP-VMS - Interactive Bot Tester
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\n8n\test-bot.ps1" %*
