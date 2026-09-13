"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillCoverageLedger = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const coverageLedger_1 = require("./coverageLedger");
const SUPER_ADMIN_ROLES = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];
function isVacancyLike(d) {
    const origin = String(d.origin || '').toUpperCase();
    return (d.isUnassigned === true
        || d.employeeId === 'VACANTE'
        || String(d.employeeName || '').toUpperCase().startsWith('VACANTE')
        || origin.startsWith('VACANTE_')
        || origin === 'INTERRUPTION');
}
function dayBoundsAr(dateStr) {
    return {
        start: new Date(`${dateStr}T00:00:00-03:00`),
        end: new Date(`${dateStr}T23:59:59.999-03:00`),
    };
}
function buildMatches(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const used = new Set();
    const matches = [];
    const claim = (...ids) => {
        for (const id of ids) {
            if (id)
                used.add(id);
        }
    };
    for (const row of rows) {
        if (used.has(row.id))
            continue;
        if (String(row.data.coverageEventId || '').trim())
            continue;
        if (!isVacancyLike(row.data))
            continue;
        const coveredById = row.data.coveredByEmployeeId ? String(row.data.coveredByEmployeeId) : '';
        const coveredByName = String(row.data.coveredByEmployeeName || '').trim();
        if (!coveredById && !coveredByName && row.data.status !== 'COVERED')
            continue;
        const titularId = (row.data.causedByShiftId && byId.has(String(row.data.causedByShiftId))
            ? String(row.data.causedByShiftId)
            : null)
            || (row.data.originRef && byId.has(String(row.data.originRef))
                ? String(row.data.originRef)
                : null);
        let covererId = null;
        if (coveredById) {
            const hit = rows.find((r) => !used.has(r.id)
                && !isVacancyLike(r.data)
                && String(r.data.employeeId || '') === coveredById
                && !String(r.data.coverageEventId || '').trim());
            if (hit)
                covererId = hit.id;
        }
        const eventId = (0, coverageLedger_1.newCoverageEventId)();
        const titularName = String(row.data.causedByEmployeeName
            || (titularId ? byId.get(titularId)?.data.employeeName : '')
            || '');
        matches.push({
            eventId,
            titularId,
            vacancyId: row.id,
            covererId,
            covererName: coveredByName || (covererId ? String(byId.get(covererId)?.data.employeeName || '') : ''),
            titularName,
            coverageType: String(row.data.coverageType || 'BACKFILL'),
            reason: 'vacancy_covered',
        });
        claim(row.id, titularId, covererId);
    }
    for (const row of rows) {
        if (used.has(row.id))
            continue;
        if (String(row.data.coverageEventId || '').trim())
            continue;
        if (isVacancyLike(row.data))
            continue;
        const coversEmpId = row.data.coversEmployeeId ? String(row.data.coversEmployeeId) : '';
        const coversName = String(row.data.coversAbsenceEmployeeName || '').trim().toLowerCase();
        if (!coversEmpId && !coversName)
            continue;
        let titularId = null;
        if (row.data.causedByShiftId && byId.has(String(row.data.causedByShiftId))) {
            titularId = String(row.data.causedByShiftId);
        }
        else if (row.data.absenceShiftId && byId.has(String(row.data.absenceShiftId))) {
            const absId = String(row.data.absenceShiftId);
            const abs = byId.get(absId);
            if (isVacancyLike(abs.data) && abs.data.causedByShiftId && byId.has(String(abs.data.causedByShiftId))) {
                titularId = String(abs.data.causedByShiftId);
            }
            else if (!isVacancyLike(abs.data)) {
                titularId = absId;
            }
        }
        else if (coversEmpId) {
            const hit = rows.find((r) => !used.has(r.id)
                && String(r.data.employeeId || '') === coversEmpId
                && (r.data.isAbsent === true || r.data.coveredByEmployeeId || r.data.operacionallyCovered));
            if (hit)
                titularId = hit.id;
        }
        else if (coversName.length > 2) {
            const hit = rows.find((r) => {
                if (used.has(r.id) || isVacancyLike(r.data))
                    return false;
                const name = String(r.data.employeeName || '').toLowerCase();
                return name.includes(coversName) || coversName.includes(name.split(',')[0] || '');
            });
            if (hit)
                titularId = hit.id;
        }
        let vacancyId = null;
        if (titularId) {
            const vac = rows.find((r) => !used.has(r.id)
                && isVacancyLike(r.data)
                && (String(r.data.causedByShiftId || '') === titularId
                    || String(r.data.originRef || '') === titularId));
            if (vac)
                vacancyId = vac.id;
        }
        const eventId = (0, coverageLedger_1.newCoverageEventId)();
        matches.push({
            eventId,
            titularId,
            vacancyId,
            covererId: row.id,
            covererName: String(row.data.employeeName || ''),
            titularName: coversName || String(titularId ? byId.get(titularId)?.data.employeeName : ''),
            coverageType: String(row.data.coverageType || 'BACKFILL'),
            reason: 'coverer_signal',
        });
        claim(row.id, titularId, vacancyId);
    }
    for (const row of rows) {
        if (used.has(row.id))
            continue;
        if (String(row.data.coverageEventId || '').trim())
            continue;
        if (isVacancyLike(row.data))
            continue;
        if (!(row.data.isAbsent === true || String(row.data.status || '').toUpperCase() === 'ABSENT'))
            continue;
        const coveredById = row.data.coveredByEmployeeId ? String(row.data.coveredByEmployeeId) : '';
        const coveredByName = String(row.data.coveredByEmployeeName || '').trim();
        if (!coveredById && !coveredByName)
            continue;
        let covererId = null;
        if (coveredById) {
            const hit = rows.find((r) => !used.has(r.id)
                && !isVacancyLike(r.data)
                && String(r.data.employeeId || '') === coveredById);
            if (hit)
                covererId = hit.id;
        }
        const vacancyId = rows.find((r) => !used.has(r.id)
            && isVacancyLike(r.data)
            && (String(r.data.causedByShiftId || '') === row.id
                || String(r.data.originRef || '') === row.id))?.id || null;
        const eventId = (0, coverageLedger_1.newCoverageEventId)();
        matches.push({
            eventId,
            titularId: row.id,
            vacancyId,
            covererId,
            covererName: coveredByName || (covererId ? String(byId.get(covererId)?.data.employeeName || '') : ''),
            titularName: String(row.data.employeeName || ''),
            coverageType: String(row.data.coverageType || 'BACKFILL'),
            reason: 'titular_covered_by',
        });
        claim(row.id, covererId, vacancyId);
    }
    return matches.filter((m) => m.titularId || m.vacancyId || m.covererId);
}
exports.backfillCoverageLedger = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    }
    const role = String(context.auth.token?.role ?? '');
    if (!SUPER_ADMIN_ROLES.includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo SuperAdmin puede ejecutar backfill.');
    }
    const empresaId = String(data?.empresaId || '').trim();
    const dateStr = String(data?.dateStr || '').trim();
    if (!empresaId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId y dateStr (YYYY-MM-DD) requeridos.');
    }
    const dryRun = data?.dryRun !== false;
    const db = admin.firestore();
    const { start, end } = dayBoundsAr(dateStr);
    const snap = await db.collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
        .get();
    const rows = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter((r) => !r.data.draft && !r.data.isVirtual);
    const matches = buildMatches(rows);
    let updated = 0;
    const samples = [];
    if (!dryRun && matches.length > 0) {
        let batch = db.batch();
        let ops = 0;
        const flush = async () => {
            if (ops === 0)
                return;
            await batch.commit();
            batch = db.batch();
            ops = 0;
        };
        for (const m of matches) {
            const patchBase = {
                coverageEventId: m.eventId,
                coverageType: m.coverageType,
                resolvedBy: 'BACKFILL',
                backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
                backfillReason: m.reason,
            };
            if (m.titularId) {
                batch.update(db.collection('turnos').doc(m.titularId), {
                    ...patchBase,
                    coveredByEmployeeId: m.covererId
                        ? (rows.find((r) => r.id === m.covererId)?.data.employeeId || null)
                        : null,
                    coveredByEmployeeName: m.covererName || null,
                    operacionallyCovered: true,
                });
                ops += 1;
                updated += 1;
            }
            if (m.vacancyId) {
                batch.update(db.collection('turnos').doc(m.vacancyId), {
                    ...patchBase,
                    coveredByEmployeeName: m.covererName || null,
                    causedByEmployeeName: m.titularName || null,
                });
                ops += 1;
                updated += 1;
            }
            if (m.covererId) {
                batch.update(db.collection('turnos').doc(m.covererId), {
                    ...patchBase,
                    coversAbsenceEmployeeName: m.titularName || null,
                    causedByShiftId: m.titularId || null,
                    absenceShiftId: m.vacancyId || m.titularId || null,
                });
                ops += 1;
                updated += 1;
            }
            if (ops >= 400)
                await flush();
            if (samples.length < 8) {
                samples.push(`${m.reason}:${m.eventId}:${m.titularName}->${m.covererName}`);
            }
        }
        await flush();
    }
    else {
        for (const m of matches.slice(0, 8)) {
            samples.push(`${m.reason}:${m.eventId}:${m.titularName}->${m.covererName}`);
        }
    }
    return {
        dryRun,
        dateStr,
        empresaId,
        scanned: rows.length,
        matched: matches.length,
        updated: dryRun ? 0 : updated,
        skipped: rows.filter((r) => String(r.data.coverageEventId || '').trim()).length,
        samples,
    };
});
//# sourceMappingURL=backfillCoverageLedger.js.map