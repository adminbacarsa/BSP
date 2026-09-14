import { db } from '@/lib/firebase';
import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, Timestamp, updateDoc,
} from 'firebase/firestore';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import { calcRefuerzoHorasVendidas } from '@/lib/refuerzo/refuerzoProforma';
import { formatRefuerzoFechaAr, formatRefuerzoTimeRange, refuerzoTipoCode } from '@/lib/refuerzo/refuerzoDisplay';
import { appendRefuerzoPuntualSlaTrace } from '@/lib/refuerzo/refuerzoSlaTrace';

export type RefuerzoCancelActor = {
  uid: string;
  name: string;
  pinAuthorizerName: string;
};

const CANCELLABLE = new Set(['APROBADA', 'ASIGNADA', 'COMPLETADA']);

async function collectTurnoIds(sol: SolicitudRefuerzo): Promise<string[]> {
  const ids = new Set<string>((sol.turnoIds || []).filter(Boolean) as string[]);
  if (sol.id) {
    const snap = await getDocs(query(
      collection(db, 'turnos'),
      where('solicitudRefuerzoId', '==', sol.id),
    ));
    snap.docs.forEach((d) => ids.add(d.id));
  }
  return [...ids];
}

async function assertTurnosCancelables(turnoIds: string[]): Promise<void> {
  for (const id of turnoIds) {
    const snap = await getDoc(doc(db, 'turnos', id));
    if (!snap.exists()) continue;
    const data = snap.data();
    if (data.isDeleted === true) continue;
    if (data.isCompleted === true || data.isPresent === true) {
      throw new Error(
        'No se puede eliminar: el turno ya tiene presencia o está completado. Revisá liquidación manualmente.',
      );
    }
  }
}

async function softDeleteTurnos(
  turnoIds: string[],
  actor: RefuerzoCancelActor,
  reason: string,
): Promise<number> {
  let deleted = 0;
  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (const id of turnoIds) {
    const snap = await getDoc(doc(db, 'turnos', id));
    if (!snap.exists() || snap.data()?.isDeleted === true) continue;
    batch.update(doc(db, 'turnos', id), {
      isDeleted: true,
      deletedAt: Timestamp.now(),
      deletedByUid: actor.uid,
      deletedByNombre: actor.name,
      deletedPinAuthorizer: actor.pinAuthorizerName,
      deleteReason: reason,
      cancelledVia: 'SUPERVISION',
    });
    deleted += 1;
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  return deleted;
}

async function closeRefuerzoNovedades(
  solicitudId: string,
  actor: RefuerzoCancelActor,
  reason: string,
): Promise<number> {
  const snap = await getDocs(query(
    collection(db, 'novedades'),
    where('solicitudRefuerzoId', '==', solicitudId),
  ));
  if (snap.empty) return 0;

  let batch = writeBatch(db);
  let ops = 0;
  let closed = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (const d of snap.docs) {
    const data = d.data();
    if (data.status === 'CANCELADA') continue;
    batch.update(d.ref, {
      status: 'CANCELADA',
      viewed: true,
      enGestion: false,
      enGestionBy: null,
      cancelledAt: Timestamp.now(),
      cancelledByUid: actor.uid,
      cancelledByNombre: actor.name,
      cancelReason: reason,
    });
    closed += 1;
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();
  return closed;
}

/** Cancela RFZ/TURA puntual: solicitud, turnos, novedades, trazabilidad SLA. Requiere PIN validado en UI. */
export async function cancelRefuerzoPuntual(
  sol: SolicitudRefuerzo,
  reason: string,
  actor: RefuerzoCancelActor,
): Promise<{ turnosDeleted: number; novedadesClosed: number }> {
  if (!sol.id) throw new Error('Solicitud sin id');
  if (sol.alcance === 'ESTRUCTURAL' || sol.slaApplied) {
    throw new Error('Usá «Revertir +pax» para refuerzos estructurales');
  }
  if (!CANCELLABLE.has(sol.estado)) {
    throw new Error(`No se puede cancelar en estado ${sol.estado}`);
  }
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new Error('Indicá el motivo de cancelación');

  const turnoIds = await collectTurnoIds(sol);
  await assertTurnosCancelables(turnoIds);

  const turnosDeleted = await softDeleteTurnos(turnoIds, actor, trimmedReason);
  const novedadesClosed = await closeRefuerzoNovedades(sol.id, actor, trimmedReason);

  const code = refuerzoTipoCode(sol);
  const hrs = calcRefuerzoHorasVendidas(sol);
  const traceDetail = [
    `Cancelación ${code} · ${formatRefuerzoFechaAr(sol.fecha)} ${formatRefuerzoTimeRange(sol.startTime, sol.endTime)}`,
    sol.parentEmpleadoName || sol.positionName,
    hrs > 0 ? `${hrs}h vendidas revertidas` : null,
    `PIN: ${actor.pinAuthorizerName}`,
    trimmedReason,
  ].filter(Boolean).join(' · ');

  await solicitudRefuerzoService.update(sol.id, {
    estado: 'CANCELADA',
    cancelledAt: Timestamp.now(),
    cancelledByUid: actor.uid,
    cancelledByNombre: actor.name,
    cancelReason: trimmedReason,
    cancelledPinAuthorizer: actor.pinAuthorizerName,
    turnoIds: [],
  });

  await appendRefuerzoPuntualSlaTrace(
    sol,
    'CANCEL_REFUERZO_PUNTUAL',
    traceDetail,
    { uid: actor.uid, name: actor.name },
  );

  return { turnosDeleted, novedadesClosed };
}
