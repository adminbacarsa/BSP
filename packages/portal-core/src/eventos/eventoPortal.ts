import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { Evento, SolicitudEvento } from '@cosp/portal-types';
import { isEventoActivo } from './eventoHelpers';

export async function loadEventosByEmpresaRange(
  db: Firestore,
  empresaId: string,
  fromDate: string,
  toDate: string,
): Promise<Evento[]> {
  const q = query(
    collection(db, 'eventos'),
    where('empresaId', '==', empresaId),
    where('fecha', '>=', fromDate),
    where('fecha', '<=', toDate),
    orderBy('fecha'),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Evento))
    .filter(isEventoActivo);
}

export async function loadSolicitudesEventoByEmpleado(
  db: Firestore,
  empleadoId: string,
  empresaId: string,
  fromDate: string,
  toDate: string,
): Promise<SolicitudEvento[]> {
  const q = query(
    collection(db, 'solicitudes_evento'),
    where('empresaId', '==', empresaId),
    where('empleadoId', '==', empleadoId),
    where('servicioFecha', '>=', fromDate),
    where('servicioFecha', '<=', toDate),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SolicitudEvento));
}

export async function createSolicitudEventoGuardia(
  db: Firestore,
  data: Omit<SolicitudEvento, 'id' | 'tipo' | 'status' | 'creadoAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'solicitudes_evento'), {
    ...data,
    tipo: 'guardia_solicita',
    status: 'pendiente',
    creadoAt: serverTimestamp(),
  });
  return ref.id;
}

export async function rejectConvocatoriaEvento(db: Firestore, solicitudId: string): Promise<void> {
  await updateDoc(doc(db, 'solicitudes_evento', solicitudId), {
    status: 'rechazada',
    respondidoAt: serverTimestamp(),
  });
}

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

export async function assignGuardToEvent(db: Firestore, params: AssignGuardToEventParams): Promise<void> {
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

  const turnosSnap = await getDocs(
    query(
      collection(db, 'turnos'),
      where('empresaId', '==', empresaId),
      where('employeeId', '==', empleadoId),
      where('startTime', '>=', `${servicioFecha}T00:00:00`),
      where('startTime', '<=', `${servicioFecha}T23:59:59`),
    ),
  );

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
      const empSnap = await getDoc(doc(db, 'empleados', empleadoId));
      if (empSnap.exists()) {
        const empData = empSnap.data() as Record<string, unknown>;
        originalObjectiveId = String(empData.preferredObjectiveId || empData.objectiveId || '') || null;
        originalObjectiveName = String(empData.preferredObjectiveName || empData.objectiveName || '') || null;
      }
    } catch {
      /* continuar */
    }
  }

  const batch = writeBatch(db);

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
    const turnoRef = doc(collection(db, 'turnos'));
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
      createdAt: serverTimestamp(),
    });
  }

  if (solicitudId) {
    batch.update(doc(db, 'solicitudes_evento', solicitudId), {
      status: 'aprobada',
      respondidoAt: serverTimestamp(),
      ...(respondidoPor ? { respondidoPor } : {}),
    });
  }

  if (originalObjectiveId) {
    const [y, m, d2] = servicioFecha.split('-');
    const fechaLabel = `${d2}/${m}/${y}`;
    batch.set(doc(collection(db, 'novedades')), {
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
      createdAt: serverTimestamp(),
    });
  }

  await batch.commit();
}
