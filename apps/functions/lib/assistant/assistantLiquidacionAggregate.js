"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateLiquidacionEmpresaPeriodo = aggregateLiquidacionEmpresaPeriodo;
const firestore_1 = require("firebase-admin/firestore");
const assistantEmpresaScope_1 = require("./assistantEmpresaScope");
const PAID_LEAVE = new Set(['V', 'L', 'PG', 'E', 'A']);
const TRUE_NON_WORK = new Set(['F', 'FF', 'FP', 'AA', 'FT']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET']);
const SHIFT_HOURS_FALLBACK = {
    M: 8,
    T: 8,
    N: 8,
    D12: 12,
    N12: 12,
    PU: 12,
    GU: 8,
    FT: 0,
};
const AR_DAY_OFFSET = '-03:00';
const TURNOS_LIM = 4500;
function parseYmd(s) {
    const rex = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!rex)
        throw new Error('fecha_invalida');
    return { y: Number(rex[1]), m: Number(rex[2]), d: Number(rex[3]) };
}
function arRangeTimestamps(desde, hasta) {
    const p0 = parseYmd(desde);
    const p1 = parseYmd(hasta);
    const start = firestore_1.Timestamp.fromDate(new Date(`${p0.y}-${String(p0.m).padStart(2, '0')}-${String(p0.d).padStart(2, '0')}T00:00:00.000${AR_DAY_OFFSET}`));
    const end = firestore_1.Timestamp.fromDate(new Date(`${p1.y}-${String(p1.m).padStart(2, '0')}-${String(p1.d).padStart(2, '0')}T23:59:59.999${AR_DAY_OFFSET}`));
    return { start, end };
}
function tsToDate(val) {
    if (!val)
        return null;
    if (val instanceof firestore_1.Timestamp)
        return val.toDate();
    if (typeof val === 'object' && val !== null && 'toDate' in val && typeof val.toDate === 'function') {
        return val.toDate();
    }
    if (typeof val === 'object' && val !== null && 'seconds' in val) {
        const s = Number(val.seconds);
        if (Number.isFinite(s))
            return new Date(s * 1000);
    }
    return null;
}
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getNightDuration = (start, end) => {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start)
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
const round = (n) => Math.round(n * 10) / 10;
async function aggregateLiquidacionEmpresaPeriodo(db, empresaId, fechaDesde, fechaHasta, scopeEmpresa) {
    const { start, end } = arRangeTimestamps(fechaDesde, fechaHasta);
    const empDocs = await (0, assistantEmpresaScope_1.queryEmpleadosDocsScoped)(db, empresaId, scopeEmpresa, 900);
    const empMap = new Map();
    for (const d of empDocs) {
        const data = d.data();
        const name = String(data.name ?? '').trim() ||
            `${String(data.lastName ?? '').trim()}, ${String(data.firstName ?? '').trim()}`.trim() ||
            'Sin nombre';
        empMap.set(d.id, name);
    }
    const holidays = new Set();
    const holSnap = await db.collection('feriados').limit(400).get();
    holSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string')
            holidays.add(v);
    });
    const qsnap = await db
        .collection('turnos')
        .where('startTime', '>=', start)
        .where('startTime', '<=', end)
        .limit(TURNOS_LIM)
        .get();
    const byEmp = new Map();
    const global = {
        hsTeoricas: 0,
        hsReales: 0,
        diurnas: 0,
        nocturnas: 0,
        al100FT: 0,
        plusFeriado: 0,
        turnos: 0,
        fichadas: 0,
        ftTurnos: 0,
        sinFichada: 0,
    };
    const getAcc = (empId) => {
        let a = byEmp.get(empId);
        if (!a) {
            a = { hsTeoricas: 0, hsReales: 0, diurnas: 0, nocturnas: 0, al100FT: 0, plusFeriado: 0, turnos: 0, fichadas: 0, ftTurnos: 0 };
            byEmp.set(empId, a);
        }
        return a;
    };
    for (const doc of qsnap.docs) {
        const data = doc.data();
        if (data.draft === true)
            continue;
        if (data.isUnassigned === true)
            continue;
        const empId = String(data.employeeId ?? '').trim();
        if (!empId || empId === 'VACANTE' || !empMap.has(empId))
            continue;
        if (!(0, assistantEmpresaScope_1.turnoRowBelongsToEmpresa)(data, empresaId, scopeEmpresa))
            continue;
        const code = String(data.code ?? '').trim().toUpperCase();
        const status = String(data.status ?? '').toUpperCase();
        if (status === 'CANCELED' || status === 'CANCELLED')
            continue;
        if (String(data.type ?? '').toUpperCase() === 'NOVEDAD')
            continue;
        const startDt = tsToDate(data.startTime);
        const endDt = tsToDate(data.endTime);
        if (!startDt || !endDt)
            continue;
        const a = getAcc(empId);
        a.turnos++;
        global.turnos++;
        const isAbsent = data.isAbsent === true || status === 'ABSENT';
        const zeroHours = TRUE_NON_WORK.has(code) || ZERO_HOUR_CODES.has(code) || (isAbsent && !PAID_LEAVE.has(code));
        let plannedDur = 0;
        if (!zeroHours) {
            plannedDur = Math.max(0, (endDt.getTime() - startDt.getTime()) / 3600000);
            if (plannedDur === 0 || plannedDur > 24 || isNaN(plannedDur)) {
                plannedDur = SHIFT_HOURS_FALLBACK[code] ?? 8;
            }
        }
        a.hsTeoricas += plannedDur;
        global.hsTeoricas += plannedDur;
        if (zeroHours) {
            if (code === 'FT' || data.isFrancoTrabajado === true) {
                a.ftTurnos++;
                global.ftTurnos++;
            }
            continue;
        }
        const rStartRaw = tsToDate(data.realStartTime) ?? tsToDate(data.checkInTime);
        const rEndRaw = tsToDate(data.realEndTime) ?? tsToDate(data.checkOutTime);
        const rStart = rStartRaw ? clampStart(rStartRaw, startDt, 5) : null;
        const rEnd = rEndRaw ? clampEnd(rEndRaw, endDt, 5) : null;
        let rDur = null;
        if (rStart && rEnd) {
            const rd = (rEnd.getTime() - rStart.getTime()) / 3600000;
            if (rd >= 0 && rd <= 36)
                rDur = rd;
        }
        if (rDur == null) {
            global.sinFichada++;
            continue;
        }
        a.fichadas++;
        global.fichadas++;
        a.hsReales += rDur;
        global.hsReales += rDur;
        const night = getNightDuration(rStart, rEnd);
        const day = Math.max(0, rDur - night);
        a.diurnas += day;
        a.nocturnas += night;
        global.diurnas += day;
        global.nocturnas += night;
        const isFT = data.isFrancoTrabajado === true || code === 'FT';
        if (isFT) {
            a.al100FT += rDur;
            global.al100FT += rDur;
            a.ftTurnos++;
            global.ftTurnos++;
        }
        if (holidays.has(dateKey(startDt))) {
            a.plusFeriado += rDur;
            global.plusFeriado += rDur;
        }
    }
    let horasExtras = 0;
    for (const a of byEmp.values()) {
        horasExtras += Math.max(0, a.hsReales - a.hsTeoricas);
    }
    const bolsa = Math.max(0, global.hsReales - global.al100FT);
    const hsSimples = Math.min(bolsa, 200);
    const al50 = Math.max(0, bolsa - 200);
    const muestra = [...byEmp.entries()]
        .filter(([, a]) => a.hsReales > 0)
        .map(([id, a]) => ({
        id,
        nombre: empMap.get(id) ?? id,
        hs_reales: round(a.hsReales),
        diurnas: round(a.diurnas),
        nocturnas: round(a.nocturnas),
        al_50: round(Math.max(0, Math.max(0, a.hsReales - a.al100FT) - 200)),
        al_100_ft: round(a.al100FT),
    }))
        .sort((x, y) => y.hs_reales - x.hs_reales)
        .slice(0, 12);
    return {
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        empleados_con_fichada: [...byEmp.values()].filter((a) => a.fichadas > 0).length,
        empleados_con_turnos: byEmp.size,
        turnos_considerados: global.turnos,
        turnos_con_fichada: global.fichadas,
        turnos_ft: global.ftTurnos,
        hs_teoricas: round(global.hsTeoricas),
        hs_reales: round(global.hsReales),
        diurnas: round(global.diurnas),
        nocturnas: round(global.nocturnas),
        al_50: round(al50),
        al_100_ft: round(global.al100FT),
        plus_feriado: round(global.plusFeriado),
        bolsa_200: round(bolsa),
        hs_simples: round(hsSimples),
        horas_extras_reales_menos_teoricas: round(horasExtras),
        truncado_consulta_turnos: qsnap.size >= TURNOS_LIM,
        advertencias_sin_fichada: global.sinFichada,
        muestra_empleados: muestra,
    };
}
//# sourceMappingURL=assistantLiquidacionAggregate.js.map