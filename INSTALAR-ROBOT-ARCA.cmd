@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Este instalador tiene que correr como administrador.
  echo Clic derecho en INSTALAR-ROBOT-ARCA.cmd y despues "Ejecutar como administrador".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\arca-robot\instalar.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" echo Termino con pendientes. El detalle quedo en D:\arca-txt\instalar.log
pause
exit /b %ERR%