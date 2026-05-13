import type { CycleRange } from './cycle';
export interface RrhhNovedades {
    vacacionesDias: number;
    enfermedadDias: number;
    art: number;
    licenciaEspecialDias: number;
    permisoGremialDias: number;
    injustificadaDias: number;
}
export interface EmployeeLiquidacion {
    employee: {
        id: string;
        dni: string;
        cuil: string | null;
        fileNumber: string | null;
        fullName: string;
        laborAgreement: string | null;
    };
    acumulado: {
        hsTeoricas: number;
        hsReales: number;
        diurnas: number;
        nocturnas: number;
        al50: number;
        al100FT: number;
        plusFeriado: number;
    };
    liquidacion200: {
        bolsa: number;
        hsSimples: number;
        al50: number;
        nota: string;
    };
    pagaAparte: {
        francoTrabajado100: number;
        plusFeriado: number;
    };
    novedadesRRHH: RrhhNovedades;
    turnosCount: number;
    turnosConFichada: number;
    warnings: string[];
}
export interface LiquidacionSnapshot {
    cycleId: string;
    cycleStart: string;
    cycleEnd: string;
    cctVersion: '422/05';
    generatedAt: string;
    lockedAt: string | null;
    empresaId: string;
    items: EmployeeLiquidacion[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
    };
}
interface BuildSnapshotParams {
    cycle: CycleRange;
    empresaId: string;
    clientIdFilter?: string;
    page?: number;
    pageSize?: number;
}
export declare function buildLiquidacionSnapshot(params: BuildSnapshotParams): Promise<LiquidacionSnapshot>;
export {};
