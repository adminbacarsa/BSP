import type { ProformaDayCell, ProformaEmployeeRow, ProformaObjectiveGrid, ProformaExportBundle, ProformaSummaryRow } from './proformaTypes';
import {
  isPlanificadorPlannedHoursShift,
} from '@/lib/planificacion/planningScheduledHours';
import { coalescePlannedTurnosForCell, coalescePlannedCellBillableHours } from '@/lib/planificacion/planningTurnoCoalesce';
import {
  type ObjectiveMeta,
  resolveCanonicalObjectiveId,
  resolveObjectiveDisplayName,
} from './objectiveIdentity';
import { resolveEmployeeMeta } from './proformaEnrichment';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey } from './crmDateUtils';
import { isProformaVacancyEmployee, isProformaVacancyShift } from './proformaVacancy';
import type { SlaExclusionContext } from './slaExclusionForPlanned';
import { isTurnoOnSlaExcludedSlot } from './slaExclusionForPlanned';

const SHIFT_CODE_HOURS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8, GU: 8, EN: 9, RFZ: 8, TURA: 8 };
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const NON_WORK_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP', 'FT', 'RET', 'REF', 'ESC']);

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const PDF_DAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export function formatHoursHm(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatHoursColonTotal(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0:00';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function getNightDuration(start: Date, end: Date): number {
  let durationMins = 0;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  let current = new Date(start.getTime());
  const endTime = end.getTime();
  let safety = 0;
  while (current.getTime() < endTime && safety < 1440) {
    const h = current.getHours();
    if (h >= 21 || h < 6) durationMins++;
    current.setMinutes(current.getMinutes() + 1);
    safety++;
  }
  return durationMins / 60;
}

function getDurationHours(start: Date, end: Date): number {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0 && diff <= 24) return diff;
  if (diff < 0) return diff + 24;
  return 8;
}

function toDateSafe(val: unknown): Date | null {
  if (!val) return null;
  const v = val as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function listDatesInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    out.push(getDateKeyInTimezone(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function dayLabelFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return DAY_ABBR[dt.getDay()] || '';
}

function shortDayHeader(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${Number(d)}/${Number(m)}`;
}

export function pdfDayNumber(ymd: string): string {
  const [, , d] = ymd.split('-');
  return String(Number(d));
}

export function pdfDayLetter(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return PDF_DAY_LETTER[dt.getDay()] || '';
}

function resolveShiftEndForProforma(
  t: ProformaTurnoInput,
  start: Date,
  plannedEnd: Date | null,
  hrs: number,
): Date {
  if (t.isExtended && (t.adjustedEndTime || t.extensionEndTime)) {
    const raw = String(t.adjustedEndTime || t.extensionEndTime || '').slice(0, 5);
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const end = new Date(start);
      end.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (end <= start) end.setDate(end.getDate() + 1);
      return end;
    }
  }
  if (plannedEnd) return plannedEnd;
  if (hrs > 0) return new Date(start.getTime() + Math.min(hrs, 24) * 3600000);
  return new Date(start.getTime() + 8 * 3600000);
}

function emptyCell(date: string): ProformaDayCell {
  return { date, display: '', hours: 0, dayHours: 0, nightHours: 0 };
}

function cellFromShift(date: string, code: string, start: Date, end: Date, hours: number): ProformaDayCell {
  if (FRANCO_CODES.has(code)) {
    return { date, display: 'Frco', hours: 0, dayHours: 0, nightHours: 0 };
  }
  if (NON_WORK_CODES.has(code) && !SHIFT_CODE_HOURS[code]) {
    return { date, display: code, hours: 0, dayHours: 0, nightHours: 0 };
  }
  const night = getNightDuration(start, end);
  const day = Math.max(0, hours - night);
  return {
    date,
    display: formatHoursHm(hours),
    hours,
    dayHours: day,
    nightHours: night,
  };
}

export type ProformaTurnoInput = {
  employeeId?: string;
  employeeName?: string;
  isUnassigned?: boolean;
  clientId?: string;
  objectiveId?: string;
  objectiveName?: string;
  code?: string;
  type?: string;
  startTime?: any;
  endTime?: any;
  realStartTime?: any;
  realEndTime?: any;
  hours?: number;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  segmentFromTime?: string;
  segmentToTime?: string;
  adjustedEndTime?: string;
  extensionEndTime?: string;
  extExtraHours?: number;
  positionName?: string;
};

export type BuildProformaGridsOpts = {
  turnos: ProformaTurnoInput[];
  empMeta: Record<string, { legajo?: string; name?: string }>;
  clientId?: string;
  objectiveAliases?: Record<string, ObjectiveMeta>;
  slaInRange?: Array<{ objectiveId?: string; objectiveName?: string; startDate?: string; endDate?: string }>;
  start: Date;
  end: Date;
  mode: 'auto' | 'planned' | 'executed';
  useExecutedForAuto: boolean;
  slaExclusion?: SlaExclusionContext;
  slaCodeHoursHint?: Record<string, number>;
};

function slaOverlapsRange(sla: { startDate?: string; endDate?: string }, start: Date, end: Date): boolean {
  const sd = String(sla.startDate ?? '').trim().slice(0, 10);
  const ed = String(sla.endDate ?? '').trim().slice(0, 10);
  if (!sd || !ed) return false;
  const pad = (n: number) => String(n).padStart(2, '0');
  const rangeStart = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const rangeEnd = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  return sd <= rangeEnd && ed >= rangeStart;
}

function turnoScheduleDateInRange(t: Record<string, unknown>, start: Date, end: Date): boolean {
  const st = toDateSafe(t.startTime);
  const dateKey =
    resolveTurnoScheduleDateKey(t) || (st ? getDateKeyInTimezone(st) : null);
  if (!dateKey) return false;
  const rangeStart = getDateKeyInTimezone(start);
  const rangeEnd = getDateKeyInTimezone(end);
  return dateKey >= rangeStart && dateKey <= rangeEnd;
}

export function buildProformaObjectiveGrids(opts: BuildProformaGridsOpts): ProformaObjectiveGrid[] {
  const dateColumns = listDatesInRange(opts.start, opts.end);
  const dayLabels: Record<string, string> = {};
  dateColumns.forEach((d) => { dayLabels[d] = dayLabelFromYmd(d); });

  const byObjective: Record<string, {
    objectiveId: string;
    objectiveName: string;
    employees: Record<string, ProformaEmployeeRow>;
  }> = {};

  const useExecuted = opts.mode === 'executed' || (opts.mode === 'auto' && opts.useExecutedForAuto);
  const aliases = opts.objectiveAliases || {};
  const hint = opts.slaCodeHoursHint;

  const cellGroups = new Map<string, ProformaTurnoInput[]>();

  for (const t of opts.turnos) {
    if (!isPlanificadorPlannedHoursShift(t)) continue;
    if (isProformaVacancyShift(t)) continue;
    const plannedStart = toDateSafe(t.startTime);
    if (!plannedStart) continue;
    if (!turnoScheduleDateInRange(t as Record<string, unknown>, opts.start, opts.end)) continue;

    const dateKey = resolveTurnoScheduleDateKey(t as Record<string, unknown>) || getDateKeyInTimezone(plannedStart);
    if (
      opts.slaExclusion
      && isTurnoOnSlaExcludedSlot(t, opts.slaExclusion, {
        scheduleDateKey: dateKey,
        positionName: String(t.positionName ?? ''),
      })
    ) {
      continue;
    }
    const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: t.clientId || opts.clientId };
    const objId = resolveCanonicalObjectiveId(rowCtx, aliases) || String(t.objectiveId || 'sin-id');
    const empId = String(t.employeeId || 'unknown');
    const gKey = `${objId}_${empId}_${dateKey}`;
    const list = cellGroups.get(gKey) || [];
    list.push(t);
    cellGroups.set(gKey, list);
  }

  for (const [, groupTurnos] of cellGroups) {
    const t = coalescePlannedTurnosForCell(groupTurnos, hint) as ProformaTurnoInput;
    if (!t) continue;

    const code = String(t.code || t.type || '').trim().toUpperCase();
    const plannedStart = toDateSafe(t.startTime);
    const plannedEnd = toDateSafe(t.endTime);
    const realStart = toDateSafe(t.realStartTime);
    const realEnd = toDateSafe(t.realEndTime);

    const start = useExecuted ? realStart : plannedStart;
    if (!start) continue;

    let hrs = coalescePlannedCellBillableHours(groupTurnos, hint);
    if (useExecuted && SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
    if (!Number.isFinite(hrs) || hrs < 0) hrs = 0;

    const plannedEndResolved = useExecuted ? (realEnd || plannedEnd) : plannedEnd;
    const end = resolveShiftEndForProforma(t, start, plannedEndResolved, hrs);
    if (!end) continue;

    const dateKey = resolveTurnoScheduleDateKey(t as Record<string, unknown>) || getDateKeyInTimezone(start);
    const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: t.clientId || opts.clientId };
    const objId = resolveCanonicalObjectiveId(rowCtx, aliases) || String(t.objectiveId || 'sin-id');
    const objName = resolveObjectiveDisplayName(rowCtx, aliases);
    byObjective[objId] ||= {
      objectiveId: objId,
      objectiveName: objName,
      employees: {},
    };
    if (objName !== 'Objetivo sin nombre') byObjective[objId].objectiveName = objName;

    const empId = String(t.employeeId || 'unknown');
    const meta = resolveEmployeeMeta(opts.empMeta, empId, t.employeeName);
    const empName = meta.name || 'Sin nombre';
    const legajo = meta.legajo || '—';
    if (isProformaVacancyEmployee({ employeeId: empId, name: empName })) continue;

    byObjective[objId].employees[empId] ||= {
      employeeId: empId,
      legajo,
      name: empName,
      days: Object.fromEntries(dateColumns.map((d) => [d, emptyCell(d)])),
      totalHours: 0,
      totalDay: 0,
      totalNight: 0,
    };

    const cell = cellFromShift(dateKey, code, start, end, hrs);
    const row = byObjective[objId].employees[empId];
    row.days[dateKey] = cell;
  }

  for (const sla of opts.slaInRange || []) {
    if (!slaOverlapsRange(sla, opts.start, opts.end)) continue;
    const rowCtx = { ...sla, clientId: opts.clientId };
    const objId = resolveCanonicalObjectiveId(rowCtx, aliases);
    if (!objId || byObjective[objId]) continue;
    byObjective[objId] = {
      objectiveId: objId,
      objectiveName: resolveObjectiveDisplayName(rowCtx, aliases),
      employees: {},
    };
  }

  return Object.values(byObjective)
    .filter((obj) => {
      const hasRows = Object.keys(obj.employees).length > 0;
      if (hasRows) return true;
      return obj.objectiveName !== 'Objetivo sin nombre' && !obj.objectiveName.includes('…');
    })
    .map((obj) => {
    const employees = Object.values(obj.employees)
      .map((e) => {
        let totalHours = 0;
        let totalDay = 0;
        let totalNight = 0;
        dateColumns.forEach((d) => {
          totalHours += e.days[d]?.hours || 0;
          totalDay += e.days[d]?.dayHours || 0;
          totalNight += e.days[d]?.nightHours || 0;
        });
        return { ...e, totalHours, totalDay, totalNight };
      })
      .filter((e) => !isProformaVacancyEmployee(e))
      .filter((e) => e.totalHours > 0 || Object.values(e.days).some((c) => c.display === 'Frco'))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    const dailyTotals: ProformaObjectiveGrid['dailyTotals'] = {};
    dateColumns.forEach((d) => {
      dailyTotals[d] = { total: 0, day: 0, night: 0 };
      employees.forEach((e) => {
        dailyTotals[d].total += e.days[d]?.hours || 0;
        dailyTotals[d].day += e.days[d]?.dayHours || 0;
        dailyTotals[d].night += e.days[d]?.nightHours || 0;
      });
    });

    const grandTotal = { total: 0, day: 0, night: 0 };
    employees.forEach((e) => {
      grandTotal.total += e.totalHours;
      grandTotal.day += e.totalDay;
      grandTotal.night += e.totalNight;
    });

    return {
      objectiveId: obj.objectiveId,
      objectiveName: obj.objectiveName,
      dateColumns,
      dayLabels,
      employees,
      dailyTotals,
      grandTotal,
    };
  })
  .sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

export function buildProformaSummary(objectives: ProformaObjectiveGrid[]): ProformaSummaryRow[] {
  return objectives.map((o) => ({
    objectiveName: o.objectiveName,
    totalHours: o.grandTotal.total,
    dayHours: o.grandTotal.day,
    nightHours: o.grandTotal.night,
  }));
}

export function buildPeriodLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  if (sameMonth) return `${months[start.getMonth()]}/${start.getFullYear()}`;
  return `${getDateKeyInTimezone(start)} — ${getDateKeyInTimezone(end)}`;
}

export { getDateKeyInTimezone } from './crmDateUtils';
export { isProformaVacancyEmployee, isProformaVacancyShift } from './proformaVacancy';
export { shortDayHeader };
