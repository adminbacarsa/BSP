/** Límites compartidos para crons v1 del Centro de Control (Fase 2.2). */
export const CRON_V1_RUNTIME = { timeoutSeconds: 540, memory: '512MB' as const };

/** Máximo de turnos/docs por ejecución (el backlog se drena en ticks de 5 min). */
export const CRON_QUERY_MAX_DOCS = 250;

/** Tope de operaciones por batch Firestore (margen bajo 500). */
export const CRON_BATCH_WRITE_LIMIT = 400;

/** Presupuesto de wall-clock antes del timeout de la function (ms). */
export const CRON_MAX_WALL_MS = 8 * 60 * 1000;

export function cronShouldStop(startedAtMs: number, maxWallMs = CRON_MAX_WALL_MS): boolean {
  return Date.now() - startedAtMs >= maxWallMs;
}

export async function commitBatchIfNeeded(
  db: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  opCount: number,
): Promise<{ batch: FirebaseFirestore.WriteBatch; opCount: number }> {
  if (opCount < CRON_BATCH_WRITE_LIMIT) {
    return { batch, opCount };
  }
  await batch.commit();
  return { batch: db.batch(), opCount: 0 };
}
