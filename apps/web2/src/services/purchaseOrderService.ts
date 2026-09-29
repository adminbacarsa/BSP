import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteField,
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
    opts?: { empresaId?: string; scopeEmpresa?: boolean; activeOnly?: boolean; selectableOnly?: boolean },
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
    if (opts?.selectableOnly) {
      rows = rows.filter((r) => r.status !== 'INACTIVE' && r.status !== 'CANCELLED');
    } else if (opts?.activeOnly !== false) {
      rows = rows.filter((r) => r.status !== 'INACTIVE');
    }
    return rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  },

  async create(
    data: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'>,
    opts?: { empresaId?: string },
  ): Promise<string> {
    const raw = {
      ...data,
      status: data.status || 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    const clean = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
    const payload = stampEmpresaId(clean, opts?.empresaId || data.empresaId);
    const ref = await addDoc(collection(db, COL), payload);
    return ref.id;
  },

  async update(
    id: string,
    patch: Partial<Omit<PurchaseOrder, 'id'>> & { authorizedHours?: number | null; lines?: PurchaseOrder['lines'] | null },
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      data[key] = value === null ? deleteField() : value;
    }
    await updateDoc(doc(db, COL, id), data);
  },

  async cancel(id: string, cancelledBy: string): Promise<void> {
    await this.update(id, {
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      cancelledBy,
    });
  },

  async softDelete(id: string): Promise<void> {
    await updateDoc(doc(db, COL, id), {
      status: 'INACTIVE',
      updatedAt: new Date().toISOString(),
    });
  },
};
