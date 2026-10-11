<#
 ==============================================================================
  BPP NVR Bridge - Outbound Streaming Client Utility for Windows
  ระบบบริดจ์สัญญาณกล้องวงจรปิด VIGI / NVR สู่ศูนย์กลาง BPP-VMS (Zero-MikroTik)
 ==============================================================================
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $scriptDir "config.json"
$ffmpegExe = Join-Path $scriptDir "bin\ffmpeg.exe"

if (-not (Test-Path $ffmpegExe)) {
    # Fallback to system ffmpeg if not in local bin
    $sysFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($sysFfmpeg) {
        $ffmpegExe = $sysFfmpeg.Source
    }
}

# Pre-flight check: Ensure FFmpeg is executable
if (-not (Test-Path $ffmpegExe)) {
    [System.Windows.Forms.MessageBox]::Show(
        "ไม่พบโปรแกรม FFmpeg!`n`n" +
        "กรุณาวางไฟล์ ffmpeg.exe ไว้ในโฟลเดอร์ bin\ ของโปรแกรมนี้`n" +
        "หรือติดตั้ง FFmpeg ในระบบ (System PATH)`n`n" +
        "ดาวน์โหลดได้ที่: https://www.gyan.dev/ffmpeg/builds/",
        "BPP NVR Bridge — FFmpeg ไม่พร้อมใช้งาน",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
    exit 1
}

# State management
$global:processes = @{}
$global:isBridging = $false
$global:config = @{}

function Load-Config {
    if (Test-Path $configFile) {
        try {
            $json = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $global:config = $json
        } catch {
            Write-Warning "Failed to parse config.json: $_"
        }
    }
}

$global:maxChannels = if ($global:config.max_channels) { $global:config.max_channels } else { 16 }

function Save-Config {
    $channelsList = @()
    for ($i = 1; $i -le $global:maxChannels; $i++) {
        $chk = $global:chCheckboxes[$i]
        $cmb = $global:chStreamCombos[$i]
        $channelsList += @{
            ch = $i
            enabled = [bool]$chk.Checked
            stream_type = if ($cmb.SelectedIndex -eq 1) { "stream1" } else { "stream2" }
        }
    }

    $selectedBrand = if ($cmbNvrBrand.SelectedItem) { $cmbNvrBrand.SelectedItem.ToString() } else { "TP-Link VIGI" }
    $cameraGroup = if ($global:config.camera_group) { $global:config.camera_group } else { "" }

    $obj = [ordered]@{
        server_host = $txtServerHost.Text.Trim()
        unit_code = $txtUnitCode.Text.Trim()
        nvr_brand = $selectedBrand
        custom_rtsp_path = $txtCustomRtspPath.Text.Trim()
        nvr_ip = $txtNvrIp.Text.Trim()
        nvr_port = [int]$txtNvrPort.Text.Trim()
        username = $txtUsername.Text.Trim()
        password = $txtPassword.Text
        camera_group = $cameraGroup
        max_channels = $global:maxChannels
        autostart_bridge = [bool]$chkAutoStart.Checked
        run_on_startup = [bool]$chkStartup.Checked
        channels = $channelsList
    }

    $json = $obj | ConvertTo-Json -Depth 5
    Set-Content -Path $configFile -Value $json -Encoding UTF8

    # Windows Startup Shortcut management
    $startupPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
    $shortcutPath = [System.IO.Path]::Combine($startupPath, "BPP-NVR-Bridge.lnk")
    $vbsLauncher = Join-Path $scriptDir "BPP-NVR-Bridge.vbs"

    if ($chkStartup.Checked) {
        try {
            $wsh = New-Object -ComObject WScript.Shell
            $sc = $wsh.CreateShortcut($shortcutPath)
            $sc.TargetPath = $vbsLauncher
            $sc.WorkingDirectory = $scriptDir
            $sc.Description = "BPP NVR Bridge Auto-Starter"
            $sc.Save()
        } catch {
            Write-Warning "Could not register startup shortcut: $_"
        }
    } else {
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
        }
    }
}

Load-Config

# ----------------- Main Form -----------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "BPP NVR Bridge v1.0 — ศูนย์สั่งการ BPP-VMS"
$form.Size = New-Object System.Drawing.Size(760, 750)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 12, 30)
$form.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9.25)

# Try extract icon or use standard
$form.Icon = [System.Drawing.SystemIcons]::Shield

# Top Header Banner
$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(760, 65)
$header.BackColor = [System.Drawing.Color]::FromArgb(24, 18, 48)
$form.Controls.Add($header)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "🛰️ BPP NVR Bridge (Outbound RTMP Client)"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 12.5, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(192, 132, 252)
$lblTitle.Location = New-Object System.Drawing.Point(18, 10)
$lblTitle.AutoSize = $true
$header.Controls.Add($lblTitle)

$lblSubtitle = New-Object System.Windows.Forms.Label
$lblSubtitle.Text = "ส่งต่อสัญญาณภาพจากกล้อง NVR (VIGI / Dahua / Hikvision) สู่ศูนย์กลาง BPP-VMS ข้าม CGNAT/เน็ต 4G"
$lblSubtitle.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblSubtitle.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$lblSubtitle.Location = New-Object System.Drawing.Point(20, 36)
$lblSubtitle.AutoSize = $true
$header.Controls.Add($lblSubtitle)

# Settings GroupBox: Server & Identity
$grpServer = New-Object System.Windows.Forms.GroupBox
$grpServer.Text = " 1. ตั้งค่าเซิร์ฟเวอร์ปลายทาง (BPP-VMS Gateway) "
$grpServer.Location = New-Object System.Drawing.Point(18, 75)
$grpServer.Size = New-Object System.Drawing.Size(708, 70)
$grpServer.ForeColor = [System.Drawing.Color]::FromArgb(168, 85, 247)
$form.Controls.Add($grpServer)

$lblServerHost = New-Object System.Windows.Forms.Label
$lblServerHost.Text = "IP/Domain เซิร์ฟเวอร์:"
$lblServerHost.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblServerHost.Location = New-Object System.Drawing.Point(15, 28)
$lblServerHost.AutoSize = $true
$grpServer.Controls.Add($lblServerHost)

$txtServerHost = New-Object System.Windows.Forms.TextBox
$txtServerHost.Text = if ($global:config.server_host) { $global:config.server_host } else { "192.168.10.200" }
$txtServerHost.Location = New-Object System.Drawing.Point(145, 25)
$txtServerHost.Size = New-Object System.Drawing.Size(185, 23)
$txtServerHost.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtServerHost.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpServer.Controls.Add($txtServerHost)

$lblUnitCode = New-Object System.Windows.Forms.Label
$lblUnitCode.Text = "รหัสหน่วยงาน (Unit Code):"
$lblUnitCode.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblUnitCode.Location = New-Object System.Drawing.Point(350, 28)
$lblUnitCode.AutoSize = $true
$grpServer.Controls.Add($lblUnitCode)

$txtUnitCode = New-Object System.Windows.Forms.TextBox
$txtUnitCode.Text = if ($global:config.unit_code) { $global:config.unit_code } else { "dan_khok_sung" }
$txtUnitCode.Location = New-Object System.Drawing.Point(510, 25)
$txtUnitCode.Size = New-Object System.Drawing.Size(180, 23)
$txtUnitCode.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtUnitCode.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpServer.Controls.Add($txtUnitCode)

# Settings GroupBox: Local NVR Source
$grpNvr = New-Object System.Windows.Forms.GroupBox
$grpNvr.Text = " 2. ข้อมูลเครื่องบันทึก NVR หรือกล้องในวง LAN หน้างาน "
$grpNvr.Location = New-Object System.Drawing.Point(18, 155)
$grpNvr.Size = New-Object System.Drawing.Size(708, 105)
$grpNvr.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$form.Controls.Add($grpNvr)

# Row 1: Brand ComboBox, Custom RTSP Path, Test Button
$lblBrand = New-Object System.Windows.Forms.Label
$lblBrand.Text = "ยี่ห้อ NVR:"
$lblBrand.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblBrand.Location = New-Object System.Drawing.Point(15, 27)
$lblBrand.AutoSize = $true
$grpNvr.Controls.Add($lblBrand)

$cmbNvrBrand = New-Object System.Windows.Forms.ComboBox
$cmbNvrBrand.DropDownStyle = "DropDownList"
$cmbNvrBrand.Items.Add("TP-Link VIGI") | Out-Null
$cmbNvrBrand.Items.Add("Dahua / DH") | Out-Null
$cmbNvrBrand.Items.Add("Hikvision / HIK") | Out-Null
$cmbNvrBrand.Items.Add("กำหนดเอง (Custom URL)") | Out-Null
$cmbNvrBrand.Location = New-Object System.Drawing.Point(85, 24)
$cmbNvrBrand.Size = New-Object System.Drawing.Size(155, 23)
$cmbNvrBrand.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$cmbNvrBrand.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($cmbNvrBrand)

$lblCustomRtsp = New-Object System.Windows.Forms.Label
$lblCustomRtsp.Text = "RTSP Path:"
$lblCustomRtsp.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblCustomRtsp.Location = New-Object System.Drawing.Point(252, 27)
$lblCustomRtsp.AutoSize = $true
$grpNvr.Controls.Add($lblCustomRtsp)

$txtCustomRtspPath = New-Object System.Windows.Forms.TextBox
$txtCustomRtspPath.Location = New-Object System.Drawing.Point(322, 24)
$txtCustomRtspPath.Size = New-Object System.Drawing.Size(243, 23)
$txtCustomRtspPath.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtCustomRtspPath.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($txtCustomRtspPath)

$btnTestRTSP = New-Object System.Windows.Forms.Button
$btnTestRTSP.Text = "ทดสอบเชื่อมต่อ"
$btnTestRTSP.Location = New-Object System.Drawing.Point(580, 23)
$btnTestRTSP.Size = New-Object System.Drawing.Size(110, 25)
$btnTestRTSP.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnTestRTSP.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$btnTestRTSP.FlatStyle = "Flat"
$grpNvr.Controls.Add($btnTestRTSP)

# Row 2: NVR IP, Port, Username, Password
$lblNvrIp = New-Object System.Windows.Forms.Label
$lblNvrIp.Text = "NVR IP:"
$lblNvrIp.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblNvrIp.Location = New-Object System.Drawing.Point(15, 66)
$lblNvrIp.AutoSize = $true
$grpNvr.Controls.Add($lblNvrIp)

$txtNvrIp = New-Object System.Windows.Forms.TextBox
$txtNvrIp.Text = if ($global:config.nvr_ip) { $global:config.nvr_ip } else { "192.168.1.100" }
$txtNvrIp.Location = New-Object System.Drawing.Point(70, 63)
$txtNvrIp.Size = New-Object System.Drawing.Size(115, 23)
$txtNvrIp.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtNvrIp.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($txtNvrIp)

$lblNvrPort = New-Object System.Windows.Forms.Label
$lblNvrPort.Text = "Port:"
$lblNvrPort.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblNvrPort.Location = New-Object System.Drawing.Point(195, 66)
$lblNvrPort.AutoSize = $true
$grpNvr.Controls.Add($lblNvrPort)

$txtNvrPort = New-Object System.Windows.Forms.TextBox
$txtNvrPort.Text = if ($global:config.nvr_port) { $global:config.nvr_port } else { "554" }
$txtNvrPort.Location = New-Object System.Drawing.Point(235, 63)
$txtNvrPort.Size = New-Object System.Drawing.Size(45, 23)
$txtNvrPort.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtNvrPort.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($txtNvrPort)

$lblUser = New-Object System.Windows.Forms.Label
$lblUser.Text = "User:"
$lblUser.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblUser.Location = New-Object System.Drawing.Point(295, 66)
$lblUser.AutoSize = $true
$grpNvr.Controls.Add($lblUser)

$txtUsername = New-Object System.Windows.Forms.TextBox
$txtUsername.Text = if ($global:config.username) { $global:config.username } else { "admin" }
$txtUsername.Location = New-Object System.Drawing.Point(335, 63)
$txtUsername.Size = New-Object System.Drawing.Size(80, 23)
$txtUsername.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtUsername.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($txtUsername)

$lblPass = New-Object System.Windows.Forms.Label
$lblPass.Text = "Pass:"
$lblPass.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$lblPass.Location = New-Object System.Drawing.Point(430, 66)
$lblPass.AutoSize = $true
$grpNvr.Controls.Add($lblPass)

$txtPassword = New-Object System.Windows.Forms.TextBox
$txtPassword.Text = if ($global:config.password) { $global:config.password } else { "" }
$txtPassword.PasswordChar = '*'
$txtPassword.Location = New-Object System.Drawing.Point(470, 63)
$txtPassword.Size = New-Object System.Drawing.Size(95, 23)
$txtPassword.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
$txtPassword.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$grpNvr.Controls.Add($txtPassword)

# Brand ComboBox Change Event
$cmbNvrBrand.Add_SelectedIndexChanged({
    switch ($cmbNvrBrand.SelectedIndex) {
        0 {
            $txtCustomRtspPath.Enabled = $false
            $txtCustomRtspPath.Text = "/ch{ch}/stream1|stream2"
        }
        1 {
            $txtCustomRtspPath.Enabled = $false
            $txtCustomRtspPath.Text = "/cam/realmonitor?channel={ch}&subtype=0|1"
        }
        2 {
            $txtCustomRtspPath.Enabled = $false
            $txtCustomRtspPath.Text = "/Streaming/Channels/{ch}01|02"
        }
        3 {
            $txtCustomRtspPath.Enabled = $true
            if ($global:config.custom_rtsp_path) {
                $txtCustomRtspPath.Text = $global:config.custom_rtsp_path
            } else {
                $txtCustomRtspPath.Text = "/ch{ch}/stream2"
            }
        }
    }
})

# Initialize Brand selection from config
$brandInitialIdx = 0
if ($global:config.nvr_brand) {
    switch ($global:config.nvr_brand) {
        "TP-Link VIGI" { $brandInitialIdx = 0 }
        "Dahua / DH" { $brandInitialIdx = 1 }
        "Hikvision / HIK" { $brandInitialIdx = 2 }
        "กำหนดเอง (Custom URL)" { $brandInitialIdx = 3 }
        default { $brandInitialIdx = 0 }
    }
}
$cmbNvrBrand.SelectedIndex = $brandInitialIdx
if ($brandInitialIdx -eq 3 -and $global:config.custom_rtsp_path) {
    $txtCustomRtspPath.Text = $global:config.custom_rtsp_path
}

# Channels GroupBox
$grpChannels = New-Object System.Windows.Forms.GroupBox
$grpChannels.Text = " 3. เลือกช่องสัญญาณกล้อง (Channels 1 - 16) — อิสระ Sub/Main Stream "
$grpChannels.Location = New-Object System.Drawing.Point(18, 270)
$grpChannels.Size = New-Object System.Drawing.Size(708, 290)
$grpChannels.ForeColor = [System.Drawing.Color]::FromArgb(74, 222, 128)
$form.Controls.Add($grpChannels)

$global:chCheckboxes = @{}
$global:chStreamCombos = @{}
$global:chStatusLabels = @{}

$cfgChannelsMap = @{}
if ($global:config.channels) {
    foreach ($c in $global:config.channels) {
        $cfgChannelsMap[$c.ch] = $c
    }
}

for ($i = 1; $i -le $global:maxChannels; $i++) {
    $col = if ($i -le 8) { 0 } else { 1 }
    $row = if ($i -le 8) { $i - 1 } else { $i - 9 }

    $posX = if ($col -eq 0) { 20 } else { 370 }
    $posY = 25 + ($row * 31)

    $chk = New-Object System.Windows.Forms.CheckBox
    $chk.Text = "ช่อง $i"
    $chk.Location = New-Object System.Drawing.Point($posX, $posY)
    $chk.Size = New-Object System.Drawing.Size(70, 24)
    $chk.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)

    $isChEnabled = $false
    $streamType = "stream2"
    if ($cfgChannelsMap.ContainsKey($i)) {
        $isChEnabled = [bool]$cfgChannelsMap[$i].enabled
        $streamType = $cfgChannelsMap[$i].stream_type
    } elseif ($i -le 4) {
        $isChEnabled = $true
    }
    $chk.Checked = $isChEnabled

    $cmb = New-Object System.Windows.Forms.ComboBox
    $cmb.DropDownStyle = "DropDownList"
    $cmb.Items.Add("Sub Stream (ประหยัดเน็ต)") | Out-Null
    $cmb.Items.Add("Main Stream (ชัดสุด)") | Out-Null
    $cmb.SelectedIndex = if ($streamType -eq "stream1") { 1 } else { 0 }

    $cmb.Location = New-Object System.Drawing.Point(($posX + 75), ($posY + 1))
    $cmb.Size = New-Object System.Drawing.Size(160, 23)
    $cmb.BackColor = [System.Drawing.Color]::FromArgb(10, 8, 22)
    $cmb.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)

    $lblStatus = New-Object System.Windows.Forms.Label
    $lblStatus.Text = if ($isChEnabled) { "⚪ พร้อม" } else { "⚪ ปิด" }
    $lblStatus.Location = New-Object System.Drawing.Point(($posX + 242), ($posY + 3))
    $lblStatus.Size = New-Object System.Drawing.Size(85, 20)
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)

    $grpChannels.Controls.Add($chk)
    $grpChannels.Controls.Add($cmb)
    $grpChannels.Controls.Add($lblStatus)

    $global:chCheckboxes[$i] = $chk
    $global:chStreamCombos[$i] = $cmb
    $global:chStatusLabels[$i] = $lblStatus

    $chk.Add_CheckedChanged({
        param($sender, $e)
        $idx = $null
        foreach ($k in $global:chCheckboxes.Keys) {
            if ($global:chCheckboxes[$k] -eq $sender) { $idx = $k; break }
        }
        if ($idx -and -not $global:isBridging) {
            $global:chStatusLabels[$idx].Text = if ($sender.Checked) { "⚪ พร้อม" } else { "⚪ ปิด" }
            $global:chStatusLabels[$idx].ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
        }
    })
}

# Bottom Controls: Checkboxes & Action Buttons
$chkAutoStart = New-Object System.Windows.Forms.CheckBox
$chkAutoStart.Text = "เริ่มส่งสัญญาณอัตโนมัติเมื่อเปิดโปรแกรมนี้"
$chkAutoStart.Location = New-Object System.Drawing.Point(20, 570)
$chkAutoStart.Size = New-Object System.Drawing.Size(260, 24)
$chkAutoStart.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$chkAutoStart.Checked = [bool]$global:config.autostart_bridge
$form.Controls.Add($chkAutoStart)

$chkStartup = New-Object System.Windows.Forms.CheckBox
$chkStartup.Text = "เปิดโปรแกรมพร้อมเปิดเครื่อง (Run on Windows Startup)"
$chkStartup.Location = New-Object System.Drawing.Point(290, 570)
$chkStartup.Size = New-Object System.Drawing.Size(320, 24)
$chkStartup.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$chkStartup.Checked = [bool]$global:config.run_on_startup
$form.Controls.Add($chkStartup)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = "💾 บันทึกค่า"
$btnSave.Location = New-Object System.Drawing.Point(20, 610)
$btnSave.Size = New-Object System.Drawing.Size(100, 42)
$btnSave.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnSave.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$btnSave.FlatStyle = "Flat"
$form.Controls.Add($btnSave)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "🚀 เริ่มส่งสัญญาณ (Start Bridge)"
$btnStart.Location = New-Object System.Drawing.Point(130, 610)
$btnStart.Size = New-Object System.Drawing.Size(210, 42)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(147, 51, 234)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnStart.FlatStyle = "Flat"
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "⏹️ หยุดส่งสัญญาณ (Stop)"
$btnStop.Location = New-Object System.Drawing.Point(350, 610)
$btnStop.Size = New-Object System.Drawing.Size(160, 42)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$btnStop.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$btnStop.Enabled = $false
$btnStop.FlatStyle = "Flat"
$form.Controls.Add($btnStop)

$btnHideTray = New-Object System.Windows.Forms.Button
$btnHideTray.Text = "📥 ย่อลง System Tray"
$btnHideTray.Location = New-Object System.Drawing.Point(520, 610)
$btnHideTray.Size = New-Object System.Drawing.Size(206, 42)
$btnHideTray.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnHideTray.ForeColor = [System.Drawing.Color]::FromArgb(192, 132, 252)
$btnHideTray.FlatStyle = "Flat"
$form.Controls.Add($btnHideTray)

# Status Bar
$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusStrip.BackColor = [System.Drawing.Color]::FromArgb(24, 18, 48)
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = "สถานะ: พร้อมใช้งาน (หยุดพัก)"
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$statusStrip.Items.Add($statusLabel) | Out-Null
$form.Controls.Add($statusStrip)

# ----------------- System Tray NotifyIcon -----------------
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "BPP NVR Bridge"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuShow = $contextMenu.Items.Add("แสดงหน้าต่าง BPP NVR Bridge")
$menuStart = $contextMenu.Items.Add("เริ่มส่งสัญญาณ")
$menuStop = $contextMenu.Items.Add("หยุดส่งสัญญาณ")
$menuExit = $contextMenu.Items.Add("ปิดโปรแกรม (Exit)")
$notifyIcon.ContextMenuStrip = $contextMenu

$menuShow.Add_Click({
    $form.Show()
    $form.WindowState = "Normal"
    $form.Activate()
})

$notifyIcon.Add_DoubleClick({
    $form.Show()
    $form.WindowState = "Normal"
    $form.Activate()
})

$btnHideTray.Add_Click({
    $form.Hide()
    $notifyIcon.ShowBalloonTip(2000, "BPP NVR Bridge", "โปรแกรมกำลังทำงานในพื้นหลัง (System Tray)", [System.Windows.Forms.ToolTipIcon]::Info)
})

# ----------------- Core Streaming Logic -----------------
function Start-ChannelStream([int]$ch) {
    $chk = $global:chCheckboxes[$ch]
    $cmb = $global:chStreamCombos[$ch]
    $lbl = $global:chStatusLabels[$ch]

    if (-not $chk.Checked) {
        $lbl.Text = "⚪ ปิด"
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
        return
    }

    $streamType = if ($cmb.SelectedIndex -eq 1) { "stream1" } else { "stream2" }
    $subIdx = if ($cmb.SelectedIndex -eq 1) { 0 } else { 1 }
    $user = [System.Uri]::EscapeDataString($txtUsername.Text.Trim())
    $pass = [System.Uri]::EscapeDataString($txtPassword.Text)
    $ip = $txtNvrIp.Text.Trim()
    $port = $txtNvrPort.Text.Trim()
    $serverHost = $txtServerHost.Text.Trim()
    $unit = $txtUnitCode.Text.Trim()

    $brandIdx = $cmbNvrBrand.SelectedIndex
    if ($brandIdx -lt 0) { $brandIdx = 0 }

    $rtspPath = switch ($brandIdx) {
        0 { "/ch${ch}/${streamType}" }
        1 { "/cam/realmonitor?channel=${ch}&subtype=${subIdx}" }
        2 {
            $streamNum = if ($subIdx -eq 0) { "01" } else { "02" }
            "/Streaming/Channels/${ch}${streamNum}"
        }
        3 {
            $customPath = $txtCustomRtspPath.Text.Trim()
            if (-not $customPath) { $customPath = "/ch{ch}/${streamType}" }
            $customPath -replace '\{ch\}', $ch -replace '\{stream\}', $streamType -replace '\{subtype\}', $subIdx
        }
        default { "/ch${ch}/${streamType}" }
    }
    if (-not $rtspPath.StartsWith("/")) { $rtspPath = "/" + $rtspPath }

    $rtspUrl = "rtsp://${user}:${pass}@${ip}:${port}${rtspPath}"
    $rtmpTarget = "rtmp://${serverHost}:1935/live/${unit}_ch${ch}"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffmpegExe
    # Direct Stream Copy (-c copy) ensures ~0% CPU load!
    $psi.Arguments = "-hide_banner -loglevel error -rtsp_transport tcp -stimeout 5000000 -i `"$rtspUrl`" -c copy -flvflags no_duration_filesize -f flv `"$rtmpTarget`""
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    $psi.WindowStyle = "Hidden"

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $global:processes[$ch] = $proc
        $lbl.Text = "🟢 ออนไลน์"
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(74, 222, 128)
    } catch {
        $lbl.Text = "🔴 ผิดพลาด"
        $lbl.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
    }
}

function Stop-AllStreams {
    foreach ($k in $global:processes.Keys) {
        $p = $global:processes[$k]
        if ($p -and -not $p.HasExited) {
            try { $p.Kill() } catch {}
        }
        $lbl = $global:chStatusLabels[$k]
        $chk = $global:chCheckboxes[$k]
        if ($lbl) {
            $lbl.Text = if ($chk.Checked) { "⚪ พร้อม" } else { "⚪ ปิด" }
            $lbl.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
        }
    }
    $global:processes.Clear()
    $global:isBridging = $false

    $btnStart.Enabled = $true
    $btnStart.BackColor = [System.Drawing.Color]::FromArgb(147, 51, 234)
    $btnStop.Enabled = $false
    $btnStop.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $statusLabel.Text = "สถานะ: หยุดการส่งสัญญาณเรียบร้อย"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
}

function Start-AllStreams {
    Save-Config
    $global:isBridging = $true
    $btnStart.Enabled = $false
    $btnStart.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $btnStop.Enabled = $true
    $btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)

    $activeCount = 0
    for ($i = 1; $i -le $global:maxChannels; $i++) {
        if ($global:chCheckboxes[$i].Checked) {
            Start-ChannelStream $i
            $activeCount++
        }
    }

    $statusLabel.Text = "สถานะ: กำลังบริดจ์สัญญาณ ($activeCount ช่องเปิดใช้งาน)"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(74, 222, 128)
}

$btnStart.Add_Click({ Start-AllStreams })
$btnStop.Add_Click({ Stop-AllStreams })
$menuStart.Add_Click({ Start-AllStreams })
$menuStop.Add_Click({ Stop-AllStreams })

$btnSave.Add_Click({
    Save-Config
    [System.Windows.Forms.MessageBox]::Show("บันทึกการตั้งค่าเรียบร้อยแล้ว", "BPP NVR Bridge", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})

# Test Connection Button (Network & RTSP Authentication)
$btnTestRTSP.Add_Click({
    $ip = $txtNvrIp.Text.Trim()
    $portText = $txtNvrPort.Text.Trim()
    $port = if ($portText) { [int]$portText } else { 554 }
    $user = [System.Uri]::EscapeDataString($txtUsername.Text.Trim())
    $pass = [System.Uri]::EscapeDataString($txtPassword.Text)
    
    $statusLabel.Text = "กำลังทดสอบเครือข่าย $ip : $port ..."
    $form.Refresh()
    
    # 1. ทดสอบเชื่อมต่อพอร์ต TCP
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcpOk = $false
    try {
        $ar = $tcp.BeginConnect($ip, $port, $null, $null)
        $wh = $ar.AsyncWaitHandle.WaitOne(3000, $false)
        if ($wh -and $tcp.Connected) {
            $tcp.EndConnect($ar)
            $tcpOk = $true
        }
    } catch {
        $tcpOk = $false
    } finally {
        $tcp.Close()
    }
    
    if (-not $tcpOk) {
        [System.Windows.Forms.MessageBox]::Show(
            "ไม่สามารถเชื่อมต่อไปยัง NVR ที่ $ip : $port ได้!`n`nโปรดตรวจสอบ:`n1. หมายเลข IP และพอร์ตถูกต้องหรือไม่`n2. สาย LAN หรือการเชื่อมต่อท่อ VPN ยังทำงานอยู่หรือไม่",
            "ผลการทดสอบ: การเชื่อมต่อเครือข่ายล้มเหลว",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        $statusLabel.Text = "สถานะ: เชื่อมต่อ NVR ไม่สำเร็จ (Port $port ปิด/ไม่ตอบสนอง)"
        return
    }

    # 2. ทดสอบตรวจสอบสิทธิ์ RTSP Authentication & Stream ผ่าน FFmpeg
    $statusLabel.Text = "เชื่อมต่อพอร์ต $port สำเร็จ! กำลังตรวจสอบรหัสผ่านและสัญญาณภาพ..."
    $form.Refresh()

    $brandIdx = $cmbNvrBrand.SelectedIndex
    if ($brandIdx -lt 0) { $brandIdx = 0 }
    $testPath = switch ($brandIdx) {
        0 { "/ch1/stream2" }
        1 { "/cam/realmonitor?channel=1&subtype=1" }
        2 { "/Streaming/Channels/102" }
        3 {
            $customPath = $txtCustomRtspPath.Text.Trim()
            if (-not $customPath) { $customPath = "/ch{ch}/{stream}" }
            $customPath -replace '\{ch\}', '1' -replace '\{stream\}', 'stream2' -replace '\{subtype\}', '1'
        }
        default { "/ch1/stream2" }
    }
    if (-not $testPath.StartsWith("/")) { $testPath = "/" + $testPath }
    $rtspUrl = "rtsp://${user}:${pass}@${ip}:${port}${testPath}"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ffmpegExe
    $psi.Arguments = "-hide_banner -rtsp_transport tcp -timeout 3000000 -i `"$rtspUrl`" -t 0.1 -f null -"
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true

    $ffmpegProc = $null
    $authSuccess = $false
    $authErrorMsg = ""

    try {
        $ffmpegProc = [System.Diagnostics.Process]::Start($psi)
        $exited = $ffmpegProc.WaitForExit(4500)
        if (-not $exited) {
            try { $ffmpegProc.Kill() } catch {}
        }
        $errText = $ffmpegProc.StandardError.ReadToEnd()

        if ($errText -match "401 Unauthorized|Authentication failed|Server returned 401|method DESCRIBE failed: 401") {
            $authErrorMsg = "ชื่อผู้ใช้ (Username) หรือรหัสผ่าน (Password) ไม่ถูกต้อง (401 Unauthorized)"
        } elseif ($ffmpegProc.ExitCode -eq 0 -or $errText -match "Stream #0:|Video:|Input #0") {
            $authSuccess = $true
        } elseif ($errText -match "404 Not Found") {
            $authSuccess = $true
            $authErrorMsg = "รหัสผ่านถูกต้อง! (แต่ช่องสัญญาณที่ 1 อาจยังไม่ได้เสียบกล้อง: 404)"
        } else {
            $authSuccess = ($ffmpegProc.ExitCode -eq 0)
            if (-not $authSuccess) {
                $firstErr = ($errText -split "`n" | Where-Object { $_ -match "Error|failed|401|404|Invalid" } | Select-Object -First 1)
                $authErrorMsg = if ($firstErr) { $firstErr.Trim() } else { "ไม่สามารถดึงข้อมูลสตรีมได้" }
            }
        }
    } catch {
        $authErrorMsg = $_.Exception.Message
    } finally {
        if ($ffmpegProc) { $ffmpegProc.Dispose() }
    }

    if ($authSuccess) {
        $detailMsg = if ($authErrorMsg) { "`n`nหมายเหตุ: $authErrorMsg" } else { "" }
        [System.Windows.Forms.MessageBox]::Show(
            "เชื่อมต่อ NVR สำเร็จ และตรวจสอบรหัสผ่านถูกต้อง 100%!$detailMsg",
            "ผลการทดสอบ: สำเร็จ",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
        $statusLabel.Text = "สถานะ: เชื่อมต่อ NVR และตรวจสอบรหัสผ่านสำเร็จ"
    } else {
        [System.Windows.Forms.MessageBox]::Show(
            "เชื่อมต่อพอร์ต NVR สำเร็จ แต่ดึงภาพไม่สำเร็จ!`n`nสาเหตุ: $authErrorMsg`n`nโปรดตรวจสอบ:`n1. ชื่อผู้ใช้และรหัสผ่าน NVR ถูกต้องหรือไม่`n2. รูปแบบยี่ห้อ NVR (VIGI/Dahua/Hikvision) เลือกตรงกับเครื่องหรือไม่",
            "ผลการทดสอบ: รหัสผ่านไม่ถูกต้อง หรือรูปแบบผิดพลาด",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        $statusLabel.Text = "สถานะ: รหัสผ่าน NVR ไม่ถูกต้อง หรือดึงภาพไม่สำเร็จ"
    }
})

# ----------------- Watchdog Timer -----------------
$watchdogTimer = New-Object System.Windows.Forms.Timer
$watchdogTimer.Interval = 5000
$watchdogTimer.Add_Tick({
    if ($global:isBridging) {
        for ($i = 1; $i -le $global:maxChannels; $i++) {
            if ($global:chCheckboxes[$i].Checked) {
                $proc = $global:processes[$i]
                if (-not $proc -or $proc.HasExited) {
                    $global:chStatusLabels[$i].Text = "🟡 กำลังเชื่อมใหม่"
                    $global:chStatusLabels[$i].ForeColor = [System.Drawing.Color]::FromArgb(250, 204, 21)
                    Start-ChannelStream $i
                }
            }
        }
    }
})
$watchdogTimer.Start()

# ----------------- Form Closing Handling -----------------
$form.Add_FormClosing({
    param($sender, $e)
    # Minimize to tray instead of quitting if active
    if ($global:isBridging) {
        $e.Cancel = $true
        $form.Hide()
        $notifyIcon.ShowBalloonTip(2000, "BPP NVR Bridge", "ระบบยังคงบริดจ์สัญญาณต่อไปในพื้นหลัง (System Tray)", [System.Windows.Forms.ToolTipIcon]::Info)
    } else {
        Stop-AllStreams
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
    }
})

$menuExit.Add_Click({
    Stop-AllStreams
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

# Check autostart flag
if ($global:config.autostart_bridge) {
    $form.Add_Shown({
        Start-AllStreams
        # If autostarted, minimize to tray silently
        $form.Hide()
    })
}

[System.Windows.Forms.Application]::Run($form)
