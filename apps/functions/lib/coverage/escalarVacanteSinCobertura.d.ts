import * as admin from 'firebase-admin';
export type EscalarVacanteParams = {
    shiftId: string;
    empresaId?: string | null;
    objectiveId?: string | null;
    objectiveName?: string | null;
    positionName?: string | null;
    message?: string | null;
    attemptRetention?: boolean;
    source?: string;
};
export type EscalarVacanteResult = {
    escalated: boolean;
    retained: boolean;
    retentionShiftIds: string[];
    novedadId?: string;
    supervisorsNotified: number;
};
export declare function escalarVacanteSinCobertura(db: admin.firestore.Firestore, params: EscalarVacanteParams): Promise<EscalarVacanteResult>;
export declare function countColleaguesPresentSameObjective(db: admin.firestore.Firestore, objectiveId: string, excludeShiftId: string, excludeEmployeeId: string): Promise<number>;
export declare function loadReemplazarRetiro2a3hFromSla(db: admin.firestore.Firestore, objectiveId: string, positionName: string): Promise<boolean | null>;
