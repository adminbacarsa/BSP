import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import type { ConvocatoriaCobertura } from './convocatoriasCobertura';

const PLACEHOLDER_OBJECTIVE = 'Objetivo no indicado';
const PLACEHOLDER_POSITION = 'Puesto no indicado';

function firstText(...vals: Array<string | null | undefined>): string | undefined {
  for (const v of vals) {
    const t = String(v ?? '').trim();
    if (t && t !== 'tu puesto') return t;
  }
  return undefined;
}

function objectiveFromMap(
  map: Record<string, ObjectiveLocation>,
  objectiveId?: string,
  objectiveName?: string,
): string {
  const byId = objectiveId ? map[objectiveId] : undefined;
  const byName = objectiveName ? map[objectiveName] : undefined;
  return (byId?.name || byName?.name || objectiveName || '').trim();
}

/**
 * Objetivo · puesto del ¿Venís? en Hoy.
 * La convocatoria LLEGADA_TARDE a veces no trae nombres: se completan con el turno del guardia.
 */
export function llegadaTardePlaceLabel(
  conv: Pick<
    ConvocatoriaCobertura,
    'shiftId' | 'objectiveId' | 'objectiveName' | 'positionName' | 'clientName'
  >,
  shifts: Shift[] = [],
  objectivesMap: Record<string, ObjectiveLocation> = {},
): string {
  const shift = conv.shiftId ? shifts.find((s) => s.id === conv.shiftId) : undefined;
  const objectiveId = firstText(conv.objectiveId, shift?.objectiveId);
  const objectiveName = firstText(conv.objectiveName, shift?.objectiveName);
  const positionName = firstText(conv.positionName, shift?.positionName);
  const objective = objectiveFromMap(objectivesMap, objectiveId, objectiveName);
  const position = (positionName || '').trim();
  const parts = [objective, position].filter((p) => p && p !== 'tu puesto');
  if (parts.length > 0) return parts.join(' · ');
  return `${PLACEHOLDER_OBJECTIVE} · ${PLACEHOLDER_POSITION}`;
}
