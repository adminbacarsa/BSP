/**
 * Borra todos los turnos con un objectiveId huérfano.
 * Uso:
 *   node scripts/delete-orphan-objective.js              ← lista los turnos encontrados
 *   node scripts/delete-orphan-objective.js --execute    ← borra en producción
 */

const admin = require('firebase-admin');

const ORPHAN_OID = '31DrJvGnD2pRSFiusxUF';
const DRY_RUN = !process.argv.includes('--execute');

admin.initializeApp({
  projectId: 'comtroldata',
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function run() {
  const env = process.env.FIRESTORE_EMULATOR_HOST
    ? `EMULADOR (${process.env.FIRESTORE_EMULATOR_HOST})`
    : 'PRODUCCIÓN';
  console.log(`\n=== delete-orphan-objective ===`);
  console.log(`Entorno : ${env}`);
  console.log(`OID     : ${ORPHAN_OID}`);
  console.log(`Modo    : ${DRY_RUN ? 'DRY RUN (sin cambios)' : '*** EJECUCIÓN REAL — BORRANDO ***'}\n`);

  const snap = await db.collection('turnos')
    .where('objectiveId', '==', ORPHAN_OID)
    .get();

  if (snap.empty) {
    console.log('No se encontraron turnos con ese objectiveId. Nada que borrar.');
    process.exit(0);
  }

  console.log(`Turnos encontrados: ${snap.size}\n`);
  snap.docs.forEach((d) => {
    const data = d.data();
    const fecha = data.startTime?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '?';
    console.log(`  ${d.id} | ${fecha} | emp=${data.employeeId ?? '?'} | obj="${data.objectiveName ?? ''}" | client=${data.clientId ?? '?'}`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No se realizaron cambios. Ejecutá con --execute para borrar.');
    process.exit(0);
  }

  const BATCH_SIZE = 400;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, docs.length - i);
    console.log(`  Borrados: ${deleted}/${docs.length}`);
  }

  console.log(`\nListo. ${deleted} turnos eliminados.`);
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
