"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePosMatch = normalizePosMatch;
exports.isNoPlanningVacancyOrigin = isNoPlanningVacancyOrigin;
exports.resolveSlotRequiredQuantity = resolveSlotRequiredQuantity;
exports.slotCoverageStatus = slotCoverageStatus;
exports.slotAlreadyHasCoverer = slotAlreadyHasCoverer;
exports.closeSiblingNoPlanningVacancies = closeSiblingNoPlanningVacancies;
exports.queueCloseSiblingVacanciesInBatch = queueCloseSiblingVacanciesInBatch;
const firestore_1 = require("firebase-admin/firestore");
function normalizePosMatch(n) {
    let s = String(n ?? '').trim().toLowerCase();
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/^puesto\s+/, '');
    return s;
}
function isNoPlanningVacancyOrigin(data) {
    const o = String(data?.vacancyOrigin || data?.origin || '').toUpperCase();
    return o.includes('NO_PLANNING') || o.includes('SIN_PLANIFICAR') || o === 'SLA_VIRTUAL';
}
function isVacancyDoc(data) {
    return (data.isUnassigned === true
        || data.employeeId === 'VACANTE'
        || String(data.employeeName || '').toUpperCase().startsWith('VACANTE')
        || String(data.status || '').toUpperCase() === 'UNCOVERED');
}
function isRealCovererDoc(data) {
    if (isVacancyDoc(data))
        return false;
    if (data.isAbsent === true || data.isFranco === true)
        return false;
    if (data.isSinCobertura === true || data.employeeId === 'SIN_COBERTURA')
        return false;
    const empId = String(data.employeeId || '');
    if (!empId || empId === 'VACANTE')
        return false;
    return true;
}
function resolveSlotRequiredQuantity(data) {
    const raw = Number(data?.requiredQuantity
        ?? data?.slotRequiredQuantity
        ?? data?.quantity
        ?? data?.guardQty
        ?? 0);
    if (Number.isFinite(raw) && raw >= 1)
        return Math.floor(raw);
    return 1;
}
async function querySlotDocs(db, slot) {
    const objId = String(slot.objectiveId || '').trim();
    try {
        let q = db.collection('turnos')
            .where('objectiveId', '==', objId)
            .where('startTime', '==', slot.startTime)
            .limit(60);
        if (slot.empresaId) {
            q = db.collection('turnos')
                .where('empresaId', '==', slot.empresaId)
                .where('objectiveId', '==', objId)
                .where('startTime', '==', slot.startTime)
                .limit(60);
        }
        return await q.get();
    }
    catch {
        return await db.collection('turnos')
            .where('objectiveId', '==', objId)
            .where('startTime', '==', slot.startTime)
            .limit(60)
            .get();
    }
}
async function slotCoverageStatus(db, slot) {
    const objId = String(slot.objectiveId || '').trim();
    const stamped = Math.max(1, Math.floor(Number(slot.requiredQuantity) || 1));
    if (!objId || !slot.startTime) {
        return { covered: 0, required: stamped, saturated: false, covererNames: [] };
    }
    const pos = normalizePosMatch(slot.positionName);
    const exclude = new Set((slot.excludeShiftIds || []).map(String));
    const snap = await querySlotDocs(db, slot);
    const covererNames = [];
    let openVacancies = 0;
    for (const d of snap.docs) {
        if (exclude.has(d.id))
            continue;
        const data = d.data();
        const dPos = normalizePosMatch(data.positionName);
        const coversPos = normalizePosMatch(data.coversPositionName);
        if (pos && dPos !== pos && coversPos !== pos && isRealCovererDoc(data))
            continue;
        if (pos && dPos && dPos !== pos && isVacancyDoc(data))
            continue;
        if (isVacancyDoc(data)) {
            const st = String(data.status || '').toUpperCase();
            if (st !== 'COVERED' && st !== 'CANCELLED' && st !== 'COMPLETED')
                openVacancies++;
            continue;
        }
        if (!isRealCovererDoc(data))
            continue;
        if (pos && dPos !== pos && coversPos !== pos)
            continue;
        covererNames.push(String(data.employeeName || data.employeeId || d.id));
    }
    const covered = covererNames.length;
    const inferred = Math.max(stamped, covered + openVacancies);
    const required = Number(slot.requiredQuantity) > 1 ? stamped : inferred;
    return {
        covered,
        required,
        saturated: covered >= required,
        covererNames,
    };
}
async function slotAlreadyHasCoverer(db, slot) {
    const st = await slotCoverageStatus(db, slot);
    return {
        saturated: st.saturated,
        covererNames: st.covererNames,
        covered: st.covered,
        required: st.required,
    };
}
async function closeSiblingNoPlanningVacancies(db, opts) {
    const objId = String(opts.objectiveId || '').trim();
    const coveredId = String(opts.coveredVacancyId || '').trim();
    if (!objId || !opts.startTime || !coveredId)
        return 0;
    const required = Math.max(1, Math.floor(Number(opts.requiredQuantity) || 1));
    const status = await slotCoverageStatus(db, {
        objectiveId: objId,
        positionName: opts.positionName,
        startTime: opts.startTime,
        empresaId: opts.empresaId,
        requiredQuantity: required,
        excludeShiftIds: [],
    });
    if (!status.saturated)
        return 0;
    const pos = normalizePosMatch(opts.positionName);
    const snap = await querySlotDocs(db, {
        objectiveId: objId,
        positionName: opts.positionName,
        startTime: opts.startTime,
        empresaId: opts.empresaId,
    });
    const batch = db.batch();
    let closed = 0;
    const siblingIds = [];
    for (const d of snap.docs) {
        if (d.id === coveredId)
            continue;
        const data = d.data();
        if (!isVacancyDoc(data))
            continue;
        if (!isNoPlanningVacancyOrigin(data) && String(data.origin || '') !== 'SLA_VIRTUAL')
            continue;
        const dPos = normalizePosMatch(data.positionName);
        if (pos && dPos && dPos !== pos)
            continue;
        const st = String(data.status || '').toUpperCase();
        if (st === 'COVERED' || st === 'CANCELLED' || st === 'COMPLETED')
            continue;
        siblingIds.push(d.id);
        batch.update(d.ref, {
            status: 'COVERED',
            isUnassigned: false,
            coveredByEmployeeId: opts.covererEmployeeId || null,
            coveredByEmployeeName: opts.covererEmployeeName || null,
            coverageEventId: opts.coverageEventId || data.coverageEventId || null,
            coveredBySiblingVacancyId: coveredId,
            slotSaturatedClosedAt: firestore_1.FieldValue.serverTimestamp(),
            resolvedBy: opts.resolvedBy || data.resolvedBy || 'AUTO',
        });
        closed++;
    }
    if (!closed)
        return 0;
    await batch.commit();
    for (const sid of siblingIds) {
        const convs = await db.collection('convocatorias_cobertura')
            .where('shiftId', '==', sid)
            .where('status', 'in', ['PENDING', 'ESCALATED'])
            .limit(20)
            .get();
        if (convs.empty)
            continue;
        const cb = db.batch();
        for (const c of convs.docs) {
            cb.update(c.ref, {
                status: 'CANCELLED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                cancelReason: 'SLOT_YA_SATURADO',
            });
        }
        await cb.commit();
    }
    return closed;
}
function queueCloseSiblingVacanciesInBatch(batch, siblingDocs, opts) {
    const pos = normalizePosMatch(opts.positionName);
    const closedIds = [];
    for (const d of siblingDocs) {
        if (d.id === opts.coveredVacancyId)
            continue;
        const data = d.data();
        if (!isVacancyDoc(data))
            continue;
        if (!isNoPlanningVacancyOrigin(data) && String(data.origin || '') !== 'SLA_VIRTUAL')
            continue;
        const dPos = normalizePosMatch(data.positionName);
        if (pos && dPos && dPos !== pos)
            continue;
        const st = String(data.status || '').toUpperCase();
        if (st === 'COVERED' || st === 'CANCELLED' || st === 'COMPLETED')
            continue;
        batch.update(d.ref, {
            status: 'COVERED',
            isUnassigned: false,
            coveredByEmployeeId: opts.covererEmployeeId || null,
            coveredByEmployeeName: opts.covererEmployeeName || null,
            coverageEventId: opts.coverageEventId || null,
            coveredBySiblingVacancyId: opts.coveredVacancyId,
            slotSaturatedClosedAt: firestore_1.FieldValue.serverTimestamp(),
            resolvedBy: opts.resolvedBy || 'AUTO',
        });
        closedIds.push(d.id);
    }
    return closedIds;
}
//# sourceMappingURL=slotCoverageGuard.js.map