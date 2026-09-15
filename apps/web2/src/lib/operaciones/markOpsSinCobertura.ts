/**
 * Cierra un hueco operativo como "sin cobertura" (no inventa otro doc paralelo).
 * Actualiza la vacante real y/o las VACANTE_POR_AUSENCIA ligadas al titular.
 */
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const isVirtualId = (id: unknown) => {
  const s = String(id || '');
  return !s || s.startsWith('V124_') || s.startsWith('SLA_GAP') || s.startsWith('autosinc_');
};

const isVacancyLike = (s: any): boolean => {
  if (!s) return false;
  const origin = String(s.origin || '').toUpperCase();
  return (
    s.isUnassigned === true
    || s.employeeId === 'VACANTE'
    || String(s.employeeName || '').toUpperCase().startsWith('VACANTE')
    || origin.startsWith('VACANTE_')
    || origin === 'INTERRUPTION'
  );
};

export async function markOpsSinCobertura(opts: {
  absenceShift: any;
  empresaId: string;
  notes?: string;
  stamp: (payload: Record<string, unknown>, empresaId: string) => Record<string, unknown>;
}): Promise<{ updatedShiftIds: string[] }> {
  const { absenceShift, empresaId, notes, stamp } = opts;
  const tid = String(absenceShift?.empresaId || empresaId || '').trim();
  if (!tid || !absenceShift) throw new Error('empresaId / turno requerido');

  const updatedShiftIds: string[] = [];
  const batch = writeBatch(db);

  const patchSinCobertura = {
    status: 'SIN_COBERTURA',
    isSinCobertura: true,
    isUnassigned: true,
    employeeId: 'VACANTE',
    employeeName: 'SIN COBERTURA',
    resolvedBy: 'OPERACIONES',
    sinCoberturaAt: serverTimestamp(),
    sinCoberturaNotes: notes || null,
  };

  const idsToClose = new Set<string>();

  if (absenceShift.id && !isVirtualId(absenceShift.id) && isVacancyLike(absenceShift)) {
    idsToClose.add(String(absenceShift.id));
  }

  // Vacantes ligadas al titular (o a esta vacante si ya es el hueco)
  const anchorIds = [
    absenceShift.id,
    absenceShift.causedByShiftId,
  ].filter((id) => id && !isVirtualId(id)).map(String);

  for (const anchorId of [...new Set(anchorIds)]) {
    const snap = await getDocs(
      query(
        collection(db, 'turnos'),
        where('causedByShiftId', '==', anchorId),
        where('origin', '==', 'VACANTE_POR_AUSENCIA'),
      ),
    );
    for (const d of snap.docs) {
      const st = String(d.data().status || '').toUpperCase();
      if (st === 'COVERED' || st === 'SIN_COBERTURA') continue;
      if (d.data().coverageEventId) continue;
      idsToClose.add(d.id);
    }
  }

  // También INTERRUPTION / VACANTE_CORRECCION del mismo causedBy
  if (absenceShift.id && !isVirtualId(absenceShift.id) && !isVacancyLike(absenceShift)) {
    // titular ausente: no convertimos su turno en SIN_COBERTURA (sigue siendo el ausente)
  } else if (absenceShift.id && !isVirtualId(absenceShift.id)) {
    idsToClose.add(String(absenceShift.id));
  }

  for (const id of idsToClose) {
    batch.update(doc(db, 'turnos', id), patchSinCobertura);
    updatedShiftIds.push(id);
  }

  await batch.commit();

  await addDoc(
    collection(db, 'novedades'),
    stamp(
      {
        type: 'SIN_COBERTURA',
        title: 'Puesto sin cobertura',
        status: 'pending',
        objectiveId: absenceShift.objectiveId || null,
        objectiveName: absenceShift.objectiveName || '',
        positionName: absenceShift.positionName || '',
        employeeId: absenceShift.employeeId || null,
        employeeName: absenceShift.employeeName || null,
        clientId: absenceShift.clientId || null,
        shiftId: absenceShift.id || null,
        closedShiftIds: updatedShiftIds,
        description:
          notes
          || `Protocolo — ${absenceShift.positionName || 'puesto'} en ${absenceShift.objectiveName || 'objetivo'} queda sin cobertura.`,
        createdAt: serverTimestamp(),
        reportedBy: 'OPERACIONES',
      },
      tid,
    ),
  );

  if (updatedShiftIds.length === 0 && !isVirtualId(absenceShift.id) && isVacancyLike(absenceShift)) {
    // Virtual: crear doc real cerrado para que no se regenere el hueco
    await addDoc(
      collection(db, 'turnos'),
      stamp(
        {
          ...patchSinCobertura,
          origin: 'SIN_COBERTURA',
          objectiveId: absenceShift.objectiveId || null,
          objectiveName: absenceShift.objectiveName || '',
          positionName: absenceShift.positionName || 'General',
          clientId: absenceShift.clientId || null,
          startTime: absenceShift.startTime || null,
          endTime: absenceShift.endTime || null,
          scheduleDate: absenceShift.scheduleDate || null,
          causedByShiftId: absenceShift.causedByShiftId || null,
          createdAt: serverTimestamp(),
        },
        tid,
      ),
    );
  }

  return { updatedShiftIds };
}
