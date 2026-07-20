import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';

export interface GrupoObjetivos {
  id?: string;
  empresaId: string;
  nombre: string;
  clientId: string;
  clientName: string;
  objectiveIds: string[];
  objectiveNames: string[];
}

export const gruposService = {
  getByEmpresa: async (empresaId: string): Promise<GrupoObjetivos[]> => {
    try {
      const q = query(
        collection(db, 'grupos_objetivos'),
        where('empresaId', '==', empresaId),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as GrupoObjetivos));
    } catch (e) {
      console.error('Error cargando grupos_objetivos:', e);
      return [];
    }
  },

  add: async (data: Omit<GrupoObjetivos, 'id'>): Promise<string> => {
    const ref = await addDoc(collection(db, 'grupos_objetivos'), data);
    return ref.id;
  },

  update: async (id: string, data: Partial<Omit<GrupoObjetivos, 'id'>>): Promise<void> => {
    await updateDoc(doc(db, 'grupos_objetivos', id), data);
  },

  delete: async (id: string): Promise<void> => {
    await deleteDoc(doc(db, 'grupos_objetivos', id));
  },
};
