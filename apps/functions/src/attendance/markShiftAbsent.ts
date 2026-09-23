import { Timestamp, type Firestore } from 'firebase-admin/firestore';

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

  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    if (shift.absenceDetectedAt) return { applied: false, alreadyAbsent: true };
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
    });
  }

  return { applied: true };
}
