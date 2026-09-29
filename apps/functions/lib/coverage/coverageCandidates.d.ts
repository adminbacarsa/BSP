export declare const COVERAGE_CASCADE_ORDER: readonly ["RET", "REF", "ESC", "EXTEND", "ADVANCE", "FT"];
export declare const COVERAGE_LEGACY_CANDIDATE_TYPES: readonly ["VOLANTE", "SIN_TURNO_CON_EXP", "SIN_TURNO"];
export type CoverageCascadeType = (typeof COVERAGE_CASCADE_ORDER)[number];
export type CoverageWizardStepKey = 'INTERNO' | 'RETENCION' | 'FT';
export declare const COVERAGE_JOIN_TOLERANCE_MS: number;
export declare const COVERAGE_HARD_CAP_MS: number;
export declare const COVERAGE_LICENSE_CODES: ReadonlySet<string>;
export type CoverageRejectReason = 'ES_EL_AUSENTE' | 'LICENCIA_TURNO' | 'LICENCIA_RRHH' | 'ZOMBI' | 'NO_CONTIGUO' | 'TOPE_12_59' | 'YA_CONVOCADO' | 'SOLAPA_COBERTURA' | 'AUSENTE' | 'NO_PRESENTE' | 'COMPLETADO' | 'SIN_SOLAPE' | 'COBERTURA_USADA' | 'HUECO_CUBIERTO' | 'FALTA_APTITUD' | 'RESTRICCION' | 'EN_OTRA_SESION' | 'DESCANSO';
export declare const COVERAGE_REJECT_LABEL: Record<CoverageRejectReason, string>;
export declare function coverageRejectMessage(reason: CoverageRejectReason): string;
export declare function coverageWizardStepKeys(order?: readonly string[]): CoverageWizardStepKey[];
export interface CoverageShiftView {
    id: string;
    employeeId: string;
    employeeName?: string;
    code?: string;
    objectiveId?: string;
    positionId?: string;
    positionName?: string;
    startMs: number;
    endMs: number;
    isPresent?: boolean;
    isCompleted?: boolean;
    isAbsent?: boolean;
    isFranco?: boolean;
    isUnassigned?: boolean;
    isVirtual?: boolean;
    draft?: boolean;
    coverageUsed?: boolean;
    isDeleted?: boolean;
    coverageSuperseded?: boolean;
    origin?: string;
    coverageType?: string;
    coverageHoursOnSource?: boolean;
    realStartMs?: number;
    checkInMs?: number;
    deploymentBand?: string;
    absenceShiftId?: string;
}
export interface CoverageAbsenceView {
    employeeId: string;
    startMs: number;
    endMs: number;
    code?: string;
    status?: string;
}
export interface CoverageEmployeeView {
    id: string;
    name?: string;
    restriccionesObjetivo?: {
        objectiveId?: string;
    }[];
    restriccionesCliente?: {
        clientId?: string;
    }[];
    aptitudes?: {
        codigo?: string;
        vigencia?: string;
    }[];
}
export interface CoverageEngagementView {
    employeeId: string;
    shiftId: string;
    status: string;
}
export interface CoverageGapView {
    titularShiftId: string;
    absentEmployeeId?: string;
    objectiveId: string;
    clientId?: string;
    positionId?: string;
    positionName?: string;
    startMs: number;
    endMs: number;
    band?: string;
    aptitudesRequeridas?: string[];
    alreadyCovered?: boolean;
}
export interface BuildCoverageCandidatesInput {
    nowMs: number;
    gap: CoverageGapView;
    shifts: CoverageShiftView[];
    absences?: CoverageAbsenceView[];
    employees?: CoverageEmployeeView[];
    engagements?: CoverageEngagementView[];
    sessionBusyEmployeeIds?: string[];
    hardCapMs?: number;
    toleranceMs?: number;
    purpose?: 'select' | 'accept';
    ignoreConvocatoriaShiftId?: string;
}
export interface CoverageCandidateRow {
    type: CoverageCascadeType;
    employeeId: string;
    employeeName: string;
    sourceShiftId: string;
    positionRank: 0 | 1;
    otherPosition: boolean;
    eligible: boolean;
    rejectReason?: CoverageRejectReason;
}
export interface CoverageCandidateSet {
    byType: Record<CoverageCascadeType, CoverageCandidateRow[]>;
    eligible: CoverageCandidateRow[];
    rejected: CoverageCandidateRow[];
}
export interface AcceptanceCheck {
    ok: boolean;
    reason?: CoverageRejectReason;
    message?: string;
}
export declare function dualSegmentBounds(gap: CoverageGapView): {
    extEndMs: number;
    advStartMs: number;
};
export declare function buildCoverageCandidates(input: BuildCoverageCandidatesInput): CoverageCandidateSet;
export declare function pickBestCandidate(set: CoverageCandidateSet, type: CoverageCascadeType): CoverageCandidateRow | null;
export declare function acceptanceStillValid(input: BuildCoverageCandidatesInput, type: CoverageCascadeType, employeeId: string, sourceShiftId?: string): AcceptanceCheck;
