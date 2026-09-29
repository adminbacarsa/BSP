# Eventos: Centro de Control, prefactura y eventuales

Análisis de cómo está hoy (sin cambiar ese código). Pedido de Mauro, septiembre 2026.

## Centro de Control hoy

Un turno es evento si `code === 'EV'` u `origin === 'EVENTO'`. Un `eventoId` suelto en un M/T/N no lo convierte en evento.

En el Centro de Control no entran a la tarjeta del objetivo. Salen del % de cobertura del puesto y se agrupan en una tarjeta ámbar por evento y servicio (`eventsWithAlerts` / `splitShiftsByEvent` en `operaciones/index.tsx`). Esa tarjeta usa la misma `GuardCard` que un puesto: se puede fichar, marcar ausente, hacer checkout y abrir el protocolo de cobertura a mano.

Lo que no iguala a un puesto:

- No mueven el KPI ni las vacantes del objetivo (se los saca antes de sumar).
- La ausencia automática, el aviso de llegada y la cascada de reemplazo están pensados para el puesto vendido. Un EV no abre solo el reemplazo ni convoca la bolsa.
- Si el guardia estaba en un puesto y se lo pasa a evento, el puesto original queda como vacante (`eventoAssignService`). El evento en sí no tiene dotación SLA que cubrir.
- El cron de cierre trata el EV como cualquier turno con horario, pero no hay relevo de franja del evento.

## Prefactura hoy

Dos caminos, y no son la liquidación:

1. **Puesto `coverageType: eventos`.** No vende ni cubre SLA. En Supervisión se imputan TURA (extensión) a ese puesto. La prefactura agrupa esas TURA por día del evento (`planningEventosExtras`). RFZ/TURA/EV no entran a la franja del SLA (`executedBillableHoursByFranja`).
2. **Turnos `code: EV`.** La prefactura del cliente los lista aparte, por evento y servicio, con el campo `hours` del turno (lo planificado), no con la fichada (`crm/index.tsx`). El PDF/CSV tiene un bloque «Total eventos».

Liquidar al guardia (esta rama) no factura el evento. El EV sigue en `OBJECTIVE_NON_BILLABLE_CODES`: no suma horas vendidas del objetivo.

## Qué falta

| Pieza | Hoy | Para quedar como un puesto |
| --- | --- | --- |
| Fichada | La tarjeta del evento la permite | Misma ventana T−15 / T+… y el mismo cierre servidor, con el horario del servicio del evento |
| Ausente | Solo si alguien lo marca en la tarjeta | T+30 y aviso de llegada sobre el EV, sin inventar vacante en el SLA del objetivo |
| Reemplazo | El protocolo se puede abrir a mano; la cascada no sale sola | Cascada del hueco del evento, candidatos de la bolsa, sin usar RET/REF del puesto vendido |
| Prefactura | Horas planificadas del EV, o TURA del puesto eventos | Facturar las horas del evento (fichadas si el modo es ejecutado; planificadas si es planificado), un solo concepto por día |
| Eventuales | No existe el módulo | Bolsa del grupo para cubrir esos huecos |

Cuidado de no pagar ni facturar dos veces: la TURA imputada al puesto eventos y el turno EV del mismo guardia y horario son el mismo trabajo. La liquidación ya no suma las dos si se pisan. La prefactura tiene que elegir una sola fuente.

## Propuesta por pasos

1. **Fichada del evento.** El portal y el CC fichan el EV con el horario del servicio. La liquidación (ya en esta rama) paga esa fichada en normales / 50 % / feriado / nocturnas y la muestra en el bucket Eventos.
2. **Ausencia del evento.** El cron de ausencias incluye el EV. Genera la novedad en la tarjeta del evento, no una vacante del SLA.
3. **Reemplazo.** Desde esa ausencia, el CC abre el mismo protocolo (retener no aplica al evento; sigue REF/ESC del grupo, ext/adel y FT). Al cubrir, se escribe un EV del reemplazo, no un turno del puesto.
4. **Prefactura única.** Un renglón por día de evento: horas del EV fichado (o del plan, según el modo). Si ese tramo ya está como TURA del puesto eventos, no se vuelve a facturar.
5. **Eventuales.** Módulo nuevo: bolsa de horas del grupo, gente sin puesto fijo. El paso 3 los ofrece primeros para cubrir el evento. No venden SLA. Lo que trabajan se liquida como EV y se factura en el renglón del paso 4.
