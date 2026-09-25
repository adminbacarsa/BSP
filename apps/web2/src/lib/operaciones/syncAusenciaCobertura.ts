import {
  collection,
  deleteField,
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
import { resolveCoverageBandCode } from '@/lib/operaciones/coverageExtAdvSegments';
import {
  gapFromAbsenceLikeShift,
  sourceShiftEligibleForCoverageGap,
} from '@/lib/operaciones/coverageSourceShiftForGap';
import {
  isDualSiblingOpsCoverage,
  isTitularAlreadyCovered,
} from '@/lib/operaciones/coverageTitularState';

export { isDualSiblingOpsCoverage, isTitularAlreadyCovered } from '@/lib/operaciones/coverageTitularState';

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

export function buildOpsCoverageDocId(titularShiftId: string, employeeId: string): string {
  return `ops_cov_${titularShiftId}_${employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export const DELETED_REASON_CONVERTED_COVERAGE = 'CONVERTIDO_EN_COBERTURA';

export function isSourceShiftConvertedForCoverage(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  return (
    data.isDeleted === true
    && String(data.deletedReason || '') === DELETED_REASON_CONVERTED_COVERAGE
  );
}

export function clearSourceCoverageUsedPatch(): Record<string, unknown> {
  return {
    coverageUsed: false,
    coverageUsedForShiftId: null,
    coverageDocId: null,
    coverageUsedAt: null,
    coverageUsedBy: null,
    coverageUsedCoversEmployeeName: null,
    coverageUsedObjectiveName: null,
  };
}

/** REF/ESC: el turno planificado se convierte en cobertura (baja lógica); el ops_cov lleva banda del titular. */
export function buildEscRefSourceConvertedPatch(
  srcData: Record<string, unknown>,
  covDocId: string,
): Record<string, unknown> {
  const statusBeforeDelete = String(srcData.status ?? 'ACTIVE');
  return {
    isDeleted: true,
    status: 'CANCELLED',
    deletedReason: DELETED_REASON_CONVERTED_COVERAGE,
    convertedToCoverageDocId: covDocId,
    statusBeforeDelete,
    coverageUsed: deleteField(),
    coverageUsedForShiftId: deleteField(),
    coverageDocId: deleteField(),
    coverageUsedAt: deleteField(),
    coverageUsedBy: deleteField(),
    coverageUsedCoversEmployeeName: deleteField(),
    coverageUsedObjectiveName: deleteField(),
  };
}

/** Restaura turno origen al cancelar/supersedear cobertura (REF/ESC convertidos o RET con coverageUsed). */
export function buildRestoreSourceShiftAfterCoveragePatch(
  srcData: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!srcData) return clearSourceCoverageUsedPatch();
  if (isSourceShiftConvertedForCoverage(srcData)) {
    const prevStatus = String(srcData.statusBeforeDelete || 'ACTIVE');
    return {
      isDeleted: false,
      status: prevStatus,
      deletedReason: deleteField(),
      convertedToCoverageDocId: deleteField(),
      statusBeforeDelete: deleteField(),
      ...clearSourceCoverageUsedPatch(),
    };
  }
  return {
    ...clearSourceCoverageUsedPatch(),
    isRetentionActivated: deleteField(),
    retentionActivatedAt: deleteField(),
  };
}

export function sourceShiftCoverageUsedPatch(opts: {
  titularShiftId: string;
  coverageDocId: string;
  resolvedBy: CoverageResolvedBy;
  isRet: boolean;
  coversEmployeeName?: string | null;
  coversObjectiveName?: string | null;
}): Record<string, unknown> {
  if (!opts.isRet) {
    return { coverageDocId: opts.coverageDocId };
  }
  return {
    coverageUsed: true,
    coverageUsedForShiftId: opts.titularShiftId,
    coverageDocId: opts.coverageDocId,
    coverageUsedAt: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_EMULATOR === 'true'
      ? Timestamp.now()
      : serverTimestamp(),
    coverageUsedBy: opts.resolvedBy,
    coverageUsedCoversEmployeeName: opts.coversEmployeeName ?? null,
    coverageUsedObjectiveName: opts.coversObjectiveName ?? null,
    isRetentionActivated: true,
    retentionActivatedAt: serverTimestamp(),
  };
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
  covSegmentStart?: Timestamp | null;
  covSegmentEnd?: Timestamp | null;
  extensionEndTime?: Timestamp | null;
  adjustedStartTime?: Timestamp | null;
  coveredByLabel?: string | null;
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

  const ctEarly = String(params.coverageType || 'COBERTURA').toUpperCase();
  const existingCovId = String(titular.coverageDocId || '').trim();
  if (existingCovId && !params.allowReplace && existingCovId !== covDocId) {
    const exSnap = await getDoc(doc(db, 'turnos', existingCovId));
    if (exSnap.exists() && isActiveOpsCoverageDoc(exSnap.data() as Record<string, unknown>)) {
      const exCt = String((exSnap.data() as Record<string, unknown>).coverageType || '').toUpperCase();
      if (!isDualSiblingOpsCoverage(exCt, ctEarly)) {
        throw new CoverageApplyError('ALREADY_COVERED', 'El titular ya tiene cobertura activa');
      }
    }
  }

  const dualLeg = ctEarly === 'EXTEND' || ctEarly === 'ADVANCE';
  await supersedeOpsCoveragesForAbsence(db, titularId, batch, {
    keepDocId: covDocId,
    supersededBy: params.convocatoriaId || params.resolvedBy,
    onlySupersedeCoverageType: dualLeg ? ctEarly : null,
  });

  const linkFields = opsCoverageLinkFields(titular, titularId);
  let bandCode: string;
  try {
    bandCode = resolveCoverageBandCode({
      code: (params.code || titular.code) as string,
      startTime: titular.startTime ?? titular.shiftDateObj,
    });
  } catch {
    throw new CoverageApplyError('INVALID_CODE', 'Falta código de banda del titular');
  }
  const startTs =
    params.covSegmentStart
    ?? params.startTime
    ?? toTimestamp(titular.startTime)
    ?? (titular.shiftDateObj instanceof Date ? Timestamp.fromDate(titular.shiftDateObj) : null);
  const endTs =
    params.covSegmentEnd
    ?? params.endTime
    ?? toTimestamp(titular.endTime)
    ?? (titular.endDateObj instanceof Date ? Timestamp.fromDate(titular.endDateObj) : null);

  const posName = params.positionName || titular.positionName || null;
  const ct = ctEarly;
  const isRet = ct === 'RET';

  const sourceId = String(params.sourceShiftId || '').trim();
  if (sourceId) {
    const srcSnap = await getDoc(doc(db, 'turnos', sourceId));
    if (!srcSnap.exists()) {
      throw new CoverageApplyError('NOT_FOUND', 'Turno origen no encontrado');
    }
    const srcData = srcSnap.data() as Record<string, unknown>;
    const sameCovOnSource =
      String(srcData.coverageDocId || '').trim() === covDocId
      && (srcData.coverageUsed === true || ct === 'EXTEND' || ct === 'ADVANCE');
    if (['REF', 'ESC', 'RET'].includes(ct) && !sameCovOnSource) {
      const gap = gapFromAbsenceLikeShift(titular as Record<string, unknown>);
      if (!gap || !sourceShiftEligibleForCoverageGap(srcData, gap)) {
        throw new CoverageApplyError(
          'INVALID_SOURCE',
          'El turno de origen no solapa el hueco (banda/horario). Elegí otro REF/ESC/RET.',
        );
      }
    }
    const usedBase = sourceShiftCoverageUsedPatch({
      titularShiftId: titularId,
      coverageDocId: covDocId,
      resolvedBy: params.resolvedBy,
      isRet,
      coversEmployeeName: (titular.employeeName as string) || null,
      coversObjectiveName: (titular.objectiveName as string) || null,
    });
    if (sameCovOnSource) {
      // Reintento / resync.
    } else if (ct === 'EXTEND' && params.extensionEndTime) {
      batch.update(doc(db, 'turnos', sourceId), {
        ...usedBase,
        isExtended: true,
        adjustedEndTime: params.extensionEndTime,
        extensionEndTime: params.extensionEndTime,
      });
    } else if (ct === 'ADVANCE' && params.adjustedStartTime) {
      batch.update(doc(db, 'turnos', sourceId), {
        ...usedBase,
        isEarlyStart: true,
        adjustedStartTime: params.adjustedStartTime,
      });
    } else if (ct === 'ESC' || ct === 'REF') {
      batch.update(
        doc(db, 'turnos', sourceId),
        buildEscRefSourceConvertedPatch(srcData, covDocId),
      );
    } else {
      batch.update(doc(db, 'turnos', sourceId), usedBase);
    }
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
        isAwaitingCoverageCheckIn: ct !== 'EXTEND',
        coverageSuperseded: false,
        ...(ct === 'EXTEND' || ct === 'ADVANCE' ? { coverageHoursOnSource: true } : {}),
        createdAt: typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_EMULATOR === 'true'
          ? Timestamp.now()
          : serverTimestamp(),
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
    const titularName =
      closeMode === 'FULL' && params.coveredByLabel
        ? params.coveredByLabel
        : params.candidateEmployeeName;
    batch.update(
      doc(db, 'turnos', titularId),
      {
        ...absentShiftCoveragePatch({
          coveredByEmployeeId: params.candidateEmployeeId,
          coveredByEmployeeName: titularName,
          coverageType: closeMode === 'FULL' && params.coveredByLabel ? 'RETENCION' : ct,
          coverageDocId: covDocId,
          resolvedBy: params.resolvedBy,
          titularStatus: closeMode === 'PARTIAL' ? 'PARTIAL' : 'COVERED',
          isAbsence,
        }),
        coverageClaimConvocatoriaId: null,
        coverageConvocatoriaId: params.convocatoriaId || null,
      },
    );
  }

  // Espejo de functions: cierra el turno VACANTE_POR_AUSENCIA que crea onGuardAbsenceDetected.
  if (closeMode === 'FULL') {
    const empresaId = String(titular.empresaId || '').trim();
    const constraints = [
      where('causedByShiftId', '==', titularId),
      where('origin', '==', 'VACANTE_POR_AUSENCIA'),
      ...(empresaId ? [where('empresaId', '==', empresaId)] : []),
      limit(5),
    ];
    const vacSnap = await getDocs(query(collection(db, 'turnos'), ...constraints)).catch(() => null);
    for (const d of vacSnap?.docs ?? []) {
      if (d.data().isDeleted === true) continue;
      batch.update(d.ref, {
        isDeleted: true,
        status: 'COVERED',
        deletedReason: 'TITULAR_CUBIERTO',
        closedBy: params.resolvedBy || 'COVERAGE',
        closedAt: serverTimestamp(),
      });
    }
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
      const srcSnap = await getDoc(doc(db, 'turnos', prevSource));
      if (srcSnap.exists()) {
        batch.update(
          srcSnap.ref,
          buildRestoreSourceShiftAfterCoveragePatch(srcSnap.data() as Record<string, unknown>),
        );
      }
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
