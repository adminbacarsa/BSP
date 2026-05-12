
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy } from 'firebase/firestore';

export interface Absence {
  id?: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  status: 'Pendiente' | 'Autorizada' | 'Justificada' | 'Injustificada' | 'Rechazada';
  hasCertificate: boolean;
  reason: string;
  comments: string;
  rejectionReason?: string;
  alternativePeriodStart?: string;
  alternativePeriodEnd?: string;
  source?: string;
}

const toDateStr = (val: any): string => {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return '';
};

export const absenceService = {
  getAll: async () => {
    const q = query(collection(db, 'ausencias'), orderBy('startDate', 'desc'));
    const s = await getDocs(q);
    return s.docs.map(d => {
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
  },

  add: async (data: Absence) => addDoc(collection(db, 'ausencias'), {
      ...data,
      createdAt: new Date().toISOString()
  }),

  update: async (id: string, data: Partial<Absence>) => updateDoc(doc(db, 'ausencias', id), data),
  
  delete: (id: string) => deleteDoc(doc(db, 'ausencias', id))
};
