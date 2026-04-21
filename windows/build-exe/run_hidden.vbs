Set WshShell = CreateObject("WScript.Shell")

' 获取当前目录
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 指定端口
port = "3000"

' 构造命令（设置端口 + 日志）
cmd = "cmd /c cd /d """ & currentDir & """ && set PORT=" & port & " && moonplayer-server.exe >> run.log 2>&1"

' 隐藏运行
WshShell.Run cmd, 0, False