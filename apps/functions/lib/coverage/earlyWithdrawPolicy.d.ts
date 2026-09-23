export type EarlyWithdrawReplacePolicy = 'NO_REPLACE' | 'OPERATOR_CHOICE' | 'REPLACE' | 'AUTO_REPLACE';
export type EarlyWithdrawReason = 'ENFERMEDAD' | 'ABANDONO' | 'FAMILIAR' | 'OPERATIVO' | 'AUTORIZADO';
export declare function hoursRemainingUntilEnd(nowMs: number, endMs: number): number;
export declare function resolveEarlyWithdrawReplacePolicy(opts: {
    hoursLeft: number;
    colleaguesPresent: number;
    reemplazarRetiro2a3h: boolean | null;
    isAutoMode: boolean;
    operatorReplaceChoice?: boolean | null;
}): EarlyWithdrawReplacePolicy;
export declare function rrhhPartialForReason(reason: EarlyWithdrawReason): {
    absenceType: 'E' | 'A' | 'AA';
    typeLabel: string;
    disciplinary: boolean;
};
