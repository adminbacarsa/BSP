import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { markShiftAbsent } from './markShiftAbsent';
import { skipAbsencePipelineForShift } from '../coverage/coverageTraceShift';
import { iniciarCascadaCobertura } from '../coverage/convocatoriasCobertura';
import { isEmpresaManualMode } from '../ops/opsManualMode';

const MIN_HOURS_BEFORE_GAP_END = 2;

function ms(v: unknown): number {
  return (v as Timestamp | undefined)?.toMillis?.() ?? 0;
}

async function relaunchTitularCoverage(
  db: Firestore,
  opsCov: Record<string, unknown> & { id: string },
): Promise<void> {
  const titularId = String(opsCov.absenceShiftId || opsCov.coveredShiftId || '').trim();
  if (!titularId) return;
  const titSnap = await db.collection('turnos').doc(titularId).get();
  if (!titSnap.exists) return;
  const tit = titSnap.data() as Record<string, unknown>;
  const empresaId = String(tit.empresaId || opsCov.empresaId || '').trim() || 'bacarsa';
  const manual = await isEmpresaManualMode(db, empresaId);
  if (manual) {
    await db.collection('novedades').add({
      type: 'CONVOCADO_NO_LLEGO',
      status: 'PENDIENTE',
      shiftId: opsCov.id,
      absenceShiftId: titularId,
      objectiveId: tit.objectiveId || null,
      objectiveName: tit.objectiveName || '',
      empresaId,
      description: `${opsCov.employeeName || 'Convocado'} no llegó — relanzar cobertura del titular manualmente.`,
      createdAt: Timestamp.now(),
      source: 'SYSTEM_SCHEDULER',
    });
    return;
  }
  await iniciarCascadaCobertura(
    db,
    {
      id: titularId,
      objectiveId: String(tit.objectiveId || ''),
      objectiveName: String(tit.objectiveName || ''),
      positionName: String(tit.positionName || ''),
      clientId: String(tit.clientId || ''),
      clientName: String(tit.clientName || ''),
      code: String(tit.code || ''),
      startTime: tit.startTime as Timestamp,
      endTime: tit.endTime as Timestamp,
      empresaId,
    },
    'AUTO',
  );
}

export async function runConvocadoAbsentPass(db: Firestore, now: Timestamp): Promise<number> {
  const nowMs = now.toMillis();
  const windowStartMs = nowMs - 12 * 60 * 60 * 1000;
  const snap = await db.collection('turnos').where('origin', '==', 'OPERATIONS_COVERAGE').limit(300).get();

  let marked = 0;
  for (const docSnap of snap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    if (skipAbsencePipelineForShift(shift)) continue;
    if (ms(shift.startTime) < windowStartMs) continue;
    if (shift.isPresent === true || shift.isCompleted === true) continue;
    if (shift.isAbsent === true) continue;

    const ct = String(shift.coverageType || '').toUpperCase();
    if (ct === 'EXTEND') continue;

    const gapEnd = ms(shift.endTime);
    const skipRelaunch = !!(gapEnd && gapEnd - nowMs < MIN_HOURS_BEFORE_GAP_END * 3600000);

    const gapStart = ms(shift.startTime);
    const deadline =
      ct === 'ADVANCE'
        ? (ms(shift.adjustedStartTime) || gapStart) + 60 * 60 * 1000
        : Math.max(ms(shift.createdAt) || gapStart, gapStart) + 60 * 60 * 1000;

    if (nowMs < deadline) continue;

    const covTypes = new Set(['RET', 'REF', 'ESC', 'FT']);
    if (!covTypes.has(ct) && !shift.isReten) continue;

    if (ct === 'ADVANCE') {
      const titularId = String(shift.absenceShiftId || '').trim();
      if (titularId) {
        await db.collection('turnos').doc(titularId).update({
          coverageStatus: 'PARTIAL',
          operacionallyCovered: false,
        });
      }
    }

    const r = await markShiftAbsent(db, docSnap.id, {
      reason: 'CONVOCADO_NO_LLEGO',
      by: 'SYSTEM_SCHEDULER',
    });
    if (r.applied) {
      marked++;
      if (!skipRelaunch) {
        await relaunchTitularCoverage(db, { ...shift, id: docSnap.id });
      }
    }
  }
  return marked;
}
