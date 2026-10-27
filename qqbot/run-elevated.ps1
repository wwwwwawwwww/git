$ErrorActionPreference = 'Continue'
$b = 'G:\大肥鱼工作区\qqbot\napcat'
$log = Join-Path $b 'elevated-run.log'
"=== start $(Get-Date -Format 'HH:mm:ss') ===" | Set-Content -Encoding UTF8 $log
$env:NAPCAT_PATCH_PACKAGE = "$b\qqnt.json"
$env:NAPCAT_LOAD_PATH = "$b\loadNapCat.js"
$env:NAPCAT_INJECT_PATH = "$b\NapCatWinBootHook.dll"
$env:NAPCAT_LAUNCHER_PATH = "$b\NapCatWinBootMain.exe"
$env:NAPCAT_MAIN_PATH = "$b\napcat.mjs"
"QQ path exists: $(Test-Path 'E:\QQ\QQ.exe')" | Add-Content -Encoding UTF8 $log
& "$b\NapCatWinBootMain.exe" 'E:\QQ\QQ.exe' "$b\NapCatWinBootHook.dll" *>> $log
"exit=$LASTEXITCODE" | Add-Content -Encoding UTF8 $log
"=== end $(Get-Date -Format 'HH:mm:ss') ===" | Add-Content -Encoding UTF8 $log
