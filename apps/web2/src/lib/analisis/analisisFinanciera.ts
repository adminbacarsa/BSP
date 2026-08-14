/**
 * Financiera COSP: consumo de hs-hombre e impacto.
 * Pirámide objetivo → cliente → empresa. Sin precios ni tarifas.
 * Modo planificado | real + novedades (V/L/E/A/AA/PG) + FT + extras.
 */

import {
  calcPlanificadorShiftHours,
  isOperationalOriginShift,
  isPlanificadorPlannedHoursShift,
  shiftCoverageExtensionExtraHours,
} from '@/lib/planificacion/planningScheduledHours';
import { getDateKeyInTimezone } from '@/lib/crm/crmDateUtils';
import { resolveCanonicalObjectiveId } from '@/lib/crm/objectiveIdentity';
import { slaHoursForServiceInRange } from '@/lib/crm/slaObjectiveHours';
import { isTurnoOnSlaExcludedSlot } from '@/lib/crm/slaExclusionForPlanned';
import { isProformaVacancyShift } from '@/lib/crm/proformaVacancy';
import {
  type AbsenceEvent,
  type AusenciasStats,
  coverageHoursFromShift,
  isFrancoTrabajadoShift,
  isVacantShift,
  shiftStartMs,
} from './analisisQueries';

export type FinHoursMode = 'planned' | 'real';

export type FinNovedades = {
  vac: number;
  enf: number;
  art: number;
  lic: number;
  inj: number;
  total: number;
  eventos: number;
};

export type FinGuardRow = {
  employeeId: string;
  name: string;
  hsPlan: number;
  hsReal: number;
  hsFt: number;
  hsExtra: number;
  hsOps: number;
  hsNovedad: number;
};

export type FinObjectiveBase = {
  id: string;
  name: string;
  clientId: string;
  client: string;
  slaHours: number;
  hsPlan: number;
  hsReal: number;
  hsFt: number;
  hsExtra: number;
  hsOps: number;
  hsVacante: number;
  novedades: FinNovedades;
  guards: FinGuardRow[];
};

export type FinViewRow = FinObjectiveBase & {
  hsMalla: number;
  hsConsumo: number;
  hsPerdida: number;
  guardias: number;
  hsSlaPorGuardia: number;
  hsConsumoPorGuardia: number;
  eficienciaPct: number;
  deltaVsSla: number;
};

export type FinClientView = {
  id: string;
  name: string;
  objetivos: number;
  slaHours: number;
  hsMalla: number;
  hsPlan: number;
  hsReal: number;
  hsFt: number;
  hsExtra: number;
  hsOps: number;
  hsVacante: number;
  novedades: FinNovedades;
  hsConsumo: number;
  hsPerdida: number;
  guardias: number;
  hsSlaPorGuardia: number;
  hsConsumoPorGuardia: number;
  eficienciaPct: number;
  deltaVsSla: number;
  rows: FinViewRow[];
};

export type FinEmpresaView = {
  clientes: number;
  objetivos: number;
  slaHours: number;
  hsMalla: number;
  hsPlan: number;
  hsReal: number;
  hsFt: number;
  hsExtra: number;
  hsOps: number;
  hsVacante: number;
  novedades: FinNovedades;
  hsConsumo: number;
  hsPerdida: number;
  guardias: number;
  hsSlaPorGuardia: number;
  hsConsumoPorGuardia: number;
  eficienciaPct: number;
  deltaVsSla: number;
  clients: FinClientView[];
};

const SIN_OBJETIVO = 'SIN_OBJETIVO';

export type LeaveAttributionSource = 'ausencia' | 'malla_periodo' | 'malla_historial' | 'legajo' | 'sin_objetivo';

const r1 = (n: number) => Math.round(n * 10) / 10;

function emptyNov(): FinNovedades {
  return { vac: 0, enf: 0, art: 0, lic: 0, inj: 0, total: 0, eventos: 0 };
}

function addNov(a: FinNovedades, b: FinNovedades): FinNovedades {
  return {
    vac: r1(a.vac + b.vac),
    enf: r1(a.enf + b.enf),
    art: r1(a.art + b.art),
    lic: r1(a.lic + b.lic),
    inj: r1(a.inj + b.inj),
    total: r1(a.total + b.total),
    eventos: a.eventos + b.eventos,
  };
}

function bumpNov(n: FinNovedades, ev: AbsenceEvent): void {
  const hs = Number(ev.hs) || 0;
  if (ev.category === 'vac') n.vac += hs;
  else if (ev.category === 'enf') n.enf += hs;
  else if (ev.category === 'art') n.art += hs;
  else if (ev.category === 'inj') n.inj += hs;
  else n.lic += hs;
  n.total += hs;
  n.eventos += 1;
}

function isFichado(t: any): boolean {
  const st = String(t?.status || '').toUpperCase();
  return t?.isPresent === true || t?.isCompleted === true || st === 'PRESENT' || st === 'COMPLETED';
}

function isAusenteTurno(t: any): boolean {
  const st = String(t?.status || '').toUpperCase();
  return t?.isAbsent === true || st === 'ABSENT';
}

function isAdelantoShift(t: any): boolean {
  return t?.isEarlyStart === true || String(t?.coverageSegmentRole || '').toUpperCase() === 'EARLY_START';
}

function isExtensionShift(t: any): boolean {
  return t?.isExtended === true || String(t?.coverageSegmentRole || '').toUpperCase() === 'EXTENSION';
}

function emptyGuard(employeeId: string, name: string): FinGuardRow {
  return { employeeId, name, hsPlan: 0, hsReal: 0, hsFt: 0, hsExtra: 0, hsOps: 0, hsNovedad: 0 };
}

type Acc = {
  name: string;
  clientId: string;
  client: string;
  sla: number;
  plan: number;
  real: number;
  ft: number;
  extra: number;
  ops: number;
  vacant: number;
  novedades: FinNovedades;
  guards: Map<string, FinGuardRow>;
};

function touch(
  map: Map<string, Acc>,
  id: string,
  name: string,
  clientId: string,
  client: string,
): Acc {
  const row = map.get(id) || {
    name,
    clientId,
    client,
    sla: 0,
    plan: 0,
    real: 0,
    ft: 0,
    extra: 0,
    ops: 0,
    vacant: 0,
    novedades: emptyNov(),
    guards: new Map<string, FinGuardRow>(),
  };
  if (!map.has(id)) map.set(id, row);
  if (name && row.name === id) row.name = name;
  if (client && row.client === 'Sin Cliente') row.client = client;
  if (clientId && !row.clientId) row.clientId = clientId;
  return row;
}

function guardOf(acc: Acc, employeeId: string, name: string): FinGuardRow | null {
  const id = String(employeeId || '').trim();
  if (!id || id === 'VACANTE') return null;
  const g = acc.guards.get(id) || emptyGuard(id, name || id);
  if (name && g.name === id) g.name = name;
  acc.guards.set(id, g);
  return g;
}

function uniqueGuards(rows: { guards: FinGuardRow[] }[]): number {
  const ids = new Set<string>();
  rows.forEach((r) => r.guards.forEach((g) => ids.add(g.employeeId)));
  return ids.size;
}

export function finMallaHours(
  row: Pick<FinObjectiveBase, 'hsPlan' | 'hsReal' | 'novedades'>,
  mode: FinHoursMode,
): number {
  if (mode === 'real') return row.hsReal;
  return r1(row.hsPlan + (row.novedades?.total || 0));
}

export function finConsumoHours(row: FinObjectiveBase, mode: FinHoursMode): number {
  const malla = finMallaHours(row, mode);
  const novedad = mode === 'real' ? row.novedades.total : 0;
  return r1(malla + row.hsFt + row.hsExtra + row.hsOps + novedad);
}

export function finGuardConsumo(g: FinGuardRow, mode: FinHoursMode): number {
  const malla = mode === 'real' ? g.hsReal : r1(g.hsPlan + g.hsNovedad);
  const novedad = mode === 'real' ? g.hsNovedad : 0;
  return r1(malla + g.hsFt + g.hsExtra + g.hsOps + novedad);
}

function decorate(base: FinObjectiveBase, mode: FinHoursMode): FinViewRow {
  const hsMalla = r1(finMallaHours(base, mode));
  const hsConsumo = finConsumoHours(base, mode);
  const guardias = base.guards.length;
  const hsSlaPorGuardia = guardias > 0 ? r1(base.slaHours / guardias) : 0;
  const hsConsumoPorGuardia = guardias > 0 ? r1(hsConsumo / guardias) : 0;
  const eficienciaPct = hsConsumo > 0 ? Math.round((base.slaHours / hsConsumo) * 1000) / 10 : 0;
  return {
    ...base,
    hsMalla,
    hsConsumo,
    hsPerdida: r1(base.hsVacante),
    guardias,
    hsSlaPorGuardia,
    hsConsumoPorGuardia,
    eficienciaPct,
    deltaVsSla: r1(hsConsumo - base.slaHours),
  };
}

function sumNovedades(rows: FinViewRow[]): FinNovedades {
  return rows.reduce((acc, r) => addNov(acc, r.novedades), emptyNov());
}

function metricsFrom(rows: FinViewRow[], extraGuards?: number) {
  const slaHours = r1(rows.reduce((s, r) => s + r.slaHours, 0));
  const hsMalla = r1(rows.reduce((s, r) => s + r.hsMalla, 0));
  const hsPlan = r1(rows.reduce((s, r) => s + r.hsPlan, 0));
  const hsReal = r1(rows.reduce((s, r) => s + r.hsReal, 0));
  const hsFt = r1(rows.reduce((s, r) => s + r.hsFt, 0));
  const hsExtra = r1(rows.reduce((s, r) => s + r.hsExtra, 0));
  const hsOps = r1(rows.reduce((s, r) => s + r.hsOps, 0));
  const hsVacante = r1(rows.reduce((s, r) => s + r.hsVacante, 0));
  const novedades = sumNovedades(rows);
  const hsConsumo = r1(rows.reduce((s, r) => s + r.hsConsumo, 0));
  const guardias = extraGuards != null ? extraGuards : uniqueGuards(rows);
  return {
    slaHours,
    hsMalla,
    hsPlan,
    hsReal,
    hsFt,
    hsExtra,
    hsOps,
    hsVacante,
    novedades,
    hsConsumo,
    hsPerdida: hsVacante,
    guardias,
    hsSlaPorGuardia: guardias > 0 ? r1(slaHours / guardias) : 0,
    hsConsumoPorGuardia: guardias > 0 ? r1(hsConsumo / guardias) : 0,
    eficienciaPct: hsConsumo > 0 ? Math.round((slaHours / hsConsumo) * 1000) / 10 : 0,
    deltaVsSla: r1(hsConsumo - slaHours),
  };
}

/**
 * Home de un legajo = objetivo donde más horas de malla planificó en el período.
 * Sirve para vacaciones/licencias sin objectiveId.
 */
export function homeObjectiveByEmployee(
  turnos: any[],
  objectiveAliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
): Map<string, string> {
  const acc = new Map<string, Map<string, number>>();
  turnos.forEach((t: any) => {
    if (isVacantShift(t) || isFrancoTrabajadoShift(t)) return;
    if (!isPlanificadorPlannedHoursShift(t)) return;
    const eid = String(t.employeeId || '').trim();
    if (!eid || eid === 'VACANTE') return;
    const oid =
      resolveCanonicalObjectiveId(t, objectiveAliases) ||
      String(t.objectiveId ?? '').trim();
    if (!oid) return;
    const byObj = acc.get(eid) || new Map<string, number>();
    byObj.set(oid, (byObj.get(oid) || 0) + calcPlanificadorShiftHours(t));
    acc.set(eid, byObj);
  });
  const home = new Map<string, string>();
  acc.forEach((byObj, eid) => {
    let best = '';
    let max = -1;
    byObj.forEach((hs, oid) => {
      if (hs > max) {
        max = hs;
        best = oid;
      }
    });
    if (best) home.set(eid, best);
  });
  return home;
}

export function homeFromEmployees(employees: any[]): Map<string, string> {
  const m = new Map<string, string>();
  (employees || []).forEach((e) => {
    const id = String(e?.id || e?.employeeId || '').trim();
    const oid = String(e?.preferredObjectiveId || e?.objectiveId || e?.objetivoId || '').trim();
    if (id && oid) m.set(id, oid);
  });
  return m;
}

/** Último puesto de malla del legajo antes de `beforeDay` (YYYY-MM-DD). */
export function lastPlannedObjectiveBefore(
  turnos: any[],
  employeeId: string,
  beforeDay: string | undefined,
  aliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
): string {
  const eid = String(employeeId || '').trim();
  if (!eid) return '';
  let bestOid = '';
  let bestMs = -1;
  for (const t of turnos) {
    if (String(t.employeeId || '').trim() !== eid) continue;
    if (isVacantShift(t) || isFrancoTrabajadoShift(t)) continue;
    if (!isPlanificadorPlannedHoursShift(t)) continue;
    const ms = shiftStartMs(t);
    if (ms == null) continue;
    if (beforeDay) {
      const day = getDateKeyInTimezone(new Date(ms));
      if (day >= beforeDay) continue;
    }
    if (ms < bestMs) continue;
    const oid =
      resolveCanonicalObjectiveId(t, aliases) ||
      String(t.objectiveId ?? '').trim();
    if (!oid) continue;
    bestMs = ms;
    bestOid = oid;
  }
  return bestOid;
}

export function resolveLeaveObjective(
  ev: AbsenceEvent,
  homePeriod: Map<string, string>,
  homeLookback: Map<string, string>,
  turnosPeriodo: any[],
  turnosHistorial: any[],
  aliases: Record<string, { canonicalId: string; name: string; clientId?: string }>,
  employeeHome?: Map<string, string>,
): { oid: string; source: LeaveAttributionSource } {
  if (ev.objectiveId) {
    const oid = resolveCanonicalObjectiveId({ objectiveId: ev.objectiveId }, aliases) || ev.objectiveId;
    return { oid, source: 'ausencia' };
  }
  const eid = String(ev.employeeId || '').trim();
  const lastPeriod = lastPlannedObjectiveBefore(turnosPeriodo, eid, ev.fromDay, aliases);
  if (lastPeriod) return { oid: lastPeriod, source: 'malla_periodo' };
  const homeP = eid ? homePeriod.get(eid) : '';
  if (homeP) return { oid: homeP, source: 'malla_periodo' };
  const lastHist = lastPlannedObjectiveBefore(turnosHistorial, eid, ev.fromDay, aliases);
  if (lastHist) return { oid: lastHist, source: 'malla_historial' };
  const homeH = eid ? homeLookback.get(eid) : '';
  if (homeH) return { oid: homeH, source: 'malla_historial' };
  const homeEmp = eid && employeeHome ? employeeHome.get(eid) : '';
  if (homeEmp) {
    const oid = resolveCanonicalObjectiveId({ objectiveId: homeEmp }, aliases) || homeEmp;
    return { oid, source: 'legajo' };
  }
  return { oid: SIN_OBJETIVO, source: 'sin_objetivo' };
}

export function buildAnalisisFinanciera(opts: {
  turnos: any[];
  ausenciasStats: AusenciasStats | null;
  vigenteServices: any[];
  periodStart: Date;
  periodEnd: Date;
  objectiveAliases: Record<string, { canonicalId: string; name: string; clientId?: string }>;
  slaExclusionCtx: any;
  /** Malla de meses previos (lookback) para licencias sin objectiveId. */
  turnosHistorial?: any[];
  /** Legajos: preferredObjectiveId como último fallback de puesto. */
  employees?: any[];
}): FinObjectiveBase[] {
  const { turnos, ausenciasStats, vigenteServices, periodStart, periodEnd, objectiveAliases, slaExclusionCtx } = opts;
  const historial = opts.turnosHistorial && opts.turnosHistorial.length ? opts.turnosHistorial : turnos;
  const employeeHome = homeFromEmployees(opts.employees || []);
  const byObj = new Map<string, Acc>();

  vigenteServices.forEach((srv: any) => {
    const canonicalId = resolveCanonicalObjectiveId(srv, objectiveAliases) || String(srv.objectiveId ?? '').trim();
    if (!canonicalId) return;
    const hours = slaHoursForServiceInRange(srv, periodStart, periodEnd);
    if (hours <= 0) return;
    const clientId = String(srv.clientId || objectiveAliases[canonicalId]?.clientId || '').trim();
    const row = touch(
      byObj,
      canonicalId,
      srv.objectiveName || objectiveAliases[canonicalId]?.name || canonicalId,
      clientId,
      srv.clientName || 'Sin Cliente',
    );
    row.sla += hours;
  });

  const homeByEmp = homeObjectiveByEmployee(turnos, objectiveAliases);
  const homeLookback = homeObjectiveByEmployee(historial, objectiveAliases);

  turnos.forEach((t: any) => {
    const ms = shiftStartMs(t);
    const plannedStart = ms != null ? new Date(ms) : (t.startTime?.seconds ? new Date(t.startTime.seconds * 1000) : null);
    const scheduleDateKey = plannedStart ? getDateKeyInTimezone(plannedStart) : '';
    if (
      plannedStart &&
      isTurnoOnSlaExcludedSlot(t, slaExclusionCtx, {
        scheduleDateKey,
        positionName: String(t.positionName ?? ''),
      })
    ) {
      return;
    }

    const oid =
      resolveCanonicalObjectiveId(t, objectiveAliases) ||
      String(t.objectiveId ?? '').trim() ||
      'SIN_OBJETIVO';
    const alias = objectiveAliases[oid];
    const row = touch(
      byObj,
      oid,
      alias?.name || t.objectiveName || oid,
      String(t.clientId || alias?.clientId || '').trim(),
      t.clientName || 'Sin Cliente',
    );
    const g = guardOf(row, t.employeeId, t.employeeName || '');

    if (isFrancoTrabajadoShift(t) && !isVacantShift(t)) {
      const hs = coverageHoursFromShift(t);
      if (hs > 0) {
        row.ft += hs;
        if (g) g.hsFt += hs;
      }
      return;
    }

    if (isOperationalOriginShift(t) && !isVacantShift(t) && !isProformaVacancyShift(t)) {
      const hs = coverageHoursFromShift(t);
      if (hs > 0) {
        row.ops += hs;
        if (g) g.hsOps += hs;
        if (g && isFichado(t) && !isAusenteTurno(t)) g.hsReal += hs;
      }
      return;
    }

    if (!isPlanificadorPlannedHoursShift(t)) return;
    if (isProformaVacancyShift(t)) return;
    const extra = shiftCoverageExtensionExtraHours(t);
    const gross = calcPlanificadorShiftHours(t);
    const base = Math.max(0, Math.round((gross - extra) * 100) / 100);
    if (isVacantShift(t)) {
      if (base > 0) row.vacant += base;
      return;
    }
    if (base > 0) {
      row.plan += base;
      if (g) g.hsPlan += base;
    }
    if (extra > 0) {
      let extraPlan = extra;
      if (isAdelantoShift(t) && isExtensionShift(t)) extraPlan = extra;
      row.extra += extraPlan;
      if (g) g.hsExtra += extraPlan;
    }
    if (g && isFichado(t) && !isAusenteTurno(t)) {
      const done = gross > 0 ? gross : coverageHoursFromShift(t);
      if (done > 0) {
        row.real += done;
        g.hsReal += done;
      }
    }
  });

  (ausenciasStats?.detalle || []).forEach((ev) => {
    const { oid } = resolveLeaveObjective(
      ev,
      homeByEmp,
      homeLookback,
      turnos,
      historial,
      objectiveAliases,
      employeeHome,
    );
    const alias = objectiveAliases[oid];
    const row = touch(
      byObj,
      oid,
      oid === SIN_OBJETIVO
        ? 'Sin objetivo (licencia sin puesto en malla)'
        : (alias?.name || oid),
      String(alias?.clientId || '').trim(),
      oid === SIN_OBJETIVO ? 'Sin asignar' : 'Sin Cliente',
    );
    bumpNov(row.novedades, ev);
    const g = guardOf(row, ev.employeeId, ev.emp);
    if (g) g.hsNovedad += Number(ev.hs) || 0;
  });

  return [...byObj.entries()].map(([id, d]) => {
    const novedades: FinNovedades = {
      vac: r1(d.novedades.vac),
      enf: r1(d.novedades.enf),
      art: r1(d.novedades.art),
      lic: r1(d.novedades.lic),
      inj: r1(d.novedades.inj),
      total: r1(d.novedades.total),
      eventos: d.novedades.eventos,
    };
    const guards = [...d.guards.values()]
      .map((g) => ({
        ...g,
        hsPlan: r1(g.hsPlan),
        hsReal: r1(g.hsReal),
        hsFt: r1(g.hsFt),
        hsExtra: r1(g.hsExtra),
        hsOps: r1(g.hsOps),
        hsNovedad: r1(g.hsNovedad),
      }))
      .sort((a, b) => (b.hsPlan + b.hsReal + b.hsFt + b.hsNovedad) - (a.hsPlan + a.hsReal + a.hsFt + a.hsNovedad));
    return {
      id,
      name: d.name,
      clientId: d.clientId || d.client,
      client: d.client,
      slaHours: r1(d.sla),
      hsPlan: r1(d.plan),
      hsReal: r1(d.real),
      hsFt: r1(d.ft),
      hsExtra: r1(d.extra),
      hsOps: r1(d.ops),
      hsVacante: r1(d.vacant),
      novedades,
      guards,
    };
  }).filter((r) =>
    r.slaHours > 0 || r.hsPlan > 0 || r.hsReal > 0 || r.hsFt > 0 || r.hsVacante > 0 || r.novedades.total > 0 || r.hsOps > 0,
  ).sort((a, b) => (b.slaHours + b.hsPlan) - (a.slaHours + a.hsPlan));
}

export function rollAnalisisFinanciera(bases: FinObjectiveBase[], mode: FinHoursMode): FinEmpresaView {
  const viewRows = bases.map((b) => decorate(b, mode));
  const byClient = new Map<string, FinViewRow[]>();
  viewRows.forEach((r) => {
    const key = r.clientId || r.client || 'SIN_CLIENTE';
    const arr = byClient.get(key) || [];
    arr.push(r);
    byClient.set(key, arr);
  });

  const clients: FinClientView[] = [...byClient.entries()].map(([id, rows]) => {
    const name = rows[0]?.client || id;
    const m = metricsFrom(rows);
    return {
      id,
      name,
      objetivos: rows.length,
      ...m,
      rows: rows.sort((a, b) => b.hsConsumo - a.hsConsumo),
    };
  }).sort((a, b) => b.hsConsumo - a.hsConsumo);

  const empresaMetrics = metricsFrom(viewRows, uniqueGuards(viewRows));
  return {
    clientes: clients.length,
    objetivos: viewRows.length,
    ...empresaMetrics,
    clients,
  };
}
