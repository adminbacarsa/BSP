import type { ServicePosition } from '@/services/slaService';
import { slaCoversCalendarMonth, toYyyyMmDd } from '@/lib/firestoreDates';
import {
  calculateMonthlyBreakdown,
  calculateSlaHoursForDateRange,
  calculateSlaHoursForMonth,
  parseYmdToLocalDate,
} from '@/lib/servicios/slaHoursCalculator';
import {
  isSlaContractActive,
  type SlaPlanningRow,
} from '@/lib/slaPlanningMatch';

function normObjectiveName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/** Clave estable cliente+objetivo para deduplicar contratos SLA. */
export function objectiveKeyForSla(sla: {
  clientId?: unknown;
  objectiveId?: unknown;
  objectiveName?: unknown;
}): string {
  const cid = String(sla.clientId ?? '').trim();
  const oid = String(sla.objectiveId ?? '').trim();
  const name = normObjectiveName(sla.objectiveName);
  return `${cid}::${oid || name || 'sin-obj'}`;
}

function slaOverlapsDateRange(
  sla: SlaPlanningRow,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const startRaw = toYyyyMmDd(sla.startDate);
  const endRaw = toYyyyMmDd(sla.endDate);
  const sd = parseYmdToLocalDate(startRaw || '1970-01-01');
  const ed = parseYmdToLocalDate(endRaw || '2099-12-31');
  if (!sd || !ed) return false;
  const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  return sd <= re && ed >= rs;
}

/**
 * Un contrato vigente por objetivo en el rango (misma regla que planificación: mayor startDate).
 * Evita sumar contrato anterior + actual en CRM / Análisis.
 */
export function pickVigenteSlasForPeriod(
  services: SlaPlanningRow[],
  rangeStart: Date,
  rangeEnd: Date,
): SlaPlanningRow[] {
  const byKey = new Map<string, SlaPlanningRow[]>();
  for (const srv of services) {
    if (!isSlaContractActive(srv.status)) continue;
    const key = objectiveKeyForSla(srv);
    const arr = byKey.get(key) || [];
    arr.push(srv);
    byKey.set(key, arr);
  }

  const result: SlaPlanningRow[] = [];
  for (const group of byKey.values()) {
    const overlapping = group.filter((s) => slaOverlapsDateRange(s, rangeStart, rangeEnd));
    if (overlapping.length === 0) continue;
    const vigente = [...overlapping].sort((a, b) =>
      toYyyyMmDd(b.startDate).localeCompare(toYyyyMmDd(a.startDate)),
    )[0];
    result.push(vigente);
  }
  return result;
}

/** Horas SLA de un contrato en un rango — alineado al pie «Vendidas» del planificador en mes completo. */
export function slaHoursForServiceInRange(
  srv: SlaPlanningRow,
  rangeStart: Date | null,
  rangeEnd: Date | null,
): number {
  const positions = (
    Array.isArray(srv.positions)
      ? srv.positions
      : Object.values((srv.positions as Record<string, unknown>) || {})
  ) as ServicePosition[];
  if (!positions.length || !rangeStart || !rangeEnd) {
    if (!rangeStart && !rangeEnd) {
      return Math.round(
        calculateMonthlyBreakdown(
          positions,
          toYyyyMmDd(srv.startDate),
          toYyyyMmDd(srv.endDate),
          srv.excludedDates as string[] | undefined,
        ).reduce((acc, m) => acc + m.totalHours, 0),
      );
    }
    return 0;
  }

  const rs = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const re = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  const lastDayOfMonth = new Date(rs.getFullYear(), rs.getMonth() + 1, 0).getDate();
  const isFullCalendarMonth =
    rs.getDate() === 1 &&
    re.getDate() === lastDayOfMonth &&
    rs.getMonth() === re.getMonth() &&
    rs.getFullYear() === re.getFullYear();

  if (isFullCalendarMonth && slaCoversCalendarMonth(srv.startDate, srv.endDate, rs.getFullYear(), rs.getMonth())) {
    const calculated = Math.round(
      calculateSlaHoursForMonth(
        positions,
        toYyyyMmDd(srv.startDate),
        toYyyyMmDd(srv.endDate),
        srv.excludedDates as string[] | undefined,
        rs.getFullYear(),
        rs.getMonth(),
      ).total,
    );
    if (calculated > 0) return calculated;
    const stored = Math.round(Number(srv.totalMonthlyHours) || 0);
    if (stored > 0) return stored;
  }

  return Math.round(
    calculateSlaHoursForDateRange(
      positions,
      toYyyyMmDd(srv.startDate),
      toYyyyMmDd(srv.endDate),
      srv.excludedDates as string[] | undefined,
      rangeStart,
      rangeEnd,
    ),
  );
}

export function sumVigenteSlaHoursInRange(
  services: SlaPlanningRow[],
  rangeStart: Date | null,
  rangeEnd: Date | null,
): number {
  if (!rangeStart || !rangeEnd) {
    return services.reduce((acc, s) => acc + slaHoursForServiceInRange(s, null, null), 0);
  }
  return pickVigenteSlasForPeriod(services, rangeStart, rangeEnd).reduce(
    (acc, s) => acc + slaHoursForServiceInRange(s, rangeStart, rangeEnd),
    0,
  );
}
