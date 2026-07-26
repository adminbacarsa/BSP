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
    coveredByEmployeeId?: string;
    coveredByEmployeeName?: string;
    coversEmployeeId?: string;
    coverageSegmentRole?: string;
    comments?: string;
    isFrancoTrabajado?: boolean;
    draft?: boolean;
}

export interface PlanningAbsenceRecord {
    employeeId: string;
    employeeName?: string;
    dateStr: string;
    code: string;
    absenceId: string;
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

export interface EmployeeWorkWisdomProfile {
    empId: string;
    nombre: string;
    totalWorkDays: number;
    byPosition: Record<string, number>;
    byBand: Record<string, number>;
    shift12hCount: number;
    shift8hCount: number;
    maxWorkStreak: number;
    retDays: number;
}

export interface PlanningCoverageWisdom {
    objectiveId: string;
    year: number;
    month: number;
    periodLabel: string;
    daysAnalyzed: number;
    cellsAnalyzed: number;
    absenceContextsFound: number;
    events: CoverageWisdomEvent[];
    coverers: CovererWisdomProfile[];
    strategyCounts: Partial<Record<CoverageStrategyObserved, number>>;
    summary: string;
    extractedAt: string;
    /** Meses YYYY-MM incluidos en el análisis histórico. */
    monthsIncluded?: string[];
    lookbackMonths?: number;
    /** Hábitos de trabajo por legajo (puesto, 12h, rachas). */
    employeeProfiles?: Record<string, EmployeeWorkWisdomProfile>;
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

function parseCoveringComment(comment: string): string | null {
    const m = String(comment || '').match(/Cubriendo a\s+(.+?)(?:\s*\(|$)/i);
    return m ? m[1].trim() : null;
}

function inferPositionForEmployee(employeeId: string, scoped: PlanningShiftCell[]): string {
    const counts = new Map<string, number>();
    for (const c of scoped) {
        if (c.employeeId !== employeeId) continue;
        if (!WORK_BANDS.has(normCode(c.code))) continue;
        const p = c.positionName || '';
        counts.set(p, (counts.get(p) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || '';
}

type AbsentContext = {
    absentEmpId: string;
    absentEmpName: string;
    absentCode: string;
    dateStr: string;
    positionName: string;
    coveredBy?: string;
    source: 'turno' | 'ausencias';
};

function collectAbsentContexts(
    scoped: PlanningShiftCell[],
    absences: PlanningAbsenceRecord[],
    idToName: Map<string, string>,
): AbsentContext[] {
    const contexts: AbsentContext[] = [];
    const keys = new Set<string>();

    for (const c of scoped) {
        if (!ABSENCE_CODES.has(normCode(c.code))) continue;
        const key = `${c.employeeId}__${c.dateStr}`;
        if (keys.has(key)) continue;
        keys.add(key);
        contexts.push({
            absentEmpId: c.employeeId,
            absentEmpName: idToName.get(c.employeeId) || c.employeeName || c.employeeId,
            absentCode: normCode(c.code),
            dateStr: c.dateStr,
            positionName: c.positionName || inferPositionForEmployee(c.employeeId, scoped),
            coveredBy: c.coveredBy,
            source: 'turno',
        });
    }

    for (const a of absences) {
        const key = `${a.employeeId}__${a.dateStr}`;
        if (keys.has(key)) continue;
        keys.add(key);
        contexts.push({
            absentEmpId: a.employeeId,
            absentEmpName: a.employeeName || idToName.get(a.employeeId) || a.employeeId,
            absentCode: normCode(a.code),
            dateStr: a.dateStr,
            positionName: inferPositionForEmployee(a.employeeId, scoped),
            source: 'ausencias',
        });
    }

    return contexts;
}

function resolveCovererFromLabel(
    label: string,
    nameToId: Map<string, string>,
): string | null {
    const clean = String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!clean) return null;
    return resolveEmpIdByName(clean, nameToId);
}

export function extractPlanningCoverageWisdom(
    cells: PlanningShiftCell[],
    params: {
        objectiveId: string;
        year: number;
        month: number;
        absences?: PlanningAbsenceRecord[];
    },
): PlanningCoverageWisdom {
    const { objectiveId, year, month, absences = [] } = params;
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
    const absentContexts = collectAbsentContexts(scoped, absences, idToName);

    const linkCovererToAbsent = (
        absent: AbsentContext,
        covererEmpId: string,
        covererCode: string,
        strategy: CoverageStrategyObserved,
        source: CoverageWisdomEvent['source'],
        note?: string,
    ) => {
        if (!covererEmpId || covererEmpId === absent.absentEmpId) return;
        pushEvent({
            dateStr: absent.dateStr,
            objectiveId,
            positionName: absent.positionName,
            absentEmpId: absent.absentEmpId,
            absentEmpName: absent.absentEmpName,
            absentCode: absent.absentCode,
            covererEmpId,
            covererEmpName: idToName.get(covererEmpId) || covererEmpId,
            covererCode: normCode(covererCode),
            bandCovered: bandFromCode(covererCode),
            strategy,
            source,
            note,
        });
    };

    for (const absent of absentContexts) {
        const posCells = scoped.filter(
            (c) => c.dateStr === absent.dateStr && (c.positionName || '') === (absent.positionName || ''),
        );
        const dayCells = scoped.filter((c) => c.dateStr === absent.dateStr);
        const isHybrid = detectHybridDay(scoped, absent.dateStr, absent.positionName || '');

        if (absent.coveredBy) {
            const label = String(absent.coveredBy);
            const strategy = strategyFromCoveredByLabel(label);
            const covererId = resolveCovererFromLabel(label, nameToId);
            if (covererId) {
                const covererCell = byEmpDate.get(`${covererId}__${absent.dateStr}`);
                linkCovererToAbsent(
                    absent,
                    covererId,
                    covererCell?.code || 'M',
                    strategy,
                    'coveredBy_field',
                    label,
                );
            } else if (strategy === 'extension_12h' || strategy === 'hybrid_12_8') {
                const d12 = posCells.find((c) => normCode(c.code) === 'D12' && c.employeeId !== absent.absentEmpId);
                const n12 = posCells.find((c) => normCode(c.code) === 'N12' && c.employeeId !== absent.absentEmpId);
                if (d12) {
                    linkCovererToAbsent(absent, d12.employeeId, 'D12', isHybrid ? 'hybrid_12_8' : 'extension_12h', 'coveredBy_field', label);
                }
                if (n12) {
                    linkCovererToAbsent(absent, n12.employeeId, 'N12', isHybrid ? 'hybrid_12_8' : 'extension_12h', 'coveredBy_field', label);
                }
            }
        }

        const absentCell = byEmpDate.get(`${absent.absentEmpId}__${absent.dateStr}`);
        if (absentCell?.coveredByEmployeeId) {
            const covererCell = byEmpDate.get(`${absentCell.coveredByEmployeeId}__${absent.dateStr}`);
            linkCovererToAbsent(
                absent,
                absentCell.coveredByEmployeeId,
                covererCell?.code || 'M',
                strategyFromCovererCode(covererCell?.code || 'M', covererCell?.isFrancoTrabajado),
                'coveredBy_field',
                absentCell.coveredByEmployeeName,
            );
        }

        for (const c of dayCells) {
            if (c.employeeId === absent.absentEmpId) continue;

            if (c.coversEmployeeId === absent.absentEmpId) {
                const strategy = isHybrid && ['D12', 'N12'].includes(normCode(c.code))
                    ? 'hybrid_12_8'
                    : strategyFromCovererCode(c.code, c.isFrancoTrabajado);
                linkCovererToAbsent(absent, c.employeeId, c.code, strategy, 'coversEmployeeId');
            }

            if (c.coveredByEmployeeId === absent.absentEmpId) {
                linkCovererToAbsent(
                    absent,
                    c.employeeId,
                    c.code,
                    strategyFromCovererCode(c.code, c.isFrancoTrabajado),
                    'coversEmployeeId',
                );
            }

            const titularFromComment = parseCoveringComment(c.comments || '');
            if (titularFromComment) {
                const titularId = resolveCovererFromLabel(titularFromComment, nameToId);
                if (titularId === absent.absentEmpId) {
                    linkCovererToAbsent(
                        absent,
                        c.employeeId,
                        c.code,
                        strategyFromCovererCode(c.code, c.isFrancoTrabajado),
                        'inferred_grid',
                        c.comments,
                    );
                }
            }
        }
    }

    for (const dateStr of dates) {
        const dayCells = scoped.filter((c) => c.dateStr === dateStr);
        const positions = [...new Set(dayCells.map((c) => c.positionName || ''))];

        for (const positionName of positions) {
            const posCells = dayCells.filter((c) => (c.positionName || '') === positionName);
            const isHybrid = detectHybridDay(scoped, dateStr, positionName);
            const dayAbsents = absentContexts.filter(
                (a) => a.dateStr === dateStr && (a.positionName || '') === positionName,
            );
            if (dayAbsents.length === 0) continue;

            const absentIds = new Set(dayAbsents.map((a) => a.absentEmpId));
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
                    for (const absent of dayAbsents) {
                        linkCovererToAbsent(absent, w.employeeId, c, strategy, 'inferred_grid', 'Patrón híbrido D12+N12 + M+T+N');
                    }
                }
            } else if (!hasEventsForDay && workers.length > 0) {
                for (const absent of dayAbsents) {
                    for (const w of workers) {
                        linkCovererToAbsent(
                            absent,
                            w.employeeId,
                            w.code,
                            strategyFromCovererCode(w.code, w.isFrancoTrabajado),
                            'inferred_grid',
                            'Misma fecha/puesto — sin coveredBy explícito',
                        );
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
        summary = absentContexts.length > 0
            ? `Sin coberturas detectadas en ${periodLabel}: ${scoped.length} celdas, ${absentContexts.length} ausencia(s) V/L/E (turnos o RRHH).`
            : `Sin ausencias V/L/E ni coberturas en ${periodLabel} (${scoped.length} celdas de turno).`;
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
        cellsAnalyzed: scoped.length,
        absenceContextsFound: absentContexts.length,
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

const SHIFT_12H_CODES = new Set(['D12', 'N12']);
const SHIFT_8H_CODES = new Set(['M', 'T', 'N', 'FT', 'ESC', 'REF']);

function addDaysToDateStr(dateStr: string, delta: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function computeMaxWorkStreak(dateCodes: Map<string, string>): number {
    const dates = [...dateCodes.keys()].sort();
    if (dates.length === 0) return 0;
    let max = 0;
    let streak = 0;
    let prev: string | null = null;
    for (const ds of dates) {
        const code = normCode(dateCodes.get(ds) || '');
        const isWork = WORK_BANDS.has(code) || code === 'RET';
        if (!isWork) {
            streak = 0;
            prev = ds;
            continue;
        }
        if (prev && addDaysToDateStr(prev, 1) === ds) streak++;
        else streak = 1;
        max = Math.max(max, streak);
        prev = ds;
    }
    return max;
}

export function extractEmployeeWorkProfiles(
    cells: PlanningShiftCell[],
    objectiveId: string,
): Record<string, EmployeeWorkWisdomProfile> {
    const scoped = cells.filter((c) => c.objectiveId === objectiveId);
    const byEmp = new Map<string, { nombre: string; dates: Map<string, string> }>();
    const out: Record<string, EmployeeWorkWisdomProfile> = {};

    for (const c of scoped) {
        const code = normCode(c.code);
        if (!code || ABSENCE_CODES.has(code)) continue;

        let row = byEmp.get(c.employeeId);
        if (!row) {
            row = { nombre: c.employeeName || c.employeeId, dates: new Map() };
            byEmp.set(c.employeeId, row);
            out[c.employeeId] = {
                empId: c.employeeId,
                nombre: row.nombre,
                totalWorkDays: 0,
                byPosition: {},
                byBand: {},
                shift12hCount: 0,
                shift8hCount: 0,
                maxWorkStreak: 0,
                retDays: 0,
            };
        }
        if (c.employeeName) {
            row.nombre = c.employeeName;
            out[c.employeeId].nombre = c.employeeName;
        }
        row.dates.set(c.dateStr, code);

        const prof = out[c.employeeId];
        if (code === 'RET') {
            prof.retDays++;
            continue;
        }
        if (!WORK_BANDS.has(code) && !SHIFT_8H_CODES.has(code)) continue;

        prof.totalWorkDays++;
        const pos = c.positionName || '';
        if (pos) prof.byPosition[pos] = (prof.byPosition[pos] || 0) + 1;
        const band = bandFromCode(code);
        prof.byBand[band] = (prof.byBand[band] || 0) + 1;
        if (SHIFT_12H_CODES.has(code)) prof.shift12hCount++;
        else if (SHIFT_8H_CODES.has(code)) prof.shift8hCount++;
    }

    for (const [empId, row] of byEmp.entries()) {
        if (out[empId]) out[empId].maxWorkStreak = computeMaxWorkStreak(row.dates);
    }
    return out;
}

function mergeCovererProfiles(profiles: CovererWisdomProfile[]): CovererWisdomProfile[] {
    const map = new Map<string, CovererWisdomProfile>();
    for (const p of profiles) {
        let acc = map.get(p.empId);
        if (!acc) {
            acc = {
                empId: p.empId,
                nombre: p.nombre,
                totalCoverages: 0,
                byBand: {},
                byStrategy: {},
                byAbsentCode: {},
                score: 0,
            };
            map.set(p.empId, acc);
        }
        acc.totalCoverages += p.totalCoverages;
        for (const [k, v] of Object.entries(p.byBand)) {
            acc.byBand[k] = (acc.byBand[k] || 0) + v;
        }
        for (const [k, v] of Object.entries(p.byStrategy)) {
            const key = k as CoverageStrategyObserved;
            acc.byStrategy[key] = (acc.byStrategy[key] || 0) + (v || 0);
        }
        for (const [k, v] of Object.entries(p.byAbsentCode)) {
            acc.byAbsentCode[k] = (acc.byAbsentCode[k] || 0) + v;
        }
        if (!acc.lastCoverDate || (p.lastCoverDate && p.lastCoverDate > acc.lastCoverDate)) {
            acc.lastCoverDate = p.lastCoverDate;
        }
        if (p.nombre && p.nombre !== p.empId) acc.nombre = p.nombre;
    }
    const maxTotal = Math.max(1, ...[...map.values()].map((p) => p.totalCoverages));
    return [...map.values()]
        .map((p) => ({ ...p, score: Math.round((p.totalCoverages / maxTotal) * 100) }))
        .sort((a, b) => b.totalCoverages - a.totalCoverages || a.nombre.localeCompare(b.nombre));
}

export function mergeCoverageWisdom(
    monthly: PlanningCoverageWisdom[],
    params: {
        objectiveId: string;
        targetYear: number;
        targetMonth: number;
        lookbackMonths: number;
        allCells: PlanningShiftCell[];
    },
): PlanningCoverageWisdom {
    const { objectiveId, targetYear, targetMonth, lookbackMonths, allCells } = params;
    const monthsIncluded = monthly.map(
        (m) => `${m.year}-${String(m.month).padStart(2, '0')}`,
    );
    const periodLabel = monthsIncluded.length > 0
        ? `${monthsIncluded[0]} → ${monthsIncluded[monthsIncluded.length - 1]}`
        : `${String(targetMonth).padStart(2, '0')}/${targetYear}`;

    const eventKeys = new Set<string>();
    const events: CoverageWisdomEvent[] = [];
    for (const m of monthly) {
        for (const ev of m.events) {
            const key = `${ev.dateStr}__${ev.absentEmpId}__${ev.covererEmpId}__${ev.bandCovered}`;
            if (eventKeys.has(key)) continue;
            eventKeys.add(key);
            events.push(ev);
        }
    }

    const strategyCounts: Partial<Record<CoverageStrategyObserved, number>> = {};
    for (const ev of events) {
        strategyCounts[ev.strategy] = (strategyCounts[ev.strategy] || 0) + 1;
    }

    const coverers = mergeCovererProfiles(monthly.flatMap((m) => m.coverers));
    const employeeProfiles = extractEmployeeWorkProfiles(allCells, objectiveId);

    const daysAnalyzed = monthly.reduce((s, m) => s + m.daysAnalyzed, 0);
    const cellsAnalyzed = allCells.filter((c) => c.objectiveId === objectiveId).length;
    const absenceContextsFound = monthly.reduce((s, m) => s + m.absenceContextsFound, 0);

    const top12 = Object.values(employeeProfiles)
        .filter((p) => p.shift12hCount > 0)
        .sort((a, b) => b.shift12hCount - a.shift12hCount)
        .slice(0, 2)
        .map((p) => `${p.nombre} (${p.shift12hCount}×12h)`)
        .join(', ');

    let summary: string;
    if (events.length === 0 && Object.keys(employeeProfiles).length === 0) {
        summary = `Sin historial operativo en los últimos ${lookbackMonths} mes(es) antes de ${String(targetMonth).padStart(2, '0')}/${targetYear}.`;
    } else {
        const topCover = coverers.slice(0, 2).map((c) => `${c.nombre} (${c.totalCoverages})`).join(', ');
        const parts: string[] = [];
        if (events.length > 0) parts.push(`${events.length} cobertura(s)`);
        if (topCover) parts.push(`referentes: ${topCover}`);
        if (top12) parts.push(`12h: ${top12}`);
        summary = `Historial ${periodLabel}: ${parts.join(' · ')}.`;
    }

    return {
        objectiveId,
        year: targetYear,
        month: targetMonth,
        periodLabel,
        daysAnalyzed,
        cellsAnalyzed,
        absenceContextsFound,
        events,
        coverers,
        strategyCounts,
        summary,
        extractedAt: new Date().toISOString(),
        monthsIncluded,
        lookbackMonths,
        employeeProfiles,
    };
}

export function positionAffinityScore(
    empId: string,
    positionName: string,
    wisdom: PlanningCoverageWisdom | null | undefined,
): number {
    if (!wisdom?.employeeProfiles || !positionName) return 0;
    const p = wisdom.employeeProfiles[empId];
    if (!p || p.totalWorkDays <= 0) return 0;
    const posCount = p.byPosition[positionName] || 0;
    return Math.round((posCount / p.totalWorkDays) * 70);
}

export function shift12hAffinityScore(
    empId: string,
    wisdom: PlanningCoverageWisdom | null | undefined,
): number {
    if (!wisdom?.employeeProfiles) return 0;
    const p = wisdom.employeeProfiles[empId];
    if (!p) return 0;
    const total = p.shift12hCount + p.shift8hCount;
    if (total <= 0) return 0;
    return Math.round((p.shift12hCount / total) * 45);
}

export function previousCalendarMonth(year: number, month: number): { year: number; month: number } {
    if (month <= 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
}

export const DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS = 6;

export function calendarMonthsBefore(
    targetYear: number,
    targetMonth: number,
    count: number,
): Array<{ year: number; month: number }> {
    const out: Array<{ year: number; month: number }> = [];
    let y = targetYear;
    let m = targetMonth;
    for (let i = 0; i < count; i++) {
        const prev = previousCalendarMonth(y, m);
        y = prev.year;
        m = prev.month;
        out.unshift({ year: y, month: m });
    }
    return out;
}

export function wisdomBandFromShiftCode(code: string): string {
    return bandFromCode(code);
}
