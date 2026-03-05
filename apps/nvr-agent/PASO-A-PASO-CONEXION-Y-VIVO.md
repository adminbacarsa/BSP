# Paso a paso: Conexión NVR (agente) → Plataforma y video en vivo por túnel

Esta guía lleva desde cero hasta tener el agente conectado a la plataforma y el **video en vivo** funcionando por túnel (aunque el NVR esté en otra red).

**Estado típico:** El **túnel de video en vivo** ya está resuelto (agente → tunnel-server → app). Los **eventos HTTP** (alertas, heartbeats) pueden no verse si el proxy o la URL que usa el agente no es alcanzable; la solución es usar **N8N como proxy** (Parte D): agente envía al webhook de N8N y N8N reenvía a **nvrAgentEvents**.

---

## Resumen del flujo

1. **Plataforma:** Firestore (token de registro, webhook), Cloud Functions (nvrOnboard, nvrAgentEvents), servidor túnel (Cloud Run), app con URL del túnel.
2. **Registro (una vez por NVR):** Llamás a **nvrOnboard** con los datos del NVR y recibís un **agent_secret**. Ese secret identifica a ese NVR para siempre.
3. **Agente:** Configurás `platform.key` = agent_secret y `platform.tunnel_url` = URL del túnel. El agente envía alertas/heartbeats y abre el túnel para vivo.
4. **Ver en vivo:** En Operaciones, al hacer clic en "Ver canal en vivo" para una alerta de ese NVR, la app se conecta al túnel y muestra el stream que envía el agente.

---

## Parte A: Preparar la plataforma (una sola vez)

### Paso 1. Token de registro en Firestore

Solo quienes tengan este token pueden dar de alta NVRs nuevos (endpoint nvrOnboard).

1. Entrá a **Firebase Console** → tu proyecto → **Firestore**.
2. Si no existe, creá la colección **`nvr_config`**.
3. Creá (o editá) el documento con ID **`registration`** dentro de **`nvr_config`**.
4. Añadí un campo **`token`** (string) con un valor secreto largo, por ejemplo:
   - Podés generar uno en https://www.random.org/strings/ (32 caracteres alfanuméricos).
   - Ejemplo: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`.
5. Guardá. **Anotá el token**; lo vas a usar en el Paso 5 para registrar el NVR.

### Paso 2. Desplegar Cloud Functions (nvrOnboard y nvrAgentEvents)

Las funciones **nvrOnboard** (registro de NVR) y **nvrAgentEvents** (recibir eventos del agente) tienen que estar desplegadas.

1. En la PC donde tenés el repo, abrí terminal en la raíz del proyecto (donde está `firebase.json`).
2. Ejecutá:
   ```bash
   cd apps/functions
   npm install
   npm run build
   cd ../..
   firebase deploy --only functions:nvrOnboard,functions:nvrAgentEvents
   ```
3. Anotá la URL de **nvrAgentEvents** que muestra Firebase (ej. `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrAgentEvents`). La de **nvrOnboard** será igual pero con `/nvrOnboard` al final.

### Paso 3. Desplegar el servidor túnel (Cloud Run)

El servidor túnel recibe la conexión del agente y la del navegador y hace de puente para el vivo.

1. **Requisitos:** tener instalado [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install). Luego:
   ```powershell
   gcloud auth login
   gcloud config set project comtroldata
   ```

2. **Desde la raíz del repo** (o desde `apps/tunnel-server`):
   ```powershell
   cd D:\APP\cronoapp\apps\tunnel-server
   npm install
   gcloud run deploy tunnel-server --source . --region us-central1 --allow-unauthenticated --project comtroldata
   ```
   Si estás en la raíz: `gcloud run deploy tunnel-server --source apps/tunnel-server --region us-central1 --allow-unauthenticated --project comtroldata`

3. Cuando termine, en la consola verás la **URL del servicio**. En este proyecto está en uso: `https://tunnel-server-698108879063.us-central1.run.app`.

4. **URL para WebSocket:** la misma URL pero con **`wss://`**. En uso: `wss://tunnel-server-698108879063.us-central1.run.app`. Ya está en `platform.tunnel_url` del agente y debe ponerse en `NEXT_PUBLIC_TUNNEL_WS_URL` en la app.

**Importante:** En Cloud Run, la cuenta de servicio por defecto del proyecto ya puede leer Firestore y usar Firebase Auth del mismo proyecto (comtroldata). Si usás otra cuenta, asignale al menos "Cloud Datastore User" y permisos para verificar ID tokens.

### Paso 4. Configurar la app web (URL del túnel)

Para que "Ver en vivo" use el túnel, la app tiene que conocer la URL del servidor túnel.

1. Si la app está en **Vercel / Netlify / similar:** en el panel de la app, añadí una variable de entorno:
   - Nombre: **`NEXT_PUBLIC_TUNNEL_WS_URL`**
   - Valor: la URL del túnel con **wss://** (ej. `wss://tunnel-server-698108879063.us-central1.run.app`).
2. Si la app se construye en local: creá o editá un archivo **`.env.local`** en la carpeta de la app web (ej. `apps/web2/`) con:
   ```
   NEXT_PUBLIC_TUNNEL_WS_URL=wss://tunnel-server-698108879063.us-central1.run.app
   ```
3. Volvé a construir y desplegar la app (o reiniciar el dev server) para que tome la variable.

---

## Parte B: Registrar el NVR (alta en la plataforma)

Cada NVR que quieras conectar se "registra" una sola vez. A partir de ahí la plataforma lo reconoce y le asigna una clave (agent_secret).

### Borrar una NVR y sus canales para cargarla de nuevo

Si ya registraste una NVR y querés borrarla (y todos sus canales) para darla de alta de nuevo con otro cliente/objetivo o datos:

1. Desde la carpeta **`apps/functions`**, con credenciales de Firebase/Google Cloud (variable `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una clave de cuenta de servicio, o en un entorno GCP):
   ```powershell
   cd D:\APP\cronoapp\apps\functions
   node scripts/borrar-nvr.js 8F0001CPAZ21EFD
   ```
   Reemplazá `8F0001CPAZ21EFD` por el **nvr_id** que quieras borrar.
2. El script borra el documento **nvr_devices/{nvr_id}** y todos los **camera_routes** con `nvr_serial` igual a ese ID.
3. Después podés volver a registrar la NVR con el script **registrar-nvr.ps1** (Paso 5).

### Paso 5. Llamar a nvrOnboard

Tenés que hacer un **POST** a la Cloud Function **nvrOnboard** con el token del Paso 1 y los datos del NVR. Podés usar **curl** (o Postman).

1. **URL:**  
   `https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrOnboard`  
   (reemplazá `TU_PROYECTO` por el ID de tu proyecto de Firebase).

2. **Headers:**
   - `Content-Type: application/json`
   - `Authorization: Bearer EL_TOKEN_QUE_ANOTASTE_EN_PASO_1`  
   (o `X-Registration-Token: EL_TOKEN_...`).

3. **Body (JSON):** reemplazá con los datos reales de tu NVR.
   ```json
   {
     "nvr_id": "Bacar-M102",
     "nvr_name": "NVR Bacar Planta",
     "nvr_ip": "192.168.0.102",
     "nvr_port": 80,
     "nvr_user": "admin",
     "nvr_password": "tu_password_nvr",
     "channel_count": 4,
     "channel_names": ["Entrada", "Hall", "Estacionamiento", "Perimetral"],
     "client_id": "ID_DEL_CLIENTE_EN_LA_PLATAFORMA",
     "objective_id": "ID_DEL_OBJETIVO_EN_LA_PLATAFORMA"
   }
   ```
   - **nvr_id:** único (ej. serial o nombre; mismo que en el agente).
   - **nvr_ip:** IP del NVR en la red del agente.
   - **channel_count:** cantidad de canales.
   - **channel_names:** opcional; orden 1, 2, 3…
   - **client_id** y **objective_id:** opcionales. Si los enviás, la NVR y **todos sus canales** quedan asignados a ese cliente y objetivo.

4. Ejemplo con **curl** (en una sola línea o con `\` al final de cada línea):
   ```bash
   curl -X POST "https://us-central1-TU_PROYECTO.cloudfunctions.net/nvrOnboard" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" \
     -d "{\"nvr_id\":\"Bacar-M102\",\"nvr_name\":\"NVR Bacar Planta\",\"nvr_ip\":\"192.168.0.102\",\"nvr_user\":\"admin\",\"nvr_password\":\"tu_password\",\"channel_count\":4}"
   ```

5. **Respuesta correcta (200):**
   ```json
   { "ok": true, "nvr_id": "Bacar-M102", "agent_secret": "una_cadena_larga_generada..." }
   ```
6. **Anotá el `agent_secret`** y guardalo en un lugar seguro. Ese valor es la **clave del agente** para ese NVR; lo vas a poner en `platform.key` en el agente.

Si la respuesta es 401: el token de registro es incorrecto o no existe en `nvr_config/registration`.  
Si es 400: revisá que `nvr_id` y `nvr_ip` estén y sean válidos.

---

## Parte C: Configurar y arrancar el agente

El agente corre en una PC que tenga red al NVR (misma LAN). Esa PC puede estar en otra red que la plataforma; por eso usamos el túnel para el vivo.

### Paso 6. Archivo de configuración del agente

En la PC donde corre el agente, en la carpeta del agente (o donde esté `config.properties`):

1. Copiá **`config.example.properties`** a **`config.properties`** (si aún no lo tenés).
2. Editá **`config.properties`** con algo como:

```properties
# Conexión al NVR (IP de la LAN donde está el agente)
nvr.ip=192.168.0.102
nvr.port=37777
nvr.user=admin
nvr.password=tu_password_nvr

# Mismo nvr_id que usaste en nvrOnboard (Paso 5)
nvr.id=Bacar-M102
nvr.name=NVR Bacar Planta

# Opcional: nombres de canales
channel.names=Entrada,Hall,Estacionamiento,Perimetral

# URL del webhook (N8N o directo a nvrAgentEvents). Para eventos y heartbeats.
platform.url=https://autbacar.dnsalias.com/webhook/nvr-alertas
# Clave del agente que te devolvió nvrOnboard (Paso 5)
platform.key=EL_AGENT_SECRET_QUE_ANOTASTE

# Túnel para video en vivo: URL del servidor túnel (Paso 3) con wss://
platform.tunnel_url=wss://tunnel-server-698108879063.us-central1.run.app

# Eventos a enviar
event.types.include=VIDEOLOST_EX,SHELTER_EX,ALARM_EX
# Heartbeat cada 30 segundos (recomendado)
platform.heartbeat.interval.seconds=30
```

Reemplazá:
- **nvr.ip, nvr.user, nvr.password** por los datos reales del NVR.
- **nvr.id** por el **mismo** valor que usaste en el Paso 5 (`nvr_id`).
- **platform.key** por el **agent_secret** que devolvió nvrOnboard.
- **platform.tunnel_url** por la URL **wss://** del servidor túnel (Paso 3).
- **platform.url** por tu webhook de N8N o por la URL de nvrAgentEvents si enviás directo a Firebase.

### Paso 7. Arrancar el agente

1. Asegurate de tener Java y las dependencias (NetSDK, etc.) como en el README del agente.
2. Ejecutá el agente (por ejemplo):
   ```bash
   java -jar target/nvr-agent-1.0.0.jar
   ```
   o el script que usen (`run.bat` / `run.sh`).
3. En la consola deberías ver algo como:
   - Conexión al NVR y suscripción a alarmas.
   - "Túnel de vivo: wss://..."
   - Si el túnel conecta y autentica: "[Tunnel] Conectado" y "[Tunnel] Autenticado. Listo para stream."

Si el túnel no conecta, revisá que **platform.tunnel_url** sea **wss://** (no https) y que la URL del Paso 3 sea alcanzable desde esa PC (firewall, proxy).

---

## Parte D: Eventos HTTP — N8N como proxy (recomendado si no tenés otro proxy)

**Todo por agente y N8N:** Las alertas tienen que llegar desde el **agente** al webhook de N8N y de ahí a la plataforma. No uses el envío HTTP nativo del NVR (“Subida de imágenes” a otra IP): esas alertas no comparten el mismo `nvrId` que el agente y en CronoApp no podés abrir “Ver en vivo” desde la alerta. Con agente → N8N → nvrAgentEvents tenés alertas inteligentes (IVS) y siempre el botón de vivo.

Si **no estás viendo los eventos HTTP** del agente en la plataforma (Operaciones / alertas), suele ser porque la URL de **platform.url** no es alcanzable (proxy caído, firewall, etc.). La solución es usar **N8N como único punto de entrada**: el agente envía al webhook de N8N y N8N reenvía a la Cloud Function **nvrAgentEvents**. Así N8N hace de proxy y no dependés de otro servicio.

### Flujo: Agente → N8N (webhook) → nvrAgentEvents

1. **En N8N:** Creá un workflow con:
   - **Webhook** (POST, path ej. `nvr-alertas`). Production URL: `https://TU_DOMINIO_N8N/webhook/nvr-alertas` (o `http://IP_N8N:5678/webhook/nvr-alertas` si es local).
   - **HTTP Request** (o "Enviar a CronoApp"):
     - **Method:** POST  
     - **URL:** `https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents`  
     - **Body Content Type:** JSON  
     - **Body:** pasar el body que recibió el webhook (en N8N suele ser `$json.body`). Debe tener al menos: **nvrId**, **channel**, **eventTypeName**, **status**, **timestamp**.
     - **Header:** `Authorization: Bearer TU_SECRET` (o `X-API-Key: TU_SECRET`). El secret puede ser la clave global de Firestore `nvr_config/webhook.secret` o el **agent_secret** del NVR (el mismo que `platform.key` en el agente).
2. **En el agente** (`config.properties`): poné **platform.url** = la URL del webhook de N8N (no la de Firebase directo):
   ```properties
   platform.url=https://autbacar.dnsalias.com/webhook/nvr-alertas
   platform.key=EL_AGENT_SECRET_O_CLAVE_GLOBAL
   ```
3. Activá el workflow en N8N. Reiniciá el agente. Las alertas y heartbeats llegarán a N8N y N8N los reenvía a nvrAgentEvents; en CronoApp verás las alertas en Operaciones y "Ver canal en vivo" seguirá funcionando por túnel si lo tenés configurado.

Ver **N8N-WEBHOOK.md** para el detalle del body y workflows de ejemplo (`n8n-workflow-NVR-Alert-B-C.json`, `n8n-workflow-NVR-Alert-completo.json`).

### Si no ves los eventos (diagnóstico)

| Revisar | Dónde |
|--------|--------|
| ¿El agente puede alcanzar **platform.url**? | Desde la PC del agente: `curl -X POST "https://TU_URL_N8N/webhook/nvr-alertas" -H "Content-Type: application/json" -d "{\"nvrId\":\"test\",\"channel\":0,\"eventTypeName\":\"MOTION_EX\",\"status\":\"start\",\"timestamp\":\"2025-03-02T12:00:00.000Z\"}"` — si falla, es red/firewall/proxy. |
| ¿N8N recibe el POST? | N8N → ejecuciones del workflow: deberían aparecer entradas cuando el agente envía. |
| ¿N8N reenvía a nvrAgentEvents? | En el nodo HTTP Request del workflow: URL = `.../nvrAgentEvents`, body con nvrId, channel, eventTypeName, status, timestamp; header Authorization con el secret correcto. |
| ¿nvrAgentEvents acepta el request? | Firebase Console → Functions → nvrAgentEvents → Logs. Si hay 401, el secret no coincide (usá `nvr_config/webhook.secret` o el agent_secret del NVR). |
| ¿Las alertas se crean en Firestore? | Firestore → colección `alerts` (o la que use la app). Si no hay docs nuevos, el body o el status puede estar mal (nvrAgentEvents solo crea alerta cuando **status** = `"start"`). |

---

## Parte E: Probar el video en vivo

1. Entrá a la **app** (Operaciones) con un usuario logueado.
2. Abrí una **alerta** de ese NVR (o andá a la página de vivo con parámetros):
   - Podés ir directo a:  
     `https://TU_APP/admin/operaciones/vivo?nvrId=Bacar-M102&channel=1`  
     (reemplazá `TU_APP` y `Bacar-M102` por tu app y tu `nvr_id`).
3. La app debería:
   - Cargar el NVR desde Firestore (tiene `agent_registered` / `stream_via_tunnel`).
   - Si está definida **NEXT_PUBLIC_TUNNEL_WS_URL**, abrir WebSocket al túnel con nvrId, canal y token.
   - Mostrar la imagen que envía el agente (actualización cada ~150 ms).

Si ves "Agente no conectado": el agente no tiene abierta la conexión al túnel o no se autenticó. Revisá consola del agente y que **platform.key** sea exactamente el **agent_secret** del Paso 5.  
Si ves "Conectando al agente..." y no cambia: revisá que el servidor túnel esté desplegado y que la app use la misma URL **wss://** que el agente.  
Si el agente dice "[Tunnel] Autenticado" pero en la app no se ve imagen: revisá que el NVR responda en **http://nvr.ip/cgi-bin/snapshot.cgi?channel=1** (puerto 80) con el usuario/contraseña del agente; algunos equipos usan otro puerto o otra ruta (consultá la documentación del NVR).

---

## Checklist rápido

| Paso | Qué | Dónde |
|------|-----|--------|
| 1 | Token de registro en Firestore `nvr_config/registration` → campo `token` | Firebase Console |
| 2 | Desplegar nvrOnboard y nvrAgentEvents | `firebase deploy --only functions:...` |
| 3 | Desplegar tunnel-server en Cloud Run, anotar URL **wss://** | `gcloud run deploy ...` |
| 4 | Variable `NEXT_PUBLIC_TUNNEL_WS_URL=wss://...` en la app | Vercel / .env.local |
| 5 | POST a nvrOnboard con token + datos NVR, anotar **agent_secret** | curl / Postman |
| 6 | config.properties: nvr.id, platform.key=agent_secret, platform.tunnel_url=wss://... | PC del agente |
| 7 | Arrancar agente, ver "[Tunnel] Autenticado" | Consola del agente |
| 8 | Abrir vivo en la app con nvrId y channel | Navegador |
| 9 | **Eventos HTTP:** Si no ves alertas, usar N8N como proxy: platform.url = URL webhook N8N; workflow N8N → HTTP Request a nvrAgentEvents (ver Parte D) | N8N + config.properties |

Con esto, la conexión del NVR (agente) a la plataforma, el **video en vivo por túnel** y los **eventos HTTP por N8N** quedan cubiertos.
