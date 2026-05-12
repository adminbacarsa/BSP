
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy } from 'firebase/firestore';

export interface Agreement {
  id?: string;
  name: string;             
  code: string;             
  maxHoursWeekly: number;   
  maxHoursMonthly: number;  
  
  saturdayCutoffHour: number; // Ej: 13
  saturdayRate: number;       // 0=Normal, 50=50%, 100=100% (NUEVO)
  
  nightShiftStart: number;  
  nightShiftEnd: number;    
  
  paysDoubleOnFranco: boolean; 
  categories: string[];        
}

export const agreementService = {
  getAll: async () => {
    try {
      const q = query(collection(db, 'convenios_colectivos')); 
      const s = await getDocs(q);
      
      return s.docs.map(d => {
          const data = d.data();
          return { 
              id: d.id, 
              name: data.name || 'Sin Nombre',
              code: data.code || '',
              
              maxHoursWeekly: Number(data.maxHoursWeekly || 48),
              maxHoursMonthly: Number(data.maxHoursMonthly || 200),
              
              saturdayCutoffHour: Number(data.saturdayCutoffHour || 13),
              saturdayRate: Number(data.saturdayRate !== undefined ? data.saturdayRate : 100), // Default 100% si no existe
              
              nightShiftStart: Number(data.nightShiftStart || 21),
              nightShiftEnd: Number(data.nightShiftEnd || 6),
              
              paysDoubleOnFranco: data.paysDoubleOnFranco ?? true, 
              categories: Array.isArray(data.categories) ? data.categories : []
          } as Agreement;
      });
    } catch (e) {
      console.error("Error leyendo convenios:", e);
      return [];
    }
  },

  add: async (data: Agreement) => addDoc(collection(db, 'convenios_colectivos'), {
      ...data,
      isActive: true,
      createdAt: new Date()
  }),
  
  update: async (id: string, data: Partial<Agreement>) => updateDoc(doc(db, 'convenios_colectivos', id), data),
  
  delete: (id: string) => deleteDoc(doc(db, 'convenios_colectivos', id))
};
