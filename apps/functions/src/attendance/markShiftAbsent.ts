import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isEventoShift } from '../eventos/eventoCoverage';
import { isExcluidoDeOperacion } from '../common/excluirDeOperacion';
import { isRetShift, isZeroDurationShift } from '../common/retShift';

export type ShiftAbsentReason =
  | 'AUTO_T30'
  | 'LLEGADA_TARDE_RECHAZADA'
  | 'LLEGADA_TARDE_TIMEOUT'
  | 'ETA_VENCIDA'
  | 'AVISO_MAYOR_60'
  | 'CONVOCADO_NO_LLEGO'
  | 'MANUAL_OPS'
  | 'FIX_SIN_REGISTRO';

export type MarkShiftAbsentOpts = {
  reason: ShiftAbsentReason;
  /** Quién dispara (SYSTEM_SCHEDULER, convocatoria, operador uid, etc.) */
  by?: string;
  /** Histórico ya cubierto: no novedad (push) y el trigger no retiene ni abre cascada. */
  skipCascadeSideEffects?: boolean;
};

function shiftEmpresaId(shift: Record<string, unknown>): string {
  return String(shift.empresaId || '').trim() || 'bacarsa';
}

function arDateStrFromStartMs(startMs: number): string {
  const arDate = new Date(startMs - 3 * 60 * 60 * 1000);
  return `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
}

function startMsOf(shift: Record<string, unknown>): number {
  return (shift.startTime as { toMillis?: () => number })?.toMillis?.() ?? 0;
}

function startDateStr(shift: Record<string, unknown>): string {
  const startMs = startMsOf(shift);
  return arDateStrFromStartMs(startMs || Date.now());
}

function startHorario(shift: Record<string, unknown>): string {
  const startMs = startMsOf(shift);
  return startMs ? buildHorario(shift, startMs) : '';
}

function buildHorario(shift: Record<string, unknown>, startMs: number): string {
  const st = (shift.startTime as { toDate?: () => Date })?.toDate?.() ?? new Date(startMs);
  const etMs = (shift.endTime as { toMillis?: () => number })?.toMillis?.() ?? 0;
  const et = etMs ? new Date(etMs) : null;
  const fmtT = (d: Date) =>
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Cordoba' });
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
  const operador = opts.reason === 'MANUAL_OPS' || opts.reason === 'FIX_SIN_REGISTRO';
  if (!operador && (isRetShift(shift) || isZeroDurationShift(shift))) {
    return { applied: false };
  }
  const objectiveId = String(shift.objectiveId || '').trim();
  if (objectiveId) {
    const obj = await db.collection('objetivos').doc(objectiveId).get();
    if (obj.exists && isExcluidoDeOperacion(obj.data())) return { applied: false };
  }

  if (shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT') {
    if (shift.absenceDetectedAt) {
      const tipo = String(shift.absenceType || '').trim().toUpperCase();
      if (!tipo || tipo === 'AA' || tipo === 'MANUAL_OPS') {
        await asegurarDocAusencia(db, sid, shift, {
          now: Timestamp.now(),
          dateStr: startDateStr(shift),
          horario: startHorario(shift),
          origin: String(shift.absenceDetectedBy || 'AA'),
          actorBy: opts.by || 'SYSTEM',
        });
      }
      if (isEventoShift(shift) && shift.esEventual === true && !shift.eventualNoSePresentoAt) {
        await aplicarNoSePresento(db, sid, opts.by || 'SYSTEM');
      }
      return { applied: false, alreadyAbsent: true };
    }
  }
  // Un guardia que ya fichó no queda ausente por un proceso automático; solo el operador puede decidirlo.
  if ((shift.isPresent === true || shift.isCompleted === true) && !operador) {
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
    ...(opts.skipCascadeSideEffects ? { absenceCascadeSkip: true } : {}),
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

  await asegurarDocAusencia(db, sid, shift, {
    now,
    dateStr,
    horario,
    origin: reason,
    actorBy,
    eventFields,
  });

  const novSnap = await db
    .collection('novedades')
    .where('shiftId', '==', sid)
    .where('type', '==', 'AUSENCIA_AUTO')
    .limit(1)
    .get();
  if (!opts.skipCascadeSideEffects && novSnap.empty) {
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

async function asegurarDocAusencia(
  db: Firestore,
  sid: string,
  shift: Record<string, unknown>,
  extra: {
    now: Timestamp;
    dateStr: string;
    horario: string;
    origin: string;
    actorBy: string;
    eventFields?: Record<string, unknown>;
  },
): Promise<void> {
  const ausSnap = await db.collection('ausencias').where('shiftId', '==', sid).limit(1).get();
  if (!ausSnap.empty) return;
  const eventGap = isEventoShift(shift);
  const eventFields = extra.eventFields || (eventGap
    ? {
      eventoId: shift.eventoId || null,
      eventoNombre: shift.eventoNombre || null,
      servicioId: shift.servicioId || null,
      servicioNombre: shift.servicioNombre || null,
      eventGap: true,
    }
    : {});
  await db.collection('ausencias').add({
    employeeId: shift.employeeId || null,
    employeeName: shift.employeeName || '',
    startDate: extra.dateStr,
    endDate: extra.dateStr,
    type: 'No Presentacion',
    absenceType: 'AA',
    origin: extra.origin,
    shiftId: sid,
    objectiveId: shift.objectiveId || null,
    objectiveName: shift.objectiveName || '',
    clientId: shift.clientId || null,
    empresaId: shiftEmpresaId(shift),
    positionName: shift.positionName || '',
    shiftCode: String(shift.code || '').toUpperCase() || null,
    reason: `No presentacion al turno ${extra.horario} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
    status: 'Confirmada',
    hasCertificate: false,
    createdAt: extra.now,
    source: extra.actorBy,
    ...eventFields,
  });
}

/** Cobertura de un guardia nombrado (no vacante ni ops_cov). */
export function coberturaEsPorAusencia(titular: Record<string, unknown> | null | undefined): boolean {
  if (!titular) return false;
  const emp = String(titular.employeeId || '').trim();
  if (!emp || emp === 'VACANTE') return false;
  const origin = String(titular.origin || '').toUpperCase();
  if (origin === 'OPERATIONS_COVERAGE' || origin === 'SLA_VIRTUAL' || origin === 'RETEN') return false;
  const absent = titular.isAbsent === true || String(titular.status || '').toUpperCase() === 'ABSENT';
  if (!absent && titular.isUnassigned === true) return false;
  if (!absent && titular.isPresent === true) return false;
  return true;
}

/** Hay ausencia de RRHH: `absenceType` en el turno o un doc de `ausencias` con este shiftId. */
export async function ausenciaYaRegistrada(
  db: Firestore,
  shiftId: string,
  titular: Record<string, unknown>,
): Promise<boolean> {
  if (String(titular.absenceType || '').trim()) return true;
  const sid = String(shiftId || '').trim();
  if (!sid) return false;
  const aus = await db.collection('ausencias').where('shiftId', '==', sid).limit(1).get();
  return !aus.empty;
}

async function aplicarNoSePresento(db: Firestore, shiftId: string, actorUid: string): Promise<void> {
  try {
    const { aplicarEventualNoSePresento } = await import('../eventuales/eventualNoSePresento');
    await aplicarEventualNoSePresento(db, { shiftId, aviso: false, actorUid });
  } catch (err) {
    console.warn('[markShiftAbsent] eventual no se presentó:', (err as Error)?.message);
  }
}
