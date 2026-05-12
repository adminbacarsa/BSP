
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, addDoc, doc, deleteDoc } from 'firebase/firestore';
import { Client, Objective, Service, Employee } from '@/types/wfm';

export const wfmService = {
  // Clientes
  getClients: async () => {
    const s = await getDocs(collection(db, 'clients'));
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Client));
  },
  // Objetivos por Cliente
  getObjectives: async (clientId: string) => {
    const q = query(collection(db, 'objectives'), where('clientId', '==', clientId));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Objective));
  },
  // Servicios por Objetivo
  getServices: async (objectiveId: string) => {
    const q = query(collection(db, 'services'), where('objectiveId', '==', objectiveId));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Service));
  },
  // Empleados
  getEmployees: async () => {
    const s = await getDocs(collection(db, 'employees'));
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
  }
};
