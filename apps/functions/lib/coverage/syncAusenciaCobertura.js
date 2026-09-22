"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAusenciaCoberturaGestionada = syncAusenciaCoberturaGestionada;
exports.absentShiftCoveragePatch = absentShiftCoveragePatch;
exports.isTitularAlreadyCovered = isTitularAlreadyCovered;
exports.isActiveOpsCoverageDoc = isActiveOpsCoverageDoc;
exports.supersedeOpsCoveragesForAbsence = supersedeOpsCoveragesForAbsence;
exports.opsCoverageLinkFields = opsCoverageLinkFields;
const admin = require("firebase-admin");
async function syncAusenciaCoberturaGestionada(db, params, batch) {
    const shiftId = String(params.shiftId || '').trim();
    if (!shiftId)
        return 0;
    let q = db.collection('ausencias').where('shiftId', '==', shiftId);
    if (params.empresaId) {
        q = q.where('empresaId', '==', params.empresaId);
    }
    const snap = await q.limit(10).get();
    if (snap.empty)
        return 0;
    const payload = {
        coberturaEstado: 'GESTIONADA',
        coberturaResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        coberturaResolvedBy: params.resolvedBy || 'OPERACIONES',
        coveredByEmployeeId: params.coveredByEmployeeId ?? null,
        coveredByEmployeeName: params.coveredByEmployeeName ?? null,
        coverageType: params.coverageType ?? null,
    };
    let n = 0;
    for (const d of snap.docs) {
        if (batch)
            batch.update(d.ref, payload);
        else
            await d.ref.update(payload);
        n += 1;
    }
    return n;
}
function absentShiftCoveragePatch(opts) {
    const patch = {
        resolvedBy: opts.resolvedBy || 'OPERACIONES',
        coverageType: opts.coverageType || 'COBERTURA',
        coveredAt: admin.firestore.FieldValue.serverTimestamp(),
        coveredByEmployeeId: opts.coveredByEmployeeId || null,
        coveredByEmployeeName: opts.coveredByEmployeeName || null,
        operacionallyCovered: true,
        coverageStatus: 'COVERED',
    };
    if (!opts.isAbsence) {
        patch.status = 'COVERED';
    }
    else {
        patch.isAbsent = true;
        patch.status = 'ABSENT';
        if (!opts.coverageType) {
            patch.absenceType = 'AA';
        }
    }
    return patch;
}
function isTitularAlreadyCovered(data) {
    if (!data)
        return false;
    if (data.operacionallyCovered === true)
        return true;
    if (String(data.coverageStatus || '').toUpperCase() === 'COVERED')
        return true;
    if (data.coveredByEmployeeId)
        return true;
    if (data.coveredByEmployeeName)
        return true;
    return false;
}
function isActiveOpsCoverageDoc(data) {
    if (!data)
        return false;
    if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE')
        return false;
    if (data.coverageSuperseded === true)
        return false;
    if (String(data.status || '').toUpperCase() === 'CANCELLED')
        return false;
    if (data.isDeleted === true)
        return false;
    return true;
}
async function supersedeOpsCoveragesForAbsence(db, absenceShiftId, batch, opts) {
    const id = String(absenceShiftId || '').trim();
    if (!id)
        return 0;
    const [byAbsence, byCovered] = await Promise.all([
        db.collection('turnos').where('absenceShiftId', '==', id).limit(40).get(),
        db.collection('turnos').where('coveredShiftId', '==', id).limit(40).get(),
    ]);
    const seen = new Set();
    let n = 0;
    for (const d of [...byAbsence.docs, ...byCovered.docs]) {
        if (seen.has(d.id))
            continue;
        seen.add(d.id);
        if (opts?.keepDocId && d.id === opts.keepDocId)
            continue;
        const data = d.data();
        if (!isActiveOpsCoverageDoc(data))
            continue;
        batch.update(d.ref, {
            coverageSuperseded: true,
            coverageSupersededAt: admin.firestore.FieldValue.serverTimestamp(),
            coverageSupersededBy: opts?.supersededBy || null,
            status: 'CANCELLED',
        });
        n += 1;
    }
    return n;
}
function opsCoverageLinkFields(titular, absenceShiftId) {
    return {
        absenceShiftId,
        coveredShiftId: absenceShiftId,
        coversEmployeeId: titular?.employeeId || null,
        coversEmployeeName: titular?.employeeName || null,
    };
}
//# sourceMappingURL=syncAusenciaCobertura.js.map