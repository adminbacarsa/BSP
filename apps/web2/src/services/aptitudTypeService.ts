import { db } from '@/lib/firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    getDocs,
    query,
    where,
    orderBy,
} from 'firebase/firestore';
import { type AptitudType, APTITUD_SEEDS } from '@/lib/rrhh/aptitudTypes';

const seedingPromises = new Map<string, Promise<void>>();

export const aptitudTypeService = {
    listByEmpresa: async (empresaId: string): Promise<AptitudType[]> => {
        const q = query(
            collection(db, 'tipos_aptitud'),
            where('empresaId', '==', empresaId),
            where('status', '==', 'ACTIVE'),
            orderBy('sortOrder'),
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as AptitudType));
    },

    ensureSeeded: async (empresaId: string): Promise<AptitudType[]> => {
        if (!seedingPromises.has(empresaId)) {
            const p = (async () => {
                const q = query(
                    collection(db, 'tipos_aptitud'),
                    where('empresaId', '==', empresaId),
                );
                const snap = await getDocs(q);
                const existingCodigos = new Set(snap.docs.map(d => (d.data() as AptitudType).codigo));
                const missing = APTITUD_SEEDS.filter(s => !existingCodigos.has(s.codigo));
                await Promise.all(missing.map(seed =>
                    addDoc(collection(db, 'tipos_aptitud'), { ...seed, empresaId })
                ));
            })();
            seedingPromises.set(empresaId, p);
        }
        await seedingPromises.get(empresaId);
        return aptitudTypeService.listByEmpresa(empresaId);
    },

    create: async (empresaId: string, data: Omit<AptitudType, 'id' | 'empresaId'>): Promise<string> => {
        const ref = await addDoc(collection(db, 'tipos_aptitud'), { ...data, empresaId });
        return ref.id;
    },

    update: async (docId: string, data: Partial<AptitudType>): Promise<void> => {
        await updateDoc(doc(db, 'tipos_aptitud', docId), data as Record<string, unknown>);
    },

    deactivate: async (docId: string): Promise<void> => {
        await updateDoc(doc(db, 'tipos_aptitud', docId), { status: 'INACTIVE' });
    },
};
