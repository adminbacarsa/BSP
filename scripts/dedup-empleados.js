/**
 * dedup-empleados.js
 * Analiza duplicados de empleados en Firestore por DNI y/o legajo.
 * Uso:
 *   node scripts/dedup-empleados.js            → dry-run (solo muestra)
 *   node scripts/dedup-empleados.js --delete   → elimina duplicados
 *
 * Criterio para elegir qué doc conservar:
 *   1. El que tiene uid (vinculado a Auth)
 *   2. El que tiene más campos completos
 *   3. En caso de empate, el más antiguo (menor doc ID lexicográfico)
 *
 * Apunta a PRODUCCIÓN — no setear FIRESTORE_EMULATOR_HOST.
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');
const path = require('path');

const DRY_RUN = !process.argv.includes('--delete');

// Intentar usar service account si existe, sino credenciales de aplicación
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
try {
  const sa = require(serviceAccountPath);
  if (!getApps().length) initializeApp({ credential: cert(sa) });
} catch {
  if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
}
const db = getFirestore();

function countFields(data) {
  return Object.values(data).filter(v => v !== null && v !== undefined && v !== '').length;
}

function pickKeeper(docs) {
  // 1. Preferir el que tiene uid
  const withUid = docs.filter(d => d._data.uid);
  const pool = withUid.length > 0 ? withUid : docs;
  // 2. Dentro del pool, el más completo
  pool.sort((a, b) => countFields(b._data) - countFields(a._data));
  return pool[0];
}

async function main() {
  console.log(DRY_RUN
    ? '\n🔍 MODO DRY-RUN — solo se muestra, nada se borra'
    : '\n⚠️  MODO DELETE — se eliminarán los duplicados');
  console.log('────────────────────────────────────────────\n');

  const snap = await db.collection('empleados').get();
  const docs = snap.docs.map(d => ({ id: d.id, _data: d.data() }));
  console.log(`Total empleados en colección: ${docs.length}\n`);

  // Agrupar por DNI
  const byDni = {};
  for (const d of docs) {
    const key = (d._data.dni || '').trim();
    if (!key) continue;
    if (!byDni[key]) byDni[key] = [];
    byDni[key].push(d);
  }

  // Agrupar por fileNumber (legajo)
  const byLeg = {};
  for (const d of docs) {
    const key = (d._data.fileNumber || '').trim();
    if (!key) continue;
    if (!byLeg[key]) byLeg[key] = [];
    byLeg[key].push(d);
  }

  const toDelete = new Set();

  const printGroup = (label, key, group) => {
    const keeper = pickKeeper(group);
    console.log(`  ${label}: ${key}`);
    for (const d of group) {
      const isKeeper = d.id === keeper.id;
      const fields = countFields(d._data);
      const uid = d._data.uid ? ` uid=${d._data.uid}` : '';
      console.log(`    ${isKeeper ? '✔ CONSERVAR' : '✗ BORRAR  '} id=${d.id}  ${d._data.lastName || ''} ${d._data.firstName || ''} (${fields} campos)${uid}`);
      if (!isKeeper) toDelete.add(d.id);
    }
    console.log();
  };

  console.log('── DUPLICADOS POR DNI ─────────────────────');
  let dniDups = 0;
  for (const [key, group] of Object.entries(byDni)) {
    if (group.length > 1) { printGroup('DNI', key, group); dniDups++; }
  }
  if (dniDups === 0) console.log('  (ninguno)\n');

  console.log('── DUPLICADOS POR LEGAJO ──────────────────');
  let legDups = 0;
  for (const [key, group] of Object.entries(byLeg)) {
    if (group.length > 1) {
      // Si ya están todos marcados para borrar por DNI, no repetir
      const newInGroup = group.filter(d => !toDelete.has(d.id) || d.id === pickKeeper(group).id);
      if (newInGroup.length > 1) { printGroup('LEG', key, group); legDups++; }
    }
  }
  if (legDups === 0) console.log('  (ninguno)\n');

  console.log('────────────────────────────────────────────');
  console.log(`Total a eliminar: ${toDelete.size} documentos`);

  if (toDelete.size === 0) { console.log('\n✔ No hay duplicados para eliminar.'); return; }

  if (DRY_RUN) {
    console.log('\nPara eliminarlos corré:\n  node scripts/dedup-empleados.js --delete\n');
    return;
  }

  // DELETE
  const ids = [...toDelete];
  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK).forEach(id => batch.delete(db.collection('empleados').doc(id)));
    await batch.commit();
    deleted += Math.min(CHUNK, ids.length - i);
    process.stdout.write(`  Eliminados ${deleted}/${ids.length}\r`);
  }
  console.log(`\n✔ ${deleted} documentos duplicados eliminados de producción.`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
