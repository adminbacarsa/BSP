/**
 * Elimina datos Firestore del tenant prueba_sa (u otro --empresa).
 * NO toca Firebase Auth por defecto (ver nota al final).
 *
 * Producción: sin FIRESTORE_EMULATOR_HOST.
 * Credenciales: service-account.json en la raíz del repo (como export-prod.js)
 *   o GOOGLE_APPLICATION_CREDENTIALS / ADC (firebase login).
 *
 * Uso recomendado:
 *   node scripts/purge-prueba-sa.js --dry-run
 *   node scripts/purge-prueba-sa.js --execute
 *
 * Opciones:
 *   --empresa prueba_sa   (default)
 *   --dry-run             solo contar (default si no hay --execute)
 *   --execute             borrar en producción
 */

const path = require('path');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

const PROTECTED_EMPRESA = 'bacarsa';
const DEFAULT_EMPRESA = 'prueba_sa';
const BATCH_SIZE = 400;
const PAGE_SIZE = 500;

const EMPRESA_ID_COLLECTIONS = [
  'turnos',
  'ausencias',
  'novedades',
  'swap_requests',
  'empleados',
  'clients',
  'clientes',
  'servicios_sla',
  'contratos_servicio',
  'tipos_turno',
  'objetivos',
  'user_notifications',
  'audit_logs',
  'integraciones_api',
  'feriados',
  'contracts',
  'quotes',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let empresaId = DEFAULT_EMPRESA;
  let dryRun = true;
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) empresaId = args[++i];
    else if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--execute') {
      execute = true;
      dryRun = false;
    }
  }
  return { empresaId: empresaId.trim(), dryRun, execute };
}

function assertSafeTarget(empresaId) {
  const id = empresaId.trim().toLowerCase();
  if (!id) throw new Error('empresaId vacío');
  if (id === PROTECTED_EMPRESA) {
    throw new Error(`Refusing to purge protected empresa: ${PROTECTED_EMPRESA}`);
  }
}

function docEmpresaId(data) {
  return String(data?.empresaId ?? '').trim().toLowerCase();
}

/** Solo borrar si el doc tiene empresaId explícito y coincide con el target. */
function isDeletableForEmpresa(data, targetEmpresaId) {
  const docEmp = docEmpresaId(data);
  if (!docEmp) return false;
  if (docEmp === PROTECTED_EMPRESA) return false;
  return docEmp === targetEmpresaId.trim().toLowerCase();
}

function initFirestore() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.warn(
      `ADVERTENCIA: FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} — quitá la variable para producción.`,
    );
    if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
    return getFirestore();
  }

  console.log('Modo: Firestore PRODUCCIÓN (comtroldata)');
  const saPath = path.resolve(__dirname, '../service-account.json');
  if (!getApps().length) {
    try {
      initializeApp({ credential: cert(saPath), projectId: 'comtroldata' });
      console.log('  Credenciales: service-account.json');
    } catch {
      initializeApp({ projectId: 'comtroldata' });
      console.log('  Credenciales: ADC / GOOGLE_APPLICATION_CREDENTIALS');
    }
  }
  return getFirestore();
}

async function queryByEmpresaId(db, colName, empresaId) {
  const docs = [];
  let last;
  for (;;) {
    let q = db.collection(colName).where('empresaId', '==', empresaId).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (isDeletableForEmpresa(d.data(), empresaId)) docs.push(d);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }
  return docs;
}

async function purgeByEmpresaIdQuery(db, colName, empresaId, dryRun) {
  const docs = await queryByEmpresaId(db, colName, empresaId);
  if (docs.length === 0) return { colName, count: 0, deleted: 0 };

  if (dryRun) return { colName, count: docs.length, deleted: 0, dryRun: true };

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return { colName, count: docs.length, deleted };
}

async function purgePlanificacionEstados(db, empresaId, dryRun) {
  const prefix = `${empresaId}_`;
  const byId = new Map();

  const byEmp = await queryByEmpresaId(db, 'planificacion_estados', empresaId);
  byEmp.forEach((d) => byId.set(d.id, d));

  let last;
  for (;;) {
    let q = db
      .collection('planificacion_estados')
      .orderBy(FieldPath.documentId())
      .startAt(prefix)
      .endAt(`${prefix}\uf8ff`)
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (!d.id.startsWith(prefix)) continue;
      const data = d.data();
      const emp = docEmpresaId(data);
      if (emp && emp !== empresaId.trim().toLowerCase()) continue;
      if (emp === PROTECTED_EMPRESA) continue;
      if (!emp && !d.id.startsWith(prefix)) continue;
      if (emp || d.id.startsWith(prefix)) byId.set(d.id, d);
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  const docs = [...byId.values()].filter((d) => {
    const data = d.data();
    const emp = docEmpresaId(data);
    if (emp) return isDeletableForEmpresa(data, empresaId);
    return d.id.startsWith(prefix);
  });

  if (docs.length === 0) return { colName: 'planificacion_estados', count: 0, deleted: 0 };
  if (dryRun) return { colName: 'planificacion_estados', count: docs.length, deleted: 0, dryRun: true };

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return { colName: 'planificacion_estados', count: docs.length, deleted };
}

async function purgeSystemUsers(db, empresaId, dryRun) {
  const snap = await db.collection('system_users').where('empresaId', '==', empresaId).get();
  const docs = snap.docs.filter((d) => {
    const data = d.data();
    const role = String(data.role ?? '').trim().toUpperCase();
    const emp = docEmpresaId(data);
    if (role === 'SUPERADMIN' && !emp) return false;
    return isDeletableForEmpresa(data, empresaId);
  });

  if (docs.length === 0) return { colName: 'system_users', count: 0, deleted: 0 };
  if (dryRun) return { colName: 'system_users', count: docs.length, deleted: 0, dryRun: true };

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return { colName: 'system_users', count: docs.length, deleted };
}

async function purgeRoles(db, empresaId, dryRun) {
  const snap = await db.collection('roles').where('empresaId', '==', empresaId).get();
  const docs = snap.docs.filter((d) => isDeletableForEmpresa(d.data(), empresaId));

  if (docs.length === 0) return { colName: 'roles', count: 0, deleted: 0 };
  if (dryRun) return { colName: 'roles', count: docs.length, deleted: 0, dryRun: true };

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return { colName: 'roles', count: docs.length, deleted };
}

async function purgeMigrateJobs(db, empresaId, dryRun) {
  const byId = new Map();
  for (const field of ['sourceEmpresaId', 'targetEmpresaId']) {
    const snap = await db.collection('empresa_migrate_jobs').where(field, '==', empresaId).get();
    snap.docs.forEach((d) => {
      const data = d.data();
      const src = String(data.sourceEmpresaId ?? '').trim().toLowerCase();
      const tgt = String(data.targetEmpresaId ?? '').trim().toLowerCase();
      const target = empresaId.trim().toLowerCase();
      if (src === PROTECTED_EMPRESA && tgt !== target && src !== target) return;
      if (tgt === PROTECTED_EMPRESA && src !== target && tgt !== target) return;
      if (src === target || tgt === target) byId.set(d.id, d);
    });
  }

  const docs = [...byId.values()];
  if (docs.length === 0) return { colName: 'empresa_migrate_jobs', count: 0, deleted: 0 };
  if (dryRun) return { colName: 'empresa_migrate_jobs', count: docs.length, deleted: 0, dryRun: true };

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return { colName: 'empresa_migrate_jobs', count: docs.length, deleted };
}

async function purgeEmpresaDoc(db, empresaId, dryRun) {
  const ref = db.collection('empresas').doc(empresaId);
  const snap = await ref.get();
  if (!snap.exists) return { colName: 'empresas', count: 0, deleted: 0 };

  if (dryRun) return { colName: 'empresas', count: 1, deleted: 0, dryRun: true };

  await ref.delete();
  return { colName: 'empresas', count: 1, deleted: 1 };
}

async function main() {
  const { empresaId, dryRun, execute } = parseArgs();
  assertSafeTarget(empresaId);

  const db = initFirestore();
  const modeLabel = dryRun ? 'DRY-RUN (solo conteo)' : 'EXECUTE (borrado real)';
  console.log(`\n[purge-prueba-sa] empresa=${empresaId} modo=${modeLabel}\n`);
  console.log('Reglas: no se borran docs sin empresaId; nunca se toca bacarsa.');
  console.log('Auth: NO se eliminan usuarios (admin@prueba.com / guardia@prueba.com pueden quedar huérfanos).\n');

  const summary = [];

  for (const col of EMPRESA_ID_COLLECTIONS) {
    process.stdout.write(`  ${col}... `);
    try {
      const r = await purgeByEmpresaIdQuery(db, col, empresaId, dryRun);
      summary.push(r);
      console.log(dryRun ? `${r.count} a borrar` : `${r.deleted} borrados`);
    } catch (e) {
      if (e.code === 9 || /index/i.test(String(e.message))) {
        console.log(`omitido (índice/query): ${e.message}`);
        summary.push({ colName: col, count: 0, deleted: 0, skipped: true });
      } else {
        throw e;
      }
    }
  }

  process.stdout.write('  planificacion_estados... ');
  const plan = await purgePlanificacionEstados(db, empresaId, dryRun);
  summary.push(plan);
  console.log(dryRun ? `${plan.count} a borrar` : `${plan.deleted} borrados`);

  process.stdout.write('  system_users... ');
  const su = await purgeSystemUsers(db, empresaId, dryRun);
  summary.push(su);
  console.log(dryRun ? `${su.count} a borrar` : `${su.deleted} borrados`);

  process.stdout.write('  roles... ');
  const roles = await purgeRoles(db, empresaId, dryRun);
  summary.push(roles);
  console.log(dryRun ? `${roles.count} a borrar` : `${roles.deleted} borrados`);

  process.stdout.write('  empresa_migrate_jobs... ');
  const jobs = await purgeMigrateJobs(db, empresaId, dryRun);
  summary.push(jobs);
  console.log(dryRun ? `${jobs.count} a borrar` : `${jobs.deleted} borrados`);

  process.stdout.write('  empresas (doc)... ');
  const emp = await purgeEmpresaDoc(db, empresaId, dryRun);
  summary.push(emp);
  console.log(dryRun ? `${emp.count} a borrar` : `${emp.deleted} borrados`);

  const total = summary.reduce((n, r) => n + (dryRun ? r.count || 0 : r.deleted || 0), 0);
  console.log(`\n--- Resumen ${dryRun ? '(dry-run)' : '(ejecutado)'} ---`);
  for (const r of summary) {
    const n = dryRun ? r.count : r.deleted;
    if (n > 0 || r.skipped) console.log(`  ${r.colName}: ${r.skipped ? 'omitido' : n}`);
  }
  console.log(`\nTotal${dryRun ? ' a borrar' : ' borrado'}: ${total}`);

  if (dryRun) {
    console.log('\nSin cambios en Firestore. Ejecutá con --execute para borrar.\n');
  } else if (!execute) {
    console.log('\n');
  } else {
    console.log('\nOK — tenant Firestore purgado. Revisá Auth manualmente si hace falta.\n');
  }
}

main().catch((e) => {
  console.error('\n❌ Error:', e.message || e);
  if (/Could not load the default credentials|ENOENT.*service-account/i.test(String(e.message))) {
    console.error(`
Credenciales faltantes para producción:
  1. Descargá la clave de cuenta de servicio del proyecto comtroldata (Firebase Console → Project settings → Service accounts).
  2. Guardala como service-account.json en la raíz del repo (no commitear).
  3. O: $env:GOOGLE_APPLICATION_CREDENTIALS='ruta\\al\\json'
  4. O: firebase login + gcloud auth application-default login
`);
  }
  process.exit(1);
});
