"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onGuardAbsenceDetected = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
exports.onGuardAbsenceDetected = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .firestore.document('turnos/{turnoId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.isAbsent === true || after.isAbsent !== true)
        return;
    if (after.employeeId === 'VACANTE' || after.isUnassigned)
        return;
    if (after.vacancyCreatedForAbsence === true)
        return;
    const skipOrigins = new Set(['RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL',
        'VACANTE_CORRECCION', 'VACANTE_POR_EVENTO', 'VACANTE_POR_AUSENCIA']);
    if (skipOrigins.has(String(after.origin || '')))
        return;
    const empresaId = typeof after.empresaId === 'string' ? after.empresaId : null;
    if (!empresaId)
        return;
    const turnoId = context.params.turnoId;
    const db = admin.firestore();
    const dupSnap = await db.collection('turnos')
        .where('causedByShiftId', '==', turnoId)
        .where('origin', '==', 'VACANTE_POR_AUSENCIA')
        .limit(1)
        .get();
    if (!dupSnap.empty)
        return;
    const scheduleDate = typeof after.scheduleDate === 'string' ? after.scheduleDate : '';
    const todayStr = new Date().toISOString().slice(0, 10);
    const nowH = new Date().getHours();
    const isTomorrow = scheduleDate > todayStr;
    const actionTarget = (isTomorrow && nowH < 19) ? 'PLANIFICACION' : 'OPERACIONES';
    const vacancyDoc = {
        employeeId: 'VACANTE',
        employeeName: 'VACANTE',
        isUnassigned: true,
        code: after.code || null,
        type: after.type || after.code || null,
        objectiveId: after.objectiveId || null,
        objectiveName: after.objectiveName || '',
        positionName: after.positionName || 'General',
        clientId: after.clientId || null,
        clientName: after.clientName || '',
        startTime: after.startTime || null,
        endTime: after.endTime || null,
        scheduleDate,
        origin: 'VACANTE_POR_AUSENCIA',
        vacancyOrigin: 'ABSENCE',
        causedByShiftId: turnoId,
        causedByEmployeeId: after.employeeId || null,
        causedByEmployeeName: after.employeeName || '',
        actionTarget,
        empresaId,
        draft: false,
        status: 'UNCOVERED',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await Promise.all([
        db.collection('turnos').add(vacancyDoc),
        db.collection('turnos').doc(turnoId).update({ vacancyCreatedForAbsence: true }),
    ]);
    console.log(`[onGuardAbsenceDetected] VACANTE_POR_AUSENCIA creada para turno ${turnoId} empresa ${empresaId} actionTarget=${actionTarget}`);
});
//# sourceMappingURL=onGuardAbsenceDetected.js.map