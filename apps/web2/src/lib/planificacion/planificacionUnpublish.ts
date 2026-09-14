import { getAuth } from 'firebase/auth';
import {
    collection,
    deleteField,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    where,
    writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
    belongsToEmpresaView,
    buildPlanificacionEstadoDocId,
    planificacionPublishLookupKey,
    stampEmpresaId,
} from '@/lib/multiempresa';
import { isOperationalOriginShift } from '@/lib/planificacion/planificacionPlanningShiftRules';

export type UnpublishPlanificacionParams = {
    empresaId: string | null | undefined;
    migracionCompleta: boolean;
    selectedObjective: string;
    year: number;
    month: number;
    objectiveName: string;
};

export type UnpublishPlanificacionResult = {
    restoredDrafts: number;
    publishLookupKey: string;
};

export async function unpublishPlanificacionMonth({
    empresaId,
    migracionCompleta,
    selectedObjective,
    year,
    month,
    objectiveName,
}: UnpublishPlanificacionParams): Promise<UnpublishPlanificacionResult> {
    const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
    const primaryDocId = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
    const legacyDocId = buildPlanificacionEstadoDocId('', selectedObjective, year, month);

    const auth = getAuth();
    const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59, 999);
    const shiftSnap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', '==', selectedObjective),
    ));
    const batch = writeBatch(db);
    let restoredDrafts = 0;

    shiftSnap.docs
        .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
        .filter(d => {
            const data = d.data();
            const start = data.startTime?.toDate?.();
            if (!start || start < firstDay || start > lastDay) return false;
            if (isOperationalOriginShift(data)) return false;
            const code = String(data.code || '').toUpperCase();
            if (code === 'RFZ' || code === 'TURA') return false;
            return data.draft !== true;
        })
        .forEach(d => {
            batch.update(d.ref, { draft: true });
            restoredDrafts++;
        });

    const clearPublish = {
        publishedAt: deleteField(),
        publishedBy: deleteField(),
    };
    const primaryRef = doc(db, 'planificacion_estados', primaryDocId);
    const primarySnap = await getDoc(primaryRef);
    if (primarySnap.exists()) {
        batch.update(primaryRef, clearPublish);
    }
    if (legacyDocId !== primaryDocId) {
        const legacyRef = doc(db, 'planificacion_estados', legacyDocId);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
            batch.update(legacyRef, clearPublish);
        }
    }
    batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
        action: 'DESPUBLICACION_CRONOGRAMA',
        module: 'PLANIFICADOR',
        details: `Cronograma despublicado — ${objectiveName} · ${month}/${year} · ${restoredDrafts} turno(s) vuelven a borrador (puestos conservados)`,
        timestamp: serverTimestamp(),
        actorName,
        actorUid: auth.currentUser?.uid || null,
        objectiveId: selectedObjective,
        objectiveName,
        year,
        month,
    }, empresaId));

    await batch.commit();

    return { restoredDrafts, publishLookupKey };
}
