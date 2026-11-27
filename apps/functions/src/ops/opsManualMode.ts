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

/**
 * Pin "Por defecto" del Modo Rápido (empresas/{id}/config/ops.preferModoRapido).
 * Sin esto, con preferencia solo en localStorage el server seguía mandando alertas al CC clásico.
 */
export async function isOpsPreferModoRapido(
  db: Firestore,
  empresaId: string,
): Promise<boolean> {
  const eid = String(empresaId || '').trim();
  if (!eid) return false;
  try {
    const snap = await db.doc(`empresas/${eid}/config/ops`).get();
    return snap.data()?.preferModoRapido === true;
  } catch {
    return false;
  }
}

/** Sala Manual abierta O empresa con Modo Rápido por defecto → sin push/bandeja/cascada/auto-protocolo CC. */
export async function shouldSuppressCcAutoAlerts(
  db: Firestore,
  empresaId: string,
): Promise<boolean> {
  if (await isEmpresaManualMode(db, empresaId)) return true;
  return isOpsPreferModoRapido(db, empresaId);
}
