/**
 * P9 Peaje 9 Norte — SOLO LECTURA por defecto.
 * Lista los salientes del 29/09/2026 y el parche que escribiría (no lo aplica).
 *
 *   node scripts/fix-p9-salientes-peaje.mjs
 *   node scripts/fix-p9-salientes-peaje.mjs --apply --allow-prod
 *
 * --apply escribe isRetention en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const OBJECTIVE_ID = 'UJHqYnFeQfCEbYfVSMIi';
const DAY_START = new Date('2026-09-29T00:00:00-03:00');
const DAY_END = new Date('2026-09-30T00:00:00-03:00');
const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');

function hm(ts) {
  if (!ts?.toDate) return '-';
  return ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const snap = await db.collection('turnos')
  .where('objectiveId', '==', OBJECTIVE_ID)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(DAY_START))
  .where('startTime', '<', admin.firestore.Timestamp.fromDate(DAY_END))
  .get();

const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
rows.sort((a, b) => (a.startTime?.toMillis?.() || 0) - (b.startTime?.toMillis?.() || 0));
console.log(`turnos ${rows.length} objetivo ${OBJECTIVE_ID} 29/09`);
for (const r of rows) {
  console.log([
    hm(r.startTime), hm(r.endTime), r.code, r.positionName, r.employeeName,
    `st=${r.status}`, `present=${r.isPresent === true}`, `ret=${r.isRetention === true}`,
    `end=${r.realEndTime ? hm(r.realEndTime) : '-'}`, r.completionReason || '', r.retentionReason || '',
  ].join(' | '));
}

const open = rows.filter((r) => r.isPresent === true && r.isCompleted !== true && !r.realEndTime && r.isRetention !== true && r.endTime?.toMillis && r.endTime.toMillis() <= Date.parse('2026-09-29T15:06:00-03:00'));
console.log(`abiertos pasados las 15:06: ${open.length}`);
for (const r of open) {
  console.log(`DRY ${r.id} ${r.employeeName} ${r.code} ${r.positionName} → isRetention RELEVO_NO_PRESENTADO retentionStartedAt=${hm(r.endTime)}`);
}

if (!apply) {
  console.log('dryRun: no se escribió nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}
let n = 0;
for (const r of open) {
  await db.collection('turnos').doc(r.id).update({
    isRetention: true,
    retentionReason: 'RELEVO_NO_PRESENTADO',
    retentionStartedAt: r.endTime,
    autoRetentionAt: r.endTime,
  });
  n += 1;
}
console.log(`apply ${n}`);
