import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { revertTitularAfterConvocadoNoLlego, cancelPendingConvocatoriasForTitular } from './convocadoTitularRevert';

export type RevertConvocadoFalseResult = {
  dryRun: boolean;
  scanned: number;
  reverted: number;
  rows: Array<{ opsCovId: string; titularId: string; action: string }>;
};

/** Limpieza Demo: ops_cov marcados CONVOCADO_NO_LLEGO por el scheduler real (no deberían existir en Demo). */
export async function revertConvocadoFalseAbsencesRun(
  db: Firestore,
  opts: { empresaId: string; dryRun?: boolean },
): Promise<RevertConvocadoFalseResult> {
  const empresaId = String(opts.empresaId || '').trim();
  const dryRun = opts.dryRun !== false;
  const rows: RevertConvocadoFalseResult['rows'] = [];

  const snap = await db
    .collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('origin', '==', 'OPERATIONS_COVERAGE')
    .where('absenceDetectedBy', '==', 'CONVOCADO_NO_LLEGO')
    .limit(200)
    .get();

  let reverted = 0;
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const titularId = String(data.absenceShiftId || data.coveredShiftId || '').trim();
    rows.push({ opsCovId: d.id, titularId, action: dryRun ? 'would_revert' : 'reverted' });

    if (dryRun) continue;

    await d.ref.update({
      isAbsent: false,
      status: 'CANCELLED',
      absenceType: null,
      absenceDetectedAt: null,
      absenceDetectedBy: null,
      coverageSuperseded: true,
      coverageSupersededAt: FieldValue.serverTimestamp(),
      coverageSupersededBy: 'REVERT_CONVOCADO_FALSE',
    });

    const ausSnap = await db.collection('ausencias').where('shiftId', '==', d.id).limit(5).get();
    for (const a of ausSnap.docs) {
      const origin = String(a.data().origin || '');
      if (origin === 'CONVOCADO_NO_LLEGO' || a.data().absenceType === 'AA') {
        await a.ref.update({ status: 'Anulada', anuladaAt: FieldValue.serverTimestamp() });
      }
    }

    if (titularId) {
      await revertTitularAfterConvocadoNoLlego(db, { ...data, id: d.id });
      await cancelPendingConvocatoriasForTitular(db, titularId);
    }
    reverted += 1;
  }

  return { dryRun, scanned: snap.size, reverted, rows };
}
