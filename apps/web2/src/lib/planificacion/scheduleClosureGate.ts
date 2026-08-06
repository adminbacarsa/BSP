/**
 * Criterio de éxito post-generación: cobertura diaria (huecos SLA) + horas vendidas.
 */

import type { CoveragePolicyBalanceReport } from './coveragePolicyBalance';
import type { CoverageVerificationReport } from './coverageVerification';

export type ScheduleClosureResult = {
    ok: boolean;
    slaHoursOk: boolean;
    dailyBalanceOk: boolean;
    uncoveredSlotCount: number;
    billableHours: number;
    slaVendidas: number;
    hoursGap: number;
    messages: string[];
    labelEs: string;
};

import type { Pure24hsBandAuditResult, Pure24hsTitularRotationAudit } from './pure24hsBandAudit';

export type ScheduleClosureOptions = {
    /** Tolerancia relativa en horas vendidas (default 0.5 h absoluta mínima). */
    hoursToleranceAbs?: number;
    /** Puro 24 HS: exige qty×M/T/N por puesto y día (multipax). */
    bandAudit?: Pure24hsBandAuditResult | null;
    /** Puro 24 HS: cada titular debe rotar M/T/N en el mes. */
    rotationAudit?: Pure24hsTitularRotationAudit | null;
};

export function evaluateScheduleClosure(
    coverageReport: CoverageVerificationReport,
    balance: CoveragePolicyBalanceReport,
    options?: ScheduleClosureOptions,
): ScheduleClosureResult {
    const tol = options?.hoursToleranceAbs ?? 0.5;
    const slaVendidas = coverageReport.hours.slaVendidas ?? 0;
    const billableHours = coverageReport.hours.billableHoursGenerated ?? 0;
    const hoursGap = slaVendidas > 0 ? slaVendidas - billableHours : 0;
    const slaHoursOk = slaVendidas <= 0 || billableHours >= slaVendidas - tol;
    const uncoveredSlotCount = Math.max(
        balance.underSlotCount,
        coverageReport.coverage.uncoveredSlots,
    );
    const dailyBalanceOk = balance.ok && coverageReport.coverage.uncoveredSlots <= 0;
    const bandAuditOk = options?.bandAudit == null || options.bandAudit.ok === true;
    const rotationAuditOk = options?.rotationAudit == null || options.rotationAudit.ok === true;
    const ok = dailyBalanceOk && slaHoursOk && bandAuditOk && rotationAuditOk;

    const messages: string[] = [];
    if (!dailyBalanceOk) {
        messages.push(
            `Huecos SLA: ${uncoveredSlotCount} slot(s) sin cubrir (${balance.summary}).`,
        );
    }
    if (!bandAuditOk && options?.bandAudit) {
        messages.push(`Bandas 24 HS: ${options.bandAudit.summary}`);
    }
    if (!rotationAuditOk && options?.rotationAudit) {
        messages.push(`Rotación 24 HS: ${options.rotationAudit.summary}`);
    }
    if (!slaHoursOk) {
        messages.push(
            `Horas vendidas: faltan ${Math.max(0, Math.round(hoursGap * 10) / 10)} h `
            + `(${Math.round(billableHours)} / ${slaVendidas} h).`,
        );
    }

    const labelEs = ok
        ? 'Cierre OK: cobertura diaria y horas SLA.'
        : messages.join(' ');

    return {
        ok,
        slaHoursOk,
        dailyBalanceOk,
        uncoveredSlotCount,
        billableHours,
        slaVendidas,
        hoursGap,
        messages,
        labelEs,
    };
}
