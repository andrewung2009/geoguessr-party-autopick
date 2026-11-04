@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Dependencies are missing. Run setup.bat first.
  pause
  exit /b 1
)

echo Registering the Discord command...
node src\register.js
set EXITCODE=%ERRORLEVEL%
echo.
echo Exit code: %EXITCODE%
pause
exit /b %EXITCODE%
