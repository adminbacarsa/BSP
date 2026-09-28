/** Campo Firestore en `empresas/{id}`. Default false → consumidores legacy. */
export const HOURS_CORE_FLAG_FIELD = 'hoursCoreEnabled' as const;

/**
 * Lee el flag de hours-core F1.
 * Default false: prod sin cambio hasta que Mauro active (ej. pruebas_sa).
 */
export function isHoursCoreEnabled(
  empresa: { hoursCoreEnabled?: boolean | null } | null | undefined,
): boolean {
  return empresa?.hoursCoreEnabled === true;
}
