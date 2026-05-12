/**
 * cleanup-orphan-shifts.js
 * Elimina turnos (+ ausencias + novedades) cuyos objectiveId ya no existen en servicios_sla.
 * Uso: node scripts/cleanup-orphan-shifts.js [--dry-run]
 *
 * --dry-run  Solo muestra qué se eliminaría, sin borrar nada.
 * Requiere service-account.json en la raíz del proyecto.
 */

const GOOGLE_APPLICATION_CREDENTIALS = require('path').resolve(__dirname, '../service-account.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_APPLICATION_CREDENTIALS;

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore }                  = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: cert(GOOGLE_APPLICATION_CREDENTIALS), projectId: 'comtroldata' });
}
const db = getFirestore();

const DRY_RUN = process.argv.includes('--dry-run');

async function batchDelete(col, ids) {
  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK).forEach(id => batch.delete(db.collection(col).doc(id)));
    await batch.commit();
    deleted += Math.min(CHUNK, ids.length - i);
  }
  return deleted;
}

async function run() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — solo reporte, nada se elimina' : '🗑️  LIMPIEZA DE TURNOS HUÉRFANOS — PRODUCCIÓN'}\n`);

  // 1. Obtener todos los objectiveId activos en servicios_sla
  console.log('Leyendo servicios_sla...');
  const slaSnap = await db.collection('servicios_sla').get();
  const activeObjectiveIds = new Set(slaSnap.docs.map(d => d.data().objectiveId).filter(Boolean));
  console.log(`  ${slaSnap.size} servicios, ${activeObjectiveIds.size} objectiveIds únicos\n`);

  // 2. Obtener todos los turnos y agrupar por objectiveId
  console.log('Leyendo turnos...');
  const turnosSnap = await db.collection('turnos').get();
  console.log(`  ${turnosSnap.size} turnos en total\n`);

  // Agrupar por objectiveId
  const byObjective = {};
  turnosSnap.docs.forEach(d => {
    const oid = d.data().objectiveId;
    if (!oid) return;
    if (!byObjective[oid]) byObjective[oid] = [];
    byObjective[oid].push(d.id);
  });

  // 3. Filtrar huérfanos (objectiveId sin SLA activo)
  const orphanObjectiveIds = Object.keys(byObjective).filter(oid => !activeObjectiveIds.has(oid));

  if (orphanObjectiveIds.length === 0) {
    console.log('✅ No hay turnos huérfanos. Todo limpio.');
    process.exit(0);
  }

  const orphanShiftIds = orphanObjectiveIds.flatMap(oid => byObjective[oid]);
  console.log(`⚠️  Encontrados ${orphanObjectiveIds.length} objetivo(s) huérfano(s):\n`);
  orphanObjectiveIds.forEach(oid => {
    console.log(`  objectiveId: ${oid}  →  ${byObjective[oid].length} turno(s)`);
  });
  console.log(`\n  Total turnos a eliminar: ${orphanShiftIds.length}`);

  // 4. Buscar ausencias y novedades vinculadas (en chunks de 30 porque 'in' max 30)
  console.log('\nBuscando ausencias y novedades vinculadas...');
  const ausIds = [];
  const novIds = [];
  const CHUNK = 30;
  for (let i = 0; i < orphanShiftIds.length; i += CHUNK) {
    const chunk = orphanShiftIds.slice(i, i + CHUNK);
    const [ausSnap, novSnap] = await Promise.all([
      db.collection('ausencias').where('shiftId', 'in', chunk).get(),
      db.collection('novedades').where('shiftId', 'in', chunk).get(),
    ]);
    ausSnap.docs.forEach(d => ausIds.push(d.id));
    novSnap.docs.forEach(d => novIds.push(d.id));
  }
  console.log(`  ${ausIds.length} ausencia(s), ${novIds.length} novedad(es) vinculadas`);

  console.log(`
Resumen de lo que se eliminará:
  • ${orphanShiftIds.length} turno(s)
  • ${ausIds.length} ausencia(s)
  • ${novIds.length} novedad(es)
`);

  if (DRY_RUN) {
    console.log('DRY RUN: nada eliminado. Volvé a correr sin --dry-run para eliminar.');
    process.exit(0);
  }

  // 5. Confirmar por consola (no interactivo — si llegás acá ya confirmaste leer el dry-run)
  console.log('Eliminando...');
  const [t, a, n] = await Promise.all([
    batchDelete('turnos',   orphanShiftIds),
    batchDelete('ausencias', ausIds),
    batchDelete('novedades', novIds),
  ]);

  console.log(`\n✅ Listo:`);
  console.log(`   ${t} turno(s) eliminados`);
  console.log(`   ${a} ausencia(s) eliminadas`);
  console.log(`   ${n} novedad(es) eliminadas\n`);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
