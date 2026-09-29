import { Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * El convocado (RET/ESC/REF/FT/sin turno/ADV) no tiene ausencia automática.
 * Si se pasa de la hora estimada, `runConvocadoFollowUp` avisa al CC (CONVOCADO_DEMORADO).
 */
export async function runConvocadoAbsentPass(
  _db: Firestore,
  _now: Timestamp,
  _cc?: unknown,
): Promise<number> {
  return 0;
}
