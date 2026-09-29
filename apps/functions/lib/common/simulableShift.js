"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectiveOperationCache = exports.FRANCO_SHIFT_CODES = exports.LICENSE_SHIFT_CODES = void 0;
exports.shiftGridCode = shiftGridCode;
exports.isLicenseShiftCode = isLicenseShiftCode;
exports.isFrancoShiftCode = isFrancoShiftCode;
exports.isLicenseShift = isLicenseShift;
exports.simulableShiftSkipReason = simulableShiftSkipReason;
exports.isSimulableShift = isSimulableShift;
exports.contractCalendarYmd = contractCalendarYmd;
exports.shiftStartMs = shiftStartMs;
exports.simulableShiftSkipReasonResolved = simulableShiftSkipReasonResolved;
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const arClock_1 = require("./arClock");
const planificacionEstadoKeys_1 = require("../assistant/planificacionEstadoKeys");
exports.LICENSE_SHIFT_CODES = new Set([
    'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);
exports.FRANCO_SHIFT_CODES = new Set(['F', 'FF', 'FP']);
function normalizeCode(value) {
    return String(value ?? '').trim().toUpperCase();
}
function shiftGridCode(data) {
    if (!data)
        return '';
    return normalizeCode(data.code) || normalizeCode(data.shiftCode);
}
function isLicenseShiftCode(code) {
    return exports.LICENSE_SHIFT_CODES.has(normalizeCode(code));
}
function isFrancoShiftCode(code) {
    return exports.FRANCO_SHIFT_CODES.has(normalizeCode(code));
}
function isLicenseShift(data) {
    return isLicenseShiftCode(shiftGridCode(data));
}
function simulableShiftSkipReason(data, opts) {
    if (!data)
        return 'VIRTUAL';
    if (data.draft === true)
        return 'DRAFT';
    if (data.isVirtual === true)
        return 'VIRTUAL';
    if ((0, coverageTraceShift_1.isOpsCoverageHoursOnSourceDoc)(data))
        return 'OPS_COV_TRACE';
    if ((0, coverageTraceShift_1.isFrancoCoverageOriginDoc)(data))
        return 'FRANCO_ORIGEN';
    const code = shiftGridCode(data);
    if (isLicenseShiftCode(code))
        return 'LICENCIA';
    if (data.isFranco === true || isFrancoShiftCode(code))
        return 'FRANCO';
    if (opts?.inOperation === false)
        return 'FUERA_OPERACION';
    return null;
}
function isSimulableShift(data, opts) {
    return simulableShiftSkipReason(data, opts) === null;
}
function pad2(n) {
    return String(n).padStart(2, '0');
}
function contractCalendarYmd(value) {
    if (value == null || value === '')
        return '';
    if (typeof value === 'string')
        return value.trim().slice(0, 10);
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()))
            return '';
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'object') {
        const o = value;
        if (typeof o.toDate === 'function') {
            const d = o.toDate();
            if (d && !Number.isNaN(d.getTime()))
                return d.toISOString().slice(0, 10);
        }
        const sec = o.seconds ?? o._seconds;
        if (typeof sec === 'number')
            return new Date(sec * 1000).toISOString().slice(0, 10);
    }
    return String(value).trim().slice(0, 10);
}
function contractActive(status) {
    const st = String(status ?? '').trim().toLowerCase();
    if (!st)
        return true;
    return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}
function clientIsActive(data) {
    if (!data)
        return true;
    if (data.active === false)
        return false;
    const u = String(data.status ?? 'ACTIVO').trim().toUpperCase();
    return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
}
function slaMonthRange(data) {
    if (!contractActive(data.status))
        return null;
    const startRaw = contractCalendarYmd(data.startDate);
    const endRaw = contractCalendarYmd(data.endDate);
    if (!startRaw && !endRaw)
        return null;
    return { start: startRaw || '1970-01-01', end: endRaw || '2099-12-31' };
}
function overlapsMonth(start, end, year, month) {
    const from = `${year}-${pad2(month)}-01`;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${year}-${pad2(month)}-${pad2(last)}`;
    return start <= to && end >= from;
}
function shiftStartMs(data) {
    if (!data)
        return 0;
    const raw = data.startTime;
    if (!raw)
        return 0;
    if (typeof raw === 'number')
        return raw;
    if (raw instanceof Date)
        return raw.getTime();
    if (typeof raw === 'string') {
        const ms = Date.parse(raw);
        return Number.isNaN(ms) ? 0 : ms;
    }
    if (typeof raw.toMillis === 'function')
        return raw.toMillis();
    if (typeof raw.toDate === 'function')
        return raw.toDate().getTime();
    const sec = raw.seconds ?? raw._seconds;
    if (typeof sec === 'number')
        return sec * 1000;
    return 0;
}
class ObjectiveOperationCache {
    constructor() {
        this.slasByEmpresa = new Map();
        this.clientsByEmpresa = new Map();
        this.monthCache = new Map();
    }
    async isShiftInOperation(db, shift) {
        if (!shift)
            return false;
        const empresaId = String(shift.empresaId ?? '').trim();
        const objectiveId = String(shift.objectiveId ?? '').trim();
        const ms = shiftStartMs(shift);
        if (!empresaId || !objectiveId || !ms)
            return false;
        const ymd = (0, arClock_1.arYmd)(ms);
        const { year, month } = (0, arClock_1.arYearMonth)(ms);
        const entry = await this.monthEntry(db, empresaId, objectiveId, year, month);
        if (!entry.published)
            return false;
        return entry.ranges.some((r) => ymd >= r.start && ymd <= r.end);
    }
    async monthEntry(db, empresaId, objectiveId, year, month) {
        const key = `${empresaId}|${objectiveId}|${year}|${month}`;
        const hit = this.monthCache.get(key);
        if (hit)
            return hit;
        const [published, slas, clients] = await Promise.all([
            this.isPlanPublished(db, empresaId, objectiveId, year, month),
            this.loadSlas(db, empresaId),
            this.loadClients(db, empresaId),
        ]);
        const ranges = [];
        if (published) {
            for (const doc of slas) {
                const data = doc.data();
                if (String(data.objectiveId ?? '').trim() !== objectiveId)
                    continue;
                const clientId = String(data.clientId ?? '').trim();
                const client = clientId ? clients.get(clientId) : undefined;
                if (clientId && clients.has(clientId) && !clientIsActive(client))
                    continue;
                if (!clientId && !clientIsActive(undefined))
                    continue;
                const range = slaMonthRange(data);
                if (!range)
                    continue;
                if (!overlapsMonth(range.start, range.end, year, month))
                    continue;
                ranges.push(range);
            }
        }
        const entry = { published, ranges };
        this.monthCache.set(key, entry);
        return entry;
    }
    async isPlanPublished(db, empresaId, objectiveId, year, month) {
        const docIds = (0, planificacionEstadoKeys_1.planificacionEstadoLookupDocIds)(empresaId, objectiveId, year, month);
        const docs = await Promise.all(docIds.map((id) => db.collection('planificacion_estados').doc(id).get()));
        return docs.some((d) => {
            if (!d.exists)
                return false;
            const pub = d.data()?.publishedAt;
            return pub != null && pub !== '';
        });
    }
    async loadSlas(db, empresaId) {
        const hit = this.slasByEmpresa.get(empresaId);
        if (hit)
            return hit;
        const snap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
        const docs = snap.docs.map((d) => ({ data: () => d.data() }));
        this.slasByEmpresa.set(empresaId, docs);
        return docs;
    }
    async loadClients(db, empresaId) {
        const hit = this.clientsByEmpresa.get(empresaId);
        if (hit)
            return hit;
        const snap = await db.collection('clients').where('empresaId', '==', empresaId).get();
        const map = new Map();
        snap.docs.forEach((d) => map.set(d.id, d.data()));
        this.clientsByEmpresa.set(empresaId, map);
        return map;
    }
}
exports.ObjectiveOperationCache = ObjectiveOperationCache;
async function simulableShiftSkipReasonResolved(db, data, cache = new ObjectiveOperationCache()) {
    const base = simulableShiftSkipReason(data);
    if (base)
        return base;
    const inOperation = await cache.isShiftInOperation(db, data);
    return simulableShiftSkipReason(data, { inOperation });
}
//# sourceMappingURL=simulableShift.js.map