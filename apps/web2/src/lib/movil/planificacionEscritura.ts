/**
 * Escritura de los cambios del celular en `turnos`, con los mismos campos que guarda la
 * grilla (`turnoPayload` del planificador). El celular NO publica meses ni guarda borradores:
 * solo corrige un mes ya publicado, así que todo se escribe `draft:false` (dispara el push
 * `onTurnoWrite`, igual que «Publicar corrección» del escritorio). Un mes sin publicar se ve en
 * solo lectura (`AVISO_MES_SIN_PUBLICAR`) y se planifica desde la computadora.
 */
import {
  Timestamp, addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { aplicarCambios, bandaParaCubrir, instantesJornada, type CambioLocal, type TurnoMovil } from '@/lib/movil/planificacionBasica';

export type ContextoEscritura = {
  empresaId: string;
  actorName: string;
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
  // Corrección de un mes publicado: nunca borrador desde el celular.
  const draft = false;
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
