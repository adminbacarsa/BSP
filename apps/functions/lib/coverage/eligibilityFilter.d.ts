import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
export type CandidateType = 'RET' | 'VOLANTE' | 'SIN_TURNO_CON_EXP' | 'EXTEND' | 'ADVANCE' | 'SIN_TURNO' | 'FT';
export interface EligibilityContext {
    objectiveId: string;
    clientId?: string;
    aptitudesRequeridas?: string[];
    shiftCode?: string;
}
export interface EligibilityResult {
    eligible: boolean;
    reason?: string;
}
export declare function checkEligibility(employee: Record<string, any>, ctx: EligibilityContext, candidateType: CandidateType, distanceKm?: number): EligibilityResult;
export declare function deriveCandidateType(employee: Record<string, any>, objectiveId: string, todayShifts: {
    employeeId: string;
    code?: string;
}[]): CandidateType | null;
export declare const CASCADE_ORDER: CandidateType[];
export declare function nextCascadeStep(current: CandidateType): CandidateType | null;
export declare function getUrgency(startTime: Timestamp | {
    seconds: number;
}): 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
export declare function findEmployeeUid(db: admin.firestore.Firestore, employeeId: string, empData?: Record<string, any>): Promise<string | null>;
