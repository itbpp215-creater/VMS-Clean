Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
proxyPath = fso.BuildPath(scriptDir, "rtsp_proxy.js")
WshShell.Run """C:\Program Files\nodejs\node.exe"" """ & proxyPath & """", 0, False
