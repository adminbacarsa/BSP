/**
 * Auditoría CC 29/09/2026 (pruebas_sa) — correcciones de datos. SOLO LECTURA por defecto.
 * Informe: docs/AUDITORIA-CC-2026-09-29.md
 *
 *  1. Francos origen de una cobertura FT que quedaron con code FT / isFrancoTrabajado (pre-P9e):
 *     vuelven a F con coverageUsed → el FT real vive en el ops_cov.
 *     - Bazán  IyiwO0Dyh7LxBKXLkx7a (cubre a Rodriguez Giacom R5MsjwU3eryItmbhRDbZ). Demo la marcó
 *       ausente y el P9E_FIX quitó isAbsent, pero siguió SIN_COBERTURA / vacante escalada.
 *     - Bustamante 97NGzkedXzZv7cBjtz3b (cubre a Barrios Carranza v8jgluiyR1TUv6OLFSCe).
 *  2. Banega O7u639G8qCuxxC8X1xzk: `relievedOutgoingShiftId` apunta a Molina M2 (DpwtohzMcvj1LbnxwYgu);
 *     el saliente de la serie es Coronel M (OeQaoP9ftCbMX3M5DQfM), que ya lo tiene como `relievedBy`.
 *  3. `ausencias` duplicadas por shiftId (clics repetidos de MARK_ABSENT + AUTO): se conserva la más
 *     antigua y el resto pasa a status INACTIVE (soft delete).
 *
 *   node scripts/fix-auditoria-cc-2026-09-29.mjs
 *   node scripts/fix-auditoria-cc-2026-09-29.mjs --apply --allow-prod
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
const FIX_TAG = 'AUDITORIA_CC_2026-09-29';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const FRANCO_ORIGEN = [
  { id: 'IyiwO0Dyh7LxBKXLkx7a', titularId: 'R5MsjwU3eryItmbhRDbZ', who: 'BAZAN' },
  { id: '97NGzkedXzZv7cBjtz3b', titularId: 'v8jgluiyR1TUv6OLFSCe', who: 'BUSTAMANTE RIOS' },
];
const BANEGA = { id: 'O7u639G8qCuxxC8X1xzk', wrongOutgoing: 'DpwtohzMcvj1LbnxwYgu', rightOutgoing: 'OeQaoP9ftCbMX3M5DQfM' };
const DUP_ABSENCE_SHIFTS = ['Ju2eLw6HSJjjMQkOLjd8', 'R5MsjwU3eryItmbhRDbZ', 'v8jgluiyR1TUv6OLFSCe'];

const ms = (v) => v?.toMillis?.() ?? (v?._seconds ? v._seconds * 1000 : 0);
const patches = [];

// 1. francos origen
for (const f of FRANCO_ORIGEN) {
  const snap = await db.collection('turnos').doc(f.id).get();
  if (!snap.exists) { console.log(`SKIP turno ${f.id} (${f.who}) no existe`); continue; }
  const r = snap.data();
  const covDocId = r.coverageDocId || `ops_cov_${f.titularId}_${r.employeeId}`;
  const cov = await db.collection('turnos').doc(covDocId).get();
  const covOk = cov.exists && cov.data().isDeleted !== true;
  const already = r.code === 'F' && r.isFranco === true && r.isFrancoTrabajado !== true && r.coverageUsed === true;
  console.log([
    already ? 'OK ' : 'FIX', f.id, r.employeeName, `code=${r.code}`, `isFranco=${r.isFranco}`,
    `isFT=${r.isFrancoTrabajado}`, `status=${r.status ?? '-'}`, `sinCob=${r.isSinCobertura ?? '-'}`,
    `cov=${covDocId} ${covOk ? 'ACTIVA' : 'NO ENCONTRADA'}`,
  ].join(' | '));
  if (already) continue;
  if (!covOk) { console.log(`   → no se toca: el ops_cov no está activo`); continue; }
  patches.push({
    col: 'turnos', id: f.id, label: `${r.employeeName} franco origen → F + coverageUsed`,
    patch: {
      code: 'F', type: 'F', isFranco: true, isFrancoTrabajado: false,
      coverageUsed: true, coverageUsedForShiftId: f.titularId, coverageDocId: covDocId,
      comments: `Franco Trabajado (cobertura ${covDocId})`,
      isSinCobertura: FieldValue.delete(), isUnassigned: FieldValue.delete(), vacanteEscalada: FieldValue.delete(),
      status: FieldValue.delete(), vacancyCreatedForAbsence: FieldValue.delete(), vacancyOrigin: FieldValue.delete(),
      absenceVacancyOpenedAt: FieldValue.delete(), coverageClaimAt: FieldValue.delete(),
      isAbsent: false, absenceType: FieldValue.delete(), absenceDetectedAt: FieldValue.delete(),
      correctedBy: FIX_TAG,
      correctionNote: 'Franco origen de una cobertura FT (pre-P9e): vuelve a F con coverageUsed; el FT real es el ops_cov.',
    },
  });
}

// 2. Banega relievedOutgoingShiftId
{
  const snap = await db.collection('turnos').doc(BANEGA.id).get();
  if (!snap.exists) console.log(`SKIP Banega ${BANEGA.id} no existe`);
  else {
    const r = snap.data();
    const right = (await db.collection('turnos').doc(BANEGA.rightOutgoing).get()).data() || {};
    console.log(`${r.relievedOutgoingShiftId === BANEGA.wrongOutgoing ? 'FIX' : 'OK '} Banega relievedOutgoingShiftId=${r.relievedOutgoingShiftId} | Coronel.relievedBy=${right.relievedBy}`);
    if (r.relievedOutgoingShiftId === BANEGA.wrongOutgoing && right.relievedBy === BANEGA.id) {
      patches.push({
        col: 'turnos', id: BANEGA.id, label: 'Banega relievedOutgoingShiftId → Coronel M (serie)',
        patch: { relievedOutgoingShiftId: BANEGA.rightOutgoing, relievedOutgoingFixedFrom: BANEGA.wrongOutgoing, correctedBy: FIX_TAG },
      });
    }
  }
}

// 3. ausencias duplicadas por shiftId
for (const shiftId of DUP_ABSENCE_SHIFTS) {
  const snap = await db.collection('ausencias').where('shiftId', '==', shiftId).get();
  const live = snap.docs.filter((d) => String(d.data().status || '').toUpperCase() !== 'INACTIVE');
  const sorted = live.sort((a, b) => ms(a.data().createdAt) - ms(b.data().createdAt));
  console.log(`ausencias shiftId=${shiftId}: ${snap.size} docs, ${live.length} vivas`);
  for (const d of sorted) {
    const r = d.data();
    console.log(`   ${d.id} ${r.employeeName || r.employeeId} ${r.type || ''} ${r.status || ''} origin=${r.origin || '-'} createdAt=${r.createdAt?.toDate?.()?.toISOString?.() || '-'}`);
  }
  for (const d of sorted.slice(1)) {
    patches.push({
      col: 'ausencias', id: d.id, label: `ausencia duplicada de ${shiftId} (queda ${sorted[0].id})`,
      patch: { status: 'INACTIVE', inactivatedAt: FieldValue.serverTimestamp(), inactivatedBy: FIX_TAG, duplicateOf: sorted[0].id },
    });
  }
}

console.log(`\nparches: ${patches.length}`);
for (const p of patches) console.log(`DRY ${p.col}/${p.id} → ${p.label}`);

if (!apply) {
  console.log('dryRun: no se escribió nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}
for (const p of patches) await db.collection(p.col).doc(p.id).update(p.patch);
console.log(`apply ${patches.length}`);
