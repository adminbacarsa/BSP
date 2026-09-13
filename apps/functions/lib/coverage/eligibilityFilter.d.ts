import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
export type CandidateType = 'SIN_TURNO' | 'VOLANTE' | 'SIN_TURNO_CON_EXP' | 'RET' | 'ESC' | 'EXTEND' | 'ADVANCE' | 'FT';
export type CascadeStepType = 'SIN_TURNO' | 'RET' | 'ESC' | 'EXT_DUAL' | 'FT';
export declare const CASCADE_ORDER: CascadeStepType[];
export declare const BROADCAST_LIMIT = 5;
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
export declare function toCascadeStep(type: string): CascadeStepType | null;
export declare function cascadeStepIndex(type: string): number;
export declare function nextCascadeStep(current: CascadeStepType | CandidateType | string): CascadeStepType | null;
export declare function checkEligibility(employee: Record<string, any>, ctx: EligibilityContext, candidateType: CandidateType, distanceKm?: number): EligibilityResult;
export declare function deriveCandidateType(employee: Record<string, any>, objectiveId: string, todayShifts: {
    employeeId: string;
    code?: string;
}[]): CandidateType | null;
export declare function getUrgency(startTime: Timestamp | {
    seconds: number;
}): 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
export declare function findEmployeeUid(db: admin.firestore.Firestore, employeeId: string, empData?: Record<string, any>): Promise<string | null>;
