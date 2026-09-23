"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConvocadoAbsentPass = runConvocadoAbsentPass;
const firestore_1 = require("firebase-admin/firestore");
const markShiftAbsent_1 = require("./markShiftAbsent");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const convocatoriasCobertura_1 = require("../coverage/convocatoriasCobertura");
const opsManualMode_1 = require("../ops/opsManualMode");
const MIN_HOURS_BEFORE_GAP_END = 2;
function ms(v) {
    return v?.toMillis?.() ?? 0;
}
async function relaunchTitularCoverage(db, opsCov) {
    const titularId = String(opsCov.absenceShiftId || opsCov.coveredShiftId || '').trim();
    if (!titularId)
        return;
    const titSnap = await db.collection('turnos').doc(titularId).get();
    if (!titSnap.exists)
        return;
    const tit = titSnap.data();
    const empresaId = String(tit.empresaId || opsCov.empresaId || '').trim() || 'bacarsa';
    const manual = await (0, opsManualMode_1.isEmpresaManualMode)(db, empresaId);
    if (manual) {
        await db.collection('novedades').add({
            type: 'CONVOCADO_NO_LLEGO',
            status: 'PENDIENTE',
            shiftId: opsCov.id,
            absenceShiftId: titularId,
            objectiveId: tit.objectiveId || null,
            objectiveName: tit.objectiveName || '',
            empresaId,
            description: `${opsCov.employeeName || 'Convocado'} no llegó — relanzar cobertura del titular manualmente.`,
            createdAt: firestore_1.Timestamp.now(),
            source: 'SYSTEM_SCHEDULER',
        });
        return;
    }
    await (0, convocatoriasCobertura_1.iniciarCascadaCobertura)(db, {
        id: titularId,
        objectiveId: String(tit.objectiveId || ''),
        objectiveName: String(tit.objectiveName || ''),
        positionName: String(tit.positionName || ''),
        clientId: String(tit.clientId || ''),
        clientName: String(tit.clientName || ''),
        code: String(tit.code || ''),
        startTime: tit.startTime,
        endTime: tit.endTime,
        empresaId,
    }, 'AUTO');
}
async function runConvocadoAbsentPass(db, now) {
    const nowMs = now.toMillis();
    const windowStartMs = nowMs - 12 * 60 * 60 * 1000;
    const snap = await db.collection('turnos').where('origin', '==', 'OPERATIONS_COVERAGE').limit(300).get();
    let marked = 0;
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if ((0, coverageTraceShift_1.skipAbsencePipelineForShift)(shift))
            continue;
        if (ms(shift.startTime) < windowStartMs)
            continue;
        if (shift.isPresent === true || shift.isCompleted === true)
            continue;
        if (shift.isAbsent === true)
            continue;
        const ct = String(shift.coverageType || '').toUpperCase();
        if (ct === 'EXTEND')
            continue;
        const gapEnd = ms(shift.endTime);
        const skipRelaunch = !!(gapEnd && gapEnd - nowMs < MIN_HOURS_BEFORE_GAP_END * 3600000);
        const gapStart = ms(shift.startTime);
        const deadline = ct === 'ADVANCE'
            ? (ms(shift.adjustedStartTime) || gapStart) + 60 * 60 * 1000
            : Math.max(ms(shift.createdAt) || gapStart, gapStart) + 60 * 60 * 1000;
        if (nowMs < deadline)
            continue;
        const covTypes = new Set(['RET', 'REF', 'ESC', 'FT']);
        if (!covTypes.has(ct) && !shift.isReten)
            continue;
        if (ct === 'ADVANCE') {
            const titularId = String(shift.absenceShiftId || '').trim();
            if (titularId) {
                await db.collection('turnos').doc(titularId).update({
                    coverageStatus: 'PARTIAL',
                    operacionallyCovered: false,
                });
            }
        }
        const r = await (0, markShiftAbsent_1.markShiftAbsent)(db, docSnap.id, {
            reason: 'CONVOCADO_NO_LLEGO',
            by: 'SYSTEM_SCHEDULER',
        });
        if (r.applied) {
            marked++;
            if (!skipRelaunch) {
                await relaunchTitularCoverage(db, { ...shift, id: docSnap.id });
            }
        }
    }
    return marked;
}
//# sourceMappingURL=convocadoAbsentPass.js.map