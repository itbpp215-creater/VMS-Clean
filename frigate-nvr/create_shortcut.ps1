$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\BPP-VMS NVR.lnk")

# Try to use Edge, fallback to Chrome if Edge doesn't exist
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

if (Test-Path $edgePath) {
    $Shortcut.TargetPath = $edgePath
} elseif (Test-Path $chromePath) {
    $Shortcut.TargetPath = $chromePath
} else {
    $Shortcut.TargetPath = "msedge.exe"
}

$Shortcut.Arguments = "--app=https://localhost/"
$Shortcut.WindowStyle = 1
$Shortcut.Description = "BPP-VMS NVR System"
$Shortcut.Save()
Write-Host "Shortcut created at $DesktopPath\BPP-VMS NVR.lnk"
