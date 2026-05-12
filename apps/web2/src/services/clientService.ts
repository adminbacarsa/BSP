
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Client, Objective } from '@/types/wfm';

export const clientService = {
  // Obtener todos los clientes
  getClients: async (): Promise<Client[]> => {
    try {
      const colRef = collection(db, 'clients');
      const snapshot = await getDocs(colRef);
      // Mapeo seguro para evitar errores de TS
      return snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Sin Nombre',
        cuit: doc.data().cuit || '',
        ...doc.data()
      })) as Client[];
    } catch (error) {
      console.error("Error getClients:", error);
      return [];
    }
  },

  // Obtener objetivos de un cliente
  getObjectivesByClient: async (clientId: string): Promise<Objective[]> => {
    try {
      const colRef = collection(db, 'objectives');
      const q = query(colRef, where("clientId", "==", clientId));
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        clientId: doc.data().clientId,
        name: doc.data().name || 'Objetivo Sin Nombre',
        address: doc.data().address || ''
      })) as Objective[];
    } catch (error) {
      console.error("Error getObjectivesByClient:", error);
      return [];
    }
  }
};
