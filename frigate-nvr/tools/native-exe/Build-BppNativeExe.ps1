param(
    [string]$OutputDir = "D:\Sloth-BPP215\native",
    [string]$SlothSourceDir = "D:\Sloth-BPP215\native\bin"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# 1. Ensure managed WebView2 .NET Framework DLLs (Microsoft.Web.WebView2.Core.dll + WebView2Loader.dll)
$coreDll = Join-Path $OutputDir "Microsoft.Web.WebView2.Core.dll"
$winformsDll = Join-Path $OutputDir "Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $OutputDir "WebView2Loader.dll"

$needNuget = $true
if ((Test-Path $coreDll) -and (Test-Path $loaderDll)) {
    try {
        [System.Reflection.AssemblyName]::GetAssemblyName($coreDll) | Out-Null
        $needNuget = $false
    } catch {
        $needNuget = $true
    }
}

if ($needNuget) {
    Write-Host "[Build-BppNativeExe] Fetching managed Microsoft.Web.WebView2 NuGet package..." -ForegroundColor Cyan
    $nupkgZip = Join-Path $env:TEMP "webview2_pkg.zip"
    $nupkgExtract = Join-Path $env:TEMP "webview2_pkg_extracted"
    if (Test-Path $nupkgExtract) { Remove-Item $nupkgExtract -Recurse -Force }
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2792.45" -OutFile $nupkgZip -UseBasicParsing
    Expand-Archive -Path $nupkgZip -DestinationPath $nupkgExtract -Force
    $netDir = Join-Path $nupkgExtract "lib\net462"
    if (-not (Test-Path $netDir)) {
        $netDir = Join-Path $nupkgExtract "lib\net45"
    }
    Copy-Item (Join-Path $netDir "Microsoft.Web.WebView2.Core.dll") $coreDll -Force
    Copy-Item (Join-Path $netDir "Microsoft.Web.WebView2.WinForms.dll") $winformsDll -Force
    Copy-Item (Join-Path $nupkgExtract "runtimes\win-x64\native\WebView2Loader.dll") $loaderDll -Force
    Remove-Item $nupkgZip -Force -ErrorAction SilentlyContinue
    Remove-Item $nupkgExtract -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. Ensure go2rtc.exe + mediamtx.exe + bore.exe in OutputDir
$g2rDest = Join-Path $OutputDir "go2rtc.exe"
if (-not (Test-Path $g2rDest)) {
    Write-Host "[Build-BppNativeExe] Fetching official go2rtc_win64.zip..." -ForegroundColor Cyan
    $g2rZip = Join-Path $env:TEMP "go2rtc_win64.zip"
    Invoke-WebRequest -Uri "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip" -OutFile $g2rZip -UseBasicParsing
    Expand-Archive -Path $g2rZip -DestinationPath $OutputDir -Force
    Remove-Item $g2rZip -Force -ErrorAction SilentlyContinue
}
if (Test-Path $SlothSourceDir) {
    $destBinDir = Join-Path $OutputDir "bin"
    if (-not (Test-Path $destBinDir)) {
        New-Item -ItemType Directory -Path $destBinDir -Force | Out-Null
    }
    foreach ($toolExe in @("mediamtx.exe", "bore.exe")) {
        $srcExe = Join-Path $SlothSourceDir $toolExe
        $dstExe = Join-Path $destBinDir $toolExe
        if ((Test-Path $srcExe) -and ($srcExe.ToLower() -ne $dstExe.ToLower())) {
            Copy-Item $srcExe $dstExe -Force
        }
    }
}

# 3. Copy gateway & worker scripts + icon to OutputDir
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($py in @("gpu_accelerator.py", "native_ai_worker.py", "native_gateway.py")) {
    Copy-Item (Join-Path $scriptDir $py) (Join-Path $OutputDir $py) -Force
}
$icoFile = Join-Path $scriptDir "bpp215.ico"
if (Test-Path $icoFile) {
    Copy-Item $icoFile (Join-Path $OutputDir "bpp215.ico") -Force
}

# 4. Find csc.exe (.NET Framework 4.x compiler built into Windows)
$cscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
    throw "csc.exe not found on this machine"
}

$csFile = Join-Path $scriptDir "BppVmsShell.cs"
$outExe = Join-Path $OutputDir "BPP-VMS.exe"
$oldExe = Join-Path $OutputDir "BPP-VMS.exe.old"
if (Test-Path $oldExe) { Remove-Item $oldExe -Force -ErrorAction SilentlyContinue }
if (Test-Path $outExe) {
    try {
        Remove-Item $outExe -Force -ErrorAction Stop
    } catch {
        Move-Item $outExe $oldExe -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[Build-BppNativeExe] Compiling $outExe ..." -ForegroundColor Yellow
$win32IconArg = if (Test-Path $icoFile) { "/win32icon:$icoFile" } else { "" }
& $csc /target:winexe /platform:x64 /optimize+ `
    $win32IconArg `
    /out:$outExe `
    /r:System.dll `
    /r:System.Core.dll `
    /r:System.Drawing.dll `
    /r:System.Windows.Forms.dll `
    /r:System.Web.Extensions.dll `
    "/r:$coreDll" `
    "/r:$winformsDll" `
    $csFile

if ($LASTEXITCODE -ne 0) {
    throw "Compilation of BPP-VMS.exe failed with exit code $LASTEXITCODE"
}
if (Test-Path $oldExe) { Remove-Item $oldExe -Force -ErrorAction SilentlyContinue }
Write-Host "[Build-BppNativeExe] Successfully built: $outExe" -ForegroundColor Green

$setupCsFile = Join-Path $scriptDir "BppVmsSetupWizard.cs"
if (Test-Path $setupCsFile) {
    $setupOutExe = Join-Path $OutputDir "BPP-VMS-Setup.exe"
    $setupOldExe = Join-Path $OutputDir "BPP-VMS-Setup.exe.old"
    if (Test-Path $setupOldExe) { Remove-Item $setupOldExe -Force -ErrorAction SilentlyContinue }
    if (Test-Path $setupOutExe) {
        try {
            Remove-Item $setupOutExe -Force -ErrorAction Stop
        } catch {
            Move-Item $setupOutExe $setupOldExe -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "[Build-BppNativeExe] Compiling $setupOutExe ..." -ForegroundColor Yellow
    & $csc /target:winexe /platform:x64 /optimize+ `
        $win32IconArg `
        /out:$setupOutExe `
        /r:System.dll `
        /r:System.Core.dll `
        /r:System.Drawing.dll `
        /r:System.Windows.Forms.dll `
        "/r:$coreDll" `
        "/r:$winformsDll" `
        $setupCsFile

    if ($LASTEXITCODE -ne 0) {
        throw "Compilation of BPP-VMS-Setup.exe failed with exit code $LASTEXITCODE"
    }
    if (Test-Path $setupOldExe) { Remove-Item $setupOldExe -Force -ErrorAction SilentlyContinue }
    Write-Host "[Build-BppNativeExe] Successfully built: $setupOutExe" -ForegroundColor Green

    $workspaceRoot = Split-Path -Parent $OutputDir
    if (Test-Path $workspaceRoot) {
        try {
            Copy-Item $setupOutExe (Join-Path $workspaceRoot "BPP-VMS-Setup.exe") -Force -ErrorAction Stop
        } catch {
            # BPP-VMS-Setup.exe may be currently running the wizard; ignore overwrite lock
        }
        foreach ($legacyFile in @("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "Install-On-New-PC.bat", "Install-Or-Start-BPP-VMS.bat")) {
            $lfPath = Join-Path $workspaceRoot $legacyFile
            if (Test-Path $lfPath) { Remove-Item $lfPath -Force -ErrorAction SilentlyContinue }
        }
        Write-Host "[Build-BppNativeExe] Published root installer: $(Join-Path $workspaceRoot 'BPP-VMS-Setup.exe')" -ForegroundColor Cyan
    }
}
