/**
 * Horas de cobertura del mes: cada turno se mira una vez y acredita su día
 * (`coversDateStr` o el deducido). La fila, los puestos y las barras leen el mapa.
 */
import { isPlanningWorkShiftCode } from '@/lib/slaPlanningMatch';
import {
  diaAcreditacionCobertura,
  esTramoCobertura,
} from '@/lib/planificacion/coberturaDiaHueco';
import {
  PLANNING_NON_BILLABLE_CODES,
  type PlanningShiftSlice,
} from '@/lib/planificacion/positionCoverageUnits';
import {
  calcPlanningBillableHoursAttributedToPosition,
  planningShiftBillableBreakdown,
} from '@/lib/planificacion/planningScheduledHours';

export type AportePorDiaYPuesto = Record<string, Record<string, number>>;

type Posicion = { positionName?: string; shifts?: Array<{ code?: string }> };

function codigosValidos(pos: Posicion): Set<string> {
  return new Set(
    (pos.shifts || [])
      .map((s) => String(s.code || '').toUpperCase())
      .filter((c) => c && isPlanningWorkShiftCode(c)),
  );
}

/**
 * `día → puesto → horas`. Recorre cada turno del mes (y el día borde) una sola vez.
 */
export function sumarAportePorDiaYPuesto(input: {
  employees: Array<{ id: string }>;
  dias: string[];
  positions: Posicion[];
  resolveShift: (empId: string, date: string) => PlanningShiftSlice | null | undefined;
  isLeave: (empId: string, date: string, shift: PlanningShiftSlice) => boolean;
  objectiveIdOf: (empId: string, shift: PlanningShiftSlice, date: string) => string;
  selectedObjective: string;
  dominantPositionName: string;
  slaCodeHoursHint?: Record<string, number>;
}): AportePorDiaYPuesto {
  const dias = new Set(input.dias);
  const borde = input.dias.length
    ? (() => {
        const orden = [...input.dias].sort();
        const [y0, m0, d0] = orden[0].split('-').map(Number);
        const [y1, m1, d1] = orden[orden.length - 1].split('-').map(Number);
        const prev = new Date(y0, m0 - 1, d0 - 1);
        const next = new Date(y1, m1 - 1, d1 + 1);
        const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        return [fmt(prev), ...orden, fmt(next)];
      })()
    : [];
  const puestos = input.positions.map((p) => ({
    name: String(p.positionName || 'General'),
    codes: codigosValidos(p),
  }));
  const map: AportePorDiaYPuesto = {};
  const sumar = (dia: string, puesto: string, horas: number) => {
    if (!(horas > 0) || !dias.has(dia)) return;
    if (!map[dia]) map[dia] = {};
    map[dia][puesto] = (map[dia][puesto] || 0) + horas;
  };

  for (const emp of input.employees) {
    for (const docDate of borde) {
      const shift = input.resolveShift(emp.id, docDate);
      if (!shift || shift.isDeleted) continue;
      if (input.isLeave(emp.id, docDate, shift)) continue;
      if (input.objectiveIdOf(emp.id, shift, docDate) !== String(input.selectedObjective)) continue;
      const code = String(shift.code || '').toUpperCase();
      if (PLANNING_NON_BILLABLE_CODES.has(code)) continue;
      const homePos = String(shift.positionName || input.dominantPositionName || 'General');
      const coverPos = String(shift.coversPositionName || homePos);
      const tramo = esTramoCobertura(shift);
      const acredita = diaAcreditacionCobertura(shift, docDate);
      const consultas: Array<{ dia: string; aporte: 'completo' | 'solo-base' | 'solo-tramo' }> = [];
      if (dias.has(docDate)) {
        consultas.push({ dia: docDate, aporte: !tramo || acredita === docDate ? 'completo' : 'solo-base' });
      }
      if (tramo && acredita !== docDate && dias.has(acredita)) {
        consultas.push({ dia: acredita, aporte: 'solo-tramo' });
      }
      for (const consulta of consultas) {
        if (consulta.aporte === 'solo-tramo') {
          const horas = planningShiftBillableBreakdown({ ...shift, positionName: homePos }, input.slaCodeHoursHint).extra;
          sumar(consulta.dia, coverPos, horas);
          continue;
        }
        for (const pos of puestos) {
          const attributed = consulta.aporte === 'solo-base'
            ? planningShiftBillableBreakdown({ ...shift, positionName: homePos }, input.slaCodeHoursHint).base
            : calcPlanningBillableHoursAttributedToPosition(
                { ...shift, positionName: homePos },
                pos.name,
                input.slaCodeHoursHint,
              );
          if (attributed <= 0) continue;
          const isHome = homePos === pos.name;
          if (consulta.aporte === 'solo-base' && !isHome) continue;
          if (isHome && pos.codes.size > 0 && isPlanningWorkShiftCode(code) && !pos.codes.has(code)) continue;
          if (consulta.aporte === 'completo' && !isHome && attributed > 0) {
            sumar(consulta.dia, pos.name, attributed);
            continue;
          }
          if (!isHome && consulta.aporte !== 'completo') continue;
          sumar(consulta.dia, pos.name, attributed);
        }
      }
    }
  }
  return map;
}
