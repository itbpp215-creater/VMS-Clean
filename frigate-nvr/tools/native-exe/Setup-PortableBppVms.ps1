param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [ValidateSet("client", "clean", "custom", "full", "keep")]
    [string]$MigrationMode = "keep",
    [switch]$MigrateCameras = $false,
    [switch]$MigrateUsers = $false,
    [switch]$MigrateGps = $false,
    [switch]$MigrateWatchlist = $false,
    [switch]$MigrateBranding = $false,
    [string]$CustomSystemTitle = "SLOTH BPP-VMS",
    [string]$ServerUrl = "https://vms.local",
    [switch]$CreateDesktopShortcut = $true,
    [switch]$CreateStartMenuShortcut = $true,
    [switch]$AutoStartWithWindows = $false,
    [switch]$LaunchAfterSetup = $false
)

$ErrorActionPreference = "Stop"

function Write-Step([int]$Pct, [string]$Msg) {
    Write-Host "[PROGRESS:$Pct] $Msg"
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8File([string]$FilePath, [string]$Content) {
    $parent = Split-Path -Parent $FilePath
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($FilePath, $Content, $Utf8NoBom)
}

Write-Step 5 "กำลังเตรียมโครงสร้างโฟลเดอร์ระบบที่ $WorkspaceRoot ..."

$NativeDir   = Join-Path $WorkspaceRoot "native"
$BinDir      = Join-Path $NativeDir "bin"
$ConfigDir   = Join-Path $NativeDir "config"
$DataDir     = Join-Path $NativeDir "data"
$ModelsDir   = Join-Path $NativeDir "models"
$RuntimeDir  = Join-Path $NativeDir "runtime"
$VenvDir     = Join-Path $NativeDir "venv"
$SnapshotDir = Join-Path $NativeDir "migration-snapshot"
$FrigateCfg  = Join-Path $WorkspaceRoot "repo\frigate-nvr\config"

foreach ($d in @($NativeDir, $BinDir, $ConfigDir, $DataDir, $ModelsDir, $RuntimeDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

# Helper to initialize a clean base config directory
function Initialize-CleanConfig([string]$TargetCfg, [string]$SystemTitle) {
    if (Test-Path $TargetCfg) {
        Remove-Item -Path "$TargetCfg\*" -Recurse -Force -ErrorAction SilentlyContinue
    }
    foreach ($sub in @("dashboard-settings", "lpr", "auth", "faces")) {
        New-Item -ItemType Directory -Path (Join-Path $TargetCfg $sub) -Force | Out-Null
    }
    $cleanYml = Join-Path $FrigateCfg "config.clean.yml"
    if (Test-Path $cleanYml) {
        Copy-Item $cleanYml (Join-Path $TargetCfg "config.yml") -Force
    } else {
        Write-Utf8File (Join-Path $TargetCfg "config.yml") "mqtt:`n  enabled: false`ncameras: {}`ndetect:`n  enabled: true`n"
    }
    Write-Utf8File (Join-Path $TargetCfg "camera_credentials.env") ""
    Write-Utf8File (Join-Path $TargetCfg "nvr_groups.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "camera_templates.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "camera_sources.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "gpsone_devices.local.json") '{"devices": {}, "permissions": {}}'

    $safeTitle = if ($SystemTitle -and $SystemTitle.Trim()) { $SystemTitle.Trim() } else { "SLOTH BPP-VMS" }
    $brandingObj = @{ title = $safeTitle; subtitle = "AI CCTV Surveillance Platform" } | ConvertTo-Json -Compress
    Write-Utf8File (Join-Path $TargetCfg "dashboard-settings\branding.json") $brandingObj
    Write-Utf8File (Join-Path $TargetCfg "dashboard-settings\channels.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "dashboard-settings\camera_names.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "dashboard-settings\camera_gps.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "dashboard-settings\nodes.json") '[]'
    Write-Utf8File (Join-Path $TargetCfg "lpr\lpr_cameras.txt") ""
    Write-Utf8File (Join-Path $TargetCfg "lpr\lpr_zones.json") '{}'
    Write-Utf8File (Join-Path $TargetCfg "lpr\object_alerts.json") '{}'

    foreach ($cached in @("go2rtc.native.yaml", "gpu_caps_cache.json")) {
        $cp = Join-Path $RuntimeDir $cached
        if (Test-Path $cp) { Remove-Item $cp -Force -ErrorAction SilentlyContinue }
    }
}

$srcPool = if (Test-Path $SnapshotDir) { $SnapshotDir } else { $FrigateCfg }

# 1. Apply Data & Configuration Migration Mode
if ($MigrationMode -eq "client") {
    $safeSrv = if ($ServerUrl -and $ServerUrl.Trim()) { $ServerUrl.Trim().TrimEnd('/') } else { "https://vms.local" }
    Write-Step 25 "กำลังตั้งค่าเครื่องนี้เป็นโปรแกรมลูกข่าย (PC Client Mode -> $safeSrv)..."
    $clientCfgObj = @{ role = "client"; server_url = $safeSrv } | ConvertTo-Json -Compress
    Write-Utf8File (Join-Path $ConfigDir "client_mode.json") $clientCfgObj
    Write-Utf8File (Join-Path $ConfigDir ".machine_id") $env:COMPUTERNAME
    Write-Step 60 "บันทึกการตั้งค่าลูกข่าย ($safeSrv) สำหรับเครื่อง $env:COMPUTERNAME เรียบร้อยแล้ว"
}
else {
    $serverCfgObj = @{ role = "server"; server_url = "http://127.0.0.1:8443" } | ConvertTo-Json -Compress
    Write-Utf8File (Join-Path $ConfigDir "client_mode.json") $serverCfgObj

    if ($MigrationMode -eq "clean") {
        Write-Step 15 "กำลังตั้งค่าระบบแบบเครื่องแม่ข่ายใหม่ทั้งหมด (Clean New Server)..."
        Initialize-CleanConfig -TargetCfg $ConfigDir -SystemTitle $CustomSystemTitle
    }
    elseif ($MigrationMode -eq "full") {
        Write-Step 15 "กำลังโคลนการตั้งค่าเครื่องแม่ข่ายทั้งหมด 100% (กล้อง, ผู้ใช้, GPS, ทะเบียนเฝ้าระวัง, แบรนด์)..."
        Initialize-CleanConfig -TargetCfg $ConfigDir -SystemTitle $CustomSystemTitle
        if (Test-Path $srcPool) {
            Copy-Item "$srcPool\*" $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Utf8File (Join-Path $ConfigDir "client_mode.json") $serverCfgObj
    }
    elseif ($MigrationMode -eq "custom") {
        Write-Step 15 "กำลังคัดลอกเฉพาะข้อมูลที่เลือกจากเครื่องต้นทาง (Custom Selective Migration)..."
        Initialize-CleanConfig -TargetCfg $ConfigDir -SystemTitle $CustomSystemTitle

        if ($MigrateCameras) {
            Write-Step 20 "-> กำลังนำเข้า รายการกล้อง CCTV, กลุ่ม NVR และพิกัดกล้อง..."
            foreach ($cf in @("config.yml", "camera_credentials.env", "camera_templates.json", "camera_sources.json", "nvr_groups.json", "ai_schedules.json", "manual_recordings.json")) {
                if (Test-Path "$srcPool\$cf") { Copy-Item "$srcPool\$cf" "$ConfigDir\$cf" -Force }
            }
            foreach ($df in @("channels.json", "camera_names.json", "camera_gps.json", "nodes.json")) {
                if (Test-Path "$srcPool\dashboard-settings\$df") {
                    Copy-Item "$srcPool\dashboard-settings\$df" "$ConfigDir\dashboard-settings\$df" -Force
                }
            }
        }

        if ($MigrateUsers) {
            Write-Step 24 "-> กำลังนำเข้า บัญชีผู้ใช้งานและสิทธิ์การเข้าถึง (User Accounts)..."
            if (Test-Path "$srcPool\auth") {
                Copy-Item "$srcPool\auth\*" "$ConfigDir\auth\" -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if ($MigrateGps) {
            Write-Step 28 "-> กำลังนำเข้า อุปกรณ์ติดตามพิกัด GPS และเส้นทางย้อนหลัง..."
            foreach ($gf in @("gpsone_devices.local.json", "gpsone_history.local.db")) {
                if (Test-Path "$srcPool\$gf") { Copy-Item "$srcPool\$gf" "$ConfigDir\$gf" -Force }
            }
        }

        if ($MigrateWatchlist) {
            Write-Step 32 "-> กำลังนำเข้า บัญชีดำป้ายทะเบียนเฝ้าระวัง, ฐานข้อมูลใบหน้าหมายจับ (187 แฟ้ม) และโซน AI..."
            if (Test-Path "$srcPool\lpr") {
                Copy-Item "$srcPool\lpr\*" "$ConfigDir\lpr\" -Recurse -Force -ErrorAction SilentlyContinue
            }
            if (Test-Path "$srcPool\faces") {
                Copy-Item "$srcPool\faces\*" "$ConfigDir\faces\" -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if ($MigrateBranding) {
            Write-Step 35 "-> กำลังนำเข้า ชื่อหน่วยงาน โลโก้ และการตั้งค่าหน้าแดชบอร์ดเดิม..."
            foreach ($bf in @("branding.json", "logo.png")) {
                if (Test-Path "$srcPool\dashboard-settings\$bf") {
                    Copy-Item "$srcPool\dashboard-settings\$bf" "$ConfigDir\dashboard-settings\$bf" -Force
                }
            }
        }
        Write-Utf8File (Join-Path $ConfigDir "client_mode.json") $serverCfgObj
    }
    else {
        Write-Step 15 "กำลังตรวจสอบไฟล์ตั้งค่าปัจจุบันของเครื่อง ($env:COMPUTERNAME)..."
        if (-not (Test-Path (Join-Path $ConfigDir "config.yml"))) {
            Initialize-CleanConfig -TargetCfg $ConfigDir -SystemTitle $CustomSystemTitle
        }
        Write-Utf8File (Join-Path $ConfigDir "client_mode.json") $serverCfgObj
    }

    # Stamp current PC's COMPUTERNAME into .machine_id so native_gateway.py recognizes this PC
    Write-Utf8File (Join-Path $ConfigDir ".machine_id") $env:COMPUTERNAME
    Write-Step 40 "ผูกสิทธิ์การตั้งค่าเข้ากับเครื่อง $env:COMPUTERNAME เรียบร้อยแล้ว"

    # 2. Verify Python & Create/Update Local venv (All-GPU: CUDA / DirectML / CPU)
    Write-Step 45 "กำลังตรวจสอบ Python Runtime และสภาพแวดล้อม AI..."
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
        Write-Step 48 "ไม่พบ Python ในระบบ กำลังติดตั้ง Python 3.11 อัตโนมัติผ่าน winget..."
        winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
    }

    $venvPython = Join-Path $VenvDir "Scripts\python.exe"
    $pyvenvCfg  = Join-Path $VenvDir "pyvenv.cfg"
    $venvValid = $false
    if ((Test-Path $venvPython) -and (Test-Path $pyvenvCfg)) {
        try {
            $cfgText = Get-Content $pyvenvCfg -Raw -ErrorAction Stop
            if ($cfgText -like "*$VenvDir*") {
                & $venvPython --version *> $null
                if ($LASTEXITCODE -eq 0) { $venvValid = $true }
            }
        } catch { $venvValid = $false }
    }

    if (-not $venvValid) {
        Write-Step 55 "กำลังสร้าง Python Virtual Environment สำหรับเครื่อง $env:COMPUTERNAME ..."
        if (Test-Path $VenvDir) {
            Remove-Item -Path $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        python -m venv --system-site-packages $VenvDir
    }

    Write-Step 65 "กำลังตรวจสอบไลบรารีระบบและเอนจิน All-GPU ONNX Runtime..."
    $depsReady = $false
    try {
        & $venvPython -c "import fastapi, uvicorn, yaml, ruamel.yaml, websockets, cv2, numpy, PIL, pydantic, multipart, httpx, onnxruntime" *> $null
        if ($LASTEXITCODE -eq 0) { $depsReady = $true }
    } catch { $depsReady = $false }

    if (-not $depsReady) {
        Write-Step 68 "กำลังติดตั้งไลบรารีระบบและเอนจิน All-GPU ONNX Runtime..."
        & $venvPython -m pip install --upgrade pip --quiet
        & $venvPython -m pip install fastapi uvicorn pyyaml "ruamel.yaml" websockets opencv-python-headless numpy pillow pydantic python-multipart httpx onnxruntime-directml --quiet
    } else {
        Write-Step 72 "ตรวจพบไลบรารี AI และ ONNX Runtime ครบถ้วนพร้อมใช้งานแล้ว"
    }

    # 3. Check go2rtc.exe in native\ or native\bin\
    Write-Step 78 "กำลังตรวจสอบเอนจินสตรีมมิ่งความหน่วงต่ำ (go2rtc.exe)..."
    $go2rtcRoot = Join-Path $NativeDir "go2rtc.exe"
    $go2rtcBin  = Join-Path $BinDir "go2rtc.exe"
    if (-not (Test-Path $go2rtcRoot) -and -not (Test-Path $go2rtcBin)) {
        Write-Step 80 "กำลังดาวน์โหลด go2rtc_win64.zip..."
        $zipPath = Join-Path $RuntimeDir "go2rtc_win64.zip"
        Invoke-WebRequest -Uri "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip" -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force
    }
}

# 4. Sync native scripts & compile BPP-VMS.exe
Write-Step 86 "กำลังคอมไพล์โปรแกรมหลัก BPP-VMS.exe (SLOTH Cyber Shell)..."
foreach ($pyFile in @("gpu_accelerator.py", "native_ai_worker.py", "native_gateway.py")) {
    $srcPy = Join-Path $PSScriptRoot $pyFile
    if (Test-Path $srcPy) {
        Copy-Item $srcPy (Join-Path $NativeDir $pyFile) -Force
    }
}
$buildScript = Join-Path $PSScriptRoot "Build-BppNativeExe.ps1"
& $buildScript -OutputDir $NativeDir

# 5. Shortcuts & Windows Startup
$exePath = Join-Path $NativeDir "BPP-VMS.exe"
if ($CreateDesktopShortcut -and (Test-Path $exePath)) {
    Write-Step 93 "กำลังสร้างไอคอนทางลัด 'SLOTH BPP-VMS' บนหน้าจอ Desktop..."
    try {
        $desktop = [Environment]::GetFolderPath("Desktop")
        $shortcutPath = Join-Path $desktop "SLOTH BPP-VMS.lnk"
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut($shortcutPath)
        $sc.TargetPath = $exePath
        $sc.WorkingDirectory = $NativeDir
        $sc.Description = "SLOTH x BPP-VMS Native Windows Edition (All-GPU)"
        $sc.Save()
    } catch {}
}

if ($CreateStartMenuShortcut -and (Test-Path $exePath)) {
    try {
        $startMenu = [Environment]::GetFolderPath("Programs")
        $shortcutPath = Join-Path $startMenu "SLOTH BPP-VMS.lnk"
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut($shortcutPath)
        $sc.TargetPath = $exePath
        $sc.WorkingDirectory = $NativeDir
        $sc.Description = "SLOTH x BPP-VMS Native Windows Edition (All-GPU)"
        $sc.Save()
    } catch {}
}

if ($AutoStartWithWindows -and (Test-Path $exePath)) {
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "BPP-VMS-Native" -Value "`"$exePath`""
} else {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "BPP-VMS-Native" -ErrorAction SilentlyContinue
}

Write-Step 100 "ติดตั้งและตั้งค่าระบบ SLOTH x BPP-VMS เสร็จสมบูรณ์!"

if ($LaunchAfterSetup -and (Test-Path $exePath)) {
    Start-Process -FilePath $exePath -WorkingDirectory $NativeDir
}
