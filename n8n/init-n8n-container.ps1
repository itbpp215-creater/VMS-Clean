<#
.SYNOPSIS
Initializes the n8n Docker container for BPP-VMS, imports Gemini credentials,
and imports the All-in-One Master Bot Workflow.
#>

[CmdletBinding()]
param()

$AppRoot = (Resolve-Path "$PSScriptRoot\..\frigate-nvr").Path
Set-Location $AppRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Initializing n8n Docker Container for BPP-VMS Stack      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Start / Recreate n8n container
Write-Host "`n[1/4] Starting n8n container via Docker Compose..." -ForegroundColor Yellow
docker compose up -d n8n

# 2. Wait for n8n to be ready
Write-Host "`n[2/4] Waiting for n8n health check (http://localhost:5678/healthz)..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false
while (-not $ready -and $attempt -lt $maxAttempts) {
    Start-Sleep -Seconds 2
    $attempt++
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:5678/healthz" -TimeoutSec 2 -ErrorAction Stop
        if ($res.status -eq "ok" -or $null -ne $res) {
            $ready = $true
            Write-Host "n8n is ready and responding! (Attempt $attempt)" -ForegroundColor Green
        }
    }
    catch {
        Write-Host -NoNewline "."
    }
}

if (-not $ready) {
    Write-Warning "n8n took longer than expected to respond, proceeding with CLI import..."
}

# 3. Import Credentials into n8n container
Write-Host "`n[3/4] Importing Google Gemini credentials into n8n container..." -ForegroundColor Yellow
docker exec n8n-service n8n import:credentials --input=/n8n-init/credentials.json

# 4. Import Workflow into n8n container
Write-Host "`n[4/4] Importing BPP-VMS Master Bot Workflow into n8n container..." -ForegroundColor Yellow
docker exec n8n-service n8n import:workflow --input=/n8n-init/workflows/bpp_vms_master_bot_workflow.json

# 5. Restart n8n container to apply imported workflows
Write-Host "`n[5/5] Refreshing n8n container..." -ForegroundColor Yellow
docker restart n8n-service

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  n8n Container Initialization Completed Successfully!    " -ForegroundColor Green
Write-Host "  Web UI: http://localhost:5678                           " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
