<#
.SYNOPSIS
Installs one verified BPP release into a new empty Windows site root.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$InstallRoot = 'D:\BPP-VMS\frigate-nvr',
    [ValidateSet('Clone', 'NewSite')][string]$Profile,
    [string]$SiteName,
    [string]$LanIpAddress,
    [switch]$FixtureMode,
    [string]$PythonExecutable = 'python',
    [switch]$ForceHealthFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BppRelease.Common.psm1') -Force

function Invoke-InstalledCompose {
    <#
    .SYNOPSIS
    Runs Compose against the base and target local-only overlay as one unit.
    .OUTPUTS
    Checked native stdout; public-edge is never implicitly enabled.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    return Invoke-BppNative -FilePath 'docker' -WorkingDirectory $script:TargetRoot -ArgumentList (@(
        'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.site.yml'
    ) + $Arguments)
}

function Copy-InstallTree {
    <#
    .SYNOPSIS
    Copies a verified extracted directory into the fresh target without source ACLs.
    .OUTPUTS
    Destination files; throws rather than merging into an existing target.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Destination)

    if (Test-Path -LiteralPath $Destination) { throw "Install target already exists: '$Destination'." }
    New-Item -ItemType Directory -Path $Destination | Out-Null
    [IO.File]::WriteAllText((Join-Path $Destination '.bpp-install-partial'), 'installer-owned partial', [Text.Encoding]::ASCII)
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Restore-ReleaseBindState {
    <#
    .SYNOPSIS
    Restores approved Watchlist/settings/backups state into fresh bind directories.
    .OUTPUTS
    Target files only; source TLS/ACME/runtime-media paths are absent by policy.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StateRoot)

    foreach ($relative in @('config\lpr', 'config\dashboard-settings', 'config\backups')) {
        $source = Join-Path $StateRoot $relative
        if (Test-Path -LiteralPath $source -PathType Container) {
            $destination = Join-Path $script:TargetRoot $relative
            if (-not (Test-Path -LiteralPath $destination)) { New-Item -ItemType Directory -Path $destination -Force | Out-Null }
            Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
        }
    }
}

function Restore-NamedVolumeSeed {
    <#
    .SYNOPSIS
    Restores one raw directory or volume.tar into an exact new Compose volume.
    .OUTPUTS
    A populated named volume; uses the loaded auth image and never starts services.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$VolumeName, [Parameter(Mandatory = $true)][string]$SeedPath)

    Invoke-BppNative -FilePath 'docker' -ArgumentList @('volume', 'create', $VolumeName) | Out-Null
    $mount = (Resolve-BppFullPath -Path $SeedPath) + ':/seed:ro'
    if (Test-Path -LiteralPath (Join-Path $SeedPath 'volume.tar') -PathType Leaf) {
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('run', '--rm', '-v', "${VolumeName}:/target", '-v', $mount, 'auth-service:local', 'sh', '-eu', '-c', 'tar -xf /seed/volume.tar -C /target') | Out-Null
    }
    else {
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('run', '--rm', '-v', "${VolumeName}:/target", '-v', $mount, 'auth-service:local', 'sh', '-eu', '-c', 'cp -a /seed/. /target/') | Out-Null
    }
}

function Wait-InstalledHealth {
    <#
    .SYNOPSIS
    Requires Frigate health and runtime config/GPU validation before autostart.
    .OUTPUTS
    No output on success; failure leaves the stack stopped by the outer handler.
    #>
    [CmdletBinding()]
    param()

    $container = @(Invoke-InstalledCompose -Arguments @('ps', '-q', 'frigate'))
    if ($container.Count -ne 1) { throw 'Installer cannot locate Frigate.' }
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    do {
        $health = (@(Invoke-BppNative -FilePath 'docker' -ArgumentList @('inspect', '-f', '{{.State.Health.Status}}', $container[0])) -join '').Trim()
        if ($health -eq 'healthy') { break }
        if ($health -eq 'unhealthy') { throw 'Installed Frigate is unhealthy.' }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($health -ne 'healthy') { throw 'Installed Frigate health timed out.' }
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'python3', '-m', 'frigate', '--validate-config') | Out-Null
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'nvidia-smi', '-L') | Out-Null
}

function Register-BppAutostart {
    <#
    .SYNOPSIS
    Registers a highest-privilege current-user logon task only after health passes.
    .OUTPUTS
    A Scheduled Task; Windows user logon remains required for Docker Desktop WSL2.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$NodeId)

    $taskName = 'BPP-VMS-' + $NodeId.Substring(0, 12)
    $starter = Join-Path $script:TargetRoot 'scripts\release\Start-BppNode.ps1'
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$starter`" -InstallRoot `"$script:TargetRoot`"")
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
}

$archive = Resolve-BppFullPath -Path $ArchivePath
$script:TargetRoot = Resolve-BppFullPath -Path $InstallRoot
$bppRoot = Split-Path -Parent $script:TargetRoot
if ([string]::IsNullOrWhiteSpace($Profile)) { $Profile = Read-Host 'Profile (Clone or NewSite)' }
if ([string]::IsNullOrWhiteSpace($SiteName)) { $SiteName = Read-Host 'Site name' }
if ([string]::IsNullOrWhiteSpace($LanIpAddress)) { $LanIpAddress = Read-Host 'New machine LAN IPv4 address' }
if ([string]::IsNullOrWhiteSpace($SiteName) -or $SiteName.Length -gt 80 -or $SiteName.Contains("`r") -or $SiteName.Contains("`n")) { throw 'Site name must contain 1-80 characters on one line.' }
$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($LanIpAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or [Net.IPAddress]::IsLoopback($parsedAddress)) { throw 'LAN IP address must be a non-loopback IPv4 address.' }
if (Test-Path -LiteralPath $bppRoot) {
    $rootChildren = @(Get-ChildItem -LiteralPath $bppRoot -Force)
    if ($rootChildren.Count -gt 0) {
        $partialMarker = Join-Path $script:TargetRoot '.bpp-install-partial'
        if ($rootChildren.Count -eq 1 -and $rootChildren[0].FullName -eq $script:TargetRoot -and (Test-Path -LiteralPath $partialMarker -PathType Leaf)) {
            [void](Assert-BppPathUnderRoot -Root $bppRoot -Path $script:TargetRoot)
            Remove-Item -LiteralPath $script:TargetRoot -Recurse -Force
        }
        else { throw "BPP root must be empty before installation: '$bppRoot'." }
    }
}
else { New-Item -ItemType Directory -Path $bppRoot -Force | Out-Null }

if (-not $FixtureMode) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run installer as Administrator.' }
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('info') | Out-Null
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('compose', 'version') | Out-Null
    Invoke-BppNative -FilePath 'nvidia-smi' -ArgumentList @('-L') | Out-Null
}

$extract = Join-Path ([IO.Path]::GetTempPath()) ('bpp-release-' + [Guid]::NewGuid().ToString('N'))
$started = $false
try {
    & (Join-Path $PSScriptRoot 'Test-BppRelease.ps1') -ArchivePath $archive -ExtractRoot $extract -Full
    $releaseRoot = Join-Path $extract 'bpp-release'
    $manifest = Read-BppManifest -Path (Join-Path $releaseRoot 'manifest.json')
    Copy-InstallTree -Source (Join-Path $releaseRoot 'application') -Destination $script:TargetRoot
    $profileDirectory = if ($Profile -eq 'Clone') { 'clone' } else { 'new-site' }
    Copy-Item -LiteralPath (Join-Path $releaseRoot "profiles\$profileDirectory\config.yml") -Destination (Join-Path $script:TargetRoot 'config\config.yml') -Force
    Copy-Item -LiteralPath (Join-Path $releaseRoot "profiles\$profileDirectory\.env") -Destination (Join-Path $script:TargetRoot '.env') -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'templates\docker-compose.site.yml') -Destination (Join-Path $script:TargetRoot 'docker-compose.site.yml') -Force
    $releaseScriptTarget = Join-Path $script:TargetRoot 'scripts\release'
    if (-not (Test-Path -LiteralPath $releaseScriptTarget)) { New-Item -ItemType Directory -Path $releaseScriptTarget -Force | Out-Null }
    foreach ($tool in @('Start-BppNode.ps1', 'BppRelease.Common.psm1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $tool) -Destination (Join-Path $releaseScriptTarget $tool) -Force }

    $nodeId = [Guid]::NewGuid().ToString('N')
    $envValues = Read-BppEnv -Path (Join-Path $script:TargetRoot '.env')
    $envValues['SITE_NAME'] = $SiteName
    $envValues['NODE_ID'] = $nodeId
    $envValues['COMPOSE_PROJECT_NAME'] = 'bpp-vms-' + $nodeId.Substring(0, 12)
    $envValues['AUTH_COOKIE_SECURE'] = 'true'
    foreach ($secretKey in @('AUTH_AUDIT_SHARED_SECRET', 'WATCHLIST_PROXY_SHARED_SECRET', 'WATCHLIST_SERVICE_SHARED_SECRET')) { $envValues[$secretKey] = New-BppSecret }
    foreach ($emptyKey in @('WATCHLIST_FEDERATION_SHARED_SECRET', 'BPP_FEDERATION_ALLOW_CIDR', 'WATCHLIST_ALLOWED_ORIGINS', 'DUCKDNS_SUBDOMAIN', 'DUCKDNS_TOKEN', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'DISCORD_WEBHOOK_URL', 'LPR_TELEGRAM_BOT_TOKEN', 'LPR_TELEGRAM_CHAT_ID', 'LPR_DISCORD_WEBHOOK_URL')) { $envValues[$emptyKey] = '' }
    Write-BppEnv -Path (Join-Path $script:TargetRoot '.env') -Values $envValues
    & $PythonExecutable (Join-Path $PSScriptRoot 'configure_site.py') --config (Join-Path $script:TargetRoot 'config\config.yml') --lan-ip-address $LanIpAddress
    if ($LASTEXITCODE -ne 0) { throw 'Target config transformation failed.' }
    Restore-ReleaseBindState -StateRoot (Join-Path $releaseRoot 'state')

    $certDirectory = Join-Path $script:TargetRoot 'config\certs'
    if (-not (Test-Path -LiteralPath $certDirectory)) { New-Item -ItemType Directory -Path $certDirectory -Force | Out-Null }
    if ($FixtureMode) {
        & $PythonExecutable (Join-Path $script:TargetRoot 'auth-service\generate_tls_certificate.py') --certificate-file (Join-Path $certDirectory 'fullchain.pem') --private-key-file (Join-Path $certDirectory 'privkey.pem') --ip-address $LanIpAddress
        if ($LASTEXITCODE -ne 0) { throw 'Local TLS generation failed.' }
        Copy-Item -LiteralPath (Join-Path $releaseRoot 'state') -Destination (Join-Path $script:TargetRoot '.bpp-fixture-state') -Recurse
    }
    else {
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('load', '-i', (Join-Path $releaseRoot 'images\docker-images.tar')) | Out-Null
        $certMount = (Resolve-BppFullPath -Path $certDirectory) + ':/certs'
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('run', '--rm', '-v', $certMount, 'auth-service:local', 'python', '/app/generate_tls_certificate.py', '--certificate-file', '/certs/fullchain.pem', '--private-key-file', '/certs/privkey.pem', '--ip-address', $LanIpAddress) | Out-Null
        $project = [string]$envValues['COMPOSE_PROJECT_NAME']
        Restore-NamedVolumeSeed -VolumeName ($project + '_auth-db') -SeedPath (Join-Path $releaseRoot 'state\auth-db')
        foreach ($volume in @('nas-storage', 'nas-bot-data')) {
            $seed = Join-Path $releaseRoot ('state\' + $volume)
            if (Test-Path -LiteralPath $seed -PathType Container) { Restore-NamedVolumeSeed -VolumeName ($project + '_' + $volume) -SeedPath $seed }
        }
        & (Join-Path $script:TargetRoot 'scripts\harden-windows-acl.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Windows ACL hardening failed.' }
        Invoke-InstalledCompose -Arguments @('config', '--quiet') | Out-Null
        Invoke-InstalledCompose -Arguments @('up', '-d', '--no-build') | Out-Null
        $started = $true
        Wait-InstalledHealth
    }
    if ($ForceHealthFailure) { throw 'Forced target health failure for testing.' }

    $policy = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'release-policy.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
    $releaseFiles = @($manifest.files | Where-Object { $_.path.StartsWith('application/') } | ForEach-Object { $_.path.Substring(12) })
    $installedMetadata = [ordered]@{ schema = 'bpp-installed-release/v1'; version = $manifest.version; stateSchema = [int]$policy.stateSchema; releaseFiles = @($releaseFiles); imageIds = @(); sourceCommit = $manifest.sourceCommit; promotedUtc = [DateTime]::UtcNow.ToString('o') }
    $metadataDirectory = Join-Path $script:TargetRoot '.bpp-release'
    if (-not (Test-Path -LiteralPath $metadataDirectory)) { New-Item -ItemType Directory -Path $metadataDirectory -Force | Out-Null }
    [IO.File]::WriteAllText((Join-Path $metadataDirectory 'current.json'), ($installedMetadata | ConvertTo-Json -Depth 10) + "`r`n", (New-Object Text.UTF8Encoding($false)))
    $report = [ordered]@{ schema = 'bpp-node/v1'; version = $manifest.version; siteName = $SiteName; nodeId = $nodeId; composeProject = [string]$envValues['COMPOSE_PROJECT_NAME']; profile = $Profile; lanIpAddress = $LanIpAddress; publicEdgeEnabled = $false; status = 'healthy'; installedUtc = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::WriteAllText((Join-Path $script:TargetRoot '.bpp-node.json'), ($report | ConvertTo-Json -Depth 5) + "`r`n", (New-Object Text.UTF8Encoding($false)))
    if (-not $FixtureMode) { Register-BppAutostart -NodeId $nodeId }
    Remove-Item -LiteralPath (Join-Path $script:TargetRoot '.bpp-install-partial') -Force
    [IO.File]::WriteAllText((Join-Path $script:TargetRoot '.bpp-autostart-ready'), $nodeId + "`r`n", [Text.Encoding]::ASCII)
    Write-Host "Installation completed and verified. Open https://$LanIpAddress" -ForegroundColor Green
}
catch {
    if ($started -and -not $FixtureMode) { try { Invoke-InstalledCompose -Arguments @('stop') | Out-Null } catch { Write-Warning 'Target stop also failed; inspect Docker before retrying.' } }
    Write-Error ("Installation failed; target remains closed and autostart disabled: " + $_.Exception.Message)
    throw
}
finally {
    if (Test-Path -LiteralPath $extract) { Remove-BppOwnedTemporaryDirectory -Path $extract }
}
