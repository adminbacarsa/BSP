import { addDoc, collection, Timestamp, updateDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import { calcRefuerzoPactadaHours } from '@/lib/refuerzo/refuerzoDisplay';

/**
 * TURA cargado desde Planificación: el pedido (`solicitudes_refuerzo`, AGREGADO_TURNO, ya asignado)
 * y el turno TURA atado al turno del guardia, con la misma forma que el de Supervisión, para que lo
 * lean la prefactura, Operaciones, Supervisión y Servicios.
 */
export async function crearTuraPlanificacion(opts: {
  empresaId: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  employeeId: string;
  employeeName: string;
  parentShiftId: string;
  positionName: string;
  /** Día del turno del guardia (YYYY-MM-DD). */
  fecha: string;
  /** Inicio y fin del agregado como fecha-hora local (YYYY-MM-DDTHH:mm). */
  inicioIso: string;
  finIso: string;
  draft: boolean;
}): Promise<{ solicitudId: string; turnoId: string }> {
  const user = getAuth().currentUser;
  const quien = user?.displayName || user?.email || 'Planificación';
  const hhmm = (iso: string) => iso.slice(11, 16);
  const horas = calcRefuerzoPactadaHours(hhmm(opts.inicioIso), hhmm(opts.finIso));
  const solicitudId = await solicitudRefuerzoService.create({
    empresaId: opts.empresaId,
    clientId: opts.clientId,
    clientName: opts.clientName,
    objectiveId: opts.objectiveId,
    objectiveName: opts.objectiveName,
    tipo: 'AGREGADO_TURNO',
    alcance: 'PUNTUAL',
    fecha: opts.inicioIso.slice(0, 10),
    startTime: hhmm(opts.inicioIso),
    endTime: hhmm(opts.finIso),
    positionName: opts.positionName,
    parentShiftId: opts.parentShiftId,
    parentEmpleadoId: opts.employeeId,
    parentEmpleadoName: opts.employeeName,
    motivo: 'Cargado en Planificación',
    origen: 'PLANIFICACION',
    estado: 'ASIGNADA',
    actionTarget: 'PLANIFICACION',
    solicitadoPorUid: user?.uid || '',
    solicitadoPorNombre: quien,
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
    fecha: opts.fecha,
    startTime: `${opts.inicioIso}:00`,
    endTime: `${opts.finIso}:00`,
    hours: horas,
    origin: 'CLIENT_REQUEST',
    solicitudRefuerzoId: solicitudId,
    code: 'TURA',
    isPresent: false,
    isAbsent: false,
    isCompleted: false,
    draft: opts.draft,
    employeeId: opts.employeeId,
    employeeName: opts.employeeName,
    parentShiftId: opts.parentShiftId,
    positionName: opts.positionName,
    turaContiguous: true,
    autorizadoPorUid: user?.uid ?? null,
    autorizadoPorNombre: quien,
    autorizadoAt: Timestamp.now(),
    via: 'PLANIFICACION_RAPIDO',
  });
  await updateDoc(doc(db, 'solicitudes_refuerzo', solicitudId), { turnoIds: [ref.id] });
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: Timestamp.now(),
    actorUid: user?.uid || 'unknown',
    actorName: quien,
    action: 'CREATE_TURA',
    module: 'PLANIFICACION',
    details: `TURA ${hhmm(opts.inicioIso)}–${hhmm(opts.finIso)} a ${opts.employeeName} en ${opts.objectiveName} (${opts.fecha})`,
    empresaId: opts.empresaId,
    metadata: { platform: 'web_admin_crono', via: 'PLANIFICACION_RAPIDO', solicitudId, turnoId: ref.id, parentShiftId: opts.parentShiftId },
  });
  return { solicitudId, turnoId: ref.id };
}
