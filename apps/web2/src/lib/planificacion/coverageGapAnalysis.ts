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

import type { PlanningPositionLike, PositionActiveOnDayFn } from './objectiveCoverageDemand';

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

function getCustomBandCodes(pos: PlanningPositionLike, dayLetter: string, cycles?: string[], dateStr?: string): string[] {
    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles, dateStr);
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
    dateStr?: string,
): PositionDayGap | null {
    const posName = String(pos.positionName || 'General');
    const qty = Math.max(1, Number(pos.qty) || 1);
    const schemeLabel = positionSchemeLabelForDay(pos, dayLetter, cycles, dateStr);

    if (!isActiveOnDay) return null;

    const units = countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cycles, true, dateStr);
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

        const has8h = mtnBands.some(c => (codeCounts[c] || 0) > 0);
        const has12h = altBands.some(c => (codeCounts[c] || 0) > 0);

        if (has8h && !has12h) {
            // Esquema 8h comprometido — solo mostrar bandas faltantes de ese esquema
            missingBandsPrimary = missingBandsForScheme(qty, codeCounts, mtnBands);
            missingBandsAlternate = [];
            alternateScheme = undefined;
        } else if (has12h && !has8h) {
            // Esquema 12h comprometido
            primaryScheme = altBands.join('+');
            missingBandsPrimary = missingBandsForScheme(qty, codeCounts, altBands);
            missingBandsAlternate = [];
            alternateScheme = undefined;
        } else {
            // Sin comprometer — mostrar ambas opciones
            const mtnClosed = Math.min(qty, Math.min(...mtnBands.map(c => codeCounts[c] || 0)));
            const remainingAfterMtn = qty - mtnClosed;
            missingBandsPrimary = missingBandsForScheme(qty, codeCounts, mtnBands);
            if (remainingAfterMtn > 0) {
                missingBandsAlternate = missingBandsForScheme(remainingAfterMtn, codeCounts, altBands);
            }
        }
    } else {
        // Custom: necesitamos PAX por turno (quantity) para el diagnóstico correcto
        const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles, dateStr);
        const allShiftsForDay = pos.shifts || [];
        const effWithPax: Array<{ code: string; quantity?: number }> = eff.length > 0
            ? eff.map(s => ({ code: normCode(s.code), quantity: (s as any).quantity }))
            : allShiftsForDay
                  .filter(s => {
                      if (Array.isArray((s as any).specificDates) && (s as any).specificDates.length > 0) {
                          return dateStr ? (s as any).specificDates.includes(dateStr) : false;
                      }
                      if (Array.isArray((s as any).days) && (s as any).days.length > 0) {
                          return (s as any).days.includes(dayLetter);
                      }
                      return true;
                  })
                  .map(s => ({ code: normCode(s.code), quantity: (s as any).quantity }));

        const bandCodes = effWithPax.map(b => b.code).filter(Boolean);
        primaryScheme = bandCodes.join('+') || schemeLabel;

        const hasPerShiftPax = effWithPax.some(b => b.quantity != null && Number(b.quantity) > 0);
        if (hasPerShiftPax) {
            missingBandsPrimary = effWithPax
                .filter(b => !!b.code)
                .flatMap(b => {
                    const bandPax = (b.quantity != null && Number(b.quantity) > 0)
                        ? Math.max(1, Math.floor(Number(b.quantity)))
                        : qty;
                    const have = codeCounts[b.code] || 0;
                    const missing = Math.max(0, bandPax - have);
                    return missing > 0 ? [{ code: b.code, missing }] : [];
                });
        } else {
            missingBandsPrimary = missingBandsForScheme(qty, codeCounts, bandCodes);
        }
    }

    const parts: string[] = [];
    const primaryText = formatBandGaps(missingBandsPrimary);
    const altText = formatBandGaps(missingBandsAlternate);
    if (primaryText && altText && alternateScheme) {
        // Sin esquema comprometido — mostrar ambas opciones
        parts.push(`${primaryText} (${primaryScheme}); o ${altText} (${alternateScheme}) para ${missingUnits} puesto${missingUnits > 1 ? 's' : ''}`);
    } else if (primaryText) {
        // Esquema comprometido — solo lo que falta
        parts.push(`falta ${primaryText}`);
    } else if (missingUnits > 0) {
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
    isPosActiveOnDay?: PositionActiveOnDayFn,
): DayCoverageGapReport {
    const checkActive = isPosActiveOnDay ?? ((pos, letter, ds) => {
        const days = pos.activeDays;
        if (!days || days.length === 0) return true;
        return days.includes(letter);
    });

    const positionGaps: PositionDayGap[] = [];
    let closed = 0;
    let required = 0;

    for (const pos of positions) {
        const posName = String(pos.positionName || 'General');
        if (!checkActive(pos, dayLetter, dateStr)) continue;

        const units = countPositionClosedUnitsFromShifts(
            pos,
            dayLetter,
            codeCountsByPosition[posName] || {},
            cycles,
            true,
            dateStr,
        );
        closed += units.closed;
        required += units.required;

        const gap = analyzePositionDayGap(
            pos,
            dayLetter,
            codeCountsByPosition[posName] || {},
            cycles,
            true,
            dateStr,
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
    isPosActiveOnDay?: PositionActiveOnDayFn,
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
    gapBand?: string;
    missing: number;
    detail: string;
}> {
    const rows: Array<{
        positionName: string;
        code: string;
        gapBand?: string;
        missing: number;
        detail: string;
    }> = [];
    for (const pg of dayReport.positions) {
        if (pg.missingBandsPrimary.length > 0) {
            for (const bg of pg.missingBandsPrimary) {
                rows.push({
                    positionName: pg.positionName,
                    code: bg.code,
                    gapBand: bg.code,
                    missing: bg.missing,
                    detail: `Falta ${bg.missing}×${bg.code} (${pg.schemeLabel})`,
                });
            }
        } else if (pg.missingUnits > 0) {
            const band = pg.missingBandsPrimary[0]?.code ?? pg.missingBandsAlternate[0]?.code;
            rows.push({
                positionName: pg.positionName,
                code: pg.primaryScheme + (pg.alternateScheme ? ` o ${pg.alternateScheme}` : ''),
                gapBand: band,
                missing: pg.missingUnits,
                detail: pg.summary,
            });
        }
    }
    return rows;
}

/** Banda SLA a cerrar desde fila del tooltip (pie de cobertura). */
export function inferGapBandForClose(row: {
    gapBand?: string;
    code?: string;
    detail?: string;
}): string | undefined {
    if (row.gapBand) return String(row.gapBand).toUpperCase();
    const fromDetail = row.detail?.match(/×\s*([A-Z][A-Z0-9]*)/i)?.[1];
    if (fromDetail) return fromDetail.toUpperCase();
    const code = String(row.code || '').trim();
    const first = code.split(/\s+/)[0]?.toUpperCase();
    if (/^(M|T|N|D12|N12|E\d+)$/.test(first)) return first;
    return undefined;
}
