import { collection, doc, Timestamp, writeBatch } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { calcRefuerzoPactadaHours } from '@/lib/refuerzo/refuerzoDisplay';
import { armarEscriturasRfze, camposRelojTurnoRfze } from '@/lib/refuerzo/rfzeSobreRet';

/**
 * Refuerzo eventual (RFZE) desde Planificación: por cada fecha, un pedido de refuerzo ya aprobado y
 * asignado (trazabilidad del servicio, prefactura) y el turno RFZ del guardia, con la misma forma que
 * el de Supervisión. `rfzTipo: 'EVENTUAL'` lo distingue del fijo.
 * Si hay RET a borrar, va en el mismo batch que el alta: o quedan los dos escritos, o ninguno.
 */
export async function crearRfzePlanificacion(opts: OpcionesRfze): Promise<number> {
  return crearRfzesAtomicos([opts]);
}

export type OpcionesRfze = {
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
  /** Docs RET que se borran en el mismo commit que estos RFZE. */
  borrarTurnoIds?: string[];
};

export async function crearRfzesAtomicos(grupos: OpcionesRfze[]): Promise<number> {
  const conFechas = grupos.filter((g) => g.fechas.length > 0);
  if (!conFechas.length) return 0;
  const user = getAuth().currentUser;
  const quien = user?.displayName || user?.email || 'Planificación';
  const batch = writeBatch(db);
  const borrados = new Set<string>();
  let n = 0;
  for (const opts of conFechas) {
    const sigla = String(opts.sigla || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 8);
    const horas = calcRefuerzoPactadaHours(opts.inicio, opts.fin);
    const plan = armarEscriturasRfze({
      fechas: opts.fechas,
      inicio: opts.inicio,
      fin: opts.fin,
      borrarTurnoIds: opts.borrarTurnoIds,
    });
    const borradosAca: string[] = [];
    for (const paso of plan) {
      if (paso.tipo !== 'delete') continue;
      if (borrados.has(paso.id)) continue;
      borrados.add(paso.id);
      borradosAca.push(paso.id);
      batch.delete(doc(db, 'turnos', paso.id));
    }
    for (const fecha of opts.fechas) {
      const reloj = camposRelojTurnoRfze(fecha, opts.inicio, opts.fin);
      const solRef = doc(collection(db, 'solicitudes_refuerzo'));
      const turnoRef = doc(collection(db, 'turnos'));
      const ahora = Timestamp.now();
      batch.set(solRef, {
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
        solicitadoAt: ahora,
        autorizadoPorUid: user?.uid || '',
        autorizadoPorNombre: quien,
        autorizadoAt: ahora,
        empleadoIds: [opts.employeeId],
        empleadoNames: [opts.employeeName],
        horasTotales: horas,
        turnoIds: [turnoRef.id],
        createdAt: ahora,
        updatedAt: ahora,
      });
      batch.set(turnoRef, {
        empresaId: opts.empresaId,
        objectiveId: opts.objectiveId,
        clientId: opts.clientId,
        clientName: opts.clientName,
        objectiveName: opts.objectiveName,
        fecha,
        startTime: Timestamp.fromDate(reloj.startTime),
        endTime: Timestamp.fromDate(reloj.endTime),
        hours: horas,
        origin: 'CLIENT_REQUEST',
        solicitudRefuerzoId: solRef.id,
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
        autorizadoAt: ahora,
        via: 'PLANIFICACION_RAPIDO',
      });
      n += 1;
    }
    batch.set(doc(collection(db, 'audit_logs')), {
      timestamp: Timestamp.now(),
      actorUid: user?.uid || 'unknown',
      actorName: quien,
      action: 'CREATE_RFZE',
      module: 'PLANIFICACION',
      details: `RFZE${sigla ? ` ${sigla}` : ''} ${opts.inicio}–${opts.fin} a ${opts.employeeName} en ${opts.objectiveName}: ${opts.fechas.join(', ')} · pidió ${opts.pidio}${borradosAca.length ? ` · RET borrado: ${borradosAca.join(', ')}` : ''}`,
      empresaId: opts.empresaId,
      metadata: { platform: 'web_admin_crono', via: 'PLANIFICACION_RAPIDO' },
    });
  }
  await batch.commit();
  return n;
}
