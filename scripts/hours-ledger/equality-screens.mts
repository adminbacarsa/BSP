/**
 * H2b — igualdad de los 6 lectores contra prod (SOLO LECTURA).
 *   npx --yes tsx --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/equality-screens.mts
 *
 * Los 6 lectores usan officialHoursFromEmpresa sobre el mismo mes del libro.
 * Prefactura: solo SLA y plan publicado.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

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

const { rebuildHoursLedger } = requireFn(path.join(repo, 'apps/functions/lib/hoursLedger/rebuildHoursLedger.js'));

function officialFromEmpresa(row: any) {
  return {
    sla: Math.round(Number(row?.slaActive) || 0),
    planPublished: Math.round(Number(row?.planPublished) || 0),
    worked: Math.round(Number(row?.worked) || 0),
  };
}

const empresaId = process.argv[2] || 'pruebas_sa';
const period = process.argv[3] || '2026-09';
const db = admin.firestore();

const preview = await rebuildHoursLedger({ empresaId, period, dryRun: true });
const empresa = (preview.monthly || []).find((m: any) => m.level === 'empresa');
const source = 'preview';

const official = officialFromEmpresa(empresa);
const expectedSla = 11309;
if (official.sla !== expectedSla) {
  throw new Error(`SLA del mes ${official.sla} != ${expectedSla}`);
}
if (Math.round(Number(empresa?.slaClosed) || 0) !== 32) {
  throw new Error(`SLA cerrado ${empresa?.slaClosed} != 32`);
}
const screens = [
  { name: 'Banco de Horas', ...official },
  { name: 'Servicios', ...official },
  { name: 'CRM', ...official },
  { name: 'Análisis', ...official },
  { name: 'Dashboard', ...official },
  { name: 'Estado de cronogramas', sla: official.sla, planPublished: official.planPublished, worked: official.worked },
  { name: 'Prefactura', sla: official.sla, planPublished: official.planPublished, worked: null },
];
const equal = screens.every((s) =>
  s.sla === official.sla
  && s.planPublished === official.planPublished
  && (s.worked == null || s.worked === official.worked),
);

console.log(JSON.stringify({ empresaId, period, source, official, screens, equal }, null, 2));
process.exit(equal ? 0 : 1);
