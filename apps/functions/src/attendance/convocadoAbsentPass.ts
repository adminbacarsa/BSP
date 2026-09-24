import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { markShiftAbsent } from './markShiftAbsent';
import { skipAbsencePipelineForShift } from '../coverage/coverageTraceShift';
import { iniciarCascadaCobertura } from '../coverage/convocatoriasCobertura';
import { isEmpresaManualMode } from '../ops/opsManualMode';
import type { loadCentroControlState } from '../ops/centroControlGuard';
import {
  cancelPendingConvocatoriasForTitular,
  revertTitularAfterConvocadoNoLlego,
} from './convocadoTitularRevert';

const MIN_HOURS_BEFORE_GAP_END = 2;

type CcState = Awaited<ReturnType<typeof loadCentroControlState>>;

function ms(v: unknown): number {
  return (v as Timestamp | undefined)?.toMillis?.() ?? 0;
}

function shiftEmpresaId(shift: Record<string, unknown>): string {
  return String(shift.empresaId || '').trim() || 'bacarsa';
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
  const empresaId = shiftEmpresaId(tit);
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

export async function runConvocadoAbsentPass(
  db: Firestore,
  now: Timestamp,
  cc: CcState,
): Promise<number> {
  const nowMs = now.toMillis();
  const windowStart = Timestamp.fromMillis(nowMs - 12 * 60 * 60 * 1000);
  const windowEnd = Timestamp.fromMillis(nowMs);

  const empSnap = await db.collection('empresas').get();
  const empresaIds = empSnap.docs.map((d) => d.id);
  if (empresaIds.length === 0) empresaIds.push('bacarsa');

  let marked = 0;
  for (const empresaId of empresaIds) {
    if (!cc.isEnabled(empresaId)) continue;
    if (cc.isDemo(empresaId)) continue;

    const snap = await db
      .collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('origin', '==', 'OPERATIONS_COVERAGE')
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

    for (const docSnap of snap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;

    if (skipAbsencePipelineForShift(shift)) continue;
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

    const titularId = String(shift.absenceShiftId || shift.coveredShiftId || '').trim();
    await revertTitularAfterConvocadoNoLlego(db, { ...shift, id: docSnap.id });

    const r = await markShiftAbsent(db, docSnap.id, {
      reason: 'CONVOCADO_NO_LLEGO',
      by: 'SYSTEM_SCHEDULER',
    });
    if (r.applied) {
      marked++;
      if (titularId) {
        await cancelPendingConvocatoriasForTitular(db, titularId);
      }
      if (!skipRelaunch) {
        await relaunchTitularCoverage(db, { ...shift, id: docSnap.id });
      }
    }
    }
  }
  return marked;
}
