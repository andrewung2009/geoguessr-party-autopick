@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org
  pause
  exit /b 1
)

node setup.js
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Setup finished. Next: run register.bat, then start.bat.
pause
