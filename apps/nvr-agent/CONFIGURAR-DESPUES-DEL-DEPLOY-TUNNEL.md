# Tunnel-server configurado

URL del túnel en uso:

- **HTTPS:** `https://tunnel-server-698108879063.us-central1.run.app`
- **WebSocket (agente y app):** `wss://tunnel-server-698108879063.us-central1.run.app`

---

## Dónde está configurado

1. **Agente – config.properties**  
   `platform.tunnel_url=wss://tunnel-server-698108879063.us-central1.run.app`

2. **N8N – nodo "GET snapshot NVR"**  
   URL: `https://tunnel-server-698108879063.us-central1.run.app/snapshot?nvrId=...&channel=...`  
   (si importás el JSON del repo, ya viene con esta URL)

3. **App web (para "Ver en vivo")**  
   Variable de entorno **NEXT_PUBLIC_TUNNEL_WS_URL** = `wss://tunnel-server-698108879063.us-central1.run.app`  
   (en Vercel o en `apps/web2/.env.local`)

Si en el futuro cambiás la URL del tunnel-server, actualizá estos tres lugares.
