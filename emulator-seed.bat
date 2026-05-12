@echo off
title Seed Usuarios - Emulador CronoApp
cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════════
echo   Seed Usuarios  ^|  Emulador debe estar corriendo
echo ════════════════════════════════════════════════════════
echo.
echo   Firestore : localhost:8080
echo   Auth      : localhost:9099
echo   UI        : http://127.0.0.1:4000
echo.

node scripts/seed-usuarios.js

echo.
pause
