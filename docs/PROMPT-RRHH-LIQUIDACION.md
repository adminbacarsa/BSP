# PROMPT / CONTEXTO CANÓNICO — RRHH + Liquidación (COSP)

> **Uso:** Pegá este documento completo al inicio de un chat cuando trabajes novedades RRHH, ausencias, correcciones o liquidación CCT.
> **Proyecto:** COSP V1.0 / CronoApp — `C:\APP\cronoapp` (repo `adminbacarsa/BSP`).
> **Fuente:** código actual (`apps/web2` RRHH/Reportes/Liquidaciones + `apps/functions` payroll-api / liquidacion) + `CLAUDE.md`.
> **Idioma:** español técnico.

---

## Instrucciones para el asistente

Sos un ingeniero senior COSP. Este documento es la **fuente de verdad de RRHH + liquidación**. Al responder:

1. Distinguí siempre **`ausencias`** (legajo RRHH) vs **`novedades`** (bitácora operativa CC/Ops).
2. El motor canónico de horas liquidadas es `calculateLiquidationHoursStats` / `buildLiquidacionSnapshot` (espejo API). No inventes otra fórmula de bolsa 200.
3. Ciclo CCT por defecto: **26 → 25**. `cycleId` = YYYY-MM del mes del corte (día 25). Anclar a **ART (−03:00)** en Functions.
4. `payroll_settings/{empresaId}.hoursMode` publica el modo del **endpoint**; el query `hoursMode` del consumidor externo se ignora.
5. Permiso **`adjust`** (solo módulo `RRHH`) gobierna correcciones masivas / bulk delete; SuperAdmin bypasea.
6. Si este prompt contradice el código, **priorizá el código** y señalá la divergencia.

---

## 1. Resumen ejecutivo

| Capa | Qué hace |
|------|----------|
| **RRHH** (`/admin/rrhh`) | Legajos, catálogo `tipos_novedad`, altas de `ausencias`, feriados, convenios, correcciones (`adjust`), dispositivos |
| **Reportes → Liquidación** (`/admin/reportes`) | Grilla CCT sobre rango (toggle `usePlannedHours`); export PDF/JSON; mismo motor de horas |
| **Liquidaciones** (`/admin/liquidaciones`) | Snapshot por `cycleId` vía callable; ajustes manuales; publica `hoursMode` al endpoint |
| **API payroll** (`payrollApi`) | HTTP `X-API-Key`: ciclos, liquidación acumulada, cierre inmutable |
| **Agregado live** | Al `isCompleted` de un turno → `liquidacion_mensual` + `liquidacion_turno_contrib` |

**Bolsa 200 (CCT 422/05):** bolsa = Hs trabajadas − FT 100% (FT y plus feriado se pagan aparte); Hs simples = min(bolsa, 200); Al 50% = max(0, bolsa − 200).

**Modos de horas:** `planned` = usa ventana planificada (sin exigir fichada); `real` = solo suma con fichada (clamp ±5 min); sin fichada → warning, no suma a Hs Reales.

---

## 2. Ciclo 26→25

```
cycleId "2026-05"  →  2026-04-26 00:00 ART  …  2026-05-25 23:59:59.999 ART
```

| Pieza | Ubicación | Notas |
|-------|-----------|-------|
| Backend canónico | `functions/src/payroll-api/cycle.ts` | `DEFAULT_CYCLE_START_DAY=26`, `END=25`; `parseCycleId`, `listRecentCycles` |
| Frontend RRHH | `rrhh/index.tsx` → `getCycleDates(ref, startDay=26)` | Por legajo: `empleados.cycleStartDay` (default 26) |
| Legajo | `EmployeeLegajoForm` / `employeeLegajoDefaults` | Editable 1–31; default producto **26** |
| Workload | `functions/.../workload.service.ts` | `getCycleDates` privado (mismo concepto) |

**Importante:** el panel Liquidaciones / API usan siempre 26→25 fijo. El `cycleStartDay` del legajo afecta stats del dashboard RRHH del empleado, no redefine el `cycleId` del endpoint.

---

## 3. Grafo de conexiones

```
[1 tipos_novedad] ──► labels/códigos al cargar [2 Alta ausencia RRHH]
                              │
[3 Portal EMPLEADO Pendiente] ┼──► autorización / verificación médica [4]
                              │
                              ▼
                    [5 Replicar a Planificación] ──► celdas V/L/E/… + opcional [novedades source:AUSENCIA]
                              │
[6 Ops markShiftAbsent] ──────┼──► ausencias Confirmada + AA + coberturaEstado
                              │
[7 Ajuste crono cobertura] ◄──┘ (alignAbsenceWithTitularShift / cobertura GESTIONADA)
                              │
[8 Correcciones adjust] ──────► audit_logs (AJUSTE_HORAS, …) ──► puede tocar turnos
                              │
                    turnos + ausencias + feriados
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
 [9 Reportes UI]    [10 Liquidaciones UI]    [11 API payroll]
  useReportes         getPayrollSnapshot      /v1/payroll/*
  calculate…          Internal + ajustes      hoursMode desde
                      payroll_settings         payroll_settings
          │                   │                   │
          └─────────── misma fórmula CCT ─────────┘
                              │
 [12 onTurnoWrite] ──► turnoHoursCalc ──► liquidacion_mensual (mes calendario)
```

---

## 4. Zoom de los 12 flujos

### Flujo 1 — Catálogo `tipos_novedad`

- Soft-delete: `status: ACTIVE | INACTIVE`. Seed `NOVEDAD_TYPE_SEEDS` (incluye MAVIC).
- Campos: `label`, `code` (V/E/A/L/PG/AA/LT/SGS/SUS), `defaultDays`, `requiresAuth`, `medicalVerification`, `isSystem`.
- UI: tab Tipos en RRHH (`TiposNovedadTab` + `novedadTypeService`).

**Archivos:** `lib/rrhh/novedadTypes.ts`, `novedadTypeCodes.ts`, `services/novedadTypeService.ts`

---

### Flujo 2 — Alta / edición novedad RRHH (`ausencias`)

- UI tab Novedades → modal; `handleSaveAbsence` → `absenceService.add/update`.
- Resuelve `absenceType` vía tipo configurado → `RRHH_ABSENCE_LABEL_TO_CODE` → `inferAbsenceCode`.
- Status: `Pendiente | En verificación | Autorizada | Justificada | Injustificada | Rechazada` (+ `Confirmada` desde Ops).
- Auditoría `CREATE_ABSENCE` / `UPDATE_ABSENCE`.

**Archivos:** `pages/admin/rrhh/index.tsx`, `services/absenceService.ts`, `lib/planificacion/absenceCodes.ts`

---

### Flujo 3 — Pedido desde portal (`source: EMPLEADO`)

- Empleado crea ausencia Pendiente; RRHH ve alertas; Supervisión también puede Autorizar/Rechazar.
- Bulk delete / acciones sensibles requieren `canAdjust` (`RRHH.adjust` o SuperAdmin).

---

### Flujo 4 — Verificación médica / certificado

- Si `medicalVerification` del tipo: flujo a `En verificación` con certificado (Storage / Drive).
- Callable/migración Drive: `functions/src/rrhh/migrateAbsenceCertificateToDrive.ts`.

---

### Flujo 5 — Replicación a Planificación

- Gate: `absenceReplicatesToPlanning` (Autorizada/Justificada/Injustificada/Confirmada/En verificación; LT **no** replica; Rechazada limpia réplicas).
- Al autorizar/justificar: además `novedades` con `source: 'AUSENCIA'`.
- Planificación pinta códigos licencia sobre la malla; no es el motor de liquidación.

---

### Flujo 6 — AA / ausencia operativa → RRHH

- `markShiftAbsent` escribe `ausencias` Confirmada + novedad `AUSENCIA_AUTO` + dispara cobertura.
- `coberturaEstado`: `PENDIENTE | VACANTE | GESTIONADA` (FULL cobertura → GESTIONADA).
- UI alinea con turno titular: `alignAbsenceWithTitularShift`.

**Archivos:** `attendance/markShiftAbsent.ts`, `lib/rrhh/absenceCoverageAlign.ts`, `lib/cosp/coverageSemantics.ts`

---

### Flujo 7 — Ajuste cobertura desde RRHH

- Modal `AjustarCronoCoberturaModal` / hooks de cobertura sobre ausencia con `shiftId`.
- No reimplementar `applyCoverage` aquí: usar escritor único de Ops.

---

### Flujo 8 — Correcciones (`adjust`)

- Tab Correcciones: tipos `AJUSTE_HORAS | CORRECCION_PRESENCIA | CORRECCION_CODIGO | RETENCION_FALTANTE | CORRECCION_PLANIFICACION`.
- Gate UI: `canAdjust`. Escribe auditoría; puede alterar turnos/códigos.
- **No confundir** con `ajustes_liquidacion` del panel Liquidaciones (otro doc, otro propósito).

**Archivo:** `components/admin/rrhh/CorreccionesTab.tsx`

---

### Flujo 9 — Reportes → pestaña Liquidación

- Hook `useReportes`: prepara turnos (`propagateFrancoTrabajadoFlags`, `dedupeShiftsByAbsencePriority`, `prepareShiftsForEmployeeLiquidation`, `collapseShiftsByEmployeeDayForLiquidation`) → `calculateLiquidationHoursStats`.
- Toggle UI `usePlannedHours` (sesión local; **no** escribe `payroll_settings`).
- Export PDF (`liquidacionReportPdf`) / JSON payroll.
- Análisis reutiliza el mismo motor vía `sumPlantelLiquidationHours`.

**Archivos:** `hooks/useReportes.ts`, `pages/admin/reportes/index.tsx`, `lib/analisis/analisisLiquidacionHours.ts`

---

### Flujo 10 — Panel `/admin/liquidaciones`

- Permiso módulo `API_KEYS` (o CONFIG). Callable `getPayrollSnapshotInternal` → `buildLiquidacionSnapshot`.
- Publica `payroll_settings/{empresaId}.hoursMode` (`planned`|`real`) + audit `PAYROLL_API_HOURS_MODE`.
- Ajustes por empleado: `ajustes_liquidacion/{empresaId}_{cycleId}_{employeeId}` (hs + días RRHH); audit `AJUSTE_LIQUIDACION`.
- Hook: `useLiquidaciones`.

**Archivos:** `pages/admin/liquidaciones/index.tsx`, `hooks/useLiquidaciones.ts`

---

### Flujo 11 — API HTTP liquidación

```
GET  /v1/payroll/cycles?count=12
GET  /v1/payroll/liquidacion?cycleId=YYYY-MM&clientId=&page=&pageSize=
POST /v1/payroll/liquidacion/:cycleId/close   # scope payroll.close
GET  /v1/payroll/health
```

- Auth: header `X-API-Key` → integración; scopes `payroll.read` / `payroll.close`.
- Cierre: `payroll_cycles_locks/{cycleId}` + `payrollLockedAt` en turnos/ausencias del ciclo.
- JSON = acumulado por empleado (sin detalle de turnos). AA = días, no descuenta horas.

**Archivos:** `functions/src/payroll-api/{handler,calc,cycle,settings,auth}.ts` · export `payrollApi` en `index.ts`

---

### Flujo 12 — Agregado al completar turno

- Trigger `onTurnoWrite` → `updateLiquidacionOnTurnoComplete` → `calcTurnoHoursContrib` (`turnoHoursCalc.ts`).
- Docs: `liquidacion_turno_contrib/{turnoId}` (idempotente) + `liquidacion_mensual/{empresaId_yyyy-mm}/empleados/{employeeId}`.
- Clave = **mes calendario del startTime**, no ciclo 26→25. Complementa; no reemplaza el snapshot de ciclo.

---

## 5. Impacto por módulo

| Módulo | Impacto |
|--------|---------|
| **RRHH** | Origen novedades/legajos; `adjust`; ciclo por empleado |
| **Planificación** | Réplicas de ausencias en malla; tope 200h ciclo CCT |
| **Operaciones** | Genera AA → `ausencias`; actualiza `coberturaEstado` |
| **Reportes** | UI liquidador + PDF; motor `calculateLiquidationHoursStats` |
| **Liquidaciones / API_KEYS** | Snapshot ciclo, ajustes, publicación `hoursMode`, API keys |
| **Análisis** | `sumPlantelLiquidationHours` = mismas hs liquidadas |
| **Portal** | Solicitud ausencias; fichadas alimentan modo `real` |
| **Functions** | payroll-api, markShiftAbsent, onTurnoWrite→liquidacion_* |

---

## 6. Colecciones Firestore

| Colección | Rol |
|-----------|-----|
| `tipos_novedad` | Catálogo parametrizable por empresa |
| `ausencias` | Novedades RRHH / AA Ops (`shiftId`, `coberturaEstado`, certificado) |
| `novedades` | Bitácora Ops + eco `source:AUSENCIA` desde RRHH |
| `empleados` | Legajo; `cycleStartDay`, `maxHours` (200), convenio |
| `turnos` | Input de horas; `payrollLockedAt` tras cierre |
| `feriados` | Plus feriado |
| `payroll_settings` | Doc id = `empresaId`; `hoursMode` |
| `ajustes_liquidacion` | Correcciones manuales por ciclo/empleado |
| `payroll_cycles_locks` | Snapshot inmutable al cerrar ciclo |
| `liquidacion_mensual` / `liquidacion_turno_contrib` | Agregado incremental al completar |
| `audit_logs` | CREATE_ABSENCE, AJUSTE_*, PAYROLL_API_HOURS_MODE |
| `integraciones_api` | API keys payroll (scopes) |

---

## 7. Archivos clave

| Área | Paths |
|------|-------|
| UI RRHH | `apps/web2/src/pages/admin/rrhh/index.tsx` |
| UI Liquidaciones | `apps/web2/src/pages/admin/liquidaciones/index.tsx` |
| UI Reportes | `apps/web2/src/pages/admin/reportes/index.tsx` |
| Hooks | `hooks/useLiquidaciones.ts`, `hooks/useReportes.ts` |
| Tipos / códigos | `lib/rrhh/novedadTypes.ts`, `lib/planificacion/absenceCodes.ts` |
| Análisis | `lib/analisis/analisisLiquidacionHours.ts` |
| Permisos | `config/modules.ts` (`RRHH` + `adjust`; `API_KEYS`; `REPORTS`) |
| Payroll API | `apps/functions/src/payroll-api/*` |
| Agregado | `apps/functions/src/liquidacion/{turnoHoursCalc,updateLiquidacionOnTurnoComplete}.ts` |
| Trigger | `apps/functions/src/notifications/onTurnoWrite.ts` |

---

## 8. Reglas críticas (checklist)

1. **`ausencias` ≠ `novedades`**: no mezclar escrituras ni semántica.
2. Motor único de hs liquidadas: `calculateLiquidationHoursStats` ↔ `buildLiquidacionSnapshot`.
3. Ciclo API/Liquidaciones = **26→25 ART**; `cycleId` = mes del día 25.
4. Endpoint ignora `hoursMode` del query: lee `payroll_settings`.
5. Sin fichada en modo `real` → 0 hs reales + warning (no inventar horas).
6. FT / plus feriado **fuera** de la bolsa 200 (pagan aparte al 100%).
7. AA cuenta días RRHH; **no** descuenta horas en el acumulado.
8. Cierre de ciclo es irreversible a nivel producto (`payroll_cycles_locks` + stamps).
9. Soft-delete tipos: `INACTIVE`; no borrar histórico de ausencias al reseedeár catálogo.
10. `adjust` solo en RRHH; ajustes de liquidación viven en `ajustes_liquidacion` (otro flujo).
11. LT no replica a planificación (el guardia trabajó).
12. Agregado `liquidacion_mensual` = mes calendario ≠ ciclo CCT.

---

## 9. Prompt corto de arranque

```
Leé docs/PROMPT-RRHH-LIQUIDACION.md. Es el mapa canónico de RRHH + liquidación COSP:
12 flujos, ciclo 26→25, ausencias vs novedades, motor de horas, payroll_settings,
API /v1/payroll y permiso adjust.

Tarea: [DESCRIBÍ AQUÍ]

Restricciones:
- No inventar segunda fórmula de bolsa 200.
- Respetar hoursMode publicado en payroll_settings para el endpoint.
- Distinguir ajustes_liquidacion vs CorreccionesTab (adjust).
- Antes de editar, nombrá flujos y colecciones que tocás.
```

---

*Documento generado para Mauro Martinez / Grupo Bacar — uso interno COSP.*
