/**
 * Informe mensual por objetivo — realidad COSP (SLA / plan malla / fichadas).
 * El HTML Río Primero es solo referencia de layout; las fórmulas vienen de CRM/Análisis.
 */

import type { ServiceSLA } from '@/services/slaService';
import { resolveTurnoScheduleDateKey, toDateSafe } from '@/lib/crm/crmDateUtils';
import { fichadaHoursForShift, isShiftFichado } from '@/lib/crm/fichadaHours';
import {
  calcPlanificadorShiftHours,
  isPlanificadorPlannedHoursShift,
} from '@/lib/planificacion/planningScheduledHours';
import { calculateSlaHoursForMonth } from '@/lib/servicios/slaHoursCalculator';
import { CCT_HS_TECHO_MENSUAL } from '@/lib/analisis/analisisBolsa';
import {
  employeeDisplayName,
  type CapacityEmployeeInput,
} from '@/lib/servicios/serviceCapacityViability';

const r1 = (n: number) => Math.round(n * 10) / 10;

const BAND_CODES = ['M', 'T', 'N', 'D12', 'N12'] as const;
export type ReportBandCode = (typeof BAND_CODES)[number];

export type BandCounts = Partial<Record<ReportBandCode, number>>;

export type DayCoverageRow = {
  fecha: string;
  dia: number;
  domingo: boolean;
  planHs: number;
  realHs: number;
  planCounts: BandCounts;
  realCounts: BandCounts;
  ok: boolean;
};

export type DayDeviationRow = {
  fecha: string;
  diaSem: string;
  plan: BandCounts & { hs: number };
  real: BandCounts & { hs: number };
  diffs: BandCounts;
};

export type GuardMonthRow = {
  employeeId: string;
  name: string;
  turnosPlan: number;
  turnosFichados: number;
  hsPlan: number;
  hsReal: number;
  bandas: BandCounts;
  overTecho200: boolean;
};

export type FichadaOutlierRow = {
  fecha: string;
  employeeId: string;
  name: string;
  banda: string;
  hsReportadas: number;
  hsUsadas: number;
  nota: string;
};

export type ServiceObjectiveMonthReport = {
  year: number;
  month: number;
  objectiveId: string;
  slaHs: number;
  planHs: number;
  realHs: number;
  gapSlaPlan: number;
  gapPlanReal: number;
  callouts: string[];
  calendario: DayCoverageRow[];
  desvios: DayDeviationRow[];
  guardias: GuardMonthRow[];
  outliers: FichadaOutlierRow[];
  diasIncompletos: number;
};

function isBandCode(c: string): c is ReportBandCode {
  return (BAND_CODES as readonly string[]).includes(c);
}

function bump(counts: BandCounts, code: string, n = 1) {
  const c = code.trim().toUpperCase();
  if (!isBandCode(c)) return;
  counts[c] = (counts[c] || 0) + n;
}

function countsEqual(a: BandCounts, b: BandCounts): boolean {
  for (const code of BAND_CODES) {
    if ((a[code] || 0) !== (b[code] || 0)) return false;
  }
  return true;
}

function formatBandCounts(c: BandCounts): string {
  return BAND_CODES.filter((k) => (c[k] || 0) > 0)
    .map((k) => `${c[k]}${k}`)
    .join(' ') || '—';
}

const DIA_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function shiftDayKey(t: any): string | null {
  return resolveTurnoScheduleDateKey(t);
}

function shiftCode(t: any): string {
  return String(t.code || t.type || '').trim().toUpperCase();
}

function rawFichadaDurationHours(t: any): number | null {
  const rs = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  const re = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  if (!rs || !re) return null;
  const diff = (re.getTime() - rs.getTime()) / 3600000;
  if (!Number.isFinite(diff)) return null;
  const hrs = diff >= 0 ? diff : diff + 24;
  return hrs > 0 ? hrs : null;
}

/**
 * Informe del mes para un objetivo + SLA.
 * `turnos` debe incluir malla y fichadas del objectiveId en el mes.
 */
export function buildServiceObjectiveMonthReport(opts: {
  service: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions' | 'excludedDates' | 'objectiveId'>;
  turnos: any[];
  employees?: CapacityEmployeeInput[];
  year: number;
  /** 0–11 */
  month: number;
  /** Umbral relativo (0–1) para callouts de brecha. Default 5%. */
  gapThreshold?: number;
}): ServiceObjectiveMonthReport {
  const { service, year, month } = opts;
  const threshold = opts.gapThreshold ?? 0.05;
  const objectiveId = String(service.objectiveId || '').trim();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const slaHs = r1(
    calculateSlaHoursForMonth(
      service.positions || [],
      service.startDate || '',
      service.endDate || '',
      service.excludedDates,
      year,
      month,
    ).total,
  );

  const nameById = new Map<string, string>();
  for (const e of opts.employees || []) {
    nameById.set(e.id, employeeDisplayName(e));
  }

  const byDay = new Map<string, { planHs: number; realHs: number; plan: BandCounts; real: BandCounts }>();
  for (let d = 1; d <= daysInMonth; d++) {
    const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    byDay.set(fecha, { planHs: 0, realHs: 0, plan: {}, real: {} });
  }

  type GuardAgg = {
    turnosPlan: number;
    turnosFichados: number;
    hsPlan: number;
    hsReal: number;
    bandas: BandCounts;
    name: string;
  };
  const byGuard = new Map<string, GuardAgg>();

  const ensureGuard = (id: string, fallbackName?: string) => {
    let g = byGuard.get(id);
    if (!g) {
      g = {
        turnosPlan: 0,
        turnosFichados: 0,
        hsPlan: 0,
        hsReal: 0,
        bandas: {},
        name: nameById.get(id) || fallbackName || id,
      };
      byGuard.set(id, g);
    }
    return g;
  };

  const outliers: FichadaOutlierRow[] = [];
  let planHs = 0;
  let realHs = 0;

  for (const t of opts.turnos || []) {
    if (objectiveId && String(t.objectiveId || '').trim() !== objectiveId) continue;
    const day = shiftDayKey(t);
    if (!day || !byDay.has(day)) continue;
    const bucket = byDay.get(day)!;
    const code = shiftCode(t);
    const eid = String(t.employeeId || '').trim();
    const ename = String(t.employeeName || '').trim();

    if (isPlanificadorPlannedHoursShift(t)) {
      const hs = calcPlanificadorShiftHours(t) || 0;
      if (hs > 0) {
        bucket.planHs += hs;
        planHs += hs;
        bump(bucket.plan, code);
        if (eid && eid.toUpperCase() !== 'VACANTE') {
          const g = ensureGuard(eid, ename);
          g.turnosPlan += 1;
          g.hsPlan += hs;
          bump(g.bandas, code);
        }
      }
    }

    if (isShiftFichado(t)) {
      const used = fichadaHoursForShift(t) || 0;
      if (used > 0) {
        bucket.realHs += used;
        realHs += used;
        bump(bucket.real, code);
        if (eid && eid.toUpperCase() !== 'VACANTE') {
          const g = ensureGuard(eid, ename);
          g.turnosFichados += 1;
          g.hsReal += used;
          bump(g.bandas, code);
        }
      }
      const raw = rawFichadaDurationHours(t);
      if (raw != null && (raw > 14 || raw < 0.25) && used > 0) {
        outliers.push({
          fecha: day,
          employeeId: eid,
          name: nameById.get(eid) || ename || eid,
          banda: code || '—',
          hsReportadas: r1(raw),
          hsUsadas: r1(used),
          nota:
            raw > 14
              ? 'Duración bruta anómala; COSP usa hs de banda/fichada normalizada'
              : 'Fichada con duración casi nula; COSP usa hs de banda si aplica',
        });
      }
    }
  }

  planHs = r1(planHs);
  realHs = r1(realHs);

  const calendario: DayCoverageRow[] = [];
  const desvios: DayDeviationRow[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const bucket = byDay.get(fecha)!;
    const dt = new Date(year, month, d, 12, 0, 0, 0);
    const domingo = dt.getDay() === 0;
    const hasPlan = Object.values(bucket.plan).some((n) => (n || 0) > 0) || bucket.planHs > 0;
    const hasReal = Object.values(bucket.real).some((n) => (n || 0) > 0) || bucket.realHs > 0;
    const ok = !hasPlan || (hasReal && countsEqual(bucket.plan, bucket.real));
    calendario.push({
      fecha,
      dia: d,
      domingo,
      planHs: r1(bucket.planHs),
      realHs: r1(bucket.realHs),
      planCounts: bucket.plan,
      realCounts: bucket.real,
      ok: hasPlan ? ok : true,
    });
    if (hasPlan && !ok) {
      const diffs: BandCounts = {};
      for (const code of BAND_CODES) {
        const delta = (bucket.real[code] || 0) - (bucket.plan[code] || 0);
        if (delta !== 0) diffs[code] = delta;
      }
      desvios.push({
        fecha,
        diaSem: DIA_SEM[dt.getDay()],
        plan: { ...bucket.plan, hs: r1(bucket.planHs) },
        real: { ...bucket.real, hs: r1(bucket.realHs) },
        diffs,
      });
    }
  }

  const guardias: GuardMonthRow[] = [...byGuard.entries()]
    .map(([employeeId, g]) => ({
      employeeId,
      name: g.name,
      turnosPlan: g.turnosPlan,
      turnosFichados: g.turnosFichados,
      hsPlan: r1(g.hsPlan),
      hsReal: r1(g.hsReal),
      bandas: g.bandas,
      overTecho200: g.hsReal > CCT_HS_TECHO_MENSUAL || g.hsPlan > CCT_HS_TECHO_MENSUAL,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const callouts: string[] = [];
  if (slaHs > 0 && planHs > 0 && Math.abs(slaHs - planHs) / slaHs > threshold) {
    callouts.push(
      `Brecha SLA vs plan: ${r1(slaHs - planHs)} h (SLA ${slaHs} h · plan malla ${planHs} h).`,
    );
  }
  if (planHs > 0 && Math.abs(planHs - realHs) / planHs > threshold) {
    callouts.push(
      `Brecha plan vs fichadas: ${r1(planHs - realHs)} h (plan ${planHs} h · fichadas ${realHs} h).`,
    );
  }
  if (planHs === 0 && slaHs > 0) {
    callouts.push(`Hay paquete SLA (${slaHs} h) pero no hay horas de plan en malla para este mes.`);
  }
  if (realHs === 0 && planHs > 0) {
    callouts.push('Hay plan en malla pero ninguna fichada real en el mes (reales = 0, no se infiere del plan).');
  }

  return {
    year,
    month,
    objectiveId,
    slaHs,
    planHs,
    realHs,
    gapSlaPlan: r1(slaHs - planHs),
    gapPlanReal: r1(planHs - realHs),
    callouts,
    calendario,
    desvios,
    guardias,
    outliers,
    diasIncompletos: desvios.length,
  };
}

export { formatBandCounts };
