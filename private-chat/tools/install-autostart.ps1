param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$pythonw = Get-Command pythonw.exe -ErrorAction SilentlyContinue
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonw -and -not $python) {
    Write-Host "Python not found. Install Python 3.11+ and add it to PATH." -ForegroundColor Yellow
    exit 1
}
$exe = if ($pythonw) { $pythonw.Source } else { $python.Source }
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'PrivateChat.vbs'

# Windows Script Host 读取 UTF-16 LE 最稳，中文路径不会乱码
$content = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run """$exe"" ""$root\app\server.py"" --port 8787", 0, False
"@
[System.IO.File]::WriteAllText($vbs, $content, [System.Text.Encoding]::Unicode)

Write-Host "Autostart entry created:" -ForegroundColor Green
Write-Host "  $vbs"
Write-Host "It starts the chat server silently after your next Windows login." -ForegroundColor Cyan
Write-Host "To remove it, run uninstall-autostart.bat." -ForegroundColor Yellow
Start-Sleep -Seconds 3
