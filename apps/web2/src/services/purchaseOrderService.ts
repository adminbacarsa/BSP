import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { filterRowsByEmpresa, stampEmpresaId } from '@/lib/multiempresa';
import type { PurchaseOrder } from '@/lib/crm/slaBilling.types';

const COL = 'ordenes_compra';

export const purchaseOrderService = {
  async getByClient(
    clientId: string,
    opts?: { empresaId?: string; scopeEmpresa?: boolean; activeOnly?: boolean },
  ): Promise<PurchaseOrder[]> {
    const empresaId = String(opts?.empresaId || '').trim();
    const constraints = [where('clientId', '==', clientId)];
    if (empresaId) constraints.push(where('empresaId', '==', empresaId));
    const q = query(collection(db, COL), ...constraints);
    const snap = await getDocs(q);
    let rows = snap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as PurchaseOrder,
    );
    const scope = opts?.scopeEmpresa === true && !!opts?.empresaId?.trim();
    if (scope) {
      rows = filterRowsByEmpresa(rows, opts!.empresaId!, scope) as PurchaseOrder[];
    }
    if (opts?.activeOnly !== false) {
      rows = rows.filter((r) => r.status !== 'INACTIVE');
    }
    return rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  },

  async create(
    data: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'>,
    opts?: { empresaId?: string },
  ): Promise<string> {
    const payload = stampEmpresaId(
      {
        ...data,
        status: data.status || 'ACTIVE',
        createdAt: new Date().toISOString(),
      },
      opts?.empresaId,
    );
    const ref = await addDoc(collection(db, COL), payload);
    return ref.id;
  },

  async update(id: string, patch: Partial<PurchaseOrder>): Promise<void> {
    await updateDoc(doc(db, COL, id), {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },

  async softDelete(id: string): Promise<void> {
    await updateDoc(doc(db, COL, id), {
      status: 'INACTIVE',
      updatedAt: new Date().toISOString(),
    });
  },
};
