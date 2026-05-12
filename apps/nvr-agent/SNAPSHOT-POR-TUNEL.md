# Snapshot por túnel (N8N en la nube)

Para que **N8N** (en la nube) pueda obtener la imagen del NVR sin tocar la IP local, el **tunnel-server** expone un endpoint y el **agente** responde por el mismo WebSocket del túnel.

---

## Qué se implementó

1. **Tunnel-server (Cloud Run)**  
   - **GET /snapshot?nvrId=XXX&channel=Y** (channel 1-based).  
   - Header **Authorization: Bearer** con el mismo valor que en nvrAgentEvents (agent_secret o nvr_config/webhook.secret).  
   - El servidor le pide al agente conectado (por WebSocket) una imagen; el agente la pide al NVR y la devuelve en base64.  
   - Respuesta: **image/jpeg** (cuerpo binario).

2. **Agente (TunnelClient)**  
   - Si recibe un mensaje **get_snapshot** (channel + requestId), hace un GET al NVR (snapshot.cgi), codifica la imagen en base64 y envía **snapshot_response** con requestId e imageBase64.

3. **Workflow N8N**  
   - El nodo **"GET snapshot NVR"** ya no llama a `http://192.168.x.x/...`.  
   - Llama a **https://&lt;tu-tunnel-server&gt;/snapshot?nvrId=...&channel=...** con **Authorization: Bearer &lt;agent_secret&gt;**.  
   - En el JSON del workflow la URL ya está configurada: **tunnel-server-698108879063.us-central1.run.app**.

---

## Pasos para que funcione

1. **Desplegar el tunnel-server** con los cambios (endpoint `/snapshot` y manejo de `get_snapshot` / `snapshot_response`).  
   - Desde el repo: deploy a Cloud Run como en PASO-A-PASO-CONEXION-Y-VIVO.md.  
   - Anotá la URL base (ej. `https://tunnel-server-xxxxx-uc.a.run.app`).

2. **Agente**  
   - Debe tener **platform.tunnel_url** apuntando al tunnel-server (wss://...) para que esté conectado al túnel.  
   - Recompilar el agente con los cambios de TunnelClient (get_snapshot → snapshot_response).  
   - Reiniciar el agente.

3. **N8N**  
   - En el nodo **"GET snapshot NVR"** la URL ya es `https://tunnel-server-698108879063.us-central1.run.app/snapshot?...`.  
   - El header **Authorization** debe ser **Bearer** + el mismo agent_secret (platform.key).

4. **Probar**  
   - Dispará una alerta; N8N debería recibir el evento, pedir el snapshot al túnel, el agente pedir la imagen al NVR y devolverla; el Merge ya no se queda colgado y la ejecución no termina en Error por “connection cannot be established”.

---

## Por qué dejaban de funcionar las ejecuciones

El flujo hace **Merge** de (evento + imagen). Si **GET snapshot** iba directo a la IP del NVR, desde N8N en la nube fallaba y el Merge **nunca** recibía la segunda entrada, así que la ejecución quedaba **Running** hasta timeout y luego **Error**.  
Con el snapshot por túnel, N8N llama a una URL pública (el tunnel-server); el agente, que sí puede llegar al NVR, devuelve la imagen y el Merge recibe las dos entradas. Las ejecuciones dejan de colgarse.
