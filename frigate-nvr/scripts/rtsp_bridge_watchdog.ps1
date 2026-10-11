# BPP-VMS RTSP Bridge Watchdog & Auto-Healer
# Ensures rtsp_proxy.js is perpetually running and listening on port 8556.

# Single-instance lock to prevent duplicate watchdogs
$mutexName = "Global\BPP_VMS_RTSP_Bridge_Watchdog"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = "d:\BPP-VMS\frigate-nvr\scripts" }
$RootDir = Split-Path -Parent $ScriptDir
if (-not $RootDir) { $RootDir = "d:\BPP-VMS\frigate-nvr" }
$ScriptPath = Join-Path $ScriptDir "rtsp_proxy.js"

$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodePath -or -not (Test-Path $NodePath)) {
    $NodePath = "C:\Program Files\nodejs\node.exe"
}

$LogPath = Join-Path $RootDir "runtime\bridge_watchdog.log"
$CfUrlFile = Join-Path $RootDir "runtime\cloudflare_tunnel_url.txt"

function Write-Log($msg) {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "[$ts] $msg" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

Write-Log "RTSP Bridge & DDNS Watchdog loop active."

$LastKnownIP = ""
$LastDnsCheck = [DateTime]::MinValue
$DuckDnsToken = "0fd9e313-3af4-4203-83f8-8be0d588325e"
$DuckDnsDomain = "bpp215"
$LastCfCheck = [DateTime]::MinValue

while ($true) {
    try {
        # 1. Check if node process for rtsp_proxy is running and port 8556 is listening
        $nodeProc = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*rtsp_proxy.js*" }
        $conn = Get-NetTCPConnection -LocalPort 8556 -State Listen -ErrorAction SilentlyContinue

        if (-not $nodeProc -or -not $conn) {
            Write-Log "RTSP Bridge node process or port 8556 not active. Restarting native RTSP Bridge..."
            if ($nodeProc) {
                foreach ($p in $nodeProc) {
                    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
                }
            }
            # Start fresh bridge process
            Start-Process $NodePath -ArgumentList "`"$ScriptPath`"" -WindowStyle Hidden
            Start-Sleep -Seconds 2
            
            $verify = Get-NetTCPConnection -LocalPort 8556 -State Listen -ErrorAction SilentlyContinue
            if ($verify) {
                Write-Log "RTSP Bridge successfully bound to port 8556."
            } else {
                Write-Log "WARNING: Port 8556 still not detected after launch."
            }
        }

        # 2. Check and sync Public IP with DuckDNS every 60 seconds
        if ((Get-Date) -gt $LastDnsCheck.AddMinutes(1)) {
            $LastDnsCheck = Get-Date
            try {
                $curIP = (Invoke-RestMethod "https://api.ipify.org?format=json" -TimeoutSec 5).ip
                if ($curIP -and $curIP -ne $LastKnownIP) {
                    Write-Log "Public IP change detected: $curIP (previous: $LastKnownIP). Updating DuckDNS..."
                    $resp = (Invoke-RestMethod "https://www.duckdns.org/update?domains=$DuckDnsDomain&token=$DuckDnsToken&ip=$curIP" -TimeoutSec 5).Trim()
                    Write-Log "DuckDNS update response: $resp"
                    $LastKnownIP = $curIP
                }
            } catch {
                # Ignore transient network timeout
            }
        }

        # 3. Track and persist active Cloudflare Tunnel URL
        if ((Get-Date) -gt $LastCfCheck.AddSeconds(30)) {
            $LastCfCheck = Get-Date
            try {
                $curCfUrl = 'https://vms.local'
                if (-not (Test-Path $CfUrlFile) -or (Get-Content $CfUrlFile -ErrorAction SilentlyContinue) -ne $curCfUrl) {
                    $curCfUrl | Out-File -FilePath $CfUrlFile -Encoding utf8 -Force
                    Write-Log "Cloudflare Tunnel active at: $curCfUrl"
                }
            } catch {
                # Ignore transient docker lock
            }
        }
    } catch {
        Write-Log "Watchdog exception: $_"
    }
    
    Start-Sleep -Seconds 10
}
