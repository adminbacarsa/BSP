import type { Firestore } from 'firebase-admin/firestore';
import { ObjectiveOperationCache, type OperationVerdict } from '../common/simulableShift';
import { seriesCodeOf } from '../common/shiftSeries';
import { nextBandSlotsFromSlaDoc } from './positionHasContinuity';

export type HandoffKind = 'CONTINUA' | 'FIN_SERVICIO' | 'SIN_FRANJA';

/**
 * La franja siguiente cae en un día que no está en operación (el turno sí lo estaba):
 * fin del servicio, sin retención ni vacante. Si el objetivo no tiene SLA fechado,
 * se mantiene la continuidad estructural (tests y objetivos legacy).
 */
export async function handoffAtEnd(
  db: Firestore,
  shift: Record<string, unknown>,
  end: Date,
  slas: Record<string, unknown>[],
  cache: ObjectiveOperationCache,
): Promise<HandoffKind> {
  const structural = slas.some(
    (sla) => nextBandSlotsFromSlaDoc(sla, String(shift.positionName || ''), end, seriesCodeOf(shift)) != null,
  );
  if (!structural) return 'SIN_FRANJA';
  const startVerdict: OperationVerdict = await cache.operationVerdict(db, shift);
  if (startVerdict !== 'IN') return 'CONTINUA';
  const endVerdict = await cache.operationVerdict(db, {
    empresaId: shift.empresaId,
    objectiveId: shift.objectiveId,
    startTime: end,
  });
  return endVerdict === 'OUT' ? 'FIN_SERVICIO' : 'CONTINUA';
}
