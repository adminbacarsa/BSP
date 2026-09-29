import { outgoingFor, relieverFor, seriesCodeOf, type SeriesShift } from './shiftSeries';

type NamedShift = SeriesShift & { employeeName?: unknown; code?: unknown };

function personName(shift: NamedShift): string {
  return String(shift.employeeName || 'guardia').trim() || 'guardia';
}

function personCode(shift: NamedShift): string {
  return (seriesCodeOf(shift) || String(shift.code || '')).trim().toUpperCase() || '—';
}

export type SeriesReliefNotice = {
  /** Saliente que `outgoingFor` elige para este entrante. Null si no hay. */
  seriesOutgoingId: string | null;
  /** Null cuando el elegido es el de la serie (o no hay serie contra quién comparar). */
  message: string | null;
};

/**
 * Aviso del modal de ingreso. Si el operador elige un saliente que no es el de la serie,
 * el texto dice a quién le corresponde y qué pasa con el elegido (cierra a su hora o queda retenido).
 */
export function seriesReliefChoiceNotice(
  incoming: NamedShift,
  chosen: NamedShift | null | undefined,
  candidates: readonly NamedShift[],
): SeriesReliefNotice {
  const series = outgoingFor(incoming, candidates);
  const seriesOutgoingId = series?.id ? String(series.id) : null;
  if (!chosen?.id || !series || String(chosen.id) === seriesOutgoingId) {
    return { seriesOutgoingId, message: null };
  }
  const others = candidates.filter((row) => String(row.id || '') !== String(chosen.id));
  const stays = relieverFor(chosen, [...others, incoming]);
  const fate = stays ? 'queda retenido' : 'cierra a su hora';
  const message =
    `A ${personName(incoming)} (${personCode(incoming)}) le corresponde relevar a ${personName(series)} (${personCode(series)}). `
    + `${personName(chosen)} (${personCode(chosen)}) ${fate}.`;
  return { seriesOutgoingId, message };
}
