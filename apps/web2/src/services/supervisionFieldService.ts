import { db } from '@/lib/firebase';
import {
  addDoc, collection, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, Timestamp, updateDoc, where, limit,
} from 'firebase/firestore';

export type LibroGuardiaEntry = {
  id?: string;
  objectiveId: string;
  clientId?: string;
  objetivoNombre?: string;
  clientName?: string;
  type: string;
  etiqueta?: string;
  gravedad?: string;
  text: string;
  accionTomada?: string;
  imageUrl?: string;
  audioUrl?: string;
  origen?: string;
  estadoIncidente?: 'ABIERTO' | 'EN_CURSO' | 'CERRADO';
  supervisorUid?: string;
  supervisorNombre?: string;
  empleadoNombre?: string;
  createdAt?: Timestamp;
};

export type SupervisionVisita = {
  id?: string;
  empresaId: string;
  objectiveId: string;
  objectiveName: string;
  clientId?: string;
  clientName?: string;
  supervisorUid: string;
  supervisorNombre: string;
  observaciones: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  createdAt?: Timestamp;
};

export type ObjetivoConsigna = {
  id?: string;
  empresaId: string;
  objectiveId: string;
  objectiveName: string;
  clientId?: string;
  clientName?: string;
  texto: string;
  status: 'ACTIVE' | 'INACTIVE';
  creadoPorUid: string;
  creadoPorNombre: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

const LIBRO = 'libro_guardia';
const VISITAS = 'supervision_visitas';
const CONSIGNAS = 'objetivo_consignas';

export const supervisionFieldService = {
  subscribeLibroByObjectives(
    objectiveIds: string[],
    onData: (items: LibroGuardiaEntry[]) => void,
    maxPerObjective = 80,
  ): () => void {
    if (!objectiveIds.length) {
      onData([]);
      return () => {};
    }
    const chunks: string[][] = [];
    for (let i = 0; i < objectiveIds.length; i += 10) {
      chunks.push(objectiveIds.slice(i, i + 10));
    }
    const unsubs: (() => void)[] = [];
    const maps = chunks.map(() => new Map<string, LibroGuardiaEntry>());

    const emit = () => {
      const merged = new Map<string, LibroGuardiaEntry>();
      maps.forEach(m => m.forEach((v, k) => merged.set(k, v)));
      const list = Array.from(merged.values()).sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      onData(list.slice(0, maxPerObjective * objectiveIds.length));
    };

    chunks.forEach((ids, idx) => {
      const q = query(
        collection(db, LIBRO),
        where('objectiveId', 'in', ids),
        orderBy('createdAt', 'desc'),
        limit(maxPerObjective),
      );
      unsubs.push(onSnapshot(q, snap => {
        maps[idx].clear();
        snap.docs.forEach(d => maps[idx].set(d.id, { id: d.id, ...d.data() } as LibroGuardiaEntry));
        emit();
      }, () => {
        maps[idx].clear();
        emit();
      }));
    });

    return () => unsubs.forEach(u => u());
  },

  async createLibroEntry(data: Omit<LibroGuardiaEntry, 'id' | 'createdAt'>): Promise<string> {
    const ref = await addDoc(collection(db, LIBRO), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  },

  async updateIncidenteEstado(id: string, estado: LibroGuardiaEntry['estadoIncidente']): Promise<void> {
    await updateDoc(doc(db, LIBRO, id), { estadoIncidente: estado, updatedAt: serverTimestamp() });
  },

  subscribeVisitas(
    empresaId: string,
    objectiveIds: string[] | null,
    onData: (items: SupervisionVisita[]) => void,
  ): () => void {
    if (objectiveIds !== null && !objectiveIds.length) {
      onData([]);
      return () => {};
    }
    const q = objectiveIds?.length
      ? query(
          collection(db, VISITAS),
          where('empresaId', '==', empresaId),
          where('objectiveId', 'in', objectiveIds.slice(0, 10)),
          orderBy('createdAt', 'desc'),
          limit(100),
        )
      : query(
          collection(db, VISITAS),
          where('empresaId', '==', empresaId),
          orderBy('createdAt', 'desc'),
          limit(100),
        );
    return onSnapshot(q, snap => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() } as SupervisionVisita)));
    }, () => onData([]));
  },

  async createVisita(data: Omit<SupervisionVisita, 'id' | 'createdAt'>): Promise<string> {
    const ref = await addDoc(collection(db, VISITAS), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  },

  subscribeConsignas(
    empresaId: string,
    objectiveIds: string[] | null,
    onData: (items: ObjetivoConsigna[]) => void,
  ): () => void {
    if (objectiveIds !== null && !objectiveIds.length) {
      onData([]);
      return () => {};
    }
    const q = objectiveIds?.length
      ? query(
          collection(db, CONSIGNAS),
          where('empresaId', '==', empresaId),
          where('status', '==', 'ACTIVE'),
          where('objectiveId', 'in', objectiveIds.slice(0, 10)),
          orderBy('createdAt', 'desc'),
        )
      : query(
          collection(db, CONSIGNAS),
          where('empresaId', '==', empresaId),
          where('status', '==', 'ACTIVE'),
          orderBy('createdAt', 'desc'),
          limit(200),
        );
    return onSnapshot(q, snap => {
      onData(snap.docs.map(d => ({ id: d.id, ...d.data() } as ObjetivoConsigna)));
    }, () => onData([]));
  },

  async createConsigna(data: Omit<ObjetivoConsigna, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<string> {
    const ref = await addDoc(collection(db, CONSIGNAS), {
      ...data,
      status: 'ACTIVE',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  },

  async deactivateConsigna(id: string): Promise<void> {
    await updateDoc(doc(db, CONSIGNAS, id), { status: 'INACTIVE', updatedAt: serverTimestamp() });
  },

  async loadObjectivesForEmpresa(empresaId: string): Promise<{ id: string; name: string; clientId: string; clientName: string }[]> {
    const snap = await getDocs(query(collection(db, 'clients'), where('empresaId', '==', empresaId)));
    const out: { id: string; name: string; clientId: string; clientName: string }[] = [];
    snap.docs.forEach(d => {
      const name = d.data().name || d.data().fantasyName || d.id;
      (d.data().objetivos || []).forEach((o: any) => {
        if (o?.id) out.push({ id: o.id, name: o.name || o.id, clientId: d.id, clientName: name });
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  },
};
