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
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Evento, SolicitudEvento } from '@cosp/portal-types';
import { isEventoActivo } from './eventoHelpers';

const AR_OFFSET = '-03:00';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function arDateTimeTs(fecha: string, hhmm: string): Timestamp {
  const time = /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '08:00';
  const [hRaw, mRaw] = time.split(':');
  return Timestamp.fromDate(
    new Date(`${fecha}T${pad2(Number(hRaw))}:${pad2(Number(mRaw))}:00.000${AR_OFFSET}`),
  );
}

function arDayBounds(fecha: string) {
  return {
    startTs: Timestamp.fromDate(new Date(`${fecha}T00:00:00.000${AR_OFFSET}`)),
    endTs: Timestamp.fromDate(new Date(`${fecha}T23:59:59.999${AR_OFFSET}`)),
    startStr: `${fecha}T00:00:00`,
    endStr: `${fecha}T23:59:59`,
  };
}

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

  const { startTs, endTs, startStr, endStr } = arDayBounds(servicioFecha);
  const base = query(collection(db, 'turnos'), where('employeeId', '==', empleadoId));
  const [tsSnap, strSnap] = await Promise.all([
    getDocs(query(base, where('startTime', '>=', startTs), where('startTime', '<=', endTs))),
    getDocs(query(base, where('startTime', '>=', startStr), where('startTime', '<=', endStr))),
  ]);

  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const d of [...tsSnap.docs, ...strSnap.docs]) {
    if (empresaId && d.data().empresaId && String(d.data().empresaId) !== empresaId) continue;
    byId.set(d.id, d);
  }

  const existingTurno =
    [...byId.values()].find((d) => {
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
        originalObjectiveName =
          String(empData.preferredObjectiveName || empData.objectiveName || '') || null;
      }
    } catch {
      /* continuar */
    }
  }

  let startTime = arDateTimeTs(servicioFecha, horaInicio);
  let endTime = arDateTimeTs(servicioFecha, horaFin);
  if (endTime.toMillis() <= startTime.toMillis()) {
    endTime = Timestamp.fromDate(new Date(endTime.toDate().getTime() + 24 * 60 * 60 * 1000));
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
      startTime,
      endTime,
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
      startTime,
      endTime,
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
