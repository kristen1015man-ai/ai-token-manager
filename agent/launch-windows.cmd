@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0support\sparkloom-windows.ps1" -Mode Launch
if errorlevel 1 (
  echo.
  echo Sparkloom did not finish setup. Please send a screenshot of this window to support.
  echo.
  pause
)
