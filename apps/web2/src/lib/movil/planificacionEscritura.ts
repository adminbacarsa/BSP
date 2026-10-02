/**
 * Escritura de los cambios del celular en `turnos`, con los mismos campos que guarda la
 * grilla (`turnoPayload` del planificador) y la misma publicación (`planificacion_estados`
 * + `draft:false` + `audit_logs`). `draft` sigue la regla del escritorio: borrador si el mes
 * no está publicado; corrección (`draft:false`, dispara el push `onTurnoWrite`) si lo está.
 */
import { getAuth } from 'firebase/auth';
import {
  Timestamp, addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, buildPlanificacionEstadoDocId, stampEmpresaId } from '@/lib/multiempresa';
import { aplicarCambios, bandaParaCubrir, instantesJornada, type CambioLocal, type TurnoMovil } from '@/lib/movil/planificacionBasica';

export type ContextoEscritura = {
  empresaId: string;
  actorName: string;
  /** true = el mes sigue en borrador: los turnos nacen `draft:true` (sin push). */
  borrador: boolean;
};

function payloadTurno(input: TurnoMovil & { ft: boolean; actorName: string; comments: string; bolsaCuil?: string; draft: boolean }) {
  const inst = instantesJornada(input.date, input.start, input.end, input.franco);
  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    clientId: input.clientId,
    clientName: input.clientName,
    objectiveId: input.objectiveId,
    objectiveName: input.objectiveName,
    code: input.code,
    type: input.code,
    startTime: Timestamp.fromDate(inst.start),
    endTime: Timestamp.fromDate(inst.end),
    scheduleDate: input.date,
    isFranco: input.franco,
    isFrancoTrabajado: input.ft,
    isUnassigned: input.employeeId === 'VACANTE',
    positionName: input.positionName,
    hours: input.hours,
    draft: input.draft,
    esEventual: Boolean(input.bolsaCuil),
    bolsaCuil: input.bolsaCuil || null,
    comments: input.comments,
    actorName: input.actorName,
    createdAt: serverTimestamp(),
  };
}

/** Aplica el lote en orden; `creados` resuelve ids sintéticos (`vacante:*`, `slot:*`) a docs reales. */
export async function escribirLote(lote: CambioLocal[], base: TurnoMovil[], ctx: ContextoEscritura): Promise<void> {
  let actuales = base.map((t) => ({ ...t }));
  const creados = new Map<string, string>();
  for (const cambio of lote) {
    actuales = aplicarCambios(actuales, [cambio]);
    await escribirCambio(cambio, base, actuales, ctx, creados);
  }
}

export async function escribirCambio(cambio: CambioLocal, originales: TurnoMovil[], aplicados: TurnoMovil[], ctx: ContextoEscritura, creados: Map<string, string>): Promise<void> {
  const { empresaId, actorName } = ctx;
  const draft = ctx.borrador;
  if (cambio.kind === 'nuevo') {
    const ref = doc(collection(db, 'turnos'));
    await setDoc(ref, stampEmpresaId(payloadTurno({
      ...cambio.franja,
      employeeId: cambio.employeeId,
      employeeName: cambio.employeeName,
      vacante: false,
      licencia: false,
      franco: false,
      coveredBy: '',
      ft: cambio.ft,
      bolsaCuil: cambio.bolsaCuil,
      actorName,
      draft,
      comments: 'Asignación desde el celular',
    }), empresaId));
    creados.set(cambio.franja.id, ref.id);
    return;
  }
  const origen = originales.find((t) => t.id === cambio.franjaId) || aplicados.find((t) => t.id === cambio.franjaId);
  if (!origen) return;
  const idReal = creados.get(cambio.franjaId) || (originales.some((t) => t.id === origen.id) ? origen.id : null);
  if (cambio.kind === 'borrar') {
    if (idReal) await deleteDoc(doc(db, 'turnos', idReal));
    return;
  }
  if (cambio.kind === 'asignar') {
    const banda = cambio.banda ?? bandaParaCubrir({ ...origen, kind: origen.vacante ? 'vacante' : origen.licencia ? 'licencia' : 'ok' });
    if (origen.licencia) {
      if (idReal) await updateDoc(doc(db, 'turnos', idReal), stampEmpresaId({ coveredBy: cambio.employeeName, draft, actorName }, empresaId));
      await addDoc(collection(db, 'turnos'), stampEmpresaId(payloadTurno({
        ...origen,
        employeeId: cambio.employeeId,
        employeeName: cambio.employeeName,
        code: banda.code,
        start: banda.start,
        end: banda.end,
        hours: banda.hours,
        franco: false,
        ft: cambio.ft,
        bolsaCuil: cambio.bolsaCuil,
        actorName,
        draft,
        comments: 'Cobertura de licencia desde el celular',
      }), empresaId));
      return;
    }
    if (!idReal) return;
    const inst = instantesJornada(origen.date, banda.start, banda.end, false);
    await updateDoc(doc(db, 'turnos', idReal), stampEmpresaId({
      employeeId: cambio.employeeId,
      employeeName: cambio.employeeName,
      code: banda.code,
      type: banda.code,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      hours: banda.hours,
      isUnassigned: false,
      isFranco: false,
      isFrancoTrabajado: cambio.ft,
      draft,
      esEventual: Boolean(cambio.bolsaCuil),
      bolsaCuil: cambio.bolsaCuil || null,
      actorName,
      comments: 'Asignación desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    return;
  }
  if (!idReal) return;
  if (cambio.kind === 'horario') {
    const inst = instantesJornada(origen.date, cambio.start, cambio.end, false);
    await updateDoc(doc(db, 'turnos', idReal), stampEmpresaId({
      code: cambio.code,
      type: cambio.code,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      hours: cambio.hours,
      isFranco: false,
      draft,
      actorName,
      comments: 'Cambio de horario desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    return;
  }
  if (cambio.kind === 'franco') {
    const inst = instantesJornada(origen.date, origen.start, origen.end, true);
    await updateDoc(doc(db, 'turnos', idReal), stampEmpresaId({
      code: 'F',
      type: 'F',
      isFranco: true,
      startTime: Timestamp.fromDate(inst.start),
      endTime: Timestamp.fromDate(inst.end),
      hours: 0,
      draft,
      actorName,
      comments: 'Franco desde el celular',
      updatedAt: serverTimestamp(),
    }, empresaId));
    const vacanteRef = doc(collection(db, 'turnos'));
    await setDoc(vacanteRef, stampEmpresaId(payloadTurno({
      ...origen,
      employeeId: 'VACANTE',
      employeeName: 'Vacante',
      franco: false,
      ft: false,
      actorName,
      draft,
      comments: 'Hueco por franco desde el celular',
    }), empresaId));
    creados.set(`vacante:${origen.id}`, vacanteRef.id);
    return;
  }
  const otro = originales.find((t) => t.id === cambio.otroId);
  const a = aplicados.find((t) => t.id === cambio.franjaId);
  const b = aplicados.find((t) => t.id === cambio.otroId);
  if (!otro || !a || !b) return;
  const patch = (t: TurnoMovil) => stampEmpresaId({
    employeeId: t.employeeId, employeeName: t.employeeName, draft, actorName, comments: 'Permuta desde el celular', updatedAt: serverTimestamp(),
  }, empresaId);
  await updateDoc(doc(db, 'turnos', idReal), patch(a));
  await updateDoc(doc(db, 'turnos', otro.id), patch(b));
}

/**
 * Publicación del mes (misma secuencia que `executePublish` de la grilla): marca
 * `planificacion_estados.publishedAt`, pasa a `draft:false` los turnos del objetivo en el mes
 * y deja el `audit_logs`. El push a cada guardia lo manda `onCronogramaPublished` en el servidor.
 */
export async function publicarMes(input: {
  empresaId: string;
  objectiveId: string;
  objectiveName: string;
  clientId: string;
  ym: string;
  migracionCompleta: boolean;
}): Promise<number> {
  const [year, month] = input.ym.split('-').map(Number);
  const auth = getAuth();
  const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
  const publishDocId = buildPlanificacionEstadoDocId(input.empresaId, input.objectiveId, year, month);
  await setDoc(doc(db, 'planificacion_estados', publishDocId), {
    objetivoId: input.objectiveId,
    objectiveId: input.objectiveId,
    año: year,
    mes: month,
    year,
    month,
    publishedAt: serverTimestamp(),
    publishedBy: actorName,
    lastModifiedAt: serverTimestamp(),
    lastModifiedBy: actorName,
    empresaId: input.empresaId,
  }, { merge: true });
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0, 23, 59, 59);
  const draftsSnap = await getDocs(query(
    collection(db, 'turnos'),
    where('objectiveId', '==', input.objectiveId),
    where('draft', '==', true),
    where('startTime', '>=', Timestamp.fromDate(firstDay)),
    where('startTime', '<=', Timestamp.fromDate(lastDay)),
  ));
  const docs = draftsSnap.docs.filter((d) => belongsToEmpresaView(d.data(), input.empresaId, input.migracionCompleta));
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + 400)) batch.update(d.ref, { draft: false });
    await batch.commit();
  }
  await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
    action: 'PUBLICACION_CRONOGRAMA',
    module: 'PLANIFICADOR',
    details: `Cronograma publicado desde el celular — ${input.objectiveName} · ${String(month).padStart(2, '0')}/${year} · ${docs.length} turno(s) notificado(s)`,
    timestamp: serverTimestamp(),
    actorName,
    actorUid: auth.currentUser?.uid || null,
    objectiveId: input.objectiveId,
    objectiveName: input.objectiveName,
    clientId: input.clientId || undefined,
  }, input.empresaId));
  return docs.length;
}
