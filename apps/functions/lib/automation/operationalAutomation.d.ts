export type PlanningAutomationInput = {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    applyGemini?: boolean;
    overwriteAutoDrafts?: boolean;
    dryRun?: boolean;
};
export type PlanningAutomationResult = {
    ok: boolean;
    runId: string;
    objectiveId: string;
    year: number;
    month: number;
    assignmentsGenerated: number;
    assignmentsPersisted: number;
    coverageRatio: number;
    uncoveredSlots: number;
    slaHoursClosed: boolean;
    geminiApplied: boolean;
    geminiCorrectionsApplied: number;
    geminiSummary: string | null;
    dryRun: boolean;
    notes: string[];
};
export type OperationalAlertScanInput = {
    empresaId: string;
    lookbackHours?: number;
    lookaheadHours?: number;
    toleranceMinutes?: number;
};
export type OperationalAlertScanResult = {
    ok: boolean;
    empresaId: string;
    evaluatedShifts: number;
    opsWindowShifts: number;
    anomaliesDetected: number;
    alertsCreated: number;
    alertsAutoClosed: number;
    byType: Record<string, number>;
    generatedAt: string;
};
export type ClosureChecklistInput = {
    empresaId: string;
    year: number;
    month: number;
    persistSnapshot?: boolean;
};
export type ClosureChecklistResult = {
    ok: boolean;
    empresaId: string;
    period: string;
    generatedAt: string;
    totals: {
        turnos: number;
        marcacionesPendientes: number;
        turnosAbiertosFueraHorario: number;
        ausencias: number;
        ausenciasSinResolver: number;
        inconsistenciasEstado: number;
    };
    horas: {
        slaVendidas: number;
        planificadasCobertura: number;
        ejecutadasFichadas: number;
        gapSlaVsPlan: number;
        gapPlanVsEjecutado: number;
    };
    prefactura: {
        source: 'hours_balances' | 'fallback_turnos';
        rows: number;
        slaHours: number;
        plannedHours: number;
        realHours: number;
        resultante: number;
        saldoPlan: number;
        saldoReal: number;
    };
    checks: {
        marcacionesOk: boolean;
        cierresOk: boolean;
        ausenciasOk: boolean;
        coberturaOk: boolean;
        listoParaCierre: boolean;
    };
    recomendaciones: string[];
};
export declare function runPlanningAutomationCycle(input: PlanningAutomationInput): Promise<PlanningAutomationResult>;
export declare function scanOperationalAlertsForEmpresa(input: OperationalAlertScanInput): Promise<OperationalAlertScanResult>;
export declare function buildOperationalClosureChecklist(input: ClosureChecklistInput): Promise<ClosureChecklistResult>;
