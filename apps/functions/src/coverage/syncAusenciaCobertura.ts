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

/** Marca el turno titular como cubierto (sin borrar isAbsent en ausencias reales). */
export function absentShiftCoveragePatch(opts: {
  coveredByEmployeeId?: string | null;
  coveredByEmployeeName?: string | null;
  coverageType?: string;
  isAbsence?: boolean;
  resolvedBy?: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    resolvedBy: opts.resolvedBy || 'OPERACIONES',
    coverageType: opts.coverageType || 'COBERTURA',
    coveredAt: admin.firestore.FieldValue.serverTimestamp(),
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

/** Criterio demo/prod: 1 ausencia ya cubierta no debe reabrir cascada ni crear otra cobertura. */
export function isTitularAlreadyCovered(
  data: Record<string, any> | undefined | null,
): boolean {
  if (!data) return false;
  if (data.operacionallyCovered === true) return true;
  if (String(data.coverageStatus || '').toUpperCase() === 'COVERED') return true;
  if (data.coveredByEmployeeId) return true;
  if (data.coveredByEmployeeName) return true;
  return false;
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
  opts?: { keepDocId?: string | null; supersededBy?: string | null },
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
