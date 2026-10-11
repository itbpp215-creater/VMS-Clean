# ==============================================================================
# BPP-VMS Intelligence & Dossier NAS Backup Sync Utility
# ==============================================================================
# สคริปต์สำหรับซิงค์สำเนาข้อมูลคดี, แฟ้มบุคคล (Dossiers), ผัง i2, และ Backup
# จาก SSD ของเครื่องหลัก ไปเก็บสำรองไว้ที่ NAS แบบอัตโนมัติ (Two-Tier Redundancy)
# รองรับทั้งโหมด:
#   1. Manual Sync (สั่งซิงค์ครั้งเดียว)
#   2. Real-Time Watcher (-Watch: ตรวจจับไฟล์เมื่อเซฟแล้วซิงค์ทันที)
#   3. Windows Task Scheduler (-RegisterAutoSync: รันอัตโนมัติตอนเปิดเครื่อง)
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$TargetLocation = "Z:\nas-storage",

    [Parameter(Mandatory = $false)]
    [switch]$Watch,

    [Parameter(Mandatory = $false)]
    [switch]$RegisterAutoSync,

    [Parameter(Mandatory = $false)]
    [switch]$UnregisterAutoSync,

    [Parameter(Mandatory = $false)]
    [switch]$RegisterTask,

    [Parameter(Mandatory = $false)]
    [int]$IntervalHours = 2,

    [Parameter(Mandatory = $false)]
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$logsDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}
$logFilePath = Join-Path $logsDir "nas-sync.log"

function Write-SyncLog {
    param([string]$Message, [string]$Level = "INFO", [ConsoleColor]$Color = [ConsoleColor]::White)
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$ts] [$Level] $Message"
    if (-not $Silent) {
        Write-Host $logLine -ForegroundColor $Color
    }
    try {
        [System.IO.File]::AppendAllText($logFilePath, "$logLine`r`n", [System.Text.Encoding]::UTF8)
    } catch {}
}

# ------------------------------------------------------------------------------
# 1. ยกเลิกการลงทะเบียน Task Scheduler (-UnregisterAutoSync)
# ------------------------------------------------------------------------------
if ($UnregisterAutoSync) {
    $taskName = "BPP-VMS-NAS-AutoSync"
    Write-SyncLog "กำลังยกเลิกงาน Scheduled Task '$taskName'..." "INFO" Cyan
    try {
        & schtasks.exe /delete /tn $taskName /f 2>&1 | Out-Null
        Write-SyncLog "ยกเลิกงาน Scheduled Task สำเร็จเรียบร้อยแล้ว" "SUCCESS" Green
    } catch {
        Write-SyncLog "ไม่พบงาน '$taskName' ใน Task Scheduler หรือถูกลบไปแล้ว" "WARN" Yellow
    }

    # หยุด Background Process ที่กำลังรันอยู่ถ้ามี
    $runningWatchers = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%sync-to-nas.ps1%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
    if ($runningWatchers) {
        foreach ($proc in $runningWatchers) {
            try {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
                Write-SyncLog "หยุด Watcher Process (PID: $($proc.ProcessId)) เรียบร้อย" "INFO" Yellow
            } catch {}
        }
    }
    return
}

# ------------------------------------------------------------------------------
# 2. ลงทะเบียน Windows Scheduled Task ให้รันอัตโนมัติตอน Logon (-RegisterAutoSync)
# ------------------------------------------------------------------------------
if ($RegisterAutoSync -or $RegisterTask) {
    $taskName = "BPP-VMS-NAS-AutoSync"
    $scriptPath = [System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
    $powerShellExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Watch -Silent -TargetLocation `"$TargetLocation`""

    Write-SyncLog "กำลังลงทะเบียน Scheduled Task '$taskName' เพื่อเปิดตรวจจับและซิงค์อัตโนมัติเมื่อเปิดเครื่อง..." "INFO" Yellow

    $action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        Write-SyncLog "ลงทะเบียนงานสำเร็จ! ระบบจะเริ่มตรวจจับและซิงค์ข้อมูลไป NAS ทันทีเมื่อเข้าสู่ระบบ Windows" "SUCCESS" Green
        Write-SyncLog "(ชื่องานใน Task Scheduler: $taskName)" "INFO" Gray
    } catch {
        try {
            $fullCmd = "`"$powerShellExe`" $arguments"
            & schtasks.exe /create /tn $taskName /tr $fullCmd /sc ONLOGON /f | Out-Null
            Write-SyncLog "ลงทะเบียนผ่าน schtasks สำเร็จเรียบร้อย!" "SUCCESS" Green
        } catch {
            Write-SyncLog "ไม่สามารถลงทะเบียน Scheduled Task ได้: $_" "ERROR" Red
            exit 1
        }
    }

    # หากรันจากสคริปต์ ให้สตาร์ท watcher ในพื้นหลังทันที
    Write-SyncLog "กำลังเริ่มการทำงานของตัวตรวจจับไฟล์ในพื้นหลัง..." "INFO" Yellow
    Start-Process -FilePath $powerShellExe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Watch -Silent -TargetLocation `"$TargetLocation`""
    Write-SyncLog "เปิดระบบตรวจจับและซิงค์อัตโนมัติในพื้นหลังเรียบร้อยแล้ว!" "SUCCESS" Green
    return
}

# ------------------------------------------------------------------------------
# ฟังก์ชันซิงค์ข้อมูลจริง (Sync Function)
# ------------------------------------------------------------------------------
function Invoke-NasSyncOperation {
    param([string]$Target)

    $containerRunning = (docker ps --filter "name=nas-bot-service" --format "{{.Names}}") -eq "nas-bot-service"
    if (-not $containerRunning) {
        Write-SyncLog "คอนเทนเนอร์ nas-bot-service ยังไม่ทำงาน ข้ามรอบการซิงค์" "WARN" Yellow
        return $false
    }

    if (-not (Test-Path $Target)) {
        try {
            New-Item -ItemType Directory -Path $Target -Force | Out-Null
        } catch {
            Write-SyncLog "ไม่สามารถเข้าถึงหรือสร้างโฟลเดอร์ปลายทาง $Target ได้ กรุณาตรวจสอบการเชื่อมต่อ NAS" "ERROR" Red
            return $false
        }
    }

    $startTime = Get-Date
    try {
        $sourceContainerPath = "nas-bot-service:/data/nas-storage/."
        $tempSyncOut = & docker cp $sourceContainerPath "$Target" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "docker cp failed with code $($LASTEXITCODE): $tempSyncOut"
        }

        # ซิงค์ runtime/i2-bridge ไปยัง NAS สำรองเพิ่มเติมหากมี
        $bridgeHostRoot = Join-Path $projectRoot "runtime\i2-bridge"
        $bridgeTarget = Join-Path $Target "i2-bridge"
        if (Test-Path $bridgeHostRoot) {
            if (-not (Test-Path $bridgeTarget)) { New-Item -ItemType Directory -Path $bridgeTarget -Force | Out-Null }
            $bridgeMedia = Join-Path $bridgeHostRoot "media"
            $bridgeTargetMedia = Join-Path $bridgeTarget "media"
            if (Test-Path $bridgeMedia) {
                & robocopy $bridgeMedia $bridgeTargetMedia /E /NDL /NFL /NJH /NJS /R:1 /W:1 2>&1 | Out-Null
            }
        }

        $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
        Write-SyncLog "ซิงค์สำเนาข้อมูล Dossiers/i2/Backups ไปยัง NAS ($Target) สำเร็จ! (ใช้เวลา $elapsed วินาที)" "SUCCESS" Green
        return $true
    } catch {
        Write-SyncLog "เกิดข้อผิดพลาดในการซิงค์ข้อมูล: $_" "ERROR" Red
        return $false
    }
}

# ------------------------------------------------------------------------------
# 3. โหมด Live Watcher (-Watch: ตรวจจับเมื่อไฟล์เซฟแล้วซิงค์ทันที)
# ------------------------------------------------------------------------------
if ($Watch) {
    Write-SyncLog "=========================================================" "INFO" Cyan
    Write-SyncLog "🛡️ BPP-VMS: ระบบตรวจจับไฟล์และซิงค์สู่ NAS อัตโนมัติ (Active)" "INFO" Cyan
    Write-SyncLog "   - ต้นทาง: SSD เครื่องหลัก (Local Master)" "INFO" Gray
    Write-SyncLog "   - ปลายทาง: $TargetLocation (NAS Backup Replica)" "INFO" Gray
    Write-SyncLog "=========================================================" "INFO" Cyan

    # สร้าง marker เริ่มต้นในคอนเทนเนอร์
    & docker exec nas-bot-service touch /tmp/last_nas_sync_marker 2>&1 | Out-Null

    $checkIntervalSec = 10
    $debounceSec = 8
    $hourlyTick = 0

    while ($true) {
        try {
            Start-Sleep -Seconds $checkIntervalSec
            $hourlyTick += $checkIntervalSec

            # ตรวจสอบสถานะคอนเทนเนอร์
            $containerRunning = (docker ps --filter "name=nas-bot-service" --format "{{.Names}}") -eq "nas-bot-service"
            if (-not $containerRunning) {
                continue
            }

            # ตรวจจับไฟล์ที่มีการเปลี่ยนแปลงใหม่กว่า marker
            $changedRaw = (& docker exec nas-bot-service find /data/nas-storage -type f -newer /tmp/last_nas_sync_marker 2>&1) | Out-String
            $changedLines = $changedRaw.Trim().Split("`n") | Where-Object { $_ -and -not $_.StartsWith("find:") }

            $shouldSync = $false
            if ($changedLines.Count -gt 0) {
                Write-SyncLog "ตรวจพบไฟล์บันทึกใหม่ $($changedLines.Count) รายการ! กำลังรอเขียนไฟล์เสร็จสมบูรณ์ (${debounceSec}s)..." "INFO" Yellow
                Start-Sleep -Seconds $debounceSec
                $shouldSync = $true
            } elseif ($hourlyTick -ge 3600) {
                # Sync ประจำชั่วโมงเพื่อความมั่นใจ 100%
                $shouldSync = $true
                $hourlyTick = 0
            }

            if ($shouldSync) {
                $ok = Invoke-NasSyncOperation -Target $TargetLocation
                if ($ok) {
                    & docker exec nas-bot-service touch /tmp/last_nas_sync_marker 2>&1 | Out-Null
                }
            }
        } catch {
            Write-SyncLog "ข้อผิดพลาดในลูป Watcher: $_" "WARN" Yellow
            Start-Sleep -Seconds 15
        }
    }
    return
}

# ------------------------------------------------------------------------------
# 4. โหมด Manual Sync (สั่งซิงค์ครั้งเดียวตามปกติ)
# ------------------------------------------------------------------------------
Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "  🛡️  BPP-VMS: สั่งซิงค์สำเนาข้อมูลสู่ NAS ด้วยตนเอง" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

$ok = Invoke-NasSyncOperation -Target $TargetLocation
if ($ok) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "  🎉 สำรองข้อมูลคู่ขนานไปยัง NAS เสร็จสมบูรณ์!" -ForegroundColor Green
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    exit 1
}