# Tunnel Server (túnel saliente para vivo)

Servidor WebSocket que permite a los **agentes** conectar por un túnel saliente y servir video en vivo a la **app** sin que el navegador tenga que alcanzar la red del NVR.

## Rutas

- **`/agent`** (WebSocket): agentes. Primer mensaje: `{ "type": "auth", "nvrId": "...", "agent_secret": "..." }`. Luego reciben `start_stream` / `stop_stream` y envían frames JPEG (binario).
- **`/live`** (WebSocket): navegador. Query: `?nvrId=...&channel=...&token=<Firebase ID token>`.
- **`/health`** (GET): salud para Cloud Run.

## Despliegue en Cloud Run

```bash
cd apps/tunnel-server
gcloud run deploy tunnel-server --source . --region us-central1 --allow-unauthenticated
```

O con Docker:

```bash
docker build -t tunnel-server .
docker run -p 8080:8080 -e GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json tunnel-server
```

En Firestore, los NVRs que usan túnel deben tener `agent_secret` (y opcionalmente `stream_via_tunnel: true` para que la app elija vivo por túnel).
