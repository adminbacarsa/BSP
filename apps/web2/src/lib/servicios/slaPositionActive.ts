/**
 * Vigencia de un puesto SLA en una fecha (puro, sin Firebase).
 * `services/slaService.ts` lo re-exporta; el motor del libro de horas lo usa desde Functions.
 */
export function isPositionActiveOnDate(
  pos: { status?: string; inactiveFrom?: string } | null | undefined,
  dateStr: string,
): boolean {
  const st = String(pos?.status || 'ACTIVE').toUpperCase();
  if (st !== 'INACTIVE' && st !== 'INACTIVO') return true;
  const from = String(pos?.inactiveFrom || '').slice(0, 10);
  if (!from) return false;
  return String(dateStr || '').slice(0, 10) < from;
}
