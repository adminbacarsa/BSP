/**
 * E2E del recálculo de guardia_puntaje. Solo emulador.
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8393"
 *   node scripts/eval-puntaje-guardia-emulator.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!host.startsWith('127.0.0.1:') && !host.startsWith('localhost:')) {
  console.error('FIRESTORE_EMULATOR_HOST tiene que apuntar al emulador local');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-puntaje' });
const db = admin.firestore();
const { recalcularPuntajePersona, marcarPuntajeDirty, procesarPuntajeDirty } = requireFn('./lib/desempeno/puntajeGuardiaJob.js');

const empresaId = 'puntaje-e2e';
const empleadoId = 'guardia-puntaje-e2e';
const ahora = new Date('2026-10-02T15:00:00-03:00');
const hace = (dias) => new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const results = [];
function report(id, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

await db.collection('empresas').doc(empresaId).set({ nombre: 'Puntaje E2E' });
await db.collection('turnos').doc('turno-tarde-e2e').set({
  empresaId, employeeId: empleadoId, startTime: hace(2), isPresent: true, lateMinutes: 20, code: 'M',
});
await db.collection('ausencias').doc('aus-e-e2e').set({
  empresaId, employeeId: empleadoId, code: 'E', date: hace(3), status: 'ACTIVA',
});
await db.collection('ausencias').doc('aus-aa-e2e').set({
  empresaId, employeeId: empleadoId, shiftId: 'otro', code: 'AA', origin: 'AUTO_T30', date: hace(4), status: 'ACTIVA',
});
await db.collection('convocatorias_cobertura').doc('conv-ft-e2e').set({
  empresaId, candidateEmployeeId: empleadoId, type: 'FT', status: 'ACCEPTED', respondedAt: hace(1),
});

const id = await recalcularPuntajePersona(db, { empresaId, empleadoId }, ahora);
const doc = await db.collection('guardia_puntaje').doc(empleadoId).get();
const data = doc.data() || {};
const tipos = (data.detalle || []).map((d) => d.tipo);
report('doc', id === empleadoId && data.empresaId === empresaId, id || 'sin');
report('licencia-no-baja', !tipos.includes('FALTA_SIN_AVISO') || tipos.filter((t) => t === 'FALTA_SIN_AVISO').length === 1, tipos.join(','));
report('aa', tipos.includes('FALTA_SIN_AVISO'), tipos.join(','));
report('tarde', tipos.includes('LLEGADA_TARDE_SIN_AVISO'), tipos.join(','));
report('ft', tipos.includes('FT_ACEPTADO') && data.disposicion === 58, `d ${data.disposicion}`);
report('total', data.cumplimiento === 77 && data.total === 69, `c ${data.cumplimiento} t ${data.total}`);

const otra = await recalcularPuntajePersona(db, { empresaId, empleadoId }, ahora);
const doc2 = await db.collection('guardia_puntaje').doc(empleadoId).get();
report('idempotente', otra === empleadoId && doc2.data()?.total === data.total, String(doc2.data()?.total));

await marcarPuntajeDirty(db, { empresaId, empleadoId });
const n = await procesarPuntajeDirty(db, 10, ahora);
const dirty = await db.collection('guardia_puntaje_dirty').doc(empleadoId).get();
report('dirty', n === 1 && !dirty.exists, `n ${n}`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
if (failed) process.exitCode = 1;
