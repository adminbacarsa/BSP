import { getAuth } from 'firebase/auth';
import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
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

export type PublishPlanificacionParams = {
    empresaId: string;
    migracionCompleta: boolean;
    selectedObjective: string;
    selectedClient: string;
    year: number;
    month: number;
    objectiveName: string;
    clientName: string;
    isSuperAdmin: boolean;
    slaHoursMismatch: boolean;
    hasCoverageGaps: boolean;
};

export type PublishPlanificacionResult = {
    publishLookupKey: string;
    actorName: string;
    totalPublished: number;
    rfzPublished: number;
    draftsCount: number;
};

export async function publishPlanificacionMonth({
    empresaId,
    migracionCompleta,
    selectedObjective,
    selectedClient,
    year,
    month,
    objectiveName,
    clientName,
    isSuperAdmin,
    slaHoursMismatch,
    hasCoverageGaps,
}: PublishPlanificacionParams): Promise<PublishPlanificacionResult> {
    const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
    const publishDocId = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
    const auth = getAuth();
    const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';

    await setDoc(doc(db, 'planificacion_estados', publishDocId), {
        objetivoId: selectedObjective,
        objectiveId: selectedObjective,
        año: year,
        mes: month,
        year,
        month,
        publishedAt: serverTimestamp(),
        publishedBy: actorName,
        lastModifiedAt: serverTimestamp(),
        lastModifiedBy: actorName,
        empresaId,
    }, { merge: true });

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    const draftsSnap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', '==', selectedObjective),
        where('draft', '==', true),
        where('startTime', '>=', Timestamp.fromDate(firstDay)),
        where('startTime', '<=', Timestamp.fromDate(lastDay)),
    ));
    const batch = writeBatch(db);
    draftsSnap.docs
        .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
        .forEach(d => batch.update(d.ref, { draft: false }));

    let rfzPublished = 0;
    try {
        const rfzDraftSnap = await getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', selectedObjective),
            where('code', '==', 'RFZ'),
            where('draft', '==', true),
        ));
        const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
        rfzDraftSnap.docs
            .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
            .filter(d => String(d.data().fecha || '').startsWith(monthPrefix))
            .forEach(d => { batch.update(d.ref, { draft: false }); rfzPublished++; });
    } catch (e) {
        console.warn('[plan] publish RFZ draft sweep error:', e);
    }
    await batch.commit();

    await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
        action: 'PUBLICACION_CRONOGRAMA',
        module: 'PLANIFICADOR',
        details: isSuperAdmin && (slaHoursMismatch || hasCoverageGaps)
            ? `[OVERRIDE SA] Cronograma publicado — ${objectiveName} · ${String(month).padStart(2, '0')}/${year} · ${draftsSnap.docs.length} turno(s)`
            : `Cronograma publicado — ${objectiveName} · ${String(month).padStart(2, '0')}/${year} · ${draftsSnap.docs.length} turno(s) notificado(s)`,
        timestamp: serverTimestamp(),
        actorName,
        actorUid: auth.currentUser?.uid || null,
        objectiveId: selectedObjective,
        objectiveName,
        clientId: selectedClient || undefined,
        clientName: clientName || undefined,
        year,
        month,
    }, empresaId));

    const totalPublished = draftsSnap.docs.length + rfzPublished;

    return {
        publishLookupKey,
        actorName,
        totalPublished,
        rfzPublished,
        draftsCount: draftsSnap.docs.length,
    };
}
