"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVplanIntake = buildVplanIntake;
exports.validateVplanRequest = validateVplanRequest;
function buildVplanIntake(request, snapshot) {
    return {
        empresaId: request.empresaId,
        objectiveId: request.objectiveId,
        objectiveName: snapshot.objectiveName,
        slaId: snapshot.slaId,
        year: request.year,
        month: request.month,
        mode: request.mode,
        positionCount: snapshot.positions.length,
        employeeCount: snapshot.employees.length,
        monthDays: snapshot.days.length,
        budgetMode: request.budgetMode ?? 'cct',
        preferredCycle: request.preferredCycle ?? '6+2',
    };
}
function validateVplanRequest(request) {
    if (!request.empresaId?.trim())
        return 'empresaId es obligatorio';
    if (!request.objectiveId?.trim())
        return 'objectiveId es obligatorio';
    if (!Number.isFinite(request.year) || request.year < 2000)
        return 'year inválido';
    if (!Number.isFinite(request.month) || request.month < 1 || request.month > 12)
        return 'month inválido';
    return null;
}
//# sourceMappingURL=phase0-intake.js.map