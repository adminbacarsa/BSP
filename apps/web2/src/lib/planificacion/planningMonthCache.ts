import type { PlanningTurnosIngestResult } from './planningTurnosIngest';

const MAX_CACHED_MONTHS = 5;

const cache = new Map<string, PlanningTurnosIngestResult>();

export function planningMonthCacheKey(empresaId: string, year: number, month: number): string {
    return `${empresaId}_${year}_${month}`;
}

export function getCachedPlanningMonth(key: string): PlanningTurnosIngestResult | undefined {
    return cache.get(key);
}

export function setCachedPlanningMonth(key: string, value: PlanningTurnosIngestResult): void {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHED_MONTHS) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        cache.delete(oldest);
    }
}

export function adjacentPlanningMonths(year: number, month: number): Array<{ year: number; month: number }> {
    const prev = month <= 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    const next = month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    return [prev, next];
}
