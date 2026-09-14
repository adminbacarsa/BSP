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
  }
  return patch;
}
