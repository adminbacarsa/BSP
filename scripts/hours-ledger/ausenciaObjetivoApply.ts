/** Regla de escritura de propose-ausencias-objetivo. Pura: no toca Firestore. */
export const AUSENCIA_OBJETIVO_ASSIGNED_BY = 'propose-ausencias-2026-09-30';

export type AusenciaObjetivoDecision = {
  action: 'APLICAR' | 'DECISION_HUMANA';
  objectiveId: string;
};

/**
 * ALTA, o MEDIA cuyo id está en clients.objetivos (el propuesto o el canónico por nombre).
 * Sin id en clientes (legajo 28lAh3BLC9QG58XooWNC, HELMANN / LOPEZ) queda para decisión humana.
 */
export function classifyAusenciaObjetivo(
  row: { confianza?: string; propuesta?: string; canonicoSugerido?: string },
  clientObjIds: Set<string>,
): AusenciaObjetivoDecision {
  const confianza = String(row.confianza || '');
  const propuesta = String(row.propuesta || '').trim();
  const canon = String(row.canonicoSugerido || '').trim();
  const target = clientObjIds.has(propuesta) ? propuesta : (clientObjIds.has(canon) ? canon : '');
  if ((confianza === 'ALTA' || confianza === 'MEDIA') && target) {
    return { action: 'APLICAR', objectiveId: target };
  }
  return { action: 'DECISION_HUMANA', objectiveId: '' };
}
