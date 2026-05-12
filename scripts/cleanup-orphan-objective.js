/**
 * Limpieza de objetivo huérfano: elimina todos los turnos de un objectiveId
 * que ya no tiene cliente en Firestore.
 * Uso: node scripts/cleanup-orphan-objective.js <objectiveId>
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

const objectiveId = process.argv[2];
if (!objectiveId) {
  console.error('Uso: node scripts/cleanup-orphan-objective.js <objectiveId>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function cleanup() {
  console.log(`\nBuscando turnos para objetivo: ${objectiveId}`);

  const snap = await db.collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .get();

  if (snap.empty) {
    console.log('No se encontraron turnos para este objetivo.');
    process.exit(0);
  }

  console.log(`Encontrados: ${snap.size} turnos. Eliminando...`);

  const BATCH_SIZE = 400;
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, snap.docs.length - i);
    console.log(`  Eliminados: ${deleted}/${snap.size}`);
  }

  console.log(`\n✅ Listo. ${deleted} turnos eliminados para objetivo ${objectiveId}.`);
  process.exit(0);
}

cleanup().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
