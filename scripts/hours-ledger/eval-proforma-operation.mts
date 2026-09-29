/**
 * Prefactura: solo objetivos en operación (classifySlaBucket).
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-proforma-operation.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { splitHoursByOperation, inOperationObjectiveIds } from './slaPolicy.ts';
import { buildInOperationObjectiveIds } from '../../apps/web2/src/lib/crm/proformaOperation.ts';
import { executedBillableHoursByFranja } from '../../apps/web2/src/lib/crm/executedBillableHoursByFranja.ts';
import { sumPlannedHoursForTurnos } from '../../apps/web2/src/lib/crm/plannedHours.ts';

const unitIn = inOperationObjectiveIds(new Map([
  ['edif', ['active']],
  ['demo', ['withoutPlan']],
  ['cerrado', ['closed']],
]));
const unitSplit = splitHoursByOperation({ edif: 100, demo: 40, cerrado: 10, '': 5 }, unitIn);
if (unitSplit.billed !== 110 || unitSplit.outside !== 45) {
  throw new Error(`split unitario ${JSON.stringify(unitSplit)}`);
}
const ids = buildInOperationObjectiveIds({
  slas: [
    { objectiveId: 'ixCsoxfuwwJdunzXVxvq', status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-12-31', clientId: 'banco' },
    { objectiveId: 'demo', status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-12-31', clientId: 'banco' },
    { objectiveId: 'viejo', status: 'ACTIVE', closed: true, startDate: '2026-01-01', endDate: '2026-07-31', clientId: 'banco' },
  ],
  year: 2026,
  monthIndex0: 8,
  publishedObjectiveIds: new Set(['ixCsoxfuwwJdunzXVxvq']),
  clientStatusById: new Map([['banco', 'ACTIVE']]),
});
if (ids.size !== 1 || !ids.has('ixCsoxfuwwJdunzXVxvq')) {
  throw new Error(`universo ${[...ids].join(',')}`);
}
console.log('UNIT_OK', unitSplit);

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
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

const slaIds = ['ixCsoxfuwwJdunzXVxvq', '6odnoyrOlHSxjtbML6kC'];
const slaDocs = await Promise.all(slaIds.map((id) => db.collection('servicios_sla').doc(id).get()));
const clientId = String(slaDocs.find((d) => d.exists)?.data()?.clientId || '');
if (!clientId) throw new Error('sin clientId en los SLA del Banco');
const client = await db.collection('clients').doc(clientId).get();
const slas = (await db.collection('servicios_sla').where('clientId', '==', clientId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const objetivos = new Set<string>();
for (const s of slas) if (s.objectiveId) objetivos.add(String(s.objectiveId));
for (const o of client.data()?.objetivos || []) {
  const id = String(o?.id || o?.objectiveId || '').trim();
  if (id) objetivos.add(id);
}
const published = new Set<string>();
await Promise.all([...objetivos].map(async (oid) => {
  const id = `pruebas_sa_${oid}_2026_9`;
  const docu = await db.collection('planificacion_estados').doc(id).get();
  const data = docu.exists ? docu.data() : null;
  if (data?.publishedAt != null && data.publishedAt !== '') published.add(oid);
}));
const inOperation = buildInOperationObjectiveIds({
  slas,
  year: 2026,
  monthIndex0: 8,
  publishedObjectiveIds: published,
  clientStatusById: new Map([[clientId, client.data()?.status]]),
});
const start = new Date('2026-09-01T00:00:00.000-03:00');
const end = new Date('2026-09-30T23:59:59.999-03:00');
const turnosSnap = await db.collection('turnos')
  .where('empresaId', '==', 'pruebas_sa')
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
  .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
  .get();
const turnos = turnosSnap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((t) => objetivos.has(String(t.objectiveId || '')));
const franja = executedBillableHoursByFranja(turnos as any[], { startYmd: '2026-09-01', endYmd: '2026-09-30' });
const executed = splitHoursByOperation(franja.byObjectiveId, inOperation);
const plannedAll = sumPlannedHoursForTurnos(turnos, { start, end });
const plannedIn = sumPlannedHoursForTurnos(
  turnos.filter((t) => inOperation.has(String(t.objectiveId || ''))),
  { start, end },
);
const names = [...inOperation].map((id) => {
  const sla = slas.find((s) => String(s.objectiveId) === id);
  return `${sla?.objectiveName || id} (${id}) sla=${sla?.id}`;
});
const byObj = new Map<string, { n: number; name: string }>();
for (const t of turnos) {
  const id = String(t.objectiveId || '');
  const row = byObj.get(id) || { n: 0, name: String(t.objectiveName || '') };
  row.n += 1;
  byObj.set(id, row);
}
const top = [...byObj.entries()]
  .map(([id, row]) => ({ id, name: row.name, turnos: row.n, ejec: franja.byObjectiveId[id] || 0, inOp: inOperation.has(id) }))
  .sort((a, b) => b.turnos - a.turnos);
console.log('POR_OBJETIVO', JSON.stringify(top, null, 2));
console.log(JSON.stringify({
  client: client.data()?.name || clientId,
  antes: { ejecutado: Math.round(franja.totalBillable * 10) / 10, planificado: Math.round(plannedAll * 10) / 10, turnos: turnos.length },
  despues: { ejecutado: executed.billed, planificado: Math.round(plannedIn * 10) / 10, fueraEjec: executed.outside, fueraPlan: Math.round((plannedAll - plannedIn) * 10) / 10 },
  enOperacion: names,
}, null, 2));
const slaObjectiveIds = slaDocs.map((d) => String(d.data()?.objectiveId || '')).sort();
if ([...inOperation].sort().join() !== slaObjectiveIds.join()) {
  throw new Error(`en operación ${[...inOperation].join(',')} != SLA ${slaObjectiveIds.join(',')}`);
}
const fueraTurnos = turnos.filter((t) => !inOperation.has(String(t.objectiveId || ''))).length;
if (executed.outside <= 0 && fueraTurnos > 0) {
  console.log('FUERA_TURNOS_SIN_HORAS', fueraTurnos);
}
console.log('BANCO_OK');
