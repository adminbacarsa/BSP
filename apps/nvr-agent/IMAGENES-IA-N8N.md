# Procesar imágenes de alertas con N8N e IA

Esta guía describe cómo hacer que las alertas NVR incluyan **imagen**, **análisis con IA** (persona, sospechoso, conducta indebida) y un **enlace para abrir el canal en vivo** en CronoApp.

---

## Flujo general

1. **Llega una alerta** al webhook N8N (body: `nvrId`, `channel`, `eventTypeName`, `timestamp`, etc.).
2. **Obtener una imagen** del canal: N8N pide el snapshot al NVR (Opción A).
3. **Procesar con IA**: detectar si hay persona y si es sospechosa o hace algo indebido.
4. **Enviar a CronoApp** con la imagen (nvrAlertV2) y, si la IA marca sospechoso/indebido, **notificar con enlace para abrir el video en vivo** (capturas + canal abierto).

---

## 1. Opción A: N8N pide el snapshot al NVR (paso a paso)

Cuando llega la alerta al webhook, N8N tiene `nvrId` y `channel` (0-based). Necesitás un **mapeo NVR → IP y credenciales**.

### 1.1 Mapeo NVR → IP y credenciales

Elegí una de estas formas:

- **Google Sheet** con columnas: `nvrId` | `nvr_ip` | `nvr_user` | `nvr_password`. En el workflow, después del IF (true), un nodo **Google Sheets – Read Rows** con filtro por `nvrId` = `{{ $json.body.nvrId }}`, y que devuelva una fila. Luego un **Code** que una esa fila con `body` en un solo ítem para los nodos siguientes.
- **Code estático:** un nodo **Code** al inicio de la rama true que tenga un objeto, ej.:
  ```javascript
  const body = $input.first().json.body || $input.first().json;
  const map = {
    "Bacar M102": { nvr_ip: "192.168.0.102", nvr_user: "admin", nvr_pass: "tu_pass" }
  };
  const cfg = map[body.nvrId] || {};
  return [{ json: { body, nvr_ip: cfg.nvr_ip, nvr_user: cfg.nvr_user, nvr_pass: cfg.nvr_pass } }];
  ```
  Así el ítem lleva `body`, `nvr_ip`, `nvr_user`, `nvr_pass` para el siguiente nodo.

### 1.2 Pedir el snapshot al NVR

- Nodo **HTTP Request**:
  - **Method:** GET.
  - **URL:** `http://{{ $json.nvr_ip }}/cgi-bin/snapshot.cgi?channel={{ $json.body.channel + 1 }}` (canal 1-based; si tu modelo usa otro query, ajustá).
  - **Authentication:** Basic Auth. User = `{{ $json.nvr_user }}`, Password = `{{ $json.nvr_pass }}`.
  - **Options → Response:** Response Format = **File** (para recibir la imagen como binario).
- La salida de este nodo suele tener el binario en `binary.data` y puede no traer `body`; si lo necesitás en los siguientes nodos, usá antes un **Merge** o un **Code** que combine el ítem del webhook (body) con el ítem del HTTP Request (binary), para que un solo ítem tenga tanto `body` como la imagen en `binary`.

**Importante:** N8N debe poder alcanzar la IP del NVR (misma red o VPN). Si N8N está en la nube y el NVR en red local, hace falta túnel o proxy, o usar la opción B (agente envía la imagen).

### Opción B: El agente envía la imagen

El agente Java (Dahua NetSDK) podría, al recibir una alarma, capturar un frame del canal y enviarlo. Opciones:

- Enviar **dos requests**: uno al webhook N8N con el JSON del evento (como ahora) y otro a N8N o a **nvrAlertV2** con multipart (imagen + campos).  
- O un **solo POST multipart** al webhook N8N con el JSON en un campo y la imagen en otro; N8N parsea y luego reenvía a nvrAlertV2.

Requiere cambios en el agente (captura con NetSDK + envío de la imagen). La ventaja es que no dependés de que N8N llegue al NVR.

---

## 2. Procesar con IA en N8N

Una vez que tengás la imagen en un ítem (como binario o como URL):

1. Añadí un nodo de **IA** en el flujo (después de obtener la imagen):
   - **OpenAI** (Chat o Image) con modelo que soporte visión (ej. `gpt-4o`, `gpt-4-vision`).
   - O **Google AI**, **Anthropic**, etc., si tu instancia de N8N los tiene.
2. Configurá el nodo para que reciba la **imagen** del ítem anterior (binary data o URL) y un **prompt**, por ejemplo:
   - *"Describe brevemente esta imagen de una cámara de seguridad. Indica si hay persona, vehículo, animal o nada relevante."*
   - O: *"Responde solo: PERSONA, VEHICULO, VACIO o OTRO."*
3. **Prompt para persona + sospechoso / conducta indebida:** que la IA no solo detecte persona sino si es sospechosa o hace algo indebido. Prompt sugerido (responde solo una etiqueta):
   - *VACIO / VEHICULO / PERSONA_OK / PERSONA_SOSPECHOSA / CONDUCTA_INDEBIDA.*
   - Definí: PERSONA_SOSPECHOSA = merodeo, ocultarse, actuar sospechoso; CONDUCTA_INDEBIDA = forcejeo, forzar puerta, agresión, objeto peligroso.
4. La salida del nodo de IA (ej. `$json.message.content`) la usás en un **IF**:
   - **PERSONA_SOSPECHOSA** o **CONDUCTA_INDEBIDA** → enviar a nvrAlertV2 con imagen y **notificación con enlace para abrir el canal en vivo** (sección 4).
   - **PERSONA_OK**, **VEHICULO** → enviar a nvrAlertV2 con imagen (y opcionalmente etiqueta en `object_type`).
   - **VACIO** → no enviar a CronoApp (filtrar falsos positivos) o solo a hoja de log.
   - **Notificaciones:** usar el texto para Slack, email, etc.

No es obligatorio usar IA; podés ir directo de “obtener imagen” a “enviar a CronoApp”.

---

## 3. Enviar la imagen a CronoApp (nvrAlertV2)

La Cloud Function **nvrAlertV2** crea (o actualiza) la alerta en Firestore y sube la imagen a Storage. Así la app muestra la foto y “Ver canal en vivo”.

- **URL:**  
  `https://us-central1-comtroldata.cloudfunctions.net/nvrAlertV2`  
  (reemplazá el proyecto si usás otro.)
- **Método:** POST.
- **Content-Type:** `multipart/form-data`.
- **Headers:**  
  - `Authorization: Bearer 123456` (o el valor de `nvr_config/webhook.secret` en Firestore).  
  - O `X-API-Key: 123456`.

**Campos del multipart (form-data):**

| Campo         | Origen en N8N                    | Notas |
|---------------|-----------------------------------|-------|
| **image** / **file** | Binario de la imagen (del HTTP Request al NVR o del agente) | Nombre del campo según lo que espere la función; a veces `image`, a veces el primer archivo. |
| **channel_id** | `{{ $json.body.channel + 1 }}`   | Canal 1-based. |
| **nvrId**     | `{{ $json.body.nvrId }}`         | Mismo ID que en Cámaras NVR. |
| **camera_name** | `{{ $json.body.channelName }}` o nombre fijo | Opcional. |
| **event_type** | `{{ $json.body.eventTypeName }}`  | Ej. ALARM_EX, VIDEOLOST_EX. |
| **object_type** | Resultado de la IA (ej. "human", "vehicle") o fijo | Opcional. |

En N8N, el nodo **HTTP Request** para enviar a nvrAlertV2:

- **Send Body:** sí.
- **Body Content Type:** Multipart form-data (o “Form Data” si permite adjuntar archivo).
- Añadís cada campo como parámetro; el de la imagen como **File** tomando el binario del ítem anterior (por ejemplo del nodo que hizo GET al snapshot del NVR).

Si la IA devolvió una etiqueta (persona/vehículo), podés ponerla en `object_type` para que en CronoApp se vea mejor.

---

## 4. Abrir el canal de video de la cámara (además de las capturas)

Cuando la IA marca **PERSONA_SOSPECHOSA** o **CONDUCTA_INDEBIDA**, además de crear la alerta con la captura en CronoApp, conviene que el operador pueda **abrir el canal en vivo** de esa cámara con un clic.

### 4.1 URL para abrir el video en vivo en CronoApp

La app tiene una página que reproduce el stream del NVR por canal. La URL es:

```text
https://TU_DOMINIO_CRONOAPP/admin/operaciones/vivo?nvrId=NVR_ID&channel=CANAL
```

- **TU_DOMINIO_CRONOAPP:** la URL base de tu app (ej. `https://comtroldata.web.app` o tu dominio).
- **nvrId:** el mismo que en la alerta (ej. `Bacar M102`). Si tiene espacios, codificá en la URL: `encodeURIComponent(nvrId)`.
- **channel:** canal **1-based** (para canal 0 del agente usá `1`).

Ejemplo: `https://comtroldata.web.app/admin/operaciones/vivo?nvrId=Bacar%20M102&channel=1`

Al abrir esa URL en el navegador, la página carga los datos del NVR desde Firestore (IP, puerto, usuario del stream) y reproduce el video en vivo. El operador ve la cámara en tiempo real además de la captura de la alerta.

### 4.2 Cómo “abrir el canal” desde N8N

N8N no puede abrir un navegador en la PC del operador; lo que hacés es **enviar un enlace** en una notificación para que el operador haga clic y se abra el vivo:

1. **Slack:** en la rama donde la IA devolvió PERSONA_SOSPECHOSA o CONDUCTA_INDEBIDA, añadí un nodo **Slack** que envíe un mensaje con el enlace, ej.:
   - *"Alerta posible persona sospechosa / conducta indebida – NVR X, canal Y. Captura en CronoApp. Abrir canal en vivo: [ENLACE]"*
   - El ENLACE = `https://TU_BASE/admin/operaciones/vivo?nvrId={{ encodeURIComponent($json.body.nvrId) }}&channel={{ $json.body.channel + 1 }}`
2. **Email:** nodo **Send Email** con el mismo enlace en el cuerpo del mail.
3. **Otra integración:** cualquier nodo que envíe un mensaje o notificación (Telegram, Teams, etc.) con ese enlace.

Así el operador recibe la notificación y, al hacer clic en el enlace, se abre la página de CronoApp con el video en vivo de esa cámara. Las capturas siguen en la alerta en el dashboard; el enlace suma la vista en vivo.

### 4.3 Resumen

| Qué | Dónde |
|-----|--------|
| Captura (imagen) | nvrAlertV2 crea la alerta con foto en CronoApp. |
| Ver canal en vivo | Mismo botón "Ver canal en vivo" en la alerta en la app, o enlace directo en la notificación: `/admin/operaciones/vivo?nvrId=...&channel=...` (canal 1-based). |

---

**Prompt completo para copiar en el nodo de IA:**

```text
Esta imagen es de una cámara de seguridad. Analizala y responde ÚNICAMENTE con una de estas etiquetas, sin explicación:
VACIO - no hay personas ni vehículos relevantes.
VEHICULO - solo vehículo(s), sin persona en situación relevante.
PERSONA_OK - hay persona(s) en situación normal (trabajando, pasando, esperando).
PERSONA_SOSPECHOSA - persona que parece merodear, ocultarse, actuar de forma sospechosa o fuera de lugar.
CONDUCTA_INDEBIDA - persona realizando una acción indebida (forcejeo, intento de forzar puerta/ventana, agresión, objeto peligroso o prohibido visible).
Responde solo la etiqueta, nada más.
```

---

## 5. Esquema del workflow en N8N (resumen)

```
Webhook (nvr-alertas)
    → IF (body.type ≠ heartbeat)
        true →
            [Opcional] Code o Google Sheets: nvrId → nvr_ip, user, pass
            → HTTP Request: GET snapshot del NVR (Basic Auth)
            → [Opcional] OpenAI / Google AI: analizar imagen
            → [Opcional] IF: filtrar por resultado de IA
            → HTTP Request: POST multipart a nvrAlertV2 (imagen + channel_id, nvrId, event_type, etc.)
            → Google Sheets (alertas)  // si querés seguir guardando en hoja
            → [Opcional] Enviar también a nvrAgentEvents (solo JSON) si querés alerta sin imagen en paralelo
            → Si IA = PERSONA_SOSPECHOSA o CONDUCTA_INDEBIDA: Slack / Email con enlace a /admin/operaciones/vivo?nvrId=...&channel=...
        false → Google Sheets (heartbeats)
```

Podés simplificar: por ejemplo solo “Webhook → IF true → GET snapshot → POST nvrAlertV2” sin IA, y después añadir la IA para filtrar o etiquetar.

---

## 6. URLs de snapshot (Dahua, referencia)

Algunos modelos Dahua usan:

- `http://IP/cgi-bin/snapshot.cgi?channel=1` (canal 1-based).
- O con subtype para mejor calidad: `...?channel=1&subtype=0`.

Consultá la documentación de tu modelo o probá con un navegador (con Basic Auth) para ver la URL exacta.

---

## 7. Resumen

| Paso              | Qué hacer |
|-------------------|-----------|
| Obtener imagen    | N8N hace GET al snapshot del NVR (mapeando nvrId → IP + auth) o el agente envía la imagen. |
| Procesar con IA   | Nodo OpenAI/Google AI con la imagen y un prompt; usar la respuesta para filtrar o etiquetar. |
| Enviar a CronoApp | POST multipart a **nvrAlertV2** con imagen + channel_id (1-based), nvrId, event_type, etc., y header de secreto. |
| Abrir canal en vivo | En notificación (Slack, email): enlace a `https://TU_APP/admin/operaciones/vivo?nvrId=...&channel=...` (canal 1-based). |

Así las alertas tienen captura, la IA puede marcar persona sospechosa o conducta indebida, y el operador puede abrir el video en vivo con un clic en el enlace de la notificación.

---

## 8. Workflow completo listo para importar

En el repo hay un JSON con el flujo completo (Opción A + IA + nvrAlertV2 + enlace a vivo):

**Archivo:** `n8n-workflow-NVR-Imagen-IA-Completo.json` (en `apps/nvr-agent/`).

**Qué incluye:**
- Webhook → IF (no heartbeat) → rama alertas: mapeo NVR→IP → GET snapshot NVR → Merge (body + imagen) → añadir base64 → OpenAI Vision → Merge (ítem + IA) → nvrAlertV2, nvrAgentEvents, Google Sheets (alertas), IF (sospechoso/indebido) → Slack con enlace a **https://comtroldata.web.app/admin/operaciones/vivo?nvrId=...&channel=...**
- Rama heartbeats → Google Sheets (heartbeats).

**Antes de activar, configurá:**

1. **Nodo "NVR → IP y credenciales":** editá el objeto `map` en el Code y poné la IP, usuario y contraseña de cada NVR (ej. `'Bacar M102': { nvr_ip: '192.168.0.102', nvr_user: 'admin', nvr_pass: 'xxx' }`).
2. **Nodo "GET snapshot NVR":** añadí credencial **HTTP Basic Auth** con user/pass del NVR (o el que use el mapeo). Response Format = **File**.
3. **Nodo "OpenAI Vision (etiqueta)":** en el header `Authorization` usá `Bearer TU_OPENAI_API_KEY` o configurá la variable `OPENAI_API_KEY` en N8N (Variables de entorno).
4. **Nodo "Enviar imagen a CronoApp (nvrAlertV2)":** header **X-API-Key** = el secreto de Firestore (`nvr_config/webhook.secret`, ej. `123456`). Si el multipart con imagen falla, en la documentación de n8n podés revisar el parámetro tipo "Binary File" para el campo de la imagen.
5. **Nodo "Enviar evento a CronoApp (nvrAgentEvents)":** mismo **X-API-Key**.
6. **Nodo "Slack (enlace a vivo)":** reemplazá la URL por tu **Incoming Webhook** de Slack (o sustituí por el nodo Slack nativo con canal).
7. **Google Sheets:** en los nodos de alertas y heartbeats, poné el **ID de tu documento** (reemplazá `PONER_ID_DE_TU_HOJA`) y el nombre de cada hoja.

**Importar:** En N8N → Menú (tres puntos) → **Import from File** → elegir `n8n-workflow-NVR-Imagen-IA-Completo.json`. Luego configurá lo anterior y activá el workflow.
