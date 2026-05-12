
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, query, where, doc, updateDoc, deleteDoc, arrayUnion, orderBy } from 'firebase/firestore';
import { Client, Objective, Contact, ServiceSLA } from '@/types/crm';

export const crmService = {
  // CLIENTES
  getClients: async () => {
    const s = await getDocs(collection(db, 'clients'));
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Client));
  },
  addClient: (data: any) => addDoc(collection(db, 'clients'), { 
    ...data, 
    contacts: [], 
    timeline: [], 
    ltv: 0,
    createdAt: new Date() 
  }),
  updateClient: (id: string, data: any) => updateDoc(doc(db, 'clients', id), data),
  deleteClient: (id: string) => deleteDoc(doc(db, 'clients', id)),

  // SEDES (OBJETIVOS)
  getObjectives: async (clientId: string) => {
    const q = query(collection(db, 'objectives'), where('clientId', '==', clientId));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Objective));
  },
  addObjective: (data: any) => addDoc(collection(db, 'objectives'), { ...data, createdAt: new Date() }),
  updateObjective: (id: string, data: any) => updateDoc(doc(db, 'objectives', id), data),
  deleteObjective: (id: string) => deleteDoc(doc(db, 'objectives', id)),

  // SERVICIOS (SLA)
  getServices: async (objectiveId: string) => {
    const q = query(collection(db, 'services'), where('objectiveId', '==', objectiveId));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as any));
  },
  addService: (data: any) => addDoc(collection(db, 'services'), { ...data, createdAt: new Date() }),

  // BITÁCORA
  addTimelineNote: (clientId: string, note: string) => 
    updateDoc(doc(db, 'clients', clientId), { 
      timeline: arrayUnion({ text: note, date: new Date().toISOString(), user: 'Admin' }) 
    }),
};
