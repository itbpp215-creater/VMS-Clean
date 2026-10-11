# ==============================================================================
# BPP-VMS On-Demand Video Restore Utility (From Synology NAS)
# ==============================================================================
# สคริปต์สำหรับดึงไฟล์บันทึกวิดีโอย้อนหลังที่สำรองไว้บน NAS
# เมื่อ SSD ในเครื่องบันทึกทับไฟล์เดิมไปแล้ว
# รองรับ 2 โหมด:
#   1. Evidence Mode: รวมคลิปทุกนาทีเป็นไฟล์ MP4 หลักฐานชุดเดียว (FFmpeg Stream Copy)
#   2. Timeline Mode: ดึงคลิปย่อยกลับมาลง SSD ในโฟลเดอร์ recordings เพื่อดูบน Timeline
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$Camera,

    [Parameter(Mandatory = $false)]
    [string]$Date,

    [Parameter(Mandatory = $false)]
    [int]$StartHour = -1,

    [Parameter(Mandatory = $false)]
    [int]$EndHour = -1,

    [Parameter(Mandatory = $false)]
    [ValidateSet("evidence", "timeline")]
    [string]$Mode = "evidence",

    [Parameter(Mandatory = $false)]
    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$exportsDir = Join-Path $projectRoot "storage\exports"

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   BPP-VMS - คลังวิดีโอ NAS & กู้คืนไฟล์ย้อนหลัง (On-Demand Video Restore)   " -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. ตรวจสอบสถานะ API ของ nas-bot-service
$apiBase = "http://127.0.0.1:5005"
try {
    $statusRes = Invoke-RestMethod -Uri "$apiBase/api/nas-bot/sync/status" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "[INFO] เชื่อมต่อ nas-bot-service สำเร็จ" -ForegroundColor Green
    if ($statusRes.connected) {
        Write-Host "       🟢 NAS ออนไลน์: \\$($statusRes.nas_host)\$($statusRes.nas_share)" -ForegroundColor Green
    } else {
        Write-Host "       🟡 NAS ยังไม่ได้เชื่อมต่อหรือออฟไลน์ (จะค้นหาจาก SSD ในเครื่องและ NAS เมื่อต่อติด)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[WARN] ไม่สามารถติดต่อ nas-bot-service ได้ (Container อาจกำลังเริ่มต้น)" -ForegroundColor Yellow
}

# 2. ดึงรายการวันที่และกล้องที่มีบันทึก
Write-Host ""
Write-Host "กำลังค้นหารายการวันที่และกล้องที่มีบันทึกในระบบ..." -ForegroundColor Cyan
try {
    $datesData = Invoke-RestMethod -Uri "$apiBase/api/nas-bot/video-archive/dates" -TimeoutSec 5 -ErrorAction Stop
} catch {
    $datesData = @()
}

# Interactive prompts if parameters missing
if (-not $Camera) {
    $availableCams = @()
    foreach ($d in $datesData) {
        if ($d.cameras) {
            foreach ($c in $d.cameras) {
                if ($availableCams -notcontains $c) { $availableCams += $c }
            }
        }
    }
    if ($availableCams.Count -eq 0) {
        $availableCams = @("D_BPP215_1", "D_BPP215_2", "D_BPP215_3", "KK06")
    }

    Write-Host "รายการกล้องที่พบในระบบ:" -ForegroundColor White
    for ($i = 0; $i -lt $availableCams.Count; $i++) {
        Write-Host "  [$($i+1)] $($availableCams[$i])" -ForegroundColor Gray
    }
    $camChoice = Read-Host "เลือกหมายเลขกล้อง หรือพิมพ์ชื่อกล้อง (ค่าเริ่มต้น 1)"
    if ([string]::IsNullOrWhiteSpace($camChoice)) { $camChoice = "1" }
    if ($camChoice -match "^\d+$" -and [int]$camChoice -le $availableCams.Count) {
        $Camera = $availableCams[[int]$camChoice - 1]
    } else {
        $Camera = $camChoice.Trim()
    }
}

if (-not $Date) {
    if ($datesData.Count -gt 0) {
        Write-Host ""
        Write-Host "วันที่พบล่าสุดในคลัง:" -ForegroundColor White
        $maxShow = [Math]::Min(10, $datesData.Count)
        for ($i = 0; $i -lt $maxShow; $i++) {
            $loc = switch ($datesData[$i].storage_location) {
                "both" { "[SSD + NAS]" }
                "nas"  { "[NAS Archive]" }
                default { "[SSD]" }
            }
            Write-Host "  [$($i+1)] $($datesData[$i].date) $loc ($($datesData[$i].hours.Count) ชม.)" -ForegroundColor Gray
        }
        $dateChoice = Read-Host "เลือกหมายเลขวันที่ หรือพิมพ์วันที่ (YYYY-MM-DD) เช่น $((Get-Date).ToString('yyyy-MM-dd'))"
        if ([string]::IsNullOrWhiteSpace($dateChoice)) { $dateChoice = "1" }
        if ($dateChoice -match "^\d+$" -and [int]$dateChoice -le $datesData.Count) {
            $Date = $datesData[[int]$dateChoice - 1].date
        } else {
            $Date = $dateChoice.Trim()
        }
    } else {
        $Date = Read-Host "ระบุวันที่ต้องการกู้คืน (รูปแบบ YYYY-MM-DD)"
    }
}

if ($StartHour -lt 0) {
    $shInput = Read-Host "ระบุชั่วโมงเริ่มต้น (0-23, เช่น 0 สำหรับ 00:00 น.)"
    if ([string]::IsNullOrWhiteSpace($shInput)) { $shInput = "0" }
    $StartHour = [int]$shInput
}

if ($EndHour -lt 0) {
    $ehInput = Read-Host "ระบุชั่วโมงสิ้นสุด (0-23, เช่น 23 หรือกด Enter เพื่อใช้ชั่วโมงเดียวกับเริ่มต้น)"
    if ([string]::IsNullOrWhiteSpace($ehInput)) { $ehInput = $StartHour.ToString() }
    $EndHour = [int]$ehInput
}

Write-Host ""
Write-Host "สรุปคำสั่งกู้คืนวิดีโอ:" -ForegroundColor Cyan
Write-Host "  - กล้อง:       $Camera" -ForegroundColor White
Write-Host "  - วันที่:       $Date" -ForegroundColor White
Write-Host "  - ช่วงเวลา:    $($StartHour.ToString('00')):00 ถึง $($EndHour.ToString('00')):59 น." -ForegroundColor White
Write-Host "  - รูปแบบ:      $(if ($Mode -eq 'evidence') { 'รวมเป็นไฟล์หลักฐาน MP4 (Evidence)' } else { 'กู้คืนสู่ Timeline (SSD)' })" -ForegroundColor White
Write-Host ""

if (-not $Force) {
    $confirm = Read-Host "ยืนยันเริ่มการกู้คืนหรือไม่? (Y/N, ค่าเริ่มต้น Y)"
    if ($confirm -and $confirm.Trim().ToUpper() -eq "N") {
        Write-Host "ยกเลิกคำสั่งแล้ว" -ForegroundColor Yellow
        exit 0
    }
}

# 3. ส่งคำสั่งกู้คืนไปยัง API
$restorePayload = @{
    camera     = $Camera
    date       = $Date
    start_hour = $StartHour
    end_hour   = $EndHour
    mode       = $Mode
} | ConvertTo-Json

Write-Host ""
Write-Host "กำลังส่งคำสั่งไปยัง Engine..." -ForegroundColor Cyan
try {
    $startRes = Invoke-RestMethod -Uri "$apiBase/api/nas-bot/video-archive/restore" `
        -Method Post `
        -ContentType "application/json" `
        -Body $restorePayload `
        -ErrorAction Stop
    $taskId = $startRes.task_id
    Write-Host "[INFO] ได้รับรหัสงาน: $taskId" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] ไม่สามารถส่งคำสั่งกู้คืนได้: $_" -ForegroundColor Red
    exit 1
}

# 4. Polling สถานะจนกว่าจะเสร็จสิ้น
Write-Host ""
$completed = $false
while (-not $completed) {
    Start-Sleep -Seconds 1.5
    try {
        $taskStatus = Invoke-RestMethod -Uri "$apiBase/api/nas-bot/video-archive/status/$taskId" -ErrorAction Stop
        $pct = [int]($taskStatus.progress)
        $msg = $taskStatus.message

        Write-Progress -Activity "กำลังกู้คืนวิดีโอจาก NAS ($Camera - $Date)" `
            -Status "$msg ($pct%)" `
            -PercentComplete $pct

        if ($taskStatus.status -eq "completed") {
            Write-Progress -Activity "กำลังกู้คืนวิดีโอจาก NAS" -Completed
            $completed = $true
            Write-Host ""
            Write-Host "==================================================================" -ForegroundColor Green
            Write-Host "  🎉 การกู้คืนวิดีโอสำเร็จเรียบร้อยแล้ว!" -ForegroundColor Green
            Write-Host "==================================================================" -ForegroundColor Green

            if ($Mode -eq "evidence") {
                $exportedFile = Join-Path $exportsDir $taskStatus.filename
                $sizeMB = [Math]::Round($taskStatus.size_bytes / 1MB, 2)
                Write-Host "  ไฟล์ที่ส่งออก: $exportedFile" -ForegroundColor Cyan
                Write-Host "  ขนาดไฟล์:     $sizeMB MB" -ForegroundColor White
                Write-Host "  URL ดาวน์โหลด: $apiBase$($taskStatus.download_url)" -ForegroundColor Gray
                Write-Host ""

                if (-not $Force -and (Test-Path $exportedFile)) {
                    $openFolder = Read-Host "ต้องการเปิดโฟลเดอร์เก็บไฟล์หรือไม่? (Y/N, ค่าเริ่มต้น Y)"
                    if (-not $openFolder -or $openFolder.Trim().ToUpper() -ne "N") {
                        explorer.exe /select,"$exportedFile"
                    }
                }
            } else {
                Write-Host "  คลิปวิดีโอถูกกู้คืนกลับสู่โฟลเดอร์ recordings บนเครื่องเรียบร้อยแล้ว" -ForegroundColor Cyan
                Write-Host "  ท่านสามารถเปิดดูบนหน้าต่าง Timeline ของระบบได้ทันที" -ForegroundColor White
            }
        } elseif ($taskStatus.status -eq "failed") {
            Write-Progress -Activity "กำลังกู้คืนวิดีโอจาก NAS" -Completed
            $completed = $true
            Write-Host ""
            Write-Host "❌ การกู้คืนล้มเหลว: $($taskStatus.error)" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "กำลังรอสถานะ..." -ForegroundColor Gray
    }
}
