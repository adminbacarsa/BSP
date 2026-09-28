/**
 * Diagnóstico solo lectura: niveles del libro guardado + invariante franja + novedades.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/diag-h2c.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';

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

const { buildLedgerMonth } = await import('./engineEntry.ts');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const empresaId = 'pruebas_sa';
const period = '2026-09';

const saved = await db.collection('hours_ledger_monthly').where('empresaId', '==', empresaId).where('periodKey', '==', period).get();
const byLevel: Record<string, number> = {};
for (const d of saved.docs) {
  const lv = String(d.data().level || '(sin)');
  byLevel[lv] = (byLevel[lv] || 0) + 1;
}
const emp = saved.docs.find((d) => d.data().level === 'empresa');
console.log('SAVED', JSON.stringify({ docs: saved.size, byLevel, empresa: emp ? {
  slaActive: Math.round(emp.data().slaActive || 0),
  covered: Math.round(emp.data().covered || 0),
  uncovered: Math.round(emp.data().uncovered || 0),
  novedadPaga: Math.round(emp.data().novedadPaga || 0),
  planPublished: Math.round(emp.data().planPublished || 0),
  worked: Math.round(emp.data().worked || 0),
} : null }));

const year = 2026;
const month = 9;
const start = new Date('2026-09-01T00:00:00.000-03:00');
const end = new Date('2026-09-30T23:59:59.999-03:00');
const [empresaSnap, clientsSnap, slaSnap, planifSnap, empSnap, ausSnap, turnosSnap] = await Promise.all([
  db.collection('empresas').doc(empresaId).get(),
  db.collection('clients').where('empresaId', '==', empresaId).get(),
  db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
  db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
  db.collection('empleados').where('empresaId', '==', empresaId).get(),
  db.collection('ausencias').where('empresaId', '==', empresaId).get(),
  db.collection('turnos').where('empresaId', '==', empresaId).where('startTime', '>=', admin.firestore.Timestamp.fromDate(start)).where('startTime', '<=', admin.firestore.Timestamp.fromDate(end)).get(),
]);

const codes: Record<string, number> = {};
let paidSample = 0;
for (const d of turnosSnap.docs) {
  const t = d.data();
  const c = String(t.code || t.type || '').toUpperCase();
  if (['V', 'L', 'E', 'A', 'PG'].includes(c)) {
    codes[c] = (codes[c] || 0) + 1;
    if (paidSample < 3) {
      paidSample += 1;
      console.log('SHIFT', c, { hours: t.hours, objectiveId: t.objectiveId, status: t.status, draft: t.draft });
    }
  }
}
const ausCodes: Record<string, number> = {};
for (const d of ausSnap.docs) {
  const a = d.data();
  const c = String(a.type || a.codigo || a.code || a.tipo || '').toUpperCase();
  ausCodes[c || '(vacio)'] = (ausCodes[c || '(vacio)'] || 0) + 1;
}
console.log('TURNOS_PAID', codes, 'AUS_CODES', ausCodes, 'turnos', turnosSnap.size, 'aus', ausSnap.size);

const empNameById: Record<string, string> = {};
empSnap.docs.forEach((d) => {
  const e = d.data();
  const st = String(e.status || '').toLowerCase();
  if (st === 'inactive' || st === 'inactivo') return;
  empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
});
function publishMap(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const map: Record<string, boolean> = {};
  for (const d of docs) {
    const data = d.data();
    if (data.publishedAt == null || data.publishedAt === '') continue;
    const id = d.id;
    const m = id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
    const oid = String(data.objectiveId || data.objetivoId || m?.[1] || '').trim();
    const y = Number(data.year ?? data.año ?? m?.[2]);
    const mo = Number(data.month ?? data.mes ?? m?.[3]);
    if (oid && Number.isFinite(y) && Number.isFinite(mo)) map[`${oid}_${y}_${mo}`] = true;
  }
  return map;
}

const built = buildLedgerMonth({
  empresaId, year, month,
  hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
  clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  empNameById,
});
const levels: Record<string, number> = {};
for (const m of built.monthly) levels[m.level] = (levels[m.level] || 0) + 1;
const t = built.totals;
const named = built.monthly.filter((m) => m.level === 'objetivo' && /ceb|villa|tadicor|peaje|loter/i.test(`${m.objectiveName} ${m.clientName}`));
console.log('NAMED', JSON.stringify(named.map((m) => ({
  name: m.objectiveName,
  sla: Math.round(m.slaActive),
  inact: Math.round(m.slaInactive),
  cerr: Math.round(m.slaClosed),
  sinPlan: Math.round(m.slaWithoutPlan || 0),
  worked: Math.round(m.worked || 0),
  fuera: Math.round(m.workedOutside || 0),
}))));
const objs = built.monthly.filter((m) => m.level === 'objetivo');
const topOut = [...objs].filter((m) => m.workedOutside > 0).sort((a, b) => b.workedOutside - a.workedOutside).slice(0, 8);
console.log('FUERA', JSON.stringify(topOut.map((m) => ({
  name: m.objectiveName, worked: Math.round(m.worked), fuera: Math.round(m.workedOutside), sla: Math.round(m.slaActive),
}))));
console.log('ENGINE', JSON.stringify({
  levels,
  slaActive: Math.round(t.slaActive),
  slaInactive: Math.round(t.slaInactive),
  slaClosed: Math.round(t.slaClosed),
  slaWithoutPlan: Math.round(t.slaWithoutPlan || 0),
  covered: Math.round(t.covered),
  uncovered: Math.round(t.uncovered),
  sum: Math.round(t.covered + t.uncovered),
  delta: Math.round(t.covered + t.uncovered - t.slaActive),
  novedadPaga: Math.round(t.novedadPaga),
  planPublished: Math.round(t.planPublished),
  worked: Math.round(t.worked),
  workedOutside: Math.round(t.workedOutside || 0),
}));
const bad = built.monthly.filter((m) => m.level === 'objetivo' && Math.abs((m.covered + m.uncovered) - m.slaActive) > 0.5);
bad.sort((a, b) => (b.covered + b.uncovered - b.slaActive) - (a.covered + a.uncovered - a.slaActive));
const clients = built.monthly.filter((m) => m.level === 'cliente');
const badClient = clients.filter((m) => Math.abs((m.covered + m.uncovered) - m.slaActive) > 0.5);
const badDay = built.days.filter((d) => Math.abs(((d.covered || 0) + (d.uncovered || 0)) - (d.slaActive || 0)) > 0.6);
const input = {
  empresaId, year, month,
  hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
  clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  empNameById,
};
const ids = built.monthly.filter((m) => m.level === 'objetivo').map((m) => m.objectiveId);
let sla = 0; let plan = 0; let covered = 0; let uncovered = 0; let novedad = 0;
for (let i = 0; i < ids.length; i += 10) {
  const slice = buildLedgerMonth({
    ...input,
    onlyObjectiveIds: ids.slice(i, i + 10),
    skipPersona: true,
    includeUnscopedPaidAbsences: i === 0,
  });
  const emp = slice.totals;
  sla += emp.slaActive; plan += emp.planPublished; covered += emp.covered; uncovered += emp.uncovered; novedad += emp.novedadPaga;
}
const chunk = {
  sla: Math.round(sla), plan: Math.round(plan), covered: Math.round(covered),
  uncovered: Math.round(uncovered), novedad: Math.round(novedad),
};
console.log('CHUNKS', JSON.stringify(chunk));
console.log('BAD_OBJ', bad.length, 'BAD_CLIENT', badClient.length, 'BAD_DAY', badDay.length, 'CLIENTS', clients.length);
if (Math.round(t.slaActive) !== 11309) throw new Error(`SLA del mes ${Math.round(t.slaActive)} != 11309`);
if (Math.round(t.slaClosed) !== 32) throw new Error(`SLA cerrado ${Math.round(t.slaClosed)} != 32`);
if (Math.abs((t.covered + t.uncovered) - t.slaActive) > 1) throw new Error('invariante empresa');
if (bad.length || badClient.length || badDay.length) throw new Error('invariante grano');
if (!(t.novedadPaga > 0)) throw new Error('novedad paga sigue en 0');
if (!clients.length || clients.some((c) => c.level !== 'cliente')) throw new Error('sin rollup cliente');
const full = {
  sla: Math.round(t.slaActive), plan: Math.round(t.planPublished), covered: Math.round(t.covered),
  uncovered: Math.round(t.uncovered), novedad: Math.round(t.novedadPaga),
};
for (const k of Object.keys(full) as (keyof typeof full)[]) {
  if (Math.abs(full[k] - chunk[k]) > 1) throw new Error(`tanda ${k} ${chunk[k]} != ${full[k]}`);
}
console.log('INVARIANT_OK', JSON.stringify(full));
console.log('BAD_OBJ', bad.length);
for (const m of bad.slice(0, 15)) {
  console.log([
    m.objectiveName,
    'sla', Math.round(m.slaActive),
    'inact', Math.round(m.slaInactive),
    'cerr', Math.round(m.slaClosed),
    'cov', Math.round(m.covered),
    'unc', Math.round(m.uncovered),
    'delta', Math.round(m.covered + m.uncovered - m.slaActive),
    'plan', Math.round(m.planPublished),
  ].join(' | '));
}
