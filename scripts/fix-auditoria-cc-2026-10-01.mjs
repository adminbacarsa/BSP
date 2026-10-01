/**
 * Auditor?a CC 01/10/2026 (pruebas_sa) ? correcciones de datos. SOLO LECTURA por defecto.
 * Informe: docs/AUDITORIA-CC-2026-10-01.md
 *
 *  1. GARCIA (M2 Puesto 2 Peaje) cerrada por el operador con CHECKOUT (celular/escritorio) estando
 *     retenida: el cierre manual no limpia la retenci?n. Quedan `isRetention: true` sin
 *     `retentionMinutes` ni `retentionEndedAt` en los COMPLETED del 01/10 y del 30/09.
 *  2. Huecos `sla_huecos_sin_plan` del 02/10 detectados con las franjas de un SLA cerrado de un d?a
 *     (25/09: M3 12:00, T 15:00). El SLA de octubre tiene M3 12:30 y T 15:15, ambos planificados.
 *
 *   node scripts/fix-auditoria-cc-2026-10-01.mjs
 *   node scripts/fix-auditoria-cc-2026-10-01.mjs --apply --allow-prod
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');
const FIX_TAG = 'fix-auditoria-cc-2026-10-01';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const RETENIDAS_CERRADAS_A_MANO = [
  { id: 'VvAYzVRtAL3s4Hsa5rHQ', who: 'GARCIA 01/10' },
  { id: 'boLe2gSh4mEhKFW7QCN9', who: 'GARCIA 30/09' },
];
const HUECOS_SLA_NO_VIGENTE = [
  'gap_pruebas_sa_UJHqYnFeQfCEbYfVSMIi_puesto_1_2026-10-02_M3',
  'gap_pruebas_sa_UJHqYnFeQfCEbYfVSMIi_puesto_2_2026-10-02_T',
];

const ms = (v) => v?.toMillis?.() ?? 0;
const ar = (v) => (ms(v) ? new Date(ms(v) - 3 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : '-');
const patches = [];

// 1. retenidas cerradas con CHECKOUT manual
for (const f of RETENIDAS_CERRADAS_A_MANO) {
  const snap = await db.collection('turnos').doc(f.id).get();
  if (!snap.exists) { console.log(`SKIP turno ${f.id} (${f.who}) no existe`); continue; }
  const r = snap.data();
  const endMs = ms(r.endTime);
  const realEndMs = ms(r.realEndTime);
  const retStartMs = ms(r.retentionStartedAt) || endMs;
  const minutes = realEndMs > retStartMs ? Math.round((realEndMs - retStartMs) / 60000) : 0;
  const already = r.isRetention !== true && typeof r.retentionMinutes === 'number';
  console.log([
    already ? 'OK ' : 'FIX', f.id, r.employeeName, `status=${r.status}`, `isRetention=${r.isRetention}`,
    `fin=${ar(r.endTime)}`, `realEnd=${ar(r.realEndTime)}`, `retMin=${r.retentionMinutes ?? '-'}`,
    `? ${minutes} min`,
  ].join(' | '));
  if (already) continue;
  if (r.status !== 'COMPLETED' || !realEndMs) { console.log('   ? no se toca: no est? COMPLETED con realEndTime'); continue; }
  patches.push({
    col: 'turnos', id: f.id, label: `${r.employeeName} cierre manual retenida ? retentionMinutes ${minutes}`,
    patch: {
      isRetention: false,
      retentionEndedAt: Timestamp.fromMillis(realEndMs),
      retentionMinutes: minutes,
      completionReason: r.completionReason || 'CHECKOUT_OPERADOR',
      correctedBy: FIX_TAG,
      correctionNote: 'CHECKOUT del operador sobre un retenido no cerraba la retenci?n (auditor?a 01/10).',
      correctedAt: FieldValue.serverTimestamp(),
    },
  });
}

// 2. huecos detectados con un SLA cerrado
for (const id of HUECOS_SLA_NO_VIGENTE) {
  const snap = await db.collection('sla_huecos_sin_plan').doc(id).get();
  if (!snap.exists) { console.log(`SKIP hueco ${id} no existe`); continue; }
  const r = snap.data();
  const already = r.status === 'CLOSED';
  console.log(`${already ? 'OK ' : 'FIX'} ${id} | ${r.positionName} ${r.bandCode} ${ar(r.gapStart)}?${ar(r.gapEnd)} | status=${r.status}`);
  if (already) continue;
  patches.push({
    col: 'sla_huecos_sin_plan', id, label: `hueco ${r.bandCode} ${r.positionName} ? CLOSED (SLA no vigente)`,
    patch: {
      status: 'CLOSED',
      closedAt: FieldValue.serverTimestamp(),
      closedReason: 'SLA_NO_VIGENTE',
      correctedBy: FIX_TAG,
      correctionNote: 'Franja tomada del SLA cerrado del 25/09; el SLA de octubre tiene esa franja planificada.',
    },
  });
}

console.log(`\nparches: ${patches.length}`);
for (const p of patches) console.log(`DRY ${p.col}/${p.id} ? ${p.label}`);

if (!apply) {
  console.log('dryRun: no se escribi? nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribi?.');
  process.exit(1);
}
for (const p of patches) await db.collection(p.col).doc(p.id).update(p.patch);
console.log(`apply ${patches.length}`);
