# Registración vs Webhook: qué es cada uno y dónde se usa

Resumen corto para no liarse.

---

## 1. REGISTRACIÓN (una sola vez)

**Qué es:** El paso en el que “dás de alta” un NVR en la plataforma. Se hace **una vez** por NVR.

**Dónde está en Firebase:**  
`nvr_config` → documento **`registration`** → campo **`token`**  
(ej. `0024472243000905$`).

**Para qué sirve:**  
Solo para **llamar al endpoint de onboarding** (registro). Con ese token en el header, el backend crea el NVR en la base y te devuelve un **agent_secret**.

**Quién lo usa:**  
- Vos (o un script) cuando hacés el POST de registro del NVR.  
- En ese POST mandás header: `X-Registration-Token: <token de nvr_config/registration>` o `Authorization: Bearer <ese mismo token>`.

**Después del registro:**  
Ese token de “registration” **no se usa más** para enviar eventos. No va en el agente ni en N8N para las alertas.

---

## 2. WEBHOOK / ENVÍO DE EVENTOS (siempre)

**Qué es:** El endpoint al que se envían **cada evento** (alertas, heartbeats). Es el que recibe N8N cuando reenvía a CronoApp.

**URL:**  
- **Cloud Run:** `https://nvragentevents-2cmypxemla-uc.a.run.app`  
- **Cloud Functions:** `https://us-central1-comtroldata.cloudfunctions.net/nvrAgentEvents`  

Usá **solo una**: la que tengas desplegada y activa. Si no sabés cuál, probá primero la de Cloud Run.

**Dónde está en Firebase:**  
`nvr_config` → documento **`webhook`** → campo **`secret`**  
(ej. `123456`).

**Para qué sirve:**  
El backend acepta dos formas de autenticación para **este** endpoint:

1. **Secreto global:** el valor de `nvr_config/webhook` → **`secret`**.  
   Si en el request mandás ese valor (por ejemplo como `Authorization: Bearer 123456`), acepta.
2. **Secreto por NVR:** el valor de `nvr_devices/{nvrId}` → **`agent_secret`**.  
   Ese es el que te dieron al hacer el registro (ej. `RRrtHM69t3p-_lv9O3UXkQZvSBWvP51PJ0BxOQSnTe0`). Si en el request mandás ese valor (ej. `Authorization: Bearer RRrtHM69t3p-...`), acepta.

**Quién lo usa:**  
- **N8N**, en el nodo “Enviar evento a CronoApp (directo)”:  
  - URL = `https://nvragentevents-2cmypxemla-uc.a.run.app`  
  - Header = `Authorization: Bearer <un solo valor>`  
  - Ese valor tiene que ser **o bien** el `secret` de webhook **o bien** el `agent_secret` del NVR (el que copiaste en config como platform.key).
- **Agente:** no llama a esta URL; el agente llama a N8N. El `platform.key` del agente es el mismo `agent_secret` (para tener todo alineado), pero quien realmente usa “el token del webhook/eventos” contra CronoApp es N8N.

---

## Resumen en una tabla

| Concepto | Dónde en Firebase | Quién lo usa | Cuándo |
|--------|-------------------|-------------|--------|
| **Token de registración** | `nvr_config/registration` → `token` | Quien hace el POST de registro del NVR | Solo una vez al dar de alta el NVR. No va en el agente ni en N8N para eventos. |
| **Secreto del webhook (eventos)** | `nvr_config/webhook` → `secret` **o** `nvr_devices/{nvrId}` → `agent_secret` | N8N (nodo “Enviar evento a CronoApp (directo)”) | En cada request a la URL de nvrAgentEvents (Cloud Run). |

---

## Qué poner en cada lado (sin liarse)

1. **Agente – config.properties**  
   - `platform.url` = URL del **webhook de N8N** (ej. `https://autbacar.dnsalias.com/webhook/nvr-alertas`).  
   - `platform.key` = el **agent_secret** que te dieron al registrar el NVR (ej. `RRrtHM69t3p-_lv9O3UXkQZvSBWvP51PJ0BxOQSnTe0`). El agente usa esto para hablar con N8N si lo configuraste así; N8N no valida este valor contra Firebase.

2. **N8N – nodo “Enviar evento a CronoApp (directo)”**  
   - **URL** = la de los eventos en la nube, ej. `https://nvragentevents-2cmypxemla-uc.a.run.app`.  
   - **Authorization** = `Bearer <un solo secreto>`. Ese secreto debe ser **o** el `secret` de `nvr_config/webhook` **o** el `agent_secret` del NVR (el de `platform.key`). Mismo valor en los dos lados: el que esté guardado en Firebase para ese endpoint.

3. **Firebase**  
   - **Registro:** `nvr_config/registration` → `token` = solo para el POST de registro.  
   - **Eventos:** o usás un solo secreto global en `nvr_config/webhook` → `secret`, o cada NVR tiene su `agent_secret` en `nvr_devices/{nvrId}`. N8N tiene que mandar **exactamente** uno de esos dos.

Así: **registración** = token de `registration`, solo para dar de alta el NVR. **Webhook** = URL de eventos + Authorization con `secret` o `agent_secret`; eso es lo que usa N8N cada vez que envía un evento a CronoApp.
