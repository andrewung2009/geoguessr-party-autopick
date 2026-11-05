@echo off
setlocal
cd /d "%~dp0.."

if not exist "logs" mkdir "logs"

if exist "logs\bridge.log" (
  move /y "logs\bridge.log" "logs\bridge.log.old" >nul 2>&1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [autostart] Node.js is not installed or not on PATH. >> "logs\bridge.log"
  exit /b 1
)

if not exist ".env" (
  echo [autostart] .env is missing. Run setup.bat first. >> "logs\bridge.log"
  exit /b 1
)

if not exist "node_modules" (
  echo [autostart] node_modules is missing. Run setup.bat first. >> "logs\bridge.log"
  exit /b 1
)

:loop
node src\discord.js >> "logs\bridge.log" 2>&1
set "EXITCODE=%ERRORLEVEL%"

if "%EXITCODE%"=="0" (
  exit /b 0
)

if "%EXITCODE%"=="3" (
  echo [autostart] Bridge port is in use. Retrying in 30 seconds... >> "logs\bridge.log"
  ping -n 31 127.0.0.1 >nul
) else (
  echo [autostart] Bridge exited with code %EXITCODE%. Restarting in 5 seconds... >> "logs\bridge.log"
  ping -n 6 127.0.0.1 >nul
)

goto loop
