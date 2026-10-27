@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=%~1
if "%PORT%"=="" set PORT=8787

rem 如果服务已经在跑，直接打开浏览器，避免“端口被占用”的误解
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:%PORT%'; exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
  echo.
  echo   服务已经在运行，已帮你打开浏览器。
  ping -n 2 127.0.0.1 >nul
  exit /b 0
)

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
  echo   启动失败：没找到 Python，或者端口被别的程序占用了。
  echo   需要 Python 3.11 以上版本。
  pause
)
