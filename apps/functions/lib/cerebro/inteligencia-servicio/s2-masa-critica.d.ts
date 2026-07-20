import { CoverageNeed, MasaCritica } from '../types';
type Ciclo = {
    diasTrabajo: number;
    cicloDias: number;
};
export declare function calcularMasaCritica(needs: CoverageNeed[], empleadosPorBanda?: Record<string, number>): MasaCritica[];
export declare function calcularMinimoPorCiclo(cantSimultaneos: number, ciclo: Ciclo): number;
export declare function calcularMinimoParaBanda(cantSimultaneos: number, esBanda12h: boolean): number;
export declare function generarAlertasDeficit(masas: MasaCritica[]): string[];
export declare function hayDeficit(masas: MasaCritica[]): boolean;
export {};
