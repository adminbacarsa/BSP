import { getAuth } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { logOpsError } from '@/lib/operaciones/logOpsError';

export type OpsAuditLogFields = {
    actorName?: string;
    objectiveId?: string;
    objectiveName?: string;
    clientId?: string;
    clientName?: string;
    employeeId?: string;
    employeeName?: string;
    shiftId?: string;
};

function resolveOpsActorName(override?: string): string {
    if (override) return override;
    const auth = getAuth();
    return auth.currentUser?.displayName
        || auth.currentUser?.email?.split('@')[0]
        || 'Operador';
}

/**
 * Registra evento en audit_logs con stampEmpresaId (multi-tenant).
 */
export async function registrarBitacoraOps(
    action: string,
    details: string,
    empresaId: string,
    extra?: OpsAuditLogFields,
): Promise<void> {
    try {
        const auth = getAuth();
        const payload: Record<string, unknown> = {
            action,
            module: 'OPERACIONES',
            details,
            timestamp: serverTimestamp(),
            actorName: resolveOpsActorName(extra?.actorName),
            actorUid: auth.currentUser?.uid || null,
        };
        if (extra?.objectiveId != null) payload.objectiveId = extra.objectiveId;
        if (extra?.objectiveName != null) payload.objectiveName = extra.objectiveName;
        if (extra?.clientId != null) payload.clientId = extra.clientId;
        if (extra?.clientName != null) payload.clientName = extra.clientName;
        if (extra?.employeeId != null) payload.employeeId = extra.employeeId;
        if (extra?.employeeName != null) payload.employeeName = extra.employeeName;
        if (extra?.shiftId != null) payload.shiftId = extra.shiftId;

        await addDoc(collection(db, 'audit_logs'), stampEmpresaId(payload, empresaId));
    } catch (e) {
        logOpsError('registrarBitacoraOps', e, { userMessage: 'No se pudo registrar en bitácora.' });
    }
}

/** Variante fire-and-forget (no bloquea UI). */
export function registrarBitacoraOpsBg(
    action: string,
    details: string,
    empresaId: string,
    extra?: OpsAuditLogFields,
): void {
    void registrarBitacoraOps(action, details, empresaId, extra);
}
