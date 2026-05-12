# NVR-Agent → N8N: configurar webhook

Pasos para recibir las alertas del NVR-agent en N8N. Si N8N está detrás de Caddy con HTTPS, la URL del webhook es **https://autbacar.dnsalias.com/webhook/nvr-alertas** (ver [N8N-HTTPS.md](../../N8N-HTTPS.md)).

## 1. Crear el workflow en N8N

1. En N8N, **nuevo workflow** (o usar "My workflow 2").
2. Haz clic en **"Add first step..."** o en el **+** del panel izquierdo.
3. Busca el nodo **"Webhook"** e insértalo.
4. En el nodo Webhook:
   - **HTTP Method:** POST
   - **Path:** pon un path único, por ejemplo `nvr-alertas` (la URL final será `https://autbacar.dnsalias.com/webhook/nvr-alertas` si usas HTTPS, o `http://IP:5678/webhook/nvr-alertas` en local).
   - Deja **Authentication** en "None" si N8N es solo en tu red; si quieres clave, luego configura `platform.key` en el agente y en N8N (Header Auth).
5. **Guarda** el workflow y actívalo (**Active** en la esquina superior).
6. Copia la **Production URL** que muestra N8N (con HTTPS: `https://autbacar.dnsalias.com/webhook/nvr-alertas`).

## 2. Configurar el NVR-agent

En `config.properties` (o tu archivo de config):

- Si el agente corre **en la misma PC** que N8N: `platform.url=http://localhost:5678/webhook/nvr-alertas`
- Si el agente corre **en otra máquina** y N8N está con HTTPS: `platform.url=https://autbacar.dnsalias.com/webhook/nvr-alertas`

```properties
platform.url=https://autbacar.dnsalias.com/webhook/nvr-alertas
platform.key=
```

Si en N8N configuraste autenticación en el webhook, pon la misma clave en `platform.key`.

Reinicia el NVR-agent. Cuando el NVR dispare una alarma, el agente hará POST a esa URL y verás el item en N8N.

## 3. Formato del body que recibe N8N

Cada POST trae un JSON como:

```json
{
  "nvrId": "default",
  "channel": 0,
  "eventType": 8450,
  "eventTypeName": "MOTION_EX",
  "status": "start",
  "timestamp": "2025-03-02T18:00:00.000Z",
  "source": "nvr-agent"
}
```

En el nodo Webhook de N8N el body llega dentro de **body**; para acceder en nodos siguientes usá `$json.body.nvrId`, `$json.body.channel`, etc.

### Traducción de los campos (qué significa cada uno)

| Campo | Significado |
|-------|-------------|
| **nvrId** | Identificador del NVR (ej. `"default"`, `"Bacar M102"`). |
| **nvrName** | Nombre legible del NVR (si está en `config.properties`). |
| **channel** | Índice del canal (0, 1, 2…). En algunos eventos puede venir un valor interno del SDK. |
| **channelName** | Nombre del canal (ej. "Entrada", "Estacionamiento") si está definido en el agente. |
| **eventType** | Código numérico del evento (8450 = movimiento, etc.). |
| **eventTypeName** | Tipo de evento: `MOTION_EX` (movimiento), `ALARM_EX`, `VIDEOLOST_EX` (pérdida de video), `SHELTER_EX` (obstrucción), `DISKFULL_EX`, `DISKERROR_EX`. |
| **status** | `"start"` = alarma iniciada, `"stop"` = alarma terminada. |
| **timestamp** | Fecha/hora del evento (ISO, ej. `2026-03-03T15:35:33.220Z`). |
| **source** | Siempre `"nvr-agent"`. |
| **channelMask** | (Opcional) Array de 0/1 por canal: 1 = activo en ese evento, 0 = inactivo. Útil cuando un solo POST indica estado de varios canales. |

### Mensaje legible en N8N

Después del Webhook podés agregar un nodo **Set** o **Code** para armar un texto tipo:

- **NVR:** `{{ $json.body.nvrId }}` (o `$json.body.nvrName` si existe)
- **Evento:** `{{ $json.body.eventTypeName }}` – `{{ $json.body.status }}`
- **Canal:** `{{ $json.body.channel }}` (o `$json.body.channelName`)
- **Hora:** `{{ $json.body.timestamp }}`

Ejemplo de frase: *"Alerta Bacar M102 – MOTION_EX stop – canal 57 – 2026-03-03 15:35:33"*.

En N8N puedes:
- Usar **Code** o **Set** para leer `$json.body.nvrId`, `$json.body.channel`, `$json.body.eventTypeName`, `$json.body.status`, etc.
- Enviar a **Slack**, **Email**, **HTTP Request** (p. ej. a tu backend o Cloud Function).
- Filtrar por tipo (`eventTypeName === "MOTION_EX"`) o por canal (p. ej. solo canal 0).

## 4. Enviar alertas desde N8N a CronoApp (Firebase)

Si querés que las alertas también queden en CronoApp (dashboard por cliente, resolución, reportes):

1. Después del nodo **Webhook**, añadí un nodo **HTTP Request**.
2. **Method:** POST  
   **URL:** `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrAgentEvents`  
   **Body Content Type:** JSON  
   **Body:** mapeá los campos del webhook al formato que espera la Cloud Function:
   - `nvrId` → `{{ $json.body.nvrId }}` (o `$json.nvrId` según cómo llegue)
   - `channel` → `{{ $json.body.channel }}`
   - `eventTypeName` → `{{ $json.body.eventTypeName }}`
   - `status` → `{{ $json.body.status }}`
   - `timestamp` → `{{ $json.body.timestamp }}`
   - (opcional) header **Authorization:** `Bearer TU_SECRET` (el mismo de `nvr_config/webhook` en Firestore).
3. Así N8N recibe el evento del agente y lo reenvía a Firebase; en CronoApp verás la alerta en **Operaciones** y en **Admin → Dashboard alertas** (por cliente, tipo de evento, fabricante Dahua/Hikvision y tratamiento/resolución).

## 5. Dashboard de alertas en CronoApp

En la app web: **Admin → Dashboard alertas**.

- Filtros: **cliente**, **fabricante** (Dahua / Hikvision), **estado** (pendiente / resuelta), **fechas**.
- Listado: fecha, cliente, objetivo, cámara, tipo de evento, cómo fue tratada la alerta (resolución y notas).
- Acción **Resolver** para marcar una alerta pendiente como resuelta (tipo de resolución + notas).

Las alertas que llegan por el agente Dahua (o por N8N reenviando a la Cloud Function) se guardan con `vendor: 'dahua'` y, si el NVR tiene cliente asignado en Cámaras NVR, con `client_id` para filtrar por cliente. Más adelante se suman agentes Hikvision con `vendor: 'hikvision'`.

---

## 6. Ver las últimas 100 alertas

### Opción A: Pestaña Executions de N8N

En el workflow **NVR Alert**, abrí la pestaña **Executions**. Cada ejecución es una alerta recibida; las últimas aparecen arriba. Ahí podés ver las últimas 100 (o más) haciendo scroll; al hacer clic en una ejecución ves el body completo (nvrId, eventTypeName, channel, timestamp, etc.).

### Opción B: Guardar en Google Sheets (tabla ordenada)

Para tener una hoja con todas las alertas y ver fácilmente las últimas 100:

1. **Crear una hoja** en Google Sheets con una primera fila de encabezados, por ejemplo:  
   `Fecha/Hora` | `NVR` | `Evento` | `Canal` | `Status` | `Tipo (heartbeat/alerta)`  
2. En el workflow **NVR Alert**, después del **Webhook**:
   - Añadí un nodo **IF**: condición `{{ $json.body.type }}` no es igual a `heartbeat` (así los heartbeats no se guardan en la hoja). Conectá el Webhook al IF por “true” para las alertas.
   - Añadí un nodo **Google Sheets** → **Append or Create Row** (o **Insert Row**).
   - Configurá la conexión a Google y elegí el documento y la hoja.
   - Mapeá las columnas (en **Map Each Column Manually** / "Define below", en el **valor** de cada columna):
     - **Fecha/Hora** → ver más abajo "Hora local en el sheet" si querés hora Argentina; si no, `{{ $json.body.timestamp }}`
     - NVR → `{{ $json.body.nvrId }}` (o `$json.body.nvrName`)
     - Evento → `{{ $json.body.eventTypeName }}`
     - Canal → `{{ $json.body.channel }}`
     - Status → `{{ $json.body.status }}`
     - Tipo → `alerta`
3. Conectá el IF (salida “true”) al nodo de Google Sheets. Opcionalmente conectá también la salida “false” a lo que ya tengas (p. ej. no hacer nada con los heartbeats).
4. Cada alerta añadirá una fila. En la hoja, ordená por la columna **Fecha/Hora** descendente para ver las **últimas 100** (o las que quieras) arriba.

### Opción C: Ver en CronoApp (Firebase)

Si reenviás las alertas a la Cloud Function `nvrAgentEvents`, se guardan en Firestore. En la app web, **Admin → Dashboard alertas** (o la vista de operaciones) lista las alertas; podés filtrar y ordenar por fecha para ver las últimas (las últimas 100 desde la plataforma). Las alertas creadas por `nvrAgentEvents` ya permiten **"Ver canal en vivo"** en la app si el NVR y las rutas de cámara están configurados en Cámaras NVR (mismo `nvrId` y datos de streaming).

---

### Imágenes de la alerta y ver cámara en vivo

- **Ver en vivo:** Las alertas que llegan por N8N a `nvrAgentEvents` se crean con `nvrId` y canal; si en CronoApp el NVR tiene configuradas las rutas de streaming (IP, puerto, usuario del flujo), en la app ya podés usar **"Ver canal en vivo"** para esa alerta. No hace falta N8N para eso; solo que el nodo "Enviar a CronoApp" envíe bien `nvrId`, `channel`, etc.
- **Captura de imagen (snapshot):** Hoy el agente Java envía solo el evento (sin imagen). Para que la alerta tenga foto:
  - **Opción A:** Extender el agente para que, al recibir una alarma, capture un frame del canal con el NetSDK y envíe la imagen (p. ej. POST multipart a la Cloud Function `nvrAlertV2`, que acepta imagen y crea/actualiza la alerta con foto). Así la imagen llega con el evento.
  - **Opción B:** Si el NVR expone una URL de snapshot por HTTP (muchos Dahua tienen `/cgi-bin/snapshot.cgi?channel=N`), en N8N podrías añadir en la rama **true** un nodo **HTTP Request** que pida esa URL (con auth si hace falta), obtenga la imagen y luego enviarla a `nvrAlertV2` junto con nvrId/canal. Eso requiere conocer la IP del NVR y el canal por cada alerta (ya lo tenés en el body) y que la URL de snapshot sea accesible desde donde corre N8N.

En resumen: "Ver en vivo" ya funciona desde la app con las alertas que llegan por N8N; para adjuntar imagen a la alerta hace falta o bien que el agente envíe el snapshot o bien que N8N llame a una URL de snapshot del NVR y reenvíe a `nvrAlertV2`.  
**Guía completa (obtener imagen, procesar con IA en N8N, enviar a CronoApp):** [IMAGENES-IA-N8N.md](IMAGENES-IA-N8N.md).

### Hacer ambas: Google Sheets + CronoApp (recomendado)

Podés tener **las dos** en el mismo workflow: cada alerta se guarda en la hoja **y** se envía a CronoApp.

1. **Webhook** (recibe POST del agente).
2. **IF**: condición `{{ $json.body.type }}` **no es igual** a `heartbeat` (solo procesar alertas, no heartbeats).
3. Conectá la salida **true** del IF a **dos** nodos en paralelo:
   - **Google Sheets** → **Append or Create Row**: documento y hoja con columnas Fecha/Hora, NVR, Evento, Canal, Status (mapeadas desde `$json.body.timestamp`, `$json.body.nvrId`, `$json.body.eventTypeName`, `$json.body.channel`, `$json.body.status`).
   - **HTTP Request**: Method POST, URL `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrAgentEvents`, Body JSON con `nvrId`, `channel`, `eventTypeName`, `status`, `timestamp` (desde `$json.body.*`). Opcional: header `Authorization: Bearer TU_SECRET`.
4. La salida **false** del IF (heartbeats) podés dejarla sin conectar o usarla para otro uso (p. ej. registrar último heartbeat en otra hoja).

Así cada alerta: **(B)** queda en la hoja para ver las últimas 100 ordenando por fecha, y **(C)** llega a CronoApp para el dashboard, resolver alertas y reportes.

---

### ¿Qué es el nodo IF?

El **IF** es un nodo que **divide el flujo** según una condición: si se cumple, los ítems salen por una conexión (“true”); si no, por otra (“false”). En este workflow la condición es: *“el campo `body.type` no es igual a `heartbeat`”*. Así, cuando llega una **alerta** (no tiene `type: heartbeat`), pasa por “true” y se envía a la hoja y a CronoApp; cuando llega un **heartbeat**, pasa por “false” y no lo guardamos ni lo enviamos como alarma.

---

### Importar el workflow desde JSON

En el repo hay un JSON listo para importar: **`n8n-workflow-NVR-Alert-B-C.json`** (en `apps/nvr-agent/`).

1. En N8N, menú de los **tres puntos** (arriba a la derecha) → **Import from File** (o **Import from URL** si subís el JSON a una URL).
2. Elegí el archivo `n8n-workflow-NVR-Alert-B-C.json`.
3. Después de importar:
   - **Antes** de probar el nodo Google Sheets: creá la hoja en Google y en la **primera fila** poné exactamente estos encabezados (uno por columna): **Fecha/Hora** | **NVR** | **Evento** | **Canal** | **Status**. Si la hoja está vacía, N8N puede dar "No columns found".
   - En el nodo **Google Sheets**: elegí tu cuenta de Google y reemplazá **PONER_ID_DE_TU_HOJA** por el ID del documento (en la URL: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`). Elegí el nombre de la pestaña/hoja (ej. "Hoja 1").
   - En el nodo **Enviar a CronoApp**: reemplazá `TU_PROYECTO` en la URL por el ID de tu proyecto de Firebase. Si usás secreto, añadí en **Headers** la cabecera `Authorization: Bearer TU_SECRET`.
4. Guardá y activá el workflow.

Si ya tenés un workflow “NVR Alert” con solo el Webhook, podés copiar de este JSON solo los nodos IF, Google Sheets y HTTP Request y las conexiones, y pegarlos en tu workflow.

**Error "No columns found in Google Sheets":** La hoja debe tener la **primera fila con encabezados**. En la fila 1 poné: **A1** = Fecha/Hora, **B1** = NVR, **C1** = Evento, **D1** = Canal, **E1** = Status. Guardá y volvé a ejecutar. En el nodo, si hay "Column Mapping" o "Define columns", usá esos mismos nombres mapeados a `$json.body.timestamp`, `$json.body.nvrId`, etc.

---

### Hora local en el sheet (ej. Argentina, UTC−3)

Para que en la hoja no se vea la hora en UTC (+3 h respecto a Argentina), convertí el timestamp al escribir.

**Dónde:** En el nodo **Google Sheets** (alertas o heartbeats), en **Parameters** → **Values to Send** (Map Each Column Manually), en el **valor** de la columna de fecha/hora:

- **Google Sheets (alertas)** → columna **Fecha/Hora**, valor:
  ```text
  {{ new Date($json.body.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'medium' }) }}
  ```
- **Google Sheets (heartbeats)** → columna **LastHeartbeat**, valor:
  ```text
  {{ new Date($json.body.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'medium' }) }}
  ```

Si N8N no acepta esa expresión larga en el campo, podés poner antes un nodo **Code** que agregue `timestampLocal` al ítem y en el Sheet mapear esa columna a `{{ $json.timestampLocal }}`.

---

## 7. Control de heartbeats: alerta si el agente se desconecta

Si el agente envía un heartbeat cada 30 segundos (`platform.heartbeat.interval.seconds=30` en `config.properties`), podés considerar **desconectado** cuando en **1 minuto** no llegue ninguno y generar una alerta en CronoApp.

### Paso 1: Registrar cada heartbeat (workflow principal)

En el mismo workflow **NVR Alert**, en la salida **false** del IF (por donde pasan los heartbeats):

1. Creá en Google Sheets una pestaña (o documento) **"Heartbeats"** con encabezados: **nvrId** | **LastHeartbeat** (o **Último**).
2. Añadí un nodo **Google Sheets** → **Append or Create Row**, conectado desde la salida **false** del IF.
3. Configurá: mismo documento, hoja **"Heartbeats"**. Columnas (en el valor de cada una):
   - **nvrId** → `{{ $json.body.nvrId }}`
   - **LastHeartbeat** → para hora Argentina usar la expresión de "Hora local en el sheet" arriba; si no, `{{ $json.body.timestamp }}`

Así cada heartbeat que llega queda registrado con su hora.

### Paso 2: Workflow "Monitor Heartbeats" (cada 1 minuto)

Creá un **segundo workflow** en N8N:

1. **Trigger: Schedule**  
   - Interval: every 1 minute (o cada 2 minutos si preferís).

2. **Google Sheets – Read Rows**  
   - Documento = el mismo de alertas. Hoja = **el mismo nombre de pestaña donde se escriben los heartbeats** (ej. **"Heartbeats"** o **"Hoja1"** si configuraste el workflow principal para escribir ahí). Si los heartbeats entran en "Hoja1", aquí tenés que poner **"Hoja1"**; si no, el Monitor no verá datos y no generará alertas AGENT_OFFLINE.
   - Leé las últimas filas (ej. las últimas 200) para tener los heartbeats recientes.

3. **Code** (o **Edit Fields** + **Aggregate**)  
   - Entrada: las filas leídas (columnas `nvrId`, `LastHeartbeat`).  
   - Lógica: por cada `nvrId` quedate con el **timestamp más reciente** (max LastHeartbeat).  
   - Si `ahora - max(LastHeartbeat)` **> 60 segundos** para un NVR, generá un ítem para ese NVR (ej. `{ nvrId, eventTypeName: 'AGENT_OFFLINE', status: 'start', timestamp: now }`).  
   - Salida: un ítem por cada NVR que no tuvo heartbeat en el último minuto.

4. **IF** (opcional)  
   - Condición: hay al menos un ítem (NVR desconectado).  
   - **true** → seguir; **false** → terminar sin hacer nada.

5. **HTTP Request – Enviar a CronoApp**  
   - Mismo endpoint `nvrAgentEvents`.  
   - Method: POST. Body (por cada ítem):  
     `{ "nvrId": "{{ $json.nvrId }}", "eventTypeName": "AGENT_OFFLINE", "status": "start", "timestamp": "{{ $json.timestamp }}" }`  
   - Header `Authorization: Bearer TU_SECRET` si hace falta.

Así, cada minuto N8N revisa los últimos heartbeats; si un NVR no tiene ninguno en el último minuto, envía una alerta **AGENT_OFFLINE** a CronoApp y la ves en el dashboard como cualquier otra.

### Paso 3: Configurar el agente

En `config.properties` del agente:

```properties
platform.heartbeat.interval.seconds=30
```

Reiniciá el agente. Cada 30 s enviará un heartbeat al mismo webhook; el workflow principal lo registra en "Heartbeats"; el workflow programado cada 1 minuto detecta si faltó y genera la alerta.

### Resumen

| Qué | Dónde |
|-----|--------|
| Heartbeat llega cada 30 s | Agente (config) |
| Se guarda en "Heartbeats" | Workflow principal, salida **false** del IF → Google Sheets Append |
| Cada 1 min se revisa | Workflow "Monitor Heartbeats" con Schedule |
| Si no hubo heartbeat en 1 min | Se envía alerta AGENT_OFFLINE a CronoApp |

### Importar todo con JSON (dos workflows)

En `apps/nvr-agent/` hay dos JSON listos:

1. **`n8n-workflow-NVR-Alert-completo.json`**  
   - Webhook → IF → **true**: Google Sheets (alertas) + Enviar a CronoApp.  
   - **false**: Google Sheets (hoja **"Heartbeats"**) para registrar cada heartbeat.

2. **`n8n-workflow-Monitor-Heartbeats.json`**  
   - Schedule cada 1 min → Leer hoja "Heartbeats" → Code (detecta NVRs sin heartbeat en 1 min) → Enviar AGENT_OFFLINE a CronoApp.

**Pasos:**

1. En Google Sheets (mismo documento que las alertas): creá una pestaña para heartbeats (ej. **"Heartbeats"** o usá **"Hoja1"**) con fila 1: **nvrId** | **LastHeartbeat**. En el workflow **Monitor Heartbeats**, el nodo "Leer Heartbeats" debe usar **el mismo nombre de hoja** (si los heartbeats se guardan en "Hoja1", poné "Hoja1" en ese nodo).
2. En N8N: **Import from File** e importá los dos JSON (uno por uno; si ya tenés un workflow "NVR Alert", podés reemplazarlo por el completo o añadir solo el nodo de heartbeats).
3. En **ambos** workflows: reemplazá **PONER_ID_DE_TU_HOJA** por el ID de tu documento de Google (en todos los nodos Google Sheets).
4. En los nodos **HTTP Request** (Enviar a CronoApp / Enviar AGENT_OFFLINE): reemplazá **TU_PROYECTO** por el ID de Firebase. Añadí header **Authorization: Bearer TU_SECRET** si la Cloud Function lo exige.
5. Guardá y activá **los dos** workflows.
6. En el agente: `platform.heartbeat.interval.seconds=30` en `config.properties` y reiniciá.

---

## 8. Si no te ingresan las alertas IVS (humano / vehículo) en CronoApp

Las alertas IVS (ALARM_EX) deben llegar al webhook de N8N y N8N debe reenviarlas a la Cloud Function **nvrAgentEvents**. Revisá en este orden:

### 1. Agente: que envíe ALARM_EX

- En `config.properties` debe estar **ALARM_EX** en la whitelist:
  ```properties
  event.types.include=VIDEOLOST_EX,SHELTER_EX,ALARM_EX
  ```
- En el NVR (configuración del equipo) tené activados los eventos smart/IVS (humano, vehículo, intrusiones) en los canales que quieras.
- En consola del agente, al dispararse un evento IVS deberías ver que se envía (no "Evento omitido (no en lista)").

### 2. N8N: condición del IF

- El nodo **IF** debe dejar pasar las **alertas** (no los heartbeats). Condición recomendada:
  - **Value 1:** `{{ $json.body.type }}` (o `$json.body?.type`)
  - **Operation:** "not equal" / "no es igual"
  - **Value 2:** `heartbeat`
- Así, cuando llega una alarma IVS el body **no** tiene `type: "heartbeat"` (o no tiene `type`), y la condición es verdadera → el ítem sale por **true** y debe ir al HTTP Request que envía a CronoApp.

### 3. N8N: nodo "Enviar a CronoApp" (HTTP Request)

- **URL:** `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrAgentEvents` (reemplazá TU_PROYECTO por el ID de Firebase).
- **Method:** POST.
- **Body Content Type:** JSON.
- **Body** (campos que espera la Cloud Function):
  - `nvrId` → `{{ $json.body.nvrId }}`
  - `channel` → `{{ $json.body.channel }}` (número, 0-based)
  - `eventTypeName` → `{{ $json.body.eventTypeName }}` (ej. ALARM_EX)
  - `status` → `{{ $json.body.status }}` (debe ser **"start"** para que se cree la alerta; si falta, la función no crea)
  - `timestamp` → `{{ $json.body.timestamp }}`
- **Header de autenticación:** el mismo secreto que en Firestore `nvr_config/webhook`:  
  `Authorization: Bearer TU_SECRET` o `X-API-Key: TU_SECRET`.

### 4. Firebase: nvrAgentEvents solo crea alerta con status "start"

- Si el agente envía el evento con `status: "stop"` (fin de alarma), la Cloud Function responde OK pero **no** crea documento en `alerts`. Solo crea cuando `status === "start"`. Asegurate de que el agente envíe al menos el evento "start" para cada alarma.

### 5. Ver si llegan a Firebase

- En Firebase Console → Functions → **nvrAgentEvents** → Logs: si N8N está llamando bien, verás entradas por cada POST. Si hay error 401, revisá el secreto. Si ves `skipped: 'status_not_start'`, el body tiene `status` distinto de "start".
- En Firestore → colección **alerts**: deberían aparecer documentos nuevos con `status: 'pending'` y `event_type` (ej. ALARM_EX).

Si todo lo anterior está bien y aún no ves alertas IVS en Operaciones, revisá en la app que no tengas filtros que oculten esa ruta o NVR (Admin → Cámaras / NVR: que la ruta o el NVR no esté desactivado).

---

## 9. Si te llegan AGENT_OFFLINE pero el agente sí envía heartbeats

Si en la hoja **Heartbeats** ves entradas recientes para un NVR (ej. "Bacar M102", "8F0001CPAZ21EFD") y aun así en CronoApp te aparecen alertas **AGENT_OFFLINE**, suele ser por cómo el workflow **Monitor Heartbeats** lee y compara las fechas.

### Causas habituales

1. **Formato de fecha en la hoja**  
   El nodo **Code** del Monitor compara "último heartbeat" con "ahora". Si la columna **LastHeartbeat** (o **Último**) está en texto local (ej. "3/3/26, 10:30:23 p. m."), la comparación puede fallar.  
   **Recomendación:** En el workflow que escribe heartbeats, guardá **LastHeartbeat** en formato que N8N pueda parsear, por ejemplo:
   - `{{ $json.body.timestamp }}` (ISO del agente), o  
   - `{{ new Date().toISOString() }}` (hora al escribir).

2. **Nombre de la hoja o columnas**  
   El Monitor debe leer la **misma** pestaña donde se escriben los heartbeats (ej. **"Heartbeats"**). Las columnas deben llamarse **nvrId** y **LastHeartbeat** (o **Último**) como en el Code.

3. **Ventana demasiado corta**  
   Si el heartbeat va cada 30 s y el Monitor corre cada 1 min, a veces la lectura cae justo entre dos heartbeats y marca offline por error. En el JSON del workflow **Monitor Heartbeats** la ventana está en **90 segundos**; si usás una versión antigua con 60 s, reimportá el JSON o cambiá en el Code a 90 s.

4. **Reimportar el workflow Monitor**  
   En `apps/nvr-agent/` está **n8n-workflow-Monitor-Heartbeats.json**. Ese Code ya usa comparación por tiempo numérico (no por texto) y 90 s. Importalo de nuevo en N8N y reemplazá el nodo "NVRs sin heartbeat en 1 min" para que use esta lógica.

### Resumen

| Revisar | Acción |
|--------|--------|
| Formato LastHeartbeat | Escribir en la hoja en ISO (ej. `$json.body.timestamp`) |
| Hoja y columnas | Misma hoja "Heartbeats", columnas nvrId y LastHeartbeat |
| Ventana | 90 segundos en el Code del Monitor |
| Código del Monitor | Reimportar n8n-workflow-Monitor-Heartbeats.json |
