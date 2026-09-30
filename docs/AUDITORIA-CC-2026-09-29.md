# Auditoría Centro de Comando — pruebas_sa — 29/09/2026

Recorrido **solo lectura** de todo el día (hora AR) en `pruebas_sa`: 11 objetivos con cronograma publicado, 167 turnos, 26+ ausencias, 71 convocatorias, 115 `audit_logs`, 233 novedades, sesiones de operador y `empresas.modoDemoEnabled`. Cada evento se contrastó con las reglas de `CLAUDE.md` y `docs/PROMPT-COBERTURA-CC-FLUJOS.md`, teniendo en cuenta qué código estaba publicado a cada hora.

## Código publicado durante el día

| Hora AR | Deploy | Qué cambió |
|--------|--------|------------|
| 13:56 | P5f / P5g | Revertir hasta T+60; relevo por serie M→T→N |
| 14:23 | Plan | Planificación |
| 14:42 | Convocado / H2f | Fichada del convocado sin tardanza; libro de horas dirty |
| 15:01 | P8 | Eventos en el CC |
| ~17:40 | P9 | Saliente presente no desaparece; retención desde el fin planificado |
| ~19:45 | P9d–f | Aviso de serie en el modal de ingreso; una persona por FT; franco origen |

Estado de la sala: Demo **ON** 07:48, **OFF** ~12:00–17:32, **ON** desde 17:32. Sesiones Manual 07:50–08:08 y 09:30–17:32. Con Demo ON, `detectarAusencias` salta la empresa entera (las AA del día las puso el operador o el Demo).

## Tabla de casos

| # | Caso (turno · objetivo · hora) | Regla | Qué pasó | Causa | Estado |
|---|---|---|---|---|---|
| 1 | Herrante `Ju2eLw6HSJjjMQkOLjd8`, Rodriguez Giacom `R5MsjwU3eryItmbhRDbZ`, Palacios `RWZgEH7GQZFuDRwVqPsr` · T 16:00 · 16:30 | AA a T+30 sin aviso (`AUTO_T30`) | Sin AA a las 16:30; el operador los marcó a las 18:30. Venencia `eBVhk3s8yZQ8McSXG7C5` (T3 16–17, 1 h) sí tuvo AA 16:33 | `detectarAusencias` descartaba turnos con más de 6 h por delante (`endMs > now + 6h`): ningún turno de 8 h llegaba a AUTO_T30 | **Corregido** — `isAutoAbsenceSpanPlausible` (solo descarta docs > 13 h). E2E 83 |
| 2 | Herrante · 18:30 | Una cascada por hueco | 3 cascadas en paralelo: 3 convocatorias EXTEND a Araya + 15 FT | `iniciarCascadaCobertura` chequeaba PENDING sin transacción; trigger `onTurnoAbsenciaDetectada` + `marcarAusenciaOperaciones` + `gestionarVacantes` entraron juntos | **Corregido** — candado transaccional `cascadeLockAt` (90 s) en el titular. E2E 79 |
| 3 | Rodriguez Giacom · 18:30 | Una cascada por hueco | 2 EXTEND a Coronel | Ídem 2 | **Corregido** (mismo fix) |
| 4 | Barrios Carranza `v8jgluiyR1TUv6OLFSCe` · Obrador · 00:12–00:13 | Un broadcast FT por paso | Doble ola FT (ESCALATED por timeout y después REJECTED del Demo volvió a avanzar) | `avanzarCascadaOrPartialVacante` avanzaba con cualquier REJECTED | **Corregido** — `shouldAdvanceOnReject`: un REJECTED sobre ESCALATED no avanza. E2E 80 |
| 5 | Herrante · 18:30 | MARK_ABSENT idempotente | 5 clics del operador = 5 `audit_logs`, 6 docs en `ausencias`, 3 cascadas | El botón del CC volvía a llamar la callable y a escribir turno + `ausencias` desde el cliente en cada clic | **Corregido** — `markAbsentInFlight` en lista y map-view; si el servidor aplicó la AA el front no escribe. Datos: script dryRun (ausencias duplicadas → INACTIVE) |
| 6 | Farias `07pTJuDJ9El34iuBKtAW` · Peaje · M3 12–16 retenido por Venencia (T3 16–17) | Retener solo mientras dura el hueco | Siguió retenido hasta el checkout manual 20:28; debía cerrar 17:00 | `autoCompletarTurnosCore` rama `isRetention` solo cerraba por relevo o tope | **Corregido** — `FIN_HUECO_SIN_CONTINUIDAD` al fin del hueco si no hay franja siguiente (con franja siguiente sigue retenido). E2E 81–82 |
| 7 | Barrionuevo `AI23UprOLH90rrfIbdhI`, Yulitta, Luque, Moreno, Agostinelli · 14:56 | Relevo cierra al saliente a su hora planificada (15:00) | Cerrados 14:56 con la fichada del entrante | Pre-P9d: `registrarPresencia` desde Operaciones no programaba el cierre | **Legacy** (P9d 19:45 programa `relieveScheduledAt` también para OPERATIONS) |
| 8 | Baez `M` · Puesto 1 · 11:47 | Serie M→T→N | Relevado por Farias M3 | Pre-P5g (13:56) | **Legacy** |
| 9 | Garcia / Bosio / Cardo · 11:31 | Relevo del mismo puesto/serie | Relevos cruzados entre puestos | Pre-P5g | **Legacy** |
| 10 | Varios retenidos de la mañana | `retentionStartedAt` = fin planificado | Quedó en :09 (momento del cron) | Pre-P9 (17:40) | **Legacy** |
| 11 | Banega `O7u639G8qCuxxC8X1xzk` · Río Primero · 15:00 | Serie: T releva al M, no al M2 | Relevó a Molina M2; Coronel M quedó abierto (DATA_FIX 15:19 lo cerró). `relievedOutgoingShiftId` de Banega sigue apuntando a Molina | Pre-P5g / P9 | **Legacy** — dato a corregir (script dryRun) |
| 12 | Bustamante `97NGzkedXzZv7cBjtz3b` · Obrador · 00:12 | Franco origen queda F con `coverageUsed`; el FT real es el ops_cov | Franco quedó `code: FT`, `isFrancoTrabajado` | Pre-P9e | **Legacy** — dato a corregir (script dryRun) |
| 13 | Bazán `IyiwO0Dyh7LxBKXLkx7a` · 18:34 | Franco origen no se marca ausente ni vacante | Demo la marcó ausente; P9E_FIX quitó `isAbsent` pero siguió `SIN_COBERTURA`, `vacanteEscalada`, `code: FT` | Pre-P9e + fix parcial | **Legacy** — dato a corregir (script dryRun) |
| 14 | Gauna `JA5SV5Y3V32c6ycmyAA2` · NEC Playa · N 23–07 (28/09 23:08); Vitali `B5NOihOo6lk6KQIliFum` · Savio | Ext + Adel cubren el hueco completo por horario real | EXT PARTIAL con segmento fijo CCT; el FT siguiente dio `ALREADY_COVERED`; 03:00–07:00 sin cubrir → TOPE 03:59 + vacante | Segmentos Ext/Adel salían de la tabla por código (N = 19–23 / 23–07), no del HH:MM del titular; `applyCoverage` no admite FT sobre el resto de un PARTIAL | **Parcial** — segmentos ahora por horario real (N 23–07 → 23–03 / 03–07). E2E 85. FT sobre el segmento restante de un PARTIAL sigue **abierto** (diseño) |
| 15 | Garcia `aZhbhlA8TY9yHbI6TVRB` · 15:09 | Texto de retención | «no se presentó» cuando el relevo (15:30) todavía no era debido | Texto fijo de `RELEVO_NO_PRESENTADO` | **Abierto** (cosmético) |
| 16 | `tfYmFnHtl1FkxGekk7d0` · H. Oncológico Playa | Una representación por hueco (P3) | Hermano `VACANTE_CORRECCION` junto a Capdevila | Origen legacy previo a P3 | **Legacy** — `node scripts/dedupe-vacantes-hueco.mjs` |
| 17 | Novedades `VACANTE_PROTOCOLO` 08:08 Salón, 11:15 Peaje, 17:46 ×3 Obrador | El CC no escribe vacantes sintéticas | Novedades del front al abrir protocolo | Front legacy | **Abierto** (revisar si siguen apareciendo con el build actual) |
| 18 | Giupponi / Chavero · TOPE 03:59 → T 15:00 | 12 h de descanso | 11 h entre cierre por tope y el siguiente turno | Planificación, no cobertura | **Abierto** (planificación) |
| 19 | Vacantes creadas 21–24 AR | Destino Planificación/Operaciones en calendario AR | `onGuardAbsenceDetected` / `onVacanteCorrectionCreated` comparaban con el día UTC y la hora del servidor: a las 22 AR «hoy» ya era mañana | Fechas UTC | **Corregido** — `vacancyActionTargetAr` (arClock). E2E 86 |
| 20 | Aptitudes con vigencia = hoy, cascada 21–24 AR | Vigencia en calendario AR | `checkEligibility` usaba `toISOString()` (UTC) | Fecha UTC | **Corregido** |

## Backlog CC cerrado en esta rama

- **Convocatorias CC:** al **rechazar** («✗ Rechaza / No contesta»), al **aceptar por teléfono** y al **cerrar el protocolo** (X del panel o de la pestaña) se cancela la convocatoria PENDING en el servidor (`cancelarConvocatoriaCobertura`). Botón **Acepta** siempre visible (con convocatoria en app: «Acepta por teléfono (manual)»).
- **Cascada Auto en hora AR:** destino de la vacante y vigencia de aptitudes en calendario AR.
- **Prioridad EXT sobre retenido:** en la lista EXT el saliente ya retenido por ese hueco (`retentionAbsenceShiftId` = titular) va primero (`retainedForGap`). E2E 84.
- **Segmentos por horario HH:MM:** Ext = inicio → mitad, Adel = mitad → fin del hueco real (M/T conservan 11:00 / 19:00). E2E 85.

## Datos de pruebas_sa a corregir (lo aplica Mauro)

```
node scripts/fix-auditoria-cc-2026-09-29.mjs                       # dryRun
node scripts/fix-auditoria-cc-2026-09-29.mjs --apply --allow-prod  # aplica
```

Parches (9 en el dryRun del 30/09 00:10): Bazán y Bustamante → F + `coverageUsed`; Banega `relievedOutgoingShiftId` → Coronel; 6 `ausencias` duplicadas (5 Herrante, 1 Rodriguez Giacom) → `status: INACTIVE`.

## Pendientes de diseño

- FT (o cualquier tipo) sobre el **segmento restante** de un titular PARTIAL (`applyCoverage` hoy responde `ALREADY_COVERED`).
- Texto de retención cuando el relevo todavía no era debido.
- Con Demo ON, `detectarAusencias` salta toda la empresa: las AA automáticas dependen del Demo.
