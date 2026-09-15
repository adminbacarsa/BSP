"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROADCAST_LIMIT = exports.RET_RADIUS_KM_EXPANDED = exports.RET_RADIUS_KM_PRIMARY = exports.CASCADE_ORDER = void 0;
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
    'CROSS_POS',
    'EXT_DUAL',
    'INTERCAMBIO',
    'CROSS_OBJ',
    'FT',
];
exports.RET_RADIUS_KM_PRIMARY = 15;
exports.RET_RADIUS_KM_EXPANDED = 30;
exports.BROADCAST_LIMIT = 5;
function toCascadeStep(type) {
    if (type === 'VOLANTE' || type === 'SIN_TURNO_CON_EXP' || type === 'SIN_TURNO')
        return 'SIN_TURNO';
    if (type === 'RET')
        return 'RET';
    if (type === 'ESC')
        return 'ESC';
    if (type === 'CROSS_POS')
        return 'CROSS_POS';
    if (type === 'CROSS_OBJ')
        return 'CROSS_OBJ';
    if (type === 'EXTEND' || type === 'ADVANCE' || type === 'EXT_DUAL')
        return 'EXT_DUAL';
    if (type === 'INTERCAMBIO')
        return 'INTERCAMBIO';
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
function checkEligibility(employee, ctx, candidateType, distanceKm, maxDistanceKm = exports.RET_RADIUS_KM_PRIMARY) {
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
        distanceKm !== undefined &&
        Number.isFinite(distanceKm)) {
        if (distanceKm > maxDistanceKm) {
            return { eligible: false, reason: `DISTANCIA_EXCEDE_${maxDistanceKm}KM` };
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