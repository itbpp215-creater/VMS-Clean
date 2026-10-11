[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$installPath = 'D:\BPP-VMS\frigate-nvr'
$archivePath = 'D:\BPP-VMS-FullBackup.tar.enc'
$scriptPath = Join-Path $PSScriptRoot 'migrate-machine.ps1'

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  BPP-VMS - Import System (New Machine)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Restoring system to: $installPath"
Write-Host "From backup file: $archivePath"
Write-Host ""

if (-not (Test-Path -LiteralPath $scriptPath)) {
    Write-Host "ERROR: Script not found at $scriptPath" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

& $scriptPath -Mode Import -ArchivePath $archivePath -InstallPath $installPath

Write-Host "`nPress Enter to exit..." -ForegroundColor Green
Read-Host
