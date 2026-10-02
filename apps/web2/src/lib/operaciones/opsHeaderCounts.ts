import { isOperationalOriginShift } from '@cosp/ops-core';

function arYearMonthOf(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(d);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  };
}

function publishKey(objectiveId: unknown, year: number, month: number): string {
  return `${String(objectiveId ?? '').trim()}_${year}_${month}`;
}

/**
 * Contadores del CC: el mes del turno (publicado al arrancar), no el mes de ahora.
 * Un N 23–07 que sigue en servicio el 01/10 cuenta aunque octubre no esté publicado.
 */
export function shiftCountsInOpsHeader(s: any, publishStatusMap: Record<string, boolean>): boolean {
  // Mismo universo que el monitor: operativo (EVENTO, cobertura, RETEN) siempre;
  // REF/ESC/TURA planificados cuando el mes del turno está publicado.
  if (isOperationalOriginShift(s) || s?.isVirtual === true) return true;
  const d = s?.shiftDateObj instanceof Date ? s.shiftDateObj : null;
  if (d) {
    const { year, month } = arYearMonthOf(d);
    if (publishStatusMap[publishKey(s.objectiveId, year, month)]) return true;
  }
  return false;
}

/** Arrancó en un mes publicado y termina en uno que no: fin de servicio, no retención. */
export function isFinServicioSinCronograma(s: any, publishStatusMap: Record<string, boolean>): boolean {
  const start = s?.shiftDateObj instanceof Date ? s.shiftDateObj : null;
  const end = s?.endDateObj instanceof Date ? s.endDateObj : null;
  if (!start || !end) return false;
  const a = arYearMonthOf(start);
  const b = arYearMonthOf(end);
  if (a.year === b.year && a.month === b.month) return false;
  return !!publishStatusMap[publishKey(s.objectiveId, a.year, a.month)]
    && !publishStatusMap[publishKey(s.objectiveId, b.year, b.month)];
}
