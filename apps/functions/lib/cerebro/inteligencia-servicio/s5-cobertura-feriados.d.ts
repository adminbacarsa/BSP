import { CerebroSLA, CoberturaFeriado } from '../types';
export declare function inferirCoberturaFeriados(sla: CerebroSLA, year: number): CoberturaFeriado[];
export declare function feriadosConCobertura(feriados: CoberturaFeriado[]): CoberturaFeriado[];
export declare function fechasFeriadosConCobertura(feriados: CoberturaFeriado[]): string[];
export declare function esFeriadoConCobertura(feriados: CoberturaFeriado[], fecha: string): boolean;
