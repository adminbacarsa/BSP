"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_COVERAGE_CASCADE_ORDER = void 0;
exports.isEventoShift = isEventoShift;
exports.eventoTieneFranjasEncadenadas = eventoTieneFranjasEncadenadas;
exports.eventualesParaHueco = eventualesParaHueco;
exports.planEventualAusente = planEventualAusente;
exports.EVENT_COVERAGE_CASCADE_ORDER = ['REF', 'ESC', 'EXTEND', 'ADVANCE', 'FT'];
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
function eventualesParaHueco() {
    return [];
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