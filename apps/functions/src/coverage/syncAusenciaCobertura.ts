import * as admin from 'firebase-admin';

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
    coveredAt: admin.firestore.FieldValue.serverTimestamp(),
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

/** Criterio demo/prod: 1 ausencia ya cubierta no debe reabrir cascada ni crear otra cobertura. */
export function isTitularAlreadyCovered(
  data: Record<string, any> | undefined | null,
): boolean {
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
    coverageUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    coverageUsedBy: opts.resolvedBy,
  };
  if (opts.isRet) {
    patch.isRetentionActivated = true;
    patch.retentionActivatedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  return patch;
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
      batch.update(db.collection('turnos').doc(prevSource), clearSourceCoverageUsedPatch());
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

  const existingCovId = String(titular.coverageDocId || '').trim();
  if (existingCovId && !params.allowReplace && existingCovId !== covDocId) {
    const exSnap = await db.collection('turnos').doc(existingCovId).get();
    if (exSnap.exists && isActiveOpsCoverageDoc(exSnap.data())) {
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
  const startTs = params.startTime ?? (titular.startTime as admin.firestore.Timestamp) ?? null;
  const endTs = params.endTime ?? (titular.endTime as admin.firestore.Timestamp) ?? null;
  const posName = params.positionName || titular.positionName || null;
  const ct = String(params.coverageType || 'COBERTURA').toUpperCase();
  const isRet = ct === 'RET';

  const sourceId = String(params.sourceShiftId || '').trim();
  if (sourceId && sourceId !== params.candidateEmployeeId) {
    batch.update(
      db.collection('turnos').doc(sourceId),
      sourceShiftCoverageUsedPatch({
        titularShiftId: titularId,
        coverageDocId: covDocId,
        resolvedBy: params.resolvedBy,
        isRet,
      }),
    );
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
      isAwaitingCoverageCheckIn: true,
      coverageSuperseded: false,
      empresaId: empresaId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(params.convocatoriaId ? { assignedByConvocatoria: params.convocatoriaId } : {}),
    },
    { merge: true },
  );

  const closeMode = params.titularCloseMode ?? 'FULL';
  if (closeMode !== 'NONE') {
    const isAbsence =
      titular.isAbsent === true || String(titular.status || '').toUpperCase() === 'ABSENT';
    batch.update(
      db.collection('turnos').doc(titularId),
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
