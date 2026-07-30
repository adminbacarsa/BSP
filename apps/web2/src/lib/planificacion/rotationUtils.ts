import type { ServiceRotation, RotationPeriod, RotationEntry } from '@/services/slaService';

function getWeekStartForDate(dateStr: string, weekStartDay = 1): string {
    const date = new Date(dateStr + 'T00:00:00');
    const dow = date.getDay() === 0 ? 7 : date.getDay(); // 1=Mon…7=Sun
    const daysBack = ((dow - weekStartDay) + 7) % 7;
    const ws = new Date(date);
    ws.setDate(date.getDate() - daysBack);
    return ws.toISOString().split('T')[0];
}

function getWeekDiff(refDateStr: string, dateStr: string, weekStartDay = 1): number {
    const refWs = getWeekStartForDate(refDateStr, weekStartDay);
    const dateWs = getWeekStartForDate(dateStr, weekStartDay);
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    return Math.round((new Date(dateWs + 'T00:00:00').getTime() - new Date(refWs + 'T00:00:00').getTime()) / msPerWeek);
}

function getWeekOfMonth(dateStr: string, weekStartDay = 1): number {
    const [y, m] = dateStr.split('-').map(Number);
    const firstOfMonth = `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-01`;
    const firstWs = getWeekStartForDate(firstOfMonth, weekStartDay);
    const diff = getWeekDiff(firstWs, dateStr, weekStartDay);
    return Math.max(1, diff + 1);
}

export function rotationPeriodApplies(
    period: RotationPeriod,
    dateStr: string,
    rotation: ServiceRotation,
): boolean {
    const t = period.trigger;
    switch (t.type) {
        case 'WEEKLY': {
            if (!rotation.referenceWeekStart) return false;
            const diff = getWeekDiff(rotation.referenceWeekStart, dateStr, rotation.weekStartDay ?? 1);
            const weeklyPeriods = rotation.periods.filter(p => p.trigger.type === 'WEEKLY');
            const total = weeklyPeriods.length || 1;
            const idx = ((diff % total) + total) % total;
            return idx === (t.periodIndex ?? 0);
        }
        case 'DAY_OF_WEEK': {
            const date = new Date(dateStr + 'T00:00:00');
            const dow = date.getDay() === 0 ? 7 : date.getDay();
            return (t.days ?? []).includes(dow);
        }
        case 'DATE_RANGE':
            return dateStr >= (t.fromDate ?? '') && dateStr <= (t.toDate ?? '9999-12-31');
        case 'FORTNIGHT': {
            const day = parseInt(dateStr.split('-')[2], 10);
            return t.half === 'FIRST' ? day <= 15 : day > 15;
        }
        case 'WEEK_OF_MONTH': {
            const wn = getWeekOfMonth(dateStr, rotation.weekStartDay ?? 1);
            return (t.weekNumbers ?? []).includes(wn);
        }
        default:
            return false;
    }
}

export function getRotationEntriesForDate(rotation: ServiceRotation, dateStr: string): RotationEntry[] {
    for (const period of rotation.periods) {
        if (rotationPeriodApplies(period, dateStr, rotation)) return period.entries;
    }
    return [];
}

export function getAllDatesInMonth(year: number, month: number): string[] {
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => {
        const d = i + 1;
        return `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    });
}
