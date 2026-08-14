/**
 * Bolsa de hs-hombre realista.
 * 200 hs/mes es el TECHO CCT por vigilador, no el promedio que entrega.
 * Capacidad = plantilla ACTIVE × 200 × (1 − índice de ausencia de los 3 meses cerrados previos).
 */

import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import { buildAusenciasStats } from './analisisQueries';
import type { AnalisisPeriodMode } from './analisisUniverso';

export const CCT_HS_TECHO_MENSUAL = 200;

const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export type ThreeMonthLookback = {
  start: Date;
  end: Date;
  months: number;
  label: string;
};

export type BolsaRealista = {
  plantel: number;
  techoMensualGuardia: number;
  techoPeriodoGuardia: number;
  techoBruto: number;
  lookback: ThreeMonthLookback;
  hsAusenciaLookback: number;
  techoLookback: number;
  indice: number;
  indicePct: number;
  tieneHistorial: boolean;
  hsEfectivasGuardia: number;
  bolsaInicial: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Tres meses calendario cerrados anteriores al mes del período. Ago → May–Jul. */
export function threeMonthLookback(periodStart: Date): ThreeMonthLookback {
  const y = periodStart.getFullYear();
  const m = periodStart.getMonth();
  const start = new Date(y, m - 3, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  const label = `${MONTHS_SHORT[start.getMonth()]} ${start.getFullYear()}–${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  return { start, end, months: 3, label };
}

/** Tope 200 hs/mes prorrateado al modo de período. */
export function cctTechoHsPerGuard(mode: AnalisisPeriodMode, daysCount: number): number {
  if (mode === 'quarter') return CCT_HS_TECHO_MENSUAL * 3;
  if (mode === 'semester') return CCT_HS_TECHO_MENSUAL * 6;
  if (mode === 'year') return CCT_HS_TECHO_MENSUAL * 12;
  if (mode === 'month') return CCT_HS_TECHO_MENSUAL;
  return Math.max(1, Math.round(CCT_HS_TECHO_MENSUAL * (Math.max(1, daysCount) / 30)));
}

function activeIdSet(employees: any[]): Set<string> {
  return new Set(
    employees
      .map((e: any) => String(e?.id || '').trim())
      .filter((id) => id && id !== 'VACANTE'),
  );
}

export function buildBolsaRealista(opts: {
  employees: any[];
  ausencias: any[];
  turnosLookback: any[];
  periodMode: AnalisisPeriodMode;
  periodDays: number;
  periodStart: Date;
  tiposNovedad?: NovedadType[];
}): BolsaRealista {
  const plantel = opts.employees.length;
  const lookback = threeMonthLookback(opts.periodStart);
  const techoPeriodoGuardia = cctTechoHsPerGuard(opts.periodMode, opts.periodDays);
  const techoBruto = r1(Math.max(0, plantel) * techoPeriodoGuardia);
  const techoLookback = r1(Math.max(0, plantel) * CCT_HS_TECHO_MENSUAL * lookback.months);

  const ids = activeIdSet(opts.employees);
  const ausencias = (opts.ausencias || []).filter((a: any) => {
    const eid = String(a?.employeeId || '').trim();
    return !eid || ids.has(eid);
  });
  const turnosLookback = (opts.turnosLookback || []).filter((t: any) => {
    const eid = String(t?.employeeId || '').trim();
    return !eid || eid === 'VACANTE' || ids.has(eid);
  });

  const stats = plantel > 0
    ? buildAusenciasStats({
      ausencias,
      turnos: turnosLookback,
      employees: opts.employees,
      periodStart: lookback.start,
      periodEnd: lookback.end,
      capHsPerGuardPeriod: CCT_HS_TECHO_MENSUAL * lookback.months,
      tiposNovedad: opts.tiposNovedad || [],
    })
    : null;

  const hsAusenciaLookback = r1(stats?.hsAfectadas ?? 0);
  const tieneHistorial = (stats?.total ?? 0) > 0 || hsAusenciaLookback > 0;
  const indiceRaw = techoLookback > 0 ? hsAusenciaLookback / techoLookback : 0;
  const indice = Math.min(1, Math.max(0, indiceRaw));
  const hsEfectivasGuardia = r1(techoPeriodoGuardia * (1 - indice));
  const bolsaInicial = r1(Math.max(0, plantel) * hsEfectivasGuardia);

  return {
    plantel,
    techoMensualGuardia: CCT_HS_TECHO_MENSUAL,
    techoPeriodoGuardia,
    techoBruto,
    lookback,
    hsAusenciaLookback,
    techoLookback,
    indice,
    indicePct: r1(indice * 100),
    tieneHistorial,
    hsEfectivasGuardia,
    bolsaInicial,
  };
}
