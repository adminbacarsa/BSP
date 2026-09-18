/**
 * Capacidad del plantel para absorber vacaciones sin extras (techo 200)
 * y dosis óptima mensual del derecho anual pendiente.
 */

import {
  countVacationDaysInRange,
  countVacationShiftDaysInMonth,
  dominantShiftFromMalla,
  schemeFromShiftCode,
  vacationCalendarDaysBySeniority,
  yearsSeniorityAt,
} from '@/lib/servicios/serviceCapacityViability';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import { CCT_HS_TECHO_MENSUAL } from './analisisBolsa';

const r1 = (n: number) => Math.round(n * 10) / 10;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = (v as { seconds?: number; _seconds?: number }).seconds
    ?? (v as { _seconds?: number })._seconds;
  if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
  return null;
}

function ymd(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function employeeIngreso(emp: any): Date | null {
  return toDate(emp?.fechaIngreso) || toDate(emp?.startDate) || toDate(emp?.ingreso) || null;
}

export type PlantelVacacionesCapacidad = {
  plantel: number;
  techoMensualHs: number;
  /** Derecho anual CCT (días / hs) por antigüedad. */
  derechoAnualDias: number;
  derechoAnualHs: number;
  tomadasYtdDias: number;
  tomadasYtdHs: number;
  pendienteDias: number;
  pendienteHs: number;
  /** V ya cargadas en el mes del período. */
  vacMesDias: number;
  vacMesHs: number;
  mesesRestantesAnio: number;
  /** Pendiente / meses restantes (hs y días). */
  dosisOptimaMensualHs: number;
  dosisOptimaMensualDias: number;
  /**
   * Holgura bajo techo 200 antes de extras:
   * bolsaInicial − hsLiquidadas (si hay), si no bolsa − plan.
   */
  holguraSinExtrasHs: number;
  /** Cuánto V/mes puede absorber la estructura sin forzar extras. */
  soporteSinExtrasHs: number;
  /** max(0, max(vacMes, dosisOptima) − soporte). */
  gapExtrasForzadasHs: number;
  /** Jornada promedio tipificada del plantel (8/12). */
  jornadaPromedioHs: number;
  conclusion: string;
};

export function buildPlantelVacacionesCapacidad(opts: {
  employees: any[];
  ausencias: any[];
  turnosPeriodo: any[];
  /** Año/mes del período (mes calendario de Análisis). */
  year: number;
  /** 0–11 */
  monthIndex0: number;
  bolsaInicialHs: number;
  /** Hs liquidadas del período (preferido) o plan si aún no hay fichadas. */
  hsConsumoTecho: number;
  tiposNovedad?: NovedadType[];
}): PlantelVacacionesCapacidad {
  const {
    employees,
    ausencias,
    turnosPeriodo,
    year,
    monthIndex0,
    bolsaInicialHs,
    hsConsumoTecho,
    tiposNovedad = [],
  } = opts;

  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const asOf = new Date(year, monthIndex0 + 1, 0, 12, 0, 0, 0);
  const ytdFrom = ymd(year, 0, 1);
  const ytdTo = ymd(year, monthIndex0, daysInMonth);
  const yearEnd = new Date(year, 11, 31, 12, 0, 0, 0);
  const monthStart = new Date(year, monthIndex0, 1, 12, 0, 0, 0);
  const mesesRestantesAnio = Math.max(
    1,
    (yearEnd.getFullYear() - monthStart.getFullYear()) * 12
      + (yearEnd.getMonth() - monthStart.getMonth())
      + 1,
  );

  let derechoAnualDias = 0;
  let tomadasYtdDias = 0;
  let vacMesDias = 0;
  let jornadaSum = 0;
  let jornadaN = 0;

  const plantel = (employees || []).filter((e) => {
    const st = String(e?.status || 'ACTIVE').toUpperCase();
    return st !== 'INACTIVE' && st !== 'BAJA';
  });

  for (const emp of plantel) {
    const eid = String(emp.id || '').trim();
    if (!eid) continue;
    const years = yearsSeniorityAt(employeeIngreso(emp), asOf);
    const vacYear = vacationCalendarDaysBySeniority(years);
    derechoAnualDias += vacYear;

    const taken = countVacationDaysInRange({
      ausencias,
      employeeId: eid,
      fromYmd: ytdFrom,
      toYmd: ytdTo,
      tiposNovedad,
      mode: 'taken',
    });
    tomadasYtdDias += taken;

    const vacShift = countVacationShiftDaysInMonth(turnosPeriodo, eid, year, monthIndex0);
    const vacAus = countVacationDaysInRange({
      ausencias,
      employeeId: eid,
      fromYmd: ymd(year, monthIndex0, 1),
      toYmd: ytdTo,
      tiposNovedad,
      mode: 'any',
    });
    vacMesDias += Math.max(vacShift, vacAus);

    const band = dominantShiftFromMalla(turnosPeriodo, eid, year, monthIndex0);
    const { jornadaHs } = schemeFromShiftCode(band);
    jornadaSum += jornadaHs;
    jornadaN += 1;
  }

  const jornadaPromedioHs = jornadaN > 0 ? r1(jornadaSum / jornadaN) : 8;
  const pendienteDias = Math.max(0, derechoAnualDias - tomadasYtdDias);
  const derechoAnualHs = r1(derechoAnualDias * jornadaPromedioHs);
  const tomadasYtdHs = r1(tomadasYtdDias * jornadaPromedioHs);
  const pendienteHs = r1(pendienteDias * jornadaPromedioHs);
  const vacMesHs = r1(vacMesDias * jornadaPromedioHs);

  const dosisOptimaMensualDias = r1(pendienteDias / mesesRestantesAnio);
  const dosisOptimaMensualHs = r1(pendienteHs / mesesRestantesAnio);

  const holguraSinExtrasHs = r1(Math.max(0, bolsaInicialHs - Math.max(0, hsConsumoTecho)));
  const soporteSinExtrasHs = holguraSinExtrasHs;
  const demandaVMes = Math.max(vacMesHs, dosisOptimaMensualHs);
  const gapExtrasForzadasHs = r1(Math.max(0, demandaVMes - soporteSinExtrasHs));

  let conclusion: string;
  if (plantel.length === 0) {
    conclusion = 'Sin plantel activo para estimar vacaciones.';
  } else if (gapExtrasForzadasHs <= 0.5 && vacMesHs <= soporteSinExtrasHs + 0.5) {
    conclusion = `La estructura absorbe hasta ~${soporteSinExtrasHs.toLocaleString('es-AR')} hs/mes de V sin forzar extras (techo ${CCT_HS_TECHO_MENSUAL}). Dosis óptima del pendiente: ${dosisOptimaMensualHs.toLocaleString('es-AR')} hs/mes (~${dosisOptimaMensualDias} d).`;
  } else if (vacMesHs > dosisOptimaMensualHs + 8) {
    conclusion = `Este mes concentra ${vacMesHs.toLocaleString('es-AR')} hs de V vs óptimo ${dosisOptimaMensualHs.toLocaleString('es-AR')} hs/mes. Holgura ${soporteSinExtrasHs.toLocaleString('es-AR')} hs → riesgo de ~${gapExtrasForzadasHs.toLocaleString('es-AR')} hs extras para cubrir.`;
  } else {
    conclusion = `Pendiente anual ${pendienteHs.toLocaleString('es-AR')} hs → dosificar ~${dosisOptimaMensualHs.toLocaleString('es-AR')} hs/mes. Holgura bajo 200: ${soporteSinExtrasHs.toLocaleString('es-AR')} hs; gap extras estimado ${gapExtrasForzadasHs.toLocaleString('es-AR')} hs.`;
  }

  return {
    plantel: plantel.length,
    techoMensualHs: CCT_HS_TECHO_MENSUAL,
    derechoAnualDias: r1(derechoAnualDias),
    derechoAnualHs,
    tomadasYtdDias: r1(tomadasYtdDias),
    tomadasYtdHs,
    pendienteDias: r1(pendienteDias),
    pendienteHs,
    vacMesDias: r1(vacMesDias),
    vacMesHs,
    mesesRestantesAnio,
    dosisOptimaMensualHs,
    dosisOptimaMensualDias,
    holguraSinExtrasHs,
    soporteSinExtrasHs,
    gapExtrasForzadasHs,
    jornadaPromedioHs,
    conclusion,
  };
}
