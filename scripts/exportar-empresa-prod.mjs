/**
 * Exporta SOLO LECTURA de prod (comtroldata) los datos de una empresa a un JSON con el mismo formato que
 * los backups (`{ _meta, coleccion: [{ _id, ...campos }] }`), listo para el emulador:
 *
 *   node scripts/exportar-empresa-prod.mjs --empresa pruebas_sa [--salida backups/pruebas_sa-prod.json] [--con-logs]
 *   node scripts/seed-from-backup-file.js backups/pruebas_sa-prod.json --empresa pruebas_sa --clear-before
 *
 * No escribe en producción. Sin emulador en el entorno (FIRESTORE_EMULATOR_HOST) para que lea prod.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, GeoPoint, DocumentReference } = require('firebase-admin/firestore');

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('No arranques este script con el emulador en el entorno: tiene que leer prod.');
}

const args = process.argv.slice(2);
const arg = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? String(args[i + 1] || '') : d;
};
const EMPRESA = arg('--empresa', 'pruebas_sa').trim();
const SALIDA = resolve(arg('--salida', `backups/${EMPRESA}-prod.json`));
const CON_LOGS = args.includes('--con-logs');

const COLECCIONES = [
  'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
  'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
  'objetivos', 'grupos_objetivos',
  'ajustes_crono', 'ajustes_horas', 'fichajes', 'sesiones_operador',
  'solicitudes_refuerzo', 'supervision_visitas', 'objetivo_consignas',
  'planificacion_estados', 'liquidacion_turno_contrib',
  'roles', 'feriados', 'system_users', 'client_users', 'integraciones_api',
  'planificaciones_historial', 'contracts', 'quotes',
  'ordenes_compra', 'eventuales_bolsa',
];
const COLECCIONES_PESADAS = ['audit_logs', 'user_notifications', 'assistant_interaction_logs', 'historial_operaciones'];
const DOC_ID_ES_EMPRESA = ['planning_rules'];

function serializar(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp) return { _seconds: v.seconds, _nanoseconds: v.nanoseconds };
  if (v instanceof GeoPoint) return { latitude: v.latitude, longitude: v.longitude };
  if (v instanceof DocumentReference) return v.path;
  if (Array.isArray(v)) return v.map(serializar);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = serializar(x);
    return o;
  }
  return v;
}

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod'));

const salida = {};
let total = 0;

const empresaDoc = await db.collection('empresas').doc(EMPRESA).get();
if (!empresaDoc.exists) throw new Error(`No existe empresas/${EMPRESA} en prod`);
salida.empresas = [{ _id: empresaDoc.id, ...serializar(empresaDoc.data()) }];
total += 1;
console.log(`empresas/${EMPRESA} OK`);

for (const col of DOC_ID_ES_EMPRESA) {
  const d = await db.collection(col).doc(EMPRESA).get();
  if (d.exists) {
    salida[col] = [{ _id: d.id, ...serializar(d.data()) }];
    total += 1;
    console.log(`${col}/${EMPRESA} OK`);
  }
}

for (const col of [...COLECCIONES, ...(CON_LOGS ? COLECCIONES_PESADAS : [])]) {
  try {
    const snap = await db.collection(col).where('empresaId', '==', EMPRESA).get();
    if (snap.empty) continue;
    salida[col] = snap.docs.map((d) => ({ _id: d.id, ...serializar(d.data()) }));
    total += snap.size;
    console.log(`${col.padEnd(28)} ${String(snap.size).padStart(6)}`);
  } catch (e) {
    console.warn(`${col}: ${e.message}`);
  }
}

salida._meta = {
  exportedAt: new Date().toISOString(),
  totalDocs: total,
  origen: 'prod comtroldata (solo lectura)',
  empresaId: EMPRESA,
};

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify(salida));
console.log(`\nListo: ${total} docs → ${SALIDA}`);
