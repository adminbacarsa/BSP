@echo off
REM Instala la tarea "COSP Auto Pull" (cada 5 min: git fetch + pull + reinicio lab si hay commits nuevos).
REM Clic derecho -> Ejecutar como administrador
REM Opcional: argumento "logon" = usuario actual; sin argumento = SYSTEM al arranque + cada 5 min.

cd /d "%~dp0"
echo Repo: %CD%
echo.

if /i "%~1"=="logon" (
  echo Modo: usuario actual + cada 5 min
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-cosp-auto-pull-task.ps1"
) else (
  echo Modo: arranque SYSTEM + cada 5 min
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-cosp-auto-pull-task.ps1" -AtStartupAsSystem
)

echo.
echo Probar: schtasks /Run /TN "COSP Auto Pull"
echo Log: logs\auto-pull.log
echo Quitar: npm run unregister:auto-pull-task
pause
