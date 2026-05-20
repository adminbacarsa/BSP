export declare function ymCordobaParts(dt: Date): {
    year: number;
    month: number;
    ym: string;
};
export declare function buildPlanificacionEstadoDocId(empresaId: string, objectiveId: string, year: number, month: number): string;
export declare function planificacionEstadoLookupDocIds(empresaId: string, objectiveId: string, year: number, month: number): string[];
export declare function planificacionEstadoLookupKey(objectiveId: string, ym: string): string;
