"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leerSlaYDerivarCobertura = leerSlaYDerivarCobertura;
exports.filtrarNeedsParaFecha = filtrarNeedsParaFecha;
exports.agruparNeedsPorBanda = agruparNeedsPorBanda;
const types_1 = require("../types");
function leerSlaYDerivarCobertura(sla) {
    const needs = [];
    for (const pos of sla.positions) {
        const baseExcluded = mergeExcluded(sla.excludedDates, pos.excludedDates);
        if (pos.shifts.length === 0) {
            const inferidas = inferirBandasDesdeCoverageType(pos.coverageType);
            for (const banda of inferidas) {
                needs.push(buildNeed(pos, banda, pos.activeDays, baseExcluded));
            }
        }
        else {
            for (const shift of pos.shifts) {
                const diasActivos = shift.days ?? pos.activeDays;
                const activeDays = diasActivos.length > 0 ? diasActivos : [...types_1.DIAS_SEMANA];
                needs.push(buildNeed(pos, {
                    code: shift.code,
                    name: shift.name || shift.code,
                    hours: shift.hours,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                }, activeDays, baseExcluded));
            }
        }
    }
    return needs;
}
function buildNeed(pos, banda, diasSemana, excludedDates) {
    return {
        puestoId: pos.id,
        puestoName: pos.name,
        banda: banda.code,
        bandaName: banda.name,
        cantSimultaneos: pos.quantity,
        diasSemana,
        horaInicio: banda.startTime,
        horaFin: banda.endTime,
        hours: banda.hours,
        esBanda12h: banda.hours >= 12,
        excludedDates,
    };
}
function inferirBandasDesdeCoverageType(coverageType) {
    switch (coverageType) {
        case '24hs':
            return [
                types_1.HORARIOS_BANDA['M'],
                types_1.HORARIOS_BANDA['T'],
                types_1.HORARIOS_BANDA['N'],
            ].map((h, i) => ({ code: ['M', 'T', 'N'][i], ...h }));
        case '12hs_diurno':
            return [{ code: 'D12', ...types_1.HORARIOS_BANDA['D12'] }];
        case '12hs_nocturno':
            return [{ code: 'N12', ...types_1.HORARIOS_BANDA['N12'] }];
        default:
            return [{ code: 'M', ...types_1.HORARIOS_BANDA['M'] }];
    }
}
function mergeExcluded(a, b) {
    const s = new Set([...(a ?? []), ...(b ?? [])]);
    return [...s].sort();
}
function filtrarNeedsParaFecha(needs, fecha, diaSemana) {
    return needs.filter(n => {
        if (n.excludedDates.includes(fecha))
            return false;
        if (n.diasSemana.length > 0 && !n.diasSemana.includes(diaSemana))
            return false;
        return true;
    });
}
function agruparNeedsPorBanda(needs) {
    const m = {};
    for (const n of needs) {
        m[n.banda] = (m[n.banda] ?? 0) + n.cantSimultaneos;
    }
    return m;
}
//# sourceMappingURL=s1-leer-sla.js.map