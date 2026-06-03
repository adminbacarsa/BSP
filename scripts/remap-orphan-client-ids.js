/**
 * Re-vincula turnos con clientId huérfano (doc clients/{id} borrado tras migración).
 *
 * Uso:
 *   node scripts/remap-orphan-client-ids.js           # dry-run
 *   node scripts/remap-orphan-client-ids.js --apply   # escribe en Firestore
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}
const db = getFirestore();

const KNOWN = {
  '99yqpqc4ppY9rVXymWhx': 'DB8UZxFC4DpqGSQ3o69w',
  p9atJYpcu9oUspQMFta3: 'ujOVMbL9gK8YK6DsiLvs',
  ZlxmWiRw5qGYtIST5uZh: '8rr2FePfgQ6xY2jH0gyk',
  FzAowOV93fHQcxZhHfjN: 'NS0UBtf6zkHsm2iRRo9W',
};

async function discoverMappings() {
  const clients = (await db.collection('clients').get()).docs.map(d => ({
    id: d.id,
    name: d.data().name,
    objetivos: d.data().objetivos || [],
  }));
  const clientIds = new Set(clients.map(c => c.id));
  const objToClient = new Map();
  clients.forEach(c => c.objetivos.forEach(o => {
    if (o?.id) objToClient.set(String(o.id), c);
  }));

  const turnos = await db.collection('turnos').get();
  const orphanCounts = new Map();
  turnos.docs.forEach(d => {
    const cid = String(d.data().clientId || '').trim();
    if (!cid || clientIds.has(cid)) return;
    orphanCounts.set(cid, (orphanCounts.get(cid) || 0) + 1);
  });

  const mappings = [];
  for (const [orphan, count] of orphanCounts) {
    let target = KNOWN[orphan];
    if (!target) {
      const sample = await db.collection('turnos').where('clientId', '==', orphan).limit(1).get();
      const objId = String(sample.docs[0]?.data()?.objectiveId || '');
      target = objToClient.get(objId)?.id;
    }
    const targetDoc = target ? clients.find(c => c.id === target) : null;
    mappings.push({ orphan, count, target, targetName: targetDoc?.name || null });
  }
  return mappings.sort((a, b) => b.count - a.count);
}

async function applyMapping(orphan, target) {
  const snap = await db.collection('turnos').where('clientId', '==', orphan).get();
  let batch = db.batch();
  let n = 0;
  let updated = 0;
  for (const doc of snap.docs) {
    batch.update(doc.ref, { clientId: target });
    n++;
    updated++;
    if (n >= 490) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return updated;
}

async function main() {
  console.log(`\nModo: ${APPLY ? 'APLICAR' : 'dry-run'}\n`);
  const mappings = await discoverMappings();
  if (!mappings.length) {
    console.log('No hay clientId huérfanos en turnos.');
    return;
  }

  for (const m of mappings) {
    console.log(
      `${m.orphan} (${m.count} turnos) → ${m.target || '?'} ${m.targetName || ''}`,
    );
  }

  const missing = mappings.filter(m => !m.target);
  if (missing.length) {
    console.error('\nNo se pudo resolver destino para:', missing.map(m => m.orphan).join(', '));
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nEjecutá con --apply para actualizar turnos.');
    return;
  }

  let total = 0;
  for (const m of mappings) {
    const n = await applyMapping(m.orphan, m.target);
    total += n;
    console.log(`✓ ${m.orphan} → ${m.target}: ${n} turnos`);
  }
  console.log(`\nListo. ${total} turnos actualizados.\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
