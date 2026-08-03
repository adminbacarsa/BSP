import type { V2PositionDef } from './autoScheduleEngineV2';
import {
    calculateMonthlyBreakdown,
    calculateSlaHoursForMonth,
    isArgentineHoliday,
    parseYmdToLocalDate,
    WEEK_DAY_CODES,
} from '@/lib/servicios/slaHoursCalculator';
import type { ServicePosition, ShiftVariant } from '@/services/slaService';

export const AUTO_LAB_DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
export type AutoLabDayLetter = (typeof AUTO_LAB_DAY_LETTERS)[number];

function toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function monthBoundsYmd(year: number, month: number): { start: string; end: string } {
    const last = new Date(year, month, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
        start: `${year}-${pad(month)}-01`,
        end: `${year}-${pad(month)}-${pad(last)}`,
    };
}

export function clampDateYmd(value: string, min: string, max: string): string {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function v2PositionToServicePosition(pos: V2PositionDef, id: string): ServicePosition {
    const shifts = pos.shifts || [];
    const activeDays = pos.activeDays?.length ? pos.activeDays : [...AUTO_LAB_DAY_LETTERS];
    const bandTimes: Record<string, { start: string; end: string }> = {
        M: { start: '07:00', end: '15:00' },
        T: { start: '15:00', end: '23:00' },
        N: { start: '23:00', end: '07:00' },
        D12: { start: '07:00', end: '19:00' },
        N12: { start: '19:00', end: '07:00' },
    };

    return {
        id,
        name: pos.positionName,
        coverageType: String(pos.coverageType || '').toLowerCase() === '24hs' ? '24hs' : 'custom',
        quantity: Math.max(1, Number(pos.qty) || 1),
        allowedShiftTypes: shifts.map((s) => {
            const code = String(s.code || '').toUpperCase();
            const times = bandTimes[code] || { start: '07:00', end: '15:00' };
            const variant: ShiftVariant = {
                code,
                name: s.name || code,
                startTime: s.startTime || times.start,
                endTime: s.endTime || times.end,
                hours: Number(s.hours) || 8,
            };
            if (Array.isArray(s.blocks) && s.blocks.length >= 2) {
                variant.blocks = s.blocks.map((b) => ({
                    startTime: String(b.startTime),
                    endTime: String(b.endTime),
                }));
            }
            if (Array.isArray(s.days) && s.days.length > 0) variant.days = [...s.days];
            if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
                variant.specificDates = [...s.specificDates];
            }
            return variant;
        }),
        activeDays,
        excludedDates: pos.excludedDates,
    };
}

export function v2PositionsToServicePositions(positions: V2PositionDef[]): ServicePosition[] {
    return positions.map((p, idx) => v2PositionToServicePosition(p, `lab-pos-${idx + 1}`));
}

export function getServiceDaysInMonth(
    year: number,
    month: number,
    serviceStart: string,
    serviceEnd: string,
    excludedDates?: string[],
): Date[] {
    const monthStart = parseYmdToLocalDate(monthBoundsYmd(year, month).start);
    const monthEnd = parseYmdToLocalDate(monthBoundsYmd(year, month).end);
    const sStart = parseYmdToLocalDate(serviceStart);
    const sEnd = parseYmdToLocalDate(serviceEnd);
    if (!monthStart || !monthEnd || !sStart || !sEnd) return [];

    const rangeStart = sStart > monthStart ? sStart : monthStart;
    const rangeEnd = sEnd < monthEnd ? sEnd : monthEnd;
    if (rangeStart > rangeEnd) return [];

    const excluded = new Set(excludedDates || []);
    const days: Date[] = [];
    const cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
        const key = toDateKey(cursor);
        if (!excluded.has(key)) {
            days.push(new Date(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
}

export function calculateSlaHoursForVigencia(
    positions: V2PositionDef[],
    serviceStart: string,
    serviceEnd: string,
    excludedDates: string[] | undefined,
    year: number,
    /** Mes calendario 1-based (enero = 1), alineado a Auto Lab y `buildDaysInMonth`. */
    month: number,
): number {
    const servicePositions = v2PositionsToServicePositions(positions);
    if (servicePositions.length === 0) return 0;
    const row = calculateSlaHoursForMonth(
        servicePositions,
        serviceStart,
        serviceEnd,
        excludedDates,
        year,
        month - 1,
    );
    return Math.round(row.total);
}

export function calculatePositionSlaHoursForMonth(
    pos: V2PositionDef,
    serviceStart: string,
    serviceEnd: string,
    excludedDates: string[] | undefined,
    year: number,
    month: number,
): number {
    const servicePosition = v2PositionToServicePosition(pos, 'lab-pos-single');
    const row = calculateSlaHoursForMonth(
        [servicePosition],
        serviceStart,
        serviceEnd,
        excludedDates,
        year,
        month - 1,
    );
    return Math.round(row.total);
}

export function suggestMinEmployeeCount(
    positions: V2PositionDef[],
    serviceStart: string,
    serviceEnd: string,
    excludedDates?: string[],
): number {
    if (positions.length === 0) return 1;

    let total = 0;
    positions.forEach((pos, idx) => {
        const sp = v2PositionToServicePosition(pos, `lab-pos-${idx + 1}`);
        const pax = Math.max(1, Number(pos.qty) || 1);
        const is24 = String(pos.coverageType || '').toLowerCase() === '24hs';
        const minRot = is24 ? pax * 2 : pax;
        const breakdown = calculateMonthlyBreakdown([sp], serviceStart, serviceEnd, excludedDates);
        const avgH = breakdown.length > 0
            ? breakdown.reduce((acc, row) => acc + row.totalHours, 0) / breakdown.length
            : 0;
        total += Math.max(minRot, Math.ceil(avgH / 192));
    });

    return Math.max(1, total);
}

export interface AutoLabCalendarMonth {
    year: number;
    month: number;
    label: string;
    days: Array<{ date: Date; ds: string; inRange: boolean }>;
}

export function buildCalendarMonthsForService(
    serviceStart: string,
    serviceEnd: string,
): AutoLabCalendarMonth[] {
    const start = parseYmdToLocalDate(serviceStart);
    const end = parseYmdToLocalDate(serviceEnd);
    if (!start || !end || start > end) return [];

    const months: AutoLabCalendarMonth[] = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

    while (cursor <= endMonth) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const label = cursor.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        const daysInMo = new Date(y, m + 1, 0).getDate();
        const days: AutoLabCalendarMonth['days'] = [];

        for (let d = 1; d <= daysInMo; d++) {
            const date = new Date(y, m, d);
            const inRange = date >= start && date <= end;
            const ds = inRange
                ? `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                : '';
            days.push({ date, ds, inRange });
        }

        months.push({ year: y, month: m, label, days });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

export function dayLetterFromDate(date: Date): string {
    return WEEK_DAY_CODES[date.getDay()];
}

export function isWeekendDate(date: Date): boolean {
    const d = date.getDay();
    return d === 0 || d === 6;
}

export function isHolidayDate(ds: string): boolean {
    return isArgentineHoliday(ds);
}
