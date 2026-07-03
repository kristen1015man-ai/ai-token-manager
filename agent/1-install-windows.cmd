@echo off
setlocal
cd /d "%~dp0"

echo Sparkloom Agent - first install
echo.
echo This will check and install Node.js, Git, Python and Sparkloom Agent SDK when missing.
echo If Windows asks for permission, confirm it on this computer.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"

echo.
echo If Sparkloom Agent is running, keep this window open.
echo Return to https://ai.seapllo.com/studio and refresh Agent status.
echo.
pause
