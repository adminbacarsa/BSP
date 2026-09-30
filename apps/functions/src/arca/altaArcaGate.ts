/**
 * Un eventual no ficha si el alta AT de esa empresa no está CONFIRMADA.
 * El turno lleva el estado denormalizado (`eventualAltaArcaConfirmada`): la fichada no lee contratos.
 * Espejo: apps/web2/src/lib/eventuales/arcaEnvios.mjs.
 */
import { ALERTA_ALTA_PENDIENTE_MS } from './arcaEnviosCore';

export function isAltaArcaConfirmada(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift || shift.esEventual !== true) return true;
  return shift.eventualAltaArcaConfirmada === true;
}

export function altaArcaPendienteAlerta(
  shift: Record<string, unknown>,
  nowMs: number,
): { tipo: 'ALTA_ARCA_PENDIENTE'; prioridad: 'ALTA'; contratoId: string | null; minutosAlInicio: number } | null {
  if (isAltaArcaConfirmada(shift)) return null;
  const start = (shift.startTime as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  if (!start) return null;
  if (nowMs < start - ALERTA_ALTA_PENDIENTE_MS) return null;
  return {
    tipo: 'ALTA_ARCA_PENDIENTE',
    prioridad: 'ALTA',
    contratoId: (shift.eventualContratoId as string) || null,
    minutosAlInicio: Math.round((start - nowMs) / 60000),
  };
}
