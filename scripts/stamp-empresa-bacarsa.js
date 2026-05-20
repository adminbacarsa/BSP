/**
 * Etiqueta documentos legacy (sin empresaId o vacío) con empresaId: bacarsa.
 * No modifica docs que ya tienen otra empresa (ej. prueba_sa).
 *
 * Uso emulador (default si FIRESTORE_EMULATOR_HOST no está definido en el entorno):
 *   $env:FIRESTORE_EMULATOR_HOST='localhost:8080'
 *   node scripts/stamp-empresa-bacarsa.js --dry-run
 *   node scripts/stamp-empresa-bacarsa.js
 *
 * Uso producción (comtroldata):
 *   Quitar FIRESTORE_EMULATOR_HOST del entorno.
 *   Credenciales: service-account.json en la raíz del repo (como export-prod.js)
 *     o GOOGLE_APPLICATION_CREDENTIALS / firebase login + ADC.
 *   node scripts/stamp-empresa-bacarsa.js --dry-run
 *   node scripts/stamp-empresa-bacarsa.js
 *
 * Opciones:
 *   --empresa bacarsa          (default bacarsa)
 *   --dry-run                  solo cuenta, no escribe
 *   --collections turnos,clients   subconjunto de colecciones
 *
 * Tras ejecutar en prod: recargar planificación con selector Bacarsa.
 */

const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

const DEFAULT_EMPRESA = 'bacarsa';
const BATCH_SIZE = 490;
const PAGE_SIZE = 500;

const ALL_COLLECTIONS = [
  'empleados',
  'clients',
  'clientes',
  'turnos',
  'ausencias',
  'novedades',
  'swap_requests',
  'contratos_servicio',
  'tipos_turno',
  'servicios_sla',
  'objetivos',
  'planificacion_estados',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let empresaId = DEFAULT_EMPRESA;
  let dryRun = false;
  let collections = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) empresaId = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--collections' && args[i + 1]) {
      collections = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return { empresaId, dryRun, collections };
}

function isLegacyForStamp(data) {
  return !String(data?.empresaId ?? '').trim();
}

function initFirestore() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    console.log(`Modo: emulador Firestore (${emulator})`);
    if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
    return getFirestore();
  }

  console.log('Modo: Firestore PRODUCCIÓN (comtroldata)');
  const saPath = path.resolve(__dirname, '../service-account.json');
  if (!getApps().length) {
    try {
      initializeApp({ credential: cert(saPath), projectId: 'comtroldata' });
    } catch {
      initializeApp({ projectId: 'comtroldata' });
      console.log('  (ADC / GOOGLE_APPLICATION_CREDENTIALS — sin service-account.json)');
    }
  }
  return getFirestore();
}

async function scanCollection(db, colName) {
  const legacy = [];
  let last;
  for (;;) {
    let q = db.collection(colName).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isLegacyForStamp(d.data())) legacy.push(d);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return legacy;
}

async function stampCollection(db, colName, empresaId, dryRun) {
  const docs = await scanCollection(db, colName);
  if (docs.length === 0) {
    return { colName, stamped: 0, scanned: 0 };
  }

  if (dryRun) {
    return { colName, stamped: docs.length, scanned: docs.length, dryRun: true };
  }

  let stamped = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.update(d.ref, { empresaId }));
    await batch.commit();
    stamped += chunk.length;
  }
  return { colName, stamped, scanned: docs.length };
}

async function main() {
  const { empresaId, dryRun, collections } = parseArgs();
  const cols = (collections && collections.length > 0 ? collections : ALL_COLLECTIONS).filter((c) =>
    ALL_COLLECTIONS.includes(c),
  );
  const unknown = (collections || []).filter((c) => !ALL_COLLECTIONS.includes(c));
  if (unknown.length) {
    console.warn('Colecciones ignoradas (no en lista):', unknown.join(', '));
  }
  if (cols.length === 0) {
    console.error('Sin colecciones válidas. Usá --collections turnos,clients,...');
    process.exit(1);
  }

  const db = initFirestore();
  console.log(`\n[stamp-empresa-bacarsa] empresa=${empresaId} dryRun=${dryRun}`);
  console.log(`Colecciones: ${cols.join(', ')}\n`);

  const summary = [];
  for (const col of cols) {
    process.stdout.write(`  ${col}... `);
    const r = await stampCollection(db, col, empresaId, dryRun);
    summary.push(r);
    console.log(dryRun ? `${r.stamped} legacy (dry-run)` : `${r.stamped} actualizados`);
  }

  const total = summary.reduce((n, r) => n + (r.stamped || 0), 0);
  console.log(`\nTotal${dryRun ? ' a etiquetar' : ' etiquetados'}: ${total}`);
  if (dryRun) console.log('\nEjecutá sin --dry-run para aplicar cambios.\n');
  else console.log('\nOK — recargá planificación Bacarsa en el panel.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
