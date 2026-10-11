<#
.SYNOPSIS
Clears stuck or pending i2 Analyst's Notebook import queues from both the Windows filesystem and Docker database.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BridgeRoot = '',

    [Parameter(Mandatory = $false)]
    [switch]$All
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BridgeRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
    $BridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\runtime\i2-bridge'))
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  BPP-VMS: Clearing Stuck i2 Import Queues" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Stop hung i2 process
Write-Host "[1/4] Stopping any hanging i2 (Anb.exe) processes..." -ForegroundColor Yellow
Stop-Process -Name "Anb" -Force -ErrorAction SilentlyContinue

# 2. Clean bridge directory files
Write-Host "[2/4] Cleaning bridge folders in: $BridgeRoot" -ForegroundColor Yellow
$foldersToClean = @(
    (Join-Path $BridgeRoot 'jobs\pending'),
    (Join-Path $BridgeRoot 'jobs\processing'),
    (Join-Path $BridgeRoot 'inbox'),
    (Join-Path $BridgeRoot 'outbox')
)

foreach ($dir in $foldersToClean) {
    if (Test-Path $dir) {
        Remove-Item -Path (Join-Path $dir '*') -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Cleaned: $dir" -ForegroundColor DarkGray
    }
}

$lockFile = Join-Path $BridgeRoot 'bridge.lock'
if (Test-Path $lockFile) {
    Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
    Write-Host "  Removed lock file" -ForegroundColor DarkGray
}

$progressFile = Join-Path $BridgeRoot 'progress.json'
if (Test-Path $progressFile) {
    Remove-Item -Path $progressFile -Force -ErrorAction SilentlyContinue
    Write-Host "  Removed progress file" -ForegroundColor DarkGray
}

# 3. Clean Docker state
Write-Host "[3/4] Cleaning stuck import records inside nas-bot container..." -ForegroundColor Yellow
$keepFilter = if ($All) { "False" } else { "v.get('status') == 'applied'" }
$cleanScript = @"
import json, os
p = '/data/i2-graph-state.json'
try:
    if os.path.exists(p):
        with open(p, 'r', encoding='utf-8') as f:
            d = json.load(f)
        before = len(d.get('imports', {}))
        d['imports'] = {k: v for k, v in d.get('imports', {}).items() if $keepFilter}
        after = len(d.get('imports', {}))
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        print(f'Cleared {before - after} stuck import(s). Remaining: {after}')
    else:
        print('State file not found, skipping.')
except Exception as e:
    print(f'Error: {e}')
"@

try {
    $encoded = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($cleanScript))
    docker exec -i nas-bot-service python3 -c "import base64; exec(base64.b64decode('$encoded').decode('utf-8'))"
} catch {
    Write-Host "  Note: Could not run inside Docker automatically ($($_.Exception.Message))" -ForegroundColor DarkYellow
}

# 4. Restart nas-bot to refresh state cache
Write-Host "[4/4] Restarting nas-bot-service container..." -ForegroundColor Yellow
try {
    docker restart nas-bot-service | Out-Null
    Write-Host "  nas-bot-service restarted successfully." -ForegroundColor Green
} catch {
    Write-Host "  Could not restart container via docker command." -ForegroundColor DarkYellow
}

Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Clear completed! You can now upload fresh files." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan