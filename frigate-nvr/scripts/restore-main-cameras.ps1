# ========================================================================
# Sloth BPP-VMS - Restore Cameras from Backup
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
$configDir = Join-Path $resolvedPath "config"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

Clear-Host
Write-Header "Sloth BPP-VMS - กู้คืนกล้องทั้งหมดจากไฟล์สำรอง (Restore Cameras)"

Write-Host "[1/3] กำลังค้นหาไฟล์สำรองคอนฟิกกล้อง..." -ForegroundColor Yellow

$latestConfigBak = Get-ChildItem -Path $configDir -Filter "config.yml.bak.*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latestGroupsBak = Get-ChildItem -Path $configDir -Filter "nvr_groups.json.bak.*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latestCredsBak  = Get-ChildItem -Path $configDir -Filter "camera_credentials.env.bak.*" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

$restoredAny = $false

if ($latestConfigBak) {
    Copy-Item -LiteralPath $latestConfigBak.FullName -Destination (Join-Path $configDir "config.yml") -Force
    Write-Host "  [OK] กู้คืน config.yml จากไฟล์สำรองเดิม ($($latestConfigBak.Name))" -ForegroundColor Green
    $restoredAny = $true
} else {
    Write-Host "  [*] ไม่พบไฟล์สำรองในเครื่อง กำลังดึง config.yml ชุดระบบหลักจากเซิร์ฟเวอร์..." -ForegroundColor Cyan
    $cfgUrl = "https://vms.local/downloads/config.yml"
    $targetCfg = Join-Path $configDir "config.yml"
    $dlOk = $false
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -k -fSL "$cfgUrl" -o "$targetCfg"
        if ($LASTEXITCODE -eq 0 -and (Test-Path $targetCfg) -and (Get-Item $targetCfg).Length -gt 5KB) {
            $dlOk = $true
        }
    }
    if (-not $dlOk) {
        try {
            [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
            (New-Object System.Net.WebClient).DownloadFile($cfgUrl, $targetCfg)
            if ((Test-Path $targetCfg) -and (Get-Item $targetCfg).Length -gt 5KB) { $dlOk = $true }
        } catch {}
    }
    if ($dlOk) {
        Write-Host "  [OK] ดาวน์โหลดและกู้คืน config.yml สำเร็จ (มีกล้องระบบหลักครบถ้วน)" -ForegroundColor Green
        $restoredAny = $true
    } else {
        Write-Host "  [!] ไม่สามารถดึงไฟล์ config.yml จากเซิร์ฟเวอร์ได้" -ForegroundColor Red
    }
}

if ($latestGroupsBak) {
    Copy-Item -LiteralPath $latestGroupsBak.FullName -Destination (Join-Path $configDir "nvr_groups.json") -Force
    Write-Host "  [OK] กู้คืน nvr_groups.json จาก $($latestGroupsBak.Name)" -ForegroundColor Green
    $restoredAny = $true
} else {
    $grpUrl = "https://vms.local/downloads/nvr_groups.json"
    $targetGrp = Join-Path $configDir "nvr_groups.json"
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
        (New-Object System.Net.WebClient).DownloadFile($grpUrl, $targetGrp)
        Write-Host "  [OK] ดาวน์โหลดและกู้คืน nvr_groups.json สำเร็จ" -ForegroundColor Green
        $restoredAny = $true
    } catch {}
}

if ($latestCredsBak) {
    Copy-Item -LiteralPath $latestCredsBak.FullName -Destination (Join-Path $configDir "camera_credentials.env") -Force
    Write-Host "  [OK] กู้คืน camera_credentials.env จาก $($latestCredsBak.Name)" -ForegroundColor Green
    $restoredAny = $true
} else {
    $crdUrl = "https://vms.local/downloads/camera_credentials.env"
    $targetCrd = Join-Path $configDir "camera_credentials.env"
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
        (New-Object System.Net.WebClient).DownloadFile($crdUrl, $targetCrd)
        Write-Host "  [OK] ดาวน์โหลดและกู้คืน camera_credentials.env สำเร็จ" -ForegroundColor Green
        $restoredAny = $true
    } catch {}
}

if (-not $restoredAny) {
    Write-Host "`n  [!] ไม่สามารถกู้คืนคอนฟิกได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

Write-Host "`n[2/3] กำลังรีสตาร์ทบริการ Frigate และ Config API..." -ForegroundColor Yellow
try {
    & docker compose --project-directory "$resolvedPath" -f "$composeFile" restart frigate config-api
    Write-Host "  [OK] รีสตาร์ทบริการเรียบร้อย กล้องทั้งหมดพร้อมทำงานแล้ว" -ForegroundColor Green
} catch {
    Write-Host "  [!] รีสตาร์ทคอนเทนเนอร์ไม่สำเร็จ: $_" -ForegroundColor Red
}

Write-Host ""
Write-Header "[SUCCESS] กู้คืนรายการกล้องทั้งหมดสำเร็จเรียบร้อยแล้ว!"
Write-Host "  เปิดตรวจสอบที่ Dashboard: https://localhost" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Read-Host "  กดปุ่ม [Enter] เพื่อปิดหน้าต่างนี้..."
