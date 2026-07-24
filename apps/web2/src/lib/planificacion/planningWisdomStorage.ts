import type { PlanningCoverageWisdom } from './planningCoverageWisdom';

const WISDOM_INDEX_KEY = 'cosp_coverage_wisdom_v1';
const LAST_OBJECTIVE_KEY = 'cosp_coverage_wisdom_last_obj';

export interface WisdomCacheIndex {
    version: 1;
    entries: Record<string, PlanningCoverageWisdom>;
}

function emptyIndex(): WisdomCacheIndex {
    return { version: 1, entries: {} };
}

export function loadWisdomIndex(): WisdomCacheIndex {
    if (typeof window === 'undefined') return emptyIndex();
    try {
        const raw = localStorage.getItem(WISDOM_INDEX_KEY);
        if (!raw) return emptyIndex();
        const parsed = JSON.parse(raw) as WisdomCacheIndex;
        if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
            return emptyIndex();
        }
        return parsed;
    } catch {
        return emptyIndex();
    }
}

export function loadWisdomForObjective(objectiveId: string): PlanningCoverageWisdom | null {
    const key = objectiveId.trim();
    if (!key) return null;
    return loadWisdomIndex().entries[key] ?? null;
}

export function saveWisdomEntry(wisdom: PlanningCoverageWisdom): void {
    if (typeof window === 'undefined') return;
    const objectiveId = wisdom.objectiveId.trim();
    if (!objectiveId) return;
    try {
        const index = loadWisdomIndex();
        index.entries[objectiveId] = wisdom;
        localStorage.setItem(WISDOM_INDEX_KEY, JSON.stringify(index));
        localStorage.setItem(LAST_OBJECTIVE_KEY, objectiveId);
    } catch {
        /* ignore quota */
    }
}

export function loadLastObjectiveId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(LAST_OBJECTIVE_KEY);
    } catch {
        return null;
    }
}

export function countCachedWisdomEntries(): number {
    return Object.keys(loadWisdomIndex().entries).length;
}
