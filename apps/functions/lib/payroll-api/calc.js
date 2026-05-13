"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLiquidacionSnapshot = buildLiquidacionSnapshot;
const admin = require("firebase-admin");
const cycle_1 = require("./cycle");
const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const TRUE_NON_WORK = new Set(['F', 'FF', 'FP', 'AA', 'FT']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const SHIFT_HOURS_FALLBACK = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, GU: 8, FT: 0,
};
const RRHH_CODE_MAP = {
    V: 'vacacionesDias',
    L: 'licenciaEspecialDias',
    E: 'enfermedadDias',
    A: 'art',
    PG: 'permisoGremialDias',
    AA: 'injustificadaDias',
};
const round = (n) => Math.round(n * 100) / 100;
const fmtCuil = (raw) => {
    if (!raw)
        return null;
    const s = String(raw).replace(/[^0-9]/g, '');
    if (s.length === 11)
        return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
    return String(raw);
};
const tsToDate = (val) => {
    if (!val)
        return null;
    if (val instanceof admin.firestore.Timestamp)
        return val.toDate();
    if (typeof val.toDate === 'function')
        return val.toDate();
    if (typeof val.seconds === 'number')
        return new Date(val.seconds * 1000);
    if (typeof val._seconds === 'number')
        return new Date(val._seconds * 1000);
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getNightDuration = (start, end) => {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()))
        return 0;
    if (end.getTime() <= start.getTime())
        return 0;
    let mins = 0;
    const cur = new Date(start.getTime());
    const endMs = end.getTime();
    let safety = 0;
    while (cur.getTime() < endMs && safety < 2880) {
        const h = cur.getHours();
        if (h >= 21 || h < 6)
            mins++;
        cur.setMinutes(cur.getMinutes() + 1);
        safety++;
    }
    return mins / 60;
};
const clampStart = (real, plan, tolMin = 5) => (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;
const clampEnd = (real, plan, tolMin = 5) => Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;
const overlapsDay = (start, end, dayStr) => {
    const [y, m, d] = dayStr.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    return start.getTime() <= dayEnd.getTime() && end.getTime() >= dayStart.getTime();
};
const datesBetween = (start, end) => {
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur.getTime() <= endNorm.getTime()) {
        out.push(dateKey(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
};
async function buildLiquidacionSnapshot(params) {
    const db = admin.firestore();
    const { cycle, empresaId } = params;
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize || 100));
    let empQuery = db.collection('empleados');
    if (empresaId)
        empQuery = empQuery.where('empresaId', '==', empresaId);
    const empSnap = await empQuery.get();
    const empMap = new Map();
    empSnap.forEach((d) => empMap.set(d.id, { id: d.id, ...d.data() }));
    const holidaysSnap = await db.collection('feriados').get();
    const holidays = new Set();
    holidaysSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string')
            holidays.add(v);
    });
    const tStart = (0, cycle_1.toTs)(cycle.cycleStart);
    const tEnd = (0, cycle_1.toTs)(cycle.cycleEnd);
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();
    const ausenciasSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();
    const lockDoc = await db.collection('payroll_cycles_locks').doc(cycle.cycleId).get();
    const lockedAtRaw = lockDoc.exists ? lockDoc.data()?.lockedAt : null;
    const lockedAt = lockedAtRaw ? tsToDate(lockedAtRaw)?.toISOString() ?? null : null;
    const acc = new Map();
    const getAcc = (empId) => {
        let cur = acc.get(empId);
        if (cur)
            return cur;
        cur = {
            emp: empMap.get(empId) || null,
            empId,
            hsTeoricas: 0,
            hsReales: 0,
            diurnas: 0,
            nocturnas: 0,
            al100FT: 0,
            plusFeriado: 0,
            turnosCount: 0,
            turnosConFichada: 0,
            warnings: [],
            rrhh: {
                vacacionesDias: 0,
                enfermedadDias: 0,
                art: 0,
                licenciaEspecialDias: 0,
                permisoGremialDias: 0,
                injustificadaDias: 0,
            },
        };
        acc.set(empId, cur);
        return cur;
    };
    turnosSnap.forEach((doc) => {
        const data = doc.data();
        if (!data)
            return;
        if (empresaId && data.empresaId && data.empresaId !== empresaId)
            return;
        if (params.clientIdFilter && data.clientId !== params.clientIdFilter)
            return;
        if (data.draft === true)
            return;
        if (data.isUnassigned === true)
            return;
        const empId = data.employeeId;
        if (!empId || empId === 'VACANTE')
            return;
        if (empresaId && !empMap.has(empId))
            return;
        const code = String(data.code || '').trim().toUpperCase();
        const status = String(data.status || '').toUpperCase();
        if (status === 'CANCELED' || status === 'CANCELLED')
            return;
        const a = getAcc(empId);
        a.turnosCount++;
        const start = tsToDate(data.startTime);
        const end = tsToDate(data.endTime);
        if (!start || !end) {
            a.warnings.push(`Turno ${doc.id} sin startTime/endTime válidos.`);
            return;
        }
        const isAbsent = data.isAbsent === true ||
            status === 'ABSENT' ||
            (status === '' && code === 'AA');
        const isUnjustAbsent = !PAID_LEAVE.has(code) && isAbsent;
        const zeroHours = TRUE_NON_WORK.has(code) || isUnjustAbsent || ZERO_HOUR_CODES.has(code);
        let plannedDur = 0;
        if (!zeroHours) {
            plannedDur = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
            if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) {
                plannedDur = SHIFT_HOURS_FALLBACK[code] ?? 8;
            }
        }
        a.hsTeoricas += plannedDur;
        const rStartRaw = tsToDate(data.realStartTime) ?? tsToDate(data.checkInTime);
        const rEndRaw = tsToDate(data.realEndTime) ?? tsToDate(data.checkOutTime);
        const rStart = rStartRaw ? clampStart(rStartRaw, start, 5) : null;
        const rEnd = rEndRaw ? clampEnd(rEndRaw, end, 5) : null;
        let rDur = null;
        if (rStart && rEnd) {
            const rd = (rEnd.getTime() - rStart.getTime()) / 3600000;
            if (rd >= 0 && rd <= 36)
                rDur = rd;
        }
        if (zeroHours) {
            return;
        }
        if (rDur == null) {
            a.warnings.push(`Turno ${doc.id} (${code} ${dateKey(start)}) sin fichada — no suma a Hs Reales.`);
            return;
        }
        a.turnosConFichada++;
        a.hsReales += rDur;
        const night = getNightDuration(rStart, rEnd);
        const day = Math.max(0, rDur - night);
        a.diurnas += day;
        a.nocturnas += night;
        const isFT = data.isFrancoTrabajado === true || code === 'FT';
        if (isFT)
            a.al100FT += rDur;
        if (holidays.has(dateKey(start)))
            a.plusFeriado += rDur;
    });
    ausenciasSnap.forEach((doc) => {
        const data = doc.data();
        if (!data)
            return;
        if (empresaId && data.empresaId && data.empresaId !== empresaId)
            return;
        const status = String(data.status || '').toUpperCase();
        if (status !== 'APPROVED' && status !== '')
            return;
        const empId = data.employeeId;
        if (!empId)
            return;
        if (empresaId && !empMap.has(empId))
            return;
        const startStr = String(data.startDate || '');
        const endStr = String(data.endDate || startStr);
        if (!startStr)
            return;
        const start = tsToDate(startStr);
        const end = tsToDate(endStr) || start;
        if (!start || !end)
            return;
        if (end < cycle.cycleStart || start > cycle.cycleEnd)
            return;
        const a = getAcc(empId);
        const code = String(data.absenceType || data.codigo || '').toUpperCase();
        const mappedField = RRHH_CODE_MAP[code];
        if (!mappedField)
            return;
        const allDays = datesBetween(start, end);
        let count = 0;
        for (const dStr of allDays) {
            if (overlapsDay(cycle.cycleStart, cycle.cycleEnd, dStr))
                count++;
        }
        if (count > 0)
            a.rrhh[mappedField] += count;
    });
    const allItems = [];
    for (const [empId, a] of acc) {
        const empData = a.emp || {};
        const fullName = empData.name ||
            (empData.firstName ? `${empData.lastName || ''}, ${empData.firstName}`.trim() : '') ||
            'Sin Nombre';
        const dni = String(empData.dni || '').trim();
        const cuil = fmtCuil(empData.cuil || empData.cuit);
        const fileNumber = empData.fileNumber ? String(empData.fileNumber) : null;
        const laborAgreement = empData.laborAgreement ? String(empData.laborAgreement) : null;
        const bolsa = Math.max(0, a.hsReales - a.al100FT);
        const hsSimples = Math.min(bolsa, 200);
        const al50 = Math.max(0, bolsa - 200);
        allItems.push({
            employee: { id: empId, dni, cuil, fileNumber, fullName, laborAgreement },
            acumulado: {
                hsTeoricas: round(a.hsTeoricas),
                hsReales: round(a.hsReales),
                diurnas: round(a.diurnas),
                nocturnas: round(a.nocturnas),
                al50: round(al50),
                al100FT: round(a.al100FT),
                plusFeriado: round(a.plusFeriado),
            },
            liquidacion200: {
                bolsa: round(bolsa),
                hsSimples: round(hsSimples),
                al50: round(al50),
                nota: 'FT y Feriados se pagan aparte.',
            },
            pagaAparte: {
                francoTrabajado100: round(a.al100FT),
                plusFeriado: round(a.plusFeriado),
            },
            novedadesRRHH: a.rrhh,
            turnosCount: a.turnosCount,
            turnosConFichada: a.turnosConFichada,
            warnings: a.warnings,
        });
    }
    allItems.sort((x, y) => x.employee.fullName.localeCompare(y.employee.fullName));
    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);
    return {
        cycleId: cycle.cycleId,
        cycleStart: cycle.cycleStartStr,
        cycleEnd: cycle.cycleEndStr,
        cctVersion: '422/05',
        generatedAt: new Date().toISOString(),
        lockedAt,
        empresaId,
        items,
        pagination: { page, pageSize, total },
    };
}
//# sourceMappingURL=calc.js.map