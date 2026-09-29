/**
 * H2e — facturable según el modo del contrato. Solo lectura (pruebas_sa, septiembre 2026).
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-h2e-facturado.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  billableGaps,
  billableHoursForContract,
  buildProformaBillingRows,
  prorateFixedMonthlyHours,
} from '../../apps/web2/src/lib/crm/slaBilling.ts';
import { allocatePurchaseOrder } from '../../apps/web2/src/lib/crm/purchaseOrderAllocation.ts';
import type { PurchaseOrder } from '../../apps/web2/src/lib/crm/slaBilling.types.ts';

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'h2-readonly';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';
delete process.env.FIRESTORE_EMULATOR_HOST;

const repo = path.resolve('C:/APP/cronoapp-planificacion');
const requireFn = createRequire(path.join(repo, 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
const deny = (what: string) => function denied() { throw new Error(`escritura bloqueada (${what})`); };
for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
CollectionReference.prototype.add = deny('add');
WriteBatch.prototype.commit = deny('batch');
Firestore.prototype.runTransaction = deny('tx');
Firestore.prototype.recursiveDelete = deny('recursiveDelete');

const { buildLedgerMonth, applyBillableOnRows } = await import('./engineEntry.ts');

const fijo = prorateFixedMonthlyHours(300, '2026-09-16', '2026-09-30', '2026-09-01', '2026-09-30');
if (fijo !== 150) throw new Error(`FIJO prorrateado ${fijo} != 150`);
const ej = billableHoursForContract({
  mode: 'EJECUTADO', planHours: 80, coveredHours: 40,
  periodStartYmd: '2026-09-01', periodEndYmd: '2026-09-30',
});
if (ej.billableHours !== 40) throw new Error('EJECUTADO debe facturar cubiertas');

const ocBase = { empresaId: 'x', clientId: 'c', ocNumber: 'OC', startDate: '2026-09-01', endDate: '2026-09-30', status: 'ACTIVE' as const };
const ocCases: Array<{ oc: PurchaseOrder; expect: Record<string, number> }> = [
  { oc: { ...ocBase, id: 'g', kind: 'GENERAL', authorizedHours: 1000 }, expect: { a: 600, b: 400 } },
  { oc: { ...ocBase, id: 'p', kind: 'POR_OBJETIVO', lines: [{ objectiveId: 'a', authorizedHours: 100 }, { objectiveId: 'b', authorizedHours: 900 }] }, expect: { a: 100, b: 700 } },
  { oc: { ...ocBase, id: 'b', kind: 'BOLSA', authorizedHours: 900, lines: [{ objectiveId: 'a', authorizedHours: 300 }, { objectiveId: 'b', authorizedHours: 300 }] }, expect: { a: 600, b: 300 } },
];
const demands = [{ objectiveId: 'a', prestadoHours: 600 }, { objectiveId: 'b', prestadoHours: 700 }];
for (const { oc, expect } of ocCases) {
  const alloc = allocatePurchaseOrder(oc, demands);
  const ledgerRows = demands.map((d) => ({
    objectiveId: d.objectiveId, periodKey: '2026-09', billingMode: 'ORDEN_COMPRA',
    covered: d.prestadoHours, worked: d.prestadoHours, billingPurchaseOrderId: oc.id,
  }));
  applyBillableOnRows(ledgerRows, [oc]);
  const proforma = buildProformaBillingRows({
    vigenteSlas: demands.map((d) => ({ id: `s_${d.objectiveId}`, objectiveId: d.objectiveId, objectiveName: d.objectiveId, billingMode: 'ORDEN_COMPRA', billingPurchaseOrderId: oc.id })) as any[],
    purchaseOrders: [oc],
    periodStartYmd: '2026-09-01',
    periodEndYmd: '2026-09-30',
    plannedByObjectiveId: {},
    plannedByObjectiveName: {},
    franjaByObjectiveId: Object.fromEntries(demands.map((d) => [d.objectiveId, d.prestadoHours])),
    franjaByObjectiveName: {},
  });
  for (const d of demands) {
    const direct = billableHoursForContract({
      mode: 'ORDEN_COMPRA', planHours: 0, coveredHours: d.prestadoHours,
      periodStartYmd: '2026-09-01', periodEndYmd: '2026-09-30',
      purchaseOrder: oc, objectiveId: d.objectiveId, ocDemands: demands,
    }).billableHours;
    const fromAlloc = alloc.byObjective.find((r) => r.objectiveId === d.objectiveId)!.billableHours;
    const fromLedger = ledgerRows.find((r) => r.objectiveId === d.objectiveId)!.billable;
    const fromProforma = proforma.find((r) => r.objectiveId === d.objectiveId)!.billableHours;
    const want = expect[d.objectiveId];
    if (![direct, fromAlloc, fromLedger, fromProforma].every((v) => v === want)) {
      throw new Error(`OC ${oc.kind} ${d.objectiveId}: contrato ${direct} reparto ${fromAlloc} libro ${fromLedger} prefactura ${fromProforma} != ${want}`);
    }
  }
}
const gaps = billableGaps(50, 25);
if (gaps.workedNotBilled !== 25 || gaps.billedNotWorked !== 0) throw new Error('gaps');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const empresaId = 'pruebas_sa';
const year = 2026;
const month = 9;
const start = new Date('2026-09-01T00:00:00.000-03:00');
const end = new Date('2026-09-30T23:59:59.999-03:00');

function publishMap(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const map: Record<string, boolean> = {};
  for (const d of docs) {
    const data = d.data();
    if (data.publishedAt == null || data.publishedAt === '') continue;
    const idMatch = d.id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
    const oid = String(data.objectiveId || data.objetivoId || idMatch?.[1] || '').trim();
    const y = Number(data.year ?? data.año ?? idMatch?.[2]);
    const mo = Number(data.month ?? data.mes ?? idMatch?.[3]);
    if (oid && Number.isFinite(y) && Number.isFinite(mo)) map[`${oid}_${y}_${mo}`] = true;
  }
  return map;
}

const [empresaSnap, clientsSnap, slaSnap, planifSnap, empSnap, ausSnap, contractsSnap, ordersSnap, turnosSnap] = await Promise.all([
  db.collection('empresas').doc(empresaId).get(),
  db.collection('clients').where('empresaId', '==', empresaId).get(),
  db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
  db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
  db.collection('empleados').where('empresaId', '==', empresaId).get(),
  db.collection('ausencias').where('empresaId', '==', empresaId).get(),
  db.collection('contracts').get(),
  db.collection('ordenes_compra').where('empresaId', '==', empresaId).get(),
  db.collection('turnos').where('empresaId', '==', empresaId)
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end)).get(),
]);

const clientIds = new Set(clientsSnap.docs.map((d) => d.id));
const empNameById: Record<string, string> = {};
empSnap.docs.forEach((d) => {
  const e = d.data();
  const st = String(e.status || '').toLowerCase();
  if (st === 'inactive' || st === 'inactivo') return;
  empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
});

const built = buildLedgerMonth({
  empresaId, year, month,
  hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
  clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  empNameById,
  contracts: contractsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => clientIds.has(String((c as { clientId?: string }).clientId || ''))),
  purchaseOrders: ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
});

const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const empresa = built.monthly.find((m) => m.level === 'empresa')!;
const nk = built.monthly.find((m) => m.level === 'objetivo' && m.objectiveId === 'NK1i1DUwlaDxC4Hn8QwJ');
if (!nk || nk.planPublished !== 2760) throw new Error(`plan publicado Nuevo Edificio en el libro ${nk?.planPublished} != 2760`);
const nkDays = built.days.filter((d: any) => d.objectiveId === 'NK1i1DUwlaDxC4Hn8QwJ');
const nkDaysPlan = r1(nkDays.reduce((a: number, d: any) => a + (Number(d.planPublished) || 0), 0));
if (nkDaysPlan !== 2760) throw new Error(`plan publicado Nuevo Edificio por día ${nkDaysPlan} != 2760`);
console.log('NK_LIBRO_PLAN', nk.planPublished, 'dias', nkDaysPlan);
const objs = built.monthly.filter((m) => m.level === 'objetivo' && m.billingMode);
const clients = built.monthly.filter((m) => m.level === 'cliente');

for (const m of objs) {
  const g = billableGaps(m.worked, m.billable);
  if (Math.abs(g.workedNotBilled - m.workedNotBilled) > 0.05 || Math.abs(g.billedNotWorked - m.billedNotWorked) > 0.05) {
    throw new Error(`gaps ${m.objectiveName}: ${m.workedNotBilled}/${m.billedNotWorked} vs ${g.workedNotBilled}/${g.billedNotWorked}`);
  }
}
const sum = (k: 'billable' | 'workedNotBilled' | 'billedNotWorked') => r1(objs.reduce((a, m) => a + (Number(m[k]) || 0), 0));
if (Math.abs(sum('billable') - empresa.billable) > 1) throw new Error(`billable empresa ${empresa.billable} != objetivos ${sum('billable')}`);
if (Math.abs(sum('workedNotBilled') - empresa.workedNotBilled) > 1) throw new Error('workedNotBilled no suma');
if (Math.abs(sum('billedNotWorked') - empresa.billedNotWorked) > 1) throw new Error('billedNotWorked no suma');
if (Math.abs(empresa.covered + empresa.uncovered - empresa.slaActive) > 1) throw new Error('covered+uncovered != SLA');

console.log('INVARIANTS_OK', JSON.stringify({
  billable: empresa.billable,
  worked: empresa.worked,
  workedNotBilled: empresa.workedNotBilled,
  billedNotWorked: empresa.billedNotWorked,
  objetivos: objs.length,
}));
console.log('TABLA_H2E');
console.log(['cliente', 'sla', 'prestado', 'facturable', 'trabNoFact', 'factNoTrab'].join('\t'));
for (const c of clients.sort((a, b) => b.workedNotBilled - a.workedNotBilled).slice(0, 12)) {
  console.log([c.clientName || c.clientId, c.slaActive, c.worked, c.billable, c.workedNotBilled, c.billedNotWorked].join('\t'));
}
console.log('H2E_OK');
