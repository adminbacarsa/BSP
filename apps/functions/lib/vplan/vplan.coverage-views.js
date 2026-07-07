"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPositionSlotRows = buildPositionSlotRows;
exports.buildSlaExpectedByCode = buildSlaExpectedByCode;
exports.buildOverCoveredByDay = buildOverCoveredByDay;
exports.buildCodeMonthSummary = buildCodeMonthSummary;
exports.buildSchedulePreview = buildSchedulePreview;
exports.buildVplanCoverageBundle = buildVplanCoverageBundle;
exports.engineAssignmentsFromDraft = engineAssignmentsFromDraft;
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'NR']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
function normCode(c) {
    const u = String(c || '').toUpperCase();
    return u === 'D12' ? 'M' : u === 'N12' ? 'N' : u;
}
function getDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function getDayLetter(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()] ?? 'L';
}
function positionIsActiveOn(pos, dayLetter) {
    const days = pos.activeDays;
    if (!days || days.length === 0)
        return true;
    return days.includes(dayLetter);
}
function codeCategory(code) {
    const c = code.toUpperCase();
    if (FRANCO_CODES.has(c))
        return 'franco';
    if (ABSENCE_CODES.has(c))
        return 'ausencia';
    if (NON_BILLABLE.has(c))
        return 'otro';
    return 'trabajo';
}
function codeLabel(code) {
    const c = code.toUpperCase();
    const labels = {
        M: 'Mañana', T: 'Tarde', N: 'Noche', D12: 'Diurno 12h', N12: 'Nocturno 12h',
        F: 'Franco', FF: 'Franco feriado', FP: 'Franco permuta', FT: 'Franco trabajado',
        RET: 'Retención', ESC: 'Escuela', REF: 'Refuerzo', EN: 'Entrada', V: 'Vacaciones',
    };
    return labels[c] ?? c;
}
function buildPositionSlotRows(ctx, assignments) {
    const realCount = {};
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) || !a.positionName)
            continue;
        const k = `${a.dateStr}__${a.positionName}__${normCode(c)}`;
        realCount[k] = (realCount[k] || 0) + 1;
    }
    const agg = {};
    ctx.daysInMonth.forEach((d) => {
        const dateStr = getDateKey(d);
        const dayLetter = getDayLetter(dateStr);
        ctx.positions.forEach((pos) => {
            if (pos.excludedDates?.includes(dateStr))
                return;
            const qty = Number(pos.qty) || 0;
            if (!qty)
                return;
            if (!positionIsActiveOn(pos, dayLetter))
                return;
            const shifts = (pos.shifts || []).filter((s) => {
                const c = String(s.code || '').toUpperCase();
                return c && !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c)
                    && (!Array.isArray(s.days) || s.days.length === 0 || s.days.includes(dayLetter));
            });
            for (const sh of shifts) {
                const shiftCode = String(sh.code || '').toUpperCase();
                const slotKey = `${pos.positionName}__${normCode(shiftCode)}`;
                if (!agg[slotKey])
                    agg[slotKey] = { required: 0, covered: 0, assigned: 0 };
                agg[slotKey].required += qty;
                const dayKey = `${dateStr}__${pos.positionName}__${normCode(shiftCode)}`;
                const assigned = realCount[dayKey] || 0;
                agg[slotKey].covered += Math.min(assigned, qty);
                agg[slotKey].assigned += assigned;
            }
        });
    });
    return Object.entries(agg)
        .map(([key, { required, covered, assigned }]) => {
        const sep = key.lastIndexOf('__');
        const positionName = key.slice(0, sep);
        const shiftCode = key.slice(sep + 2);
        const coveredSlots = Math.min(required, covered);
        const missingSlots = Math.max(0, required - coveredSlots);
        const excessSlots = Math.max(0, assigned - required);
        return {
            positionName,
            shiftCode,
            requiredSlots: required,
            coveredSlots,
            missingSlots,
            excessSlots,
            assignedSlots: assigned,
            coveragePct: required > 0 ? Math.round((coveredSlots / required) * 1000) / 10 : 100,
        };
    })
        .sort((a, b) => a.positionName.localeCompare(b.positionName) || a.shiftCode.localeCompare(b.shiftCode));
}
function buildSlaExpectedByCode(ctx) {
    const out = {};
    ctx.daysInMonth.forEach((d) => {
        const dateStr = getDateKey(d);
        const dayLetter = getDayLetter(dateStr);
        ctx.positions.forEach((pos) => {
            if (pos.excludedDates?.includes(dateStr))
                return;
            const qty = Number(pos.qty) || 0;
            if (!qty)
                return;
            if (!positionIsActiveOn(pos, dayLetter))
                return;
            const shifts = (pos.shifts || []).filter((s) => {
                const c = String(s.code || '').toUpperCase();
                return c && !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c)
                    && (!Array.isArray(s.days) || s.days.length === 0 || s.days.includes(dayLetter));
            });
            for (const sh of shifts) {
                const code = String(sh.code || '').toUpperCase();
                out[code] = (out[code] || 0) + qty;
            }
        });
    });
    return out;
}
function buildOverCoveredByDay(ctx, assignments) {
    const realCount = {};
    const realEmps = {};
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c) || !a.positionName)
            continue;
        const k = `${a.dateStr}__${a.positionName}__${normCode(c)}`;
        realCount[k] = (realCount[k] || 0) + 1;
        if (!realEmps[k])
            realEmps[k] = [];
        realEmps[k].push(a.employeeId);
    }
    const overCoveredByDay = {};
    let overCoveredSlots = 0;
    ctx.daysInMonth.forEach((d) => {
        const dateStr = getDateKey(d);
        const dayLetter = getDayLetter(dateStr);
        ctx.positions.forEach((pos) => {
            if (pos.excludedDates?.includes(dateStr))
                return;
            const qty = Number(pos.qty) || 0;
            if (!qty)
                return;
            if (!positionIsActiveOn(pos, dayLetter))
                return;
            const shifts = (pos.shifts || []).filter((s) => {
                const c = String(s.code || '').toUpperCase();
                return c && !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c)
                    && (!Array.isArray(s.days) || s.days.length === 0 || s.days.includes(dayLetter));
            });
            for (const sh of shifts) {
                const shiftCode = String(sh.code || '').toUpperCase();
                const dayKey = `${dateStr}__${pos.positionName}__${normCode(shiftCode)}`;
                const assigned = realCount[dayKey] || 0;
                const excess = Math.max(0, assigned - qty);
                if (excess <= 0)
                    continue;
                overCoveredSlots += excess;
                if (!overCoveredByDay[dateStr])
                    overCoveredByDay[dateStr] = [];
                overCoveredByDay[dateStr].push({
                    positionName: pos.positionName,
                    shiftCode,
                    excess,
                    employeeIds: realEmps[dayKey] || [],
                });
            }
        });
    });
    return { overCoveredByDay, overCoveredSlots };
}
function buildCodeMonthSummary(assignments, slaExpectedByCode) {
    const counts = {};
    for (const a of assignments) {
        const code = String(a.code || '').toUpperCase();
        if (!code)
            continue;
        if (!counts[code])
            counts[code] = { count: 0, hours: 0 };
        counts[code].count += 1;
        counts[code].hours += Number(a.hours) || 0;
    }
    return Object.entries(counts)
        .map(([code, v]) => {
        const slaExpected = slaExpectedByCode?.[code];
        const excessCount = slaExpected !== undefined ? Math.max(0, v.count - slaExpected) : undefined;
        return {
            code,
            label: codeLabel(code),
            category: codeCategory(code),
            count: v.count,
            hours: Math.round(v.hours),
            slaExpected,
            excessCount,
        };
    })
        .sort((a, b) => {
        const order = { trabajo: 0, franco: 1, ausencia: 2, otro: 3 };
        const ca = order[a.category] - order[b.category];
        if (ca !== 0)
            return ca;
        return a.code.localeCompare(b.code);
    });
}
function buildSchedulePreview(opts) {
    const nameById = new Map(opts.employees.map((e) => [e.id, e.displayName]));
    const byEmp = new Map();
    for (const emp of opts.employees) {
        byEmp.set(emp.id, {
            employeeId: emp.id,
            displayName: emp.displayName,
            defaultPosition: opts.defaultPositionByEmp[emp.id],
            cells: {},
            codeTotals: {},
        });
    }
    for (const a of opts.assignments) {
        if (!byEmp.has(a.employeeId)) {
            byEmp.set(a.employeeId, {
                employeeId: a.employeeId,
                displayName: nameById.get(a.employeeId) || a.employeeId,
                defaultPosition: opts.defaultPositionByEmp[a.employeeId],
                cells: {},
                codeTotals: {},
            });
        }
        const row = byEmp.get(a.employeeId);
        const code = String(a.code || '').toUpperCase();
        row.cells[a.dateStr] = { code, positionName: a.positionName };
        row.codeTotals[code] = (row.codeTotals[code] || 0) + 1;
    }
    const rows = [...byEmp.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    return {
        dateStrs: opts.dateStrs,
        rows,
        codeSummary: buildCodeMonthSummary(opts.assignments, opts.slaExpectedByCode),
    };
}
function buildVplanCoverageBundle(opts) {
    const slaExpectedByCode = buildSlaExpectedByCode(opts.ctx);
    const { overCoveredByDay, overCoveredSlots } = buildOverCoveredByDay(opts.ctx, opts.draftAssignments);
    return {
        totalSlots: opts.coverage.totalSlots,
        coveredSlots: opts.coverage.coveredSlots,
        uncoveredSlots: opts.coverage.uncoveredSlots,
        overCoveredSlots,
        coverageRatio: Math.round(opts.coverage.coverageRatio * 1000) / 10,
        structuralHours: Math.round(opts.monthDemandHours),
        positionSlots: buildPositionSlotRows(opts.ctx, opts.draftAssignments),
        uncoveredByDay: opts.coverage.uncoveredByDay,
        overCoveredByDay,
        schedulePreview: buildSchedulePreview({
            assignments: opts.draftAssignments,
            employees: opts.employees,
            dateStrs: opts.dateStrs,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            slaExpectedByCode,
        }),
    };
}
function engineAssignmentsFromDraft(draft) {
    return draft.map((a) => ({
        empId: a.employeeId,
        dateStr: a.dateStr,
        positionName: a.positionName,
        code: a.code,
        name: a.code,
        hours: a.hours ?? 0,
        startTime: '00:00',
        isFranco: a.code === 'F' || a.code === 'FF',
    }));
}
//# sourceMappingURL=vplan.coverage-views.js.map