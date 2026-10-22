param(
    [string]$SourceRoot = "D:\Sloth-BPP215",
    [string]$PackageDir = "D:\SLOTH-BPP-VMS-Installer",
    [string]$ZipPath = "D:\SLOTH-BPP-VMS-Installer.zip",
    [switch]$CreateZip = $true
)

$ErrorActionPreference = "Stop"

Write-Host "[Pack-Installer] Preparing clean installer package at $PackageDir ..." -ForegroundColor Cyan

if (Test-Path $PackageDir) {
    Remove-Item -Path $PackageDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

# 1. Copy root installer executables, DLLs, and launcher scripts
foreach ($rootFile in @(
    "BPP-VMS-Setup.exe",
    "Install-On-New-PC.bat",
    "Install-Or-Start-BPP-VMS.bat",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll"
)) {
    $src = Join-Path $SourceRoot $rootFile
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $PackageDir $rootFile) -Force
    }
}

# 2. Build clean native\ directory (binaries + migration-snapshot, without machine-specific venv/webview2 cache)
$destNative = Join-Path $PackageDir "native"
foreach ($sub in @("bin", "certs", "config", "data", "recordings", "runtime", "migration-snapshot")) {
    New-Item -ItemType Directory -Path (Join-Path $destNative $sub) -Force | Out-Null
}

foreach ($nf in @(
    "BPP-VMS.exe",
    "BPP-VMS-Setup.exe",
    "go2rtc.exe",
    "gpu_accelerator.py",
    "native_ai_worker.py",
    "native_gateway.py",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll"
)) {
    $srcNf = Join-Path "$SourceRoot\native" $nf
    if (Test-Path $srcNf) {
        Copy-Item $srcNf (Join-Path $destNative $nf) -Force
    }
}

if (Test-Path "$SourceRoot\native\bin") {
    Copy-Item "$SourceRoot\native\bin\*" (Join-Path $destNative "bin") -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path "$SourceRoot\native\migration-snapshot") {
    Copy-Item "$SourceRoot\native\migration-snapshot\*" (Join-Path $destNative "migration-snapshot") -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. Build clean repo\frigate-nvr\ directory (only essential runtime & ONNX models)
$srcFrigate  = Join-Path $SourceRoot "repo\frigate-nvr"
$destFrigate = Join-Path $PackageDir "repo\frigate-nvr"
New-Item -ItemType Directory -Path $destFrigate -Force | Out-Null

foreach ($svcDir in @(
    "web",
    "config-api",
    "lpr-service",
    "watchlist-api",
    "analytics-engine",
    "nas-bot-service",
    "auth-service",
    "chat-service",
    "media-compat-service",
    "tools"
)) {
    $sDir = Join-Path $srcFrigate $svcDir
    if (Test-Path $sDir) {
        $dDir = Join-Path $destFrigate $svcDir
        Copy-Item $sDir $dDir -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $dDir -Filter "__pycache__" -Recurse -Directory -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Copy clean config template
$destCfg = Join-Path $destFrigate "config"
New-Item -ItemType Directory -Path $destCfg -Force | Out-Null
foreach ($cfgTemplate in @("config.clean.yml", "config.yml")) {
    $sCfg = Join-Path "$srcFrigate\config" $cfgTemplate
    if (Test-Path $sCfg) {
        Copy-Item $sCfg (Join-Path $destCfg $cfgTemplate) -Force
    }
}

# Copy active ONNX AI models (LicensePlateRECOG\model\attr)
$srcAttr  = Join-Path $srcFrigate "LicensePlateRECOG\model\attr"
$destAttr = Join-Path $destFrigate "LicensePlateRECOG\model\attr"
if (Test-Path $srcAttr) {
    New-Item -ItemType Directory -Path $destAttr -Force | Out-Null
    Copy-Item "$srcAttr\*" $destAttr -Force -ErrorAction SilentlyContinue
}

# 4. Write installation guide
$readmeLines = @(
    "================================================================================",
    "  SLOTH x BPP-VMS 215 -- Enterprise Native Windows Installer (v215)",
    "================================================================================",
    "",
    "How to Install on Any Windows 10/11 PC:",
    "1. Copy this folder to the target drive (e.g., D:\Sloth-BPP215 or C:\Sloth-BPP215).",
    "2. Double-click 'BPP-VMS-Setup.exe' (or 'Install-On-New-PC.bat').",
    "3. Choose your installation mode in the Setup Wizard:",
    "   - Mode 1: Clean New Machine (0 cameras, fresh configuration)",
    "   - Mode 2: Custom Selective Migration (pick cameras, users, GPS, LPR + 187 Warrant Faces)",
    "   - Mode 3: Full System Clone (100% clone of source system)",
    "4. Click 'Install Now' and launch SLOTH x BPP-VMS!",
    "================================================================================"
)
[System.IO.File]::WriteAllLines((Join-Path $PackageDir "README-INSTALL.txt"), $readmeLines, [System.Text.Encoding]::UTF8)

$pkgSizeMb = [math]::Round(((Get-ChildItem $PackageDir -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host ("[Pack-Installer] Clean installer folder ready: " + $PackageDir + " (" + $pkgSizeMb + " MB)") -ForegroundColor Green

if ($CreateZip) {
    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
    }
    Write-Host ("[Pack-Installer] Compressing installer archive to " + $ZipPath + " ...") -ForegroundColor Yellow
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($PackageDir, $ZipPath, [System.IO.Compression.CompressionLevel]::Fastest, $false)
    $zipSizeMb = [math]::Round(((Get-Item $ZipPath).Length / 1MB), 2)
    Write-Host ("[Pack-Installer] Successfully created archive: " + $ZipPath + " (" + $zipSizeMb + " MB)") -ForegroundColor Green
}
