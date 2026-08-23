@echo off
setlocal
cd /d "%~dp0"

title NAI V5 S11 - Android Dev

set "JAVA_HOME=C:\Program Files\Java\jdk-17"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "NDK_HOME=%ANDROID_HOME%\ndk\30.0.15729638"
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

where node >nul 2>nul || (echo [ERROR] node.exe not found.& pause& exit /b 1)
where cargo >nul 2>nul || (echo [ERROR] cargo.exe not found.& pause& exit /b 1)
where adb >nul 2>nul || (echo [ERROR] adb.exe not found.& pause& exit /b 1)

adb get-state >nul 2>nul || (
  echo [ERROR] Galaxy Tab not detected. Connect USB and allow USB debugging.
  adb devices
  pause
  exit /b 1
)

echo [INFO] Releasing stale Vite port 1420...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ids=Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach($p in $ids){Stop-Process -Id $p -Force -ErrorAction SilentlyContinue}" >nul 2>nul

timeout /t 1 /nobreak >nul

echo [OK] Starting Tauri Android dev...
echo.
call npm run tauri -- android dev --host 127.0.0.1

echo.
echo Android dev process ended.
pause
endlocal
