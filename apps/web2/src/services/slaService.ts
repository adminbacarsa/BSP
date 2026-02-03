
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, where } from 'firebase/firestore';

// Definición de Turno (variante)
export interface ShiftVariant {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  hours: number;
  isCustom?: boolean;
  days?: string[];
}

// Definición de Puesto
export interface ServicePosition {
  id: string;
  name: string;
  coverageType: '24hs' | '12hs_diurno' | '12hs_nocturno' | 'custom';
  quantity: number;
  allowedShiftTypes: ShiftVariant[];
  activeDays: string[];
}

// Definición de Contrato de Servicio (SLA)
export interface ServiceSLA {
  id?: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  startDate: string;
  endDate: string;
  positions: ServicePosition[];
  totalMonthlyHours: number;
  status: 'active' | 'inactive' | 'expired';
}

export const slaService = {
  // 1. Obtener todos los servicios (para la lista general)
  getAll: async () => {
    try {
      const q = query(collection(db, 'servicios_sla'), orderBy('clientName'));
      const s = await getDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceSLA));
    } catch (e) {
      console.error("Error getting services:", e);
      return [];
    }
  },

  // 2. Obtener servicios de un cliente específico (para la pestaña del CRM)
  getByClientId: async (clientId: string) => {
    try {
      const q = query(collection(db, 'servicios_sla'), where('clientId', '==', clientId));
      const s = await getDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceSLA));
    } catch (e) {
      console.error("Error filter services:", e);
      return [];
    }
  },

  // 3. Obtener Clientes y sus Objetivos (CORREGIDO ESPAÑOL/INGLÉS)
  getClients: async () => {
    try {
      const q = query(collection(db, 'clients'), orderBy('name'));
      const s = await getDocs(q);
      return s.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          name: data.name || data.fantasyName || 'Sin Nombre',
          // AQUÍ ESTÁ LA MAGIA: Leemos 'objetivos' (tu DB actual) O 'objectives' (backup)
          objectives: data.objetivos || data.objectives || [] 
        };
      });
    } catch (e) {
      console.error("Error loading clients for dropdown:", e);
      return [];
    }
  },

  // 4. CRUD Básico
  add: async (data: ServiceSLA) => addDoc(collection(db, 'servicios_sla'), data),
  
  update: (id: string, data: Partial<ServiceSLA>) => updateDoc(doc(db, 'servicios_sla', id), data),
  
  delete: (id: string) => deleteDoc(doc(db, 'servicios_sla', id)),
};
