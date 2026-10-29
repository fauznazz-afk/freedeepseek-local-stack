@echo off
REM Starts FreeDeepseekAPI (9655) + 9router (20128) hidden and verifies the chain.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
    echo.
    echo [FAIL] Something did not come up. Check the logs folder.
)
pause
