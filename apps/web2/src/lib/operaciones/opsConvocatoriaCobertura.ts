import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import type { InternalCoverageKind } from '@/lib/operaciones/coverageInternalCandidates';

export type OpsConvocatoriaCallableType = 'RET' | 'REF' | 'ESC' | 'EXTEND' | 'ADVANCE' | 'FT';

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

/** Turno real en Firestore para la vacante/ausencia (materializa virtuales). */
export async function ensureRealAbsenceShiftId(
  absenceShift: Record<string, unknown>,
  empresaId: string,
): Promise<string> {
  let shiftId = String(absenceShift.id || '').trim();
  const isVirtual =
    absenceShift.isVirtual === true
    || shiftId.startsWith('V124_')
    || shiftId.startsWith('SLA_GAP');
  if (!isVirtual && shiftId) return shiftId;

  const newRef = doc(collection(db, 'turnos'));
  await setDoc(
    newRef,
    stampEmpresaId(
      {
        clientId: absenceShift.clientId || null,
        clientName: absenceShift.clientName || null,
        objectiveId: absenceShift.objectiveId || null,
        objectiveName: absenceShift.objectiveName || null,
        positionName: absenceShift.positionName || null,
        employeeId: absenceShift.employeeId || 'VACANTE',
        employeeName: absenceShift.employeeName || 'VACANTE',
        code: absenceShift.code || 'T',
        startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
        endTime: Timestamp.fromDate(toDate(absenceShift.endDateObj)),
        status: absenceShift.isAbsent ? 'ABSENT' : 'REPORTED_TO_PLANNING',
        isAbsent: !!absenceShift.isAbsent,
        isReported: true,
        isReportedToPlanning: !!absenceShift.isReportedToPlanning,
        origin: absenceShift.origin || 'SLA_VIRTUAL',
        createdAt: serverTimestamp(),
      },
      empresaId,
    ),
  );
  return newRef.id;
}

export function convocatoriaTypeForInternalKind(
  kind: InternalCoverageKind,
): OpsConvocatoriaCallableType {
  if (kind === 'REF') return 'REF';
  if (kind === 'ESC') return 'ESC';
  return 'RET';
}

export async function invokeCrearConvocatoriaCobertura(params: {
  absenceShift: Record<string, unknown>;
  candidateEmployeeId: string;
  type: OpsConvocatoriaCallableType;
  empresaId: string;
  candidateShiftId?: string;
  extendShiftId?: string;
  advanceShiftId?: string;
  ftShiftId?: string;
}): Promise<{ convocatoriaId: string; shiftId: string }> {
  const empresaId = String(params.empresaId || '').trim();
  const shiftId = await ensureRealAbsenceShiftId(params.absenceShift, empresaId);
  const fn = httpsCallable(functions, 'crearConvocatoriaCobertura');
  const payload: Record<string, unknown> = {
    shiftId,
    candidateEmployeeId: params.candidateEmployeeId,
    type: params.type,
    empresaId,
  };
  if (params.candidateShiftId) payload.candidateShiftId = params.candidateShiftId;
  if (params.extendShiftId) payload.extendShiftId = params.extendShiftId;
  if (params.advanceShiftId) payload.advanceShiftId = params.advanceShiftId;
  if (params.ftShiftId) payload.ftShiftId = params.ftShiftId;
  const res = await fn(payload);
  const convocatoriaId = String((res.data as { convocatoriaId?: string })?.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    throw new Error('La callable no devolvió convocatoriaId');
  }
  return { convocatoriaId, shiftId };
}
