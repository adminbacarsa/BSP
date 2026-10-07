import * as admin from 'firebase-admin';
import { isFrancoCoverageOriginDoc } from './coverageTraceShift';
import { isFrancoShiftCode } from '../common/simulableShift';
import { resolveCoverageBandCode } from './coverageExtAdvSegments';
import { isEventoShift } from '../eventos/eventoCoverage';
import { camposPresencia, parcheFuenteSinHoras, yaFicho } from '../fichajes/fichadaSobreCobertura';
import { asegurarObjetivoDeEvento, camposTurnoEvento } from '../eventos/turnoEvento';
import {
  gapWindowFromTitularShift,
  shiftEndMs,
  shiftStartMs,
  sourceShiftEligibleForCoverageGap,
} from './coverageSourceShiftForGap';
import { completesPartialSegment, uncoveredRemainderMs } from './partialSegment';

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
 * Cierra hermanos históricos VACANTE_POR_AUSENCIA (P3 ya no los crea).
 * Sin esto quedan "DESCUBIERTO" en el CC aunque el titular ya esté cubierto o revertido.
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
  const srcCode = String(srcData.code || srcData.shiftCode || '').trim().toUpperCase();
  const francoComment = /franco trabajado\s*\(cobertura/i.test(String(srcData.comments || ''));
  const restoreFranco = srcCode === 'FT'
    && String(srcData.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE'
    && (francoComment || srcData.isFrancoTrabajado === true || isFrancoCoverageOriginDoc(srcData));
  const francoBack = restoreFranco
    ? { code: 'F', isFranco: true, isFrancoTrabajado: false }
    : {};
  if (isSourceShiftConvertedForCoverage(srcData)) {
    const prevStatus = String(srcData.statusBeforeDelete || 'ACTIVE');
    return {
      isDeleted: false,
      status: prevStatus,
      deletedReason: admin.firestore.FieldValue.delete(),
      convertedToCoverageDocId: admin.firestore.FieldValue.delete(),
      statusBeforeDelete: admin.firestore.FieldValue.delete(),
      ...clearSourceCoverageUsedPatch(),
      ...francoBack,
    };
  }
  return {
    ...clearSourceCoverageUsedPatch(),
    ...francoBack,
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
  const origin = String(data.origin || '').toUpperCase();
  const coberturaDeEvento = origin === 'EVENTO' && data.eventGap === true && !!data.coverageType;
  if (origin !== 'OPERATIONS_COVERAGE' && !coberturaDeEvento) return false;
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
  /** Hora en que el convocado aceptó. Ancla de la ventana de fichada. */
  acceptedAt?: admin.firestore.Timestamp | null;
  allowReplace?: boolean;
  covSegmentStart?: admin.firestore.Timestamp | null;
  covSegmentEnd?: admin.firestore.Timestamp | null;
  extensionEndTime?: admin.firestore.Timestamp | null;
  adjustedStartTime?: admin.firestore.Timestamp | null;
  coveredByLabel?: string | null;
  /** No cancela otras coberturas activas del mismo hueco (p. ej. un EXT hermano). */
  preserveSiblingOpsCov?: boolean;
  /**
   * REF/ESC del mismo objetivo: el ops_cov usa la ventana del titular (T−15 / T−5 / T),
   * no la del convocado. El aviso lo manda asignarRefEscSiMismoObjetivo.
   */
  refEscAsignacionDirecta?: boolean;
  /**
   * RET asignado directo (cualquier objetivo): el origen se convierte como un REF
   * y el ops_cov usa la ventana del convocado, no la del turno planificado.
   */
  retAsignacionDirecta?: boolean;
  /** Más de 1 h antes del inicio: turno planificado (T−15 / T−5 / T / AA a T+30). */
  coberturaAnticipada?: boolean;
  /** 1 h o menos, o hueco ya empezado: ventana del convocado. */
  coberturaUrgente?: boolean;
  escenarioCobertura?: 'ANTICIPADA' | 'URGENTE';
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
  const titularPartial = String(titular.coverageStatus || '').toUpperCase() === 'PARTIAL';
  let remainder: { startMs: number; endMs: number } | null = null;
  if (existingCovId && !params.allowReplace && existingCovId !== covDocId) {
    const exSnap = await db.collection('turnos').doc(existingCovId).get();
    if (exSnap.exists && isActiveOpsCoverageDoc(exSnap.data())) {
      const ex = exSnap.data() as Record<string, unknown>;
      const exCt = String(ex.coverageType || '').toUpperCase();
      const completes = titularPartial && completesPartialSegment(exCt, ctEarly);
      if (completes) {
        const gap = gapWindowFromTitularShift(titular);
        remainder = gap
          ? uncoveredRemainderMs(gap.startMs, gap.endMs, shiftStartMs(ex), shiftEndMs(ex))
          : null;
      }
      const fillsRemainder = completes && !!remainder;
      if (!isDualSiblingOpsCoverage(exCt, ctEarly) && !fillsRemainder) {
        throw new CoverageApplyError('ALREADY_COVERED', 'El titular ya tiene cobertura activa');
      }
    }
  }

  const dualLeg = ctEarly === 'EXTEND' || ctEarly === 'ADVANCE';
  const onlySupersedeCoverageType = params.preserveSiblingOpsCov || dualLeg || remainder ? ctEarly : null;
  await supersedeOpsCoveragesForAbsence(db, titularId, batch, {
    keepDocId: covDocId,
    supersededBy: params.convocatoriaId || params.resolvedBy,
    onlySupersedeCoverageType,
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
    ?? (remainder ? admin.firestore.Timestamp.fromMillis(remainder.startMs) : null)
    ?? params.startTime
    ?? (titular.startTime as admin.firestore.Timestamp)
    ?? null;
  const endTs =
    params.covSegmentEnd
    ?? (remainder ? admin.firestore.Timestamp.fromMillis(remainder.endMs) : null)
    ?? params.endTime
    ?? (titular.endTime as admin.firestore.Timestamp)
    ?? null;
  const eventGap = isEventoShift(titular as { code?: unknown; origin?: unknown });
  const eventServicioNombre = String(titular.servicioNombre || params.positionName || titular.positionName || 'Evento');
  const posName = eventGap ? eventServicioNombre : (params.positionName || titular.positionName || null);
  const ct = ctEarly;
  const isRet = ct === 'RET';
  const writtenCode = eventGap ? 'EV' : (ct === 'FT' ? 'FT' : bandCode);

  const sourceId = String(params.sourceShiftId || '').trim();
  let srcData: Record<string, unknown> | null = null;
  if (sourceId) {
    const srcSnap = await db.collection('turnos').doc(sourceId).get();
    if (!srcSnap.exists) {
      throw new CoverageApplyError('NOT_FOUND', 'Turno origen no encontrado');
    }
    srcData = srcSnap.data() as Record<string, unknown>;
    const linkedToThis = String(srcData.coverageDocId || '').trim() === covDocId;
    const sameCovOnSource =
      linkedToThis && (srcData.coverageUsed === true || ct === 'EXTEND' || ct === 'ADVANCE');
    if (['REF', 'ESC', 'RET'].includes(ct) && !linkedToThis) {
      const gap = gapWindowFromTitularShift(titular);
      const window = gap && remainder
        ? { ...gap, startMs: remainder.startMs, endMs: remainder.endMs }
        : gap;
      if (!window || !sourceShiftEligibleForCoverageGap(srcData, window)) {
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
    const clearAdvanceMarkers = {
      isEarlyStart: false,
      adjustedStartTime: admin.firestore.FieldValue.delete(),
      isExtended: false,
      extensionEndTime: admin.firestore.FieldValue.delete(),
      adjustedEndTime: admin.firestore.FieldValue.delete(),
    };
    // FT conserva el franco origen (P9e): el FT real vive en el ops_cov. Solo REF/ESC/RET se convierten.
    const anularFuente = ct === 'REF' || ct === 'ESC' || ct === 'RET';
    const quitarReloj = anularFuente ? parcheFuenteSinHoras(covDocId, titularId) : null;
    if (sameCovOnSource && (ct === 'EXTEND' || ct === 'ADVANCE')) {
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
        { ...buildEscRefSourceConvertedPatch(srcData, covDocId), ...(quitarReloj || {}) },
      );
    } else if (ct === 'FT') {
      const srcCode = String(srcData.code || srcData.shiftCode || '').trim().toUpperCase();
      const comment = /franco trabajado\s*\(cobertura/i.test(String(srcData.comments || ''));
      const franco = srcData.isFranco === true
        || isFrancoShiftCode(srcCode)
        || comment
        || isFrancoCoverageOriginDoc(srcData);
      const keepCode = isFrancoShiftCode(srcCode) ? srcCode : 'F';
      batch.update(db.collection('turnos').doc(sourceId), {
        ...usedBase,
        ...clearAdvanceMarkers,
        coverageUsed: true,
        coverageUsedForShiftId: titularId,
        ...(franco
          ? {
            isFranco: true,
            isFrancoTrabajado: false,
            code: keepCode,
            comments: `Franco Trabajado (cobertura ${covDocId})`,
          }
          : {}),
      });
    } else if (ct === 'RET' && (params.retAsignacionDirecta || params.coberturaAnticipada || params.coberturaUrgente)) {
      batch.update(
        db.collection('turnos').doc(sourceId),
        { ...buildEscRefSourceConvertedPatch(srcData, covDocId), ...(quitarReloj || {}) },
      );
    } else if (ct === 'RET') {
      batch.update(db.collection('turnos').doc(sourceId), {
        ...usedBase,
        ...clearAdvanceMarkers,
        ...(quitarReloj || {}),
      });
    } else {
      batch.update(db.collection('turnos').doc(sourceId), usedBase);
    }
  }

  let eventCampos: Record<string, unknown> | null = null;
  if (eventGap) {
    const eventObjetivo = await asegurarObjetivoDeEvento(db, {
      eventoId: titular.eventoId,
      servicioId: titular.servicioId,
      eventoNombre: titular.eventoNombre,
      clientId: params.clientId ?? titular.clientId,
      clientName: params.clientName ?? titular.clientName,
    });
    eventCampos = {
      ...camposTurnoEvento({
        empresaId,
        eventoId: titular.eventoId,
        eventoNombre: titular.eventoNombre,
        servicioId: titular.servicioId,
        servicioNombre: titular.servicioNombre || eventServicioNombre,
        clientId: eventObjetivo.clientId || params.clientId || titular.clientId,
        clientName: eventObjetivo.clientName || params.clientName || titular.clientName,
        objectiveId: eventObjetivo.objectiveId || params.objectiveId || titular.objectiveId,
        objectiveName: eventObjetivo.objectiveName || params.objectiveName || titular.objectiveName,
        startTime: startTs,
        endTime: endTs,
        sourceShiftId: sourceId || null,
      }),
      eventGap: true,
    };
  }

  const existingCovSnap = await db.collection('turnos').doc(covDocId).get();
  const existingCov = existingCovSnap.exists
    ? (existingCovSnap.data() as Record<string, unknown>)
    : null;
  const realStartMs = (existingCov?.realStartTime as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  const keepPresence = existingCov?.isPresent === true || realStartMs > 0;
  const moverPresencia = !!srcData
    && ['REF', 'ESC', 'RET'].includes(ct)
    && yaFicho(srcData)
    && !keepPresence;

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
      code: writtenCode,
      type: eventGap ? 'Evento' : writtenCode,
      ...(eventCampos || {}),
      startTime: startTs,
      endTime: endTs,
      origin: eventGap ? 'EVENTO' : 'OPERATIONS_COVERAGE',
      resolvedBy: params.resolvedBy,
      coverageType: ct,
      ...linkFields,
      sourceShiftId: sourceId || null,
      coverageForShiftId: titularId,
      ...(srcData && (ct === 'REF' || ct === 'ESC' || ct === 'RET' || ct === 'FT')
        ? { codigoOriginal: String(srcData.code || srcData.shiftCode || ct).trim().toUpperCase() }
        : {}),
      coverageSuperseded: false,
      coverageHoursOnSource: ct === 'EXTEND' || ct === 'ADVANCE',
      empresaId: empresaId || null,
      ...(moverPresencia && srcData
        ? camposPresencia(srcData)
        : keepPresence
          ? {}
          : {
            status: 'PENDING',
            isPresent: false,
            isAwaitingCoverageCheckIn: ct !== 'EXTEND',
          }),
      ...(existingCov ? {} : { createdAt: coverageServerTime() }),
      ...(existingCov?.acceptedAt ? {} : { acceptedAt: params.acceptedAt || coverageServerTime() }),
      ...(params.convocatoriaId ? { assignedByConvocatoria: params.convocatoriaId } : {}),
      ...(params.refEscAsignacionDirecta ? { refEscAsignacionDirecta: true } : {}),
      ...(params.retAsignacionDirecta ? { retAsignacionDirecta: true } : {}),
      ...(params.coberturaAnticipada ? { coberturaAnticipada: true, refEscAsignacionDirecta: true } : {}),
      ...(params.coberturaUrgente ? { coberturaUrgente: true } : {}),
      ...(params.escenarioCobertura ? { escenarioCobertura: params.escenarioCobertura } : {}),
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
    if (titular.isSinCobertura === true || titular.vacanteEscalada === true) {
      const realEmployee = String(titular.employeeId || '').trim() && titular.employeeId !== 'VACANTE';
      batch.update(db.collection('turnos').doc(titularId), {
        isSinCobertura: false,
        vacanteEscalada: false,
        ...(realEmployee ? { isUnassigned: false } : {}),
      });
      const escRef = db
        .collection('novedades')
        .doc(`escalada_${titularId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)}`);
      if ((await escRef.get()).exists) {
        batch.update(escRef, {
          status: 'ATENDIDA',
          resolved: true,
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
    for (const ref of await findOpenAbsenceVacancyDocs(db, titularId)) {
      batch.update(ref, absenceVacancyClosePatch('COVERED', params.resolvedBy || 'COVERAGE'));
    }
    const { releaseRetentionForAbsenceShift } = await import('./coverageRetention');
    await releaseRetentionForAbsenceShift(db, titularId, params.resolvedBy || 'COVERAGE');
  }

  return covDocId;
}

/** Saca la marca de cobertura del titular y lo deja ausente, sin cubrir. */
export function clearTitularCoveragePatch(): Record<string, unknown> {
  const del = admin.firestore.FieldValue.delete();
  return {
    coverageType: del,
    coverageStatus: del,
    coverageDocId: del,
    coveredByEmployeeId: del,
    coveredByEmployeeName: del,
    coveredAt: del,
    operacionallyCovered: false,
    coverageConvocatoriaId: del,
    coverageClaimConvocatoriaId: del,
  };
}

/**
 * Anula un ops_cov sin borrarlo. Si otra cobertura activa usa el mismo turno fuente,
 * solo re-apunta coverageDocId; no revierte el adelanto/extensión de esa otra pata.
 */
export async function anularOpsCoverageLeg(
  db: admin.firestore.Firestore,
  batch: admin.firestore.WriteBatch,
  opts: { opsCovId: string; reason: string },
): Promise<void> {
  const id = String(opts.opsCovId || '').trim();
  const covSnap = await db.collection('turnos').doc(id).get();
  if (!covSnap.exists) throw new CoverageApplyError('NOT_FOUND', 'ops_cov no encontrado');
  const cov = covSnap.data() as Record<string, unknown>;
  if (!isActiveOpsCoverageDoc(cov)) return;

  batch.update(covSnap.ref, {
    coverageSuperseded: true,
    coverageSupersededAt: admin.firestore.FieldValue.serverTimestamp(),
    coverageSupersededReason: opts.reason,
    status: 'CANCELLED',
  });

  const titularId = String(cov.absenceShiftId || cov.coveredShiftId || '').trim();
  const sourceId = String(cov.sourceShiftId || '').trim();
  const siblingSnap = titularId
    ? await db.collection('turnos').where('absenceShiftId', '==', titularId).limit(20).get()
    : null;
  const otherOnGap = (siblingSnap?.docs || []).filter(
    (d) => d.id !== id && isActiveOpsCoverageDoc(d.data()),
  );
  if (titularId && otherOnGap.length === 0) {
    batch.update(db.collection('turnos').doc(titularId), clearTitularCoveragePatch());
  }

  if (!sourceId) return;
  const srcSnap = await db.collection('turnos').doc(sourceId).get();
  if (!srcSnap.exists) return;
  const src = srcSnap.data() as Record<string, unknown>;
  const bySource = await db.collection('turnos').where('sourceShiftId', '==', sourceId).limit(20).get();
  const otherOnSource = bySource.docs.filter((d) => d.id !== id && isActiveOpsCoverageDoc(d.data()));
  if (otherOnSource.length > 0) {
    if (String(src.coverageDocId || '') === id) {
      batch.update(srcSnap.ref, { coverageDocId: otherOnSource[0].id });
    }
    return;
  }
  if (String(src.coverageDocId || '') === id || src.coverageUsed === true) {
    batch.update(srcSnap.ref, {
      ...buildRestoreSourceShiftAfterCoveragePatch(src),
      isEarlyStart: false,
      adjustedStartTime: admin.firestore.FieldValue.delete(),
    });
  }
}
