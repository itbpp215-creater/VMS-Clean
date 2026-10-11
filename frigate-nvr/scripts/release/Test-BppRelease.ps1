<#
.SYNOPSIS
Performs a non-mutating, full readback verification of one BPP release TAR.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$ExtractRoot,
    [switch]$Full,
    [switch]$ForceFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BppRelease.Common.psm1') -Force

function Test-ReleaseScope {
    <#
    .SYNOPSIS
    Rejects runtime media, old identity, database, cache, and Git paths after extraction.
    .OUTPUTS
    No output on success; throws with the first forbidden relative path.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ReleaseRoot)

    $mediaExtensions = @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mkv', '.avi', '.mov')
    $prefixLength = (Resolve-BppFullPath -Path $ReleaseRoot).TrimEnd('\', '/').Length + 1
    foreach ($file in Get-ChildItem -LiteralPath $ReleaseRoot -File -Recurse -Force) {
        $relative = $file.FullName.Substring($prefixLength).Replace('\', '/')
        $lower = $relative.ToLowerInvariant()
        $segments = @($lower -split '/')
        if (@($segments | Where-Object { $_ -in @('.git', '.worktrees', '.venv', 'venv', 'node_modules', '__pycache__', '.pytest_cache', 'cuda-cache') }).Count -gt 0) {
            throw "Release contains forbidden dependency/Git path '$relative'."
        }
        if ($lower -match '(^|/)(storage|lpr-data)(/|$)' -or $lower.EndsWith('/backup.db') -or $lower.EndsWith('/secret.key') -or $lower.EndsWith('.once')) {
            throw "Release contains forbidden runtime/identity path '$relative'."
        }
        if ($lower -match '^application/config/(?:acme|certs|auth|lpr|backups|dashboard-settings)(/|$)') {
            throw "Release application contains source-owned state '$relative'."
        }
        if ($lower.StartsWith('state/') -and $mediaExtensions -contains $file.Extension.ToLowerInvariant()) {
            throw "Release state contains captured media '$relative'."
        }
    }
}

$archive = Resolve-BppFullPath -Path $ArchivePath
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Release archive does not exist: '$archive'." }
$checksumPath = $archive + '.sha256'
if (Test-Path -LiteralPath $checksumPath -PathType Leaf) {
    $checksumLine = ([IO.File]::ReadAllText($checksumPath, [Text.Encoding]::ASCII) -split "`r?`n")[0]
    if ($checksumLine -notmatch '^([0-9A-Fa-f]{64})\s+\*?(.+)$') { throw 'Outer SHA-256 companion has an invalid format.' }
    $expectedOuterHash = $Matches[1].ToLowerInvariant()
    $namedArchive = $Matches[2].Trim()
    if ($namedArchive -ne [IO.Path]::GetFileName($archive)) { throw 'Outer SHA-256 companion names a different archive.' }
    $actualOuterHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualOuterHash -ne $expectedOuterHash) { throw 'Outer SHA-256 mismatch; the archive is incomplete or changed.' }
}
Test-BppTarEntries -ArchivePath $archive

$ownedExtract = [string]::IsNullOrWhiteSpace($ExtractRoot)
if ($ownedExtract) {
    $extract = Join-Path ([IO.Path]::GetTempPath()) ('bpp-release-' + [Guid]::NewGuid().ToString('N'))
}
else {
    $extract = Resolve-BppFullPath -Path $ExtractRoot
    if (Test-Path -LiteralPath $extract) { throw "Extract root already exists: '$extract'." }
}

try {
    New-Item -ItemType Directory -Path $extract | Out-Null
    Invoke-BppNative -FilePath 'tar.exe' -ArgumentList @('-xf', $archive, '-C', $extract) | Out-Null
    $releaseRoot = Join-Path $extract 'bpp-release'
    $manifestPath = Join-Path $releaseRoot 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Release is missing bpp-release/manifest.json.' }
    $manifest = Read-BppManifest -Path $manifestPath
    if ($manifest.releaseSchema -ne 1 -or $manifest.version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
        throw 'Release manifest version/schema is unsupported.'
    }

    $actualFiles = @(Get-BppFileManifest -Root $releaseRoot | Where-Object { $_.path -ne 'manifest.json' })
    $actualByPath = @{}
    foreach ($file in $actualFiles) { $actualByPath[$file.path] = $file }
    $expectedFiles = @($manifest.files)
    if ($actualFiles.Count -ne $expectedFiles.Count) { throw 'Release file inventory count does not match manifest.' }
    foreach ($expected in $expectedFiles) {
        if (-not $actualByPath.ContainsKey($expected.path)) { throw "Release is missing manifest file '$($expected.path)'." }
        $actual = $actualByPath[$expected.path]
        if ($actual.sha256 -ne $expected.sha256 -or [long]$actual.bytes -ne [long]$expected.bytes) {
            throw "Release hash/length mismatch for '$($expected.path)'."
        }
    }

    foreach ($model in @($manifest.requiredModels)) {
        if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot ('application/' + $model)) -PathType Leaf)) {
            throw "Release is missing required model '$model'."
        }
    }
    foreach ($statePath in @($manifest.requiredState)) {
        if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot ('state/' + $statePath)))) {
            throw "Release is missing required state '$statePath'."
        }
    }
    Test-ReleaseScope -ReleaseRoot $releaseRoot
    if ($ForceFailure) { throw 'Forced verifier failure for rollback testing.' }
    Write-Host "BPP release verification passed: $($manifest.version)" -ForegroundColor Green
}
finally {
    if ($ownedExtract -and (Test-Path -LiteralPath $extract)) {
        Remove-BppOwnedTemporaryDirectory -Path $extract
    }
}
