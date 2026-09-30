export declare const AR_OFFSET_MS: number;
export declare function arMidnightMs(ms: number): number;
export declare function arHour(ms: number): number;
export declare function arYmd(ms: number): string;
export declare function arHmOnDayMs(dayMs: number, h: number, m: number): number;
export declare function arHmOnYmdMs(ymd: string, h: number, m: number): number;
export declare function arYearMonth(ms: number): {
    year: number;
    month: number;
};
export declare function arPlanificacionEstadoKey(objectiveId: string, ms: number): string;
export declare function arDayBoundsMs(ms: number): {
    startMs: number;
    endMs: number;
};
export declare function vacancyActionTargetAr(scheduleDateYmd: string, nowMs: number): 'PLANIFICACION' | 'OPERACIONES';
