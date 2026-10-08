/**
 * Estado por día del modal de cobertura de licencia (escritorio).
 * Cada día marcado tiene su cobertura; nada se copia solo al día siguiente
 * y un día ya configurado no se pisa sin que el llamador lo confirme.
 */
import { checkRestBetweenShiftsDetail } from '@/lib/planificacion/restBetweenShifts';
import { classifyRestViolation, monthNeedsSupervisorPin } from '@/lib/planificacion/supervisorAuth';
import { planningHourLimits } from '@/lib/planning/planning-rules.runtime';
import {
  resolveVacancySplitSegmentTimes,
  vacancyDayHasCoverage,
  type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import type { VacancyPositionSla } from '@/lib/planificacion/vacancySplitBands';

const LICENSE = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'ART']);
const FRANCO = new Set(['F', 'FF', 'FP']);

export function coverageKey(coverage: VacancyDayCoverage | undefined): string {
  if (!coverage || coverage.mode === 'none') return 'none';
  if (coverage.mode === 'substitute') return `S:${coverage.employeeId}`;
  return [
    'X',
    coverage.extEmpId,
    coverage.adelEmpId,
    coverage.gapBand,
    coverage.gapPosition,
    coverage.extExtraHours ?? '',
    coverage.secondExtExtraHours ?? '',
  ].join('|');
}

export function coveragesDiffer(a: VacancyDayCoverage | undefined, b: VacancyDayCoverage | undefined): boolean {
  return coverageKey(a) !== coverageKey(b);
}

export function savedCoverage(
  map: Record<string, VacancyDayCoverage>,
  day: string,
): VacancyDayCoverage {
  return map[day] ?? { mode: 'none' };
}

export function applyCoverageToDay(
  map: Record<string, VacancyDayCoverage>,
  day: string,
  coverage: VacancyDayCoverage,
): Record<string, VacancyDayCoverage> {
  return { ...map, [day]: coverage };
}

export function clearDayCoverage(
  map: Record<string, VacancyDayCoverage>,
  day: string,
): Record<string, VacancyDayCoverage> {
  if (!map[day]) return map;
  const next = { ...map };
  delete next[day];
  return next;
}

/** Días que ya tienen cobertura y recibirían otra distinta. Los vacíos no cuentan. */
export function daysOverwritten(
  map: Record<string, VacancyDayCoverage>,
  incoming: Record<string, VacancyDayCoverage>,
): string[] {
  return Object.keys(incoming).filter((day) => {
    const prev = map[day];
    if (!vacancyDayHasCoverage(prev ?? { mode: 'none' })) return false;
    return coveragesDiffer(prev, incoming[day]);
  }).sort();
}

export function mergeCoverages(
  map: Record<string, VacancyDayCoverage>,
  incoming: Record<string, VacancyDayCoverage>,
): Record<string, VacancyDayCoverage> {
  return { ...map, ...incoming };
}

export function emptyDays(days: readonly string[], map: Record<string, VacancyDayCoverage>): string[] {
  return days.filter((d) => !vacancyDayHasCoverage(savedCoverage(map, d)));
}

/**
 * Plantilla = el día que se configuró último si sigue teniendo cobertura;
 * si no, el último de la lista que tenga.
 */
export function templateDayForRemaining(
  days: readonly string[],
  map: Record<string, VacancyDayCoverage>,
  preferred: string | null,
): string | null {
  if (preferred && vacancyDayHasCoverage(savedCoverage(map, preferred))) return preferred;
  const withCov = days.filter((d) => vacancyDayHasCoverage(savedCoverage(map, d)));
  return withCov.length ? withCov[withCov.length - 1] : null;
}

/**
 * Copia la plantilla solo a días sin cobertura. `adapt` puede ajustar el hueco de ese día
 * (mismo suplente o mismos guardias, banda del día).
 */
export function fillEmptyDays(
  map: Record<string, VacancyDayCoverage>,
  days: readonly string[],
  template: VacancyDayCoverage,
  adapt: (day: string, template: VacancyDayCoverage) => VacancyDayCoverage | null = (_day, tpl) => tpl,
): { next: Record<string, VacancyDayCoverage>; filled: string[] } {
  const next = { ...map };
  const filled: string[] = [];
  if (!vacancyDayHasCoverage(template)) return { next, filled };
  for (const day of emptyDays(days, map)) {
    const cov = adapt(day, template);
    if (!cov || !vacancyDayHasCoverage(cov)) continue;
    next[day] = cov;
    filled.push(day);
  }
  return { next, filled };
}

export function nextMarkedDay(days: readonly string[], day: string): string | null {
  const i = days.indexOf(day);
  if (i < 0 || i >= days.length - 1) return null;
  return days[i + 1];
}

export function previousMarkedDay(days: readonly string[], day: string): string | null {
  const i = days.indexOf(day);
  if (i <= 0) return null;
  return days[i - 1];
}

export type PickerDraft = {
  tab: 'substitute' | 'split';
  substituteId: string;
  extId: string;
  adelId: string;
};

/** Borrador listo para guardar. Split a medias o la misma persona en los dos tramos → null. */
export function draftCoverage(draft: PickerDraft, gap?: { band: string; position: string; extExtraHours?: number | null; secondExtExtraHours?: number | null }): VacancyDayCoverage | null {
  if (draft.tab === 'substitute') {
    return draft.substituteId ? { mode: 'substitute', employeeId: draft.substituteId } : null;
  }
  if (!draft.extId || !draft.adelId || draft.extId === draft.adelId) return null;
  if (!gap?.band || !gap.position) return null;
  return {
    mode: 'split',
    extEmpId: draft.extId,
    adelEmpId: draft.adelId,
    gapBand: gap.band,
    gapPosition: gap.position,
    ...(gap.extExtraHours != null && gap.secondExtExtraHours != null
      ? { extExtraHours: gap.extExtraHours, secondExtExtraHours: gap.secondExtExtraHours }
      : {}),
  };
}

/** Un tramo elegido y el otro no: hay cambios que todavía no son una cobertura. */
export function draftIsPartial(draft: PickerDraft): boolean {
  if (draft.tab !== 'split') return false;
  const ext = !!draft.extId;
  const adel = !!draft.adelId;
  return ext !== adel;
}

export type GuardShift = {
  code?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  isFranco?: boolean;
};

export type ProposedGuardShift = {
  code: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  /** Horas que se suman al mes: el hueco si está libre, solo el extra si ya trabaja. */
  addHours: number;
  /** Extensión pegada al turno que ya hace: no abre un descanso nuevo antes. */
  extiendeTurno?: boolean;
};

export function horasEntre(from?: string, to?: string): number {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let mins = (th * 60 + tm) - (fh * 60 + fm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
}

/** Turno que tomaría cada guardia ese día con esta cobertura (descanso y tope lo miran). */
export function propuestaGuardCobertura(input: {
  coverage: VacancyDayCoverage;
  titular: { code?: string; scheduleLabel?: string; hours?: number } | null;
  shiftOf: (empId: string) => GuardShift | null;
  positionStructure: VacancyPositionSla[] | undefined;
}): Record<string, ProposedGuardShift> {
  const { coverage, titular } = input;
  if (coverage.mode === 'substitute') {
    const m = String(titular?.scheduleLabel || '').match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
    const hours = titular?.hours || 8;
    return { [coverage.employeeId]: { code: titular?.code || 'M', startTime: m?.[1], endTime: m?.[2], hours, addHours: hours } };
  }
  if (coverage.mode !== 'split') return {};
  const extShift = input.shiftOf(coverage.extEmpId);
  const adelShift = input.shiftOf(coverage.adelEmpId);
  const times = resolveVacancySplitSegmentTimes(
    input.positionStructure,
    coverage.gapBand,
    coverage.gapPosition,
    { code: extShift?.code },
    { code: adelShift?.code },
    coverage.extExtraHours,
    coverage.secondExtExtraHours,
  );
  const extAdd = coverage.extExtraHours ?? horasEntre(times.first.from, times.first.to);
  const adelAdd = coverage.secondExtExtraHours ?? horasEntre(times.second.from, times.second.to);
  return {
    [coverage.extEmpId]: {
      code: String(extShift?.code || coverage.gapBand || 'M'),
      startTime: extShift?.startTime || times.first.from,
      endTime: times.first.to,
      hours: extAdd,
      addHours: extAdd,
      extiendeTurno: true,
    },
    [coverage.adelEmpId]: {
      code: String(adelShift?.code || coverage.gapBand || 'T'),
      startTime: times.second.from,
      endTime: adelShift?.endTime || times.second.to,
      hours: adelAdd,
      addHours: adelAdd,
    },
  };
}

export type CoverageGuardInput = {
  dateStr: string;
  /** employeeId → turno propuesto ese día. */
  proposedByEmp: Record<string, ProposedGuardShift>;
  shiftOf: (empId: string, dateStr: string) => GuardShift | null;
  monthHoursOf: (empId: string) => number;
  nameOf: (empId: string) => string;
  monthlyCap?: number;
};

export type CoverageAuthRequest = {
  kind: 'DESCANSO' | 'TOPE';
  employeeId: string;
  name: string;
  dateStr: string;
  restHours?: number;
  monthHours?: number;
  cap: number;
  shiftCode?: string;
  message: string;
};

export type CoverageGuardResult = {
  blocked: string[];
  authorizations: CoverageAuthRequest[];
};

/**
 * Licencia, descanso y tope se miran con el turno de ESE guardia ESE día.
 * El franco no bloquea (PIN de FT). Entre 8 y 12 h, y el tope de 200 h, salen
 * como autorización: sin PIN el llamador no escribe. Menos de 8 h queda en blocked.
 */
export function evaluateCoverageDayGuards(input: CoverageGuardInput): CoverageGuardResult {
  const cap = input.monthlyCap ?? planningHourLimits().monthly;
  const blocked: string[] = [];
  const authorizations: CoverageAuthRequest[] = [];
  const cfg = { minRestBetweenShiftsHours: 12, longRestAfterWorkedHours: 48, minLongRestHours: 35 };
  for (const [empId, proposed] of Object.entries(input.proposedByEmp)) {
    const name = input.nameOf(empId) || empId;
    const today = input.shiftOf(empId, input.dateStr);
    const code = String(today?.code || '').toUpperCase();
    const franco = !!today?.isFranco || FRANCO.has(code);
    if (LICENSE.has(code)) {
      blocked.push(`${name} tiene licencia ${code} ese día.`);
      continue;
    }
    if (!franco && !proposed.extiendeTurno) {
      const rest = checkRestBetweenShiftsDetail({
        empId,
        targetDateStr: input.dateStr,
        proposed: {
          code: proposed.code,
          startTime: proposed.startTime,
          endTime: proposed.endTime,
          hours: proposed.hours,
        },
        getShift: (eid, ds) => {
          if (eid === empId && ds === input.dateStr) {
            return { code: proposed.code, startTime: proposed.startTime, endTime: proposed.endTime, hours: proposed.hours };
          }
          return input.shiftOf(eid, ds);
        },
        cfg,
      });
      const band = classifyRestViolation(rest);
      if (rest && band === 'blocked') blocked.push(`${name}: ${rest.message}`);
      if (rest && band === 'pin') {
        authorizations.push({
          kind: 'DESCANSO',
          employeeId: empId,
          name,
          dateStr: input.dateStr,
          restHours: rest.gapHours,
          cap,
          shiftCode: proposed.code,
          message: `${name}: ${rest.message}`,
        });
      }
    }
    const add = Number(proposed.addHours) || 0;
    const month = input.monthHoursOf(empId) + add;
    if (add > 0 && monthNeedsSupervisorPin(month, cap)) {
      authorizations.push({
        kind: 'TOPE',
        employeeId: empId,
        name,
        dateStr: input.dateStr,
        monthHours: Math.round(month),
        cap,
        shiftCode: proposed.code,
        message: `${name} quedaría en ${Math.round(month)} h. Tope ${cap}.`,
      });
    }
  }
  return { blocked, authorizations };
}

/** Sin PIN, la autorización pendiente bloquea la escritura. Con PIN, solo queda lo duro (< 8 h, licencia). */
export function unresolvedGuardMessages(
  result: CoverageGuardResult,
  granted: { descanso: boolean; tope: boolean },
): string[] {
  const msgs = [...result.blocked];
  for (const auth of result.authorizations) {
    if (auth.kind === 'DESCANSO' && !granted.descanso) msgs.push(auth.message);
    if (auth.kind === 'TOPE' && !granted.tope) msgs.push(auth.message);
  }
  return msgs;
}
