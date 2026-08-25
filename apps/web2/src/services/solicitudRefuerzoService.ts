import { db, onSnapshotFresh } from '@/lib/firebase';
import {
  collection, addDoc, getDocs, doc, updateDoc,
  query, where, orderBy, Timestamp,
} from 'firebase/firestore';

export type SolicitudTipo   = 'REFUERZO_PUESTO' | 'AGREGADO_TURNO';
export type SolicitudAlcance = 'PUNTUAL' | 'ESTRUCTURAL';
export type SolicitudEstado = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'ASIGNADA' | 'COMPLETADA' | 'CANCELADA';
export type SolicitudOrigen = 'PORTAL_CLIENTE' | 'MANUAL' | 'SUPERVISOR_MANUAL';

export interface SolicitudRefuerzo {
  id?: string;
  empresaId: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;

  tipo: SolicitudTipo;
  /** PUNTUAL = solo esa fecha (RFZ). ESTRUCTURAL = +pax en el SLA del servicio. */
  alcance?: SolicitudAlcance;
  slaApplied?: boolean;
  slaIdAplicado?: string;
  fecha: string;      // YYYY-MM-DD
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm

  // Solo REFUERZO_PUESTO
  positionId?: string;
  positionName?: string;
  shiftCode?: string;
  cantidadPax?: number;

  // Solo AGREGADO_TURNO
  parentShiftId?: string;
  parentEmpleadoId?: string;
  parentEmpleadoName?: string;

  motivo: string;
  origen: SolicitudOrigen;

  // Workflow
  estado: SolicitudEstado;
  actionTarget?: 'PLANIFICACION' | 'OPERACIONES';
  solicitadoPorUid: string;
  solicitadoPorNombre: string;
  solicitadoAt: Timestamp | string;

  supervisorUid?: string;
  autorizadoPorUid?: string;
  autorizadoPorNombre?: string;
  autorizadoAt?: Timestamp | string;
  motivoRechazo?: string;

  // Cobertura asignada
  turnoIds?: string[];
  empleadoIds?: string[];
  empleadoNames?: string[];

  // Si el guardia fue cambiado (AGREGADO_TURNO)
  guardiaOriginalId?: string;
  guardiaOriginalNombre?: string;

  canalSolicitud?: 'TELEFONO' | 'WHATSAPP' | 'EMAIL' | 'PRESENCIAL';
  horasTotales?: number;

  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

const COL = 'solicitudes_refuerzo';

/** Firestore rechaza valores undefined; los quitamos antes de escribir. */
function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out as T;
}

export const solicitudRefuerzoService = {
  async create(data: Omit<SolicitudRefuerzo, 'id'>): Promise<string> {
    const ref = await addDoc(collection(db, COL), stripUndefined({
      ...data,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
    return ref.id;
  },

  async update(id: string, patch: Partial<SolicitudRefuerzo>): Promise<void> {
    await updateDoc(doc(db, COL, id), stripUndefined({
      ...patch,
      updatedAt: Timestamp.now(),
    }));
  },

  async getByEmpresa(empresaId: string): Promise<SolicitudRefuerzo[]> {
    const q = query(
      collection(db, COL),
      where('empresaId', '==', empresaId),
      orderBy('solicitadoAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo));
  },

  async getByObjectiveIds(objectiveIds: string[]): Promise<SolicitudRefuerzo[]> {
    if (!objectiveIds.length) return [];
    const q = query(
      collection(db, COL),
      where('objectiveId', 'in', objectiveIds.slice(0, 10)),
      orderBy('solicitadoAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo));
  },

  async getByClient(clientId: string): Promise<SolicitudRefuerzo[]> {
    const q = query(
      collection(db, COL),
      where('clientId', '==', clientId),
      orderBy('solicitadoAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo));
  },

  subscribeByEmpresa(
    empresaId: string,
    cb: (items: SolicitudRefuerzo[]) => void,
    onError?: (e: Error) => void,
  ) {
    const q = query(
      collection(db, COL),
      where('empresaId', '==', empresaId),
      orderBy('solicitadoAt', 'desc'),
    );
    return onSnapshotFresh(
      q,
      snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo))),
      err => { console.error('[solicitudRefuerzo] subscribeByEmpresa error:', err); onError?.(err); },
    );
  },

  subscribeByObjectiveIds(
    objectiveIds: string[],
    cb: (items: SolicitudRefuerzo[]) => void,
    onError?: (e: Error) => void,
  ) {
    if (!objectiveIds.length) { cb([]); return () => {}; }
    const q = query(
      collection(db, COL),
      where('objectiveId', 'in', objectiveIds.slice(0, 10)),
      orderBy('solicitadoAt', 'desc'),
    );
    return onSnapshotFresh(
      q,
      snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo))),
      err => { console.error('[solicitudRefuerzo] subscribeByObjectiveIds error:', err); onError?.(err); },
    );
  },

  subscribeByClient(
    clientId: string,
    cb: (items: SolicitudRefuerzo[]) => void,
    onError?: (e: Error) => void,
  ) {
    const q = query(
      collection(db, COL),
      where('clientId', '==', clientId),
      orderBy('solicitadoAt', 'desc'),
    );
    return onSnapshotFresh(
      q,
      snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as SolicitudRefuerzo))),
      err => { console.error('[solicitudRefuerzo] subscribeByClient error:', err); onError?.(err); },
    );
  },
};
