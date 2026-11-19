@echo off
rem Lanzador de alta-empresa.js: doble clic en el servidor (carpeta del bridge).
rem Para que pueda recargar Caddy / arrancar pm2 sin problemas: clic derecho > Ejecutar como administrador.
chcp 65001 >nul
cd /d "%~dp0"
title Alta de WA Bridge por empresa

where node >nul 2>nul
if errorlevel 1 (
  echo [XX] No encontre Node.js en este equipo. Abri la consola donde corre el bridge o instala Node.js.
  echo.
  pause
  exit /b 1
)

if not exist "alta-empresa.js" (
  echo [XX] Falta alta-empresa.js en la carpeta %cd%
  echo.
  pause
  exit /b 1
)

node alta-empresa.js %*

echo.
echo Listo. Esta ventana se puede cerrar.
pause
