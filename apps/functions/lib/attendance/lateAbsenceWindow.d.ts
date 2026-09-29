export declare const LATE_ABSENCE_FLOOR_MS: number;
export declare const LATE_ABSENCE_CAP_MS: number;
export declare const PROVISIONAL_LATE_REASONS: Set<string>;
export declare const REVERSIBLE_LATE_REASONS: Set<string>;
export declare function shiftStartMs(shift: Record<string, unknown>): number;
export declare function lateAbsenceDeadlineMs(plannedStartMs: number, etaAtMs: number): number;
export declare function isProvisionalLateAbsence(shift: Record<string, unknown>, nowMs: number): boolean;
export declare function isReversibleLateAbsence(shift: Record<string, unknown>, nowMs: number): boolean;
export declare function lateVacancyDue(shift: Record<string, unknown>, nowMs: number): boolean;
