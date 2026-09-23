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

export type CoverageResolvedBy = 'OPERACIONES' | 'AUTO' | 'MODO_DEMO';

export class CoverageApplyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Payload estándar para marcar el turno titular ausente/vacante como cubierto. */
export function absentShiftCoveragePatch(opts: {
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string;
  coverageDocId?: string | null;
  resolvedBy?: CoverageResolvedBy | string;
  titularStatus?: 'COVERED' | 'PARTIAL';
  /** Vacante pura: status COVERED. Ausencia: mantener isAbsent, no pisar status ABSENT. */
  isAbsence?: boolean;
}): Record<string, unknown> {
  const titularSt = opts.titularStatus || 'COVERED';
  const patch: Record<string, unknown> = {
    resolvedBy: opts.resolvedBy || 'OPERACIONES',
    coverageType: opts.coverageType || 'COBERTURA',
    coveredAt: serverTimestamp(),
    coveredByEmployeeId: opts.coveredByEmployeeId || null,
    coveredByEmployeeName: opts.coveredByEmployeeName || null,
    operacionallyCovered: titularSt === 'COVERED',
    coverageStatus: titularSt,
  };
  if (opts.coverageDocId) patch.coverageDocId = opts.coverageDocId;
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

/** Idempotencia Ops: titular con doc de cobertura activo. */
export function isTitularAlreadyCovered(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const covId = String(data.coverageDocId || '').trim();
  if (data.operacionallyCovered === true && covId) return true;
  if (String(data.coverageStatus || '').toUpperCase() === 'COVERED' && covId) return true;
  return false;
}

export function buildOpsCoverageDocId(titularShiftId: string, employeeId: string): string {
  return `ops_cov_${titularShiftId}_${employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export function clearSourceCoverageUsedPatch(): Record<string, unknown> {
  return {
    coverageUsed: false,
    coverageUsedForShiftId: null,
    coverageDocId: null,
    coverageUsedAt: null,
    coverageUsedBy: null,
  };
}

export function sourceShiftCoverageUsedPatch(opts: {
  titularShiftId: string;
  coverageDocId: string;
  resolvedBy: CoverageResolvedBy;
  isRet: boolean;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    coverageUsed: true,
    coverageUsedForShiftId: opts.titularShiftId,
    coverageDocId: opts.coverageDocId,
    coverageUsedAt: serverTimestamp(),
    coverageUsedBy: opts.resolvedBy,
  };
  if (opts.isRet) {
    patch.isRetentionActivated = true;
    patch.retentionActivatedAt = serverTimestamp();
  }
  return patch;
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

export type ApplyCoverageParams = {
  titularShiftId: string;
  titularShift?: Record<string, unknown>;
  candidateEmployeeId: string;
  candidateEmployeeName: string;
  sourceShiftId?: string | null;
  coverageType: string;
  resolvedBy: CoverageResolvedBy;
  empresaId: string;
  startTime?: Timestamp | null;
  endTime?: Timestamp | null;
  code?: string;
  positionName?: string;
  objectiveId?: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  titularCloseMode?: 'FULL' | 'PARTIAL' | 'NONE';
  convocatoriaId?: string;
  allowReplace?: boolean;
};

/**
 * Escritura única de cobertura Ops: doc B aparte + marca de uso en turno planificado (A) + titular (C).
 */
export async function applyCoverage(
  db: Firestore,
  batch: WriteBatch,
  params: ApplyCoverageParams,
): Promise<string> {
  const titularId = String(params.titularShiftId || '').trim();
  if (!titularId) throw new CoverageApplyError('INVALID', 'Falta titularShiftId');

  let titular = params.titularShift;
  if (!titular) {
    const snap = await getDoc(doc(db, 'turnos', titularId));
    if (!snap.exists()) throw new CoverageApplyError('NOT_FOUND', 'Turno titular no encontrado');
    titular = { id: snap.id, ...snap.data() } as Record<string, unknown>;
  }

  const empresaId = String(params.empresaId || titular.empresaId || '').trim();
  const covDocId = buildOpsCoverageDocId(titularId, params.candidateEmployeeId);

  const existingCovId = String(titular.coverageDocId || '').trim();
  if (existingCovId && !params.allowReplace && existingCovId !== covDocId) {
    const exSnap = await getDoc(doc(db, 'turnos', existingCovId));
    if (exSnap.exists() && isActiveOpsCoverageDoc(exSnap.data() as Record<string, unknown>)) {
      throw new CoverageApplyError('ALREADY_COVERED', 'El titular ya tiene cobertura activa');
    }
  }

  const ctEarly = String(params.coverageType || 'COBERTURA').toUpperCase();
  const dualLeg = ctEarly === 'EXTEND' || ctEarly === 'ADVANCE';
  await supersedeOpsCoveragesForAbsence(db, titularId, batch, {
    keepDocId: covDocId,
    supersededBy: params.convocatoriaId || params.resolvedBy,
    onlySupersedeCoverageType: dualLeg ? ctEarly : null,
  });

  const linkFields = opsCoverageLinkFields(titular, titularId);
  const bandCode = String(params.code || titular.code || 'T').trim();
  const startTs =
    params.startTime
    ?? toTimestamp(titular.startTime)
    ?? (titular.shiftDateObj instanceof Date ? Timestamp.fromDate(titular.shiftDateObj) : null);
  const endTs =
    params.endTime
    ?? toTimestamp(titular.endTime)
    ?? (titular.endDateObj instanceof Date ? Timestamp.fromDate(titular.endDateObj) : null);

  const posName = params.positionName || titular.positionName || null;
  const ct = String(params.coverageType || 'COBERTURA').toUpperCase();
  const isRet = ct === 'RET';

  const sourceId = String(params.sourceShiftId || '').trim();
  if (sourceId && sourceId !== params.candidateEmployeeId) {
    batch.update(
      doc(db, 'turnos', sourceId),
      sourceShiftCoverageUsedPatch({
        titularShiftId: titularId,
        coverageDocId: covDocId,
        resolvedBy: params.resolvedBy,
        isRet,
      }),
    );
  }

  batch.set(
    doc(db, 'turnos', covDocId),
    stampEmpresaId(
      {
        employeeId: params.candidateEmployeeId,
        employeeName: params.candidateEmployeeName,
        clientId: params.clientId ?? titular.clientId ?? null,
        clientName: params.clientName ?? titular.clientName ?? null,
        objectiveId: params.objectiveId ?? titular.objectiveId ?? null,
        objectiveName: params.objectiveName ?? titular.objectiveName ?? '',
        positionName: posName,
        coversPositionName: posName,
        code: ct === 'FT' ? 'FT' : bandCode,
        type: ct === 'FT' ? 'FT' : bandCode,
        startTime: startTs,
        endTime: endTs,
        status: 'PENDING',
        origin: 'OPERATIONS_COVERAGE',
        resolvedBy: params.resolvedBy,
        coverageType: ct,
        ...linkFields,
        sourceShiftId: sourceId || null,
        isPresent: false,
        isAwaitingCoverageCheckIn: true,
        coverageSuperseded: false,
        createdAt: serverTimestamp(),
        ...(params.convocatoriaId ? { assignedByConvocatoria: params.convocatoriaId } : {}),
      },
      empresaId,
    ),
    { merge: true },
  );

  const closeMode = params.titularCloseMode ?? 'FULL';
  if (closeMode !== 'NONE') {
    const isAbsence =
      titular.isAbsent === true || String(titular.status || '').toUpperCase() === 'ABSENT';
    batch.update(
      doc(db, 'turnos', titularId),
      absentShiftCoveragePatch({
        coveredByEmployeeId: params.candidateEmployeeId,
        coveredByEmployeeName: params.candidateEmployeeName,
        coverageType: ct,
        coverageDocId: covDocId,
        resolvedBy: params.resolvedBy,
        titularStatus: closeMode === 'PARTIAL' ? 'PARTIAL' : 'COVERED',
        isAbsence,
      }),
    );
  }

  return covDocId;
}

/** @deprecated Usar applyCoverage */
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
  return applyCoverage(db, batch, {
    titularShiftId: String(opts.titularShift.id),
    titularShift: opts.titularShift,
    candidateEmployeeId: opts.candidateEmployeeId,
    candidateEmployeeName: opts.candidateEmployeeName,
    sourceShiftId: opts.candidateShiftId,
    coverageType: opts.coverageType,
    resolvedBy: 'OPERACIONES',
    empresaId: opts.empresaId,
  });
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
  opts?: {
    keepDocId?: string | null;
    supersededBy?: string | null;
    onlySupersedeCoverageType?: string | null;
  },
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
    const onlyCt = String(opts?.onlySupersedeCoverageType || '').trim().toUpperCase();
    if (onlyCt) {
      const docCt = String(data.coverageType || '').toUpperCase();
      if (docCt !== onlyCt) continue;
    }
    const prevSource = String(data.sourceShiftId || '').trim();
    if (prevSource) {
      batch.update(doc(db, 'turnos', prevSource), clearSourceCoverageUsedPatch());
    }
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
