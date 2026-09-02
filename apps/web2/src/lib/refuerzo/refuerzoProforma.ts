import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { calcRefuerzoPactadaHours, isSolicitudRefuerzoExtraVendible, refuerzoTipoCode } from './refuerzoDisplay';
import type { ProformaDayCell, ProformaObjectiveGrid, ProformaPositionObjectiveGrid } from '@/lib/crm/proformaTypes';
import { isEventosPosition } from '@/lib/servicios/eventosPosition';

const BILLABLE_ESTADOS = new Set(['APROBADA', 'ASIGNADA', 'COMPLETADA']);

function turaImputacionLegajo(positionName: string): string {
  const name = String(positionName || '').trim();
  if (!name) return 'TUR';
  if (isEventosPosition({ name, coverageType: 'eventos' }) || /^eventos?$/i.test(name)) return 'EVT';
  const compact = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return compact.slice(0, 4) || 'TUR';
}

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
    const billedPos = String(sol.positionName || '').trim();
    const posName = sol.tipo === 'AGREGADO_TURNO'
      ? (billedPos || `TURA · ${sol.parentEmpleadoName || 'Agregado'}`)
      : `RFZ · ${billedPos || 'Refuerzo cliente'}`;
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

function normalizeNameKey(name: string): string {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** TURA imputada a Eventos u otro puesto: suma horas al legajo del guardia ampliado. */
function resolveTuraEmployeeRow(
  grid: ProformaObjectiveGrid,
  sol: SolicitudRefuerzo,
): { rowId: string; rowName: string; legajo: string } {
  const parentId = String(sol.parentEmpleadoId || '').trim();
  const parentName = String(sol.parentEmpleadoName || '').trim();

  if (parentId) {
    const existing = grid.employees.find((e) => e.employeeId === parentId);
    return {
      rowId: parentId,
      rowName: existing?.name || parentName || parentId,
      legajo: existing?.legajo || '',
    };
  }

  if (parentName) {
    const key = normalizeNameKey(parentName);
    const existing = grid.employees.find((e) => normalizeNameKey(e.name) === key);
    if (existing) {
      return { rowId: existing.employeeId, rowName: existing.name, legajo: existing.legajo || '' };
    }
    return {
      rowId: `tura-parent-${key.replace(/[^a-z0-9]+/g, '-')}`,
      rowName: parentName,
      legajo: '',
    };
  }

  const billedPos = String(sol.positionName || '').trim();
  if (billedPos) {
    return {
      rowId: `puesto-${sol.positionId || billedPos}`,
      rowName: billedPos,
      legajo: turaImputacionLegajo(billedPos),
    };
  }

  return {
    rowId: sol.id ? `refuerzo-${sol.id}` : `refuerzo-tura-${String(sol.fecha).slice(0, 10)}`,
    rowName: 'TURA · Agregado',
    legajo: 'TUR',
  };
}

function refuerzoPositionGridLabel(sol: SolicitudRefuerzo): string | null {
  const code = refuerzoTipoCode(sol);
  const billedPos = String(sol.positionName || '').trim();
  if (code === 'TURA') return billedPos || null;
  return billedPos ? `RFZ · ${billedPos}` : 'RFZ · Refuerzo';
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
    const resolved = code === 'TURA'
      ? resolveTuraEmployeeRow(grid, sol)
      : {
          rowId: sol.id ? `refuerzo-${sol.id}` : `refuerzo-${code}-${fecha}-${grid.employees.length}`,
          rowName: code === 'TURA'
            ? `TURA cliente · ${sol.parentEmpleadoName || 'Agregado'}`
            : `RFZ cliente · ${String(sol.positionName || '').trim() || 'Refuerzo'}`,
          legajo: 'RFZ',
        };
    const { rowId, rowName, legajo } = resolved;

    let row = grid.employees.find((e) => e.employeeId === rowId);
    if (!row) {
      row = {
        employeeId: rowId,
        legajo: legajo || (code === 'TURA' ? 'TUR' : 'RFZ'),
        name: rowName,
        days: Object.fromEntries(dateColumns.map((d) => [d, emptyCell(d)])),
        totalHours: 0,
        totalDay: 0,
        totalNight: 0,
      };
      grid.employees.push(row);
    }
    const prevCell = row.days[fecha] || emptyCell(fecha);
    const nextHrs = prevCell.hours + hrs;
    row.days[fecha] = {
      date: fecha,
      display: formatHoursHm(nextHrs),
      hours: nextHrs,
      dayHours: prevCell.dayHours + hrs,
      nightHours: prevCell.nightHours,
    };
    row.totalHours += hrs;
    row.totalDay += hrs;
    grid.dailyTotals[fecha].total += hrs;
    grid.dailyTotals[fecha].day += hrs;
    grid.grandTotal.total += hrs;
    grid.grandTotal.day += hrs;
  }

  return out.sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

/** Agrega horas vendidas RFZ/TURA imputadas a la grilla mensual por puesto. */
export function applyRefuerzoHorasVendidasToPositionGrids(
  grids: ProformaPositionObjectiveGrid[],
  solicitudes: SolicitudRefuerzo[],
  range: { start: Date; end: Date },
): ProformaPositionObjectiveGrid[] {
  const { startYmd, endYmd } = getRangeYmd(range);
  const dateColumns = grids[0]?.dateColumns || listDatesInRange(range.start, range.end);
  const dayLabels = grids[0]?.dayLabels || dayLabelsForColumns(dateColumns);
  const out = grids.map((g) => ({
    ...g,
    positions: g.positions.map((p) => ({ ...p, days: { ...p.days } })),
    dailyTotals: Object.fromEntries(
      Object.entries(g.dailyTotals).map(([k, v]) => [k, { ...v }]),
    ) as ProformaPositionObjectiveGrid['dailyTotals'],
    grandTotal: { ...g.grandTotal },
  }));

  for (const sol of solicitudes) {
    if (!BILLABLE_ESTADOS.has(sol.estado)) continue;
    if (!isSolicitudRefuerzoExtraVendible(sol)) continue;
    if (!solicitudRefuerzoInRange(sol, startYmd, endYmd)) continue;

    const posLabel = refuerzoPositionGridLabel(sol);
    if (!posLabel) continue;

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
        positions: [],
        dailyTotals: Object.fromEntries(dateColumns.map((d) => [d, { total: 0, day: 0, night: 0 }])),
        grandTotal: { total: 0, day: 0, night: 0 },
      };
      out.push(grid);
    }

    let pos = grid.positions.find((p) => p.positionName === posLabel);
    if (!pos) {
      pos = {
        positionName: posLabel,
        days: Object.fromEntries(dateColumns.map((d) => [d, emptyCell(d)])),
        totalHours: 0,
        totalDay: 0,
        totalNight: 0,
      };
      grid.positions.push(pos);
    }

    const prevCell = pos.days[fecha] || emptyCell(fecha);
    const nextHrs = prevCell.hours + hrs;
    pos.days[fecha] = {
      date: fecha,
      display: formatHoursHm(nextHrs),
      hours: nextHrs,
      dayHours: prevCell.dayHours + hrs,
      nightHours: prevCell.nightHours,
    };
    pos.totalHours += hrs;
    pos.totalDay += hrs;
    grid.dailyTotals[fecha].total += hrs;
    grid.dailyTotals[fecha].day += hrs;
    grid.grandTotal.total += hrs;
    grid.grandTotal.day += hrs;
  }

  return out
    .map((g) => ({
      ...g,
      positions: g.positions
        .filter((p) => p.totalHours > 0)
        .sort((a, b) => a.positionName.localeCompare(b.positionName, 'es')),
    }))
    .filter((g) => g.positions.length > 0)
    .sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
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
