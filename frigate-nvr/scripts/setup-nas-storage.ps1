# ==============================================================================
# BPP-VMS Physical NAS Storage & Sync Setup Helper
# ==============================================================================
# สคริปต์สำหรับเชื่อมต่อ Physical NAS (Synology, QNAP, TrueNAS, Windows Share)
# เข้ากับระบบ BPP-VMS รองรับทั้งโหมด Auto-Sync ใน Container และโหมด Directory Junction
# พร้อมรองรับ Tailscale Mesh Network ภายในตัว
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$NasIp = "",

    [Parameter(Mandatory = $false)]
    [string]$ShareName = "BPP215",

    [Parameter(Mandatory = $false)]
    [string]$DriveLetter = "Z:",

    [Parameter(Mandatory = $false)]
    [string]$NasUser = "",

    [Parameter(Mandatory = $false)]
    [string]$NasPassword = "",

    [Parameter(Mandatory = $false)]
    [string]$TailscaleAuthKey = "",

    [Parameter(Mandatory = $false)]
    [string]$TailscaleHostName = "",

    [Parameter(Mandatory = $false)]
    [ValidateSet("AutoSync", "Junction")]
    [string]$Mode = "AutoSync"
)

$ErrorActionPreference = "Stop"
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $ProjectRoot ".env"
$StorageDir = Join-Path $ProjectRoot "storage"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "  🛡️  BPP-VMS: ระบบเชื่อมต่อและตั้งค่า Physical NAS" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. รับค่า IP ของ NAS
if ([string]::IsNullOrWhiteSpace($NasIp)) {
    $NasIp = Read-Host "กรุณากรอก IP ของเครื่อง NAS (เช่น 192.168.1.100 หรือ 100.88.125.117)"
}
if ([string]::IsNullOrWhiteSpace($NasIp)) {
    Write-Host "❌ ข้อผิดพลาด: ไม่ได้ระบุ IP ของ NAS" -ForegroundColor Red
    exit 1
}

# 2. ตรวจสอบ Tailscale หากเป็น IP ในวง Tailscale (100.x.x.x)
if ($NasIp -like "100.*") {
    $currentTsKey = ""
    if (Test-Path $EnvFile) {
        $envMatch = Get-Content $EnvFile | Select-String "^TAILSCALE_AUTHKEY=(.+)"
        if ($envMatch) { $currentTsKey = $envMatch.Matches[0].Groups[1].Value.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($TailscaleAuthKey) -and [string]::IsNullOrWhiteSpace($currentTsKey)) {
        Write-Host "ℹ️ ตรวจพบว่า IP ปลายทาง ($NasIp) เป็นเครือข่าย Tailscale" -ForegroundColor Cyan
        $TailscaleAuthKey = Read-Host "กรุณากรอก Tailscale Auth Key (tskey-auth-...) เพื่อเชื่อมต่ออัตโนมัติ (หรือกด Enter หากไม่ใช้)"
    }
}

# 3. รับค่า User / Password
if ([string]::IsNullOrWhiteSpace($NasUser)) {
    $NasUser = Read-Host "กรุณากรอก Username สำหรับเข้า NAS (กด Enter หากไม่ใช้)"
}
if (-not [string]::IsNullOrWhiteSpace($NasUser) -and [string]::IsNullOrWhiteSpace($NasPassword)) {
    $secPass = Read-Host "กรุณากรอก Password สำหรับเข้า NAS ($NasUser)" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
    $NasPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# 4. ตรวจสอบการเชื่อมต่อ Network Ping และ SMB Port 445
Write-Host "[*] กำลังตรวจสอบการเชื่อมต่อไปยัง NAS ($NasIp)..." -ForegroundColor Yellow
$pingOk = Test-Connection -ComputerName $NasIp -Count 2 -Quiet
if (-not $pingOk) {
    Write-Host "⚠️ คำเตือน: ไม่สามารถ Ping ไปยัง $NasIp ได้ (อาจเกิดจาก NAS ปิด ICMP หรืออยู่คนละเครือข่าย)" -ForegroundColor Yellow
    $tcpTest = Test-NetConnection -ComputerName $NasIp -Port 445 -WarningAction SilentlyContinue
    if ($tcpTest.TcpTestSucceeded) {
        Write-Host "  ✅ แต่พบว่าพอร์ต SMB 445 เปิดอยู่และเชื่อมต่อได้ปกติ!" -ForegroundColor Green
    } else {
        $continueAnyhow = Read-Host "ต้องการดำเนินการต่อเพื่อบันทึกการตั้งค่าหรือไม่? (y/n)"
        if ($continueAnyhow -ne "y") { exit 1 }
    }
} else {
    Write-Host "  ✅ เชื่อมต่อเครือข่ายสำเร็จ (Network reachable)" -ForegroundColor Green
}

$UncPath = "\\$NasIp\$ShareName"
Write-Host "[*] Shared Folder Path: $UncPath" -ForegroundColor Gray

# 5. ฟังก์ชันอัปเดตค่าในไฟล์ .env
function Update-EnvKey {
    param([string]$Path, [hashtable]$Entries)
    if (-not (Test-Path $Path)) {
        if (Test-Path "$Path.example") { Copy-Item "$Path.example" $Path }
        else { New-Item -ItemType File -Path $Path -Force | Out-Null }
    }
    $lines = Get-Content -Path $Path -Encoding UTF8
    $newLines = [System.Collections.Generic.List[string]]::new()
    $processed = [System.Collections.Generic.HashSet[string]]::new()

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("#") -or [string]::IsNullOrWhiteSpace($trimmed)) {
            $newLines.Add($line)
            continue
        }
        $eqIdx = $line.IndexOf('=')
        if ($eqIdx -gt 0) {
            $k = $line.Substring(0, $eqIdx).Trim()
            if ($Entries.ContainsKey($k)) {
                $newLines.Add("$k=$($Entries[$k])")
                $processed.Add($k) | Out-Null
                continue
            }
        }
        $newLines.Add($line)
    }

    foreach ($k in $Entries.Keys) {
        if (-not $processed.Contains($k)) {
            $newLines.Add("$k=$($Entries[$k])")
        }
    }
    [System.IO.File]::WriteAllLines($Path, $newLines, [System.Text.Encoding]::UTF8)
}

# ==============================================================================
# MODE A: AutoSync (Two-Tier Container Auto-Sync & Web Archive Retrieval)
# ==============================================================================
if ($Mode -eq "AutoSync") {
    Write-Host "`n[*] [Mode: AutoSync] กำลังบันทึกการตั้งค่าลงไฟล์ .env สำหรับระบบ Background Sync..." -ForegroundColor Yellow
    $envValues = @{
        "NAS_HOST" = $NasIp
        "NAS_SHARE" = $ShareName
        "NAS_USERNAME" = $NasUser
        "NAS_PASSWORD" = $NasPassword
        "NAS_SYNC_ENABLED" = "true"
        "NAS_SYNC_DEBOUNCE_SEC" = "8"
        "NAS_VIDEO_ARCHIVE_ENABLED" = "true"
        "NAS_VIDEO_ARCHIVE_INTERVAL_MIN" = "15"
    }
    if (-not [string]::IsNullOrWhiteSpace($TailscaleAuthKey)) {
        $envValues["TAILSCALE_AUTHKEY"] = $TailscaleAuthKey
    }
    if (-not [string]::IsNullOrWhiteSpace($TailscaleHostName)) {
        $envValues["TAILSCALE_HOSTNAME"] = $TailscaleHostName
    }

    Update-EnvKey -Path $EnvFile -Entries $envValues
    Write-Host "  ✅ บันทึกค่า NAS ลงไฟล์ .env เรียบร้อยแล้ว" -ForegroundColor Green

    # รีสตาร์ท container tailscale และ nas-bot หาก Docker รันอยู่
    Push-Location $ProjectRoot
    try {
        $dockerRunning = (docker compose ps 2>&1 | Select-String "tailscale") -ne $null
        if ($dockerRunning) {
            Write-Host "[*] กำลังปรับใช้การตั้งค่ากับคอนเทนเนอร์ tailscale และ nas-bot..." -ForegroundColor Yellow
            docker compose up -d --no-deps tailscale nas-bot 2>&1 | Out-Null
            Write-Host "  ✅ คอนเทนเนอร์ tailscale และ nas-bot รีสตาร์ทเรียบร้อยแล้ว" -ForegroundColor Green
            
            Start-Sleep -Seconds 3
            try {
                $testRes = Invoke-RestMethod -Uri "http://localhost:5005/api/nas-bot/sync/test-connection" -TimeoutSec 5 -ErrorAction SilentlyContinue
                if ($testRes.status -eq "success") {
                    Write-Host "  🎉 เชื่อมต่อไปยัง NAS สำเร็จสมบูรณ์! (Authentication Successful)" -ForegroundColor Green
                } elseif ($testRes.message) {
                    Write-Host "  ⚠️ ผลการทดสอบจากระบบ: $($testRes.message)" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "  ℹ️ ระบบพื้นหลังพร้อมทำงาน (สามารถทดสอบได้ที่หน้าเว็บ Dashboard)" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "  ℹ️ ยังไม่ได้เริ่ม Docker ระบบจะใช้การตั้งค่าใหม่เมื่อเปิด Docker ครั้งถัดไป" -ForegroundColor Gray
    }
    Pop-Location

    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "  🎉 การตั้งค่า NAS Auto-Sync เสร็จสมบูรณ์!" -ForegroundColor Green
    Write-Host "  - NAS Server: \\$NasIp\$ShareName" -ForegroundColor White
    Write-Host "  - ผู้ใช้งาน: $NasUser" -ForegroundColor White
    Write-Host "  - บันทึกวิดีโอหลัก: ทำงานบนไดรฟ์เครื่องนี้ (Local Disk) เร็วและเสถียรที่สุด" -ForegroundColor White
    Write-Host "  - การสำรองข้อมูล: nas-bot-service จะคอยสำรองไฟล์และวิดีโอขึ้น NAS อัตโนมัติ" -ForegroundColor White
    Write-Host "  - คลังย้อนหลัง: สามารถเรียกดู/ดึงวิดีโอผ่านปุ่ม 'คลังวิดีโอ NAS (Archive)' บนแดชบอร์ด" -ForegroundColor White
    Write-Host "========================================================`n" -ForegroundColor Green
    exit 0
}

# ==============================================================================
# MODE B: Junction (Legacy Network Drive Directory Junction)
# ==============================================================================
if (-not $DriveLetter.EndsWith(":")) { $DriveLetter = "$($DriveLetter):" }

# ตรวจสอบหรือ Map Network Drive
if (Get-PSDrive -Name $DriveLetter.TrimEnd(':') -ErrorAction SilentlyContinue) {
    Write-Host "[*] พบไดรฟ์ $DriveLetter เชื่อมต่ออยู่แล้ว" -ForegroundColor Green
} else {
    Write-Host "[*] กำลังเชื่อมต่อไดรฟ์ $DriveLetter ไปยัง $UncPath..." -ForegroundColor Yellow
    if (-not [string]::IsNullOrWhiteSpace($NasUser)) {
        cmd.exe /c "net use $DriveLetter `"$UncPath`" `"$NasPassword`" /user:`"$NasUser`" /persistent:yes"
    } else {
        cmd.exe /c "net use $DriveLetter `"$UncPath`" /persistent:yes"
    }

    if (-not (Get-PSDrive -Name $DriveLetter.TrimEnd(':') -ErrorAction SilentlyContinue)) {
        Write-Host "❌ ไม่สามารถ Map Network Drive $DriveLetter ไปยัง $UncPath ได้" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✅ Map Drive $DriveLetter สำเร็จเรียบร้อย" -ForegroundColor Green
}

$NasRecordingsDir = Join-Path "$DriveLetter\" "recordings"
$NasIntelDir = Join-Path "$DriveLetter\" "nas-storage"

if (-not (Test-Path $NasRecordingsDir)) {
    New-Item -ItemType Directory -Path $NasRecordingsDir -Force | Out-Null
}
if (-not (Test-Path $NasIntelDir)) {
    New-Item -ItemType Directory -Path $NasIntelDir -Force | Out-Null
}

$isJunction = $false
if (Test-Path $StorageDir) {
    $item = Get-Item $StorageDir
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $isJunction = $true
        Write-Host "  ℹ️ โฟลเดอร์ storage เป็น Junction Link อยู่แล้ว ชี้ไปที่ NAS แล้ว" -ForegroundColor Green
    }
}

if (-not $isJunction) {
    Push-Location $ProjectRoot
    try { docker compose stop frigate 2>$null } catch {}
    Pop-Location

    if (Test-Path $StorageDir) {
        $existingFiles = Get-ChildItem -Path $StorageDir -Force
        if ($existingFiles.Count -gt 0) {
            Write-Host "[*] พบไฟล์บันทึกเดิม กำลังย้ายไปยัง NAS ($NasRecordingsDir)..." -ForegroundColor Yellow
            Copy-Item -Path "$StorageDir\*" -Destination $NasRecordingsDir -Recurse -Force
        }
        $backupOld = "${StorageDir}_local_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Rename-Item -Path $StorageDir -NewName $backupOld
        Write-Host "  📦 สำรองโฟลเดอร์ storage เดิมไว้ที่: $backupOld" -ForegroundColor Gray
    }

    cmd.exe /c "mklink /J `"$StorageDir`" `"$NasRecordingsDir`""

    if (Test-Path $StorageDir) {
        Write-Host "  ✅ สร้างจุดเชื่อมต่อ (Junction Link) ไปยัง NAS สำเร็จสมบูรณ์!" -ForegroundColor Green
    } else {
        Write-Host "❌ สร้าง Junction Link ล้มเหลว" -ForegroundColor Red
        exit 1
    }

    Push-Location $ProjectRoot
    try { docker compose start frigate 2>$null } catch {}
    Pop-Location
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  🎉 การตั้งค่า NAS Junction เสร็จสมบูรณ์เรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green
