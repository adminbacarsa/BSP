# Auditoría CC — pruebas_sa — 02/10/2026 (read-only)

Lectura de producción (`comtroldata`, firebase-admin, sin escrituras) del 02/10 en `turnos`, `ausencias`, `novedades`, `audit_logs`, `convocatorias_cobertura` (+ `eventos`), `eventos`, `solicitudes_evento`, `contratos_eventuales`, `arca_envios`, `anexo_codigos`, `guardia_puntaje`, `guardia_desempeno_eventos`, `sla_huecos_sin_plan`, `servicios_sla`, `planificacion_estados` y `sesiones_operador`. Mismo formato que `docs/AUDITORIA-CC-2026-10-01.md`. Horas en AR.

## Contexto del día

| Hora | Qué había desplegado / qué pasó |
|------|--------------------------------|
| 09:30 | Evento **pumas** `N1pPa6zZzutj9ZoSztR6` creado por `implementaciones.it`: un servicio «puerta campus» 12:00–20:00 en Plaza de La Musica (`1787359299201`), cupo 5, `tipoTurno: libre`, **sin cupo por género** (`cupoPorGenero` ausente → INDISTINTO; no se usó). |
| 09:38 → 15:54 | Sala **Manual**: piloto `implementaciones.it` (sesión 09:38:46, `passToAuto` 15:53:58). Después, Auto. |
| 09:47 / 09:55 | ABALLAY (eventual `20334141463`) asignado al evento: contrato `pruebas_sa_20334141463_2026-10`, AT LOTE 09:47 → quitado `SIN_TURNOS` 09:48:42 (contrato ANULADO) → reasignado 09:55:01 con **dos** AT URGENTE el mismo segundo (`kTWqhnLUfGM2AQhXkWB7`, `qpMd762lmZ5dQOi8pYFU`). |
| 09:54 | Debora: corrección masiva de francos (F 02/10 y 03/10 para SANCHEZ y BAZAN ANA) y republicación de Peaje 9 Norte 10/2026 (`[OVERRIDE SA] 0 turno(s)`). |
| 12:35 | `detectarAusencias`: AA de ABALLAY (12:35:05) y SANCHEZ (12:35:23) en el evento. Código desplegado **anterior a `0b3c286d`** (12:55) y `66134e18` (14:26). |
| 12:41 | Operador `BIar6f7ILATdkucXKH9NTDUkKQG2` revierte la AA de ABALLAY (`revertirAusencia`, `presenciaSource: OPERATIONS`, 41 min tarde). |
| 18:00 | `scheduledCronogramaSinPublicar`: **3** novedades `crono_sin_pub_pruebas_sa_{obj}_2026-10` (Nuevo Edificio, Sucursal Villa María, Data Center). Corregido respecto del 01/10 (41). ✓ |
| 20:00 | Cierre de los tres EV del evento con `SIN_CONTINUIDAD_SLA` (20:04). |

Empresa: `modoDemoEnabled: true`, `centroControlEnabled: true`, `hoursCoreEnabled: true`.

## 1. Evento «pumas» de punta a punta

| # | Paso | Qué pasó | Estado |
|---|------|----------|--------|
| 1 | Convocatorias de nómina | QUIROGA `LFhWrhiFyteCIrEQAC3K` (`admin_asigna`, desde RET) aprobada; SANCHEZ `4SGp8NSWLk6NAxzIW6by` (`admin_convoca`) aprobada, turno `YxNARWm72U81nnA7Vwly` desde el F `oWLyJ4u7FQ6T0LF6xnqq` (novedad `VACANTE_POR_EVENTO` 09:56:08); BAZAN ANA `textkEqMdkBC4U7Aa3et` quedó `convocado` sin responder (sin turno). | ✓ |
| 2 | Eventual | ABALLAY: marco firmado 02/10 (vence 2027-10-02), contrato `pruebas_sa_20334141463_2026-10`, turno `YuSTKGsC91W9aksQ3lTb` 12:00–20:00. | ✓ alta; ✗ **dos AT URGENTE** (ver §5 código #2) |
| 3 | QUIROGA | checkIn 11:53:44, `realStartTime` 12:00 (pago desde inicio planificado), cierre 20:00 `SIN_CONTINUIDAD_SLA` 20:04:04. | ✓ |
| 4 | ABALLAY T+30 | AA `AUTO_T30` 12:35:05 (T+35). `aplicarEventualNoSePresento` 12:35:07: novedad `AUSENCIA_EVENTUAL` («No se paga la jornada. ARCA: alta cancelada»), los dos AT `quitadoDelLote` `NO_SE_PRESENTO`/`FALTA_SIN_AVISO`, contrato `ANULADO` (`cierre.motivo CANCELAR_AT`), `anexo_codigos` `sinEfecto`, `guardia_desempeno_eventos/FALTA_SIN_AVISO_YuSTKGsC91W9aksQ3lTb_20334141463`, turno `pagaJornada:false`, `noSePresento`, `eventualArcaAccion: CANCELAR_AT`, `excluirBolsaCuils`. | ✓ según spec P8 |
| 5 | Re-cascada tras la falta | `iniciarCascadaCobertura(…, 'EVENTUAL_AUSENTE')` 12:35:22 **con la sala en Manual** → FT a BAZAN ANA (`X5ktPUBUgPM8JrFZRMZj`) y a **SANCHEZ** (`YUh0SXi0esOjZvQKYILv`), que tenía su propio EV 12–20 en el mismo evento. Ambas TIMEOUT 12:39:04 → `VACANTE_SIN_COBERTURA` `escalada_YuSTKGsC91W9aksQ3lTb` 12:39:05, cancelada 12:41:27. | ✗ código #3 y #4 |
| 6 | Reversión ABALLAY 12:41:26 | El turno quedó presente (`absenceRevertedAt`, `realStartTime` 12:41, `lateMinutes` 41) y cerró 20:00 `SIN_CONTINUIDAD_SLA`. Pero **nada de la falta se deshizo**: `pagaJornada:false`, `noSePresento:true`, `eventualNoSePresentoAt` sin `…RevertidoAt`, `excluirBolsaCuils` con su CUIL, `isUnassigned:true`, `isSinCobertura:true`, `vacanteEscalada:true`, `eventualAltaArcaConfirmada:false`; los dos AT siguen quitados; contrato `ANULADO` con `jornadas: []`; `anexo_codigos` `sinEfecto:true`; desempeño FALTA_SIN_AVISO vigente; novedad `AUSENCIA_EVENTUAL` sin resolver. Sin `audit_logs` de la reversión. | ✗ **datos** (script §4). Causa: `deshacerEventualNoSePresento` entró con `0b3c286d` a las 12:55, 14 min después. No es bug vigente. |
| 7 | SANCHEZ T+30 | AA `AUTO_T30` 12:35:23 (texto «Puesto ·», `positionName` vacío). Sin cascada (Manual, coherente). Ausencia `a8WOosaFc2Df0UFjfu4c` **Anulada 13:18:41**; el turno tiene `absenceRevertedBy: 'claude-fix-pruebas_sa'` y `checkInAt = realStartTime = absenceRevertedAt = 12:01:00` — es un arreglo de datos de otra sesión, no una fichada real. Cierre 20:00 ✓. | ⚠ dato artificial; sin tocar |
| 8 | Cierre del evento 20:00 | Los tres EV cerraron a las 20:00 (`SIN_CONTINUIDAD_SLA`, `realEndTime` 20:00). El evento sigue `status: 'abierto'` y el servicio `status: 'pendiente'`; no hay novedad de «evento finalizado». En el código no existe un cierre automático del evento ni un aviso al terminar: no es una falla, es funcionalidad no implementada. | ✓ turnos; — evento |
| 9 | Anulación / baja ARCA | No se creó ningún envío `ANULACION`/`BAJA_NO_PRESENTACION`: con el código del mediodía la falta solo quitaba los AT del lote (`canceladoMotivo FALTA_SIN_AVISO`). El AT nunca se confirmó (`eventualAltaArcaConfirmada:false`), por lo que no hubo nada que anular en ARCA. Con `66134e18` (14:26) la anulación pasa a tarea manual en ARCA pendientes. | ✓ coherente con lo desplegado |

## 2. Relevos de franja (primer día real con `pairReliefs`)

SLA octubre Peaje (`u7pMU1WQaGq1rxXxWstO`): Puesto 1 ×1 (M 10:45–12, T 12–14:30, M2 11–15, T2 15–17, M3 12:30–16, T3 16–17); Puesto 2 ×2 por franja (M 11:30–15:15, T 15:15–16:15, M2 11:45–15:30, T2 15:30–16:30).

| # | Puesto / franja | Qué pasó | FIFO esperado | Estado |
|---|-----------------|----------|---------------|--------|
| 1 | Puesto 1 M→T | BAEZ (in 10:51) relevado por GUERRERO 12:05:31, `retentionMinutes` 5. | Igual. | ✓ |
| 2 | Puesto 1 M2→T2 | FANTINI retenido 15:00, relevado por FONTANA 15:04, ret 4. | Igual. | ✓ |
| 3 | Puesto 1 M3→T3 | FARIAS relevo programado por VENENCIA, cerrado 16:00 `RELEVO_PROGRAMADO`. | Igual. | ✓ |
| 4 | Puesto 2 M×2→T×2 | FERRERO (in 11:29) y BOSIO (in 12:04). LOPEZ (15:18:55) relevó a **FERRERO** (más antiguo, ret 4); BRIZUELA (15:19:29) a **BOSIO** (ret 4). | LOPEZ→FERRERO, BRIZUELA→BOSIO. | ✓ FIFO |
| 5 | Puesto 2 M2×2→T2×2 | GARCIA (in 11:35) y CARDO (in 11:37). GONZALEZ (15:36:26) relevó a **GARCIA** (ret 6); BAZAN F. (15:36:58) a **CARDO** (ret 7). | GONZALEZ→GARCIA, BAZAN→CARDO. | ✓ FIFO |

`retentionMinutes` 4/4/5/6/7 = `round((realEndTime − endTime)/60s)` ✓. Sin retenciones abiertas al cierre del día; ningún turno quedó `isPresent` o `isRetention` sin `realEndTime`.

## 3. Cierres por SLA, ausencias y huecos

| Cierre `SIN_CONTINUIDAD_SLA` | Turnos | Verificación |
|------------------------------|--------|--------------|
| 14:30 | GUERRERO T | Última franja del Puesto 1 a esa hora: T→M2 no es serie; cierre a su fin ✓ |
| 16:15 | LOPEZ, BRIZUELA T | Fin del SLA Puesto 2 ✓ |
| 16:30 | BAZAN F., GONZALEZ T2 | Fin del SLA Puesto 2 ✓ |
| 17:00 | FONTANA T2, VENENCIA T3 | Fin del SLA Puesto 1 ✓ |
| 20:00 | QUIROGA, ABALLAY, SANCHEZ EV | Fin del servicio del evento ✓ |

Ausencias del día (11 docs): BOSIO AA 12:04:06 → revertida 12:04:42; FARIAS AA 13:00:21 → revertida 13:02:25 (32 min tarde); ABALLAY y SANCHEZ (§1). Reversiones correctas salvo el eventual. Flag residual `vacancyCreatedForAbsence` en los revertidos (cosmético, conocido).

Huecos y vacantes virtuales: a las **12:35:10** el CC escribió 7 novedades `autodev_nov_gap_pruebas_sa_UJHqYnFeQfCEbYfVSMIi_…` (`VACANTE_A_PLANIFICACION`, ATENDIDA, `autoProcessed`) para **todas** las franjas de Peaje (M3, T×2, T2×2, T3, T2) más `autodev_prot_…_M3`, aunque todas estaban planificadas y presentes, y `gap_…_M3` es un hueco **CLOSED** desde el 01/10. Lo mismo a las 09:16:59 para Colegio de Arquitectos (3). Origen: `useOperacionesMonitor` (~1197) auto-devuelve las vacantes virtuales del día apenas aparecen en `processedData`; en una recarga de la malla el cálculo ve la grilla incompleta un instante. Ruido sin efecto operativo (ya están ATENDIDA). Código #5.

`scheduledCronogramaSinPublicar` 18:00:23: exactamente 3 docs, uno por objetivo-mes ✓.

## 4. Script de datos

`node scripts/fix-auditoria-cc-2026-10-02.mjs` (dryRun) · `--apply --allow-prod` lo corre Mauro. Replica en datos lo que hoy hace `deshacerEventualNoSePresento` (main) para la reversión de ABALLAY de las 12:41:

| Doc | Cambio |
|-----|--------|
| `turnos/YuSTKGsC91W9aksQ3lTb` | `pagaJornada:true`; borra `noSePresento`, `eventualNoSePresentoAt/Motivo`, `eventualArcaAccion`, `eventualDesempeno`; `eventualNoSePresentoRevertidoAt` = 12:41:26, `…RevertidoPor` = operador; `eventualArcaReversion: AT_REENCOLADO`; `excluirBolsaCuils` sin su CUIL; `isUnassigned/isSinCobertura/vacanteEscalada:false`. |
| `arca_envios/kTWqhnLUfGM2AQhXkWB7` | Reencolado: `quitadoDelLote:false`, `canal URGENTE`, `estado PENDIENTE`, `urgentePorReversion`, `reencoladoMotivo AUSENCIA_REVERTIDA`. **Mauro decide**: el evento ya pasó; si no corresponde dar el alta tardía, correr con `--sin-arca`. |
| `arca_envios/qpMd762lmZ5dQOi8pYFU` | Sigue quitado; `quitadoMotivo: DUPLICADO` (gemelo del anterior, creado el mismo segundo). |
| `contratos_eventuales/pruebas_sa_20334141463_2026-10` | `estado CONFIRMADO`, `status ACTIVE`, `jornadas` = [02/10 12:00–20:00, 8 h], `fechaBaja 2026-10-02`, borra `cierre`, `reabiertoMotivo AUSENCIA_REVERTIDA`. |
| `anexo_codigos/pruebas_sa_20334141463_2026-10` | `sinEfecto:false`, borra `sinEfectoAt`. |
| `guardia_desempeno_eventos/FALTA_SIN_AVISO_YuSTKGsC91W9aksQ3lTb_20334141463` | Se borra; se crea `LLEGADA_TARDE_SIN_AVISO_…` (41 min, `revertidaDesdeFalta`). |
| `novedades` `AUSENCIA_EVENTUAL` del turno | `ATENDIDA`, `resolved`, `reversionNota`. |
| `audit_logs` | Un registro `DATA_FIX` con el detalle. |

Nada más se toca: SANCHEZ (dato artificial de otra sesión), francos duplicados (no lo son: `Nm48fm…` y `3EzY9g…` son del 03/10), vacantes virtuales (ya ATENDIDA), puntaje (se recalcula solo al escribir; necesita el fix de código #1).

## 5. Backlog de código (ninguno corregido en esta rama)

| # | Dónde | Qué | Evidencia |
|---|-------|-----|-----------|
| 1 | `desempeno/puntajeGuardiaJob.ts:92` | `reverted` solo mira `revertedAt`/`revertidaAt`/status `REVERTIDA`. Las reversiones reales escriben `anuladaAt` + `status: 'Anulada'` (o reconvierten a Llegada Tarde) y el turno `absenceRevertedAt`. Resultado: **FALTA_SIN_AVISO −15** para ABALLAY, SANCHEZ, FARIAS y BOSIO (×3, 30/09–02/10) aunque todas fueron revertidas. Fix: `reverted = anuladaAt || status ANULADA || tipo Llegada Tarde || turno.absenceRevertedAt`. | `guardia_puntaje` 20:10 |
| 2 | `eventuales/planificacionEventuales.ts` | `sincronizarContratoEventual` corre dos veces en la misma asignación: la callable (`actorUid` del usuario, l. 626/887) y el trigger `onTurnoEventualWrite` (SYSTEM, l. 919). Cada una creó un AT URGENTE a las 09:55:01. Falta idempotencia: un solo AT vivo por contrato (buscar `AT` no quitado antes de crear). | `arca_envios` kTWq… y qpMd… |
| 3 | `eventuales/eventualNoSePresento.ts:486` | `aplicarEventualNoSePresento` llama a `iniciarCascadaCobertura` sin consultar `isEmpresaManualMode` (el trigger y `gestionarVacantes` sí lo hacen). Con la sala Manual lanzó FT a dos personas a las 12:35:22. | convocatorias X5kt…, YUh0… |
| 4 | `coverage/coverageCandidates.ts` `considerFt` / `overlappingCoverage` | El FT solo rechaza por `ops_cov` solapado; no mira otros turnos de trabajo del mismo día. SANCHEZ (F 02/10 ya usado como origen de su EV 12–20) fue candidata FT para el hueco 12:35–20:00 del mismo evento. Debe rechazar `SOLAPA_TURNO` si la persona tiene EV/puesto (no franco, no licencia) solapado al hueco, y excluir francos con `coverageUsed`/`sourceShiftId` consumido. | convocatoria YUh0SXi0esOjZvQKYILv |
| 5 | `web2 hooks/useOperacionesMonitor.ts` ~1197 | Auto-devolución a Planificación de vacantes virtuales sin esperar a que la malla esté cargada ni verificar `sla_huecos_sin_plan` CLOSED. 10 novedades falsas el 02/10. | `autodev_nov_gap_…` 09:16:59 / 12:35:10 |
| 6 | `detectarAusencias` (texto AA de evento) | «… en Puesto ·» cuando el EV no tiene `positionName`: usar el nombre del servicio del evento. | novedad AA SANCHEZ 12:35:23 |
| 7 | Eventos | No existe cierre automático del evento/servicio al terminar el último EV ni aviso. Decidir si se quiere (`status: finalizado` + novedad). | evento sigue `abierto` |

Verificado sin hallazgos: FIFO de relevos, cierres por fin de SLA, tope 12:59 (turno más largo del día 8 h, QUIROGA 12:00–20:00), `CRONOGRAMA_SIN_PUBLICAR`, cupo por género (no usado), puntaje de aceptaciones (`EVENTO_ACEPTADO` +5 QUIROGA/SANCHEZ/ABALLAY, `CONVOCATORIA_SIN_RESPUESTA` −3 BAZAN ANA/SANCHEZ).
