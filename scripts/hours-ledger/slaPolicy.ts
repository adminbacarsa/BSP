/**
 * Decisión única del SLA mensual. Mauro todavía no cerró dos casos;
 * los defaults conservan el comportamiento actual del libro.
 * Cambiar un flag acá y en el test alcanza para dar vuelta la regla.
 */
export const SLA_POLICY = {
  /** (a) Contrato activo sin cronograma publicado entra al SLA activo. Hoy: sí (Shopping Villa María 2 400). */
  slaCountsWithoutPublishedPlan: true,
  /** (b) Contrato activo de un cliente inactivo entra al SLA activo. Hoy: no (Lotería CET Río Ceballos 720). */
  slaCountsInactiveClient: false,
} as const;

export type SlaPolicy = typeof SLA_POLICY;
export type SlaBucket = 'active' | 'inactive' | 'closed' | 'skip';

export function classifySlaBucket(
  input: {
    closed: boolean;
    contractActive: boolean;
    clientActive: boolean;
    hasPublishedPlan: boolean;
  },
  policy: SlaPolicy = SLA_POLICY,
): SlaBucket {
  if (input.closed && input.contractActive) return 'closed';
  if (!input.contractActive) return 'inactive';
  if (!input.clientActive && !policy.slaCountsInactiveClient) return 'inactive';
  if (!input.hasPublishedPlan && !policy.slaCountsWithoutPublishedPlan) return 'skip';
  return 'active';
}
