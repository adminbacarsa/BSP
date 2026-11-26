# Manual Meta — WhatsApp Cloud API (COSP)

Guía para Mauro / Bacar. La tubería en COSP ya está desplegada; este documento cubre **solo la configuración en Meta** y cómo enchufarla en CronoApp.

**Última actualización:** 2026-11-26

---

## Qué vas a obtener al final

| Dato | Dónde se usa en COSP |
|------|----------------------|
| Phone number ID | Configuración → WhatsApp → Cloud |
| WABA ID | Idem |
| Access token (system user) | Botón «Guardar token» (no queda en el navegador) |
| Webhook URL | Meta App Dashboard |
| Verify token | Meta + COSP (`cosp-wa-cloud-verify`) |

**Webhook COSP (prod):**  
`https://us-central1-comtroldata.cloudfunctions.net/whatsappCloudWebhook`

**Verify token por defecto:** `cosp-wa-cloud-verify`  
(salvo que hayan definido `WA_CLOUD_VERIFY_TOKEN` o `system_secrets/wa_cloud_webhook`)

---

## Antes de empezar — checklist

- [ ] Cuenta Facebook personal con rol de admin en el negocio Bacar (o que te den acceso).
- [ ] Acceso a [Meta Business Suite](https://business.facebook.com) del portfolio **Grupo Bacar** (o el que usen).
- [ ] Un **número de teléfono** que pueda recibir SMS o llamada de voz.
  - Ideal: línea Bacar **nueva**, no la del bridge Baileys en producción.
  - El número **no** puede estar activo en WhatsApp personal / WhatsApp Business app (salvo coexistencia Meta, que es otro flujo).
- [ ] Método de pago en Business Manager (hace falta para mensajes iniciados por la empresa).
- [ ] Celular de prueba (el tuyo) con WhatsApp para recibir `hello_world`.

---

## Paso 1 — Portfolio de negocio

1. Entrá a https://business.facebook.com
2. Si no hay portfolio: **Crear cuenta** / **Create account** → nombre (ej. «Grupo Bacar»).
3. Completá datos de la empresa cuando Meta los pida.
4. Anotá el nombre del portfolio: lo vas a vincular al App.

**Verificación del negocio:** Meta suele pedir CUIT / docs. Sin verificación completa igual podés probar con el número de test; para producción y límites altos conviene verificar.

---

## Paso 2 — App en Meta for Developers

1. Entrá a https://developers.facebook.com
2. Arriba a la derecha: **Mis apps** → **Crear app**.
3. Caso de uso: **Connect with customers through WhatsApp**  
   (en dashboards viejos: tipo *Business* + producto WhatsApp).
4. Nombre de la app: **no** pongas solo «WhatsApp» (Meta lo rechaza). Ejemplos OK:
   - `COSP Operaciones`
   - `Bacar Centro de Control`
5. Mail de contacto: el de TI / Mauro.
6. Vinculá el **Business portfolio** del paso 1.
7. Creá la app.

---

## Paso 3 — Producto WhatsApp y sandbox

1. En el dashboard de la app → menú **WhatsApp** (o **Use cases** → WhatsApp → Customize).
2. Abrí **API Setup** / **Configuración de la API**.
3. Meta crea automáticamente:
   - Un **WhatsApp Business Account (WABA)** de prueba
   - Un **número de teléfono de prueba** (ya registrado)
4. En **To** / destinatarios de prueba:
   - Agregá tu celular (y el de Juan / un guardia piloto).
   - Confirmá el código que te llega por WhatsApp.
5. **Generate access token** (token corto de usuario — solo para la prueba de ahora).
6. Seleccioná el número **From** (test) y **To** (tu celular).
7. Enviá el mensaje de plantilla **`hello_world`**.

**Criterio de done:** te llega el mensaje en WhatsApp.

### Datos a anotar (sandbox)

En la misma pantalla copiá:

1. **Phone number ID** (no es el número +54…; es un ID numérico largo).
2. **WhatsApp Business Account ID** (WABA ID).
3. Token temporal (solo prueba; después lo reemplazamos).

---

## Paso 4 — Token permanente (system user)

El token del paso 3 caduca en horas. En producción hace falta uno de **usuario del sistema**.

1. https://business.facebook.com → **Configuración del negocio** (engranaje).
2. **Usuarios** → **Usuarios del sistema** → **Agregar**.
3. Nombre: ej. `cosp-wa-cloud`.
4. Rol: **Administrador** (o el mínimo que permita tokens de WhatsApp; en la práctica suele pedirse Admin).
5. **Agregar activos**:
   - La **app** que creaste → control total / Develop.
   - El **WABA** (cuenta de WhatsApp) → control total.
6. En el usuario del sistema → **Generar token nuevo**.
7. Seleccioná la app y estos permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   - (opcional) `business_management`
8. Elegí vencimiento: **sin vencimiento** o el máximo que ofrezca Meta (si solo hay plazos, programá rotación).
9. **Copiá el token una sola vez** y guardalo en un lugar seguro (gestor de secretos / 1Password). No lo pegues en chats ni en git.

**Criterio de done:** tenés un token largo tipo `EAA...` que no es el de «Generate access token» del API Setup.

---

## Paso 5 — Número de producción

### 5.1 Requisitos del número

- Con código de país (ej. +54 9 351…).
- Puede recibir SMS o llamada.
- No short-code.
- Si ya tiene WhatsApp: hay que **eliminar la cuenta** de esa app o usar el flujo de coexistencia (no recomendado para el primer piloto).

### 5.2 Liberar el número del bridge (si es el mismo)

Si pensás reutilizar el número del Baileys:

1. En el celular: WhatsApp → Dispositivos vinculados → cerrar sesión del bridge.
2. O borrar / dejar de usar esa línea en Baileys.
3. Esperá a que Meta acepte el número (a veces tarda si estaba «caliente»).

**Recomendación Bacar:** número **nuevo** para Cloud; el bridge sigue con el actual hasta el corte.

### 5.3 Alta en WhatsApp Manager

1. Desde el App Dashboard → WhatsApp → **API Setup** → **Add phone number**  
   o Business Suite → **WhatsApp Manager** → números.
2. Completá el **nombre para mostrar** (display name): debe coincidir con la marca (ej. «Bacar Seguridad» / «COSP Bacar»). Meta lo revisa.
3. Verificá el número con el código SMS / voz.
4. Anotá el nuevo **Phone number ID** (cambia respecto al de test).

### 5.4 Registrar el número en Cloud API

Desde terminal (reemplazá valores):

```bash
curl -X POST "https://graph.facebook.com/v21.0/PHONE_NUMBER_ID/register" ^
  -H "Authorization: Bearer TOKEN_SYSTEM_USER" ^
  -H "Content-Type: application/json" ^
  -d "{\"messaging_product\":\"whatsapp\",\"pin\":\"123456\"}"
```

- `PHONE_NUMBER_ID`: el ID del número de producción.
- `TOKEN_SYSTEM_USER`: el del paso 4.
- `pin`: PIN de 6 dígitos de verificación en 2 pasos del número (si no tenía, ese valor lo crea).

**Criterio de done:** el registro responde OK y el número aparece como registrado para Cloud API.

### 5.5 Método de pago

1. Business Settings → **Pagos** / Payment methods.
2. Agregá tarjeta o medio válido.
3. Sin esto, los mensajes de plantilla / iniciados por negocio fallan o quedan limitados.

---

## Paso 6 — Webhook (recibir ubicaciones / mensajes)

1. App Dashboard → WhatsApp → **Configuration** (Configuración).
2. **Callback URL:**  
   `https://us-central1-comtroldata.cloudfunctions.net/whatsappCloudWebhook`
3. **Verify token:** `cosp-wa-cloud-verify`
4. Guardá / Verificá. Meta hace un GET; COSP debe responder el `hub.challenge` (ya implementado).
5. En **Webhook fields** / suscripciones, marcá al menos:
   - **messages**
6. Asociá el webhook al **WABA** correcto (si el dashboard lo pide).

**Criterio de done:** Meta muestra el webhook como verificado / activo.

**Prueba:** desde el celular, mandá una **ubicación** al número Business. En Firestore debería aparecer un doc en:

`wa_cloud_inbox/{empresaId}/messages/{messageId}`

(En COSP, con provider **Cloud** y Phone number ID bien indexado.)

---

## Paso 7 — Pegar credenciales en COSP

1. Abrí https://comtroldata.web.app → **Configuración** → **WhatsApp**.
2. Elegí la empresa (ej. `pruebas_sa` primero; **no** Bacar prod hasta el piloto).
3. Panel **Cloud API**:
   - **Phone number ID** → el de producción (o test si aún estás en sandbox).
   - **WABA ID**
   - **Número visible** (opcional, solo UI): +54 9 …
4. **Pegá el token** del system user → **Guardar token** / **Rotar token**.  
   Debe decir «Configurado» con máscara; el token no se vuelve a mostrar entero.
5. Nombres de **plantillas** (cuando las tengas aprobadas):  
   `presenteOk`, `fueraDeRadio`, `salidaOk`, `salidaAntesDeFin` — el nombre exacto en Meta (minúsculas/guiones bajos).
6. **Guardar configuración**.
7. Selector de proveedor: **Cloud API** (solo en la empresa piloto).
8. Opcional: **Enviar hello_world** a tu celular (requiere token + phone number ID + destinatario agregado en Meta si aún es test).

**Criterio de done:** Modo Rápido muestra «Cloud conectado» y una ubicación (real o **Simular ubicación**) genera pending.

---

## Paso 8 — Plantillas (mensajes que inicia la empresa)

Regla Meta:

- Si el **guardia escribió hace menos de 24 h**, podés responder texto libre (COSP ya usa `sendWhatsAppCloudText`).
- Si **ustedes escriben primero** o pasaron 24 h, hace falta una **plantilla aprobada**.

### 8.1 Crear plantillas

1. WhatsApp Manager → **Plantillas de mensaje** / Message templates.
2. Crear (idioma **Spanish** / `es` o `es_AR` según ofrezca Meta).
3. Propuestas alineadas a COSP:

| Uso en config COSP | Nombre sugerido en Meta | Ejemplo de cuerpo |
|--------------------|-------------------------|-------------------|
| presenteOk | `cosp_presente_ok` | {{1}}, registramos tu presente a las {{2}}. |
| fueraDeRadio | `cosp_fuera_radio` | {{1}}, estás a {{2}} m del puesto. Acercate y volvé a mandar ubicación. |
| salidaOk | `cosp_salida_ok` | {{1}}, salida registrada a las {{2}}. |
| salidaAntesDeFin | `cosp_salida_antes` | {{1}}, tu turno termina a las {{2}}. Avisá la salida después de esa hora. |

4. Categoría: en general **Utility** (utilidad), no Marketing.
5. Enviá a revisión y esperá aprobación (minutos a días).

### 8.2 En COSP

Cuando estén **Approved**, copiá el **nombre exacto** en Config → WhatsApp → Nombres de plantillas → Guardar.

> Nota: el envío automático por plantilla desde Modo Rápido se puede ir cableando después; hoy el camino crítico es **respuesta en ventana 24 h** + recepción de ubicación.

---

## Paso 9 — Piloto operativo

1. Empresa **pruebas_sa** (o similar), provider **Cloud**.
2. 2–3 guardias con el número Business guardado en el celular (chat 1:1, **no** el grupo del bridge).
3. Brief: «Para fichar, mandá **ubicación** al número X».
4. Ops: Modo Rápido con Cloud; Bridge sigue en Bacar.
5. Probar:
   - [ ] Ingreso con ubicación → pending / auto presente
   - [ ] Respuesta automática al guardia (si hay token)
   - [ ] Salida con ubicación tras el fin → aviso / cierre
6. Medir 3–5 días: errores Graph, demoras, ban del número (no debería con Cloud oficial).

---

## Paso 10 — Corte a Bacar (cuando el piloto esté OK)

1. Config Bacar → WhatsApp → cargar IDs + token (si es otro WABA/número, repetir).
2. Provider **Cloud**.
3. Comunicar a objetivos que migran: dejan de usar el **grupo** Baileys; pasan a chat con el número Business.
4. Apagar Baileys solo en esas cuentas cuando no queden grupos activos.
5. Dejar Bridge configurado pero **inactivo** por si hay rollback (selector → Bridge).

---

## Errores frecuentes

| Síntoma | Qué revisar |
|---------|-------------|
| Webhook no verifica | URL exacta, verify token `cosp-wa-cloud-verify`, function desplegada |
| Mensajes no llegan al inbox | Suscripción `messages`; Phone number ID indexado (Guardar config); provider Cloud |
| `hello_world` falla | Destinatario no agregado (sandbox); token inválido; phone number ID incorrecto |
| «Sin token» al enviar | Volver a Guardar token con system user |
| Número rechazado | Sigue en WhatsApp app; display name rechazado; verificación pendiente |
| 24 h / template | Están escribiendo primero sin plantilla aprobada |

---

## Seguridad (recordatorio)

- El token **nunca** va a git, ni a `AGENTE-BUZON`, ni a capturas de pantalla compartidas.
- En COSP solo se guarda vía callable; la UI muestra máscara.
- Rotá el token si alguien lo expuso: Config → Revocar → pegar uno nuevo.

---

## Referencias oficiales

- [Get started — Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Register phone number](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/)

---

## Resumen en una frase

**Meta:** app + WABA + número + token system user + webhook.  
**COSP:** pegar IDs/token en Config → WhatsApp, provider Cloud, piloto, después Bacar.
