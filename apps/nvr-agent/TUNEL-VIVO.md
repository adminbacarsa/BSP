# Túnel saliente para video en vivo

> **Guía paso a paso:** [PASO-A-PASO-CONEXION-Y-VIVO.md](PASO-A-PASO-CONEXION-Y-VIVO.md) — conexión agente → plataforma y vivo por túnel.

Cuando el agente está en una red distinta a la de la plataforma (o del operador), el navegador no puede conectar directo al NVR. En ese caso el **agente abre un túnel saliente** hacia la plataforma y hace de puente: la plataforma recibe el stream por ese túnel y lo sirve al navegador.

---

## Arquitectura

```
[ NVR ]  <--LAN-->  [ Agente (PC) ]  --WebSocket (saliente)-->  [ Servidor túnel (Cloud Run) ]  <--WebSocket-->  [ Navegador ]
                         |                                                        |
                    snapshot loop                                              relay
                    (HTTP al NVR)                                          (agent ↔ browser)
```

1. **Agente** abre una conexión WebSocket **saliente** al servidor túnel (no abre puertos en la red del cliente).
2. El agente se autentica con `nvrId` + `agent_secret` (el mismo que usa para nvrAgentEvents).
3. Cuando un usuario hace clic en "Ver en vivo" para ese NVR, la **app** abre un WebSocket al mismo servidor túnel con `nvrId` + canal + token de la sesión.
4. El **servidor túnel** une ambos extremos: le pide al agente "empezar stream canal N" y reenvía cada frame que el agente envía hacia el WebSocket del navegador.
5. El **agente** obtiene frames del NVR (p. ej. snapshot HTTP en bucle) y los envía por su WebSocket al servidor.

---

## Componentes

### 1. Servidor túnel (`apps/tunnel-server`)

- **WebSocket** en la ruta `/agent`: lo usan los agentes. Primer mensaje: `{ type: 'auth', nvrId, agent_secret }`. El servidor valida contra Firestore `nvr_devices/{nvrId}.agent_secret` y asocia la conexión a ese `nvrId`.
- **WebSocket** en la ruta `/live`: lo usa el navegador. Query: `?nvrId=...&channel=...&token=...` (token = Firebase ID token o token de corta duración). El servidor valida el token, busca la conexión del agente para ese `nvrId`, envía al agente `{ type: 'start_stream', channel }`, y reenvía cada mensaje binario o base64 del agente al navegador.
- Cuando el navegador cierra, el servidor envía al agente `{ type: 'stop_stream', channel }`.
- Formato del stream: el agente envía **frames JPEG** (snapshots). El navegador recibe una secuencia de JPEG y los muestra (p. ej. en un `<img>` actualizando el `src`, o canvas). Opcionalmente el servidor puede enviar como MJPEG HTTP si el cliente lo prefiere.

### 2. Agente (Java)

- Nueva config: `platform.tunnel_url` (ej. `wss://tunnel-xxx.run.app`).
- Al arrancar, si `tunnel_url` está definido, abre WebSocket a `{tunnel_url}/agent`, envía auth con `nvrId` y `platform.key` (agent_secret). Mantiene la conexión abierta y reconecta si se cae.
- Al recibir `{ type: 'start_stream', channel: N }`: inicia un bucle que cada ~150 ms hace GET al snapshot del NVR (p. ej. `http://nvr.ip/cgi-bin/snapshot.cgi?channel=N` con Basic Auth), lee los bytes de la imagen y los envía por el WebSocket al servidor (binario o base64). Al recibir `stop_stream` para ese canal, detiene el bucle.

### 3. App web (Ver en vivo)

- Variable de entorno **`NEXT_PUBLIC_TUNNEL_WS_URL`**: URL base del servidor túnel (ej. `wss://tunnel-xxx.run.app`). Si está definida y el NVR tiene `stream_via_tunnel: true` o `agent_registered: true`, la página "Ver en vivo" abre un WebSocket a `{TUNNEL_WS_URL}/live?nvrId=...&channel=...&token=<Firebase ID token>`, recibe los frames JPEG y los muestra en un `<img>` que se actualiza.
- Si no hay túnel configurado o el NVR no está registrado por agente, se usa el comportamiento actual (conexión directa al NVR con stream_ip en iframe Dahua).

---

## Seguridad

- **Agente:** solo acepta conexiones que envíen un `agent_secret` que coincida con `nvr_devices[nvrId].agent_secret` en Firestore.
- **Navegador:** el parámetro `token` debe ser un Firebase ID token válido (o un token de corta duración generado por una Cloud Function tras validar que el usuario tiene permiso). El servidor túnel verifica el token antes de unir al viewer con el agente.
- **Tráfico:** WebSocket puede ir por TLS (wss://). Los frames de video viajan por ese canal.

---

## Despliegue del servidor túnel

El servidor está en **`apps/tunnel-server`** (Node.js + Express + ws). Se despliega en **Google Cloud Run**:

- El agente y el navegador se conectan a la URL del servicio (ej. `https://tunnel-xxx-uc.a.run.app`); WebSocket se hace por la misma URL (Cloud Run soporta upgrade a WebSocket).
- Variables de entorno: `GOOGLE_APPLICATION_CREDENTIALS` o cuenta de servicio para leer Firestore (nvr_devices, agent_secret). Opcional: `PORT=8080`.

En Firestore, en `nvr_devices/{nvrId}` se puede añadir el campo **`stream_via_tunnel: true`** cuando el NVR se registró por agente y se quiere que "Ver en vivo" use el túnel en lugar de la IP directa.
