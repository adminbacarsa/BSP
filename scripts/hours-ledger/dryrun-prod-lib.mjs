/**
 * H2a — prueba como en producción: Node + `apps/functions/lib` compilado, SIN NEXT_PUBLIC_*,
 * rebuild de pruebas_sa en dryRun contra prod (solo lectura; toda escritura Admin queda bloqueada).
 *   node scripts/hours-ledger/dryrun-prod-lib.mjs [empresaId] [yyyy-mm]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of Object.keys(process.env)) {
  if (k.startsWith('NEXT_PUBLIC_')) delete process.env[k];
}
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFn = createRequire(path.join(root, 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
const deny = (what) => function denied() { throw new Error(`escritura bloqueada (${what})`); };
for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
CollectionReference.prototype.add = deny('add');
WriteBatch.prototype.commit = deny('batch');
Firestore.prototype.runTransaction = deny('tx');
Firestore.prototype.recursiveDelete = deny('recursiveDelete');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}

const { rebuildHoursLedger } = requireFn(path.join(root, 'apps/functions/lib/hoursLedger/rebuildHoursLedger.js'));

const empresaId = process.argv[2] || 'pruebas_sa';
const period = process.argv[3] || '2026-09';
const expected = { slaActive: 12957, planPublished: 10984, planDraft: 2840, worked: 11550 };

const res = await rebuildHoursLedger({ empresaId, period, dryRun: true });
const t = res.totals || {};
const got = {
  slaActive: Math.round(t.slaActive || 0),
  planPublished: Math.round(t.planPublished || 0),
  planDraft: Math.round(t.planDraft || 0),
  worked: Math.round(t.worked || 0),
};
const deltas = Object.fromEntries(Object.keys(expected).map((k) => [k, got[k] - expected[k]]));
const empresa = (res.monthly || []).find((m) => m.level === 'empresa');
console.log(JSON.stringify({
  env: { NEXT_PUBLIC_vars: Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_')).length },
  dryRun: res.dryRun,
  got,
  expected,
  deltas,
  aparte: empresa && { slaInactive: Math.round(empresa.slaInactive || 0), slaClosed: Math.round(empresa.slaClosed || 0) },
  docs: { days: res.days?.length ?? res.dayCount, monthly: res.monthly?.length ?? res.monthCount },
  ok: Object.values(deltas).every((n) => Math.abs(n) <= 5),
}, null, 2));
process.exit(0);
