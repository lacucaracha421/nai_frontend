@echo off
setlocal
cd /d "%~dp0"

title NAI V5 Studio - Web Server

set "NAI_PORT=3080"
set "NAI_URL=http://127.0.0.1:%NAI_PORT%"
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%PATH%"

REM Already running? Just open the browser.
powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod '%NAI_URL%/api/health' -TimeoutSec 1; if ($r.ok) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  echo [INFO] Web server is already running at %NAI_URL%
  start "" "%NAI_URL%"
  exit /b 0
)

if not exist "dist\index.html" (
  echo [INFO] Building frontend...
  call npm run build || (echo [ERROR] Frontend build failed.& pause& exit /b 1)
)

set "SERVER_EXE="
if exist "src-tauri\target\release\nai-web-server.exe" (
  set "SERVER_EXE=src-tauri\target\release\nai-web-server.exe"
) else if exist "src-tauri\target\debug\nai-web-server.exe" (
  set "SERVER_EXE=src-tauri\target\debug\nai-web-server.exe"
)

REM Open the browser in the background once the server is ready.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command ^
  "for ($i = 0; $i -lt 120; $i++) { try { $r = Invoke-RestMethod '%NAI_URL%/api/health' -TimeoutSec 1; if ($r.ok) { Start-Process '%NAI_URL%'; break } } catch {}; Start-Sleep -Milliseconds 300 }"

echo [OK] Starting NAI V5 Studio Web Server on %NAI_URL%
echo      (Keep this window open while using the web app.)
echo.

if defined SERVER_EXE (
  "%SERVER_EXE%" --port %NAI_PORT%
) else (
  call npm run web:server -- --port %NAI_PORT%
)

echo.
echo Web server stopped.
pause
endlocal
