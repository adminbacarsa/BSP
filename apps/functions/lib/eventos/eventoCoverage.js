"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBJECTIVE_COVERAGE_WITH_EVENTUAL = exports.EVENT_COVERAGE_CASCADE_ORDER = void 0;
exports.isEventoShift = isEventoShift;
exports.eventoTieneFranjasEncadenadas = eventoTieneFranjasEncadenadas;
exports.bloqueoCruceEventual = bloqueoCruceEventual;
exports.eventualesParaHueco = eventualesParaHueco;
exports.planEventualAusente = planEventualAusente;
exports.EVENT_COVERAGE_CASCADE_ORDER = ['EVENTUAL', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'];
exports.OBJECTIVE_COVERAGE_WITH_EVENTUAL = ['RET', 'REF', 'ESC', 'EXTEND', 'ADVANCE', 'EVENTUAL', 'FT'];
function isEventoShift(shift) {
    if (!shift)
        return false;
    const row = shift;
    const code = String(row.code || '').trim().toUpperCase();
    const origin = String(row.origin || '').trim().toUpperCase();
    return code === 'EV' || origin === 'EVENTO';
}
function eventoTieneFranjasEncadenadas(shift) {
    if (!shift)
        return false;
    return shift.eventoFranjasEncadenadas === true;
}
const REST_MS = 12 * 60 * 60 * 1000;
function haversineKm(aLat, aLng, bLat, bLng) {
    const r = 6371;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLng = ((bLng - aLng) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}
function vigente(fecha, hoy) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) && String(fecha) >= hoy;
}
function bloqueoCruceEventual(nueva, otras) {
    if (!nueva.startMs || !nueva.endMs || nueva.endMs <= nueva.startMs)
        return { ok: false, codigo: 'SUPERPOSICION' };
    const todos = [
        ...otras.filter((o) => o.startMs && o.endMs && o.endMs > o.startMs).map((o) => ({ ...o, empresaId: String(o.empresaId || '') })),
        { startMs: nueva.startMs, endMs: nueva.endMs, empresaId: 'NUEVA' },
    ].sort((a, b) => a.startMs - b.startMs);
    for (const o of otras) {
        if (nueva.startMs < o.endMs && o.startMs < nueva.endMs)
            return { ok: false, codigo: 'SUPERPOSICION' };
    }
    for (let i = 1; i < todos.length; i += 1) {
        const descanso = todos[i].startMs - todos[i - 1].endMs;
        const tocaNueva = todos[i].empresaId === 'NUEVA' || todos[i - 1].empresaId === 'NUEVA';
        if (tocaNueva && descanso >= 0 && descanso < REST_MS && todos[i].empresaId !== todos[i - 1].empresaId) {
            return { ok: false, codigo: 'DESCANSO_12H' };
        }
    }
    return { ok: true };
}
function eventualesParaHueco(input) {
    const hueco = input?.hueco;
    const bolsa = input?.bolsa || [];
    if (!hueco?.empresaId || !hueco.startMs || !hueco.endMs)
        return [];
    const hoy = String(hueco.hoyYmd || '');
    const otras = input?.otrasJornadas || [];
    const out = [];
    for (const row of bolsa) {
        const cuil = String(row.cuil || '').trim();
        if (!cuil)
            continue;
        if (String(row.disponibilidad || 'DISPONIBLE').toUpperCase() !== 'DISPONIBLE')
            continue;
        if (!(row.empresasHabilitadas || []).includes(hueco.empresaId))
            continue;
        if (!vigente(row.credencialVencimiento, hoy))
            continue;
        const apto = row.aptoPsicofisico || {};
        if (String(apto.estado || '').trim().toUpperCase() !== 'APTO')
            continue;
        if (!vigente(apto.vencimiento, hoy))
            continue;
        const cruce = bloqueoCruceEventual({ empresaId: hueco.empresaId, startMs: hueco.startMs, endMs: hueco.endMs }, otras.filter((j) => j.cuil === cuil));
        if (!cruce.ok)
            continue;
        const geo = row.domicilioGeo;
        const distanceKm = geo && hueco.lat != null && hueco.lng != null && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)
            ? Math.round(haversineKm(Number(geo.lat), Number(geo.lng), Number(hueco.lat), Number(hueco.lng)) * 10) / 10
            : null;
        const legajo = (row.legajos || []).find((l) => String(l.empresaId || '') === hueco.empresaId && String(l.employeeId || '').trim());
        out.push({
            employeeId: String(legajo?.employeeId || cuil),
            employeeName: String(row.nombre || cuil),
            cuil,
            ...(row.uid ? { uid: String(row.uid) } : {}),
            distanceKm,
            confiabilidad: Number(row.confiabilidad) || 0,
        });
    }
    out.sort((a, b) => {
        const da = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm;
        const db = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm;
        if (da !== db)
            return da - db;
        if (a.confiabilidad !== b.confiabilidad)
            return b.confiabilidad - a.confiabilidad;
        return a.employeeName.localeCompare(b.employeeName, 'es');
    });
    return out;
}
function planEventualAusente(input) {
    if (input.isEventual !== true)
        return null;
    const employeeId = String(input.employeeId || '').trim();
    const empresaAltaId = String(input.empresaAltaId || '').trim();
    if (!employeeId || !empresaAltaId)
        return null;
    const neverStarted = input.punched !== true;
    return {
        employeeId,
        empresaAltaId,
        eventoId: String(input.eventoId || ''),
        shiftId: String(input.shiftId || ''),
        neverStarted,
        descuentaLiquidacion: true,
        confiabilidadDelta: -1,
        arcaBajaPendiente: neverStarted,
    };
}
//# sourceMappingURL=eventoCoverage.js.map