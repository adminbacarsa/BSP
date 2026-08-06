/**
 * Motor bandas fijas (rotateShifts=false): M/T/N todo el mes por guardia.
 * Esquema por guardia: arranca en 6+2 (preferencia UI) y escala 6+2→6+1→5+1
 * si falta capacidad horaria vs slaVendidas, respetando pico por banda.
 * Con pico P y pocos guardias (ej. 5 en T/N) el mínimo operativo puede ser 5+1.
 * Ej. 16 guardias → 6 M en 6+2 + 10 T/N en 5+1, con upgrades puntuales a 6+1 en M.
 */

import {
    generateScheduleV2,
    pickRepresentativeCycle,
    effectiveShiftsForPositionDay,
    positionIsActiveOn,
    HARD_MAX_HOURS,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
} from './autoScheduleEngineV2';
import { isFullCustomObjectivePool } from './objectiveHeadcount';

export type FixedBandSchemeKey = '6+2' | '6+1' | '5+1';

const CYCLE_MAP: Record<FixedBandSchemeKey, [number, number]> = {
    '6+2': [6, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
};

const SCHEME_INTENSITY_ORDER: FixedBandSchemeKey[] = ['6+2', '6+1', '5+1'];

const FIXED_BAND_OFFSET: Record<string, number> = { N: 0, N12: 1, T: 2, D12: 4, M: 5 };

/** Apretar crono / ajustar: esquemas intensivos + RET de banca para otros objetivos. */
export function isFixedBandIntensiveMode(ctx: V2EngineContext): boolean {
    return ctx.ajustarCrono === true || (ctx.apretarCronoDays?.length ?? 0) > 0;
}

function schemeToCycle(key: FixedBandSchemeKey): [number, number] {
    return CYCLE_MAP[key];
}

function cycleToSchemeKey(cL: number, cF: number): FixedBandSchemeKey {
    if (cL === 6 && cF === 2) return '6+2';
    if (cL === 6 && cF === 1) return '6+1';
    if (cL === 5 && cF === 1) return '5+1';
    return '6+1';
}

function allowedSchemesInOrder(autoCycles: string[]): FixedBandSchemeKey[] {
    if (!autoCycles.length) return [...SCHEME_INTENSITY_ORDER];
    return SCHEME_INTENSITY_ORDER.filter(k => autoCycles.includes(k));
}

function userPreferredScheme(autoCycles: string[]): FixedBandSchemeKey {
    const allowed = allowedSchemesInOrder(autoCycles);
    return allowed.includes('6+2') ? '6+2' : (allowed[0] ?? '6+2');
}

function nextIntensiveScheme(cur: FixedBandSchemeKey): FixedBandSchemeKey | null {
    const idx = SCHEME_INTENSITY_ORDER.indexOf(cur);
    return idx >= 0 && idx < SCHEME_INTENSITY_ORDER.length - 1
        ? SCHEME_INTENSITY_ORDER[idx + 1]
        : null;
}
export function estimateEmpBillableHours(
    ctx: V2EngineContext,
    empId: string,
    cL: number,
    cF: number,
    avgShiftHours = 8,
): number {
    const mode = ctx.budgetMode === 'calendar' ? 'calendar' : 'cct';
    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay
        : 25;
    const workRatio = cL / (cL + cF);
    const priorHours = Math.max(0, ctx.empMonthlyInitial[empId] || 0);
    const absSet = ctx.absences[empId];

    if (mode === 'calendar') {
        const absenceDays = absSet
            ? ctx.daysInMonth.filter(d => absSet.has(ctx.getDateKey(d))).length
            : 0;
        return Math.max(0, HARD_MAX_HOURS - absenceDays * avgShiftHours);
    }

    const daysCurrent = ctx.daysInMonth.filter(d => d.getDate() <= cutoffDay);
    const daysNext = ctx.daysInMonth.filter(d => d.getDate() > cutoffDay);
    const absenceDaysCurrent = absSet
        ? daysCurrent.filter(d => absSet.has(ctx.getDateKey(d))).length
        : 0;
    const absenceDaysNext = absSet
        ? daysNext.filter(d => absSet.has(ctx.getDateKey(d))).length
        : 0;

    const remainingHardCurrent = Math.max(0, HARD_MAX_HOURS - priorHours);
    const workableDaysCurrent = Math.max(0, daysCurrent.length - absenceDaysCurrent);
    const capacityCurrent = Math.ceil(workableDaysCurrent * workRatio) * avgShiftHours;
    const availableCurrentCycle = Math.max(0, Math.min(remainingHardCurrent, capacityCurrent));

    const workableDaysNext = Math.max(0, daysNext.length - absenceDaysNext);
    const capacityNext = Math.ceil(workableDaysNext * workRatio) * avgShiftHours;
    const availableNextCycle = Math.max(0, Math.min(HARD_MAX_HOURS, capacityNext));

    return availableCurrentCycle + availableNextCycle;
}

/** Peor día de cobertura simultánea con esquemas mixtos por guardia. */
export function bandMinConcurrentMixed(
    empIds: string[],
    clByEmp: Record<string, number>,
    cycleLenByEmp: Record<string, number>,
    offsetByEmp: Record<string, number>,
    monthDays = 30,
): number {
    let minW = 99;
    for (let d = 0; d < monthDays; d++) {
        let w = 0;
        for (const id of empIds) {
            const L = cycleLenByEmp[id] ?? 8;
            const cL = clByEmp[id] ?? 6;
            const o = offsetByEmp[id] ?? 0;
            if ((d + o) % L < cL) w++;
        }
        minW = Math.min(minW, w);
    }
    return minW;
}

function provisionalOffsets(
    empIds: string[],
    primaryByEmp: Record<string, string>,
    staggerByEmp: Record<string, number>,
    clByEmp: Record<string, number>,
    cycleLenByEmp: Record<string, number>,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const empId of empIds) {
        const band = String(primaryByEmp[empId] || 'M').toUpperCase();
        const eCycleLen = cycleLenByEmp[empId] ?? 8;
        const staggerIdx = staggerByEmp[empId] ?? 0;
        const bandOff = (FIXED_BAND_OFFSET[band] ?? 0) % eCycleLen;
        out[empId] = (bandOff + staggerIdx) % eCycleLen;
    }
    return out;
}

function mapsFromSchemes(schemeByEmp: Record<string, FixedBandSchemeKey>): {
    clByEmp: Record<string, number>;
    cycleLenByEmp: Record<string, number>;
} {
    const clByEmp: Record<string, number> = {};
    const cycleLenByEmp: Record<string, number> = {};
    for (const [id, key] of Object.entries(schemeByEmp)) {
        const [cL, cF] = schemeToCycle(key);
        clByEmp[id] = cL;
        cycleLenByEmp[id] = cL + cF;
    }
    return { clByEmp, cycleLenByEmp };
}

/**
 * Esquema por guardia.
 * Normal (6+2): todos homogéneos en 6+2 — sin mezclar 5+1/6+1.
 * Apretar/ajustar: baseline por pico + escala 6+2→6+1→5+1 si falta horas vendidas.
 */
export function assignFixedBandSchemes(
    ctx: V2EngineContext,
    empIds: string[],
    primaryByEmp: Record<string, string>,
    staggerByEmp: Record<string, number>,
    peak: Record<string, number>,
    ringCodes: string[],
): {
    clByEmp: Record<string, number>;
    cycleLenByEmp: Record<string, number>;
    schemeByEmp: Record<string, FixedBandSchemeKey>;
    flexSixOne: string[];
    flexFiveOne: string[];
} {
    const intensive = isFixedBandIntensiveMode(ctx);
    const userDefault = userPreferredScheme(ctx.autoCycles);
    const schemeByEmp: Record<string, FixedBandSchemeKey> = {};

    for (const band of ringCodes) {
        const ids = empIds.filter(id => primaryByEmp[id] === band);
        if (!intensive) {
            for (const id of ids) schemeByEmp[id] = userDefault;
            continue;
        }
        const P = peak[band] || 1;
        const [cL, cF] = pickCycleForBand(ids.length, P);
        const baseline = cycleToSchemeKey(cL, cF);
        const baseIdx = SCHEME_INTENSITY_ORDER.indexOf(baseline);
        const defaultIdx = SCHEME_INTENSITY_ORDER.indexOf(userDefault);
        const startScheme = defaultIdx >= baseIdx ? userDefault : baseline;
        for (const id of ids) schemeByEmp[id] = startScheme;
    }

    let { clByEmp, cycleLenByEmp } = mapsFromSchemes(schemeByEmp);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);

    const totalOffer = () => empIds.reduce(
        (s, id) => s + estimateEmpBillableHours(ctx, id, clByEmp[id] ?? 6, (cycleLenByEmp[id] ?? 8) - (clByEmp[id] ?? 6)),
        0,
    );

    const bandMeetsPeak = (band: string, trial: Record<string, FixedBandSchemeKey>) => {
        const ids = empIds.filter(id => primaryByEmp[id] === band);
        const { clByEmp: tCl, cycleLenByEmp: tLen } = mapsFromSchemes(
            Object.fromEntries(ids.map(id => [id, trial[id]])) as Record<string, FixedBandSchemeKey>,
        );
        const offsets = provisionalOffsets(ids, primaryByEmp, staggerByEmp, tCl, tLen);
        const P = peak[band] || 1;
        return bandMinConcurrentMixed(ids, tCl, tLen, offsets) >= P;
    };

    while (intensive && slaTarget > 0 && totalOffer() < slaTarget - 0.5) {
        let bestEmp: string | null = null;
        let bestNext: FixedBandSchemeKey | null = null;
        let bestGain = 0;

        for (const empId of empIds) {
            const cur = schemeByEmp[empId];
            const next = nextIntensiveScheme(cur);
            if (!next) continue;

            const [nCL, nCF] = schemeToCycle(next);
            const [cCL, cCF] = schemeToCycle(cur);
            const gain = estimateEmpBillableHours(ctx, empId, nCL, nCF)
                - estimateEmpBillableHours(ctx, empId, cCL, cCF);
            if (gain <= 0) continue;

            const trial = { ...schemeByEmp, [empId]: next };
            const band = primaryByEmp[empId];
            if (!bandMeetsPeak(band, trial)) continue;

            if (gain > bestGain) {
                bestGain = gain;
                bestEmp = empId;
                bestNext = next;
            }
        }

        if (!bestEmp || !bestNext) break;
        schemeByEmp[bestEmp] = bestNext;
        ({ clByEmp, cycleLenByEmp } = mapsFromSchemes(schemeByEmp));
    }

    const flexSixOne = empIds.filter(id => schemeByEmp[id] === '6+1');
    const flexFiveOne = empIds.filter(id => schemeByEmp[id] === '5+1');

    return { clByEmp, cycleLenByEmp, schemeByEmp, flexSixOne, flexFiveOne };
}

/** Mínimo guardias disponibles simultáneamente (peor día) con offsets 0..L-1 óptimos. */
export function maxMinConcurrent(cL: number, cF: number, n: number): number {
    const L = cL + cF;
    function minForOffsets(offs: number[]): number {
        let m = 99;
        for (let d = 0; d < 30; d++) {
            let w = 0;
            for (const o of offs) if ((d + o) % L < cL) w++;
            m = Math.min(m, w);
        }
        return m;
    }
    let best = 0;
    const go = (i: number, picked: number[]) => {
        if (picked.length === n) { best = Math.max(best, minForOffsets(picked)); return; }
        for (let j = i; j < L; j++) go(j + 1, [...picked, j]);
    };
    go(0, []);
    return best;
}

/** Menor n con ciclo dado que cubre pico P en el peor día. */
export function minHeadcountForPeak(cL: number, cF: number, peak: number): number {
    for (let n = peak; n <= peak + 8; n++) {
        if (maxMinConcurrent(cL, cF, n) >= peak) return n;
    }
    return peak + 8;
}

/** Mejor ciclo para `count` guardias cubriendo pico `peak`. */
export function pickCycleForBand(count: number, peak: number): [number, number] {
    const order: Array<[number, number]> = [
        CYCLE_MAP['6+2'],
        CYCLE_MAP['5+1'],
        CYCLE_MAP['6+1'],
    ];
    for (const [cL, cF] of order) {
        if (count >= minHeadcountForPeak(cL, cF, peak) && maxMinConcurrent(cL, cF, count) >= peak) {
            return [cL, cF];
        }
    }
    return CYCLE_MAP['5+1'];
}

/** Reparto equilibrado de guardias por banda (M/T/N) sumando n total. */
export function splitHeadcountAcrossBands(n: number, bandCodes: string[]): Record<string, number> {
    const k = bandCodes.length;
    const out: Record<string, number> = {};
    bandCodes.forEach((b, i) => {
        out[b] = Math.floor(n / k) + (i < n % k ? 1 : 0);
    });
    return out;
}

/** Escalonado global por banda — francos no alineados dentro de M/T/N. */
export function computeFixedBandGlobalStagger(
    employees: Array<{ id: string }>,
    empPrimaryShift: Record<string, string | null>,
): Record<string, number> {
    const byBand: Record<string, string[]> = {};
    for (const e of employees) {
        const b = String(empPrimaryShift[e.id] || 'M').toUpperCase();
        if (!byBand[b]) byBand[b] = [];
        byBand[b].push(e.id);
    }
    const out: Record<string, number> = {};
    for (const ids of Object.values(byBand)) {
        ids.forEach((id, i) => { out[id] = i; });
    }
    return out;
}

/** Pico de slots simultáneos por banda (suma qty de puestos 24hs). */
export function peakPerBandFromCtx(ctx: V2EngineContext): Record<string, number> {
    const peak: Record<string, number> = {};
    for (const pos of ctx.positions) {
        const cov = String(pos.coverageType || '').toLowerCase();
        if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
        const sampleDay = ctx.daysInMonth.find(d => positionIsActiveOn(pos, ctx.getDayLetter(ctx.getDateKey(d))));
        const sl = sampleDay ? ctx.getDayLetter(ctx.getDateKey(sampleDay)) : 'L';
        const codes = effectiveShiftsForPositionDay(pos, sl, ctx.autoCycles)
            .map(s => String(s.code || '').toUpperCase()).filter(Boolean);
        const qty = Math.max(1, Number(pos.qty) || 1);
        for (const c of codes) {
            if (c === 'D12' || c === 'N12') continue;
            peak[c] = (peak[c] || 0) + qty;
        }
    }
    return peak;
}

/** Plan bandas fijas: primary shift + ciclo por guardia. */
export function buildFixedBandPlan(ctx: V2EngineContext, empIds24: string[]): {
    primaryByEmp: Record<string, string>;
    staggerByEmp: Record<string, number>;
    clByEmp: Record<string, number>;
    cycleLenByEmp: Record<string, number>;
    schemeByEmp: Record<string, FixedBandSchemeKey>;
    flexSixOne: string[];
    flexFiveOne: string[];
    bandCounts: Record<string, number>;
} {
    const ringCodes = (() => {
        for (const pos of ctx.positions) {
            const cov = String(pos.coverageType || '').toLowerCase();
            if (cov !== '24hs' && cov !== '24' && cov !== '24h') continue;
            const sampleDay = ctx.daysInMonth.find(d => positionIsActiveOn(pos, ctx.getDayLetter(ctx.getDateKey(d))));
            const sl = sampleDay ? ctx.getDayLetter(ctx.getDateKey(sampleDay)) : 'L';
            const codes = effectiveShiftsForPositionDay(pos, sl, ctx.autoCycles)
                .map(s => String(s.code || '').toUpperCase()).filter(c => c !== 'D12' && c !== 'N12');
            if (codes.length >= 2) return codes;
        }
        return ['M', 'T', 'N'];
    })();

    const peak = peakPerBandFromCtx(ctx);
    const n = empIds24.length;
    const bandCounts: Record<string, number> = {};
    const maxP = Math.max(1, ...ringCodes.map(b => peak[b] || 1));

    if (ringCodes.length === 3 && n >= 15) {
        const need62 = minHeadcountForPeak(6, 2, maxP);
        const need51 = minHeadcountForPeak(5, 1, maxP);
        const intensive = isFixedBandIntensiveMode(ctx);
        if (intensive && need62 + 2 * need51 <= n) {
            bandCounts[ringCodes[0]] = need62;
            bandCounts[ringCodes[1]] = need51;
            bandCounts[ringCodes[2]] = n - need62 - need51;
        } else if (!intensive && need62 + 2 * need51 <= n) {
            // Normal 6+2 homogéneo: 6+5+5 (16 guardias; T/N con 5 en 6+2 al límite de pico)
            bandCounts[ringCodes[0]] = need62;
            bandCounts[ringCodes[1]] = need51;
            bandCounts[ringCodes[2]] = n - need62 - need51;
        } else if (need62 * 2 <= n) {
            bandCounts[ringCodes[0]] = need62;
            bandCounts[ringCodes[1]] = need51;
            bandCounts[ringCodes[2]] = n - need62 - need51;
        } else {
            Object.assign(bandCounts, splitHeadcountAcrossBands(n, ringCodes));
        }
    } else {
        Object.assign(bandCounts, splitHeadcountAcrossBands(n, ringCodes));
    }

    const primaryByEmp: Record<string, string> = {};
    let ci = 0;
    let left = bandCounts[ringCodes[0]] || 0;
    empIds24.forEach(empId => {
        while (left <= 0 && ci < ringCodes.length - 1) { ci++; left = bandCounts[ringCodes[ci]] || 0; }
        primaryByEmp[empId] = ringCodes[ci];
        left--;
    });

    const empPrimaryShift: Record<string, string | null> = {};
    for (const [id, b] of Object.entries(primaryByEmp)) empPrimaryShift[id] = b;
    const staggerByEmp = computeFixedBandGlobalStagger(
        empIds24.map(id => ({ id })),
        empPrimaryShift,
    );

    const {
        clByEmp,
        cycleLenByEmp,
        schemeByEmp,
        flexSixOne,
        flexFiveOne,
    } = assignFixedBandSchemes(ctx, empIds24, primaryByEmp, staggerByEmp, peak, ringCodes);

    return {
        primaryByEmp,
        staggerByEmp,
        clByEmp,
        cycleLenByEmp,
        schemeByEmp,
        flexSixOne,
        flexFiveOne,
        bandCounts,
    };
}

/** Offsets de franco por guardia (bandas fijas). */
export function assignFixedBandOffsets(
    empIds: string[],
    empPrimaryShift: Record<string, string | null>,
    staggerByEmp: Record<string, number>,
    clByEmp: Record<string, number>,
    cycleLenByEmp: Record<string, number>,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const empId of empIds) {
        const band = String(empPrimaryShift[empId] || 'M').toUpperCase();
        const eCL = clByEmp[empId] ?? 6;
        const eCycleLen = cycleLenByEmp[empId] ?? 8;
        const staggerIdx = staggerByEmp[empId] ?? 0;
        const bandOff = (FIXED_BAND_OFFSET[band] ?? 0) % eCycleLen;
        out[empId] = (bandOff + staggerIdx) % eCycleLen;
    }
    return out;
}

/**
 * Bandas fijas — modo apretar/ajustar: banca en RET y máx. 2 F seguidos.
 * Modo normal 6+2: no convierte banca a RET (como mucho retDesignateSet en el fallback).
 */
export function enforceFixedBandFrancoRetCap(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cycleWorkDays: Record<string, Set<string>>,
): void {
    if (ctx.rotateShifts !== false || !isFixedBandIntensiveMode(ctx)) return;
    const dayKeys = ctx.daysInMonth.map(d => ctx.getDateKey(d));

    for (const emp of ctx.employees) {
        let consecF = 0;
        for (const dateStr of dayKeys) {
            const a = assignments.find(x => x.empId === emp.id && x.dateStr === dateStr);
            if (!a) continue;
            const code = String(a.code || '').toUpperCase();
            if (code !== 'F' || (a.hours ?? 0) > 0) {
                consecF = 0;
                continue;
            }

            const isWorkDay = cycleWorkDays[emp.id]?.has(dateStr) ?? false;
            const benchOnWorkDay = isWorkDay && !a.positionName;

            if (benchOnWorkDay || consecF >= 2) {
                a.code = 'RET';
                a.name = 'Retén';
                a.hours = 0;
                a.startTime = '00:00';
                a.isFranco = false;
                a.isReten = true;
                a.positionName = '';
                consecF = 0;
            } else {
                consecF++;
            }
        }
    }
}

function scheduleFairnessPenalty(result: V2GenerateResult): number {
    const hrs = Object.values(result.stats.employeeMonthlyHours || {});
    if (hrs.length === 0) return 0;
    const mean = hrs.reduce((s, h) => s + h, 0) / hrs.length;
    const variance = hrs.reduce((s, h) => s + (h - mean) ** 2, 0) / hrs.length;
    let maxConsecF = 0;
    for (const empId of Object.keys(result.stats.employeeMonthlyHours || {})) {
        const days = result.assignments
            .filter(a => a.empId === empId)
            .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        let streak = 0;
        for (const a of days) {
            if (String(a.code || '').toUpperCase() === 'F') {
                streak++;
                maxConsecF = Math.max(maxConsecF, streak);
            } else streak = 0;
        }
    }
    return variance / 8 + Math.max(0, maxConsecF - 2) * 50;
}

export function generateScheduleFixedBand(ctx: V2EngineContext): V2GenerateResult {
    if (isFullCustomObjectivePool(ctx.positions)) {
        return generateScheduleV2({ ...ctx, rotateShifts: false });
    }
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles);
    const cycleLen = Math.max(1, cL + cF);

    let best: V2GenerateResult | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let phase = 0; phase < cycleLen; phase++) {
        const result = generateScheduleV2({
            ...ctx,
            rotateShifts: false,
            fixedBandOffsetPhase: phase,
        });

        const uncovered = result.stats.uncoveredSlots ?? 0;
        const deficit = result.stats.slaDeficitRemaining ?? 0;
        const fairness = scheduleFairnessPenalty(result);
        const score = uncovered * 1000 + deficit * 10 + fairness;

        if (result.stats.slaHoursClosed) {
            if (score < bestScore) { bestScore = score; best = result; }
            continue;
        }
        if (score < bestScore) { bestScore = score; best = result; }
        if (uncovered === 0 && deficit <= 0.5) return result;
    }

    if (best?.stats.slaHoursClosed) return best;

    return best ?? generateScheduleV2({ ...ctx, rotateShifts: false });
}
