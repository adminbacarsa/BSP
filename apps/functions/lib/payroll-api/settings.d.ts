export type PayrollHoursMode = 'planned' | 'real';
export declare function resolveEmpresaHoursMode(empresaId: string): Promise<PayrollHoursMode>;
