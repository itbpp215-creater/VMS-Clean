# ========================================================================
# Sloth BPP-VMS - Export Clean Installer Package (Zero-GitHub)
# กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
# ========================================================================

[CmdletBinding()]
param(
    [string]$InstallPath = ""
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([string]::IsNullOrWhiteSpace($InstallPath)) {
    $InstallPath = Join-Path $PSScriptRoot ".."
}
$resolvedPath = (Resolve-Path $InstallPath).Path
[System.IO.Directory]::SetCurrentDirectory($resolvedPath)
Set-Location $resolvedPath
$gitRoot = (Split-Path -Parent $resolvedPath)

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

Clear-Host
Write-Header "Sloth BPP-VMS - ส่งออกชุดติดตั้งสำหรับเครื่องใหม่ (Zero-GitHub Package)"

Write-Host "[1/3] กำลังตรวจสอบสถานะ Git Repository..." -ForegroundColor Yellow
Push-Location $gitRoot

if (-not (Test-Path ".git")) {
    Write-Host "  [!] ไม่พบโฟลเดอร์ .git บนเครื่องนี้ ไม่สามารถสร้าง Release Package ได้" -ForegroundColor Red
    Pop-Location
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

$rootZip = Join-Path $gitRoot "bpp-vms-installer.zip"
$webDownloadsDir = Join-Path $resolvedPath "web\downloads"
if (-not (Test-Path $webDownloadsDir)) {
    New-Item -ItemType Directory -Path $webDownloadsDir -Force | Out-Null
}
$webZip = Join-Path $webDownloadsDir "bpp-vms-installer.zip"

Write-Host "  [OK] Git Repository พร้อมทำงาน`n" -ForegroundColor Green

Write-Host "[2/3] กำลังสร้างไฟล์ติดตั้ง bpp-vms-installer.zip..." -ForegroundColor Yellow
Write-Host "  [*] รวมเฉพาะโค้ดระบบและสคริปต์ควบคุมทั้งหมด (Exclude: .git, .env, storage, databases)..." -ForegroundColor Gray

try {
    # สร้างแพ็กเกจ ZIP โดยกำหนด Root Folder เป็น BPP-VMS/ ทันที
    & git archive --format=zip --prefix=BPP-VMS/ HEAD -o $rootZip
    if ($LASTEXITCODE -ne 0) {
        throw "git archive exited with code $LASTEXITCODE"
    }

    # รวมไฟล์โมเดล AI และคอนฟิกเริ่มต้นที่จำเป็นต่อการรันคอนเทนเนอร์ (ซึ่งอยู่นอก Git) เข้าไปใน ZIP
    Write-Host "  [*] กำลังรวมไฟล์โมเดล AI LPR และการตั้งค่าเริ่มต้นลงในแพ็กเกจ..." -ForegroundColor Gray
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipArchive = [System.IO.Compression.ZipFile]::Open($rootZip, "Update")

    $extraFiles = @(
        @{ Local = "frigate-nvr\config\model_cache\yolo11m-640.onnx"; Entry = "BPP-VMS/frigate-nvr/config/model_cache/yolo11m-640.onnx" },
        @{ Local = "frigate-nvr\LicensePlateRECOG\model\license_plate.pt"; Entry = "BPP-VMS/frigate-nvr/LicensePlateRECOG/model/license_plate.pt" },
        @{ Local = "frigate-nvr\LicensePlateRECOG\model\data_plate.pt"; Entry = "BPP-VMS/frigate-nvr/LicensePlateRECOG/model/data_plate.pt" },
        @{ Local = "frigate-nvr\config\lpr\lpr_cameras.txt"; Entry = "BPP-VMS/frigate-nvr/config/lpr/lpr_cameras.txt" },
        @{ Local = "frigate-nvr\config\lpr\lpr_zones.json"; Entry = "BPP-VMS/frigate-nvr/config/lpr/lpr_zones.json" },
        @{ Local = "frigate-nvr\config\lpr\suspect_plates.txt"; Entry = "BPP-VMS/frigate-nvr/config/lpr/suspect_plates.txt" },
        @{ Local = "frigate-nvr\config\dashboard-settings\storage-policy\storage_threshold"; Entry = "BPP-VMS/frigate-nvr/config/dashboard-settings/storage-policy/storage_threshold" }
    )

    foreach ($item in $extraFiles) {
        $sourcePath = Join-Path $gitRoot $item.Local
        if (Test-Path $sourcePath) {
            $existing = $zipArchive.GetEntry($item.Entry)
            if ($existing) { $existing.Delete() }
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $sourcePath, $item.Entry) | Out-Null
            Write-Host "      + $($item.Local)" -ForegroundColor DarkGray
        } else {
            Write-Host "      [!] ไม่พบไฟล์ $sourcePath" -ForegroundColor Yellow
        }
    }
    $zipArchive.Dispose()

    # คัดลอกไปยัง web/downloads เพื่อให้ดาวน์โหลดผ่านเว็บได้
    Copy-Item -LiteralPath $rootZip -Destination $webZip -Force
    $webRootZip = Join-Path $resolvedPath "web\bpp-vms-installer.zip"
    Copy-Item -LiteralPath $rootZip -Destination $webRootZip -Force

    # คัดลอกไปยัง Synology NAS (updates/) ถ้ามีการเชื่อมต่อเครือข่าย NAS
    try {
        $envFile = Join-Path $resolvedPath ".env"
        if (Test-Path $envFile) {
            $nasHost = ""
            $nasShare = ""
            Get-Content $envFile | ForEach-Object {
                $line = $_.Trim()
                if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
                    $parts = $line.Split("=", 2)
                    if ($parts[0].Trim() -eq "NAS_HOST") { $nasHost = $parts[1].Trim().Trim('"').Trim("'") }
                    if ($parts[0].Trim() -eq "NAS_SHARE") { $nasShare = $parts[1].Trim().Trim('"').Trim("'") }
                }
            }
            if ($nasHost -and $nasShare) {
                $nasUpdatesDir = "\\$nasHost\$nasShare\updates"
                if (Test-Path "\\$nasHost\$nasShare") {
                    if (-not (Test-Path $nasUpdatesDir)) {
                        New-Item -ItemType Directory -Path $nasUpdatesDir -Force | Out-Null
                    }
                    Copy-Item -LiteralPath $rootZip -Destination (Join-Path $nasUpdatesDir "bpp-vms-installer.zip") -Force
                    Write-Host "  [+] ซิงค์ชุดติดตั้งไปยัง Synology NAS สำเร็จ: $nasUpdatesDir\bpp-vms-installer.zip" -ForegroundColor Green
                }
            }
        }
    } catch {
        Write-Host "  [*] ข้ามการซิงค์ไปยัง NAS (ไม่ได้เชื่อมต่อหรือยังไม่ได้เมานต์เครือข่าย)" -ForegroundColor DarkGray
    }

    $zipItem = Get-Item -LiteralPath $rootZip
    $zipMb = [math]::Round($zipItem.Length / 1MB, 2)
    Write-Host "  [OK] สร้างแพ็กเกจติดตั้งสำเร็จเรียบร้อย! (ขนาด: $zipMb MB)`n" -ForegroundColor Green
} catch {
    Write-Host "  [!] เกิดข้อผิดพลาดในการสร้างไฟล์ ZIP: $_" -ForegroundColor Red
    Pop-Location
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}
Pop-Location

# รับ IP ของเครื่อง
$localIP = "localhost"
try {
    $ipObj = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "vEthernet|Loopback" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1)
    if ($ipObj) { $localIP = $ipObj.IPAddress }
} catch {}

Write-Host "[3/3] สรุปช่องทางการนำไปติดตั้งบนเครื่องใหม่ (Zero-GitHub):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  🔹 วิธีที่ 1: ก๊อปปี้ผ่าน Flash Drive (ออฟไลน์ 100%)" -ForegroundColor White
Write-Host "     - นำไฟล์นี้ไปใส่ Flash Drive: " -NoNewline -ForegroundColor Gray
Write-Host "$rootZip" -ForegroundColor Cyan
Write-Host "     - นำไปเสียบที่เครื่องใหม่ และแตกไฟล์ (Extract) ลงที่ไดรฟ์ D:\" -ForegroundColor Gray
Write-Host "     - จะได้โฟลเดอร์ D:\BPP-VMS ตามโครงสร้างคู่มือทันที!" -ForegroundColor Green
Write-Host ""
Write-Host "  🔹 วิธีที่ 2: ดาวน์โหลดผ่านหน้าเว็บ / ลิงก์ตรง (ไม่ต้องล็อกอิน GitHub)" -ForegroundColor White
Write-Host "     - เปิดเบราว์เซอร์จากเครื่องใหม่ แล้วดาวน์โหลดผ่านลิงก์:" -ForegroundColor Gray
Write-Host "       --> https://vms.local/downloads/bpp-vms-installer.zip" -ForegroundColor Green
if ($localIP -ne "127.0.0.1") {
    Write-Host "       --> https://${localIP}/downloads/bpp-vms-installer.zip (Local LAN)" -ForegroundColor Cyan
}
Write-Host "       (หรือดาวน์โหลดผ่านเมนูคู่มือบนหน้าเว็บหลัก)" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  [SUCCESS] แพ็กเกจพร้อมนำไปใช้งานบนเครื่องใหม่เรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
