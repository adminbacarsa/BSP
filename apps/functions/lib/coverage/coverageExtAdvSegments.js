"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSplitTimesCct = defaultSplitTimesCct;
exports.hhmmPairToTimestamps = hhmmPairToTimestamps;
exports.resolveCoverageBandCode = resolveCoverageBandCode;
exports.dualExtAdvSegmentTimestamps = dualExtAdvSegmentTimestamps;
exports.titularAnchorFromShift = titularAnchorFromShift;
exports.extensionEndTimestamp = extensionEndTimestamp;
exports.adjustedStartTimestamp = adjustedStartTimestamp;
const firestore_1 = require("firebase-admin/firestore");
const arClock_1 = require("../common/arClock");
function defaultSplitTimesCct(band) {
    const b = String(band || 'M').toUpperCase();
    if (b === 'T') {
        return {
            gap: { from: '15:00', to: '23:00' },
            ext: { from: '15:00', to: '19:00' },
            adel: { from: '19:00', to: '23:00' },
        };
    }
    if (b === 'N' || b === 'N12') {
        return {
            gap: { from: '19:00', to: '07:00' },
            ext: { from: '19:00', to: '23:00' },
            adel: { from: '23:00', to: '07:00' },
        };
    }
    if (b === 'M' || b === 'D12') {
        return {
            gap: { from: '07:00', to: '15:00' },
            ext: { from: '07:00', to: '11:00' },
            adel: { from: '11:00', to: '15:00' },
        };
    }
    return {
        gap: { from: '15:00', to: '23:00' },
        ext: { from: '15:00', to: '19:00' },
        adel: { from: '19:00', to: '23:00' },
    };
}
function tsToDate(ts) {
    if (!ts)
        return null;
    if (ts instanceof firestore_1.Timestamp)
        return ts.toDate();
    if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
        return new Date(ts.seconds * 1000);
    }
    if (ts instanceof Date)
        return ts;
    return null;
}
function parseHm(hm) {
    const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
    return { h: h || 0, m: m || 0 };
}
function hhmmPairToTimestamps(anchor, fromHm, toHm) {
    const f = parseHm(fromHm);
    const t = parseHm(toHm);
    const startMs = (0, arClock_1.arHmOnDayMs)(anchor.getTime(), f.h, f.m);
    let endMs = (0, arClock_1.arHmOnDayMs)(anchor.getTime(), t.h, t.m);
    if (endMs <= startMs)
        endMs += 24 * 60 * 60 * 1000;
    return { start: firestore_1.Timestamp.fromMillis(startMs), end: firestore_1.Timestamp.fromMillis(endMs) };
}
function resolveCoverageBandCode(opts) {
    const c = String(opts.code || '').trim().toUpperCase();
    if (c && !['T', 'COBERTURA', ''].includes(c))
        return c;
    const d = tsToDate(opts.startTime);
    if (!d)
        throw new Error('Falta código de banda del titular');
    const h = (0, arClock_1.arHour)(d.getTime());
    if (h >= 6 && h < 14)
        return 'M';
    if (h >= 14 && h < 22)
        return 'T';
    return 'N';
}
function dualExtAdvSegmentTimestamps(opts) {
    const split = defaultSplitTimesCct(opts.gapBand);
    const extCov = hhmmPairToTimestamps(opts.titularAnchor, split.ext.from, split.ext.to);
    const advCov = hhmmPairToTimestamps(opts.titularAnchor, split.adel.from, split.adel.to);
    return {
        extCov: { ...extCov, extensionEndHm: split.ext.to },
        advCov: { ...advCov, adjustedStartHm: split.adel.from },
    };
}
function titularAnchorFromShift(titular) {
    const d = tsToDate(titular.startTime) || tsToDate(titular.endTime);
    if (d)
        return d;
    return new Date();
}
function extensionEndTimestamp(anchor, hm) {
    return hhmmPairToTimestamps(anchor, hm, hm).start;
}
function adjustedStartTimestamp(anchor, hm) {
    return hhmmPairToTimestamps(anchor, hm, hm).start;
}
//# sourceMappingURL=coverageExtAdvSegments.js.map