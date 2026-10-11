# ========================================================================
# Sloth BPP-VMS - 1-Click Automated Setup & Installation Worker
# กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
# ========================================================================

[CmdletBinding()]
param(
    [string]$InstallPath = "$PSScriptRoot\.."
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$resolvedPath = (Resolve-Path $InstallPath).Path
[System.IO.Directory]::SetCurrentDirectory($resolvedPath)
Set-Location $resolvedPath
$composeFile = Join-Path $resolvedPath "docker-compose.yml"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function New-CryptoHexSecret([int]$byteCount = 32) {
    $bytes = New-Object byte[] $byteCount
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

Clear-Host
Write-Header "Sloth BPP-VMS - ตัวช่วยติดตั้งระบบสำหรับเครื่องใหม่ [1-Click Setup]"

# ------------------------------------------------------------------------
# 1. ตรวจสอบการทำงานของ Docker Desktop
# ------------------------------------------------------------------------
Write-Host "[1/7] กำลังตรวจสอบสถานะ Docker Desktop..." -ForegroundColor Yellow

$dockerReady = $false
while (-not $dockerReady) {
    try {
        $null = & docker info 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerReady = $true
            Write-Host "  [OK] ตรวจพบ Docker Engine พร้อมทำงานแล้ว`n" -ForegroundColor Green
        } else {
            throw "Docker engine not running"
        }
    } catch {
        Write-Host ""
        Write-Host "  [!] ไม่พบการทำงานของ Docker Desktop!" -ForegroundColor Red
        Write-Host "  กรุณาเปิดโปรแกรม Docker Desktop บนเครื่องนี้ แล้วรอจนกว่าสถานะที่มุมซ้ายล่างจะเป็นสีเขียว [Engine running]" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "  กดปุ่ม [Enter] หลังจากเปิด Docker Desktop แล้ว เพื่อตรวจสอบอีกครั้ง..."
    }
}

# ------------------------------------------------------------------------
# 2. ตรวจสอบและสร้างไฟล์ .env แบบอัตโนมัติ (สุ่ม Secret 64-char Hex)
# ------------------------------------------------------------------------
Write-Host "[2/7] กำลังตรวจสอบและตั้งค่าไฟล์ความปลอดภัย [.env]..." -ForegroundColor Yellow

$envPath = Join-Path $resolvedPath ".env"
$envExamplePath = Join-Path $resolvedPath ".env.example"

if (-not (Test-Path $envPath)) {
    if (Test-Path $envExamplePath) {
        Copy-Item -LiteralPath $envExamplePath -Destination $envPath
        Write-Host "  [*] สร้างไฟล์ .env จาก .env.example" -ForegroundColor Gray
    } else {
        New-Item -Path $envPath -ItemType File -Force | Out-Null
        Write-Host "  [*] สร้างไฟล์ .env ใหม่" -ForegroundColor Gray
    }
}

# อ่านค่าและเติมตัวแปรที่จำเป็นอัตโนมัติเพื่อป้องกัน Docker Compose แครช
$envLines = @()
if (Test-Path $envPath) {
    $envLines = Get-Content -LiteralPath $envPath -Encoding utf8
}

$envMap = [ordered]@{}
foreach ($line in $envLines) {
    $trimmed = $line.Trim()
    if ($trimmed -and -not $trimmed.StartsWith("#")) {
        $eqIdx = $line.IndexOf("=")
        if ($eqIdx -gt 0) {
            $k = $line.Substring(0, $eqIdx).Trim()
            $v = $line.Substring($eqIdx + 1).Trim()
            $envMap[$k] = $v
        }
    }
}

$requiredSecrets = @(
    "AUTH_AUDIT_SHARED_SECRET",
    "MEDIA_COMPAT_PROXY_SHARED_SECRET",
    "WATCHLIST_PROXY_SHARED_SECRET",
    "WATCHLIST_FEDERATION_SHARED_SECRET",
    "WATCHLIST_SERVICE_SHARED_SECRET"
)

$secretsGenerated = 0
foreach ($sec in $requiredSecrets) {
    if (-not $envMap.Contains($sec) -or [string]::IsNullOrWhiteSpace($envMap[$sec])) {
        $envMap[$sec] = New-CryptoHexSecret 32
        $secretsGenerated++
    }
}

# ตรวจสอบค่ากล้องเริ่มต้น
$defaultVars = @{
    "FRIGATE_DVR_USER" = "admin"
    "FRIGATE_DVR_PASS" = "admin1234"
    "FRIGATE_PRASAT_USER" = "admin"
    "FRIGATE_PRASAT_PASS" = "admin1234"
    "CLOUDFLARE_TUNNEL_TOKEN" = "none_local_only"
    "COMPOSE_PROJECT_NAME" = "bpp-vms"
    "AUTH_COOKIE_SECURE" = "true"
    "STORAGE_MIN_FREE_PERCENT" = "15"
    "BPP_FEDERATION_ALLOW_CIDR" = "127.0.0.1/32"
    "LPR_CAMERAS" = "cam11"
    "LPR_ALERT_LOCATION" = "BPP PrerimWatch"
    "LPR_ALERT_COOLDOWN" = "30"
    "LPR_SUPERADMIN_USERNAME" = "admin"
    "BPP_ARCHIVE_DIR" = "./storage/lpr-archive"
    "BPP_ARCHIVE_CROPS_DIR" = "./storage/lpr-archive"
}

foreach ($key in $defaultVars.Keys) {
    if (-not $envMap.Contains($key) -or [string]::IsNullOrWhiteSpace($envMap[$key])) {
        $envMap[$key] = $defaultVars[$key]
    }
}

# บันทึกไฟล์ .env กลับลงดิสก์
$newEnvContent = @()
$newEnvContent += "# BPP-VMS Automated Generated Environment File"
$newEnvContent += "# Generated on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$newEnvContent += ""
foreach ($k in $envMap.Keys) {
    $newEnvContent += "$k=$($envMap[$k])"
}
[System.IO.File]::WriteAllLines($envPath, $newEnvContent, [System.Text.Encoding]::UTF8)

Write-Host "  [OK] ไฟล์ .env พร้อมใช้งาน [สร้างความปลอดภัย 64-char Hex ครบทุกตัว]`n" -ForegroundColor Green

# ------------------------------------------------------------------------
# 3. ตรวจสอบและสร้างใบรับรอง HTTPS (SSL Certificate)
# ------------------------------------------------------------------------
Write-Host "[3/7] กำลังตรวจสอบใบรับรองความปลอดภัย HTTPS [SSL]..." -ForegroundColor Yellow

$certsDir = Join-Path $resolvedPath "config\certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$fullchainPath = Join-Path $certsDir "fullchain.pem"
$privkeyPath = Join-Path $certsDir "privkey.pem"

if (-not (Test-Path $fullchainPath) -or -not (Test-Path $privkeyPath)) {
    Write-Host "  [*] กำลังสร้าง Self-Signed SSL Certificate สำหรับ localhost..." -ForegroundColor Gray
    Write-Host "  [*] [กำลัง Build auth-service image... อาจใช้เวลาสักครู่ในครั้งแรก]" -ForegroundColor Gray
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $certResult = (& docker compose --project-directory "$resolvedPath" -f "$composeFile" run --rm --no-deps -T -v "${certsDir}:/certs" auth-service python /app/generate_tls_certificate.py --certificate-file /certs/fullchain.pem --private-key-file /certs/privkey.pem 2>&1) | Out-String
    $ErrorActionPreference = $prevEap
}

# ตรวจสอบว่าไฟล์ใบรับรองถูกสร้างจริง
if ((Test-Path $fullchainPath) -and (Test-Path $privkeyPath)) {
    Write-Host "  [OK] ใบรับรอง HTTPS พร้อมใช้งาน`n" -ForegroundColor Green
} else {
    Write-Host "  [!] ไม่สามารถสร้างใบรับรอง SSL ได้!" -ForegroundColor Red
    Write-Host "      ไฟล์ที่ต้องการ: $fullchainPath" -ForegroundColor Red
    Write-Host "      ไฟล์ที่ต้องการ: $privkeyPath" -ForegroundColor Red
    if ($certResult) {
        Write-Host "      รายละเอียด: $certResult" -ForegroundColor Red
    }
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

# ตรวจสอบความพร้อมของไดเรกทอรีและโมเดล AI (Frigate Detection & LPR)
$requiredDirs = @(
    "LicensePlateRECOG\model",
    "config\model_cache",
    "config\lpr",
    "config\dashboard-settings\storage-policy",
    "config\certs",
    "lpr-data\crops",
    "lpr-model-store",
    "storage\recordings",
    "storage\clips",
    "storage\exports",
    "storage\lpr-archive"
)
foreach ($rd in $requiredDirs) {
    $fullRd = Join-Path $resolvedPath $rd
    if (-not (Test-Path $fullRd)) {
        New-Item -ItemType Directory -Path $fullRd -Force | Out-Null
    }
}

$frigateModel = Join-Path $resolvedPath "config\model_cache\yolo11m-640.onnx"
$plateModel = Join-Path $resolvedPath "LicensePlateRECOG\model\license_plate.pt"
$charModel = Join-Path $resolvedPath "LicensePlateRECOG\model\data_plate.pt"

if (Test-Path $frigateModel) {
    Write-Host "  [OK] ตรวจพบโมเดล Frigate AI Detection (yolo11m-640.onnx)" -ForegroundColor Green
} else {
    Write-Host "  [!] คำเตือน: ไม่พบไฟล์โมเดล config\model_cache\yolo11m-640.onnx" -ForegroundColor Yellow
    Write-Host "      ระบบ AI ตรวจจับวัตถุจะไม่ทำงานจนกว่าจะมีไฟล์นี้" -ForegroundColor Yellow
}

if ((Test-Path $plateModel) -and (Test-Path $charModel)) {
    Write-Host "  [OK] ตรวจพบโมเดล AI LPR (license_plate.pt, data_plate.pt)`n" -ForegroundColor Green
} else {
    Write-Host "  [!] คำเตือน: ไม่พบไฟล์โมเดล AI ใน LicensePlateRECOG\model" -ForegroundColor Yellow
    Write-Host "      กรุณาดาวน์โหลดชุดติดตั้งสมบูรณ์จาก https://vms.local/downloads/bpp-vms-installer.zip`n" -ForegroundColor Yellow
}

# ------------------------------------------------------------------------
# 4. ตรวจสอบและเตรียมบัญชีผู้ดูแลระบบ [First-Time Super Administrator]
# ------------------------------------------------------------------------
Write-Host "[4/7] กำลังตรวจสอบบัญชีผู้ดูแลระบบ [Administrator Account]..." -ForegroundColor Yellow

$userCountCheck = "import auth; ctx = auth.get_conn(); conn = ctx.__enter__(); auth.ensure_schema(conn); print('USER_COUNT:' + str(conn.execute('SELECT COUNT(*) FROM users').fetchone()[0])); ctx.__exit__(None, None, None)"

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$checkRaw = (& docker compose --project-directory "$resolvedPath" -f "$composeFile" run --rm --no-deps -T auth-service python -c $userCountCheck 2>&1) | Out-String
$ErrorActionPreference = $prevEap

$userCount = 0
if ($checkRaw -match "USER_COUNT:(\d+)") {
    $userCount = [int]$matches[1]
}

$adminUser = "admin"
$chosenPassword = ""

if ($userCount -eq 0) {
    Write-Host ""
    Write-Host "  ========================================================================" -ForegroundColor Magenta
    Write-Host "    ตั้งค่าบัญชีผู้ดูแลระบบคนแรก [First-Time Super Administrator]" -ForegroundColor Magenta
    Write-Host "  ========================================================================" -ForegroundColor Magenta
    Write-Host "  ชื่อบัญชี [Username]: admin" -ForegroundColor White
    Write-Host "  กรุณาตั้งรหัสผ่านสำหรับ admin [ความยาวตั้งแต่ 8 ตัวอักษรขึ้นไป]" -ForegroundColor White
    Write-Host "  * หากต้องการใช้รหัสผ่านชั่วคราวเริ่มต้น ให้กดปุ่ม [Enter] ได้ทันที *" -ForegroundColor Yellow
    Write-Host "    [รหัสผ่านเริ่มต้นคือ: ChangeMeAdmin123!]" -ForegroundColor Gray
    Write-Host ""
    
    $inputPass = Read-Host "  กำหนดรหัสผ่าน [หรือกด Enter ใช้รหัสเริ่มต้น]"
    if ([string]::IsNullOrWhiteSpace($inputPass)) {
        $chosenPassword = "ChangeMeAdmin123!"
    } else {
        while ($inputPass.Length -lt 8) {
            Write-Host "  [!] รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร" -ForegroundColor Red
            $inputPass = Read-Host "  กรุณาใส่รหัสผ่านใหม่อีกครั้ง"
        }
        $chosenPassword = $inputPass
    }

    Write-Host "`n  [*] กำลังสร้างบัญชีผู้ดูแลระบบ..." -ForegroundColor Gray
    $escapedPass = $chosenPassword.Replace('\', '\\').Replace("'", "\'")
    $provisionScript = @"
import sqlite3, auth
conn = sqlite3.connect(auth.DB_PATH)
auth.ensure_schema(conn)
h = auth.pwd_context.hash('$escapedPass')
conn.execute('INSERT OR REPLACE INTO users (username, password_hash, role, active) VALUES (?, ?, ?, ?)', ('$adminUser', h, 'superadmin', 1))
conn.commit()
changed = conn.total_changes
conn.close()
if changed > 0:
    print('SUPERADMIN_PROVISIONED_SUCCESS')
else:
    raise RuntimeError('Failed to verify superadmin in database')
"@
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $res = (& docker compose --project-directory "$resolvedPath" -f "$composeFile" run --rm --no-deps -T auth-service python -c "$provisionScript" 2>&1) | Out-String
    $ErrorActionPreference = $prevEap

    if ($res -match "SUPERADMIN_PROVISIONED_SUCCESS") {
        Write-Host "  [OK] สร้างบัญชีผู้ดูแลระบบ $adminUser สำเร็จเรียบร้อยแล้ว!`n" -ForegroundColor Green
    } else {
        Write-Host "  [!] เกิดข้อผิดพลาดในการสร้างบัญชีผู้ดูแลระบบ: $res" -ForegroundColor Red
        Read-Host "กดปุ่ม [Enter] เพื่อออก..."
        exit 1
    }

    # บันทึกช่วยจำไว้ที่โฟลเดอร์ราก
    $memoPath = Join-Path (Resolve-Path "$resolvedPath\..").Path "Admin_Login_Info.txt"
    $memoContent = @"
======================================================
  Sloth BPP-VMS - ข้อมูลการเข้าสู่ระบบเริ่มต้น
  สร้างเมื่อ: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
======================================================
  URL เข้าระบบ: https://localhost
  Username:     $adminUser
  Password:     $chosenPassword
======================================================
* หมายเหตุ: บันทึกนี้ถูกสร้างขึ้นเพื่อความสะดวกของผู้ดูแลระบบ *
"@
    [System.IO.File]::WriteAllText($memoPath, $memoContent, [System.Text.Encoding]::UTF8)
} else {
    Write-Host "  [OK] ระบบมีบัญชีผู้ใช้งานอยู่แล้วในฐานข้อมูล`n" -ForegroundColor Green
}

# ------------------------------------------------------------------------
# 5. สตาร์ทคอนเทนเนอร์ระบบ BPP-VMS ทั้งหมด [docker compose up -d]
# ------------------------------------------------------------------------
Write-Host "[5/7] กำลังเริ่มการทำงานของระบบ BPP-VMS ทั้งหมด [docker compose up -d]..." -ForegroundColor Yellow
try {
    & docker compose --project-directory "$resolvedPath" -f "$composeFile" up -d
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up -d exited with code $LASTEXITCODE"
    }
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'

    # หยุดบริการ cloudflared-tunnel อัตโนมัติเมื่อเป็นโทเค็นเริ่มต้น ป้องกัน restart loop
    if ($envMap["CLOUDFLARE_TUNNEL_TOKEN"] -eq "none_local_only") {
        Write-Host "  [*] หยุดบริการ cloudflared-tunnel อัตโนมัติ [เนื่องจากยังไม่ได้ตั้งค่า Cloudflare Token จริง]" -ForegroundColor Gray
        cmd.exe /c "docker compose --project-directory \"$resolvedPath\" -f \"$composeFile\" stop cloudflared >nul 2>&1"
    }
    $ErrorActionPreference = $prevEA
    Write-Host "  [OK] บริการทั้งหมดถูกเริ่มทำงานเรียบร้อยแล้ว`n" -ForegroundColor Green
} catch {
    Write-Host "  [!] เกิดข้อผิดพลาดในการเริ่ม Docker Compose: $_" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

# ------------------------------------------------------------------------
# 6. ตรวจสอบสถานะโปรแกรม IBM i2 Analyst's Notebook และเปิดระบบ i2-Bridge
# ------------------------------------------------------------------------
Write-Host "[6/7] กำลังตรวจสอบโปรแกรม IBM i2 Analyst's Notebook บนเครื่องนี้..." -ForegroundColor Yellow
$i2ComKey = 'Registry::HKEY_CLASSES_ROOT\Wow6432Node\CLSID\{29C44DCF-28D6-4C95-8DEF-A666763F5B70}\LocalServer32'
if (Test-Path -LiteralPath $i2ComKey) {
    Write-Host "  [OK] ตรวจพบโปรแกรม IBM i2 Analyst's Notebook ติดตั้งอยู่บนเครื่องนี้!" -ForegroundColor Green
    try {
        $bridgeScript = Join-Path $resolvedPath "scripts\i2-bridge\start-i2-bridge.ps1"
        if (Test-Path $bridgeScript) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$bridgeScript" | Out-Null
            Write-Host "  [OK] เริ่มการทำงานของ BPP i2 Bridge ในพื้นหลังเรียบร้อยแล้ว`n" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [!] ไม่สามารถสตาร์ท i2-Bridge ได้: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [i] ไม่พบโปรแกรม IBM i2 Analyst's Notebook บนเครื่องนี้" -ForegroundColor Gray
    Write-Host "      [ข้ามการรัน i2-Bridge: เครื่องนี้ยังคงสามารถเปิดดู ค้นหา และวิเคราะห์ผังความเชื่อมโยงที่แปลงแล้วผ่านหน้าเว็บได้ตามปกติ 100%]`n" -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------
# 7. ติดตั้ง n8n Master Bot Workflow และกำหนดค่า AI / Telegram
# ------------------------------------------------------------------------
Write-Host "[7/7] กำลังติดตั้ง n8n Master Bot Workflow และกำหนดค่า AI / Telegram..." -ForegroundColor Yellow
$repoRoot = (Resolve-Path "$resolvedPath\..").Path
$n8nInstaller = Join-Path $repoRoot "n8n\install-workflow.ps1"
if (Test-Path $n8nInstaller) {
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$n8nInstaller" -SkipPause
        Write-Host "`n  [OK] ติดตั้ง n8n Master Bot Workflow และกำหนดค่าเรียบร้อยแล้ว`n" -ForegroundColor Green
    } catch {
        Write-Host "`n  [!] เกิดข้อผิดพลาดในการติดตั้ง n8n Workflow: $_`n" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [!] ไม่พบไฟล์ติดตั้ง n8n: $n8nInstaller`n" -ForegroundColor Yellow
}

# ------------------------------------------------------------------------
# 8. สรุปผลและเปิดเบราว์เซอร์เข้าใช้งาน
# ------------------------------------------------------------------------
Write-Header "[SUCCESS] การติดตั้งและเริ่มระบบ BPP-VMS สำเร็จสมบูรณ์!"

Write-Host "  ระบบพร้อมให้บริการแล้วที่:" -ForegroundColor White
Write-Host "  --> ระบบหลัก [Main Web]:  https://localhost" -ForegroundColor Cyan
Write-Host "  --> n8n AI Automation:    http://localhost:5678" -ForegroundColor Cyan
if ($chosenPassword) {
    Write-Host "  Username: admin" -ForegroundColor White
    Write-Host "  Password: $chosenPassword" -ForegroundColor White
}
Write-Host ""
Write-Host "  [ไฟล์บันทึกช่วยจำอยู่ที่: $memoPath]" -ForegroundColor Gray
Write-Host ""

try {
    Start-Process "https://localhost"
} catch {}

Write-Host "========================================================================" -ForegroundColor Cyan
Read-Host "  กดปุ่ม [Enter] เพื่อปิดหน้าต่างนี้..."
