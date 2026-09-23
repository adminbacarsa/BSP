"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.positionHasContinuityFromSlaDoc = positionHasContinuityFromSlaDoc;
exports.loadPositionHasContinuity = loadPositionHasContinuity;
const types_1 = require("../cerebro/types");
const s1_leer_sla_1 = require("../cerebro/inteligencia-servicio/s1-leer-sla");
const TZ = 'America/Argentina/Cordoba';
const CONTINUITY_WINDOW_MS = 30 * 60 * 1000;
const normPos = (n) => String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
function posMatch(a, b) {
    const na = normPos(a);
    const nb = normPos(b);
    if (!na || !nb)
        return false;
    if (na === nb)
        return true;
    if (na.endsWith(nb) || nb.endsWith(na))
        return true;
    return false;
}
function ymdInTz(d) {
    return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
function weekdayLetter(d) {
    const en = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
    const map = {
        Mon: 'L',
        Tue: 'M',
        Wed: 'X',
        Thu: 'J',
        Fri: 'V',
        Sat: 'S',
        Sun: 'D',
    };
    return map[en] || 'L';
}
function hmToMsOnDay(anchor, hm) {
    const [h, m] = String(hm || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(anchor);
    const y = parts.find((p) => p.type === 'year')?.value || '1970';
    const mo = parts.find((p) => p.type === 'month')?.value || '01';
    const da = parts.find((p) => p.type === 'day')?.value || '01';
    const iso = `${y}-${mo}-${da}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    const utcGuess = Date.parse(`${iso}-03:00`);
    if (!Number.isNaN(utcGuess))
        return utcGuess;
    return anchor.getTime();
}
function positionHasContinuityFromSlaDoc(slaDoc, positionName, shiftEndTime) {
    if (!slaDoc)
        return false;
    const sla = (0, types_1.normalizarSlaDeFirestore)({ ...slaDoc, id: slaDoc.id || 'sla' });
    const needs = (0, s1_leer_sla_1.leerSlaYDerivarCobertura)(sla);
    const endMs = shiftEndTime.getTime();
    const dateStr = ymdInTz(shiftEndTime);
    const dayLetter = weekdayLetter(shiftEndTime);
    for (const need of needs) {
        if (!posMatch(need.puestoName, positionName))
            continue;
        if (need.excludedDates?.includes(dateStr))
            continue;
        if (!need.diasSemana.includes(dayLetter))
            continue;
        const startMs = hmToMsOnDay(shiftEndTime, need.horaInicio);
        const diff = Math.abs(startMs - endMs);
        if (diff <= CONTINUITY_WINDOW_MS)
            return true;
    }
    return false;
}
async function loadPositionHasContinuity(db, objectiveId, positionName, shiftEndTime) {
    const oid = String(objectiveId || '').trim();
    if (!oid)
        return false;
    const slaSnap = await db
        .collection('servicios_sla')
        .where('objectiveId', '==', oid)
        .where('status', '==', 'active')
        .limit(3)
        .get();
    for (const d of slaSnap.docs) {
        if (positionHasContinuityFromSlaDoc(d.data(), positionName, shiftEndTime)) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=positionHasContinuity.js.map