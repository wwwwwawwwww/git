@echo off
cd /d "%~dp0"
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge.ps1" >> "C:\NapCat\bridge-console.log" 2>&1
