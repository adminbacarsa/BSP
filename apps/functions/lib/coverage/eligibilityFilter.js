"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASCADE_ORDER = void 0;
exports.checkEligibility = checkEligibility;
exports.deriveCandidateType = deriveCandidateType;
exports.nextCascadeStep = nextCascadeStep;
exports.getUrgency = getUrgency;
exports.findEmployeeUid = findEmployeeUid;
const firestore_1 = require("firebase-admin/firestore");
function checkEligibility(employee, ctx, candidateType, distanceKm) {
    const today = new Date().toISOString().slice(0, 10);
    const restricObjs = employee.restriccionesObjetivo || [];
    if (restricObjs.some((r) => r.objectiveId === ctx.objectiveId)) {
        return { eligible: false, reason: 'RESTRICCION_OBJETIVO' };
    }
    if (ctx.clientId) {
        const restricClients = employee.restriccionesCliente || [];
        if (restricClients.some((r) => r.clientId === ctx.clientId)) {
            return { eligible: false, reason: 'RESTRICCION_CLIENTE' };
        }
    }
    if ((candidateType === 'RET' || candidateType === 'VOLANTE' || candidateType === 'FT') &&
        distanceKm !== undefined) {
        if (distanceKm > 15) {
            return { eligible: false, reason: 'DISTANCIA_EXCEDE_15KM' };
        }
    }
    if (candidateType === 'RET') {
        const isTitular = employee.preferredObjectiveId === ctx.objectiveId;
        const hasExp = !!(employee.experienciaObjetivos || {})[ctx.objectiveId];
        const isVolante = (employee.volante || []).includes(ctx.objectiveId);
        if (!isTitular && !hasExp && !isVolante) {
            return { eligible: false, reason: 'SIN_EXPERIENCIA_EN_OBJETIVO' };
        }
    }
    const required = ctx.aptitudesRequeridas || [];
    if (required.length > 0) {
        const empApts = employee.aptitudes || [];
        const vigentes = empApts
            .filter((a) => !a.vigencia || a.vigencia >= today)
            .map((a) => a.codigo);
        const missing = required.filter((r) => !vigentes.includes(r));
        if (missing.length > 0) {
            return { eligible: false, reason: `FALTA_APTITUD:${missing.join(',')}` };
        }
    }
    return { eligible: true };
}
function deriveCandidateType(employee, objectiveId, todayShifts) {
    const empId = employee.id;
    const shift = todayShifts.find((s) => s.employeeId === empId);
    if (shift) {
        const code = String(shift.code || '').toUpperCase();
        if (code === 'RET')
            return 'RET';
        if (['F', 'FF', 'FP', 'FT'].includes(code))
            return 'FT';
        return null;
    }
    const isVolante = (employee.volante || []).includes(objectiveId);
    if (isVolante)
        return 'VOLANTE';
    const isTitular = employee.preferredObjectiveId === objectiveId;
    const hasExp = !!(employee.experienciaObjetivos || {})[objectiveId];
    if (isTitular || hasExp)
        return 'SIN_TURNO_CON_EXP';
    return 'SIN_TURNO';
}
exports.CASCADE_ORDER = [
    'RET',
    'VOLANTE',
    'SIN_TURNO_CON_EXP',
    'EXTEND',
    'ADVANCE',
    'SIN_TURNO',
    'FT',
];
function nextCascadeStep(current) {
    const idx = exports.CASCADE_ORDER.indexOf(current);
    if (idx === -1 || idx >= exports.CASCADE_ORDER.length - 1)
        return null;
    return exports.CASCADE_ORDER[idx + 1];
}
function getUrgency(startTime) {
    const startMs = startTime instanceof firestore_1.Timestamp
        ? startTime.toMillis()
        : startTime.seconds * 1000;
    const diffMin = (startMs - Date.now()) / 60000;
    if (diffMin <= 60)
        return 'URGENTE';
    if (diffMin <= 240)
        return 'INTERMEDIO';
    return 'NORMAL';
}
async function findEmployeeUid(db, employeeId, empData) {
    const data = empData || (await db.collection('empleados').doc(employeeId).get()).data();
    if (!data)
        return null;
    if (data.uid)
        return String(data.uid);
    return null;
}
//# sourceMappingURL=eligibilityFilter.js.map