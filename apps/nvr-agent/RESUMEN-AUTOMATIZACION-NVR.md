# Resumen: automatización NVR Dahua → plataforma

Documento único que resume todo el flujo que querés y cómo encaja cada pieza. Nada se quita; el túnel es la solución para vivo y para que N8N pueda pedir el snapshot al NVR cuando esté en la nube.

---

## Objetivo de la automatización

1. **Leer alarmas y alertas** de las NVR Dahua.
2. En el **agente**, excluir detecciones de movimiento **salvo IVS** (eventos inteligentes).
3. **Keep-alive**: saber que estamos conectados a esa NVR (heartbeats + detección de desconexión).
4. Cuando hay **alerta**: usar **IA** para clasificar (intrusión, robo, merodeo, etc.).
5. Enviar esa alerta a la **plataforma** y poder **abrir el canal en vivo** o ir abriendo los canales donde ocurre la alerta para seguimiento (visible en la plataforma).
6. **Otros tipos de alerta** (cámara no funciona, no graba): procesarlos y enviar el mensaje correspondiente para avisar del problema.

---

## Componentes

| Componente | Rol |
|------------|-----|
| **NVR Dahua** | Genera eventos (IVS, pérdida de video, obstrucción, etc.). |
| **Agente (nvr-agent)** | Conectado al NVR por NetSDK; filtra por tipo (IVS, SMART_EX, VIDEOLOST_EX, SHELTER_EX, etc.); envía eventos y heartbeats al webhook de N8N; abre túnel para video en vivo. |
| **N8N** | Recibe eventos del agente; keep-alive (hoja Heartbeats + trigger cada 2 min → AGENT_OFFLINE/ONLINE); pide snapshot al NVR (vía túnel o red cuando N8N puede llegar al NVR); llama a IA (OpenAI Vision); reenvía alertas a CronoApp (nvrAgentEvents) y escribe en Google Sheet. |
| **Túnel (tunnel-server)** | Permite que la **plataforma** y, si hace falta, **N8N** lleguen al NVR aunque esté en red local: vivo en el navegador y, si N8N está en la nube, GET snapshot puede ir por el mismo túnel o por un proxy que exponga el NVR. |
| **Plataforma (CronoApp)** | Recibe eventos en nvrAgentEvents; muestra alertas y permite **abrir canal en vivo** (conexión al túnel); puede mostrar los canales donde está ocurriendo la alerta para seguimiento. |
| **IA (OpenAI Vision)** | Clasifica la imagen del snapshot (intrusión, robo, merodeo, etc.) para decidir si notificar o no. |

---

## Flujo paso a paso

1. **NVR** dispara un evento (IVS, pérdida de video, obstrucción, etc.).
2. **Agente** recibe por NetSDK; si el tipo está en `event.types.include` (IVS/ALARM_EX, SMART_EX, VIDEOLOST_EX, SHELTER_EX, etc.), envía **POST** al **webhook de N8N** (body: nvrId, channel, eventTypeName, status, timestamp, etc.).
3. **Agente** envía **heartbeats** cada X segundos al mismo webhook (type=heartbeat). N8N escribe en la hoja **Heartbeats** (nvrId, LastHeartbeat, Ts). El **trigger cada 2 min** lee esa hoja; si un NVR no tiene latido en 3 min → **AGENT_OFFLINE**; si vuelve → **AGENT_ONLINE** (una vez por cambio). Eso es el **keep-alive**.
4. **N8N** recibe el POST; si no es heartbeat:
   - Envía el evento a **CronoApp** (nvrAgentEvents) y a **Google Sheet (alertas)**.
   - Rama de **snapshot + IA**: obtiene IP del NVR (nodo “NVR → IP y credenciales”), llama **GET snapshot NVR** (http al NVR). Para que esto funcione con N8N en la nube hace falta que N8N pueda alcanzar al NVR: **túnel o proxy** que exponga el NVR (mismo que para vivo, o uno específico para peticiones HTTP al NVR).
   - Con la imagen, **OpenAI Vision** etiqueta (intrusión, merodeo, etc.); según la etiqueta se puede filtrar o priorizar y enviar a CronoApp / Slack.
5. **Plataforma** recibe el evento en nvrAgentEvents; guarda la alerta y permite **“Ver en vivo”**: la app se conecta al **túnel** y muestra el stream del canal. Idealmente se pueden ir abriendo los canales donde ocurre la alerta para seguimiento (eso se resuelve en la app con la info de nvrId + channel que ya llega en el evento).
6. **Alertas de fallo** (cámara no funciona, no graba): son eventos como **VIDEOLOST_EX**, **SHELTER_EX**. El agente ya los incluye en `event.types.include`; N8N los recibe y los puede enviar a la plataforma y/o a un mensaje específico (ej. “Cámara X sin señal” / “Cámara X obstruida”) procesándolos en un nodo o rama aparte si querés texto distinto.

---

## Túnel: para qué sirve y qué falta

- **Video en vivo en la plataforma:** ya está pensado: agente abre conexión al **tunnel-server** (Cloud Run); la app usa **NEXT_PUBLIC_TUNNEL_WS_URL** y “Ver en vivo” se conecta a ese túnel. Ver **PASO-A-PASO-CONEXION-Y-VIVO.md**.
- **GET snapshot NVR desde N8N en la nube:** Implementado por **túnel**. El tunnel-server expone **GET /snapshot?nvrId=&channel=**; N8N llama a esa URL (con Bearer = agent_secret); el servidor le pide al agente (por el mismo WebSocket del túnel) la imagen; el agente la pide al NVR y la devuelve. Ver **SNAPSHOT-POR-TUNEL.md**. En el workflow N8N el nodo "GET snapshot NVR" debe usar la URL del tunnel-server (reemplazar el placeholder en la URL). Si N8N está en la misma red que el NVR, podés seguir usando la IP directa del NVR en ese nodo.

Por ahora el workflow tiene el nodo **GET snapshot NVR** activo; cuando el túnel (o proxy) para que N8N llegue al NVR esté listo, solo hay que apuntar ese nodo a la URL que exponga el NVR (o dejar la IP si N8N está en la misma red).

---

## Checklist rápido

- [ ] **Agente:** `event.types.include` con IVS, SMART_EX, VIDEOLOST_EX, SHELTER_EX, etc. (sin MOTION_EX salvo que lo quieras).
- [ ] **Agente:** `platform.url` = webhook N8N; `platform.key` = agent_secret; `platform.tunnel_url` = URL del tunnel-server (wss://...) para vivo.
- [ ] **N8N:** workflow importado; URL de nvrAgentEvents correcta; Authorization = Bearer con el mismo secret que en Firestore (webhook.secret o nvr_devices.agent_secret).
- [ ] **N8N:** hoja Heartbeats con nvrId, LastHeartbeat, Ts; trigger cada 2 min activo → keep-alive y AGENT_OFFLINE/ONLINE.
- [ ] **Tunnel-server** desplegado; app con NEXT_PUBLIC_TUNNEL_WS_URL; agente con platform.tunnel_url → **canal en vivo** en la plataforma.
- [ ] **GET snapshot NVR:** cuando N8N esté en la nube, definir túnel/proxy HTTP al NVR y apuntar el nodo ahí; o correr N8N en la misma red que el NVR.
- [ ] **IA:** OPENAI_API_KEY en N8N; nodo OpenAI Vision con la etiqueta que quieras (intrusión, merodeo, etc.).
- [ ] **Alertas de fallo:** VIDEOLOST_EX / SHELTER_EX ya llegan; en N8N o en la plataforma podés mapear a mensajes tipo “Cámara sin señal” / “Cámara obstruida”.

Con esto tenés el mapa completo de la automatización sin quitar nada; el túnel es la pieza que resuelve vivo y, cuando esté listo el acceso HTTP desde N8N al NVR, también el snapshot y la IA en la nube.
