/**
 * Retenciones marcadas antes del fin del saliente, o vinculadas a un titular
 * que ya no existe. SOLO LECTURA por defecto. Empresa pruebas_sa.
 *
 *   node scripts/fix-retencion-anticipada.mjs
 *   node scripts/fix-retencion-anticipada.mjs --empresa pruebas_sa
 *   node scripts/fix-retencion-anticipada.mjs --apply --allow-prod
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : 'pruebas_sa';
const ALIGN_MS = 30 * 60 * 1000;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const nowMs = Date.now();

function ms(value) {
  return value?.toMillis?.() ?? 0;
}

function codeOf(row) {
  return String(row?.code || row?.type || '').trim().toUpperCase();
}

const snap = await db.collection('turnos').where('isRetention', '==', true).limit(400).get();
const rows = snap.docs.filter((d) => {
  const data = d.data();
  if (data.isCompleted === true) return false;
  if (data.manualRetentionType) return false;
  if (empresaId && String(data.empresaId || '') !== empresaId) return false;
  return true;
});

console.log(`retenciones abiertas ${rows.length} empresa=${empresaId || '*'} (leídas ${snap.size})`);

const plans = [];
for (const docSnap of rows) {
  const shift = docSnap.data();
  const endMs = ms(shift.endTime);
  const beforeEnd = endMs > nowMs;
  const linkedId = String(shift.retentionAbsenceShiftId || '').trim();
  let titular = null;
  if (linkedId) {
    const gap = await db.collection('turnos').doc(linkedId).get();
    titular = gap.exists ? gap.data() : null;
  }
  const orphan = !!linkedId && !titular;
  let covered = false;
  if (titular && (titular.isAbsent === true || String(titular.status || '').toUpperCase() === 'ABSENT')) {
    const start = ms(titular.startTime);
    const objectiveId = String(titular.objectiveId || shift.objectiveId || '');
    const positionName = titular.positionName || shift.positionName;
    if (objectiveId && positionName && start) {
      const around = await db.collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('positionName', '==', positionName)
        .where('startTime', '>=', admin.firestore.Timestamp.fromMillis(start - ALIGN_MS))
        .where('startTime', '<=', admin.firestore.Timestamp.fromMillis(start + ALIGN_MS))
        .get();
      const gapCode = codeOf(titular);
      covered = titular.operacionallyCovered === true
        || String(titular.coverageStatus || '').toUpperCase() === 'COVERED'
        || around.docs.some((d) => {
          if (d.id === linkedId) return false;
          const row = d.data();
          if (row.isAbsent === true || String(row.status || '').toUpperCase() === 'ABSENT') return false;
          if (row.isCompleted === true) return false;
          const eid = String(row.employeeId || '').trim();
          if (!eid || eid === 'VACANTE' || row.isUnassigned === true) return false;
          const their = codeOf(row);
          if (gapCode && their && their !== gapCode) return false;
          return true;
        });
    }
  }

  let action = null;
  let patch = null;
  if (beforeEnd && (orphan || covered || !linkedId)) {
    action = orphan ? 'soltar anticipada huérfana' : covered ? 'soltar anticipada cubierta' : 'soltar anticipada sin vínculo';
    patch = {
      isRetention: false,
      retentionReleasedAt: FieldValue.serverTimestamp(),
      releasedBy: 'DATA_FIX_RETENCION_ANTICIPADA',
      retentionReason: FieldValue.delete(),
      retentionKind: FieldValue.delete(),
      retentionAbsenceShiftId: FieldValue.delete(),
      retentionPlannedFor: FieldValue.delete(),
      retentionPlannedKind: FieldValue.delete(),
    };
  } else if (beforeEnd && titular) {
    action = 'pasar a retención programada';
    patch = {
      isRetention: false,
      retentionPlannedFor: shift.endTime,
      retentionPlannedKind: 'AUSENCIA_RELEVO',
      retentionReason: FieldValue.delete(),
      retentionKind: FieldValue.delete(),
    };
  } else if (orphan) {
    action = 'limpiar vínculo huérfano';
    patch = {
      retentionAbsenceShiftId: FieldValue.delete(),
      retentionReason: FieldValue.delete(),
      retentionKind: FieldValue.delete(),
      retentionPlannedFor: FieldValue.delete(),
      retentionPlannedKind: FieldValue.delete(),
    };
  }
  if (!action) continue;
  plans.push({ id: docSnap.id, name: shift.employeeName, action, patch });
  console.log(`${apply ? 'APPLY' : 'DRY'} ${docSnap.id} ${shift.employeeName || ''} ${shift.code || ''} fin=${endMs ? new Date(endMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : '-'} → ${action}`);
}

if (!plans.length) {
  console.log('Nada para corregir.');
  process.exit(0);
}
if (!apply) {
  console.log(`dryRun: ${plans.length} turno(s). No se escribió nada.`);
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}
for (const row of plans) {
  await db.collection('turnos').doc(row.id).update(row.patch);
}
console.log(`apply ${plans.length}`);
