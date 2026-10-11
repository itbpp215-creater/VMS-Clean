@echo off
cd /d "%~dp0"

:: 1. Automatically unblock the script file silently
start "" /b powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0BPP-NVR-Bridge.ps1' -ErrorAction SilentlyContinue"

:: 2. Check if BPP-NVR-Bridge.ps1 exists in the directory
if not exist "%~dp0BPP-NVR-Bridge.ps1" (
    powershell.exe -WindowStyle Hidden -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('BPP-NVR-Bridge.ps1 not found! `n`nAre you running this directly from inside the .zip file? `nPlease RIGHT-CLICK the .zip file and select EXTRACT ALL before running the program.', 'BPP NVR Bridge - Error', 'OK', 'Error')"
    exit /b 1
)

:: 3. Run the program hidden and exit the batch file immediately
start "" powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%~dp0BPP-NVR-Bridge.ps1"
exit
