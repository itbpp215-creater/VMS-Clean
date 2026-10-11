@echo off
chcp 65001 >nul
title BPP-VMS - 1-Click n8n Master Bot Workflow Installer
cd /d "%~dp0"

echo =========================================================================
echo    BPP-VMS - à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡ n8n Master Bot Workflow à¸­à¸±à¸•à¹‚à¸™à¸¡à¸±à¸•à¸´ (à¸•à¸Šà¸”.215)
echo =========================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File ".\n8n\install-workflow.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] à¸à¸²à¸£à¸•à¸´à¸”à¸•à¸±à¹‰à¸‡à¸¡à¸µà¸‚à¹‰à¸­à¸œà¸´à¸”à¸žà¸¥à¸²à¸” à¸£à¸«à¸±à¸ª: %ERRORLEVEL%
    pause
)
