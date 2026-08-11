/**
 * Hueco SLA a cubrir en vacaciones: detectar E1/E2/E3 (etc.) y permitir elegir banda manualmente.
 */

import {
  alignVacancyGapBand,
  orderedWorkShiftsAcrossObjective,
  orderedWorkShiftsForPosition,
  shiftTimeWindowFromSla,
  type VacancyPositionSla,
} from './vacancySplitBands';
import type { TitularVacancyWorkShift } from './vacancyCoverage';

const NON_WORK = new Set(['V', 'L', 'PG', 'A', 'E', 'AA', 'F', 'FF', 'FT', 'PAST', 'LOCKED', 'RET']);

function normCode(code: unknown): string {
  return String(code || '').trim().toUpperCase();
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  cur.setDate(cur.getDate() + delta);
  return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
}

function readWorkShift(
  empId: string,
  dateStr: string,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
): Record<string, any> | null {
  const key = `${empId}_${dateStr}`;
  for (const src of [pendingChanges[key], shiftsMap[key]]) {
    if (!src || src.isDeleted) continue;
    const c = normCode(src.code);
    if (c && !NON_WORK.has(c)) return src;
    // Código y puesto preservados cuando se aplicó ausencia sobre un turno planificado
    const orig = normCode(src.originalCode);
    if (orig && !NON_WORK.has(orig)) return {
      ...src,
      code: orig,
      positionName: src.originalPositionName || src.positionName,
    };
  }
  return null;
}

export type VacancyGapBandOption = {
  code: string;
  positionName: string;
  scheduleLabel: string;
  hours: number;
  startTime: string;
  endTime: string;
};

export function listVacancyGapBandOptions(
  positionStructure: VacancyPositionSla[] | undefined,
  preferredPosition?: string | null,
): VacancyGapBandOption[] {
  if (!positionStructure?.length) return [];
  const out: VacancyGapBandOption[] = [];
  const seen = new Set<string>();
  const positions = preferredPosition
    ? [positionStructure.find((p) => p.positionName === preferredPosition)].filter(Boolean)
    : positionStructure;

  for (const pos of positions as VacancyPositionSla[]) {
    const bands = orderedWorkShiftsForPosition(positionStructure, pos.positionName);
    for (const b of bands) {
      const key = `${pos.positionName}__${b.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const win = shiftTimeWindowFromSla(b);
      const hrs = Math.round(((win.endMin - win.startMin) / 60) * 10) / 10;
      out.push({
        code: b.code,
        positionName: pos.positionName || 'General',
        scheduleLabel: `${win.from}–${win.to}`,
        hours: hrs > 0 ? hrs : Number(b.hours) || 8,
        startTime: win.from,
        endTime: win.to,
      });
    }
  }

  if (out.length === 0) {
    for (const b of orderedWorkShiftsAcrossObjective(positionStructure)) {
      const posName =
        positionStructure.find((p) =>
          orderedWorkShiftsForPosition(positionStructure, p.positionName).some((s) => s.code === b.code),
        )?.positionName || 'General';
      const key = `${posName}__${b.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const win = shiftTimeWindowFromSla(b);
      out.push({
        code: b.code,
        positionName: posName,
        scheduleLabel: `${win.from}–${win.to}`,
        hours: Number(b.hours) || 8,
        startTime: win.from,
        endTime: win.to,
      });
    }
  }

  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Banda más frecuente del titular en el mes anterior al bloque de ausencia (solo códigos del SLA). */
export function inferTitularGapBandFromHistory(
  titularId: string,
  absenceBlockStart: string | undefined,
  positionStructure: VacancyPositionSla[] | undefined,
  preferredPosition: string | null | undefined,
  shiftsMap: Record<string, any>,
  pendingChanges: Record<string, any>,
): VacancyGapBandOption | null {
  const options = listVacancyGapBandOptions(positionStructure, preferredPosition);
  if (!options.length || !absenceBlockStart) return null;

  const optionCodes = new Set(options.map((o) => o.code));
  const freq: Record<string, number> = {};
  const anchor = absenceBlockStart;

  for (let delta = 0; delta >= -45; delta--) {
    const adj = addCalendarDays(anchor, delta);
    const s = readWorkShift(titularId, adj, shiftsMap, pendingChanges);
    if (!s) continue;
    let c = normCode(s.code);
    const pos = String(s.positionName || preferredPosition || '');
    const aligned = alignVacancyGapBand(c, pos, positionStructure, s);
    if (optionCodes.has(aligned)) c = aligned;
    else if (!optionCodes.has(c)) {
      const win = shiftTimeWindowFromSla({ startTime: s.startTime, endTime: s.endTime, hours: s.hours });
      const match = options.find((o) => o.startTime === win.from || o.code === c);
      if (match) c = match.code;
      else continue;
    }
    freq[c] = (freq[c] || 0) + 1;
  }

  const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  return options.find((o) => o.code === best[0]) ?? null;
}

export function buildTitularVacancyFromGapOption(
  option: VacancyGapBandOption,
  source: TitularVacancyWorkShift['source'] | 'user_selected',
  sourceLabel: string,
  rawShift?: Record<string, any>,
): TitularVacancyWorkShift {
  return {
    code: option.code,
    bandLabel: option.code,
    positionName: option.positionName,
    scheduleLabel: option.scheduleLabel,
    hours: option.hours,
    source: source as TitularVacancyWorkShift['source'],
    sourceLabel,
    rawShift: rawShift ?? { code: option.code, positionName: option.positionName },
  };
}

export function resolveEffectiveVacancyGapTitular(
  inferred: TitularVacancyWorkShift | null,
  userBandCode: string | null | undefined,
  gapOptions: VacancyGapBandOption[],
  positionStructure: VacancyPositionSla[] | undefined,
): TitularVacancyWorkShift | null {
  if (userBandCode) {
    // Soporta clave compuesta "CODE__positionName" para distinguir puestos con el mismo código.
    const parts = userBandCode.split('__');
    const code = normCode(parts[0]);
    const posName = parts.length > 1 ? parts.slice(1).join('__') : null;
    const opt = posName
      ? (gapOptions.find((o) => o.code === code && o.positionName === posName) || gapOptions.find((o) => o.code === code))
      : gapOptions.find((o) => o.code === code);
    if (opt) {
      return buildTitularVacancyFromGapOption(
        opt,
        'user_selected' as TitularVacancyWorkShift['source'],
        'Turno a cubrir elegido manualmente',
        inferred?.rawShift,
      );
    }
  }

  if (!inferred) return null;

  const aligned = alignVacancyGapBand(
    inferred.code,
    inferred.positionName,
    positionStructure,
    inferred.rawShift,
  );
  const opt =
    gapOptions.find((o) => o.code === aligned && o.positionName === inferred.positionName)
    || gapOptions.find((o) => o.code === aligned)
    || gapOptions.find((o) => o.code === normCode(inferred.code));

  if (opt) {
    return buildTitularVacancyFromGapOption(
      opt,
      inferred.source,
      `${inferred.sourceLabel} · horario según SLA`,
      inferred.rawShift,
    );
  }

  return inferred;
}
