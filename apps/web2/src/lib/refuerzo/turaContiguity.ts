import { hoursFromShiftClock } from './refuerzoDisplay';

const DEFAULT_GAP_THRESHOLD_MIN = 15;

export type ShiftClockLike = {
  startTime?: unknown;
  endTime?: unknown;
  hours?: unknown;
  fecha?: string;
};

function instantFromClock(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    const d = (val as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = (val as { seconds?: number; _seconds?: number }).seconds
    ?? (val as { _seconds?: number })._seconds;
  if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
  if (typeof val === 'string') {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseHmToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Resuelve fin/inicio efectivo de un turno (ISO, Timestamp o HH:mm + fecha). */
export function resolveShiftEndInstant(shift: ShiftClockLike | null | undefined): Date | null {
  if (!shift) return null;
  const direct = instantFromClock(shift.endTime);
  if (direct) return direct;
  const endMin = parseHmToMinutes(shift.endTime);
  const start = instantFromClock(shift.startTime);
  const fecha = String(shift.fecha || '').slice(0, 10);
  if (endMin != null && fecha) {
    const [y, mo, d] = fecha.split('-').map(Number);
    return new Date(y, (mo || 1) - 1, d || 1, Math.floor(endMin / 60), endMin % 60, 0, 0);
  }
  if (endMin != null && start) {
    const out = new Date(start);
    out.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
    if (out <= start) out.setDate(out.getDate() + 1);
    return out;
  }
  return null;
}

export function resolveShiftStartInstant(shift: ShiftClockLike | null | undefined): Date | null {
  if (!shift) return null;
  const direct = instantFromClock(shift.startTime);
  if (direct) return direct;
  const startMin = parseHmToMinutes(shift.startTime);
  const fecha = String(shift.fecha || '').slice(0, 10);
  if (startMin != null && fecha) {
    const [y, mo, d] = fecha.split('-').map(Number);
    return new Date(y, (mo || 1) - 1, d || 1, Math.floor(startMin / 60), startMin % 60, 0, 0);
  }
  return null;
}

/** Minutos entre fin del turno base e inicio del TURA. Negativo = solapamiento. */
export function gapMinutesBetweenParentAndTura(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
): number | null {
  const parentEnd = resolveShiftEndInstant(parent);
  const turaStart = resolveShiftStartInstant(tura);
  if (!parentEnd || !turaStart) return null;
  return (turaStart.getTime() - parentEnd.getTime()) / 60000;
}

/** Seguido si gap ≤ umbral (default 15 min). */
export function isTuraContiguousToParent(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
  thresholdMin: number = DEFAULT_GAP_THRESHOLD_MIN,
): boolean {
  const gap = gapMinutesBetweenParentAndTura(parent, tura);
  if (gap === null) return false;
  return gap <= thresholdMin;
}

export function formatShiftClockRange(shift: ShiftClockLike | null | undefined): string {
  if (!shift) return '';
  const fmt = (d: Date | null) => {
    if (!d) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const start = resolveShiftStartInstant(shift);
  const end = resolveShiftEndInstant(shift);
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a}–${b}`;
  return a || b || '';
}

export function combinedContiguousRangeLabel(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
): string {
  const start = resolveShiftStartInstant(parent);
  const end = resolveShiftEndInstant(tura);
  const fmt = (d: Date | null) => {
    if (!d) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a}–${b}`;
  return a || b || '';
}

export function turaBillableHours(tura: ShiftClockLike | null | undefined): number {
  return hoursFromShiftClock(tura || {});
}

export type ShiftRowLike = ShiftClockLike & {
  id?: string;
  parentShiftId?: string;
  parentEmpleadoId?: string;
  employeeId?: string;
  objectiveId?: string;
  code?: string;
  type?: string;
  solicitudRefuerzoId?: string;
  isTuraCutSegment?: boolean;
  turaContiguous?: boolean;
};

/** Busca el turno base de un TURA por id directo o por parentEmpleadoId + proximidad horaria. */
export function findParentShiftForTura(
  tura: ShiftRowLike | null | undefined,
  allShifts: ShiftRowLike[],
): ShiftRowLike | null {
  if (!tura) return null;
  const parentId = String(tura.parentShiftId || '').trim();
  if (parentId) {
    const direct = allShifts.find((s) => s.id === parentId);
    if (direct) return direct;
  }
  const peid = String(tura.parentEmpleadoId || '').trim();
  if (!peid) return null;
  const turaStart = resolveShiftStartInstant(tura);
  if (!turaStart) return null;

  let best: ShiftRowLike | null = null;
  let bestGap = Infinity;
  for (const s of allShifts) {
    if (s.id === tura.id) continue;
    const code = String(s.code || s.type || '').toUpperCase();
    if (code === 'TURA' || code === 'RFZ') continue;
    if (String(s.employeeId || '') !== peid) continue;
    if (tura.objectiveId && s.objectiveId && s.objectiveId !== tura.objectiveId) continue;
    const parentEnd = resolveShiftEndInstant(s);
    if (!parentEnd) continue;
    const gap = (turaStart.getTime() - parentEnd.getTime()) / 60000;
    if (gap < -60 || gap > 24 * 60) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}

/** Turno operativo a enfocar al atender una novedad TURA-extensión (padre mergeado o 2º tramo cortado). */
export function resolveTuraExtensionOperacionesTarget(
  novedad: {
    parentShiftId?: string | null;
    parentEmpleadoId?: string | null;
    objectiveId?: string | null;
    solicitudRefuerzoId?: string | null;
    turnoIds?: string[] | null;
    tipoSolicitud?: string | null;
  },
  processedData: ShiftRowLike[],
): ShiftRowLike | null {
  const isTura = String(novedad.tipoSolicitud || '').toUpperCase() === 'TURA'
    || String(novedad.type || '').toUpperCase() === 'TURA_EXTENSION';
  if (!isTura && !novedad.parentEmpleadoId) return null;

  const parentId = String(novedad.parentShiftId || '').trim();
  if (parentId) {
    const parent = processedData.find((s) => s.id === parentId);
    if (parent) return parent;
  }

  const peid = String(novedad.parentEmpleadoId || '').trim();
  if (peid && novedad.objectiveId) {
    const mergedParent = processedData.find(
      (s) => s.employeeId === peid
        && s.objectiveId === novedad.objectiveId
        && s.turaContiguous,
    );
    if (mergedParent) return mergedParent;

    const turnoIds = Array.isArray(novedad.turnoIds) ? novedad.turnoIds : [];
    const cut = processedData.find(
      (s) => s.isTuraCutSegment
        && (String(s.parentEmpleadoId || s.employeeId || '') === peid)
        && s.objectiveId === novedad.objectiveId
        && (turnoIds.includes(String(s.id || ''))
          || (novedad.solicitudRefuerzoId && s.solicitudRefuerzoId === novedad.solicitudRefuerzoId)),
    );
    if (cut) return cut;
  }

  const turnoIds = Array.isArray(novedad.turnoIds) ? novedad.turnoIds : [];
  if (turnoIds.length) {
    return processedData.find((s) => turnoIds.includes(String(s.id || ''))) ?? null;
  }
  return null;
}
