/**
 * P9b — relevos programados inválidos en turnos abiertos (pruebas_sa). SOLO LECTURA por defecto.
 * Un saliente PRESENT con `relievedBy` cuyo relevo no es de la serie, no arranca en la ventana
 * del fin (−30 min … +2 h) o ya no está presente/planificado: se lista el parche que limpiaría
 * `relievedBy` / `relieveScheduledAt` para que autoCompletar aplique la lógica actual.
 *
 *   node scripts/fix-p9b-relevo-programado.mjs [--empresa pruebas_sa]
 *   node scripts/fix-p9b-relevo-programado.mjs --apply --allow-prod
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { isValidReliefForOutgoing, isReliefPresent, staleProgrammedReliefPatch } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');
const empIdx = args.indexOf('--empresa');
const empresaId = empIdx >= 0 ? args[empIdx + 1] : 'pruebas_sa';

const hm = (ts) => ts?.toDate
  ? ts.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Cordoba' })
  : '-';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const snap = await db.collection('turnos')
  .where('empresaId', '==', empresaId)
  .where('status', '==', 'PRESENT')
  .get();

const open = snap.docs.filter((d) => {
  const r = d.data();
  return r.isCompleted !== true && !r.realEndTime && String(r.relievedBy || '').trim();
});
console.log(`empresa ${empresaId}: PRESENT abiertos con relievedBy = ${open.length}`);

const invalid = [];
for (const d of open) {
  const r = d.data();
  const endMs = r.endTime?.toMillis?.() ?? 0;
  const relievedBy = String(r.relievedBy).trim();
  const inSnap = await db.collection('turnos')
    .where('objectiveId', '==', r.objectiveId)
    .where('employeeId', '==', relievedBy)
    .where('startTime', '>=', admin.firestore.Timestamp.fromMillis(endMs - 13 * 3600000))
    .where('startTime', '<=', admin.firestore.Timestamp.fromMillis(endMs + 2 * 3600000))
    .get();
  const incoming = inSnap.docs.map((x) => x.data());
  const valid = incoming.find((inc) => isReliefPresent(inc) && isValidReliefForOutgoing(inc, endMs, r));
  const why = !incoming.length
    ? 'relevo sin turno en la ventana'
    : !incoming.some((inc) => isReliefPresent(inc))
      ? 'relevo no presente'
      : 'relevo fuera de serie u horario';
  console.log([
    valid ? 'OK ' : 'INV',
    d.id, r.employeeName, r.code, r.positionName, `${hm(r.startTime)}-${hm(r.endTime)}`,
    `relievedBy=${r.relievedByName || relievedBy}`, `sched=${hm(r.relieveScheduledAt)}`,
    valid ? '' : why,
  ].join(' | '));
  if (!valid) invalid.push({ id: d.id, data: r });
}

console.log(`inválidos: ${invalid.length}`);
for (const { id, data } of invalid) {
  console.log(`DRY ${id} ${data.employeeName} → relievedBy=null relieveScheduledAt=null (${data.relievedByName || data.relievedBy})`);
}

if (!apply) {
  console.log('dryRun: no se escribió nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}
for (const { id, data } of invalid) {
  await db.collection('turnos').doc(id).update(staleProgrammedReliefPatch(data));
}
console.log(`apply ${invalid.length}`);
