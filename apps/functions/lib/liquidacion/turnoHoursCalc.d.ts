export type TurnoHoursContrib = {
    hsTeoricas: number;
    hsReales: number;
    diurnas: number;
    nocturnas: number;
    al100FT: number;
    plusFeriado: number;
    isFT: boolean;
    monthKey: string;
};
export declare function monthKeyFromDate(d: Date): string;
export declare function calcTurnoHoursContrib(data: Record<string, unknown>, holidays?: Set<string>): TurnoHoursContrib | null;
