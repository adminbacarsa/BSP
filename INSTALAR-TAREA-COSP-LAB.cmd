@echo off
REM Instala la tarea programada "COSP Lab" (emuladores + seed + Next al reinicio).
REM Clic derecho -> Ejecutar como administrador
REM Opcional: arrastrar o pasar argumento "logon" para disparo al iniciar sesion (usuario actual) en lugar de SYSTEM al arranque.

cd /d "%~dp0"
echo Repo: %CD%
echo.

if /i "%~1"=="logon" (
  echo Modo: inicio de sesion (usuario actual^)
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-cosp-lab-scheduled-task.ps1"
) else (
  echo Modo: arranque del sistema como SYSTEM (3 min demora; sin login^)
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-cosp-lab-scheduled-task.ps1" -AtStartupAsSystem
)

echo.
echo Probar: schtasks /Run /TN "COSP Lab"
echo Diagnostico desde repo: npm run diagnose:lab
echo Trazas: %%ProgramData%%\COSP\trace.log
pause
