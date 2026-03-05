# Qué alertas enviar a la plataforma

El agente filtra por tipo de evento: solo se envían los que estén en la whitelist de `event.types.include`.

---

## Eventos que soporta el NetSDK (Dahua)

| eventTypeName   | Código  | ¿Se envía? | Descripción                         |
|-----------------|---------|------------|-------------------------------------|
| **MOTION_EX**   | 0x2102  | **No**     | Detección de movimiento (genérica). Demasiado frecuente. |
| **VIDEOLOST_EX**| 0x2103  | **Sí**     | Pérdida de video / señal de cámara. |
| **SHELTER_EX**  | 0x2104  | **Sí**     | Cámara obstruida / tapada.          |
| **DISKFULL_EX** | 0x2106  | **No**     | Disco del NVR lleno.                |
| **DISKERROR_EX**| 0x2107  | **No**     | Error de disco en el NVR.            |
| **ALARM_EX**    | 0x2101  | **Sí**     | Alarmas genéricas / IVS: **humano**, **vehículo**, intrusiones, etc. |

---

## Configuración por defecto: qué se envía

- **Sí se envían:** **VIDEOLOST_EX**, **SHELTER_EX**, **ALARM_EX** (pérdida de señal, obstrucción, eventos smart como humano/vehículo).
- **No se envían:** **MOTION_EX**, **DISKFULL_EX**, **DISKERROR_EX**.

En muchos equipos Dahua la detección de **humano** o **vehículo** llega como **ALARM_EX**; el subtipo concreto puede estar en la configuración del NVR o en estructuras extendidas del SDK.

---

## Configuración en el agente: filtrar por tipo

En `config.properties` la whitelist por defecto es:

```properties
# Solo estos eventos se envían. El resto (MOTION_EX, DISKFULL_EX, DISKERROR_EX) se omite.
event.types.include=VIDEOLOST_EX,SHELTER_EX,ALARM_EX
```

- Si **no** ponés `event.types.include`, se envían **todos** los eventos que envíe el SDK.
- Con la línea de arriba solo se envían pérdida de video, obstrucción y alarmas (humano/vehículo). En consola verás `[PlatformSender] Evento omitido (no en lista): MOTION_EX ...` para los que no se envían.

---

## Keepalive / heartbeat

Para que la plataforma sepa que el agente (y en la práctica el NVR) sigue vivo, podés activar un **heartbeat** periódico:

```properties
# Enviar un POST de “estoy vivo” cada 300 segundos (5 min) al mismo webhook.
platform.heartbeat.interval.seconds=300
```

El body del heartbeat es algo como:

```json
{"source":"nvr-agent","type":"heartbeat","nvrId":"Bacar M102","nvrName":"...","timestamp":"2026-03-03T16:00:00.000Z"}
```

En **N8N** podés:
- Recibir alertas y heartbeats en el **mismo** webhook.
- Usar un nodo **IF** o **Filter**: si `body.type === "heartbeat"` → registrar/actualizar “última vez vivo”; si no → procesar como alarma y reenviar a CronoApp u otro destino.

Si el agente deja de enviar heartbeats (caída de red o proceso), la plataforma puede considerar el NVR/agente como “offline” después de un tiempo sin recibir ninguno.

---

## Resumen

| Objetivo                         | Configuración                                                                 |
|----------------------------------|-------------------------------------------------------------------------------|
| Solo VIDEOLOST, SHELTER, ALARM   | `event.types.include=VIDEOLOST_EX,SHELTER_EX,ALARM_EX` (valor por defecto).   |
| Enviar humano / vehículo (IVS)  | Incluir `ALARM_EX` (ya está); configurar el NVR con eventos smart/IVS.       |
| Saber si el agente está vivo    | `platform.heartbeat.interval.seconds=300` (o el intervalo que quieras).       |
