@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=%~1
if "%PORT%"=="" set PORT=8787
echo.
echo   正在启动私密聊天（端口 %PORT%）...
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 app\server.py --port %PORT% --open
) else (
  python app\server.py --port %PORT% --open
)
if errorlevel 1 (
  echo.
  echo   启动失败：没找到 Python，或者端口被占用了。
  echo   需要 Python 3.11 以上版本。
  pause
)
