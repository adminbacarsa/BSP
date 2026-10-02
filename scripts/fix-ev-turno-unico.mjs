/**
 * Normaliza los 3 turnos EV del evento pumas (pruebas_sa, 02/10/2026, puerta campus).
 * No recrea el RET de QUIROGA: ese horario ya se pisó. El F de SANCHEZ queda F con coverageUsed.
 *
 *   node scripts/fix-ev-turno-unico.mjs
 *   node scripts/fix-ev-turno-unico.mjs --apply --allow-prod
 *
 * Requiere `npm run build` en apps/functions. pruebas_sa está pre-autorizado; lo corre Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { normalizarTurnoEvExistente } = requireFn('./lib/eventos/turnoEvento.js');

const EMPRESA = 'pruebas_sa';
const EVENTO = 'N1pPa6zZzutj9ZoSztR6';
const SRV_PREFIX = 'f0c8bbbe';
const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');

const TURNOS = [
  { id: 'Y2gOK37lLQFa8FARd7aQ', quien: 'QUIROGA' },
  { id: 'YuSTKGsC91W9aksQ3lTb', quien: 'ABALLAY' },
  { id: 'YxNARWm72U81nnA7Vwly', quien: 'SANCHEZ', francoShiftId: 'oWLyJ4u7FQ6T0LF6xnqq' },
];

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

if (apply && !allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}

for (const row of TURNOS) {
  const snap = await db.collection('turnos').doc(row.id).get();
  const data = snap.data() || {};
  const srv = String(data.servicioId || '');
  const nombre = String(data.servicioNombre || data.positionName || '').toLowerCase();
  if (snap.exists && srv && !srv.startsWith(SRV_PREFIX) && nombre !== 'puerta campus') {
    console.log(`SKIP ${row.quien} ${row.id} servicio ${srv}`);
    continue;
  }
  const out = await normalizarTurnoEvExistente(db, row.id, {
    apply,
    empresaId: EMPRESA,
    eventoId: EVENTO,
    eventoNombre: 'pumas',
    servicioNombre: 'puerta campus',
    francoShiftId: row.francoShiftId,
  });
  console.log(JSON.stringify({ quien: row.quien, apply, ...out }));
}
if (!apply) console.log('dryRun: no se escribió nada.');
