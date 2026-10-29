@echo off
REM End-to-end check: proxy, 9router, and a real completion through both.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify.ps1" %*
pause
