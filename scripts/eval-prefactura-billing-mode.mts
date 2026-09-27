/**
 * Prefactura — modo Auto por contrato (billingMode del SLA) con fallback al contrato comercial abierto.
 *
 * proformaMode arrastra el cliente Firebase (sin red en este eval), que exige una API key no vacía:
 *   $env:NEXT_PUBLIC_FIREBASE_API_KEY='AIzaEvalDummy'; $env:NEXT_PUBLIC_USE_EMULATOR='true'
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/eval-prefactura-billing-mode.mts
 */
import {
  autoBillingModeLabel,
  autoDetailUsesExecutedForObjective,
  billingModeToProformaDetailMode,
  buildProformaBillingRows,
  clientHasOpenCommercialContract,
  resolveClientDefaultProformaDetailMode,
  resolveSlaBillingMode,
} from '../apps/web2/src/lib/crm/slaBilling.ts';
import { resolveProformaDetailMode, turnoEligibleForProformaGrid } from '../apps/web2/src/lib/crm/proformaMode.ts';
import { buildProformaObjectiveGrids, buildProformaPositionGrids } from '../apps/web2/src/lib/crm/proformaGrid.ts';
import { executedBillableHoursByFranja } from '../apps/web2/src/lib/crm/executedBillableHoursByFranja.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'OK' : 'FALLA', `\t${label}\tesperado ${JSON.stringify(want)}\tobtenido ${JSON.stringify(got)}`);
  if (!ok) failed++;
};

const sla = (id: string, objectiveId: string, objectiveName: string, billingMode?: string) =>
  ({ id, objectiveId, objectiveName, billingMode, startDate: '2026-09-01', endDate: '2026-09-30' }) as any;

console.log('\nModo efectivo por contrato');
check('SLA sin billingMode + contrato comercial abierto → EJECUTADO', resolveSlaBillingMode(sla('s', 'o', 'O'), { clientHasOpenContract: true }), 'EJECUTADO');
check('SLA sin billingMode sin contrato abierto → PLANIFICADO', resolveSlaBillingMode(sla('s', 'o', 'O'), {}), 'PLANIFICADO');
check('SLA PLANIFICADO explícito gana al contrato abierto', resolveSlaBillingMode(sla('s', 'o', 'O', 'PLANIFICADO'), { clientHasOpenContract: true }), 'PLANIFICADO');
check('SLA FIJO explícito gana al contrato abierto', resolveSlaBillingMode(sla('s', 'o', 'O', 'FIJO'), { clientHasOpenContract: true }), 'FIJO');
check('billingMode null (Auto elegido en Servicios) + contrato abierto → EJECUTADO', resolveSlaBillingMode({ billingMode: null }, { clientHasOpenContract: true }), 'EJECUTADO');
check('billingMode null sin contrato abierto → PLANIFICADO', resolveSlaBillingMode({ billingMode: null }, {}), 'PLANIFICADO');
check('etiqueta Servicios con contrato abierto', autoBillingModeLabel({ clientHasOpenContract: true }), 'Auto: ejecutado (contrato abierto)');
check('etiqueta Servicios sin contrato abierto', autoBillingModeLabel({}), 'Auto: planificado');
check('ORDEN_COMPRA → detalle ejecutado', billingModeToProformaDetailMode('ORDEN_COMPRA'), 'executed');
check('FIJO → detalle planificado', billingModeToProformaDetailMode('FIJO'), 'planned');

console.log('\nContrato comercial abierto');
check('abierto activo cuenta', clientHasOpenCommercialContract([{ type: 'cerrado' }, { type: 'abierto' }]), true);
check('abierto dado de baja (INACTIVE) no cuenta', clientHasOpenCommercialContract([{ type: 'abierto', status: 'INACTIVE' }]), false);
check('sin contratos', clientHasOpenCommercialContract(undefined), false);

console.log('\nCliente mixto: cada objetivo sigue a su contrato');
const mixed = resolveClientDefaultProformaDetailMode(
  [sla('a', 'OBJ_A', 'Edificio', 'EJECUTADO'), sla('b', 'OBJ_B', 'Obrador', 'PLANIFICADO'), sla('c', 'OBJ_C', 'Peaje', 'ORDEN_COMPRA')],
  {},
);
check('mixed', mixed.mixed, true);
check('byObjectiveId', mixed.byObjectiveId, { OBJ_A: 'executed', OBJ_B: 'planned', OBJ_C: 'executed' });
check('turno de OBJ_A (Auto) → ejecutado', autoDetailUsesExecutedForObjective(mixed, 'OBJ_A', ''), true);
check('turno de OBJ_B (Auto) → planificado', autoDetailUsesExecutedForObjective(mixed, 'OBJ_B', ''), false);
check('turno sin objectiveId, por nombre "  peaje "', autoDetailUsesExecutedForObjective(mixed, '', '  peaje '), true);
check('objetivo sin SLA → modo del encabezado', autoDetailUsesExecutedForObjective(mixed, 'OBJ_X', 'Otro'), mixed.mode === 'executed');

const legacy = resolveClientDefaultProformaDetailMode([sla('a', 'OBJ_A', 'Edificio'), sla('b', 'OBJ_B', 'Obrador', 'PLANIFICADO')], { clientHasOpenContract: true });
check('fallback abierto: SLA sin modo → ejecutado; SLA explícito → planificado', legacy.byObjectiveId, { OBJ_A: 'executed', OBJ_B: 'planned' });
check('cliente abierto sin SLAs → encabezado ejecutado', resolveClientDefaultProformaDetailMode([], { clientHasOpenContract: true }).mode, 'executed');

console.log('\nGrilla Auto con resolver por turno');
const resolver = (t: any) => autoDetailUsesExecutedForObjective(mixed, t?.objectiveId, t?.objectiveName);
const turno = (objectiveId: string, fichado: boolean) => ({
  objectiveId,
  code: 'M',
  employeeId: 'E1',
  startTime: new Date('2026-09-25T09:00:00Z'),
  endTime: new Date('2026-09-25T17:00:00Z'),
  ...(fichado ? { realStartTime: new Date('2026-09-25T09:05:00Z'), realEndTime: new Date('2026-09-25T17:00:00Z') } : {}),
});
check('OBJ_A resuelve executed', resolveProformaDetailMode('auto', resolver, turno('OBJ_A', false)), 'executed');
check('OBJ_B resuelve planned', resolveProformaDetailMode('auto', resolver, turno('OBJ_B', false)), 'planned');
check('OBJ_A sin fichada no entra a la grilla ejecutada', turnoEligibleForProformaGrid(turno('OBJ_A', false), 'auto', resolver), false);
check('OBJ_A fichado entra', turnoEligibleForProformaGrid(turno('OBJ_A', true), 'auto', resolver), true);
check('OBJ_B sin fichada entra (planificado)', turnoEligibleForProformaGrid(turno('OBJ_B', false), 'auto', resolver), true);
check('override manual Planificado ignora el contrato', resolveProformaDetailMode('planned', resolver, turno('OBJ_A', false)), 'planned');

console.log('\nResumen de facturación por contrato');
const rows = buildProformaBillingRows({
  vigenteSlas: [sla('a', 'OBJ_A', 'Edificio'), sla('b', 'OBJ_B', 'Obrador', 'PLANIFICADO')],
  purchaseOrders: [],
  periodStartYmd: '2026-09-01',
  periodEndYmd: '2026-09-30',
  plannedByObjectiveId: { OBJ_A: 120, OBJ_B: 240 },
  plannedByObjectiveName: {},
  franjaByObjectiveId: { OBJ_A: 100, OBJ_B: 200 },
  franjaByObjectiveName: {},
  clientHasOpenContract: true,
});
check(
  'Edificio (sin modo, cliente abierto) factura franja; Obrador (PLANIFICADO) factura plan',
  rows.map((r) => [r.objectiveName, r.billingMode, r.billableHours]),
  [['Edificio', 'EJECUTADO', 100], ['Obrador', 'PLANIFICADO', 240]],
);

console.log('\nGrilla Ejecutado = contador por franja (Nuevo Edificio 25/09, docs reales anonimizados)');
{
  const realDay = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'edificio-nk-2026-09-25.json'), 'utf8'),
  ) as any[];
  const franja = executedBillableHoursByFranja(realDay, { startYmd: '2026-09-25', endYmd: '2026-09-25' });
  const gridOpts = {
    turnos: realDay,
    empMeta: {},
    start: new Date(2026, 8, 25, 0, 0, 0),
    end: new Date(2026, 8, 25, 23, 59, 59),
    useExecutedForAuto: false,
    executedFranja: franja,
  };
  const byEmp = buildProformaObjectiveGrids({ ...gridOpts, mode: 'executed' });
  const byPos = buildProformaPositionGrids({ ...gridOpts, mode: 'executed' });
  const empTotal = byEmp.reduce((a, g) => a + g.grandTotal.total, 0);
  const posTotal = byPos.reduce((a, g) => a + g.grandTotal.total, 0);
  const coverRow = byEmp[0]?.employees.find((e) => e.name === 'Guardia 07');
  console.log(`  contador ${franja.totalBillable} · grilla legajo ${empTotal} · grilla puesto ${posTotal}`);
  check('grilla por legajo = contador', Math.round(empTotal * 10) / 10, franja.totalBillable);
  check('grilla por puesto = contador', Math.round(posTotal * 10) / 10, franja.totalBillable);
  check('el FT que cubre aparece con sus 8 h (no como franco)', coverRow?.totalHours ?? 0, 8);
}

console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
