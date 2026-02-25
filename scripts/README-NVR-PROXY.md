# Proxy HTTP → HTTPS para NVR

La NVR solo envía por **HTTP**. El webhook de Firebase solo acepta **HTTPS**. Este script recibe las peticiones por HTTP y las reenvía al webhook por HTTPS.

## Cómo usar

1. **Ejecutar el proxy** en una PC o servidor que esté en la **misma red** que la NVR (o a la que la NVR pueda enviar):

   ```bash
   node scripts/nvr-http-to-https-proxy.js
   ```

   Por defecto escucha en el puerto **8080** y reenvía a `nvrAlertV2`. Para **prueba** (nvrWebhookTest):

   ```bash
   set TARGET_URL=https://us-central1-comtroldata.cloudfunctions.net/nvrWebhookTest
   node scripts/nvr-http-to-https-proxy.js
   ```

   En PowerShell:

   ```powershell
   $env:TARGET_URL="https://us-central1-comtroldata.cloudfunctions.net/nvrWebhookTest"; node scripts/nvr-http-to-https-proxy.js
   ```

2. **En la NVR** configurar:

   - **Protocolo:** HTTP  
   - **Dirección del servidor:** IP de la PC donde corre el proxy (ej. `192.168.1.100`)  
   - **Puerto:** `8080`  
   - **Ruta de subida de imágenes:** `/nvrAlertV2?key=123456` (usar **nvrAlertV2**; la antigua nvrAlert está en 1.ª gen y no se actualiza)

3. La NVR enviará a `http://192.168.1.100:8080/nvrAlertV2?key=123456` y el proxy reenviará a la Cloud Function por HTTPS.

## Parámetros en la URL (query)

Podés sumar parámetros a la URL para que el backend identifique cámara y nombre sin depender del body:

| Parámetro   | Ejemplo   | Uso |
|------------|-----------|-----|
| `channel`  | `?channel=1` | Número de canal/cámara (si la NVR no lo manda en el body). |
| `channelId`| `?channelId=2` | Igual que `channel`. |
| `ch`       | `?ch=3`   | Forma corta de canal. |
| `nvrId`    | `?nvrId=NVR-001` | Identificador del NVR (si no viene en el body). |

Ejemplo por cámara: una URL distinta por canal para que cada una sea un evento distinto:

- Cámara 1: `http://IP:8080/nvrAlertV2?key=123456&channel=1`
- Cámara 2: `http://IP:8080/nvrAlertV2?key=123456&channel=2`

El proxy reenvía la query tal cual; la Cloud Function lee estos parámetros.

## Entender qué envía la NVR (inspección en el proxy)

Si en el body del request no podés ver qué manda la NVR, podés activar el **modo inspección** del proxy para que registre en consola las partes del multipart y los campos de texto (nombres de campo y valores cortos). No se modifica el body; solo se analiza para logging.

```bash
set NVR_LOG_BODY=1
node scripts/nvr-http-to-https-proxy.js
```

En PowerShell:

```powershell
$env:NVR_LOG_BODY="1"; node scripts/nvr-http-to-https-proxy.js
```

También sirve `DEBUG=1` en lugar de `NVR_LOG_BODY=1`.

En consola verás líneas como:

- `[PROXY] NVR body (partes): channel_id = "1" | camera_name = "Entrada" | file (file: snapshot.jpg) 45678 bytes`
- `[PROXY] NVR campos (texto): {"channel_id":"1","camera_name":"Entrada",...}`

Así podés saber qué nombres de campo usa tu NVR (p. ej. `channel_id`, `Channel`, `camera_name`, `DeviceName`) para configurar rutas o informar al backend si hace falta soportar más nombres.

## Variables de entorno

| Variable     | Por defecto | Descripción |
|-------------|-------------|-------------|
| `PORT`      | `8080`      | Puerto en el que escucha el proxy. |
| `TARGET_URL`| `.../nvrAlertV2` | URL HTTPS de destino (usar **nvrAlertV2**; o nvrWebhookTest para prueba). |
| `NVR_LOG_BODY` | —       | Si es `1`, se inspecciona y se loguea el body multipart (partes y campos de texto). |
| `DEBUG`     | —           | Si es `1`, equivale a activar `NVR_LOG_BODY` para inspección. |

## ID de evento en Operaciones

En la pantalla de Operaciones, al abrir una alerta IVS se muestra el **ID de evento** (el ID del documento en Firestore). Podés copiarlo con el botón "Copiar" y usarlo en bitácora o reportes para referenciar exactamente ese evento. La imagen se puede ampliar con un clic para verla a pantalla completa.

## Requisitos

- Node.js instalado (v14 o superior).
- La PC con el proxy debe ser accesible desde la NVR (misma LAN o reglas de firewall que permitan el puerto 8080).
