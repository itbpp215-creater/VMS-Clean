<#
.SYNOPSIS
Builds a semantic-versioned, self-contained offline BPP update TAR.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$')][string]$Version,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [switch]$Development,
    [switch]$FixtureMode,
    [string]$FixtureImageBundle,
    [string]$FixtureGitBranch = 'main',
    [AllowEmptyString()][string]$FixtureGitStatus = '',
    [string]$FixtureCommit = 'fixture'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BppRelease.Common.psm1') -Force

function ConvertTo-VersionTuple {
    <#
    .SYNOPSIS
    Parses an exact production semantic version into three comparable integers.
    .OUTPUTS
    A three-element integer array; malformed versions throw before package writes.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "Invalid semantic version '$Value'." }
    return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
}

function Test-VersionGreater {
    <#
    .SYNOPSIS
    Compares two validated semantic versions without lexical ordering errors.
    .OUTPUTS
    True only when Candidate is numerically newer than Current.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Candidate, [Parameter(Mandatory = $true)][string]$Current)

    $candidateTuple = @(ConvertTo-VersionTuple -Value $Candidate)
    $currentTuple = @(ConvertTo-VersionTuple -Value $Current)
    for ($index = 0; $index -lt 3; $index++) {
        if ($candidateTuple[$index] -gt $currentTuple[$index]) { return $true }
        if ($candidateTuple[$index] -lt $currentTuple[$index]) { return $false }
    }
    return $false
}

function Test-UpdateApplicationFile {
    <#
    .SYNOPSIS
    Excludes every site-owned, runtime, dependency, Git, and old-identity path.
    .OUTPUTS
    Boolean only; source files remain unread except by the later approved copy.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $lower = $RelativePath.Replace('\', '/').ToLowerInvariant()
    $segments = @($lower -split '/')
    if (@($segments | Where-Object { $_ -in @('.git', '.worktrees', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', 'dist', 'cuda-cache') }).Count -gt 0) { return $false }
    if ($lower -in @('.env', 'config/config.yml', '.bpp-node.json', '.bpp-autostart-ready')) { return $false }
    if ($lower -match '^(?:storage|lpr-data|\.bpp-release|\.bpp-rollback)(/|$)') { return $false }
    if ($lower -match '^config/(?:auth|acme|certs|lpr|backups|dashboard-settings)(/|$)') { return $false }
    if ($lower.EndsWith('/secret.key') -or $lower.EndsWith('.once') -or $lower.EndsWith('/backup.db')) { return $false }
    return $true
}

function Copy-UpdateApplication {
    <#
    .SYNOPSIS
    Copies only release-owned regular files into an isolated update staging tree.
    .OUTPUTS
    A new application directory; reparse points are not followed.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Destination)

    $root = (Resolve-BppFullPath -Path $Source).TrimEnd('\', '/')
    $prefixLength = $root.Length + 1
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse -Force -Attributes !ReparsePoint) {
        $relative = $file.FullName.Substring($prefixLength)
        if (-not (Test-UpdateApplicationFile -RelativePath $relative)) { continue }
        $target = Join-Path $Destination $relative
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

$source = Resolve-BppFullPath -Path $SourceRoot
$output = Resolve-BppFullPath -Path $OutputDirectory
$policy = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'release-policy.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not (Test-VersionGreater -Candidate $Version -Current $policy.currentVersion)) { throw "Update version must be newer than $($policy.currentVersion)." }

if ($FixtureMode) {
    $branch = $FixtureGitBranch
    $status = $FixtureGitStatus
    $commit = $FixtureCommit
}
else {
    $branch = (@(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $source, 'branch', '--show-current')) -join '').Trim()
    $status = @(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $source, 'status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
    $commit = (@(Invoke-BppNative -FilePath 'git' -ArgumentList @('-C', $source, 'rev-parse', 'HEAD')) -join '').Trim()
}
if (-not $Development) {
    if ($branch -ne 'main') { throw 'Production update packaging requires the main branch.' }
    if (-not [string]::IsNullOrWhiteSpace($status)) { throw 'Production update packaging requires a clean worktree.' }
}
$manifestVersion = if ($Development) { $Version + '-dev.' + $commit.Substring(0, [Math]::Min(8, $commit.Length)) } else { $Version }
if (-not (Test-Path -LiteralPath $output)) { New-Item -ItemType Directory -Path $output -Force | Out-Null }
$archive = Join-Path $output ("BPP-VMS-Update-$manifestVersion.tar")
if (Test-Path -LiteralPath $archive) { throw "Update archive already exists: '$archive'." }
$identifier = [Guid]::NewGuid().ToString('N')
$staging = Join-Path $output ('.bpp-update-stage-' + $identifier)
$releaseRoot = Join-Path $staging 'bpp-release'
$partial = $archive + '.' + $identifier + '.partial'
try {
    $application = Join-Path $releaseRoot 'application'
    Copy-UpdateApplication -Source $source -Destination $application
    foreach ($model in @($policy.requiredModels)) {
        if (-not (Test-Path -LiteralPath (Join-Path $application $model) -PathType Leaf)) { throw "Update is missing model '$model'." }
    }
    $imageDirectory = Join-Path $releaseRoot 'images'
    New-Item -ItemType Directory -Path $imageDirectory -Force | Out-Null
    $imageTarget = Join-Path $imageDirectory 'docker-images.tar'
    $imageIds = @()
    if ($FixtureMode) {
        if ([string]::IsNullOrWhiteSpace($FixtureImageBundle)) { throw 'Fixture update requires an image bundle.' }
        Copy-Item -LiteralPath $FixtureImageBundle -Destination $imageTarget
        $imageIds = @('fixture-image')
    }
    else {
        $images = @(Invoke-BppCompose -Root $source -Arguments @('config', '--images') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        if ($images.Count -eq 0) { throw 'Compose resolved no images for update.' }
        foreach ($image in $images) { $imageIds += (@(Invoke-BppNative -FilePath 'docker' -ArgumentList @('image', 'inspect', '-f', '{{.Id}}', $image)) -join '').Trim() }
        Invoke-BppNative -FilePath 'docker' -ArgumentList (@('save', '-o', $imageTarget) + $images) | Out-Null
    }
    $files = @(Get-BppFileManifest -Root $releaseRoot)
    $releaseFiles = @($files | Where-Object { $_.path.StartsWith('application/') } | ForEach-Object { $_.path.Substring(12) })
    $manifest = [ordered]@{
        schema = 'bpp-release-manifest/v1'; releaseSchema = 1; releaseType = 'update'
        version = $manifestVersion; baseVersion = $Version; buildKind = $(if ($Development) { 'development' } else { 'production' })
        createdUtc = [DateTime]::UtcNow.ToString('o'); sourceCommit = $commit; stateSchema = [int]$policy.stateSchema
        migrations = @(); profiles = @(); requiredModels = @($policy.requiredModels); requiredState = @()
        excludedRuntimeRoots = @($policy.excludedRuntimeRoots); excludedVolumes = @($policy.excludedVolumes)
        imageIds = @($imageIds); releaseFiles = @($releaseFiles); files = @($files)
    }
    Write-BppManifest -Path (Join-Path $releaseRoot 'manifest.json') -Manifest $manifest
    Invoke-BppNative -FilePath 'tar.exe' -ArgumentList @('-cf', $partial, '-C', $staging, 'bpp-release') | Out-Null
    & (Join-Path $PSScriptRoot 'Test-BppRelease.ps1') -ArchivePath $partial -Full
    Move-BppAtomic -Source $partial -Destination $archive
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($archive + '.sha256', "$hash  $([IO.Path]::GetFileName($archive))`r`n", [Text.Encoding]::ASCII)
    Copy-BppReleaseCompanions -OutputDirectory $output
    Write-Host "Created self-contained update: $archive" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
