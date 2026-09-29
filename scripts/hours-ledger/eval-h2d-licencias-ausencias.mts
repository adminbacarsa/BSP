/**
 * H2d — dry-run de solo lectura contra prod (pruebas_sa, septiembre 2026).
 * Invariantes: licencias por tipo == novedadPaga; causas de descubiertas == descubiertas;
 * cubiertas + descubiertas == SLA. Imprime la tabla por objetivo con las columnas nuevas.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-h2d-licencias-ausencias.mts
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

const { buildLedgerMonth, jornadaPagada } = await import('./engineEntry.ts');

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

const [empresaSnap, clientsSnap, slaSnap, planifSnap, empSnap, ausSnap, turnosSnap] = await Promise.all([
  db.collection('empresas').doc(empresaId).get(),
  db.collection('clients').where('empresaId', '==', empresaId).get(),
  db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
  db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
  db.collection('empleados').where('empresaId', '==', empresaId).get(),
  db.collection('ausencias').where('empresaId', '==', empresaId).get(),
  db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
    .get(),
]);

const empNameById: Record<string, string> = {};
empSnap.docs.forEach((d) => {
  const e = d.data();
  const st = String(e.status || '').toLowerCase();
  if (st === 'inactive' || st === 'inactivo') return;
  empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
});

const built = buildLedgerMonth({
  empresaId,
  year,
  month,
  hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
  clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  publishStatusMap: publishMap(planifSnap.docs),
  empNameById,
});

const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
const empresa = built.monthly.find((m) => m.level === 'empresa')!;
const objs = built.monthly.filter((m) => m.level === 'objetivo');

// 1) jornada: ningún turno paga/ausente puede rendir 24 h.
let badJornada = 0;
for (const t of turnosSnap.docs) {
  const hs = jornadaPagada(t.data());
  if (hs === 24 || hs <= 0 || hs > 13) badJornada += 1;
}
if (badJornada) throw new Error(`jornadaPagada devolvió 24h/valor inválido en ${badJornada} turnos`);

// 2) licencias por tipo == novedadPaga (empresa y por objetivo).
const licSum = (r: any) => r1(r.licV + r.licE + r.licL + r.licA + r.licPG + r.licSUS + r.licSGS);
if (Math.abs(licSum(empresa) - empresa.novedadPaga) > 1) {
  throw new Error(`licencias por tipo ${licSum(empresa)} != novedadPaga ${empresa.novedadPaga}`);
}
const badLic = objs.filter((m) => Math.abs(licSum(m) - m.novedadPaga) > 0.5);
if (badLic.length) throw new Error(`licencias por tipo != novedadPaga en ${badLic.length} objetivos`);

// 3) causas de descubiertas == descubiertas (empresa, objetivo y día).
const causeSum = (r: any) => r1(r.uncoveredAusencia + r.uncoveredRetiro + r.uncoveredFaltaPlan);
if (Math.abs(causeSum(empresa) - empresa.uncovered) > 1) {
  throw new Error(`causas ${causeSum(empresa)} != descubiertas ${empresa.uncovered}`);
}
const badCause = objs.filter((m) => Math.abs(causeSum(m) - m.uncovered) > 0.5);
if (badCause.length) {
  throw new Error(`causas != descubiertas en ${badCause.length} objetivos: ${badCause.slice(0, 3).map((m) => m.objectiveName).join(', ')}`);
}
const badCauseDay = built.days.filter((d: any) => Math.abs(causeSum(d) - d.uncovered) > 0.6);
if (badCauseDay.length) throw new Error(`causas != descubiertas en ${badCauseDay.length} días`);

// 4) cubiertas + descubiertas == SLA (invariante H2c, no debe romperse).
if (Math.abs(empresa.covered + empresa.uncovered - empresa.slaActive) > 1) {
  throw new Error('invariante SLA = cubiertas + descubiertas rota');
}

// 5) ausencias AA: horas/turnos/legajos coherentes.
if (!(empresa.ausenciaTurnos > 0) || !(empresa.ausenciaHoras > 0)) {
  throw new Error('Ausencias (AA) sigue en 0: revisar isAbsent en turnos publicados');
}

// 6) fuera de operación es un subconjunto del total (mismo universo que worked/workedOutside).
if (empresa.novedadPagaOutside > empresa.novedadPaga + 0.5) throw new Error('licencias fuera > total');
if (empresa.ausenciaHorasOutside > empresa.ausenciaHoras + 0.5) throw new Error('ausencias AA fuera > total');
if (empresa.ausenciaTurnosOutside > empresa.ausenciaTurnos) throw new Error('turnos AA fuera > total');

console.log('INVARIANTS_OK', JSON.stringify({
  jornadaBad: badJornada,
  licSum: licSum(empresa),
  novedadPaga: empresa.novedadPaga,
  causeSum: causeSum(empresa),
  uncovered: empresa.uncovered,
  covered: empresa.covered,
  slaActive: empresa.slaActive,
  ausenciaHoras: empresa.ausenciaHoras,
  ausenciaTurnos: empresa.ausenciaTurnos,
  ausenciaLegajos: empresa.ausenciaLegajos,
}, null, 2));

const table = objs
  .filter((m) => m.slaActive > 0 || m.novedadPaga > 0 || m.ausenciaHoras > 0)
  .sort((a, b) => b.slaActive - a.slaActive)
  .slice(0, 8)
  .map((m) => ({
    objetivo: m.objectiveName,
    sla: Math.round(m.slaActive),
    cubiertas: Math.round(m.covered),
    descubiertas: Math.round(m.uncovered),
    porAusencia: Math.round(m.uncoveredAusencia),
    porRetiro: Math.round(m.uncoveredRetiro),
    porFaltaPlan: Math.round(m.uncoveredFaltaPlan),
    licV: Math.round(m.licV),
    licE: Math.round(m.licE),
    licL: Math.round(m.licL),
    licA: Math.round(m.licA),
    licPG: Math.round(m.licPG),
    licSUS: Math.round(m.licSUS),
    licSGS: Math.round(m.licSGS),
    aaHoras: Math.round(m.ausenciaHoras),
    aaTurnos: m.ausenciaTurnos,
    aaLegajos: m.ausenciaLegajos,
  }));
console.log('TABLA_H2D', JSON.stringify(table, null, 2));

// 6) paridad tandas vs. build completo (mismo mecanismo que H2c: node scripts/hours-ledger/diag-h2c.mts).
const ids = objs.map((m) => m.objectiveId);
let chunkLic = 0;
let chunkAaHoras = 0;
let chunkAaTurnos = 0;
let chunkCauseSum = 0;
for (let i = 0; i < ids.length; i += 10) {
  const slice = buildLedgerMonth({
    empresaId, year, month,
    hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
    clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    publishStatusMap: publishMap(planifSnap.docs),
    empNameById,
    onlyObjectiveIds: ids.slice(i, i + 10),
    skipPersona: true,
    includeUnscopedPaidAbsences: i === 0,
  });
  const e = slice.totals as any;
  chunkLic += licSum(e);
  chunkAaHoras += e.ausenciaHoras;
  chunkAaTurnos += e.ausenciaTurnos;
  chunkCauseSum += causeSum(e);
}
const parity = {
  lic: [r1(chunkLic), licSum(empresa)],
  aaHoras: [r1(chunkAaHoras), empresa.ausenciaHoras],
  aaTurnos: [chunkAaTurnos, empresa.ausenciaTurnos],
  causeSum: [r1(chunkCauseSum), causeSum(empresa)],
};
for (const [k, [chunk, full]] of Object.entries(parity)) {
  if (Math.abs(chunk - full) > 1) throw new Error(`tanda ${k} ${chunk} != completo ${full}`);
}
console.log('PARITY_OK', JSON.stringify(parity));
console.log('H2D_OK');
