/**
 * Memoria operativa de coberturas: aprende de cronogramas ya planificados
 * (quién cubrió, con qué estrategia, en qué banda).
 */

export type CoverageStrategyObserved =
    | 'modo8_plantilla'
    | 'ret_interno'
    | 'ret_externo'
    | 'extension_12h'
    | 'hybrid_12_8'
    | 'ft'
    | 'manual'
    | 'unknown';

export interface PlanningShiftCell {
    id: string;
    employeeId: string;
    employeeName?: string;
    objectiveId: string;
    dateStr: string;
    code: string;
    positionName?: string;
    coveredBy?: string;
    coversEmployeeId?: string;
    coverageSegmentRole?: string;
    isFrancoTrabajado?: boolean;
    draft?: boolean;
}

export interface CoverageWisdomEvent {
    dateStr: string;
    objectiveId: string;
    positionName: string;
    absentEmpId: string;
    absentEmpName: string;
    absentCode: string;
    covererEmpId: string;
    covererEmpName: string;
    covererCode: string;
    bandCovered: string;
    strategy: CoverageStrategyObserved;
    source: 'coveredBy_field' | 'coversEmployeeId' | 'inferred_grid';
    note?: string;
}

export interface CovererWisdomProfile {
    empId: string;
    nombre: string;
    totalCoverages: number;
    byBand: Record<string, number>;
    byStrategy: Partial<Record<CoverageStrategyObserved, number>>;
    byAbsentCode: Record<string, number>;
    lastCoverDate?: string;
    score: number;
}

export interface PlanningCoverageWisdom {
    objectiveId: string;
    year: number;
    month: number;
    periodLabel: string;
    daysAnalyzed: number;
    events: CoverageWisdomEvent[];
    coverers: CovererWisdomProfile[];
    strategyCounts: Partial<Record<CoverageStrategyObserved, number>>;
    summary: string;
    extractedAt: string;
}

const ABSENCE_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'AA']);
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12', 'FT']);

function normCode(code: string): string {
    return String(code || '').toUpperCase().trim();
}

function strategyFromCovererCode(code: string, isFt?: boolean): CoverageStrategyObserved {
    const c = normCode(code);
    if (isFt || c === 'FT') return 'ft';
    if (c === 'D12' || c === 'N12') return 'extension_12h';
    if (c === 'RET') return 'ret_interno';
    if (WORK_BANDS.has(c)) return 'modo8_plantilla';
    return 'unknown';
}

function strategyFromCoveredByLabel(label: string): CoverageStrategyObserved {
    const u = label.toUpperCase();
    if (u.includes('D12') || u.includes('N12') || u.includes('EXTENSI')) return 'extension_12h';
    if (u.includes('HÍBRID') || u.includes('HIBRID') || u.includes('12+8')) return 'hybrid_12_8';
    if (u.includes('RET EXTERN') || u.includes('OTRO OBJETIVO')) return 'ret_externo';
    if (u.includes('RET')) return 'ret_interno';
    if (u.includes('FT') || u.includes('FRANCO TRAB')) return 'ft';
    if (u.includes('MANUAL')) return 'manual';
    return 'modo8_plantilla';
}

function bandFromCode(code: string): string {
    const c = normCode(code);
    if (c === 'D12') return 'M';
    if (c === 'N12') return 'N';
    return c;
}

function resolveEmpIdByName(name: string, nameToId: Map<string, string>): string | null {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    if (nameToId.has(key)) return nameToId.get(key)!;
    for (const [k, id] of nameToId.entries()) {
        if (k.includes(key) || key.includes(k)) return id;
    }
    return null;
}

function detectHybridDay(cells: PlanningShiftCell[], dateStr: string, positionName: string): boolean {
    const day = cells.filter((c) => c.dateStr === dateStr && (c.positionName || '') === positionName);
    const d12 = day.filter((c) => normCode(c.code) === 'D12').length;
    const n12 = day.filter((c) => normCode(c.code) === 'N12').length;
    const m = day.filter((c) => normCode(c.code) === 'M').length;
    const t = day.filter((c) => normCode(c.code) === 'T').length;
    const n = day.filter((c) => normCode(c.code) === 'N').length;
    return d12 >= 1 && n12 >= 1 && m >= 1 && t >= 1 && n >= 1;
}

function buildNameMaps(cells: PlanningShiftCell[]): {
    idToName: Map<string, string>;
    nameToId: Map<string, string>;
} {
    const idToName = new Map<string, string>();
    const nameToId = new Map<string, string>();
    for (const c of cells) {
        const name = c.employeeName?.trim();
        if (name) {
            idToName.set(c.employeeId, name);
            nameToId.set(name.toLowerCase(), c.employeeId);
        }
    }
    return { idToName, nameToId };
}

export function extractPlanningCoverageWisdom(
    cells: PlanningShiftCell[],
    params: { objectiveId: string; year: number; month: number },
): PlanningCoverageWisdom {
    const { objectiveId, year, month } = params;
    const scoped = cells.filter((c) => c.objectiveId === objectiveId);
    const { idToName, nameToId } = buildNameMaps(scoped);
    const events: CoverageWisdomEvent[] = [];
    const eventKeys = new Set<string>();

    const pushEvent = (ev: CoverageWisdomEvent) => {
        const key = `${ev.dateStr}__${ev.absentEmpId}__${ev.covererEmpId}__${ev.bandCovered}`;
        if (eventKeys.has(key)) return;
        eventKeys.add(key);
        events.push(ev);
    };

    const byEmpDate = new Map<string, PlanningShiftCell>();
    for (const c of scoped) {
        byEmpDate.set(`${c.employeeId}__${c.dateStr}`, c);
    }

    const dates = [...new Set(scoped.map((c) => c.dateStr))].sort();

    for (const dateStr of dates) {
        const dayCells = scoped.filter((c) => c.dateStr === dateStr);
        const positions = [...new Set(dayCells.map((c) => c.positionName || ''))];

        for (const positionName of positions) {
            const posCells = dayCells.filter((c) => (c.positionName || '') === positionName);
            const isHybrid = detectHybridDay(scoped, dateStr, positionName);
            const absentCells = posCells.filter((c) => ABSENCE_CODES.has(normCode(c.code)));

            for (const absent of absentCells) {
                const absentName = idToName.get(absent.employeeId) || absent.employeeName || absent.employeeId;

                if (absent.coveredBy) {
                    const label = String(absent.coveredBy);
                    const strategy = strategyFromCoveredByLabel(label);
                    const covererId = resolveEmpIdByName(label.replace(/\s*\([^)]*\)\s*$/, ''), nameToId);
                    if (covererId) {
                        const covererCell = byEmpDate.get(`${covererId}__${dateStr}`);
                        pushEvent({
                            dateStr,
                            objectiveId,
                            positionName,
                            absentEmpId: absent.employeeId,
                            absentEmpName: absentName,
                            absentCode: normCode(absent.code),
                            covererEmpId: covererId,
                            covererEmpName: idToName.get(covererId) || covererId,
                            covererCode: normCode(covererCell?.code || 'M'),
                            bandCovered: bandFromCode(covererCell?.code || 'M'),
                            strategy,
                            source: 'coveredBy_field',
                            note: label,
                        });
                    } else if (strategy === 'extension_12h' || strategy === 'hybrid_12_8') {
                        const d12 = posCells.find((c) => normCode(c.code) === 'D12' && c.employeeId !== absent.employeeId);
                        const n12 = posCells.find((c) => normCode(c.code) === 'N12' && c.employeeId !== absent.employeeId);
                        if (d12) {
                            pushEvent({
                                dateStr,
                                objectiveId,
                                positionName,
                                absentEmpId: absent.employeeId,
                                absentEmpName: absentName,
                                absentCode: normCode(absent.code),
                                covererEmpId: d12.employeeId,
                                covererEmpName: idToName.get(d12.employeeId) || d12.employeeId,
                                covererCode: 'D12',
                                bandCovered: 'M',
                                strategy: isHybrid ? 'hybrid_12_8' : 'extension_12h',
                                source: 'coveredBy_field',
                                note: label,
                            });
                        }
                        if (n12) {
                            pushEvent({
                                dateStr,
                                objectiveId,
                                positionName,
                                absentEmpId: absent.employeeId,
                                absentEmpName: absentName,
                                absentCode: normCode(absent.code),
                                covererEmpId: n12.employeeId,
                                covererEmpName: idToName.get(n12.employeeId) || n12.employeeId,
                                covererCode: 'N12',
                                bandCovered: 'N',
                                strategy: isHybrid ? 'hybrid_12_8' : 'extension_12h',
                                source: 'coveredBy_field',
                                note: label,
                            });
                        }
                    }
                }

                for (const c of posCells) {
                    if (c.coversEmployeeId === absent.employeeId) {
                        const strategy = isHybrid && ['D12', 'N12'].includes(normCode(c.code))
                            ? 'hybrid_12_8'
                            : strategyFromCovererCode(c.code, c.isFrancoTrabajado);
                        pushEvent({
                            dateStr,
                            objectiveId,
                            positionName,
                            absentEmpId: absent.employeeId,
                            absentEmpName: absentName,
                            absentCode: normCode(absent.code),
                            covererEmpId: c.employeeId,
                            covererEmpName: idToName.get(c.employeeId) || c.employeeName || c.employeeId,
                            covererCode: normCode(c.code),
                            bandCovered: bandFromCode(c.code),
                            strategy,
                            source: 'coversEmployeeId',
                        });
                    }
                }
            }

            if (absentCells.length > 0) {
                const absentIds = new Set(absentCells.map((a) => a.employeeId));
                const workers = posCells.filter(
                    (c) => !absentIds.has(c.employeeId) && WORK_BANDS.has(normCode(c.code)),
                );
                const hasEventsForDay = events.some(
                    (e) => e.dateStr === dateStr && e.positionName === positionName,
                );
                if (isHybrid && !hasEventsForDay) {
                    for (const w of workers) {
                        const c = normCode(w.code);
                        const strategy: CoverageStrategyObserved =
                            c === 'D12' || c === 'N12' ? 'hybrid_12_8' : 'modo8_plantilla';
                        for (const absent of absentCells) {
                            pushEvent({
                                dateStr,
                                objectiveId,
                                positionName,
                                absentEmpId: absent.employeeId,
                                absentEmpName: idToName.get(absent.employeeId) || absent.employeeId,
                                absentCode: normCode(absent.code),
                                covererEmpId: w.employeeId,
                                covererEmpName: idToName.get(w.employeeId) || w.employeeId,
                                covererCode: c,
                                bandCovered: bandFromCode(c),
                                strategy,
                                source: 'inferred_grid',
                                note: 'Patrón híbrido D12+N12 + M+T+N',
                            });
                        }
                    }
                }
            }
        }
    }

    const covererMap = new Map<string, CovererWisdomProfile>();
    const strategyCounts: Partial<Record<CoverageStrategyObserved, number>> = {};

    for (const ev of events) {
        strategyCounts[ev.strategy] = (strategyCounts[ev.strategy] || 0) + 1;
        let prof = covererMap.get(ev.covererEmpId);
        if (!prof) {
            prof = {
                empId: ev.covererEmpId,
                nombre: ev.covererEmpName,
                totalCoverages: 0,
                byBand: {},
                byStrategy: {},
                byAbsentCode: {},
                score: 0,
            };
            covererMap.set(ev.covererEmpId, prof);
        }
        prof.totalCoverages++;
        prof.byBand[ev.bandCovered] = (prof.byBand[ev.bandCovered] || 0) + 1;
        prof.byStrategy[ev.strategy] = (prof.byStrategy[ev.strategy] || 0) + 1;
        prof.byAbsentCode[ev.absentCode] = (prof.byAbsentCode[ev.absentCode] || 0) + 1;
        if (!prof.lastCoverDate || ev.dateStr > prof.lastCoverDate) {
            prof.lastCoverDate = ev.dateStr;
        }
    }

    const maxTotal = Math.max(1, ...[...covererMap.values()].map((p) => p.totalCoverages));
    const coverers = [...covererMap.values()]
        .map((p) => ({ ...p, score: Math.round((p.totalCoverages / maxTotal) * 100) }))
        .sort((a, b) => b.totalCoverages - a.totalCoverages || a.nombre.localeCompare(b.nombre));

    const periodLabel = `${String(month).padStart(2, '0')}/${year}`;
    let summary: string;
    if (events.length === 0) {
        summary = `Sin eventos de cobertura detectados en ${periodLabel} (revisar ausencias V/L/E y campo coveredBy).`;
    } else {
        const top = coverers.slice(0, 3).map((c) => `${c.nombre} (${c.totalCoverages})`).join(', ');
        summary = `${events.length} cobertura(s) en ${periodLabel}. Referentes: ${top}.`;
    }

    return {
        objectiveId,
        year,
        month,
        periodLabel,
        daysAnalyzed: dates.length,
        events,
        coverers,
        strategyCounts,
        summary,
        extractedAt: new Date().toISOString(),
    };
}

export function rankCoverersFromWisdom(
    wisdom: PlanningCoverageWisdom | null | undefined,
    band: string,
    options?: { absentCode?: string; limit?: number },
): CovererWisdomProfile[] {
    if (!wisdom) return [];
    const b = normCode(band);
    const code = options?.absentCode ? normCode(options.absentCode) : null;
    return wisdom.coverers
        .filter((c) => (c.byBand[b] || 0) > 0)
        .filter((c) => !code || (c.byAbsentCode[code] || 0) > 0)
        .sort((a, b2) => {
            const scoreA = (a.byBand[b] || 0) * 10 + a.totalCoverages;
            const scoreB = (b2.byBand[b] || 0) * 10 + b2.totalCoverages;
            return scoreB - scoreA;
        })
        .slice(0, options?.limit ?? 5);
}

export const COVERAGE_STRATEGY_LABELS: Record<CoverageStrategyObserved, string> = {
    modo8_plantilla: 'Modo 8 — plantilla',
    ret_interno: 'RET interno activado',
    ret_externo: 'RET otro objetivo',
    extension_12h: 'Contingencia D12+N12',
    hybrid_12_8: 'Híbrido D12+N12 + M+T+N',
    ft: 'Franco trabajado (FT)',
    manual: 'Asignación manual',
    unknown: 'Sin clasificar',
};
