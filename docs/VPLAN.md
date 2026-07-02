# VPLAN — Cerebro de planificación automática COSP

> **Versión:** 0.1 (etapa de prueba)  
> **Estado:** Experimental — **solo emulador local**. Sin deploy a producción hasta validación completa.  
> **Aislamiento:** Proceso **100 % paralelo** al planificador actual (V2/V4, `autoPlanningBrain`, wizard Automatizar). **No reemplaza ni modifica** flujos existentes hasta decisión explícita de producto.

---

## 1. Qué es VPLAN

**VPLAN** (Vision Plan) es el cerebro unificado de planificación automática para CronoApp. Objetivo: poder planificar **cualquier tipo de cronograma** — desde cero, continuando el mes anterior, completando un borrador, restaurando tras licencias o cambios de dotación, o migrando dinámicas de cobertura (ej. 6+2 → 4+2).

Principios:

| Principio | Descripción |
|-----------|-------------|
| **Pipeline por etapas** | Cada fase tiene entrada/salida tipada; no hay “un solo algoritmo mágico”. |
| **Determinismo primero** | Generación y cierre mecánico mandan; la IA solo propone **patches** al final. |
| **Paralelismo** | Código en `apps/functions/src/vplan/` y `apps/web2/src/lib/vplan/`. Sin imports desde planificador legacy salvo tipos/utilidades de lectura Firestore. |
| **Emulador primero** | Desarrollo y pruebas con `npm run emulators`; deploy de Functions **prohibido** hasta sign-off. |
| **No destructivo** | VPLAN produce **diff / propuesta**; la UI o un paso explícito aplica cambios. No publica ni borra turnos sin confirmación humana (salvo modo batch futuro con permisos). |

---

## 2. Relación con el sistema actual

```
┌─────────────────────────────────────────────────────────────┐
│  PRODUCCIÓN HOY (intocable por VPLAN en fase prueba)        │
│  · planificacion/index.tsx + wizard Automatizar             │
│  · autoPlanningBrain, autoScheduleEngine V2/V4              │
│  · coverageVerification, optimizePlanningGemini             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  VPLAN (paralelo, experimental)                             │
│  · Callable: vplanRun (Functions, emulador)                   │
│  · Cliente lab: apps/web2/src/lib/vplan/                    │
│  · Sin wire en UI principal hasta fase de integración        │
└─────────────────────────────────────────────────────────────┘
```

**No se debe:** importar VPLAN desde `planificacion/index.tsx`, alterar motores V2/V4, ni cambiar `optimizePlanningGemini` en esta fase.

**Sí se puede:** leer las mismas colecciones Firestore (SLA, turnos, empleados, ausencias) como **solo lectura** para armar contexto.

---

## 3. Modos de corrida (`PlanningRunMode`)

| Modo | Cuándo | Objetivo |
|------|--------|----------|
| `GREENFIELD` | Mes vacío / sin turnos planificados | Cronograma desde cero |
| `CONTINUE` | Mes anterior publicado existe | Respetar rachas, apertura de ciclo, bandas |
| `COMPLETE` | Grilla iniciada (borrador o parcial) | Rellenar huecos sin romper lo ya asignado |
| `RESTORE` | Cronograma roto (licencias, transferencias, cambio de objetivo) | Re-armar días afectados |
| `REPLAN_ABSENCES` | Novedades V/L/E sobre mes ya armado | Replanificar solo días/puestos impactados |
| `REBALANCE_HOURS` | Cobertura OK pero horas ≠ SLA vendidas | Ajustar asignaciones sin cambiar esquema |
| `MIGRATE_CYCLE` | Cambio de dinámica (6+2 ↔ 4+2, modo 8 ↔ 12) | Migrar con verificación de continuidad |

El orquestador elige sub-pipeline según modo + viabilidad.

---

## 4. Pipeline de procesamiento (10 fases)

### Fase 0 — Intake

**Entrada:** `objectiveId`, `year`, `month`, `empresaId`, `PlanningRunMode`, opciones (presupuesto CCT, ciclo preferido, etc.).

**Salida:** `PlanningBrainContext.run` — metadatos de la corrida, permisos, actor.

---

### Fase 1 — Modelo de demanda (contrato / SLA)

Traduce SLA → matemática operativa.

1. Puestos activos: `qty`, `coverageType`, bandas, `activeDays`, exclusiones.
2. Demanda por día: horas, bandas por puesto, pax-unidades a cerrar.
3. Horas vendidas vs demanda estructural del mes (`slaVendidas` vs `monthDemandHours`).
4. Catálogo de tipos de cobertura del objetivo:

| Tipo | Automático VPLAN | Notas |
|------|------------------|-------|
| Modo 8 — 6+2 normal | Sí | M+T+N |
| Modo 12 — ausencia V/L/E | Sí | D12+N12 en días afectados |
| Contingencia / apretar día | No (manual) | Libera RET |
| Franco trabajado (FT) | No | PIN / costo extra |
| Suplente directo | Semi | 1 guardia cubre banda titular |
| Ext + adel (split) | Semi | ½+½ = 1 pax en cobertura SLA |
| Transferencia otro objetivo | Restore | Reduce oferta local |

**Salida:** `DemandModel`.

---

### Fase 2 — Modelo de oferta (dotación)

1. Plantilla del objetivo (preferido, puesto, banda habitual).
2. Disponibilidad por empleado: ausencias, horas CCT consumidas (26→25), tope 200 h.
3. Estado previo (modos `CONTINUE` / `RESTORE`): snapshot mes anterior, **rachas** (trabajo/franco, banda, offset de ciclo), `prevMonthOpeningSlot`.
4. Oferta externa: RET, prestables desde otros objetivos.

**Salida:** `SupplyModel`.

---

### Fase 3 — Viabilidad

Antes de generar nada:

- Pico simultáneo vs dotación.
- Horas oferta vs horas vendidas.
- Cobertura concurrente por puesto.
- Ciclo (6+2, 4+2, 5+1…) vs plantilla requerida.

**Salida:** `FeasibilityReport` (`ok`, motivos, plantilla sugerida, ciclo recomendado).

Si `ok === false` → fin con diagnóstico (no Fase 5).

---

### Fase 4 — Estrategia

Decisiones (reglas puras, sin asignaciones aún):

- Ciclo de trabajo y esquema (modo 8 vs 12 por día).
- Bandas fijas vs rotativas.
- Prioridad continuidad vs reset de rachas.
- **Cuándo tratar ausencias:** pre-bloqueo (V/L/E conocidas antes de generar) vs post-parche (novedad sobre cronograma existente).
- Orden de cobertura ante huecos: sin turno → RET → ESC → ext 12h → split → FT (CCT 422/05).

**Salida:** `PlanningStrategy`.

---

### Fase 5 — Generación (motores determinísticos)

Sub-motores (plug-in, no monolito):

| Motor | Caso |
|-------|------|
| `FixedBandFloater` | 6+2 estricto, bandas fijas + flotante |
| `SixPlusOne` | 6+1, layout 6×puesto 24 hs |
| `DemandDriven` | Rotativo, objetivos complejos |
| `CustomDayScheduler` | Puestos L–V, horarios custom |
| `GapFiller` | `COMPLETE`, huecos puntuales |
| `CycleMigrator` | `MIGRATE_CYCLE` 6+2 ↔ 4+2 |

**Salida:** `ScheduleDraft` (asignaciones empleado × día × código × puesto).

---

### Fase 6 — Excepciones y coberturas

Sobre el borrador base:

1. Aplicar licencias/ausencias aprobadas; activar modo 12 si corresponde.
2. Cubrir huecos (según estrategia): suplente, ext+adel, RET.
3. Dejar explícito lo **no automático**: FT, contingencia, transferencias → `pendingHumanActions[]`.

**Salida:** `ScheduleDraft` + `CoveragePackage[]`.

---

### Fase 7 — Verificación multi-capa

| Verificador | Control |
|-------------|---------|
| `CoverageVerifier` | Puestos cerrados, bandas, esquema SLA |
| `HoursVerifier` | Facturable ≈ `slaVendidas` |
| `RestVerifier` | 12 h entre turnos |
| `CycleVerifier` | Rachas F, máx. 2 F seguidos, 48 h antes de bloque F |
| `CctVerifier` | 200 h ciclo, tramos 26→25 |
| `ContinuityVerifier` | Coherencia con mes anterior |
| `PolicyVerifier` | No F→turno silencioso; no FT sin autorización |

**Salida:** `VerificationReport` (bloqueantes / warnings / info).

---

### Fase 8 — Reparación determinística (fixer)

Cierre mecánico antes de IA: rebalanceo horas, swaps de banda, RET, `francoStreakGuard`.

**Salida:** `ScheduleDraft` mejorado + `FixerLog`.

---

### Fase 9 — Optimización IA (opcional)

Solo si persisten gaps. Reutiliza patrón `optimizePlanningGemini`: entrada acotada, salida = lista de `Correccion`. Re-ejecutar Fase 7 tras aplicar.

**Salida:** `OptimizationResult` + correcciones JSON.

---

### Fase 10 — Entrega

| Artefacto | Uso |
|-----------|-----|
| `ScheduleDiff` | Celdas a crear/actualizar en `turnos` (draft) |
| `PlanningRunReport` | Diagnóstico humano (viabilidad, gaps, warnings) |
| `audit_logs` | Trazabilidad (`action: VPLAN_RUN`) |
| `vplan_snapshots` (colección futura) | Comparar / rollback de corridas |

---

## 5. Contrato central (`PlanningBrainContext`)

Objeto que viaja entre fases (implementación: `apps/functions/src/vplan/vplan.types.ts`):

```typescript
PlanningBrainContext {
  run: PlanningRunRequest
  demand?: DemandModel           // Fase 1
  supply?: SupplyModel           // Fase 2
  feasibility?: FeasibilityReport
  strategy?: PlanningStrategy
  draft?: ScheduleDraft
  packages?: CoveragePackage[]
  verification?: VerificationReport
  fixerLog?: FixerLogEntry[]
  optimization?: OptimizationResult
  previousMonth?: ScheduleSnapshot
}
```

Cada etapa: **lee contexto → escribe su slice → no muta otras fases**.

---

## 6. Arquitectura Cloud Functions (objetivo)

| Componente | Ubicación | Rol |
|------------|-----------|-----|
| `vplanRun` | `apps/functions/src/vplan/vplan.handler.ts` | Callable HTTPS — orquestador |
| `vplan/phases/*` | Módulos por fase | Lógica pura testeable |
| `vplan/engines/*` | Sub-motores Fase 5 | Generadores plug-in |
| `vplan/verifiers/*` | Fase 7 | Verificadores independientes |
| Cliente lab | `apps/web2/src/lib/vplan/vplan.client.ts` | Invocación emulador + tipos |

**Fase prueba:** un solo callable `vplanRun` con `intent` por etapa (`feasibility` | `full` | `verify-only` …) para probar incrementalmente.

Configuración runtime prevista (cuando se despliegue): `timeoutSeconds: 300`, `memory: 1GiB`, secreto `GEMINI_API_KEY` solo para Fase 9.

---

## 7. Ausencias: ¿antes o después?

| Enfoque | Uso |
|---------|-----|
| **Antes de generar** | V/L/E ya aprobadas al planificar el mes → bloquean días en oferta; demanda en modo 12 |
| **Después (replan)** | Novedad sobre cronograma publicado → `REPLAN_ABSENCES` / `RESTORE` |
| **Híbrido** | Mes base sin V → publicar → pipeline incremental por novedad |

VPLAN debe soportar los tres vía `PlanningStrategy.absenceTiming`.

---

## 8. Ejemplo numérico de referencia (4 puestos)

| Puesto | Config | Horas/mes (30 d) |
|--------|--------|------------------|
| P1 | 2 pax 24 hs | 1.440 h |
| P2 | 1 pax 24 hs | 720 h |
| P3 | 1 pax 24 hs | 720 h |
| P4 | 1 pax L–V 9 h | ~198 h |
| **Total** | | **~3.078 h vendidas** |

Plantilla 6+2: **17 guardias** (16 en 24 hs + 1 en P4). Pico simultáneo día laboral: **5**.

---

## 9. Flujo de trabajo del equipo (fase prueba)

```
1. Desarrollo en apps/functions/src/vplan/ (+ tests unitarios por fase)
2. npm run emulators (Auth + Firestore + Functions)
3. Script o cliente lab: vplanRun({ mode, objectiveId, year, month })
4. Comparar salida con planificador manual (misma objetivo/mes) — sin escribir en UI prod
5. Commits frecuentes en main (o rama feature/vplan) — documentación + código aislado
6. Deploy Functions: SOLO cuando VPLAN pase checklist de sign-off (sección 10)
7. Deploy hosting / wire UI: fase posterior explícita
```

**Variables emulador:** mismas que el resto del lab (`GEMINI_API_KEY` en `apps/functions/.env` si se prueba Fase 9).

---

## 10. Checklist de sign-off (antes de deploy)

- [ ] Fase 1–3: demanda + oferta + viabilidad coinciden con SLA manual en ≥3 objetivos reales.
- [ ] Fase 5 `GREENFIELD`: genera grilla que cierra cobertura y horas ± tolerancia SLA.
- [ ] Fase 5 `CONTINUE`: respeta apertura de ciclo mes anterior en caso de prueba documentado.
- [ ] Fase 6–7: ext+adel y suplente cierran pax; verificadores sin falsos positivos masivos.
- [ ] Fase 7 `CctVerifier`: ningún empleado supera 200 h en ciclo de prueba.
- [ ] `RESTORE` / `REPLAN_ABSENCES`: caso licencia masiva documentado pasa.
- [ ] `MIGRATE_CYCLE`: caso 6+2 → 4+2 documentado pasa o rechaza con diagnóstico claro.
- [ ] Callable `vplanRun` corre en emulador < 120 s en objetivo mediano.
- [ ] **Cero regresión:** wizard Automatizar y planificación manual sin cambios de comportamiento.
- [ ] Aprobación explícita Mauro / IT Leader.

---

## 11. Roadmap de implementación sugerido

| Ola | Entregable |
|-----|------------|
| **Ola 0** (actual) | Documentación VPLAN, tipos, callable stub, cliente lab emulador |
| **Ola 1** | Fases 0–3 (intake, demanda, oferta, viabilidad) |
| **Ola 2** | Fase 5 `GREENFIELD` + motor 6+2 fijo |
| **Ola 3** | Fase 7 verificadores unificados |
| **Ola 4** | `CONTINUE` + snapshot mes anterior |
| **Ola 5** | Fases 6, 8 (`RESTORE`, coberturas) |
| **Ola 6** | `MIGRATE_CYCLE`, Fase 9 IA, UI lab opcional |
| **Ola 7** | Integración producto (fuera de alcance hasta sign-off) |

---

## 12. Referencias en el repo (legacy — solo lectura conceptual)

| Módulo actual | Idea reutilizable en VPLAN |
|---------------|----------------------------|
| `autoPlanningBrain.ts` | Staffing, modo 12, contingencia |
| `autoScheduleEngineV2/V4` | Lógica generación (copiar/adaptar en `vplan/engines`, no importar) |
| `objectiveCoverageDemand.ts` | Fase 1 demanda |
| `coverageVerification.ts` | Fase 7 |
| `vacancyCoverage.ts` | Fase 6 split |
| `planningAgentTypes.ts` | Intents previos (`feasibility`, `generate`, …) — superseded por VPLAN |
| `optimizePlanningGemini` | Fase 9 |

---

## 13. Glosario

| Término | Significado |
|---------|-------------|
| **Pax cerrado** | 1 unidad de esquema SLA completo en un puesto/día (ej. M+T+N o MM) |
| **Slot** | Celda banda × día (ej. 2×M en P1) |
| **Plantilla** | Guardias necesarios incluyendo francos del ciclo |
| **Racha** | Secuencia trabajo/franco/banda de un guardia |
| **Apertura de ciclo** | Último estado del mes anterior para continuar rotación |
| **Diff** | Propuesta de cambios vs estado actual, no apply automático en fase prueba |

---

*Documento mantenido por el equipo COSP. Actualizar este archivo en cada ola de VPLAN antes de ampliar alcance.*
