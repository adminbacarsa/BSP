# PROMPT / CONTEXTO CANÓNICO — Planificación (COSP)

> **Uso:** Pegá este documento completo al inicio de un chat con Claude (o adjuntálo) cuando trabajes Planificación / malla / publicación / FT / Automatizar.
> **Proyecto:** COSP V1.0 / CronoApp — `C:\APP\cronoapp`.
> **Fuente:** `apps/web2/src/pages/admin/planificacion/index.tsx`, `lib/planificacion/*`, `dataRetention.ts`, `CLAUDE.md`.
> **Idioma:** español técnico.

---

## Instrucciones para el asistente

1. **Producción = `planificacion/index.tsx`** (no los hooks legacy `usePlanificacion.ts` / `usePlanificacionLogic.ts`).
2. **Publicado** ⇔ `planificacion_estados.publishedAt` truthy. Guardar ≠ publicar.
3. **Automatizar no publica:** deja `pendingChanges` → operador Guarda → Publica.
4. Distinguí **franco descanso** (`isFranco` F/FF/FP) vs **FT** (`isFrancoTrabajado` / `code:FT`).
5. Respetá retención: **hot** navega OK, **warm** aviso, **cold** bloqueado.
6. Soft-delete / no borrar estados: despublicar = quitar `publishedAt`, conservar puestos.
7. Si contradice este doc vs código, priorizá el código.

---

## 1. Resumen ejecutivo

La malla vive en `turnos`. El estado de publicación por objetivo/mes vive en `planificacion_estados`. Guardar sin publicar escribe `draft:true`; publicar setea `publishedAt` y barre `draft→false`. Ops solo ve planificados si el mes está publicado (salvo orígenes operativos). FT es franco convertido a trabajo (costo CCT), permiso `PLANNING.assign_ft`. Pipeline Automatizar: viabilidad → `generateScheduleV2/V4` → `verifyScheduleCoverage` → opcional `optimizePlanningGemini` → `pendingChanges`.

**Códigos CCT (planificación):** M/T/N/D12/N12 (trabajo), RET/REF/ESC (cobertura/formación), F/FF/FP (francos), FT (franco trabajado), V/L/E/A/AA/PG/SUS (ausencias/licencias en grilla).

---

## 2. Arquitectura

```
servicios_sla.positions (demanda)
        │
        ▼
Planificación UI ──pendingChanges──► turnos (draft?) ──Publicar──► draft:false
        │                              │
        │                              ├── Ops filter
        │                              ├── Reportes / Análisis / Liquidación
        │                              └── hours_balances (rebuild al guardar)
        ▼
planificacion_estados
  publishedAt? + defaultPositionByEmp + rotacionesDesactivadasMes
        │
        ▼
useOperacionesMonitor.publishStatusMap
  ├─ planificado + published → visible Ops
  └─ origin operativo → visible sin publish
```

**Automatizar:** `dotación+SLA → feasibility → generateScheduleV2 → coverageVerification → [Gemini] → pendingChanges → Guardar → [Publicar]`.

---

## 3. Grafo de flujos

```
[1 Editar malla] ──► [2 Guardar draft]
        │                    │
        │                    └──► [3 Publicar] ──► Ops ve planificados
        │                    └──► [4 Despublicar SA] ──► draft:true otra vez
        │
        ├──► [5 Corrección post-publish] (correct → draft:false inmediato)
        ├──► [6 Asignar FT] (assign_ft)
        ├──► [7 Navegar mes hot/warm/cold]
        └──► [8 Automatizar] ──► pending (no publica)

[9 FT desde Ops] ──► applyCoverage FT ──► marca isFrancoTrabajado
[10 Rebuild hours_balances] ◄── Guardar malla / Servicios / CRM
```

---

## 4. Zoom de flujos

### 1. Editar malla (borrador)
Celda → `pendingChanges` → Guardar → `turnos` con `draft: !isPublished` (salvo `correctionMode` → `draft:false`). Campos: `code`, `isFranco`, `isFrancoTrabajado`, `positionName`, `startTime`/`endTime`, `employeeId`, `objectiveId`.

### 2. Guardar
Batch a Firestore; puede disparar rebuild `hours_balances`. No setea `publishedAt`.

### 3. Publicar (`publish` / SA)
Gates: SLA plan≈vendido (SA override); avisos gaps.  
`setDoc(planificacion_estados)` merge `{publishedAt, publishedBy, objectiveId, year, month, empresaId}` → query turnos `draft==true` del mes → `draft:false` → `audit_logs: PUBLICACION_CRONOGRAMA`.

Doc id: `{empresaId}_{objectiveId}_{year}_{month}` (legacy sin tenant). Lookup UI: `${objectiveId}_${year}_${month}`.

### 4. Despublicar (solo SA)
Quita `publishedAt`/`publishedBy` (conserva `defaultPositionByEmp`). Turnos planificados del mes → `draft:true` (no toca operativos ni RFZ/TURA). Audit `DESPUBLICACION_CRONOGRAMA`.

### 5. Corrección post-publicación (`correct`)
`correctionMode`: edita con `draft:false` inmediato; RFZ draft puede disparar `needsRepublish`.

### 6. Asignar FT en Planificación (`assign_ft`)
`francoMode='FT_SELECTION'` → pending `isFrancoTrabajado:true`. Persistencia: `isFranco` + `isFrancoTrabajado` + código banda/FT. Gate: `francoTrabajadoAccess.ts`.

### 7. Navegar mes (retención)
`goToPlanningMonth` → `planningMonthAccess` (`dataRetention.ts`):  
- **Hot** = mes actual + 2 cerrados → OK  
- **Warm** = hasta 12 meses → aviso  
- **Cold** = bloqueado (toast error)

### 8. Automatizar (`auto_lab` / wizard)
Pipeline: feasibility (`checkFeasibility` / `resolveAutoPlanningBrain`) → `runPlanningGeneration` (router: `mixed_phased` | `six_plus_one` | `strict_six_two_floater` | `v4`) → `verifyScheduleCoverage` (+ `coverageFixer`) → opcional `optimizePlanningGemini` (ajuste fino, **no** regenera el mes) → `pendingChanges`. **No publica solo.**

Smoke: `npm run eval:planning-agent`. Skill: `.cursor/skills/cosp-planificacion-agent/`.  
VPLAN (`docs/VPLAN.md`, `vplanRun`) es experimental paralelo — no integra este wizard.

**Hallazgo código:** existe modal `showAutoV2Modal` («Automatizar cronograma») y `runFullGeneration`, pero en el árbol actual **no hay** `setShowAutoV2Modal(true)` — posible regresión del botón de apertura. Auto Lab (`/admin/planificacion/auto-lab` + permiso `auto_lab`) sigue siendo el sandbox de motores.

### 9. FT desde Ops
Cobertura tipo FT / `WorkedDayOffModal`: marca origen F como `isFrancoTrabajado` + `code:'FT'` y crea `ops_cov` vía `applyCoverage` (`coverageType:'FT'`).

### 10. Filtro Ops (qué ve el CC)
`useOperacionesMonitor`: descarta `draft===true`; si NO operativo exige `publishStatusMap` + SLA del mes.  
Operativo (visible sin publish): `origin ∈ {RETEN, OPERATIONS_COVERAGE, SLA_VIRTUAL, EVENTO}` o `CLIENT_REQUEST` no-RFZ/TURA, o `isReten`, o `resolvedBy==='OPERACIONES'`. RFZ/TURA `CLIENT_REQUEST` sí exigen publish. Francos descanso: F/FF/FP (no FT).

---

## 5. Colecciones

| Colección | Campos clave |
|-----------|--------------|
| `turnos` | `draft`, `code`, `isFranco`, `isFrancoTrabajado`, `origin`, `resolvedBy`, `objectiveId`, horarios, coverage meta |
| `planificacion_estados` | `publishedAt`, `publishedBy`, `defaultPositionByEmp`, `rotacionesDesactivadasMes`, year/month/empresaId |
| `servicios_sla` | Demanda puestos/bandas; contrato `closed` bloquea turnos |
| `hours_balances` | Extracto mensual; rebuild al guardar |
| `audit_logs` | PUBLICACION / DESPUBLICACION / CAMBIO_FRANCO_TURNO |
| `roles` | `PLANNING`: read/create/update/delete + `publish`, `correct`, `auto_lab`, `assign_ft` |

---

## 6. Archivos clave

| Área | Path |
|------|------|
| UI producción | `apps/web2/src/pages/admin/planificacion/index.tsx` |
| Permisos | `apps/web2/src/config/modules.ts` |
| FT gate | `apps/web2/src/lib/planificacion/francoTrabajadoAccess.ts` |
| Multiempresa / publish key | `apps/web2/src/lib/multiempresa.ts` |
| Retención | `apps/web2/src/lib/dataRetention.ts` |
| Motor auto | `lib/planificacion/autoScheduleEngineV2.ts` (+ V4) |
| Verify / Gemini | `coverageVerification.ts`, functions `optimizePlanningGemini` |
| Ops filter | `hooks/useOperacionesMonitor.ts` |
| Origen operativo | `packages/ops-core/src/operationalOrigin.ts` |
| VPLAN (experimental, paralelo) | `docs/VPLAN.md`, `apps/functions/src/vplan/` — **no** modifica wizard |

---

## 7. Impacto por módulo

| Módulo | Efecto |
|--------|--------|
| **Ops** | Solo planificados publicados + operativos; FT como cobertura |
| **RRHH / Liquidación** | FT computa horas extra; ausencias en grilla |
| **Análisis / Reportes** | Horas plan vs resultante; filtro published |
| **Servicios** | SLA demanda + gates publicación; `closed` bloquea |
| **Portal** | Turnos draft no operan como publicados |
| **CRM / hours_balances** | Extracto al guardar malla |

---

## 8. Reglas críticas

1. Publicado ⇔ `publishedAt` presente (doc puede existir solo con puestos sin publicar).
2. `draft:true` = invisible en Ops; visible en grilla Planificación.
3. Operativos siempre visibles en Ops sin publish (definición Ops más amplia que helper local de horas plan).
4. `isFranco` ≠ FT; FT es trabajo con costo.
5. Hot / warm / cold en navegación de meses.
6. Automatizar no publica.
7. Despublicar no borra el doc de estado ni asignaciones de puesto.
8. Multiempresa: escribir id con `empresaId_`; leer con fallback legacy.
9. Contrato SLA `closed:true` bloquea edición de turnos en Planificación.
10. Eventos/TURA en fila extras: prefactura, no cobertura SLA.

---

## 9. Checklist anti-regresión

- [ ] ¿Cambió `draft` / `publishedAt`? Verificar Ops + Portal + Reportes + Marcaciones.
- [ ] ¿Nuevo código CCT? Actualizar `SHIFT_HOURS_LOOKUP`, non-billable, leyenda, liquidación.
- [ ] ¿Automatizar? Mantener feasibility→generate→verify→optimize; Gemini no regenera mes; verificar apertura del modal.
- [ ] ¿Hooks legacy? No — extender `index.tsx` + `lib/planificacion/*`.
- [ ] ¿Meses? Respetar `planningMonthAccess` (cold bloqueado).
- [ ] ¿FT? Exigir `assign_ft`; no sumar FT como hs plan billable.
- [ ] ¿Cobertura Ops? No inventar cascada desde planificación — ver `PROMPT-COBERTURA-CC-FLUJOS.md`.

Publicación: lógica de **app** (cliente escribe `publishedAt` + sweep); no hay callable `publish`. Trigger `onCronogramaPublished` → FCM. Lookup UI/Ops: `{objectiveId}_{year}_{month}`; doc Firestore: `{empresaId}_…` (+ legacy).

---

## 10. Prompt corto

```
Leé docs/PROMPT-PLANIFICACION.md. Mapa canónico de Planificación COSP: malla, draft/publish, FT, retención hot/warm/cold, Automatizar V2, filtro Ops.

Tarea: [DESCRIBÍ AQUÍ]

Restricciones:
- Producción = planificacion/index.tsx.
- Guardar ≠ publicar; Automatizar no publica.
- Distinguir franco F vs FT.
- Cold bloquea navegación de mes.
```

---

*Grupo Bacar / COSP · Uso interno. Enriquecido con exploración [Map Planificacion module](b1a68360-b872-4b01-b1d1-4a8434ba7d4f).*
