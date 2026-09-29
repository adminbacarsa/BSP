"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIFT_SERIES_ALIGN_MS = void 0;
exports.parseShiftSeries = parseShiftSeries;
exports.isRecognizedSeriesCode = isRecognizedSeriesCode;
exports.nextSeriesCode = nextSeriesCode;
exports.prevSeriesCode = prevSeriesCode;
exports.seriesCodeOf = seriesCodeOf;
exports.seriesHandoffKind = seriesHandoffKind;
exports.seriesBoundMs = seriesBoundMs;
exports.reliefPositionsMatch = reliefPositionsMatch;
exports.relieverFor = relieverFor;
exports.outgoingFor = outgoingFor;
const reliefEligibility_1 = require("./reliefEligibility");
exports.SHIFT_SERIES_ALIGN_MS = 30 * 60 * 1000;
const EIGHT_BANDS = ['M', 'T', 'N'];
function normCode(value) {
    return String(value ?? '').trim().toUpperCase();
}
function parseShiftSeries(code) {
    const c = normCode(code);
    if (c === 'D12' || c === 'N12')
        return { kind: '12', band: c };
    const m = /^(M|T|N)(\d*)$/.exec(c);
    if (!m)
        return null;
    return { kind: '8', band: m[1], suffix: m[2] || '' };
}
function isRecognizedSeriesCode(code) {
    return parseShiftSeries(code) !== null;
}
function codeOf(parsed) {
    if (parsed.kind === '12')
        return parsed.band;
    return `${parsed.band}${parsed.suffix}`;
}
function nextSeriesCode(code) {
    const parsed = parseShiftSeries(code);
    if (!parsed)
        return null;
    if (parsed.kind === '12')
        return parsed.band === 'D12' ? 'N12' : 'D12';
    const i = EIGHT_BANDS.indexOf(parsed.band);
    return `${EIGHT_BANDS[(i + 1) % EIGHT_BANDS.length]}${parsed.suffix}`;
}
function prevSeriesCode(code) {
    const parsed = parseShiftSeries(code);
    if (!parsed)
        return null;
    if (parsed.kind === '12')
        return parsed.band === 'D12' ? 'N12' : 'D12';
    const i = EIGHT_BANDS.indexOf(parsed.band);
    return `${EIGHT_BANDS[(i + 2) % EIGHT_BANDS.length]}${parsed.suffix}`;
}
const INHERITED_CODE_KEYS = ['titularCode', 'coveredShiftCode', 'sourceShiftCode', 'band', 'banda'];
function seriesCodeOf(shift) {
    if (!shift)
        return '';
    const own = (0, reliefEligibility_1.reliefShiftCode)(shift);
    const origin = String(shift.origin || '').toUpperCase();
    const coverage = origin === 'OPERATIONS_COVERAGE'
        && shift.coverageHoursOnSource !== true
        && String(shift.coverageType || '').toUpperCase() !== 'EXTEND'
        && String(shift.coverageType || '').toUpperCase() !== 'ADVANCE';
    if (coverage && !isRecognizedSeriesCode(own)) {
        for (const key of INHERITED_CODE_KEYS) {
            const inherited = normCode(shift[key]);
            if (isRecognizedSeriesCode(inherited))
                return inherited;
        }
    }
    return own;
}
function seriesHandoffKind(outgoingCode, incomingCode) {
    const outgoing = parseShiftSeries(outgoingCode);
    const incoming = parseShiftSeries(incomingCode);
    if (!outgoing || !incoming)
        return 'FALLBACK';
    return codeOf(incoming) === nextSeriesCode(codeOf(outgoing)) ? 'SERIES' : 'REJECT';
}
function readMs(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (value instanceof Date) {
        const t = value.getTime();
        return Number.isFinite(t) ? t : 0;
    }
    if (value && typeof value === 'object') {
        const o = value;
        if (typeof o.toMillis === 'function') {
            const t = o.toMillis();
            return Number.isFinite(t) ? t : 0;
        }
        if (typeof o.toDate === 'function') {
            const t = o.toDate().getTime();
            return Number.isFinite(t) ? t : 0;
        }
        if (typeof o.seconds === 'number')
            return o.seconds * 1000;
    }
    if (typeof value === 'string' && value.trim()) {
        const t = Date.parse(value);
        return Number.isFinite(t) ? t : 0;
    }
    return 0;
}
function seriesBoundMs(shift, kind) {
    if (!shift)
        return 0;
    const direct = kind === 'start' ? shift.startMs : shift.endMs;
    if (typeof direct === 'number' && direct > 0)
        return direct;
    const obj = kind === 'start' ? shift.shiftDateObj : shift.endDateObj;
    const raw = kind === 'start' ? shift.startTime : shift.endTime;
    return readMs(obj) || readMs(raw);
}
function fichajeMs(shift) {
    if (typeof shift.checkInMs === 'number' && shift.checkInMs > 0)
        return shift.checkInMs;
    return (readMs(shift.checkInAt)
        || readMs(shift.realStartTime)
        || readMs(shift.checkInTime)
        || readMs(shift.presenciaAt)
        || 0);
}
function reliefPositionsMatch(a, b) {
    const norm = (n) => String(n ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^puesto\s+/, '');
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb)
        return false;
    return na === nb || na.endsWith(nb) || nb.endsWith(na);
}
function incomingStartsInWindow(start, outgoingEnd, opts) {
    if (!start || !outgoingEnd)
        return false;
    if (opts && (opts.earliestIncomingMs != null || opts.latestIncomingMs != null)) {
        if (opts.earliestIncomingMs != null && start < opts.earliestIncomingMs)
            return false;
        if (opts.latestIncomingMs != null && start > opts.latestIncomingMs)
            return false;
        return true;
    }
    const align = opts?.alignMs ?? exports.SHIFT_SERIES_ALIGN_MS;
    return Math.abs(start - outgoingEnd) <= align;
}
function rankRows(rows, anchor, anchorIsOutgoing, targetMs) {
    if (!rows.length || !targetMs)
        return null;
    const scored = rows.map((row) => {
        const outCode = anchorIsOutgoing ? seriesCodeOf(anchor) : seriesCodeOf(row);
        const inCode = anchorIsOutgoing ? seriesCodeOf(row) : seriesCodeOf(anchor);
        const kind = seriesHandoffKind(outCode, inCode);
        const bound = anchorIsOutgoing ? seriesBoundMs(row, 'start') : seriesBoundMs(row, 'end');
        return { row, kind, dist: Math.abs(bound - targetMs), fichaje: fichajeMs(row) };
    }).filter((row) => row.kind !== 'REJECT');
    if (!scored.length)
        return null;
    scored.sort((a, b) => {
        const ka = a.kind === 'SERIES' ? 0 : 1;
        const kb = b.kind === 'SERIES' ? 0 : 1;
        if (ka !== kb)
            return ka - kb;
        if (a.dist !== b.dist)
            return a.dist - b.dist;
        return b.fichaje - a.fichaje;
    });
    return scored[0].row;
}
function relieverFor(outgoing, candidates, opts) {
    const outgoingEnd = seriesBoundMs(outgoing, 'end');
    if (!outgoingEnd)
        return null;
    const pool = candidates.filter((candidate) => {
        if (!candidate)
            return false;
        if (candidate.id && outgoing.id && candidate.id === outgoing.id)
            return false;
        if (!(0, reliefEligibility_1.isReliefEligibleShift)(candidate))
            return false;
        if (!reliefPositionsMatch(candidate.positionName, outgoing.positionName))
            return false;
        const start = seriesBoundMs(candidate, 'start');
        return incomingStartsInWindow(start, outgoingEnd, opts);
    });
    return rankRows(pool, outgoing, true, outgoingEnd);
}
function outgoingFor(incoming, candidates, opts) {
    const gapStart = seriesBoundMs(incoming, 'start');
    if (!gapStart)
        return null;
    const align = opts?.alignMs ?? exports.SHIFT_SERIES_ALIGN_MS;
    const pool = candidates.filter((candidate) => {
        if (!candidate)
            return false;
        if (candidate.id && incoming.id && candidate.id === incoming.id)
            return false;
        if (!(0, reliefEligibility_1.isReliefEligibleShift)(candidate))
            return false;
        if (!reliefPositionsMatch(candidate.positionName, incoming.positionName))
            return false;
        const start = seriesBoundMs(candidate, 'start');
        const end = seriesBoundMs(candidate, 'end');
        if (start <= 0 || start >= gapStart - 60_000)
            return false;
        if (!end || Math.abs(end - gapStart) > align)
            return false;
        return true;
    });
    return rankRows(pool, incoming, false, gapStart);
}
//# sourceMappingURL=shiftSeries.js.map