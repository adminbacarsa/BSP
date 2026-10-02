import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
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

/** El turno lo escribe el servidor. Esta función queda para no romper el import. */
export async function assignGuardToEvent(_db: Firestore, _params: AssignGuardToEventParams): Promise<void> {
  throw new Error('El turno EV lo escribe el servidor (asignarGuardiaEvento / respondEventoConvocatoria).');
}

/** El eventual puede avisar que no va solo después de aceptar y antes del inicio (hora AR). */
export function puedeNoAsistirEventual(
  sol: { status?: string; esEventual?: boolean; servicioFecha?: string; jornada?: { fecha?: string; horaInicio?: string } | null },
  ahoraMs = Date.now(),
): boolean {
  if (sol.esEventual !== true || sol.status !== 'aprobada') return false;
  const fecha = String(sol.jornada?.fecha || sol.servicioFecha || '');
  const hora = String(sol.jornada?.horaInicio || '00:00');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{1,2}:\d{2}$/.test(hora)) return false;
  const [h, m] = hora.split(':').map(Number);
  const inicio = new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000-03:00`).getTime();
  return Number.isFinite(inicio) && ahoraMs < inicio;
}
