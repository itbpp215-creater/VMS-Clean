$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("BPP-VMS NVR.lnk")

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
Write-Host "Shortcut created at BPP-VMS NVR.lnk"
