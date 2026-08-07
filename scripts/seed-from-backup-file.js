/**
 * seed-from-backup-file.js
 * Importa un backup JSON local al emulador Firestore (+ Auth desde system_users).
 *
 * Uso:
 *   node scripts/seed-from-backup-file.js "C:\path\backup.json"
 *   node scripts/seed-from-backup-file.js ./backup.json --empresa bacarsa
 *   node scripts/seed-from-backup-file.js ./backup.json --full
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldPath } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { waitForFirestoreEmulator, sleep } = require('./emulator-firestore-ready');

const PROJECT_ID = 'comtroldata';
const BATCH_SIZE = 250;
const DEFAULT_PASSWORD = 'admin1234';

// Sincronizado con backup.service.ts y restore.service.ts
const EMPRESA_SCOPED_COLS = new Set([
  // Core operativo
  'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
  'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
  'objetivos', 'grupos_objetivos',
  // RRHH / ajustes
  'ajustes_crono', 'ajustes_horas', 'fichajes', 'sesiones_operador',
  'solicitudes_refuerzo', 'supervision_visitas', 'objetivo_consignas',
  // Planificación
  'planificacion_estados',
  // Liquidación
  'liquidacion_turno_contrib',
  // Comunicación / logs
  'user_notifications', 'assistant_interaction_logs', 'audit_logs',
  // Sistema empresa
  'roles', 'feriados', 'system_users', 'client_users', 'integraciones_api',
  // Legacy / emulador
  'planificaciones_historial', 'contracts', 'quotes',
]);

// Colecciones cuyo doc ID es el empresaId (no tienen campo empresaId en el doc)
// Se importan por doc ID en lugar de filtrar por campo.
const DOC_ID_IS_EMPRESA = new Set(['planning_rules']);

// Colecciones pesadas que no se necesitan para desarrollo
const DEV_SKIP_COLS = new Set(['audit_logs', 'user_notifications', 'assistant_interaction_logs', 'historial_operaciones']);

const args = process.argv.slice(2);
const fullMode = args.includes('--full');
const devMode = args.includes('--dev');
const clearAll = args.includes('--clear-all'); // legacy CLI: ya no borra todo el emulador (usar --full)
const empresaIdx = args.indexOf('--empresa');
const empresaId = empresaIdx >= 0 ? String(args[empresaIdx + 1] || '').trim() : 'bacarsa';
const fileArg = args.find(a => !a.startsWith('--') && a !== empresaId);

if (!fileArg) {
  console.error('Uso: node scripts/seed-from-backup-file.js <backup.json> [--empresa bacarsa] [--full] [--dev]');
  process.exit(1);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`No existe: ${filePath}`);
  process.exit(1);
}

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
try { db.settings({ preferRest: true }); } catch { /* ya inicializado */ }
const auth = getAuth();

function docMatchesEmpresa(doc, empId) {
  const docEmpId = String(doc.empresaId ?? '').trim();
  return docEmpId === empId || (empId === 'bacarsa' && docEmpId === '');
}

function deserialize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deserialize);
  if (typeof obj._seconds === 'number' && typeof obj._nanoseconds === 'number') {
    return new Timestamp(obj._seconds, obj._nanoseconds);
  }
  const result = {};
  for (const [k, v] of Object.entries(obj)) result[k] = deserialize(v);
  return result;
}

async function commitBatchWithRetry(batch, label = '') {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await commitBatchWithRetry(batch, colName);
      return;
    } catch (e) {
      const msg = e?.message || String(e);
      if (attempt >= maxAttempts) throw e;
      process.stdout.write(`\nSTATUS:Reintentando escritura${label ? ` (${label})` : ''} (${attempt}/${maxAttempts})...\n`);
      await sleep(400 * attempt);
      await waitForFirestoreEmulator({ maxWaitMs: 45_000 });
    }
  }
}

async function deleteCollectionWhereEmpresa(colName, empId) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(colName).where('empresaId', '==', empId).limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await commitBatchWithRetry(batch, colName);
    deleted += snap.size;
  }
  if (empId === 'bacarsa') {
    while (true) {
      const snap = await db.collection(colName).where('empresaId', '==', '').limit(BATCH_SIZE).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await commitBatchWithRetry(batch, colName);
      deleted += snap.size;
    }
  }
  return deleted;
}

/** Limpia Firestore completo usando la REST API del emulador (instantáneo).
 *  Si el endpoint retorna 500 (bug conocido del emulador), borra colección por colección como fallback. */
async function clearEmulatorFull() {
  process.stdout.write('\nSTATUS:Preparando emulador (limpiando datos)...\n');
  process.stdout.write('Limpiando Firestore completo (REST API)... ');
  const ok = await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8080,
      path: `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      method: 'DELETE',
    }, res => {
      res.resume();
      resolve(res.statusCode === 200 || res.statusCode === 204);
    });
    req.setTimeout(20000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
  if (ok) {
    console.log('OK');
    await sleep(2000);
    await waitForFirestoreEmulator({ maxWaitMs: 60_000 });
    return;
  }
  // Fallback: borrar colección por colección
  console.log('fallback — borrando por colección...');
  const allCols = [...EMPRESA_SCOPED_COLS, 'empresas', 'system_config', 'feriados_nacionales'];
  for (const col of allCols) {
    let deleted = 0;
    while (true) {
      const snap = await db.collection(col).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await commitBatchWithRetry(batch, colName);
      deleted += snap.size;
    }
    if (deleted) process.stdout.write(`  ${col}: ${deleted} docs\n`);
  }
  console.log('Limpieza completa (fallback OK)');
}

async function clearEmpresa(empId) {
  process.stdout.write(`Limpiando datos de ${empId} (por colección)... `);
  let deleted = 0;
  for (const col of EMPRESA_SCOPED_COLS) {
    try {
      deleted += await deleteCollectionWhereEmpresa(col, empId);
    } catch (e) {
      console.warn(`\n  WARN limpiar ${col}: ${e.message}`);
      await sleep(800);
      try {
        deleted += await deleteCollectionWhereEmpresa(col, empId);
      } catch {
        /* omit */
      }
    }
    await sleep(40);
  }
  try {
    const empRef = db.collection('empresas').doc(empId);
    const snap = await empRef.get();
    if (snap.exists) { await empRef.delete(); deleted += 1; }
  } catch { /* omit */ }
  console.log(`${deleted} docs borrados`);
}

async function seedAuthFromSystemUsers(systemUsers) {
  if (!Array.isArray(systemUsers) || systemUsers.length === 0) {
    console.log('Auth: sin system_users en backup');
    return 0;
  }
  process.stdout.write('\nSTATUS:Sincronizando usuarios Auth...\n');
  let created = 0;
  for (const u of systemUsers) {
    const email = String(u.email ?? '').trim();
    const uid = String(u._id ?? u.uid ?? '').trim();
    if (!email || !uid) continue;
    try {
      await auth.createUser({
        uid,
        email,
        displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined,
        password: DEFAULT_PASSWORD,
        disabled: u.status === 'INACTIVE',
      });
      const role = String(u.role ?? 'ADMIN').trim();
      if (role) await auth.setCustomUserClaims(uid, { role });
      created++;
    } catch (e) {
      if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
        try {
          // Si el email ya existe con OTRO uid (caso seed vs backup), buscar el uid real
          let targetUid = uid;
          if (e.code === 'auth/email-already-exists') {
            try {
              const existing = await auth.getUserByEmail(email);
              targetUid = existing.uid;
            } catch { /* mantener uid del backup */ }
          }
          await auth.updateUser(targetUid, { email, password: DEFAULT_PASSWORD });
          const role = String(u.role ?? 'ADMIN').trim();
          if (role) await auth.setCustomUserClaims(targetUid, { role });
        } catch { /* omit */ }
      } else {
        console.warn(`  WARN Auth ${email}: ${e.message}`);
      }
    }
  }
  console.log(`Auth: ${created} usuarios (${DEFAULT_PASSWORD} si son nuevos)`);
  return created;
}

async function seedFirestore(collections, empId, isFull, isDev) {
  // Pre-calcular total para reportar progreso real
  let grandTotal = 0;
  for (const [col, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    if (isDev && DEV_SKIP_COLS.has(col)) continue;
    if (!isFull && col !== 'empresas' && !EMPRESA_SCOPED_COLS.has(col)) continue;
    grandTotal += docs.length;
  }

  let written = 0;
  for (const [col, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    if (isDev && DEV_SKIP_COLS.has(col)) {
      console.log(`  ${col.padEnd(28)} [--dev: omitida]`);
      continue;
    }

    let filtered = docs;
    if (!isFull) {
      if (col === 'empresas') {
        filtered = docs.filter(d => d._id === empId);
      } else if (EMPRESA_SCOPED_COLS.has(col)) {
        filtered = docs.filter(d => docMatchesEmpresa(d, empId));
      } else if (DOC_ID_IS_EMPRESA.has(col)) {
        // El doc ID es el empresaId (ej: planning_rules/bacarsa)
        filtered = docs.filter(d => d._id === empId);
      } else {
        console.log(`  ${col.padEnd(28)} [ignorada — no está en EMPRESA_SCOPED_COLS]`);
        continue;
      }
      if (filtered.length === 0) continue;
    }

    process.stdout.write(`  ${col.padEnd(28)} ${String(filtered.length).padStart(6)} docs ... `);
    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = db.batch();
      filtered.slice(i, i + BATCH_SIZE).forEach(doc => {
        const { _id, ...fields } = doc;
        if (!_id) return;
        batch.set(db.collection(col).doc(_id), deserialize(fields), { merge: false });
      });
      await commitBatchWithRetry(batch, colName);
      written += Math.min(BATCH_SIZE, filtered.length - i);
      process.stdout.write(`\nPROGRESS:${written}:${grandTotal}:${col}`);
      if (((i / BATCH_SIZE) + 1) % 4 === 0) await sleep(50);
    }
    process.stdout.write('\n');
    console.log('OK');
  }
  return written;
}

async function run() {
  await waitForFirestoreEmulator({ maxWaitMs: 30_000 });
  console.log(`\nLeyendo ${filePath}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const meta = data._meta || {};
  const { _meta, _auth_users, ...collections } = data;
  const isFull = fullMode;
  const isDev = devMode;
  const scope = isFull ? 'plataforma completa' : `empresa ${empresaId}`;
  const devNote = isDev ? ' [--dev: sin audit_logs/notifications]' : '';

  console.log(`Backup: ${meta.exportedAt || '?'} — ${meta.totalDocs || '?'} docs — alcance import: ${scope}${devNote}\n`);

  if (isFull || clearAll) {
    await clearEmulatorFull();
  } else {
    await clearEmpresa(empresaId);
  }

  const authUsers = Array.isArray(_auth_users) && _auth_users.length > 0
    ? _auth_users
    : null;
  if (authUsers) {
    await seedAuthFromSystemUsers(authUsers.map(u => ({ ...u, _id: u.uid })));
  } else {
    await seedAuthFromSystemUsers(collections.system_users || []);
  }

  console.log('\nSembrando Firestore:');
  const written = await seedFirestore(collections, empresaId, isFull, isDev);

  console.log(`\n✔ Listo — ${written.toLocaleString()} documentos importados (${scope})`);
  console.log('  Firestore UI: http://127.0.0.1:4000/firestore');
  console.log('  App: http://localhost:3000 (recargá con Ctrl+F5)\n');
}

run().catch(e => {
  console.error('\nError:', e.message);
  process.exit(1);
});
