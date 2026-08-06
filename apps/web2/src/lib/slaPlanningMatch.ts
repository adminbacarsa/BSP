import { slaCoversCalendarMonth, toYyyyMmDd } from '@/lib/firestoreDates';
import { filterSlaRowsByEmpresa } from '@/lib/multiempresa';
import { calculateSlaHoursForMonth } from '@/lib/servicios/slaHoursCalculator';
import type { ServicePosition } from '@/services/slaService';
import {
  derivePlanningPositionActiveDays,
  formatPositionActiveDaysLabel,
  normalizePlanningShifts,
  type PlanningPositionShiftRow,
} from '@/lib/planningPositionDays';

export {
  derivePlanningPositionActiveDays,
  formatPositionActiveDaysLabel,
  type PlanningPositionShiftRow,
} from '@/lib/planningPositionDays';

export type SlaPlanningRow = {
  id?: string;
  clientId?: string;
  objectiveId?: string;
  objectiveName?: string;
  startDate?: unknown;
  endDate?: unknown;
  positions?: unknown;
  status?: string;
  [key: string]: unknown;
};

/** Contrato operativo activo (tolerante a mayúsculas / español). */
export function isSlaContractActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

function normObjectiveKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/** Claves posibles del objetivo seleccionado (id, nombre, variantes). */
export function objectiveMatchKeys(
  selectedObjective: string,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    keys.add(v);
    keys.add(normObjectiveKey(v));
  };
  const sel = String(selectedObjective ?? '').trim();
  if (!sel) return keys;
  add(sel);
  const obj = clientObjetivos?.find(
    (o) =>
      sel === String(o?.id ?? '').trim() ||
      sel === String(o?.name ?? '').trim() ||
      sel === String(o?.objectiveId ?? '').trim(),
  );
  if (obj) {
    add(obj.id);
    add(obj.objectiveId);
    add(obj.name);
    const targetName = normObjectiveKey(obj.name);
    if (targetName && clientObjetivos?.length) {
      for (const o of clientObjetivos) {
        if (normObjectiveKey(o?.name) !== targetName) continue;
        add(o.id);
        add(o.objectiveId);
        add(o.name);
      }
    }
  }
  return keys;
}

/** Mismo objetivo lógico aunque el SLA conserve un objectiveId distinto (restore / legacy). */
export function slaMatchesPlanningObjective(
  sla: SlaPlanningRow,
  selectedObjective: string,
  clientObjetivos?: Array<{ id?: string; name?: string; objectiveId?: string }>,
  slaIdToObjectiveId?: Record<string, string>,
): boolean {
  const keys = objectiveMatchKeys(selectedObjective, clientObjetivos);
  if (slaMatchesObjective(sla, keys, slaIdToObjectiveId)) return true;

  const sel = String(selectedObjective ?? '').trim();
  if (!sel || !clientObjetivos?.length) return false;

  const selObj =
    clientObjetivos.find(
      (o) =>
        sel === String(o?.id ?? '').trim() ||
        sel === String(o?.name ?? '').trim() ||
        sel === String(o?.objectiveId ?? '').trim(),
    ) ?? null;
  const selName = normObjectiveKey(selObj?.name ?? sel);
  const slaName = normObjectiveKey(sla.objectiveName);
  if (selName && slaName && selName === slaName) return true;

  const slaOid = String(sla.objectiveId ?? '').trim();
  if (!slaOid) return false;
  const slaLinked = clientObjetivos.find(
    (o) =>
      slaOid === String(o?.id ?? '').trim() ||
      slaOid === String(o?.objectiveId ?? '').trim() ||
      slaOid === String(o?.name ?? '').trim() ||
      normObjectiveKey(o?.name) === normObjectiveKey(slaOid),
  );
  if (slaLinked && selObj && normObjectiveKey(slaLinked.name) === normObjectiveKey(selObj.name)) {
    return true;
  }
  return false;
}

export function slaMatchesObjective(
  sla: SlaPlanningRow,
  keys: Set<string>,
  slaIdToObjectiveId?: Record<string, string>,
): boolean {
  const candidates = [
    sla.objectiveId,
    sla.objectiveName,
    sla.id && slaIdToObjectiveId?.[sla.id],
  ];
  return candidates.some((c) => {
    const v = String(c ?? '').trim();
    if (!v) return false;
    return keys.has(v) || keys.has(normObjectiveKey(v));
  });
}

export function filterSlasForPlanningTenant<T extends SlaPlanningRow>(
  rows: T[],
  empresaId: string,
  scopeEmpresa: boolean,
  clientIds: Set<string>,
): T[] {
  return filterSlaRowsByEmpresa(rows, empresaId, scopeEmpresa, clientIds);
}

function normClientName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/** Mismo criterio que Servicios: clientId actual o nombre de cliente (restore / clientId legacy). */
export function slaBelongsToPlanningClient(
  sla: SlaPlanningRow,
  selectedClientId: string,
  clients: Array<{ id?: string; name?: string }>,
): boolean {
  const sel = String(selectedClientId ?? '').trim();
  if (!sel) return false;
  const cid = String(sla.clientId ?? '').trim();
  if (cid === sel) return true;
  const row = clients.find((c) => String(c.id ?? '').trim() === sel);
  if (!row) return false;
  const rowName = normClientName(row.name);
  const slaName = normClientName(sla.clientName);
  if (rowName && slaName && rowName === slaName) return true;
  return false;
}

function isLegacySlaClientId(clientId: string, clients: Array<{ id?: string }>): boolean {
  const cid = String(clientId ?? '').trim();
  return !!cid && !clients.some((c) => String(c.id ?? '').trim() === cid);
}

/** Contratos del tenant que aplican al cliente+objetivo en planificación (alineado a Servicios). */
export function filterSlasForPlanningContext<T extends SlaPlanningRow>(
  rows: T[],
  selectedClientId: string,
  selectedObjective: string,
  clients: Array<{ id?: string; name?: string; objetivos?: Array<{ id?: string; name?: string; objectiveId?: string }> }>,
  slaIdToObjectiveId?: Record<string, string>,
): T[] {
  const clientRow = clients.find((c) => c.id === selectedClientId);
  const clientObjetivos = clientRow?.objetivos;
  return rows.filter((d) => {
    if (!slaMatchesPlanningObjective(d, selectedObjective, clientObjetivos, slaIdToObjectiveId)) {
      return false;
    }
    if (slaBelongsToPlanningClient(d, selectedClientId, clients)) return true;
    const cid = String(d.clientId ?? '').trim();
    return isLegacySlaClientId(cid, clients);
  });
}

export function planningMonthHasActiveSla(
  matching: SlaPlanningRow[],
  year: number,
  month: number,
): boolean {
  const { vigente, hasExactMatch } = pickSlaForPlanningMonth(matching, year, month);
  if (hasExactMatch && vigente) return true;
  return matching.some(
    (d) => isSlaContractActive(d.status) && slaCoversCalendarMonth(d.startDate, d.endDate, year, month),
  );
}

export function pickSlaForPlanningMonth(
  matching: SlaPlanningRow[],
  year: number,
  month: number,
): { vigente: SlaPlanningRow | null; hasExactMatch: boolean; fallback: SlaPlanningRow | null } {
  const active = matching.filter((s) => isSlaContractActive(s.status));
  const pool = active.length > 0 ? active : matching;
  const overlapping = pool.filter((d) => slaCoversCalendarMonth(d.startDate, d.endDate, year, month));
  const vigente =
    overlapping.length > 0
      ? [...overlapping].sort((a, b) => toYyyyMmDd(b.startDate).localeCompare(toYyyyMmDd(a.startDate)))[0]
      : null;
  return { vigente, hasExactMatch: !!vigente, fallback: vigente };
}

export function formatSlaRangeHint(rows: SlaPlanningRow[]): string {
  if (!rows.length) return '';
  return rows
    .slice(0, 3)
    .map((s) => `${toYyyyMmDd(s.startDate) || '?'} → ${toYyyyMmDd(s.endDate) || '?'}`)
    .join(' · ');
}

export const DEFAULT_PLANNING_SHIFTS = [
  { code: 'M', hours: 8 },
  { code: 'T', hours: 8 },
  { code: 'N', hours: 8 },
] as const;

export type PlanningPositionRow = {
  positionName: string;
  shifts: PlanningPositionShiftRow[];
  qty: number;
  activeDays: string[];
  coverageType: string;
  excludedDates?: string[];
  preferenciaGenero?: string;
  _serviceId?: string;
  _serviceRange?: string;
};

function parsePlanningPositionQty(pos: Record<string, unknown>): number {
  const rawQty =
    pos.quantity ??
    pos.qty ??
    pos.pax ??
    pos.cant ??
    pos.cantidad ??
    pos.cant_guardias ??
    pos.dotacion ??
    pos.guardias ??
    pos.plazas ??
    pos.cupo ??
    pos.staff ??
    pos.personal ??
    pos.recursos ??
    1;
  const cleanQty = typeof rawQty === 'string' ? rawQty.trim() : rawQty;
  const parsedQty = parseInt(String(cleanQty), 10);
  return !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1;
}

function slaServiceRangeLabel(srv: SlaPlanningRow): string {
  return `${toYyyyMmDd(srv.startDate) || '?'} → ${toYyyyMmDd(srv.endDate) || '?'}`;
}

/** Estructura de puestos para la grilla de planificación (tolerante a puestos sin allowedShiftTypes). */
export function buildPlanningPositionStructure(
  srv: SlaPlanningRow | null | undefined,
  opts: { monthHasSla: boolean; hasExactMatch: boolean },
): { structure: PlanningPositionRow[]; usedSlaFallback: boolean } {
  const slaActive = opts.monthHasSla || opts.hasExactMatch;
  const structure: PlanningPositionRow[] = [];
  const defaultShifts = DEFAULT_PLANNING_SHIFTS.map((s) => ({ ...s }));

  if (srv?.positions) {
    const positionsIterable = Array.isArray(srv.positions)
      ? srv.positions
      : Object.values(srv.positions as Record<string, unknown>);
    for (const raw of positionsIterable) {
      const pos = raw as Record<string, unknown> | null;
      if (!pos) continue;
      const shiftList = pos.allowedShiftTypes ?? pos.shifts;
      const hasShifts = Array.isArray(shiftList) && shiftList.length > 0;
      if (!hasShifts && !slaActive) continue;
      const normalizedShifts = hasShifts
        ? normalizePlanningShifts(shiftList)
        : defaultShifts.map((s) => ({ ...s }));
      const posCoverageType = String(pos.coverageType ?? srv.coverageType ?? '24hs');
      // Para puestos 24hs, D12 y N12 siempre deben estar disponibles en el modal aunque no figuren en el SLA
      if (posCoverageType === '24hs') {
        const existingCodes = new Set(normalizedShifts.map((s) => s.code));
        if (!existingCodes.has('D12')) normalizedShifts.push({ code: 'D12', hours: 12 });
        if (!existingCodes.has('N12')) normalizedShifts.push({ code: 'N12', hours: 12 });
      }
      // Días excluidos: SLA-nivel aplica a todos; posición-nivel solo a este puesto
      const slaExcluded: string[] = Array.isArray((srv as any).excludedDates) ? (srv as any).excludedDates : [];
      const posExcluded: string[] = Array.isArray(pos.excludedDates) ? (pos.excludedDates as string[]) : [];
      const mergedExcluded = [...new Set([...slaExcluded, ...posExcluded])];
      structure.push({
        positionName: String(pos.name ?? pos.positionName ?? 'General'),
        shifts: normalizedShifts,
        qty: parsePlanningPositionQty(pos),
        activeDays: derivePlanningPositionActiveDays(pos.activeDays as string[] | undefined, normalizedShifts),
        coverageType: posCoverageType,
        ...(pos.preferenciaGenero ? { preferenciaGenero: String(pos.preferenciaGenero) } : {}),
        ...(mergedExcluded.length > 0 ? { excludedDates: mergedExcluded } : {}),
        _serviceId: srv.id,
        _serviceRange: slaServiceRangeLabel(srv),
      });
    }
  }

  let usedSlaFallback = false;
  if (structure.length === 0 && slaActive) {
    usedSlaFallback = true;
    const fallbackCoverage = String(srv?.coverageType ?? '24hs');
    const fallbackShifts = defaultShifts.map((s) => ({ ...s })) as PlanningPositionShiftRow[];
    if (fallbackCoverage === '24hs') {
      fallbackShifts.push({ code: 'D12', hours: 12 });
      fallbackShifts.push({ code: 'N12', hours: 12 });
    }
    structure.push({
      positionName: 'General',
      shifts: fallbackShifts,
      qty: 1,
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      coverageType: fallbackCoverage,
      ...(srv?.id ? { _serviceId: srv.id } : {}),
      ...(srv ? { _serviceRange: slaServiceRangeLabel(srv) } : {}),
    });
  }

  return { structure, usedSlaFallback };
}

const PLANNING_FRANCO_OR_ABSENCE = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);

/** Día sin servicio para el puesto (exclusión SLA global o por puesto). */
export function isPlanningPositionExcludedOnDate(
  pos: { excludedDates?: string[] } | null | undefined,
  dateStr: string,
): boolean {
  if (!pos?.excludedDates?.length || !dateStr) return false;
  return pos.excludedDates.includes(dateStr);
}

/** Turnos laborales que no deben asignarse en un día excluido (francos/licencias sí). */
export function isPlanningWorkShiftCode(code: string | undefined | null): boolean {
  const c = String(code || '').toUpperCase();
  if (!c) return false;
  return !PLANNING_FRANCO_OR_ABSENCE.has(c);
}

export function planningPositionExclusionLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  const wd = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dt.getDay()];
  return `${wd} ${d}/${m}`;
}

/** Mapa fecha YYYY-MM-DD → nombres de puestos excluidos ese día (SLA). */
export function buildExcludedPositionsByDate(
  positions: Array<{ positionName: string; excludedDates?: string[] }>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const pos of positions) {
    for (const ds of pos.excludedDates || []) {
      if (!map[ds]) map[ds] = [];
      if (!map[ds].includes(pos.positionName)) map[ds].push(pos.positionName);
    }
  }
  for (const ds of Object.keys(map)) map[ds].sort((a, b) => a.localeCompare(b));
  return map;
}

export function abbrevPlanningPositionName(name: string, max = 6): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '·';
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^puesto$/i.test(parts[0])) {
    const rest = parts.slice(1).join(' ');
    return rest.length > max ? `${rest.slice(0, max - 1)}…` : rest;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function excludedPositionsCellLabel(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return abbrevPlanningPositionName(names[0], 8);
  return `${names.length} puestos`;
}

export function excludedPositionsTooltip(names: string[], dateStr: string): string {
  if (!names.length) return '';
  return `Sin servicio SLA (${planningPositionExclusionLabel(dateStr)}):\n${names.map((n) => `• ${n}`).join('\n')}`;
}

/**
 * Horas SLA vendidas del mes visible en planificación / Auto Lab.
 * Prioriza desglose por puestos/días (como «SLA sim.» en Servicios); totalMonthlyHours solo como fallback.
 */
export function resolvePlanningMonthSlaHours(
  srv: {
    positions?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    excludedDates?: string[];
    totalMonthlyHours?: unknown;
  } | null | undefined,
  year: number,
  month: number,
): number {
  const positions = (Array.isArray(srv?.positions) ? srv.positions : []) as ServicePosition[];
  const startDate = toYyyyMmDd(srv?.startDate);
  const endDate = toYyyyMmDd(srv?.endDate);
  if (positions.length > 0 && startDate && endDate) {
    const row = calculateSlaHoursForMonth(
      positions,
      startDate,
      endDate,
      srv?.excludedDates,
      year,
      month,
    );
    const calculated = Math.round(row.total);
    if (calculated > 0) return calculated;
  }
  return Math.round(Number(srv?.totalMonthlyHours) || 0);
}
