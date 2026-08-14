/**
 * Parchea turnos que tienen un objectiveId obsoleto, remplazÃ¡ndolo por el actual.
 * Uso:
 *   node scripts/patch-objective-id.js              â† lista objectiveIds distintos de CASISA en jul/2026
 *   node scripts/patch-objective-id.js --execute    â† aplica el patch
 *
 * OLD_OID se detecta automÃ¡ticamente: cualquier objectiveId de CASISA que NO estÃ©
 * en la lista de objetivos registrados del cliente.
 */

const admin = require('firebase-admin');

const CLIENT_ID  = 'DB8UZxFC4DpqGSQ3o69w';   // CASISA
const NEW_OID    = '9CbYIDmsUGnabENKvXZt';    // Obrador MalagueÃ±o actual
const NEW_NAME   = 'OBRADOR MALAGUEÃ‘O';
// objectiveIds vÃ¡lidos conocidos de CASISA (del backup):
const KNOWN_OIDS = new Set([
  '3xqaoEr1npPnCX7q08uq',
  '5XMZ7UuKJEWosCnRhrHz',
  '9CbYIDmsUGnabENKvXZt',
  'AUOMjDCashPHdrTBFef2',
  'C0vVFSwfbUuz5nLbHJFP',
  'cjfbhj8Pz5yqIhc6s2uc',
  'gEFStTLl3AornRIX0kcq',
  'i0P5axzS2wRAlvIfAuc1',
  'I3y36XNAwZJRMl550C6z',
  'L2zXxSy4hWcYIRl4VMUQ',
  'lNJTL47NRCaluny4etzL',
  'mYfci0lv8rKRRQhKwepW',
  'pPXuDgjGTrFEwSeaFc1M',
]);

const DRY_RUN = !process.argv.includes('--execute');

admin.initializeApp({
  projectId: 'comtroldata',
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function run() {
  const env = process.env.FIRESTORE_EMULATOR_HOST
    ? `EMULADOR (${process.env.FIRESTORE_EMULATOR_HOST})`
    : 'PRODUCCIÃ“N';
  console.log(`\n=== patch-objective-id ===`);
  console.log(`Entorno : ${env}`);
  console.log(`Modo    : ${DRY_RUN ? 'DRY RUN (sin cambios)' : '*** EJECUCIÃ“N REAL ***'}\n`);

  // Consulta todos los turnos de CASISA
  const snap = await db.collection('turnos')
    .where('clientId', '==', CLIENT_ID)
    .get();

  console.log(`Total turnos CASISA: ${snap.size}`);

  // Detecta objectiveIds distintos
  const byOid = new Map();
  snap.docs.forEach((doc) => {
    const oid = doc.data().objectiveId ?? '(vacÃ­o)';
    if (!byOid.has(oid)) byOid.set(oid, []);
    byOid.get(oid).push(doc);
  });

  console.log('\nObjectiveIds distintos encontrados:');
  for (const [oid, docs] of byOid.entries()) {
    const label = KNOWN_OIDS.has(oid) ? 'âœ“ conocido' : 'âš  DESCONOCIDO';
    console.log(`  ${label}  ${oid}  (${docs.length} turnos)`);
  }

  // Filtra los desconocidos (candidatos a parchear)
  const orphanEntries = [...byOid.entries()].filter(([oid]) => !KNOWN_OIDS.has(oid));

  if (orphanEntries.length === 0) {
    console.log('\nNo hay objectiveIds huÃ©rfanos. Nada que parchear.');
    process.exit(0);
  }

  console.log(`\nObjectiveIds huÃ©rfanos a parchear â†’ ${NEW_OID} ("${NEW_NAME}"):`);
  for (const [oid, docs] of orphanEntries) {
    console.log(`  ${oid}  (${docs.length} turnos)`);
    docs.slice(0, 3).forEach((doc) => {
      const d = doc.data();
      const fecha = d.startTime?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? d.startTime ?? '?';
      console.log(`    ${doc.id} | ${fecha} | emp=${d.employeeId ?? '?'} | name="${d.objectiveName ?? ''}"`);
    });
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No se realizaron cambios. EjecutÃ¡ con --execute para aplicarlos.');
    process.exit(0);
  }

  // Patch
  const allOrphan = orphanEntries.flatMap(([, docs]) => docs);
  const BATCH_SIZE = 400;
  let updated = 0;
  for (let i = 0; i < allOrphan.length; i += BATCH_SIZE) {
    const batch = db.batch();
    allOrphan.slice(i, i + BATCH_SIZE).forEach((doc) => {
      batch.update(doc.ref, { objectiveId: NEW_OID, objectiveName: NEW_NAME });
    });
    await batch.commit();
    updated += Math.min(BATCH_SIZE, allOrphan.length - i);
    console.log(`  Parcheados: ${updated}/${allOrphan.length}`);
  }

  console.log(`\nListo. ${updated} turnos actualizados con objectiveId="${NEW_OID}" y objectiveName="${NEW_NAME}".`);
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

