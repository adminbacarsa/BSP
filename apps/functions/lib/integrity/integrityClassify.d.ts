export type TurnoFinding = 'turnoClienteInexistente' | 'turnoObjetivoInexistente' | 'turnoEmpresaDistinta';
export type ClientLookup = {
    empresaId: string;
    exists: boolean;
};
export declare function classifyTurnoFindings(turno: {
    clientId?: unknown;
    objectiveId?: unknown;
    empresaId?: unknown;
}, clientsById: Map<string, ClientLookup>, objectiveIdsOfEmpresa: Set<string>): TurnoFinding[];
export declare function slaClientIsMissing(clientId: unknown, clientsById: Map<string, ClientLookup>): boolean;
export declare const INTEGRITY_SAMPLE_CAP = 40;
export type IntegrityCounts = {
    turnoClienteInexistente: number;
    turnoObjetivoInexistente: number;
    turnoEmpresaDistinta: number;
    slaClienteInexistente: number;
};
export type IntegrityReportBody = {
    empresaId: string;
    date: string;
    windowStart: string;
    windowEnd: string;
    generatedAt: string;
    counts: IntegrityCounts;
    samples: Record<keyof IntegrityCounts, string[]>;
    totalFindings: number;
    mode: 'report_only';
};
export declare function emptyIntegrityCounts(): IntegrityCounts;
export declare function pushSample(list: string[], id: string): void;
export declare function totalFindings(counts: IntegrityCounts): number;
export declare function arDateKey(d?: Date): string;
export declare function integrityReportId(empresaId: string, date?: string): string;
export declare function scanLoadedEmpresa(input: {
    empresaId: string;
    date: string;
    windowStart: string;
    windowEnd: string;
    generatedAt: string;
    turnos: Array<{
        id: string;
        clientId?: unknown;
        objectiveId?: unknown;
        empresaId?: unknown;
    }>;
    slas: Array<{
        id: string;
        clientId?: unknown;
    }>;
    clientsById: Map<string, ClientLookup>;
    objectiveIds: Set<string>;
}): IntegrityReportBody;
export declare function integrityNovedadDescription(reportId: string, counts: IntegrityCounts): string;
