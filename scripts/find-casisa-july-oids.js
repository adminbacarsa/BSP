/**
 * Lista todos los objectiveIds distintos en turnos de CASISA en julio 2026.
 * Incluye turnos con o sin clientId (para atrapar huérfanos).
 */

const admin = require('firebase-admin');

const CLIENT_ID = 'DB8UZxFC4DpqGSQ3o69w'; // CASISA

admin.initializeApp({
  projectId: 'comtroldata',
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const { Timestamp } = admin.firestore;

async function run() {
  const julio2026Start = new Date('2026-07-01T00:00:00-03:00');
  const julio2026End   = new Date('2026-07-31T23:59:59-03:00');

  console.log('\n=== Turnos CASISA con clientId — julio 2026 ===');
  const byClient = await db.collection('turnos')
    .where('clientId', '==', CLIENT_ID)
    .where('startTime', '>=', Timestamp.fromDate(julio2026Start))
    .where('startTime', '<=', Timestamp.fromDate(julio2026End))
    .get();
  console.log(`Encontrados: ${byClient.size}`);

  const byOid = new Map();
  byClient.docs.forEach((d) => {
    const oid = String(d.data().objectiveId ?? '(vacío)').trim() || '(vacío)';
    if (!byOid.has(oid)) byOid.set(oid, { count: 0, samples: [] });
    byOid.get(oid).count++;
    if (byOid.get(oid).samples.length < 2) byOid.get(oid).samples.push(d.id);
  });

  console.log('\nObjectiveIds distintos:');
  for (const [oid, info] of [...byOid.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${oid}  (${info.count} turnos)  ej: ${info.samples.join(', ')}`);
  }

  // También buscar por el ID directo, sin clientId (por si los turnos están sin ese campo)
  console.log('\n=== Búsqueda directa por objectiveId === ');
  const TARGET = '31DrJvGnD2pRSFiusxUF';
  const byOidDirect = await db.collection('turnos')
    .where('objectiveId', '==', TARGET)
    .where('startTime', '>=', Timestamp.fromDate(julio2026Start))
    .where('startTime', '<=', Timestamp.fromDate(julio2026End))
    .get();
  console.log(`objectiveId "${TARGET}" en julio: ${byOidDirect.size}`);
  byOidDirect.docs.slice(0, 5).forEach((d) => {
    const data = d.data();
    console.log(`  ${d.id} | clientId=${data.clientId ?? '?'} | emp=${data.employeeId ?? '?'}`);
  });

  // Sin rango de fechas
  const byOidAll = await db.collection('turnos')
    .where('objectiveId', '==', TARGET)
    .get();
  console.log(`objectiveId "${TARGET}" en TOTAL: ${byOidAll.size}`);
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
