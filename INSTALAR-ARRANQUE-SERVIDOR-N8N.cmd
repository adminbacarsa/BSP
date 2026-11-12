@echo off
REM Instala el arranque automatico de la PC N8N: inicio de sesion automatico de Soporte
REM + tarea "COSP Servidor N8N" (N8N por NSSM, pm2 resurrect, Caddy HTTPS).
REM Clic derecho -> Ejecutar como administrador.
REM Argumentos opcionales:
REM   sinautologon   solo la tarea (sin inicio de sesion automatico)
REM   quitarautologon  desactiva el inicio de sesion automatico
REM   quitar         quita la tarea

cd /d "%~dp0"
echo Repo: %CD%
echo.

if /i "%~1"=="sinautologon" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-n8n-server-startup.ps1"
) else if /i "%~1"=="quitarautologon" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-n8n-server-startup.ps1" -DisableAutoLogon
) else if /i "%~1"=="quitar" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-n8n-server-startup.ps1" -Unregister
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-n8n-server-startup.ps1" -AutoLogon
)

echo.
echo Probar sin reiniciar: schtasks /Run /TN "COSP Servidor N8N"
echo Log: %%ProgramData%%\COSP\n8n-server-startup.log
pause
