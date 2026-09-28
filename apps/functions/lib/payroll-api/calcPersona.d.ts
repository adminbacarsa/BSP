import * as admin from 'firebase-admin';
import type { CycleRange } from './cycle';
import type { LiquidacionSnapshot } from './calc';
export interface BuildSnapshotPersonaParams {
    db: admin.firestore.Firestore;
    cycle: CycleRange;
    empresaId: string;
    scopeEmpresa: boolean;
    migracionCompleta: boolean;
    clientIdFilter?: string;
    page: number;
    pageSize: number;
    hoursMode: 'planned' | 'real';
}
export declare function buildLiquidacionSnapshotPersona(params: BuildSnapshotPersonaParams): Promise<LiquidacionSnapshot>;
