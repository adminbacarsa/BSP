
import { db, onSnapshotFresh } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy, where } from 'firebase/firestore';
import { empresaScopedQuery, deleteDocForEmpresa, updateDocForEmpresa, stampEmpresaId } from '@/lib/multiempresa';
import { validateAbsenceDateRange, toCalendarDateStr } from '@/lib/planificacion/absenceCodes';

export interface Absence {
  id?: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  status: 'Pendiente' | 'En verificación' | 'Autorizada' | 'Justificada' | 'Injustificada' | 'Rechazada';
  hasCertificate: boolean;
  reason: string;
  comments: string;
  rejectionReason?: string;
  alternativePeriodStart?: string;
  alternativePeriodEnd?: string;
  source?: string;
  ajusteCronoId?: string;
  coberturaEstado?: 'PENDIENTE' | 'GESTIONADA' | 'VACANTE';
}

const toDateStr = (val: unknown): string => toCalendarDateStr(val) || '';

export const absenceService = {
  getAll: async (opts?: { empresaId?: string; scopeEmpresa?: boolean }) => {
    const scope = opts?.scopeEmpresa === true && !!opts?.empresaId?.trim();
    const s = await getDocs(
      scope
        ? (empresaScopedQuery('ausencias', opts!.empresaId!, true) as ReturnType<typeof query>)
        : query(collection(db, 'ausencias'), orderBy('startDate', 'desc')),
    );
    const rows = s.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            startDate: toDateStr(data.startDate),
            endDate: toDateStr(data.endDate),
            employeeName: data.employeeName || '',
            status: data.status || 'Pendiente',
            hasCertificate: data.hasCertificate || false,
            reason: data.reason || '',
            comments: data.comments || ''
        } as Absence;
    });
    return scope ? rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')) : rows;
  },

  add: async (data: Absence, empresaId?: string) => {
    const range = validateAbsenceDateRange(data.startDate, data.endDate);
    if (!range.ok) throw new Error(range.message);
    return addDoc(collection(db, 'ausencias'), stampEmpresaId({
      ...data,
      startDate: range.startDate,
      endDate: range.endDate,
      createdAt: new Date().toISOString(),
    }, empresaId || ''));
  },

  update: async (id: string, data: Partial<Absence>, opts?: { empresaId: string; migracionCompleta: boolean }) => {
    const payload = { ...data } as Partial<Absence>;
    if (payload.startDate != null || payload.endDate != null) {
      const range = validateAbsenceDateRange(payload.startDate, payload.endDate);
      if (!range.ok) throw new Error(range.message);
      payload.startDate = range.startDate;
      payload.endDate = range.endDate;
    }
    if (opts?.empresaId) {
      return updateDocForEmpresa('ausencias', id, payload as Record<string, unknown>, opts.empresaId, opts.migracionCompleta);
    }
    return updateDoc(doc(db, 'ausencias', id), payload);
  },

  delete: (id: string, opts?: { empresaId: string; migracionCompleta: boolean }) => {
    if (opts?.empresaId) {
      return deleteDocForEmpresa('ausencias', id, opts.empresaId, opts.migracionCompleta);
    }
    return deleteDoc(doc(db, 'ausencias', id));
  },

  subscribeAllByEmpresa(empresaId: string, cb: (items: Absence[]) => void) {
    const q = query(
      collection(db, 'ausencias'),
      where('empresaId', '==', empresaId),
      orderBy('startDate', 'desc'),
    );
    return onSnapshotFresh(q, snap => cb(
      snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          startDate: toDateStr(data.startDate),
          endDate: toDateStr(data.endDate),
          status: data.status || 'Pendiente',
        } as Absence;
      })
    ));
  },

  subscribePendientes(empresaId: string, cb: (items: Absence[]) => void) {
    const q = query(
      collection(db, 'ausencias'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'Pendiente'),
      orderBy('startDate', 'desc'),
    );
    return onSnapshotFresh(q, snap => cb(
      snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          startDate: toDateStr(data.startDate),
          endDate: toDateStr(data.endDate),
          status: data.status || 'Pendiente',
        } as Absence;
      })
    ));
  },
};
