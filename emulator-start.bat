@echo off
title Firebase Emulator - CronoApp
cd /d "%~dp0"

echo.
echo ════════════════════════════════════════════════════════
echo   Firebase Emulator  ^|  Firestore + Auth + Functions
echo ════════════════════════════════════════════════════════
echo.

if exist emulator-data (
    echo   [datos persistidos encontrados — importando...]
    echo.
    firebase emulators:start --only firestore,auth,functions --import=./emulator-data --export-on-exit=./emulator-data
) else (
    echo   [sin datos previos — arrancando limpio...]
    echo.
    firebase emulators:start --only firestore,auth,functions --export-on-exit=./emulator-data
)

pause
