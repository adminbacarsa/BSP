"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLiquidacionSnapshot = buildLiquidacionSnapshot;
const admin = require("firebase-admin");
const cycle_1 = require("./cycle");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const SHIFT_HOURS_FALLBACK = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, GU: 8, FT: 8, EN: 9, RO: 10,
};
const RRHH_CODE_MAP = {
    V: 'vacacionesDias',
    L: 'licenciaEspecialDias',
    E: 'enfermedadDias',
    A: 'art',
    PG: 'permisoGremialDias',
    AA: 'injustificadaDias',
    RA: 'retiroAnticipadoDias',
};
const RRHH_TYPE_LABEL_TO_CODE = {
    VACACIONES: 'V',
    ENFERMEDAD: 'E',
    ART: 'A',
    'LICENCIA ESP.': 'L',
    'LICENCIA ESPECIAL': 'L',
    'PG PERMISO GREMIAL': 'PG',
    'PERMISO GREMIAL': 'PG',
    INJUSTIFICADA: 'AA',
    'RETIRO ANTICIPADO': 'RA',
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
    if (typeof val === 'number' && Number.isFinite(val)) {
        return new Date(val > 1e12 ? val : val * 1000);
    }
    if (typeof val === 'string') {
        const s = val.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return new Date(`${s}T00:00:00.000-03:00`);
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
};
const dateKeyAR = (d) => {
    const ar = new Date(d.getTime() - 3 * 3600 * 1000);
    const y = ar.getUTCFullYear();
    const m = String(ar.getUTCMonth() + 1).padStart(2, '0');
    const day = String(ar.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
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
        const arH = new Date(cur.getTime() - 3 * 3600 * 1000).getUTCHours();
        if (arH >= 21 || arH < 6)
            mins++;
        cur.setMinutes(cur.getMinutes() + 1);
        safety++;
    }
    return mins / 60;
};
const clampStart = (real, plan, tolMin = 5) => (real.getTime() - plan.getTime()) / 60000 <= tolMin ? plan : real;
const clampEnd = (real, plan, tolMin = 5) => Math.abs((real.getTime() - plan.getTime()) / 60000) <= tolMin ? plan : real;
const overlapsDay = (rangeStart, rangeEnd, dayStr) => {
    const dayStart = new Date(`${dayStr}T00:00:00.000-03:00`);
    const dayEnd = new Date(`${dayStr}T23:59:59.999-03:00`);
    return rangeStart.getTime() <= dayEnd.getTime() && rangeEnd.getTime() >= dayStart.getTime();
};
const datesBetween = (start, end) => {
    const out = [];
    let curKey = dateKeyAR(start);
    const endKey = dateKeyAR(end);
    let safety = 0;
    while (curKey <= endKey && safety < 800) {
        out.push(curKey);
        const [y, m, d] = curKey.split('-').map(Number);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        curKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
        safety++;
    }
    return out;
};
const normEmpresa = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
async function buildLiquidacionSnapshot(params) {
    const db = admin.firestore();
    const { cycle, empresaId } = params;
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(500, Math.max(1, params.pageSize || 100));
    const hoursMode = params.hoursMode === 'planned' ? 'planned' : 'real';
    const { scopeEmpresa, migracionCompleta } = await (0, assistantEmpresaScope_1.resolveAssistantEmpresaScope)(db, empresaId);
    const empDocs = await (0, assistantEmpresaScope_1.queryEmpleadosDocsScoped)(db, empresaId, scopeEmpresa, 5000);
    const empMap = new Map();
    const empIdByLegajo = new Map();
    for (const d of empDocs) {
        const data = d.data();
        if (!(0, assistantEmpresaScope_1.belongsToEmpresaView)(data, empresaId, migracionCompleta))
            continue;
        const st = String(data.status || '').toLowerCase();
        if (st === 'inactive' || st === 'inactivo')
            continue;
        empMap.set(d.id, { id: d.id, ...data });
        const legajo = String(data.fileNumber || data.legajo || '').trim();
        if (legajo && !empIdByLegajo.has(legajo))
            empIdByLegajo.set(legajo, d.id);
    }
    const resolveEmpId = (raw) => {
        if (!raw || raw === 'VACANTE')
            return null;
        if (empMap.has(raw))
            return raw;
        return empIdByLegajo.get(raw) || null;
    };
    const holidaysSnap = await db.collection('feriados').get();
    const holidays = new Set();
    holidaysSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string')
            holidays.add(v.slice(0, 10));
    });
    const tStart = (0, cycle_1.toTs)(cycle.cycleStart);
    const tEnd = (0, cycle_1.toTs)(cycle.cycleEnd);
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();
    let turnosDocs = turnosSnap.docs;
    try {
        const bySched = await db
            .collection('turnos')
            .where('scheduleDate', '>=', cycle.cycleStartStr)
            .where('scheduleDate', '<=', cycle.cycleEndStr)
            .get();
        const seen = new Set(turnosDocs.map((d) => d.id));
        for (const d of bySched.docs) {
            if (!seen.has(d.id))
                turnosDocs.push(d);
        }
    }
    catch {
    }
    const ausenciasSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();
    const lockDoc = await db.collection('payroll_cycles_locks').doc(cycle.cycleId).get();
    const lockedAtRaw = lockDoc.exists ? lockDoc.data()?.lockedAt : null;
    const lockedAt = lockedAtRaw ? tsToDate(lockedAtRaw)?.toISOString() ?? null : null;
    const acc = new Map();
    const diagnostics = {
        empleadosEmpresa: empMap.size,
        turnosEnRango: turnosDocs.length,
        turnosContados: 0,
        turnosDescartadosEmpresa: 0,
        turnosDescartadosEmpleado: 0,
        turnosSinHorario: 0,
        turnosBorrador: 0,
        ausenciasContadas: 0,
    };
    const isOperationalTurno = (data) => data?.origin === 'RETEN' ||
        data?.origin === 'OPERATIONS_COVERAGE' ||
        data?.origin === 'SLA_VIRTUAL' ||
        !!data?.isReten ||
        data?.resolvedBy === 'OPERACIONES';
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
                retiroAnticipadoDias: 0,
                otrosDias: 0,
            },
        };
        acc.set(empId, cur);
        return cur;
    };
    const turnoBelongs = (data) => {
        const docEmp = String(data.empresaId ?? '').trim();
        if (!scopeEmpresa) {
            if (!docEmp)
                return true;
            return (0, assistantEmpresaScope_1.tenantEmpresaIdsMatch)(docEmp, empresaId) || normEmpresa(docEmp) === 'bacarsa';
        }
        return (0, assistantEmpresaScope_1.belongsToEmpresaView)(data, empresaId, migracionCompleta);
    };
    turnosDocs.forEach((doc) => {
        const data = doc.data();
        if (!data)
            return;
        if (!turnoBelongs(data)) {
            diagnostics.turnosDescartadosEmpresa++;
            return;
        }
        if (params.clientIdFilter && data.clientId !== params.clientIdFilter)
            return;
        if (data.draft === true) {
            diagnostics.turnosBorrador++;
            if (hoursMode !== 'planned' && !isOperationalTurno(data))
                return;
        }
        if (data.isUnassigned === true)
            return;
        if (String(data.type || '').toUpperCase() === 'NOVEDAD')
            return;
        const empId = resolveEmpId(String(data.employeeId || '').trim());
        if (!empId) {
            diagnostics.turnosDescartadosEmpleado++;
            return;
        }
        const codeRaw = String(data.code || '').trim().toUpperCase();
        const code = codeRaw.includes('/') ? codeRaw.split('/')[0] : codeRaw;
        const status = String(data.status || '').toUpperCase();
        if (status === 'CANCELED' || status === 'CANCELLED')
            return;
        const a = getAcc(empId);
        a.turnosCount++;
        diagnostics.turnosContados++;
        let start = tsToDate(data.startTime);
        let end = tsToDate(data.endTime);
        if ((!start || !end) && data.scheduleDate) {
            const ds = String(data.scheduleDate).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
                const h = SHIFT_HOURS_FALLBACK[code] ?? 8;
                if (!start)
                    start = new Date(`${ds}T07:00:00.000-03:00`);
                if (!end)
                    end = new Date(start.getTime() + h * 3600000);
            }
        }
        if (!start || !end) {
            diagnostics.turnosSinHorario++;
            a.warnings.push(`Turno ${doc.id} sin startTime/endTime válidos.`);
            return;
        }
        const isFT = data.isFrancoTrabajado === true || code === 'FT' || codeRaw === 'FT';
        const isAbsent = hoursMode !== 'planned' && (data.isAbsent === true ||
            status === 'ABSENT' ||
            (status === '' && code === 'AA'));
        const isUnjustAbsent = !PAID_LEAVE.has(code) && isAbsent;
        const zeroHours = (!isFT && ZERO_HOUR_CODES.has(code)) || isUnjustAbsent;
        let plannedDur = 0;
        if (!zeroHours || isFT) {
            const hoursField = Number(data.hours);
            if (Number.isFinite(hoursField) && hoursField > 0 && hoursField <= 24) {
                plannedDur = hoursField;
            }
            else {
                plannedDur = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
                if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) {
                    plannedDur = SHIFT_HOURS_FALLBACK[code] ?? 8;
                }
            }
        }
        if (!isFT)
            a.hsTeoricas += plannedDur;
        if (zeroHours && !isFT)
            return;
        let workStart;
        let workEnd;
        let workDur;
        if (hoursMode === 'planned') {
            workStart = start;
            workEnd = end;
            workDur = plannedDur;
        }
        else {
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
            if (rDur == null) {
                a.warnings.push(`Turno ${doc.id} (${codeRaw} ${dateKeyAR(start)}) sin fichada — no suma a Hs Reales.`);
                return;
            }
            workStart = rStart;
            workEnd = rEnd;
            workDur = rDur;
        }
        a.turnosConFichada++;
        if (isFT) {
            a.al100FT += workDur;
        }
        else {
            a.hsReales += workDur;
            const night = getNightDuration(workStart, workEnd);
            const day = Math.max(0, workDur - night);
            a.diurnas += day;
            a.nocturnas += night;
            if (holidays.has(dateKeyAR(start)))
                a.plusFeriado += workDur;
        }
    });
    ausenciasSnap.forEach((doc) => {
        const data = doc.data();
        if (!data)
            return;
        if (!turnoBelongs(data))
            return;
        const status = String(data.status || '').toUpperCase();
        if (status === 'PENDIENTE' || status === 'PENDING' || status === 'REJECTED' || status === 'RECHAZADA') {
            return;
        }
        const empId = resolveEmpId(String(data.employeeId || '').trim());
        if (!empId)
            return;
        const startStr = String(data.startDate || '').slice(0, 10);
        const endStr = String(data.endDate || startStr).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr))
            return;
        const start = tsToDate(startStr);
        const end = tsToDate(endStr) || start;
        if (!start || !end)
            return;
        if (end < cycle.cycleStart || start > cycle.cycleEnd)
            return;
        const allDays = datesBetween(start, end);
        let count = 0;
        for (const dStr of allDays) {
            if (overlapsDay(cycle.cycleStart, cycle.cycleEnd, dStr))
                count++;
        }
        if (count <= 0)
            return;
        const a = getAcc(empId);
        diagnostics.ausenciasContadas++;
        const raw = String(data.absenceType || data.codigo || data.type || '').trim();
        const upper = raw.toUpperCase();
        const code = RRHH_CODE_MAP[upper]
            ? upper
            : (RRHH_TYPE_LABEL_TO_CODE[upper] || upper);
        const mappedField = RRHH_CODE_MAP[code];
        if (mappedField) {
            a.rrhh[mappedField] += count;
        }
        else {
            a.rrhh.otrosDias += count;
        }
    });
    const allItems = [];
    for (const [empId, a] of acc) {
        const empData = a.emp || {};
        const fullName = empData.name ||
            (empData.firstName || empData.lastName
                ? `${empData.lastName || ''}, ${empData.firstName || ''}`.replace(/^,\s*/, '').trim()
                : '') ||
            'Sin Nombre';
        const dni = String(empData.dni || '').trim();
        const cuil = fmtCuil(empData.cuil || empData.cuit);
        const fileNumber = empData.fileNumber || empData.legajo
            ? String(empData.fileNumber || empData.legajo)
            : null;
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
    allItems.sort((x, y) => x.employee.fullName.localeCompare(y.employee.fullName, 'es'));
    const total = allItems.length;
    const startIdx = (page - 1) * pageSize;
    const items = allItems.slice(startIdx, startIdx + pageSize);
    return {
        cycleId: cycle.cycleId,
        cycleStart: cycle.cycleStartStr,
        cycleEnd: cycle.cycleEndStr,
        cctVersion: '422/05',
        hoursMode,
        generatedAt: new Date().toISOString(),
        lockedAt,
        empresaId,
        items,
        pagination: { page, pageSize, total },
        diagnostics,
    };
}
//# sourceMappingURL=calc.js.map