/**
 * KPIs de higiene de dato y tablero de gestión (unidad de negocio).
 * Solo lectura sobre Demanda / Informe / Financiera / extracto — sin motor paralelo.
 */

import { toDateSafe } from '@/lib/crm/crmDateUtils';
import type { DemandaObjectiveRow } from './analisisQueries';
import type { InformeAnalitico } from './analisisInforme';
import type { FinEmpresaView } from './analisisFinanciera';
import type { HoursBalanceRow } from '@/lib/hoursBalance/types';

const r1 = (n: number) => Math.round(n * 10) / 10;

export type AnalisisCalidadKpis = {
  planPubHs: number;
  planTotalHs: number;
  hsSoloBorrador: number;
  pctMallaPublicada: number;
  realHs: number;
  pctFichada: number;
  pendienteFichadaHs: number;
  presentAtSinIsPresent: number;
  extractPlanHs: number | null;
  extractRealHs: number | null;
  deltaPlanExtractVsMalla: number | null;
  deltaRealExtractVsMalla: number | null;
  mallaVaciaConExtracto: boolean;
  objetivosConSla: number;
  hsSlaSinPlan: number;
  coberturaPlanPct: number;
  coberturaRealPct: number;
  avanceFichadaPct: number;
  opsHs: number;
  eficienciaSlaConsumo: number;
  pctConsumoNovedades: number;
  pctConsumoOps: number;
  pctConsumoIdle: number;
  hsPlanPorGuardia: number;
  hsRealPorGuardia: number;
};

export function sumExtractHours(rows: HoursBalanceRow[]): { plan: number; real: number } {
  let plan = 0;
  let real = 0;
  for (const r of rows) {
    plan += Number(r.plannedHours) || 0;
    real += Number(r.realHours) || 0;
  }
  return { plan: r1(plan), real: r1(real) };
}

/** presentAt seteado sin isPresent/isCompleted — gap Ops ↔ Análisis. */
export function countPresentAtSinIsPresent(turnos: any[]): number {
  let n = 0;
  for (const t of turnos) {
    if (!t || t.isAbsent === true) continue;
    if (t.isPresent === true || t.isCompleted === true) continue;
    const st = String(t.status || '').toUpperCase();
    if (st === 'PRESENT' || st === 'COMPLETED') continue;
    if (toDateSafe(t.presentAt)) n += 1;
  }
  return n;
}

export function buildAnalisisCalidadKpis(opts: {
  demandaTotals: DemandaObjectiveRow;
  informe: InformeAnalitico;
  fin: FinEmpresaView;
  turnos: any[];
  extractRows: HoursBalanceRow[];
  extractReady: boolean;
  mallaReady: boolean;
}): AnalisisCalidadKpis {
  const { demandaTotals: d, informe, fin, turnos, extractRows, extractReady, mallaReady } = opts;
  const planPubHs = r1(d.planHours);
  const planTotalHs = r1(d.planHoursTotal || d.planHours);
  const hsSoloBorrador = r1(Math.max(0, planTotalHs - planPubHs));
  const pctMallaPublicada = planTotalHs > 0
    ? Math.round((planPubHs / planTotalHs) * 1000) / 10
    : (planPubHs > 0 ? 100 : 0);
  const realHs = r1(informe.hsRealizadas);
  const pctFichada = planPubHs > 0
    ? Math.round((realHs / planPubHs) * 1000) / 10
    : 0;
  const pendienteFichadaHs = r1(Math.max(0, planPubHs - realHs));
  const extract = extractReady && extractRows.length > 0 ? sumExtractHours(extractRows) : null;
  const mallaVaciaConExtracto = Boolean(
    extractReady
    && (!mallaReady || turnos.length === 0)
    && extract
    && (extract.plan > 0 || extract.real > 0),
  );
  const objetivosConSla = (fin.objetivos || 0) > 0
    ? fin.objetivos
    : (d.slaHours > 0 ? 1 : 0);
  const hsSlaSinPlan = r1(Math.max(0, d.slaHours - planPubHs));
  const consumo = fin.hsConsumo || 0;
  const idle = (fin.hsFranco || 0) + (fin.hsRet || 0) + (fin.hsDespliegue || 0);
  const guardias = Math.max(1, fin.guardias || informe.dotacionActiva || 1);

  return {
    planPubHs,
    planTotalHs,
    hsSoloBorrador,
    pctMallaPublicada,
    realHs,
    pctFichada,
    pendienteFichadaHs,
    presentAtSinIsPresent: countPresentAtSinIsPresent(turnos),
    extractPlanHs: extract ? extract.plan : null,
    extractRealHs: extract ? extract.real : null,
    deltaPlanExtractVsMalla: extract && turnos.length > 0 ? r1(extract.plan - planPubHs) : null,
    deltaRealExtractVsMalla: extract && turnos.length > 0 ? r1(extract.real - realHs) : null,
    mallaVaciaConExtracto,
    objetivosConSla,
    hsSlaSinPlan,
    coberturaPlanPct: informe.coberturaPlanPct,
    coberturaRealPct: informe.coberturaEfectivaPct,
    avanceFichadaPct: pctFichada,
    opsHs: r1(d.opsHours || fin.hsOps || 0),
    eficienciaSlaConsumo: fin.eficienciaPct || 0,
    pctConsumoNovedades: consumo > 0 ? Math.round(((fin.novedades?.total || 0) / consumo) * 1000) / 10 : 0,
    pctConsumoOps: consumo > 0 ? Math.round(((fin.hsOps || 0) / consumo) * 1000) / 10 : 0,
    pctConsumoIdle: consumo > 0 ? Math.round((idle / consumo) * 1000) / 10 : 0,
    hsPlanPorGuardia: r1(planPubHs / guardias),
    hsRealPorGuardia: r1(realHs / guardias),
  };
}
