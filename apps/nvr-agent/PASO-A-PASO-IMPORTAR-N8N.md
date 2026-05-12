# Paso a paso: importar el workflow en N8N y que funcione

Guía corta para no marearse: importar el JSON, configurar lo mínimo y que lleguen alertas y la alerta de desconexión (último latido hace más de 3 min).

---

## Paso 1: Importar el workflow

1. Abrí **N8N** (en el navegador).
2. Menú **Workflows** → **Import from File** (o **Add workflow** → **Import**).
3. Elegí el archivo **`n8n-workflow-nvr-alert-corregido.json`** (está en `apps/nvr-agent/` del repo).
4. Si N8N pregunta "Replace existing workflow?", podés reemplazar o crear uno nuevo.
5. Guardá el workflow (Ctrl+S o botón **Save**).

---

## Paso 2: Credenciales que tenés que tener en N8N

El JSON ya trae la URL de CronoApp y el agent_secret. Solo tenés que tener **credenciales creadas en N8N** para:

| Credencial | Uso |
|------------|-----|
| **Google Sheets** (cuenta de servicio) | Para "Leer Heartbeats", "Google Sheets (heartbeats)1", "Google Sheets (alertas)1". Mismo documento que uses en el workflow. |
| **OpenAI** (opcional) | Para el nodo "OpenAI Vision (etiqueta)" si querés IA en las imágenes. |

En cada nodo que marque error de credencial, entrá al nodo → **Credentials** → elegí la credencial que corresponda (o creala si no existe). El **document ID** del Google Sheet en el JSON es un ejemplo; si usás otro documento, cambiá en los nodos el **Document ID** por el de tu hoja.

---

## Paso 3: Activar el workflow (importante)

1. Arriba a la derecha del canvas hay un **interruptor** (toggle) que dice **Inactive** / **Active**.
2. Pasalo a **Active** (verde). Si no está activo, el webhook no recibe nada y el **trigger "Cada 2 minuto" no se ejecuta** → por eso no se dispara la alerta de desconexión aunque hayan pasado 4 min desde el último latido.
3. Guardá de nuevo.

---

## Paso 4: Hoja "Heartbeats" en Google Sheets

Para que la **alerta de desconexión** funcione (último latido hace más de 3 min):

1. En el **mismo** documento de Google que usás en N8N, tiene que existir una hoja llamada **"Heartbeats"**.
2. La primera fila debe tener los **encabezados**: `nvrId`, `LastHeartbeat`, y si podés, **`Ts`** (timestamp en formato ISO, ej. `2025-03-04T19:52:00.000Z`).
3. Cuando el agente envía heartbeats, N8N escribe en esa hoja (rama del webhook cuando es heartbeat). Si no hay filas en "Heartbeats", el nodo "Leer Heartbeats" no tiene datos y no puede marcar a nadie como desconectado.
4. Si la hoja tiene solo `nvrId` y `LastHeartbeat` (sin `Ts`), el nodo "Estado NVR (3 min)" usa `LastHeartbeat`; si esa columna tiene fecha/hora en formato que Excel/Sheets entiendan (ej. `04/03/2025 16:52:00`), suele funcionar. Mejor añadir columna **Ts** y que el nodo "Google Sheets (heartbeats)1" escriba ahí `$json.body.timestamp` (el workflow ya lo hace si importaste el JSON actual).

---

## Paso 5: Probar la alerta de desconexión

1. Comprobá que en la hoja **Heartbeats** haya al menos una fila con tu `nvrId` (ej. `8F0001CPAZ21EFD`) y una hora (ej. 4:52).
2. Dejá el agente **parado** (o desconectá la red) para que no envíe más heartbeats.
3. Esperá **más de 3 minutos** (ej. hasta 4:56 si el último latido fue 4:52).
4. El trigger **"Cada 2 minuto"** corre cada 2 min; en la siguiente ejecución después de los 3 min, el nodo "Estado NVR (3 min, una vez por cambio)" debería generar un ítem **AGENT_OFFLINE** y "Enviar estado NVR a CronoApp" lo envía a CronoApp.
5. Revisá en N8N → **Executions**: debería aparecer una ejecución del trigger "Cada 2 minuto"; abrila y mirá el nodo "Estado NVR (3 min...)" y "Enviar estado NVR a CronoApp". Si "Estado NVR" no devuelve ningún ítem, la hoja no tiene datos o las fechas no se están leyendo bien (revisá que la hoja tenga nombre "Heartbeats" y que "Leer Heartbeats" use la misma hoja y el mismo documento).

---

## Paso 6: Resumen rápido

| Qué | Dónde |
|-----|--------|
| Importar | N8N → Workflows → Import from File → `n8n-workflow-nvr-alert-corregido.json` |
| Credenciales | Asignar Google Sheets (y OpenAI si usás IA) en los nodos que lo pidan. |
| **Activar workflow** | Toggle **Active** arriba a la derecha (si no, no corre ni el webhook ni el "Cada 2 minuto"). |
| Hoja Heartbeats | Mismo documento, hoja "Heartbeats", columnas nvrId, LastHeartbeat, Ts (opcional). |
| Alertas al sheet / CronoApp | El agente envía al webhook de N8N; `platform.url` en el agente = URL del webhook. |
| Desconexión (3 min) | Trigger "Cada 2 minuto" → Leer Heartbeats → Estado NVR (3 min) → Enviar estado NVR a CronoApp. Solo corre si el workflow está **activo**. |

Si el último latido fue a las 4:52 y a las 4:56 no saltó la alerta, lo más habitual es que el workflow esté **Inactive** o que "Leer Heartbeats" no esté trayendo filas (hoja vacía, otro documento, otro nombre de hoja). Revisá eso primero.
