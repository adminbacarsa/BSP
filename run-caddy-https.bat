@echo off
REM Ejecutar Caddy para HTTPS (autbacar.dnsalias.com -> N8N en 5678)
setlocal
set "CADDY_DIR=D:\APP\caddy"
set "CADDY_EXE=%CADDY_DIR%\caddy.exe"
set "SRC_EXE=C:\Users\Soporte\Downloads\caddy_windows_amd64.exe"

if not exist "%CADDY_DIR%" mkdir "%CADDY_DIR%"

if not exist "%CADDY_EXE%" (
    if exist "%SRC_EXE%" (
        echo Copiando Caddy desde Downloads...
        copy /Y "%SRC_EXE%" "%CADDY_EXE%"
    ) else (
        echo No se encuentra %SRC_EXE%
        echo Descarga Caddy desde https://github.com/caddyserver/caddy/releases
        echo y guardalo como caddy_windows_amd64.exe en Descargas.
        pause
        exit /b 1
    )
)

copy /Y "%~dp0Caddyfile.n8n" "%CADDY_DIR%\Caddyfile" >nul 2>&1
echo Caddyfile actualizado en %CADDY_DIR%
echo.
echo Iniciando Caddy (deja esta ventana abierta)...
echo N8N debe estar corriendo en el puerto 5678.
echo Luego entra a https://autbacar.dnsalias.com
echo.
cd /d "%CADDY_DIR%"
"%CADDY_EXE%" run
pause
