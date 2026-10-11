Set objShell = CreateObject("WScript.Shell")
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\BPP-NVR-Bridge.ps1"

' Unblock file silently
objShell.Run "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command ""Unblock-File -Path '" & scriptPath & "' -ErrorAction SilentlyContinue""", 0, True

' Run the main script
If CreateObject("Scripting.FileSystemObject").FileExists(scriptPath) Then
    objShell.Run "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """", 0, False
Else
    MsgBox "à¹„à¸¡à¹ˆà¸žà¸šà¹„à¸Ÿà¸¥à¹Œ BPP-NVR-Bridge.ps1 !" & vbCrLf & vbCrLf & "à¸„à¸¸à¸“à¸à¸³à¸¥à¸±à¸‡à¹€à¸›à¸´à¸”à¹‚à¸›à¸£à¹à¸à¸£à¸¡à¸ˆà¸²à¸à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œ .zip à¹‚à¸”à¸¢à¸•à¸£à¸‡à¹ƒà¸Šà¹ˆà¸«à¸£à¸·à¸­à¹„à¸¡à¹ˆ?" & vbCrLf & "à¸à¸£à¸¸à¸“à¸²à¸„à¸¥à¸´à¸à¸‚à¸§à¸²à¸—à¸µà¹ˆà¹„à¸Ÿà¸¥à¹Œ .zip à¹à¸¥à¹‰à¸§à¹€à¸¥à¸·à¸­à¸ Extract All (à¹à¸•à¸à¹„à¸Ÿà¸¥à¹Œ) à¸à¹ˆà¸­à¸™à¹ƒà¸Šà¹‰à¸‡à¸²à¸™", 16, "BPP NVR Bridge - Error"
End If
