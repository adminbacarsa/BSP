import { Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * El convocado (RET/ESC/REF/FT/sin turno/ADV) no tiene ausencia automática,
 * ni cuando el hueco es futuro ni cuando ya empezó.
 * Si se pasa la llegada (inicio del hueco si todavía no había arrancado, si no la ETA)
 * + 15 min, `runConvocadoFollowUp` avisa al CC (CONVOCADO_DEMORADO).
 */
export async function runConvocadoAbsentPass(
  _db: Firestore,
  _now: Timestamp,
  _cc?: unknown,
): Promise<number> {
  return 0;
}
