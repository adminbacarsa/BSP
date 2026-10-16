import { addDoc, collection, Timestamp, updateDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import { calcRefuerzoPactadaHours } from '@/lib/refuerzo/refuerzoDisplay';

function diaSiguiente(ds: string): string {
  const d = new Date(`${ds}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Refuerzo eventual (RFZE) desde Planificación: por cada fecha, un pedido de refuerzo ya aprobado y
 * asignado (trazabilidad del servicio, prefactura) y el turno RFZ del guardia, con la misma forma que
 * el de Supervisión. `rfzTipo: 'EVENTUAL'` lo distingue del fijo.
 */
export async function crearRfzePlanificacion(opts: {
  empresaId: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  employeeId: string;
  employeeName: string;
  fechas: string[];
  inicio: string;
  fin: string;
  pidio: string;
  motivo?: string;
  draft: boolean;
  /** Sigla del refuerzo en la grilla (RM = refuerzo Día de la Madre). Vacía: RFZE. */
  sigla?: string;
  /** Borrador por fecha (el mes siguiente puede estar sin publicar). Si falta, `draft`. */
  draftDe?: (fecha: string) => boolean;
}): Promise<number> {
  const sigla = String(opts.sigla || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 8);
  const user = getAuth().currentUser;
  const quien = user?.displayName || user?.email || 'Planificación';
  const horas = calcRefuerzoPactadaHours(opts.inicio, opts.fin);
  const cruza = opts.fin <= opts.inicio;
  let n = 0;
  for (const fecha of opts.fechas) {
    const solicitudId = await solicitudRefuerzoService.create({
      empresaId: opts.empresaId,
      clientId: opts.clientId,
      clientName: opts.clientName,
      objectiveId: opts.objectiveId,
      objectiveName: opts.objectiveName,
      tipo: 'REFUERZO_PUESTO',
      alcance: 'PUNTUAL',
      fecha,
      startTime: opts.inicio,
      endTime: opts.fin,
      positionName: 'Refuerzo eventual',
      shiftCode: 'RFZE',
      ...(sigla ? { rfzSigla: sigla } : {}),
      cantidadPax: 1,
      motivo: (opts.motivo || '').trim() || 'Refuerzo eventual cargado en Planificación',
      origen: 'PLANIFICACION',
      estado: 'ASIGNADA',
      actionTarget: 'PLANIFICACION',
      solicitadoPorUid: '',
      solicitadoPorNombre: opts.pidio.trim(),
      solicitadoAt: Timestamp.now(),
      autorizadoPorUid: user?.uid || '',
      autorizadoPorNombre: quien,
      autorizadoAt: Timestamp.now(),
      empleadoIds: [opts.employeeId],
      empleadoNames: [opts.employeeName],
      horasTotales: horas,
    });
    const ref = await addDoc(collection(db, 'turnos'), {
      empresaId: opts.empresaId,
      objectiveId: opts.objectiveId,
      clientId: opts.clientId,
      clientName: opts.clientName,
      objectiveName: opts.objectiveName,
      fecha,
      startTime: `${fecha}T${opts.inicio}:00`,
      endTime: `${cruza ? diaSiguiente(fecha) : fecha}T${opts.fin}:00`,
      hours: horas,
      origin: 'CLIENT_REQUEST',
      solicitudRefuerzoId: solicitudId,
      code: 'RFZ',
      rfzTipo: 'EVENTUAL',
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: opts.draftDe ? opts.draftDe(fecha) : opts.draft,
      employeeId: opts.employeeId,
      employeeName: opts.employeeName,
      positionName: 'Refuerzo eventual',
      shiftCode: 'RFZE',
      ...(sigla ? { rfzSigla: sigla } : {}),
      autorizadoPorUid: user?.uid ?? null,
      autorizadoPorNombre: quien,
      autorizadoAt: Timestamp.now(),
      via: 'PLANIFICACION_RAPIDO',
    });
    await updateDoc(doc(db, 'solicitudes_refuerzo', solicitudId), { turnoIds: [ref.id] });
    n += 1;
  }
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: Timestamp.now(),
    actorUid: user?.uid || 'unknown',
    actorName: quien,
    action: 'CREATE_RFZE',
    module: 'PLANIFICACION',
    details: `RFZE${sigla ? ` ${sigla}` : ''} ${opts.inicio}–${opts.fin} a ${opts.employeeName} en ${opts.objectiveName}: ${opts.fechas.join(', ')} · pidió ${opts.pidio}`,
    empresaId: opts.empresaId,
    metadata: { platform: 'web_admin_crono', via: 'PLANIFICACION_RAPIDO' },
  });
  return n;
}
