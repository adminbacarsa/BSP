import {
  collection,
  query,
  where,
  getDocs,
  limit,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';

export type SyncAusenciaCoberturaParams = {
  shiftId: string;
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string | null;
  resolvedBy?: string;
  /** Si hay empresaId, acota la query (multiempresa). */
  empresaId?: string | null;
};

/**
 * Al confirmar cobertura desde Operaciones, la novedad RRHH (`ausencias`)
 * debe pasar a GESTIONADA. Si no hay doc vinculado por shiftId, no falla.
 */
export async function syncAusenciaCoberturaGestionada(
  db: Firestore,
  params: SyncAusenciaCoberturaParams,
  batch?: WriteBatch,
): Promise<number> {
  const shiftId = String(params.shiftId || '').trim();
  if (!shiftId) return 0;

  const constraints = [where('shiftId', '==', shiftId)];
  if (params.empresaId) {
    constraints.push(where('empresaId', '==', params.empresaId));
  }

  const snap = await getDocs(query(collection(db, 'ausencias'), ...constraints, limit(10)));
  if (snap.empty) return 0;

  const payload: Record<string, unknown> = {
    coberturaEstado: 'GESTIONADA',
    coberturaResolvedAt: serverTimestamp(),
    coberturaResolvedBy: params.resolvedBy || 'OPERACIONES',
  };
  if (params.coveredByEmployeeId != null) {
    payload.coveredByEmployeeId = params.coveredByEmployeeId || null;
  }
  if (params.coveredByEmployeeName != null) {
    payload.coveredByEmployeeName = params.coveredByEmployeeName || null;
  }
  if (params.coverageType != null) {
    payload.coverageType = params.coverageType || null;
  }

  let n = 0;
  for (const d of snap.docs) {
    if (batch) {
      batch.update(d.ref, payload);
    } else {
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(d.ref, payload);
    }
    n += 1;
  }
  return n;
}

/** Payload estándar para marcar el turno titular ausente/vacante como cubierto. */
export function absentShiftCoveragePatch(opts: {
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string;
  /** Vacante pura: status COVERED. Ausencia: mantener isAbsent, no pisar status ABSENT. */
  isAbsence?: boolean;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    resolvedBy: 'OPERACIONES',
    coverageType: opts.coverageType || 'COBERTURA',
    coveredAt: serverTimestamp(),
    coveredByEmployeeId: opts.coveredByEmployeeId || null,
    coveredByEmployeeName: opts.coveredByEmployeeName || null,
    operacionallyCovered: true,
    coverageStatus: 'COVERED',
  };
  if (!opts.isAbsence) {
    patch.status = 'COVERED';
  } else {
    // Forzar verdad del titular: sin esto la app sigue mostrando 7–15 como "próximo turno".
    patch.isAbsent = true;
    patch.status = 'ABSENT';
    if (!opts.coverageType) {
      patch.absenceType = 'AA';
    }
  }
  return patch;
}
