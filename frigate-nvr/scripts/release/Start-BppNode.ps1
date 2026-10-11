<#
.SYNOPSIS
At user logon, waits for Docker Desktop and starts one verified local BPP node.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = 'D:\BPP-VMS\frigate-nvr',
    [ValidateRange(60, 3600)][int]$DockerWaitSeconds = 900
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $InstallRoot 'scripts\release\BppRelease.Common.psm1') -Force

function Invoke-NodeCompose {
    <#
    .SYNOPSIS
    Runs Compose with both base and local-only site definitions.
    .OUTPUTS
    Native stdout; public-edge is absent unless an operator explicitly invokes it elsewhere.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    return Invoke-BppNative -FilePath 'docker' -WorkingDirectory $InstallRoot -ArgumentList (@(
        'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.site.yml'
    ) + $Arguments)
}

if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot '.bpp-autostart-ready') -PathType Leaf)) {
    throw 'BPP autostart is disabled until installation/update verification succeeds.'
}

$deadline = [DateTime]::UtcNow.AddSeconds($DockerWaitSeconds)
do {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 5
} while ([DateTime]::UtcNow -lt $deadline)
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop did not become ready after user logon.' }

Invoke-NodeCompose -Arguments @('config', '--quiet') | Out-Null
Invoke-NodeCompose -Arguments @('up', '-d', '--no-build') | Out-Null
$container = @(Invoke-NodeCompose -Arguments @('ps', '-q', 'frigate'))
if ($container.Count -ne 1) { throw 'Autostart cannot locate the Frigate container.' }
$healthDeadline = [DateTime]::UtcNow.AddMinutes(4)
do {
    $health = (@(Invoke-BppNative -FilePath 'docker' -ArgumentList @('inspect', '-f', '{{.State.Health.Status}}', $container[0])) -join '').Trim()
    if ($health -eq 'healthy') { break }
    if ($health -eq 'unhealthy') { throw 'Frigate became unhealthy during autostart.' }
    Start-Sleep -Seconds 3
} while ([DateTime]::UtcNow -lt $healthDeadline)
if ($health -ne 'healthy') { throw 'Frigate health timed out during autostart.' }
Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'python3', '-m', 'frigate', '--validate-config') | Out-Null
