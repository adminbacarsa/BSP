/**
 * remap-preferred-objectives.js
 * Remapea preferredObjectiveId de los empleados: los IDs numéricos viejos
 * (pre-migración) → nuevos objectiveIds de servicios_sla actuales.
 *
 * Uso:
 *   node scripts/remap-preferred-objectives.js           ← dry-run
 *   node scripts/remap-preferred-objectives.js --confirm ← escribe en producción
 */

const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}
const db = getFirestore();

const DRY_RUN = !process.argv.includes('--confirm');
const BATCH_SIZE = 400;

// Mapeo: objectiveId viejo (numérico) → nuevo objectiveId en servicios_sla actual
// Verificado mediante diagnose-preferred-objectives.js + backup 2026-05-06
const REMAP = {
  '1769017079195': { newId: 'bVCi8alvRQlkSoQFbEp5', name: 'H. San Roque Nuevo'   },
  '1768936428905': { newId: 'xFJmjYYYCS7wEB78EU0c', name: 'H. Misericordia'       },
  '1777917383755': { newId: '9CbYIDmsUGnabENKvXZt', name: 'OBRADOR MALAGUEÑO'     },
  '1778081547840': { newId: 'kTh5JYvGtbOMDbZHOleZ', name: 'OBRADOR CRUZ DEL EJE' },
};

async function main() {
  console.log('='.repeat(60));
  console.log(`REMAP preferredObjectiveId — ${DRY_RUN ? 'DRY-RUN (sin cambios)' : '⚠ ESCRIBIENDO EN PRODUCCIÓN'}`);
  console.log('='.repeat(60));

  const snap = await db.collection('empleados').get();
  console.log(`\nTotal empleados: ${snap.size}`);

  const updates = [];
  let yaCorrectos = 0, sinPref = 0;

  snap.docs.forEach(d => {
    const data = d.data();
    const oldPref = data.preferredObjectiveId || '';
    if (!oldPref) { sinPref++; return; }
    const mapping = REMAP[oldPref];
    if (!mapping) { yaCorrectos++; return; } // ya tiene ID nuevo u otro valor
    updates.push({ docId: d.id, oldPref, newPref: mapping.newId, name: mapping.name,
      empName: `${data.lastName || ''}, ${data.firstName || ''} (leg: ${data.fileNumber || data.legajo || 'S/N'})` });
  });

  console.log(`  Sin preferredObjectiveId: ${sinPref}`);
  console.log(`  Ya con ID nuevo / no necesita cambio: ${yaCorrectos}`);
  console.log(`  A actualizar: ${updates.length}\n`);

  updates.forEach(u => {
    console.log(`  ${u.empName}`);
    console.log(`    "${u.oldPref}" → "${u.newPref}" (${u.name})`);
  });

  if (DRY_RUN) {
    console.log(`\n→ DRY-RUN: ${updates.length} empleado(s) se actualizarían. Pasá --confirm para aplicar.`);
    return;
  }

  if (updates.length === 0) { console.log('\nNada que actualizar.'); return; }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    updates.slice(i, i + BATCH_SIZE).forEach(u => {
      batch.update(db.collection('empleados').doc(u.docId), { preferredObjectiveId: u.newPref });
    });
    await batch.commit();
  }
  console.log(`\n✓ ${updates.length} empleados actualizados.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
