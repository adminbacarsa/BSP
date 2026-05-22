/**
 * restore-selective.js
 * Restaura SELECTIVAMENTE desde un backup:
 *   1. Colección `convenios_colectivos` completa (merge — no borra los existentes)
 *   2. Campo `preferredObjectiveId` en empleados (solo actualiza ese campo)
 *
 * Uso:
 *   node scripts/restore-selective.js --file ./backups/backup_2026-05-06.json [--confirm]
 *   node scripts/restore-selective.js --drive-id DRIVE_FILE_ID [--confirm]
 *
 * Sin --confirm: dry-run (solo muestra qué haría, no escribe nada).
 * Con --confirm: escribe en PRODUCCIÓN.
 */

const { execSync } = require('child_process');
const https        = require('https');
const fs           = require('fs');
const path         = require('path');
const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp }                    = require('firebase-admin/firestore');

// ── Inicializar Admin SDK → PRODUCCIÓN (gcloud ADC) ─────────────────────────
if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}
const db = getFirestore();

const BATCH_SIZE = 400;
const args       = process.argv.slice(2);
const DRY_RUN    = !args.includes('--confirm');
const fileIdx    = args.indexOf('--file');
const driveIdx   = args.indexOf('--drive-id');

if (fileIdx === -1 && driveIdx === -1) {
  console.error('Uso: node scripts/restore-selective.js --file <path.json> [--confirm]');
  console.error('  o: node scripts/restore-selective.js --drive-id <DRIVE_FILE_ID> [--confirm]');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function deserialize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deserialize);
  if (typeof obj === 'object') {
    if ('_seconds' in obj && '_nanoseconds' in obj) {
      return new Timestamp(obj._seconds, obj._nanoseconds);
    }
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = deserialize(v);
    return r;
  }
  return obj;
}

async function getADCToken() {
  const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
  return token;
}

function downloadFromDrive(fileId, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path:     `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      headers:  { Authorization: `Bearer ${token}` },
    };
    https.get(options, res => {
      if (res.statusCode !== 200) { reject(new Error(`Drive respondió ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Carga del backup ─────────────────────────────────────────────────────────
async function loadBackup() {
  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Archivo no encontrado: ${filePath}`);
      process.exit(1);
    }
    console.log(`Leyendo backup local: ${filePath}`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  const driveId = args[driveIdx + 1];
  console.log(`Descargando backup de Drive: ${driveId}`);
  const token = await getADCToken();
  const json  = await downloadFromDrive(driveId, token);
  return JSON.parse(json);
}

// ── Restaurar convenios_colectivos ───────────────────────────────────────────
async function restoreConvenios(backup) {
  const docs = backup.collections?.convenios_colectivos || backup.convenios_colectivos;
  if (!docs || docs.length === 0) {
    console.log('\n[convenios_colectivos] No hay documentos en el backup — saltando.');
    return;
  }

  console.log(`\n[convenios_colectivos] ${docs.length} documento(s) en el backup:`);
  for (const doc of docs) {
    console.log(`  · ${doc._id}  nombre="${doc.nombre || '(sin nombre)'}"`);
  }

  if (DRY_RUN) {
    console.log('  → DRY-RUN: no se escribió nada. Pasá --confirm para aplicar.');
    return;
  }

  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_SIZE)) {
      const { _id, ...data } = doc;
      batch.set(db.collection('convenios_colectivos').doc(_id), deserialize(data), { merge: true });
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, docs.length - i);
  }
  console.log(`  ✓ ${written} convenios escritos en producción (merge).`);
}

// ── Restaurar preferredObjectiveId en empleados ──────────────────────────────
async function restorePreferredObjective(backup) {
  const backupEmps = backup.collections?.empleados || backup.empleados;
  if (!backupEmps || backupEmps.length === 0) {
    console.log('\n[empleados.preferredObjectiveId] No hay empleados en el backup — saltando.');
    return;
  }

  const candidatos = backupEmps.filter(e => e.preferredObjectiveId);
  console.log(`\n[empleados.preferredObjectiveId] ${candidatos.length} empleado(s) con objetivo preferido en el backup.`);
  if (candidatos.length === 0) { console.log('  (ninguno tenía preferredObjectiveId en el backup)'); return; }

  // Leer empleados actuales de producción
  const prodSnap = await db.collection('empleados').get();

  // Índices por distintos identificadores estables
  const byDocId    = {};  // Firestore doc ID (si no hubo migración)
  const byLegajo   = {};  // fileNumber / legajo (más robusto post-migración)
  const byDni      = {};  // DNI como fallback
  prodSnap.forEach(d => {
    const data = d.data();
    byDocId[d.id] = { id: d.id, ...data };
    const leg = (data.fileNumber || data.legajo || '').toString().trim();
    if (leg) byLegajo[leg] = { id: d.id, ...data };
    const dni = (data.dni || '').toString().trim();
    if (dni) byDni[dni] = { id: d.id, ...data };
  });

  console.log(`  (${prodSnap.size} empleados en producción actual)`);

  const updates = [];
  let yaCorrectos = 0, sinMatch = 0;

  for (const emp of candidatos) {
    const leg = (emp.fileNumber || emp.legajo || '').toString().trim();
    const dni = (emp.dni || '').toString().trim();

    // Buscar por ID directo, luego legajo, luego DNI
    const prod = byDocId[emp._id] || (leg && byLegajo[leg]) || (dni && byDni[dni]);

    const nombre = `${emp.lastName || ''}, ${emp.firstName || ''} (legajo: ${leg || 'N/A'})`;

    if (!prod) {
      console.log(`  SKIP — sin match: ${nombre}`);
      sinMatch++;
      continue;
    }

    const actual  = prod.preferredObjectiveId || '(vacío)';
    const nuevoPref = emp.preferredObjectiveId;

    if (actual === nuevoPref) {
      console.log(`  = ${nombre} — ya correcto: ${nuevoPref}`);
      yaCorrectos++;
    } else {
      console.log(`  ≠ ${nombre}`);
      console.log(`      actual: "${actual}" → backup: "${nuevoPref}"`);
      updates.push({ id: prod.id, preferredObjectiveId: nuevoPref });
    }
  }

  console.log(`\n  Resumen: ${updates.length} a actualizar, ${yaCorrectos} ya correctos, ${sinMatch} sin match.`);

  if (updates.length === 0) { console.log('  Nada que hacer.'); return; }

  if (DRY_RUN) {
    console.log(`  → DRY-RUN: ${updates.length} empleado(s) se actualizarían. Pasá --confirm para aplicar.`);
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + BATCH_SIZE)) {
      batch.update(db.collection('empleados').doc(u.id), { preferredObjectiveId: u.preferredObjectiveId });
    }
    await batch.commit();
  }
  console.log(`  ✓ ${updates.length} empleados actualizados (solo campo preferredObjectiveId).`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log(`RESTORE SELECTIVO — ${DRY_RUN ? 'DRY-RUN (sin cambios)' : '⚠ ESCRIBIENDO EN PRODUCCIÓN'}`);
  console.log('='.repeat(60));

  const backup = await loadBackup();

  // Detectar formato del backup (puede ser { collections: {...} } o directo)
  const keys = Object.keys(backup);
  console.log(`Backup cargado. Claves de nivel superior: ${keys.join(', ')}`);

  await restoreConvenios(backup);
  await restorePreferredObjective(backup);

  console.log('\n' + '='.repeat(60));
  if (DRY_RUN) {
    console.log('DRY-RUN completo. Para aplicar los cambios ejecutá con --confirm:');
    const cmd = args.filter(a => a !== '--confirm').join(' ');
    console.log(`  node scripts/restore-selective.js ${cmd} --confirm`);
  } else {
    console.log('Restauración selectiva completada.');
  }
  console.log('='.repeat(60));
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
