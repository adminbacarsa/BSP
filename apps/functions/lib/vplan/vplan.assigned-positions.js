"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferDefaultPositionFromTurnos = inferDefaultPositionFromTurnos;
exports.mergeDefaultPositionMaps = mergeDefaultPositionMaps;
exports.mergeDefaultShiftMaps = mergeDefaultShiftMaps;
exports.enforceAssigned24hsPositions = enforceAssigned24hsPositions;
exports.detectAssignedPositionViolations = detectAssignedPositionViolations;
const vplan_positions_1 = require("./vplan.positions");
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function assignmentKey(empId, dateStr) {
    return `${empId}_${dateStr}`;
}
function inferDefaultPositionFromTurnos(assignments) {
    const tally = new Map();
    for (const a of assignments) {
        const pos = String(a.positionName || '').trim();
        const code = String(a.code || '').toUpperCase();
        if (!pos || code === 'F' || code === 'RET' || code === 'R')
            continue;
        if (!tally.has(a.employeeId))
            tally.set(a.employeeId, new Map());
        const byPos = tally.get(a.employeeId);
        byPos.set(pos, (byPos.get(pos) || 0) + 1);
    }
    const out = {};
    for (const [empId, byPos] of tally) {
        let bestPos = '';
        let bestCount = 0;
        for (const [pos, count] of byPos) {
            if (count > bestCount) {
                bestPos = pos;
                bestCount = count;
            }
        }
        if (bestPos)
            out[empId] = bestPos;
    }
    return out;
}
function mergeDefaultPositionMaps(...layers) {
    const out = {};
    for (const layer of layers) {
        if (!layer)
            continue;
        for (const [empId, pos] of Object.entries(layer)) {
            if (pos)
                out[empId] = pos;
        }
    }
    return out;
}
function mergeDefaultShiftMaps(...layers) {
    const out = {};
    for (const layer of layers) {
        if (!layer)
            continue;
        for (const [empId, band] of Object.entries(layer)) {
            if (band)
                out[empId] = band.toUpperCase();
        }
    }
    return out;
}
function enforceAssigned24hsPositions(opts) {
    const log = [];
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const fixed24hs = new Map();
    for (const [empId, posName] of Object.entries(opts.defaultPositionByEmp)) {
        const pos = posByName.get(posName);
        if (!pos || !(0, vplan_positions_1.is24hsPosition)(pos) || (0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
            continue;
        fixed24hs.set(empId, posName);
    }
    if (fixed24hs.size === 0) {
        return { draft: opts.draft, log };
    }
    const assignments = opts.draft.assignments.map((a) => {
        const fixedPos = fixed24hs.get(a.employeeId);
        if (!fixedPos)
            return a;
        const code = a.code.toUpperCase();
        if (!WORK_CODES.has(code)) {
            if (a.positionName === '')
                return a;
            return { ...a, positionName: '' };
        }
        if (a.positionName === fixedPos)
            return a;
        log.push({
            code: 'ASSIGNED_POSITION_ENFORCE',
            message: `${a.positionName || '—'} → ${fixedPos}`,
            employeeId: a.employeeId,
            dateStr: a.dateStr,
        });
        return { ...a, positionName: fixedPos };
    });
    return {
        draft: { ...opts.draft, assignments },
        log,
    };
}
function detectAssignedPositionViolations(draft, defaultPositionByEmp, positions) {
    const posByName = new Map(positions.map((p) => [p.positionName, p]));
    const violations = [];
    for (const a of draft.assignments) {
        const expected = defaultPositionByEmp[a.employeeId];
        if (!expected)
            continue;
        const pos = posByName.get(expected);
        if (!pos || !(0, vplan_positions_1.is24hsPosition)(pos) || (0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
            continue;
        const code = a.code.toUpperCase();
        if (!WORK_CODES.has(code))
            continue;
        const actual = String(a.positionName || '').trim();
        if (actual === expected)
            continue;
        violations.push({
            employeeId: a.employeeId,
            dateStr: a.dateStr,
            expectedPosition: expected,
            actualPosition: actual || '—',
            code,
        });
    }
    return violations;
}
//# sourceMappingURL=vplan.assigned-positions.js.map