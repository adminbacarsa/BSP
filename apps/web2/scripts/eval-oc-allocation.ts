/**
 * Smoke: tope de orden de compra por tipo (GENERAL / POR_OBJETIVO / BOLSA) en la prefactura.
 * Ejecutar: npm run eval:oc-allocation (desde apps/web2)
 */
import {
  allocatePurchaseOrder,
  authorizedHoursForObjective,
  BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE,
  ocConsumptionLevel,
  purchaseOrderTotalHours,
  resolvePurchaseOrderKind,
} from '../src/lib/crm/purchaseOrderAllocation';
import { buildProformaBillingRows } from '../src/lib/crm/slaBilling';
import type { PurchaseOrder } from '../src/lib/crm/slaBilling.types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, `${msg}: esperado ${String(expected)}, obtenido ${String(actual)}`);
}

const base: Omit<PurchaseOrder, 'id' | 'kind' | 'lines' | 'authorizedHours'> = {
  empresaId: 'bacarsa',
  clientId: 'c1',
  ocNumber: 'OC-1',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  status: 'ACTIVE',
};

// --- Tipo legacy (sin kind) ---
eq(resolvePurchaseOrderKind({}), 'GENERAL', 'legacy sin líneas = GENERAL');
eq(resolvePurchaseOrderKind({ lines: [{ objectiveId: 'a', authorizedHours: 10 }] }), 'POR_OBJETIVO', 'legacy con líneas = POR_OBJETIVO');

// --- GENERAL: tope único compartido ---
const general: PurchaseOrder = { ...base, id: 'g', kind: 'GENERAL', authorizedHours: 1000 };
eq(purchaseOrderTotalHours(general), 1000, 'GENERAL total');
eq(authorizedHoursForObjective(general, 'a'), 1000, 'GENERAL tope por objetivo = total');
{
  const s = allocatePurchaseOrder(general, [
    { objectiveId: 'b', prestadoHours: 700 },
    { objectiveId: 'a', prestadoHours: 600 },
  ]);
  eq(s.consumedHours, 1300, 'GENERAL consumido');
  eq(s.billableHours, 1000, 'GENERAL facturable no supera el total');
  eq(s.balanceHours, 0, 'GENERAL saldo 0');
  eq(ocConsumptionLevel(s.ratio), 'full', 'GENERAL aviso 100 %');
  const a = s.byObjective.find((r) => r.objectiveId === 'a')!;
  const b = s.byObjective.find((r) => r.objectiveId === 'b')!;
  eq(a.billableHours, 600, 'GENERAL a entra completo (orden por objectiveId)');
  eq(b.billableHours, 400, 'GENERAL b toma el resto');
}
{
  const s = allocatePurchaseOrder(general, [{ objectiveId: 'a', prestadoHours: 850 }]);
  eq(ocConsumptionLevel(s.ratio), 'warn', 'GENERAL aviso 80 %');
  eq(s.balanceHours, 150, 'GENERAL saldo');
}
{
  const s = allocatePurchaseOrder({ ...general, authorizedHours: undefined }, [{ objectiveId: 'a', prestadoHours: 50 }]);
  eq(s.billableHours, 50, 'GENERAL sin techo factura todo');
  eq(s.totalHours, undefined, 'GENERAL sin techo');
}

// --- POR_OBJETIVO: total = suma de líneas ---
const porObjetivo: PurchaseOrder = {
  ...base,
  id: 'p',
  kind: 'POR_OBJETIVO',
  lines: [
    { objectiveId: 'a', authorizedHours: 100 },
    { objectiveId: 'b', authorizedHours: 200 },
  ],
};
eq(purchaseOrderTotalHours(porObjetivo), 300, 'POR_OBJETIVO total = suma');
eq(authorizedHoursForObjective(porObjetivo, 'b'), 200, 'POR_OBJETIVO tope de b');
eq(authorizedHoursForObjective(porObjetivo, 'zzz'), undefined, 'POR_OBJETIVO sin línea = sin tope (legacy)');
{
  const s = allocatePurchaseOrder(porObjetivo, [
    { objectiveId: 'a', prestadoHours: 150 },
    { objectiveId: 'b', prestadoHours: 50 },
  ]);
  const a = s.byObjective.find((r) => r.objectiveId === 'a')!;
  const b = s.byObjective.find((r) => r.objectiveId === 'b')!;
  eq(a.billableHours, 100, 'POR_OBJETIVO a topado en su línea');
  eq(b.billableHours, 50, 'POR_OBJETIVO b no toma lo de a');
  eq(b.balanceHours, 150, 'POR_OBJETIVO saldo b');
  eq(ocConsumptionLevel(a.ratio), 'full', 'POR_OBJETIVO aviso a');
  eq(s.billableHours, 150, 'POR_OBJETIVO facturable total');
}

// --- BOLSA: total fijo + asignación editable, lo sin asignar disponible ---
const bolsa: PurchaseOrder = {
  ...base,
  id: 'b',
  kind: 'BOLSA',
  authorizedHours: 12000,
  lines: [
    { objectiveId: 'a', authorizedHours: 5000 },
    { objectiveId: 'b', authorizedHours: 4000 },
  ],
};
eq(purchaseOrderTotalHours(bolsa), 12000, 'BOLSA total fijo');
{
  const s = allocatePurchaseOrder(bolsa, [
    { objectiveId: 'a', prestadoHours: 6000 },
    { objectiveId: 'b', prestadoHours: 3000 },
    { objectiveId: 'c', prestadoHours: 2500 },
  ]);
  eq(s.assignedHours, 9000, 'BOLSA asignado');
  const a = s.byObjective.find((r) => r.objectiveId === 'a')!;
  const b = s.byObjective.find((r) => r.objectiveId === 'b')!;
  const c = s.byObjective.find((r) => r.objectiveId === 'c')!;
  if (BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE) {
    eq(a.billableHours, 6000, 'BOLSA a usa 1000 de la bolsa');
    eq(a.fromUnassignedHours, 1000, 'BOLSA a tomado de sin asignar');
    eq(c.billableHours, 2000, 'BOLSA c (sin asignación) solo toma lo que queda sin asignar');
    eq(s.unassignedHours, 0, 'BOLSA sin asignar agotado');
    eq(s.billableHours, 11000, 'BOLSA facturable = 6000 + 3000 + 2000 (b deja 1000 sin usar)');
    assert(s.billableHours <= (s.totalHours ?? 0), 'BOLSA nunca supera el total');
    eq(s.balanceHours, 1000, 'BOLSA saldo total = asignación no usada de b');
  } else {
    eq(a.billableHours, 5000, 'BOLSA a topado en su asignación');
    eq(c.billableHours, 0, 'BOLSA c sin asignación no factura');
    eq(s.unassignedHours, 3000, 'BOLSA sin asignar intacto');
  }
  eq(b.billableHours, 3000, 'BOLSA b dentro de su asignación');
  eq(b.balanceHours, 1000, 'BOLSA saldo b');
  eq(ocConsumptionLevel(b.ratio), 'ok', 'BOLSA b sin aviso');
  eq(ocConsumptionLevel(a.ratio), 'full', 'BOLSA a aviso 100 %');
  eq(s.consumedHours, 11500, 'BOLSA consumido');
}
{
  const s = allocatePurchaseOrder(bolsa, [{ objectiveId: 'a', prestadoHours: 4100 }]);
  eq(ocConsumptionLevel(s.byObjective[0].ratio), 'warn', 'BOLSA aviso 80 % por objetivo');
  eq(s.unassignedHours, 3000, 'BOLSA sin asignar se conserva si nadie lo usa');
  eq(s.balanceHours, 7900, 'BOLSA saldo total');
}

// --- Integración con la prefactura ---
const slas = [
  { id: 's1', objectiveId: 'a', objectiveName: 'Alfa', billingMode: 'ORDEN_COMPRA', billingPurchaseOrderId: 'g' },
  { id: 's2', objectiveId: 'b', objectiveName: 'Beta', billingMode: 'ORDEN_COMPRA', billingPurchaseOrderId: 'g' },
  { id: 's3', objectiveId: 'c', objectiveName: 'Gamma', billingMode: 'PLANIFICADO' },
  { id: 's4', objectiveId: 'd', objectiveName: 'Delta', billingMode: 'FIJO', billingFixedMonthlyHours: 720 },
] as any[];
const input = {
  purchaseOrders: [general, bolsa],
  periodStartYmd: '2026-10-01',
  periodEndYmd: '2026-10-31',
  plannedByObjectiveId: { a: 800, b: 800, c: 300, d: 500 },
  plannedByObjectiveName: {},
  franjaByObjectiveId: { a: 600, b: 700, c: 250, d: 450 },
  franjaByObjectiveName: {},
};
{
  const rows = buildProformaBillingRows({ ...input, vigenteSlas: slas });
  const byId = new Map(rows.map((r) => [r.objectiveId, r]));
  eq(byId.get('a')!.billableHours, 600, 'prefactura GENERAL a');
  eq(byId.get('b')!.billableHours, 400, 'prefactura GENERAL b topado por el total compartido');
  eq(byId.get('b')!.ocKind, 'GENERAL', 'prefactura tipo OC en la fila');
  eq(byId.get('c')!.billableHours, 300, 'prefactura PLANIFICADO');
  eq(byId.get('d')!.billableHours, 720, 'prefactura FIJO');
}
{
  const rows = buildProformaBillingRows({ ...input, vigenteSlas: slas, modeOverride: 'ORDEN_COMPRA' });
  const byId = new Map(rows.map((r) => [r.objectiveId, r]));
  eq(byId.get('c')!.billingMode, 'ORDEN_COMPRA', 'override OC cambia el modo de la fila');
  eq(byId.get('c')!.billableHours, 250, 'override OC sin OC = ejecutado sin tope');
  eq(byId.get('c')!.ocId, undefined, 'override OC sin OC no inventa OC');
  eq(byId.get('a')!.billableHours, 600, 'override OC respeta la OC del contrato');
}
{
  const rows = buildProformaBillingRows({ ...input, vigenteSlas: slas, modeOverride: 'FIJO' });
  const byId = new Map(rows.map((r) => [r.objectiveId, r]));
  eq(byId.get('d')!.billableHours, 720, 'override FIJO usa las horas fijas del contrato');
  eq(byId.get('a')!.billableHours, 800, 'override FIJO sin horas fijas = planificado');
}
{
  const cancelled: PurchaseOrder = { ...general, status: 'CANCELLED' };
  const rows = buildProformaBillingRows({ ...input, purchaseOrders: [cancelled], vigenteSlas: slas.slice(0, 1) });
  eq(rows[0].ocId, undefined, 'OC anulada no tope');
  eq(rows[0].billableHours, 600, 'OC anulada factura ejecutado sin tope');
}

console.log('eval-oc-allocation OK');
