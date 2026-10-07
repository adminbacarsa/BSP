import {
  doc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import type { InternalCoverageKind } from '@/lib/operaciones/coverageInternalCandidates';

export type OpsConvocatoriaCallableType = 'RET' | 'REF' | 'ESC' | 'EXTEND' | 'ADVANCE' | 'FT' | 'EVENTUAL';

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

/** Turno real en Firestore para la vacante/ausencia (id determinístico; sin SLA_VIRTUAL aleatorio). */
export async function ensureRealAbsenceShiftId(
  absenceShift: Record<string, unknown>,
  empresaId: string,
): Promise<string> {
  let shiftId = String(absenceShift.id || '').trim();
  const isVirtual =
    absenceShift.isVirtual === true
    || shiftId.startsWith('V124_')
    || shiftId.startsWith('SLA_GAP')
    || shiftId.startsWith('gap_');
  if (!isVirtual && shiftId) return shiftId;
  if (String(absenceShift.vacancyOrigin || '') === 'ABSENCE' && shiftId && !isVirtual) {
    return shiftId;
  }
  if (!shiftId) {
    throw new Error('VACANTE_SIN_ID');
  }
  const detId = shiftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const ref = doc(db, 'turnos', detId);
  await setDoc(
    ref,
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
        status: 'UNCOVERED_REPORTED',
        isUnassigned: true,
        isReported: true,
        origin: 'SLA_UNPLANNED_GAP',
        slaGapDocId: detId,
        createdAt: serverTimestamp(),
      },
      empresaId,
    ),
    { merge: true },
  );
  return detId;
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
  bolsaCuil?: string;
}): Promise<{ convocatoriaId: string; shiftId: string; aplicadaDirecta?: boolean }> {
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
  if (params.bolsaCuil) payload.bolsaCuil = params.bolsaCuil;
  const res = await fn(payload);
  const data = (res.data || {}) as { convocatoriaId?: string | null; aplicadaDirecta?: boolean };
  if (data.aplicadaDirecta) return { convocatoriaId: '', shiftId, aplicadaDirecta: true };
  const convocatoriaId = String(data.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    throw new Error('La callable no devolvió convocatoriaId');
  }
  return { convocatoriaId, shiftId };
}

/**
 * Cancela una convocatoria PENDING cuando el operador rechaza al candidato, confirma por
 * teléfono o cierra el protocolo. Si el guardia ya respondió (no está PENDING) el servidor
 * responde failed-precondition y acá se ignora: no hay nada que cancelar.
 */
export async function invokeCancelarConvocatoriaCobertura(convocatoriaId?: string | null): Promise<boolean> {
  const id = String(convocatoriaId || '').trim();
  if (!id) return false;
  try {
    await httpsCallable(functions, 'cancelarConvocatoriaCobertura')({ convocatoriaId: id });
    return true;
  } catch (e: unknown) {
    const code = String((e as { code?: string })?.code || '');
    if (!/failed-precondition|not-found/.test(code)) {
      console.warn('[cancelarConvocatoriaCobertura]', id, e);
    }
    return false;
  }
}
