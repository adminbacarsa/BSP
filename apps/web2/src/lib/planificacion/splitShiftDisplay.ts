import type { PlanningPositionShiftRow } from '@/lib/planningPositionDays';

export type SplitBlockTimes = { startTime: unknown; endTime: unknown };

export function slaBlocksForPositionShift(
  positionStructure: Array<{ positionName?: string; shifts?: PlanningPositionShiftRow[] }>,
  positionName: string | null | undefined,
  code: string | null | undefined,
): Array<{ startTime: string; endTime: string }> | null {
  if (!positionName || !code) return null;
  const pos = positionStructure.find((p) => p.positionName === positionName);
  const shift = pos?.shifts?.find((s) => String(s.code).toUpperCase() === String(code).toUpperCase());
  const blocks = shift?.blocks;
  if (!Array.isArray(blocks) || blocks.length < 2) return null;
  return blocks;
}

export function resolveCellSecondBlock(
  cellKey: string,
  pendingChanges: Record<string, unknown>,
  secondBlockMap: Record<string, SplitBlockTimes>,
  positionName: string | null | undefined,
  code: string | null | undefined,
  positionStructure: Array<{ positionName?: string; shifts?: PlanningPositionShiftRow[] }>,
): SplitBlockTimes | null {
  const pending = pendingChanges[`${cellKey}_B2`] as Record<string, unknown> | undefined;
  if (pending && !pending.isDeleted && pending.startTime != null && pending.endTime != null) {
    return { startTime: pending.startTime, endTime: pending.endTime };
  }
  const fromFirestore = secondBlockMap[cellKey];
  if (fromFirestore?.startTime != null && fromFirestore?.endTime != null) return fromFirestore;
  const slaBlocks = slaBlocksForPositionShift(positionStructure, positionName, code);
  if (slaBlocks?.[1]) {
    return { startTime: slaBlocks[1].startTime, endTime: slaBlocks[1].endTime };
  }
  return null;
}

/**
 * Código del segundo turno del día (`isSecondBlock` / clave `_B2`), para pintar `+EM2` en la celda.
 * No usa bloques SLA del mismo puesto: solo docs/pending con segundo bloque real.
 */
export function codigoSegundoBloqueCelda(
  cellKey: string,
  pendingChanges: Record<string, { isDeleted?: boolean; code?: string } | undefined>,
  cellTurnosMap: Record<string, Array<{ isDeleted?: boolean; isSecondBlock?: boolean; code?: string }> | undefined>,
): string | null {
  const pend = pendingChanges[`${cellKey}_B2`];
  if (pend?.isDeleted === true) return null;
  if (pend) {
    const fromPend = String(pend.code || '').toUpperCase().trim();
    if (fromPend) return fromPend;
  }
  const b2 = (cellTurnosMap[cellKey] || []).find(
    (d) => d && d.isDeleted !== true && d.isSecondBlock === true,
  );
  if (!b2) return null;
  const fromDoc = String(b2.code || '').toUpperCase().trim();
  return fromDoc || null;
}

export function formatSplitScheduleLabel(
  primaryStart: string | null | undefined,
  primaryEnd: string | null | undefined,
  secondBlock: SplitBlockTimes | null,
  formatTime: (t: unknown) => string,
  fallbackCode?: string,
  bandSchedule?: Record<string, string>,
): string | null {
  const pStart = primaryStart ? formatTime(primaryStart) : null;
  const pEnd = primaryEnd ? formatTime(primaryEnd) : null;
  const primary =
    pStart && pEnd
      ? `${pStart}–${pEnd}`
      : fallbackCode && bandSchedule?.[fallbackCode]
        ? bandSchedule[fallbackCode]
        : null;
  if (!secondBlock?.startTime || !secondBlock?.endTime) return primary;
  const b2Start = formatTime(secondBlock.startTime);
  const b2End = formatTime(secondBlock.endTime);
  if (!primary) return `${b2Start}–${b2End}`;
  return `${primary} + ${b2Start}–${b2End}`;
}
