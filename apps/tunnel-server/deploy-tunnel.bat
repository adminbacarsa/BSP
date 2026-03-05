@echo off
REM Despliega tunnel-server en Google Cloud Run (incluye endpoint /snapshot para N8N).
REM Requiere: gcloud instalado y login (gcloud auth login), proyecto comtroldata.
setlocal
cd /d "%~dp0"

echo Instalando dependencias...
call npm install
if errorlevel 1 (
  echo Fallo npm install
  pause
  exit /b 1
)

echo.
echo Desplegando en Cloud Run (region us-central1, proyecto comtroldata)...
gcloud run deploy tunnel-server --source . --region us-central1 --allow-unauthenticated --project comtroldata
if errorlevel 1 (
  echo Fallo el deploy. Revisa gcloud auth login y gcloud config set project comtroldata
  pause
  exit /b 1
)

echo.
echo Listo. Copia la URL que muestra Cloud Run (ej. https://tunnel-server-XXXXX-uc.a.run.app).
echo Luego reemplaza en:
echo   1. apps\nvr-agent\config.properties - platform.tunnel_url=wss://tunnel-server-XXXXX-uc.a.run.app
echo   2. N8N nodo "GET snapshot NVR" - URL: https://tunnel-server-XXXXX-uc.a.run.app/snapshot?...
echo   3. App web - NEXT_PUBLIC_TUNNEL_WS_URL=wss://tunnel-server-XXXXX-uc.a.run.app
echo.
pause
