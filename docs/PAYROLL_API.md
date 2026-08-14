# API de Liquidación COSP — Manual del Integrador

> Documento de referencia para el sistema interno de liquidación de sueldos
> que va a consumir los datos de horas y novedades RRHH desde COSP.

---

## 1. Qué entrega esta API

Por cada **ciclo CCT 422/05** (del 26 al 25), un JSON con una fila por
empleado conteniendo:

- Horas teóricas y horas **reales** (fichada) trabajadas.
- Horas diurnas y nocturnas (corte 21:00–06:00).
- Horas al **100 %** (Franco Trabajado — FT).
- **Plus Feriado** (horas reales en fechas marcadas como feriado).
- **Liquidación 200 hs**: horas simples, al 50 %, y nota recordando que FT y
  feriados se pagan aparte.
- **Novedades RRHH** del ciclo: días de vacaciones, licencia, ART,
  enfermedad, permiso gremial e injustificada.
- `warnings[]` con turnos sin fichada y otros casos a revisar manualmente.

Es el mismo cálculo que muestra la pantalla **Reportes → Detalle de horas**
en el panel COSP.

---

## 2. Datos que recibe el integrador

Antes de empezar, el equipo COSP te entrega:

| Dato | Ejemplo |
|---|---|
| Base URL del entorno | `https://us-central1-comtroldata.cloudfunctions.net/payrollApi` |
| API Key | `csp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (se entrega una sola vez) |
| Scopes | `payroll.read`, `payroll.close` |

> **Guardá la clave en un manager de secretos.** En la base solo queda el
> hash; si se pierde hay que emitir una nueva.

Si tu servidor tiene IP fija, pediles que la restrinjan al rango/IP
correspondiente (`ipAllowlist`).

---

## 3. Autenticación

Todos los endpoints (menos `/health`) requieren el header:

```
X-API-Key: csp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Si la clave es inválida, está revocada o la IP no está autorizada, la API
responde **401** o **403** con un JSON del tipo:

```json
{ "error": { "code": "invalid_api_key", "message": "API Key inválida o revocada." } }
```

---

## 4. Concepto de ciclo (importante)

Liquidamos siempre por ciclo **CCT 422/05 SUVICO**: del **día 26** del mes
anterior al **día 25** del mes objetivo.

- `cycleId` = `YYYY-MM` del mes en que cae el corte (día 25).
- Ejemplos:
  - `2026-05` → 2026-04-26 al 2026-05-25
  - `2026-06` → 2026-05-26 al 2026-06-25

Cuando un ciclo se **cierra** con `POST .../close`, los turnos y ausencias
de ese período quedan marcados como `payrollLockedAt` y ya no se editan
desde el panel.

---

## 5. Endpoints

### 5.1 `GET /v1/payroll/health`

No requiere API Key. Para chequear que la URL responde.

```text
GET /v1/payroll/health
→ 200 { "status": "ok", "time": "2026-05-13T11:50:00.000Z" }
```

### 5.2 `GET /v1/payroll/cycles?count=12`

Lista los últimos N ciclos (default 12) y si cada uno está cerrado.

```bash
curl -H "X-API-Key: $KEY" \
  "$BASE/v1/payroll/cycles?count=6"
```

```json
{
  "cycles": [
    {
      "cycleId": "2026-05",
      "cycleStart": "2026-04-26",
      "cycleEnd": "2026-05-25",
      "cctVersion": "422/05",
      "lockedAt": null,
      "lockedBy": null
    },
    {
      "cycleId": "2026-04",
      "cycleStart": "2026-03-26",
      "cycleEnd": "2026-04-25",
      "cctVersion": "422/05",
      "lockedAt": "2026-04-26T14:02:00.000Z",
      "lockedBy": "integraciones_api/abc"
    }
  ]
}
```

### 5.3 `GET /v1/payroll/liquidacion`

**Endpoint principal.** Acumulado por empleado para el ciclo solicitado.

Query params:

| Param | Default | Descripción |
|---|---|---|
| `cycleId` | obligatorio | `YYYY-MM`. Ej. `2026-05`. |
| `clientId` | — | Filtra por cliente (opcional). |
| `page` | `1` | Paginación. |
| `pageSize` | `100` (máx 500) | Paginación. |

El modo de horas (**planificadas** o **fichadas**) lo define COSP en
**Liquidaciones → Modo horas · endpoint**. El integrador **no** puede
cambiarlo con un query param. `GET /cycles` incluye `hoursMode` para
saber qué está publicado.

Si no hay setting, el default es **planificadas**.

```bash
curl -H "X-API-Key: $KEY" \
  "$BASE/v1/payroll/liquidacion?cycleId=2026-05&pageSize=200"
```

Respuesta (resumida a 1 empleado):

```json
{
  "cycleId": "2026-05",
  "cycleStart": "2026-04-26",
  "cycleEnd": "2026-05-25",
  "cctVersion": "422/05",
  "hoursMode": "planned",
  "generatedAt": "2026-05-13T11:50:00.000Z",
  "lockedAt": null,
  "empresaId": "bacarsa",
  "items": [
    {
      "employee": {
        "id": "abc123",
        "dni": "30111222",
        "cuil": "20-30111222-3",
        "fileNumber": "L-0142",
        "fullName": "Kasianchuk, Gustavo Facundo",
        "laborAgreement": "SUVICO"
      },
      "acumulado": {
        "hsTeoricas": 192.0,
        "hsReales": 188.5,
        "diurnas": 144.0,
        "nocturnas": 44.5,
        "al50": 0.0,
        "al100FT": 12.0,
        "plusFeriado": 8.0
      },
      "liquidacion200": {
        "bolsa": 176.5,
        "hsSimples": 176.5,
        "al50": 0.0,
        "nota": "FT y Feriados se pagan aparte."
      },
      "pagaAparte": {
        "francoTrabajado100": 12.0,
        "plusFeriado": 8.0
      },
      "novedadesRRHH": {
        "vacacionesDias": 0,
        "enfermedadDias": 2,
        "art": 0,
        "licenciaEspecialDias": 0,
        "permisoGremialDias": 0,
        "injustificadaDias": 1
      },
      "turnosCount": 22,
      "turnosConFichada": 21,
      "warnings": [
        "Turno 7d8a (M 2026-05-04) sin fichada — no suma a Hs Reales."
      ]
    }
  ],
  "pagination": { "page": 1, "pageSize": 200, "total": 142 }
}
```

#### Significado de cada campo

| Campo | Significado |
|---|---|
| `acumulado.hsTeoricas` | Horas planificadas. Control vs `hsReales`. |
| `acumulado.hsReales` | Horas efectivamente trabajadas (fichada). **Es lo que se liquida.** |
| `acumulado.diurnas` / `nocturnas` | Sobre horas reales. Nocturnidad: 21:00–06:00. |
| `acumulado.al100FT` | Franco Trabajado. Va a `pagaAparte.francoTrabajado100`. |
| `acumulado.plusFeriado` | Horas reales en feriado. Paga aparte. |
| `liquidacion200.hsSimples` | `min(bolsa, 200)`. |
| `liquidacion200.al50` | `max(0, bolsa − 200)`. |
| `novedadesRRHH` | Días dentro del ciclo. |
| `warnings` | Inconsistencias a revisar manualmente. |

> **Fórmula clave:** `bolsa = hsReales − al100FT`. FT y feriado **no
> entran** a la bolsa de las 200 hs.

### 5.4 `POST /v1/payroll/liquidacion/:cycleId/close`

Cierra el ciclo. Requiere scope `payroll.close`. Después del cierre los
documentos del período quedan estampados con `payrollLockedAt`.

Recomendado mandar `Idempotency-Key` único por intento (si tu sistema
reintenta por timeout, no se duplica nada).

```bash
curl -X POST \
  -H "X-API-Key: $KEY" \
  -H "Idempotency-Key: 2026-05-cierre-01" \
  "$BASE/v1/payroll/liquidacion/2026-05/close"
```

```json
{
  "success": true,
  "snapshot": {
    "cycleId": "2026-05",
    "lockedAt": "2026-05-26T13:10:23.000Z",
    "items": [ /* mismo formato que el GET */ ]
  }
}
```

Si ya estaba cerrado:

```json
{
  "error": {
    "code": "cycle_already_locked",
    "message": "El ciclo 2026-05 ya fue cerrado.",
    "lockedAt": "2026-05-26T13:10:23.000Z",
    "lockedBy": "integraciones_api/abc"
  }
}
```

---

## 6. Códigos de respuesta

| Status | Cuándo | Acción sugerida |
|---|---|---|
| `200` | OK | — |
| `400 invalid_cycle` | `cycleId` mal formado | Usar `YYYY-MM`. |
| `401 missing_api_key` / `invalid_api_key` | Header ausente o clave inválida | Verificar header / pedir reemisión. |
| `403 ip_not_allowed` | Tu IP no está en allowlist | Avisar a COSP. |
| `403 missing_scope` | Scope insuficiente | Pedir scope. |
| `404 not_found` | Ruta inexistente | Revisar URL. |
| `409 cycle_already_locked` | Ya se cerró ese ciclo | Solo `GET` de ese ciclo. |
| `500 internal_error` | Bug del servidor | Reintentar; si persiste, contactar a COSP. |

Cuerpo de error estándar:

```json
{ "error": { "code": "missing_api_key", "message": "Falta header X-API-Key." } }
```

---

## 7. Flujo mensual recomendado

1. **Día 25 al mediodía** — `GET /cycles?count=3` para identificar el ciclo.
2. **Día 25 al cierre** — `GET /liquidacion?cycleId=2026-05`. Revisar
   `warnings` con operaciones (turnos sin fichada).
3. Operaciones corrige fichadas pendientes. Reintentar el GET hasta que los
   `warnings` estén controlados.
4. **Día 26** — `POST /liquidacion/2026-05/close` con `Idempotency-Key`.
   Guardar el `snapshot` devuelto como referencia oficial.
5. El sistema interno importa el snapshot y procesa la nómina.

---

## 8. Ejemplos por lenguaje

### Node.js (18+)

```javascript
const API = 'https://us-central1-comtroldata.cloudfunctions.net/payrollApi';
const KEY = process.env.COSP_API_KEY;

async function getLiquidacion(cycleId) {
  const r = await fetch(
    `${API}/v1/payroll/liquidacion?cycleId=${cycleId}&pageSize=500`,
    { headers: { 'X-API-Key': KEY } },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

async function closeCycle(cycleId) {
  const r = await fetch(
    `${API}/v1/payroll/liquidacion/${cycleId}/close`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KEY,
        'Idempotency-Key': `${cycleId}-${Date.now()}`,
      },
    },
  );
  return r.json();
}
```

### Python

```python
import os, requests

API = "https://us-central1-comtroldata.cloudfunctions.net/payrollApi"
KEY = os.environ["COSP_API_KEY"]


def get_liquidacion(cycle_id):
    r = requests.get(
        f"{API}/v1/payroll/liquidacion",
        params={"cycleId": cycle_id, "pageSize": 500},
        headers={"X-API-Key": KEY},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def close_cycle(cycle_id, idem_key):
    r = requests.post(
        f"{API}/v1/payroll/liquidacion/{cycle_id}/close",
        headers={"X-API-Key": KEY, "Idempotency-Key": idem_key},
        timeout=120,
    )
    return r.json()
```

### PowerShell (para diagnóstico rápido)

```powershell
$KEY = "csp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
$URL = "https://us-central1-comtroldata.cloudfunctions.net/payrollApi/v1/payroll/liquidacion?cycleId=2026-05"
Invoke-RestMethod -Uri $URL -Headers @{ "X-API-Key" = $KEY } | ConvertTo-Json -Depth 8
```

---

## 9. Buenas prácticas

- **No persistas la API Key en el repo.** Usar variables de entorno o un
  secret manager.
- **Llamá una vez por día como máximo** y cacheá la respuesta del GET hasta
  decidir cerrar el ciclo.
- **Idempotencia** en `POST close`: siempre mandar `Idempotency-Key`.
- **Conciliá `warnings`** antes de cerrar. Turnos sin fichada quedan fuera
  de `hsReales` y, una vez cerrado el ciclo, no se editan sin reabrirlo.
- **Verificá `pagination.total`**: si tu request superó `pageSize`, pedí
  más páginas. Para ≤200 empleados, directamente `pageSize=500`.

---

## 10. Troubleshooting

| Síntoma | Causa más probable |
|---|---|
| `401 missing_api_key` | Falta el header `X-API-Key`. |
| `401 invalid_api_key` | Clave mal copiada o revocada. |
| `403 ip_not_allowed` | Tu servidor cambió de IP. Mandar la nueva. |
| `hsReales` muy por debajo de `hsTeoricas` | Fichadas pendientes; revisar `warnings`. |
| `pagination.total` más bajo de lo esperado | Filtro `clientId` o empleados sin `empresaId` configurada en `empleados`. |
| Empleado no aparece en `items` | El empleado no tiene `empresaId` o no tiene turnos efectivos en el ciclo. |

---

## 11. Versionado

- Versionamos por path: `/v1/...`. Si el contrato cambia de manera
  incompatible, se sirve `/v2/...` y `/v1/` queda disponible durante al
  menos 90 días para migración.
- `cctVersion` en el cuerpo de la respuesta indica el convenio aplicado.
  Hoy: `"422/05"`.

---

## 12. Contacto

Equipo COSP: operaciones@comtroldata · Servicio: Bacar S.A. Seguridad Privada.
