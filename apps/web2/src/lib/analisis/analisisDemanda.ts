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
  type AusenciasStats,
  type DemandaObjectiveRow,
  coverageHoursFromShift,
  coverageResultanteHours,
  isFrancoTrabajadoShift,
  isVacantShift,
} from './analisisQueries';

function isAdelantoShift(t: any): boolean {
  return t?.isEarlyStart === true || String(t?.coverageSegmentRole || '').toUpperCase() === 'EARLY_START';
}

function isExtensionShift(t: any): boolean {
  return t?.isExtended === true || String(t?.coverageSegmentRole || '').toUpperCase() === 'EXTENSION';
}

export function buildDemandaByObjective(opts: {
  turnos: any[];
  ausenciasStats: AusenciasStats | null;
  vigenteServices: any[];
  periodStart: Date;
  periodEnd: Date;
  objectiveAliases: Record<string, { canonicalId: string; name: string; clientId?: string }>;
  slaExclusionCtx: any;
}): { rows: DemandaObjectiveRow[]; totals: DemandaObjectiveRow } {
  const { turnos, ausenciasStats, vigenteServices, periodStart, periodEnd, objectiveAliases, slaExclusionCtx } = opts;

  const slaByObj = new Map<string, { name: string; client: string; sla: number }>();
  vigenteServices.forEach((srv: any) => {
    const canonicalId = resolveCanonicalObjectiveId(srv, objectiveAliases) || String(srv.objectiveId ?? '').trim();
    if (!canonicalId) return;
    const hours = slaHoursForServiceInRange(srv, periodStart, periodEnd);
    if (hours <= 0) return;
    const prev = slaByObj.get(canonicalId) || {
      name: srv.objectiveName || canonicalId,
      client: srv.clientName || 'Sin Cliente',
      sla: 0,
    };
    slaByObj.set(canonicalId, { ...prev, sla: prev.sla + hours });
  });

  type Acc = {
    name: string;
    client: string;
    plan: number;
    ext: number;
    adel: number;
    ft: number;
    ops: number;
    vacant: number;
    absence: number;
    absenceCovered: number;
  };
  const byObj = new Map<string, Acc>();
  const touch = (id: string, name: string, client: string): Acc => {
    const row = byObj.get(id) || {
      name, client, plan: 0, ext: 0, adel: 0, ft: 0, ops: 0, vacant: 0, absence: 0, absenceCovered: 0,
    };
    byObj.set(id, row);
    return row;
  };

  slaByObj.forEach((info, id) => touch(id, info.name, info.client));

  turnos.forEach((t: any) => {
    const plannedStart = t.startTime?.seconds ? new Date(t.startTime.seconds * 1000) : null;
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

    const ok =
      resolveCanonicalObjectiveId(t, objectiveAliases) ||
      String(t.objectiveId ?? '').trim() ||
      'SIN_OBJETIVO';
    const slaInfo = slaByObj.get(ok);
    const row = touch(ok, slaInfo?.name || t.objectiveName || ok, slaInfo?.client || t.clientName || 'Sin Cliente');

    const isFt = isFrancoTrabajadoShift(t) && !isVacantShift(t);

    if (isOperationalOriginShift(t) && !isVacantShift(t) && !isProformaVacancyShift(t)) {
      const hs = coverageHoursFromShift(t);
      if (hs > 0) row.ops += hs;
      return;
    }

    if (!isPlanificadorPlannedHoursShift(t) && !isFt) return;
    if (isProformaVacancyShift(t)) return;
    const extra = shiftCoverageExtensionExtraHours(t);
    const gross = isPlanificadorPlannedHoursShift(t)
      ? calcPlanificadorShiftHours(t)
      : coverageHoursFromShift(t);
    const base = Math.max(0, Math.round((gross - extra) * 100) / 100);
    if (isVacantShift(t)) {
      if (base > 0) row.vacant += base;
      return;
    }
    if (base > 0) row.plan += base;
    if (isFt) {
      const ftHs = coverageHoursFromShift(t) || gross;
      if (ftHs > 0) row.ft += ftHs;
    }
    if (extra > 0) {
      if (isAdelantoShift(t) && !isExtensionShift(t)) row.adel += extra;
      else if (isAdelantoShift(t) && isExtensionShift(t)) {
        row.adel += extra / 2;
        row.ext += extra / 2;
      } else row.ext += extra;
    }
  });

  (ausenciasStats?.detalle || []).forEach((ev) => {
    const ok = ev.objectiveId
      ? (resolveCanonicalObjectiveId({ objectiveId: ev.objectiveId }, objectiveAliases) || ev.objectiveId)
      : '';
    if (!ok) return;
    const slaInfo = slaByObj.get(ok);
    const row = touch(ok, slaInfo?.name || ok, slaInfo?.client || 'Sin Cliente');
    row.absence += ev.hs;
    if (ev.covered) row.absenceCovered += ev.hs;
  });

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rows: DemandaObjectiveRow[] = [...byObj.entries()].map(([id, d]) => {
    const slaHours = round1(slaByObj.get(id)?.sla || 0);
    const planHours = round1(d.plan);
    const extHours = round1(d.ext);
    const adelHours = round1(d.adel);
    const ftHours = round1(d.ft);
    const opsHours = round1(d.ops);
    const vacantHours = round1(d.vacant);
    const absenceHours = round1(d.absence);
    const resultante = coverageResultanteHours({ planHours, extHours, adelHours, opsHours });
    return {
      id,
      name: d.name,
      client: d.client,
      slaHours,
      planHours,
      extHours,
      adelHours,
      ftHours,
      opsHours,
      vacantHours,
      absenceHours,
      absenceCoveredHours: round1(d.absenceCovered),
      resultante,
      deltaSla: round1(resultante - slaHours),
      deltaPlan: round1(resultante - planHours),
    };
  }).filter((r) =>
    r.slaHours > 0 || r.planHours > 0 || r.resultante > 0 || r.vacantHours > 0 || r.absenceHours > 0,
  ).sort((a, b) => (b.slaHours + b.resultante) - (a.slaHours + a.resultante));

  const totals = rows.reduce<DemandaObjectiveRow>((acc, r) => ({
    id: '_total',
    name: 'Total',
    client: '',
    slaHours: acc.slaHours + r.slaHours,
    planHours: acc.planHours + r.planHours,
    extHours: acc.extHours + r.extHours,
    adelHours: acc.adelHours + r.adelHours,
    ftHours: acc.ftHours + r.ftHours,
    opsHours: acc.opsHours + r.opsHours,
    vacantHours: acc.vacantHours + r.vacantHours,
    absenceHours: acc.absenceHours + r.absenceHours,
    absenceCoveredHours: acc.absenceCoveredHours + r.absenceCoveredHours,
    resultante: acc.resultante + r.resultante,
    deltaSla: acc.deltaSla + r.deltaSla,
    deltaPlan: acc.deltaPlan + r.deltaPlan,
  }), {
    id: '_total', name: 'Total', client: '', slaHours: 0, planHours: 0, extHours: 0, adelHours: 0,
    ftHours: 0, opsHours: 0, vacantHours: 0, absenceHours: 0, absenceCoveredHours: 0,
    resultante: 0, deltaSla: 0, deltaPlan: 0,
  });

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    rows,
    totals: {
      ...totals,
      slaHours: r1(totals.slaHours),
      planHours: r1(totals.planHours),
      extHours: r1(totals.extHours),
      adelHours: r1(totals.adelHours),
      ftHours: r1(totals.ftHours),
      opsHours: r1(totals.opsHours),
      vacantHours: r1(totals.vacantHours),
      absenceHours: r1(totals.absenceHours),
      absenceCoveredHours: r1(totals.absenceCoveredHours),
      resultante: r1(totals.resultante),
      deltaSla: r1(totals.deltaSla),
      deltaPlan: r1(totals.deltaPlan),
    },
  };
}
