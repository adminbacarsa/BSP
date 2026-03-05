# Cómo importar el workflow en N8N

## Archivo a importar

- **Ruta:** `apps/nvr-agent/n8n-workflow-nvr-alert-corregido.json`  
- En tu PC: `D:\APP\cronoapp\apps\nvr-agent\n8n-workflow-nvr-alert-corregido.json`

El nodo **"Google Sheets (alertas)1"** ya tiene los campos con `($json.body || $json)` para que las alertas (ALARM_EX, SMART_EX, etc.) se escriban bien en la hoja.

---

## Pasos para importar

1. **Abrí N8N** en el navegador (ej. https://autbacar.dnsalias.com o donde tengas N8N).

2. **Abrí el menú de workflows:**
   - Click en **"Workflows"** en el menú izquierdo (o el ícono de flujo).

3. **Importar el archivo:**
   - Click en los **tres puntos** (⋮) o en **"Add workflow"**.
   - Elegí **"Import from File"** / **"Import from file"**.
   - Navegá hasta: `D:\APP\cronoapp\apps\nvr-agent\`
   - Seleccioná el archivo **`n8n-workflow-nvr-alert-corregido.json`**.
   - Click en **Abrir** / **Open**.

4. **Si N8N pregunta** "Replace existing workflow?" o "This will replace the current workflow":
   - Si querés **reemplazar** el workflow actual → **Replace** / **Sí**.
   - Si preferís **mantener** el actual y tener una copia nueva → **Import as new** / **No** (y después podés borrar el viejo).

5. **Revisar credenciales:**
   - En los nodos que marquen error (Google Sheets, HTTP, etc.) entrá al nodo y asigná tu credencial (la misma que usabas antes).

6. **Document ID del Google Sheet (si usás otro documento):**
   - Abrí el nodo **"Google Sheets (alertas)1"** (y "Google Sheets (heartbeats)1", "Leer Heartbeats" si aplica).
   - Si tu hoja está en **otro** documento de Google, reemplazá el **Document ID** por el de tu documento (está en la URL del Sheet: `docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`).

7. **Activar el workflow:**
   - Arriba a la derecha pasá el interruptor a **Active** (verde).
   - Guardá (Ctrl+S o botón **Save**).

Listo. Las alertas que envíe el agente a `https://autbacar.dnsalias.com/webhook/nvr-alertas` deberían escribirse en la **Hoja 1** del documento configurado.

---

## GET snapshot NVR por túnel

El nodo "GET snapshot NVR" usa la URL del **tunnel-server** (GET /snapshot?nvrId=&channel=). En el JSON del repo ya está la URL: `https://tunnel-server-698108879063.us-central1.run.app/snapshot?...`. Authorization = Bearer + agent_secret. Ver **SNAPSHOT-POR-TUNEL.md**.

---

## Si da "Forbidden" o "Secreto inválido"

El nodo "Enviar evento a CronoApp (directo)" envía a la URL de eventos (Cloud Run o Cloud Functions). El backend acepta el token si coincide con:

- **nvr_config/webhook** → campo **secret**, **o**
- **nvr_devices/{nvrId}** → campo **agent_secret** (el nvrId viene en el body del request).

Qué hacer: en Firebase poné el **mismo** valor que usás en N8N (Bearer sin la palabra "Bearer") en uno de esos dos sitios. Ejemplo: si en N8N tenés `Bearer RRrtHM69t3p-_lv9O3UXkQZvSBWvP51PJ0BxOQSnTe0`, en **nvr_config/webhook** → **secret** = `RRrtHM69t3p-_lv9O3UXkQZvSBWvP51PJ0BxOQSnTe0`. O bien en **nvr_devices/8F0001CPAZ21EFD** (y el nvrId que envíe el agente) → **agent_secret** = ese mismo valor.
