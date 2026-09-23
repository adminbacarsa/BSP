import { type Firestore } from 'firebase-admin/firestore';
export type ShiftAbsentReason = 'AUTO_T30' | 'LLEGADA_TARDE_RECHAZADA' | 'LLEGADA_TARDE_TIMEOUT' | 'ETA_VENCIDA' | 'AVISO_MAYOR_60' | 'CONVOCADO_NO_LLEGO' | 'MANUAL_OPS';
export type MarkShiftAbsentOpts = {
    reason: ShiftAbsentReason;
    by?: string;
    skipCascadeSideEffects?: boolean;
};
export declare function markShiftAbsent(db: Firestore, shiftId: string, opts: MarkShiftAbsentOpts): Promise<{
    applied: boolean;
    alreadyAbsent?: boolean;
}>;
