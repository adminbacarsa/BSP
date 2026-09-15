import { getAuth } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { logOpsError } from '@/lib/operaciones/logOpsError';
import { writeCriticalAuditLog } from '@/lib/audit/criticalAuditLog';

export type OpsAuditLogFields = {
    actorName?: string;
    objectiveId?: string;
    objectiveName?: string;
    clientId?: string;
    clientName?: string;
    employeeId?: string;
    employeeName?: string;
    shiftId?: string;
    /** Campos extra (actorId, userRole, autoStarted, …) */
    meta?: Record<string, unknown>;
    /** Por defecto true — algunos eventos de guardia no llevan module. */
    includeModule?: boolean;
    /** Si true, falla la escritura de auditoría → lanza (operación crítica). */
    critical?: boolean;
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
    const auth = getAuth();
    const meta = extra?.meta ?? {};
    const actorName = resolveOpsActorName(extra?.actorName);
    const actorUid = auth.currentUser?.uid || null;
    const auditExtra: Record<string, unknown> = { ...meta };
    if (extra?.objectiveId != null) auditExtra.objectiveId = extra.objectiveId;
    if (extra?.objectiveName != null) auditExtra.objectiveName = extra.objectiveName;
    if (extra?.clientId != null) auditExtra.clientId = extra.clientId;
    if (extra?.clientName != null) auditExtra.clientName = extra.clientName;
    if (extra?.employeeId != null) auditExtra.employeeId = extra.employeeId;
    if (extra?.employeeName != null) auditExtra.employeeName = extra.employeeName;
    if (extra?.shiftId != null) auditExtra.shiftId = extra.shiftId;

    if (extra?.critical) {
        await writeCriticalAuditLog({
            empresaId,
            action,
            module: extra?.includeModule !== false ? 'OPERACIONES' : 'OPERACIONES',
            details,
            actorUid,
            actorName,
            extra: auditExtra,
        });
        return;
    }

    try {
        const payload: Record<string, unknown> = {
            action,
            details,
            timestamp: serverTimestamp(),
            actorName,
            ...meta,
        };
        if (extra?.includeModule !== false) {
            payload.module = 'OPERACIONES';
        }
        if (!('actorId' in meta) && !('actorUid' in meta)) {
            payload.actorUid = actorUid;
        }
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

/** Auditoría de Ops que debe completarse (lanza `CriticalAuditError` si falla). */
export async function registrarBitacoraOpsCritical(
    action: string,
    details: string,
    empresaId: string,
    extra?: OpsAuditLogFields,
): Promise<void> {
    await registrarBitacoraOps(action, details, empresaId, { ...extra, critical: true });
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
