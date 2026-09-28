/**
 * H2a — dry-run de solo lectura contra prod.
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/dryrun-prod.mts
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

function publishMap(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const map: Record<string, boolean> = {};
  for (const d of docs) {
    const data = d.data();
    if (data.publishedAt == null || data.publishedAt === '') continue;
    const id = d.id;
    const m = id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
    if (m) map[`${m[1]}_${m[2]}_${Number(m[3])}`] = true;
    const oid = String(data.objectiveId || data.objetivoId || m?.[1] || '').trim();
    const y = Number(data.year ?? data.año ?? m?.[2]);
    const mo = Number(data.month ?? data.mes ?? m?.[3]);
    if (oid && Number.isFinite(y) && Number.isFinite(mo)) map[`${oid}_${y}_${mo}`] = true;
  }
  return map;
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const empresaId = 'pruebas_sa';
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

const t = built.totals;
const expected = { slaActive: 12957, planPublished: 10984, planDraft: 2840, worked: 11546 };
const got = {
  slaActive: Math.round(t.slaActive),
  planPublished: Math.round(t.planPublished),
  planDraft: Math.round(t.planDraft),
  worked: Math.round(t.worked),
};
const deltas = Object.fromEntries(Object.keys(expected).map((k) => [k, (got as any)[k] - (expected as any)[k]]));
const empresa = built.monthly.find((m) => m.level === 'empresa');
const aparte = built.monthly.filter((m) => m.level === 'objetivo' && (m.slaInactive || m.slaClosed));
console.log(JSON.stringify({
  flag: empresaSnap.data()?.hoursCoreEnabled === true,
  workedRaw: t.worked,
  turnos: turnosSnap.size,
  empleados: Object.keys(empNameById).length,
  got,
  expected,
  deltas,
  empresa: empresa && {
    slaInactive: Math.round(empresa.slaInactive),
    slaClosed: Math.round(empresa.slaClosed),
    covered: empresa.covered,
    uncovered: empresa.uncovered,
  },
  aparte: aparte.map((m) => `${m.objectiveName}|inactivo=${Math.round(m.slaInactive)}|cerrado=${Math.round(m.slaClosed)}|cli=${m.clientName}`),
  activos: built.monthly.filter((m) => m.level === 'objetivo' && m.slaActive).map((m) => `${m.objectiveName}|${Math.round(m.slaActive)}|${m.clientName}|${m.clientId}`),
  docs: { days: built.days.length, monthly: built.monthly.length },
  ok: Object.values(deltas).every((n) => n === 0),
}, null, 2));
