"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectarBandasEspeciales = detectarBandasEspeciales;
exports.esBandaDe12h = esBandaDe12h;
exports.proponer12hEquivalente = proponer12hEquivalente;
const types_1 = require("../types");
const BANDAS_12H_CONOCIDAS = new Set(['D12', 'N12']);
function detectarBandasEspeciales(sla) {
    const bandas12h = new Set();
    const notas = [];
    for (const pos of sla.positions) {
        if (pos.coverageType === '12hs_diurno')
            bandas12h.add('D12');
        if (pos.coverageType === '12hs_nocturno')
            bandas12h.add('N12');
        for (const shift of pos.shifts) {
            if (BANDAS_12H_CONOCIDAS.has(shift.code)) {
                bandas12h.add(shift.code);
            }
            else if (shift.hours >= 12) {
                bandas12h.add(shift.code);
                notas.push(`Turno ${shift.code} (${shift.name}) tiene ${shift.hours}h — tratado como jornada 12h.`);
            }
        }
    }
    const esBanda12h = bandas12h.size > 0;
    if (esBanda12h) {
        const lista = [...bandas12h].join(', ');
        notas.unshift(`Servicio con jornadas de 12h detectadas: ${lista}`);
        notas.push('Ciclo adaptado a 4+2 (4 días trabajo + 2 francos).');
        notas.push('Máximo 3 días consecutivos de 12h antes del descanso (vs 6 en ciclo estándar).');
        notas.push('Masa crítica: ceil(n × 6/4) en lugar de ceil(n × 8/6).');
    }
    return {
        esBanda12h,
        bandas12h: [...bandas12h],
        cicloAdaptado: esBanda12h ? types_1.CICLO_12H : types_1.CICLO_ESTANDAR,
        maxDiasConsecutivos: esBanda12h ? 3 : 6,
        notas,
    };
}
function esBandaDe12h(code) {
    return BANDAS_12H_CONOCIDAS.has(code);
}
function proponer12hEquivalente(bandas8h) {
    const mapa = {};
    for (const b of bandas8h) {
        if (b === 'M' || b === 'T')
            mapa[b] = 'D12';
        if (b === 'N')
            mapa[b] = 'N12';
    }
    return mapa;
}
//# sourceMappingURL=s4-bandas-especiales.js.map