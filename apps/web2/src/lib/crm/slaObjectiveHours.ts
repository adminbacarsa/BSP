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

/** Deduplica por objetivo dentro de un cliente (ignora alias distinto en `clientId` del doc). */
export function objectiveKeyForClientScope(
  sla: { objectiveId?: unknown; objectiveName?: unknown },
  canonicalClientId: string,
): string {
  const oid = String(sla.objectiveId ?? '').trim();
  const name = normObjectiveName(sla.objectiveName);
  return `${canonicalClientId}::${oid || name || 'sin-obj'}`;
}

function normalizeServicePositions(srv: SlaPlanningRow): ServicePosition[] {
  if (Array.isArray(srv.positions)) return srv.positions as ServicePosition[];
  return Object.values((srv.positions as Record<string, unknown>) || {}) as ServicePosition[];
}

function slaOverlapsDateRange(
  sla: SlaPlanningRow,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const sd = parseYmdToLocalDate(toYyyyMmDd(sla.startDate));
  const ed = parseYmdToLocalDate(toYyyyMmDd(sla.endDate));
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
  canonicalClientId?: string,
): SlaPlanningRow[] {
  const byKey = new Map<string, SlaPlanningRow[]>();
  for (const srv of services) {
    if (!isSlaContractActive(srv.status)) continue;
    const key = canonicalClientId
      ? objectiveKeyForClientScope(srv, canonicalClientId)
      : objectiveKeyForSla(srv);
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
  const positions = normalizeServicePositions(srv);
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
  canonicalClientId?: string,
): number {
  if (!rangeStart || !rangeEnd) {
    const vigenteByObjective = new Map<string, SlaPlanningRow>();
    for (const s of services) {
      if (!isSlaContractActive(s.status)) continue;
      const key = canonicalClientId
        ? objectiveKeyForClientScope(s, canonicalClientId)
        : objectiveKeyForSla(s);
      const prev = vigenteByObjective.get(key);
      if (!prev || toYyyyMmDd(s.startDate).localeCompare(toYyyyMmDd(prev.startDate)) > 0) {
        vigenteByObjective.set(key, s);
      }
    }
    return [...vigenteByObjective.values()].reduce(
      (acc, s) => acc + slaHoursForServiceInRange(s, null, null),
      0,
    );
  }
  return pickVigenteSlasForPeriod(services, rangeStart, rangeEnd, canonicalClientId).reduce(
    (acc, s) => acc + slaHoursForServiceInRange(s, rangeStart, rangeEnd),
    0,
  );
}
