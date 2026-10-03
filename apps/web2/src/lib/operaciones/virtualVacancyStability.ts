/**
 * Vacantes virtuales del CC (hueco SLA vs turnos reales) — filtro anti-fantasma.
 *
 * Auditoría 02/10: con una malla parcial (primer snapshot desde caché, re-suscripción) el cálculo vio
 * todas las franjas de Peaje sin turnos durante un instante y el CC dibujó 7 vacantes y escribió 10
 * novedades `VACANTE_A_PLANIFICACION` falsas. Regla:
 *  1. Sin un snapshot de `turnos` del servidor no hay vacantes virtuales (la caché puede estar incompleta).
 *  2. Una vacante virtual se dibuja (y recién ahí dispara novedades) cuando lleva `stableMs` seguidos
 *     apareciendo en el cálculo. Si desaparece, la próxima vez arranca de cero.
 */
export const VIRTUAL_VACANCY_STABLE_MS = 60_000;

export interface VirtualVacancyGateInput {
  nowMs: number;
  /** El último snapshot de `turnos` vino del servidor (no `fromCache`). */
  shiftsFromServer: boolean;
  /** Primera vez que se vio cada id (se muta: alta de nuevos, baja de los que ya no están). */
  seenAt: Map<string, number>;
  stableMs?: number;
}

export function stableVirtualVacancies<T extends { id: string }>(vacancies: T[], gate: VirtualVacancyGateInput): T[] {
  const stableMs = gate.stableMs ?? VIRTUAL_VACANCY_STABLE_MS;
  if (!gate.shiftsFromServer) {
    gate.seenAt.clear();
    return [];
  }
  const present = new Set(vacancies.map((v) => v.id));
  for (const id of Array.from(gate.seenAt.keys())) {
    if (!present.has(id)) gate.seenAt.delete(id);
  }
  const out: T[] = [];
  for (const v of vacancies) {
    const first = gate.seenAt.get(v.id);
    if (first == null) {
      gate.seenAt.set(v.id, gate.nowMs);
      continue;
    }
    if (gate.nowMs - first >= stableMs) out.push(v);
  }
  return out;
}
