# Registro de NVR desde el agente (alta real + clave por NVR)

> **Guía paso a paso completa:** [PASO-A-PASO-CONEXION-Y-VIVO.md](PASO-A-PASO-CONEXION-Y-VIVO.md) — desde la conexión del agente a la plataforma hasta el video en vivo por túnel.

Este documento describe el flujo en el que **el agente, al instalarse y parametrizarse, da de alta el NVR en la plataforma**. Así la plataforma tiene un registro **real** del NVR (mismo ID que usa el agente), datos de conexión para "Ver en vivo" y una **clave de cifrado** (secret) exclusiva para ese agente.

---

## Problema actual

- Los canales/NVR en la plataforma no son "reales": se crean a mano en Cámaras NVR o al llegar la primera alerta, y el **nvrId** del agente (ej. "Bacar M102") puede no coincidir con el ID en la app (ej. serial "8F0001CPAZ21EFD").
- **Ver en vivo** no funciona porque el documento `nvr_devices/{nvrId}` no existe para el ID de la alerta o no tiene IP/puerto/usuario/contraseña.
- No hay vínculo explícito entre "agente instalado en sitio" y "NVR en la plataforma"; la conexión se asume manual.

---

## Objetivo

1. **Al instalar y parametrizar el agente**, el técnico solo configura el agente (NVR IP, usuario, contraseña, nombre, canales).
2. El agente **registra el NVR en la plataforma** en un único paso (onboarding). La plataforma:
   - Crea el NVR y los canales (alta real).
   - Guarda los datos de conexión para "Ver en vivo" (stream).
   - Genera una **clave (secret)** para ese NVR y se la devuelve al agente.
3. El agente guarda esa clave y la usa en todas las llamadas posteriores (alertas, heartbeats). La plataforma valida por **clave por NVR**, no solo una clave global.
4. "Ver en vivo" funciona porque el NVR en la app tiene el **mismo ID** que el agente y ya tiene IP/puerto/usuario/contraseña.

---

## Flujo propuesto

### 1. En la plataforma (una vez)

- El administrador genera un **token de registro** y lo guarda en Firestore:
  - Colección: (no hay colección; es un documento) **`nvr_config/registration`** (mismo estilo que `nvr_config/webhook`).
  - Campo: **`token`** (string). Valor: una cadena aleatoria larga (ej. 32 caracteres alfanuméricos). Solo quien tenga ese token puede llamar a **nvrOnboard** y dar de alta NVRs.
- Cómo crear el token: en la consola de Firebase → Firestore → crear documento con ID **registration** dentro de la colección **nvr_config** (si no existe **nvr_config**, crearla como colección y luego el doc **registration**). Campo `token` = el valor que elijas. O desde la app (futuro): Admin → Cámaras NVR → "Generar token de registro".

### 2. Instalación del agente

El técnico en sitio:

1. Instala el agente (Java) en una PC que tenga red al NVR.
2. Edita `config.properties`:
   - Conexión NVR: `nvr.ip`, `nvr.port`, `nvr.user`, `nvr.password`
   - Identidad: `nvr.id` (ej. serial del equipo o nombre único: "NVR-PORTERIA"), `nvr.name`
   - Canales: `channel.names` (opcional)
   - **Plataforma:** `platform.url` = URL base de la API (ej. `https://us-central1-PROYECTO.cloudfunctions.net`)
   - **Token de registro:** `platform.registration_token` = el token que le dio el admin (solo para el primer paso)
3. La primera vez que arranca el agente (o cuando se ejecuta un comando "registrar"), el agente llama al endpoint **nvrOnboard** (ver más abajo) con esos datos.
4. La plataforma:
   - Valida el token de registro.
   - Crea `nvr_devices/{nvr_id}` con: serial/nvr_id, nombre, **stream_ip**, **stream_port**, **stream_user**, **stream_password** (para vivo), channel_count, y un **agent_secret** generado (clave de cifrado).
   - Crea `camera_routes/{nvr_id}__1`, `...__2`, etc., con nombres de canal si los envió el agente.
   - Responde `{ "ok": true, "agent_secret": "..." }`.
5. El agente guarda `agent_secret` en un archivo local (ej. `agent_secret.txt` o en `config.properties` como `platform.key`) y lo usa en todas las llamadas a **nvrAgentEvents** (y heartbeats vía N8N, si aplica). A partir de ahí **no vuelve a usar** el token de registro para el día a día.

### 3. Uso diario

- El agente envía eventos y heartbeats con el header `Authorization: Bearer <agent_secret>` (o `X-API-Key: <agent_secret>`).
- La Cloud Function **nvrAgentEvents** acepta:
  - La clave global de webhook (como hasta ahora), **o**
  - La clave del NVR: si el body trae `nvrId`, se busca `nvr_devices/{nvrId}.agent_secret` y se valida que el header coincida con esa clave.
- Las alertas llegan con el mismo `nvrId` que está en la plataforma; "Ver en vivo" abre `nvr_devices/{nvrId}` y usa stream_ip, stream_port, etc.

### 4. Ver en vivo

- **Por túnel (agente en otra red):** Si configurás el **túnel saliente** (ver [TUNEL-VIVO.md](TUNEL-VIVO.md)), el agente abre una conexión saliente al servidor túnel y sirve el vivo por ahí. La app usa el túnel cuando el NVR tiene `stream_via_tunnel: true` o `agent_registered: true` y está definida la URL del túnel en la app.
- **Directo (misma red/VPN):** La página **Operaciones → Vivo** con `?nvrId=...&channel=...` lee `nvr_devices/{nvrId}`. Si el documento tiene **stream_ip**, etc., el reproductor puede conectar directo al NVR (cuando el navegador tiene acceso de red al NVR).

---

## API del onboarding

### POST `nvrOnboard`

**URL:** `https://us-central1-PROYECTO.cloudfunctions.net/nvrOnboard`

**Headers:**

- `Content-Type: application/json`
- `Authorization: Bearer <REGISTRATION_TOKEN>` o `X-Registration-Token: <REGISTRATION_TOKEN>`

**Body (JSON):**

| Campo            | Tipo   | Obligatorio | Descripción |
|------------------|--------|-------------|-------------|
| nvr_id           | string | Sí          | ID único del NVR (ej. serial o "NVR-PORTERIA"). Será el doc id en `nvr_devices`. |
| nvr_name         | string | No          | Nombre para mostrar. |
| nvr_ip           | string | Sí          | IP del NVR (para stream en vivo). |
| nvr_port         | number | No          | Puerto (default 80 para HTTP del reproductor). |
| nvr_user         | string | No          | Usuario para stream (default "admin"). |
| nvr_password     | string | No          | Contraseña para stream. |
| channel_count    | number | Sí          | Cantidad de canales (ej. 16). |
| channel_names    | string[] | No        | Nombres por canal, en orden (canal 1, 2, ...). |
| client_id        | string | No          | ID de cliente en la plataforma (si ya se conoce). |
| objective_id     | string | No          | ID de objetivo (si ya se conoce). |

**Respuesta 200:**

```json
{
  "ok": true,
  "nvr_id": "NVR-PORTERIA",
  "agent_secret": "generated-secret-string..."
}
```

El agente debe guardar `agent_secret` y usarlo como `platform.key` en todas las llamadas a la plataforma (nvrAgentEvents o webhook N8N que llame a nvrAgentEvents).

**Errores:**

- 401: Token de registro inválido o faltante.
- 400: Faltan campos obligatorios o nvr_id inválido.
- 409: Ya existe un NVR con ese nvr_id y ya fue registrado por un agente (opcional: permitir re-registro con el mismo token para actualizar stream_*).

---

## Seguridad

- **Token de registro:** de alta entropía, guardado en Firestore y mostrado solo una vez al admin. Quien instala el agente lo pone en config y lo usa una sola vez para el onboarding.
- **agent_secret:** generado por la plataforma, uno por NVR. El agente lo guarda en local y no se envía más el token de registro. Así cada NVR tiene su propia clave (cifrado/autenticación).
- **Datos de stream:** se guardan en Firestore (stream_ip, stream_port, stream_user, stream_password). Solo usuarios autenticados con permisos de admin pueden ver Cámaras NVR. Opcional: cifrar stream_password con una clave en Secret Manager.

---

## Cambios en el agente (Java)

- Añadir propiedad `platform.registration_token` (o `PLATFORM_REGISTRATION_TOKEN`).
- Al arrancar (o con un flag `--register`), si hay `registration_token` y no hay aún `platform.key` (agent_secret), llamar a **nvrOnboard** con los datos del Config (nvr_ip, nvr_port, nvr_user, nvr_password, nvr_id, nvr_name, channel_count, channel_names).
- Recibir `agent_secret` y guardarlo en `platform.key` (en memoria y, si se desea, persistir en `config.properties` o en un archivo `agent_secret.txt`).
- En todas las llamadas a la plataforma usar ese `platform.key` como Bearer / X-API-Key.

---

## Resumen

| Paso | Quién | Qué |
|------|--------|-----|
| 1 | Admin | Genera token de registro; opcionalmente asigna cliente/objetivo por defecto. |
| 2 | Técnico | Instala agente, configura NVR + platform.url + platform.registration_token. |
| 3 | Agente | Llama nvrOnboard → plataforma crea NVR + canales + stream, devuelve agent_secret. |
| 4 | Agente | Guarda agent_secret, lo usa en alertas/heartbeats. |
| 5 | Plataforma | nvrAgentEvents acepta clave global o agent_secret del NVR. |
| 6 | Usuario | "Ver en vivo" funciona porque nvr_devices tiene el mismo nvrId y datos de stream. |

Con esto, los canales de la NVR en la plataforma **son reales** (dados de alta por el agente al parametrizarse) y la conexión para vivo queda registrada en el mismo paso, con una clave de cifrado por NVR.

---

## ¿Cómo accedo a los canales en vivo si el agente está en otra red?

Hoy la página **Ver en vivo** hace que **tu navegador** se conecte **directo** al NVR (IP + puerto que están en `nvr_devices`). Eso solo funciona si el navegador puede llegar a esa IP: misma red que el NVR o VPN hacia esa red. Si el agente está en una PC en la red del cliente (ej. oficina del cliente) y la plataforma (o el operador) está en otra red o en internet, **el navegador no puede conectar directo al NVR** (IP privada, detrás de un router, sin acceso desde fuera). En ese caso hace falta que **el agente cree un canal de comunicación** y actúe como puente.

### Situación actual (sin canal)

- Navegador → intenta conectar a `stream_ip` del NVR → si esa IP no es alcanzable (red distinta), falla.
- El agente solo envía eventos/heartbeats a la plataforma; **no** expone el stream de video.

### Opciones para que el agente “cree el canal”

**1. Agente como proxy HTTP (agente expuesto)**

- El agente abre un **servidor HTTP/WebSocket** en la PC donde corre (ej. puerto 8080) que sirve el stream del NVR (el agente se conecta al NVR por LAN y reenvía el flujo).
- Para que la plataforma o el navegador lleguen al agente, la PC del agente tiene que ser alcanzable desde internet: **IP pública + port forwarding**, o **túnel inverso** (ngrok, Cloudflare Tunnel, Tailscale, etc.). La plataforma guardaría en `nvr_devices` una URL tipo `https://tunel-del-agente.ejemplo.com/live?channel=1` en lugar de (o además de) IP directa.
- **Ventaja:** un solo componente (agente) hace de puente. **Desventaja:** hay que exponer el agente (túnel o red) y mantenerlo.

**2. Agente abre túnel saliente hacia la plataforma (canal saliente)**

- El agente **no** abre puertos; abre una conexión **saliente** hacia la plataforma (WebSocket o similar a una Cloud Function / backend).
- La plataforma asigna un “canal” por NVR/agente. Cuando un usuario hace clic en “Ver en vivo”, la app se conecta al mismo backend; el backend **relaya** entre el navegador y la conexión que el agente ya tiene abierta. El agente, por esa conexión, envía el stream que obtiene del NVR (o el backend le pide “dame el canal 1” y el agente empuja el flujo).
- **Ventaja:** el agente está detrás de NAT/firewall; no hace falta abrir puertos en la red del cliente. **Desventaja:** hace falta un backend en la nube que relée (y opcionalmente transcodifique o cachee el stream).

**3. VPN hacia la red del cliente**

- Operador o plataforma se conecta a una **VPN** que los deja en la misma red que el NVR (o que el agente). Entonces el navegador sigue conectándose directo al NVR como hoy (usando `stream_ip`).
- **Ventaja:** no hay que cambiar agente ni backend. **Desventaja:** cada cliente/sede necesita VPN y el operador debe usarla para ver ese sitio.

**4. Servicio de retransmisión en la nube**

- El agente envía el stream (o snapshots periódicos) a un **servidor en la nube** (vuestro backend o un servicio). La app “Ver en vivo” se conecta a ese servidor, no al NVR. El agente sería el que “sube” el canal; la plataforma solo consume desde la nube.
- **Ventaja:** el navegador siempre habla con la nube. **Desventaja:** ancho de banda y costo de servidor/streaming.

### Resumen

| Pregunta | Respuesta |
|----------|-----------|
| ¿El agente crea hoy un canal para el vivo? | **No.** Hoy el agente no interviene en el stream; el vivo es navegador → NVR directo. |
| ¿Puedo ver en vivo si estoy en otra red? | Solo si hay VPN al sitio del NVR, o si se implementa que **el agente cree un canal** (proxy, túnel saliente o envío a la nube). |
| ¿Quién tendría que “crear el canal”? | El **agente** (como proxy o como cliente que abre túnel/stream hacia la plataforma) o un **servicio en la nube** que reciba el stream del agente y lo sirva al navegador. |

Para implementar “agente crea el canal”, los pasos típicos serían: (1) en el agente, módulo que obtenga el stream del NVR (SDK o HTTP al NVR) y lo exponga por WebSocket/HTTP o lo envíe por una conexión saliente a la plataforma; (2) en la plataforma, backend o Cloud Function que relée entre navegador y agente, o que sirva la URL del proxy/túnel del agente; (3) en la app, “Ver en vivo” usar esa URL o ese backend en lugar de conectar directo a la IP del NVR cuando el NVR esté en red remota.

---

## Implementación en el proyecto

- **Cloud Function `nvrOnboard`:** en `apps/functions/src/nvr/nvrOnboard.ts`. Expuesta como `https://us-central1-PROYECTO.cloudfunctions.net/nvrOnboard`. Requiere en Firestore el documento `nvr_config/registration` con campo `token`.
- **nvrAgentEvents:** acepta autenticación por clave global (`nvr_config/webhook` secret) **o** por clave del NVR (`nvr_devices/{nvrId}.agent_secret`). Así los agentes que se registraron con **nvrOnboard** usan su `agent_secret` en el header y no necesitan la clave global.
- **Agente Java:** falta implementar la llamada a **nvrOnboard** al arrancar (o con `--register`) y la persistencia del `agent_secret` devuelto. Mientras tanto, se puede probar el onboarding con `curl` (ver ejemplos en la sección API).
