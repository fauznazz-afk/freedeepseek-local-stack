@echo off
REM Stops the launcher's processes and anything still holding 9655 / 20128.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
pause
