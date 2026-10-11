<#
.SYNOPSIS
Applies a self-contained BPP update while preserving site state and rolling back failures.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$InstallRoot = 'D:\BPP-VMS\frigate-nvr',
    [switch]$AllowDevelopment,
    [switch]$FixtureMode,
    [switch]$ForceHealthFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BppRelease.Common.psm1') -Force

function Get-VersionTuple {
    <#
    .SYNOPSIS
    Parses the numeric core of production or explicitly allowed dev versions.
    .OUTPUTS
    Three integers; malformed versions fail before the installed node stops.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-dev\.[0-9A-Za-z.-]+)?$') { throw "Unsupported update version '$Value'." }
    return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
}

function Test-NewerVersion {
    <#
    .SYNOPSIS
    Compares semantic numeric cores and rejects equal/downgrade updates.
    .OUTPUTS
    Boolean without modifying installed metadata.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Candidate, [Parameter(Mandatory = $true)][string]$Current)

    $candidateTuple = @(Get-VersionTuple -Value $Candidate)
    $currentTuple = @(Get-VersionTuple -Value $Current)
    for ($index = 0; $index -lt 3; $index++) {
        if ($candidateTuple[$index] -gt $currentTuple[$index]) { return $true }
        if ($candidateTuple[$index] -lt $currentTuple[$index]) { return $false }
    }
    return $false
}

function Assert-ReleaseOwnedPath {
    <#
    .SYNOPSIS
    Confirms a manifest release file stays below the install root and outside site ownership.
    .OUTPUTS
    Canonical target path, or an exception before snapshot/promotion.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $normalized = $RelativePath.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -match '^(?:/|[A-Za-z]:)' -or $normalized -match '(^|/)\.\.(/|$)') { throw "Unsafe release file '$RelativePath'." }
    foreach ($sitePath in @($script:Policy.siteOwnedPaths) + @('.bpp-node.json', '.bpp-autostart-ready', '.bpp-rollback')) {
        $site = ([string]$sitePath).Replace('\', '/').TrimEnd('/')
        if ($normalized -eq $site -or $normalized.StartsWith($site + '/', [StringComparison]::OrdinalIgnoreCase)) { throw "Update attempts to own site path '$RelativePath'." }
    }
    return Assert-BppPathUnderRoot -Root $script:TargetRoot -Path (Join-Path $script:TargetRoot $normalized)
}

function Copy-ReleaseFileSet {
    <#
    .SYNOPSIS
    Copies an enumerated release-owned file set while retaining relative layout.
    .OUTPUTS
    Destination files only; the manifest list controls every copied path.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$DestinationRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )

    foreach ($relative in $RelativePaths) {
        $source = Join-Path $SourceRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release file source is missing '$relative'." }
        $destination = Join-Path $DestinationRoot $relative
        $parent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

function Invoke-TargetCompose {
    <#
    .SYNOPSIS
    Runs target Compose with the local-only site overlay and checked exit status.
    .OUTPUTS
    Native stdout; public-edge is not activated by update or rollback.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    return Invoke-BppNative -FilePath 'docker' -WorkingDirectory $script:TargetRoot -ArgumentList (@('compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.site.yml') + $Arguments)
}

function Wait-TargetHealth {
    <#
    .SYNOPSIS
    Requires healthy Frigate and valid runtime config after promotion or rollback.
    .OUTPUTS
    No output; throws to initiate rollback when validation fails.
    #>
    [CmdletBinding()]
    param()

    $container = @(Invoke-TargetCompose -Arguments @('ps', '-q', 'frigate'))
    if ($container.Count -ne 1) { throw 'Cannot locate target Frigate.' }
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    do {
        $health = (@(Invoke-BppNative -FilePath 'docker' -ArgumentList @('inspect', '-f', '{{.State.Health.Status}}', $container[0])) -join '').Trim()
        if ($health -eq 'healthy') { break }
        if ($health -eq 'unhealthy') { throw 'Target Frigate is unhealthy.' }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($health -ne 'healthy') { throw 'Target Frigate health timed out.' }
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'python3', '-m', 'frigate', '--validate-config') | Out-Null
}

function Remove-OldRollbackGenerations {
    <#
    .SYNOPSIS
    Keeps only the three newest successful tool-owned rollback generations.
    .OUTPUTS
    No output; each deletion is constrained to a direct child with valid metadata.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RollbackRoot)

    $generations = @(Get-ChildItem -LiteralPath $RollbackRoot -Directory -Force | ForEach-Object {
        $metadataPath = Join-Path $_.FullName 'generation.json'
        if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
            $metadata = [IO.File]::ReadAllText($metadataPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
            if ($metadata.schema -eq 'bpp-rollback-generation/v1' -and $metadata.status -eq 'successful') {
                [PSCustomObject]@{ Directory = $_; PromotionUtc = [DateTime]::Parse($metadata.promotionUtc).ToUniversalTime() }
            }
        }
    } | Sort-Object PromotionUtc -Descending)
    foreach ($generation in @($generations | Select-Object -Skip ([int]$script:Policy.rollbackRetention))) {
        $resolved = Assert-BppPathUnderRoot -Root $RollbackRoot -Path $generation.Directory.FullName
        if ((Split-Path -Parent $resolved) -ne (Resolve-BppFullPath -Path $RollbackRoot)) { throw 'Rollback pruning target is not a direct child.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

$archive = Resolve-BppFullPath -Path $ArchivePath
$script:TargetRoot = Resolve-BppFullPath -Path $InstallRoot
$script:Policy = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'release-policy.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$currentPath = Join-Path $script:TargetRoot '.bpp-release\current.json'
if (-not (Test-Path -LiteralPath $currentPath -PathType Leaf)) { throw 'Installed release metadata is missing.' }
$current = [IO.File]::ReadAllText($currentPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($current.schema -ne 'bpp-installed-release/v1') { throw 'Installed release metadata schema is unsupported.' }
$extract = Join-Path ([IO.Path]::GetTempPath()) ('bpp-release-' + [Guid]::NewGuid().ToString('N'))
$promotionStarted = $false
$rollbackRoot = Join-Path $script:TargetRoot '.bpp-rollback'
$generation = $null
$autostartBytes = $null
$runningServices = @()

try {
    & (Join-Path $PSScriptRoot 'Test-BppRelease.ps1') -ArchivePath $archive -ExtractRoot $extract -Full
    $releaseRoot = Join-Path $extract 'bpp-release'
    $manifest = Read-BppManifest -Path (Join-Path $releaseRoot 'manifest.json')
    if ($manifest.releaseType -ne 'update' -or -not (Test-Path -LiteralPath (Join-Path $releaseRoot 'images\docker-images.tar') -PathType Leaf)) { throw 'Archive is not a self-contained BPP update.' }
    if ($manifest.buildKind -eq 'development' -and -not $AllowDevelopment) { throw 'Development update requires -AllowDevelopment.' }
    if (-not (Test-NewerVersion -Candidate $manifest.version -Current $current.version)) { throw 'Update version is not newer than the installed release.' }
    if ([int]$manifest.stateSchema -ne [int]$current.stateSchema) {
        if (@($manifest.migrations).Count -eq 0) { throw 'State schema change requires explicit apply and rollback migrations.' }
        foreach ($migration in @($manifest.migrations)) {
            if ([string]::IsNullOrWhiteSpace($migration.applyScript) -or [string]::IsNullOrWhiteSpace($migration.rollbackScript)) { throw 'Every state migration requires apply and rollback scripts.' }
        }
    }
    $newFiles = @($manifest.releaseFiles | ForEach-Object { [string]$_ })
    $oldFiles = @($current.releaseFiles | ForEach-Object { [string]$_ })
    foreach ($relative in @($newFiles + $oldFiles | Sort-Object -Unique)) { [void](Assert-ReleaseOwnedPath -RelativePath $relative) }

    if (-not (Test-Path -LiteralPath $rollbackRoot)) { New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null }
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')
    $generation = Join-Path $rollbackRoot ($current.version + '-' + $timestamp)
    New-Item -ItemType Directory -Path (Join-Path $generation 'files') -Force | Out-Null
    foreach ($relative in $oldFiles) {
        $installedFile = Join-Path $script:TargetRoot $relative
        if (Test-Path -LiteralPath $installedFile -PathType Leaf) {
            $snapshot = Join-Path (Join-Path $generation 'files') $relative
            $parent = Split-Path -Parent $snapshot
            if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -LiteralPath $installedFile -Destination $snapshot
        }
    }
    Copy-Item -LiteralPath $currentPath -Destination (Join-Path $generation 'current.json')
    $readyPath = Join-Path $script:TargetRoot '.bpp-autostart-ready'
    if (Test-Path -LiteralPath $readyPath -PathType Leaf) { $autostartBytes = [IO.File]::ReadAllBytes($readyPath); Remove-Item -LiteralPath $readyPath -Force }

    if (-not $FixtureMode) {
        $runningServices = @(Get-BppActiveState -Root $script:TargetRoot)
        Invoke-TargetCompose -Arguments @('stop') | Out-Null
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('load', '-i', (Join-Path $releaseRoot 'images\docker-images.tar')) | Out-Null
    }
    $promotionStarted = $true
    foreach ($relative in $oldFiles) {
        if ($relative -notin $newFiles) {
            $obsolete = Assert-ReleaseOwnedPath -RelativePath $relative
            if (Test-Path -LiteralPath $obsolete -PathType Leaf) { Remove-Item -LiteralPath $obsolete -Force }
        }
    }
    Copy-ReleaseFileSet -SourceRoot (Join-Path $releaseRoot 'application') -DestinationRoot $script:TargetRoot -RelativePaths $newFiles
    if ($ForceHealthFailure) { throw 'Forced candidate health failure.' }
    if (-not $FixtureMode) {
        Invoke-TargetCompose -Arguments @('config', '--quiet') | Out-Null
        Invoke-TargetCompose -Arguments (@('up', '-d', '--no-build') + @()) | Out-Null
        Wait-TargetHealth
    }

    $newMetadata = [ordered]@{ schema = 'bpp-installed-release/v1'; version = $manifest.version; stateSchema = [int]$manifest.stateSchema; releaseFiles = @($newFiles); imageIds = @($manifest.imageIds); sourceCommit = $manifest.sourceCommit; promotedUtc = [DateTime]::UtcNow.ToString('o') }
    $metadataDirectory = Split-Path -Parent $currentPath
    if (-not (Test-Path -LiteralPath $metadataDirectory)) { New-Item -ItemType Directory -Path $metadataDirectory -Force | Out-Null }
    [IO.File]::WriteAllText($currentPath, ($newMetadata | ConvertTo-Json -Depth 10) + "`r`n", (New-Object Text.UTF8Encoding($false)))
    $generationMetadata = [ordered]@{ schema = 'bpp-rollback-generation/v1'; version = $current.version; promotedTo = $manifest.version; promotionUtc = [DateTime]::UtcNow.ToString('o'); status = 'successful' }
    [IO.File]::WriteAllText((Join-Path $generation 'generation.json'), ($generationMetadata | ConvertTo-Json) + "`r`n", (New-Object Text.UTF8Encoding($false)))
    if ($null -ne $autostartBytes) { [IO.File]::WriteAllBytes($readyPath, $autostartBytes) }
    try { Remove-OldRollbackGenerations -RollbackRoot $rollbackRoot } catch { Write-Warning "Rollback pruning failed: $($_.Exception.Message)" }
    Write-Host "Update completed and verified: $($manifest.version)" -ForegroundColor Green
}
catch {
    $candidateError = $_.Exception.Message
    if ($promotionStarted -and $null -ne $generation) {
        try {
            $snapshotMetadata = [IO.File]::ReadAllText((Join-Path $generation 'current.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
            foreach ($relative in @($manifest.releaseFiles + $snapshotMetadata.releaseFiles | Sort-Object -Unique)) {
                $target = Assert-ReleaseOwnedPath -RelativePath ([string]$relative)
                if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
            }
            Copy-ReleaseFileSet -SourceRoot (Join-Path $generation 'files') -DestinationRoot $script:TargetRoot -RelativePaths @($snapshotMetadata.releaseFiles | Where-Object { Test-Path -LiteralPath (Join-Path (Join-Path $generation 'files') $_) })
            Copy-Item -LiteralPath (Join-Path $generation 'current.json') -Destination $currentPath -Force
            if ($null -ne $autostartBytes) { [IO.File]::WriteAllBytes((Join-Path $script:TargetRoot '.bpp-autostart-ready'), $autostartBytes) }
            if (-not $FixtureMode -and $runningServices.Count -gt 0) { Invoke-TargetCompose -Arguments (@('start') + $runningServices) | Out-Null; Wait-TargetHealth }
            Write-Warning ("Update failed; automatic rollback passed and old release is active: " + $candidateError)
        }
        catch { Write-Error ("Update and rollback failed; keep node stopped for repair: " + $_.Exception.Message) }
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $extract) { Remove-BppOwnedTemporaryDirectory -Path $extract }
}
