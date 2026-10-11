<#
.SYNOPSIS
Shared fail-closed primitives for BPP migration, installation, and update tools.

.DESCRIPTION
The module centralizes path ownership, native-process exit checking, silent .env
handling, cryptographic randomness, file manifests, TAR entry validation, and
guarded temporary cleanup. Functions never print secret values.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-BppFullPath {
    <#
    .SYNOPSIS
    Canonicalizes one caller-selected path without requiring it to exist.
    .OUTPUTS
    A fully qualified path string; the filesystem is not modified.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    return [IO.Path]::GetFullPath($Path)
}

function Assert-BppPathUnderRoot {
    <#
    .SYNOPSIS
    Proves that a candidate is a strict descendant of an explicitly owned root.
    .OUTPUTS
    The canonical candidate path, or an exception for the root itself/outside it.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $rootPath = (Resolve-BppFullPath -Path $Root).TrimEnd('\', '/')
    $candidate = Resolve-BppFullPath -Path $Path
    $prefix = $rootPath + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path '$candidate' is outside the owned root '$rootPath'."
    }
    return $candidate
}

function Invoke-BppNative {
    <#
    .SYNOPSIS
    Runs one native command and converts every non-zero result into an exception.
    .OUTPUTS
    Native stdout as an array of lines; stderr/exit failures are not suppressed.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = (Get-Location).Path
    )

    Push-Location $WorkingDirectory
    try {
        $output = @(& $FilePath @ArgumentList)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "Native command '$FilePath' failed with exit code $exitCode."
        }
        return $output
    }
    finally {
        Pop-Location
    }
}

function Read-BppEnv {
    <#
    .SYNOPSIS
    Parses a UTF-8 dotenv file without expanding, logging, or normalizing values.
    .OUTPUTS
    An ordered dictionary; blank/comment lines are ignored and no output is printed.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-BppFullPath -Path $Path
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Environment file does not exist: '$resolved'."
    }
    $values = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($resolved, [Text.Encoding]::UTF8)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { throw "Environment file contains a malformed assignment." }
        $key = $line.Substring(0, $separator).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Environment file contains an invalid key." }
        $values[$key] = $line.Substring($separator + 1)
    }
    return $values
}

function Write-BppEnv {
    <#
    .SYNOPSIS
    Atomically writes an ordered dotenv mapping as UTF-8 with Windows CRLF lines.
    .OUTPUTS
    No pipeline output; rejects newline injection and leaves the old file on failure.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values
    )

    $target = Resolve-BppFullPath -Path $Path
    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($key in $Values.Keys) {
        $name = [string]$key
        $value = [string]$Values[$key]
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $name.Contains("`r") -or $name.Contains("`n")) {
            throw "Environment key is invalid."
        }
        if ($value.Contains("`r") -or $value.Contains("`n")) {
            throw "Environment value for '$name' contains a newline."
        }
        $lines.Add("$name=$value")
    }
    $temporary = Join-Path $parent ('.bpp-env-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $payload = ($lines -join "`r`n") + "`r`n"
        [IO.File]::WriteAllText($temporary, $payload, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $target -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function New-BppSecret {
    <#
    .SYNOPSIS
    Generates a unique per-node secret from at least 32 cryptographically random bytes.
    .OUTPUTS
    Base64URL text without padding; the value is returned but never printed internally.
    #>
    [CmdletBinding()]
    param([ValidateRange(32, 256)][int]$ByteCount = 32)

    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-BppFileManifest {
    <#
    .SYNOPSIS
    Hashes every regular file beneath one payload root in stable path order.
    .OUTPUTS
    Objects with relative path, byte length, and lowercase SHA-256; no files change.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root)

    $rootPath = Resolve-BppFullPath -Path $Root
    if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) { throw "Manifest root does not exist." }
    $prefixLength = $rootPath.TrimEnd('\', '/').Length + 1
    return @(Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force | ForEach-Object {
        [PSCustomObject]@{
            path = $_.FullName.Substring($prefixLength).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } | Sort-Object path)
}

function Test-BppTarEntries {
    <#
    .SYNOPSIS
    Rejects TAR members that could escape extraction or address absolute host paths.
    .OUTPUTS
    No output on success; throws before extraction for drive, UNC, absolute, or traversal paths.
    #>
    [CmdletBinding(DefaultParameterSetName = 'Entries')]
    param(
        [Parameter(Mandatory = $true, ParameterSetName = 'Entries')][string[]]$Entries,
        [Parameter(Mandatory = $true, ParameterSetName = 'Archive')][string]$ArchivePath
    )

    if ($PSCmdlet.ParameterSetName -eq 'Archive') {
        $Entries = @(Invoke-BppNative -FilePath 'tar.exe' -ArgumentList @('-tf', (Resolve-BppFullPath -Path $ArchivePath)))
    }
    if (@($Entries).Count -eq 0) { throw "TAR has no entries." }
    foreach ($entry in $Entries) {
        $normalized = ([string]$entry).Replace('\', '/')
        if ($normalized -match '^(?:/|//|[A-Za-z]:)' -or $normalized -match '(^|/)\.\.(/|$)') {
            throw "TAR contains unsafe path entry '$entry'."
        }
    }
}

function Read-BppManifest {
    <#
    .SYNOPSIS
    Reads only the supported BPP release-manifest schema from UTF-8 JSON.
    .OUTPUTS
    A parsed manifest object; unknown/missing schemas fail before any mutation.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $manifest = [IO.File]::ReadAllText((Resolve-BppFullPath -Path $Path), [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($null -eq $manifest -or $manifest.schema -ne 'bpp-release-manifest/v1') {
        throw "Unsupported BPP release manifest schema."
    }
    return $manifest
}

function Write-BppManifest {
    <#
    .SYNOPSIS
    Atomically serializes a supported non-secret release manifest as UTF-8 JSON.
    .OUTPUTS
    No pipeline output; rejects the wrong schema and never invents manifest fields.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Manifest
    )

    if ($Manifest.schema -ne 'bpp-release-manifest/v1') { throw "Unsupported BPP release manifest schema." }
    $target = Resolve-BppFullPath -Path $Path
    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $temporary = Join-Path $parent ('.bpp-manifest-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $json = $Manifest | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($temporary, $json + "`r`n", (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $target -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Move-BppAtomic {
    <#
    .SYNOPSIS
    Promotes a completed file without silently replacing an existing release.
    .OUTPUTS
    No output; source and destination must share a parent for atomic filesystem rename semantics.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $sourcePath = Resolve-BppFullPath -Path $Source
    $destinationPath = Resolve-BppFullPath -Path $Destination
    if ((Split-Path -Parent $sourcePath) -ne (Split-Path -Parent $destinationPath)) { throw "Atomic promotion requires one parent directory." }
    if (Test-Path -LiteralPath $destinationPath) { throw "Refusing to overwrite existing release '$destinationPath'." }
    Move-Item -LiteralPath $sourcePath -Destination $destinationPath
}

function Invoke-BppCompose {
    <#
    .SYNOPSIS
    Runs Docker Compose v2 from one explicit installation root with checked exit status.
    .OUTPUTS
    Compose stdout lines; the selected root controls its project and .env scope.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    return Invoke-BppNative -FilePath 'docker' -ArgumentList (@('compose') + $Arguments) -WorkingDirectory (Resolve-BppFullPath -Path $Root)
}

function Remove-BppOwnedTemporaryDirectory {
    <#
    .SYNOPSIS
    Recursively removes only a tool-generated GUID directory under Windows TEMP.
    .OUTPUTS
    No output; any caller-selected or shape-mismatched path is refused unchanged.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $candidate = Resolve-BppFullPath -Path $Path
    $temporaryRoot = (Resolve-BppFullPath -Path ([IO.Path]::GetTempPath())).TrimEnd('\', '/')
    [void](Assert-BppPathUnderRoot -Root $temporaryRoot -Path $candidate)
    if ([IO.Path]::GetFileName($candidate) -notmatch '^bpp-release-[0-9a-f]{32}$') {
        throw "Refusing cleanup of a directory not owned by BPP release tooling."
    }
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force }
}

function Export-BppNamedVolume {
    <#
    .SYNOPSIS
    Archives one exact Docker named volume through a unique read-only helper.
    .OUTPUTS
    Writes volume.tar in a caller-owned destination; never starts Compose services.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$VolumeName,
        [Parameter(Mandatory = $true)][string]$Destination,
        [scriptblock]$CommandInvoker = {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            Invoke-BppNative -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory
        }
    )

    $destinationPath = Resolve-BppFullPath -Path $Destination
    if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) {
        New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
    }
    $archive = Join-Path $destinationPath 'volume.tar'
    if (Test-Path -LiteralPath $archive) { throw "Volume export already exists: '$archive'." }
    $helperName = 'bpp-release-volume-' + [Guid]::NewGuid().ToString('N')
    $arguments = @(
        'run', '--rm', '--name', $helperName,
        '-v', "${VolumeName}:/source:ro",
        '-v', "${destinationPath}:/backup",
        'alpine:3.20', 'tar', '-cf', '/backup/volume.tar', '-C', '/source', '.'
    )
    & $CommandInvoker 'docker' $arguments (Get-Location).Path | Out-Null
}

function Export-BppAuthSeed {
    <#
    .SYNOPSIS
    Copies only auth.db from an exact auth volume and excludes JWT/one-time files.
    .OUTPUTS
    Writes auth.db in the destination or throws when the required database is absent.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$VolumeName,
        [Parameter(Mandatory = $true)][string]$Destination,
        [scriptblock]$CommandInvoker = {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            Invoke-BppNative -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory
        }
    )

    $destinationPath = Resolve-BppFullPath -Path $Destination
    if (-not (Test-Path -LiteralPath $destinationPath)) { New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null }
    $helperName = 'bpp-release-auth-' + [Guid]::NewGuid().ToString('N')
    $arguments = @(
        'run', '--rm', '--name', $helperName,
        '-v', "${VolumeName}:/source:ro", '-v', "${destinationPath}:/backup",
        'alpine:3.20', 'sh', '-eu', '-c', 'test -f /source/auth.db; cp /source/auth.db /backup/auth.db'
    )
    & $CommandInvoker 'docker' $arguments (Get-Location).Path | Out-Null
}

function Export-BppRecoveryVolume {
    <#
    .SYNOPSIS
    Exports a recovery volume while excluding Git, JWT key, and one-time credentials.
    .OUTPUTS
    Writes recovery.tar; input volume remains mounted read-only throughout.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$VolumeName,
        [Parameter(Mandatory = $true)][string]$Destination,
        [scriptblock]$CommandInvoker = {
            param($FilePath, $ArgumentList, $WorkingDirectory)
            Invoke-BppNative -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory
        }
    )

    $destinationPath = Resolve-BppFullPath -Path $Destination
    if (-not (Test-Path -LiteralPath $destinationPath)) { New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null }
    $helperName = 'bpp-release-recovery-' + [Guid]::NewGuid().ToString('N')
    $arguments = @(
        'run', '--rm', '--name', $helperName,
        '-v', "${VolumeName}:/source:ro", '-v', "${destinationPath}:/backup",
        'alpine:3.20', 'tar', '--exclude=.git', '--exclude=secret.key', '--exclude=*.once',
        '-cf', '/backup/recovery.tar', '-C', '/source', '.'
    )
    & $CommandInvoker 'docker' $arguments (Get-Location).Path | Out-Null
}

function Get-BppActiveState {
    <#
    .SYNOPSIS
    Captures exactly which Compose services are running before source quiescence.
    .OUTPUTS
    A stable array of service names; it performs no start, stop, or restart action.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [scriptblock]$ComposeInvoker = {
            param($ComposeRoot, $ComposeArguments)
            Invoke-BppCompose -Root $ComposeRoot -Arguments $ComposeArguments
        }
    )

    $services = @(& $ComposeInvoker (Resolve-BppFullPath -Path $Root) @('ps', '--services', '--filter', 'status=running'))
    return @($services | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
}

function Copy-BppReleaseCompanions {
    <#
    .SYNOPSIS
    Copies reviewed one-click launchers, Thai guidance, and their runtime tools.
    .OUTPUTS
    Companion files beneath an explicit output directory; no source data is copied.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$OutputDirectory)

    $output = Resolve-BppFullPath -Path $OutputDirectory
    if (-not (Test-Path -LiteralPath $output)) { New-Item -ItemType Directory -Path $output -Force | Out-Null }
    $templateRoot = Join-Path $PSScriptRoot 'templates'
    foreach ($name in @('Install_BPP-VMS.bat', 'Update_BPP-VMS.bat', 'Verify_BPP-VMS.bat')) {
        Copy-Item -LiteralPath (Join-Path $templateRoot $name) -Destination (Join-Path $output $name) -Force
    }
    $guides = @(Get-ChildItem -LiteralPath $templateRoot -File -Filter '*-BPP-VMS.md')
    if ($guides.Count -ne 1) { throw 'Expected exactly one BPP Thai operator guide template.' }
    Copy-Item -LiteralPath $guides[0].FullName -Destination (Join-Path $output $guides[0].Name) -Force
    $tools = Join-Path $output 'tools'
    $toolTemplates = Join-Path $tools 'templates'
    New-Item -ItemType Directory -Path $toolTemplates -Force | Out-Null
    foreach ($name in @(
        'Install-BppRelease.ps1', 'Update-BppRelease.ps1', 'Test-BppRelease.ps1',
        'Start-BppNode.ps1', 'BppRelease.Common.psm1', 'release-policy.json',
        'configure_site.py', 'build_site_profiles.py'
    )) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $tools $name) -Force
    }
    Copy-Item -LiteralPath (Join-Path $templateRoot 'docker-compose.site.yml') -Destination (Join-Path $toolTemplates 'docker-compose.site.yml') -Force
}

Export-ModuleMember -Function @(
    'Resolve-BppFullPath',
    'Assert-BppPathUnderRoot',
    'Invoke-BppNative',
    'Read-BppEnv',
    'Write-BppEnv',
    'New-BppSecret',
    'Get-BppFileManifest',
    'Test-BppTarEntries',
    'Read-BppManifest',
    'Write-BppManifest',
    'Move-BppAtomic',
    'Invoke-BppCompose',
    'Remove-BppOwnedTemporaryDirectory',
    'Export-BppNamedVolume',
    'Export-BppAuthSeed',
    'Export-BppRecoveryVolume',
    'Get-BppActiveState',
    'Copy-BppReleaseCompanions'
)
