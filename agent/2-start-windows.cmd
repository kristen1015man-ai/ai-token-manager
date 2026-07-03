@echo off
setlocal
cd /d "%~dp0"

echo Sparkloom Agent - start
echo.
echo Keep this window open while using Sparkloom Studio.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"

echo.
echo Sparkloom Agent has stopped.
pause
