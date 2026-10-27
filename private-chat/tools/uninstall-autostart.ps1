param()

$ErrorActionPreference = 'Stop'
try {
    Unregister-ScheduledTask -TaskName 'PrivateChat' -Confirm:$false
    Write-Host "已删除计划任务 PrivateChat。" -ForegroundColor Green
} catch {
    Write-Host "没有找到计划任务 PrivateChat，或删除失败。" -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
