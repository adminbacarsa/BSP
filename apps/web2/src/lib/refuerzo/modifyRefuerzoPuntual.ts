import { db } from '@/lib/firebase';
import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, Timestamp, updateDoc,
} from 'firebase/firestore';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import {
  calcRefuerzoHorasVendidas,
} from '@/lib/refuerzo/refuerzoProforma';
import {
  calcRefuerzoPactadaHours,
  formatRefuerzoFechaAr,
  formatRefuerzoTimeRange,
  refuerzoTipoCode,
} from '@/lib/refuerzo/refuerzoDisplay';
import { appendRefuerzoPuntualSlaTrace } from '@/lib/refuerzo/refuerzoSlaTrace';
import { buildRefuerzoTurnoIsoRange, buildTuraContiguousFlag } from '@/lib/refuerzo/refuerzoTurnoTimes';
import type { RefuerzoTraceActor } from '@/lib/refuerzo/refuerzoSlaTrace';

export type ModifyRefuerzoPatch = {
  fecha?: string;
  startTime?: string;
  endTime?: string;
  positionId?: string;
  positionName?: string;
  motivo?: string;
};

const MODIFIABLE = new Set(['APROBADA', 'ASIGNADA']);

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

/** Modifica RFZ/TURA puntual ya aprobada: solicitud, turnos vinculados, novedades y trazabilidad SLA. */
export async function modifyRefuerzoPuntual(
  sol: SolicitudRefuerzo,
  patch: ModifyRefuerzoPatch,
  actor: RefuerzoTraceActor,
): Promise<void> {
  if (!sol.id) throw new Error('Solicitud sin id');
  if (sol.alcance === 'ESTRUCTURAL' || sol.slaApplied) {
    throw new Error('Los refuerzos estructurales no se editan desde acá');
  }
  if (!MODIFIABLE.has(sol.estado)) {
    throw new Error(`Solo se puede modificar en APROBADA o ASIGNADA (actual: ${sol.estado})`);
  }

  const merged: SolicitudRefuerzo = {
    ...sol,
    fecha: patch.fecha?.slice(0, 10) || sol.fecha,
    startTime: patch.startTime?.slice(0, 5) || sol.startTime,
    endTime: patch.endTime?.slice(0, 5) || sol.endTime,
    positionId: patch.positionId !== undefined ? patch.positionId : sol.positionId,
    positionName: patch.positionName !== undefined ? patch.positionName : sol.positionName,
    motivo: patch.motivo !== undefined ? patch.motivo.trim() : sol.motivo,
  };

  if (!merged.fecha || !merged.startTime || !merged.endTime) {
    throw new Error('Fecha y horario son obligatorios');
  }

  const turnoIds = await collectTurnoIds(sol);
  for (const id of turnoIds) {
    const snap = await getDoc(doc(db, 'turnos', id));
    if (!snap.exists() || snap.data()?.isDeleted) continue;
    if (snap.data()?.isCompleted || snap.data()?.isPresent) {
      throw new Error('No se puede modificar: el turno ya tiene presencia o está completado');
    }
  }

  const { startISO, endISO, horasPactadas } = buildRefuerzoTurnoIsoRange(merged);
  const turaContiguous = sol.tipo === 'AGREGADO_TURNO'
    ? await buildTuraContiguousFlag(sol.parentShiftId, merged)
    : undefined;

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
    if (!snap.exists() || snap.data()?.isDeleted) continue;
    const patchTurno: Record<string, unknown> = {
      fecha: merged.fecha,
      startTime: startISO,
      endTime: endISO,
      hours: horasPactadas,
      updatedAt: Timestamp.now(),
      modifiedByUid: actor.uid,
      modifiedByNombre: actor.name,
    };
    if (merged.positionId !== undefined) patchTurno.positionId = merged.positionId || null;
    if (merged.positionName !== undefined) patchTurno.positionName = merged.positionName || null;
    if (turaContiguous !== undefined) patchTurno.turaContiguous = turaContiguous;
    batch.update(doc(db, 'turnos', id), patchTurno);
    ops += 1;
    if (ops >= 400) await flush();
  }
  await flush();

  await solicitudRefuerzoService.update(sol.id, {
    fecha: merged.fecha,
    startTime: merged.startTime,
    endTime: merged.endTime,
    positionId: merged.positionId,
    positionName: merged.positionName,
    motivo: merged.motivo,
    horasTotales: calcRefuerzoPactadaHours(merged.startTime, merged.endTime),
    modifiedAt: Timestamp.now(),
    modifiedByUid: actor.uid,
    modifiedByNombre: actor.name,
  });

  const novSnap = await getDocs(query(
    collection(db, 'novedades'),
    where('solicitudRefuerzoId', '==', sol.id),
  ));
  const hrsVendidas = calcRefuerzoHorasVendidas(merged);
  for (const d of novSnap.docs) {
    await updateDoc(d.ref, {
      horasVendidasEstimadas: hrsVendidas,
      fecha: merged.fecha,
      startTime: merged.startTime,
      endTime: merged.endTime,
      description: [
        refuerzoTipoCode(merged),
        formatRefuerzoFechaAr(merged.fecha),
        formatRefuerzoTimeRange(merged.startTime, merged.endTime),
        merged.motivo,
      ].filter(Boolean).join(' · '),
      updatedAt: Timestamp.now(),
    });
  }

  const code = refuerzoTipoCode(sol);
  const beforeLabel = `${formatRefuerzoFechaAr(sol.fecha)} ${formatRefuerzoTimeRange(sol.startTime, sol.endTime)}`;
  const afterLabel = `${formatRefuerzoFechaAr(merged.fecha)} ${formatRefuerzoTimeRange(merged.startTime, merged.endTime)}`;
  await appendRefuerzoPuntualSlaTrace(
    merged,
    'MODIFY_REFUERZO_PUNTUAL',
    `${code} modificado: ${beforeLabel} → ${afterLabel}${merged.positionName ? ` · ${merged.positionName}` : ''}`,
    actor,
  );
}
