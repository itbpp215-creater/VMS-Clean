<#
.SYNOPSIS
Starts the BPP i2 Bridge as a hidden background process.
#>

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$bridgeScript = [System.IO.Path]::GetFullPath((Join-Path $scriptDir 'i2-bridge.ps1'))
$powerShell32 = "$env:WINDIR\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

# Check if IBM i2 Analyst's Notebook is installed
$comKey = 'Registry::HKEY_CLASSES_ROOT\Wow6432Node\CLSID\{29C44DCF-28D6-4C95-8DEF-A666763F5B70}\LocalServer32'
if (-not (Test-Path -LiteralPath $comKey)) {
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Yellow
    Write-Host "  [i] ไม่พบโปรแกรม IBM i2 Analyst Notebook บนเครื่องนี้" -ForegroundColor Yellow
    Write-Host "========================================================================" -ForegroundColor Yellow
    Write-Host "  * ตัวแปลงผัง i2-Bridge จำเป็นต้องใช้ไลเซนส์โปรแกรม IBM i2 บน Windows" -ForegroundColor White
    Write-Host "  * เครื่องนี้สามารถเปิดดู ค้นหา และวิเคราะห์ผังความเชื่อมโยงผ่านเว็บได้ตามปกติ 100%" -ForegroundColor Green
    Write-Host "  * หากต้องการแปลงไฟล์ผัง .anb ใหม่ กรุณาดำเนินการบนเครื่องหลักที่มีลิขสิทธิ์ i2" -ForegroundColor Gray
    Write-Host "========================================================================" -ForegroundColor Yellow
    Write-Host ""
    return
}

# Check if already running
$running = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%i2-bridge.ps1%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
if ($running) {
    Write-Host "BPP i2 Bridge is ALREADY RUNNING in background (PID: $($running.ProcessId))" -ForegroundColor Green
    return
}

# Start hidden
Start-Process -FilePath $powerShell32 -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$bridgeScript`"" -WindowStyle Hidden
Start-Sleep -Seconds 1

$check = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%i2-bridge.ps1%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
if ($check) {
    Write-Host "Started BPP i2 Bridge in background successfully (PID: $($check.ProcessId))" -ForegroundColor Green
    Write-Host "You can safely close this window now. The bridge will keep running in the background." -ForegroundColor Cyan
} else {
    Write-Host "Failed to start i2 Bridge in background." -ForegroundColor Red
}