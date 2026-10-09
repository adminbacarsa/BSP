/**
 * Cerrar una banda en la vista agrupada: las bandas abiertas de cada objetivo
 * (la misma cuenta que «Puestos sin cerrar») y a qué objetivo se acredita el cierre.
 */

import { analyzeDayCoverageGaps, flattenDayGapsForUi } from './coverageGapAnalysis';
import type { PlanningPositionLike } from './coverageGapAnalysis';
import { listVacancyGapBandOptions } from './vacancyGapBands';
import type { VacancyPositionSla } from './vacancySplitBands';

export type ObjetivoConteoDia = {
  id: string;
  name: string;
  positions: PlanningPositionLike[];
  /** Conteos ya con el crédito Ext/Adel, por puesto. */
  codeCountsByPosition: Record<string, Record<string, number>>;
};

export type BandaAbiertaGrupo = {
  objectiveId: string;
  objectiveName: string;
  positionName: string;
  band: string;
  startTime: string;
  endTime: string;
  horario: string;
  missing: number;
  etiqueta: string;
};

export type AcreditacionCierre = {
  objectiveId: string;
  coversObjectiveId: string;
  coversPositionName: string;
  coversBandCode: string;
  coversDateStr: string;
};

export function claveBandaAbierta(b: Pick<BandaAbiertaGrupo, 'objectiveId' | 'positionName' | 'band'>): string {
  return `${b.objectiveId}|${b.positionName}|${b.band}`;
}

export function etiquetaBandaAbierta(b: {
  objectiveName: string;
  positionName: string;
  band: string;
  horario?: string;
  missing: number;
}): string {
  const banda = [b.band, b.horario].filter(Boolean).join(' ');
  return [b.objectiveName, b.positionName, banda, `falta ${b.missing}`].filter(Boolean).join(' · ');
}

function horarioDeBanda(positions: PlanningPositionLike[], positionName: string, band: string): { startTime: string; endTime: string; horario: string } {
  const opt = listVacancyGapBandOptions(positions as VacancyPositionSla[], positionName)
    .find((o) => String(o.code).toUpperCase() === String(band).toUpperCase());
  const startTime = opt?.startTime || '';
  const endTime = opt?.endTime || '';
  const horario = opt?.scheduleLabel || (startTime && endTime ? `${startTime}–${endTime}` : '');
  return { startTime, endTime, horario };
}

/** Bandas que «Puestos sin cerrar» dejaría abiertas, una fila por objetivo del grupo. */
export function bandasAbiertasDelGrupo(input: {
  objetivos: readonly ObjetivoConteoDia[];
  dateStr: string;
  dayLetter: string;
  cycles?: string[];
}): BandaAbiertaGrupo[] {
  const out: BandaAbiertaGrupo[] = [];
  for (const obj of input.objetivos) {
    const report = analyzeDayCoverageGaps(
      obj.positions,
      input.dateStr,
      input.dayLetter,
      obj.codeCountsByPosition,
      input.cycles,
    );
    for (const row of flattenDayGapsForUi(report)) {
      const band = String(row.gapBand || '').toUpperCase();
      if (!band) continue;
      const horario = horarioDeBanda(obj.positions, row.positionName, band);
      const base = {
        objectiveId: obj.id,
        objectiveName: obj.name,
        positionName: row.positionName,
        band,
        startTime: horario.startTime,
        endTime: horario.endTime,
        horario: horario.horario,
        missing: row.missing,
      };
      out.push({ ...base, etiqueta: etiquetaBandaAbierta(base) });
    }
  }
  return out;
}

/** El cierre queda en el objetivo y la banda elegidos, no en el del guardia. */
export function acreditacionCierreElegido(
  banda: Pick<BandaAbiertaGrupo, 'objectiveId' | 'positionName' | 'band'>,
  dateStr: string,
): AcreditacionCierre {
  return {
    objectiveId: banda.objectiveId,
    coversObjectiveId: banda.objectiveId,
    coversPositionName: banda.positionName,
    coversBandCode: banda.band,
    coversDateStr: dateStr,
  };
}

/**
 * El crédito cierra el objetivo de `coversObjectiveId`.
 * Sin ese campo, sigue el objetivo del turno (vista de un solo objetivo).
 */
export function acreditaCoberturaAlObjetivo(
  shift: { objectiveId?: string | null; coversObjectiveId?: string | null } | null | undefined,
  objectiveId: string,
): boolean {
  if (!shift) return false;
  const cubre = String(shift.coversObjectiveId || '').trim();
  if (cubre) return cubre === String(objectiveId);
  return String(shift.objectiveId || '') === String(objectiveId);
}

/** Un guardia de otro objetivo del grupo puede extender; uno de afuera, no. */
export function objetivoPermitidoParaExtender(
  shiftObjectiveId: string | null | undefined,
  objetivoDelHueco: string,
  objetivosDelGrupo?: readonly string[] | null,
): boolean {
  const id = String(shiftObjectiveId || '').trim();
  if (!id) return true;
  if (id === String(objetivoDelHueco)) return true;
  return !!objetivosDelGrupo?.some((o) => String(o) === id);
}
