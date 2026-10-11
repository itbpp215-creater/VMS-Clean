[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$installPath = 'D:\BPP-VMS\frigate-nvr'
$archivePath = 'D:\BPP-VMS-FullBackup.tar.enc'
$scriptPath = Join-Path $installPath 'scripts\migrate-machine.ps1'

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  BPP-VMS - Export System (Old Machine)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Exporting system settings, databases, and Docker images..."
Write-Host "Output file: $archivePath"
Write-Host ""

if (-not (Test-Path -LiteralPath $scriptPath)) {
    Write-Host "ERROR: Script not found at $scriptPath" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

& $scriptPath -Mode Export -InstallPath $installPath -ArchivePath $archivePath -IncludeDockerImages

Write-Host "`nPress Enter to exit..." -ForegroundColor Green
Read-Host
