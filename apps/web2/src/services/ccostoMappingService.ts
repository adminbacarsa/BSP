import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export interface CcostoCatalogItem {
  ccosto: string;
  count: number;
  objectiveId?: string;
  clientId?: string;
  objectiveName?: string;
  clientName?: string;
  linkedAt?: string;
  linkedBy?: string;
}

export interface CcostoMappingDoc {
  empresaId: string;
  sourceFile?: string;
  items: CcostoCatalogItem[];
  updatedAt?: unknown;
  updatedBy?: string;
}

function mappingRef(empresaId: string) {
  return doc(db, 'ccosto_objective_mapping', empresaId);
}

export const ccostoMappingService = {
  async get(empresaId: string): Promise<CcostoMappingDoc | null> {
    if (!empresaId) return null;
    const snap = await getDoc(mappingRef(empresaId));
    if (!snap.exists()) return null;
    const data = snap.data() as CcostoMappingDoc;
    return {
      empresaId,
      sourceFile: data.sourceFile,
      items: Array.isArray(data.items) ? data.items : [],
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
    };
  },

  async save(
    empresaId: string,
    items: CcostoCatalogItem[],
    opts?: { sourceFile?: string },
  ): Promise<void> {
    if (!empresaId) throw new Error('empresaId requerido');
    const actor = getAuth().currentUser?.displayName
      || getAuth().currentUser?.email?.split('@')[0]
      || 'admin';
    await setDoc(
      mappingRef(empresaId),
      {
        empresaId,
        items,
        sourceFile: opts?.sourceFile ?? null,
        updatedAt: serverTimestamp(),
        updatedBy: actor,
      },
      { merge: true },
    );
  },
};
