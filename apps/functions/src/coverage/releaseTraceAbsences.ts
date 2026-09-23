import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { isOpsCoverageHoursOnSourceDoc } from './coverageTraceShift';
import { releaseRetentionForAbsenceShift } from './coverageRetention';

export type ReleaseTraceAbsencesRow = {
  shiftId: string;
  employeeName: string;
  action: 'would_revert' | 'reverted';
};

export async function releaseTraceAbsencesRun(
  db: Firestore,
  opts: { empresaId?: string; dryRun?: boolean },
): Promise<{ rows: ReleaseTraceAbsencesRow[] }> {
  const dryRun = opts.dryRun !== false;
  const empresaFilter = String(opts.empresaId || '').trim();
  const snap = await db
    .collection('turnos')
    .where('origin', '==', 'OPERATIONS_COVERAGE')
    .where('isAbsent', '==', true)
    .limit(200)
    .get();

  const rows: ReleaseTraceAbsencesRow[] = [];

  for (const docSnap of snap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    if (!isOpsCoverageHoursOnSourceDoc(shift)) continue;
    if (empresaFilter && String(shift.empresaId || '') !== empresaFilter) continue;

    rows.push({
      shiftId: docSnap.id,
      employeeName: String(shift.employeeName || ''),
      action: dryRun ? 'would_revert' : 'reverted',
    });

    if (dryRun) continue;

    await docSnap.ref.update({
      status: 'PENDING',
      isAbsent: false,
      absenceType: FieldValue.delete(),
      absenceDetectedAt: FieldValue.delete(),
      absenceDetectedBy: FieldValue.delete(),
    });

    const ausSnap = await db.collection('ausencias').where('shiftId', '==', docSnap.id).limit(5).get();
    for (const a of ausSnap.docs) {
      await a.ref.update({ status: 'Anulada', anuladaAt: FieldValue.serverTimestamp(), anuladaBy: 'RELEASE_TRACE_ABSENCES' });
    }

    const convSnap = await db
      .collection('convocatorias_cobertura')
      .where('shiftId', '==', docSnap.id)
      .where('status', 'in', ['PENDING', 'ESCALATED'])
      .limit(20)
      .get();
    for (const c of convSnap.docs) {
      await c.ref.update({
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: 'RELEASE_TRACE_ABSENCES',
      });
    }

    const novSnap = await db
      .collection('novedades')
      .where('shiftId', '==', docSnap.id)
      .where('type', '==', 'AUSENCIA_AUTO')
      .limit(5)
      .get();
    for (const n of novSnap.docs) {
      await n.ref.update({ status: 'CANCELLED', resolved: true });
    }

    await releaseRetentionForAbsenceShift(db, docSnap.id, 'RELEASE_TRACE_ABSENCES');
  }

  return { rows };
}
