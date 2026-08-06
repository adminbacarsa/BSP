import type { ServiceRotation } from '@/services/slaService';
import { isPlanningPositionExcludedOnDate } from '@/lib/slaPlanningMatch';
import {
    getAllDatesInMonth,
    getRoundRobinOffset,
    getWeekStartForDate,
    rotationPeriodApplies,
} from './rotationUtils';
import type { SlaRotationByDate } from './slaContractPlanning';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

type PlannerPositionDef = {
    positionName?: string;
    qty?: number;
    shifts?: Array<{ code?: string; hours?: number; days?: string[]; specificDates?: string[] }>;
    activeDays?: string[];
    coverageType?: string;
    excludedDates?: string[];
};

function isFrancoCode(code: string | undefined): boolean {
    return FRANCO_CODES.has(String(code || '').toUpperCase());
}

function is24hsCoverage(pos: PlannerPositionDef): boolean {
    const t = String(pos.coverageType || '').toLowerCase();
    return t === '24hs' || t === '24' || t === '24h';
}

function positionIsActiveOnPlanner(pos: PlannerPositionDef, dayLetter: string, dateStr?: string): boolean {
    if (dateStr && pos.excludedDates?.includes(dateStr)) return false;
    if (is24hsCoverage(pos)) return true;

    const shifts = pos.shifts || [];
    const specificDateShifts = shifts.filter(
        (s) => !isFrancoCode(s.code) && Array.isArray(s.specificDates) && s.specificDates.length > 0,
    );
    const weekdayShifts = shifts.filter(
        (s) => !isFrancoCode(s.code) && !(Array.isArray(s.specificDates) && s.specificDates.length > 0),
    );

    if (dateStr && specificDateShifts.some((s) => s.specificDates!.includes(dateStr))) {
        return true;
    }
    if (specificDateShifts.length > 0 && weekdayShifts.length === 0) {
        return false;
    }

    if (Array.isArray(pos.activeDays) && pos.activeDays.length > 0 && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    const workingShifts = weekdayShifts;
    const withDays = workingShifts.filter((s) => Array.isArray(s.days) && s.days.length > 0);
    if (withDays.length === 0 || withDays.length < workingShifts.length) return true;
    return withDays.some((s) => s.days!.includes(dayLetter));
}

function dayLetterFromDateStr(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return days[date.getDay()];
}

function isPosActiveOnDay(pos: PlannerPositionDef, dayLetter: string, dateStr?: string): boolean {
    return positionIsActiveOnPlanner(pos, dayLetter, dateStr);
}

function isPosExcludedOnDate(pos: { excludedDates?: unknown }, dateStr: string): boolean {
    return isPlanningPositionExcludedOnDate(pos, dateStr);
}

function findPositionCfg(positionStructure: unknown[] | undefined, positionName: string): unknown | undefined {
    if (!positionStructure?.length || !positionName) return undefined;
    const want = positionName.trim().toLowerCase();
    return positionStructure.find((p: { positionName?: string }) =>
        String(p?.positionName ?? '').trim().toLowerCase() === want,
    );
}

export type RotationMonthCell = {
    empId: string;
    dateStr: string;
    code: string;
    positionName: string;
    hours: number;
    startTime: string;
    isDeleted?: boolean;
    _isAutoRotation?: boolean;
};

/**
 * Misma lógica que la grilla manual (`planificacion/index`): round_robin semanal,
 * cycle_rotation, custom_sequence y períodos estáticos por trigger.
 */
export function applyRotationsForMonth(
    rotations: ServiceRotation[],
    pendingChanges: Record<string, unknown>,
    shiftsMap: Record<string, unknown>,
    year: number,
    month: number,
    positionStructure?: unknown[],
): Record<string, RotationMonthCell> {
    const additions: Record<string, RotationMonthCell> = {};
    const allDates = getAllDatesInMonth(year, month);
    const getPending = (key: string) => pendingChanges[key] as { isDeleted?: boolean; isTemp?: boolean; code?: string } | undefined;
    const getSaved = (key: string) => shiftsMap[key] as { isDeleted?: boolean; code?: string } | undefined;

    for (const rotation of rotations) {
        if (rotation.cycleMode === 'cycle_rotation') {
            const crP = rotation.periods[0];
            if (!crP || !rotation.cycleWorkDays || !rotation.cycleOffDays) continue;
            const crE = crP.entries.filter((e) => e.employeeId && e.shiftCode && e.cycleAnchorDate);
            const crN = crE.length;
            if (crN < 1) continue;
            const cycLen = rotation.cycleWorkDays + rotation.cycleOffDays;
            for (const dateStr of allDates) {
                const dayLetter = dayLetterFromDateStr(dateStr);
                for (let ci = 0; ci < crN; ci++) {
                    const cEmp = crE[ci];
                    const key = `${cEmp.employeeId}_${dateStr}`;
                    const cPend = getPending(key);
                    const ancMs = new Date(cEmp.cycleAnchorDate! + 'T00:00:00').getTime();
                    const dtMs = new Date(dateStr + 'T00:00:00').getTime();
                    const dSince = Math.round((dtMs - ancMs) / 86400000);
                    const cIdx = Math.floor(dSince / cycLen);
                    const pos = ((dSince % cycLen) + cycLen) % cycLen;
                    if (pos >= rotation.cycleWorkDays) {
                        const saved = getSaved(key);
                        if (saved && !saved.isDeleted) continue;
                        if (cPend && !cPend.isDeleted && cPend.isTemp) continue;
                        additions[key] = {
                            empId: cEmp.employeeId!,
                            dateStr,
                            code: 'F',
                            positionName: '',
                            hours: 0,
                            startTime: '00:00',
                            isDeleted: false,
                            _isAutoRotation: true,
                        };
                    } else {
                        if (cPend && !cPend.isDeleted) continue;
                        const saved = getSaved(key);
                        if (saved && !saved.isDeleted) continue;
                        const eIdx = ((ci + cIdx) % crN + crN) % crN;
                        const ent = crE[eIdx];
                        if (positionStructure?.length && ent.positionName) {
                            const pCfg = findPositionCfg(positionStructure, ent.positionName);
                            if (pCfg) {
                                if (!isPosActiveOnDay(pCfg as object, dayLetter, dateStr)) continue;
                                if (isPosExcludedOnDate(pCfg as object, dateStr)) continue;
                            }
                        }
                        const posPS = findPositionCfg(positionStructure, ent.positionName ?? '');
                        const shiftPS = (posPS as { shifts?: { code?: string; hours?: number }[] })?.shifts?.find(
                            (s) => String(s.code || '').toUpperCase() === String(ent.shiftCode || '').toUpperCase(),
                        );
                        const shiftHours = shiftPS && Number(shiftPS.hours) > 0 ? Number(shiftPS.hours) : 8;
                        additions[key] = {
                            empId: cEmp.employeeId!,
                            dateStr,
                            code: ent.shiftCode!,
                            positionName: ent.positionName || '',
                            hours: shiftHours,
                            startTime: '00:00',
                            isDeleted: false,
                            _isAutoRotation: true,
                        };
                    }
                }
            }
            continue;
        }
        if (rotation.cycleMode === 'custom_sequence') {
            const csAnchor = rotation.sequenceAnchorDate;
            if (!csAnchor) continue;
            const csP = rotation.periods[0];
            if (!csP) continue;
            const csEntries = csP.entries.filter((e) => e.employeeId && e.sequence?.length);
            if (!csEntries.length) continue;
            const csAncMs = new Date(csAnchor + 'T00:00:00').getTime();
            for (const dateStr of allDates) {
                const dayLetter = dayLetterFromDateStr(dateStr);
                const dtMs = new Date(dateStr + 'T00:00:00').getTime();
                const daysSince = Math.round((dtMs - csAncMs) / 86400000);
                for (const csEmp of csEntries) {
                    const seq: string[] =
                        csEmp.sequence!.length === 1 && (csEmp.sequence![0] as string).length > 2
                            ? (csEmp.sequence![0] as string).split('').filter((c: string) => /[A-Z]/.test(c))
                            : (csEmp.sequence as string[]);
                    const seqLen = seq.length;
                    const seqPos = ((daysSince % seqLen) + seqLen) % seqLen;
                    const code = (seq[seqPos] as string).toUpperCase();
                    const key = `${csEmp.employeeId}_${dateStr}`;
                    const cPend = getPending(key);
                    if (code === 'F' || code === 'FF' || code === 'FP') {
                        const saved = getSaved(key);
                        if (saved && !saved.isDeleted) continue;
                        if (cPend && !cPend.isDeleted && cPend.isTemp) continue;
                        additions[key] = {
                            empId: csEmp.employeeId!,
                            dateStr,
                            code,
                            positionName: '',
                            hours: 0,
                            startTime: '00:00',
                            isDeleted: false,
                            _isAutoRotation: true,
                        };
                    } else {
                        if (cPend && !cPend.isDeleted) continue;
                        const saved = getSaved(key);
                        if (saved && !saved.isDeleted) continue;
                        if (positionStructure?.length && csEmp.positionName) {
                            const pCfg = findPositionCfg(positionStructure, csEmp.positionName);
                            if (pCfg) {
                                if (!isPosActiveOnDay(pCfg as object, dayLetter, dateStr)) continue;
                                if (isPosExcludedOnDate(pCfg as object, dateStr)) continue;
                            }
                        }
                        const posPS = findPositionCfg(positionStructure, csEmp.positionName ?? '');
                        const shiftPS = (posPS as { shifts?: { code?: string; hours?: number }[] })?.shifts?.find(
                            (s) => String(s.code || '').toUpperCase() === code,
                        );
                        const shiftHours = shiftPS && Number(shiftPS.hours) > 0 ? Number(shiftPS.hours) : 8;
                        additions[key] = {
                            empId: csEmp.employeeId!,
                            dateStr,
                            code,
                            positionName: csEmp.positionName || '',
                            hours: shiftHours,
                            startTime: '00:00',
                            isDeleted: false,
                            _isAutoRotation: true,
                        };
                    }
                }
            }
            continue;
        }
        if (rotation.cycleMode === 'round_robin') {
            const rrP = rotation.periods[0];
            if (rrP && rrP.trigger.type === 'WEEKLY') {
                const rrE = rrP.entries.filter((e) => e.employeeId && e.shiftCode);
                const rrN = rrE.length;
                if (rrN >= 2) {
                    let rrInferredRef: string | undefined = rotation.referenceWeekStart;
                    outer: for (const rrd of allDates) {
                        for (let ri2 = 0; ri2 < rrN; ri2++) {
                            const p2 = getPending(`${rrE[ri2].employeeId}_${rrd}`);
                            if (p2 && !p2.isDeleted && p2.code === rrE[ri2].shiftCode) {
                                rrInferredRef = getWeekStartForDate(rrd, rotation.weekStartDay ?? 1);
                                break outer;
                            }
                        }
                    }
                    const rrGate = rotation.referenceWeekStart
                        ? getWeekStartForDate(rotation.referenceWeekStart, rotation.weekStartDay ?? 1)
                        : null;
                    const rrWeekGroups = new Map<string, string[]>();
                    for (const d of allDates) {
                        const ws = getWeekStartForDate(d, rotation.weekStartDay ?? 1);
                        if (!rrWeekGroups.has(ws)) rrWeekGroups.set(ws, []);
                        rrWeekGroups.get(ws)!.push(d);
                    }
                    const rrWeekSlotMap = new Map<string, Map<number, number>>();
                    for (const [ws, wDates] of rrWeekGroups) {
                        if (rrGate && ws < rrGate) continue;
                        const wOff = getRoundRobinOffset(rotation, wDates[0], rrN, rrInferredRef);
                        if (wOff === null) continue;
                        const empToSlot = new Map<number, number>();
                        const wClaimed = new Set<number>();
                        for (let ri2 = 0; ri2 < rrN; ri2++) {
                            const natS = (ri2 + wOff) % rrN;
                            for (const wd of wDates) {
                                const p = getPending(`${rrE[ri2].employeeId}_${wd}`);
                                if (p && !p.isDeleted) {
                                    const si = rrE.findIndex((e) => e.shiftCode === p.code);
                                    if (si >= 0 && si !== natS && !empToSlot.has(ri2)) {
                                        empToSlot.set(ri2, si);
                                        wClaimed.add(si);
                                        break;
                                    }
                                }
                            }
                        }
                        const wAvail: number[] = [];
                        for (let s = 0; s < rrN; s++) {
                            const si2 = (wOff + s) % rrN;
                            if (!wClaimed.has(si2)) wAvail.push(si2);
                        }
                        let wAIdx = 0;
                        for (let ri2 = 0; ri2 < rrN; ri2++) {
                            if (empToSlot.has(ri2)) continue;
                            const natS2 = (ri2 + wOff) % rrN;
                            if (!wClaimed.has(natS2)) {
                                empToSlot.set(ri2, natS2);
                                wClaimed.add(natS2);
                            } else {
                                while (wAIdx < wAvail.length && wClaimed.has(wAvail[wAIdx])) wAIdx++;
                                if (wAIdx < wAvail.length) {
                                    empToSlot.set(ri2, wAvail[wAIdx]);
                                    wClaimed.add(wAvail[wAIdx]);
                                    wAIdx++;
                                }
                            }
                        }
                        rrWeekSlotMap.set(ws, empToSlot);
                    }
                    for (const dateStr of allDates) {
                        if (rrGate && dateStr < rrGate) continue;
                        const dayLetter = dayLetterFromDateStr(dateStr);
                        const ws2 = getWeekStartForDate(dateStr, rotation.weekStartDay ?? 1);
                        const empToSlot2 = rrWeekSlotMap.get(ws2);
                        if (!empToSlot2) continue;
                        for (let ri = 0; ri < rrN; ri++) {
                            const rrEmp = rrE[ri];
                            const key = `${rrEmp.employeeId}_${dateStr}`;
                            const rrPend = getPending(key);
                            const rrFS = getSaved(key);
                            const rrIsFr = (s: { isDeleted?: boolean; code?: string } | undefined) =>
                                s && !s.isDeleted && FRANCO_CODES.has(String(s.code || '').toUpperCase());
                            if (rrIsFr(rrPend) || (!rrPend && rrIsFr(rrFS))) continue;
                            if (rrPend && !rrPend.isDeleted) continue;
                            if (!rrPend && rrFS && !rrFS.isDeleted) continue;
                            const slotIdx = empToSlot2.get(ri);
                            if (slotIdx === undefined) continue;
                            const rrRot = rrE[slotIdx];
                            if (positionStructure?.length && rrRot.positionName) {
                                const posCfg = findPositionCfg(positionStructure, rrRot.positionName);
                                if (posCfg) {
                                    if (!isPosActiveOnDay(posCfg as object, dayLetter, dateStr)) continue;
                                    if (isPosExcludedOnDate(posCfg as object, dateStr)) continue;
                                }
                            }
                            additions[key] = {
                                empId: rrEmp.employeeId!,
                                dateStr,
                                code: rrRot.shiftCode!,
                                positionName: rrRot.positionName || '',
                                hours: 8,
                                startTime: '00:00',
                                isDeleted: false,
                                _isAutoRotation: true,
                            };
                        }
                    }
                    if (rotation.cycleWorkDays && rotation.cycleOffDays) {
                        const cycLen = rotation.cycleWorkDays + rotation.cycleOffDays;
                        for (let ci = 0; ci < rrN; ci++) {
                            const cEmp = rrE[ci];
                            if (!cEmp.cycleAnchorDate) continue;
                            const anchorMs = new Date(cEmp.cycleAnchorDate + 'T00:00:00').getTime();
                            for (const cDate of allDates) {
                                if (rrGate && cDate < rrGate) continue;
                                const cKey = `${cEmp.employeeId}_${cDate}`;
                                const cPend = getPending(cKey);
                                const saved = getSaved(cKey);
                                if (saved && !saved.isDeleted) continue;
                                if (cPend && !cPend.isDeleted && cPend.isTemp) continue;
                                const cMs = new Date(cDate + 'T00:00:00').getTime();
                                const cDays = Math.round((cMs - anchorMs) / 86400000);
                                const cPos = ((cDays % cycLen) + cycLen) % cycLen;
                                if (cPos < rotation.cycleOffDays) {
                                    additions[cKey] = {
                                        empId: cEmp.employeeId!,
                                        dateStr: cDate,
                                        code: 'F',
                                        positionName: '',
                                        hours: 0,
                                        startTime: '00:00',
                                        isDeleted: false,
                                        _isAutoRotation: true,
                                    };
                                }
                            }
                        }
                    }
                }
            }
            continue;
        }
        for (const period of rotation.periods) {
            for (const dateStr of allDates) {
                if (!rotationPeriodApplies(period, dateStr, rotation)) continue;
                const dayLetter = dayLetterFromDateStr(dateStr);
                for (const entry of period.entries) {
                    if (!entry.employeeId || !entry.shiftCode) continue;
                    if (positionStructure?.length && entry.positionName) {
                        const posCfg = findPositionCfg(positionStructure, entry.positionName);
                        if (posCfg) {
                            if (!isPosActiveOnDay(posCfg as object, dayLetter, dateStr)) continue;
                            if (isPosExcludedOnDate(posCfg as object, dateStr)) continue;
                        }
                    }
                    const key = `${entry.employeeId}_${dateStr}`;
                    const activePending = getPending(key);
                    const fsShift = getSaved(key);
                    const isFranco = (s: { isDeleted?: boolean; code?: string } | undefined) =>
                        s && !s.isDeleted && FRANCO_CODES.has(String(s.code || '').toUpperCase());
                    if (isFranco(activePending) || (!activePending && isFranco(fsShift))) continue;
                    if (!activePending || activePending.isDeleted) {
                        additions[key] = {
                            empId: entry.employeeId,
                            dateStr,
                            code: entry.shiftCode,
                            positionName: entry.positionName || '',
                            hours: 8,
                            startTime: '00:00',
                            isDeleted: false,
                            _isAutoRotation: true,
                        };
                    }
                }
            }
        }
    }
    return additions;
}

export function rotationAdditionsToSlaRotationByDate(
    additions: Record<string, RotationMonthCell>,
    dateStrs: string[],
): SlaRotationByDate | undefined {
    const allowedDates = new Set(dateStrs);
    const out: SlaRotationByDate = {};
    for (const cell of Object.values(additions)) {
        if (!allowedDates.has(cell.dateStr)) continue;
        const code = String(cell.code || '').toUpperCase();
        if (FRANCO_CODES.has(code) || (cell.hours ?? 0) <= 0) continue;
        const pos = String(cell.positionName || '').trim();
        if (!pos) continue;
        if (!out[cell.dateStr]) out[cell.dateStr] = {};
        out[cell.dateStr][cell.empId] = {
            positionName: pos,
            shiftCode: code,
        };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
