# Por qué no funciona – diagnóstico paso a paso

Una sola cosa está rota en algún punto. Hay que encontrar **cuál** y arreglarlo.

---

## Paso 1: ¿El agente envía algo a N8N?

**Qué mirar:** Consola del agente cuando corre (run.bat).

- Si ves **`[PlatformSender] Evento enviado: SMART_EX`** o **`Heartbeat enviado`** → el agente **sí** está mandando al `platform.url`.
- Si ves **`Evento omitido (no en lista)`** → el evento no está en `event.types.include` (no es fallo de red).
- Si ves **error de conexión, timeout, connection refused** → el agente **no** llega a N8N. Revisar:
  - `platform.url` en config.properties = URL del webhook de N8N (ej. `https://autbacar.dnsalias.com/webhook/nvr-alertas`).
  - N8N está arriba y el workflow está **Active** (verde).
  - Firewall / red no bloquea esa URL.

**Si el agente no envía:** arreglar URL, N8N activo o red. El resto no importa hasta que esto funcione.

---

## Paso 2: ¿N8N recibe el POST?

**Qué mirar:** N8N → **Executions**. Cuando el agente envía un evento o heartbeat, debe aparecer una ejecución **nueva** del workflow (trigger = Webhook).

- Si **no** aparece ninguna ejecución cuando el agente manda → N8N no está recibiendo. Revisar:
  - URL del webhook que configuraste en el agente = la que tiene el nodo Webhook en N8N (path `nvr-alertas` o el que sea).
  - Workflow **Active**.
  - Si N8N está detrás de un proxy/dominio, que ese dominio resuelva bien y el path sea el correcto.

**Si N8N no recibe:** el fallo está entre agente y N8N (URL, workflow inactivo, proxy). Arreglar eso primero.

---

## Paso 3: ¿N8N puede enviar a CronoApp (nvrAgentEvents)?

**Qué mirar:** En la misma ejecución de N8N, el nodo **"Enviar evento a CronoApp (directo)"**:

- Si sale **Forbidden / Secreto inválido** → el backend rechaza el token. Revisar:
  - En N8N, header **Authorization** = `Bearer XXXXX` (el valor exacto, sin espacios de más).
  - En Firebase: **nvr_config/webhook** → campo **secret** = ese mismo valor (solo el token, sin "Bearer"), **o** en **nvr_devices/{nvrId}** → **agent_secret** = ese mismo valor. El `nvrId` del body debe ser el que usás en ese documento.
  - URL del nodo = la que realmente usás (Cloud Run o Cloud Functions). Si la función está en Cloud Run, la URL tiene que ser la de Cloud Run.

**Si da Forbidden:** corregir token o URL; no es culpa del agente ni del resto del flujo.

---

## Paso 4: ¿Por qué falla "GET snapshot NVR"?

**Qué mirar:** En la ejecución, el nodo **"GET snapshot NVR"** con error **"The connection cannot be established"**.

- **Causa:** Ese nodo hace HTTP a la **IP del NVR** (ej. `http://192.168.0.102/...`). Si N8N corre **en la nube**, no puede llegar a una IP de tu red local.
- **No es un bug de configuración:** es que falta que “algo” exponga el NVR a internet (túnel o proxy). Mientras tanto:
  - Las **alertas y el evento a CronoApp** pueden seguir funcionando (los nodos anteriores a GET snapshot ya enviaron).
  - Podés **desactivar solo ese nodo** (y los que dependan de la imagen) para que no rompa la ejecución; el resto del flujo sigue.

**Resumen:** O N8N está en la misma red que el NVR, o hacés un túnel/proxy para que N8N pueda pedir el snapshot. Hasta entonces, ese nodo va a fallar si N8N está en la nube.

---

## Paso 5: ¿Llegan las alertas a la plataforma / al sheet?

- **CronoApp:** Si el nodo "Enviar evento a CronoApp (directo)" sale en verde en N8N, el evento **sí** llegó a nvrAgentEvents. Si no ves la alerta en la UI, el fallo está en la **app** (pantalla, filtros, o cómo se leen los datos de Firestore).
- **Google Sheet:** Si el nodo "Google Sheets (alertas)1" sale en verde, los datos se escribieron. Si la hoja está vacía, revisar que sea la hoja correcta (mismo Document ID y nombre de hoja).

---

## Resumen: orden para revisar

1. Agente → ¿envía? (consola del agente).
2. N8N → ¿recibe? (Executions con ejecuciones nuevas).
3. N8N → CronoApp → ¿Forbidden? (token y URL en N8N + Firestore).
4. GET snapshot → ¿connection cannot be established? (N8N en la nube sin túnel/proxy).
5. ¿Se ve en la app o en el sheet? (otra capa: UI o Sheet).

Decime **exactamente** qué ves: por ejemplo “el agente dice Heartbeat enviado pero en N8N no hay ejecuciones” o “en N8N el nodo Enviar evento da Forbidden”. Con eso se apunta al eslabón roto y se arregla solo eso.
