@echo off
REM COSP Lab completo — emuladores + seed + Next + Expo (app móvil guardia).
REM Uso:
REM   INICIAR-LAB-COSP-FULL.cmd
REM   INICIAR-LAB-COSP-FULL.cmd -Restart
REM   INICIAR-LAB-COSP-FULL.cmd -NoSeed

cd /d "%~dp0"
title COSP Lab Full (Web + Mobile)
echo.
echo  COSP Lab FULL — emuladores, seed, Next.js y Expo...
echo  Repo: %CD%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cosp-lab.ps1" -WithExpo -Network -NoCursor %*

if errorlevel 1 (
  echo.
  echo  ERROR en el arranque. Revisá JDK 21+, Node, firebase-tools y GEMINI_API_KEY en apps\functions\.env
  pause
  exit /b 1
)

echo.
echo  Ventanas: "COSP Emulators", "COSP Next", "COSP Expo :8081"
echo  Detener todo: npm run stop:lab:all
timeout /t 10 >nul
