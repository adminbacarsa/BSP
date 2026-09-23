import type { Firestore } from 'firebase-admin/firestore';

/**
 * Manual = hay al menos una sesión ACTIVO en sesiones_operador no vencida.
 * Mismo criterio que hasRoomManual en useOperatorSession (front).
 */
export async function isEmpresaManualMode(
  db: Firestore,
  empresaId: string,
): Promise<boolean> {
  const eid = String(empresaId || '').trim();
  if (!eid) return false;

  const snap = await db
    .collection('sesiones_operador')
    .where('empresaId', '==', eid)
    .where('status', '==', 'ACTIVO')
    .limit(20)
    .get();

  if (snap.empty) return false;

  const nowMs = Date.now();
  return snap.docs.some((d) => {
    const data = d.data();
    const exp = data.expiresAt as { toMillis?: () => number } | undefined;
    if (exp?.toMillis && exp.toMillis() <= nowMs) return false;
    return true;
  });
}
