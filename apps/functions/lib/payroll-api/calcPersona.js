"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLiquidacionSnapshotPersona = buildLiquidacionSnapshotPersona;
const cycle_1 = require("./cycle");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
const hours_core_1 = require("@cosp/hours-core");
const calc_1 = require("./calc");
const normEmpresa = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');
const emptyRrhh = () => ({
    vacacionesDias: 0,
    enfermedadDias: 0,
    art: 0,
    licenciaEspecialDias: 0,
    permisoGremialDias: 0,
    injustificadaDias: 0,
    retiroAnticipadoDias: 0,
    otrosDias: 0,
});
async function buildLiquidacionSnapshotPersona(params) {
    const { db, cycle, empresaId, scopeEmpresa, migracionCompleta, page, pageSize, hoursMode } = params;
    const empDocs = await (0, assistantEmpresaScope_1.queryEmpleadosDocsScoped)(db, empresaId, scopeEmpresa, 5000);
    const empNameById = {};
    const empDataById = new Map();
    empDocs.forEach((d) => {
        const data = d.data();
        if (!(0, assistantEmpresaScope_1.belongsToEmpresaView)(data, empresaId, migracionCompleta))
            return;
        const st = String(data.status || '').toLowerCase();
        if (st === 'inactive' || st === 'inactivo')
            return;
        empDataById.set(d.id, data);
        empNameById[d.id] = (0, hours_core_1.personaEmployeeDisplayName)(data);
    });
    const holidaysSnap = await db.collection('feriados').get();
    const holidays = {};
    holidaysSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string')
            holidays[v.slice(0, 10)] = true;
    });
    const tStart = (0, cycle_1.toTs)(cycle.cycleStart);
    const tEnd = (0, cycle_1.toTs)(cycle.cycleEnd);
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();
    const turnosDocs = turnosSnap.docs.slice();
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
    const turnoBelongs = (data) => {
        const docEmp = String(data.empresaId ?? '').trim();
        if (!scopeEmpresa) {
            if (!docEmp)
                return true;
            return (0, assistantEmpresaScope_1.tenantEmpresaIdsMatch)(docEmp, empresaId) || normEmpresa(docEmp) === 'bacarsa';
        }
        return (0, assistantEmpresaScope_1.belongsToEmpresaView)(data, empresaId, migracionCompleta);
    };
    const turnos = [];
    let turnosDescartadosEmpresa = 0;
    for (const doc of turnosDocs) {
        const data = doc.data();
        if (!data)
            continue;
        if (!turnoBelongs(data)) {
            turnosDescartadosEmpresa++;
            continue;
        }
        if (params.clientIdFilter && data.clientId !== params.clientIdFilter)
            continue;
        turnos.push({ id: doc.id, ...data });
    }
    const ausenciasSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();
    const ausencias = [];
    ausenciasSnap.forEach((doc) => {
        const data = doc.data();
        if (!data)
            return;
        if (!turnoBelongs(data))
            return;
        const status = String(data.status || '').toUpperCase();
        if (status === 'PENDIENTE' || status === 'PENDING' || status === 'REJECTED' || status === 'RECHAZADA')
            return;
        ausencias.push({ id: doc.id, ...data });
    });
    const planifSnap = await db.collection('planificacion_estados').get();
    const publishStatusMap = (0, hours_core_1.buildPersonaPublishStatusMap)(planifSnap.docs
        .filter((d) => (0, assistantEmpresaScope_1.belongsToEmpresaView)(d.data(), empresaId, migracionCompleta))
        .map((d) => d.id));
    const lockDoc = await db.collection('payroll_cycles_locks').doc(cycle.cycleId).get();
    const lockedAtRaw = lockDoc.exists ? lockDoc.data()?.lockedAt : null;
    const lockedAt = lockedAtRaw ? (0, calc_1.tsToDate)(lockedAtRaw)?.toISOString() ?? null : null;
    const book = (0, hours_core_1.buildPersonaBook)({
        turnos,
        ausencias,
        publishStatusMap,
        rangeStartYmd: cycle.cycleStartStr,
        rangeEndYmd: cycle.cycleEndStr,
        empNameById,
        holidays,
        usePlannedHours: hoursMode === 'planned',
        publishFilter: 'all',
    });
    const rrhhByEmp = new Map();
    for (const abs of ausencias) {
        const empId = String(abs.employeeId || '').trim();
        if (!empNameById[empId])
            continue;
        const startStr = String(abs.startDate || '').slice(0, 10);
        const endStr = String(abs.endDate || startStr).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr))
            continue;
        const start = (0, calc_1.tsToDate)(startStr);
        const end = (0, calc_1.tsToDate)(endStr) || start;
        if (!start || !end)
            continue;
        if (end < cycle.cycleStart || start > cycle.cycleEnd)
            continue;
        const days = (0, calc_1.datesBetween)(start, end).filter((d) => (0, calc_1.overlapsDay)(cycle.cycleStart, cycle.cycleEnd, d));
        if (days.length === 0)
            continue;
        const raw = String(abs.absenceType || abs.codigo || abs.type || '').trim();
        const upper = raw.toUpperCase();
        const code = calc_1.RRHH_CODE_MAP[upper] ? upper : (calc_1.RRHH_TYPE_LABEL_TO_CODE[upper] || upper);
        const bucket = rrhhByEmp.get(empId) || emptyRrhh();
        const mappedField = calc_1.RRHH_CODE_MAP[code];
        if (mappedField) {
            bucket[mappedField] += days.length;
        }
        else {
            bucket.otrosDias += days.length;
        }
        rrhhByEmp.set(empId, bucket);
    }
    const allItems = book.employees.map(({ employeeId, shifts, stats }) => {
        const empData = (empDataById.get(employeeId) || {});
        const fullName = (0, hours_core_1.personaEmployeeDisplayName)(empData);
        const dni = String(empData.dni || '').trim();
        const cuil = (0, calc_1.fmtCuil)(empData.cuil || empData.cuit);
        const fileNumber = empData.fileNumber || empData.legajo
            ? String(empData.fileNumber || empData.legajo)
            : null;
        const laborAgreement = empData.laborAgreement ? String(empData.laborAgreement) : null;
        const figures = (0, hours_core_1.personaStatsToPayrollFigures)({ shifts, stats }, 0);
        return {
            employee: { id: employeeId, dni, cuil, fileNumber, fullName, laborAgreement },
            acumulado: figures.acumulado,
            liquidacion200: {
                bolsa: figures.liquidacion200.bolsa,
                hsSimples: figures.liquidacion200.hsSimples,
                al50: figures.liquidacion200.al50,
                nota: 'FT y Feriados se pagan aparte.',
            },
            pagaAparte: {
                francoTrabajado100: figures.acumulado.al100FT,
                plusFeriado: figures.acumulado.plusFeriado,
            },
            novedadesRRHH: rrhhByEmp.get(employeeId) || emptyRrhh(),
            totales: figures.totales,
            desglose: figures.desglose,
            turnosCount: figures.turnosCount,
            turnosConFichada: figures.turnosConFichada,
            warnings: [],
        };
    });
    allItems.sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName, 'es'));
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
        diagnostics: {
            empleadosEmpresa: Object.keys(empNameById).length,
            turnosEnRango: turnosDocs.length,
            turnosContados: book.rawShifts.length,
            turnosDescartadosEmpresa,
            turnosDescartadosEmpleado: 0,
            turnosSinHorario: 0,
            turnosBorrador: 0,
            ausenciasContadas: ausencias.length,
            hoursCoreEnabled: true,
        },
    };
}
//# sourceMappingURL=calcPersona.js.map