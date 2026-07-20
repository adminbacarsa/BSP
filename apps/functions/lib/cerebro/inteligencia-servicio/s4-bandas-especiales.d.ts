import { CerebroSLA, BandaEspecialInfo } from '../types';
export declare function detectarBandasEspeciales(sla: CerebroSLA): BandaEspecialInfo;
export declare function esBandaDe12h(code: string): boolean;
export declare function proponer12hEquivalente(bandas8h: string[]): Record<string, string>;
