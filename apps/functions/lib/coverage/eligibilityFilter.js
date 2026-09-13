"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROADCAST_LIMIT = exports.CASCADE_ORDER = void 0;
exports.toCascadeStep = toCascadeStep;
exports.cascadeStepIndex = cascadeStepIndex;
exports.nextCascadeStep = nextCascadeStep;
exports.checkEligibility = checkEligibility;
exports.deriveCandidateType = deriveCandidateType;
exports.getUrgency = getUrgency;
exports.findEmployeeUid = findEmployeeUid;
const firestore_1 = require("firebase-admin/firestore");
exports.CASCADE_ORDER = [
    'SIN_TURNO',
    'RET',
    'ESC',
    'EXT_DUAL',
    'FT',
];
exports.BROADCAST_LIMIT = 5;
function toCascadeStep(type) {
    if (type === 'VOLANTE' || type === 'SIN_TURNO_CON_EXP' || type === 'SIN_TURNO')
        return 'SIN_TURNO';
    if (type === 'RET')
        return 'RET';
    if (type === 'ESC')
        return 'ESC';
    if (type === 'EXTEND' || type === 'ADVANCE' || type === 'EXT_DUAL')
        return 'EXT_DUAL';
    if (type === 'FT')
        return 'FT';
    return null;
}
function cascadeStepIndex(type) {
    const step = toCascadeStep(type);
    if (!step)
        return -1;
    return exports.CASCADE_ORDER.indexOf(step);
}
function nextCascadeStep(current) {
    const step = toCascadeStep(String(current));
    if (!step)
        return null;
    const idx = exports.CASCADE_ORDER.indexOf(step);
    if (idx === -1 || idx >= exports.CASCADE_ORDER.length - 1)
        return null;
    return exports.CASCADE_ORDER[idx + 1];
}
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
    if ((candidateType === 'RET' || candidateType === 'VOLANTE' || candidateType === 'FT' || candidateType === 'ESC') &&
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
        if (code === 'ESC' || code === 'REF')
            return 'ESC';
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