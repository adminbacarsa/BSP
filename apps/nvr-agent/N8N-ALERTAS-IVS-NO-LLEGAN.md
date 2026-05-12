# Las alertas (IVS) no llegan a CronoApp pero los heartbeats sí

## Flujo recomendado: todo por agente y N8N

**No uses** el envío HTTP directo del NVR (ej. “Subida de imágenes” a 192.168.0.8:8080/nvrAlertV2). Ese camino no pasa por el agente, las alertas no llevan tu `nvrId` de forma consistente y **no podés abrir el canal en vivo** desde la alerta.

El flujo correcto es:

1. **NVR** → (NetSDK, callback de alarmas) → **Agente** (Java).
2. **Agente** → POST al **webhook de N8N** (`platform.url`) con cada evento (IVS, ALARM_EX, SMART_EX, etc.) y con heartbeats.
3. **N8N** → recibe, filtra heartbeats, y para alertas llama a **nvrAgentEvents** (y opcionalmente snapshot → **nvrAlertV2**).
4. En **CronoApp** la alerta tiene el mismo `nvrId` y canal que el agente → **“Ver en vivo”** abre el canal (túnel o directo) correcto.

Así tenés **alertas inteligentes** (IVS, humanos, vehículos) y **siempre la opción de abrir el vivo** desde la alerta. El agente debe tener en `event.types.include` los tipos que envía el NVR para IVS (p. ej. ALARM_EX, SMART_EX, SMART_EXT_EX); no hace falta ningún proxy HTTP en 192.168.0.8.

---

## Llegan heartbeats pero no las otras señales (alertas)

Si **solo** llega la señal “estoy vivo” (heartbeat) y **no** las alertas (IVS, ALARM_EX, VIDEOLOST_EX, etc.), revisá en este orden:

1. **¿El agente envía eventos?**  
   Con el agente corriendo, generá un evento (pasar por la línea IVS, tapar cámara, etc.). En la consola del agente deberías ver:
   ```text
   [NVR] Evento recibido: ALARM_EX canal=0 start
   [PlatformSender] Evento enviado: ALARM_EX ch=0 start
   ```
   - Si **no** aparece: el NVR no está mandando eventos al SDK o el agente no está suscrito. Revisá la configuración IVS en el NVR y que el agente esté conectado.
   - Si aparece **"Evento omitido (no en lista)"**: en `config.properties` el `event.types.include` no incluye ese tipo (ej. ALARM_EX). Añadí el tipo que necesitás.

2. **¿N8N recibe el POST de la alerta?**  
   En N8N → Workflow → **Executions**: cuando disparás una alarma, debería aparecer **una ejecución nueva** además de las de heartbeat. Abrila y mirá el **Webhook**: el body debe tener `nvrId`, `eventTypeName`, `channel`, `status`, `timestamp` (y **no** `type: "heartbeat"`).
   - Si no hay ejecución al disparar la alarma: el agente no está llegando al webhook (URL, firewall, o el agente no envía el POST).
   - Si hay ejecución pero el body viene en otro formato (ej. sin `body` anidado), el workflow ya usa `($json.body || $json)` en el nodo "Enviar evento a CronoApp (directo)" para soportar ambos formatos.

3. **¿La rama “alertas” se ejecuta?**  
   En esa misma ejecución, abrí el nodo **"Solo alertas (no heartbeat)"**: la salida **verdadera** (alertas) debe tener 1 ítem. Si todo va a la salida **falsa**, el body tiene `type: "heartbeat"` o el nodo está mal configurado (debe ser “not equals” a `heartbeat`).

4. **¿El nodo “Enviar evento a CronoApp (directo)” corre y responde 200?**  
   Abrí ese nodo en la ejecución: si falla (error rojo), mirá el mensaje (ej. 401 = secret incorrecto; 400 = body mal formado). Si responde 200, la Cloud Function recibió el evento; revisá en Firestore (colección `alerts`) o en Operaciones si aparece la alerta.

5. **Workflow activo y webhook correcto**  
   El workflow tiene que estar **activado** (toggle en verde). La URL que usa el agente (`platform.url`) debe ser exactamente la del webhook de N8N (ej. `https://autbacar.dnsalias.com/webhook/nvr-alertas`).

En el JSON del workflow (`n8n-workflow-nvr-alert-corregido.json`) el nodo "Enviar evento a CronoApp (directo)" usa `($json.body || $json)` para leer los campos, así que funciona tanto si el webhook entrega el body en `$json.body` como en `$json`.

---

## "En alarmas hay muchas generadas" pero el sheet está vacío

El NVR tiene su **propio log de alarmas** (la pantalla donde ves 1350 eventos IVS "Hoy"). Ese log es **interno** del NVR: registra cada vez que se dispara una regla IVS. Eso **no** implica que el NVR esté enviando esos mismos eventos al **agente** por el SDK.

Para que algo llegue al **sheet** (y a CronoApp) tiene que pasar:

1. **NVR** → envía el evento al **agente** (por el protocolo NetSDK / callback de alarmas).
2. **Agente** → no lo omite (`event.types.include`) y hace POST al webhook de N8N.
3. **N8N** → recibe, va por la rama de alertas (no heartbeat) y escribe en la hoja "Hoja 1" (alertas) y llama a nvrAgentEvents.

Si el **sheet está vacío** de alertas pero el NVR muestra muchas, lo más probable es que el NVR **no esté enviando** esos eventos IVS al agente por el SDK (solo los escribe en su log interno).

**Qué hacer:**

1. **Probar en vivo:** Con el agente corriendo, dispará una regla IVS (entrá en el sector, cruzá la línea, etc.). En la **consola del agente** mirá si en ese momento aparece algo como:
   ```text
   [NVR] Evento recibido: ALARM_EX canal=4 start
   [PlatformSender] Evento enviado: ALARM_EX ch=4 start
   ```
   - Si **sí** aparece → el NVR sí manda al SDK; entonces el fallo está en N8N o en la rama (revisá ejecuciones del workflow y que "Google Sheets (alertas)1" esté en la rama **verdadera** de "Solo alertas (no heartbeat)").
   - Si **no** aparece nada cuando se dispara la IVS → el NVR no está notificando al cliente (agente). Hay que revisar en el **NVR**:
     - En la regla IVS (Regla1, Intrusión, etc.), en **"más"** / acciones de alarma: además de "Alarm Upload" (HTTP) y "Evento" (registro local), suele haber opciones como **"Notificar"**, **"Enviar a centro de vigilancia"** o **"Notify Surveillance Center"**. Esas deben estar habilitadas para que el NVR envíe el evento al cliente conectado por el protocolo (NetSDK).
     - En **Configuración del NVR** → **Eventos** / **Alarmas** / **Canal**: a veces hay que activar "Enviar al cliente" o "Push event" para el canal o para el tipo IVS.
2. **Hoja de N8N:** El workflow escribe alertas en la hoja cuando el webhook recibe un POST que **no** es heartbeat (rama verdadera de "Solo alertas (no heartbeat)"). Comprobá que ese nodo esté conectado a **"Google Sheets (alertas)1"** (o la hoja que uses para alertas) en la **primera** salida (índice 0 = alertas). Si la conexión va solo a "Enviar evento a CronoApp (directo)" y no a la hoja, el sheet seguirá vacío aunque CronoApp reciba eventos; si querés registro en sheet, la rama de alertas tiene que llegar también al nodo de Google Sheets.

Resumen: el log de alarmas del NVR y el sheet no son lo mismo. Para que el sheet (y CronoApp) se llenen, el NVR tiene que **enviar** el evento al agente por el SDK; si no envía, hay que habilitar en el NVR la notificación al cliente / centro de vigilancia para las reglas IVS.

---

## Las dos señales fijas "Canal 0" y "Santiago 1" (AGENT_OFFLINE)

**No vienen de la NVR ni del agente por HTTP.** El agente (Java) solo envía a la plataforma: (1) eventos del SDK (ALARM_EX, MOTION_EX, VIDEOLOST_EX, etc.) y (2) heartbeats (`type: "heartbeat"`). **AGENT_OFFLINE no lo envía ni la NVR ni el agente**; no existe en el código del agente.

Lo que ves en la app como "ALERTA IVS — EVENTO" con tipo **AGENT_OFFLINE** (ej. "Santiago 1", "Canal 0") son alertas creadas cuando **N8N** llama a **nvrAgentEvents** con `eventTypeName: 'AGENT_OFFLINE'`. Eso lo hace el workflow **"Monitor Heartbeats"** (nodo "Cada 2 minuto" → Leer Heartbeats → NVRs sin heartbeat en 1 min → Enviar AGENT_OFFLINE a CronoApp). Los heartbeats no crean tarjetas; solo se guardan en la hoja "Heartbeats"; N8N lee esa hoja y, si un NVR no tiene heartbeat en el último minuto, envía un POST a nvrAgentEvents con AGENT_OFFLINE. Si el trigger "Cada 2 minuto" está **desactivado**, esa rama no corre; las tarjetas que ves se crearon cuando el trigger estaba activo o en una ejecución anterior.

### ¿Por qué dice "Santiago 1" o "Canal 0"?

Ese nombre **no lo manda el heartbeat ni el evento**. Lo toma la **plataforma** al mostrar la alerta: busca en Firestore la ruta/canal asociada al `nvrId` (y canal si viene) y usa el **nombre del canal** configurado en NVR | Servidor (camera_routes). Si tenés un canal llamado "Santiago 1" y otro "Canal 0" (o el primero sin nombre y la app muestra "Canal 0"), la tarjeta muestra ese texto. Para AGENT_OFFLINE a veces se usa la primera ruta del NVR o un canal por defecto, por eso ves dos nombres distintos para lo que en el fondo es "agente offline".

### Heartbeats vs trigger desactivado

- **Heartbeats:** los envía el **agente** (cada X segundos) al **webhook** (Webhook1). Eso no depende del nodo "Cada 2 minuto". Por eso los heartbeats siguen llegando aunque el trigger esté desactivado: el agente hace POST a `https://autbacar.dnsalias.com/webhook/nvr-alertas` y N8N recibe, filtra con "Solo alertas (no heartbeat)" y manda el heartbeat a la hoja. El trigger "Cada 2 minuto" solo sirve para **leer** esa hoja y, si falta un heartbeat reciente, **enviar** AGENT_OFFLINE a CronoApp.
- **"Enviar evento" no funciona:** el nodo **"Enviar evento a CronoApp (nvrAgentEvents)"** está **después** de GET snapshot y OpenAI. Si GET snapshot falla (N8N no alcanza la IP del NVR), la ejecución se corta y ese nodo nunca se ejecuta. Por eso las **alertas** (IVS, etc.) no llegan a CronoApp. La solución es añadir el nodo **"Enviar evento a CronoApp (directo)"** justo después de "Solo alertas (no heartbeat)" (salida verdadera), para que cada alerta se envíe a nvrAgentEvents en cuanto llega, sin depender del snapshot ni de la IA.

---

## Por qué las alertas IVS no llegan

En tu workflow, **"Enviar evento a CronoApp (nvrAgentEvents)"** está **después** de:

- NVR → IP y credenciales  
- **GET snapshot NVR** (HTTP al NVR)  
- Merge, Añadir imageBase64, **OpenAI Vision**, Merge (ítem + resultado IA)

Si **GET snapshot NVR** o **OpenAI** fallan (por ejemplo N8N en la nube no alcanza la IP del NVR `192.168.0.102`, o falla la API de OpenAI), la ejecución se corta y **nunca se llama a nvrAgentEvents**. Por eso en CronoApp solo ves heartbeats y no alertas.

Además, el nodo **"NVR → IP y credenciales"** tiene un mapa con `'Bacar M102'`. Si tu agente usa **nvr.id=8F0001CPAZ21EFD**, ese mapa no coincide y `nvr_ip` queda vacío, y el GET snapshot falla.

---

## Solución 1: Enviar cada alerta a CronoApp en cuanto llega (recomendado)

Así las alertas siempre llegan a Operaciones, aunque falle el snapshot o la IA.

1. En N8N, abrí el workflow **"NVR Alert con imagen, IA y enlace a vivo"**.
2. Justo después del nodo **"Solo alertas (no heartbeat)"**, en la salida **verdadera** (alertas):
   - Añadí un nodo **HTTP Request**.
   - Nombre sugerido: **"Enviar evento a CronoApp (directo)"**.
3. Configurá ese nodo:
   - **Method:** POST  
   - **URL:** `https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents`  
   - **Send Headers:** sí. Añadí:
     - **Name:** `Authorization`  
     - **Value:** `Bearer RRrtHM69t3p-_1v903UXkQZvSBWvP51PJ0BxOQSnTe0`  
     (o el valor de `platform.key` / `nvr_config/webhook.secret` que uses).
   - **Send Body:** sí. **Body Content Type:** JSON.  
   - **Body:**
     ```json
     {
       "nvrId": "{{ $json.body.nvrId }}",
       "channel": {{ $json.body.channel }},
       "eventTypeName": "{{ $json.body.eventTypeName }}",
       "status": "{{ $json.body.status }}",
       "timestamp": "{{ $json.body.timestamp }}"
     }
     ```
4. **Conexiones:**
   - Entrada del nuevo nodo: salida **verdadera** (índice 0) de **"Solo alertas (no heartbeat)"**.
   - Salida del nuevo nodo: entradadel nodo **"NVR → IP y credenciales"** (sustituir la conexión que venía directamente desde "Solo alertas (no heartbeat)").

Con esto, cada alerta que llegue al webhook se envía **en seguida** a nvrAgentEvents y después sigue el flujo de snapshot e IA. Si el snapshot o la IA fallan, la alerta ya está en CronoApp.

---

## Solución 2: Mapear tu NVR 8F0001CPAZ21EFD

Para que el GET snapshot funcione cuando N8N sí pueda alcanzar el NVR (misma red o VPN):

1. Editá el nodo **"NVR → IP y credenciales"** (Code).
2. En el objeto `map`, añadí tu NVR:
   ```javascript
   const map = {
     'Bacar M102': { nvr_ip: '192.168.0.102', nvr_user: 'admin', nvr_pass: '18July75$' },
     '8F0001CPAZ21EFD': { nvr_ip: '192.168.0.102', nvr_user: 'admin', nvr_pass: '18July75$' }
   };
   ```
3. Guardá. Así, cuando llegue una alerta con `nvrId: "8F0001CPAZ21EFD"`, se usará esa IP y credenciales.

(Si N8N está en internet y el NVR en LAN, el GET snapshot seguirá fallando por red; la Solución 1 igual hace que las alertas lleguen a CronoApp.)

---

## Comprobar que el agente recibe eventos IVS

En `config.properties`:

- **MOTION_EX** no está en la lista a propósito (genera demasiadas alertas de movimiento bruto).
- Para **alertas inteligentes** (contornos humanos, IVS, cruce de línea, intrusión) se usan:
  - **ALARM_EX**: reglas IVS configuradas en la NVR (línea, intrusión, etc.).
  - **SMART_EX** / **SMART_EXT_EX**: otros eventos inteligentes que envía la NVR (códigos 0x218f, 0x3016).

Ejemplo: `event.types.include=VIDEOLOST_EX,SHELTER_EX,ALARM_EX,SMART_EX,SMART_EXT_EX`. Con eso el agente envía solo esas alertas al webhook.

1. Con el agente en marcha, generá un evento IVS (pasar por la línea, etc.).
2. En la consola del agente deberías ver algo como:
   ```text
   [NVR] Evento recibido: ALARM_EX canal=0 start
   ```
3. Si eso **no** aparece, el problema está en el NVR o en el NetSDK (susripción a eventos, configuración IVS en el equipo). Si **sí** aparece y en N8N no hay ejecución en la rama de alertas, revisá que la condición **"Solo alertas (no heartbeat)"** use `$json.body.type` **not equals** `heartbeat` (las alertas no llevan `type`, así que deben ir por la rama verdadera).

---

## Resumen

| Qué hacer | Dónde |
|-----------|--------|
| Añadir nodo "Enviar evento a CronoApp (directo)" justo después de "Solo alertas (no heartbeat)" (salida true) | N8N workflow |
| Poner en ese nodo: POST a nvrAgentEvents, body con `$json.body.*`, header Authorization con tu secret | Mismo nodo |
| Conectar: Solo alertas (true) → nuevo nodo → NVR → IP y credenciales | N8N |
| Añadir `8F0001CPAZ21EFD` al mapa de NVR → IP | Nodo Code "NVR → IP y credenciales" |
| Ver en consola del agente "[NVR] Evento recibido: ALARM_EX" al disparar IVS | PC del agente |

Con la Solución 1, todas las alertas (incluidas IVS) llegarán a CronoApp aunque falle el snapshot o la IA.

---

## JSON del nodo para importar en N8N

En el repo está el archivo **`n8n-nodo-enviar-evento-cronoapp-directo.json`** con la definición del nodo "Enviar evento a CronoApp (directo)".

**Cómo usarlo en N8N:**

1. Abrí el workflow y añadí un nodo **HTTP Request** (arrastrándolo desde el panel izquierdo).
2. En ese nodo, hacé clic en los tres puntos (⋮) → **Import from JSON** / **Pegar desde portapapeles** si N8N lo ofrece, o configurá el nodo a mano con los valores del JSON:
   - **URL:** `https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents`
   - **Method:** POST
   - **Header** `Authorization`: `Bearer` + tu agent_secret (reemplazá `TU_AGENT_SECRET_AQUI` en el JSON por el valor de `platform.key`).
   - **Body JSON:** el que está en `jsonBody` del JSON (usa `$json.body.nvrId`, `$json.body.channel`, etc.).
3. Conectá: salida **verdadera** de "Solo alertas (no heartbeat)" → este nodo → entrada de "NVR → IP y credenciales".

Si tu versión de N8N permite pegar un nodo desde JSON, copiá el contenido de `n8n-nodo-enviar-evento-cronoapp-directo.json` y pegá en el canvas o en "Add node" → "From JSON".

**Workflow completo corregido (una sola importación):** Para actualizar todo el workflow de una vez (enviar evento directo, Authorization con placeholder, mapa NVR con 8F0001CPAZ21EFD, proxy/túnel vivo y IA documentados, sin duplicar evento tras IA), importá en N8N el archivo **`n8n-workflow-nvr-alert-corregido.json`**. Después reemplazá en todos los nodos `REEMPLAZAR_AGENT_SECRET` por tu agent_secret y configurá `OPENAI_API_KEY` en Variables de N8N.

---

# Soluciones resumidas (las dos cosas)

## Problema 1: Las alertas IVS (y otras) no llegan a CronoApp — "Enviar evento" no funciona

**Causa:** El nodo "Enviar evento a CronoApp (nvrAgentEvents)" está después de GET snapshot y OpenAI; si alguno falla, la ejecución se corta y el nodo no se ejecuta.

**Solución:**

1. Añadí un nodo **"Enviar evento a CronoApp (directo)"** justo después de **"Solo alertas (no heartbeat)"** (salida verdadera).
2. Configuración del nodo:
   - **Method:** POST  
   - **URL:** `https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents`  
   - **Header:** `Authorization` = `Bearer` + tu **agent_secret** (el de `platform.key` en el agente, o el de `nvr_config/webhook.secret` en Firestore). **No uses** `123456` si no es tu secret real.
   - **Body (JSON):**
     ```json
     {
       "nvrId": "{{ $json.body.nvrId }}",
       "channel": {{ $json.body.channel }},
       "eventTypeName": "{{ $json.body.eventTypeName }}",
       "status": "{{ $json.body.status }}",
       "timestamp": "{{ $json.body.timestamp }}"
     }
     ```
3. Conectá: **Solo alertas (no heartbeat)** [salida true] → **Enviar evento a CronoApp (directo)** → **NVR → IP y credenciales** (la salida del nuevo nodo reemplaza la conexión directa que iba al NVR).
4. Podés usar el JSON del repo: `n8n-nodo-enviar-evento-cronoapp-directo.json` (reemplazando `TU_AGENT_SECRET_AQUI` por tu secret).

Con esto, **todas** las alertas (IVS, VIDEOLOST_EX, etc.) llegan a CronoApp en cuanto pasan por el webhook, sin depender del snapshot ni de la IA.

---

## Problema 2: Dos tarjetas fijas "Santiago 1" y "Canal 0" (AGENT_OFFLINE duplicadas)

**Causa:** El workflow "Monitor Heartbeats" (Cada 2 min → Leer Heartbeats → NVRs sin heartbeat en 1 min) puede estar devolviendo **varios ítems** por NVR (por ejemplo uno por fila de la hoja o por canal), y cada ítem genera un POST a nvrAgentEvents. La plataforma crea una alerta por cada POST; como el nombre de la tarjeta sale del canal (camera_routes), ves "Santiago 1" y "Canal 0" para lo que en realidad es un solo agente offline.

**Soluciones (elegí una o ambas):**

### A. En N8N: enviar solo un AGENT_OFFLINE por NVR

En el nodo **"NVRs sin heartbeat en 1 min"** (Code), asegurate de devolver **un solo ítem por NVR** (agrupar por `nvrId`). Ejemplo de lógica:

- Leer la hoja de heartbeats y quedarte con la **última** fila por `nvrId` (la más reciente por NVR).
- Si un NVR no tiene heartbeat en el último minuto, agregar **un único** ítem con `nvrId`, `eventTypeName: 'AGENT_OFFLINE'`, `status: 'start'`, `timestamp`.
- No devolver un ítem por cada fila antigua ni por cada canal; solo **uno por NVR offline**.

Así, por cada agente offline, N8N envía **un solo** POST a nvrAgentEvents y en la plataforma verás **una sola** tarjeta por NVR.

### B. En la plataforma: agrupar AGENT_OFFLINE por NVR al mostrar

La app ya agrupa por `agent_offline_${nvrId}`; si aun así ves dos tarjetas, puede ser porque llegan dos alertas con **distinto `nvrId`** o **distinto `route_key`** (y por tanto distinto grupo). Para que quede una sola tarjeta por agente offline, en el nodo de N8N que envía AGENT_OFFLINE usá siempre el **mismo** `nvrId` (el del agente, ej. `8F0001CPAZ21EFD`) y, si podés, **no** mandar `route_key` o mandar solo la primera ruta del NVR. En la app, al mostrar el título del grupo AGENT_OFFLINE se usa `${nvrId} (AGENT_OFFLINE)`; si todas las AGENT_OFFLINE del mismo NVR tienen el mismo `nvrId`, forman un solo grupo y una sola tarjeta.

### C. No generar AGENT_OFFLINE si no lo necesitás

Si el trigger **"Cada 2 minuto"** está **desactivado**, esa rama no corre y no se envían AGENT_OFFLINE nuevos. Las dos tarjetas que ves son alertas viejas que ya están en Firestore. Podés marcarlas como "Visto" o "Falso +" para sacarlas de pendientes. Si no querés usar el monitor de offline, dejá el trigger desactivado y no tendrás más AGENT_OFFLINE duplicadas.

---

## Monitor de heartbeats (3 min, una señal por cambio)

En **`n8n-workflow-nvr-alert-corregido.json`** el monitor de NVRs usa esta lógica:

1. **Ventana:** Se considera “desconectado” si en la hoja **Heartbeats** no hay ninguna fila de ese NVR con timestamp en los **últimos 3 minutos** (no 1 minuto). El trigger **“Cada 2 minuto”** ejecuta la rama cada 2 min y se lee la hoja.

2. **Una sola señal por cambio de estado:**
   - Si un NVR **pasa a estar sin señal en 3 min** → se envía **AGENT_OFFLINE** (“está desconectado”) **una sola vez**, hasta que vuelva a haber señal.
   - Si ese NVR **vuelve a tener heartbeat** (hay fila reciente en la hoja) → se envía **AGENT_ONLINE** (“está conectado”) **una sola vez**, hasta que se vuelva a desconectar.

3. **Estado persistente:** El nodo **“Estado NVR (3 min, una vez por cambio)”** (Code) usa **$getWorkflowStaticData('global')** para guardar por NVR si el último estado enviado fue `offline` u `online`. Así no se repite la misma señal cada 2 min.

4. **Hoja Heartbeats:** Conviene que la hoja tenga una columna **Ts** con el timestamp en formato ISO (ej. `$json.body.timestamp` del webhook). El workflow ya escribe **Ts** al hacer append de heartbeats. Para filas viejas sin Ts, el Code usa **LastHeartbeat** si existe (puede fallar el parse según el formato).

5. **En la app:** Tanto AGENT_OFFLINE como AGENT_ONLINE crean una alerta en Operaciones (event_type distinto). Podés filtrar o dar otro tratamiento a AGENT_ONLINE si solo querés destacar las desconexiones.

**Resumen:**

| Qué querés | Qué hacer |
|------------|-----------|
| Que las alertas IVS lleguen a CronoApp | Añadir nodo "Enviar evento a CronoApp (directo)" después de "Solo alertas (no heartbeat)" y usar tu agent_secret en el header. |
| Que no aparezcan dos tarjetas AGENT_OFFLINE para el mismo NVR | En "NVRs sin heartbeat en 1 min" devolver un solo ítem por NVR y enviar un solo POST por NVR con ese nvrId. |
| No ver más AGENT_OFFLINE | Dejar el trigger "Cada 2 minuto" desactivado y marcar como resueltas las alertas actuales. |
| Que el monitor envíe “desconectado” una vez y “conectado” una vez al recuperar | Usar el workflow corregido: nodo "Estado NVR (3 min, una vez por cambio)" + ventana 3 min + estado persistente; "Enviar estado NVR a CronoApp" envía AGENT_OFFLINE y AGENT_ONLINE según el ítem. |
