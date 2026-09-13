@echo off
title antigravity-hans installer
echo.
echo   ============================================
echo    antigravity-hans  -  one-click installer
echo   ============================================
echo.
echo   This will patch your Antigravity shortcuts so the
echo   interface comes up in Chinese. Your original
echo   shortcuts are backed up automatically.
echo.
echo   Antigravity itself is NOT modified.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"

echo.
echo   Press any key to close this window.
pause >nul
