
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, query, orderBy, where } from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';

export interface Holiday {
  id?: string;
  date: string;
  name: string;
  type: 'Nacional' | 'Puente' | 'Optativo' | 'Gremial';
  empresaId?: string;
}

export const holidayService = {
  /** Globales (sin empresaId) + feriados del tenant activo. */
  getForEmpresa: async (empresaId: string) => {
    const id = String(empresaId ?? '').trim();
    const s = await getDocs(query(collection(db, 'feriados'), orderBy('date', 'asc')));
    return s.docs
      .filter((d) => {
        const emp = String(d.data().empresaId ?? '').trim();
        return !emp || emp === id;
      })
      .map(d => ({ id: d.id, ...d.data() } as Holiday));
  },

  getAll: async () => {
    const q = query(collection(db, 'feriados'), orderBy('date', 'asc'));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() } as Holiday));
  },

  add: async (data: Holiday, empresaId?: string) => {
    const payload = empresaId && !data.empresaId
      ? stampEmpresaId(data as Record<string, unknown>, empresaId)
      : data;
    return addDoc(collection(db, 'feriados'), payload);
  },
  
  delete: (id: string) => deleteDoc(doc(db, 'feriados', id)),

  syncWithGovApi: async (year: number, empresaId?: string) => {
    try {
      const response = await fetch(`https://nolaborables.com.ar/api/v2/feriados/${year}`);
      if (!response.ok) throw new Error('No se pudo conectar con el servidor de feriados.');
      
      const data = await response.json();
      let addedCount = 0;

      const existingQuery = query(collection(db, 'feriados'), where('date', '>=', `${year}-01-01`), where('date', '<=', `${year}-12-31`));
      const existingDocs = await getDocs(existingQuery);
      const existingDates = new Set(existingDocs.docs.map(d => d.data().date));

      const batchPromises = data.map(async (h: any) => {
          const month = String(h.mes).padStart(2, '0');
          const day = String(h.dia).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;

          if (!existingDates.has(dateStr)) {
              addedCount++;
              const row: Holiday = { date: dateStr, name: h.motivo, type: 'Nacional' };
              return holidayService.add(row, empresaId);
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
