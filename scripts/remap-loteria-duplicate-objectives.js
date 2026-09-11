/**
 * Unifica duplicado LOTERÍA-CASINOS: remapea objectiveId (cliente A → B) y clientId huérfano.
 *
 * Canónico (más SLA / ya mapeado en remap-orphan-client-ids.js):
 *   8rr2FePfgQ6xY2jH0gyk  LOTERÍA-CASINOS
 * Duplicado a absorber:
 *   2YzI0f3ZWcwdOmG3Vlc1  LOTERÍA-CASINOS
 * clientId huérfano en turnos:
 *   ZlxmWiRw5qGYtIST5uZh  → canónico
 *
 * Uso:
 *   node scripts/remap-loteria-duplicate-objectives.js              # dry-run
 *   node scripts/remap-loteria-duplicate-objectives.js --apply      # escribe turnos (+ SLA opcional)
 *   node scripts/remap-loteria-duplicate-objectives.js --apply --deactivate-duplicate
 *   node scripts/remap-loteria-duplicate-objectives.js --apply --sla
 *
 * Prod (ADC / service account del proyecto comtroldata).
 * Emulador: set FIRESTORE_EMULATOR_HOST=localhost:8080
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const DEACTIVATE = process.argv.includes('--deactivate-duplicate');
const DO_SLA = process.argv.includes('--sla');

const CANONICAL_CLIENT_ID = '8rr2FePfgQ6xY2jH0gyk';
const DUPLICATE_CLIENT_ID = '2YzI0f3ZWcwdOmG3Vlc1';
const ORPHAN_CLIENT_IDS = ['ZlxmWiRw5qGYtIST5uZh', DUPLICATE_CLIENT_ID];

/** objectiveId cliente A → objectiveId cliente B (mismo nombre de sede). */
const OBJECTIVE_A_TO_B = {
  iHRXtrt5q5dylsSUWUpM: 'wc5RzZsM5dLtC9XT55yf', // Lotería Casa Central
  fPdVjIHYN13XsIi5NnrN: '990xxTR5X5DHVP4UaVMl', // Lotería Imprenta
  jDlsttXsKiuptxZEKrhG: 'ShHRyHQTsZAgFqvzBA3v', // Casino Laboulaye
  DvfFcQDqErMErEcwMrWA: 'lSB7BJUfmTBcmjXcjGck', // Casino Corral de Bustos
  jf7l3Xe2AStCLUdNrymK: '7iVoT4ZCd9QuwZ4QMsP3', // Casino Villa María
  rJthjBT4NHftolQch20g: 'wOP6A1rxbq4wvVzQE08C', // Casino Miramar
  '1qaCdOTjKCbXp6W4Eaqj': 'uaiQwu5ge9ujZKfaRuKZ', // Casino Carlos Paz
  '6cGRLC59xweU9GfM8UdA': 'hO6Mg3k0yBumvDzHVcaO', // Casino Mina Clavero
  AmmdcI01U8UUj4IzW24e: 'N6BqIMwGpmHpD82qSji1', // Casino Río IV
  ymnfpKkdmKGndXP5iSbb: 'uf5LuGE0et4DRG8Npitg', // Casino Embalse
  vb2fmGf2w7u9z1OQPIO7: 'ApC8R5sBpVBRBAw5EJ2b', // CET Río Ceballos
  xnKPzVCJPO7MrT9XmEgg: 'kTh5JYvGtbOMDbZHOleZ', // Obrador Cruz del Eje
};

const OBJECTIVE_NAMES = {
  iHRXtrt5q5dylsSUWUpM: 'Lotería Casa Central',
  fPdVjIHYN13XsIi5NnrN: 'Lotería Imprenta',
  jDlsttXsKiuptxZEKrhG: 'Casino Laboulaye',
  DvfFcQDqErMErEcwMrWA: 'Casino Corral de Bustos',
  jf7l3Xe2AStCLUdNrymK: 'Casino Villa María',
  rJthjBT4NHftolQch20g: 'Casino Miramar',
  '1qaCdOTjKCbXp6W4Eaqj': 'Casino Carlos Paz',
  '6cGRLC59xweU9GfM8UdA': 'Casino Mina Clavero',
  AmmdcI01U8UUj4IzW24e: 'Casino Río IV',
  ymnfpKkdmKGndXP5iSbb: 'Casino Embalse',
  vb2fmGf2w7u9z1OQPIO7: 'CET Río Ceballos',
  xnKPzVCJPO7MrT9XmEgg: 'Obrador Cruz del Eje',
};

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}
const db = getFirestore();

async function commitInChunks(updates) {
  let batch = db.batch();
  let n = 0;
  let total = 0;
  for (const { ref, data } of updates) {
    batch.update(ref, data);
    n += 1;
    total += 1;
    if (n >= 450) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return total;
}

async function collectTurnosByObjectiveId(oid) {
  const snap = await db.collection('turnos').where('objectiveId', '==', oid).get();
  return snap.docs;
}

async function collectTurnosByClientId(cid) {
  const snap = await db.collection('turnos').where('clientId', '==', cid).get();
  return snap.docs;
}

function patchForTurno(data) {
  const patch = {};
  const oid = String(data.objectiveId || '').trim();
  const cid = String(data.clientId || '').trim();
  const targetOid = OBJECTIVE_A_TO_B[oid];
  if (targetOid && targetOid !== oid) {
    patch.objectiveId = targetOid;
    const name = OBJECTIVE_NAMES[oid];
    if (name) patch.objectiveName = name;
  }
  if (ORPHAN_CLIENT_IDS.includes(cid) && cid !== CANONICAL_CLIENT_ID) {
    patch.clientId = CANONICAL_CLIENT_ID;
  }
  return Object.keys(patch).length ? patch : null;
}

async function planTurnoUpdates() {
  const byId = new Map();

  for (const oid of Object.keys(OBJECTIVE_A_TO_B)) {
    const docs = await collectTurnosByObjectiveId(oid);
    for (const d of docs) {
      const patch = patchForTurno(d.data());
      if (!patch) continue;
      const prev = byId.get(d.id) || {};
      byId.set(d.id, { ref: d.ref, data: { ...prev, ...patch }, fromOid: oid });
    }
  }

  for (const cid of ORPHAN_CLIENT_IDS) {
    if (cid === CANONICAL_CLIENT_ID) continue;
    const docs = await collectTurnosByClientId(cid);
    for (const d of docs) {
      const patch = patchForTurno(d.data());
      if (!patch) continue;
      const existing = byId.get(d.id);
      if (existing) {
        byId.set(d.id, { ref: d.ref, data: { ...existing.data, ...patch }, fromOid: existing.fromOid });
      } else {
        byId.set(d.id, { ref: d.ref, data: patch, fromOid: null });
      }
    }
  }

  return [...byId.values()];
}

async function planSlaUpdates() {
  const updates = [];
  const snap = await db.collection('servicios_sla').where('clientId', '==', DUPLICATE_CLIENT_ID).get();
  for (const d of snap.docs) {
    const data = d.data();
    const oid = String(data.objectiveId || '').trim();
    const patch = { clientId: CANONICAL_CLIENT_ID };
    if (OBJECTIVE_A_TO_B[oid]) {
      patch.objectiveId = OBJECTIVE_A_TO_B[oid];
      const name = OBJECTIVE_NAMES[oid];
      if (name) patch.objectiveName = name;
    }
    updates.push({ ref: d.ref, data: patch, slaId: d.id, oid });
  }
  return updates;
}

async function main() {
  console.log('\n=== Remap LOTERÍA-CASINOS (duplicado → canónico) ===');
  console.log(`Modo: ${APPLY ? 'APLICAR' : 'dry-run'}`);
  console.log(`Canónico: ${CANONICAL_CLIENT_ID}`);
  console.log(`Duplicado: ${DUPLICATE_CLIENT_ID}`);
  console.log(`clientId huérfanos → canónico: ${ORPHAN_CLIENT_IDS.filter((c) => c !== CANONICAL_CLIENT_ID).join(', ')}`);
  console.log(`SLA: ${DO_SLA ? 'sí' : 'no'} | desactivar duplicado: ${DEACTIVATE ? 'sí' : 'no'}`);
  console.log('');

  const canon = await db.collection('clients').doc(CANONICAL_CLIENT_ID).get();
  const dup = await db.collection('clients').doc(DUPLICATE_CLIENT_ID).get();
  if (!canon.exists) {
    console.error('Cliente canónico no existe.');
    process.exit(1);
  }
  if (!dup.exists) {
    console.warn('Cliente duplicado no existe (¿ya unificado?). Se sigue con remap de turnos.');
  } else {
    console.log('CRM canónico:', canon.data().name, `| objetivos ${(canon.data().objetivos || []).length}`);
    console.log('CRM duplicado:', dup.data().name, `| objetivos ${(dup.data().objetivos || []).length} | status ${dup.data().status || '-'}`);
  }
  console.log('');

  console.log('Mapa objectiveId A → B:');
  for (const [a, b] of Object.entries(OBJECTIVE_A_TO_B)) {
    console.log(`  ${OBJECTIVE_NAMES[a] || '?'} | ${a} → ${b}`);
  }
  console.log('');

  const turnoUpdates = await planTurnoUpdates();
  const byOid = new Map();
  let clientOnly = 0;
  for (const u of turnoUpdates) {
    if (u.fromOid) byOid.set(u.fromOid, (byOid.get(u.fromOid) || 0) + 1);
    else clientOnly += 1;
  }
  console.log(`Turnos a actualizar: ${turnoUpdates.length}`);
  for (const [oid, n] of [...byOid.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${OBJECTIVE_NAMES[oid] || oid}: ${n} docs`);
  }
  if (clientOnly) console.log(`  (solo clientId, objectiveId ya canónico): ${clientOnly}`);

  let slaUpdates = [];
  if (DO_SLA) {
    slaUpdates = await planSlaUpdates();
    console.log(`\nSLA a actualizar (clientId duplicado): ${slaUpdates.length}`);
  }

  const samples = turnoUpdates.slice(0, 5);
  if (samples.length) {
    console.log('\nMuestra patches:');
    samples.forEach((s) => console.log(' ', s.ref.id, s.data));
  }

  if (!APPLY) {
    console.log('\nDry-run OK. Para aplicar:');
    console.log('  node scripts/remap-loteria-duplicate-objectives.js --apply');
    console.log('  node scripts/remap-loteria-duplicate-objectives.js --apply --sla');
    console.log('  node scripts/remap-loteria-duplicate-objectives.js --apply --sla --deactivate-duplicate');
    return;
  }

  console.log('\nEscribiendo turnos...');
  const nTurnos = await commitInChunks(
    turnoUpdates.map((u) => ({
      ref: u.ref,
      data: { ...u.data, remappedAt: FieldValue.serverTimestamp(), remappedFrom: 'loteria-duplicate-objectives' },
    })),
  );
  console.log(`✓ turnos: ${nTurnos}`);

  if (DO_SLA && slaUpdates.length) {
    console.log('Escribiendo SLA...');
    const nSla = await commitInChunks(
      slaUpdates.map((u) => ({
        ref: u.ref,
        data: { ...u.data, remappedAt: FieldValue.serverTimestamp(), remappedFrom: 'loteria-duplicate-objectives' },
      })),
    );
    console.log(`✓ sla: ${nSla}`);
  }

  if (DEACTIVATE && dup.exists) {
    await db.collection('clients').doc(DUPLICATE_CLIENT_ID).update({
      status: 'INACTIVE',
      remappedIntoClientId: CANONICAL_CLIENT_ID,
      remappedAt: FieldValue.serverTimestamp(),
      remappedFrom: 'loteria-duplicate-objectives',
    });
    console.log(`✓ cliente duplicado → status INACTIVE`);
  }

  console.log('\nListo. Reabrí prefactura julio Lotería y verificá que no queden «Objetivo sin nombre».\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
