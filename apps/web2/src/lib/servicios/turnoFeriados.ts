import { isArgentineHoliday } from '@/lib/servicios/slaHoursCalculator';

/**
 * «+ feriados» en una franja del servicio: además de sus días de la semana corre los feriados nacionales
 * (Vifood: VFM domingos y feriados). `feriados: true` en el turno del SLA.
 */
export function correFeriado(shift: unknown, dateStr?: string, customFeriados?: ReadonlySet<string>): boolean {
  if (!dateStr) return false;
  const s = shift as { feriados?: unknown } | null | undefined;
  if (s?.feriados !== true) return false;
  return isArgentineHoliday(dateStr) || (customFeriados?.has(dateStr) ?? false);
}
