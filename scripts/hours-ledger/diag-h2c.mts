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

const { buildLedgerMonth, personaMonthWorked } = await import('./engineEntry.ts');
const { buildPersonaBook } = await import('../../packages/hours-core/src/index.ts');

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
const relief = built.monthly.filter((m) => m.level === 'objetivo').reduce((s, m) => s + (Number(m.reliefHours) || 0), 0);
if (t.covered > t.worked + relief + 1) throw new Error(`cubiertas ${Math.round(t.covered)} > trabajadas ${Math.round(t.worked)} + relevo ${Math.round(relief)}`);
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
console.log('INVARIANT_OK', JSON.stringify({ ...full, worked: Math.round(t.worked), relief: Math.round(relief) }));
const from = new Date('2026-09-01T00:00:00.000-03:00').getTime();
const until = new Date('2026-09-28T23:59:59.999-03:00').getTime();
const instant = (v: any) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v === 'string') { const n = new Date(v).getTime(); return Number.isNaN(n) ? null : n; }
  return null;
};
const monthTurnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const rangeTurnos = monthTurnos.filter((t) => {
  const ms = instant(t.startTime);
  return ms != null && ms >= from && ms <= until;
});
const liq = buildPersonaBook({
  turnos: rangeTurnos,
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  rangeStartYmd: '2026-09-01',
  rangeEndYmd: '2026-09-28',
  empNameById,
  holidays: {},
  usePlannedHours: false,
  publishFilter: 'published',
});
const sumStats = (k: string) => liq.employees.reduce((s, e) => s + (Number((e.stats as any)[k]) || 0), 0);
const liqFtByEmp = new Map<string, number>();
for (const e of liq.employees) liqFtByEmp.set(e.employeeId, Number(e.stats.extra100) || 0);
const persona = personaMonthWorked({
  turnos: monthTurnos,
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  year, month,
  hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
  empNameById,
});
const bookFtByEmp = new Map<string, number>();
for (const p of persona.parts) {
  if (p.date < '2026-09-01' || p.date > '2026-09-28') continue;
  bookFtByEmp.set(p.employeeId, (bookFtByEmp.get(p.employeeId) || 0) + p.ft);
}
let badEmp = 0;
for (const [id, ft] of liqFtByEmp) {
  if (Math.abs(ft - (bookFtByEmp.get(id) || 0)) > 0.2) badEmp += 1;
}
const days = built.days.filter((d) => d.date >= '2026-09-01' && d.date <= '2026-09-28');
const book = {
  ft: days.reduce((s, d) => s + d.ft, 0),
  ext: days.reduce((s, d) => s + d.ext, 0),
  adv: days.reduce((s, d) => s + d.adv, 0),
  worked: days.reduce((s, d) => s + d.worked, 0),
  workedOutside: days.reduce((s, d) => s + d.workedOutside, 0),
};
const row = (name: string, liquidacion: number, libro: number | null, nota: string) => ({
  name, liquidacion: Math.round(liquidacion * 10) / 10, libro: libro == null ? null : Math.round(libro * 10) / 10, nota,
});
const table = [
  row('Turnos', liq.employees.reduce((s, e) => s + e.shifts.length, 0), null, 'la liquidación cuenta turnos; el libro no'),
  row('Hs. teóricas', sumStats('horasTeoricas'), t.planPublished, 'el libro muestra el plan publicado, no las teóricas'),
  row('Hs. reales', sumStats('horasReales'), book.worked + book.workedOutside, 'reales = trabajadas en operación + fuera, días 1-28'),
  row('Diurnas', sumStats('totalDiurnas'), null, 'no está en el libro'),
  row('Nocturnas', sumStats('totalNocturnas'), null, 'no está en el libro'),
  row('Al 50%', sumStats('extra50'), null, 'exceso sobre 200 h; no está en el libro'),
  row('Al 100% (FT)', sumStats('extra100'), book.ft, 'misma fichada del motor'),
  row('Plus feriado', sumStats('plusFeriado'), null, 'no está en el libro'),
  row('EXT', liq.employees.reduce((s, e) => s + (Number(e.stats.desglose?.ext) || 0), 0), book.ext, 'desglose del motor'),
  row('ADV', liq.employees.reduce((s, e) => s + (Number(e.stats.desglose?.adv) || 0), 0), book.adv, 'desglose del motor'),
];
console.log('RECONCILE', JSON.stringify(table, null, 2));
console.log('FT_LEGAJOS', badEmp, 'de', liqFtByEmp.size);
if (Math.abs(book.ft - sumStats('extra100')) > 1) throw new Error(`FT libro ${book.ft} != liquidación ${sumStats('extra100')}`);
if (badEmp) throw new Error(`FT no cierra en ${badEmp} legajos`);
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
