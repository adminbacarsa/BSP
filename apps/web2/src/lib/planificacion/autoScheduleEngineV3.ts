/**
 * Motor de cronograma V3 — "Cerebro COSP"
 *
 * Modelo operativo COSP:
 *  1. Bandas fijas: cada empleado trabaja el mismo turno (M/T/N ó D12/N12) todo el mes.
 *  2. Grupos desfasados: numGroups = cycleLen / cF grupos con offset i × cF garantiza
 *     que exactamente 1 grupo descanse por bloque sin crear huecos de cobertura.
 *  3. FLEX dinámico: empleados sin banda fija cubren la banda con déficit ese día.
 *     En el modelo 6+2 hay 4 grupos (M, T, N, FLEX); en 4+2 hay 3 (D12, N12, FLEX).
 *  4. Continuidad cross-mes: offset = prevWork % cycleLen (ó (cL+prevRest) % cycleLen).
 *  5. Sin segunda pasada: si queda un slot sin cubrir → vacante reportada al supervisor.
 *  6. CCT 422/05: tramos T1 (días 1-cutoff) y T2 (cutoff+1-fin); 200h máx por tramo.
 */

import {
    checkFeasibility,
    pickRepresentativeCycle,
    positionIsActiveOn,
    effectiveShiftsForPositionDay,
    HARD_MAX_HOURS,
    type V2EngineContext,
    type V2Assignment,
    type V2GenerateResult,
    type V2GenerateStats,
    type CapOverflowSlot,
    type V2PositionDef,
    type V2ShiftDef,
} from './autoScheduleEngineV2';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';
import { RET_STANDBY_REFERENCE_HOURS } from './constants';

// ─── Constantes locales ─────────────────────────────────────────────────────

const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET']);

// Ciclos CCT válidos ordenados de MENOR a MAYOR intensidad (más descanso primero).
// El auto-selector elige el primero que provee cobertura teórica ≥ 100%.
// Si ninguno alcanza, se intenta el más intenso disponible (6+1).
const CCT_CYCLES_8H = [
    { cL: 4, cF: 2 },  // 67 % — máximo descanso
    { cL: 5, cF: 2 },  // 71 %
    { cL: 6, cF: 2 },  // 75 % — estándar CCT 422/05
    { cL: 4, cF: 1 },  // 80 %
    { cL: 5, cF: 1 },  // 83 %
    { cL: 6, cF: 1 },  // 86 % — máxima intensidad
] as const;
const SH_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12 };
const SH_START: Record<string, string> = { M: '06:00', T: '14:00', N: '22:00', D12: '07:00', N12: '19:00' };
const SH_END: Record<string, string>   = { M: '14:00', T: '22:00', N: '06:00', D12: '19:00', N12: '07:00' };

// Alias: el operador usa "M" aunque el puesto declare "D12" y viceversa
const SHIFT_ALIAS: Record<string, string[]> = {
    M: ['M', 'D12'], N: ['N', 'N12'], D12: ['D12', 'M'], N12: ['N12', 'N'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Elige el ciclo CCT óptimo para una posición 24/7 de 8 h dado el tamaño del grupo.
 *
 * Lógica: elige el ciclo con MÁS descanso que aún garantiza cobertura teórica ≥ 1.
 *   empCount × cL  ≥  slotsPerDay × cycleLen
 *
 * Si ningún ciclo lo logra (posición subdotada) devuelve el más intenso (6+1)
 * e informa al supervisor vía slots sin cubrir.
 *
 * Para posiciones limitadas (L-V) o 12 h se usa el ciclo del SLA sin alterar.
 */
function autoSelectCycle(
    empCount: number,
    slotsPerDay: number,
    hint: { cL: number; cF: number },
): { cL: number; cF: number } {
    if (empCount <= 0 || slotsPerDay <= 0) return hint;
    for (const c of CCT_CYCLES_8H) {
        if (empCount * c.cL >= slotsPerDay * (c.cL + c.cF)) return c;
    }
    return { cL: 6, cF: 1 };
}

function isNonWork(code: string): boolean {
    return FRANCO_SET.has(String(code ?? '').toUpperCase());
}

function shiftHrs(s: V2ShiftDef, hint?: Record<string, number>): number {
    const h = Number(s.hours);
    if (Number.isFinite(h) && h > 0) return h;
    const parseH = (t: any): number | null => {
        if (!t) return null;
        const m = String(t).match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) + Number(m[2]) / 60;
    };
    const st = parseH(s.startTime), en = parseH(s.endTime);
    if (st !== null && en !== null) {
        let d = en - st;
        if (d <= 0) d += 24;
        if (d > 0 && d <= 24) return d;
    }
    const code = String(s.code ?? '').toUpperCase();
    return hint?.[code] ?? SH_HRS[code] ?? 8;
}

function isoWeekKey(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const ft = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const wn = 1 + Math.round(
        ((t.getTime() - ft.getTime()) / 86400000 - 3 + ((ft.getUTCDay() + 6) % 7)) / 7
    );
    return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function posAllWeek(pos: V2PositionDef): boolean {
    return ['L', 'M', 'X', 'J', 'V', 'S', 'D'].every(l => positionIsActiveOn(pos, l));
}

// ─── Estado de runtime por empleado ──────────────────────────────────────────

interface EmpState {
    monthHours: number;
    cycleCurrentUsed: number;
    cycleNextUsed: number;
    weekHours: Record<string, number>;
    lastShiftCode: string | null;
    assignedDays: Set<string>;
}

// ─── Motor principal ──────────────────────────────────────────────────────────

export function generateScheduleV3(ctx: V2EngineContext): V2GenerateResult {
    const feasibility = checkFeasibility(ctx);
    const { cL, cF } = pickRepresentativeCycle(ctx.autoCycles);
    const cycleLen = cL + cF;
    const cutoff = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay
        : 25;
    const _hint = ctx.codeHoursHint ?? {};

    // ── PASO 1: Matching empleado → puesto ─────────────────────────────────
    //
    // Prioridad: objetivo preferido > bajo ausentismo.
    // Empleados con puesto fijo (defaultPositionByEmp) van ahí siempre.
    // El resto llena puestos por demanda cíclica descendente.

    const feasNeed: Record<string, number> = {};
    feasibility.perPosition.forEach(p => { feasNeed[p.positionName] = p.peopleNeededWithCycle; });

    const scoreOf = (empId: string): number => {
        const e = ctx.employees.find(x => x.id === empId)!;
        const prefer = !!ctx.objectiveId && e.preferredObjectiveId === ctx.objectiveId ? 100 : 0;
        return prefer + (1 - Math.max(0, Math.min(1, e.absenceRate ?? 0))) * 30;
    };
    const sorted = [...ctx.employees].sort((a, b) => scoreOf(b.id) - scoreOf(a.id));

    const positionGroups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { positionGroups[p.positionName] = []; });
    const empAssignedTo: Record<string, string | null> = {};
    const defaultPos = { ...(ctx.defaultPositionByEmp ?? {}) };

    for (const emp of sorted) {
        const fixed = defaultPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        positionGroups[fixed].push(emp.id);
        empAssignedTo[emp.id] = fixed;
    }
    for (const emp of sorted) {
        if (empAssignedTo[emp.id] !== undefined) continue;
        let best: string | null = null;
        let bestGap = -Infinity;
        for (const pos of ctx.positions) {
            const gap = (feasNeed[pos.positionName] ?? 0) - positionGroups[pos.positionName].length;
            if (gap > bestGap) { bestGap = gap; best = pos.positionName; }
        }
        if (best) {
            positionGroups[best].push(emp.id);
            empAssignedTo[emp.id] = best;
        } else {
            empAssignedTo[emp.id] = null;
        }
    }

    // Inferencia de owner virtual: puesto singular (qty=1) con un solo empleado sin defaultPos
    Object.entries(positionGroups).forEach(([posName, ids]) => {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos || Math.max(1, Number(pos.qty) || 1) !== 1 || ids.length !== 1) return;
        const only = ids[0];
        if (!defaultPos[only]) defaultPos[only] = posName;
    });

    // ── PASO 2: Banda fija + offset de ciclo por empleado ──────────────────
    //
    // Modelo de grupos:
    //   numBands = número de bandas activas del puesto (ej. 3 para M/T/N, 2 para D12/N12)
    //   numGroups = numBands + 1  →  1 grupo FLEX que cubre la banda del grupo que descansa
    //
    //   Offsets ideales: grupo i → offset_i = i * cF
    //   Así, en cualquier día, exactamente 1 grupo descansa y los otros cubren su banda.
    //
    //   Continuidad cross-mes (offset desde mes anterior):
    //     prevWork > 0 → offset = prevWork % cycleLen
    //     prevRest > 0 y prevRest < cF → offset = (cL + prevRest) % cycleLen

    // band fija por empleado (null = FLEX)
    const empBand: Record<string, string | null> = {};
    // offset de ciclo por empleado
    const empOffset: Record<string, number> = {};
    // cycleLen y cL específicos (puede diferir en puestos 4+2)
    const empCycleLen: Record<string, number> = {};
    const empCL: Record<string, number> = {};
    // set de empleados FLEX
    const flexSet = new Set<string>();

    for (const [posName, empIds] of Object.entries(positionGroups)) {
        if (empIds.length === 0) continue;
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const limited = !posAllWeek(pos);

        // Bandas activas de muestra
        const sampleDay = ctx.daysInMonth.find(d =>
            positionIsActiveOn(pos, ctx.getDayLetter(ctx.getDateKey(d)))
        );
        const sampleLetter = sampleDay ? ctx.getDayLetter(ctx.getDateKey(sampleDay)) : 'L';
        const bands = effectiveShiftsForPositionDay(pos, sampleLetter, ctx.autoCycles)
            .map(s => String(s.code ?? '').toUpperCase())
            .filter(Boolean);
        const numBands = bands.length;
        const qty = Math.max(1, Number(pos.qty) || 1);

        // Ciclo efectivo:
        //   - L-V: no aplica ciclo rotativo → usa hint SLA
        //   - 12h: siempre 4+2 (CCT estándar para D12/N12)
        //   - 8h 24/7: auto-selección basada en dotación (busca el ciclo con más descanso
        //     que aún garantiza cobertura teórica completa, sin que el usuario tenga
        //     que elegir el esquema manualmente)
        const is12h = numBands > 0 && shiftHrs({ code: bands[0] }, _hint) >= 12;
        const autoC = limited ? { cL, cF }
            : is12h     ? { cL: 4, cF: 2 }
            : autoSelectCycle(empIds.length, qty * numBands, { cL, cF });
        const eCL = autoC.cL;
        const eCF = autoC.cF;
        const eCycleLen = eCL + eCF;

        // Asignación de banda a cada empleado
        // Prioridad: defaultShiftByEmp → luego round-robin hasta qty por banda → FLEX
        const bandFill: Record<string, number> = {};
        bands.forEach(b => { bandFill[b] = 0; });

        // Primera pasada: empleados con banda fija explícita del operador
        empIds.forEach(eid => {
            const fxRaw = (ctx.defaultShiftByEmp?.[eid] ?? '').toUpperCase();
            if (!fxRaw) return;
            const aliases = SHIFT_ALIAS[fxRaw] ?? [fxRaw];
            const resolved = aliases.find(a => bands.includes(a));
            if (resolved && bandFill[resolved] < qty) {
                empBand[eid] = resolved;
                bandFill[resolved]++;
            }
        });

        // Segunda pasada: llenar bandas en orden → resto = FLEX
        let bi = 0;
        empIds.forEach(eid => {
            if (empBand[eid] !== undefined) return;
            while (bi < bands.length && bandFill[bands[bi]] >= qty) bi++;
            if (bi < bands.length) {
                empBand[eid] = bands[bi];
                bandFill[bands[bi]]++;
            } else {
                empBand[eid] = null; // FLEX
                flexSet.add(eid);
            }
        });

        // Para puestos limitados (L-V): offset=0 (trabajan todos los días hábiles)
        if (limited || numBands === 0) {
            empIds.forEach(eid => {
                empOffset[eid] = 0;
                empCycleLen[eid] = eCycleLen;
                empCL[eid] = eCL;
            });
            continue;
        }

        // Función para calcular offset desde historia del mes anterior
        const histOffset = (eid: string): number | null => {
            const tw = ctx.prevMonthTrailingWorkDays?.[eid];
            const tr = ctx.prevMonthTrailingRestDays?.[eid];
            if (tw !== undefined && tw > 0) return tw % eCycleLen;
            if (tr !== undefined && tr > 0 && tr < eCF) return (eCL + tr) % eCycleLen;
            return null;
        };

        // Asignación de offsets con el modelo de grupos desfasados.
        //
        // Restricción clave: en un grupo de N empleados con ciclo de longitud C,
        // el máximo de francos simultáneos es N × cF/C.
        // Para garantizarlo: cada offset puede usarse ≤ ceil(N/C) veces.
        //
        // Bug previo: usedOffsets:Set impedía reusar cualquier offset. Con N > C
        // (ej. 16 empleados, C=8) los últimos empleados acumulaban en offsets 6-7
        // produciendo 5+ francos el primer día del mes.

        const maxPerOffset = Math.ceil(empIds.length / eCycleLen);
        const offsetCounts = new Array<number>(eCycleLen).fill(0);

        // Tracking por-banda: evita que dos empleados de la misma banda compartan offset
        // (lo que causaría Franco simultáneo y gap de cobertura).
        // maxPerBand = ceil(bandCount / cycleLen) — normalmente 1 para bandas pequeñas.
        const bandOffsetCounts = new Map<string | null, number[]>();
        [...bands, null as string | null].forEach(b => {
            bandOffsetCounts.set(b, new Array<number>(eCycleLen).fill(0));
        });

        const pickOffsetForBand = (idealRaw: number, band: string | null): number => {
            const bc = bandOffsetCounts.get(band) ?? bandOffsetCounts.get(null)!;
            const bandCount = empIds.filter(e => empBand[e] === band).length;
            const maxPerBand = Math.max(1, Math.ceil(bandCount / eCycleLen));
            const start = ((idealRaw % eCycleLen) + eCycleLen) % eCycleLen;
            for (let i = 0; i < eCycleLen; i++) {
                const o = (start + i) % eCycleLen;
                if (offsetCounts[o] < maxPerOffset && bc[o] < maxPerBand) return o;
            }
            // Fallback: menor carga global, penalizando solapamiento de banda
            let best = start, minScore = bc[start] * 1000 + offsetCounts[start];
            for (let i = 1; i < eCycleLen; i++) {
                const o = (start + i) % eCycleLen;
                const score = bc[o] * 1000 + offsetCounts[o];
                if (score < minScore) { minScore = score; best = o; }
            }
            return best;
        };

        const assignOffset = (eid: string, band: string | null, idealRaw: number) => {
            const o = pickOffsetForBand(idealRaw, band);
            offsetCounts[o]++;
            (bandOffsetCounts.get(band) ?? bandOffsetCounts.get(null)!)[o]++;
            empOffset[eid] = o;
            empCycleLen[eid] = eCycleLen;
            empCL[eid] = eCL;
        };

        // Pasada única: hist tiene prioridad sobre fórmula ideal, pero dentro de cada
        // banda se aplica el cupo por offset para evitar clustering de Francos.
        //
        // Fórmula ideal: idealOff = (bIdx + si) * eCF % eCycleLen
        //   Con 4 empleados/banda, eCF=2, cycleLen=8:
        //   M → {0,2,4,6},  T → {2,4,6,0},  N → {4,6,0,2},  FLEX → {6,0,2,4}
        //   → distribución uniforme, sin francos simultáneos dentro de la misma banda.
        const bandSubIdx: Record<string, number> = {};
        let flexSubIdx = 0;

        empIds.forEach(eid => {
            const band = empBand[eid];
            const hist = histOffset(eid);
            let idealRaw: number;

            if (hist !== null) {
                // Historia cross-mes: usarla como punto de partida pero respetar cupo de banda
                idealRaw = hist;
            } else if (band !== null) {
                const bIdx = bands.indexOf(band);
                const si = bandSubIdx[band] ?? 0;
                bandSubIdx[band] = si + 1;
                idealRaw = ((bIdx + si) * eCF) % eCycleLen;
            } else {
                idealRaw = ((numBands + flexSubIdx) * eCF) % eCycleLen;
                flexSubIdx++;
            }

            assignOffset(eid, band, idealRaw);
        });
    }

    // Empleados idle (sin puesto): offset propio por historia o índice global
    ctx.employees.forEach((emp, gi) => {
        if (empOffset[emp.id] !== undefined) return;
        const tw = ctx.prevMonthTrailingWorkDays?.[emp.id];
        const tr = ctx.prevMonthTrailingRestDays?.[emp.id];
        if (tw !== undefined && tw > 0) empOffset[emp.id] = tw % cycleLen;
        else if (tr !== undefined && tr > 0 && tr < cF) empOffset[emp.id] = (cL + tr) % cycleLen;
        else empOffset[emp.id] = (gi * cF) % cycleLen;
        empCycleLen[emp.id] = cycleLen;
        empCL[emp.id] = cL;
    });

    // ── PASO 3: Días de trabajo por ciclo ──────────────────────────────────
    //
    // Puestos limitados (L-V, etc.): trabaja en días en que el puesto opera.
    // Puestos 24/7 + idle: fórmula de ciclo desfasado.

    const limitedEmps = new Set<string>(
        ctx.employees
            .filter(emp => {
                const pn = empAssignedTo[emp.id];
                if (!pn) return false;
                const p = ctx.positions.find(x => x.positionName === pn);
                return !!p && !posAllWeek(p);
            })
            .map(e => e.id)
    );

    const cycleWorkDays: Record<string, Set<string>> = {};
    ctx.employees.forEach(emp => {
        const set = new Set<string>();
        const pn = empAssignedTo[emp.id];
        const pos = pn ? ctx.positions.find(p => p.positionName === pn) : null;
        if (pos && !posAllWeek(pos)) {
            ctx.daysInMonth.forEach(d => {
                if (positionIsActiveOn(pos, ctx.getDayLetter(ctx.getDateKey(d))))
                    set.add(ctx.getDateKey(d));
            });
        } else {
            const eCycleLen = empCycleLen[emp.id] ?? cycleLen;
            const eCL = empCL[emp.id] ?? cL;
            const offset = empOffset[emp.id] ?? 0;
            ctx.daysInMonth.forEach((d, di) => {
                if ((di + offset) % eCycleLen < eCL) set.add(ctx.getDateKey(d));
            });
        }
        cycleWorkDays[emp.id] = set;
    });

    // ── PASO 3b: Alinear días de ciclo al tope CCT por tramo ───────────────
    //
    // T1 (días 1–cutoff): tope = floor((200 - priorHours) / hrsPerDay)
    // T2 (cutoff+1–fin):  tope = floor(200 / hrsPerDay)  [ciclo nuevo, arranca en 0]

    ctx.employees.forEach(emp => {
        if (limitedEmps.has(emp.id)) return;
        const band = empBand[emp.id];
        const code = (band ?? '').toUpperCase();
        const hrsPerDay = _hint[code] ?? SH_HRS[code] ?? 8;
        if (hrsPerDay <= 0) return;
        const wdSet = cycleWorkDays[emp.id];
        if (!wdSet || wdSet.size === 0) return;
        const prior = Math.max(0, ctx.empMonthlyInitial[emp.id] ?? 0);
        const wdT1 = [...wdSet].filter(d => parseInt(d.split('-')[2]) <= cutoff).sort();
        const capT1 = Math.floor(Math.max(0, HARD_MAX_HOURS - prior) / hrsPerDay);
        if (wdT1.length > capT1) wdT1.slice(capT1).forEach(d => wdSet.delete(d));
        const wdT2 = [...wdSet].filter(d => parseInt(d.split('-')[2]) > cutoff).sort();
        const capT2 = Math.floor(HARD_MAX_HOURS / hrsPerDay);
        if (wdT2.length > capT2) wdT2.slice(capT2).forEach(d => wdSet.delete(d));
    });

    // ── GENERACIÓN ─────────────────────────────────────────────────────────
    const assignments: V2Assignment[] = [];
    const rt: Record<string, EmpState> = {};
    ctx.employees.forEach(emp => {
        rt[emp.id] = {
            monthHours: 0,
            cycleCurrentUsed: ctx.empMonthlyInitial[emp.id] ?? 0,
            cycleNextUsed: 0,
            weekHours: {},
            lastShiftCode: null,
            assignedDays: new Set(),
        };
    });

    const stats: V2GenerateStats = {
        totalAssignments: 0,
        totalBillableHours: 0,
        targetHours: feasibility.metrics.effectiveTargetHours,
        uncoveredSlots: 0,
        uncoveredSlotsByDay: {},
        excessPositionEmployees: [],
        employeeMonthlyHours: {},
        employeeCycleHours: { current: {}, next: {} },
        employeesOver200: [],
        positionGroups: { ...positionGroups },
        idleEmployeeIds: Object.entries(empAssignedTo)
            .filter(([, v]) => v === null).map(([k]) => k),
        primaryShiftByEmp: {},
        suvicoWeekBillableOver48: [],
    };
    ctx.employees.forEach(e => {
        stats.employeeMonthlyHours[e.id] = 0;
        stats.employeeCycleHours.current[e.id] = ctx.empMonthlyInitial[e.id] ?? 0;
        stats.employeeCycleHours.next[e.id] = 0;
        stats.primaryShiftByEmp![e.id] = empBand[e.id] ?? null;
    });

    // Registrar ausencias primero (bloquean esos días)
    ctx.employees.forEach(emp => {
        const absSet = ctx.absences[emp.id];
        if (!absSet) return;
        absSet.forEach((code, dateStr) => {
            rt[emp.id].assignedDays.add(dateStr);
            assignments.push({
                empId: emp.id, dateStr, positionName: '',
                code, name: code, hours: 0, startTime: '00:00',
            });
        });
    });

    // Config de descanso CCT
    const restBase: AgreementRestConfig = {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
    };
    const getRestCfg = (empId: string): AgreementRestConfig => ({
        ...restBase,
        ...(limitedEmps.has(empId) ? {} : { maxConsecutiveWorkDays: empCL[empId] ?? cL }),
    });
    const getShiftForRest = (eid: string, ds: string): any | null => {
        const absMap = ctx.absences[eid];
        if (absMap?.has(ds)) return { code: absMap.get(ds), hours: 0, startTime: '00:00' };
        const a = assignments.find(x => x.empId === eid && x.dateStr === ds);
        if (!a) return null;
        const c = String(a.code ?? '').toUpperCase();
        const nw = c === 'RET' || isNonWork(c);
        return {
            code: c,
            startTime: a.startTime || (nw ? '00:00' : SH_START[c] ?? '07:00'),
            hours: nw ? 0 : (Number(a.hours) || SH_HRS[c] || 8),
            endTime: a.endTime,
        };
    };
    const passesRest = (empId: string, dateStr: string, code: string, start: string, hrs: number): boolean => {
        if (isNonWork(code)) return true;
        return checkRestBetweenShifts({
            empId, targetDateStr: dateStr,
            proposed: { code, startTime: start, hours: hrs },
            getShift: getShiftForRest,
            cfg: getRestCfg(empId),
        }) === null;
    };

    // CCT 422/05: tope duro 48h/semana — se aplica antes de cualquier writeAssign.
    const passesWeekCap = (empId: string, dateStr: string, hrs: number): boolean => {
        const wk = isoWeekKey(new Date(dateStr));
        const used = rt[empId]?.weekHours[wk] ?? 0;
        return used + hrs <= 48 + 1e-6;
    };

    const capBlockedMap = new Map<string, CapOverflowSlot[]>();
    const capBlockedSeen = new Set<string>();

    const writeAssign = (
        empId: string, dateStr: string, posName: string,
        code: string, name: string, hrs: number, start: string,
        inCurrent: boolean, end?: string,
    ) => {
        const st = rt[empId];
        const wk = isoWeekKey(new Date(dateStr));
        st.weekHours[wk] = (st.weekHours[wk] ?? 0) + hrs;
        if (inCurrent) {
            st.cycleCurrentUsed += hrs;
            stats.employeeCycleHours.current[empId] = st.cycleCurrentUsed;
        } else {
            st.cycleNextUsed += hrs;
            stats.employeeCycleHours.next[empId] = st.cycleNextUsed;
        }
        st.monthHours += hrs;
        stats.employeeMonthlyHours[empId] = st.monthHours;
        st.lastShiftCode = code;
        st.assignedDays.add(dateStr);
        const a: V2Assignment = { empId, dateStr, positionName: posName, code, name, hours: hrs, startTime: start };
        if (end) a.endTime = end;
        assignments.push(a);
        stats.totalAssignments++;
        stats.totalBillableHours += hrs;
    };

    // Pool de flotantes empresa (sin objetivo asignado): un solo slot por día por empleado.
    const retPool = ctx.globalRetPool ?? [];
    const retPoolUsedDays = new Map<string, Set<string>>();

    // ── Loop principal: día × puesto ─────────────────────────────────────────
    //
    // Tres fases por día × puesto:
    //   Fase 1: asignar regulares en TODAS las bandas.
    //   Fase 2: asignar FLEX a las bandas con déficit, ordenadas de mayor a menor déficit.
    //   Fase 3: flotantes de la empresa (globalRetPool) para slots aún sin cubrir.
    //
    // Así los FLEX no se consumen todos en la primera banda cuando hay varias con faltante.

    for (const day of ctx.daysInMonth) {
        const dateStr = ctx.getDateKey(day);
        const dayLetter = ctx.getDayLetter(dateStr);
        const inCurrent = day.getDate() <= cutoff;

        for (const pos of ctx.positions) {
            if (!positionIsActiveOn(pos, dayLetter)) continue;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const dayBands = effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles);
            const group = positionGroups[pos.positionName] ?? [];

            // Cobertura acumulada por banda (se llena en fase 1, se completa en fase 2)
            const coveredByBand: Record<string, number> = {};
            dayBands.forEach(sh => {
                coveredByBand[String(sh.code ?? '').toUpperCase()] = 0;
            });

            // ── Fase 1: Regulares en todas las bandas ────────────────────────
            for (const sh of dayBands) {
                const sCode = String(sh.code ?? '').toUpperCase();
                const sHrs = shiftHrs(sh, _hint);
                const sStart = sh.startTime || SH_START[sCode] || '07:00';
                const sEnd = sh.endTime || SH_END[sCode] || undefined;
                const sName = sh.name || sCode;

                const regular = group.filter(eid => {
                    if (rt[eid].assignedDays.has(dateStr)) return false;
                    if (ctx.absences[eid]?.has(dateStr)) return false;
                    if (!cycleWorkDays[eid]?.has(dateStr)) return false;
                    return empBand[eid] === sCode;
                });

                for (const empId of regular) {
                    if (coveredByBand[sCode] >= qty) break;
                    const st = rt[empId];
                    const used = limitedEmps.has(empId)
                        ? st.cycleCurrentUsed + st.cycleNextUsed
                        : (inCurrent ? st.cycleCurrentUsed : st.cycleNextUsed);
                    if (used + sHrs > HARD_MAX_HOURS) {
                        const sk = `${empId}||${dateStr}||${sCode}`;
                        if (!capBlockedSeen.has(sk) && passesRest(empId, dateStr, sCode, sStart, sHrs)) {
                            capBlockedSeen.add(sk);
                            const ck = `${pos.positionName}||${dateStr}||${sCode}`;
                            if (!capBlockedMap.has(ck)) capBlockedMap.set(ck, []);
                            capBlockedMap.get(ck)!.push({
                                empId, dateStr, positionName: pos.positionName,
                                code: sCode, name: sName, hours: sHrs, startTime: sStart,
                                ...(sEnd ? { endTime: sEnd } : {}),
                            });
                        }
                        continue;
                    }
                    if (!passesRest(empId, dateStr, sCode, sStart, sHrs)) continue;
                    if (!passesWeekCap(empId, dateStr, sHrs)) continue;
                    writeAssign(empId, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrent, sEnd);
                    coveredByBand[sCode]++;
                }
            }

            // ── Fase 2: FLEX a las bandas con déficit, orden de mayor déficit ──
            //
            // Ordenar bandas por cobertura ascendente = déficit descendente.
            // Así el primer FLEX disponible va a la banda más crítica.
            const bandsWithDeficit = dayBands
                .map(sh => ({ sh, sCode: String(sh.code ?? '').toUpperCase() }))
                .filter(({ sCode }) => coveredByBand[sCode] < qty)
                .sort((a, b) => coveredByBand[a.sCode] - coveredByBand[b.sCode]);

            for (const { sh, sCode } of bandsWithDeficit) {
                const sHrs = shiftHrs(sh, _hint);
                const sStart = sh.startTime || SH_START[sCode] || '07:00';
                const sEnd = sh.endTime || SH_END[sCode] || undefined;
                const sName = sh.name || sCode;

                const flex = group.filter(eid => {
                    if (!flexSet.has(eid)) return false;
                    if (rt[eid].assignedDays.has(dateStr)) return false;
                    if (ctx.absences[eid]?.has(dateStr)) return false;
                    return cycleWorkDays[eid]?.has(dateStr);
                });

                for (const empId of flex) {
                    if (coveredByBand[sCode] >= qty) break;
                    const st = rt[empId];
                    const used = limitedEmps.has(empId)
                        ? st.cycleCurrentUsed + st.cycleNextUsed
                        : (inCurrent ? st.cycleCurrentUsed : st.cycleNextUsed);
                    if (used + sHrs > HARD_MAX_HOURS) continue;
                    if (!passesRest(empId, dateStr, sCode, sStart, sHrs)) continue;
                    if (!passesWeekCap(empId, dateStr, sHrs)) continue;
                    writeAssign(empId, dateStr, pos.positionName, sCode, sName, sHrs, sStart, inCurrent, sEnd);
                    coveredByBand[sCode]++;
                }
            }

            // ── Fase 3: Flotantes empresa (globalRetPool) ───────────────────
            //
            // Último recurso: empleados de la empresa sin objetivo asignado en el
            // período. Se los convoca como RET ad-hoc; no se les aplica cap CCT.
            // Un flotante cubre un solo slot por día en este objetivo.
            if (retPool.length > 0) {
                const stillShort = bandsWithDeficit.filter(({ sCode }) => coveredByBand[sCode] < qty);
                for (const { sh, sCode } of stillShort) {
                    if (coveredByBand[sCode] >= qty) continue;
                    const sHrs = shiftHrs(sh, _hint);
                    const sStart = sh.startTime || SH_START[sCode] || '07:00';
                    const sEnd = sh.endTime || SH_END[sCode] || undefined;
                    const sName = sh.name || sCode;

                    for (const retEmp of retPool) {
                        if (coveredByBand[sCode] >= qty) break;
                        if (retPoolUsedDays.get(retEmp.id)?.has(dateStr)) continue;
                        if (!retPoolUsedDays.has(retEmp.id)) retPoolUsedDays.set(retEmp.id, new Set());
                        retPoolUsedDays.get(retEmp.id)!.add(dateStr);
                        assignments.push({
                            empId: retEmp.id,
                            dateStr,
                            positionName: pos.positionName,
                            code: sCode,
                            name: sName,
                            hours: sHrs,
                            startTime: sStart,
                            ...(sEnd ? { endTime: sEnd } : {}),
                        });
                        stats.totalAssignments++;
                        stats.totalBillableHours += sHrs;
                        coveredByBand[sCode]++;
                    }
                }
            }

            // Registrar slots sin cubrir tras las tres fases
            for (const sh of dayBands) {
                const sCode = String(sh.code ?? '').toUpperCase();
                if (coveredByBand[sCode] < qty) {
                    const missing = qty - coveredByBand[sCode];
                    stats.uncoveredSlots = (stats.uncoveredSlots ?? 0) + missing;
                    if (!stats.uncoveredSlotsByDay![dateStr]) stats.uncoveredSlotsByDay![dateStr] = [];
                    stats.uncoveredSlotsByDay![dateStr].push({
                        positionName: pos.positionName, code: sCode, missing,
                    });
                }
            }
        }
    }

    // ── CAP OVERFLOW: slots bloqueados por 200h que quedaron sin cubrir ────
    const capOverflowSlots: CapOverflowSlot[] = [];
    const seenOverflow = new Set<string>();
    capBlockedMap.forEach((blocked, key) => {
        const [posName, dateStr, code] = key.split('||');
        const gap = stats.uncoveredSlotsByDay![dateStr]
            ?.find(g => g.positionName === posName && g.code === code);
        if (!gap) return;
        let added = 0;
        for (const entry of blocked) {
            if (added >= gap.missing) break;
            const k = `${entry.empId}||${entry.dateStr}`;
            if (seenOverflow.has(k)) continue;
            seenOverflow.add(k);
            capOverflowSlots.push(entry);
            added++;
        }
    });

    // ── Días sobrantes: rescate de cobertura + F o RET ────────────────────
    //
    // - FLEX en día de trabajo con slots sin cubrir → intenta cubrir antes de asignar RET
    // - Día de ciclo-trabajo sin turno → RET (stand-by)
    // - Día de ciclo-franco, o empleado sin puesto → F
    // - Excepción 6+1: tras noche, el único franco da ~32h < 35h mínimo CCT → forzar F extra

    for (const emp of ctx.employees) {
        const st = rt[emp.id];
        const ownerPos = defaultPos[emp.id]
            ? ctx.positions.find(p => p.positionName === defaultPos[emp.id])
            : null;
        for (const day of ctx.daysInMonth) {
            const dateStr = ctx.getDateKey(day);
            if (st.assignedDays.has(dateStr)) continue;
            const dayLetter = ctx.getDayLetter(dateStr);
            const ownerInactive = !!ownerPos && !positionIsActiveOn(ownerPos, dayLetter);
            const isWorkDay = !ownerInactive && cycleWorkDays[emp.id]?.has(dateStr);
            const lastCode = (st.lastShiftCode ?? '').toUpperCase();
            const shortCyclePostNight = cF === 1 && (lastCode === 'N' || lastCode === 'N12');
            const inCurrent = day.getDate() <= cutoff;

            // Rescate: si hay slots sin cubrir, intentar asignar antes de dar RET.
            // FLEX puede cubrir cualquier banda; regulares solo su propia banda.
            if (isWorkDay && !shortCyclePostNight) {
                const dayGaps = stats.uncoveredSlotsByDay![dateStr];
                if (dayGaps && dayGaps.length > 0) {
                    let rescued = false;
                    for (const gap of dayGaps) {
                        if (gap.missing <= 0) continue;
                        // Regulares solo rescatan su propia banda; FLEX puede cruzar bandas
                        if (!flexSet.has(emp.id) && empBand[emp.id] !== null && gap.code !== empBand[emp.id]) continue;
                        const gapPos = ctx.positions.find(p => p.positionName === gap.positionName);
                        if (!gapPos || !positionIsActiveOn(gapPos, dayLetter)) continue;
                        const gapBands = effectiveShiftsForPositionDay(gapPos, dayLetter, ctx.autoCycles);
                        const sh = gapBands.find(s => String(s.code ?? '').toUpperCase() === gap.code);
                        if (!sh) continue;
                        const sHrs = shiftHrs(sh, _hint);
                        const sStart = sh.startTime || SH_START[gap.code] || '07:00';
                        const sEnd = sh.endTime || SH_END[gap.code] || undefined;
                        const used = limitedEmps.has(emp.id)
                            ? st.cycleCurrentUsed + st.cycleNextUsed
                            : (inCurrent ? st.cycleCurrentUsed : st.cycleNextUsed);
                        if (used + sHrs > HARD_MAX_HOURS) continue;
                        if (!passesRest(emp.id, dateStr, gap.code, sStart, sHrs)) continue;
                        if (!passesWeekCap(emp.id, dateStr, sHrs)) continue;
                        writeAssign(emp.id, dateStr, gap.positionName, gap.code,
                            sh.name || gap.code, sHrs, sStart, inCurrent, sEnd);
                        gap.missing--;
                        if (gap.missing <= 0)
                            stats.uncoveredSlots = Math.max(0, (stats.uncoveredSlots ?? 0) - 1);
                        rescued = true;
                        break;
                    }
                    if (rescued) continue;
                }
            }

            const rawBand = limitedEmps.has(emp.id) && empBand[emp.id] ? empBand[emp.id]! : 'RET';
            const bandHrs = isNonWork(rawBand) ? 0 : (SH_HRS[rawBand.toUpperCase()] ?? _hint[rawBand.toUpperCase()] ?? 8);
            const bandStart = SH_START[rawBand.toUpperCase()] ?? '07:00';
            const bandOk = bandHrs === 0
                || (passesWeekCap(emp.id, dateStr, bandHrs)
                    && passesRest(emp.id, dateStr, rawBand, bandStart, bandHrs));
            const bandCode = bandOk ? rawBand : 'RET';
            const fallback = isWorkDay ? (shortCyclePostNight ? 'F' : bandCode) : 'F';
            assignments.push({
                empId: emp.id, dateStr, positionName: '',
                code: fallback,
                name: fallback === 'RET' ? 'Retén' : fallback === 'F' ? 'Franco' : fallback,
                hours: 0, startTime: '00:00',
                isFranco: fallback === 'F',
                isReten: fallback === 'RET',
            });
            st.assignedDays.add(dateStr);
        }
    }

    // ── Stats finales ──────────────────────────────────────────────────────
    for (const emp of ctx.employees) {
        const st = rt[emp.id];
        if (st.cycleCurrentUsed > HARD_MAX_HOURS || st.cycleNextUsed > HARD_MAX_HOURS)
            stats.employeesOver200.push(emp.id);
        const weekCap = limitedEmps.has(emp.id)
            ? SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_LIMITED_POSITION
            : SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT;
        for (const [wk, h] of Object.entries(st.weekHours)) {
            if (h > weekCap + 1e-6)
                stats.suvicoWeekBillableOver48!.push({
                    empId: emp.id, weekKey: wk, hours: Math.round(h * 10) / 10,
                });
        }
    }

    const empRetCount: Record<string, number> = {};
    for (const a of assignments) {
        if (a.code === 'RET') empRetCount[a.empId] = (empRetCount[a.empId] ?? 0) + 1;
    }
    const empRetHours: Record<string, number> = {};
    let totalRet = 0;
    for (const [eid, c] of Object.entries(empRetCount)) {
        empRetHours[eid] = c * RET_STANDBY_REFERENCE_HOURS;
        totalRet += c;
    }
    stats.employeeRetCount = empRetCount;
    stats.employeeRetHoursPotential = empRetHours;
    stats.totalRetCount = totalRet;
    stats.totalRetHoursPotential = totalRet * RET_STANDBY_REFERENCE_HOURS;

    // Cobertura final
    let coverageViolations = 0;
    ctx.daysInMonth.forEach(day => {
        const dateStr = ctx.getDateKey(day);
        const dl = ctx.getDayLetter(dateStr);
        ctx.positions.forEach(pos => {
            if (!positionIsActiveOn(pos, dl)) return;
            const qty = Math.max(1, Number(pos.qty) || 1);
            const dayBands = effectiveShiftsForPositionDay(pos, dl, ctx.autoCycles);
            for (const sh of dayBands) {
                const sCode = String(sh.code ?? '').toUpperCase();
                const actual = assignments.filter(a =>
                    a.dateStr === dateStr &&
                    a.positionName === pos.positionName &&
                    a.code === sCode &&
                    !a.isFranco && !a.isReten
                ).length;
                if (actual < qty) coverageViolations += qty - actual;
            }
        });
    });

    return { feasibility, assignments, stats, capOverflowSlots, coverageViolations };
}
