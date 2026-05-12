/**
 * export-prod.js
 * Exporta todas las colecciones de Firestore PRODUCCIÓN a un JSON local.
 * Uso: node scripts/export-prod.js [destino.json]
 * El archivo resultante puede usarse con seed-emulator.js
 */

const GOOGLE_APPLICATION_CREDENTIALS = require('path').resolve(__dirname, '../service-account.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_APPLICATION_CREDENTIALS;

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp }       = require('firebase-admin/firestore');
const { getAuth }                       = require('firebase-admin/auth');
const fs   = require('fs');
const path = require('path');

const outFile = process.argv[2] || path.join(__dirname, `../backups/backup_${new Date().toISOString().slice(0,10)}.json`);

if (!getApps().length) {
  initializeApp({ credential: cert(GOOGLE_APPLICATION_CREDENTIALS), projectId: 'comtroldata' });
}
const db   = getFirestore();
const auth = getAuth();

const COLLECTIONS = [
  'system_users','roles','empresas','clients','empleados',
  'turnos','novedades','planificaciones_historial',
  'servicios_sla','configuracion','config',
  'tipos_turno','feriados','settings_laborales','convenios_colectivos',
  'alerts','auditorias','audit_logs','camera_routes',
  'nvr_config','nvr_devices','device_tokens','sesiones_operador',
  'swap_requests','quotes','settings_cotizador',
];

async function exportCollection(colName) {
  const snap = await db.collection(colName).get();
  if (snap.empty) return [];
  return snap.docs.map(d => ({ _id: d.id, ...serialize(d.data()) }));
}

function serialize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Timestamp) return { _seconds: obj.seconds, _nanoseconds: obj.nanoseconds };
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = serialize(v);
    return r;
  }
  return obj;
}

async function exportAuth() {
  const users = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    res.users.forEach(u => users.push({
      uid: u.uid, email: u.email,
      displayName: u.displayName || null,
      disabled: u.disabled,
      customClaims: u.customClaims || null,
    }));
    pageToken = res.pageToken;
  } while (pageToken);
  return users;
}

async function run() {
  console.log('\n📤 Exportando Firestore PRODUCCIÓN → local\n');

  const result = {
    _meta: { exportedAt: new Date().toISOString(), source: 'production' },
  };

  // Auth
  process.stdout.write('Auth usuarios ... ');
  result._auth_users = await exportAuth();
  console.log(`${result._auth_users.length} usuarios`);

  // Colecciones
  let totalDocs = 0;
  for (const col of COLLECTIONS) {
    process.stdout.write(`  ${col.padEnd(35)} `);
    try {
      const docs = await exportCollection(col);
      result[col] = docs;
      totalDocs += docs.length;
      console.log(`${String(docs.length).padStart(5)} docs`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      result[col] = [];
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  result._meta.totalDocs = totalDocs;

  console.log(`\n✅ Exportados ${totalDocs} documentos`);
  console.log(`   Archivo: ${path.resolve(outFile)}`);
  console.log(`\n   Para importar al emulador:`);
  console.log(`   node scripts/seed-emulator.js ${path.resolve(outFile)}\n`);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
