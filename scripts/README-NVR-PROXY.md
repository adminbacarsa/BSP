# Proxy HTTP → HTTPS para NVR

La NVR solo envía por **HTTP**. El webhook de Firebase solo acepta **HTTPS**. Este script recibe las peticiones por HTTP y las reenvía por HTTPS.

## Cómo usar

1. **Ejecutar el proxy** en una PC o servidor que esté en la **misma red** que la NVR (o a la que la NVR pueda enviar):

   ```bash
   node scripts/nvr-http-to-https-proxy.js
   ```

   Por defecto escucha en el puerto **8080** y reenvía a `nvrAlert`. Para **prueba** (nvrWebhookTest):

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

3. La NVR enviará a `http://192.168.1.100:8080/nvrAlertV2?key=123456` y el proxy reenviará a `https://us-central1-comtroldata.cloudfunctions.net/nvrAlertV2?key=123456`.

## Variables de entorno

| Variable     | Por defecto | Descripción                          |
|-------------|-------------|--------------------------------------|
| `PORT`      | `8080`      | Puerto en el que escucha el proxy.  |
| `TARGET_URL`| `.../nvrAlertV2` | URL HTTPS de destino (usar **nvrAlertV2**; o nvrWebhookTest para prueba). |

## Requisitos

- Node.js instalado (v14 o superior).
- La PC con el proxy debe ser accesible desde la NVR (misma LAN o reglas de firewall que permitan el puerto 8080).
