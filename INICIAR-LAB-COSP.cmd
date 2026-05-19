@echo off
REM COSP Lab — emuladores + seed + Next + Cursor (doble clic o desde consola).
REM Opciones: INICIAR-LAB-COSP.cmd -Restart   (reinicia puertos antes)
REM           INICIAR-LAB-COSP.cmd -NoSeed
REM           INICIAR-LAB-COSP.cmd -Network    (Next accesible en la red local)

cd /d "%~dp0"
title COSP Lab Launcher
echo.
echo  COSP Lab — iniciando emuladores, seed y Next.js...
echo  Repo: %CD%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cosp-lab.ps1" %*

if errorlevel 1 (
  echo.
  echo  ERROR en el arranque. Revisá JDK 21+, Node, firebase-tools y GEMINI_API_KEY en apps\functions\.env
  pause
  exit /b 1
)

echo.
echo  Ventanas abiertas: "COSP Emulators" y "COSP Next :3000"
echo  Cerrá esas ventanas para detener el lab.
timeout /t 8 >nul
