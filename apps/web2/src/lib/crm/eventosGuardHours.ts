import { isEventosPositionName } from '@/lib/servicios/eventosPosition';

/** Turno del guardia en un evento. La prefactura no lo factura: factura las horas vendidas. */
export function isEventoGuardHoursShift(t: { code?: unknown; type?: unknown; origin?: unknown; positionName?: unknown } | null | undefined): boolean {
  if (!t) return false;
  const code = String(t.code || t.type || '').trim().toUpperCase();
  const origin = String(t.origin || '').trim().toUpperCase();
  if (code === 'EV' || origin === 'EVENTO') return true;
  return code === 'TURA' && isEventosPositionName(t.positionName);
}

/** TURA imputada al puesto Eventos. No entra al contador ni a la grilla de prefactura. */
export function refuerzoImputaPuestoEventos(sol: { tipo?: string; positionName?: string } | null | undefined): boolean {
  if (!sol) return false;
  if (String(sol.tipo || '').toUpperCase() !== 'AGREGADO_TURNO') return false;
  return isEventosPositionName(sol.positionName);
}
