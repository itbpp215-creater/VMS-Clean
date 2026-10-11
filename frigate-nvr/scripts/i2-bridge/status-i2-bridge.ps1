<#
.SYNOPSIS
Checks the status of the BPP i2 Bridge background process.
#>

$running = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%i2-bridge.ps1%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
if ($running) {
    Write-Host "Status: RUNNING (PID: $($running.ProcessId))" -ForegroundColor Green
} else {
    Write-Host "Status: STOPPED" -ForegroundColor Red
}