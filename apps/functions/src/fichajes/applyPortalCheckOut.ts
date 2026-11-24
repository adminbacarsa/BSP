import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { seriesHandoffKind } from '../common/shiftSeries';
import { closeTimeMs, computeShiftCloseTimes } from '../scheduling/shiftCloseCore';

/** Ventana en la que un turno se considera relevo del saliente (misma regla que el cierre automático). */
const RELEVO_ANTES_MS = 30 * 60 * 1000;
const RELEVO_DESPUES_MS = 2 * 60 * 60 * 1000;

/** Códigos que nunca son un relevo del puesto. */
const CODIGOS_SIN_RELEVO = new Set([
  'RET',
  'ESC',
  'REF',
  'F',
  'FF',
  'FP',
  'V',
  'L',
  'E',
  'A',
  'PG',
  'ART',
  'AA',
]);

export type PortalCheckOutInput = {
  shiftId: string;
  empId: string;
  coords?: { lat?: number | null; lng?: number | null } | null;
};

export type PortalCheckOutResult = {
  closed: boolean;
  alreadyClosed?: boolean;
  /** Hay un relevo programado que todavía no está presente: se registró el aviso pero el turno sigue abierto. */
  waitingRelief?: boolean;
  realEndMs?: number;
};

export type EstadoRelevoSalida = { programado: boolean; presente: boolean };

/**
 * Relevo del saliente: solo puesto 24 h (M→T→N o D12↔N12), mismo puesto, otra persona,
 * que empieza cerca del fin. C0, C1 y cualquier código que no sea esa serie no relevan.
 * «Programado» incluye al ausente o al que todavía no llegó; «presente» es el que ya fichó.
 */
export function evaluarRelevoSalida(
  saliente: Record<string, unknown>,
  salienteId: string,
  empId: string,
  candidatos: Array<{ id: string; data: Record<string, unknown> }>,
): EstadoRelevoSalida {
  const estado: EstadoRelevoSalida = { programado: false, presente: false };
  const puesto = String(saliente.positionName || '').trim();
  for (const { id, data } of candidatos) {
    if (id === salienteId) continue;
    if (puesto && data.positionName && String(data.positionName).trim() !== puesto) continue;
    if (seriesHandoffKind(saliente.code, data.code) !== 'SERIES') continue;
    const eid = String(data.employeeId || '').trim();
    if (!eid || eid === 'VACANTE' || eid === empId || data.isUnassigned === true) continue;
    if (data.draft === true) continue;
    if (CODIGOS_SIN_RELEVO.has(String(data.code || '').trim().toUpperCase())) continue;
    const st = String(data.status || '').toUpperCase();
    if (st === 'CANCELED' || st === 'CANCELLED' || st === 'COMPLETED') continue;
    if (data.isCompleted === true) continue;
    estado.programado = true;
    if (data.isPresent === true || st === 'PRESENT') estado.presente = true;
  }
  return estado;
}

function horaArgentina(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Salida marcada por el guardia desde la app, una vez finalizado su turno (GPS validado en el cliente,
 * igual que el ingreso). Siempre deja registrado el aviso con la ubicación. Cierra el turno a la hora
 * de la marca si no hay relevo programado o el relevo ya está presente; si hay relevo programado que
 * todavía no llegó, el turno sigue abierto (el operador lo ve como «avisó salida»).
 */
export async function processPortalCheckOut(
  db: Firestore,
  input: PortalCheckOutInput,
): Promise<PortalCheckOutResult> {
  const shiftId = String(input.shiftId || '').trim();
  const empId = String(input.empId || '').trim();
  if (!shiftId || !empId) throw new Error('SHIFT_REQUIRED');

  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TURNO_NOT_FOUND');
  const shift = snap.data() as Record<string, unknown>;

  if (String(shift.employeeId || '').trim() !== empId) throw new Error('NOT_OWNER');
  if (shift.isCompleted === true || shift.realEndTime) return { closed: true, alreadyClosed: true };
  const presente = shift.isPresent === true || String(shift.status || '').toUpperCase() === 'PRESENT';
  if (!presente) throw new Error('NOT_PRESENT');
  if (Array.isArray(shift.blocks) && shift.blocks.length > 1) throw new Error('TURNO_CORTADO');

  const endMs = closeTimeMs(shift.endTime);
  if (!endMs) throw new Error('SIN_HORARIO');
  const nowMs = Date.now();
  if (nowMs < endMs) throw new Error('TOO_EARLY');

  const lat = Number(input.coords?.lat);
  const lng = Number(input.coords?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const marca: Record<string, unknown> = {
    salidaMarcadaAt: Timestamp.fromMillis(nowMs),
    salidaMarcadaSource: 'PORTAL_GPS',
    checkOutSource: 'PORTAL_GPS',
    checkOutCoords: coords,
    updatedAt: FieldValue.serverTimestamp(),
  };

  let relevo: EstadoRelevoSalida = { programado: false, presente: false };
  const objectiveId = String(shift.objectiveId || '').trim();
  if (objectiveId) {
    const q = await db
      .collection('turnos')
      .where('objectiveId', '==', objectiveId)
      .where('startTime', '>=', Timestamp.fromMillis(endMs - RELEVO_ANTES_MS))
      .where('startTime', '<=', Timestamp.fromMillis(endMs + RELEVO_DESPUES_MS))
      .get();
    relevo = evaluarRelevoSalida(
      shift,
      shiftId,
      empId,
      q.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })),
    );
  }

  if (relevo.programado && !relevo.presente) {
    await ref.update(marca);
    return { closed: false, waitingRelief: true };
  }

  const times = computeShiftCloseTimes(shift, nowMs);
  const realEnd = Timestamp.fromMillis(times.realEndMs);
  const now = Timestamp.fromMillis(nowMs);
  const patch: Record<string, unknown> = {
    ...marca,
    status: 'COMPLETED',
    isCompleted: true,
    isPresent: false,
    realEndTime: realEnd,
    checkOutTime: realEnd,
    completedAt: now,
    completedBy: 'PORTAL_GUARDIA',
    completionReason: 'SALIDA_PORTAL',
  };
  if (times.retentionEndedMs != null) {
    patch.isRetention = false;
    patch.retentionEndedAt = Timestamp.fromMillis(times.retentionEndedMs);
    if (times.retentionMinutes != null) patch.retentionMinutes = times.retentionMinutes;
  }
  await ref.update(patch);

  try {
    await db.collection('novedades').add({
      type: 'CHECKOUT',
      turnoId: shiftId,
      employeeName: String(shift.employeeName || ''),
      realTime: horaArgentina(times.realEndMs),
      source: 'PORTAL_GPS',
      empresaId: shift.empresaId ?? null,
      operatorId: 'PORTAL_GUARDIA',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[marcarSalidaPortal] novedad CHECKOUT', err);
  }

  return { closed: true, realEndMs: times.realEndMs };
}
