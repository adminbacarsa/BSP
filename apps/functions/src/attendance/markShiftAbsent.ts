import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isEventoShift } from '../eventos/eventoCoverage';
import { isExcluidoDeOperacion } from '../common/excluirDeOperacion';

export type ShiftAbsentReason =
  | 'AUTO_T30'
  | 'LLEGADA_TARDE_RECHAZADA'
  | 'LLEGADA_TARDE_TIMEOUT'
  | 'ETA_VENCIDA'
  | 'AVISO_MAYOR_60'
  | 'CONVOCADO_NO_LLEGO'
  | 'MANUAL_OPS';

export type MarkShiftAbsentOpts = {
  reason: ShiftAbsentReason;
  /** Quién dispara (SYSTEM_SCHEDULER, convocatoria, operador uid, etc.) */
  by?: string;
  skipCascadeSideEffects?: boolean;
};

function shiftEmpresaId(shift: Record<string, unknown>): string {
  return String(shift.empresaId || '').trim() || 'bacarsa';
}

function arDateStrFromStartMs(startMs: number): string {
  const arDate = new Date(startMs - 3 * 60 * 60 * 1000);
  return `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
}

function buildHorario(shift: Record<string, unknown>, startMs: number): string {
  const st = (shift.startTime as { toDate?: () => Date })?.toDate?.() ?? new Date(startMs);
  const etMs = (shift.endTime as { toMillis?: () => number })?.toMillis?.() ?? 0;
  const et = etMs ? new Date(etMs) : null;
  const fmtT = (d: Date) =>
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
  return et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st);
}

/**
 * Marca ausencia AA idempotente por shiftId: turno + RRHH + una novedad AUSENCIA_AUTO.
 * Dispara onTurnoAbsenciaDetectada vía isAbsent → true.
 */
export async function markShiftAbsent(
  db: Firestore,
  shiftId: string,
  opts: MarkShiftAbsentOpts,
): Promise<{ applied: boolean; alreadyAbsent?: boolean }> {
  const sid = String(shiftId || '').trim();
  if (!sid) return { applied: false };

  const ref = db.collection('turnos').doc(sid);
  const snap = await ref.get();
  if (!snap.exists) return { applied: false };
  const shift = snap.data() as Record<string, unknown>;
  if (isExcluidoDeOperacion(shift)) return { applied: false };
  const objectiveId = String(shift.objectiveId || '').trim();
  if (objectiveId) {
    const obj = await db.collection('objetivos').doc(objectiveId).get();
    if (obj.exists && isExcluidoDeOperacion(obj.data())) return { applied: false };
  }

  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    if (shift.absenceDetectedAt) {
      if (isEventoShift(shift) && shift.esEventual === true && !shift.eventualNoSePresentoAt) {
        await aplicarNoSePresento(db, sid, opts.by || 'SYSTEM');
      }
      return { applied: false, alreadyAbsent: true };
    }
  }
  // Un guardia que ya fichó no queda ausente por un proceso automático; solo el operador puede decidirlo.
  if ((shift.isPresent === true || shift.isCompleted === true) && opts.reason !== 'MANUAL_OPS') {
    return { applied: false };
  }

  const now = Timestamp.now();
  const startMs = (shift.startTime as { toMillis?: () => number })?.toMillis?.() ?? 0;
  const dateStr = startMs ? arDateStrFromStartMs(startMs) : arDateStrFromStartMs(Date.now());
  const horario = startMs ? buildHorario(shift, startMs) : '';
  const reason = opts.reason;
  const detectedBy = reason;
  const actorBy = opts.by || 'SYSTEM';

  await ref.update({
    status: 'ABSENT',
    isAbsent: true,
    absenceType: 'AA',
    absenceDetectedAt: shift.absenceDetectedAt || now,
    absenceDetectedBy: reason,
  });

  const eventGap = isEventoShift(shift);
  const eventFields = eventGap
    ? {
      eventoId: shift.eventoId || null,
      eventoNombre: shift.eventoNombre || null,
      servicioId: shift.servicioId || null,
      servicioNombre: shift.servicioNombre || null,
      eventGap: true,
    }
    : {};

  const ausSnap = await db.collection('ausencias').where('shiftId', '==', sid).limit(1).get();
  if (ausSnap.empty) {
    await db.collection('ausencias').add({
      employeeId: shift.employeeId || null,
      employeeName: shift.employeeName || '',
      startDate: dateStr,
      endDate: dateStr,
      type: 'No Presentacion',
      absenceType: 'AA',
      origin: reason,
      shiftId: sid,
      objectiveId: shift.objectiveId || null,
      objectiveName: shift.objectiveName || '',
      clientId: shift.clientId || null,
      empresaId: shiftEmpresaId(shift),
      positionName: shift.positionName || '',
      shiftCode: String(shift.code || '').toUpperCase() || null,
      reason: `No presentacion al turno ${horario} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
      status: 'Confirmada',
      hasCertificate: false,
      createdAt: now,
      source: actorBy,
      ...eventFields,
    });
  }

  const novSnap = await db
    .collection('novedades')
    .where('shiftId', '==', sid)
    .where('type', '==', 'AUSENCIA_AUTO')
    .limit(1)
    .get();
  if (novSnap.empty) {
    const elapsedMin =
      startMs > 0 ? Math.round((now.toMillis() - startMs) / 60000) : 0;
    await db.collection('novedades').add({
      type: 'AUSENCIA_AUTO',
      status: 'PENDIENTE',
      shiftId: sid,
      employeeId: shift.employeeId || null,
      employeeName: shift.employeeName || '',
      objectiveId: shift.objectiveId || null,
      objectiveName: shift.objectiveName || '',
      clientId: shift.clientId || null,
      empresaId: shiftEmpresaId(shift),
      positionName: shift.positionName || '',
      shiftCode: String(shift.code || '').toUpperCase() || null,
      description: `${shift.employeeName || 'Empleado'} no se presentó — ${String(shift.code || '').toUpperCase() || '—'} ${horario} · ${shift.positionName || 'Puesto'} · ${shift.objectiveName || ''}${elapsedMin ? ` (T+${elapsedMin} min).` : '.'}`,
      createdAt: now,
      source: actorBy,
      absenceReason: reason,
      ...eventFields,
    });
  }

  if (eventGap && shift.esEventual === true) {
    await aplicarNoSePresento(db, sid, actorBy);
  }

  return { applied: true };
}

async function aplicarNoSePresento(db: Firestore, shiftId: string, actorUid: string): Promise<void> {
  try {
    const { aplicarEventualNoSePresento } = await import('../eventuales/eventualNoSePresento');
    await aplicarEventualNoSePresento(db, { shiftId, aviso: false, actorUid });
  } catch (err) {
    console.warn('[markShiftAbsent] eventual no se presentó:', (err as Error)?.message);
  }
}
