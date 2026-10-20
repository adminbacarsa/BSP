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

export type PasoCierreBanda<T = undefined> =
  | { via: 'asignar'; empId: string }
  | { via: '12h'; empIds: string[]; extra: T }
  | { via: 'ft'; empId: string };

export type PlanCierreBandas<T = undefined> = {
  banda: string;
  pedidos: number;
  pasos: PasoCierreBanda<T>[];
  quedaron: number;
};

/**
 * Texto del botón de «Puestos sin cerrar».
 * Una banda: «CERRAR BANDA T». Varias: «CERRAR 2 BANDAS T».
 */
export function textoBotonCerrarBanda(missing: number, banda: string): string {
  const n = Math.max(1, Math.floor(Number(missing) || 1));
  const b = String(banda || '').trim().toUpperCase();
  if (n === 1) return `CERRAR BANDA ${b}`.trim();
  return `CERRAR ${n} BANDAS ${b}`;
}

/** Aviso cuando no alcanzan los candidatos para todas las bandas pedidas. */
export function textoResultadoCierreBanda(input: { banda: string; cerradas: number; quedaron: number }): string {
  const b = String(input.banda || '').trim().toUpperCase();
  const c = Math.max(0, Math.floor(Number(input.cerradas) || 0));
  const q = Math.max(0, Math.floor(Number(input.quedaron) || 0));
  const cerradas = c === 1 ? `Se cerró 1 banda ${b}` : `Se cerraron ${c} bandas ${b}`;
  const quedan = q === 1 ? `Quedó 1 banda ${b} sin cerrar.` : `Quedaron ${q} bandas ${b} sin cerrar.`;
  if (q <= 0) return `${cerradas}.`;
  if (c <= 0) return quedan;
  return `${cerradas}. ${quedan}`;
}

/**
 * Cierra `faltante` bandas del mismo código.
 * Por cada una, el llamador ya ordenó asignables (RET → volante → libre → otro objetivo).
 * Si no queda nadie de 8 h, entra el par de 12 h; si no, el franco (FT).
 * Quien ya cerró una no se vuelve a usar. Si no hay candidato, se corta y `quedaron` dice cuántas faltan.
 */
export function planCerrarBandas<T>(input: {
  banda: string;
  faltante: number;
  asignables: readonly { empId: string }[];
  francos: readonly { empId: string }[];
  par12: (usados: ReadonlySet<string>) => { empIds: readonly string[]; extra: T } | null;
}): PlanCierreBandas<T> {
  const banda = String(input.banda || '').trim().toUpperCase();
  const pedidos = Math.max(0, Math.floor(Number(input.faltante) || 0));
  const usados = new Set<string>();
  const pasos: PasoCierreBanda<T>[] = [];
  let iAsig = 0;
  let iFt = 0;
  const tomarAsignable = (): PasoCierreBanda<T> | null => {
    while (iAsig < input.asignables.length) {
      const empId = String(input.asignables[iAsig++]?.empId || '').trim();
      if (!empId || usados.has(empId)) continue;
      usados.add(empId);
      return { via: 'asignar', empId };
    }
    return null;
  };
  const tomarFranco = (): PasoCierreBanda<T> | null => {
    while (iFt < input.francos.length) {
      const empId = String(input.francos[iFt++]?.empId || '').trim();
      if (!empId || usados.has(empId)) continue;
      usados.add(empId);
      return { via: 'ft', empId };
    }
    return null;
  };
  while (pasos.length < pedidos) {
    const asig = tomarAsignable();
    if (asig) {
      pasos.push(asig);
      continue;
    }
    const par = input.par12(usados);
    const ids = [...new Set((par?.empIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (par && ids.length >= 2 && ids.every((id) => !usados.has(id))) {
      for (const id of ids) usados.add(id);
      pasos.push({ via: '12h', empIds: ids, extra: par.extra });
      continue;
    }
    const ft = tomarFranco();
    if (ft) {
      pasos.push(ft);
      continue;
    }
    break;
  }
  return { banda, pedidos, pasos, quedaron: Math.max(0, pedidos - pasos.length) };
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
