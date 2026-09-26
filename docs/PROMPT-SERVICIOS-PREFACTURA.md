# PROMPT / CONTEXTO CANÓNICO — Servicios SLA & Prefactura (COSP)

> **Uso:** Pegá este documento completo al inicio de un chat (o adjuntálo) cuando trabajes Servicios, contratos SLA, cierre, prefactura CRM o `hours_balances`.
> **Proyecto:** COSP V1.0 / CronoApp — `C:\APP\cronoapp` (repo `adminbacarsa/BSP`).
> **Fuente:** código actual (`servicios_sla`, `contratoCierre.ts`, `servicios/index.tsx`, `proforma*`, `hoursBalance/*`) + `CLAUDE.md`.
> **Idioma de trabajo:** español técnico.

---

## Instrucciones para el asistente

Sos un ingeniero senior del sistema COSP. Este documento es la **fuente de verdad de Servicios / Prefactura**. Al responder:

1. Distinguí siempre **`closed` ≠ `inactive`** (contrato) y **puesto `INACTIVE`** (soft-delete de posición).
2. Puesto **`coverageType: eventos`** no vende SLA ni cierra cobertura; TURA/RFZ puntuales sí van a prefactura.
3. SLA “debe” del período = **`pickVigenteSlasForPeriod`** (un contrato por objetivo, mayor `startDate`).
4. Prefactura: modos `auto|planned|executed|sin_cobertura`; export solo vía `proformaExport.ts` + `ProformaExportBundle`.
5. Extracto mensual = colección **`hours_balances`** (doc `{empresaId}_{objectiveId}_{yyyy-mm}`); rebuild desde turnos, no inventar campos.
6. Si este prompt contradice el código, **priorizá el código** y señalá la divergencia.

---

## 1. Resumen ejecutivo

| Pieza | Rol |
|-------|-----|
| `servicios_sla` | Contrato comercial: fechas, `positions[]`, horas vendidas, rotaciones/reglas |
| Módulo Servicios | Alta/edición UI (`servicios/index.tsx`); catálogo abierto/cerrado |
| `contratoCierre.ts` | Cron + callables: al día siguiente de `endDate` → `closed: true` |
| CRM Prefactura | Grilla cliente/período → PDF/CSV/Excel (`proformaExport`) |
| `hours_balances` | Cuenta corriente mensual: SLA vs plan vs real vs resultante |
| TURA / RFZ | Refuerzos puntuales vendibles; Eventos = imputación diaria sin SLA |

**Orden comercial de horas:**

```
SLA vigente (debe)  →  plan / fichaje (haber)  →  + TURA·RFZ puntuales  →  prefactura
Puesto Eventos      →  0 hs SLA                →  solo extras TURA/RFZ al día del evento
```

---

## 2. Arquitectura y grafo

```
servicios_sla (positions, fechas, status, closed?)
        │
        ├─► slaHoursCalculator / pickVigenteSlasForPeriod ──► debe SLA
        │         │
        │         ├─► Planificación (malla, bloqueo si closed-only)
        │         ├─► Ops (isSlaOpenForOperations; continuidad puesto)
        │         └─► hours_balances.slaHours (+ patch al guardar SLA)
        │
        ├─► turnos (plan / ops_cov / RFZ·TURA / EV)
        │         │
        │         └─► buildHoursBalanceMonth / rebuild ──► hours_balances
        │
        └─► CRM Prefactura
                  ├─ turnos elegibles (proformaMode)
                  ├─ applyRefuerzoHorasVendidas* (TURA/RFZ puntuales)
                  ├─ sección eventos (code EV + colección eventos)
                  └─ exportProformaPdf|Csv|Excel

Cron 00:20 AR scheduledCerrarContratosVencidos
        └─ endDate < hoy AR && !closed && !reopenedManually && !cancelled
              → closed:true, closedReason:VENCIDO (status NO cambia)
```

---

## 3. Flujos (10)

### Flujo 1 — Alta / edición contrato en Servicios

- **UI:** `apps/web2/src/pages/admin/servicios/index.tsx` + `slaService`.
- **Datos:** `clientId/objectiveId`, `startDate`/`endDate`, `positions[]`, `excludedDates`, opc. rotaciones/reglas/`horarioVersiones`.
- **Al guardar:** `patchSlaHoursOnBalances` actualiza el **debe** de meses ±3 sin pisar haber ya rebuild-eado.
- **Edges:** contrato `closed` → solo lectura; SuperAdmin reabre/cierra con callables.

### Flujo 2 — Puestos y `coverageType`

| `coverageType` | Vende SLA | Cubre unidades | Notas |
|----------------|-----------|----------------|-------|
| `24hs` / `12hs_*` / `custom` | Sí (si activo) | Sí | Bandas M/T/N o D12/N12 |
| `encargado` | Opcional (`includeInSlaTotals`) | No (salvo política) | Soft-policy auxiliar |
| **`eventos`** | **No** (`includeInSlaTotals: false`) | **No** | Código puesto `EVT`; TURA imputada a prefactura |

- Soft-delete puesto: `status: INACTIVE` + `inactiveFrom` (no borra doc).
- Helpers: `eventosPosition.ts`, `auxiliaryPositionPolicy.ts`, `positionCoverageUnits.ts`.

### Flujo 3 — Cierre automático / manual (`contratoCierre.ts`)

- **Cron:** `scheduledCerrarContratosVencidos` — `20 0 * * *` America/Argentina.
- **Regla:** `endDate < hoy AR`, no `closed`, no `reopenedManually`, no cancelado → `closed:true`, `closedReason:'VENCIDO'`, `closedBy:'SYSTEM_SCHEDULER'`.
- **Callables:** `reabrirContratoSla` / `cerrarContratoSla` — **solo SuperAdmin**; reapertura exige motivo ≥5 chars y setea `reopenedManually:true` (cron no re-cierra hasta cierre manual).
- **Invariante:** `status` permanece activo para que históricos sigan sumando horas SLA.

### Flujo 4 — `pickVigenteSlasForPeriod`

```
filtrar isSlaContractActive(status)  →  agrupar por objetivo (clientId::objectiveId|nombre)
→ solapamiento con [rangeStart, rangeEnd]  →  quedarse el de mayor startDate
```

- **No** filtra por `closed` (el cerrado vencido aún aporta debe en meses que cubre).
- Ops/KPI “en operación”: usar `isSlaOpenForOperations` (= activo **y** `closed !== true`).
- Horas: `slaHoursForServiceInRange` / `sumVigenteSlaHoursInRange` (`slaObjectiveHours.ts`).
- Eventos/encargado sin totals → 0 en `slaHoursCalculator`.

### Flujo 5 — Prefactura CRM (armado del bundle)

- **UI:** CRM ficha cliente → solapa `PREFACTURA` (`crm/index.tsx` + `ProformaPanel.tsx`).
- **Pasos:** turnos del rango → filtro `turnoEligibleForProformaGrid` → grillas legajo + puesto → merge refuerzos puntuales → SLA vigente por objetivo → bloque `eventos` (turnos `code=EV`) → `ProformaExportBundle`.
- **Layout:** `employees` | `positions` | `both`.
- **Export:** `exportProformaPdf` / `Csv` / `Excel` (`proformaExport.ts`).

### Flujo 6 — Modos de facturación (detalle prefactura)

| Modo | Qué incluye |
|------|-------------|
| `auto` | Ejecutado si el cliente tiene contrato tipo `abierto`; si no, planificado |
| `planned` | Turnos planificables (reloj planificado) |
| `executed` | Solo con `realStartTime` + `realEndTime` |
| `sin_cobertura` | Solo turnos sin cobertura ops |

Archivo: `proformaMode.ts`. Vacantes / `isSinCobertura` fuera de planned/executed normales.

### Flujo 7 — TURA / RFZ → prefactura

- Solicitudes puntuales (`alcance` ≠ estructural / `!slaApplied`) en estados `APROBADA|ASIGNADA|COMPLETADA`.
- **TURA** (`AGREGADO_TURNO`): horas ×1; imputa al guardia padre o puesto Eventos (`legajo` EVT).
- **RFZ**: horas × `cantidadPax`; fila/puesto `RFZ · …`.
- Merge: `refuerzoProforma.ts` → grillas empleado y puesto; turnos ya facturados por `solicitudRefuerzoId` se excluyen del grid base (no doble conteo).
- Estructural / `slaApplied`: ya está en el SLA → **no** vende de nuevo.

### Flujo 8 — Eventos (dos caminos)

1. **Puesto SLA `eventos`:** contenedor comercial; 0 hs vendidas; Supervisión imputa TURA al puesto; prefactura muestra fila “Extras TURA” por día.
2. **Colección `eventos` + turnos `code: EV`:** bloque aparte en el PDF/UI (cupo/horario desde doc evento).

No confundir `EVT` (puesto) con `EV` (turno de evento operativo).

### Flujo 9 — `hours_balances` types / rebuild

**Tipo** (`hoursBalance/types.ts`): `slaHours`, `plannedHours`, `vacantHours`, `realHours`, `ft/ext/adel/ops/absenceHours`, `resultante` (= plan+ext+adel+ops), `saldoPlan`/`saldoReal`, `rebuiltFrom`.

| API | Cuándo |
|-----|--------|
| `buildHoursBalanceMonth` | Calcula filas (Demanda + fichadas + vigente SLA) |
| `rebuildHoursBalanceForObjectiveMonth` | Persist 1 objetivo+mes desde turnos |
| `persistHoursBalancesFromTurnos` | Bootstrap CRM / varios meses |
| `patchSlaHoursOnBalances` | Al guardar SLA: solo pisa `slaHours` (+ saldos) |

Doc id: `{empresaId}_{objectiveId}_{yyyy-mm}`. Análisis pinta Informes desde este extracto y luego overlay de malla.

### Flujo 10 — Impacto cruzado Plan / Ops / Análisis / CRM

| Módulo | Uso de SLA / prefactura |
|--------|-------------------------|
| **Planificación** | Puestos activos del vigente; `isDateInClosedSlaOnly` → sin editar turnos; Eventos/encargado fuera de unidades de cobertura |
| **Ops** | `isSlaOpenForOperations`; continuidad / `reemplazarRetiro2a3h`; badges TURA/RFZ; no usa prefactura |
| **Análisis** | Debe = `pickVigente` + extracto `hours_balances`; Demanda/Financiera alineadas a plan+ext/ops |
| **CRM** | Prefactura + stats comerciales + persist/rebuild balances al navegar períodos |

---

## 4. Reglas `closed` vs `inactive`

| Concepto | Campo | Efecto |
|----------|-------|--------|
| **Cerrado** | `closed: true` (+ `closedReason` VENCIDO\|MANUAL) | Bloquea edición Servicios y cambios de malla en días solo-cerrados. **`status` no cambia.** Históricos siguen en `pickVigente` / horas SLA. Filtro catálogo `closed_sla`. |
| **Inactivo / cancelado** | `status: inactive\|cancelled` (y variantes ES) | Fuera de vigente (`isSlaContractActive` = false). Cron de cierre lo ignora. No opera. |
| **Reabierto** | `reopenedManually: true` | Editable; cron **no** auto-cierra hasta `cerrarContratoSla`. |
| **Puesto INACTIVE** | `positions[i].status` | Soft-delete desde `inactiveFrom`; no exige cobertura ni horas. Distinto del contrato. |

```
Cerrado  = ciclo de vida vencido (auditoría + bloqueo edición)
Inactivo = contrato anulado / dado de baja comercial
```

---

## 5. Colecciones

| Colección | Uso en este dominio |
|-----------|---------------------|
| `servicios_sla` | Contratos; `positions`, `closed*`, `reopened*`, `closeHistory` |
| `hours_balances` | Extracto mensual por objetivo |
| `turnos` | Fuente haber + EV + RFZ/TURA operativos |
| `solicitudes_refuerzo` (o equivalente servicio) | TURA/RFZ vendibles |
| `eventos` | Metadatos cupo/horario para bloque EV |
| `clients` | Cliente + `objetivos[]`; contrato comercial `abierto` → auto=ejecutado |
| `planificacion_estados` | Publicación (contexto plan, no escribe prefactura) |
| `empresas` | Scope multiempresa / nombre export |

---

## 6. Archivos clave

| Área | Path |
|------|------|
| Cierre backend | `apps/functions/src/servicios/contratoCierre.ts` (+ export `index.ts`) |
| UI Servicios | `apps/web2/src/pages/admin/servicios/index.tsx` |
| Tipos SLA | `apps/web2/src/services/slaService.ts` |
| Eventos puesto | `apps/web2/src/lib/servicios/eventosPosition.ts` |
| Horas SLA | `apps/web2/src/lib/servicios/slaHoursCalculator.ts` |
| Vigente / closed planning | `apps/web2/src/lib/crm/slaObjectiveHours.ts`, `lib/slaPlanningMatch.ts` |
| Prefactura UI | `apps/web2/src/pages/admin/crm/index.tsx`, `components/crm/ProformaPanel.tsx` |
| Grid / modos | `lib/crm/proformaGrid.ts`, `proformaMode.ts`, `proformaTypes.ts` |
| Export | `lib/crm/proformaExport.ts` |
| Refuerzos → factura | `lib/refuerzo/refuerzoProforma.ts`, `refuerzoDisplay.ts` |
| Balances | `lib/hoursBalance/{types,buildHoursBalance,hoursBalanceStore,overlayLiveSla}.ts` |
| Catálogo Servicios | `lib/servicios/serviciosObjectiveCatalog.ts` |

---

## 7. Triggers / callables / crons

- **Cron:** `scheduledCerrarContratosVencidos` (00:20 AR).
- **Callables:** `reabrirContratoSla`, `cerrarContratoSla`.
- **Front (sin callable):** armado prefactura, `patchSlaHoursOnBalances`, `rebuildHoursBalanceForObjectiveMonth`, exports PDF/CSV/XLSX.

---

## 8. Anti-patrones (no hacer)

1. Tratar `closed` como soft-delete del contrato o poner `status: inactive` al vencer.
2. Sumar puesto `eventos` a horas vendidas SLA o a unidades de cobertura.
3. Cobrar de nuevo un refuerzo **estructural** / `slaApplied` en prefactura.
4. Duplicar horas: turno con `solicitudRefuerzoId` ya mergeado vía `refuerzoProforma`.
5. Inventar un segundo extracto paralelo a `hours_balances`.
6. Usar `pickVigente` donde se necesita “solo abiertos” sin pasar por `isSlaOpenForOperations`.
7. Reabrir contratos sin SuperAdmin / sin motivo auditado.

---

## 9. Checklist rápido antes de cambiar código

- [ ] ¿Toco `closed`/`status`/puesto `INACTIVE`? ¿Cuál de los tres?
- [ ] ¿Eventos = puesto SLA o turno `EV`?
- [ ] ¿El debe del mes sigue saliendo de `pickVigenteSlasForPeriod`?
- [ ] ¿Prefactura: modo + refuerzos puntuales + export bundle?
- [ ] ¿Hay que rebuild o solo `patchSlaHours` en `hours_balances`?
- [ ] ¿Impacto Plan (bloqueo closed) / Ops (open) / Análisis (extracto) / CRM (UI)?

---

**Fin del prompt canónico Servicios / Prefactura.** Mantener alineado con el código en el mismo PR cuando cambie el ciclo de cierre, Eventos o el motor de prefactura.
