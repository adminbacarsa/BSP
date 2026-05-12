
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, query, orderBy, where } from 'firebase/firestore';

export interface Holiday {
  id?: string;
  date: string; // YYYY-MM-DD
  name: string;
  type: 'Nacional' | 'Puente' | 'Optativo' | 'Gremial';
}

export const holidayService = {
  getAll: async () => {
    const q = query(collection(db, 'feriados'), orderBy('date', 'asc'));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday));
  },

  add: async (data: Holiday) => addDoc(collection(db, 'feriados'), data),
  
  delete: (id: string) => deleteDoc(doc(db, 'feriados', id)),

  // --- NUEVA FUNCIÓN: IMPORTAR DESDE API OFICIAL ---
  syncWithGovApi: async (year: number) => {
    try {
      // 1. Fetch a la API pública de Argentina
      const response = await fetch(`https://nolaborables.com.ar/api/v2/feriados/${year}`);
      if (!response.ok) throw new Error('No se pudo conectar con el servidor de feriados.');
      
      const data = await response.json();
      let addedCount = 0;

      // 2. Obtener feriados ya existentes para no duplicar
      const existingQuery = query(collection(db, 'feriados'), where('date', '>=', `${year}-01-01`), where('date', '<=', `${year}-12-31`));
      const existingDocs = await getDocs(existingQuery);
      const existingDates = new Set(existingDocs.docs.map(d => d.data().date));

      // 3. Procesar y Guardar
      const batchPromises = data.map(async (h: any) => {
          // Formato API: dia: 1, mes: 1, motivo: "Año Nuevo", tipo: "inamovible"
          const month = String(h.mes).padStart(2, '0');
          const day = String(h.dia).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          if (!existingDates.has(dateStr)) {
              addedCount++;
              return addDoc(collection(db, 'feriados'), {
                  date: dateStr,
                  name: h.motivo,
                  type: 'Nacional' // Por defecto vienen nacionales
              });
          }
      });

      await Promise.all(batchPromises);
      return addedCount;

    } catch (e) {
      console.error("Error importando feriados:", e);
      throw e;
    }
  }
};
