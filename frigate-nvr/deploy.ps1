# deploy.ps1 - fail-fast Windows PowerShell deployment for BPP-VMS.
# Every Docker failure is converted to a terminating PowerShell error because
# Windows PowerShell otherwise continues after a native command returns nonzero.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Invoke-Compose {
    <#
    .SYNOPSIS
    Runs one Docker Compose command and stops deployment on a nonzero exit code.
    .DESCRIPTION
    Native executable failures do not honor $ErrorActionPreference in Windows
    PowerShell.  This wrapper preserves command output while turning a failed
    Compose operation into a terminating error so callers cannot report success
    for a partial image build, startup, or recreation.
    #>
    param(
        [Parameter(Mandatory)]
        [string[]]$ComposeArguments
    )

    & docker compose @ComposeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($ComposeArguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-ComposeContainerId {
    <#
    .SYNOPSIS
    Returns the current container ID for one Compose service or an empty string.
    .DESCRIPTION
    This read-only helper keeps optional pre-deploy config validation limited to
    an already running Frigate container; a first installation has no container
    yet and must proceed directly to the guarded build path.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Service
    )

    # A fresh Compose project produces no output.  Collect output in an array
    # before calling Trim so StrictMode cannot invoke a method on $null during
    # the first installation, while still preserving Docker's real exit code.
    $containerOutput = @(& docker compose ps -q $Service 2>$null)
    $composeExitCode = $LASTEXITCODE
    $containerId = if ($containerOutput.Count -gt 0) {
        ([string]$containerOutput[0]).Trim()
    }
    else {
        ""
    }
    if ($composeExitCode -ne 0) {
        throw "Unable to query Docker Compose service '$Service'."
    }
    return $containerId
}

# Refuse to operate without a machine-local environment file; secrets must never
# be substituted from tracked source or silently created by a normal deploy.
if (-not (Test-Path -LiteralPath ".env")) {
    throw "ERROR: .env file not found. Run the new-camp installer or copy .env.example first."
}

# Validate the active configuration before replacing a healthy Frigate instance.
$existingFrigate = Get-ComposeContainerId -Service "frigate"
if ($existingFrigate) {
    Write-Host "==> Validating config.yml..." -ForegroundColor Cyan
    Invoke-Compose -ComposeArguments @("exec", "-T", "frigate", "python3", "-m", "frigate", "--validate-config")
}

# Reject missing camera placeholders before Docker can start with malformed RTSP
# URLs.  Empty values are allowed only for optional variables already declared.
$configContent = Get-Content -LiteralPath "config/config.yml" -Raw
$requiredVariables = [regex]::Matches($configContent, '\{FRIGATE_[A-Z0-9_]+\}') |
    ForEach-Object { $_.Value.Trim('{}') } |
    Select-Object -Unique
$environmentContent = Get-Content -LiteralPath ".env" -Raw
$missingVariables = @(
    $requiredVariables | Where-Object {
        $escapedVariable = [regex]::Escape($_)
        $environmentContent -notmatch "(?m)^$escapedVariable="
    }
)
if ($missingVariables.Count -gt 0) {
    throw "ERROR: config.yml references variables missing from .env: $($missingVariables -join ', ')"
}

# Build first so a missing custom patch or incompatible upstream source prevents
# every subsequent startup step.  The local Frigate image is never pulled.
Write-Host "==> docker compose build" -ForegroundColor Cyan
Invoke-Compose -ComposeArguments @("build")

# Start all services only after every required local image built successfully.
Write-Host "==> docker compose up -d" -ForegroundColor Cyan
Invoke-Compose -ComposeArguments @("up", "-d")

# Dashboard templates consume environment/runtime settings at startup, so force
# recreation after a deployment rather than relying on an in-place reload.
Write-Host "==> Recreating dashboard..." -ForegroundColor Cyan
Invoke-Compose -ComposeArguments @("up", "-d", "--force-recreate", "dashboard")

# Frigate publishes a health check; treat a missing or unhealthy result as a
# deployment failure instead of printing a false completion message.
Write-Host -NoNewline "==> Waiting for Frigate healthy status..." -ForegroundColor Cyan
$healthy = $false
for ($attempt = 1; $attempt -le 40; $attempt++) {
    $frigateContainer = Get-ComposeContainerId -Service "frigate"
    if ($frigateContainer) {
        $status = (& docker inspect -f "{{.State.Health.Status}}" $frigateContainer 2>$null).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect Frigate health."
        }
        if ($status -eq "healthy") {
            $healthy = $true
            Write-Host " -> healthy!" -ForegroundColor Green
            break
        }
    }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 3
}

if (-not $healthy) {
    Write-Host ""
    $frigateContainer = Get-ComposeContainerId -Service "frigate"
    if ($frigateContainer) {
        & docker inspect -f "final health: {{.State.Health.Status}}" $frigateContainer
    }
    throw "Frigate did not become healthy before the deployment deadline."
}

Write-Host "==> Deploy completed successfully." -ForegroundColor Green
