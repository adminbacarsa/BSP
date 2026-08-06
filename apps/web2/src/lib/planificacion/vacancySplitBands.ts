/**
 * Ext + adel en licencias: bandas y horarios según SLA del puesto (custom E1/E2/E3…),
 * no solo M/T/N CCT.
 */

const CCT_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

export type VacancyPositionSla = {
  positionName?: string;
  shifts?: Array<{
    code?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
    blocks?: Array<{ startTime: string; endTime: string }>;
  }>;
};

function normCode(code: unknown): string {
  return String(code || '').trim().toUpperCase();
}

function parseTimeToMinutes(raw: string | undefined | null): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHHmm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const mm = t % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function shiftTimeWindowFromSla(shift: NonNullable<VacancyPositionSla['shifts']>[number]): {
  from: string;
  to: string;
  startMin: number;
  endMin: number;
} {
  const blocks = shift.blocks;
  if (Array.isArray(blocks) && blocks.length > 0) {
    const startMin = parseTimeToMinutes(blocks[0].startTime) ?? 0;
    const endMin = parseTimeToMinutes(blocks[blocks.length - 1].endTime) ?? startMin + 8 * 60;
    return {
      from: blocks[0].startTime,
      to: blocks[blocks.length - 1].endTime,
      startMin,
      endMin: endMin <= startMin ? endMin + 24 * 60 : endMin,
    };
  }
  const startMin = parseTimeToMinutes(shift.startTime) ?? 7 * 60;
  let endMin = parseTimeToMinutes(shift.endTime);
  if (endMin == null) {
    const hrs = Number(shift.hours) > 0 ? Number(shift.hours) : 8;
    endMin = startMin + hrs * 60;
  }
  if (endMin <= startMin) endMin += 24 * 60;
  const from = shift.startTime && parseTimeToMinutes(shift.startTime) != null
    ? shift.startTime.slice(0, 5)
    : minutesToHHmm(startMin);
  const to = shift.endTime && parseTimeToMinutes(shift.endTime) != null
    ? shift.endTime.slice(0, 5)
    : minutesToHHmm(endMin);
  return { from, to, startMin, endMin };
}

export function orderedWorkShiftsForPosition(
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
): Array<NonNullable<VacancyPositionSla['shifts']>[number] & { code: string }> {
  if (!positionName || !positionStructure?.length) return [];
  const pos = positionStructure.find((p) => p.positionName === positionName);
  const working = (pos?.shifts || []).filter((s) => !FRANCO_CODES.has(normCode(s.code)));
  const withCode = working
    .map((s) => ({ ...s, code: normCode(s.code) }))
    .filter((s) => !!s.code);
  return withCode.sort(
    (a, b) => shiftTimeWindowFromSla(a).startMin - shiftTimeWindowFromSla(b).startMin,
  );
}

/** Todas las bandas laborales del objetivo (dedupe por código), ordenadas por hora de inicio. */
export function orderedWorkShiftsAcrossObjective(
  positionStructure: VacancyPositionSla[] | undefined,
): Array<NonNullable<VacancyPositionSla['shifts']>[number] & { code: string }> {
  if (!positionStructure?.length) return [];
  const byCode = new Map<string, NonNullable<VacancyPositionSla['shifts']>[number] & { code: string }>();
  for (const pos of positionStructure) {
    for (const s of orderedWorkShiftsForPosition(positionStructure, pos.positionName)) {
      if (!byCode.has(s.code)) byCode.set(s.code, s);
    }
  }
  return [...byCode.values()].sort(
    (a, b) => shiftTimeWindowFromSla(a).startMin - shiftTimeWindowFromSla(b).startMin,
  );
}

function orderedBandsForVacancyGap(
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
): Array<NonNullable<VacancyPositionSla['shifts']>[number] & { code: string }> {
  const atPos = orderedWorkShiftsForPosition(positionStructure, positionName);
  if (atPos.length >= 2) return atPos;
  const pooled = orderedWorkShiftsAcrossObjective(positionStructure);
  return pooled.length >= 2 ? pooled : atPos;
}

export function findPositionForBand(
  positionStructure: VacancyPositionSla[] | undefined,
  band: string,
  preferredPosition?: string | null,
): string | null {
  const b = normCode(band);
  if (preferredPosition) {
    const ordered = orderedWorkShiftsForPosition(positionStructure, preferredPosition);
    if (ordered.some((s) => normCode(s.code) === b)) return preferredPosition;
  }
  if (!positionStructure?.length) return preferredPosition || null;
  for (const pos of positionStructure) {
    const ordered = orderedWorkShiftsForPosition(positionStructure, pos.positionName);
    if (ordered.some((s) => normCode(s.code) === b)) return pos.positionName || null;
  }
  return preferredPosition || null;
}

/** Códigos laborales del SLA (custom + CCT) para listar candidatos ext/adel. */
export function isVacancySegmentWorkCode(
  code: string,
  positionStructure?: VacancyPositionSla[],
): boolean {
  const c = normCode(code);
  if (CCT_BANDS.has(c) || c === 'REF' || c === 'ESC' || c === 'FT') return true;
  if (!positionStructure?.length) return false;
  for (const pos of positionStructure) {
    for (const s of pos.shifts || []) {
      if (normCode(s.code) === c && !FRANCO_CODES.has(normCode(s.code))) return true;
    }
  }
  return false;
}

export type VacancySplitNeighborBands = { extensionBand: string; earlyStartBand: string };

/** Bandas CCT (comportamiento histórico). */
export function neighborBandsCct(targetBand: string): VacancySplitNeighborBands {
  const b = normCode(targetBand);
  if (b === 'M' || b === 'D12') return { extensionBand: 'N', earlyStartBand: 'T' };
  if (b === 'T') return { extensionBand: 'M', earlyStartBand: 'N' };
  if (b === 'N' || b === 'N12') return { extensionBand: 'T', earlyStartBand: 'M' };
  return { extensionBand: 'M', earlyStartBand: 'T' };
}

/**
 * Bandas que cubren el hueco en custom concurrente (ej. falta E3 14–20):
 * - 1.er tramo: quien tenía el turno más temprano (E1) extiende 14–16.
 * - 2.º tramo: el intermedio (E2) extiende 16–20 (no es “adelanto” de inicio).
 */
export function neighborBandsForVacancyGap(
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
  targetBand: string,
): VacancySplitNeighborBands {
  const target = normCode(targetBand);
  if (CCT_BANDS.has(target)) return neighborBandsCct(target);

  const resolvedPos = findPositionForBand(positionStructure, target, positionName);
  const ordered = orderedBandsForVacancyGap(positionStructure, resolvedPos);
  const codes = ordered.map((s) => normCode(s.code));
  const idx = codes.indexOf(target);
  if (idx < 0 || codes.length < 2) return neighborBandsCct(target);

  if (idx === codes.length - 1 && codes.length >= 3) {
    return {
      extensionBand: codes[idx - 2],
      earlyStartBand: codes[idx - 1],
    };
  }

  const extensionBand = codes[Math.max(0, idx - 1)];
  const earlyStartBand = codes[Math.min(codes.length - 1, idx + 1)];
  return { extensionBand, earlyStartBand };
}

export type VacancySplitTimes = {
  gap: { from: string; to: string };
  ext: { from: string; to: string };
  adel: { from: string; to: string };
};

/** Horarios CCT fijos. */
export function defaultSplitTimesCct(band: string): VacancySplitTimes {
  const b = band.toUpperCase();
  if (b === 'T') {
    return {
      gap: { from: '15:00', to: '23:00' },
      ext: { from: '15:00', to: '19:00' },
      adel: { from: '19:00', to: '23:00' },
    };
  }
  if (b === 'N') {
    return {
      gap: { from: '19:00', to: '07:00' },
      ext: { from: '19:00', to: '23:00' },
      adel: { from: '23:00', to: '07:00' },
    };
  }
  if (b === 'M') {
    return {
      gap: { from: '07:00', to: '15:00' },
      ext: { from: '07:00', to: '11:00' },
      adel: { from: '11:00', to: '15:00' },
    };
  }
  return {
    gap: { from: '15:00', to: '23:00' },
    ext: { from: '15:00', to: '19:00' },
    adel: { from: '19:00', to: '23:00' },
  };
}

/** Parte el hueco del turno custom en dos segmentos según horario SLA. */
export function defaultSplitTimesForVacancyGap(
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
  targetBand: string,
): VacancySplitTimes {
  const target = normCode(targetBand);
  if (CCT_BANDS.has(target)) return defaultSplitTimesCct(target);

  const resolvedPos = findPositionForBand(positionStructure, target, positionName);
  const ordered = orderedBandsForVacancyGap(positionStructure, resolvedPos);
  const shift = ordered.find((s) => normCode(s.code) === target);
  if (!shift) return defaultSplitTimesCct(target);

  const win = shiftTimeWindowFromSla(shift);
  const gap = { from: win.from, to: win.to };
  const codes = ordered.map((s) => normCode(s.code));
  const idx = codes.indexOf(target);
  const prevCode = idx > 0 ? codes[idx - 1] : null;
  const prevShift = prevCode ? ordered.find((s) => normCode(s.code) === prevCode) : null;
  let splitMin = win.startMin + Math.floor((win.endMin - win.startMin) / 2);
  if (prevShift) {
    const prevWin = shiftTimeWindowFromSla(prevShift);
    if (prevWin.endMin > win.startMin && prevWin.endMin < win.endMin) {
      splitMin = prevWin.endMin;
    }
  }
  const mid = minutesToHHmm(splitMin);
  return {
    gap,
    ext: { from: gap.from, to: mid },
    adel: { from: mid, to: gap.to },
  };
}

/** En custom playa/banco, el 2.° tramo suele ser extensión de cierre (ej. 16–20), no adelanto de inicio. */
export function vacancySecondSegmentIsTailExtension(targetBand: string): boolean {
  return !CCT_BANDS.has(normCode(targetBand));
}

export type VacancySplitListContext = {
  positionStructure?: VacancyPositionSla[];
  gapPositionName?: string | null;
  gapBand?: string | null;
  preferSamePosition?: boolean;
};
