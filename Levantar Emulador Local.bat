@echo off
title COSP V1.0 - Entorno Local
cd /d "C:\APP\cronoapp"

:: Buscar el backup mas reciente en C:\tmp\
set BACKUP=
for /f "delims=" %%f in ('dir "C:\tmp\backup_*.json" /b /o-d 2^>nul') do (
  if not defined BACKUP set BACKUP=C:\tmp\%%f
)

if not defined BACKUP (
  echo No se encontro ningun backup en C:\tmp\
  echo Descarga un backup desde Drive y guardalo en C:\tmp\
  echo.
  pause
  exit /b 1
)

echo Usando backup: %BACKUP%
echo.

powershell -ExecutionPolicy Bypass -File ".\scripts\start-emulator.ps1" "%BACKUP%"
