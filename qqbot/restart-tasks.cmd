@echo off
set LOG=%TEMP%\restart-tasks.log
echo === %DATE% %TIME% === > "%LOG%"
taskkill /f /im QQ.exe >> "%LOG%" 2>&1
ping -n 4 127.0.0.1 >nul
schtasks /change /tn NapCatBoot /tr "G:\大肥鱼工作区\qqbot\start-napcat.cmd" >> "%LOG%" 2>&1
schtasks /change /tn QQBridge /tr "G:\大肥鱼工作区\qqbot\start-bridge.cmd" >> "%LOG%" 2>&1
schtasks /run /tn NapCatBoot >> "%LOG%" 2>&1
ping -n 16 127.0.0.1 >nul
schtasks /run /tn QQBridge >> "%LOG%" 2>&1
echo done >> "%LOG%"
