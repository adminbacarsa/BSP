import type { CycleRange } from './cycle';
export declare const RRHH_CODE_MAP: Record<string, keyof Omit<RrhhNovedades, 'otrosDias'>>;
export declare const RRHH_TYPE_LABEL_TO_CODE: Record<string, string>;
export interface RrhhNovedades {
    vacacionesDias: number;
    enfermedadDias: number;
    art: number;
    licenciaEspecialDias: number;
    permisoGremialDias: number;
    injustificadaDias: number;
    retiroAnticipadoDias: number;
    otrosDias: number;
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
    totales?: number;
    desglose?: {
        plan: number;
        ext: number;
        adv: number;
        cobertura: number;
        ft: number;
        tura: number;
    };
    turnosCount: number;
    turnosConFichada: number;
    warnings: string[];
}
export interface LiquidacionSnapshot {
    cycleId: string;
    cycleStart: string;
    cycleEnd: string;
    cctVersion: '422/05';
    hoursMode: 'planned' | 'real';
    generatedAt: string;
    lockedAt: string | null;
    empresaId: string;
    items: EmployeeLiquidacion[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
    };
    diagnostics?: {
        empleadosEmpresa: number;
        turnosEnRango: number;
        turnosContados: number;
        turnosDescartadosEmpresa: number;
        turnosDescartadosEmpleado: number;
        turnosSinHorario: number;
        turnosBorrador: number;
        ausenciasContadas: number;
        hoursCoreEnabled?: boolean;
    };
}
export declare const round: (n: number) => number;
export declare const fmtCuil: (raw: any) => string | null;
export declare const tsToDate: (val: any) => Date | null;
export declare const overlapsDay: (rangeStart: Date, rangeEnd: Date, dayStr: string) => boolean;
export declare const datesBetween: (start: Date, end: Date) => string[];
export interface BuildSnapshotParams {
    cycle: CycleRange;
    empresaId: string;
    clientIdFilter?: string;
    page?: number;
    pageSize?: number;
    hoursMode?: 'planned' | 'real';
}
export declare function buildLiquidacionSnapshot(params: BuildSnapshotParams): Promise<LiquidacionSnapshot>;
