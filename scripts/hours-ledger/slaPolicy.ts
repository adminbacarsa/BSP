/**
 * SLA del mes (decisión de Mauro).
 * Total = contratos en operación + cerrados del mes (prorrata).
 * En operación = contrato activo + cronograma publicado + cliente activo.
 * El cerrado se muestra aparte y ya está dentro del total.
 */
export const SLA_POLICY = {
  /** Contrato activo sin cronograma publicado. Hoy no entra al total (Shopping Villa María). */
  slaCountsWithoutPublishedPlan: false,
  /** Contrato de un cliente inactivo. Hoy no entra al total. */
  slaCountsInactiveClient: false,
} as const;

export type SlaPolicy = typeof SLA_POLICY;
export type SlaBucket = 'active' | 'inactive' | 'closed' | 'withoutPlan';

export function classifySlaBucket(
  input: {
    closed: boolean;
    contractActive: boolean;
    clientActive: boolean;
    hasPublishedPlan: boolean;
  },
  policy: SlaPolicy = SLA_POLICY,
): SlaBucket {
  if (!input.contractActive) return 'inactive';
  if (input.closed) return 'closed';
  if (!input.clientActive && !policy.slaCountsInactiveClient) return 'inactive';
  if (!input.hasPublishedPlan && !policy.slaCountsWithoutPublishedPlan) return 'withoutPlan';
  return 'active';
}

/** Mismo universo que el SLA del mes: contrato en operación o cerrado vigente. */
export function objectiveInOperation(buckets: readonly SlaBucket[]): boolean {
  return buckets.some((b) => b === 'active' || b === 'closed');
}

const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Reparte las horas reales del mes. `worked` es solo objetivos en operación.
 * El resto queda en `workedOutside` y la suma cierra con el total de persona.
 */
export function assignWorkedShares(
  total: number,
  weights: Record<string, number>,
  inOperation: ReadonlySet<string>,
): {
  worked: number;
  workedOutside: number;
  rows: Array<{ objectiveId: string; worked: number; workedOutside: number }>;
} {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const weightSum = entries.reduce((s, [, w]) => s + w, 0);
  const rows = entries.map(([objectiveId, w]) => {
    const share = weightSum > 0 ? r1(total * (w / weightSum)) : 0;
    const inside = inOperation.has(objectiveId);
    return { objectiveId, worked: inside ? share : 0, workedOutside: inside ? 0 : share };
  });
  const worked = r1(rows.reduce((s, row) => s + row.worked, 0));
  let workedOutside = r1(rows.reduce((s, row) => s + row.workedOutside, 0));
  const gap = r1(total - worked - workedOutside);
  workedOutside = r1(workedOutside + gap);
  return { worked, workedOutside, rows };
}
