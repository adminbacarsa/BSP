# Tres cosas: señales, canal no habilitado, sheet vacío y NEXT_PUBLIC_TUNNEL_WS_URL

---

## 1. Señales que no están claras

Si los eventos que llegan (SHELTER_EX, SMART_EX, etc.) no se entienden bien en la plataforma, se puede:

- Revisar en la app que el **nombre del evento** y el **canal** se muestren bien (ej. "SHELTER_EX - obstrucción" en vez de solo el código).
- En N8N o en el backend se puede mapear `eventTypeName` a un texto más claro antes de guardar o mostrar.

Si me decís qué parte no se entiende (tipo de evento, canal, hora, etc.), se puede afinar el texto que se muestra.

---

## 2. Canal no habilitado no debería figurar

**Hecho:** En la Cloud Function **nvrAgentEvents** ahora solo se crea alerta si ese NVR + canal tiene una **ruta configurada** en CronoApp (colección **camera_routes**, documento `nvrId__canal`).

- Si **no existe** el documento en `camera_routes` para ese canal (ej. Canal 38), el evento se ignora y no se guarda en la plataforma (`skipped: 'channel_not_configured'`).
- Así, solo los canales que hayas dado de alta como rutas en CronoApp generan alertas; el resto no figura.

**Importante:** Hay que **volver a desplegar** la función para que aplique:

```bash
cd apps/functions
npm run build
firebase deploy --only functions:nvrAgentEvents
```

(O desde la raíz: `firebase deploy --only functions:nvrAgentEvents`.)

---

## 3. En el sheet no aparece nada

El sheet tiene las columnas (Fecha/Hora, NVR, Evento, Canal, Status) pero está vacío. Eso suele ser por:

- **Document ID distinto:** El nodo **"Google Sheets (alertas)1"** en N8N escribe en un documento de Google. Si el **Document ID** de ese nodo no es el del libro donde estás mirando la hoja, los datos van a **otro** libro.
- **Hoja:** El nodo escribe en la hoja **"Hoja 1"**. Si en ese mismo documento tenés otra hoja (ej. "Alertas") y estás mirando esa, no verás lo que escribe el workflow.
- **Error en el nodo:** Si en N8N la ejecución falla antes (ej. en "Enviar evento" o en "GET snapshot"), a veces el nodo del Sheet no llega a ejecutarse o falla en silencio.

**Qué revisar en N8N:**

1. En **Executions**, abrí una ejecución donde haya llegado una alarma.
2. Mirá si el nodo **"Google Sheets (alertas)1"** se ejecutó (verde).
3. Si se ejecutó, entrá al nodo y comprobá el **Document ID** (está en la URL del libro: `docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`). Tiene que ser el mismo libro donde tenés la hoja vacía.
4. Comprobá que el nombre de la hoja en el nodo sea **exactamente** el de la pestaña donde querés ver los datos (ej. "Hoja 1").

---

## 4. Qué es NEXT_PUBLIC_TUNNEL_WS_URL (variable de la app)

Es una **variable de entorno** de la **app web** (Next.js, en `apps/web2`). La usa la pantalla de **Operaciones** cuando hacés clic en **"Ver en vivo"** para un NVR.

- Si esa variable **no está** definida, el botón "Ver en vivo" puede usar otro método (ej. iframe directo al NVR) o no conectar por túnel.
- Si **está** definida con la URL del tunnel-server en formato **WebSocket** (`wss://...`), entonces "Ver en vivo" se conecta al **tunnel-server** y muestra el video que envía el agente por el túnel.

**Ejemplo:**

- En **Vercel** (o donde hostees la app): Settings → Environment Variables → agregar:
  - Nombre: `NEXT_PUBLIC_TUNNEL_WS_URL`
  - Valor: `wss://tunnel-server-XXXXX-uc.a.run.app` (la misma URL base del tunnel-server, con **wss://** y sin `/agent` ni `/live`).
- En **local** (`.env.local` en `apps/web2`):
  ```
  NEXT_PUBLIC_TUNNEL_WS_URL=wss://tunnel-server-XXXXX-uc.a.run.app
  ```

**Resumen:** Solo hace falta si querés que **"Ver en vivo"** en la app use el túnel. Si no usás ese botón o solo usás N8N/agente, podés no configurarla.
