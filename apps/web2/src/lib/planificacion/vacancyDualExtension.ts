/**
 * Cobertura vacaciones custom: dos extensiones de jornada (+N h cada una o tramos auto SLA).
 */

import {
  defaultSplitTimesForVacancyGap,
  shiftTimeWindowFromSla,
  type VacancyPositionSla,
} from './vacancySplitBands';

export type VacancySegmentTimes = { from: string; to: string };

export type VacancyDualExtensionPlan = {
  gap: VacancySegmentTimes;
  first: VacancySegmentTimes;
  second: VacancySegmentTimes;
  firstExtraHours: number;
  secondExtraHours: number;
};

function parseMin(raw: string | undefined | null): number | null {
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

function hoursBetween(from: string, to: string): number {
  const a = parseMin(from);
  const b = parseMin(to);
  if (a == null || b == null) return 0;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 10) / 10;
}

export function slaEndTimeForWorkerBand(
  positionStructure: VacancyPositionSla[] | undefined,
  positionName: string | undefined | null,
  bandCode: string | undefined | null,
): string | null {
  if (!positionStructure?.length || !positionName || !bandCode) return null;
  const pos = positionStructure.find((p) => p.positionName === positionName);
  const shift = pos?.shifts?.find((s) => String(s.code || '').toUpperCase() === String(bandCode).toUpperCase());
  if (!shift) return null;
  return shiftTimeWindowFromSla(shift).to;
}

function shiftBandCode(shift: Record<string, unknown> | null | undefined): string {
  return String(shift?.code || '').toUpperCase();
}

/** Tramos auto según hueco SLA del titular ausente. */
export function autoVacancyDualExtensionPlan(
  positionStructure: VacancyPositionSla[] | undefined,
  gapPosition: string | undefined | null,
  gapBand: string,
): VacancyDualExtensionPlan {
  const split = defaultSplitTimesForVacancyGap(positionStructure, gapPosition, gapBand);
  return {
    gap: split.gap,
    first: split.ext,
    second: split.adel,
    firstExtraHours: hoursBetween(split.ext.from, split.ext.to),
    secondExtraHours: hoursBetween(split.adel.from, split.adel.to),
  };
}

/**
 * Calcula tramos de cobertura. Si `firstExtraHours` / `secondExtraHours` vienen definidos,
 * extiende desde el fin SLA de cada guardia (+N h). Si no, usa tramos auto del hueco.
 */
export function resolveVacancyDualExtensionPlan(
  positionStructure: VacancyPositionSla[] | undefined,
  gapPosition: string | undefined | null,
  gapBand: string,
  firstWorker: { positionName?: string; code?: string } | null,
  secondWorker: { positionName?: string; code?: string } | null,
  firstExtraHours?: number | null,
  secondExtraHours?: number | null,
): VacancyDualExtensionPlan {
  const auto = autoVacancyDualExtensionPlan(positionStructure, gapPosition, gapBand);
  const useManual = firstExtraHours != null && secondExtraHours != null
    && Number.isFinite(firstExtraHours) && Number.isFinite(secondExtraHours);

  if (!useManual) return auto;

  const gapStart = parseMin(auto.gap.from) ?? 0;
  const gapEnd = parseMin(auto.gap.to) ?? gapStart + 8 * 60;

  const end1 = slaEndTimeForWorkerBand(
    positionStructure,
    firstWorker?.positionName || gapPosition,
    firstWorker?.code,
  );
  const end2 = slaEndTimeForWorkerBand(
    positionStructure,
    secondWorker?.positionName || gapPosition,
    secondWorker?.code,
  );

  let firstEndMin = parseMin(end1);
  if (firstEndMin != null) firstEndMin += Math.round(firstExtraHours! * 60);
  else firstEndMin = parseMin(auto.first.to) ?? gapStart + Math.round(firstExtraHours! * 60);

  firstEndMin = Math.max(firstEndMin, gapStart);
  firstEndMin = Math.min(firstEndMin, gapEnd);
  if (firstEndMin <= gapStart) firstEndMin = Math.min(gapEnd, gapStart + Math.round(firstExtraHours! * 60));

  // El segundo guardia hace early-start: cubre desde (gapEnd - secondExtraHours) hasta gapEnd.
  // No se usa end2 porque para turnos nocturnos end2 < gapStart (día siguiente) y la aritmética
  // se desfasa. El tramo always termina en gapEnd.
  const secondStartMin = Math.max(
    gapEnd - Math.round(secondExtraHours! * 60),
    firstEndMin,
  );

  const first: VacancySegmentTimes = {
    from: auto.gap.from,
    to: minutesToHHmm(firstEndMin),
  };
  const second: VacancySegmentTimes = {
    from: minutesToHHmm(secondStartMin),
    to: minutesToHHmm(gapEnd),
  };

  return {
    gap: auto.gap,
    first,
    second,
    firstExtraHours: firstExtraHours!,
    secondExtraHours: secondExtraHours!,
  };
}

export function formatDualExtensionCoverageLabel(
  extName: string,
  secondName: string,
  plan: VacancyDualExtensionPlan,
): string {
  const a = extName.split(',')[0];
  const b = secondName.split(',')[0];
  return `${a} ext +${plan.firstExtraHours}h (${plan.first.from}–${plan.first.to}) · ${b} ext +${plan.secondExtraHours}h (${plan.second.from}–${plan.second.to})`;
}
