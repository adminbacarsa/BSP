# Tutorial: Poner en práctica el sistema NVR AI Alert (paso a paso)

Este documento explica cómo configurar y probar el flujo completo: **NVR → Webhook → Storage + Firestore → FCM → Guardias/Operador**.

---

## Índice

1. [Prerrequisitos](#1-prerrequisitos)
2. [Paso 1: Secret del webhook en Firestore](#2-paso-1-secret-del-webhook-en-firestore)
3. [Paso 2: Ruta de cámara (camera_routes)](#3-paso-2-ruta-de-cámara-camera_routes)
4. [Paso 3: Tokens FCM de guardias (guard_tokens)](#4-paso-3-tokens-fcm-de-guardias-guard_tokens)
5. [Paso 4: Guardia “en servicio” (active_assignments)](#5-paso-4-guardia-en-servicio-active_assignments)
6. [Paso 5: Probar con un POST simulado (curl)](#6-paso-5-probar-con-un-post-simulado-curl)
7. [Paso 6: Verificar alerta en Firestore y Storage](#7-paso-6-verificar-alerta-en-firestore-y-storage)
8. [Paso 7: Configurar el NVR Dahua (cámara real)](#8-paso-7-configurar-el-nvr-dahua-cámara-real)
9. [Resumen de URLs y colecciones](#9-resumen-de-urls-y-colecciones)

---

## 1. Prerrequisitos

- Proyecto Firebase **comtroldata** (o el que uses) con Functions y Firestore desplegados.
- Las funciones **nvrAlert** y **onAlertCreated** ya desplegadas (si no, ver sección final).
- Permiso de invocación pública para **nvrAlert**: en Google Cloud Console, la función debe tener el rol **Cloud Functions Invoker** para `allUsers` (o el NVR no podrá llamarla).
- Una imagen de prueba (JPG o PNG) para el POST simulado, o un NVR Dahua con IVS activado.

---

## 2. Paso 1: Secret del webhook en Firestore

El webhook solo acepta requests que envíen el secret (por URL o header). Así evitas que cualquiera dispare alertas.

1. Entrá a **Firebase Console** → [Firestore](https://console.firebase.google.com/project/comtroldata/firestore).
2. Si no existe, creá la **colección** `nvr_config` (o usá “Start collection”).
3. Creá el **documento** con ID: `webhook`.
4. Agregá un campo:
   - **Nombre:** `secret`
   - **Tipo:** string
   - **Valor:** por ejemplo `123456` (en producción usá uno largo y aleatorio).

Queda: `nvr_config` → documento `webhook` → campo `secret` = `"123456"`.

Para probar **sin** secret podés borrar el campo `secret` o dejarlo vacío; en ese caso el webhook acepta cualquier POST (solo para pruebas).

---

## 3. Paso 2: Ruta de cámara (camera_routes)

Esta colección indica **qué cámara/canal pertenece a qué objetivo/puesto** y si está habilitada. El webhook usa esto para saber si crea la alerta y a qué guardias notificar.

1. En Firestore, creá la colección **camera_routes** (si no existe).
2. El **ID del documento** debe ser: `{nvrId}__{channelId}`.  
   Para un solo NVR o demo usá: **`default__2`** (canal 2).
3. Agregá estos campos:

| Campo         | Tipo    | Valor ejemplo        |
|---------------|---------|----------------------|
| enabled      | boolean | true                 |
| camera_name  | string  | Entrada Principal    |
| objective_id | string  | OBJ_PILOTO           |
| post_id      | string  | PUESTO_ENTRADA       |
| event_type   | string  | Tripwire (opcional)  |

Si **enabled** es `false`, el webhook responde 200 pero **no** crea alerta ni notifica (útil para desactivar una cámara sin borrar la config).

---

## 4. Paso 3: Tokens FCM de guardias (guard_tokens)

Para que el trigger envíe notificaciones push, cada guardia debe tener al menos un documento en **guard_tokens** con su FCM token.

1. Creá la colección **guard_tokens** (si no existe).
2. Creá un documento. Lo ideal es usar como **ID** el `uid` del guardia en Firebase Auth (ej. `abc123uid`).
3. Campos:

| Campo     | Tipo    | Valor ejemplo                          |
|-----------|---------|----------------------------------------|
| guard_id  | string  | mismo que el uid del guardia           |
| fcm_token | string  | token que devuelve la app al registrar |
| platform  | string  | android o ios                          |
| is_active | boolean | true                                   |

El **fcm_token** lo obtiene la app del guardia al inicializar Firebase Messaging; hay que guardarlo en este documento (por ejemplo con una Cloud Function callable o desde el backend cuando el guardia inicia sesión).

Para **probar sin app**: podés dejar un documento con `fcm_token` vacío o un valor de prueba; la alerta se creará igual, pero el trigger marcará `notification.sent: false` si no hay tokens válidos.

---

## 5. Paso 4: Guardia “en servicio” (active_assignments)

El trigger **onAlertCreated** decide a quién notificar buscando guardias “en servicio” para el **objective_id** de la alerta. Eso se lee de **active_assignments**.

1. Creá la colección **active_assignments** (si no existe).
2. Creá un documento con **ID = uid del guardia** (ej. `abc123uid`).
3. Campos:

| Campo        | Tipo    | Valor ejemplo  |
|--------------|---------|----------------|
| guard_id     | string  | abc123uid      |
| objective_id | string  | OBJ_PILOTO     |
| post_id      | string  | PUESTO_ENTRADA |
| is_on_duty   | boolean | true           |

Si no hay ningún documento con `objective_id` = al de la alerta y `is_on_duty == true`, el trigger envía a **todos** los tokens activos de **guard_tokens** (fallback para el piloto).

---

## 6. Paso 5: Probar con un POST simulado (curl)

Asumimos que el secret en Firestore es `123456` y que tenés una imagen para enviar.

### Opción A: Desde la raíz del repo (ya hay un `snapshot.jpg` de prueba)

En el repo hay un JPEG mínimo en `scripts/nvr-alert-demo/snapshot.jpg`. Desde la raíz del proyecto (`D:\APP\cronoapp`):

**PowerShell o CMD:**

```bash
cd D:\APP\cronoapp
curl.exe -s -X POST "https://us-central1-comtroldata.cloudfunctions.net/nvrAlert?key=123456" -F "image=@scripts/nvr-alert-demo/snapshot.jpg" -F "channel_id=2" -F "camera_name=Entrada Principal" -F "event_type=Tripwire" -F "object_type=human"
```

(Usá `curl.exe` para evitar que PowerShell use el alias de Invoke-WebRequest.)

### Opción B: Con una imagen tuya

1. Abrí una terminal en la carpeta donde está la imagen (o usá la ruta completa).
2. Ejecutá:

**Windows (CMD o PowerShell):**

```bash
curl.exe -s -X POST "https://us-central1-comtroldata.cloudfunctions.net/nvrAlert?key=123456" -F "image=@snapshot.jpg" -F "channel_id=2" -F "camera_name=Entrada Principal" -F "event_type=Tripwire" -F "object_type=human"
```

**Si la imagen está en otra ruta:**

```bash
curl.exe -s -X POST "https://us-central1-comtroldata.cloudfunctions.net/nvrAlert?key=123456" -F "image=@C:\ruta\completa\snapshot.jpg" -F "channel_id=2" -F "camera_name=Entrada Principal" -F "event_type=Tripwire" -F "object_type=human"
```

3. Respuesta esperada:

```json
{"ok":true,"alertId":"xxxxxxxxxxxx"}
```

Si ves **403** → el `key` no coincide con el `secret` en Firestore.  
Si ves **400** (ej. “Falta archivo”) → el part `image` no se envió bien; revisá que el archivo exista y que el nombre del campo sea `image`.  
Si ves **500** → mirá los logs de la función **nvrAlert** en Firebase Console.

---

## 7. Paso 6: Verificar alerta en Firestore y Storage

1. **Firestore**
   - Ir a [Firestore](https://console.firebase.google.com/project/comtroldata/firestore) → colección **alerts**.
   - Deberías ver un documento nuevo con el **alertId** de la respuesta.
   - Campos útiles: `timestamp`, `camera_name`, `channel_id`, `status` (pending), `image_url`, `objective_id`, `post_id`. Si el trigger corrió, también verás `notification` (sent, token_count, etc.).

2. **Storage**
   - Ir a [Storage](https://console.firebase.google.com/project/comtroldata/storage).
   - Carpeta **alerts** → dentro, carpeta por fecha **YYYY-MM-DD** → archivo **&lt;alertId&gt;.jpg** (o .png según lo que subiste).

3. **Logs**
   - [Functions](https://console.firebase.google.com/project/comtroldata/functions) → **nvrAlert** → pestaña Logs.
   - [Functions](https://console.firebase.google.com/project/comtroldata/functions) → **onAlertCreated** → pestaña Logs (para ver envío FCM o errores).

---

## 8. Paso 7: Configurar el NVR Dahua (cámara real)

Cuando quieras que el **NVR real** dispare las alertas:

1. **URL del webhook**  
   `https://us-central1-comtroldata.cloudfunctions.net/nvrAlert?key=123456`  
   (reemplazá `123456` por el valor de `nvr_config/webhook.secret`).

2. **En el NVR Dahua**
   - Menú: **Network** → **Alarm Center** (o “Centro de alarmas”).
   - Protocolo: **HTTP**.
   - Server address: la URL anterior (solo el host, ej. `us-central1-comtroldata.cloudfunctions.net`).
   - Port: **443** (HTTPS).
   - Path: **/nvrAlert** (y si tu firmware permite query string, agregá `?key=123456`; si no, probá header **X-Webhook-Secret** si tu NVR lo soporta).
   - En **Event** → **IVS**: activar la regla (ej. cruce de línea, intrusión).
   - En “Record Control” o “Snapshot”: marcar **Send to Alarm Center** (o equivalente para enviar imagen al servidor HTTP).

3. **Identificación del canal**  
   Si el NVR puede enviar un parámetro de canal, asegurate de que coincida con el **channel_id** que usaste en **camera_routes** (ej. `default__2` para canal 2). Si el NVR envía otro identificador, podés crear un documento en **camera_routes** con ID acorde (ej. `NVR1__1` para NVR “NVR1” canal 1).

4. **Prueba**  
   Dispará un evento IVS (cruce de línea o intrusión) y revisá Firestore **alerts** y Storage **alerts/YYYY-MM-DD/** para confirmar que se creó el doc y la imagen.

---

## 9. Resumen de URLs y colecciones

| Qué | Dónde |
|-----|--------|
| URL del webhook | `https://us-central1-comtroldata.cloudfunctions.net/nvrAlert` |
| Secret (query) | `?key=123456` (o el valor en `nvr_config/webhook.secret`) |
| Firestore: config secret | Colección `nvr_config` → doc `webhook` → campo `secret` |
| Firestore: rutas cámara | Colección `camera_routes` → doc ej. `default__2` |
| Firestore: tokens push | Colección `guard_tokens` → doc por guardia |
| Firestore: en servicio | Colección `active_assignments` → doc por guardia |
| Firestore: alertas | Colección `alerts` → un doc por evento |
| Storage: fotos | Carpeta `alerts/YYYY-MM-DD/<alertId>.jpg` |

---

## Despliegue de las funciones (si aún no están)

Desde la raíz del repo:

```bash
cd D:\APP\cronoapp
npm --prefix apps/functions run build
firebase deploy --only "functions:nvrAlert,functions:onAlertCreated,firestore:rules"
```

Luego en Google Cloud Console: dar a **nvrAlert** el rol **Cloud Functions Invoker** a `allUsers` para que el NVR (y el curl) puedan llamarla.

---

*Tutorial generado para CronoApp – NVR AI Alert System.*
