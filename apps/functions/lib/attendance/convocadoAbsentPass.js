"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConvocadoAbsentPass = runConvocadoAbsentPass;
const firestore_1 = require("firebase-admin/firestore");
const markShiftAbsent_1 = require("./markShiftAbsent");
const coverageTraceShift_1 = require("../coverage/coverageTraceShift");
const convocatoriasCobertura_1 = require("../coverage/convocatoriasCobertura");
const opsManualMode_1 = require("../ops/opsManualMode");
const convocadoTitularRevert_1 = require("./convocadoTitularRevert");
const MIN_HOURS_BEFORE_GAP_END = 2;
function ms(v) {
    return v?.toMillis?.() ?? 0;
}
function shiftEmpresaId(shift) {
    return String(shift.empresaId || '').trim() || 'bacarsa';
}
async function relaunchTitularCoverage(db, opsCov) {
    const titularId = String(opsCov.absenceShiftId || opsCov.coveredShiftId || '').trim();
    if (!titularId)
        return;
    const titSnap = await db.collection('turnos').doc(titularId).get();
    if (!titSnap.exists)
        return;
    const tit = titSnap.data();
    const empresaId = shiftEmpresaId(tit);
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
async function runConvocadoAbsentPass(db, now, cc) {
    const nowMs = now.toMillis();
    const windowStart = firestore_1.Timestamp.fromMillis(nowMs - 12 * 60 * 60 * 1000);
    const windowEnd = firestore_1.Timestamp.fromMillis(nowMs);
    const empSnap = await db.collection('empresas').get();
    const empresaIds = empSnap.docs.map((d) => d.id);
    if (empresaIds.length === 0)
        empresaIds.push('bacarsa');
    let marked = 0;
    for (const empresaId of empresaIds) {
        if (!cc.isEnabled(empresaId))
            continue;
        if (cc.isDemo(empresaId))
            continue;
        const snap = await db
            .collection('turnos')
            .where('empresaId', '==', empresaId)
            .where('origin', '==', 'OPERATIONS_COVERAGE')
            .where('startTime', '>=', windowStart)
            .where('startTime', '<=', windowEnd)
            .get();
        for (const docSnap of snap.docs) {
            const shift = docSnap.data();
            if ((0, coverageTraceShift_1.skipAbsencePipelineForShift)(shift))
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
            const titularId = String(shift.absenceShiftId || shift.coveredShiftId || '').trim();
            await (0, convocadoTitularRevert_1.revertTitularAfterConvocadoNoLlego)(db, { ...shift, id: docSnap.id });
            const r = await (0, markShiftAbsent_1.markShiftAbsent)(db, docSnap.id, {
                reason: 'CONVOCADO_NO_LLEGO',
                by: 'SYSTEM_SCHEDULER',
            });
            if (r.applied) {
                marked++;
                if (titularId) {
                    await (0, convocadoTitularRevert_1.cancelPendingConvocatoriasForTitular)(db, titularId);
                }
                if (!skipRelaunch) {
                    await relaunchTitularCoverage(db, { ...shift, id: docSnap.id });
                }
            }
        }
    }
    return marked;
}
//# sourceMappingURL=convocadoAbsentPass.js.map