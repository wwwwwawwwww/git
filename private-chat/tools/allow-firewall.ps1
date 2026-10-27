param()

$ErrorActionPreference = 'Stop'
$ruleName = 'PrivateChat 8787'

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Firewall rule already exists: $ruleName" -ForegroundColor Green
} else {
    # 只放行同一局域网内的设备，不向整个互联网开放
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort 8787 -Action Allow -Profile Private,Public `
        -RemoteAddress LocalSubnet | Out-Null
    Write-Host "Allowed TCP 8787 from the local subnet only." -ForegroundColor Green
}

Write-Host ""
Write-Host "If your phone still cannot connect:"
Write-Host "  - make sure both devices are on the same Wi-Fi"
Write-Host "  - some public/campus Wi-Fi blocks device-to-device traffic"
Write-Host "  - try a phone hotspot, or use Tailscale (see README)"
Start-Sleep -Seconds 3
