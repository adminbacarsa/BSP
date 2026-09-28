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
