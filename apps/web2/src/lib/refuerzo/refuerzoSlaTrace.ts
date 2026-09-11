import { doc, getDoc, getDocs, query, collection, where, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  appendSlaChangeLog,
  type SlaChangeAction,
  type SlaChangeLogEntry,
} from '@/services/slaService';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { refuerzoTipoCode } from '@/lib/refuerzo/refuerzoDisplay';

export type RefuerzoTraceActor = { uid?: string; name?: string };

async function resolveSlaRef(sol: SolicitudRefuerzo) {
  if (sol.slaIdAplicado) {
    const slaRef = doc(db, 'servicios_sla', sol.slaIdAplicado);
    const fresh = await getDoc(slaRef);
    if (fresh.exists()) return { slaRef, fresh };
  }
  if (!sol.objectiveId) return null;
  const snap = await getDocs(query(
    collection(db, 'servicios_sla'),
    where('objectiveId', '==', sol.objectiveId),
    where('status', '==', 'active'),
  ));
  if (snap.empty) return null;
  let best = snap.docs[0];
  snap.docs.forEach((d) => {
    const a = (best.data().positions || []).length;
    const b = (d.data().positions || []).length;
    if (b > a) best = d;
  });
  const slaRef = doc(db, 'servicios_sla', best.id);
  const fresh = await getDoc(slaRef);
  if (!fresh.exists()) return null;
  return { slaRef, fresh };
}

/** Registra cancelación o modificación puntual RFZ/TURA en changeLog del SLA (trazabilidad Servicios). */
export async function appendRefuerzoPuntualSlaTrace(
  sol: SolicitudRefuerzo,
  action: Extract<SlaChangeAction, 'CANCEL_REFUERZO_PUNTUAL' | 'MODIFY_REFUERZO_PUNTUAL'>,
  detail: string,
  actor?: RefuerzoTraceActor,
): Promise<void> {
  const resolved = await resolveSlaRef(sol);
  if (!resolved) return;
  const { slaRef, fresh } = resolved;
  const data = fresh.data();
  const code = refuerzoTipoCode(sol);
  const logEntry: Omit<SlaChangeLogEntry, 'at'> = {
    action,
    detail: `${code}: ${detail}`,
    ...(actor?.uid ? { byUid: actor.uid } : {}),
    ...(actor?.name ? { byName: actor.name } : {}),
    ...(sol.id ? { solicitudId: sol.id } : {}),
    ...((sol.positionId || sol.slaAppliedPositionId)
      ? { positionId: sol.positionId || sol.slaAppliedPositionId }
      : {}),
    ...(sol.positionName ? { positionName: sol.positionName } : {}),
    ...((sol.shiftCode || sol.slaAppliedShiftCode)
      ? { shiftCode: sol.shiftCode || sol.slaAppliedShiftCode }
      : {}),
  };
  await updateDoc(slaRef, {
    updatedAt: Timestamp.now(),
    changeLog: appendSlaChangeLog(data.changeLog as SlaChangeLogEntry[] | undefined, logEntry),
  });
}
