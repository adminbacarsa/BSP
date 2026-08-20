import { getObjectiveForShift } from '@cosp/portal-core';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';

export type ShiftPlacement = {
  client: string;
  objective: string;
  position: string;
  /** "Cliente · Objetivo · Puesto" (omite vacíos reales; usa placeholders si falta dato) */
  line: string;
  objectiveLocation: ObjectiveLocation | null;
};

const FALLBACK_CLIENT = 'Cliente no indicado';
const FALLBACK_OBJECTIVE = 'Objetivo no indicado';
const FALLBACK_POSITION = 'Puesto no indicado';

/**
 * Resuelve Cliente · Objetivo · Puesto para cards, hero y push.
 * Siempre expone las tres etiquetas (con fallback si falta dato en Firestore).
 */
export function resolveShiftPlacement(
  shift: Shift | null | undefined,
  objectivesMap: Record<string, ObjectiveLocation> = {},
): ShiftPlacement {
  if (!shift) {
    return {
      client: FALLBACK_CLIENT,
      objective: FALLBACK_OBJECTIVE,
      position: FALLBACK_POSITION,
      line: `${FALLBACK_CLIENT} · ${FALLBACK_OBJECTIVE} · ${FALLBACK_POSITION}`,
      objectiveLocation: null,
    };
  }

  const objectiveLocation = getObjectiveForShift(
    objectivesMap,
    shift.objectiveId,
    shift.objectiveName,
  );

  const client = (shift.clientName || objectiveLocation?.clientName || '').trim() || FALLBACK_CLIENT;
  const objective =
    (objectiveLocation?.name || shift.objectiveName || '').trim() || FALLBACK_OBJECTIVE;
  const position = (shift.positionName || '').trim() || FALLBACK_POSITION;

  return {
    client,
    objective,
    position,
    line: `${client} · ${objective} · ${position}`,
    objectiveLocation,
  };
}
