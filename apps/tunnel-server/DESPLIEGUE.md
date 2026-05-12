# Desplegar túnel de video en Cloud Run

## Requisitos

- [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) instalado.
- Proyecto de Firebase/Google Cloud (ej. **comtroldata**).

## Comandos (PowerShell)

```powershell
# 1. Login y proyecto
gcloud auth login
gcloud config set project comtroldata

# 2. Ir a la carpeta del túnel e instalar dependencias
cd D:\APP\cronoapp\apps\tunnel-server
npm install

# 3. Desplegar en Cloud Run
gcloud run deploy tunnel-server --source . --region us-central1 --allow-unauthenticated --project comtroldata
```

Si preferís ejecutar desde la raíz del repo:

```powershell
cd D:\APP\cronoapp
gcloud run deploy tunnel-server --source apps/tunnel-server --region us-central1 --allow-unauthenticated --project comtroldata
```

## Después del despliegue

- URL en uso: `https://tunnel-server-698108879063.us-central1.run.app`
- WebSocket (agente y app): `wss://tunnel-server-698108879063.us-central1.run.app`
- Agente: `platform.tunnel_url=wss://tunnel-server-698108879063.us-central1.run.app` en `config.properties` (ya configurado).
- App: variable de entorno `NEXT_PUBLIC_TUNNEL_WS_URL=wss://tunnel-server-698108879063.us-central1.run.app`.

## Permisos

Cloud Run usa la cuenta de servicio del proyecto. Para validar `agent_secret` en Firestore y tokens de Firebase Auth no suele hacer falta configurar nada más si el proyecto es el mismo que Firebase (comtroldata).
