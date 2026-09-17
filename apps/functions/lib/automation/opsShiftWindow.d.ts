export declare const OPS_PLAN_LOOKAHEAD_MS: number;
export declare const OPS_ZOMBIE_PRESENT_MAX_MS: number;
export type TurnoLike = Record<string, unknown>;
export declare function opsMonitorQueryWindow(now: Date): {
    start: Date;
    end: Date;
};
export declare function isOpsShiftHoyServer(row: TurnoLike, now: Date): boolean;
