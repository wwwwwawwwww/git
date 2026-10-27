param()

$ErrorActionPreference = 'Stop'
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'PrivateChat.vbs'
if (Test-Path $vbs) {
    Remove-Item -Force $vbs
    Write-Host "Autostart entry removed." -ForegroundColor Green
} else {
    Write-Host "No autostart entry found." -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
