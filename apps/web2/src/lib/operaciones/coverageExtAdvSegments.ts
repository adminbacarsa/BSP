import { Timestamp } from 'firebase/firestore';
import { resolveVacancySplitSegmentTimes } from '@/lib/planificacion/vacancyCoverage';
import type { VacancyPositionSla } from '@/lib/planificacion/vacancySplitBands';
import { positionStructureFromServices } from '@/lib/operaciones/opsDualCoverageApply';

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

export function hhmmOnDateToTimestamp(dateStr: string, hm: string): Timestamp {
  const [y, m, d] = dateStr.split('-').map(Number);
  const { h, min } = { h: parseHm(hm).h, min: parseHm(hm).m };
  return Timestamp.fromDate(new Date(y, m - 1, d, h, min, 0, 0));
}

export function hhmmRangeOnDateToTimestamps(
  dateStr: string,
  fromHm: string,
  toHm: string,
): { start: Timestamp; end: Timestamp } {
  const start = hhmmOnDateToTimestamp(dateStr, fromHm);
  let end = hhmmOnDateToTimestamp(dateStr, toHm);
  if (end.toMillis() <= start.toMillis()) {
    const d = toDate(start);
    d.setDate(d.getDate() + 1);
    end = Timestamp.fromDate(d);
    end = hhmmOnDateToTimestamp(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      toHm,
    );
  }
  return { start, end };
}

export function resolveCoverageBandCode(opts: {
  code?: string | null;
  startTime?: unknown;
}): string {
  const c = String(opts.code || '').trim().toUpperCase();
  if (c && !['T', 'COBERTURA', ''].includes(c)) return c;
  const d = toDate(opts.startTime);
  const h = d.getHours();
  if (h >= 6 && h < 14) return 'M';
  if (h >= 14 && h < 22) return 'T';
  return 'N';
}

export type DualExtAdvPlan = {
  extCovStart: Timestamp;
  extCovEnd: Timestamp;
  advCovStart: Timestamp;
  advCovEnd: Timestamp;
  extensionEndHm: string;
  adjustedStartHm: string;
  bandCode: string;
  coveredByLabel: string;
};

export function computeDualExtAdvPlan(input: {
  absenceShift: Record<string, unknown>;
  extEmpId: string;
  advEmpId: string;
  extShift?: Record<string, unknown> | null;
  advShift?: Record<string, unknown> | null;
  servicesSLA: unknown[];
  employees: unknown[];
}): DualExtAdvPlan {
  const absence = input.absenceShift;
  const dateStr = toDate(absence.shiftDateObj).toLocaleDateString('en-CA');
  const gapBand = resolveCoverageBandCode({
    code: absence.code as string,
    startTime: absence.shiftDateObj ?? absence.startTime,
  });
  const positionStructure = positionStructureFromServices(
    input.servicesSLA,
    String(absence.objectiveId || ''),
  ) as VacancyPositionSla[];

  const dualPlan = resolveVacancySplitSegmentTimes(
    positionStructure,
    gapBand,
    String(absence.positionName || ''),
    {
      positionName: input.extShift?.positionName || absence.positionName,
      code: input.extShift?.code,
    },
    {
      positionName: absence.positionName,
      code: input.advShift?.code,
    },
    null,
    null,
  );

  const extSeg = dualPlan.first;
  const advSeg = dualPlan.second;
  const extCov = hhmmRangeOnDateToTimestamps(dateStr, extSeg.from, extSeg.to);
  const advCov = hhmmRangeOnDateToTimestamps(dateStr, advSeg.from, advSeg.to);

  const extName = String(
    input.extShift?.employeeName
    || (input.employees as any[]).find((e) => e.id === input.extEmpId)?.fullName
    || 'EXT',
  ).split(' ')[0];
  const advName = String(
    input.advShift?.employeeName
    || (input.employees as any[]).find((e) => e.id === input.advEmpId)?.fullName
    || 'ADV',
  ).split(' ')[0];
  const hiStart = extSeg.from;
  const hiEnd = advSeg.to;
  const coveredByLabel = `${extName} ext ${hiStart}–${extSeg.to} + ${advName} adel ${advSeg.from}–${hiEnd}`;

  return {
    extCovStart: extCov.start,
    extCovEnd: extCov.end,
    advCovStart: advCov.start,
    advCovEnd: advCov.end,
    extensionEndHm: extSeg.to,
    adjustedStartHm: advSeg.from,
    bandCode: gapBand,
    coveredByLabel,
  };
}
