import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export type AssignGuardToEventParams = {
  empresaId: string;
  empleadoId: string;
  empleadoNombre: string;
  empleadoObjectiveId?: string;
  empleadoObjectiveName?: string;
  eventoId: string;
  eventoNombre: string;
  clienteId?: string;
  clienteNombre?: string;
  servicioId: string;
  servicioNombre: string;
  servicioFecha: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  solicitudId?: string;
  respondidoPor?: string;
};

export async function assignGuardToEventAdmin(
  db: admin.firestore.Firestore,
  params: AssignGuardToEventParams,
): Promise<void> {
  const {
    empresaId,
    empleadoId,
    empleadoNombre,
    empleadoObjectiveId,
    empleadoObjectiveName,
    eventoId,
    eventoNombre,
    clienteId,
    clienteNombre,
    servicioId,
    servicioNombre,
    servicioFecha,
    horaInicio,
    horaFin,
    horas,
    solicitudId,
    respondidoPor,
  } = params;

  const turnosSnap = await db
    .collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('employeeId', '==', empleadoId)
    .where('startTime', '>=', `${servicioFecha}T00:00:00`)
    .where('startTime', '<=', `${servicioFecha}T23:59:59`)
    .get();

  const existingTurno =
    turnosSnap.docs.find((d) => {
      const c = String(d.data().code || '').toUpperCase();
      return c !== 'EV' && c !== 'F' && c !== 'FF' && c !== 'FP';
    }) ?? null;

  const originalCode = existingTurno ? String(existingTurno.data().code || '').toUpperCase() : null;

  let originalObjectiveId: string | null =
    existingTurno?.data().objectiveId || empleadoObjectiveId || null;
  let originalObjectiveName: string | null =
    existingTurno?.data().objectiveName || empleadoObjectiveName || null;

  if (!originalObjectiveId) {
    try {
      const empSnap = await db.collection('empleados').doc(empleadoId).get();
      if (empSnap.exists) {
        const empData = empSnap.data() as Record<string, unknown>;
        originalObjectiveId = String(empData.preferredObjectiveId || empData.objectiveId || '') || null;
        originalObjectiveName = String(empData.preferredObjectiveName || empData.objectiveName || '') || null;
      }
    } catch {
      /* continuar */
    }
  }

  const batch = db.batch();

  if (existingTurno) {
    batch.update(existingTurno.ref, {
      code: 'EV',
      origin: 'EVENTO',
      eventoId,
      eventoNombre,
      servicioId,
      servicioNombre,
      startTime: `${servicioFecha}T${horaInicio}:00`,
      endTime: `${servicioFecha}T${horaFin}:00`,
      hours: horas,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: false,
      replacedCode: originalCode,
    });
  } else {
    const turnoRef = db.collection('turnos').doc();
    batch.set(turnoRef, {
      empresaId,
      code: 'EV',
      origin: 'EVENTO',
      employeeId: empleadoId,
      employeeName: empleadoNombre,
      objectiveId: originalObjectiveId,
      objectiveName: originalObjectiveName,
      clientId: clienteId || null,
      clientName: clienteNombre || null,
      eventoId,
      eventoNombre,
      servicioId,
      servicioNombre,
      startTime: `${servicioFecha}T${horaInicio}:00`,
      endTime: `${servicioFecha}T${horaFin}:00`,
      hours: horas,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: false,
      replacedCode: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  if (solicitudId) {
    batch.update(db.collection('solicitudes_evento').doc(solicitudId), {
      status: 'aprobada',
      respondidoAt: FieldValue.serverTimestamp(),
      ...(respondidoPor ? { respondidoPor } : {}),
    });
  }

  if (originalObjectiveId) {
    const [y, m, d2] = servicioFecha.split('-');
    const fechaLabel = `${d2}/${m}/${y}`;
    batch.set(db.collection('novedades').doc(), {
      empresaId,
      type: 'VACANTE_POR_EVENTO',
      status: 'pending',
      viewed: false,
      priority: 'high',
      actionTarget: 'PLANIFICACION',
      title: `Vacante por evento · ${empleadoNombre}`,
      description:
        `${empleadoNombre} sale al evento "${eventoNombre}" el ${fechaLabel}. ` +
        `Queda vacante turno ${originalCode || '—'} en ${originalObjectiveName || originalObjectiveId}.`,
      objectiveId: originalObjectiveId,
      objectiveName: originalObjectiveName,
      fecha: servicioFecha,
      codigoTurnoOriginal: originalCode,
      employeeId: empleadoId,
      employeeName: empleadoNombre,
      eventoId,
      eventoNombre,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}
