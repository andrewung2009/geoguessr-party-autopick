@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\autostart.ps1" install
set "EXITCODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXITCODE%
