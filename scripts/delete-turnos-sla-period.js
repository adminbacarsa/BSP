/**
 * Borra turnos (y ausencias/novedades) de un período cuando el SLA ya fue eliminado sin cascade.
 *
 * Uso:
 *   node scripts/delete-turnos-sla-period.js --clientId=XXX --objectiveId=YYY --from=2026-01-01 --to=2026-12-31
 *   node scripts/delete-turnos-sla-period.js --clientId=XXX --objectiveName="CASISA Sede" --from=2026-01-01 --to=2026-12-31 --apply
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').trim() : '';
};

const clientId = arg('clientId');
const objectiveId = arg('objectiveId');
const objectiveName = arg('objectiveName');
const from = arg('from');
const to = arg('to');
const empresaId = arg('empresaId') || 'bacarsa';

if (!clientId || !from || !to || (!objectiveId && !objectiveName)) {
  console.error(`
Faltan parámetros.

Ejemplo:
  node scripts/delete-turnos-sla-period.js \\
    --clientId=DB8UZxFC4DpqGSQ3o69w \\
    --objectiveId=9CbYIDmsUGnabENKvXZt \\
    --from=2026-01-01 --to=2026-06-30

Agregá --apply para borrar.
`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}
const db = getFirestore();

function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
}

function matchesObjective(data) {
  const oid = String(data.objectiveId || '').trim();
  const oname = String(data.objectiveName || '').trim();
  if (objectiveId && oid === objectiveId) return true;
  if (objectiveName && (oname === objectiveName || norm(oname) === norm(objectiveName))) return true;
  if (objectiveId && oname === objectiveId) return true;
  return false;
}

function inEmpresa(data) {
  const docEmp = String(data.empresaId || '').trim();
  if (empresaId.toLowerCase() === 'bacarsa') return !docEmp || docEmp.toLowerCase() === 'bacarsa';
  return docEmp === empresaId;
}

async function main() {
  const [sy, sm, sd] = from.split('-').map(Number);
  const [ey, em, ed] = to.split('-').map(Number);
  const rangeStart = Timestamp.fromDate(new Date(sy, sm - 1, sd, 0, 0, 0));
  const rangeEnd = Timestamp.fromDate(new Date(ey, em - 1, ed, 23, 59, 59));

  const snap = await db.collection('turnos')
    .where('clientId', '==', clientId)
    .where('startTime', '>=', rangeStart)
    .where('startTime', '<=', rangeEnd)
    .get();

  const turnos = snap.docs.filter((d) => inEmpresa(d.data()) && matchesObjective(d.data()));
  console.log(`\nModo: ${APPLY ? 'APLICAR' : 'dry-run'}`);
  console.log(`Turnos a borrar: ${turnos.length}\n`);

  if (!turnos.length) return;

  const shiftIds = turnos.map((d) => d.id);
  let ausCount = 0;
  let novCount = 0;
  for (let i = 0; i < shiftIds.length; i += 30) {
    const chunk = shiftIds.slice(i, i + 30);
    const [aus, nov] = await Promise.all([
      db.collection('ausencias').where('shiftId', 'in', chunk).get(),
      db.collection('novedades').where('shiftId', 'in', chunk).get(),
    ]);
    ausCount += aus.size;
    novCount += nov.size;
  }
  console.log(`Ausencias: ${ausCount}, Novedades: ${novCount}`);

  if (!APPLY) {
    console.log('\nEjecutá con --apply para borrar.');
    return;
  }

  let batch = db.batch();
  let n = 0;
  const commit = async () => {
    if (n > 0) await batch.commit();
    batch = db.batch();
    n = 0;
  };

  for (const id of shiftIds) {
    batch.delete(db.collection('turnos').doc(id));
    n++;
    if (n >= 490) await commit();
  }
  await commit();

  for (let i = 0; i < shiftIds.length; i += 30) {
    const chunk = shiftIds.slice(i, i + 30);
    const [aus, nov] = await Promise.all([
      db.collection('ausencias').where('shiftId', 'in', chunk).get(),
      db.collection('novedades').where('shiftId', 'in', chunk).get(),
    ]);
    for (const d of [...aus.docs, ...nov.docs]) {
      batch.delete(d.ref);
      n++;
      if (n >= 490) await commit();
    }
  }
  await commit();

  console.log(`\nListo. ${turnos.length} turnos eliminados.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
