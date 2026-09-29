/**
 * Plan publicado: una sola función. Nuevo Edificio Corporativo, septiembre 2026.
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-published-plan-nk.mts
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { sumPublishedPlanHours } from '../../packages/hours-core/src/motors/planning/publishedPlanHours.ts';
import { sumPlannedHoursForObjective } from '../../apps/web2/src/lib/crm/plannedHours.ts';

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

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const oid = 'NK1i1DUwlaDxC4Hn8QwJ';
const start = new Date('2026-09-01T00:00:00.000-03:00');
const end = new Date('2026-09-30T23:59:59.999-03:00');
const snap = await db.collection('turnos')
  .where('empresaId', '==', 'pruebas_sa')
  .where('objectiveId', '==', oid)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
  .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
  .get();

const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const mesh = sumPublishedPlanHours(rows);
const crm = sumPlannedHoursForObjective(rows, oid, { start, end });
const expect: Record<string, number> = {
  M: 808, M1: 440, T: 656, N: 640, D12: 96, N12: 96, SIN_CODIGO: 24, FT: 32,
};
const got: Record<string, number> = {};
for (const [code, row] of Object.entries(mesh.byCode)) got[code] = row.hours;
const fail: string[] = [];
if (mesh.hours !== 2792) fail.push(`total ${mesh.hours} != 2792`);
if (crm !== 2792) fail.push(`crm ${crm} != 2792`);
if (mesh.hours !== crm) fail.push(`malla ${mesh.hours} != crm ${crm}`);
for (const [code, hours] of Object.entries(expect)) {
  if (got[code] !== hours) fail.push(`${code} ${got[code] ?? 0} != ${hours}`);
}
if (mesh.uncodedCount !== 2 || mesh.ftCount !== 4) fail.push(`sin código ${mesh.uncodedCount} FT ${mesh.ftCount}`);
if (got.RET) fail.push('RET no entra en el plan');
if (fail.length) {
  console.error(JSON.stringify({ mesh, got }, null, 2));
  throw new Error(fail.join('; '));
}
console.log('NK_PLAN_OK', mesh.hours, JSON.stringify(got));
