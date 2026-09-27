# Handoff a Plataforma — franja EJECUTADO a `@cosp/hours-core`

Rama origen: `cursor/prefactura-billing-modes` (prefactura). Rama destino: la de Plataforma (`cursor/hours-core-f1`).
Decisión de Mauro: la implementación canónica es `executedBillableHoursByFranja` (validada contra prod). Plataforma la mueve al paquete; la prefactura sigue importando la copia local hasta que el export esté en `main`.

## Qué se entrega

| Pieza | Ruta |
|-------|------|
| Módulo canónico | `apps/web2/src/lib/crm/executedBillableHoursByFranja.ts` |
| Fixture real (17 docs, Nuevo Edificio 25/09/2026) | `scripts/fixtures/edificio-nk-2026-09-25.json` |
| Eval (casos a–p) | `scripts/eval-executed-franja-example.mts` |
| Grilla Ejecutado = contador | `scripts/eval-prefactura-billing-mode.mts` (bloque final) |

Correr el eval (desde la raíz):

```powershell
npx tsx --tsconfig apps/web2/tsconfig.json scripts/eval-executed-franja-example.mts
```

Resultado esperado: `fallas: 0`. Prod (lectura, turnos por rango de `startTime`): Nuevo Edificio `NK1i1DUwlaDxC4Hn8QwJ` 25/09 = 12 franjas, 2 de 10 h, **100 h**; Obrador Malagueño Puesto 1 qty 4 = 32 h; Peaje 9 Norte = 32,3 h.

## Cómo moverlo

1. Copiar el archivo a `packages/hours-core/src/motors/puesto/executedBillableHoursByFranja.ts`.
2. Cambiar los dos imports (las dependencias ya existen en el paquete y son idénticas byte a byte a las de web2):
   - `./crmDateUtils` → `../crm/crmDateUtils`
   - `./fichadaHours` → `../crm/fichadaHours`
3. Exportar desde `packages/hours-core/src/index.ts`: `executedBillableHoursByFranja`, `coverageTargetShiftId`, `RETENTION_MAX_STINT_MS` y los tipos `FranjaShift`, `FranjaTitular`, `FranjaContribution`, `FranjaWindow`, `FranjaBucket`, `FranjaBillableResult`, `FranjaBillableOpts`.
4. Copiar el fixture y el eval al paquete (o apuntar el eval al export) y dejarlo en verde.
5. Cuando esté en `main`, la prefactura cambia el import en `apps/web2/src/pages/admin/crm/index.tsx` y el import de tipos en `apps/web2/src/lib/crm/proformaGrid.ts`, y se borra la copia local.

## Diferencias con `franjaDayBook` (hours-core-f1 @ 140fc9e8)

Ya coinciden: pedidas = ventana planificada del titular (cruza medianoche); cobertura sin salida real usa el fin planificado; FT es cobertura y no adicional; el vínculo cobertura→titular no usa `sourceShiftId`; qty > 1 = una franja por titular; titular o cobertura que se van antes se recortan a la salida real.

Difieren (manda la canónica):

1. **Tardanza.** `coverageWindow` en modo ejecutado arranca en `realStartTime`, así que el ingreso tarde descuenta horas, tanto de una cobertura como del propio titular (`puestoCoberturaHours({ titular, coverage: titular })`). Regla de Mauro: el atraso **no** se descuenta al cliente. En la canónica la cobertura presente llena la intersección planificada y solo se recorta si la **salida** real es anterior al fin planificado. Caso (g) del eval: 47 min tarde → 8 h.
2. **ESC y REF.** `NO_PEDIDAS_CODES` no los incluye: abren franja pedida y facturan. Regla de Mauro: ESC y REF no se facturan. Si cubrieron una ausencia, el doc ya es `ops_cov` y llena la franja del ausente. Además `coverageType: 'REFUERZO'` cae en `isPuestoClientExtra` (adicional al cliente); en la canónica el refuerzo vendible entra por solicitudes de refuerzo, no por el turno. Casos (h) e (i).
3. **Adicionales.** `franjaDayBook` suma TURA/RFZ/EVENTOS/`CLIENT_REQUEST` dentro del libro como `adicionalesCliente`. La canónica los deja afuera (RFZ, TURA y EV se facturan aparte en la prefactura). Si el consumidor solo usa `cubiertas`, el resultado es el mismo.
4. **Vínculo sin id.** `franjaDayBook` también asigna por heurística (FT del mismo puesto con titular ausente; doc de cobertura sin vínculo en el mismo puesto). La canónica vincula solo por `absenceShiftId` → `coveredShiftId` → `titularShiftId`. Con los datos de prod da igual; la heurística puede doble-contar si hay dos ausentes en el mismo puesto.
5. **Retenido y relevo (decisión de Mauro).** Los minutos sin nadie son descubiertos, salvo que los cubra un retenido del mismo puesto (turno con marca de retención: lo que se quedó después de su fin planificado, tope 12:59 h desde su ingreso) o el relevo que llegó antes de su inicio planificado. Cada tramo de un retenido/relevo cubre una sola franja. `franjaDayBook` no los contempla. Casos (k)–(o).
6. **Unión y atribución.** La canónica arma la unión de presencias en la ventana del titular (titular → coberturas → retenido → relevo), sin doble conteo, y devuelve por franja los aportes por legajo con sus tramos (`contributions`). La grilla Ejecutado de la prefactura se pinta con esos aportes, así grilla y contador suman lo mismo. `franjaDayBook` suma horas con tope en `buildFranjaDayBook` y guarda `quienes` sin tramos horarios.
7. **Forma de la API.** `buildPuestoFranjaDayBook` recibe un objetivo × día. La canónica recibe todos los turnos del período (cargados por rango de `startTime`, porque los `ops_cov` no tienen `scheduleDate`) y agrupa por objetivo | puesto | día | código. Redondeo: la canónica redondea a 0,1 al agregar por objetivo; `franjaDayBook`, a 0,01 por franja.

Pendiente para hours-core (decisión de Mauro):

- **Licencias en la malla.** Hoy, en las dos implementaciones, un turno V/L/E/A/PG de la malla abre franja pedida (queda descubierta). No cambia lo facturado, pero infla pedidas/descubiertas si el puesto se cubrió con otro turno planificado. En hours-core las pedidas tienen que salir del SLA (puestos × bandas vendidas), no de los turnos de la malla; eso lo resuelve.
