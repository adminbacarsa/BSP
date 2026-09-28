# PROMPT / CONTEXTO CANÓNICO — Cobertura Centro de Comando (COSP)

> **Uso:** Pegá este documento completo al inicio de un chat con Claude (o adjuntálo) cuando trabajes cobertura en Ops/CC.
> **Proyecto:** COSP V1.0 / CronoApp — `C:\APP\cronoapp` (repo GitHub `adminbacarsa/BSP`).
> **Fuente:** código actual (`apps/functions/src/coverage/*`, `apps/web2` Ops) + `CLAUDE.md` § Protocolo de cobertura.
> **Idioma de trabajo:** español técnico.

---

## Instrucciones para el asistente

Sos un ingeniero senior del sistema COSP. Este documento es la **fuente de verdad de cobertura CC**. Al responder:

1. Respetá los **escritores únicos** (`applyCoverage`, `retainOutgoingForGap`). No inventes docs `ops_cov_*` ad hoc ni segunda cascada.
2. Distinguí siempre **Manual / Auto / Demo** (misma prioridad CCT; distinta orquestación).
3. Antes de proponer cambios, identificá **qué flujo(s)** tocás y **qué colecciones / módulos** impactás.
4. No reintroduzcas modales legacy de cobertura: UI vigente = `CoverageSessionManager` en lista + map-view.
5. Soft-delete: no `deleteDoc` de usuarios/clientes; REF/ESC convertidos usan soft-delete `CONVERTIDO_EN_COBERTURA`.
6. Si algo contradice este prompt vs código, **priorizá el código** y señalá la divergencia.

---

## 1. Resumen ejecutivo

Manual, Auto y Demo comparten el **mismo orden CCT**:

```
Retención en puesto → RET → REF → ESC → Ext+Adel (EXTEND + ADVANCE) → FT
```

| Modo | Gate | Retención al ausentar | Cascada automática | Quién cubre |
|------|------|----------------------|--------------------|-------------|
| **Manual** | ≥1 `sesiones_operador` ACTIVO no vencido (`isEmpresaManualMode`) | Sí | **No** | Operador CC (`CoverageSessionManager`) |
| **Auto** | Sin sala Manual | Sí | Sí (`createdBy: AUTO`) | Convocatorias reales + app portal |
| **Demo** | `empresas.modoDemoEnabled` | Sí | Sí (`MODO_DEMO`; **ignora** Manual) | Cron inventa AA + `simularRespuestasConvocatorias` |

**Kill switch:** `empresas/{id}.centroControlEnabled === false` → sin cascada/novedades de cobertura para esa empresa.

**UI:** `apps/web2/src/pages/admin/operaciones/index.tsx` + `map-view.tsx` montan `CoverageSessionManager` + `bootstrapCoverageSession`.

---

## 2. Arquitectura y escritores únicos

```
Ausencia (markShiftAbsent / T+30 / Manual / Demo / ETA / convocado)
        │
        ▼
onTurnoAbsenciaDetectada
        ├─ retainOutgoingForGap          ← escritor único retención por hueco
        └─ iniciarCascadaCobertura       ← solo si NO Manual (Demo sí)
                │
                ▼
        convocatorias_cobertura (PENDING → timeout 3 min → ESCALATED)
                │
        aceptar (portal / simulación / «Acepta» CC)
                │
                ▼
        resolverCobertura ──claim 2 min──► applyCoverage
                │                              │
                │                              ├─ turnos/ops_cov_{titular}_{employee}
                │                              │     origin: OPERATIONS_COVERAGE
                │                              ├─ source: coverageUsed / soft-delete / EXT-ADV
                │                              └─ FULL → releaseRetentionForAbsenceShift
                └─ rechazo/timeout → avanzar cascada / VACANTE_PARCIAL / escalarVacanteSinCobertura
```

### Invariantes de `applyCoverage`

| Regla | Detalle |
|-------|---------|
| ID estable | `ops_cov_{titularShiftId}_{employeeId}` |
| Origen intacto | RET → `coverageUsed`; REF/ESC → soft-delete `CONVERTIDO_EN_COBERTURA`; EXT/ADV → horas en source |
| EXT/ADV | `coverageHoursOnSource: true` — no fichables como titular; excluidos de ausencias/retención/listas Ops (`skipAbsencePipelineForShift`) |
| Dual Ext+Adel | 1ª pata `PARTIAL`, 2ª `FULL`; no cancela hermana; sin candidato → `VACANTE_PARCIAL` |
| Claim | `coverageClaimConvocatoriaId` + `coverageClaimAt` (2 min) en `resolverCobertura` |
| FULL | cierra vacantes, limpia claim, libera retención, RRHH `coberturaEstado: GESTIONADA` |

**Candidatos (P2):** una sola función, `buildCoverageCandidates` (`packages/ops-core/src/coverageCandidates.ts`, copia en `functions/src/coverage/coverageCandidates.ts`). La usan la cascada, `crearConvocatoriaCobertura`, la revalidación al aceptar y el CC. Descartan con `rejectReason` (el panel los muestra en «No disponibles»). Licencia = turno con código de licencia **o** doc en `ausencias` vigente ese día. EXT termina cuando empieza el hueco; ADV empieza cuando termina (±30 min). Mismo puesto antes que otro puesto del objetivo. Tope `COVERAGE_HARD_CAP_MS` (= `SHIFT_HARD_CAP_MS`). El ausente no entra. Zombi no entra. Sin dos coberturas solapadas ni dos huecos a la vez.

**Orden backend:** `COVERAGE_CASCADE_ORDER` (la reexporta `CASCADE_ORDER`) = `RET → REF → ESC → EXTEND → ADVANCE → FT`. Cambiar el orden es cambiar esa constante.  
**UI Manual STEPS:** INTERNO (RET·REF·ESC, 180s) → Ext+Adel (key `RETENCION`, 60s) → FT (180s)  
**Retiro anticipado Auto:** `RET → REF → ESC → ADVANCE → FT` (**sin EXTEND**)  
**Nota:** `SIN_TURNO` / `VOLANTE` existen en tipos/candidatos pero **no** en `CASCADE_ORDER` Auto actual (backlog).

---

## 3. Grafo de conexiones entre flujos

```
[13 Marcar Manual] ──┐
[7 Llegada tarde] ───┼──► [1 markShiftAbsent] ──► [trigger onTurnoAbsenciaDetectada]
[4 Demo AA] ─────────┤              │                      │
[11 Convocado no llegó]┘            │                      ├─► [6 Retención]
[9 Vacante iniciada/T-1h] ──────────┘                      └─► [3 Cascada Auto] (si !Manual o Demo)
                                                                    │
                         [2 Manual CC wizard] ◄── sala Manual ───────┤ (cascada OFF)
                                                                    │
                         [10 Convocatoria] ◄─────────────────────────┘
                                    │
                         aceptar ───┼──► [5 applyCoverage PARTIAL|FULL]
                         rechazo/timeout ──► avanzar / [12 Escalado]
                                    │
                         FULL ──► release retención [6] + RRHH GESTIONADA
                         PARTIAL dual ──► ensureMissingDualLeg / VACANTE_PARCIAL

[8 Retiro anticipado] ──► vacante INTERRUPTION ──► earlyWithdrawCascade (Auto) o CC Manual
[9 gestionarVacantes] ──► protocolo + cascada Auto; pases SLA gaps → retención [6]
[13 Revertir] ──► limpia AA + cancela conv + release retención + opcional supersede ops_cov
```

---

## 4. Zoom de los 13 flujos

### Flujo 1 — Ausencia → `markShiftAbsent` → `onTurnoAbsenciaDetectada`

- **Trigger:** `turnos.isAbsent` false→true. Callables/schedulers: `detectarAusencias` (AUTO_T30 / ETA_VENCIDA), `marcarAusenciaOperaciones` (MANUAL_OPS), LLEGADA_TARDE rechazada/timeout, `runConvocadoAbsentPass`, ETA>60 (`AVISO_MAYOR_60`), Demo (write inline).
- **Condiciones:** CC on; objetivo en scope (`CcObjectiveMonthGate`); no draft/virtual/trace EXT-ADV. Manual → retención sí, cascada no. Auto/Demo → retención + cascada. Demo bypasea Manual.
- **Pasos:** (1) turno ABSENT + AA; (2) idempotencia; (3) `ausencias` Confirmada; (4) novedad `AUSENCIA_AUTO`; (5) `retainOutgoingForGap`; (6) `iniciarCascadaCobertura` si aplica.
- **Edges:** Presente solo se ausenta con `MANUAL_OPS`. CC off / fuera scope → return.

**Archivos:** `attendance/markShiftAbsent.ts`, `index.ts` (trigger), `ops/opsManualMode.ts`, `coverage/coverageRetention.ts`

---

### Flujo 2 — Protocolo Manual CC (`CoverageSessionManager`)

- **Trigger:** `openCoverageProtocol(shift)` → session + `bootstrapCoverageSession` (solo lectura retención).
- **Pasos UI:** INTERNO → Ext+Adel dual → FT. Geo 15/30 km.
- **Pasos datos:** convocatoria callable `crearConvocatoriaCobertura` o confirmación front `applyCoverage` (`resolvedBy: OPERACIONES`) + `syncAusenciaCoberturaGestionada`. Dual: EXTEND PARTIAL + ADVANCE FULL.
- **Edges:** No escribe retención. Backlog: cancelar conv al cerrar UI. Idempotencia si ya cubierto.

**Archivos:** `components/operaciones/CoverageSessionManager.tsx`, `lib/operaciones/opsConvocatoriaCobertura.ts`, espejo `syncAusenciaCobertura.ts`, `operaciones/index.tsx`, `map-view.tsx`

---

### Flujo 3 — Cascada Auto

- **Trigger:** trigger ausencia Auto/Demo; `gestionarVacantes`; `runConvocadoAbsentPass`; rechazo/timeout.
- **Condiciones:** !Manual (salvo Demo); titular no covered; sin PENDING/ESCALATED; timeout paso **3 min** (`checkConvocatoriaTimeouts` cada 1 min).
- **Pasos:** `findBestCandidate` → `crearConvocatoriaDoc` PENDING → timeout ESCALATED + avanzar → aceptación `resolverCobertura` → `applyCoverage`. Sin candidatos → Flujo 12. Dual PARTIAL + fallo pata → `VACANTE_PARCIAL`.
- **Edges:** Claim 2 min. EXTEND/ADVANCE PARTIAL conserva hermana; FULL cancela resto.

**Archivos:** `coverage/convocatoriasCobertura.ts`, `coverage/eligibilityFilter.ts`

---

### Flujo 4 — Demo

- **Trigger:** cron 5 min `modoDemoCron` → empresas `modoDemoEnabled`.
- **Pasos:** presencias ficticias ops_cov; AA inline (`absenceDetectedBy: MODO_DEMO`); trigger real retención+cascada; `simularRespuestasConvocatorias` (~80% accept / 20% reject, antigüedad ≥90s).
- **Edges:** No usa `markShiftAbsent`. Skip `detectarAusencias`/llegada tarde. Skip `runConvocadoAbsentPass`.
- **Turno simulable (filtro único):** todo escritor de presencia ficticia pasa por `isSimulableShift` / `simulableShiftSkipReason` (`common/simulableShift.ts`). Quedan afuera licencias/ausencias por código (`V`, `L`, `E`, `A`, `ART`, `AA`, `PG`, `SGS`, `SUS`), francos (`F`, `FF`, `FP` / `isFranco`), `draft`, `isVirtual` y los registros `ops_cov` de horas en origen (`isOpsCoverageHoursOnSourceDoc`). La simulación **nunca** inventa `realStartTime` sobre un turno no simulable. Lo usan `runModoDemoForEmpresa`, `simularRespuestasConvocatorias`, `autoPresenciaYCierre` (`index.ts`) y la simulación del asistente (`assistantDataTools.ts`). Caso real que motivó el filtro: Cejas Mario en H. Oncológico, licencia `V` marcada presente 25→28/09 (snapshot `h-oncologico-2026-09-27`, casos P1b.1–P1b.4).

**Archivos:** `common/simulableShift.ts`, `index.ts` (`runModoDemoForEmpresa`, `autoPresenciaYCierre`), `simularRespuestasConvocatorias`, `assistant/assistantDataTools.ts`

---

### Flujo 5 — `applyCoverage` PARTIAL vs FULL

- **Trigger:** `resolverCobertura` o front Manual `confirmCandidate` / `confirmDualTogether`.
- **PARTIAL:** `coverageStatus: PARTIAL`, `operacionallyCovered: false`; no cancela las demás convocatorias (FT incluidas). Auto llama `ensureMissingDualLegConvocatoria`.
- **FULL:** COVERED; limpia `isSinCobertura`/`vacanteEscalada`; cierra `VACANTE_POR_AUSENCIA`; `releaseRetentionForAbsenceShift`; `ausencias.coberturaEstado: GESTIONADA`.
- **Origen source:** RET `coverageUsed`; REF/ESC soft-delete; EXTEND `isExtended`; ADVANCE `isEarlyStart`; EXT/ADV `coverageHoursOnSource: true`.
- **Edges:** Titular ausencia real mantiene `isAbsent`/`ABSENT`. `ALREADY_COVERED` cancela conv.

**Archivos:** `functions` + `web2` `syncAusenciaCobertura.ts`, `coverageExtAdvSegments.ts`

---

### Flujo 6 — Retención

- **Escritor:** `retainOutgoingForGap` (backend). Front solo lee/pick.
- **Entrada:** trigger ausencia; `escalarVacanteSinCobertura(attemptRetention)`; `autoCompletarTurnosCore`; `slaUnplannedGapPass`.
- **Match:** saliente presente alineado **±30 min** al `startTime` del hueco.
- **Liberación:** `releaseRetentionForAbsenceShift` en FULL y `revertirAusencia`.
- **Tope 12:59:** `SHIFT_HARD_CAP_MS` en `scheduling/shiftClose.ts` (= `RETENTION_MAX_TOTAL_MS`), contado desde el inicio real (`realStartTime`/`checkInTime`; si no fichó, `startTime`), **aun con continuidad**. Al tope el server cierra COMPLETED `TOPE_JORNADA` con `realEndTime` = inicio + 12:59, novedad `tope_{shiftId}` (`TOPE_JORNADA`) y, si el hueco no está cubierto, `escalarVacanteSinCobertura(attemptRetention:false)` → el puesto pasa a vacante. Push al guardia «Fin de jornada por tope». Continuidad SLA: `positionHasContinuity` (±30 min AR sobre todos los `servicios_sla` activos del objetivo; vale el vigente).
- **Retención hasta relevo:** puesto 24 h / custom con continuidad retiene hasta que ficha el relevo (dentro del tope). Relevo presente → cierre `RELEVO_PRESENTE` en su fichada (o en el fin planificado si llegó antes). Hueco ya cubierto con cubridor en camino → `ESPERA_CUBRIDOR` (retención silenciosa, sin re-notificar).
- **Backlog:** liberar FIFO al fichar entrante; no sacar compañero de activos en edge UI.

**Archivos:** `coverageRetention.ts`, `autoCompletarTurnosCore.ts`, `shiftClose.ts`, `positionHasContinuity.ts`, `relevoOutgoingMatch.ts`

### Flujo 6b — Cierre de turnos (un solo responsable)

- **Cierres automáticos: solo el server** (`autoCompletarTurnosCore`, cron `autoCompletarTurnos`, y `registrarPresencia` al fichar el relevo). Todos pasan por `buildAutoClosePatch`: `realEndTime` siempre presente y acotado al tope; si estaba retenido, `retentionMinutes` + `retentionEndedAt` (Liquidación computa la salida real). `isRetention` se conserva en el completado; `retainOutgoingForGap` / `releaseRetentionForAbsenceShift` ignoran completados.
- **Motivos:** `RELEVO_PROGRAMADO`, `RELEVO_PRESENTE`, `SIN_CONTINUIDAD_SLA`, `MANUAL_EXTENSION_ELAPSED`, `TOPE_JORNADA`, `TOPE_JORNADA_RETROACTIVO` (pasó el tope hace > 2 h: cron caído / turno viejo abierto → retenido cierra en inicio + 12:59, resto en fin planificado, `requiereRevision: true`).
- **CC apagado (`centroControlEnabled=false`):** el cron corre igual en modo silencioso. Solo `RELEVO_PROGRAMADO`, `RELEVO_PRESENTE`, `SIN_CONTINUIDAD_SLA` (fin planificado), `TOPE_JORNADA` y `TOPE_JORNADA_RETROACTIVO`. Sin retención (`retainOutgoingForGap` / `isRetention`), sin novedades, sin `escalarVacanteSinCobertura`, sin push. Con continuidad y sin relevo queda abierto hasta el tope (acción `WAIT CC_OFF_ESPERA_TOPE`). E2E 41–43.
- **Licencia presente:** un turno con código de licencia (`isLicenseShiftCode`) **nunca** se cierra por tope. Si quedó `PRESENT` (simulación vieja, carga manual) el cron lo deja abierto para que RRHH lo corrija: acción `WAIT` / `LICENCIA_PRESENTE`, sin `realEndTime`, sin novedad `TOPE_JORNADA` ni vacante escalada. E2E 46, casos reales P1b.3–P1b.4.
- **Navegador:** no cierra solo. `useAutoMonitor` solo avisa «Turno vencido sin cierre» (presente, no retenido, > 2 h del fin). `useOperacionesMonitor` ya no tiene `AUTO_COVERAGE_COMPLETE` / `AUTO_OVERTIME_LIMIT`. **Salida manual y relevo manual del operador siguen en el CC**, siempre con `realEndTime`.
- **Pestaña vieja:** `firestore.rules` rechaza desde cliente cualquier `create`/`update` de `turnos` que deje `completionReason` o `autoCloseReason` en un motivo de cierre retirado por P1 (`AUTO_SHIFT_END`, `AUTO_SHIFT_END_CUSTOM`, `AUTO_ZOMBIE_SHIFT_END`, `AUTO_ZOMBIE_12H`, `AUTO_COVERAGE_COMPLETE`, `AUTO_OVERTIME_LIMIT`, `AUTO_MANUAL_RETENTION_END`, `AUTO_END_CF_RETENTION_TIMEOUT`). El Admin SDK (crons, callables) no pasa por reglas. Docs históricos con esos motivos se siguen pudiendo editar mientras el campo no cambie. Test: `npm run eval:turnos-close-reason-rules` (17 escrituras, compara `origin/main` vs working tree en el proyecto aislado `demo-p1b-rules`).
- **Panel desactualizado:** cuando hay build nueva publicada (`public/version.json` vs `NEXT_PUBLIC_BUILD_HASH`), la pestaña vieja **pausa todas sus escrituras automáticas** (`useAutoMonitor`, el efecto de auto-acciones de `useOperacionesMonitor`, el auto-alta de sesión de operador) y recarga sola a los 5 s. Si hay protocolo de cobertura, modal, formulario o texto sin guardar, muestra «Hay una versión nueva, se actualiza al cerrar» y recarga al cerrar. La recarga **no** cierra `sesiones_operador`: el piloto sigue piloto. Archivos: `lib/appVersion.ts`, `lib/appBusyState.ts`, `hooks/useStaleBuild.ts`, `components/system/NewVersionNotice.tsx`.
- **Retención manual (modal CC / Map view):** extensiones +1/+2/+4 h y «Indeterminada» acotadas al tope (`lib/operaciones/shiftHardCap.ts`, espejo del server).
- **Escritores de presencia:** todo alta presente escribe `status: 'PRESENT'` (la query del cron es `status == PRESENT && endTime <= now−5 min`).
- **dryRun:** `runAutoCompletarTurnosPass(db, ctx, now, { dryRun: true })` devuelve `actions[]` (CLOSE / RETAIN / RETAIN_QUIET / LINK_RELIEF / WAIT) sin escribir ni notificar.
- **Caso real:** `caps-angelelli-2026-09-26` (casos P1.1–P1.5) y `h-oncologico-2026-09-27` (P1b.1–P1b.4) en `eval-cc-casos-reales-emulator.mjs`.

**Archivos:** `scheduling/shiftClose.ts`, `scheduling/autoCompletarTurnosCore.ts`, `fichajes/registrarPresencia.ts`, `coverage/coverageRetention.ts`, `web2/hooks/useAutoMonitor.ts`, `web2/hooks/useOperacionesMonitor.ts`

---

### Flujo 7 — Llegada tarde

- **No entra en cascada CCT** como tipo de cobertura.
- **Portal:** `notificarLlegadaTarde` (T−60…T+5) → ETA fields + `LLEGADA_TARDE_AVISO`; ETA>60 → AA inmediata `AVISO_MAYOR_60`.
- **Sin aviso (P5a):** entre **T+5 y T+30** el guardia igual puede fichar. Ventana `evaluateServerCheckInWindow` / `evaluateCheckInWindow`: `lateNoNotice=true` y `lateMinutes`. El botón del portal dice **Llegada tarde** («Llegás N min tarde; queda registrado.»). `registrarPresencia` crea novedad `LLEGADA_TARDE` (no duplica si ya hay una de ese tipo en el turno). Liquidación descuenta desde `realStartTime` (H1, sin cambio).
- **Con aviso:** igual que antes — hasta `min(lateArrivalEtaAt, T+60)`; sin ETA → T+30. No setea `lateNoNotice` ni crea `LLEGADA_TARDE` al fichar.
- **Después de T+30** sin fichar: `TOO_LATE` y BLOQUE 2 `AUTO_T30`. Quien ya fichó (`isPresent`, aunque sea llegada tarde) no entra a `AUTO_T30`.
- **ops_cov convocado:** ventana propia sin cambio, `max(createdAt|coverageCreatedAt, start)+60`.
- **Scheduler:** BLOQUE 1 T+0…T+10 → conv `LLEGADA_TARDE` 3 min. Acepta confirma ETA; rechaza → AA; timeout → TIMEOUT (± AA si T+30).
- **BLOQUE 2:** ETA vencida → `ETA_VENCIDA` → Flujo 1. Sin aviso y sin fichada: T+30 → `AUTO_T30`.
- Demo skip en BLOQUE 1.

**Archivos:** `fichajes/checkInWindow.ts`, `fichajes/registrarPresencia.ts` (`requestCheckIn` → `processPortalCheckIn`), `index.ts` (`detectarAusencias`), `packages/portal-core` `evaluateCheckInWindow.ts` + `checkInUiStatus.ts`, branch LLEGADA_TARDE en `convocatoriasCobertura.ts`, `relevoNotifications.ts`

---

### Flujo 8 — Retiro anticipado

- **Callable:** `processEarlyWithdrawalCallable` → `processEarlyWithdrawal`.
- **Policy:** &lt;2h + compañeros → NO_REPLACE; solo/&gt;3h → REPLACE; 2–3h → flag SLA `reemplazarRetiro2a3h` (null: Manual `OPERATOR_CHOICE`, Auto REPLACE).
- **Cascada remanente:** solo Auto + !Manual; orden **sin EXTEND**; ADVANCE máx gap 4h.
- Cierra saliente `EARLY_WITHDRAW`; ausencia parcial; vacante `origin: INTERRUPTION` si REPLACE; audit `BAJA_*`.

**Archivos:** `earlyWithdrawalCore.ts`, `earlyWithdrawCascade.ts`, `earlyWithdrawPolicy.ts`

---

### Flujo 9 — `gestionarVacantes` (cron 5 min)

- Vacantes `isUnassigned` o `employeeId==='VACANTE'`; ventana start [now−12h, now+4h]; planning no-ops solo si `planificacion_estados` publicado.
- **Ya iniciada / T−1h:** protocolo + `VACANTE_PROTOCOLO_COBERTURA`; cascada si !Manual.
- **T−3h:** `isReportedToPlanning` + `VACANTE_A_PLANIFICACION`.
- Pases: `runDetectPublishedSlaGaps`, `runSlaUnplannedGapPass` (retención huecos SLA).

**Archivos:** `index.ts` (`gestionarVacantes`), `slaUnplannedGapPass.ts`, `detectPublishedSlaGaps.ts`

---

### Flujo 10 — Convocatoria (ciclo de vida)

Colección `convocatorias_cobertura`. Estados: `PENDING | ESCALATED | ACCEPTED | REJECTED | TIMEOUT | CANCELLED`.

| Acción | Efecto |
|--------|--------|
| Crear | Doc + notif + `CONVOCATORIA_ENVIADA` |
| Aceptar (PENDING o ESCALATED) | Revalida (licencia, solape, tope, hueco, contigüidad). Si falla: `REJECTED` + motivo y la cascada sigue. Si pasa: `resolverCobertura` → Flujo 5. FULL cancela el resto; PARTIAL no. |
| Rechazar | `REJECTED` + avanzar cascada / partial |
| Timeout cascada | `ESCALATED` + avanzar (sigue aceptando) |
| Timeout LLEGADA_TARDE | `TIMEOUT` (± AA) |
| Cancelar | Solo PENDING → `CANCELLED` (no avanza) |

Callables: `crearConvocatoriaCobertura`, `responderConvocatoriaCobertura`, `cancelarConvocatoriaCobertura`. (`getCandidatosCobertura` retirado; candidatos = `buildCoverageCandidates`.)

---

### Flujo 11 — Convocado no llegó

- Dentro de `detectarAusencias`; no Demo; `origin===OPERATIONS_COVERAGE`; no EXTEND; deadline +60 min; relanzar si quedan ≥2h.
- Revert titular (`convocadoTitularRevert`) → `markShiftAbsent(ops_cov, CONVOCADO_NO_LLEGO)` → cancel pending → Manual: novedad; Auto: nueva cascada sobre titular.

**Archivos:** `attendance/convocadoAbsentPass.ts`, `convocadoTitularRevert.ts`

---

### Flujo 12 — Escalado sin cobertura

- Cascada agotada / early sin candidatos.
- Primero `attemptRetention` → si retiene, **no** escala.
- Else: novedad `escalada_{shiftId}` `VACANTE_SIN_COBERTURA`; titular `isSinCobertura` / `SIN_COBERTURA` / `vacanteEscalada`; notif supervisores.

**Archivo:** `coverage/escalarVacanteSinCobertura.ts`

---

### Flujo 13 — Marcar / revertir ausencia Manual

- **Marcar:** `marcarAusenciaOperaciones` → `MANUAL_OPS` (puede ausentar presente) → Flujo 1.
- **Revertir:** solo hasta **T+60** (inicio planificado `startTime` + `REVERT_ABSENCE_WINDOW_MS`); si hay ops_cov exige `cancelCoverage:true`. Limpia AA, anula ausencia, cancela conv, libera retención, opcional supersede ops_cov, marca PRESENT + isLate.
- **Tarjeta CC (AUSENTES):** pasado T+60 la X se reemplaza por **VENCIDO** aunque el turno siga en curso (`isRevertAbsenceExpired`, espejo del plazo del servidor); "→ VAC" se mantiene. Al terminar el turno, VENCIDO reemplaza todas las acciones.

**Archivos:** `attendance/revertirAusencia.ts`, callables en `index.ts`, `web2/src/lib/operaciones/revertAbsenceWindow.ts`

---

## 5. Impacto por módulo

| Módulo | Rol / impacto |
|--------|----------------|
| **Operaciones (CC)** | Origen UI; sala piloto/copiloto; badges RECARGO (`isRetention`) y CIERRE PENDIENTE; filtra ops_cov EXT/ADV |
| **Functions** | Motor canónico cobertura/retención/cascada/triggers/crons |
| **Planificación** | Muestra celdas `OPERATIONS_COVERAGE` / `coverageUsed` (no es motor) |
| **RRHH** | Entrada AA; al FULL `coberturaEstado: GESTIONADA` |
| **Fichajes** | `registrarPresencia`, `checkInWindow`, relevo; EXT/ADV no fichables; Flujo 11 |
| **Análisis** | ops_cov en malla/demanda/resultante; EXT/ADV sin doble conteo; FT no infla cobertura |
| **Reportes / liquidación** | Badges COBERTURA/RETENCIÓN; FT, RET/REF/ESC, ext/adel, overtime retención |
| **Portal** | Responde convocatorias; ventanas `OPERATIONS_COVERAGE`; backlog alinear `getCheckInTiming` |
| **Novedades** | `AUSENCIA_AUTO`, `RETENCION_*`, `VACANTE_*`, `COBERTURA_RESUELTA`, `CONVOCATORIA_*`, etc. |

---

## 6. Colecciones Firestore

| Colección | Rol |
|-----------|-----|
| `turnos` | Titular AA, saliente retenido, `ops_cov_*`, vacantes |
| `convocatorias_cobertura` | Pipeline Auto/Manual/Demo/LLEGADA_TARDE |
| `ausencias` | AA / parcial / GESTIONADA |
| `novedades` | Bitácora CC |
| `user_notifications` | Push app |
| `sesiones_operador` | Gate Manual vs Auto |
| `empresas` | `centroControlEnabled`, `modoDemoEnabled` |
| `servicios_sla` | Continuidad / `reemplazarRetiro2a3h` |
| `planificacion_estados` | Scope vacantes planning |
| `audit_logs` | Scheduler / baja protocolo |
| `empleados` | uid candidato / elegibilidad |
| `system_users` | Supervisores notificados en escalado |

---

## 7. Triggers, crons y callables

### Schedulers / triggers
- `onTurnoAbsenciaDetectada` — retención; cascada si !Manual (Demo sí)
- `gestionarVacantes` — cada 5 min
- `checkConvocatoriaTimeouts` — cada 1 min
- `modoDemoCron` — cada 5 min
- `detectarAusencias` — T+30 / ETA / convocado absent
- `autoCompletarTurnos` — único cierre automático + tope 12:59 / continuidad

### Callables
`crearConvocatoriaCobertura`, `responderConvocatoriaCobertura`, `cancelarConvocatoriaCobertura`, `sesionOperador`, `marcarAusenciaOperaciones`, `revertirAusencia`, `notificarLlegadaTarde`, `registrarPresencia`, `processEarlyWithdrawalCallable`, `releaseInvalidRetentions`, `releaseTraceAbsences`

### Internos (no callables)
`applyCoverage`, `iniciarCascadaCobertura`, `resolverCobertura`, `retainOutgoingForGap`, `simularRespuestasConvocatorias`, `markShiftAbsent`

---

## 8. Espejos front / back

| Backend `apps/functions/src/coverage/` | Front `apps/web2/src/lib/operaciones/` |
|---------------------------------------|----------------------------------------|
| `syncAusenciaCobertura.ts` | `syncAusenciaCobertura.ts` |
| `coverageRetention.ts` (escritor) | `coverageRetention.ts` (UI pick) |
| `coverageSourceShiftForGap.ts` | `coverageSourceShiftForGap.ts` |
| `coverageExtAdvSegments.ts` | `coverageExtAdvSegments.ts` |
| `earlyWithdrawPolicy.ts` | `earlyWithdrawPolicy.ts` |

**Solo front:** `CoverageSessionManager`, `coverageCandidateView`, `coverageInternalCandidates`, `coverageGeo`, `opsExtAdvCandidates`, `opsConvocatoriaCobertura`, `opsDualCoverageApply`  
**Solo backend:** `convocatoriasCobertura`, `coverageCandidatesServer`, `eligibilityFilter`, `escalarVacanteSinCobertura`, `positionHasContinuity`, `earlyWithdrawalCore`, `earlyWithdrawCascade`  
**Shared:** `packages/ops-core` (`buildCoverageCandidates`, copia byte-idéntica en `functions/src/coverage/coverageCandidates.ts`), `packages/portal-core`

---

## 9. Reglas críticas (checklist)

1. Un solo materializador: `applyCoverage`.
2. Un solo escritor retención por hueco: `retainOutgoingForGap`.
3. Manual = retención sí, cascada no; Demo bypasea bloqueo Manual.
4. Claim 2 min evita doble aceptación.
5. EXT/ADV no duplican horas.
6. Continuidad SLA ±30 min + tope 12:59 desde inicio real (cierra aun con continuidad; el puesto pasa a vacante).
6b. Cierres automáticos solo en el server, siempre con `realEndTime`; el navegador no cierra turnos solo.
7. Timeout convocatoria 3 min → ESCALATED; primero que acepta gana (salvo dual).
8. Cascada agotada → `escalarVacanteSinCobertura` (+ intento retención previo).
9. CC off → sin cascada/novedades cobertura; el cierre automático corre igual en silencioso (tope 12:59 incluido).
10. Elegibilidad: mismo objetivo, geo ~15 km (ampliable 30), solape source↔hueco, aptitudes.

---

## 10. Backlog pendiente (no asumir implementado)

- [ ] Retención: liberar FIFO al fichar entrante; orden estricto spec; edge UI activos
- [ ] Convocatorias CC: cancelar al rechazar/cerrar
- [ ] Flujos: sin turno, retener sola, sintético, otros objetivos, &gt;30 km
- [ ] Cascada Auto: sin turno/volante primero; fechas AR
- [ ] Portal: alinear `getCheckInTiming` con ventanas servidor
- [x] Candidatos únicos (`buildCoverageCandidates`) + revalidación al aceptar + PARTIAL no cancela
- [ ] Prioridad EXT sobre retenido + segmentos HH:MM–HH:MM

**Cerrado Fase 1–2:** escritor único, dual Ext+Adel, REF/ESC callable, retención backend, cascada bloqueada Manual, continuidad/tope 12:59 con cierre único en server (P1), ops_cov EXT/ADV excluidos, `markShiftAbsent` unificado, llegada tarde, fichada servidor.

**E2E:** `node scripts/eval-coverage-e2e-emulator.mjs`

**Casos reales (snapshot prod → emulador):** `scripts/cc-caso-real-snapshot.mjs export` lee de prod en solo lectura (ADC) el objetivo/día y sigue los vínculos entre turnos (extend/advance/source/absence/covered/causedBy); `load` lo carga en el emulador bajo el proyecto aislado `demo-cc-casos` (no pisa el lab). Salida en `scripts/out/cc-casos/` (gitignored: datos personales). Runner: `node scripts/eval-cc-casos-reales-emulator.mjs`. Caso base: CAPS Angelelli 26/09 (`caps-angelelli-2026-09-26`).

---

## 11. Prompt corto de arranque (copiar/pegar)

```
Leé docs/PROMPT-COBERTURA-CC-FLUJOS.md (o el PDF equivalente). Es el mapa canónico de cobertura CC en COSP: 13 flujos, Manual/Auto/Demo, applyCoverage, retención, cascada, y conexiones entre módulos.

Tarea: [DESCRIBÍ AQUÍ LO QUE NECESITÁS]

Restricciones:
- No inventar ops_cov ad hoc ni segunda cascada.
- Respetar Manual (sin cascada) vs Auto/Demo.
- UI vigente = CoverageSessionManager.
- Antes de editar, nombrá qué flujos y colecciones tocás.
```

---

*Documento generado para Mauro Martinez / Grupo Bacar — uso interno COSP.*
