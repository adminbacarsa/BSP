/**
 * Pintado rápido de Análisis desde el extracto mensual CRM (`hours_balances`).
 * Misma idea que el dashboard: 1 doc por objetivo/mes, sin bajar la malla de turnos.
 * F/RET/REF, desglose SUS/V/E y guardias llegan cuando carga la malla.
 */

import type { HoursBalanceRow } from '@/lib/hoursBalance';
import type { DemandaObjectiveRow } from './analisisQueries';
import type { AusenciasStats } from './analisisQueries';
import type { FinNovedades, FinObjectiveBase } from './analisisFinanciera';

const r1 = (n: number) => Math.round(n * 10) / 10;

function emptyNov(): FinNovedades {
  return { vac: 0, enf: 0, art: 0, lic: 0, inj: 0, total: 0, eventos: 0, byCode: {} };
}

function emptyDemandaTotals(): DemandaObjectiveRow {
  return {
    id: '_total',
    name: 'Total',
    client: '',
    slaHours: 0,
    planHours: 0,
    extHours: 0,
    adelHours: 0,
    ftHours: 0,
    opsHours: 0,
    vacantHours: 0,
    absenceHours: 0,
    absenceCoveredHours: 0,
    resultante: 0,
    deltaSla: 0,
    deltaPlan: 0,
  };
}

export type HoursBalanceAcc = {
  objectiveId: string;
  objectiveName: string;
  clientId: string;
  clientName: string;
  slaHours: number;
  plannedHours: number;
  realHours: number;
  ftHours: number;
  extHours: number;
  adelHours: number;
  opsHours: number;
  vacantHours: number;
  absenceHours: number;
};

export function sumHoursBalancesByObjective(rows: HoursBalanceRow[]): HoursBalanceAcc[] {
  const byObj = new Map<string, HoursBalanceAcc>();
  for (const r of rows) {
    const id = String(r.objectiveId || '').trim();
    if (!id) continue;
    const prev = byObj.get(id) || {
      objectiveId: id,
      objectiveName: r.objectiveName || id,
      clientId: String(r.clientId || '').trim(),
      clientName: r.clientName || 'Sin Cliente',
      slaHours: 0,
      plannedHours: 0,
      realHours: 0,
      ftHours: 0,
      extHours: 0,
      adelHours: 0,
      opsHours: 0,
      vacantHours: 0,
      absenceHours: 0,
    };
    prev.slaHours += r.slaHours || 0;
    prev.plannedHours += r.plannedHours || 0;
    prev.realHours += r.realHours || 0;
    prev.ftHours += r.ftHours || 0;
    prev.extHours += r.extHours || 0;
    prev.adelHours += r.adelHours || 0;
    prev.opsHours += r.opsHours || 0;
    prev.vacantHours += r.vacantHours || 0;
    prev.absenceHours += r.absenceHours || 0;
    if (!prev.objectiveName && r.objectiveName) prev.objectiveName = r.objectiveName;
    if (!prev.clientName && r.clientName) prev.clientName = r.clientName;
    byObj.set(id, prev);
  }
  return [...byObj.values()].map((a) => ({
    ...a,
    slaHours: r1(a.slaHours),
    plannedHours: r1(a.plannedHours),
    realHours: r1(a.realHours),
    ftHours: r1(a.ftHours),
    extHours: r1(a.extHours),
    adelHours: r1(a.adelHours),
    opsHours: r1(a.opsHours),
    vacantHours: r1(a.vacantHours),
    absenceHours: r1(a.absenceHours),
  }));
}

export function demandaFromHoursBalances(rows: HoursBalanceRow[]): {
  rows: DemandaObjectiveRow[];
  totals: DemandaObjectiveRow;
} {
  const mapped: DemandaObjectiveRow[] = sumHoursBalancesByObjective(rows).map((a) => {
    const planHours = a.plannedHours;
    const resultante = r1(planHours + a.extHours + a.adelHours + a.ftHours + a.opsHours);
    return {
      id: a.objectiveId,
      name: a.objectiveName,
      client: a.clientName,
      slaHours: a.slaHours,
      planHours,
      extHours: a.extHours,
      adelHours: a.adelHours,
      ftHours: a.ftHours,
      opsHours: a.opsHours,
      vacantHours: a.vacantHours,
      absenceHours: a.absenceHours,
      absenceCoveredHours: 0,
      resultante,
      deltaSla: r1(resultante - a.slaHours),
      deltaPlan: r1(resultante - planHours),
    };
  }).filter((r) =>
    r.slaHours > 0 || r.planHours > 0 || r.resultante > 0 || r.vacantHours > 0 || r.absenceHours > 0,
  ).sort((a, b) => (b.slaHours + b.resultante) - (a.slaHours + a.resultante));

  const totals = mapped.reduce<DemandaObjectiveRow>((acc, r) => ({
    ...acc,
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
  }), emptyDemandaTotals());

  return {
    rows: mapped,
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

function overlayNovedades(
  bases: FinObjectiveBase[],
  ausenciasStats: AusenciasStats | null,
): FinObjectiveBase[] {
  if (!ausenciasStats?.detalle?.length) return bases;
  const byOid = new Map<string, FinNovedades>();
  ausenciasStats.detalle.forEach((ev) => {
    const oid = String(ev.objectiveId || '').trim() || 'SIN_OBJETIVO';
    const n = byOid.get(oid) || emptyNov();
    const hs = Number(ev.hs) || 0;
    if (ev.category === 'vac') n.vac += hs;
    else if (ev.category === 'enf') n.enf += hs;
    else if (ev.category === 'art') n.art += hs;
    else if (ev.category === 'inj') n.inj += hs;
    else n.lic += hs;
    n.total += hs;
    n.eventos += 1;
    const code = String(ev.code || '').trim().toUpperCase() || 'L';
    n.byCode[code] = (n.byCode[code] || 0) + hs;
    byOid.set(oid, n);
  });
  const used = new Set<string>();
  const out = bases.map((b) => {
    const n = byOid.get(b.id);
    if (!n) return b;
    used.add(b.id);
    return {
      ...b,
      novedades: {
        vac: r1(n.vac),
        enf: r1(n.enf),
        art: r1(n.art),
        lic: r1(n.lic),
        inj: r1(n.inj),
        total: r1(n.total),
        eventos: n.eventos,
        byCode: Object.fromEntries(Object.entries(n.byCode).map(([k, v]) => [k, r1(v)])),
      },
    };
  });
  byOid.forEach((n, oid) => {
    if (used.has(oid)) return;
    out.push({
      id: oid,
      name: oid === 'SIN_OBJETIVO' ? 'Sin objetivo (licencia sin puesto en malla)' : oid,
      clientId: '',
      client: oid === 'SIN_OBJETIVO' ? 'Sin asignar' : 'Sin Cliente',
      slaHours: 0,
      hsPlan: 0,
      hsReal: 0,
      hsFt: 0,
      hsExtra: 0,
      hsOps: 0,
      hsFranco: 0,
      hsRet: 0,
      hsDespliegue: 0,
      hsEv: 0,
      hsVacante: 0,
      novedades: {
        vac: r1(n.vac),
        enf: r1(n.enf),
        art: r1(n.art),
        lic: r1(n.lic),
        inj: r1(n.inj),
        total: r1(n.total),
        eventos: n.eventos,
        byCode: Object.fromEntries(Object.entries(n.byCode).map(([k, v]) => [k, r1(v)])),
      },
      guards: [],
    });
  });
  return out;
}

/** Financiera a grano objetivo/cliente. Sin F/RET/REF ni guardias hasta que llegue la malla. */
export function financieraFromHoursBalances(
  rows: HoursBalanceRow[],
  ausenciasStats?: AusenciasStats | null,
): FinObjectiveBase[] {
  const bases: FinObjectiveBase[] = sumHoursBalancesByObjective(rows).map((a) => {
    const nov = emptyNov();
    if (a.absenceHours > 0) {
      nov.total = a.absenceHours;
      nov.lic = a.absenceHours;
    }
    return {
      id: a.objectiveId,
      name: a.objectiveName,
      clientId: a.clientId,
      client: a.clientName,
      slaHours: a.slaHours,
      hsPlan: a.plannedHours,
      hsReal: a.realHours,
      hsFt: a.ftHours,
      hsExtra: r1(a.extHours + a.adelHours),
      hsOps: a.opsHours,
      hsFranco: 0,
      hsRet: 0,
      hsDespliegue: 0,
      hsEv: 0,
      hsVacante: a.vacantHours,
      novedades: nov,
      guards: [],
    };
  });
  return overlayNovedades(bases, ausenciasStats || null);
}
