/**
 * C3: revertir ausencia operativa — limpia titular, vacante sin cubrir,
 * doc en ausencias y novedad AUSENCIA_OPERATIVA.
 */
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { updateDocForEmpresa } from '@/lib/multiempresa';

export type RevertOpsAbsenceResult = {
  cancelledVacancies: number;
  cancelledAbsences: number;
  cancelledNovedades: number;
};

const OPS_ABSENCE_ORIGINS = new Set([
  'OPERACIONES',
  'AUTO_T30',
  'INTERRUPTION',
  'SYSTEM_SCHEDULER',
  '',
]);

function vacancyAlreadyCovered(data: Record<string, unknown>): boolean {
  if (String(data.status || '').toUpperCase() === 'COVERED') return true;
  if (data.coveredByEmployeeId || data.coveredByEmployeeName) return true;
  if (data.coverageEventId) return true;
  if (data.operacionallyCovered === true) return true;
  return false;
}

export async function revertOpsAbsence(opts: {
  shiftId: string;
  empresaId: string;
  migracionCompleta: boolean;
}): Promise<RevertOpsAbsenceResult> {
  const { shiftId, empresaId, migracionCompleta } = opts;

  const [vacSnap, ausSnap, novSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'turnos'),
        where('causedByShiftId', '==', shiftId),
        where('origin', '==', 'VACANTE_POR_AUSENCIA'),
      ),
    ),
    getDocs(query(collection(db, 'ausencias'), where('shiftId', '==', shiftId))),
    getDocs(
      query(
        collection(db, 'novedades'),
        where('shiftId', '==', shiftId),
        where('type', '==', 'AUSENCIA_OPERATIVA'),
      ),
    ),
  ]);

  const batch = writeBatch(db);
  let cancelledVacancies = 0;
  let cancelledAbsences = 0;
  let cancelledNovedades = 0;

  for (const d of vacSnap.docs) {
    const v = d.data() as Record<string, unknown>;
    if (vacancyAlreadyCovered(v)) continue;
    batch.update(d.ref, {
      status: 'CANCELLED',
      isUnassigned: false,
      cancelledReason: 'ABSENCE_REVERTED',
      cancelledAt: serverTimestamp(),
    });
    cancelledVacancies += 1;
  }

  for (const d of ausSnap.docs) {
    const a = d.data() as Record<string, unknown>;
    const origin = String(a.origin || '');
    if (!OPS_ABSENCE_ORIGINS.has(origin)) continue;
    const st = String(a.status || '').toUpperCase();
    if (st === 'CANCELADA' || st === 'CANCELLED' || st === 'INACTIVE') continue;
    batch.update(d.ref, {
      status: 'CANCELADA',
      cancelledAt: serverTimestamp(),
      cancelledReason: 'ABSENCE_REVERTED',
    });
    cancelledAbsences += 1;
  }

  for (const d of novSnap.docs) {
    const n = d.data() as Record<string, unknown>;
    const st = String(n.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'atendida' || n.resolved === true) continue;
    batch.update(d.ref, {
      status: 'cancelled',
      resolved: true,
      resolvedAt: serverTimestamp(),
      resolvedBy: 'OPERACIONES_REVERT',
    });
    cancelledNovedades += 1;
  }

  await batch.commit();

  await updateDocForEmpresa(
    'turnos',
    shiftId,
    {
      isAbsent: false,
      absenceType: null,
      absenceDetectedAt: null,
      absenceDetectedBy: null,
      absenceConfirmedBy: null,
      absenceConfirmedAt: null,
      absenceId: null,
      vacancyCreatedForAbsence: false,
      status: 'PENDING',
      absenceRevertedAt: serverTimestamp(),
      absenceRevertedBy: 'OPERACIONES',
    },
    empresaId,
    migracionCompleta,
  );

  return { cancelledVacancies, cancelledAbsences, cancelledNovedades };
}

/** Crea doc ausencias y devuelve el id (para anclar absenceId en el turno). */
export async function createOpsAbsenceDoc(opts: {
  shift: {
    id: string;
    employeeId?: string;
    employeeName?: string;
    clientId?: string | null;
    objectiveId?: string | null;
    objectiveName?: string;
    positionName?: string;
    empresaId?: string;
  };
  empresaId: string;
  stamp: (payload: Record<string, unknown>, empresaId: string) => Record<string, unknown>;
  dayStart: Date;
  dayEnd: Date;
  reasonExtra?: string;
}): Promise<string> {
  const { shift, empresaId, stamp, dayStart, dayEnd, reasonExtra } = opts;
  const ref = await addDoc(
    collection(db, 'ausencias'),
    stamp(
      {
        employeeId: shift.employeeId,
        employeeName: shift.employeeName,
        clientId: shift.clientId || null,
        objectiveId: shift.objectiveId || null,
        type: 'NO_PRESENTACION',
        startDate: Timestamp.fromDate(dayStart),
        endDate: Timestamp.fromDate(dayEnd),
        status: 'Pendiente',
        reason:
          reasonExtra
          || `No presentación en turno — ${shift.objectiveName || ''} (${shift.positionName || ''})`,
        hasCertificate: false,
        createdAt: serverTimestamp(),
        origin: 'OPERACIONES',
        shiftId: shift.id,
      },
      String(shift.empresaId || empresaId || '').trim(),
    ),
  );
  return ref.id;
}
