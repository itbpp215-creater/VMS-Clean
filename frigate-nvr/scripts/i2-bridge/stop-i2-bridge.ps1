<#
.SYNOPSIS
Stops the BPP i2 Bridge background process.
#>

$running = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%i2-bridge.ps1%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
if ($running) {
    foreach ($proc in $running) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped i2 Bridge (PID: $($proc.ProcessId))" -ForegroundColor Yellow
    }
} else {
    Write-Host "No running i2 Bridge process found." -ForegroundColor DarkGray
}
Stop-Process -Name "Anb" -Force -ErrorAction SilentlyContinue