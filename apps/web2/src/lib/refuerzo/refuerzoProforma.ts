import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { calcRefuerzoPactadaHours, isSolicitudRefuerzoExtraVendible, refuerzoTipoCode } from './refuerzoDisplay';
import type { ProformaDayCell, ProformaObjectiveGrid } from '@/lib/crm/proformaTypes';

const BILLABLE_ESTADOS = new Set(['APROBADA', 'ASIGNADA', 'COMPLETADA']);

export function calcRefuerzoHorasVendidas(sol: SolicitudRefuerzo): number {
  const hs = calcRefuerzoPactadaHours(sol.startTime, sol.endTime);
  const code = refuerzoTipoCode(sol);
  const pax = sol.cantidadPax ?? 1;
  return hs * (code === 'RFZ' ? pax : 1);
}

export function solicitudRefuerzoInRange(
  sol: SolicitudRefuerzo,
  startYmd: string,
  endYmd: string,
): boolean {
  const f = String(sol.fecha || '').slice(0, 10);
  if (!f) return false;
  return f >= startYmd && f <= endYmd;
}

export type ProformaBreakdownTarget = {
  total: number;
  byObjective: Record<string, {
    objectiveName: string;
    totalHours: number;
    positions: Record<string, {
      positionName: string;
      totalHours: number;
      byDay: Record<string, number>;
    }>;
  }>;
};

export function applyRefuerzoHorasVendidasToBreakdown(
  target: ProformaBreakdownTarget,
  solicitudes: SolicitudRefuerzo[],
  range: { start: Date; end: Date },
  normalize: (s: string) => string,
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const rangeStart = `${range.start.getFullYear()}-${pad(range.start.getMonth() + 1)}-${pad(range.start.getDate())}`;
  const rangeEnd = `${range.end.getFullYear()}-${pad(range.end.getMonth() + 1)}-${pad(range.end.getDate())}`;

  let added = 0;
  for (const sol of solicitudes) {
    if (!BILLABLE_ESTADOS.has(sol.estado)) continue;
    if (!isSolicitudRefuerzoExtraVendible(sol)) continue;
    if (!solicitudRefuerzoInRange(sol, rangeStart, rangeEnd)) continue;

    const hrs = calcRefuerzoHorasVendidas(sol);
    if (hrs <= 0) continue;

    const objName = sol.objectiveName || 'Objetivo';
    const posName = sol.tipo === 'AGREGADO_TURNO'
      ? `TURA · ${sol.parentEmpleadoName || 'Agregado'}`
      : `RFZ · ${sol.positionName || 'Refuerzo cliente'}`;
    const fecha = String(sol.fecha).slice(0, 10);

    const oKey = normalize(objName);
    target.byObjective[oKey] ||= { objectiveName: objName, totalHours: 0, positions: {} };
    const pKey = normalize(posName);
    target.byObjective[oKey].positions[pKey] ||= { positionName: posName, totalHours: 0, byDay: {} };

    target.byObjective[oKey].totalHours += hrs;
    target.byObjective[oKey].positions[pKey].totalHours += hrs;
    target.byObjective[oKey].positions[pKey].byDay[fecha] =
      (target.byObjective[oKey].positions[pKey].byDay[fecha] || 0) + hrs;
    target.total += hrs;
    added += hrs;
  }
  return added;
}

export function solicitudIdsBilledInRange(
  solicitudes: SolicitudRefuerzo[],
  range: { start: Date; end: Date },
): Set<string> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const rangeStart = `${range.start.getFullYear()}-${pad(range.start.getMonth() + 1)}-${pad(range.start.getDate())}`;
  const rangeEnd = `${range.end.getFullYear()}-${pad(range.end.getMonth() + 1)}-${pad(range.end.getDate())}`;
  const ids = new Set<string>();
  for (const sol of solicitudes) {
    if (!sol.id || !BILLABLE_ESTADOS.has(sol.estado)) continue;
    if (!isSolicitudRefuerzoExtraVendible(sol)) continue;
    if (!solicitudRefuerzoInRange(sol, rangeStart, rangeEnd)) continue;
    ids.add(sol.id);
  }
  return ids;
}

function getRangeYmd(range: { start: Date; end: Date }): { startYmd: string; endYmd: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startYmd: `${range.start.getFullYear()}-${pad(range.start.getMonth() + 1)}-${pad(range.start.getDate())}`,
    endYmd: `${range.end.getFullYear()}-${pad(range.end.getMonth() + 1)}-${pad(range.end.getDate())}`,
  };
}

function listDatesInRange(start: Date, end: Date): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function emptyCell(date: string): ProformaDayCell {
  return { date, display: '', hours: 0, dayHours: 0, nightHours: 0 };
}

function formatHoursHm(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function dayLabelsForColumns(cols: string[]): Record<string, string> {
  const labels = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  return Object.fromEntries(cols.map((d) => {
    const [y, m, day] = d.split('-').map(Number);
    return [d, labels[new Date(y, m - 1, day).getDay()] || ''];
  }));
}

export function applyRefuerzoHorasVendidasToGrids(
  grids: ProformaObjectiveGrid[],
  solicitudes: SolicitudRefuerzo[],
  range: { start: Date; end: Date },
): ProformaObjectiveGrid[] {
  const { startYmd, endYmd } = getRangeYmd(range);
  const dateColumns = grids[0]?.dateColumns || listDatesInRange(range.start, range.end);
  const dayLabels = grids[0]?.dayLabels || dayLabelsForColumns(dateColumns);
  const out = grids.map((g) => ({
    ...g,
    employees: g.employees.map((e) => ({
      ...e,
      days: { ...e.days },
    })),
    dailyTotals: Object.fromEntries(
      Object.entries(g.dailyTotals).map(([k, v]) => [k, { ...v }]),
    ) as ProformaObjectiveGrid['dailyTotals'],
    grandTotal: { ...g.grandTotal },
  }));

  for (const sol of solicitudes) {
    if (!BILLABLE_ESTADOS.has(sol.estado)) continue;
    if (!isSolicitudRefuerzoExtraVendible(sol)) continue;
    if (!solicitudRefuerzoInRange(sol, startYmd, endYmd)) continue;

    const fecha = String(sol.fecha || '').slice(0, 10);
    if (!dateColumns.includes(fecha)) continue;

    const hrs = calcRefuerzoHorasVendidas(sol);
    if (hrs <= 0) continue;

    let grid = out.find((g) => g.objectiveId === sol.objectiveId || g.objectiveName === sol.objectiveName);
    if (!grid) {
      grid = {
        objectiveId: sol.objectiveId || `refuerzo-${sol.clientId || 'cliente'}`,
        objectiveName: sol.objectiveName || 'Objetivo',
        dateColumns,
        dayLabels,
        employees: [],
        dailyTotals: Object.fromEntries(dateColumns.map((d) => [d, { total: 0, day: 0, night: 0 }])),
        grandTotal: { total: 0, day: 0, night: 0 },
      };
      out.push(grid);
    }

    const code = refuerzoTipoCode(sol);
    const rowId = sol.id ? `refuerzo-${sol.id}` : `refuerzo-${code}-${fecha}-${grid.employees.length}`;
    const rowName = code === 'TURA'
      ? `TURA cliente · ${sol.parentEmpleadoName || 'Agregado'}`
      : `RFZ cliente · ${sol.positionName || 'Refuerzo'}`;
    const days = Object.fromEntries(dateColumns.map((d) => [d, emptyCell(d)]));
    days[fecha] = { date: fecha, display: formatHoursHm(hrs), hours: hrs, dayHours: hrs, nightHours: 0 };

    grid.employees.push({
      employeeId: rowId,
      legajo: 'RFZ',
      name: rowName,
      days,
      totalHours: hrs,
      totalDay: hrs,
      totalNight: 0,
    });
    grid.dailyTotals[fecha].total += hrs;
    grid.dailyTotals[fecha].day += hrs;
    grid.grandTotal.total += hrs;
    grid.grandTotal.day += hrs;
  }

  return out.sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

export function countEstructuralesEnRango(
  solicitudes: SolicitudRefuerzo[],
  range: { start: Date; end: Date },
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const rangeStart = `${range.start.getFullYear()}-${pad(range.start.getMonth() + 1)}-${pad(range.start.getDate())}`;
  const rangeEnd = `${range.end.getFullYear()}-${pad(range.end.getMonth() + 1)}-${pad(range.end.getDate())}`;
  return solicitudes.filter((sol) =>
    BILLABLE_ESTADOS.has(sol.estado)
    && !isSolicitudRefuerzoExtraVendible(sol)
    && solicitudRefuerzoInRange(sol, rangeStart, rangeEnd),
  ).length;
}
