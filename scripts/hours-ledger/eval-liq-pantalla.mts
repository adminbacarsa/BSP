/**
 * Pantalla de liquidación = motor H1 = payrollApi, por legajo.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-liq-pantalla.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'h2-readonly';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';

import { buildPersonaBook, personaStatsToPayrollFigures } from '../../packages/hours-core/src/index.ts';
import { liquidacionPayColumns } from '../../apps/web2/src/lib/reportes/liquidacionPayColumns.ts';

const r1 = (n: number) => Math.round(n * 10) / 10;
const under = liquidacionPayColumns({ horasReales: 180, extra100: 10 });
if (under.normales !== 170 || under.al50 !== 0 || under.total !== 180) throw new Error('bolsa bajo 200');
const over = liquidacionPayColumns({ horasReales: 250, extra100: 20 });
if (over.normales !== 200 || over.al50 !== 30 || over.total !== 250) throw new Error('bolsa sobre 200');

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
const empresaId = 'pruebas_sa';
const from = new Date('2026-09-01T00:00:00.000-03:00');
const until = new Date('2026-09-28T23:59:59.999-03:00');
const [empSnap, planifSnap, turnosSnap] = await Promise.all([
  db.collection('empleados').where('empresaId', '==', empresaId).get(),
  db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
  db.collection('turnos').where('empresaId', '==', empresaId)
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(from))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(until))
    .get(),
]);
const empNameById: Record<string, string> = {};
empSnap.docs.forEach((d) => {
  const e = d.data();
  const st = String(e.status || '').toLowerCase();
  if (st === 'inactive' || st === 'inactivo') return;
  empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
});
const publishStatusMap: Record<string, boolean> = {};
for (const d of planifSnap.docs) {
  publishStatusMap[d.id] = true;
  const parts = d.id.split('_');
  const month = parseInt(parts[parts.length - 1], 10);
  const year = parseInt(parts[parts.length - 2], 10);
  if (!Number.isFinite(month) || !Number.isFinite(year)) continue;
  const objectiveId = parts.length >= 4 ? parts.slice(1, -2).join('_') : parts[0];
  publishStatusMap[`${objectiveId}_${year}_${month}`] = true;
}
const turnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const book = buildPersonaBook({
  turnos,
  ausencias: [],
  publishStatusMap,
  rangeStartYmd: '2026-09-01',
  rangeEndYmd: '2026-09-28',
  empNameById,
  holidays: {},
  usePlannedHours: false,
  publishFilter: 'all',
});
let bad = 0;
const tot = { ft: 0, reales: 0, al50: 0, total: 0, normales: 0 };
for (const e of book.employees) {
  const figures = personaStatsToPayrollFigures({ shifts: e.shifts, stats: e.stats });
  const pay = liquidacionPayColumns({
    shifts: e.shifts.length,
    horasTeoricas: e.stats.horasTeoricas,
    horasReales: e.stats.horasReales,
    extra100: e.stats.extra100,
    plusFeriado: e.stats.plusFeriado,
    diurnas: e.stats.totalDiurnas,
    nocturnas: e.stats.totalNocturnas,
  });
  tot.ft += pay.ft;
  tot.reales += e.stats.horasReales;
  tot.al50 += pay.al50;
  tot.total += pay.total;
  tot.normales += pay.normales;
  const ftOk = Math.abs(pay.ft - figures.acumulado.al100FT) <= 0.05;
  const realOk = Math.abs(e.stats.horasReales - figures.acumulado.hsReales) <= 0.05;
  const alOk = Math.abs(pay.al50 - figures.liquidacion200.al50) <= 0.05;
  const sumOk = Math.abs(pay.normales + pay.al50 + pay.ft - pay.total) <= 0.05;
  const totalOk = Math.abs(pay.total - e.stats.horasReales) <= 0.05;
  if (!ftOk || !realOk || !alOk || !sumOk || !totalOk) bad += 1;
}
if (bad) throw new Error(`pantalla != motor en ${bad} legajos`);
const { calculateLiquidationHoursStats } = await import('../../apps/web2/src/hooks/useReportes.ts');
let legacyFt = 0;
let legacyReal = 0;
for (const e of book.employees) {
  const legacy = calculateLiquidationHoursStats(e.shifts, {}, { usePlannedHours: false, hoursCoreEnabled: false });
  legacyFt += Number(legacy.extra100) || 0;
  legacyReal += Number(legacy.horasReales) || 0;
}
console.log(JSON.stringify({
  legajos: book.employees.length,
  pantalla: { ft: r1(tot.ft), reales: r1(tot.reales), al50: r1(tot.al50), normales: r1(tot.normales), total: r1(tot.total) },
  copiaHookSinH1: { ft: r1(legacyFt), reales: r1(legacyReal) },
}, null, 2));
console.log('LIQ_OK');
