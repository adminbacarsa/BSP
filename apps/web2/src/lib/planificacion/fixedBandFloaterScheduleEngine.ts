/**
 * Grupos de ciclo 24d (6M+2F+6T+2F+6N+2F) escalonados — cobertura 4×M/T/N/F.
 * Continuidad desde mayo vía trailing + último código del mes anterior.
 */

import {
    positionIsActiveOn,
    type V2Assignment,
    type V2EngineContext,
    type V2GenerateResult,
    type V2PositionDef,
} from './autoScheduleEngineV2';

/** Ciclo 24 días: M→T→N con 2F entre bandas (sin N→M directo). */
export const CYCLE_24_MTN: readonly string[] = [
    ...Array(6).fill('M'),
    ...Array(2).fill('F'),
    ...Array(6).fill('T'),
    ...Array(2).fill('F'),
    ...Array(6).fill('N'),
    ...Array(2).fill('F'),
];

const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

/** Apertura junio (índice 0..23) a partir del cierre de mayo. */
export function inferJune1CycleSlot(
    lastCode: string | undefined,
    trailingWork: number | undefined,
    trailingRest: number | undefined,
    lastWorkBandBeforeRest?: string,
): number | null {
    if (!lastCode) return null;
    const code = lastCode.toUpperCase();
    if (code === 'RET' || code === 'R') {
        // RET es un día de trabajo en el ciclo CCT — usar la banda real del guardia
        const effectiveBand = lastWorkBandBeforeRest?.toUpperCase();
        if (!effectiveBand || !WORK_BANDS.has(effectiveBand)) return null;
        const need = Math.max(1, trailingWork ?? 1);
        for (let june1 = 0; june1 < 24; june1++) {
            const may31 = (june1 - 1 + 24) % 24;
            if (CYCLE_24_MTN[may31] !== effectiveBand) continue;
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== effectiveBand) break;
                ok++;
            }
            if (ok >= need) return june1;
        }
        return null;
    }

    for (let june1 = 0; june1 < 24; june1++) {
        const may31 = (june1 - 1 + 24) % 24;
        if (CYCLE_24_MTN[may31] !== code) continue;

        if (WORK_BANDS.has(code)) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== code) break;
                ok++;
            }
            if (ok >= need) return june1;
        } else if (FRANCO_CODES.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== 'F') break;
                ok++;
            }
            if (ok < need) continue;
            if (!WORK_BANDS.has(CYCLE_24_MTN[june1])) continue;
            const beforeBlock = (may31 - need + 24) % 24;
            const bandBefore = lastWorkBandBeforeRest?.toUpperCase();
            if (bandBefore && CYCLE_24_MTN[beforeBlock] !== bandBefore) continue;
            return june1;
        }
    }
    return null;
}

/** Offsets por defecto (día 1: M/T/N/F) si no hay trailing de mayo. */
const COLD_START_OPENINGS = [4, 10, 16, 22];

function is24hs(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

function shiftMeta(pos: V2PositionDef, code: string): Pick<V2Assignment, 'name' | 'hours' | 'startTime' | 'endTime'> {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : 8;
        return {
            name: sh.name || upper,
            hours,
            startTime: sh.startTime || '07:00',
            ...(sh.endTime ? { endTime: sh.endTime } : {}),
        };
    }
    const defaults: Record<string, { startTime: string; endTime?: string; hours?: number }> = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
        N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
        F: { startTime: '00:00', hours: 0 },
    };
    const d = defaults[upper] ?? defaults.M;
    return {
        name: upper === 'F' ? 'Franco' : upper,
        hours: d.hours ?? 8,
        startTime: d.startTime,
        ...(d.endTime ? { endTime: d.endTime } : {}),
    };
}

function buildPositionGroups(ctx: V2EngineContext): Record<string, string[]> {
    const positionGroups: Record<string, string[]> = {};
    ctx.positions.forEach(p => { positionGroups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};
    const empAssigned = new Set<string>();

    for (const emp of ctx.employees) {
        const fixed = defaultPos[emp.id];
        if (!fixed || positionGroups[fixed] === undefined) continue;
        positionGroups[fixed].push(emp.id);
        empAssigned.add(emp.id);
    }

    const unassigned = ctx.employees.filter(e => !empAssigned.has(e.id));
    const posNames = ctx.positions.map(p => p.positionName);
    unassigned.forEach((emp, i) => {
        positionGroups[posNames[i % posNames.length]].push(emp.id);
    });
    return positionGroups;
}

/**
 * Divide grupos multi-qty en subgrupos independientes de 4-5 (un subgrupo por slot concurrente).
 * Puestos no-24hs se omiten — sus empleados no tienen opening slot.
 */
function buildSubgroupsFor24hs(
    ctx: V2EngineContext,
    positionGroups: Record<string, string[]>,
): string[][] {
    const result: string[][] = [];
    for (const [posName, groupIds] of Object.entries(positionGroups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos || !is24hs(pos)) continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const perSlot = Math.floor(groupIds.length / qty);
        if (perSlot < 1) { result.push([...groupIds]); continue; }
        for (let i = 0; i < qty; i++) {
            const sub = groupIds.slice(i * perSlot, (i + 1) * perSlot);
            if (sub.length > 0) result.push(sub);
        }
    }
    return result;
}

// Cold-starts POR SUBGRUPO con deduplicación POR ZONA de banda.
// El ciclo tiene 3 zonas de trabajo (M=0-5, T=8-13, N=16-21) y 3 de franco (F=6-7/14-15/22-23).
// Si dos empleados del mismo subgrupo tienen offsets en la misma zona, coinciden en Franco
// el mismo día → brecha de cobertura. Se mantiene solo uno por zona.
function resolveOpeningSlotByEmp(ctx: V2EngineContext, subgroups: string[][]): Record<string, number> {
    const out: Record<string, number> = {};

    // Zona de banda del slot (día 1 del mes = di=0)
    const bandZone = (slot: number): 'M' | 'T' | 'N' | 'F' => {
        const s = ((slot % 24) + 24) % 24;
        if (s <= 5) return 'M';
        if (s <= 7) return 'F';
        if (s <= 13) return 'T';
        if (s <= 15) return 'F';
        if (s <= 21) return 'N';
        return 'F';
    };
    // Slot preferido para llenar cada zona sin trailing
    const ZONE_SLOT: Record<string, number> = { M: 4, T: 10, N: 16, F: 22 };

    for (const groupIds of subgroups) {
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        // Paso 1: inferir offsets desde trailing de mayo
        const withTrail: string[] = [];
        const withoutTrail: string[] = [];
        for (const empId of regularIds) {
            const slot = inferJune1CycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            if (slot !== null) { out[empId] = slot; withTrail.push(empId); }
            else withoutTrail.push(empId);
        }

        // Paso 2: deduplicar por ZONA (no solo slot idéntico).
        // Dos empleados en la misma zona del ciclo coinciden en Franco → cobertura rota.
        const usedZones = new Map<string, true>();
        for (const empId of [...withTrail]) {
            const zone = bandZone(out[empId]);
            if (!usedZones.has(zone)) {
                usedZones.set(zone, true);
            } else {
                delete out[empId];
                withoutTrail.push(empId);
            }
        }

        // Paso 3: asignar a los sin-trailing el cold-start de la zona que falta
        const missingZones = (['M', 'T', 'N', 'F'] as const).filter(z => !usedZones.has(z));
        withoutTrail.sort((a, b) => a.localeCompare(b));
        withoutTrail.forEach((empId, i) => {
            const zone = missingZones[i] ?? ((['M', 'T', 'N', 'F'] as const)[i % 4]);
            out[empId] = ZONE_SLOT[zone] ?? COLD_START_OPENINGS[i % 4];
        });

        // Flotantes (índice ≥4): banda da igual, solo necesitan no coincidir en Franco con
        // otro flotante del mismo subgrupo (para que no queden dos RET → F el mismo día)
        for (const empId of floaterIds) {
            const slot = inferJune1CycleSlot(
                ctx.prevMonthLastShiftByEmp?.[empId],
                ctx.prevMonthTrailingWorkDays?.[empId],
                ctx.prevMonthTrailingRestDays?.[empId],
                ctx.prevMonthLastWorkBandBeforeRest?.[empId],
            );
            out[empId] = slot ?? COLD_START_OPENINGS[floaterIds.indexOf(empId) % 4];
        }
    }

    return out;
}

/**
 * true si todos los puestos 24hs operan 7 días y cada slot concurrente tiene 4 ó 5 guardias.
 * qty=1 → 4-5 guardias en total.
 * qty=N → N×4 o N×5 guardias (N subgrupos independientes de 4-5).
 * Puestos no-24hs (L-V, custom) se ignoran — no bloquean el floater.
 */
export function canUseFixedBandFloater(ctx: V2EngineContext, positionGroups?: Record<string, string[]>): boolean {
    const groups = positionGroups ?? buildPositionGroups(ctx);
    let counted24 = 0;
    for (const pos of ctx.positions) {
        if (!is24hs(pos)) continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) return false;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const g = groups[pos.positionName] || [];
        if (g.length === 0) return false;
        if (g.length % qty !== 0) return false;
        const perSlot = g.length / qty;
        if (perSlot !== 4 && perSlot !== 5) return false;
        counted24 += g.length;
    }
    return counted24 > 0;
}

/**
 * Convierte turnos RET en la banda que el empleado ausente habría trabajado.
 * Solo opera sobre RET (ya es "trabajo", solo reetiquetado) — nunca toca F.
 * Los slots que queden sin cubrir los maneja fixScheduleIssues con chequeo de descanso.
 */
function patchRetForAbsences(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    openingSlotByEmp: Record<string, number>,
    subgroups: string[][],
    empToPosition: Record<string, string>,
    employeeMonthlyHours: Record<string, number>,
    employeeCycleHours: { current: Record<string, number>; next: Record<string, number> },
    cutoffDay: number,
): void {
    const aIdx = new Map<string, number>();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));

    // Todos los flotantes (índice >=4 en su subgrupo) para candidatos cross-grupo
    const allFloaterIds = subgroups.flatMap(sub => sub.slice(4));

    for (const groupIds of subgroups) {
        const posName = empToPosition[groupIds[0]] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            const absentRegulars = regularIds.filter(id => ctx.absences[id]?.has(dateStr));
            if (!absentRegulars.length) return;

            for (const absentId of absentRegulars) {
                const opening = openingSlotByEmp[absentId];
                if (opening === undefined) continue;
                const neededBand = CYCLE_24_MTN[(opening + di) % 24] as string;
                if (!WORK_BANDS.has(neededBand)) continue; // habría sido F: sin brecha

                // ¿Otro regular ya cubre esa banda ese día?
                const alreadyCovered = regularIds.some(id => {
                    if (id === absentId || ctx.absences[id]?.has(dateStr)) return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && CYCLE_24_MTN[(op + di) % 24] === neededBand;
                });
                if (alreadyCovered) continue;

                // RET del mismo subgrupo primero, luego de otros subgrupos
                const allRetCandidates = [
                    ...floaterIds.filter(id => !ctx.absences[id]?.has(dateStr)),
                    ...allFloaterIds.filter(id => !floaterIds.includes(id) && !ctx.absences[id]?.has(dateStr)),
                ];

                for (const retId of allRetCandidates) {
                    const ai = aIdx.get(`${retId}__${dateStr}`);
                    if (ai === undefined) continue;
                    if (assignments[ai].code !== 'RET') continue; // ya cubrió otra brecha
                    const meta = shiftMeta(pos, neededBand);
                    assignments[ai] = {
                        empId: retId,
                        dateStr,
                        positionName: posName,
                        code: neededBand,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        ...(meta.endTime ? { endTime: meta.endTime } : {}),
                    };
                    // RET no era facturable → sumar horas completas
                    employeeMonthlyHours[retId] = (employeeMonthlyHours[retId] || 0) + meta.hours;
                    const inCurrent = day.getDate() <= cutoffDay;
                    if (inCurrent) employeeCycleHours.current[retId] = (employeeCycleHours.current[retId] || 0) + meta.hours;
                    else employeeCycleHours.next[retId] = (employeeCycleHours.next[retId] || 0) + meta.hours;
                    break;
                }
            }
        });
    }
}

export function generateFixedBandFloaterSchedule(ctx: V2EngineContext): V2GenerateResult {
    const positionGroups = buildPositionGroups(ctx);
    // Subgrupos independientes por slot concurrente (qty>1 → N subgrupos de 4-5 c/u)
    const subgroups = buildSubgroupsFor24hs(ctx, positionGroups);
    // empToPosition: usado para L-V y patchRetForAbsences
    const empToPosition: Record<string, string> = {};
    for (const [posName, ids] of Object.entries(positionGroups)) {
        ids.forEach(id => { empToPosition[id] = posName; });
    }
    const openingSlotByEmp = resolveOpeningSlotByEmp(ctx, subgroups);
    // empSubgroup: cada guardia apunta a su subgrupo de 4-5 (para isRetFloater correcto)
    const empSubgroup = new Map<string, string[]>();
    subgroups.forEach(sub => sub.forEach(id => empSubgroup.set(id, sub)));

    const primaryShiftByEmp: Record<string, string | null> = {};

    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31
        ? ctx.cctCutoffDay
        : 25;
    const assignments: V2Assignment[] = [];
    const employeeMonthlyHours: Record<string, number> = {};
    const employeeCycleHours = { current: {} as Record<string, number>, next: {} as Record<string, number> };
    ctx.employees.forEach(e => {
        employeeMonthlyHours[e.id] = 0;
        employeeCycleHours.current[e.id] = 0;
        employeeCycleHours.next[e.id] = 0;
    });

    for (const emp of ctx.employees) {
        const opening = openingSlotByEmp[emp.id];

        if (opening === undefined) {
            // Puesto L-V / custom: turno en días activos, Franco en días inactivos
            const posName = empToPosition[emp.id] ?? '';
            const pos = ctx.positions.find(p => p.positionName === posName);
            if (!pos) continue;
            primaryShiftByEmp[emp.id] = null;
            ctx.daysInMonth.forEach(day => {
                const dateStr = ctx.getDateKey(day);
                if (ctx.absences[emp.id]?.has(dateStr)) return;
                const dayLetter = ctx.getDayLetter(dateStr);
                if (positionIsActiveOn(pos, dayLetter)) {
                    const shiftCode = String(pos.shifts?.[0]?.code || 'M').toUpperCase();
                    const meta = shiftMeta(pos, shiftCode);
                    assignments.push({
                        empId: emp.id,
                        dateStr,
                        positionName: posName,
                        code: shiftCode,
                        name: meta.name,
                        hours: meta.hours,
                        startTime: meta.startTime,
                        ...(meta.endTime ? { endTime: meta.endTime } : {}),
                    });
                    employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                    const inCurrent = day.getDate() <= cutoffDay;
                    if (inCurrent) employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
                    else employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
                } else {
                    assignments.push({ empId: emp.id, dateStr, positionName: '', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true });
                }
            });
            continue;
        }

        const posName = empToPosition[emp.id] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;

        // isRetFloater: índice ≥ 4 dentro del subgrupo (no en el grupo completo del puesto)
        const subGroup = empSubgroup.get(emp.id) ?? [];
        const isRetFloater = subGroup.indexOf(emp.id) >= 4;

        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = ctx.getDateKey(day);
            if (ctx.absences[emp.id]?.has(dateStr)) return;
            const dayLetter = ctx.getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter)) return;

            const rawCode = CYCLE_24_MTN[(opening + di) % 24];
            const isExcludedDay = !isRetFloater && WORK_BANDS.has(rawCode) && !!pos.excludedDates?.includes(dateStr);
            const code = isExcludedDay ? 'RET' : (isRetFloater && WORK_BANDS.has(rawCode)) ? 'RET' : rawCode;
            if (di === 0) primaryShiftByEmp[emp.id] = (!isRetFloater && WORK_BANDS.has(rawCode)) ? rawCode : null;

            const meta = shiftMeta(pos, isExcludedDay ? rawCode : code);
            const isFranco = code === 'F';
            const isRet = code === 'RET';
            assignments.push({
                empId: emp.id,
                dateStr,
                positionName: (isFranco || isRet) ? '' : posName,
                code,
                name: meta.name,
                hours: meta.hours,
                startTime: meta.startTime,
                ...(!isRet && meta.endTime ? { endTime: meta.endTime } : {}),
                ...(isFranco ? { isFranco: true } : {}),
            });

            if (BILLABLE.has(code)) {
                employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                const inCurrent = day.getDate() <= cutoffDay;
                if (inCurrent) {
                    employeeCycleHours.current[emp.id] = (employeeCycleHours.current[emp.id] || 0) + meta.hours;
                } else {
                    employeeCycleHours.next[emp.id] = (employeeCycleHours.next[emp.id] || 0) + meta.hours;
                }
            }
        });
    }

    patchRetForAbsences(
        ctx, assignments, openingSlotByEmp, subgroups, empToPosition,
        employeeMonthlyHours, employeeCycleHours, cutoffDay,
    );

    // RET que patchRetForAbsences no convirtió (no había ausente que cubrir):
    // mostrar la banda natural del ciclo → crono limpio sin RETs visibles en planning.
    for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (a.code !== 'RET') continue;
        const opening = openingSlotByEmp[a.empId];
        if (opening === undefined) continue;
        const di = ctx.daysInMonth.findIndex(d => ctx.getDateKey(d) === a.dateStr);
        if (di < 0) continue;
        const naturalCode = CYCLE_24_MTN[(opening + di) % 24] as string;
        if (!WORK_BANDS.has(naturalCode)) continue;
        const posName = empToPosition[a.empId] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos) continue;
        const meta = shiftMeta(pos, naturalCode);
        assignments[i] = {
            empId: a.empId,
            dateStr: a.dateStr,
            positionName: posName,
            code: naturalCode,
            name: meta.name,
            hours: meta.hours,
            startTime: meta.startTime,
            ...(meta.endTime ? { endTime: meta.endTime } : {}),
        };
        employeeMonthlyHours[a.empId] = (employeeMonthlyHours[a.empId] || 0) + meta.hours;
        const day = ctx.daysInMonth[di];
        if (day) {
            const inCurrent = day.getDate() <= cutoffDay;
            if (inCurrent) employeeCycleHours.current[a.empId] = (employeeCycleHours.current[a.empId] || 0) + meta.hours;
            else employeeCycleHours.next[a.empId] = (employeeCycleHours.next[a.empId] || 0) + meta.hours;
        }
    }

    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);

    return {
        assignments,
        capOverflowSlots: [],
        coverageViolations: 0,
        feasibility: null as any,
        stats: {
            totalAssignments: assignments.length,
            totalBillableHours,
            targetHours: slaTarget,
            uncoveredSlots: 0,
            employeeMonthlyHours,
            employeeCycleHours,
            employeesOver200: [],
            positionGroups,
            idleEmployeeIds: ctx.employees.filter(e => openingSlotByEmp[e.id] === undefined).map(e => e.id),
            primaryShiftByEmp,
            slaDeficitRemaining,
            slaHoursClosed: slaDeficitRemaining <= 0.5,
            fixedBandSchemeByEmp: Object.fromEntries(
                ctx.employees.map(e => [e.id, `6+2@${openingSlotByEmp[e.id] ?? '?'}`]),
            ),
        },
    };
}

// Tests unitarios lógicos (sin Firestore)
export function _debugCycleSlots(
    cases: Array<{ last: string; tw?: number; tr?: number; expect: number }>,
): boolean {
    return cases.every(c => inferJune1CycleSlot(c.last, c.tw, c.tr) === c.expect);
}
