import { CerebroSLA, CoverageNeed } from '../types';
export declare function leerSlaYDerivarCobertura(sla: CerebroSLA): CoverageNeed[];
export declare function filtrarNeedsParaFecha(needs: CoverageNeed[], fecha: string, diaSemana: string): CoverageNeed[];
export declare function agruparNeedsPorBanda(needs: CoverageNeed[]): Record<string, number>;
