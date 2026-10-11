<#
.SYNOPSIS
Exports or imports a complete BPP-VMS machine migration archive without the GUI installer.
Version: v1.1 (Includes Mobile Responsive UI Fixes)

.DESCRIPTION
The Export mode pauses the Compose stack, copies the application tree and the two
stateful Docker volumes, optionally includes recordings and local Docker images,
then encrypts the resulting TAR archive.  Import verifies and decrypts that archive
into a new empty installation directory, restores volumes before any service starts,
reapplies the repository ACL policy, and validates the restarted Frigate service.

The migration passphrase is read only from the console as a SecureString.  It is
never accepted as a command-line argument, written to the manifest, or logged.
#>
[CmdletBinding()]
param(
    # Select the source-host export, target-host import, or local crypto self-test workflow.
    [Parameter(Mandatory = $true)]
    [ValidateSet("Export", "Import", "SelfTest")]
    [string]$Mode,

    # Store the encrypted archive outside the source root during export, or select it during import.
    [Parameter(Mandatory = $false)]
    [string]$ArchivePath,

    # Identify the existing source root for export or an empty destination root for import.
    [Parameter(Mandatory = $false)]
    [string]$InstallPath,

    # Include the potentially large Frigate recording directory when a full-history migration is required.
    [switch]$IncludeRecordings,

    # Include local Docker images so the target can restore without downloading or rebuilding images.
    [switch]$IncludeDockerImages,

    # Leave the old host stopped after a successful export for a controlled cutover window.
    [switch]$KeepSourceStopped
)

# Stop at the first failure so a partial migration is never reported as successful.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Keep the binary envelope stable so future versions can reject incompatible archives safely.
$script:MigrationMagic = [System.Text.Encoding]::ASCII.GetBytes("BPPMIG01")
$script:MigrationVersion = [byte]1
$script:HeaderLength = 61
$script:TagLength = 32
$script:KdfIterations = 250000

function Resolve-FullPath {
    <#
    .SYNOPSIS
    Resolves a user-provided path without requiring that the final target exists.
    .OUTPUTS
    A canonical absolute path string.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    # .NET canonicalization avoids ambiguous relative-path and drive-relative targets.
    return [System.IO.Path]::GetFullPath($Path)
}

function Test-Administrator {
    <#
    .SYNOPSIS
    Stops an import before it restores secrets without the rights needed to reapply ACLs.
    .OUTPUTS
    Throws when the current Windows token is not elevated.
    #>
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)

    # The hardened secret directories must not be recreated with broad inherited permissions.
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run Import from an elevated Windows PowerShell session (Run as administrator)."
    }
}

function Test-ApplicationRoot {
    <#
    .SYNOPSIS
    Confirms that a path is a BPP-VMS Compose root before files or volumes are touched.
    .OUTPUTS
    Returns the canonical root path, or throws for a non-BPP directory.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $root = Resolve-FullPath -Path $Path
    $requiredFiles = @("docker-compose.yml", ".env", "scripts\\harden-windows-acl.ps1")

    # Require the Compose definition, machine-local secrets, and ACL policy as a single coherent installation.
    foreach ($relativeFile in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $relativeFile) -PathType Leaf)) {
            throw "'$root' is not a complete BPP-VMS installation; missing '$relativeFile'."
        }
    }

    return $root
}

function Test-EmptyDestinationRoot {
    <#
    .SYNOPSIS
    Prevents an import from overwriting a running or unrelated installation.
    .OUTPUTS
    Returns the canonical destination path when it is absent or empty.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $destination = Resolve-FullPath -Path $Path

    # A non-empty target could contain active containers, secrets, or another application's files.
    if (Test-Path -LiteralPath $destination) {
        $children = @(Get-ChildItem -LiteralPath $destination -Force)
        if ($children.Count -gt 0) {
            throw "Import destination '$destination' already exists and is not empty. Choose a new empty directory."
        }
    }

    return $destination
}

function Test-ArchiveOutsideSourceRoot {
    <#
    .SYNOPSIS
    Rejects an export destination inside the source tree to avoid recursively archiving the archive itself.
    .OUTPUTS
    Throws when the archive path is beneath the source root.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,
        [Parameter(Mandatory = $true)]
        [string]$Archive
    )

    $sourcePrefix = (Resolve-FullPath -Path $SourceRoot).TrimEnd('\\') + '\\'
    $archiveFullPath = Resolve-FullPath -Path $Archive

    # Case-insensitive comparison matches Windows filesystem semantics.
    if ($archiveFullPath.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Store the migration archive outside the source installation directory."
    }
}

function Test-DockerReady {
    <#
    .SYNOPSIS
    Verifies that Docker Desktop and Docker Compose can service the migration.
    .OUTPUTS
    Throws before modifying services when the Docker daemon is unavailable.
    #>
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker Desktop is not installed or docker.exe is not on PATH."
    }

    # docker info fails when Docker Desktop is installed but its Linux engine has not started.
    & docker info | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop is installed but its engine is not ready. Start Docker Desktop and retry."
    }

    # Compose v2 is required because the project is defined as a Compose stack.
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is unavailable. Install or update Docker Desktop and retry."
    }
}

function Invoke-Compose {
    <#
    .SYNOPSIS
    Runs a Compose command from one explicit installation root and fails on a non-zero exit code.
    .OUTPUTS
    Streams Docker output and throws on failure.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Push-Location $Root
    try {
        # Running from the selected root ensures its .env chooses the correct named-volume namespace.
        & docker compose @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Get-RunningComposeServices {
    <#
    .SYNOPSIS
    Captures exactly which source services were running before export pauses the stack.
    .OUTPUTS
    Returns zero or more Compose service names without changing their state.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    Push-Location $Root
    try {
        # Restoring only these services preserves an intentionally stopped source host after the snapshot completes.
        $services = @(& docker compose ps --services --filter "status=running" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($LASTEXITCODE -ne 0) { throw "Could not inspect running Compose services before export." }
        return ,$services
    }
    finally {
        Pop-Location
    }
}

function Test-NvidiaReady {
    <#
    .SYNOPSIS
    Verifies that the target Windows host exposes an NVIDIA GPU before restore creates GPU-dependent services.
    .OUTPUTS
    Throws when the approved NVIDIA driver is absent or unusable.
    #>
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        throw "nvidia-smi is unavailable. Install the approved NVIDIA driver on the target host before Import."
    }

    # A successful driver query is the host-side prerequisite before Docker can make GPU devices available to Frigate.
    & nvidia-smi -L | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "NVIDIA driver is installed but the target GPU is not ready." }
}

function Get-ComposeServiceContainerId {
    <#
    .SYNOPSIS
    Locates the Compose-created container that owns a named volume for a service.
    .OUTPUTS
    Returns one Docker container ID or throws if the service has not been created.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$Service
    )

    Push-Location $Root
    try {
        # -a includes intentionally stopped containers after the consistent export pause or import create step.
        $containerIds = @(& docker compose ps -aq $Service | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1) {
            throw "Expected exactly one Compose container for service '$Service'."
        }
        return $containerIds[0].Trim()
    }
    finally {
        Pop-Location
    }
}

function Copy-ApplicationTree {
    <#
    .SYNOPSIS
    Copies the source-controlled and machine-local application tree while omitting disposable dependencies.
    .OUTPUTS
    Writes a complete application directory to the supplied destination.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,
        [Parameter(Mandatory = $true)]
        [string]$Destination,
        [switch]$IncludeRecordings
    )

    $excludedDirectories = @(".git", "node_modules", "__pycache__", ".pytest_cache")
    if (-not $IncludeRecordings) {
        # Recordings are optional because they can be many times larger than the actual application state.
        $excludedDirectories += "storage"
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $robocopyArguments = @($SourceRoot, $Destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:1", "/XD") + $excludedDirectories

    # Robocopy preserves hidden machine-local files such as .env without copying source ACLs into the new host.
    & robocopy @robocopyArguments | Out-Host
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed while collecting the application tree (exit code $LASTEXITCODE)."
    }
}

function Export-VolumeFromService {
    <#
    .SYNOPSIS
    Copies one named Docker volume through its owning stopped service container.
    .OUTPUTS
    Writes the volume contents to a host directory without needing Docker Desktop's internal volume path.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$Service,
        [Parameter(Mandatory = $true)]
        [string]$ContainerPath,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $containerId = Get-ComposeServiceContainerId -Root $Root -Service $Service
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    # docker cp works against stopped containers, so SQLite files are copied only after Compose has quiesced writers.
    & docker cp "$containerId`:$ContainerPath/." $Destination
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to export '$ContainerPath' from service '$Service'."
    }
}

function Import-VolumeIntoService {
    <#
    .SYNOPSIS
    Restores one previously exported named Docker volume into its newly created stopped service container.
    .OUTPUTS
    Throws if Docker cannot place the preserved volume files.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$Service,
        [Parameter(Mandatory = $true)]
        [string]$ContainerPath,
        [Parameter(Mandatory = $true)]
        [string]$Source
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        throw "Migration archive is missing the '$Service' volume backup."
    }

    $containerId = Get-ComposeServiceContainerId -Root $Root -Service $Service

    # The destination container has never started, so this restores the database before any service can initialize it.
    & docker cp "$Source\\." "$containerId`:$ContainerPath"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to restore '$ContainerPath' into service '$Service'."
    }
}

function Get-MigrationPassword {
    <#
    .SYNOPSIS
    Returns the migration passphrase as a SecureString for archive encryption or decryption.
    .DESCRIPTION
    Prompts locally with hidden input and confirms the export value. The result
    is never accepted from a process argument and is retained only for key derivation.
    #>
    param([switch]$Confirm)

    # Keep interactive prompt text ASCII because Windows PowerShell 5.1 treats a
    # no-BOM script as ANSI. Read-Host hides input and returns SecureString directly.
    $password = Read-Host "Migration password" -AsSecureString
    $plainText = ConvertFrom-SecureStringForCrypto -Value $password
    try {
        if ($plainText.Length -lt 16) {
            throw "Migration password must contain at least 16 characters."
        }
        if ($Confirm) {
            $confirmation = Read-Host "Confirm migration password" -AsSecureString
            $confirmationText = ConvertFrom-SecureStringForCrypto -Value $confirmation
            try {
                if (-not [string]::Equals($plainText, $confirmationText, [StringComparison]::Ordinal)) {
                    throw "Migration password confirmation does not match."
                }
            }
            finally {
                $confirmationText = $null
            }
        }
        return $password
    }
    finally {
        $plainText = $null
    }
}

function ConvertFrom-SecureStringForCrypto {
    <#
    .SYNOPSIS
    Converts a SecureString only at the key-derivation boundary.
    .OUTPUTS
    Returns a short-lived plaintext string; callers must clear it immediately after use.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$Value
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        # The BSTR is unmanaged and can be explicitly zeroed after the unavoidable conversion.
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-DerivedKeyMaterial {
    <#
    .SYNOPSIS
    Derives independent AES and HMAC keys from the console-entered migration passphrase.
    .OUTPUTS
    Returns 64 bytes from PBKDF2; the first half is AES-256 and the second half is HMAC-SHA-256.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$Password,
        [Parameter(Mandatory = $true)]
        [byte[]]$Salt,
        [Parameter(Mandatory = $true)]
        [int]$Iterations
    )

    $plainText = ConvertFrom-SecureStringForCrypto -Value $Password
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($plainText)
    $plainText = $null
    try {
        # PBKDF2 is available in Windows PowerShell 5.1 and avoids a dependency on a separate crypto executable.
        # ::new keeps PowerShell from expanding the password byte array into one constructor argument per byte.
        $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new([byte[]]$passwordBytes, [byte[]]$Salt, [int]$Iterations)
        try {
            return $deriver.GetBytes(64)
        }
        finally {
            $deriver.Dispose()
        }
    }
    finally {
        # Zero the byte representation once .NET has derived the actual encryption and authentication keys.
        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }
}

function New-RandomBytes {
    <#
    .SYNOPSIS
    Produces cryptographically random bytes for salts and initialization vectors.
    .OUTPUTS
    Returns a byte array of the requested length.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$Length
    )

    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        # OS-backed randomness prevents predictable archive encryption parameters.
        $rng.GetBytes($bytes)
        return $bytes
    }
    finally {
        $rng.Dispose()
    }
}

function Get-EncryptionHeader {
    <#
    .SYNOPSIS
    Creates the authenticated binary header for a versioned BPP machine archive.
    .OUTPUTS
    Returns an object containing the serialized header, salt, and IV.
    #>
    $salt = New-RandomBytes -Length 32
    $iv = New-RandomBytes -Length 16
    $header = New-Object byte[] $script:HeaderLength

    # Header layout is magic(8), version(1), PBKDF2 iteration count(4), salt(32), IV(16).
    [Array]::Copy($script:MigrationMagic, 0, $header, 0, $script:MigrationMagic.Length)
    $header[8] = $script:MigrationVersion
    [Array]::Copy([BitConverter]::GetBytes($script:KdfIterations), 0, $header, 9, 4)
    [Array]::Copy($salt, 0, $header, 13, $salt.Length)
    [Array]::Copy($iv, 0, $header, 45, $iv.Length)

    return [PSCustomObject]@{ Header = $header; Salt = $salt; Iv = $iv }
}

function Protect-MigrationTar {
    <#
    .SYNOPSIS
    Encrypts a TAR file with AES-256-CBC and authenticates header and ciphertext with HMAC-SHA-256.
    .OUTPUTS
    Writes one .bppmig archive and never writes the passphrase to disk.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$TarPath,
        [Parameter(Mandatory = $true)]
        [string]$Archive,
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$Password
    )

    $headerInfo = Get-EncryptionHeader
    $keyMaterial = Get-DerivedKeyMaterial -Password $Password -Salt $headerInfo.Salt -Iterations $script:KdfIterations
    $encryptionKey = New-Object byte[] 32
    $authenticationKey = New-Object byte[] 32
    [Array]::Copy($keyMaterial, 0, $encryptionKey, 0, 32)
    [Array]::Copy($keyMaterial, 32, $authenticationKey, 0, 32)
    [Array]::Clear($keyMaterial, 0, $keyMaterial.Length)

    $cipherPath = "$Archive.cipher-$([Guid]::NewGuid().ToString('N'))"
    $partialPath = "$Archive.partial-$([Guid]::NewGuid().ToString('N'))"
    try {
        $aes = New-Object Security.Cryptography.AesManaged
        $aes.KeySize = 256
        $aes.Mode = [Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
        $aes.Key = $encryptionKey
        $aes.IV = $headerInfo.Iv

        $tarStream = [IO.File]::OpenRead($TarPath)
        $cipherStream = [IO.File]::Open($cipherPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $cryptoStream = New-Object Security.Cryptography.CryptoStream($cipherStream, $aes.CreateEncryptor(), [Security.Cryptography.CryptoStreamMode]::Write)
        try {
            # Encrypt first into a temporary ciphertext file so HMAC can stream the complete payload without buffering it in memory.
            $tarStream.CopyTo($cryptoStream)
            $cryptoStream.FlushFinalBlock()
        }
        finally {
            $cryptoStream.Dispose()
            $tarStream.Dispose()
            $cipherStream.Dispose()
            $aes.Dispose()
        }

        $output = [IO.File]::Open($partialPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        # ::new keeps PowerShell from expanding the HMAC key byte array into one constructor argument per byte.
        $hmac = [Security.Cryptography.HMACSHA256]::new([byte[]]$authenticationKey)
        $cipherInput = [IO.File]::OpenRead($cipherPath)
        try {
            # HMAC covers metadata as well as ciphertext so a tampered iteration count, salt, or IV is rejected before extraction.
            $output.Write($headerInfo.Header, 0, $headerInfo.Header.Length)
            [void]$hmac.TransformBlock($headerInfo.Header, 0, $headerInfo.Header.Length, $headerInfo.Header, 0)
            $buffer = New-Object byte[] 1048576
            while (($read = $cipherInput.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                [void]$hmac.TransformBlock($buffer, 0, $read, $buffer, 0)
            }
            [void]$hmac.TransformFinalBlock((New-Object byte[] 0), 0, 0)
            $output.Write($hmac.Hash, 0, $hmac.Hash.Length)
        }
        finally {
            $cipherInput.Dispose()
            $hmac.Dispose()
            $output.Dispose()
        }

        # A single rename exposes only a fully written, authenticated migration archive to the operator.
        Move-Item -LiteralPath $partialPath -Destination $Archive -ErrorAction Stop
    }
    finally {
        # Temporary ciphertext is safe but disposable; key arrays are cleared before the PowerShell scope unwinds.
        # Cleanup must not hide the archive-generation exception when Windows briefly retains a closed file handle.
        if (Test-Path -LiteralPath $cipherPath) { Remove-Item -LiteralPath $cipherPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $partialPath) { Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue }
        [Array]::Clear($encryptionKey, 0, $encryptionKey.Length)
        [Array]::Clear($authenticationKey, 0, $authenticationKey.Length)
    }
}

function Read-ExactBytes {
    <#
    .SYNOPSIS
    Reads an exact count from a stream or rejects a truncated archive.
    .OUTPUTS
    Returns a byte array of the requested length.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [IO.Stream]$Stream,
        [Parameter(Mandatory = $true)]
        [int]$Length
    )

    $bytes = New-Object byte[] $Length
    $offset = 0
    while ($offset -lt $Length) {
        # Streams are permitted to return short reads, so loop until the requested binary structure is complete.
        $read = $Stream.Read($bytes, $offset, $Length - $offset)
        if ($read -le 0) { throw "Migration archive is truncated." }
        $offset += $read
    }
    return $bytes
}

function Test-BytesEqual {
    <#
    .SYNOPSIS
    Compares authentication tags without returning early on the first unequal byte.
    .OUTPUTS
    Returns true only when both byte arrays are identical.
    #>
    param(
        [byte[]]$First,
        [byte[]]$Second
    )

    if ($First.Length -ne $Second.Length) { return $false }
    $difference = 0
    for ($index = 0; $index -lt $First.Length; $index++) {
        # Accumulate all differences to avoid revealing where a tag differs through early return timing.
        $difference = $difference -bor ($First[$index] -bxor $Second[$index])
    }
    return $difference -eq 0
}

function Unprotect-MigrationTar {
    <#
    .SYNOPSIS
    Verifies an encrypted migration archive before decrypting its TAR payload.
    .OUTPUTS
    Writes the verified TAR file and returns its manifest header information.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Archive,
        [Parameter(Mandatory = $true)]
        [string]$TarPath,
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$Password
    )

    $archiveStream = [IO.File]::OpenRead($Archive)
    $cipherPath = "$TarPath.cipher-$([Guid]::NewGuid().ToString('N'))"
    $encryptionKey = $null
    $authenticationKey = $null
    try {
        $header = Read-ExactBytes -Stream $archiveStream -Length $script:HeaderLength
        $magic = New-Object byte[] $script:MigrationMagic.Length
        [Array]::Copy($header, 0, $magic, 0, $magic.Length)
        if (-not (Test-BytesEqual -First $magic -Second $script:MigrationMagic) -or $header[8] -ne $script:MigrationVersion) {
            throw "This file is not a supported BPP-VMS migration archive."
        }

        $iterations = [BitConverter]::ToInt32($header, 9)
        if ($iterations -lt 100000 -or $iterations -gt 1000000) {
            throw "Migration archive has an invalid key-derivation iteration count."
        }
        $salt = New-Object byte[] 32
        $iv = New-Object byte[] 16
        [Array]::Copy($header, 13, $salt, 0, $salt.Length)
        [Array]::Copy($header, 45, $iv, 0, $iv.Length)
        $cipherLength = $archiveStream.Length - $script:HeaderLength - $script:TagLength
        if ($cipherLength -le 0) { throw "Migration archive does not contain ciphertext." }

        $keyMaterial = Get-DerivedKeyMaterial -Password $Password -Salt $salt -Iterations $iterations
        $encryptionKey = New-Object byte[] 32
        $authenticationKey = New-Object byte[] 32
        [Array]::Copy($keyMaterial, 0, $encryptionKey, 0, 32)
        [Array]::Copy($keyMaterial, 32, $authenticationKey, 0, 32)
        [Array]::Clear($keyMaterial, 0, $keyMaterial.Length)

        # ::new keeps PowerShell from expanding the HMAC key byte array into one constructor argument per byte.
        $hmac = [Security.Cryptography.HMACSHA256]::new([byte[]]$authenticationKey)
        $cipherStream = [IO.File]::Open($cipherPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            # Copy exactly the ciphertext into a temporary file while calculating the authenticated envelope digest.
            [void]$hmac.TransformBlock($header, 0, $header.Length, $header, 0)
            $remaining = $cipherLength
            $buffer = New-Object byte[] 1048576
            while ($remaining -gt 0) {
                $requested = [Math]::Min([long]$buffer.Length, [long]$remaining)
                $read = $archiveStream.Read($buffer, 0, $requested)
                if ($read -le 0) { throw "Migration archive is truncated inside its ciphertext." }
                $cipherStream.Write($buffer, 0, $read)
                [void]$hmac.TransformBlock($buffer, 0, $read, $buffer, 0)
                $remaining -= $read
            }
            [void]$hmac.TransformFinalBlock((New-Object byte[] 0), 0, 0)
            $providedTag = Read-ExactBytes -Stream $archiveStream -Length $script:TagLength
            if (-not (Test-BytesEqual -First $hmac.Hash -Second $providedTag)) {
                throw "Migration archive authentication failed. Check the password and archive integrity."
            }
        }
        finally {
            $cipherStream.Dispose()
            $hmac.Dispose()
        }

        $aes = New-Object Security.Cryptography.AesManaged
        $aes.KeySize = 256
        $aes.Mode = [Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
        $aes.Key = $encryptionKey
        $aes.IV = $iv
        $cipherInput = [IO.File]::OpenRead($cipherPath)
        $tarOutput = [IO.File]::Open($TarPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $cryptoStream = New-Object Security.Cryptography.CryptoStream($cipherInput, $aes.CreateDecryptor(), [Security.Cryptography.CryptoStreamMode]::Read)
        try {
            # Only a verified archive reaches this point, so decryption cannot write attacker-controlled plaintext before tag verification.
            $cryptoStream.CopyTo($tarOutput)
        }
        finally {
            $cryptoStream.Dispose()
            $tarOutput.Dispose()
            $cipherInput.Dispose()
            $aes.Dispose()
        }
    }
    finally {
        $archiveStream.Dispose()
        if (Test-Path -LiteralPath $cipherPath) { Remove-Item -LiteralPath $cipherPath -Force }
        if ($null -ne $encryptionKey) { [Array]::Clear($encryptionKey, 0, $encryptionKey.Length) }
        if ($null -ne $authenticationKey) { [Array]::Clear($authenticationKey, 0, $authenticationKey.Length) }
    }
}

function Test-TarEntriesSafe {
    <#
    .SYNOPSIS
    Rejects absolute or parent-directory TAR members before extraction into the destination staging directory.
    .OUTPUTS
    Throws when an archive entry could escape its staging directory.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$TarPath
    )

    $entries = @(& tar.exe -tf $TarPath)
    if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) { throw "Migration TAR cannot be listed or is empty." }
    foreach ($entry in $entries) {
        # Block Windows drive paths, Unix absolute paths, and traversal segments regardless of separator style.
        if ($entry -match '^(?:[A-Za-z]:|[\\/])' -or $entry -match '(^|[\\/])\.\.([\\/]|$)') {
            throw "Migration TAR contains an unsafe path entry."
        }
    }
}

function Remove-MigrationTemporaryDirectory {
    <#
    .SYNOPSIS
    Deletes only a GUID-named staging directory created under the current user's system temp directory.
    .OUTPUTS
    Removes the known temporary migration workspace when it exists.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\') + '\\'
    $fullPath = Resolve-FullPath -Path $Path
    $name = [IO.Path]::GetFileName($fullPath)

    # Constrain cleanup to a path shape the script itself created; never recursively remove a caller-supplied directory.
    if ($fullPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and $name -match '^bpp-machine-migration-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function New-MigrationManifest {
    <#
    .SYNOPSIS
    Records non-secret migration scope metadata used to validate imports and explain archive contents.
    .OUTPUTS
    Writes manifest.json into the staging payload.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$StagingRoot,
        [Parameter(Mandatory = $true)]
        [bool]$HasRecordings,
        [Parameter(Mandatory = $true)]
        [bool]$HasDockerImages
    )

    $manifest = [PSCustomObject]@{
        schemaVersion = 1
        createdUtc = [DateTime]::UtcNow.ToString("o")
        includesRecordings = $HasRecordings
        includesDockerImages = $HasDockerImages
        requiredVolumes = @("auth-db", "frigate-db")
    }

    # The manifest intentionally contains scope only; secrets remain solely in the encrypted payload tree.
    $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $StagingRoot "manifest.json") -Encoding UTF8
}

function Test-MigrationManifest {
    <#
    .SYNOPSIS
    Validates the non-secret payload manifest before application files or volumes are restored.
    .OUTPUTS
    Returns the parsed manifest object when the archive schema is supported.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$PayloadRoot
    )

    $manifestPath = Join-Path $PayloadRoot "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Migration archive is missing manifest.json." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

    # A strict schema check prevents a similarly named archive from being treated as a complete machine backup.
    if ($manifest.schemaVersion -ne 1 -or $null -eq $manifest.requiredVolumes -or $manifest.requiredVolumes.Count -ne 2) {
        throw "Migration archive has an unsupported manifest schema."
    }
    return $manifest
}

function Wait-ForFrigateHealth {
    <#
    .SYNOPSIS
    Waits for the restored Frigate container to become healthy before config validation.
    .OUTPUTS
    Throws after the timeout or immediately when the container reaches an unhealthy state.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [int]$TimeoutSeconds = 180
    )

    $containerId = Get-ComposeServiceContainerId -Root $Root -Service "frigate"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $status = (& docker inspect -f '{{.State.Health.Status}}' $containerId).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Unable to inspect restored Frigate health." }
        if ($status -eq "healthy") { return }
        if ($status -eq "unhealthy") { throw "Restored Frigate reported unhealthy. Run docker compose logs frigate before retrying." }
        # Startup legitimately takes time while Docker initializes GPU access and Frigate opens its state database.
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for restored Frigate to become healthy."
}

function Invoke-MigrationExport {
    <#
    .SYNOPSIS
    Creates an encrypted, portable snapshot from a stopped-consistently BPP-VMS installation.
    .OUTPUTS
    Writes the requested .bppmig archive and restarts the source unless KeepSourceStopped is selected.
    #>
    param(
        [string]$SourceRoot,
        [string]$Archive,
        [switch]$IncludeRecordings,
        [switch]$IncludeDockerImages,
        [switch]$KeepSourceStopped
    )

    $sourceRoot = Test-ApplicationRoot -Path $SourceRoot
    $archive = Resolve-FullPath -Path $Archive
    Test-ArchiveOutsideSourceRoot -SourceRoot $sourceRoot -Archive $archive
    if (Test-Path -LiteralPath $archive) { throw "Migration archive already exists: '$archive'." }
    Test-DockerReady
    $password = Get-MigrationPassword -Confirm
    $stagingRoot = Join-Path ([IO.Path]::GetTempPath()) "bpp-machine-migration-$([Guid]::NewGuid().ToString('N'))"
    $sourceRestartServices = @()

    try {
        New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
        # Capture source state before stopping writers so export never changes an intentionally stopped deployment's state.
        Write-Host "`n==> [1/5] Checking source state & pausing services..." -ForegroundColor Cyan
        $sourceRestartServices = @(Get-RunningComposeServices -Root $sourceRoot)
        # Stop writers before copying named SQLite volumes and bind-mounted runtime databases.
        Invoke-Compose -Root $sourceRoot -Arguments @("stop")

        Write-Host "==> [2/5] Backing up application files & databases..." -ForegroundColor Cyan
        Copy-ApplicationTree -SourceRoot $sourceRoot -Destination (Join-Path $stagingRoot "application") -IncludeRecordings:$IncludeRecordings
        Export-VolumeFromService -Root $sourceRoot -Service "auth-service" -ContainerPath "/data" -Destination (Join-Path $stagingRoot "volumes\\auth-db")
        Export-VolumeFromService -Root $sourceRoot -Service "frigate" -ContainerPath "/db" -Destination (Join-Path $stagingRoot "volumes\\frigate-db")
        Export-VolumeFromService -Root $sourceRoot -Service "nas-bot" -ContainerPath "/data/nas-storage" -Destination (Join-Path $stagingRoot "volumes\\nas-storage")

        if ($IncludeDockerImages) {
            Write-Host "==> [3/5] Exporting Docker images (this takes 2-4 minutes, please wait)..." -ForegroundColor Cyan
            Push-Location $sourceRoot
            try {
                # Saving resolved Compose images preserves the exact locally built image tags for an offline target restore.
                $images = @(& docker compose config --images | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
                if ($LASTEXITCODE -ne 0 -or $images.Count -eq 0) { throw "Could not resolve Compose images for offline migration." }
                & docker save -o (Join-Path $stagingRoot "docker-images.tar") @images
                if ($LASTEXITCODE -ne 0) { throw "docker save failed while exporting offline images." }
            }
            finally {
                Pop-Location
            }
        } else {
            Write-Host "==> [3/5] Skipping Docker images export (-IncludeDockerImages not specified)..." -ForegroundColor Yellow
        }

        Write-Host "==> [4/5] Compressing and encrypting backup archive..." -ForegroundColor Cyan
        New-MigrationManifest -StagingRoot $stagingRoot -HasRecordings:$IncludeRecordings -HasDockerImages:$IncludeDockerImages
        $tarPath = Join-Path $stagingRoot "payload.tar"
        # TAR supports large recording sets without ZIP's historical size constraints.
        & tar.exe -cf $tarPath -C $stagingRoot "application" "volumes" "manifest.json" $(if ($IncludeDockerImages) { "docker-images.tar" })
        if ($LASTEXITCODE -ne 0) { throw "tar failed while assembling the migration payload." }
        Protect-MigrationTar -TarPath $tarPath -Archive $archive -Password $password
    }
    finally {
        # Restart only services that were active beforehand, unless the operator requested a deliberate cutover stop.
        if (-not $KeepSourceStopped -and @($sourceRestartServices).Count -gt 0) {
            Write-Host "==> [5/5] Restarting services on current machine..." -ForegroundColor Cyan
            try { Invoke-Compose -Root $sourceRoot -Arguments (@("start") + $sourceRestartServices) } catch { Write-Warning "Source stack remains stopped: $($_.Exception.Message)" }
        }
        Remove-MigrationTemporaryDirectory -Path $stagingRoot
    }
    Write-Host "`n=======================================================" -ForegroundColor Green
    Write-Host " SUCCESS! Backup completed successfully!" -ForegroundColor Green
    Write-Host " File saved at: $archive" -ForegroundColor Green
    Write-Host " Upload this file to Google Drive for the new machine." -ForegroundColor Green
    Write-Host "=======================================================\n" -ForegroundColor Green
}

function Invoke-MigrationImport {
    <#
    .SYNOPSIS
    Restores a complete encrypted snapshot to a fresh BPP-VMS installation directory without the GUI installer.
    .OUTPUTS
    Starts the restored Compose stack, validates Frigate config, and reports the retained state scope.
    #>
    param(
        [string]$Archive,
        [string]$DestinationRoot
    )

    Test-Administrator
    $archive = Resolve-FullPath -Path $Archive
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw "Migration archive does not exist: '$archive'." }
    $destinationRoot = Test-EmptyDestinationRoot -Path $DestinationRoot
    Test-DockerReady
    Test-NvidiaReady
    $password = Get-MigrationPassword
    $stagingRoot = Join-Path ([IO.Path]::GetTempPath()) "bpp-machine-migration-$([Guid]::NewGuid().ToString('N'))"

    try {
        New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
        $tarPath = Join-Path $stagingRoot "payload.tar"
        Unprotect-MigrationTar -Archive $archive -TarPath $tarPath -Password $password
        Test-TarEntriesSafe -TarPath $tarPath
        $payloadRoot = Join-Path $stagingRoot "payload"
        New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
        & tar.exe -xf $tarPath -C $payloadRoot
        if ($LASTEXITCODE -ne 0) { throw "tar failed while extracting the verified migration payload." }
        $manifest = Test-MigrationManifest -PayloadRoot $payloadRoot

        $applicationSource = Join-Path $payloadRoot "application"
        if (-not (Test-Path -LiteralPath (Join-Path $applicationSource "docker-compose.yml") -PathType Leaf)) {
            throw "Migration payload does not contain an application Compose root."
        }
        Copy-ApplicationTree -SourceRoot $applicationSource -Destination $destinationRoot -IncludeRecordings:$manifest.includesRecordings

        $imageBundle = Join-Path $payloadRoot "docker-images.tar"
        if ($manifest.includesDockerImages) {
            if (-not (Test-Path -LiteralPath $imageBundle -PathType Leaf)) { throw "Migration manifest requires an image bundle, but it is missing." }
            # Load before Compose creates containers so an offline target does not attempt a registry pull.
            & docker load -i $imageBundle
            if ($LASTEXITCODE -ne 0) { throw "docker load failed while importing the offline image bundle." }
        }
        else {
            # A source-only archive deliberately builds all local images on the target and therefore needs normal registry access.
            Invoke-Compose -Root $destinationRoot -Arguments @("build")
        }

        Invoke-Compose -Root $destinationRoot -Arguments @("config", "--quiet")
        Invoke-Compose -Root $destinationRoot -Arguments @("create")
        Import-VolumeIntoService -Root $destinationRoot -Service "auth-service" -ContainerPath "/data" -Source (Join-Path $payloadRoot "volumes\\auth-db")
        Import-VolumeIntoService -Root $destinationRoot -Service "frigate" -ContainerPath "/db" -Source (Join-Path $payloadRoot "volumes\\frigate-db")
        if (Test-Path (Join-Path $payloadRoot "volumes\\nas-storage")) {
            Import-VolumeIntoService -Root $destinationRoot -Service "nas-bot" -ContainerPath "/data/nas-storage" -Source (Join-Path $payloadRoot "volumes\\nas-storage")
        }

        # Reapply approved host ACLs because source ACL identities are not portable across Windows machines.
        & (Join-Path $destinationRoot "scripts\\harden-windows-acl.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Restored application ACL hardening failed." }
        Invoke-Compose -Root $destinationRoot -Arguments @("up", "-d", "--no-build")
        Wait-ForFrigateHealth -Root $destinationRoot

        $frigateContainerId = Get-ComposeServiceContainerId -Root $destinationRoot -Service "frigate"
        # Validate the restored config with the same runtime parser only after the preserved state and models are available.
        & docker exec $frigateContainerId python3 -m frigate --validate-config
        if ($LASTEXITCODE -ne 0) { throw "Restored Frigate configuration validation failed." }
        Write-Host "Migration import completed. Existing web users keep their passwords; update the host/WebRTC IP for the new machine." -ForegroundColor Green
    }
    finally {
        Remove-MigrationTemporaryDirectory -Path $stagingRoot
    }
}

function Invoke-CryptoSelfTest {
    <#
    .SYNOPSIS
    Exercises archive encryption, authentication, and decryption without Docker or application secrets.
    .OUTPUTS
    Throws on a failed byte-for-byte round trip; otherwise prints a passing result.
    #>
    $stagingRoot = Join-Path ([IO.Path]::GetTempPath()) "bpp-machine-migration-$([Guid]::NewGuid().ToString('N'))"
    try {
        New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
        $inputPath = Join-Path $stagingRoot "sample.tar"
        $archivePath = Join-Path $stagingRoot "sample.bppmig"
        $outputPath = Join-Path $stagingRoot "restored.tar"
        [IO.File]::WriteAllBytes($inputPath, [Text.Encoding]::UTF8.GetBytes("BPP migration crypto self-test"))
        $password = ConvertTo-SecureString "SelfTestOnlyMigrationPassword123!" -AsPlainText -Force
        Protect-MigrationTar -TarPath $inputPath -Archive $archivePath -Password $password
        Unprotect-MigrationTar -Archive $archivePath -TarPath $outputPath -Password $password
        if (-not (Test-BytesEqual -First ([IO.File]::ReadAllBytes($inputPath)) -Second ([IO.File]::ReadAllBytes($outputPath)))) {
            throw "Migration crypto self-test round trip did not preserve bytes."
        }
        Write-Host "Migration crypto self-test passed." -ForegroundColor Green
    }
    finally {
        Remove-MigrationTemporaryDirectory -Path $stagingRoot
    }
}

if ($Mode -eq "SelfTest") {
    # SelfTest intentionally bypasses Docker and accepts no archive path so it remains safe in development environments.
    Invoke-CryptoSelfTest
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ArchivePath) -or [string]::IsNullOrWhiteSpace($InstallPath)) {
    throw "Export and Import require both -ArchivePath and -InstallPath."
}

if ($Mode -eq "Export") {
    # Export treats InstallPath as the current working BPP-VMS Compose root.
    Invoke-MigrationExport -SourceRoot $InstallPath -Archive $ArchivePath -IncludeRecordings:$IncludeRecordings -IncludeDockerImages:$IncludeDockerImages -KeepSourceStopped:$KeepSourceStopped
}
else {
    # Import treats InstallPath as a new empty BPP-VMS Compose root, never an existing installation.
    Invoke-MigrationImport -Archive $ArchivePath -DestinationRoot $InstallPath
}
