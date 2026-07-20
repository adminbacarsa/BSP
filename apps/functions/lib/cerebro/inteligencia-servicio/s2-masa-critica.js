"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcularMasaCritica = calcularMasaCritica;
exports.calcularMinimoPorCiclo = calcularMinimoPorCiclo;
exports.calcularMinimoParaBanda = calcularMinimoParaBanda;
exports.generarAlertasDeficit = generarAlertasDeficit;
exports.hayDeficit = hayDeficit;
const types_1 = require("../types");
function calcularMasaCritica(needs, empleadosPorBanda = {}) {
    const porBanda = new Map();
    for (const need of needs) {
        if (!porBanda.has(need.banda)) {
            porBanda.set(need.banda, {
                cantSimultaneos: need.cantSimultaneos,
                ciclo: need.esBanda12h ? types_1.CICLO_12H : types_1.CICLO_ESTANDAR,
            });
        }
        else {
            const prev = porBanda.get(need.banda);
            if (need.cantSimultaneos > prev.cantSimultaneos) {
                porBanda.set(need.banda, { ...prev, cantSimultaneos: need.cantSimultaneos });
            }
        }
    }
    return Array.from(porBanda.entries()).map(([banda, { cantSimultaneos, ciclo }]) => {
        const empleadosMinimos = calcularMinimoPorCiclo(cantSimultaneos, ciclo);
        const empleadosActuales = empleadosPorBanda[banda];
        const tieneActuales = empleadosActuales !== undefined;
        const enDeficit = tieneActuales && empleadosActuales < empleadosMinimos;
        return {
            banda,
            cantSimultaneos,
            empleadosMinimos,
            ciclo,
            empleadosActuales: tieneActuales ? empleadosActuales : undefined,
            enDeficit,
            faltante: enDeficit ? empleadosMinimos - empleadosActuales : undefined,
        };
    });
}
function calcularMinimoPorCiclo(cantSimultaneos, ciclo) {
    return Math.ceil(cantSimultaneos * ciclo.cicloDias / ciclo.diasTrabajo);
}
function calcularMinimoParaBanda(cantSimultaneos, esBanda12h) {
    const ciclo = esBanda12h ? types_1.CICLO_12H : types_1.CICLO_ESTANDAR;
    return calcularMinimoPorCiclo(cantSimultaneos, ciclo);
}
function generarAlertasDeficit(masas) {
    return masas
        .filter(m => m.enDeficit)
        .map(m => `Banda ${m.banda}: necesita ${m.empleadosMinimos} empleados, ` +
        `tiene ${m.empleadosActuales ?? 0} → faltan ${m.faltante}.`);
}
function hayDeficit(masas) {
    return masas.some(m => m.enDeficit);
}
//# sourceMappingURL=s2-masa-critica.js.map