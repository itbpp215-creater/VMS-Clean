# autostart-frigate.ps1 — รันอัตโนมัติตอน sign-in (จาก Startup folder) เพื่อการันตีว่า Frigate + Dashboard ขึ้น
# Idempotent: ถ้าทุกอย่างรันอยู่แล้วจะจบเงียบๆ ภายในไม่กี่วินาที
# เฉพาะเครื่อง production นี้ (ไม่ใช่ของ repo — ดู CLAUDE.md ไม่ต้อง commit สคริปต์นี้ก็ได้ แต่ track ไว้กันหาย)
# Log: autostart.log ในโฟลเดอร์ repo (git ignore ด้วย *.log)
# Production uses the repository on D: and Docker Desktop's per-user install.
# Keeping these host-specific paths here prevents a silent no-op after sign-in.
$repo    = 'D:\BPP-VMS\frigate-nvr'
$docker  = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
$desktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
$log    = Join-Path $repo 'autostart.log'

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $log -Encoding utf8 }

Log '--- autostart run ---'

# Fail with an actionable log entry if a future Docker reinstall moves either
# executable; otherwise the wait loop would hide the real startup problem.
if (-not (Test-Path -LiteralPath $docker) -or -not (Test-Path -LiteralPath $desktop)) {
    Log "FAILED: Docker Desktop path missing (desktop=$desktop, cli=$docker)"
    exit 1
}

# 1) Docker Desktop ต้องรันอยู่ (ปกติ AutoStart ของมันจัดการเอง — นี่คือกันเหนียว)
if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    Log 'Docker Desktop not running -> starting it'
    Start-Process $desktop
}

# 2) รอ engine พร้อม (บูตเครื่องใหม่ WSL2 อาจใช้ 1-3 นาที)
$deadline = (Get-Date).AddMinutes(15)
$ready = $false
while ((Get-Date) -lt $deadline) {
    & $docker info *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 10
}
if (-not $ready) { Log 'FAILED: docker engine not ready within 15 min'; exit 1 }
Log 'docker engine ready'

# 3) image หาย (กรณีล้าง docker) ค่อย build — ปกติข้ามเพื่อไม่ต้องพึ่งเน็ตตอนบูต
& $docker image inspect frigate-branded:local *> $null
if ($LASTEXITCODE -ne 0) {
    Log 'image frigate-branded:local missing -> building'
    & $docker compose --project-directory $repo build 2>&1 | Add-Content -Path $log -Encoding utf8
}

# 4) ดัน container ขึ้น (no-op ถ้ารันอยู่แล้ว; สร้างใหม่ถ้าถูกลบ; start ถ้าถูก stop ค้าง)
# ไม่มี docker-compose.override.yml บนเครื่องนี้ (production มี GPU — ใช้ docker-compose.yml ตรงๆ ตามที่ CLAUDE.md กำหนด)
& $docker compose --project-directory $repo up -d 2>&1 | Add-Content -Path $log -Encoding utf8
& $docker compose --project-directory $repo --profile manual create --no-recreate lpr-trainer 2>&1 | Add-Content -Path $log -Encoding utf8

# An isolation test may intentionally set Frigate to restart=no. Compose does
# not always reconcile that runtime-only policy without recreating the
# container, so restore the policy explicitly after every successful startup.
& $docker update --restart unless-stopped frigate-nvr 2>&1 | Add-Content -Path $log -Encoding utf8

# Record coverage for the entire Compose project instead of checking only two
# containers. This makes a partial boot visible in the persistent startup log.
$expectedServices = @(& $docker compose --project-directory $repo config --services)
$runningServices = @(& $docker compose --project-directory $repo ps --services --status running)
$missingServices = @($expectedServices | Where-Object { $_ -notin $runningServices })
Log "compose services: expected=$($expectedServices.Count) running=$($runningServices.Count) missing=$($missingServices -join ',')"
$frigateStatus   = & $docker ps --filter name=frigate --format '{{.Status}}'
$dashboardStatus = & $docker ps --filter name=nvr-dashboard --format '{{.Status}}'
Log "frigate status: $frigateStatus"
Log "dashboard status: $dashboardStatus"
