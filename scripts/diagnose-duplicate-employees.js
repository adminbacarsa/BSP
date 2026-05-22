/**
 * diagnose-duplicate-employees.js
 * Detecta empleados duplicados dentro de la misma empresa (mismo legajo o DNI).
 * Uso: node scripts/diagnose-duplicate-employees.js [--confirm]
 *   Sin --confirm: solo reporta. Con --confirm: elimina duplicados (mantiene el más completo).
 */

const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}
const db = getFirestore();

const DRY_RUN = !process.argv.includes('--confirm');

function score(data) {
  // Más campos completos = mayor score → este se conserva
  let s = 0;
  if (data.preferredObjectiveId) s += 10;
  if (data.email) s += 5;
  if (data.portalInvite?.sent) s += 8;
  if (data.uid) s += 6;
  if (data.empresaId) s += 3;
  if (data.startDate || data.fechaIngreso) s += 2;
  if (data.phone || data.telefono) s += 1;
  return s;
}

async function main() {
  console.log('Leyendo empleados de producción...');
  const snap = await db.collection('empleados').get();
  console.log(`Total documentos: ${snap.size}\n`);

  // Agrupar por empresa + legajo y empresa + DNI
  const byLegajo = {}; // key: `${empresaId}__${fileNumber}`
  const byDni    = {}; // key: `${empresaId}__${dni}`

  snap.docs.forEach(d => {
    const data = d.data();
    const emp = (data.empresaId || 'bacarsa').trim().toLowerCase();
    const leg = (data.fileNumber || data.legajo || '').toString().trim();
    const dni = (data.dni || '').toString().trim();

    if (leg) {
      const k = `${emp}__${leg}`;
      if (!byLegajo[k]) byLegajo[k] = [];
      byLegajo[k].push({ id: d.id, data, emp });
    }
    if (dni && dni !== 'S/D') {
      const k = `${emp}__${dni}`;
      if (!byDni[k]) byDni[k] = [];
      byDni[k].push({ id: d.id, data, emp });
    }
  });

  const toDelete = new Set();
  let dupGroups = 0;

  const report = (groups, label) => {
    for (const [key, docs] of Object.entries(groups)) {
      if (docs.length < 2) continue;
      dupGroups++;
      const [empresa, valor] = key.split('__');
      console.log(`\n[DUP ${label}] empresa="${empresa}" ${label}="${valor}" — ${docs.length} docs:`);
      // Ordenar por score desc → el primero se conserva
      docs.sort((a, b) => score(b.data) - score(a.data));
      docs.forEach((d, i) => {
        const tag = i === 0 ? '✓ CONSERVAR' : '✗ ELIMINAR ';
        const name = `${d.data.lastName || ''}, ${d.data.firstName || ''}`;
        console.log(`  ${tag}  id=${d.id}  nombre="${name}"  score=${score(d.data)}  preferredObj=${d.data.preferredObjectiveId || '-'}  email=${d.data.email || '-'}`);
        if (i > 0) toDelete.add(d.id);
      });
    }
  };

  report(byLegajo, 'legajo');
  report(byDni, 'dni');

  // Eliminar IDs que aparezcan en ambas listas (ya procesados)
  const uniqueToDelete = [...toDelete];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Grupos duplicados encontrados: ${dupGroups}`);
  console.log(`Documentos a eliminar: ${uniqueToDelete.length}`);

  if (uniqueToDelete.length === 0) {
    console.log('Sin duplicados. Todo limpio.');
    return;
  }

  if (DRY_RUN) {
    console.log(`\n→ DRY-RUN. Pasá --confirm para eliminar los duplicados.`);
    return;
  }

  console.log('\nEliminando duplicados...');
  const BATCH = 400;
  for (let i = 0; i < uniqueToDelete.length; i += BATCH) {
    const batch = db.batch();
    uniqueToDelete.slice(i, i + BATCH).forEach(id => batch.delete(db.collection('empleados').doc(id)));
    await batch.commit();
  }
  console.log(`✓ ${uniqueToDelete.length} documentos duplicados eliminados.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
