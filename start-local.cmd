@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing local dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Installation failed.
    pause
    exit /b 1
  )
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5173'"
echo Starting the lesson at http://localhost:5173
echo Keep this window open while using the lesson. Press Ctrl+C to stop.
call npm.cmd run dev:pages
