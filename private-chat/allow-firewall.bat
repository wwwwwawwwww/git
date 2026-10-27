@echo off
chcp 65001 >nul
echo 正在请求管理员权限，放行 TCP 8787（仅专用网络）...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0tools\allow-firewall.ps1'"
echo 已弹出 UAC 窗口，请在窗口里点「是」。
pause
