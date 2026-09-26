# Horas — divergencias vigentes y delta Fase 1

Anexo de Fase 0. Los motores en `packages/hours-core` son copia de los consumidores (eval 0 diferencias). Este documento no unifica fórmulas: registra números distintos entre libros y el movimiento esperado cuando se aplique Fase 1.

Empaquetado Functions: `scripts/sync-hours-core-to-functions.mjs` copia el paquete a `apps/functions/vendor/hours-core` (gitignored) y compila `dist`. `apps/functions` declara `"@cosp/hours-core": "file:./vendor/hours-core"` y `prebuild` corre el sync antes de `tsc`. Firebase solo sube `apps/functions`; el vendor viaja adentro. No resolver `../../packages` en runtime.

## Regla de períodos — no mezclar

| Libro | Consumidor | Ventana |
| --- | --- | --- |
| PERSONA | Reportes → Liquidación, `payrollApi` | Ciclo CCT: día **26** del mes anterior al **25** del mes de cierre (`apps/web2/src/lib/cctPayrollPeriod.ts`, `apps/functions/src/payroll-api/cycle.ts`) |
| PUESTO | Prefactura, SLA vendido, KPIs mensuales | Mes calendario **1 … último día** |

Consecuencias:

- El libro guarda detalle **por día**. El total es una agregación del consumidor. No hay un único “total del mes” como fuente.
- El id de documento puede ser mes calendario. Liquidación / API leen **dos** docs: días 26…fin del mes anterior + 1…25 del mes de cierre.
- Congelado independiente: cerrar el ciclo 26→25 no congela la prefactura calendario, y al revés.

`calculateLiquidationHoursStats` **no recibe período**. Suma los turnos que ya le pasaron. Quién recorta es el fetch:

- `useReportes` inicializa `dateRange` con `getCctPayrollPeriodByOffset(0)` (`apps/web2/src/hooks/useReportes.ts`).
- `generateReports` arma `startDate`/`endDate` locales (`T00:00:00` … `T23:59:59.999`) y `fetchReportTurnos` filtra `startTime` en ese rango **antes** de la calculadora.

Ejemplo medido (mismo pool de 7 turnos M de 8 h, fichados). El motor sin recorte da **56 h**. Con filtro previo:

| Ventana | Días | Horas reales |
| --- | --- | --- |
| CCT cierre mayo 2026 (`2026-04-26` → `2026-05-25`) | 26/04, 10/05, 25/05 | **24** |
| Calendario mayo 2026 (`2026-05-01` → `2026-05-31`) | 10/05, 25/05, 26/05, 31/05 | **32** |

Solo CCT: **2026-04-26**. Solo calendario: **2026-05-26** y **2026-05-31**. Fase 1 no debe hacer que la prefactura adopte el ciclo CCT ni que la liquidación adopte el mes 1…fin.

## §4 Divergencias actuales (mismo hecho, número distinto)

Fixtures corridos por `eval:hours-core` (bloque informativo). Legacy y paquete coinciden; lo que diverge es el consumidor.

### Plan coalesce vs billable CRM / SLA

Turno M 07:00–15:00 extendido hasta 19:00 (`segmentFromTime` 15:00, `segmentToTime` 19:00, `extExtraHours` 4, `hours` 8):

| Función | Horas |
| --- | --- |
| `calcPlanningBillableShiftHours` (base + extra) | **12** |
| `calcPlanningSlaReconciliationHours` (cierra contra vendidas, sin tramo extra) | **8** |

Celda legajo×día con dos docs:

| Celda | `coalescePlannedCellBillableHours` hoy |
| --- | --- |
| M `hours: 8` + segundo doc M `hours: 8` e `isExtended` | **16** |
| M `hours: 8` + doc tramo `hours: 4` + segmento 15:00–19:00 | **20** (suma 8 + 12) |

El canon de persona es **12** (8 + 4 una sola vez), nunca 16 ni 20.

### Fichada 8/12 vs reloj vs clamp de liquidación

M presente: `fichadaHoursForShift` = **8** (banda). D12 completado = **12**. El mismo M fichado 07:04–15:10 sigue en **8** (no usa el reloj). Reloj puro de ese par = **8,1 h**. Prefactura EJECUTADO hoy pisa la celda con ese reloj (`proformaGrid.ts`, rama `useExecuted && realStart && realEnd`).

### Payroll ±5 min vs liquidación (retención / adelanto / relevo)

Mismo turno plan 07:00–15:00:

| Caso | Liquidación `horasReales` | payrollApi `hsReales` (±5 min) |
| --- | --- | --- |
| Adelanto autorizado 06:00–15:00 (`isEarlyStart`) | **9** | **8** (entrada temprana siempre cae dentro de +5 y vuelve al plan) |
| Retención 3 min, salida 15:03 (`isRetention`) | **8,05** | **8** (3 ≤ 5 → clamp al plan) |
| Relevo anticipado, salida 14:30 | **8** (salida antes del plan = jornada completa) | **7,5** |

### Noche: reloj local vs Argentina

Turno 22:00–06:00 ART (8 h):

| Motor | Nocturnas |
| --- | --- |
| `calcTurnoHoursContrib` en esta PC (TZ Argentina, `Date#getHours`) | **8** |
| `accumulatePayrollTurnoContribution` (resta 3 h, hora UTC = ART) | **8** |
| El mismo algoritmo de `turnoHoursCalc` si el proceso está en **UTC** (`getUTCHours` sobre el mismo instante) | **5** |

En Cloud Functions el proceso es UTC: persona/payroll en ART no se mueven; `turnoHoursCalc` sí.

### `turnoHoursCalc` vs payroll (FT)

FT 07:00–15:00 fichado:

| Motor | `al100FT` | `hsReales` |
| --- | --- | --- |
| `calcTurnoHoursContrib` (FT está en no-trabajo → aporte cero) | **0** | **0** |
| payrollApi | **8** | **0** |

### Techo 200 vs 204

26 jornadas de 8 h = **208** trabajadas:

| Cálculo | Simples | Excedente 50 % |
| --- | --- | --- |
| `calculateLiquidationHoursStats` (`baseLimit = 204`) | **204** | **4** |
| `liquidacion200FromWorkedHours(208)` y comentario de payrollApi | **200** | **8** |
| `analisisBolsa` `CCT_HS_TECHO_MENSUAL` | **200** | (ya es el techo; no usa 204) |

## Delta esperado Fase 1

Canónicos confirmados por Mauro. El número de abajo es el movimiento **antes** de aplicar el código. Fase 0 no lo aplica.

### Libro PERSONA (Liquidación / API)

Total principal = plan + EXT/ADV/cobertura/FT (M 07–15 + ext hasta 19 = **12**). Motor = `calculateStatsExact` (clamp a banda, retención, adelanto, FT). Techo **200**. Ajuste a banda planificada; por encima solo EXT/ADV/ops_cov autorizada, FT, TURA, RFZ. Celda una vez. Planificadas = columna de seguimiento. Novedades en columna aparte (`rrhh.*`), no suman a trabajadas.

- **useReportes / `calculateLiquidationHoursStats`:** el clamp de persona ya es la base. Techo **204 → 200** (208 h: simples 204→200, extra50 4→8). Celda duplicada que hoy puede entrar como 16 o 20 pasa a **12** (coalesce + un solo tramo). Novedades siguen fuera de trabajadas.
- **payrollApi:** el ciclo ya es 26→25 (sin cambio de ventana). Las horas se mueven al clamp de Liquidación: adelanto **8 → 9**, retención 3 min **8 → 8,05**, relevo anticipado **7,5 → 8**. Techo ya documentado en 200; no pasa a 204. Novedades siguen en `rrhh.*`.
- **`calcTurnoHoursContrib`:** pasa al mismo motor persona. FT **0 → 8** en al 100 %. Noche en servidor UTC **5 → 8** (reloj ART, igual que payroll/Liquidación). ±5 min se reemplaza por retención/adelanto (mismos deltas que payroll). `isCompleted` deja de ser la única puerta si Liquidación cuenta la fichada con otra regla; el número de horas trabajadas queda el de Reportes.
- **`liquidacion200FromWorkedHours` / bolsa de payroll:** ya parten de 200. Sin cambio de techo.
- **analisisBolsa:** techo ya es **200**. Sin cambio de techo. No adopta el ciclo CCT: capacidad y KPIs mensuales siguen en mes calendario.
- **CRM fichada (banda 8/12):** no es el total de persona. Sigue siendo presencia por banda. El total de legajo en Liquidación puede subir por EXT/FT autorizados (8 de banda vs **12** con extensión) sin que la fichada de banda deje de mostrar 8.
- **Planificación `coalescePlannedCellBillableHours`:** celda duplicada **16 → 12** y tramo partido que hoy suma **20 → 12** cuando el hecho es una jornada de 8 + 4. Es seguimiento de plan, no el número principal de liquidación.
- **Servicios / reconciliación SLA (`calcPlanningSlaReconciliationHours`):** la jornada vendida de la franja sigue en **8**; el extra de cobertura por ausencia no infla lo vendido. Donde el informe sumaba la celda duplicada (16), baja a **12** solo si ese 4 h es adicional de cliente (TURA/refuerzo/evento). Si el extra cubre la franja del ausente, el puesto queda en **8**, no en 12.

### Libro PUESTO (prefactura)

Factura lo que el cliente pidió: franjas SLA cubiertas. Cada franja M/T/N cuenta como máximo sus horas pedidas (tope; nunca 8:04). Extensión por ausencia no suma al cliente: cubre la franja del ausente (T faltó, M extendió 4 h y otro cubrió 4 h → franja T = **8** una vez). Descubiertas = pedidas − cubiertas, descuento solo en modo EJECUTADO. Sí suma adicional de cliente: refuerzo, TURA/ext solicitada, eventos (`coverageType` eventos) en línea aparte. Guardar por franja×día: pedidas, cubiertas (quién/tipo), descubiertas, adicionalesCliente.

- **Prefactura EJECUTADO (`proformaGrid.ts` ~283–286):** deja el reloj puro. Ejemplo 07:04–15:10 hoy **8,1 h** → tope de franja **8**. No usa el clamp de persona (retención/adelanto del legajo no se factura). Extensión que solo cubre al ausente **no** suma horas de cliente. Refuerzo / TURA / evento sí, en línea aparte.
- **CRM Hs Plan:** columna de seguimiento del cronograma (banda + extra planificado). No es el total de prefactura ejecutada ni el total de liquidación. En Fase 1 no debe copiar el clamp de persona ni el reloj 8,1.
- **SLA vendido y KPIs mensuales:** siguen en mes calendario 1…fin. No se recalculan con el ciclo 26→25.

### Períodos en Fase 1

- PERSONA (Liquidación, payrollApi, `calcTurnoHoursContrib`): siguen agregando días **26→25**. Cambian las horas del día, no la ventana.
- PUESTO (prefactura, SLA, KPIs): siguen agregando **1…fin**. Cambian la regla de la franja (tope, sin extra por ausencia), no la ventana.
- Cerrar un libro no congela el otro.
