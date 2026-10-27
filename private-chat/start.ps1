param(
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  Write-Host "没找到 Python。请先安装 Python 3.11 或更新版本，并勾选 Add to PATH。" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "  正在启动私密聊天（端口 $Port）..." -ForegroundColor Cyan
Write-Host ""
& $python.Source "app\server.py" --port $Port --open
