@echo off
title antigravity-hans uninstaller
echo.
echo   ============================================
echo    antigravity-hans  -  uninstaller
echo   ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1"

echo.
echo   Press any key to close this window.
pause >nul
