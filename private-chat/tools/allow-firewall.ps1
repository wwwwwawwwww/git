param()

$ErrorActionPreference = 'Stop'
$ruleName = 'PrivateChat 8787'

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "防火墙规则已存在：$ruleName" -ForegroundColor Green
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort 8787 -Action Allow -Profile Private | Out-Null
    Write-Host "已放行 TCP 8787（仅专用网络）。手机现在可以访问了。" -ForegroundColor Green
}

Write-Host ""
Write-Host "如果还是连不上，确认手机和电脑在同一个 Wi-Fi，并检查电脑当前 IP。" -ForegroundColor Cyan
Start-Sleep -Seconds 3
