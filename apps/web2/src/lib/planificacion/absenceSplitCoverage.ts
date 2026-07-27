/**
 * Cobertura por extensión 12h ante ausencia / día Modo 12.
 *
 * Prioridad 1 en cadena COSP: M+T+N (3×8) → D12+N12 (2×12) misma cobertura 24h.
 * Si falta banda → promover M→D12 y N→N12 antes de RET o FT (último recurso, costo doble).
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import { absenceRequiresCoverage } from './absenceFrancoUtils';
import { countMissingBands8h } from './externalRetCoverage';
import { tryApplyHybridPaxContingency, type HybridContingencyAction } from './hybridContingencyCoverage';
import { getModo12Days } from './objectiveCoverageDemand';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const WORK_8 = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    D12: { name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
    N12: { name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
};

export type AbsenceSplitAction = {
    dateStr: string;
    positionName: string;
    absentEmpId?: string;
    absentBand?: string;
    d12EmpId: string;
    n12EmpId: string;
    forced?: boolean;
};

export type AbsenceSplitResult = {
    assignments: V2Assignment[];
    actions: AbsenceSplitAction[];
    handledKeys: Set<string>;
    /** Días Modo 12 efectivos (excluye ausencias que caen en franco del ciclo). */
    effectiveModo12Days: string[];
    /** Días con hueco parcial en pax>1: demanda sigue en M+T+N, no D12+N12. */
    partialGapDays: Set<string>;
    hybridActions: HybridContingencyAction[];
};

function makeRestCfg(ctx: V2EngineContext): AgreementRestConfig {
    const { cL } = pickRepresentativeCycle(ctx.autoCycles || []);
    return {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
        maxConsecutiveWorkDays: cL,
    };
}

function makeGetShift(
    assignments: V2Assignment[],
    absences: V2EngineContext['absences'],
): (empId: string, dateStr: string) => { code: string; startTime: string; hours: number } | null {
    const idx = new Map<string, V2Assignment>();
    assignments.forEach((a) => idx.set(`${a.empId}__${a.dateStr}`, a));
    return (empId, dateStr) => {
        const abs = absences[empId]?.get(dateStr);
        if (abs) return { code: abs, startTime: '00:00', hours: 0 };
        const a = idx.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (c === 'RET' || FRANCO_CODES.has(c)) return { code: c, startTime: '00:00', hours: 0 };
        const meta = SHIFT_META[c];
        return {
            code: c,
            startTime: a.startTime || meta?.startTime || '07:00',
            hours: Number(a.hours) || meta?.hours || 8,
        };
    };
}

function canPromoteTo12(
    empId: string,
    dateStr: string,
    targetCode: 'D12' | 'N12',
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): boolean {
    if (ctx.absences[empId]?.has(dateStr)) return false;
    const meta = SHIFT_META[targetCode];
    const violation = checkRestBetweenShifts({
        empId,
        targetDateStr: dateStr,
        proposed: { code: targetCode, startTime: meta.startTime, hours: meta.hours },
        getShift: makeGetShift(assignments, ctx.absences),
        cfg,
    });
    return violation === null;
}

function promoteAssignment(a: V2Assignment, targetCode: 'D12' | 'N12', positionName: string): void {
    const meta = SHIFT_META[targetCode];
    a.code = targetCode;
    a.name = meta.name;
    a.hours = meta.hours;
    a.startTime = meta.startTime;
    a.endTime = meta.endTime;
    a.isFranco = false;
    a.isReten = false;
    a.positionName = positionName || a.positionName;
}

function findBandAtPosition(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
    excludeEmpIds: Set<string>,
): V2Assignment | undefined {
    return assignments.find((a) => {
        if (a.dateStr !== dateStr) return false;
        if (a.positionName !== positionName) return false;
        if (excludeEmpIds.has(a.empId)) return false;
        return String(a.code || '').toUpperCase() === band;
    });
}

function resolvePositionGroup(
    positionName: string,
    ctx: V2EngineContext,
    assignments: V2Assignment[],
): string[] {
    const fromDefault = ctx.employees
        .filter((e) => ctx.defaultPositionByEmp?.[e.id] === positionName)
        .map((e) => e.id);
    if (fromDefault.length > 0) return fromDefault;

    const fromMonth = new Set<string>();
    for (const a of assignments) {
        if (a.positionName === positionName && WORK_8.has(String(a.code || '').toUpperCase())) {
            fromMonth.add(a.empId);
        }
    }
    if (fromMonth.size > 0) return [...fromMonth];

    return ctx.employees.map((e) => e.id);
}

function pickD12N12Pair(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    group: string[],
    exclude: Set<string>,
): { d12: V2Assignment; n12: V2Assignment } | null {
    const mRow = findBandAtPosition(assignments, dateStr, positionName, 'M', exclude);
    const nRow = findBandAtPosition(assignments, dateStr, positionName, 'N', exclude);
    if (mRow && nRow && mRow.empId !== nRow.empId) {
        return { d12: mRow, n12: nRow };
    }

    const workRows = assignments.filter((a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName) return false;
        if (exclude.has(a.empId)) return false;
        return WORK_8.has(String(a.code || '').toUpperCase());
    });

    if (workRows.length >= 2) {
        const mLike = workRows.find((a) => String(a.code).toUpperCase() === 'M') || workRows[0];
        const nLike = workRows.find((a) => String(a.code).toUpperCase() === 'N' && a.empId !== mLike.empId)
            || workRows.find((a) => a.empId !== mLike.empId);
        if (nLike) return { d12: mLike, n12: nLike };
    }

    const available = group.filter((id) => !exclude.has(id));
    if (available.length >= 2) {
        const a0 = assignments.find((a) => a.empId === available[0] && a.dateStr === dateStr);
        const a1 = assignments.find((a) => a.empId === available[1] && a.dateStr === dateStr);
        if (a0 && a1 && !FRANCO_CODES.has(String(a0.code)) && !FRANCO_CODES.has(String(a1.code))) {
            return { d12: a0, n12: a1 };
        }
    }

    return null;
}

function applyModo12DayAtPosition(
    result: V2Assignment[],
    ctx: V2EngineContext,
    dateStr: string,
    positionName: string,
    cfg: AgreementRestConfig,
    absentOnDay: Map<string, string>,
    forceModo12: boolean,
): AbsenceSplitAction | null {
    const exclude = new Set<string>(absentOnDay.keys());

    const existingD12 = findBandAtPosition(result, dateStr, positionName, 'D12', exclude);
    const existingN12 = findBandAtPosition(result, dateStr, positionName, 'N12', exclude);
    if (existingD12 && existingN12) {
        return {
            dateStr,
            positionName,
            absentEmpId: absentOnDay.size > 0 ? [...absentOnDay.keys()][0] : undefined,
            d12EmpId: existingD12.empId,
            n12EmpId: existingN12.empId,
        };
    }

    const group = resolvePositionGroup(positionName, ctx, result);
    const pair = pickD12N12Pair(result, dateStr, positionName, group, exclude);
    if (!pair) return null;

    const force = forceModo12;
    const d12Ok = canPromoteTo12(pair.d12.empId, dateStr, 'D12', result, ctx, cfg);
    const n12Ok = canPromoteTo12(pair.n12.empId, dateStr, 'N12', result, ctx, cfg);
    if (!d12Ok || !n12Ok) {
        if (!force) return null;
    }

    promoteAssignment(pair.d12, 'D12', positionName);
    promoteAssignment(pair.n12, 'N12', positionName);

    for (const [empId, absenceCode] of absentOnDay.entries()) {
        if (!ctx.absences[empId]?.has(dateStr)) continue;
        const cell = result.find((a) => a.empId === empId && a.dateStr === dateStr);
        if (cell) {
            cell.code = absenceCode;
            cell.name = absenceCode;
            cell.hours = 0;
            cell.startTime = '00:00';
            cell.isFranco = false;
            cell.isReten = false;
        } else {
            result.push({
                empId,
                dateStr,
                positionName,
                code: absenceCode,
                name: absenceCode,
                hours: 0,
                startTime: '00:00',
                isFranco: false,
            });
        }
    }

    const tRow = findBandAtPosition(result, dateStr, positionName, 'T', new Set());
    const pax = Math.max(
        1,
        Number(ctx.positions.find((p) => p.positionName === positionName)?.qty) || 1,
    );
    // Con pax>1 solo una rotación pasa a D12+N12; la otra sigue M+T+N — no quitar turnos T.
    if (pax <= 1 && tRow && !exclude.has(tRow.empId)) {
        const idx = result.indexOf(tRow);
        if (idx >= 0) result.splice(idx, 1);
    }

    const absentEmp = [...absentOnDay.keys()].find((id) => ctx.absences[id]?.has(dateStr));
    const absentWork = absentEmp
        ? result.find((a) => a.empId === absentEmp && a.dateStr === dateStr && WORK_8.has(String(a.code || '').toUpperCase()))
        : undefined;

    return {
        dateStr,
        positionName,
        absentEmpId: absentEmp,
        absentBand: absentWork ? String(absentWork.code).toUpperCase() : undefined,
        d12EmpId: pair.d12.empId,
        n12EmpId: pair.n12.empId,
        forced: force && (!d12Ok || !n12Ok),
    };
}

function filterWorkDayAbsences(
    absentMap: Map<string, string>,
    dateStr: string,
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: V2EngineContext,
): Map<string, string> {
    const out = new Map<string, string>();
    for (const [empId, code] of absentMap.entries()) {
        if (absenceRequiresCoverage(empId, dateStr, openingSlotByEmp, ctx)) {
            out.set(empId, code);
        }
    }
    return out;
}

function resolveEffectiveModo12Days(
    ctx: V2EngineContext,
    openingSlotByEmp: Record<string, number> | undefined,
): Set<string> {
    const brainDays = new Set(getModo12Days(ctx));
    const effective = new Set<string>();

    for (const dateStr of brainDays) {
        let hasAbsence = false;
        let hasWorkAbsence = false;
        for (const [empId, dateMap] of Object.entries(ctx.absences)) {
            if (!dateMap.has(dateStr)) continue;
            hasAbsence = true;
            if (absenceRequiresCoverage(empId, dateStr, openingSlotByEmp, ctx)) {
                hasWorkAbsence = true;
                break;
            }
        }
        if (!hasAbsence || hasWorkAbsence) {
            effective.add(dateStr);
        }
    }

    for (const [empId, dateMap] of Object.entries(ctx.absences)) {
        for (const dateStr of dateMap.keys()) {
            if (absenceRequiresCoverage(empId, dateStr, openingSlotByEmp, ctx)) {
                effective.add(dateStr);
            }
        }
    }

    return effective;
}

/**
 * Convierte días Modo 12 / con ausencia V-L-E a esquema D12+N12 (2×12h).
 * Ausencias en día de franco del ciclo → solo marca E/V/L; no activa split ni cobertura.
 */
export function applyAbsenceSplitCoverage(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    openingSlotByEmp?: Record<string, number>,
    options?: { skipModo12Days?: Set<string> },
): AbsenceSplitResult {
    const result = assignments.map((a) => ({ ...a }));
    const actions: AbsenceSplitAction[] = [];
    const handledKeys = new Set<string>();
    const partialGapDays = new Set<string>();
    const hybridActions: HybridContingencyAction[] = [];
    const cfg = makeRestCfg(ctx);

    const absenceDaysByPos = new Map<string, Map<string, string>>();

    for (const [empId, dateMap] of Object.entries(ctx.absences)) {
        for (const [dateStr, code] of dateMap.entries()) {
            const pos = ctx.defaultPositionByEmp?.[empId]
                || result.find((a) => a.empId === empId && a.positionName)?.positionName
                || ctx.positions[0]?.positionName
                || '';
            if (!pos) continue;
            const key = `${dateStr}__${pos}`;
            if (!absenceDaysByPos.has(key)) absenceDaysByPos.set(key, new Map());
            absenceDaysByPos.get(key)!.set(empId, code);
        }
    }

    const effectiveModo12Days = resolveEffectiveModo12Days(ctx, openingSlotByEmp);
    const skipModo12 = options?.skipModo12Days ?? new Set<string>();
    const surplusPool = ctx.idleSurplusEmpIds ?? [];
    const modo12Explicit = (ctx.modo12Days?.length ?? 0) > 0;
    /** Con excedente RET y sin Modo 12 del cerebro → no promover D12/N12 por cada V/L/E. */
    const allowAbsenceD12Split = surplusPool.length === 0 || modo12Explicit;

    const daysToProcess = new Set<string>();
    for (const d of effectiveModo12Days) {
        if (!skipModo12.has(d)) daysToProcess.add(d);
    }
    if (allowAbsenceD12Split) {
        for (const key of absenceDaysByPos.keys()) {
            const dateStr = key.split('__')[0];
            if (!skipModo12.has(dateStr)) daysToProcess.add(dateStr);
        }
    }

    const effectiveModo12Filtered = [...effectiveModo12Days]
        .filter((d) => !skipModo12.has(d))
        .sort();

    for (const pos of ctx.positions) {
        const posName = pos.positionName;
        for (const dateStr of daysToProcess) {
            const dayPosKey = `${dateStr}__${posName}`;
            if (handledKeys.has(dayPosKey)) continue;

            const absentMap = absenceDaysByPos.get(dayPosKey) || new Map();
            const workAbsentMap = filterWorkDayAbsences(absentMap, dateStr, openingSlotByEmp, ctx);
            const isM12 = effectiveModo12Filtered.includes(dateStr);
            if (!isM12 && workAbsentMap.size === 0) continue;

            const pax = Math.max(1, Number(pos.qty) || 1);
            const missing8h = countMissingBands8h(
                result,
                ctx,
                dateStr,
                posName,
                openingSlotByEmp,
            );
            // Pax>1 con hueco parcial: contingencia híbrida D12+N12 + M+T+N (sin RET).
            if (pax > 1 && missing8h.length > 0 && missing8h.length < 3) {
                const exclude = new Set(workAbsentMap.keys());
                const hybrid = tryApplyHybridPaxContingency(
                    result,
                    ctx,
                    dateStr,
                    posName,
                    exclude,
                );
                if (hybrid) {
                    hybridActions.push(hybrid);
                    partialGapDays.add(dateStr);
                    handledKeys.add(dayPosKey);
                    continue;
                }
                partialGapDays.add(dateStr);
                continue;
            }

            const action = applyModo12DayAtPosition(
                result,
                ctx,
                dateStr,
                posName,
                cfg,
                workAbsentMap,
                isM12,
            );
            if (!action) continue;

            actions.push(action);
            handledKeys.add(dayPosKey);
        }
    }

    const effectiveModo12Out = effectiveModo12Filtered.filter((d) => !partialGapDays.has(d));

    return {
        assignments: result,
        actions,
        handledKeys,
        effectiveModo12Days: effectiveModo12Out,
        partialGapDays,
        hybridActions,
    };
}

export function isAbsenceSplitHandled(
    handledKeys: Set<string>,
    dateStr: string,
    positionName: string,
): boolean {
    return handledKeys.has(`${dateStr}__${positionName}`);
}
