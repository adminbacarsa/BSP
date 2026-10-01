# Auditor?a CC ? pruebas_sa ? 01/10/2026 (read-only)

Lectura de producci?n (`comtroldata`, firebase-admin, sin escrituras) del 01/10 en `turnos`, `ausencias`, `novedades`, `audit_logs`, `convocatorias_cobertura`, `servicios_sla`, `planificacion_estados`, `sla_huecos_sin_plan` y `sesiones_operador`. Formato igual a `docs/AUDITORIA-CC-2026-09-29.md`.

## Contexto del d?a

| Hora (AR) | Qu? hab?a desplegado / qu? pas? |
|-----------|-------------------------------|
| 06:00?07:00 | Cierre de las N del 30/09 (Patricios, Valpara?so, Tadicor, Nuevo Edificio). C?digo previo a `483a8509`. |
| 10:02 | Sala Manual: piloto `implementaciones.it` + `admin` (sesiones hasta 16:04; `passToAuto`). |
| 10:16 / 11:15 | Peaje 9 Norte ? 10/2026 publicado (override SA). ?nico objetivo con cronograma de octubre. |
| 10:21 | `483a8509` fin de servicio sin cronograma (`FIN_SERVICIO_SIN_CRONOGRAMA`). |
| 10:41 | DATA_FIX manual (Claude Code, decisi?n Mauro): N de Nuevo Edificio cerradas a las 07:00. |
| 16:00 / 16:17 | `8629e199` + `3df57da0`: relevo FIFO `pairReliefs` + inicio real efectivo. **Regla vigente desde 16:10.** |
| 18:00 | `scheduledCronogramaSinPublicar`: 41 novedades (ids por d?a; `e12a5f0f` 19:54 pasa a objetivo-mes). |

Empresa: `modoDemoEnabled: true`, `centroControlEnabled: true`, `hoursCoreEnabled: true`.

## 1. Relevos de franja

Todos los relevos del 01/10 ocurrieron **antes de las 16:10** (?ltimo: Farias?Venencia 16:02 `RELEVO_PROGRAMADO`). No hay ning?n relevo en prod ejecutado con la regla FIFO nueva: el primer d?a real ser? el 02/10 (Peaje, 14 turnos planificados). Con la regla vieja (?fichada m?s reciente?) se observan los dos casos que motivaron el cambio:

| # | Puesto / franja | Qu? pas? | Qu? debi? pasar (FIFO) | Estado |
|---|-----------------|----------|------------------------|--------|
| 1 | Puesto 1 M?T | BAEZ (in 10:51) relevado por GUERRERO 12:03:19, `realEndTime` = fichada, sin retenci?n (cron no lleg? a retener). | Igual. | ? |
| 2 | Puesto 1 M2?T2 | FANTINI (in 10:47) retenido 15:00, relevado por FONTANA 15:03:47, `retentionMinutes` 4. | Igual. | ? |
| 3 | Puesto 1 M3?T3 | FARIAS relevo programado por VENENCIA (fich? 15:51), cerrado 16:00 `RELEVO_PROGRAMADO`. | Igual. | ? |
| 4 | Puesto 2 M?2?T?2 | FERRERO in 11:38, BOSIO presente por operador 12:05 (sin `checkInAt`). LOPEZ (15:21:50) relev? a **BOSIO** (ret 7); BRIZUELA (15:25:37) a FERRERO (ret 11). | LOPEZ ? FERRERO (m?s antiguo), BRIZUELA ? BOSIO. | Regla vieja, previo a 16:10. Datos coherentes (`realEndTime` = fichada, minutos bien). Sin corregir. |
| 5 | Puesto 2 M2?2?T2?2 | GARCIA in 11:41, CARDO in 11:42. BAZAN (15:56:45) relev? a **CARDO** (ret 27). | BAZAN ? GARCIA. | Regla vieja. Sin corregir. |
| 6 | Puesto 2 T2 GONZALEZ `lxmVhJjsuQxekqp8Q0Dd` | Operador `admin` lo marc? **LLEG?** 15:58:09 (`revertirAusencia`, `presenciaSource: OPERATIONS`, sin `checkInAt`). **No relev? a nadie** (`relievedOutgoingShiftId` ausente, GARCIA sigui? retenida). | Relevar a GARCIA (?nica saliente M2 presente, serie M2?T2) y cerrarla a las 15:58 con `retentionMinutes` 28. | **Causa en c?digo (ya corregida en `8629e199`):** `1db29d24` pasaba `absenceShiftId: shiftId` a `findPresentOutgoingAlignedToGapStart`; GARCIA ten?a `retentionAbsenceShiftId = 48em` (BAZAN) ? GONZALEZ ? excluida (`relevoOutgoingMatch.ts` ?retenido por otra ausencia?). `8629e199` quit? ese par?metro en `revertirAusencia.ts`. |
| 7 | Puesto 2 M2 GARCIA `VvAYzVRtAL3s4Hsa5rHQ` | Mauro la cerr? desde el celular 15:59:01 (`CHECKOUT`, ?Salida desde el celular?). Qued? `status COMPLETED`, `realEndTime 15:59`, pero **`isRetention: true`**, sin `retentionMinutes`, sin `retentionEndedAt`, sin `autoCloseReason`. | Cierre con `isRetention: false`, `retentionEndedAt 15:59`, `retentionMinutes 29`. | **Causa en c?digo (abierta):** `useOperacionesMonitor.handleAction('CHECKOUT')` escribe solo `status/isCompleted/isPresent/realEndTime/checkoutNote` por `updateDoc`; no pasa por `buildAutoClosePatch` ni limpia la retenci?n. Mismo patr?n el 30/09 (`boLe2gSh4mEhKFW7QCN9`, GARCIA, cierre 15:34 con `isRetention: true`). **Fix de datos:** script abajo. |
| 8 | Texto de retenci?n | GARCIA: `retentionAbsenceShiftId = 48em` (BAZAN) pero `retentionReason = ?GONZALEZ ? no se present??`. | V?nculo y texto sobre la misma persona. | Menor. `autoCompletarTurnosCore.ts` ~660: el texto se refresca con el `relievePending` de cada pasada, el v?nculo se fija una vez. Deber?a leer el doc vinculado cuando hay `retentionAbsenceShiftId`. |

Sin retenciones fantasma al cierre del d?a: ning?n turno qued? `isPresent` o `isRetention` abierto (los dos `isRetention: true` son los COMPLETED de GARCIA, caso 7). Tope 12:59: turno m?s largo del d?a 4 h 18 (GARCIA). `retentionMinutes` verificados: 4, 7, 11, 27 = `round((realEndTime ? endTime)/60s)` ?.

## 2. Cierres por SLA

SLA de octubre Peaje (`u7pMU1WQaGq1rxXxWstO`): Puesto 1 ?1 (M 10:45?12, T 12?14:30, M2 11?15, T2 15?17, M3 12:30?16, T3 16?17); Puesto 2 ?2 por franja (M 11:30?15:15, T 15:15?16:15, M2 11:45?15:30, T2 15:30?16:30).

| Cierre | Turnos | Verificaci?n |
|--------|--------|--------------|
| `SIN_CONTINUIDAD_SLA` Peaje | GUERRERO T 14:30; FONTANA T2 17:00; VENENCIA T3 17:00; LOPEZ/BRIZUELA T 16:15; BAZAN/GONZALEZ T2 16:30 | ? Ninguna franja arranca a ?30 min del fin (T2 15:00 frente a T 14:30 es otra serie ? `REJECT`). `realEndTime` = fin planificado. |
| `SIN_CONTINUIDAD_SLA` 30/09?01/10 | Patricios ?6 (06:00/07:00), Valpara?so SAMPO?A 06:00, Tadicor PAREJO N2 06:00 | ? Sin SLA vigente en octubre (septiembre `closed: true`; Tadicor `inactive`). Cierre a la hora, sin retenci?n. |
| `FIN_SERVICIO_SIN_CRONOGRAMA` | Nuevo Edificio: CEBALLOS, GAUNA, RODRIGUEZ (N 23?07) | SLA octubre existe (`GREuyqm6?`, OC) con M 07:00 ? continuidad ?, pero sin cronograma publicado ? deb?a cerrar 07:00. **Qu? pas?:** el c?digo previo los retuvo a las 07:00 (`RETENCION_DETECTADA` 08:02, `RETENCION_LARGA` 09:00); el DATA_FIX de las 10:41 los dej? bien (`realEndTime 07:00`, `isRetention false`, sin minutos). Quedan `retentionStartedAt`/`autoRetentionAt` 07:00 residuales, inocuos. El fix `483a8509` cubre el caso en adelante. |
| `SIN_LUGAR_FRANJA` | ? | No hubo. Correcto: cantidades iguales (1?1, 2?2). |

## 3. Ausencias y reversiones

| Hora | Guardia | Qu? pas? | Evaluaci?n |
|------|---------|----------|------------|
| 12:05:05 | BOSIO M 11:30 (`7eTeeRDllPUcWqjNJahr`) | `AUTO_T30` (T+35, cron de 5 min) + `AUSENCIA_AUTO` + `vacancyCreatedForAbsence`. Sala Manual ? sin cascada (correcto). | ? |
| 12:05:36 | BOSIO | Piloto `implementaciones.it` marc? LLEG? (`revertirAusencia`): ausencia `Anulada`? reconvertida a ?Llegada Tarde Confirmada? (`anuladaAt 12:05:37`), `absenceRevertedAt`, sin `checkInAt`. | ? dentro de T+60. Quedan `vacancyCreatedForAbsence: true` / `vacancyOrigin: ABSENCE` en el turno (solo los lee `onGuardAbsenceDetected`; inocuo). |
| 10:51?15:56 | BAEZ, FERRERO, LOPEZ, BRIZUELA, BAZAN | `LATE_ARRIVAL` ?Llegada Tarde? 6/8/7/11/27 min con `lateMinutes` coherentes. | ? |
| ? | ?Ven?s? | 9 convocatorias `LLEGADA_TARDE` TIMEOUT/CANCELLED. | ? |

`AUTO_MARK_ABSENT` en `audit_logs` sale sin `empresaId` (menor).

## 4. Huecos SLA y novedades

| Hallazgo | Detalle | Causa probable |
|----------|---------|----------------|
| **`SLA_HUECO_SIN_PLAN` falsos** 12:05 y 15:00 | `sla_huecos_sin_plan/gap_pruebas_sa_UJHq?_puesto_1_2026-10-02_M3` (12:00?16:00) y `?_puesto_2_2026-10-02_T` (15:00?16:00), `status OPEN`. El SLA de octubre tiene M3 **12:30** (FARIAS planificado) y T **15:15** ?2 (LOPEZ+BRIZUELA planificados). Las horas 12:00/15:00 son del SLA cerrado de un solo d?a `DGWzaaRiJ7p5elY4Owgw` (25/09). | `detectPublishedSlaGaps.ts`: la query es `status == 'active'` sin filtrar `closed` ni vigencia (`startDate`/`endDate`) del SLA. **Fix de datos:** cerrar esos 2 gaps (script). **Fix de c?digo:** filtrar SLA vigente en el d?a evaluado. |
| `VACANTE_A_PLANIFICACION` 10:16 | Puesto 2 T 15:15 ?2 con un solo planificado hasta que Debora cre? a BRIZUELA 10:16:43. | ? leg?timo; se resolvi?. |
| **`CRONOGRAMA_SIN_PUBLICAR`: 41 novedades, 38 falsas** | Una por objetivo (ids por d?a `_2026-10-02`, `mesKey` ausente), todas descartadas por Mauro 19:35. Solo **3** objetivos tienen SLA vigente el 02/10 sin cronograma (Nuevo Edificio, Sucursal Villa Mar?a, Data Center). Las otras 38 (Patricios, Valpara?so, 16 sucursales Bapro, hospitales, etc.) solo tienen SLA cerrados de meses anteriores: no hay nada que publicar. Peaje correctamente ausente. | `avisoCronogramaSinPublicar.ts` arma `byObjective` con **cualquier** doc de `servicios_sla` del objetivo y avisa si `operationVerdict === 'OUT'`, sin exigir SLA vigente (activo, no cerrado) en el mes. `e12a5f0f` (una por objetivo-mes) no cambia este universo. Ma?ana `vistaHeredada` las har? nacer ATENDIDA (mismo texto), pero el ruido sigue en el contador. **Fix de c?digo pendiente.** |
| `RELEVO_AUTOMATICO` ?5, `RELEVO_PROGRAMADO` ?1, `INGRESO_AUTOREGISTRO` ?12, `LLEGADA_TARDE` ?12 | Consistentes con los turnos. | ? |

## Script de datos

`scripts/fix-auditoria-cc-2026-10-01.mjs` (dryRun por defecto; `--apply --allow-prod` solo con OK de Mauro):

1. `turnos/VvAYzVRtAL3s4Hsa5rHQ` (GARCIA 01/10): `isRetention: false`, `retentionEndedAt = realEndTime (15:59:00)`, `retentionMinutes: 29`, `completionReason: 'CHECKOUT_OPERADOR'`.
2. `turnos/boLe2gSh4mEhKFW7QCN9` (GARCIA 30/09): ?dem, `retentionEndedAt 15:34:22`, `retentionMinutes: 4`.
3. `sla_huecos_sin_plan/gap_?_puesto_1_2026-10-02_M3` y `gap_?_puesto_2_2026-10-02_T`: `status: 'CLOSED'`, `closedReason: 'SLA_NO_VIGENTE'`.

Cada patch lleva `correctedBy: 'fix-auditoria-cc-2026-10-01'` y `correctionNote`.

## Backlog de c?digo (sin tocar en esta rama)

- [ ] `useOperacionesMonitor.handleAction('CHECKOUT')` (escritorio y celular): si el turno est? retenido, cerrar con `isRetention: false`, `retentionEndedAt`, `retentionMinutes` (espejo de `buildAutoClosePatch`), o mover la salida manual a una callable.
- [ ] `detectPublishedSlaGaps.ts`: solo SLA vigentes en el d?a (`closed !== true`, `startDate ? d?a ? endDate`).
- [ ] `avisoCronogramaSinPublicar.ts`: avisar solo si el objetivo tiene SLA vigente (activo, no cerrado, cliente activo) para ?ma?ana?; tomar `objectiveName` del SLA vigente.
- [ ] `autoCompletarTurnosCore.ts` ~660: refrescar `retentionReason` desde el doc de `retentionAbsenceShiftId` cuando existe.
- [ ] `revertirAusencia`: limpiar `vacancyCreatedForAbsence` / `vacancyOrigin` al revertir (cosm?tico).
- [ ] Verificar el 02/10 (primer d?a con FIFO en prod): Puesto 2 M?2?T?2 y M2?2?T2?2 de Peaje.
