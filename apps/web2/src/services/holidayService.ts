import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, query, orderBy, where } from 'firebase/firestore';
import { stampEmpresaId } from '@/lib/multiempresa';
import {
  feriadoCuentaParaEmpresa,
  mapArgentinaDatos,
  mapNolaborables,
  type FeriadoOficial,
} from '@/lib/rrhh/feriadosGov';

export interface Holiday {
  id?: string;
  date: string;
  name: string;
  type: 'Nacional' | 'Puente' | 'Optativo' | 'Gremial';
  empresaId?: string;
}

const FERIADOS_ERROR = 'No se pudo conectar con el servidor de feriados';

async function leerJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Principal: argentinadatos. Si falla o viene vacía, nolaborables. */
export async function cargarFeriadosOficiales(year: number): Promise<FeriadoOficial[]> {
  try {
    const data = await leerJson(`https://api.argentinadatos.com/v1/feriados/${year}`);
    const mapped = mapArgentinaDatos(data).filter((h) => h.date.startsWith(`${year}-`));
    if (mapped.length > 0) return mapped;
  } catch {
    /* respaldo */
  }
  try {
    const data = await leerJson(`https://nolaborables.com.ar/api/v2/feriados/${year}`);
    const mapped = mapNolaborables(data, year).filter((h) => h.date.startsWith(`${year}-`));
    if (mapped.length > 0) return mapped;
  } catch {
    /* las dos fallaron */
  }
  throw new Error(FERIADOS_ERROR);
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
    const oficiales = await cargarFeriadosOficiales(year);

    const existingQuery = query(
      collection(db, 'feriados'),
      where('date', '>=', `${year}-01-01`),
      where('date', '<=', `${year}-12-31`),
    );
    const existingDocs = await getDocs(existingQuery);
    const existingDates = new Set<string>();
    for (const d of existingDocs.docs) {
      const data = d.data();
      if (!feriadoCuentaParaEmpresa(data.empresaId, empresaId)) continue;
      const date = String(data.date ?? '').slice(0, 10);
      if (date) existingDates.add(date);
    }

    let addedCount = 0;
    for (const h of oficiales) {
      if (existingDates.has(h.date)) continue;
      existingDates.add(h.date);
      addedCount += 1;
      const row: Holiday = { date: h.date, name: h.name, type: h.type };
      await holidayService.add(row, empresaId);
    }
    return addedCount;
  }
};
