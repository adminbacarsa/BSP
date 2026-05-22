/**
 * diagnose-preferred-objectives.js
 * Diagnóstico: preferredObjectiveId en empleados vs objectiveId en servicios_sla
 *
 * Uso: node scripts/diagnose-preferred-objectives.js
 */

const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}
const db = getFirestore();

async function main() {
  console.log('Leyendo empleados con preferredObjectiveId...');
  const empSnap = await db.collection('empleados').get();

  const conPref = empSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.preferredObjectiveId);

  console.log(`  Total empleados: ${empSnap.size}  |  Con preferredObjectiveId: ${conPref.length}\n`);

  if (conPref.length === 0) {
    console.log('❌ Ningún empleado tiene preferredObjectiveId. El restore no persistió o el campo fue borrado.');
    return;
  }

  console.log('Leyendo servicios_sla activos...');
  const slaSnap = await db.collection('servicios_sla').where('status', '==', 'active').get();
  const slaByObjId = {};
  slaSnap.docs.forEach(d => {
    const data = d.data();
    const key = data.objectiveId || d.id;
    if (key) slaByObjId[key] = { docId: d.id, name: data.objectiveName || data.name, empresaId: data.empresaId || '' };
  });

  console.log(`  Total SLA activos: ${slaSnap.size}  |  objectiveIds únicos: ${Object.keys(slaByObjId).length}\n`);

  let matches = 0, mismatches = 0;
  for (const emp of conPref) {
    const pref = emp.preferredObjectiveId;
    const sla  = slaByObjId[pref];
    const name = `${emp.lastName || ''}, ${emp.firstName || ''} (leg: ${emp.fileNumber || emp.legajo || 'S/N'})`;
    if (sla) {
      console.log(`  ✓ ${name}`);
      console.log(`      preferredObjectiveId="${pref}" → "${sla.name}" [${sla.empresaId || 'sin empresa'}]`);
      matches++;
    } else {
      console.log(`  ✗ ${name}`);
      console.log(`      preferredObjectiveId="${pref}" → NO ENCONTRADO en servicios_sla`);
      mismatches++;
    }
  }

  console.log(`\n══════ RESUMEN ══════`);
  console.log(`  Con preferredObjectiveId: ${conPref.length}`);
  console.log(`  ✓ Con SLA match:          ${matches}`);
  console.log(`  ✗ Sin SLA match:          ${mismatches}`);

  if (mismatches > 0) {
    console.log('\n  objectiveIds disponibles en SLA (primeros 20):');
    Object.entries(slaByObjId).slice(0, 20).forEach(([k, v]) =>
      console.log(`    "${k}" → "${v.name}" [${v.empresaId}]`)
    );
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
