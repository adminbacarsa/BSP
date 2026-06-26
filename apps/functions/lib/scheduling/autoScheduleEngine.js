"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSchedule = generateSchedule;
exports.verifyCoverage = verifyCoverage;
const CYCLE_24_MTN = [
    ...Array(6).fill('M'), ...Array(2).fill('F'),
    ...Array(6).fill('T'), ...Array(2).fill('F'),
    ...Array(6).fill('N'), ...Array(2).fill('F'),
];
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
const WORK_BANDS = new Set(['M', 'T', 'N']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
const BANDS_12H = new Set(['D12', 'N12']);
const COLD_START_OPENINGS = [4, 10, 16, 22];
const FLOATER_COLD_START_OPENINGS = [0, 8, 16];
function getDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function getDayLetter(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()];
}
function is24hs(pos) {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}
function positionIsActiveOn(pos, dayLetter) {
    if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    return true;
}
function positionCapacity(pos) {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const sevenDays = !Array.isArray(pos.activeDays) || pos.activeDays.length >= 7;
    if (is24hs(pos) && sevenDays) {
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        return qty * (only12h ? 3 : 4);
    }
    if (sevenDays) {
        const activeBands = (pos.shifts || []).filter(s => WORK_BANDS.has(String(s.code || '').toUpperCase())).length;
        if (activeBands === 0)
            return qty;
        return qty * Math.max(1, activeBands) * 2;
    }
    return qty;
}
function shiftMeta(pos, code, codeHoursHint) {
    const upper = code.toUpperCase();
    const sh = (pos.shifts || []).find(s => String(s.code || '').toUpperCase() === upper);
    if (sh) {
        const hours = Number(sh.hours) > 0 ? Number(sh.hours) : (codeHoursHint?.[upper] ?? 8);
        return { name: sh.name || upper, hours, startTime: sh.startTime || '07:00', ...(sh.endTime ? { endTime: sh.endTime } : {}) };
    }
    const hint = codeHoursHint?.[upper];
    const defaults = {
        M: { startTime: '07:00', endTime: '15:00' },
        T: { startTime: '15:00', endTime: '23:00' },
        N: { startTime: '23:00', endTime: '07:00' },
        D12: { startTime: '07:00', endTime: '19:00', hours: 12 },
        N12: { startTime: '19:00', endTime: '07:00', hours: 12 },
        F: { startTime: '00:00', hours: 0 },
    };
    const d = defaults[upper] ?? defaults.M;
    return { name: upper === 'F' ? 'Franco' : upper, hours: hint ?? d.hours ?? 8, startTime: d.startTime, ...(d.endTime ? { endTime: d.endTime } : {}) };
}
function buildPositionGroups(ctx) {
    const groups = {};
    ctx.positions.forEach(p => { groups[p.positionName] = []; });
    const defaultPos = ctx.defaultPositionByEmp || {};
    const unassigned = [];
    for (const emp of ctx.employees) {
        const fixed = defaultPos[emp.id];
        if (fixed && groups[fixed] !== undefined) {
            groups[fixed].push(emp.id);
        }
        else {
            unassigned.push(emp.id);
        }
    }
    if (unassigned.length > 0) {
        const targets = ctx.positions.filter(p => groups[p.positionName] !== undefined);
        if (targets.length > 0) {
            for (const empId of unassigned) {
                const leastFull = targets.reduce((best, p) => {
                    const rP = groups[p.positionName].length / positionCapacity(p);
                    const rB = groups[best.positionName].length / positionCapacity(best);
                    return rP < rB ? p : best;
                });
                groups[leastFull.positionName].push(empId);
            }
        }
    }
    return groups;
}
function buildSubgroupsFor24hs(ctx, groups) {
    const result = [];
    for (const [posName, groupIds] of Object.entries(groups)) {
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos || !is24hs(pos))
            continue;
        if (Array.isArray(pos.activeDays) && pos.activeDays.length < 7)
            continue;
        const qty = Math.max(1, Number(pos.qty) || 1);
        const codes = (pos.shifts || []).map(s => String(s.code || '').toUpperCase());
        const only12h = codes.length > 0 && codes.every(c => BANDS_12H.has(c));
        const subgroupSize = only12h ? 3 : 4;
        const subgroupCount = Math.min(qty, Math.floor(groupIds.length / subgroupSize));
        if (subgroupCount === 0)
            continue;
        const subs = [];
        for (let i = 0; i < subgroupCount; i++) {
            subs.push(groupIds.slice(i * subgroupSize, i * subgroupSize + subgroupSize));
        }
        const floaters = groupIds.slice(subgroupCount * subgroupSize);
        floaters.forEach((id, fi) => { subs[fi % subs.length].push(id); });
        result.push(...subs);
    }
    return result;
}
function inferCycleSlot(lastCode, trailingWork, trailingRest, lastWorkBand) {
    if (!lastCode)
        return null;
    const code = lastCode.toUpperCase();
    if (code === 'RET' || code === 'R') {
        const effectiveBand = lastWorkBand?.toUpperCase();
        if (!effectiveBand || !WORK_BANDS.has(effectiveBand))
            return null;
        const need = Math.max(1, trailingWork ?? 1);
        for (let june1 = 0; june1 < 24; june1++) {
            const may31 = (june1 - 1 + 24) % 24;
            if (CYCLE_24_MTN[may31] !== effectiveBand)
                continue;
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== effectiveBand)
                    break;
                ok++;
            }
            if (ok >= need)
                return june1;
        }
        return null;
    }
    for (let june1 = 0; june1 < 24; june1++) {
        const may31 = (june1 - 1 + 24) % 24;
        if (CYCLE_24_MTN[may31] !== code)
            continue;
        if (WORK_BANDS.has(code)) {
            const need = Math.max(1, trailingWork ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== code)
                    break;
                ok++;
            }
            if (ok >= need)
                return june1;
        }
        else if (FRANCO_CODES.has(code)) {
            const need = Math.max(1, trailingRest ?? 1);
            let ok = 0;
            for (let b = 0; b < need; b++) {
                if (CYCLE_24_MTN[(may31 - b + 24) % 24] !== 'F')
                    break;
                ok++;
            }
            if (ok < need)
                continue;
            if (need === 1) {
                if (CYCLE_24_MTN[june1] !== 'F')
                    continue;
            }
            else {
                if (!WORK_BANDS.has(CYCLE_24_MTN[june1]))
                    continue;
            }
            return june1;
        }
    }
    return null;
}
function resolveOpeningSlots(ctx, subgroups) {
    const out = {};
    const ZONE_SLOT = { M: 4, T: 10, N: 16, F: 22 };
    const bandZone = (slot) => {
        const s = ((slot % 24) + 24) % 24;
        if (s <= 5)
            return 'M';
        if (s <= 7)
            return 'F';
        if (s <= 13)
            return 'T';
        if (s <= 15)
            return 'F';
        if (s <= 21)
            return 'N';
        return 'F';
    };
    for (const groupIds of subgroups) {
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);
        const withTrail = [];
        const withoutTrail = [];
        for (const empId of regularIds) {
            const slot = inferCycleSlot(ctx.prevMonthLastShiftByEmp?.[empId], ctx.prevMonthTrailingWorkDays?.[empId], ctx.prevMonthTrailingRestDays?.[empId], ctx.prevMonthLastWorkBandBeforeRest?.[empId]);
            if (slot !== null) {
                out[empId] = slot;
                withTrail.push(empId);
            }
            else
                withoutTrail.push(empId);
        }
        const usedZones = new Map();
        for (const empId of [...withTrail]) {
            const zone = bandZone(out[empId]);
            if (!usedZones.has(zone))
                usedZones.set(zone, true);
            else {
                delete out[empId];
                withoutTrail.push(empId);
            }
        }
        let anchor = COLD_START_OPENINGS[0];
        let fixedBandFound = false;
        for (const empId of [...withTrail, ...withoutTrail]) {
            const fb = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            if (fb && WORK_BANDS.has(fb) && ZONE_SLOT[fb] !== undefined) {
                anchor = ZONE_SLOT[fb];
                fixedBandFound = true;
                break;
            }
        }
        if (!fixedBandFound) {
            for (const empId of withTrail) {
                if (out[empId] !== undefined) {
                    anchor = out[empId];
                    break;
                }
            }
        }
        const canonicalForZone = {};
        for (let k = 0; k < 4; k++) {
            const s = ((anchor + k * 6) % 24 + 24) % 24;
            const z = bandZone(s);
            if (!(z in canonicalForZone))
                canonicalForZone[z] = s;
        }
        for (const empId of withTrail) {
            if (out[empId] !== undefined) {
                const zone = bandZone(out[empId]);
                const c = canonicalForZone[zone];
                if (c !== undefined)
                    out[empId] = c;
            }
        }
        for (const empId of [...withTrail]) {
            if (out[empId] === undefined)
                continue;
            const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            if (!fixedBand || !WORK_BANDS.has(fixedBand))
                continue;
            const currentZone = bandZone(out[empId]);
            if (currentZone === fixedBand)
                continue;
            const targetSlot = canonicalForZone[fixedBand];
            if (targetSlot === undefined)
                continue;
            const displaced = withTrail.find(id => id !== empId && out[id] !== undefined && bandZone(out[id]) === fixedBand);
            if (displaced) {
                usedZones.delete(fixedBand);
                delete out[displaced];
                withoutTrail.push(displaced);
            }
            usedZones.delete(currentZone);
            usedZones.set(fixedBand, true);
            out[empId] = targetSlot;
        }
        const ALL_ZONES = ['M', 'T', 'N', 'F'];
        const availableZones = new Set(ALL_ZONES.filter(z => !usedZones.has(z)));
        withoutTrail.sort((a, b) => {
            const fa = ctx.defaultShiftByEmp?.[a]?.toUpperCase();
            const fb = ctx.defaultShiftByEmp?.[b]?.toUpperCase();
            return ((fb && WORK_BANDS.has(fb)) ? 1 : 0) - ((fa && WORK_BANDS.has(fa)) ? 1 : 0);
        });
        withoutTrail.forEach((empId, i) => {
            const fixedBand = ctx.defaultShiftByEmp?.[empId]?.toUpperCase();
            let zone;
            if (fixedBand && WORK_BANDS.has(fixedBand) && availableZones.has(fixedBand))
                zone = fixedBand;
            else
                zone = [...availableZones][0] ?? ALL_ZONES[i % 4];
            availableZones.delete(zone);
            out[empId] = canonicalForZone[zone] ?? ZONE_SLOT[zone] ?? COLD_START_OPENINGS[i % 4];
        });
        for (const empId of floaterIds) {
            const slot = inferCycleSlot(ctx.prevMonthLastShiftByEmp?.[empId], ctx.prevMonthTrailingWorkDays?.[empId], ctx.prevMonthTrailingRestDays?.[empId], ctx.prevMonthLastWorkBandBeforeRest?.[empId]);
            out[empId] = slot ?? FLOATER_COLD_START_OPENINGS[floaterIds.indexOf(empId) % FLOATER_COLD_START_OPENINGS.length];
        }
    }
    return out;
}
function patchRetForAbsences(ctx, assignments, openingSlotByEmp, subgroups, empToPosition, employeeMonthlyHours, cutoffDay) {
    const aIdx = new Map();
    assignments.forEach((a, i) => aIdx.set(`${a.empId}__${a.dateStr}`, i));
    const allFloaterIds = subgroups.flatMap(sub => sub.slice(4));
    for (const groupIds of subgroups) {
        const posName = empToPosition[groupIds[0]] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos)
            continue;
        const regularIds = groupIds.slice(0, 4);
        const floaterIds = groupIds.slice(4);
        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = getDateKey(day);
            const absentRegulars = regularIds.filter(id => ctx.absences[id]?.has(dateStr));
            if (!absentRegulars.length)
                return;
            for (const absentId of absentRegulars) {
                const opening = openingSlotByEmp[absentId];
                if (opening === undefined)
                    continue;
                const neededBand = CYCLE_24_MTN[(opening + di) % 24];
                if (!WORK_BANDS.has(neededBand))
                    continue;
                const alreadyCovered = regularIds.some(id => {
                    if (id === absentId || ctx.absences[id]?.has(dateStr))
                        return false;
                    const op = openingSlotByEmp[id];
                    return op !== undefined && CYCLE_24_MTN[(op + di) % 24] === neededBand;
                });
                if (alreadyCovered)
                    continue;
                const allRetCandidates = [
                    ...floaterIds.filter(id => !ctx.absences[id]?.has(dateStr)),
                    ...allFloaterIds.filter(id => !floaterIds.includes(id) && !ctx.absences[id]?.has(dateStr)),
                ];
                for (const retId of allRetCandidates) {
                    const ai = aIdx.get(`${retId}__${dateStr}`);
                    if (ai === undefined || assignments[ai].code !== 'RET')
                        continue;
                    const meta = shiftMeta(pos, neededBand, ctx.codeHoursHint);
                    assignments[ai] = { empId: retId, dateStr, positionName: posName, code: neededBand, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) };
                    employeeMonthlyHours[retId] = (employeeMonthlyHours[retId] || 0) + meta.hours;
                    break;
                }
            }
        });
    }
}
function generateSchedule(ctx) {
    const positionGroups = buildPositionGroups(ctx);
    const subgroups = buildSubgroupsFor24hs(ctx, positionGroups);
    const empToPosition = {};
    for (const [posName, ids] of Object.entries(positionGroups))
        ids.forEach(id => { empToPosition[id] = posName; });
    const openingSlotByEmp = resolveOpeningSlots(ctx, subgroups);
    const empSubgroup = new Map();
    subgroups.forEach(sub => sub.forEach(id => empSubgroup.set(id, sub)));
    const subgroupDisplacement = new Map();
    for (const subGroup of subgroups) {
        const fixedEmpId = subGroup.find(id => {
            const fb = ctx.defaultShiftByEmp?.[id]?.toUpperCase();
            return fb && WORK_BANDS.has(fb) && openingSlotByEmp[id] !== undefined;
        });
        if (!fixedEmpId)
            continue;
        const fixedBand = ctx.defaultShiftByEmp[fixedEmpId].toUpperCase();
        const fixedOpening = openingSlotByEmp[fixedEmpId];
        for (const empId of subGroup) {
            if (empId !== fixedEmpId)
                subgroupDisplacement.set(empId, { fixedBand, fixedOpening });
        }
    }
    const cutoffDay = ctx.cctCutoffDay && ctx.cctCutoffDay >= 1 && ctx.cctCutoffDay <= 31 ? ctx.cctCutoffDay : 25;
    const assignments = [];
    const employeeMonthlyHours = {};
    const primaryShiftByEmp = {};
    ctx.employees.forEach(e => { employeeMonthlyHours[e.id] = 0; });
    for (const emp of ctx.employees) {
        const opening = openingSlotByEmp[emp.id];
        const posName = empToPosition[emp.id] ?? '';
        const pos = ctx.positions.find(p => p.positionName === posName);
        if (!pos)
            continue;
        if (opening === undefined) {
            if (is24hs(pos))
                continue;
            primaryShiftByEmp[emp.id] = null;
            ctx.daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                if (ctx.absences[emp.id]?.has(dateStr))
                    return;
                const dayLetter = getDayLetter(dateStr);
                if (positionIsActiveOn(pos, dayLetter)) {
                    const shiftCode = String(pos.shifts?.[0]?.code || 'M').toUpperCase();
                    const meta = shiftMeta(pos, shiftCode, ctx.codeHoursHint);
                    assignments.push({ empId: emp.id, dateStr, positionName: posName, code: shiftCode, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) });
                    employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
                }
                else {
                    assignments.push({ empId: emp.id, dateStr, positionName: '', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true });
                }
            });
            continue;
        }
        const subGroup = empSubgroup.get(emp.id) ?? [];
        const isRetFloater = subGroup.indexOf(emp.id) >= 4;
        ctx.daysInMonth.forEach((day, di) => {
            const dateStr = getDateKey(day);
            if (ctx.absences[emp.id]?.has(dateStr))
                return;
            const dayLetter = getDayLetter(dateStr);
            if (!positionIsActiveOn(pos, dayLetter))
                return;
            const rawCode = CYCLE_24_MTN[(opening + di) % 24];
            const ownFixedBand = ctx.defaultShiftByEmp?.[emp.id]?.toUpperCase();
            let rawCodeFinal;
            if (ownFixedBand && WORK_BANDS.has(ownFixedBand) && WORK_BANDS.has(rawCode)) {
                rawCodeFinal = ownFixedBand;
            }
            else {
                const disp = subgroupDisplacement.get(emp.id);
                if (disp && rawCode === disp.fixedBand && WORK_BANDS.has(rawCode)) {
                    const naturalOfFixed = CYCLE_24_MTN[(disp.fixedOpening + di) % 24];
                    rawCodeFinal = WORK_BANDS.has(naturalOfFixed) ? naturalOfFixed : rawCode;
                }
                else {
                    rawCodeFinal = rawCode;
                }
            }
            const isExcludedDay = !isRetFloater && WORK_BANDS.has(rawCodeFinal) && !!pos.excludedDates?.includes(dateStr);
            const code = isExcludedDay ? 'RET' : (isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? 'RET' : rawCodeFinal;
            if (di === 0)
                primaryShiftByEmp[emp.id] = (!isRetFloater && WORK_BANDS.has(rawCodeFinal)) ? rawCodeFinal : null;
            const meta = shiftMeta(pos, isExcludedDay ? rawCode : code, ctx.codeHoursHint);
            const isFranco = code === 'F';
            assignments.push({
                empId: emp.id, dateStr, positionName: (isFranco || code === 'RET') ? '' : posName,
                code, name: meta.name, hours: meta.hours, startTime: meta.startTime,
                ...(code !== 'RET' && meta.endTime ? { endTime: meta.endTime } : {}),
                ...(isFranco ? { isFranco: true } : {}),
            });
            if (BILLABLE.has(code)) {
                employeeMonthlyHours[emp.id] = (employeeMonthlyHours[emp.id] || 0) + meta.hours;
            }
        });
    }
    patchRetForAbsences(ctx, assignments, openingSlotByEmp, subgroups, empToPosition, employeeMonthlyHours, cutoffDay);
    for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        if (a.code !== 'RET')
            continue;
        const opening = openingSlotByEmp[a.empId];
        if (opening === undefined)
            continue;
        const di = ctx.daysInMonth.findIndex(d => getDateKey(d) === a.dateStr);
        if (di < 0)
            continue;
        const naturalCode = CYCLE_24_MTN[(opening + di) % 24];
        if (!WORK_BANDS.has(naturalCode))
            continue;
        const posNameR = empToPosition[a.empId] ?? '';
        const posR = ctx.positions.find(p => p.positionName === posNameR);
        if (!posR)
            continue;
        const meta = shiftMeta(posR, naturalCode, ctx.codeHoursHint);
        assignments[i] = { empId: a.empId, dateStr: a.dateStr, positionName: posNameR, code: naturalCode, name: meta.name, hours: meta.hours, startTime: meta.startTime, ...(meta.endTime ? { endTime: meta.endTime } : {}) };
        employeeMonthlyHours[a.empId] = (employeeMonthlyHours[a.empId] || 0) + meta.hours;
    }
    const totalBillableHours = Object.values(employeeMonthlyHours).reduce((s, h) => s + h, 0);
    const slaTarget = Math.max(0, ctx.slaVendidas || 0);
    const slaDeficitRemaining = Math.max(0, Math.round((slaTarget - totalBillableHours) * 10) / 10);
    return {
        assignments,
        stats: {
            totalBillableHours,
            targetHours: slaTarget,
            slaHoursClosed: slaDeficitRemaining <= 0.5,
            slaDeficitRemaining,
            employeeMonthlyHours,
            idleEmployeeIds: ctx.employees.filter(e => openingSlotByEmp[e.id] === undefined && !ctx.positions.some(p => p.positionName === (empToPosition[e.id] ?? '') && !is24hs(p))).map(e => e.id),
            positionGroups,
            openingSlotByEmp,
            primaryShiftByEmp,
        },
    };
}
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
function verifyCoverage(ctx, assignments) {
    const demand = [];
    ctx.daysInMonth.forEach(d => {
        const dateStr = getDateKey(d);
        const dayLetter = getDayLetter(dateStr);
        ctx.positions.forEach(pos => {
            if (pos.excludedDates?.includes(dateStr))
                return;
            const qty = Number(pos.qty) || 0;
            if (!qty)
                return;
            if (!positionIsActiveOn(pos, dayLetter))
                return;
            const shifts = (pos.shifts || []).filter(s => {
                const c = String(s.code || '').toUpperCase();
                return c && !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c) &&
                    (!Array.isArray(s.days) || s.days.length === 0 || s.days.includes(dayLetter));
            });
            for (const sh of shifts) {
                demand.push({ dateStr, positionName: pos.positionName, shiftCode: String(sh.code || '').toUpperCase(), qty });
            }
        });
    });
    const normCode = (c) => c === 'D12' ? 'M' : c === 'N12' ? 'N' : c;
    const realCount = {};
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) || !a.positionName)
            continue;
        const k = `${a.dateStr}__${a.positionName}__${normCode(c)}`;
        realCount[k] = (realCount[k] || 0) + 1;
    }
    let totalSlots = 0, coveredSlots = 0;
    const uncoveredByDay = {};
    for (const { dateStr, positionName, shiftCode, qty } of demand) {
        totalSlots += qty;
        const k = `${dateStr}__${positionName}__${normCode(shiftCode)}`;
        const assigned = realCount[k] || 0;
        const covered = Math.min(assigned, qty);
        coveredSlots += covered;
        if (covered < qty) {
            if (!uncoveredByDay[dateStr])
                uncoveredByDay[dateStr] = [];
            uncoveredByDay[dateStr].push({ positionName, shiftCode, missing: qty - covered });
        }
    }
    const totalBillableHours = assignments.reduce((s, a) => {
        const c = String(a.code || '').toUpperCase();
        return s + (NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) ? 0 : (a.hours || 0));
    }, 0);
    return {
        totalSlots, coveredSlots, uncoveredSlots: totalSlots - coveredSlots,
        coverageRatio: totalSlots > 0 ? coveredSlots / totalSlots : 1,
        slaHoursClosed: totalBillableHours >= ctx.slaVendidas - 0.5,
        billableHours: totalBillableHours,
        slaVendidas: ctx.slaVendidas,
        uncoveredByDay,
    };
}
//# sourceMappingURL=autoScheduleEngine.js.map