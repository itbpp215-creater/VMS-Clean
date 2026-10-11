# ========================================================================
# Sloth BPP-VMS - 1-Click Telegram Bot Setup & Activator
# กำหนดค่า Telegram Bot Token และเริ่มบริการ nas-bot-service
# ========================================================================

[CmdletBinding()]
param(
    [string]$InstallPath = "$PSScriptRoot\..",
    [string]$BotToken = ""
)

[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$resolvedPath = (Resolve-Path $InstallPath).Path
Set-Location $resolvedPath
$composeFile = Join-Path $resolvedPath "docker-compose.yml"
$envFile = Join-Path $resolvedPath ".env"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
}

Clear-Host
Write-Header "Sloth BPP-VMS - ตั้งค่าและเปิดใช้งาน Telegram Bot ประจำเครื่อง"

# 1. ตรวจสอบ Docker
Write-Host "[1/3] กำลังตรวจสอบ Docker Desktop..." -ForegroundColor Yellow
try {
    $null = & docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
    Write-Host "  [OK] Docker Engine พร้อมทำงาน" -ForegroundColor Green
} catch {
    Write-Host "  [!] Docker Desktop ยังไม่ได้เปิดทำงาน กรุณาเปิด Docker ก่อนดำเนินการ" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

# 2. สอบถาม Bot Token
Write-Host "`n[2/3] กำหนดค่า Telegram Bot Token:" -ForegroundColor Yellow
if ([string]::IsNullOrWhiteSpace($BotToken)) {
    Write-Host "  กรุณานำ Bot Token ที่ได้รับจาก @BotFather บน Telegram มาใส่ด้านล่าง" -ForegroundColor White
    Write-Host "  (ตัวอย่าง: 8367725255:AAE1Xx2cYMRZ4GkZXirohcPr3RAu--wtIeM)" -ForegroundColor Gray
    Write-Host ""
    $BotToken = Read-Host "  วาง Telegram Bot Token แล้วกด [Enter]"
}

if ([string]::IsNullOrWhiteSpace($BotToken)) {
    Write-Host "  [!] ไม่ได้ระบุ Bot Token ยกเลิกการตั้งค่า" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

$BotToken = $BotToken.Trim()

# บันทึกลง .env
$envLines = @()
$tokenFound = $false
if (Test-Path $envFile) {
    $existing = Get-Content $envFile -Encoding UTF8
    foreach ($line in $existing) {
        if ($line -match "^TELEGRAM_BOT_TOKEN=") {
            $envLines += "TELEGRAM_BOT_TOKEN=$BotToken"
            $tokenFound = $true
        } else {
            $envLines += $line
        }
    }
}
if (-not $tokenFound) {
    $envLines += "TELEGRAM_BOT_TOKEN=$BotToken"
}

[System.IO.File]::WriteAllLines($envFile, $envLines, [System.Text.Encoding]::UTF8)
Write-Host "  [OK] บันทึก TELEGRAM_BOT_TOKEN ลงในไฟล์ .env สำเร็จ" -ForegroundColor Green

# 3. สตาร์ทคอนเทนเนอร์ nas-bot-service
Write-Host "`n[3/3] กำลังเริ่มการทำงานคอนเทนเนอร์ nas-bot-service..." -ForegroundColor Yellow
try {
    & docker compose --project-directory "$resolvedPath" -f "$composeFile" up -d nas-bot
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
    Write-Host "  [*] กำลังรอระบบเริ่มต้นทำงาน..." -NoNewline -ForegroundColor Gray
    Start-Sleep -Seconds 5
    Write-Host " เสร็จสิ้น" -ForegroundColor Green
} catch {
    Write-Host "  [!] ไม่สามารถสตาร์ทคอนเทนเนอร์ nas-bot ได้: $_" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

Write-Host "`n========================================================================" -ForegroundColor Green
Write-Host "  [SUCCESS] เปิดใช้งาน Telegram Bot ประจำเครื่องสำเร็จเรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "  ขั้นตอนต่อไปในการผูกบัญชี:" -ForegroundColor White
Write-Host "  1. เปิดหน้าเว็บ Dashboard (รีเฟรชหน้าเว็บ 1 ครั้ง)" -ForegroundColor White
Write-Host "  2. เปิดหน้าต่างแชท แล้วคลิกปุ่ม [ผูกบัญชี] (หรือพิมพ์ /pair)" -ForegroundColor White
Write-Host "  3. ระบบจะแสดงรหัส 6 หลัก (Pairing Code)" -ForegroundColor White
Write-Host "  4. ส่งรหัสนั้นให้บอทของคุณใน Telegram เพื่อผูกบัญชีได้ทันทีครับ!" -ForegroundColor White
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "กดปุ่มใดๆ เพื่อปิดหน้าต่างนี้..."
try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch {}
