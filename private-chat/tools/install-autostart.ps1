param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$pythonw = Get-Command pythonw.exe -ErrorAction SilentlyContinue
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonw -and -not $python) {
    Write-Host "没找到 Python。请先安装 Python 3.11+ 并加入 PATH。" -ForegroundColor Yellow
    exit 1
}
$exe = if ($pythonw) { $pythonw.Source } else { $python.Source }

$action = New-ScheduledTaskAction -Execute $exe `
    -Argument "`"$root\app\server.py`" --port 8787" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName 'PrivateChat' -Action $action -Trigger $trigger `
    -Settings $settings -Description '两个人私密聊天本地服务（127.0.0.1:8787）' -Force | Out-Null

Write-Host "已创建计划任务 PrivateChat。" -ForegroundColor Green
Write-Host "下次登录 Windows 会在后台自动启动（无窗口）。" -ForegroundColor Cyan
Write-Host "如果启动失败，先运行 uninstall-autostart.bat 取消，再用 start.bat 前台启动看报错。" -ForegroundColor Yellow
Start-Sleep -Seconds 3
