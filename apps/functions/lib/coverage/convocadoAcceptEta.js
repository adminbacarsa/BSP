"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordConvocadoAcceptEta = recordConvocadoAcceptEta;
exports.responderRecordatorioConvocadoShift = responderRecordatorioConvocadoShift;
const firestore_1 = require("firebase-admin/firestore");
const syncAusenciaCobertura_1 = require("./syncAusenciaCobertura");
const convocatoriaEventos_1 = require("./convocatoriaEventos");
const convocadoEta_1 = require("../common/convocadoEta");
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function pair(obj, latKeys, lngKeys) {
    if (!obj)
        return null;
    let lat = null;
    let lng = null;
    for (const k of latKeys) {
        const n = num(obj[k]);
        if (n != null) {
            lat = n;
            break;
        }
    }
    for (const k of lngKeys) {
        const n = num(obj[k]);
        if (n != null) {
            lng = n;
            break;
        }
    }
    const nested = obj.domicilio;
    if (lat == null)
        lat = num(nested?.lat ?? nested?.latitude);
    if (lng == null)
        lng = num(nested?.lng ?? nested?.longitude);
    if (lat == null || lng == null)
        return null;
    return { lat, lng };
}
async function empresaEtaParams(db, empresaId) {
    const snap = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
    const d = snap?.data() || {};
    const speed = num(d.convocadoEtaSpeedKmh) ?? convocadoEta_1.CONVOCADO_ETA_SPEED_KMH;
    const wait = num(d.convocadoEtaWaitMinutes) ?? convocadoEta_1.CONVOCADO_ETA_WAIT_MIN;
    return { speed, wait };
}
async function recordConvocadoAcceptEta(db, convocatoriaId, opts = {}) {
    const id = String(convocatoriaId || '').trim();
    const ref = db.collection('convocatorias_cobertura').doc(id);
    const snap = await ref.get();
    if (!snap.exists)
        return { etaMinutes: convocadoEta_1.CONVOCADO_ETA_WAIT_MIN, originSource: 'SIN_COORD' };
    const conv = snap.data();
    const now = opts.now || firestore_1.Timestamp.now();
    const nowMs = now.toMillis();
    const empId = String(conv.candidateEmployeeId || '').trim();
    const emp = empId ? (await db.collection('empleados').doc(empId).get()).data() : undefined;
    const titId = String(conv.shiftId || '').trim();
    const tit = titId ? (await db.collection('turnos').doc(titId).get()).data() : undefined;
    const device = pair(opts.originCoords, ['lat', 'latitude'], ['lng', 'longitude', 'lon']);
    const home = pair(emp, ['lat', 'latitude'], ['lng', 'longitude', 'lon']);
    const origin = device || home;
    const originSource = device ? 'DEVICE' : home ? 'DOMICILIO' : 'SIN_COORD';
    const dest = pair(tit, ['lat', 'objectiveLat', 'latitude'], ['lng', 'objectiveLng', 'longitude']);
    const km = origin && dest ? (0, convocadoEta_1.haversineKm)(origin.lat, origin.lng, dest.lat, dest.lng) : null;
    let sameObjective = false;
    const ct = String(conv.type || '').toUpperCase();
    const sourceId = String(conv.candidateShiftId || conv.extendShiftId || conv.advanceShiftId || conv.ftShiftId || '').trim();
    if ((ct === 'ESC' || ct === 'REF') && sourceId) {
        const src = (await db.collection('turnos').doc(sourceId).get()).data();
        sameObjective = !!src && String(src.objectiveId || '') === String(conv.objectiveId || '') && !!conv.objectiveId;
    }
    const params = await empresaEtaParams(db, String(conv.empresaId || ''));
    const travel = (0, convocadoEta_1.convocadoTravelEta)({
        coverageType: ct,
        sameObjective,
        distanceKm: km,
        speedKmh: params.speed,
        waitMin: params.wait,
    });
    const etaMinutes = travel.etaMinutes;
    const expectedMs = nowMs + etaMinutes * 60 * 1000;
    const reminderMs = (0, convocadoEta_1.convocadoReminderAtMs)(nowMs, etaMinutes);
    const gapEndMs = num(tit?.endTime?.toMillis?.()) ?? 0;
    const patch = {
        originCoords: origin ? { lat: origin.lat, lng: origin.lng, ...(num(opts.originCoords?.accuracy) != null ? { accuracy: num(opts.originCoords?.accuracy) } : {}) } : null,
        originSource,
        etaMinutes,
        etaTraveled: travel.traveled,
        expectedArrivalAt: firestore_1.Timestamp.fromMillis(expectedMs),
        reminderAt: firestore_1.Timestamp.fromMillis(reminderMs),
        reminderPending: true,
        delayAlertPending: true,
        ...(gapEndMs > 0 ? { gapEndAt: firestore_1.Timestamp.fromMillis(gapEndMs) } : {}),
        acceptedAt: conv.respondedAt || now,
    };
    await ref.update(patch);
    const covId = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(titId, empId);
    const cov = await db.collection('turnos').doc(covId).get();
    if (cov.exists) {
        await cov.ref.update({
            expectedArrivalAt: patch.expectedArrivalAt,
            originSource,
            etaMinutes,
            convocadoReminderAt: patch.reminderAt,
            acceptedAt: patch.acceptedAt,
        });
    }
    await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, id, {
        type: 'ACEPTADA',
        originSource,
        etaMinutes,
        at: now,
    });
    return { etaMinutes, originSource };
}
async function responderRecordatorioConvocadoShift(db, input) {
    const id = String(input.convocatoriaId || '').trim();
    if (!id)
        return { success: false, reason: 'INVALID' };
    const ref = db.collection('convocatorias_cobertura').doc(id);
    const snap = await ref.get();
    if (!snap.exists)
        return { success: false, reason: 'NOT_FOUND' };
    const conv = snap.data();
    if (String(conv.status || '') !== 'ACCEPTED')
        return { success: false, reason: 'NOT_ACCEPTED' };
    const now = firestore_1.Timestamp.now();
    if (input.action === 'PROBLEM') {
        const note = String(input.note || '').trim();
        await db.collection('novedades').add({
            type: 'PROBLEMA_CONVOCADO',
            status: 'pending',
            priority: 'high',
            convocatoriaId: id,
            shiftId: conv.shiftId || null,
            employeeId: conv.candidateEmployeeId || null,
            employeeName: conv.candidateEmployeeName || '',
            objectiveId: conv.objectiveId || null,
            objectiveName: conv.objectiveName || '',
            empresaId: conv.empresaId || null,
            title: 'Problema del convocado',
            description: note || `${conv.candidateEmployeeName || 'Convocado'} avisó un problema yendo al objetivo.`,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            source: 'CONVOCADO',
        });
        await ref.update({ convocadoReply: 'PROBLEM', convocadoReplyAt: now, convocadoReplyNote: note || null });
        await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, id, { type: 'RESPUESTA', response: 'PROBLEM', reason: note || undefined, at: now });
        return { success: true };
    }
    const eta = [10, 15, 30].includes(Number(input.etaMinutes)) ? Number(input.etaMinutes) : 15;
    const expected = firestore_1.Timestamp.fromMillis(now.toMillis() + eta * 60 * 1000);
    await ref.update({
        convocadoReply: 'ON_WAY',
        convocadoReplyAt: now,
        convocadoReplyEtaMinutes: eta,
        expectedArrivalAt: expected,
        delayAlertPending: true,
        delayAlertedForArrivalAt: firestore_1.FieldValue.delete(),
    });
    const covId = (0, syncAusenciaCobertura_1.buildOpsCoverageDocId)(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
    const cov = await db.collection('turnos').doc(covId).get();
    if (cov.exists) {
        await cov.ref.update({
            expectedArrivalAt: expected,
            convocadoReply: 'ON_WAY',
            convocadoDemorado: false,
        });
    }
    await (0, convocatoriaEventos_1.logConvocatoriaEvento)(db, id, { type: 'RESPUESTA', response: 'ON_WAY', etaMinutes: eta, at: now });
    return { success: true };
}
//# sourceMappingURL=convocadoAcceptEta.js.map