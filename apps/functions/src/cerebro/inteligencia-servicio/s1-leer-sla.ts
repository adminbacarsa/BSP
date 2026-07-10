/**
 * S1 — Leer SLA y derivar necesidades de cobertura.
 *
 * Convierte el documento `servicios_sla` en un array de `CoverageNeed`:
 * una entrada por cada combinación puesto × banda con cantidad, horario y días activos.
 */

import {
  CerebroSLA,
  CerebroPosition,
  CoverageNeed,
  DIAS_SEMANA,
  HORARIOS_BANDA,
} from '../types';

// ─── Función principal ────────────────────────────────────────────────────────

export function leerSlaYDerivarCobertura(sla: CerebroSLA): CoverageNeed[] {
  const needs: CoverageNeed[] = [];

  for (const pos of sla.positions) {
    const baseExcluded = mergeExcluded(sla.excludedDates, pos.excludedDates);

    if (pos.shifts.length === 0) {
      // Sin turnos explícitos → inferir desde coverageType
      const inferidas = inferirBandasDesdeCoverageType(pos.coverageType);
      for (const banda of inferidas) {
        needs.push(buildNeed(pos, banda, pos.activeDays, baseExcluded));
      }
    } else {
      for (const shift of pos.shifts) {
        const diasActivos = shift.days ?? pos.activeDays;
        const activeDays = diasActivos.length > 0 ? diasActivos : [...DIAS_SEMANA];
        needs.push(buildNeed(pos, {
          code: shift.code,
          name: shift.name || shift.code,
          hours: shift.hours,
          startTime: shift.startTime,
          endTime: shift.endTime,
        }, activeDays, baseExcluded));
      }
    }
  }

  return needs;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

interface BandaInferida {
  code: string;
  name: string;
  hours: number;
  startTime: string;
  endTime: string;
}

function buildNeed(
  pos: CerebroPosition,
  banda: BandaInferida,
  diasSemana: string[],
  excludedDates: string[],
): CoverageNeed {
  return {
    puestoId: pos.id,
    puestoName: pos.name,
    banda: banda.code,
    bandaName: banda.name,
    cantSimultaneos: pos.quantity,
    diasSemana,
    horaInicio: banda.startTime,
    horaFin: banda.endTime,
    hours: banda.hours,
    esBanda12h: banda.hours >= 12,
    excludedDates,
  };
}

function inferirBandasDesdeCoverageType(coverageType: string): BandaInferida[] {
  switch (coverageType) {
    case '24hs':
      return [
        HORARIOS_BANDA['M'],
        HORARIOS_BANDA['T'],
        HORARIOS_BANDA['N'],
      ].map((h, i) => ({ code: ['M', 'T', 'N'][i], ...h }));

    case '12hs_diurno':
      return [{ code: 'D12', ...HORARIOS_BANDA['D12'] }];

    case '12hs_nocturno':
      return [{ code: 'N12', ...HORARIOS_BANDA['N12'] }];

    default:
      // Fallback: banda mañana solamente
      return [{ code: 'M', ...HORARIOS_BANDA['M'] }];
  }
}

function mergeExcluded(a?: string[], b?: string[]): string[] {
  const s = new Set([...(a ?? []), ...(b ?? [])]);
  return [...s].sort();
}

// ─── Utilidades exportadas ────────────────────────────────────────────────────

/** Filtra las needs a un día específico del mes (formato YYYY-MM-DD). */
export function filtrarNeedsParaFecha(
  needs: CoverageNeed[],
  fecha: string,
  diaSemana: string,    // L M X J V S D
): CoverageNeed[] {
  return needs.filter(n => {
    if (n.excludedDates.includes(fecha)) return false;
    if (n.diasSemana.length > 0 && !n.diasSemana.includes(diaSemana)) return false;
    return true;
  });
}

/** Agrupa CoverageNeed por banda → suma de cantSimultaneos. */
export function agruparNeedsPorBanda(needs: CoverageNeed[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const n of needs) {
    m[n.banda] = (m[n.banda] ?? 0) + n.cantSimultaneos;
  }
  return m;
}
