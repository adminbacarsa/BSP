/**
 * delete-all-ausencias.js
 * Elimina TODOS los documentos de la colección `ausencias` en PRODUCCIÓN.
 * Uso: node scripts/delete-all-ausencias.js
 */

const GOOGLE_APPLICATION_CREDENTIALS = require('path').resolve(__dirname, '../service-account.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_APPLICATION_CREDENTIALS;

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: cert(GOOGLE_APPLICATION_CREDENTIALS), projectId: 'comtroldata' });
}
const db = getFirestore();

async function run() {
  const snap = await db.collection('ausencias').get();
  if (snap.empty) { console.log('✅ La colección ya está vacía.'); process.exit(0); }

  console.log(`Eliminando ${snap.size} ausencias de producción...`);
  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch();
    snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(CHUNK, snap.docs.length - i);
  }
  console.log(`✅ ${deleted} ausencias eliminadas.`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
