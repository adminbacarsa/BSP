/**
 * Migra docs planificacion_estados legacy `{objectiveId}_{year}_{month}`
 * → `{empresaId}_{objectiveId}_{year}_{month}` si no existe el doc tenant.
 *
 * Opcional: `--stamp-turnos bacarsa` agrega empresaId a turnos sin tenant (emulador/lab).
 *
 * Uso: node scripts/migrate-planificacion-estados-tenant.js [--empresa bacarsa] [--stamp-turnos bacarsa]
 * Requiere emulador Firestore (:8080) o credenciales prod (con cuidado).
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db = getFirestore();

const DEFAULT_EMPRESA = 'bacarsa';

function parseArgs() {
  const args = process.argv.slice(2);
  let empresaId = DEFAULT_EMPRESA;
  let stampTurnos = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) empresaId = args[++i];
    if (args[i] === '--stamp-turnos' && args[i + 1]) stampTurnos = args[++i];
  }
  return { empresaId, stampTurnos };
}

async function migratePlanificacionEstados(empresaId) {
  const snap = await db.collection('planificacion_estados').get();
  let copied = 0;
  let skipped = 0;
  for (const docSnap of snap.docs) {
    const id = docSnap.id;
    if (id.startsWith(`${empresaId}_`)) {
      skipped++;
      continue;
    }
    const parts = id.split('_');
    if (parts.length < 3) {
      skipped++;
      continue;
    }
    const month = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      skipped++;
      continue;
    }
    const objectiveId = parts.slice(0, -2).join('_');
    const newId = `${empresaId}_${objectiveId}_${year}_${month}`;
    const newRef = db.collection('planificacion_estados').doc(newId);
    const existing = await newRef.get();
    if (existing.exists) {
      skipped++;
      continue;
    }
    await newRef.set({
      ...docSnap.data(),
      empresaId,
      objectiveId: docSnap.data().objectiveId || docSnap.data().objetivoId || objectiveId,
      year,
      month,
      migratedFrom: id,
      migratedAt: new Date().toISOString(),
    });
    copied++;
    console.log(`  ✓ ${id} → ${newId}`);
  }
  return { copied, skipped };
}

async function stampTurnosEmpresa(empresaId) {
  const snap = await db.collection('turnos').limit(5000).get();
  const batchSize = 490;
  let updated = 0;
  let batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if (d.data().empresaId) continue;
    batch.update(d.ref, { empresaId });
    updated++;
    n++;
    if (n >= batchSize) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  return updated;
}

async function main() {
  const { empresaId, stampTurnos } = parseArgs();
  console.log(`\n[migrate-planificacion-estados] empresa=${empresaId}\n`);
  const { copied, skipped } = await migratePlanificacionEstados(empresaId);
  console.log(`\nPlanificación: ${copied} copiados, ${skipped} omitidos.`);
  if (stampTurnos) {
    const n = await stampTurnosEmpresa(stampTurnos);
    console.log(`Turnos sin empresaId → ${stampTurnos}: ${n} actualizados.`);
  }
  console.log('\nOK\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
