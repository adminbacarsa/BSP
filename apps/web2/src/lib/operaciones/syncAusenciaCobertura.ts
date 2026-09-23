import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  limit,
  Timestamp,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { isActiveOpsCoverageDoc, isTitularCoverageAssigned } from '@/lib/cosp/coverageSemantics';

export { isActiveOpsCoverageDoc } from '@/lib/cosp/coverageSemantics';
import { stampEmpresaId } from '@/lib/multiempresa';

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

/** Nombre legible del guardia que cubrió (titular ausente / slot cubierto). */
export function formatCoveringEmployeeLabel(
  shift: Record<string, unknown> | null | undefined,
): string | null {
  if (!shift) return null;
  const preset = String(shift.coveringDisplayName || '').trim();
  if (preset) return preset;
  const raw = String(shift.coveredByEmployeeName || shift.coveredBy || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return cleaned || raw;
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

/** Criterio demo/prod: 1 ausencia ya cubierta no debe generar otra cobertura activa. */
export function isTitularAlreadyCovered(data: Record<string, unknown> | null | undefined): boolean {
  return isTitularCoverageAssigned(data);
}

const toTimestamp = (val: unknown): Timestamp | null => {
  if (!val) return null;
  if (val instanceof Timestamp) return val;
  if (val instanceof Date) return Timestamp.fromDate(val);
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    return Timestamp.fromMillis((val as { seconds: number }).seconds * 1000);
  }
  return null;
};

/**
 * Asegura turno visible en Plan/Ops/Supervisión para el guardia que cubre:
 * - Mismo objetivo: actualiza turno existente con origin OPERATIONS_COVERAGE.
 * - Otro objetivo / sin tramo en malla: crea doc `ops_cov_{ausencia}_{legajo}` en el objetivo del hueco.
 */
export async function materializeOpsCoverageShift(
  db: Firestore,
  batch: WriteBatch,
  opts: {
    titularShift: Record<string, unknown> & { id: string };
    candidateEmployeeId: string;
    candidateEmployeeName: string;
    candidateShiftId?: string | null;
    coverageType: string;
    empresaId: string;
    keepDocId?: string | null;
  },
): Promise<string> {
  const absenceId = String(opts.titularShift.id || '').trim();
  const empresaId = String(opts.empresaId || opts.titularShift.empresaId || '').trim();
  const titularObj = String(opts.titularShift.objectiveId || '').trim();
  const linkFields = opsCoverageLinkFields(
    {
      employeeId: opts.titularShift.employeeId,
      employeeName: opts.titularShift.employeeName,
    },
    absenceId,
  );

  const deterministicId = absenceId
    ? `ops_cov_${absenceId}_${opts.candidateEmployeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
    : '';
  const covDocId = opts.keepDocId || deterministicId || doc(collection(db, 'turnos')).id;

  const startTs =
    toTimestamp(opts.titularShift.startTime)
    ?? (opts.titularShift.shiftDateObj instanceof Date
      ? Timestamp.fromDate(opts.titularShift.shiftDateObj)
      : null);
  const endTs =
    toTimestamp(opts.titularShift.endTime)
    ?? (opts.titularShift.endDateObj instanceof Date
      ? Timestamp.fromDate(opts.titularShift.endDateObj)
      : null);

  const candId = String(opts.candidateShiftId || '').trim();
  if (candId && candId !== opts.candidateEmployeeId) {
    const candSnap = await getDoc(doc(db, 'turnos', candId));
    if (candSnap.exists()) {
      const cd = candSnap.data() as Record<string, unknown>;
      const sameObjective = String(cd.objectiveId || '').trim() === titularObj;
      if (sameObjective && String(cd.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') {
        batch.update(doc(db, 'turnos', candId), {
          origin: 'OPERATIONS_COVERAGE',
          resolvedBy: 'OPERACIONES',
          coverageType: opts.coverageType,
          coversPositionName: opts.titularShift.positionName || cd.positionName || null,
          ...linkFields,
          assignedAt: serverTimestamp(),
        });
        return candId;
      }
    }
  }

  batch.set(
    doc(db, 'turnos', covDocId),
    stampEmpresaId(
      {
        employeeId: opts.candidateEmployeeId,
        employeeName: opts.candidateEmployeeName,
        clientId: opts.titularShift.clientId || null,
        clientName: opts.titularShift.clientName || null,
        objectiveId: opts.titularShift.objectiveId || null,
        objectiveName: opts.titularShift.objectiveName || '',
        positionName: opts.titularShift.positionName || null,
        coversPositionName: opts.titularShift.positionName || null,
        code: opts.titularShift.code || 'T',
        type: opts.titularShift.code || 'T',
        startTime: startTs,
        endTime: endTs,
        status: 'PENDING',
        origin: 'OPERATIONS_COVERAGE',
        resolvedBy: 'OPERACIONES',
        coverageType: opts.coverageType,
        ...linkFields,
        isAwaitingCoverageCheckIn: true,
        createdAt: serverTimestamp(),
      },
      empresaId,
    ),
    { merge: true },
  );
  return covDocId;
}

/** Vínculo titular ↔ cobertura para tooltip Plan ("cubre: NOMBRE"). */
export function opsCoverageLinkFields(
  titular: Record<string, unknown> | null | undefined,
  absenceShiftId: string,
): Record<string, unknown> {
  return {
    absenceShiftId,
    coveredShiftId: absenceShiftId,
    coversEmployeeId: titular?.employeeId || null,
    coversEmployeeName: titular?.employeeName || null,
  };
}


/** Soft-cancel OPERATIONS_COVERAGE previos del mismo absenceShiftId (cliente). */
export async function supersedeOpsCoveragesForAbsence(
  db: Firestore,
  absenceShiftId: string,
  batch: WriteBatch,
  opts?: { keepDocId?: string | null; supersededBy?: string | null },
): Promise<number> {
  const id = String(absenceShiftId || '').trim();
  if (!id) return 0;
  const [byAbsence, byCovered] = await Promise.all([
    getDocs(query(collection(db, 'turnos'), where('absenceShiftId', '==', id), limit(40))),
    getDocs(query(collection(db, 'turnos'), where('coveredShiftId', '==', id), limit(40))),
  ]);
  const seen = new Set<string>();
  let n = 0;
  for (const d of [...byAbsence.docs, ...byCovered.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    if (opts?.keepDocId && d.id === opts.keepDocId) continue;
    const data = d.data() as Record<string, unknown>;
    if (!isActiveOpsCoverageDoc(data)) continue;
    batch.update(d.ref, {
      coverageSuperseded: true,
      coverageSupersededAt: serverTimestamp(),
      coverageSupersededBy: opts?.supersededBy || null,
      status: 'CANCELLED',
    });
    n += 1;
  }
  return n;
}
