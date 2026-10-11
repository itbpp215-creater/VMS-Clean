# Re-launch script as Admin if not currently Admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges..."
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "Adding Windows Firewall Rule for Nginx RTMP (Port 1935)..."
New-NetFirewallRule -DisplayName "Nginx RTMP Inbound (Port 1935)" -Direction Inbound -LocalPort 1935 -Protocol TCP -Action Allow -Profile Any -ErrorAction SilentlyContinue

Write-Host "Done! You can close this window."
Pause
