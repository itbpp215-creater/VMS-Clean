[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),

    [Parameter()]
    [string[]]$AdditionalPrincipal = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-PrincipalSid {
    <#
    .SYNOPSIS
    Resolves an account name to a SID before constructing an ACL rule.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$Principal
    )

    # Rules use SIDs so localized Windows account display names do not change
    # which identity receives access.
    $account = [System.Security.Principal.NTAccount]::new($Principal)
    return $account.Translate([System.Security.Principal.SecurityIdentifier])
}

function Set-RestrictedAcl {
    <#
    .SYNOPSIS
    Replaces inherited or explicit access rules on one repository path.
    #>
    param(
        [Parameter(Mandatory)]
        [System.IO.FileSystemInfo]$Item,

        [Parameter(Mandatory)]
        [System.Security.Principal.IdentityReference[]]$Principals
    )

    if (-not $PSCmdlet.ShouldProcess($Item.FullName, "replace ACL with restricted principals")) {
        return
    }

    # icacls changes only the DACL, avoiding Set-Acl's requirement for the
    # SeSecurityPrivilege when a descriptor carries inherited audit metadata.
    & icacls.exe $Item.FullName "/inheritance:r" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to disable ACL inheritance on $($Item.FullName)"
    }

    $approvedSidValues = @($Principals | ForEach-Object { $_.Value })
    $currentAcl = Get-Acl -LiteralPath $Item.FullName
    foreach ($rule in @($currentAcl.Access)) {
        $ruleSid = $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
        )
        if ($ruleSid.Value -notin $approvedSidValues) {
            # Remove unexpected allow and deny entries so the result is exact, not
            # merely an overlay on a previously broad explicit ACL.
            & icacls.exe $Item.FullName "/remove:g" "*$($ruleSid.Value)" | Out-Null
            & icacls.exe $Item.FullName "/remove:d" "*$($ruleSid.Value)" | Out-Null
        }
    }

    $permission = if ($Item.PSIsContainer) { "(OI)(CI)F" } else { "F" }
    foreach ($principal in $Principals) {
        & icacls.exe $Item.FullName "/grant:r" "*$($principal.Value):$permission" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to grant restricted ACL on $($Item.FullName)"
        }
    }

    # Treat any unresolved or leftover principal as a hard failure so operators
    # never receive a success message for a partially hardened secret tree.
    $finalAcl = Get-Acl -LiteralPath $Item.FullName
    $finalSidValues = @(
        $finalAcl.Access |
            ForEach-Object {
                $_.IdentityReference.Translate(
                    [System.Security.Principal.SecurityIdentifier]
                ).Value
            } |
            Sort-Object -Unique
    )
    $unexpected = @($finalSidValues | Where-Object { $_ -notin $approvedSidValues })
    $missing = @($approvedSidValues | Where-Object { $_ -notin $finalSidValues })
    if ($unexpected.Count -gt 0 -or $missing.Count -gt 0) {
        throw "ACL verification failed for $($Item.FullName)"
    }
}

# SYSTEM and the local Administrators group always retain recovery access. The
# invoking operator owns normal runtime operations; service identities can be
# supplied explicitly without baking a workstation-specific account into source.
$principalSids = @(
    [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18"),
    [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544"),
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User
)
foreach ($principal in $AdditionalPrincipal) {
    $principalSids += Resolve-PrincipalSid -Principal $principal
}
$principalSids = @($principalSids | Sort-Object Value -Unique)

$resolvedRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar
)
$protectedRelativePaths = @(
    ".env",
    "config\auth",
    "config\backups",
    "config\certs",
    "config\lpr",
    "lpr-data"
)

foreach ($relativePath in $protectedRelativePaths) {
    $candidate = Join-Path $resolvedRoot $relativePath
    if (-not (Test-Path -LiteralPath $candidate)) {
        # Backups may not exist on a fresh deployment, but creating the directory
        # now prevents Config API's first recovery copy inheriting broad root ACLs.
        if ($relativePath -eq "config\backups") {
            [void](New-Item -ItemType Directory -Path $candidate)
        }
        else {
            Write-Warning "Skipping missing protected path: $relativePath"
            continue
        }
    }
    $resolvedTarget = (Resolve-Path -LiteralPath $candidate).Path
    if (
        $resolvedTarget -ne $resolvedRoot -and
        -not $resolvedTarget.StartsWith(
            "$resolvedRoot$([System.IO.Path]::DirectorySeparatorChar)",
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Refusing to change ACL outside repository root: $resolvedTarget"
    }

    $target = Get-Item -Force -LiteralPath $resolvedTarget
    Set-RestrictedAcl -Item $target -Principals $principalSids
    if ($target.PSIsContainer) {
        # Apply exact ACLs to existing children as well; inheritance alone could
        # leave stale explicit broad rules on previously created secret files.
        Get-ChildItem -Force -Recurse -LiteralPath $target.FullName |
            ForEach-Object {
                Set-RestrictedAcl -Item $_ -Principals $principalSids
            }
    }
}

Write-Output "Restricted ACLs applied to sensitive repository runtime paths."
