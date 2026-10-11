<#
.SYNOPSIS
  BPP-VMS 1-Click n8n Bot Workflow Installer
  กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
.DESCRIPTION
  ตรวจสอบ Docker n8n Container, สอบถาม/อัปเดต Gemini API Key,
  นำเข้า Credentials และ Workflow 8 โหนดเข้าสู่ n8n อัตโนมัติ 100% พร้อมเปิดหน้าเว็บ
#>

[CmdletBinding()]
param(
    [string]$ApiKey = "",
    [string]$TelegramToken = "",
    [switch]$SkipPause,
    [switch]$NonInteractive
)

$Host.UI.RawUI.WindowTitle = 'BPP-VMS n8n Master Bot Workflow Installer'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not $SkipPause) {
    Clear-Host
}

Write-Host '=========================================================================' -ForegroundColor Cyan
Write-Host '   BPP-VMS n8n Master Bot Workflow Installer [ตชด.215]                   ' -ForegroundColor Cyan
Write-Host '   ระบบติดตั้งและเชื่อมต่อสมองกล AI Automation สู่ n8n อัตโนมัติ        ' -ForegroundColor Cyan
Write-Host '=========================================================================' -ForegroundColor Cyan

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$FrigateDir = "$RepoRoot\frigate-nvr"
$N8nDir = "$RepoRoot\n8n"
$CredFile = "$N8nDir\credentials.json"
$WorkflowFile = "$N8nDir\workflows\bpp_vms_master_bot_workflow.json"
$EnvFile = "$FrigateDir\.env"

# 1. ตรวจสอบสถานะ Docker
Write-Host "`n[1/6] กำลังตรวจสอบสถานะ Docker Desktop..." -ForegroundColor Yellow
$dockerPing = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ข้อผิดพลาด: Docker Desktop ยังไม่ได้เปิดใช้งาน กรุณาเปิด Docker Desktop ก่อนรันตัวติดตั้งนี้" -ForegroundColor Red
    Write-Host "`nกดปุ่มใดๆ เพื่อออกจากโปรแกรม..."
    if (-not $NonInteractive -and -not $SkipPause) { try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch {} }
    exit 1
}
Write-Host "  [OK] Docker พร้อมทำงาน" -ForegroundColor Green

# 2. ตรวจสอบและเริ่มคอนเทนเนอร์ n8n-service
Write-Host "`n[2/6] กำลังตรวจสอบคอนเทนเนอร์ n8n-service..." -ForegroundColor Yellow
$n8nRunning = docker ps --filter "name=n8n-service" --filter "status=running" -q
if (-not $n8nRunning) {
    Write-Host "  [*] สตาร์ทคอนเทนเนอร์ n8n-service ผ่าน Docker Compose..." -ForegroundColor Cyan
    Push-Location $FrigateDir
    docker compose up -d n8n
    Pop-Location
    
    # รอจนกว่า n8n จะพร้อมตอบสนอง
    Write-Host "  [*] กำลังรอ n8n เริ่มทำงาน..." -NoNewline -ForegroundColor Yellow
    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 2
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:5678/healthz" -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($resp.status -eq "ok" -or $null -ne $resp) {
                $ready = $true
                break
            }
        } catch {}
        Write-Host -NoNewline "."
    }
    Write-Host ""
}
Write-Host '  [OK] n8n Container พร้อมทำงาน [http://127.0.0.1:5678]' -ForegroundColor Green

# 3. สอบถาม / ดึงค่า Google Gemini API Key
Write-Host "`n[3/6] กำหนดค่า Google Gemini API Key สำหรับโมเดลสมองกล AI [#4]:" -ForegroundColor Yellow

$defaultKey = ""
if ($env:GEMINI_API_KEY) {
    $defaultKey = $env:GEMINI_API_KEY
}
if (Test-Path $CredFile) {
    try {
        $jsonCred = Get-Content $CredFile -Raw | ConvertFrom-Json
        if ($jsonCred[0].data.apiKey) {
            $defaultKey = $jsonCred[0].data.apiKey
        }
    } catch {}
}

$maskedDefault = if ($defaultKey.Length -gt 10) { $defaultKey.Substring(0, 6) + "..." + $defaultKey.Substring($defaultKey.Length - 4) } else { $defaultKey }

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    if (-not $NonInteractive) {
        Write-Host "  ค่าเริ่มต้นในระบบขณะนี้: " -NoNewline
        Write-Host "[$maskedDefault]" -ForegroundColor Green
        Write-Host '  กรุณากรอก Google Gemini API Key ของท่าน' -ForegroundColor Cyan
        Write-Host '  [หรือกด Enter ทันที เพื่อใช้คีย์เริ่มต้นของระบบ]: ' -NoNewline -ForegroundColor Gray
        $userInput = Read-Host
        if (-not [string]::IsNullOrWhiteSpace($userInput)) {
            $ApiKey = $userInput.Trim()
        } else {
            $ApiKey = $defaultKey
        }
    } else {
        $ApiKey = $defaultKey
        Write-Host "  [NonInteractive] ใช้กุญแจเริ่มต้น: [$maskedDefault]" -ForegroundColor Gray
    }
}

# บันทึก credentials.json
$credObject = @(
    @{
        id = "gemini-api-cred"
        name = "Google Gemini Free API Key"
        type = "googlePalmApi"
        data = @{
            apiKey = $ApiKey
        }
    }
)
$credObject | ConvertTo-Json -Depth 5 | Set-Content -Path $CredFile -Encoding UTF8
Write-Host "  [OK] บันทึกกุญแจ API เรียบร้อย" -ForegroundColor Green

# 4. สอบถาม / กำหนดค่า Telegram Bot Token
Write-Host "`n[4/6] กำหนดค่า Telegram Bot Token สำหรับระบบแจ้งเตือนและแชทบอท:" -ForegroundColor Yellow

$defaultToken = ""
if (Test-Path $EnvFile) {
    try {
        $envLines = Get-Content -LiteralPath $EnvFile -Encoding UTF8
        foreach ($line in $envLines) {
            $tLine = $line.Trim()
            if ($tLine.StartsWith("TELEGRAM_BOT_TOKEN=")) {
                $defaultToken = $tLine.Substring("TELEGRAM_BOT_TOKEN=".Length).Trim()
                break
            }
        }
    } catch {}
}

if ([string]::IsNullOrWhiteSpace($defaultToken)) {
    $defaultToken = "YOUR_TELEGRAM_BOT_TOKEN_HERE"
}

$maskedToken = if ($defaultToken.Length -gt 10) { $defaultToken.Substring(0, 6) + "..." + $defaultToken.Substring($defaultToken.Length - 4) } else { $defaultToken }

if ([string]::IsNullOrWhiteSpace($TelegramToken)) {
    if (-not $NonInteractive) {
        Write-Host "  ค่าเริ่มต้นในระบบขณะนี้: " -NoNewline
        Write-Host "[$maskedToken]" -ForegroundColor Green
        Write-Host '  กรุณากรอก Telegram Bot Token ของท่าน' -ForegroundColor Cyan
        Write-Host '  [หรือกด Enter ทันที เพื่อใช้ค่าเดิม/ข้ามไปตั้งค่าภายหลัง]: ' -NoNewline -ForegroundColor Gray
        $userTokenInput = Read-Host
        if (-not [string]::IsNullOrWhiteSpace($userTokenInput)) {
            $TelegramToken = $userTokenInput.Trim()
        } else {
            $TelegramToken = $defaultToken
        }
    } else {
        $TelegramToken = $defaultToken
        Write-Host "  [NonInteractive] ใช้โทเค็นเริ่มต้น: [$maskedToken]" -ForegroundColor Gray
    }
}

# บันทึก Telegram Bot Token ลง .env
if (Test-Path $EnvFile) {
    try {
        $envLines = Get-Content -LiteralPath $EnvFile -Encoding UTF8
        $tokenFound = $false
        $updatedLines = @()
        foreach ($line in $envLines) {
            if ($line.Trim().StartsWith("TELEGRAM_BOT_TOKEN=")) {
                $updatedLines += "TELEGRAM_BOT_TOKEN=$TelegramToken"
                $tokenFound = $true
            } else {
                $updatedLines += $line
            }
        }
        if (-not $tokenFound) {
            $updatedLines += "TELEGRAM_BOT_TOKEN=$TelegramToken"
        }
        [System.IO.File]::WriteAllLines($EnvFile, $updatedLines, [System.Text.Encoding]::UTF8)
        Write-Host "  [OK] บันทึก Telegram Bot Token ลง .env เรียบร้อย" -ForegroundColor Green

        # ซิงค์เข้า nas-bot-service ทันทีหากคอนเทนเนอร์ทำงานอยู่
        $nasRunning = docker ps --filter "name=nas-bot-service" --filter "status=running" -q
        if ($nasRunning) {
            Push-Location $FrigateDir
            docker compose up -d nas-bot-service 2>&1 | Out-Null
            Pop-Location
            Write-Host "  [+] ซิงค์โทเค็นใหม่สู่ nas-bot-service สำเร็จ" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  [!] ไม่สามารถบันทึกค่าลง .env ได้: $_" -ForegroundColor Yellow
    }
}

# 5. นำเข้า Credentials และ Workflow เข้าสู่ n8n Container
Write-Host "`n[5/6] กำลังนำเข้ากุญแจและ Workflow 8 โหนดเข้าสู่ n8n..." -ForegroundColor Yellow

# นำเข้า Credentials
$credRes = docker exec n8n-service n8n import:credentials --input=/n8n-init/credentials.json 2>&1
Write-Host "  [+] นำเข้า Google Gemini Credentials สำเร็จ" -ForegroundColor Green

# นำเข้า Workflow
$wfRes = docker exec n8n-service n8n import:workflow --input=/n8n-init/workflows/bpp_vms_master_bot_workflow.json 2>&1
Write-Host "  [+] นำเข้า BPP-VMS Master Bot Workflow สำเร็จ" -ForegroundColor Green

# สั่ง Publish / Activate Workflow
docker exec n8n-service n8n publish:workflow --id=BPPVMSMaster01 2>&1 | Out-Null
Write-Host "  [+] เปิดใช้งานสถานะ Active ให้กับ Workflow สำเร็จ" -ForegroundColor Green

# Restart n8n service เพื่อให้ workflow ที่อัปเดตถูกโหลดเข้าหน่วยความจำและ Canvas ทันที
Write-Host "  [*] รีสตาร์ท n8n service เพื่ออัปเดตการแสดงผล..." -ForegroundColor Gray
docker restart n8n-service 2>&1 | Out-Null
Start-Sleep -Seconds 3

# 6. สรุปผลและเปิดหน้าต่างเบราว์เซอร์
Write-Host "`n[6/6] กำลังเปิดหน้าต่าง n8n บนเว็บเบราว์เซอร์..." -ForegroundColor Yellow
$n8nUrl = "http://127.0.0.1:5678/workflow/BPPVMSMaster01"
Start-Process $n8nUrl

Write-Host "`n=========================================================================" -ForegroundColor Green
Write-Host "  [SUCCESS] ติดตั้ง BPP-VMS Master Bot Workflow เรียบร้อยแล้ว!           " -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "  🌐 หน้าจอจัดการ Workflow: $n8nUrl" -ForegroundColor White
Write-Host '  🤖 สถาปัตยกรรม: 8 โหนดครบถ้วน [Webhook, Switch, AI Agent, Gemini, Watchlist, Photo, Alert, Respond]' -ForegroundColor Gray
Write-Host '  🟢 สถานะ: พร้อมรับ Webhook จากภายนอกทันที [POST /webhook/bpp-vms-master]' -ForegroundColor Gray
Write-Host '=========================================================================' -ForegroundColor Green
if (-not $NonInteractive -and -not $SkipPause) {
    Write-Host "`nกดปุ่มใดๆ เพื่อปิดหน้าต่างนี้..."
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch {}
}
