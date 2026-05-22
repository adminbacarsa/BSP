/**
 * Diagnóstico de cobertura por objetivo: qué bandas faltan por puesto/día
 * para cerrar el esquema SLA (M+T+N, D12+N12, M+T, EN, etc.).
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import {
    countPositionClosedUnitsFromShifts,
    positionSchemeLabelForDay,
    shiftBandHours,
} from './positionCoverageUnits';

export interface BandGap {
    code: string;
    missing: number;
}

export interface PositionDayGap {
    positionName: string;
    required: number;
    closed: number;
    missingUnits: number;
    schemeLabel: string;
    primaryScheme: string;
    missingBandsPrimary: BandGap[];
    alternateScheme?: string;
    missingBandsAlternate: BandGap[];
    summary: string;
}

export interface DayCoverageGapReport {
    dateStr: string;
    dayLetter: string;
    closed: number;
    required: number;
    isFull: boolean;
    positions: PositionDayGap[];
}

export interface ObjectiveCoverageGapReport {
    closed: number;
    required: number;
    daysTotal: number;
    daysFull: number;
    daysPartial: number;
    daysEmpty: number;
    byDay: Record<string, DayCoverageGapReport>;
    aggregateMissingPrimary: Record<string, number>;
    worstDays: Array<{ dateStr: string; closed: number; required: number; missingUnits: number }>;
}

export type PlanningPositionLike = {
    positionName?: string;
    qty?: number;
    coverageType?: string;
    shifts?: Array<{ code?: string; hours?: number }>;
    activeDays?: string[];
};

function normCode(code: unknown): string {
    return String(code || '').toUpperCase();
}

function uniqueBandCodes(
    shifts: Array<{ code?: string; hours?: number }>,
    minHours = 0,
    maxHours = Infinity,
): string[] {
    return [...new Set(
        shifts
            .filter(s => {
                const h = shiftBandHours(s);
                return h >= minHours && h < maxHours;
            })
            .map(s => normCode(s.code))
            .filter(Boolean),
    )];
}

function missingBandsForScheme(qty: number, codeCounts: Record<string, number>, bandCodes: string[]): BandGap[] {
    const gaps: BandGap[] = [];
    for (const code of bandCodes) {
        const have = codeCounts[code] || 0;
        const missing = Math.max(0, qty - have);
        if (missing > 0) gaps.push({ code, missing });
    }
    return gaps;
}

function formatBandGaps(gaps: BandGap[]): string {
    if (gaps.length === 0) return '';
    return gaps.map(g => `${g.missing}×${g.code}`).join(', ');
}

function get24hsBandSets(pos: PlanningPositionLike): { bands8: string[]; bands12: string[] } {
    const allShifts = Array.isArray(pos.shifts) ? pos.shifts : [];
    return {
        bands8: uniqueBandCodes(allShifts, 0, 12),
        bands12: uniqueBandCodes(allShifts, 12, Infinity),
    };
}

function getCustomBandCodes(pos: PlanningPositionLike, dayLetter: string, cycles?: string[]): string[] {
    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles);
    let codes = eff.map(s => normCode(s.code)).filter(Boolean);
    if (codes.length === 0) {
        codes = (pos.shifts || []).map(s => normCode(s.code)).filter(Boolean);
    }
    return codes;
}

/** Qué falta en un puesto/día para cerrar cobertura SLA. */
export function analyzePositionDayGap(
    pos: PlanningPositionLike,
    dayLetter: string,
    codeCounts: Record<string, number>,
    cycles?: string[],
    isActiveOnDay = true,
): PositionDayGap | null {
    const posName = String(pos.positionName || 'General');
    const qty = Math.max(1, Number(pos.qty) || 1);
    const schemeLabel = positionSchemeLabelForDay(pos, dayLetter, cycles);

    if (!isActiveOnDay) return null;

    const units = countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cycles, true);
    if (units.closed >= units.required) return null;

    const missingUnits = units.required - units.closed;
    const coverageType = String(pos.coverageType || 'custom').toLowerCase();
    let primaryScheme = schemeLabel;
    let alternateScheme: string | undefined;
    let missingBandsPrimary: BandGap[] = [];
    let missingBandsAlternate: BandGap[] = [];

    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        const { bands8, bands12 } = get24hsBandSets(pos);
        const mtnBands = bands8.length > 0 ? bands8 : ['M', 'T', 'N'];
        const altBands = bands12.length >= 2 ? bands12 : ['D12', 'N12'];

        primaryScheme = mtnBands.join('+');
        alternateScheme = altBands.join('+');

        const mtnClosed = Math.min(qty, Math.min(...mtnBands.map(c => codeCounts[c] || 0)));
        const remainingAfterMtn = qty - mtnClosed;

        missingBandsPrimary = missingBandsForScheme(qty, codeCounts, mtnBands);

        if (remainingAfterMtn > 0) {
            missingBandsAlternate = missingBandsForScheme(remainingAfterMtn, codeCounts, altBands);
        }
    } else {
        const bandCodes = getCustomBandCodes(pos, dayLetter, cycles);
        primaryScheme = bandCodes.join('+') || schemeLabel;
        missingBandsPrimary = missingBandsForScheme(qty, codeCounts, bandCodes);
    }

    const parts: string[] = [];
    const primaryText = formatBandGaps(missingBandsPrimary);
    if (primaryText) parts.push(`falta ${primaryText} (${primaryScheme})`);
    const altText = formatBandGaps(missingBandsAlternate);
    if (altText && alternateScheme) {
        parts.push(`o ${altText} (${alternateScheme}) para ${missingUnits} puesto${missingUnits > 1 ? 's' : ''}`);
    } else if (missingUnits > 0 && !primaryText) {
        parts.push(`${missingUnits} puesto${missingUnits > 1 ? 's' : ''} sin cerrar (${schemeLabel})`);
    }

    return {
        positionName: posName,
        required: units.required,
        closed: units.closed,
        missingUnits,
        schemeLabel,
        primaryScheme,
        missingBandsPrimary,
        alternateScheme,
        missingBandsAlternate,
        summary: parts.join('; ') || `${missingUnits} puesto${missingUnits > 1 ? 's' : ''} (${schemeLabel})`,
    };
}

export function analyzeDayCoverageGaps(
    positions: PlanningPositionLike[],
    dateStr: string,
    dayLetter: string,
    codeCountsByPosition: Record<string, Record<string, number>>,
    cycles?: string[],
    isPosActiveOnDay?: (pos: PlanningPositionLike, dayLetter: string) => boolean,
): DayCoverageGapReport {
    const checkActive = isPosActiveOnDay ?? ((pos, letter) => {
        const days = pos.activeDays;
        if (!days || days.length === 0) return true;
        return days.includes(letter);
    });

    const positionGaps: PositionDayGap[] = [];
    let closed = 0;
    let required = 0;

    for (const pos of positions) {
        const posName = String(pos.positionName || 'General');
        if (!checkActive(pos, dayLetter)) continue;

        const units = countPositionClosedUnitsFromShifts(
            pos,
            dayLetter,
            codeCountsByPosition[posName] || {},
            cycles,
            true,
        );
        closed += units.closed;
        required += units.required;

        const gap = analyzePositionDayGap(
            pos,
            dayLetter,
            codeCountsByPosition[posName] || {},
            cycles,
            true,
        );
        if (gap) positionGaps.push(gap);
    }

    return {
        dateStr,
        dayLetter,
        closed,
        required,
        isFull: required > 0 && closed >= required,
        positions: positionGaps,
    };
}

export function analyzeObjectiveCoverageGaps(
    positions: PlanningPositionLike[],
    days: Array<{ dateStr: string; dayLetter: string }>,
    codeCountsByDay: Record<string, Record<string, Record<string, number>>>,
    cycles?: string[],
    isPosActiveOnDay?: (pos: PlanningPositionLike, dayLetter: string) => boolean,
): ObjectiveCoverageGapReport {
    const byDay: Record<string, DayCoverageGapReport> = {};
    const aggregateMissingPrimary: Record<string, number> = {};
    let closed = 0;
    let required = 0;
    let daysFull = 0;
    let daysPartial = 0;
    let daysEmpty = 0;

    for (const { dateStr, dayLetter } of days) {
        const dayReport = analyzeDayCoverageGaps(
            positions,
            dateStr,
            dayLetter,
            codeCountsByDay[dateStr] || {},
            cycles,
            isPosActiveOnDay,
        );
        byDay[dateStr] = dayReport;
        closed += dayReport.closed;
        required += dayReport.required;

        if (dayReport.required === 0) continue;
        if (dayReport.isFull) daysFull++;
        else if (dayReport.closed === 0) daysEmpty++;
        else daysPartial++;

        for (const pg of dayReport.positions) {
            for (const bg of pg.missingBandsPrimary) {
                aggregateMissingPrimary[bg.code] = (aggregateMissingPrimary[bg.code] || 0) + bg.missing;
            }
        }
    }

    const worstDays = days
        .map(({ dateStr }) => {
            const d = byDay[dateStr];
            if (!d || d.required === 0) return null;
            return {
                dateStr,
                closed: d.closed,
                required: d.required,
                missingUnits: d.required - d.closed,
            };
        })
        .filter((x): x is NonNullable<typeof x> => x != null && x.missingUnits > 0)
        .sort((a, b) => b.missingUnits - a.missingUnits || a.closed - b.closed)
        .slice(0, 10);

    return {
        closed,
        required,
        daysTotal: days.length,
        daysFull,
        daysPartial,
        daysEmpty,
        byDay,
        aggregateMissingPrimary,
        worstDays,
    };
}

export function flattenDayGapsForUi(dayReport: DayCoverageGapReport): Array<{
    positionName: string;
    code: string;
    missing: number;
    detail: string;
}> {
    return dayReport.positions.map(pg => ({
        positionName: pg.positionName,
        code: pg.primaryScheme + (pg.alternateScheme ? ` o ${pg.alternateScheme}` : ''),
        missing: pg.missingUnits,
        detail: pg.summary,
    }));
}
