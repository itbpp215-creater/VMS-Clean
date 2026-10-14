# ========================================================================
# Sloth BPP-VMS - 1-Click Automated System Update Worker
# กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
# ========================================================================

[CmdletBinding()]
param(
    [string]$InstallPath = "$PSScriptRoot\..",
    [string]$MasterIp = ""
)

$ErrorActionPreference = 'Stop'
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$resolvedPath = (Resolve-Path $InstallPath).Path
[System.IO.Directory]::SetCurrentDirectory($resolvedPath)
Set-Location $resolvedPath
$gitRoot = (Resolve-Path "$resolvedPath\..").Path
$composeFile = Join-Path $resolvedPath "docker-compose.yml"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

Clear-Host
Write-Header 'Sloth BPP-VMS - ตัวช่วยอัปเดตระบบอัตโนมัติ [1-Click Update]'

# 1. ตรวจสอบ Docker
Write-Host "[1/3] กำลังตรวจสอบ Docker Desktop [Checking Docker Engine]..." -ForegroundColor Yellow
try {
    $null = & docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
    Write-Host "  [OK] Docker Engine พร้อมทำงาน [Docker Engine is ready]`n" -ForegroundColor Green
} catch {
    Write-Host "  [!] Docker Desktop ยังไม่ได้เปิดทำงาน กรุณาเปิด Docker ก่อนอัปเดต" -ForegroundColor Red
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}

# 2. ตรวจสอบโค้ดอัปเดต
Write-Host "[2/3] กำลังตรวจสอบสถานะการอัปเดต [Checking Update Status]..." -ForegroundColor Yellow

# 2.0 สแนปช็อตสำรองข้อมูลและคอนฟิกเฉพาะสถานีอัตโนมัติ (Automated Safe Snapshot)
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = Join-Path $gitRoot ".bpp-backup\$timestamp"
try {
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }

    $siteFilesToBackup = @(
        "frigate-nvr\.env",
        "frigate-nvr\config\config.yml",
        "frigate-nvr\config\camera_sources.json",
        "frigate-nvr\config\camera_credentials.env",
        "frigate-nvr\config\cam_list.tsv",
        "frigate-nvr\config\nvr_groups.json",
        "frigate-nvr\config\lpr\lpr_cameras.txt",
        "frigate-nvr\config\lpr\suspect_plates.txt",
        "frigate-nvr\config\lpr\blocked_webhook_cameras.json",
        "frigate-nvr\config\auth\auth.db",
        "frigate-nvr\config\lpr\watchlist.db",
        "frigate-nvr\watchlist-api\data\watchlist.db",
        "frigate-nvr\db\frigate.db"
    )

    $snapshotCount = 0
    foreach ($rel in $siteFilesToBackup) {
        $src = Join-Path $gitRoot $rel
        if (Test-Path -LiteralPath $src) {
            $dest = Join-Path $backupDir $rel
            $destParent = Split-Path -Parent $dest
            if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dest -Force
            $snapshotCount++
        }
    }
    if ($snapshotCount -gt 0) {
        Write-Host "  [*] สำรองข้อมูลคอนฟิกเฉพาะสถานีและฐานข้อมูล ($snapshotCount รายการ) -> .bpp-backup\$timestamp" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "  [!] คำเตือน: ไม่สามารถทำ Snapshot อัตโนมัติได้: $_" -ForegroundColor DarkYellow
}

$hasGitDir = Test-Path (Join-Path $gitRoot ".git")
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
$gitSuccess = $false

if ($hasGitDir -and ($null -ne $gitCmd)) {
    Push-Location $gitRoot
    try {
        Write-Host '  [*] โหมด Git: ดึงโค้ดเวอร์ชันล่าสุดจาก GitHub [git pull origin main]...' -ForegroundColor Gray
        
        # ปลดการ track ไฟล์คอนฟิกเฉพาะเครื่องออกจาก git index ในเครื่องนี้ หากเคยถูก track ไว้เดิม
        & git update-index --assume-unchanged "frigate-nvr/config/config.yml" 2>$null | Out-Null
        & git update-index --assume-unchanged "frigate-nvr/config/camera_sources.json" 2>$null | Out-Null
        & git update-index --assume-unchanged "frigate-nvr/config/camera_credentials.env" 2>$null | Out-Null
        
        & git stash | Out-Null
        $pullOutput = (& git pull origin main 2>&1) | Out-String
        Write-Host "  $pullOutput" -ForegroundColor White
        
        # ดึง stash กลับมาหากมี
        $stashList = (& git stash list 2>&1) | Out-String
        if ($stashList) { & git stash pop 2>&1 | Out-Null }
        
        $lastCommit = (& git log -1 --oneline 2>&1) | Out-String
        Write-Host "  [OK] เวอร์ชันโค้ดล่าสุด: $lastCommit" -ForegroundColor Green
        $gitSuccess = $true
    } catch {
        Write-Host "  [!] ไม่สามารถดึงโค้ดจาก Git ได้: $_" -ForegroundColor Yellow
        Write-Host "  [*] สลับไปใช้ระบบดาวน์โหลดชุดอัปเดตสำรองผ่านเครือข่ายแทน [Network Fallback]..." -ForegroundColor Cyan
    } finally {
        Pop-Location
    }
} elseif ($hasGitDir -and ($null -eq $gitCmd)) {
    Write-Host '  [*] ตรวจพบโฟลเดอร์ .git แต่เครื่องนี้ไม่ได้ติดตั้งโปรแกรม Git [Git CLI not installed]' -ForegroundColor Yellow
    Write-Host '  [*] สลับไปใช้โหมดอัปเดตผ่านเครือข่ายอัตโนมัติ [Zero-GitHub Package Mode]...' -ForegroundColor Cyan
}

if (-not $gitSuccess) {
    Write-Host '  [*] โหมดอัปเดตผ่านเครือข่าย / แพ็กเกจ [Zero-GitHub / Network Package Mode]' -ForegroundColor Cyan
    Write-Host "  [*] กำลังตรวจสอบและค้นหาอัปเดตเวอร์ชันล่าสุดผ่านระบบเครือข่าย..." -ForegroundColor Gray

    # โหลดค่าคอนฟิกจาก .env ถ้ามี
    $envFile = Join-Path $resolvedPath ".env"
    $envConfig = @{}
    if (Test-Path $envFile) {
        Get-Content $envFile -Encoding UTF8 | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.*)$") {
                $envConfig[$matches[1].Trim()] = $matches[2].Trim()
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($MasterIp)) {
        if ($envConfig.ContainsKey("MASTER_IP") -and $envConfig["MASTER_IP"]) {
            $MasterIp = $envConfig["MASTER_IP"]
        } elseif ($envConfig.ContainsKey("MASTER_SERVER_IP") -and $envConfig["MASTER_SERVER_IP"]) {
            $MasterIp = $envConfig["MASTER_SERVER_IP"]
        } else {
            # ค่าเริ่มต้น: โดเมนหลัก หรือ IP ของเครื่องศูนย์แม่ข่าย 215 (Public Domain, Tailscale Host, หรือ LAN)
            $MasterIp = "vms.local"
        }
    }

    $tempZip = Join-Path $env:TEMP "bpp-vms-update-$([System.Guid]::NewGuid().ToString('N')).zip"
    $tempExtract = Join-Path $env:TEMP "bpp-vms-extract-$([System.Guid]::NewGuid().ToString('N'))"
    $downloadSuccess = $false

    # แหล่งที่ 1: ดึงผ่าน Web Server ของเครื่องศูนย์ 215 (Cloudflare Tunnel, Tailscale หรือ LAN)
    $candidateUrls = @()
    if ($MasterIp) {
        $candidateUrls += "https://$MasterIp/downloads/bpp-vms-installer.zip"
        $candidateUrls += "http://$MasterIp/downloads/bpp-vms-installer.zip"
    }

    # รายชื่อ Host สำรองของเครื่องศูนย์ 215 ครบทุกช่องทาง
    $knownEndpoints = @("vms.local", "100.118.58.64", "192.168.1.200", "100.117.170.13", "bpp215-vms")
    foreach ($ep in $knownEndpoints) {
        if ($ep -ne $MasterIp) {
            $candidateUrls += "https://$ep/downloads/bpp-vms-installer.zip"
            $candidateUrls += "http://$ep/downloads/bpp-vms-installer.zip"
        }
    }

    foreach ($u in $candidateUrls) {
        if ($downloadSuccess) { break }
        Write-Host "  [*] พยายามดึงชุดอัปเดตจากเครื่องศูนย์ 215 ($u)..." -ForegroundColor Gray
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -k -fSL "$u" -o "$tempZip" --connect-timeout 4 --max-time 180 --progress-bar
            if ($LASTEXITCODE -eq 0 -and (Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1MB) {
                Write-Host "  [OK] ดาวน์โหลดชุดอัปเดตสำเร็จจากเครื่องศูนย์ 215!" -ForegroundColor Green
                $downloadSuccess = $true
                break
            }
        } else {
            try {
                [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls13
                $wc = New-Object System.Net.WebClient
                $wc.DownloadFile($u, $tempZip)
                if ((Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1MB) {
                    Write-Host "  [OK] ดาวน์โหลดชุดอัปเดตสำเร็จผ่าน WebClient!" -ForegroundColor Green
                    $downloadSuccess = $true
                    break
                }
            } catch {
                # continue to next candidate
            }
        }
    }

    # แหล่งที่ 1.5: หาก Windows Host ไม่มี Tailscale ให้ดึงผ่าน Docker Tailscale Container โดยตรง
    if (-not $downloadSuccess) {
        $tsContainerRunning = $false
        try {
            $tsInspect = (& docker inspect -f "{{.State.Running}}" tailscale-service 2>&1).Trim()
            if ($tsInspect -eq "true") { $tsContainerRunning = $true }
        } catch {}

        if ($tsContainerRunning) {
            Write-Host '  [*] ตรวจพบ Tailscale กำลังทำงานใน Docker Container [กำลังดึงชุดอัปเดตผ่านท่อ Docker Tailscale]...' -ForegroundColor Yellow
            $tsUrls = @(
                "https://100.117.170.13/downloads/bpp-vms-installer.zip",
                "http://100.117.170.13/downloads/bpp-vms-installer.zip",
                "https://bpp215-vms/downloads/bpp-vms-installer.zip"
            )
            foreach ($tsUrl in $tsUrls) {
                Write-Host "      กำลังเชื่อมต่อ $tsUrl ผ่าน tailscale-service..." -ForegroundColor Gray
                $dlRes = & docker exec tailscale-service wget --no-check-certificate -q -O /tmp/bpp-vms-update.zip "$tsUrl" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    & docker cp tailscale-service:/tmp/bpp-vms-update.zip "$tempZip" 2>&1 | Out-Null
                    & docker exec tailscale-service rm -f /tmp/bpp-vms-update.zip 2>&1 | Out-Null
                    if ((Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1MB) {
                        Write-Host "  [OK] ดาวน์โหลดชุดอัปเดตสำเร็จผ่าน Docker Tailscale Tunnel!" -ForegroundColor Green
                        $downloadSuccess = $true
                        break
                    }
                }
            }
        }
    }

    # แหล่งที่ 2: ดึงจากโฟลเดอร์แชร์บน Synology NAS
    if (-not $downloadSuccess) {
        $nasHost = if ($envConfig.ContainsKey("NAS_HOST") -and $envConfig["NAS_HOST"]) { $envConfig["NAS_HOST"] } else { "100.88.125.117" }
        $nasShare = if ($envConfig.ContainsKey("NAS_SHARE") -and $envConfig["NAS_SHARE"]) { $envConfig["NAS_SHARE"] } else { "BPP215" }
        $nasCandidates = @(
            "\\$nasHost\$nasShare\updates\bpp-vms-installer.zip",
            "\\$nasHost\$nasShare\bpp-vms-installer.zip",
            "\\100.88.125.117\BPP215\updates\bpp-vms-installer.zip",
            "\\192.168.1.100\BPP21\updates\bpp-vms-installer.zip"
        )
        foreach ($nasPath in $nasCandidates) {
            if (Test-Path $nasPath) {
                try {
                    Write-Host "  [*] ตรวจพบชุดอัปเดตบน Synology NAS: $nasPath" -ForegroundColor Yellow
                    Write-Host "      กำลังคัดลอกไฟล์..." -ForegroundColor Gray
                    Copy-Item -LiteralPath $nasPath -Destination $tempZip -Force
                    if ((Test-Path $tempZip) -and (Get-Item $tempZip).Length -gt 1MB) {
                        Write-Host "  [OK] คัดลอกชุดอัปเดตจาก NAS สำเร็จ!" -ForegroundColor Green
                        $downloadSuccess = $true
                        break
                    }
                } catch {
                    Write-Host "      (ไม่สามารถเข้าถึง $nasPath ได้: $($_.Exception.Message))" -ForegroundColor DarkGray
                }
            }
        }
    }

    # แหล่งที่ 3: Fallback ไฟล์ ZIP ในเครื่อง
    if (-not $downloadSuccess) {
        $localZipCandidates = @(
            (Join-Path $gitRoot "bpp-vms-installer.zip"),
            (Join-Path $resolvedPath "bpp-vms-installer.zip"),
            (Join-Path $env:USERPROFILE "Downloads\bpp-vms-installer.zip")
        )
        foreach ($cand in $localZipCandidates) {
            if ((Test-Path $cand) -and (Get-Item $cand).Length -gt 1MB) {
                Write-Host "  [*] ออฟไลน์: ตรวจพบไฟล์อัปเดตเดิมในเครื่อง: $cand" -ForegroundColor Yellow
                Copy-Item -LiteralPath $cand -Destination $tempZip -Force
                $downloadSuccess = $true
                break
            }
        }
    }

    if ($downloadSuccess) {
        try {
            Write-Host "  [*] กำลังแตกไฟล์ชุดอัปเดต..." -ForegroundColor Gray
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $tempExtract)

            # ค้นหา root folder ใน ZIP (ปกติคือ BPP-VMS)
            $sourceRoot = $tempExtract
            $innerBpp = Join-Path $tempExtract "BPP-VMS"
            if (Test-Path $innerBpp) {
                $sourceRoot = $innerBpp
            }

            Write-Host "  [*] กำลังนำไฟล์ระบบเวอร์ชันใหม่อัปเดตทับโค้ดเดิม..." -ForegroundColor Gray
            Write-Host "      (ข้อมูลความปลอดภัย, การตั้งค่ากล้อง, ฐานข้อมูล และวิดีโอถูกล็อกป้องกันไว้ ไม่ถูกเขียนทับ 100%)" -ForegroundColor DarkGray

            # รายการไฟล์/โฟลเดอร์ที่ไม่ให้เขียนทับ (Site-specific files)
            $protectedRelPaths = @(
                "frigate-nvr\.env",
                "frigate-nvr\config\config.yml",
                "frigate-nvr\config\nvr_groups.json",
                "frigate-nvr\config\camera_credentials.env",
                "frigate-nvr\config\lpr\lpr_cameras.txt",
                "frigate-nvr\config\lpr\lpr_zones.json",
                "frigate-nvr\config\lpr\suspect_plates.txt",
                "frigate-nvr\config\dashboard-settings",
                "frigate-nvr\config\certs",
                "frigate-nvr\config\backups",
                "frigate-nvr\databases",
                "frigate-nvr\storage",
                "frigate-nvr\db",
                "frigate-nvr\logs",
                "frigate-nvr\web\downloads"
            )

            # คัดลอกไฟล์ทั้งหมดทับ ยกเว้นรายการที่ป้องกันไว้
            $allSourceFiles = Get-ChildItem -Path $sourceRoot -Recurse -File
            $updatedCount = 0
            foreach ($sFile in $allSourceFiles) {
                $rel = $sFile.FullName.Substring($sourceRoot.Length).TrimStart("\", "/")
                
                $isProtected = $false
                foreach ($prot in $protectedRelPaths) {
                    if ($rel -like "$prot*" -or $rel -like "*\$prot*") {
                        $isProtected = $true
                        break
                    }
                }

                $destFile = Join-Path $gitRoot $rel
                
                # ข้อยกเว้น: หากไฟล์โมเดล AI ยังไม่มีในเครื่อง ให้คัดลอกลงไปเสมอเพื่อซ่อมแซมระบบ
                $isMissingAiModel = ($rel -like "*model_cache\yolo11m-640.onnx" -or $rel -like "*LicensePlateRECOG\model\*.pt") -and (-not (Test-Path $destFile))
                
                if ($isMissingAiModel) {
                    $isProtected = $false
                }

                if (-not $isProtected) {
                    $destDir = Split-Path -Parent $destFile
                    if (-not (Test-Path $destDir)) {
                        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    }
                    Copy-Item -LiteralPath $sFile.FullName -Destination $destFile -Force
                    $updatedCount++
                }
            }

            Write-Host "  [OK] อัปเดตไฟล์ระบบเสร็จสิ้น [$updatedCount ไฟล์ได้รับการปรับปรุง]" -ForegroundColor Green
        } catch {
            Write-Host "  [!] เกิดข้อผิดพลาดในการแตกไฟล์อัปเดต: $_" -ForegroundColor Red
            Write-Host "  [*] จะใช้โค้ดปัจจุบันเริ่มการทำงานต่อ..." -ForegroundColor Yellow
        } finally {
            if (Test-Path $tempZip) { Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue }
            if (Test-Path $tempExtract) { Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue }
        }
    } else {
        Write-Host "  [!] ไม่สามารถดาวน์โหลดไฟล์อัปเดตจากอินเทอร์เน็ตได้ และไม่พบชุดติดตั้งในเครื่อง" -ForegroundColor Yellow
        Write-Host "  [*] กำลังนำการตั้งค่าและโค้ดที่มีอยู่ไปเริ่มการทำงานต่อ..." -ForegroundColor Gray
    }
}

# ========================================================================
# 2.3 ตรวจสอบความสมบูรณ์และคุ้มครองคอนฟิกสถานี (Config Safeguard & Restore Gate)
# ========================================================================
Write-Host "`n  [*] ตรวจสอบความสมบูรณ์ของคอนฟิกกล้องและข้อมูลสถานี [Verifying Node State]..." -ForegroundColor Gray

# 1. ตรวจสอบ config.yml
$destConfigYml = Join-Path $gitRoot "frigate-nvr\config\config.yml"
$backupConfigYml = if ($backupDir) { Join-Path $backupDir "frigate-nvr\config\config.yml" } else { $null }
$cleanConfigTemplate = Join-Path $gitRoot "frigate-nvr\config\config.clean.yml"
$exampleConfigTemplate = Join-Path $gitRoot "frigate-nvr\config\config.yml.example"

if ($backupConfigYml -and (Test-Path $backupConfigYml)) {
    # หากไฟล์ปัจจุบันหายไป หรือมีขนาดเล็กผิดปกติ ให้กู้คืนจาก Backup ทันที
    if (-not (Test-Path $destConfigYml) -or (Get-Item $destConfigYml).Length -lt 50) {
        Copy-Item -LiteralPath $backupConfigYml -Destination $destConfigYml -Force
        Write-Host "  [SAFEGUARD] กู้คืนไฟล์ config.yml เดิมของสถานีกลับคืนมาเรียบร้อยแล้ว (ไม่สูญหาย 100%)" -ForegroundColor Green
    } else {
        Write-Host "  [OK] การตั้งค่ากล้อง config.yml ปลอดภัยและสมบูรณ์" -ForegroundColor Green
    }
} elseif (-not (Test-Path $destConfigYml)) {
    # ติดตั้งใหม่ครั้งแรก ยังไม่มี config.yml ให้คัดลอกจาก Template
    if (Test-Path $cleanConfigTemplate) {
        Copy-Item -LiteralPath $cleanConfigTemplate -Destination $destConfigYml -Force
        Write-Host "  [INIT] สร้าง config.yml เริ่มต้นจากแม่แบบ config.clean.yml" -ForegroundColor Cyan
    } elseif (Test-Path $exampleConfigTemplate) {
        Copy-Item -LiteralPath $exampleConfigTemplate -Destination $destConfigYml -Force
        Write-Host "  [INIT] สร้าง config.yml เริ่มต้นจากแม่แบบ config.yml.example" -ForegroundColor Cyan
    }
}

# 2. ตรวจสอบ .env
$destEnv = Join-Path $gitRoot "frigate-nvr\.env"
$backupEnv = if ($backupDir) { Join-Path $backupDir "frigate-nvr\.env" } else { $null }
$exampleEnv = Join-Path $gitRoot "frigate-nvr\.env.example"

if ($backupEnv -and (Test-Path $backupEnv)) {
    if (-not (Test-Path $destEnv) -or (Get-Item $destEnv).Length -lt 20) {
        Copy-Item -LiteralPath $backupEnv -Destination $destEnv -Force
        Write-Host "  [SAFEGUARD] กู้คืนไฟล์ .env เดิมของสถานีกลับคืนมาเรียบร้อยแล้ว" -ForegroundColor Green
    }
} elseif (-not (Test-Path $destEnv) -and (Test-Path $exampleEnv)) {
    Copy-Item -LiteralPath $exampleEnv -Destination $destEnv -Force
    Write-Host "  [INIT] สร้าง .env เริ่มต้นจากแม่แบบ .env.example" -ForegroundColor Cyan
}

# 3. ตรวจสอบกล้องและไฟล์ความลับอื่นๆ (camera_sources.json, camera_credentials.env, watchlist.db)
if ($backupDir) {
    $otherRestores = @(
        "frigate-nvr\config\camera_sources.json",
        "frigate-nvr\config\camera_credentials.env",
        "frigate-nvr\config\lpr\watchlist.db",
        "frigate-nvr\watchlist-api\data\watchlist.db",
        "frigate-nvr\config\auth\auth.db"
    )
    foreach ($rel in $otherRestores) {
        $bkFile = Join-Path $backupDir $rel
        $targetFile = Join-Path $gitRoot $rel
        if (Test-Path $bkFile) {
            if (-not (Test-Path $targetFile) -or (Get-Item $targetFile).Length -lt 2) {
                $destParent = Split-Path -Parent $targetFile
                if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
                Copy-Item -LiteralPath $bkFile -Destination $targetFile -Force
                Write-Host "  [SAFEGUARD] กู้คืน $rel เดิมของสถานีเรียบร้อย" -ForegroundColor Green
            }
        }
    }
}


# 3. โหลดบริการใหม่
Write-Host "`n[3/3] กำลังเริ่มบริการด้วยโค้ดเวอร์ชันใหม่ [docker compose up -d --build]..." -ForegroundColor Yellow
Push-Location $resolvedPath
try {
    & docker compose --project-directory "$resolvedPath" -f "$composeFile" up -d --build
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

    # หยุดบริการ cloudflared-tunnel อัตโนมัติเมื่อเป็นโทเค็นเริ่มต้น ป้องกัน restart loop
    $envFilePath = Join-Path $resolvedPath ".env"
    if (Test-Path $envFilePath) {
        $envContent = Get-Content $envFilePath -Raw
        if ($envContent -match 'CLOUDFLARE_TUNNEL_TOKEN\s*=\s*"?none_local_only"?') {
            $prevEA = $ErrorActionPreference
            $ErrorActionPreference = 'SilentlyContinue'
            cmd.exe /c "docker compose --project-directory \"$resolvedPath\" -f \"$composeFile\" stop cloudflared >nul 2>&1"
            $ErrorActionPreference = $prevEA
        }
    }
    # ตรวจสอบและดูแลสถานะ i2-Bridge หากมีโปรแกรม IBM i2 บนเครื่องนี้
    $i2ComKey = 'Registry::HKEY_CLASSES_ROOT\Wow6432Node\CLSID\{29C44DCF-28D6-4C95-8DEF-A666763F5B70}\LocalServer32'
    if (Test-Path -LiteralPath $i2ComKey) {
        $bridgeScript = Join-Path $resolvedPath "scripts\i2-bridge\start-i2-bridge.ps1"
        if (Test-Path $bridgeScript) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$bridgeScript" | Out-Null
        }
    }

    Write-Host "  [OK] อัปเดตและเริ่มบริการใหม่เรียบร้อยแล้ว [ข้อมูลผู้ใช้และการตั้งค่าเดิมคงอยู่ครบ 100%]`n" -ForegroundColor Green
} catch {
    Write-Host "  [!] เกิดข้อผิดพลาดในการรัน docker compose up: $_" -ForegroundColor Red
    Pop-Location
    Read-Host "กดปุ่ม [Enter] เพื่อออก..."
    exit 1
}
Pop-Location

Write-Header "[SUCCESS] อัปเดตระบบ BPP-VMS สำเร็จเรียบร้อยแล้ว!"
Write-Host "  หน้าต่างควบคุม (Dashboard): https://localhost" -ForegroundColor Cyan
Write-Host "  * สคริปต์ควบคุมใหม่พร้อมใช้งานที่โฟลเดอร์หลัก:" -ForegroundColor Yellow
Write-Host "    - Enable_Auto_NAS_Sync.bat : เปิดระบบตรวจจับไฟล์เมื่อเซฟและซิงค์ไป NAS อัตโนมัติ" -ForegroundColor Gray
Write-Host "    - Start_I2_Bridge.bat      : เปิดระบบแปลงผัง i2 ในพื้นหลัง (สำหรับเครื่องที่มี i2)" -ForegroundColor Gray
Write-Host "    - Status_I2_Bridge.bat     : ตรวจสอบสถานะการทำงานของตัวแปลงผัง i2" -ForegroundColor Gray
Write-Host "========================================================================" -ForegroundColor Cyan
Read-Host "  กดปุ่ม [Enter] เพื่อปิดหน้าต่างนี้..."
