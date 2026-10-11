<#
.SYNOPSIS
Builds an unencrypted, fully verified BPP migration TAR and SHA-256 companion.

.DESCRIPTION
Production mode captures running services, stops all writers, exports approved
state/images, and restarts only after TAR extraction/hash/scope verification and
promotion succeed. A failure deliberately leaves the source stack stopped.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InstallPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$')][string]$Version,
    [switch]$FixtureMode,
    [string]$FixtureStatePath,
    [string]$FixtureImageBundle,
    [string]$PythonExecutable = 'python',
    [switch]$ReplaceExisting,
    [switch]$ForceVerifierFailure,
    [string]$FixtureGitBranch = 'main',
    [AllowEmptyString()][string]$FixtureGitStatus = '',
    [string]$FixtureCommit = 'fixture'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BppRelease.Common.psm1') -Force

function Test-IncludedReleaseFile {
    <#
    .SYNOPSIS
    Applies the reviewed application/state exclusion boundary to one relative file.
    .OUTPUTS
    Boolean only; it never reads file contents or changes source state.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][ValidateSet('Application', 'State')][string]$Scope
    )

    $normalized = $RelativePath.Replace('\', '/')
    while ($normalized.StartsWith('./', [StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }
    $lower = $normalized.ToLowerInvariant()
    $segments = @($lower -split '/')
    $forbiddenDirectories = @('.git', '.worktrees', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'dist', 'cuda-cache')
    if (@($segments | Where-Object { $_ -in $forbiddenDirectories }).Count -gt 0) { return $false }
    $name = [IO.Path]::GetFileName($lower)
    if ($name -eq 'secret.key' -or $name -eq 'backup.db' -or $name.EndsWith('.once') -or $name.EndsWith('.pyc') -or $name.EndsWith('.pyo')) { return $false }
    if ($name -match '(?:token|private[-_.]?key|credential|webhook)') { return $false }

    if ($Scope -eq 'Application') {
        if ($lower -eq '.env' -or $lower -eq 'config/config.yml') { return $false }
        if ($lower -match '^(?:storage|lpr-data)(/|$)') { return $false }
        if ($lower -match '^config/(?:auth|acme|certs|lpr|backups|dashboard-settings)(/|$)') { return $false }
    }
    else {
        if ([IO.Path]::GetExtension($lower) -in @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mkv', '.avi', '.mov')) { return $false }
    }
    return $true
}

function Copy-BppFilteredTree {
    <#
    .SYNOPSIS
    Copies regular files that pass the release scope into a new staging tree.
    .OUTPUTS
    Files/directories beneath Destination; symlinks/reparse points are never followed.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][ValidateSet('Application', 'State')][string]$Scope
    )

    $sourceRoot = (Resolve-BppFullPath -Path $Source).TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "Copy source does not exist: '$sourceRoot'." }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $prefixLength = $sourceRoot.Length + 1
    foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force -Attributes !ReparsePoint) {
        $relative = $file.FullName.Substring($prefixLength)
        if (-not (Test-IncludedReleaseFile -RelativePath $relative -Scope $Scope)) { continue }
        $target = Join-Path $Destination $relative
        $targetParent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetParent)) { New-Item -ItemType Directory -Path $targetParent -Force | Out-Null }
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

function Get-BppComposeVolumeName {
    <#
    .SYNOPSIS
    Resolves the exact named-volume source mounted at a service container path.
    .OUTPUTS
    One Docker volume name; no container or volume state is changed.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Service,
        [Parameter(Mandatory = $true)][string]$ContainerPath
    )

    $container = @(Invoke-BppCompose -Root $Root -Arguments @('ps', '-aq', $Service))
    if ($container.Count -ne 1 -or [string]::IsNullOrWhiteSpace($container[0])) { throw "Expected one container for '$Service'." }
    $inspect = @(Invoke-BppNative -FilePath 'docker' -ArgumentList @('inspect', $container[0])) -join "`n" | ConvertFrom-Json
    $mount = @($inspect[0].Mounts | Where-Object { $_.Type -eq 'volume' -and $_.Destination -eq $ContainerPath })
    if ($mount.Count -ne 1) { throw "Expected one named volume at '${Service}:$ContainerPath'." }
    return [string]$mount[0].Name
}

function Wait-BppSourceHealthy {
    <#
    .SYNOPSIS
    Waits for the restarted Frigate container to report healthy after package success.
    .OUTPUTS
    No output on success; throws on unhealthy or timeout without claiming recovery.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root, [int]$TimeoutSeconds = 240)

    $container = @(Invoke-BppCompose -Root $Root -Arguments @('ps', '-q', 'frigate'))
    if ($container.Count -ne 1) { throw 'Cannot locate Frigate after source restart.' }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $status = (@(Invoke-BppNative -FilePath 'docker' -ArgumentList @('inspect', '-f', '{{.State.Health.Status}}', $container[0])) -join '').Trim()
        if ($status -eq 'healthy') { return }
        if ($status -eq 'unhealthy') { throw 'Source Frigate is unhealthy after package completion.' }
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Timed out waiting for source Frigate health after package completion.'
}

function Test-BppSourceRuntime {
    <#
    .SYNOPSIS
    Proves the restored source has valid Frigate configuration and working host/container GPU access.
    .OUTPUTS
    No output on success; throws so the caller can stop the stack again on failure.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root)

    $container = @(Invoke-BppCompose -Root $Root -Arguments @('ps', '-q', 'frigate'))
    if ($container.Count -ne 1 -or [string]::IsNullOrWhiteSpace($container[0])) {
        throw 'Cannot locate Frigate for post-restart validation.'
    }
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'python3', '-m', 'frigate', '--validate-config') | Out-Null
    Invoke-BppNative -FilePath 'nvidia-smi' -ArgumentList @('-L') | Out-Null
    Invoke-BppNative -FilePath 'docker' -ArgumentList @('exec', $container[0], 'nvidia-smi', '-L') | Out-Null
}

$sourceRoot = Resolve-BppFullPath -Path $InstallPath
$outputRoot = Resolve-BppFullPath -Path $OutputDirectory
foreach ($required in @('docker-compose.yml', '.env', 'config/config.yml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $required) -PathType Leaf)) { throw "Install source is missing '$required'." }
}
if (-not (Test-Path -LiteralPath $outputRoot)) { New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null }
$sourcePrefix = $sourceRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($outputRoot.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output directory must be outside the source installation.' }
$finalArchive = Join-Path $outputRoot 'BPP-VMS-FullBackup.tar'
$finalChecksum = $finalArchive + '.sha256'
if ((Test-Path -LiteralPath $finalArchive) -and -not $ReplaceExisting) { throw "Final archive already exists: '$finalArchive'." }
$identifier = [Guid]::NewGuid().ToString('N')
$stagingRoot = Join-Path $outputRoot ('.bpp-release-stage-' + $identifier)
$releaseRoot = Join-Path $stagingRoot 'bpp-release'
$partialArchive = Join-Path $outputRoot ('BPP-VMS-FullBackup.tar.' + $identifier + '.partial')
$runningServices = @()
$sourceQuiesced = $false

try {
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $stagingRoot 'phase.txt'), 'preflight', (New-Object Text.UTF8Encoding($false)))
    $policy = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'release-policy.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($FixtureMode) {
        $sourceBranch = $FixtureGitBranch
        $sourceStatus = $FixtureGitStatus
        $sourceCommit = $FixtureCommit
    }
    else {
        $sourceBranch = (@(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $sourceRoot, 'branch', '--show-current')) -join '').Trim()
        $sourceStatus = @(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
        $sourceCommit = (@(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $sourceRoot, 'rev-parse', 'HEAD')) -join '').Trim()
    }
    if ($sourceBranch -ne 'main') { throw 'Production migration packaging requires the main branch.' }
    if (-not [string]::IsNullOrWhiteSpace($sourceStatus)) { throw 'Production migration packaging requires a clean worktree.' }
    foreach ($model in @($policy.requiredModels)) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $model) -PathType Leaf)) { throw "Required model is missing: '$model'." }
    }

    if (-not $FixtureMode) {
        Invoke-BppNative -FilePath 'docker' -ArgumentList @('info') | Out-Null
        $runningServices = @(Get-BppActiveState -Root $sourceRoot)
        Invoke-BppCompose -Root $sourceRoot -Arguments @('stop') | Out-Null
        $sourceQuiesced = $true
        [IO.File]::WriteAllText((Join-Path $stagingRoot 'phase.txt'), 'quiesced', (New-Object Text.UTF8Encoding($false)))
    }

    Copy-BppFilteredTree -Source $sourceRoot -Destination (Join-Path $releaseRoot 'application') -Scope Application
    $profiles = Join-Path $releaseRoot 'profiles'
    & $PythonExecutable (Join-Path $PSScriptRoot 'build_site_profiles.py') --source-config (Join-Path $sourceRoot 'config/config.yml') --source-env (Join-Path $sourceRoot '.env') --output-directory $profiles
    if ($LASTEXITCODE -ne 0) { throw "Site profile generation failed with exit code $LASTEXITCODE." }

    $stateRoot = Join-Path $releaseRoot 'state'
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    $imageDirectory = Join-Path $releaseRoot 'images'
    New-Item -ItemType Directory -Path $imageDirectory -Force | Out-Null
    $imageBundleTarget = Join-Path $imageDirectory 'docker-images.tar'
    if ($FixtureMode) {
        if ([string]::IsNullOrWhiteSpace($FixtureStatePath) -or [string]::IsNullOrWhiteSpace($FixtureImageBundle)) { throw 'Fixture mode requires state and image bundle paths.' }
        Copy-BppFilteredTree -Source $FixtureStatePath -Destination $stateRoot -Scope State
        Copy-Item -LiteralPath $FixtureImageBundle -Destination $imageBundleTarget
    }
    else {
        $authVolume = Get-BppComposeVolumeName -Root $sourceRoot -Service 'auth-service' -ContainerPath '/data'
        Export-BppAuthSeed -VolumeName $authVolume -Destination (Join-Path $stateRoot 'auth-db')
        foreach ($volumeSpec in @(
            @('nas-bot', '/data/nas-storage', 'nas-storage'),
            @('nas-bot', '/data', 'nas-bot-data')
        )) {
            try {
                $volume = Get-BppComposeVolumeName -Root $sourceRoot -Service $volumeSpec[0] -ContainerPath $volumeSpec[1]
                Export-BppNamedVolume -VolumeName $volume -Destination (Join-Path $stateRoot $volumeSpec[2])
            }
            catch { Write-Warning "Optional NAS state '$($volumeSpec[2])' was not exported: $($_.Exception.Message)" }
        }
        foreach ($bindSpec in @(
            @('config/lpr', 'config/lpr'),
            @('config/dashboard-settings', 'config/dashboard-settings'),
            @('config/backups', 'config/backups')
        )) {
            $bindSource = Join-Path $sourceRoot $bindSpec[0]
            if (Test-Path -LiteralPath $bindSource -PathType Container) {
                Copy-BppFilteredTree -Source $bindSource -Destination (Join-Path $stateRoot $bindSpec[1]) -Scope State
            }
        }
        $recoverySource = Join-Path (Split-Path -Parent $sourceRoot) 'backup'
        if (Test-Path -LiteralPath $recoverySource -PathType Container) {
            Copy-BppFilteredTree -Source $recoverySource -Destination (Join-Path $stateRoot 'recovery') -Scope State
        }
        $images = @(Invoke-BppCompose -Root $sourceRoot -Arguments @('config', '--images') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        if ($images.Count -eq 0) { throw 'Compose resolved no Docker images.' }
        Invoke-BppNative -FilePath 'docker' -ArgumentList (@('save', '-o', $imageBundleTarget) + $images) | Out-Null
    }

    foreach ($requiredState in @($policy.requiredState)) {
        if (-not (Test-Path -LiteralPath (Join-Path $stateRoot $requiredState))) { throw "Required state is missing: '$requiredState'." }
    }
    $manifest = [ordered]@{
        schema = 'bpp-release-manifest/v1'
        releaseSchema = 1
        version = $Version
        buildKind = $(if ($FixtureMode) { 'fixture' } else { 'production' })
        createdUtc = [DateTime]::UtcNow.ToString('o')
        sourceCommit = $sourceCommit
        profiles = @('clone', 'new-site')
        requiredModels = @($policy.requiredModels)
        requiredState = @($policy.requiredState)
        excludedRuntimeRoots = @($policy.excludedRuntimeRoots)
        excludedVolumes = @($policy.excludedVolumes)
        files = @(Get-BppFileManifest -Root $releaseRoot)
    }
    Write-BppManifest -Path (Join-Path $releaseRoot 'manifest.json') -Manifest $manifest
    Invoke-BppNative -FilePath 'tar.exe' -ArgumentList @('-cf', $partialArchive, '-C', $stagingRoot, 'bpp-release') | Out-Null
    [IO.File]::WriteAllText((Join-Path $stagingRoot 'phase.txt'), 'tar-built', (New-Object Text.UTF8Encoding($false)))

    $verifierArguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'Test-BppRelease.ps1'), '-ArchivePath', $partialArchive, '-Full')
    if ($ForceVerifierFailure) { $verifierArguments += '-ForceFailure' }
    Invoke-BppNative -FilePath 'powershell' -ArgumentList $verifierArguments | Out-Null
    [IO.File]::WriteAllText((Join-Path $stagingRoot 'phase.txt'), 'scope-verified', (New-Object Text.UTF8Encoding($false)))

    if ((Test-Path -LiteralPath $finalArchive) -and $ReplaceExisting) {
        $previous = Join-Path $outputRoot ('BPP-VMS-FullBackup.previous-' + $identifier + '.tar')
        Move-Item -LiteralPath $finalArchive -Destination $previous
        try { Move-Item -LiteralPath $partialArchive -Destination $finalArchive } catch { Move-Item -LiteralPath $previous -Destination $finalArchive; throw }
        Remove-Item -LiteralPath $previous -Force
    }
    else { Move-BppAtomic -Source $partialArchive -Destination $finalArchive }
    $hash = (Get-FileHash -LiteralPath $finalArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($finalChecksum, "$hash  BPP-VMS-FullBackup.tar`r`n", [Text.Encoding]::ASCII)
    Copy-BppReleaseCompanions -OutputDirectory $outputRoot

    if (-not $FixtureMode -and $runningServices.Count -gt 0) {
        try {
            Invoke-BppCompose -Root $sourceRoot -Arguments (@('start') + $runningServices) | Out-Null
            Wait-BppSourceHealthy -Root $sourceRoot
            Test-BppSourceRuntime -Root $sourceRoot
        }
        catch {
            Invoke-BppCompose -Root $sourceRoot -Arguments @('stop') | Out-Null
            throw "Source restart validation failed and the source stack was stopped again: $($_.Exception.Message)"
        }
    }
    Write-Host "Created and verified: $finalArchive" -ForegroundColor Green
}
catch {
    $sourceState = if ($sourceQuiesced) {
        'source remains stopped until verification succeeds'
    }
    else {
        'failure occurred before source quiescence; source runtime state was not changed'
    }
    Write-Error ("Package creation failed; ${sourceState}: " + $_.Exception.Message)
    throw
}
finally {
    if ((Test-Path -LiteralPath $stagingRoot) -and (-not $sourceQuiesced -or (Test-Path -LiteralPath $finalArchive))) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}
