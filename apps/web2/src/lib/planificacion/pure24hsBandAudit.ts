/**
 * Auditoría estricta puro 24 HS: por día × puesto × banda (M/T/N) vs qty del SLA.
 * Complementa verifyScheduleCoverage (huecos) con detección de sobrecobertura en una banda
 * y falta en otra el mismo día (típico multipax / post-proceso).
 */

import type { V2Assignment, V2EngineContext, V2PositionDef } from './autoScheduleEngineV2';
import {
    effectiveShiftsForPositionDay,
    is24hsRotationPosition,
    positionIsActiveOn,
} from './autoScheduleEngineV2';

const WORK = new Set(['M', 'T', 'N', 'D12', 'N12']);
const NON_WORK = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'E', 'A', 'PG', 'AA']);

export type Pure24hsBandDaySnapshot = {
    dateStr: string;
    positionName: string;
    qty: number;
    expectedBands: string[];
    assigned: Record<string, number>;
    missing: Array<{ band: string; need: number; have: number }>;
    over: Array<{ band: string; need: number; have: number }>;
};

export type Pure24hsBandAuditResult = {
    ok: boolean;
    totalDayPositionChecks: number;
    failDays: number;
    snapshots: Pure24hsBandDaySnapshot[];
    summary: string;
};

function normBand(code: string): string {
    const c = String(code || '').toUpperCase();
    if (c === 'D12') return 'M';
    if (c === 'N12') return 'N';
    return c;
}

function expectedBandsForDay(
    pos: V2PositionDef,
    dayLetter: string,
    ctx: Pick<V2EngineContext, 'autoCycles'>,
    dateStr: string,
): string[] {
    const eff = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles, dateStr);
    return eff
        .map((s) => String(s.code || '').toUpperCase())
        .filter((c) => WORK.has(c));
}

export type Pure24hsTitularRotationIssue = {
    empId: string;
    positionName: string;
    counts: Record<string, number>;
    missingBands: string[];
};

export type Pure24hsTitularRotationAudit = {
    ok: boolean;
    issues: Pure24hsTitularRotationIssue[];
    summary: string;
};

/** Cada titular de rotación 24hs (subgrupo de 4) debe trabajar M, T y N en el mes. */
export function auditPure24hsTitularBandSpread(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    positionGroups: Record<string, string[]> | undefined,
    openingSlotByEmp: Record<string, number> | undefined,
): Pure24hsTitularRotationAudit {
    const issues: Pure24hsTitularRotationIssue[] = [];
    const groups = positionGroups ?? {};
    const openings = openingSlotByEmp ?? {};
    const bands = ['M', 'T', 'N'];

    for (const [positionName, empIds] of Object.entries(groups)) {
        const pos = ctx.positions.find((p) => p.positionName === positionName);
        if (!pos || !is24hsRotationPosition(pos)) continue;
        const need = Math.max(1, Number(pos.qty) || 1) * 4;
        const titulars = empIds.filter((id) => openings[id] !== undefined).slice(0, need);
        for (const empId of titulars) {
            const counts: Record<string, number> = { M: 0, T: 0, N: 0 };
            for (const a of assignments) {
                if (a.empId !== empId) continue;
                if (a.positionName !== positionName) continue;
                const b = normBand(String(a.code || ''));
                if (counts[b] !== undefined) counts[b]++;
            }
            const missingBands = bands.filter((b) => (counts[b] ?? 0) < 3);
            if (missingBands.length > 0) {
                issues.push({ empId, positionName, counts, missingBands });
            }
        }
    }

    const ok = issues.length === 0;
    return {
        ok,
        issues,
        summary: ok
            ? 'OK: titulares 24hs con M/T/N en el mes.'
            : `${issues.length} titular(es) sin rotación M→T→N completa en el mes.`,
    };
}

export function auditPure24hsBandCoverage(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
): Pure24hsBandAuditResult {
    const positions24 = ctx.positions.filter(is24hsRotationPosition);
    const snapshots: Pure24hsBandDaySnapshot[] = [];

    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);

        for (const pos of positions24) {
            if (!positionIsActiveOn(pos, dayLetter, dateStr)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const expectedBands = expectedBandsForDay(pos, dayLetter, ctx, dateStr);
            const assigned: Record<string, number> = {};
            for (const b of expectedBands) assigned[b] = 0;

            for (const a of assignments) {
                if (a.dateStr !== dateStr) continue;
                if (a.positionName !== pos.positionName) continue;
                const c = String(a.code || '').toUpperCase();
                if (NON_WORK.has(c)) continue;
                const b = normBand(c);
                if (!expectedBands.includes(b)) continue;
                assigned[b] = (assigned[b] || 0) + 1;
            }

            const missing: Pure24hsBandDaySnapshot['missing'] = [];
            const over: Pure24hsBandDaySnapshot['over'] = [];
            for (const band of expectedBands) {
                const have = assigned[band] || 0;
                if (have < qty) missing.push({ band, need: qty, have });
                if (have > qty) over.push({ band, need: qty, have });
            }

            if (missing.length > 0 || over.length > 0) {
                snapshots.push({
                    dateStr,
                    positionName: pos.positionName,
                    qty,
                    expectedBands,
                    assigned,
                    missing,
                    over,
                });
            }
        }
    }

    const totalDayPositionChecks = ctx.daysInMonth.length * positions24.length;
    const failDays = new Set(snapshots.map((s) => `${s.dateStr}|${s.positionName}`)).size;
    const ok = snapshots.length === 0;
    const summary = ok
        ? `OK: ${positions24.length} puesto(s) 24hs — bandas M/T/N por qty en todo el mes.`
        : `${snapshots.length} incidencia(s) en ${failDays} día×puesto (falta/sobra por banda).`;

    return { ok, totalDayPositionChecks, failDays, snapshots, summary };
}
