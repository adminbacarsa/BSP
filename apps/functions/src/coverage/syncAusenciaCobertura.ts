import * as admin from 'firebase-admin';
import { resolveCoverageBandCode } from './coverageExtAdvSegments';
import {
  gapWindowFromTitularShift,
  sourceShiftEligibleForCoverageGap,
} from './coverageSourceShiftForGap';

function coverageServerTime(): admin.firestore.Timestamp | admin.firestore.FieldValue {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return admin.firestore.Timestamp.now();
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

export type SyncAusenciaCoberturaParams = {
  shiftId: string;
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string | null;
  resolvedBy?: string;
  empresaId?: string | null;
};

/**
 * Al resolver cobertura (callable / cascada), marca la ausencia RRHH vinculada
 * por shiftId como GESTIONADA para alinear Ops ↔ RRHH.
 */
export async function syncAusenciaCoberturaGestionada(
  db: admin.firestore.Firestore,
  params: SyncAusenciaCoberturaParams,
  batch?: admin.firestore.WriteBatch,
): Promise<number> {
  const shiftId = String(params.shiftId || '').trim();
  if (!shiftId) return 0;

  let q: admin.firestore.Query = db.collection('ausencias').where('shiftId', '==', shiftId);
  if (params.empresaId) {
    q = q.where('empresaId', '==', params.empresaId);
  }
  const snap = await q.limit(10).get();
  if (snap.empty) return 0;

  const payload: Record<string, unknown> = {
    coberturaEstado: 'GESTIONADA',
    coberturaResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    coberturaResolvedBy: params.resolvedBy || 'OPERACIONES',
    coveredByEmployeeId: params.coveredByEmployeeId ?? null,
    coveredByEmployeeName: params.coveredByEmployeeName ?? null,
    coverageType: params.coverageType ?? null,
  };

  let n = 0;
  for (const d of snap.docs) {
    if (batch) batch.update(d.ref, payload);
    else await d.ref.update(payload);
    n += 1;
  }
  return n;
}

export type CoverageResolvedBy = 'OPERACIONES' | 'AUTO' | 'MODO_DEMO';

export class CoverageApplyError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Marca el turno titular como cubierto (sin borrar isAbsent en ausencias reales). */
export function absentShiftCoveragePatch(opts: {
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string;
  coverageDocId?: string | null;
  isAbsence?: boolean;
  resolvedBy?: string;
  titularStatus?: 'COVERED' | 'PARTIAL';
}): Record<string, unknown> {
  const titularSt = opts.titularStatus || 'COVERED';
  const patch: Record<string, unknown> = {
    resolvedBy: opts.resolvedBy || 'OPERACIONES',
    coverageType: opts.coverageType || 'COBERTURA',
    coveredAt: coverageServerTime(),
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

export function isDualSiblingOpsCoverage(existingType: string, incomingType: string): boolean {
  const a = String(existingType || '').toUpperCase();
  const b = String(incomingType || '').toUpperCase();
  return (a === 'EXTEND' && b === 'ADVANCE') || (a === 'ADVANCE' && b === 'EXTEND');
}

export function isTitularAlreadyCovered(data: Record<string, any> | undefined | null): boolean {
  if (!data) return false;
  const st = String(data.coverageStatus || '').toUpperCase();
  if (st === 'PARTIAL' || st === 'PLANNED') return false;
  if (data.operacionallyCovered === true) return true;
  if (st === 'COVERED') return true;
  return false;
}

/**
 * onGuardAbsenceDetected crea un turno VACANTE_POR_AUSENCIA aparte (push a admins). Nadie más lo
 * cierra: sin esto queda "DESCUBIERTO" en el CC aunque el titular ya esté cubierto o revertido.
 */
export async function findOpenAbsenceVacancyDocs(
  db: admin.firestore.Firestore,
  titularShiftId: string,
): Promise<admin.firestore.DocumentReference[]> {
  const snap = await db
    .collection('turnos')
    .where('causedByShiftId', '==', titularShiftId)
    .where('origin', '==', 'VACANTE_POR_AUSENCIA')
    .limit(5)
    .get();
  return snap.docs.filter((d) => d.data().isDeleted !== true).map((d) => d.ref);
}

export function absenceVacancyClosePatch(
  outcome: 'COVERED' | 'REVERTED',
  by: string,
): Record<string, unknown> {
  return {
    isDeleted: true,
    status: outcome === 'COVERED' ? 'COVERED' : 'CANCELLED',
    deletedReason: outcome === 'COVERED' ? 'TITULAR_CUBIERTO' : 'AUSENCIA_REVERTIDA',
    closedBy: by,
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
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
    coverageUsed: admin.firestore.FieldValue.delete(),
    coverageUsedForShiftId: admin.firestore.FieldValue.delete(),
    coverageDocId: admin.firestore.FieldValue.delete(),
    coverageUsedAt: admin.firestore.FieldValue.delete(),
    coverageUsedBy: admin.firestore.FieldValue.delete(),
    coverageUsedCoversEmployeeName: admin.firestore.FieldValue.delete(),
    coverageUsedObjectiveName: admin.firestore.FieldValue.delete(),
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
      deletedReason: admin.firestore.FieldValue.delete(),
      convertedToCoverageDocId: admin.firestore.FieldValue.delete(),
      statusBeforeDelete: admin.firestore.FieldValue.delete(),
      ...clearSourceCoverageUsedPatch(),
    };
  }
  return {
    ...clearSourceCoverageUsedPatch(),
    isRetentionActivated: admin.firestore.FieldValue.delete(),
    retentionActivatedAt: admin.firestore.FieldValue.delete(),
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
    coverageUsedAt: coverageServerTime(),
    coverageUsedBy: opts.resolvedBy,
    coverageUsedCoversEmployeeName: opts.coversEmployeeName ?? null,
    coverageUsedObjectiveName: opts.coversObjectiveName ?? null,
    isRetentionActivated: true,
    retentionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/** Cobertura ops activa (no supersedida / cancelada). */
export function isActiveOpsCoverageDoc(
  data: Record<string, any> | undefined | null,
): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  if (data.isDeleted === true) return false;
  return true;
}

/**
 * Soft-cancel de OPERATIONS_COVERAGE previos del mismo absenceShiftId.
 * Invariante: 1 ausencia → 1 cobertura ops activa.
 */
export async function supersedeOpsCoveragesForAbsence(
  db: admin.firestore.Firestore,
  absenceShiftId: string,
  batch: admin.firestore.WriteBatch,
  opts?: {
    keepDocId?: string | null;
    supersededBy?: string | null;
    /** Si se define, solo supersedea docs ops del mismo coverageType (EXT+ADV pueden coexistir). */
    onlySupersedeCoverageType?: string | null;
  },
): Promise<number> {
  const id = String(absenceShiftId || '').trim();
  if (!id) return 0;

  const [byAbsence, byCovered] = await Promise.all([
    db.collection('turnos').where('absenceShiftId', '==', id).limit(40).get(),
    db.collection('turnos').where('coveredShiftId', '==', id).limit(40).get(),
  ]);

  const seen = new Set<string>();
  let n = 0;
  for (const d of [...byAbsence.docs, ...byCovered.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    if (opts?.keepDocId && d.id === opts.keepDocId) continue;
    const data = d.data();
    if (!isActiveOpsCoverageDoc(data)) continue;
    const onlyCt = String(opts?.onlySupersedeCoverageType || '').trim().toUpperCase();
    if (onlyCt) {
      const docCt = String(data.coverageType || '').toUpperCase();
      if (docCt !== onlyCt) continue;
    }
    const prevSource = String(data.sourceShiftId || '').trim();
    if (prevSource) {
      const srcSnap = await db.collection('turnos').doc(prevSource).get();
      if (srcSnap.exists) {
        batch.update(
          srcSnap.ref,
          buildRestoreSourceShiftAfterCoveragePatch(srcSnap.data() as Record<string, unknown>),
        );
      }
    }
    batch.update(d.ref, {
      coverageSuperseded: true,
      coverageSupersededAt: admin.firestore.FieldValue.serverTimestamp(),
      coverageSupersededBy: opts?.supersededBy || null,
      status: 'CANCELLED',
    });
    n += 1;
  }
  return n;
}

/** Campos de vínculo titular ↔ cobertura para tooltip Plan ("cubre: NOMBRE"). */
export function opsCoverageLinkFields(titular: Record<string, any> | undefined | null, absenceShiftId: string): Record<string, unknown> {
  return {
    absenceShiftId,
    coveredShiftId: absenceShiftId,
    coversEmployeeId: titular?.employeeId || null,
    coversEmployeeName: titular?.employeeName || null,
  };
}

export type ApplyCoverageParams = {
  titularShiftId: string;
  titularShift?: Record<string, unknown>;
  candidateEmployeeId: string;
  candidateEmployeeName: string;
  sourceShiftId?: string | null;
  coverageType: string;
  resolvedBy: CoverageResolvedBy;
  empresaId: string;
  startTime?: admin.firestore.Timestamp | null;
  endTime?: admin.firestore.Timestamp | null;
  code?: string;
  positionName?: string;
  objectiveId?: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  titularCloseMode?: 'FULL' | 'PARTIAL' | 'NONE';
  convocatoriaId?: string;
  allowReplace?: boolean;
  covSegmentStart?: admin.firestore.Timestamp | null;
  covSegmentEnd?: admin.firestore.Timestamp | null;
  extensionEndTime?: admin.firestore.Timestamp | null;
  adjustedStartTime?: admin.firestore.Timestamp | null;
  coveredByLabel?: string | null;
};

/** Escritura única de cobertura (espejo web2). */
export async function applyCoverage(
  db: admin.firestore.Firestore,
  batch: admin.firestore.WriteBatch,
  params: ApplyCoverageParams,
): Promise<string> {
  const titularId = String(params.titularShiftId || '').trim();
  if (!titularId) throw new CoverageApplyError('INVALID', 'Falta titularShiftId');

  let titular = params.titularShift;
  if (!titular) {
    const snap = await db.collection('turnos').doc(titularId).get();
    if (!snap.exists) throw new CoverageApplyError('NOT_FOUND', 'Turno titular no encontrado');
    titular = { id: snap.id, ...snap.data() } as Record<string, unknown>;
  }

  const empresaId = String(params.empresaId || titular.empresaId || '').trim();
  const covDocId = buildOpsCoverageDocId(titularId, params.candidateEmployeeId);

  const ctEarly = String(params.coverageType || 'COBERTURA').toUpperCase();
  const existingCovId = String(titular.coverageDocId || '').trim();
  if (existingCovId && !params.allowReplace && existingCovId !== covDocId) {
    const exSnap = await db.collection('turnos').doc(existingCovId).get();
    if (exSnap.exists && isActiveOpsCoverageDoc(exSnap.data())) {
      const exCt = String(exSnap.data()?.coverageType || '').toUpperCase();
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
      code: params.code || (titular.code as string),
      startTime: titular.startTime,
    });
  } catch {
    throw new CoverageApplyError('INVALID_CODE', 'Falta código de banda del titular');
  }
  const startTs =
    params.covSegmentStart
    ?? params.startTime
    ?? (titular.startTime as admin.firestore.Timestamp)
    ?? null;
  const endTs =
    params.covSegmentEnd
    ?? params.endTime
    ?? (titular.endTime as admin.firestore.Timestamp)
    ?? null;
  const posName = params.positionName || titular.positionName || null;
  const ct = ctEarly;
  const isRet = ct === 'RET';

  const sourceId = String(params.sourceShiftId || '').trim();
  if (sourceId) {
    const srcSnap = await db.collection('turnos').doc(sourceId).get();
    if (!srcSnap.exists) {
      throw new CoverageApplyError('NOT_FOUND', 'Turno origen no encontrado');
    }
    const srcData = srcSnap.data() as Record<string, unknown>;
    const sameCovOnSource =
      String(srcData.coverageDocId || '').trim() === covDocId
      && (srcData.coverageUsed === true || ct === 'EXTEND' || ct === 'ADVANCE');
    if (['REF', 'ESC', 'RET'].includes(ct) && !sameCovOnSource) {
      const gap = gapWindowFromTitularShift(titular);
      if (!gap || !sourceShiftEligibleForCoverageGap(srcData, gap)) {
        throw new CoverageApplyError(
          'INVALID_SOURCE',
          'El turno de origen no solapa el hueco (banda/horario). Elegí otro REF/ESC/RET o desvinculá el conflicto.',
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
      // Reintento / resync: origen ya vinculado a este ops_cov.
    } else if (ct === 'EXTEND' && params.extensionEndTime) {
      batch.update(db.collection('turnos').doc(sourceId), {
        ...usedBase,
        isExtended: true,
        adjustedEndTime: params.extensionEndTime,
        extensionEndTime: params.extensionEndTime,
      });
    } else if (ct === 'ADVANCE' && params.adjustedStartTime) {
      batch.update(db.collection('turnos').doc(sourceId), {
        ...usedBase,
        isEarlyStart: true,
        adjustedStartTime: params.adjustedStartTime,
      });
    } else if (ct === 'ESC' || ct === 'REF') {
      batch.update(
        db.collection('turnos').doc(sourceId),
        buildEscRefSourceConvertedPatch(srcData, covDocId),
      );
    } else {
      batch.update(db.collection('turnos').doc(sourceId), usedBase);
    }
  }

  batch.set(
    db.collection('turnos').doc(covDocId),
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
      empresaId: empresaId || null,
      createdAt: coverageServerTime(),
      ...(params.convocatoriaId ? { assignedByConvocatoria: params.convocatoriaId } : {}),
    },
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
      db.collection('turnos').doc(titularId),
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

  if (closeMode === 'FULL') {
    for (const ref of await findOpenAbsenceVacancyDocs(db, titularId)) {
      batch.update(ref, absenceVacancyClosePatch('COVERED', params.resolvedBy || 'COVERAGE'));
    }
    const { releaseRetentionForAbsenceShift } = await import('./coverageRetention');
    await releaseRetentionForAbsenceShift(db, titularId, params.resolvedBy || 'COVERAGE');
  }

  return covDocId;
}
