<#
.SYNOPSIS
Registers the BPP i2 Bridge as a per-user scheduled task triggered at Windows logon.

.DESCRIPTION
The task uses 32-bit Windows PowerShell because Analyst's Notebook exposes a 32-bit COM API.
It runs only in the licensed interactive user's session so license/error dialogs can appear.
The script changes scheduled-task state only when an administrator/operator explicitly runs it.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [string]$BridgeRoot = '',

    [Parameter(Mandatory = $false)]
    [string]$TaskName = 'BPP i2 Analyst Bridge'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BridgeRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
    $BridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\runtime\i2-bridge'))
}
$bridgeScript = [System.IO.Path]::GetFullPath((Join-Path $scriptDir 'i2-bridge.ps1'))
$powerShell32 = "$env:WINDIR\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $powerShell32)) { throw '32-bit Windows PowerShell is unavailable' }

# Verify registration without launching Analyst's Notebook or opening a case file.
$comKey = 'Registry::HKEY_CLASSES_ROOT\Wow6432Node\CLSID\{29C44DCF-28D6-4C95-8DEF-A666763F5B70}\LocalServer32'
if (-not (Test-Path -LiteralPath $comKey)) { throw 'IBM i2 Analyst''s Notebook Automation API is not installed' }

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$bridgeScript`" -BridgeRoot `"$([IO.Path]::GetFullPath($BridgeRoot))`""
$action = New-ScheduledTaskAction -Execute $powerShell32 -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Keep long licensed conversions alive across power-policy changes and restart the bridge after interruption.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, 'Register per-user IBM i2 bridge at logon')) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "Registered '$TaskName'. Sign in to start the bridge; no chart was opened by this installer."
}
