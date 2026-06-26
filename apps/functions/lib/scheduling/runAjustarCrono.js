"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAjustarCrono = exports.runAjustarCronoHandler = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const db = () => admin.firestore();
function eachDayUTC(fromStr, toStr) {
    const days = [];
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const [fy, fm, fd] = fromStr.split('-').map(Number);
    const [ty, tm, td] = toStr.split('-').map(Number);
    let cur = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
    const last = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0));
    while (cur <= last) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');
        days.push(`${y}-${m}-${d}`);
        cur = new Date(cur.getTime() + MS_PER_DAY);
    }
    return days;
}
function dayBoundsAR(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return {
        start: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 3, 0, 0))),
        end: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d + 1, 2, 59, 59))),
    };
}
function build12hTimestamps(dateStr, band) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (band === 'D12') {
        return {
            startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 9, 0, 0))),
            endTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 21, 0, 0))),
        };
    }
    return {
        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 21, 0, 0))),
        endTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d + 1, 9, 0, 0))),
    };
}
function build8hTimestamps(dateStr, band) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const map = {
        M: { sh: 10, sm: 0, eh: 18, em: 0, nextDay: false },
        T: { sh: 18, sm: 0, eh: 2, em: 0, nextDay: true },
        N: { sh: 2, sm: 0, eh: 10, em: 0, nextDay: true },
    };
    const { sh, sm, eh, em, nextDay } = map[band];
    const startDay = band === 'N' ? d + 1 : d;
    const endDay = nextDay ? d + 1 : d;
    return {
        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, startDay, sh, sm, 0))),
        endTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, endDay, eh, em, 0))),
    };
}
function normBanda8(code) {
    const c = String(code || '').toUpperCase();
    if (c === 'D12')
        return 'M';
    if (c === 'N12')
        return 'N';
    if (c === 'M' || c === 'T' || c === 'N')
        return c;
    return null;
}
function isOperacional(s) {
    return s.origin === 'RETEN'
        || s.origin === 'OPERATIONS_COVERAGE'
        || s.origin === 'SLA_VIRTUAL'
        || !!s.isReten
        || s.resolvedBy === 'OPERACIONES';
}
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'RET']);
function autoComprimir12h(shifts, liberarId) {
    if (shifts.length < 3)
        return { ok: false, plan: null, error: 'Se necesitan al menos 3 guardias.' };
    const n = shifts.find(s => s.banda === 'N');
    const liberar = shifts.find(s => s.employeeId === liberarId);
    if (!n)
        return { ok: false, plan: null, error: 'No hay turno Noche — no se puede comprimir sin N12.' };
    if (!liberar)
        return { ok: false, plan: null, error: 'Guardia a liberar no encontrado.' };
    if (liberar.employeeId === n.employeeId)
        return { ok: false, plan: null, error: 'No podés liberar al de Noche — quedaría sin N12.' };
    const diurno = shifts.find(s => s.employeeId !== liberarId && s.banda === 'M')
        ?? shifts.find(s => s.employeeId !== liberarId && s.banda === 'T')
        ?? shifts.find(s => s.employeeId !== liberarId && s.employeeId !== n.employeeId);
    if (!diurno)
        return { ok: false, plan: null, error: 'No se pudo asignar cobertura diurna D12.' };
    return {
        ok: true,
        plan: shifts.map(s => {
            if (s.employeeId === liberarId)
                return { ...s, ajuste: 'RET' };
            if (s.employeeId === n.employeeId)
                return { ...s, ajuste: 'N12' };
            if (s.employeeId === diurno.employeeId)
                return { ...s, ajuste: 'D12' };
            return { ...s, ajuste: 'RET' };
        }),
    };
}
function autoComprimir12hAutomatico(shifts) {
    if (shifts.length === 0)
        return { ok: false, plan: null, error: 'No hay turnos planificados ese día.' };
    const hasM = shifts.some(s => s.banda === 'M');
    const hasT = shifts.some(s => s.banda === 'T');
    const hasN = shifts.some(s => s.banda === 'N');
    if (hasM && hasT && hasN) {
        return {
            ok: true,
            plan: shifts.map(s => {
                if (s.banda === 'M')
                    return { ...s, ajuste: 'D12' };
                if (s.banda === 'N')
                    return { ...s, ajuste: 'N12' };
                return { ...s, ajuste: 'RET' };
            }),
        };
    }
    if (!hasT)
        return { ok: false, plan: null, error: `Sin banda Tarde (M:${hasM ? 1 : 0} T:0 N:${hasN ? 1 : 0}) — no hay guardias para liberar a RET.` };
    const t = shifts.find(s => s.banda === 'T');
    return autoComprimir12h(shifts, t.employeeId);
}
const RUNTIME = { timeoutSeconds: 120, memory: '512MB' };
const runAjustarCronoHandler = async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }
    const { empresaId: rawEmpresaId, objectiveId, objectiveNombre: rawNombre, fechaDesde, fechaHasta, motivo = 'Evento — ajuste operativo', destinoObjetivoId, destinoObjetivoNombre, } = data;
    if (!rawEmpresaId || !objectiveId || !fechaDesde || !fechaHasta) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, fechaDesde y fechaHasta son requeridos.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
        throw new functions.https.HttpsError('invalid-argument', 'fechaDesde y fechaHasta deben tener formato YYYY-MM-DD.');
    }
    const empresaId = String(rawEmpresaId).trim() || 'bacarsa';
    const objectiveNombre = rawNombre || objectiveId;
    const creadoPor = context.auth.token?.email || context.auth.uid;
    const days = eachDayUTC(fechaDesde, fechaHasta);
    if (days.length === 0 || fechaDesde > fechaHasta) {
        throw new functions.https.HttpsError('invalid-argument', 'Rango de fechas inválido.');
    }
    const existingSnap = await db()
        .collection('ajustes_crono')
        .where('empresaId', '==', empresaId)
        .where('tipo', '==', 'OPERATIVO')
        .where('origenObjetivoId', '==', objectiveId)
        .where('estado', '==', 'ACTIVO')
        .get();
    const alreadyAdjusted = new Set();
    for (const docSnap of existingSnap.docs) {
        const ini = docSnap.data().fechaInicio?.toDate?.();
        if (!ini)
            continue;
        const arDate = new Date(ini.getTime() - 3 * 60 * 60 * 1000);
        const y = arDate.getUTCFullYear();
        const m = String(arDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(arDate.getUTCDate()).padStart(2, '0');
        alreadyAdjusted.add(`${y}-${m}-${d}`);
    }
    const cambiosBanda = [];
    const retenes = [];
    let retenesLiberados = 0;
    let slotsAplicados = 0;
    let slotsOmitidos = 0;
    const errores = [];
    const batch = db().batch();
    for (const dateStr of days) {
        if (alreadyAdjusted.has(dateStr)) {
            slotsOmitidos++;
            continue;
        }
        const { start, end } = dayBoundsAR(dateStr);
        const snap = await db()
            .collection('turnos')
            .where('objectiveId', '==', objectiveId)
            .where('startTime', '>=', start)
            .where('startTime', '<=', end)
            .get();
        const rows = [];
        for (const s of snap.docs) {
            const d = s.data();
            if (d.draft === true)
                continue;
            if (isOperacional(d))
                continue;
            const code = String(d.code || d.type || '').toUpperCase();
            if (!WORK_CODES.has(code))
                continue;
            const banda = normBanda8(code);
            if (!banda)
                continue;
            rows.push({
                id: s.id,
                employeeId: String(d.employeeId || ''),
                employeeName: String(d.employeeName || d.employeeId || ''),
                banda,
            });
        }
        const result = autoComprimir12hAutomatico(rows);
        if (!result.ok || !result.plan) {
            slotsOmitidos++;
            continue;
        }
        for (const p of result.plan) {
            const turnoRef = db().collection('turnos').doc(p.id);
            if (p.ajuste === 'RET') {
                batch.update(turnoRef, {
                    origin: 'RETEN',
                    isReten: true,
                    code: 'RET',
                    name: 'Retén',
                    hours: 0,
                });
                const reten = {
                    employeeId: p.employeeId,
                    employeeName: p.employeeName,
                    turnoOrigenIds: [p.id],
                    estado: destinoObjetivoId ? 'ASIGNADO' : 'DISPONIBLE',
                };
                if (destinoObjetivoId && destinoObjetivoId !== objectiveId) {
                    reten.destinoObjetivoId = destinoObjetivoId;
                    if (destinoObjetivoNombre)
                        reten.destinoObjetivoNombre = destinoObjetivoNombre;
                    const destRef = db().collection('turnos').doc();
                    const times = build8hTimestamps(dateStr, p.banda);
                    batch.set(destRef, {
                        employeeId: p.employeeId,
                        employeeName: p.employeeName,
                        objectiveId: destinoObjetivoId,
                        objectiveName: destinoObjetivoNombre || destinoObjetivoId,
                        code: p.banda,
                        name: p.banda,
                        hours: 8,
                        ...times,
                        origin: 'RETEN',
                        isReten: true,
                        draft: false,
                        empresaId,
                    });
                    reten.destinoTurnoIds = [destRef.id];
                }
                retenes.push(reten);
                retenesLiberados++;
            }
            else if (p.ajuste === 'D12' || p.ajuste === 'N12') {
                const times = build12hTimestamps(dateStr, p.ajuste);
                batch.update(turnoRef, { code: p.ajuste, name: p.ajuste, hours: 12, ...times });
                let entry = cambiosBanda.find(c => c.employeeId === p.employeeId && c.bandaNueva === p.ajuste);
                if (!entry) {
                    entry = { employeeId: p.employeeId, employeeName: p.employeeName, bandaAnterior: p.banda, bandaNueva: p.ajuste, turnoIds: [] };
                    cambiosBanda.push(entry);
                }
                entry.turnoIds.push(p.id);
            }
        }
        slotsAplicados++;
    }
    if (slotsAplicados === 0) {
        return {
            ok: false,
            retenesLiberados: 0,
            slotsAplicados: 0,
            slotsOmitidos,
            errores: errores.length ? errores : ['No se encontraron días con dotación comprimible en el rango.'],
        };
    }
    const ajusteRef = db().collection('ajustes_crono').doc();
    batch.set(ajusteRef, {
        empresaId,
        tipo: 'OPERATIVO',
        fechaInicio: admin.firestore.Timestamp.fromDate(new Date(fechaDesde + 'T15:00:00Z')),
        fechaFin: admin.firestore.Timestamp.fromDate(new Date(fechaHasta + 'T15:00:00Z')),
        origenObjetivoId: objectiveId,
        origenObjetivoNombre: objectiveNombre,
        motivo: motivo.trim() || 'Evento — ajuste operativo',
        cambiosBanda,
        retenes,
        creadoPor,
        estado: 'ACTIVO',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    try {
        await batch.commit();
    }
    catch (e) {
        throw new functions.https.HttpsError('internal', e?.message || 'Error al guardar los cambios.');
    }
    return {
        ok: true,
        retenesLiberados,
        slotsAplicados,
        slotsOmitidos,
        errores,
    };
};
exports.runAjustarCronoHandler = runAjustarCronoHandler;
exports.runAjustarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(exports.runAjustarCronoHandler);
//# sourceMappingURL=runAjustarCrono.js.map