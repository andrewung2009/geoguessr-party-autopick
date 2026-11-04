@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo .env is missing. Run setup.bat first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are missing. Run setup.bat first.
  pause
  exit /b 1
)

node src\discord.js
if errorlevel 1 pause
