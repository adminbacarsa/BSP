"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkConvocatoriaTimeouts = exports.getCandidatosCobertura = exports.cancelarConvocatoriaCobertura = exports.responderConvocatoriaCobertura = exports.crearConvocatoriaCobertura = void 0;
exports.iniciarCascadaCobertura = iniciarCascadaCobertura;
exports.simularRespuestasConvocatorias = simularRespuestasConvocatorias;
exports.crearConvocatoriaLlegadaTarde = crearConvocatoriaLlegadaTarde;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const eligibilityFilter_1 = require("./eligibilityFilter");
const coverageLedger_1 = require("./coverageLedger");
const coverage_auth_util_1 = require("./coverage-auth.util");
const shiftContinuity_1 = require("./shiftContinuity");
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function empCoords(emp) {
    const lat = Number(emp.lat ?? emp.location?.lat);
    const lng = Number(emp.lng ?? emp.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return null;
    return { lat, lng };
}
function knowledgeScore(emp, objectiveId) {
    if (emp.preferredObjectiveId === objectiveId)
        return 3;
    if ((emp.experienciaObjetivos || {})[objectiveId])
        return 2;
    if ((emp.volante || []).includes(objectiveId))
        return 1;
    return 0;
}
const TIMEOUT_MINUTES = 3;
const TYPE_LABEL = {
    RET: 'Retención (RET)',
    ESC: 'Escuela / Refuerzo',
    VOLANTE: 'Cobertura volante',
    SIN_TURNO_CON_EXP: 'Cobertura disponible',
    CROSS_POS: 'Otro puesto (mismo objetivo)',
    EXTEND: 'Extensión de jornada',
    ADVANCE: 'Adelanto de turno',
    INTERCAMBIO: 'Intercambio de banda',
    SIN_TURNO: 'Cobertura disponible',
    FT: 'Franco Trabajado (FT)',
    LLEGADA_TARDE: '¿Estás en camino?',
};
async function crearNotifConvocatoria(db, conv) {
    const urgencyLabel = conv.urgency === 'URGENTE' ? '⚡ URGENTE' : conv.urgency === 'INTERMEDIO' ? 'Intermedia' : 'Normal';
    const startDate = conv.startTime instanceof firestore_1.Timestamp
        ? conv.startTime.toDate().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Argentina/Buenos_Aires',
        })
        : '--:--';
    const isLlegadaTarde = conv.type === 'LLEGADA_TARDE';
    const title = isLlegadaTarde ? '⏰ ¿Estás en camino?' : `[${urgencyLabel}] Cobertura requerida`;
    const body = isLlegadaTarde
        ? `Tu turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'el puesto'} comenzó a las ${startDate}. Confirmá si estás en camino en los próximos ${TIMEOUT_MINUTES} min.`
        : `${TYPE_LABEL[conv.type] || conv.type} en ${conv.objectiveName || 'el puesto'} — turno ${conv.shiftCode || ''} ${startDate}. Respondé en los próximos ${TIMEOUT_MINUTES} min.`;
    await db.collection('user_notifications').add({
        uid: conv.candidateUid || null,
        employeeId: conv.candidateEmployeeId,
        type: 'CONVOCATORIA_COBERTURA',
        title,
        body,
        empresaId: conv.empresaId,
        convocatoriaId: conv.id,
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        read: false,
        readAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function crearConvocatoriaDoc(db, data) {
    const now = firestore_1.Timestamp.now();
    const timeoutAt = firestore_1.Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);
    const urgency = (0, eligibilityFilter_1.getUrgency)(data.startTime);
    const cascadeStepKey = data.cascadeStepKey || (0, eligibilityFilter_1.toCascadeStep)(data.type) || undefined;
    const docData = {
        ...data,
        cascadeStepKey: cascadeStepKey,
        cascadeStep: cascadeStepKey ? eligibilityFilter_1.CASCADE_ORDER.indexOf(cascadeStepKey) : (0, eligibilityFilter_1.cascadeStepIndex)(data.type),
        urgency,
        status: 'PENDING',
        timeoutAt,
        createdAt: now,
    };
    const ref = await db.collection('convocatorias_cobertura').add(docData);
    await crearNotifConvocatoria(db, { ...docData, id: ref.id });
    await db.collection('novedades').add({
        type: 'CONVOCATORIA_ENVIADA',
        convocatoriaId: ref.id,
        shiftId: data.shiftId,
        objectiveId: data.objectiveId,
        objectiveName: data.objectiveName || '',
        clientId: data.clientId || null,
        empresaId: data.empresaId,
        title: 'Convocatoria enviada',
        message: `${TYPE_LABEL[data.type] || data.type} → ${data.candidateEmployeeName} — turno ${data.shiftCode || ''} en ${data.objectiveName || 'objetivo'}`,
        coverageType: data.type,
        cascadeStepKey: cascadeStepKey || null,
        candidateEmployeeId: data.candidateEmployeeId,
        candidateEmployeeName: data.candidateEmployeeName,
        status: 'unread',
        resolved: false,
        createdAt: now,
    });
    return ref.id;
}
async function loadAlreadyConvocadoIds(db, empresaId, shiftId) {
    const activeConvSnap = await db.collection('convocatorias_cobertura')
        .where('empresaId', '==', empresaId)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .get();
    const ids = new Set();
    for (const d of activeConvSnap.docs) {
        const c = d.data();
        if (c.shiftId !== shiftId && c.candidateEmployeeId) {
            ids.add(String(c.candidateEmployeeId));
        }
    }
    return ids;
}
async function findCandidatesForConvType(db, conv, type, limit = eligibilityFilter_1.BROADCAST_LIMIT) {
    const ctx = {
        objectiveId: conv.objectiveId,
        clientId: conv.clientId,
        aptitudesRequeridas: conv.aptitudesRequeridas || [],
    };
    const out = [];
    if (type === 'EXTEND') {
        const vacPos = String(conv.positionName || '').trim().toLowerCase();
        const active = await db.collection('turnos')
            .where('objectiveId', '==', conv.objectiveId)
            .where('empresaId', '==', conv.empresaId)
            .where('isPresent', '==', true)
            .where('isCompleted', '==', false)
            .limit(20)
            .get();
        const samePos = [];
        const otherPos = [];
        for (const d of active.docs) {
            const t = d.data();
            if (d.id === conv.shiftId)
                continue;
            const code = String(t.code || '').toUpperCase();
            if (code !== 'M' && code !== 'T' && code !== 'N')
                continue;
            const empSnap = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'EXTEND').eligible)
                continue;
            const row = {
                id: t.employeeId,
                name: t.employeeName || '',
                uid: emp.uid,
                convocatoriaType: 'EXTEND',
                extendShiftId: d.id,
            };
            const isSame = vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos;
            (isSame ? samePos : otherPos).push(row);
        }
        for (const c of [...samePos, ...otherPos]) {
            if (out.length >= limit)
                break;
            out.push(c);
        }
        return out;
    }
    if (type === 'ADVANCE') {
        const vacPos = String(conv.positionName || '').trim().toLowerCase();
        const now = firestore_1.Timestamp.now();
        const windowEnd = firestore_1.Timestamp.fromMillis(now.toMillis() + 12 * 3600 * 1000);
        const next = await db.collection('turnos')
            .where('objectiveId', '==', conv.objectiveId)
            .where('empresaId', '==', conv.empresaId)
            .where('startTime', '>', now)
            .where('startTime', '<=', windowEnd)
            .where('isCompleted', '==', false)
            .orderBy('startTime')
            .limit(20)
            .get();
        const samePos = [];
        const otherPos = [];
        for (const d of next.docs) {
            const t = d.data();
            if (!t.employeeId || t.employeeId === 'VACANTE' || d.id === conv.shiftId)
                continue;
            if (t.isPresent || t.isAbsent || t.isUnassigned || t.isFranco)
                continue;
            const empSnap = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'ADVANCE').eligible)
                continue;
            const row = {
                id: t.employeeId,
                name: t.employeeName || '',
                uid: emp.uid,
                convocatoriaType: 'ADVANCE',
                advanceShiftId: d.id,
            };
            const isSame = vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos;
            (isSame ? samePos : otherPos).push(row);
        }
        for (const c of [...samePos, ...otherPos]) {
            if (out.length >= limit)
                break;
            out.push(c);
        }
        return out;
    }
    const empSnap = await db.collection('empleados')
        .where('empresaId', '==', conv.empresaId)
        .where('status', 'in', ['ACTIVE', 'active', 'activo', 'ACTIVO'])
        .limit(200)
        .get();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 0);
    const allTodaySnap = await db.collection('turnos')
        .where('empresaId', '==', conv.empresaId)
        .where('startTime', '>=', firestore_1.Timestamp.fromDate(todayStart))
        .where('startTime', '<=', firestore_1.Timestamp.fromDate(todayEnd))
        .limit(500)
        .get();
    const busyEmpIds = new Set();
    const francoShiftByEmp = new Map();
    const retShiftByEmp = new Map();
    const escShiftByEmp = new Map();
    const posteriorShifts = [];
    const vacantStartMs = conv.startTime?.toMillis?.() ?? Date.now();
    for (const d of allTodaySnap.docs) {
        const t = d.data();
        if (!t.employeeId || t.employeeId === 'VACANTE')
            continue;
        const code = String(t.code || '').toUpperCase();
        if (['F', 'FF', 'FP'].includes(code)) {
            francoShiftByEmp.set(t.employeeId, d.id);
        }
        else if (code === 'RET') {
            retShiftByEmp.set(t.employeeId, d.id);
        }
        else if ((code === 'ESC' || code === 'REF') && t.objectiveId === conv.objectiveId) {
            escShiftByEmp.set(t.employeeId, d.id);
        }
        else if (code !== 'FT') {
            busyEmpIds.add(t.employeeId);
        }
        if (t.objectiveId === conv.objectiveId
            && d.id !== conv.shiftId
            && t.employeeId
            && !t.isFranco
            && !t.isAbsent
            && !t.isUnassigned
            && !['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'SUS', 'RET', 'ESC', 'REF'].includes(code)) {
            const startMs = t.startTime?.toMillis?.() ?? 0;
            if (startMs > vacantStartMs + 30 * 60 * 1000) {
                posteriorShifts.push({
                    id: d.id,
                    employeeId: t.employeeId,
                    employeeName: t.employeeName,
                    startMs,
                });
            }
        }
    }
    let objLat = null;
    let objLng = null;
    if (conv.clientId && conv.objectiveId) {
        try {
            const clientSnap = await db.collection('clients').doc(conv.clientId).get();
            const objs = clientSnap.data()?.objetivos || [];
            const obj = objs.find((o) => o.id === conv.objectiveId || o.objectiveId === conv.objectiveId);
            if (obj) {
                const lat = Number(obj.lat ?? obj.latitude ?? obj.location?.lat);
                const lng = Number(obj.lng ?? obj.longitude ?? obj.location?.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    objLat = lat;
                    objLng = lng;
                }
            }
        }
        catch { }
    }
    const alreadyConvocadoIds = await loadAlreadyConvocadoIds(db, conv.empresaId, conv.shiftId);
    if (type === 'INTERCAMBIO') {
        for (const ps of posteriorShifts) {
            if (out.length >= limit)
                break;
            if (alreadyConvocadoIds.has(ps.employeeId))
                continue;
            const empSnap = await db.collection('empleados').doc(ps.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'INTERCAMBIO').eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, ps.employeeId, emp);
            out.push({
                id: ps.employeeId,
                name: ps.employeeName || `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
                uid: uid || undefined,
                convocatoriaType: 'INTERCAMBIO',
                sourceShiftId: ps.id,
            });
        }
        return out;
    }
    if (type === 'RET') {
        const pool = [];
        for (const empDoc of empSnap.docs) {
            const emp = empDoc.data();
            const empId = empDoc.id;
            if (!retShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            const coords = empCoords(emp);
            let dist = Infinity;
            if (objLat != null && objLng != null && coords) {
                dist = haversineKm(objLat, objLng, coords.lat, coords.lng);
            }
            const withinPrimary = !Number.isFinite(dist) || dist <= eligibilityFilter_1.RET_RADIUS_KM_PRIMARY;
            const withinExpanded = !Number.isFinite(dist) || dist <= eligibilityFilter_1.RET_RADIUS_KM_EXPANDED;
            if (!withinExpanded)
                continue;
            const maxKm = withinPrimary ? eligibilityFilter_1.RET_RADIUS_KM_PRIMARY : eligibilityFilter_1.RET_RADIUS_KM_EXPANDED;
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'RET', Number.isFinite(dist) ? dist : undefined, maxKm).eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
            pool.push({
                id: empId,
                name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId,
                uid: uid || undefined,
                convocatoriaType: 'RET',
                sourceShiftId: retShiftByEmp.get(empId),
                score: knowledgeScore(emp, conv.objectiveId),
                dist: Number.isFinite(dist) ? dist : 999,
            });
        }
        pool.sort((a, b) => b.score - a.score || a.dist - b.dist);
        for (const c of pool.slice(0, limit)) {
            out.push({
                id: c.id,
                name: c.name,
                uid: c.uid,
                convocatoriaType: c.convocatoriaType,
                sourceShiftId: c.sourceShiftId,
            });
        }
        return out;
    }
    if (type === 'CROSS_POS') {
        const vacPos = String(conv.positionName || '').trim().toLowerCase();
        const workCodes = new Set(['M', 'T', 'N', 'D12', 'N12', 'M1', 'T1', 'N1', 'RET', 'ESC', 'REF']);
        const active = await db.collection('turnos')
            .where('objectiveId', '==', conv.objectiveId)
            .where('empresaId', '==', conv.empresaId)
            .where('isPresent', '==', true)
            .where('isCompleted', '==', false)
            .limit(30)
            .get();
        for (const d of active.docs) {
            if (out.length >= limit)
                break;
            const t = d.data();
            if (d.id === conv.shiftId)
                continue;
            if (!t.employeeId || t.employeeId === 'VACANTE' || alreadyConvocadoIds.has(t.employeeId))
                continue;
            if (t.isAbsent || t.isFranco || t.isUnassigned)
                continue;
            if (vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos)
                continue;
            const code = String(t.code || '').toUpperCase();
            if (!workCodes.has(code))
                continue;
            const empSnapOne = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnapOne.exists)
                continue;
            const emp = empSnapOne.data();
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, t.employeeId, emp);
            out.push({
                id: t.employeeId,
                name: t.employeeName || `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
                uid: uid || undefined,
                convocatoriaType: 'CROSS_POS',
                sourceShiftId: d.id,
            });
        }
        return out;
    }
    for (const empDoc of empSnap.docs) {
        if (out.length >= limit)
            break;
        const emp = empDoc.data();
        const empId = empDoc.id;
        const name = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId;
        if (type === 'ESC') {
            if (!escShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'ESC').eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
            out.push({
                id: empId,
                name,
                uid: uid || undefined,
                convocatoriaType: 'ESC',
                sourceShiftId: escShiftByEmp.get(empId),
            });
            continue;
        }
        if (type === 'FT') {
            if (!francoShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'FT').eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
            out.push({
                id: empId,
                name,
                uid: uid || undefined,
                convocatoriaType: 'FT',
                ftShiftId: francoShiftByEmp.get(empId),
            });
            continue;
        }
        if (type === 'SIN_TURNO' || type === 'VOLANTE' || type === 'SIN_TURNO_CON_EXP') {
            if (busyEmpIds.has(empId) || francoShiftByEmp.has(empId) || retShiftByEmp.has(empId) || escShiftByEmp.has(empId))
                continue;
            if (alreadyConvocadoIds.has(empId))
                continue;
            const isVolante = (emp.volante || []).includes(conv.objectiveId);
            const isTitular = emp.preferredObjectiveId === conv.objectiveId;
            const hasExp = !!(emp.experienciaObjetivos || {})[conv.objectiveId];
            let derived = 'SIN_TURNO';
            if (isVolante)
                derived = 'VOLANTE';
            else if (isTitular || hasExp)
                derived = 'SIN_TURNO_CON_EXP';
            if (type === 'VOLANTE' && derived !== 'VOLANTE')
                continue;
            if (type === 'SIN_TURNO_CON_EXP' && derived !== 'SIN_TURNO_CON_EXP')
                continue;
            if (!(0, eligibilityFilter_1.checkEligibility)(emp, ctx, derived).eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
            out.push({
                id: empId,
                name,
                uid: uid || undefined,
                convocatoriaType: derived,
            });
        }
    }
    return out;
}
async function findCandidatesForStep(db, conv, step) {
    if (step === 'EXT_DUAL') {
        const [exts, advs] = await Promise.all([
            findCandidatesForConvType(db, conv, 'EXTEND', eligibilityFilter_1.BROADCAST_LIMIT),
            findCandidatesForConvType(db, conv, 'ADVANCE', eligibilityFilter_1.BROADCAST_LIMIT),
        ]);
        return [...exts, ...advs];
    }
    if (step === 'SIN_TURNO') {
        return findCandidatesForConvType(db, conv, 'SIN_TURNO', eligibilityFilter_1.BROADCAST_LIMIT);
    }
    if (step === 'RET')
        return findCandidatesForConvType(db, conv, 'RET', eligibilityFilter_1.BROADCAST_LIMIT);
    if (step === 'ESC')
        return findCandidatesForConvType(db, conv, 'ESC', eligibilityFilter_1.BROADCAST_LIMIT);
    if (step === 'CROSS_POS')
        return findCandidatesForConvType(db, conv, 'CROSS_POS', eligibilityFilter_1.BROADCAST_LIMIT);
    if (step === 'INTERCAMBIO')
        return findCandidatesForConvType(db, conv, 'INTERCAMBIO', eligibilityFilter_1.BROADCAST_LIMIT);
    if (step === 'FT')
        return findCandidatesForConvType(db, conv, 'FT', eligibilityFilter_1.BROADCAST_LIMIT);
    return [];
}
async function assignRetForced(db, baseConv, candidate, createdBy) {
    const now = firestore_1.Timestamp.now();
    const convRef = db.collection('convocatorias_cobertura').doc();
    const convDoc = {
        ...baseConv,
        type: 'RET',
        cascadeStepKey: 'RET',
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf('RET'),
        candidateEmployeeId: candidate.id,
        candidateEmployeeName: candidate.name,
        candidateUid: candidate.uid,
        sourceShiftId: candidate.sourceShiftId,
        status: 'ACCEPTED',
        timeoutAt: now,
        createdAt: now,
        createdBy,
        respondedAt: now,
        respondedBy: 'RET_FORZADO',
    };
    await convRef.set(convDoc);
    await resolverCobertura(db, { ...convDoc, id: convRef.id });
    if (candidate.uid || candidate.id) {
        await db.collection('user_notifications').add({
            uid: candidate.uid || null,
            employeeId: candidate.id,
            type: 'COBERTURA_ASIGNADA',
            title: 'RET asignado a cobertura',
            body: `Tu RET se convirtió en turno real en ${baseConv.objectiveName || 'el puesto'} (${baseConv.shiftCode || ''}). Presentate al puesto.`,
            empresaId: baseConv.empresaId,
            convocatoriaId: convRef.id,
            shiftId: baseConv.shiftId,
            objectiveId: baseConv.objectiveId,
            read: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
}
async function assignCrossPosForced(db, baseConv, candidate, createdBy) {
    const now = firestore_1.Timestamp.now();
    const convRef = db.collection('convocatorias_cobertura').doc();
    const convDoc = {
        ...baseConv,
        type: 'CROSS_POS',
        cascadeStepKey: 'CROSS_POS',
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf('CROSS_POS'),
        candidateEmployeeId: candidate.id,
        candidateEmployeeName: candidate.name,
        candidateUid: candidate.uid,
        sourceShiftId: candidate.sourceShiftId,
        status: 'ACCEPTED',
        timeoutAt: now,
        createdAt: now,
        createdBy,
        respondedAt: now,
        respondedBy: 'CROSS_POS_FORZADO',
    };
    await convRef.set(convDoc);
    await resolverCobertura(db, { ...convDoc, id: convRef.id });
    if (candidate.uid || candidate.id) {
        await db.collection('user_notifications').add({
            uid: candidate.uid || null,
            employeeId: candidate.id,
            type: 'COBERTURA_ASIGNADA',
            title: 'Redirección a otro puesto',
            body: `Pasás a cubrir ${baseConv.positionName || 'el puesto'} en ${baseConv.objectiveName || ''} (${baseConv.shiftCode || ''}). Tu puesto anterior queda vacante.`,
            empresaId: baseConv.empresaId,
            convocatoriaId: convRef.id,
            shiftId: baseConv.shiftId,
            objectiveId: baseConv.objectiveId,
            read: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
}
async function dispararPasoCascada(db, baseConv, step, createdBy) {
    const candidates = await findCandidatesForStep(db, baseConv, step);
    if (candidates.length === 0)
        return false;
    if (step === 'RET') {
        await assignRetForced(db, baseConv, candidates[0], createdBy);
        await db.collection('novedades').add({
            type: 'COBERTURA_RESUELTA',
            shiftId: baseConv.shiftId,
            objectiveId: baseConv.objectiveId,
            objectiveName: baseConv.objectiveName || '',
            empresaId: baseConv.empresaId,
            title: 'RET forzado asignado',
            message: `${candidates[0].name} (RET) → turno real. Sin aceptación (obligado).`,
            cascadeStepKey: step,
            status: 'pending',
            resolved: true,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return true;
    }
    if (step === 'CROSS_POS') {
        await assignCrossPosForced(db, baseConv, candidates[0], createdBy);
        await db.collection('novedades').add({
            type: 'COBERTURA_RESUELTA',
            shiftId: baseConv.shiftId,
            objectiveId: baseConv.objectiveId,
            objectiveName: baseConv.objectiveName || '',
            empresaId: baseConv.empresaId,
            title: 'Otro puesto redirigido',
            message: `${candidates[0].name} → ${baseConv.positionName || 'puesto'} (mismo objetivo). Liberó su puesto.`,
            cascadeStepKey: step,
            status: 'pending',
            resolved: true,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return true;
    }
    await Promise.all(candidates.map((c) => crearConvocatoriaDoc(db, {
        ...baseConv,
        type: c.convocatoriaType,
        cascadeStepKey: step,
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf(step),
        candidateEmployeeId: c.id,
        candidateEmployeeName: c.name,
        candidateUid: c.uid,
        ...(c.extendShiftId ? { extendShiftId: c.extendShiftId } : {}),
        ...(c.advanceShiftId ? { advanceShiftId: c.advanceShiftId } : {}),
        ...(c.ftShiftId ? { ftShiftId: c.ftShiftId } : {}),
        ...(c.sourceShiftId ? { sourceShiftId: c.sourceShiftId } : {}),
        createdBy,
    })));
    await db.collection('novedades').add({
        type: 'CONVOCATORIA_PASO_ENVIADO',
        shiftId: baseConv.shiftId,
        objectiveId: baseConv.objectiveId,
        objectiveName: baseConv.objectiveName || '',
        empresaId: baseConv.empresaId,
        title: `Protocolo auto — paso ${step}`,
        message: `${candidates.length} convocatoria(s) en paralelo (${step}) — gana el primero que acepte.`,
        cascadeStepKey: step,
        status: 'unread',
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return true;
}
async function maybeAvanzarCascada(db, conv, reason) {
    if (conv.type === 'LLEGADA_TARDE')
        return;
    const pendingSnap = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', conv.shiftId)
        .where('status', '==', 'PENDING')
        .limit(1)
        .get();
    if (!pendingSnap.empty)
        return;
    const vacantSnap = await db.collection('turnos').doc(conv.shiftId).get();
    const vacant = vacantSnap.exists ? vacantSnap.data() : {};
    if (String(vacant.status || '') === 'COVERED')
        return;
    const step = (conv.cascadeStepKey || (0, eligibilityFilter_1.toCascadeStep)(conv.type));
    if (!step)
        return;
    if (step === 'EXT_DUAL') {
        if (vacant.coverageDualExtBy && vacant.coverageDualAdvBy)
            return;
    }
    const next = (0, eligibilityFilter_1.nextCascadeStep)(step);
    if (!next) {
        await db.collection('novedades').add({
            type: 'VACANTE_SIN_COBERTURA',
            shiftId: conv.shiftId,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            empresaId: conv.empresaId,
            message: `Cascada de cobertura agotada para turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}. Sin candidatos disponibles.`,
            resolved: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return;
    }
    const nextIdx = eligibilityFilter_1.CASCADE_ORDER.indexOf(next);
    const alreadyNext = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', conv.shiftId)
        .where('status', '==', 'PENDING')
        .limit(5)
        .get();
    if (alreadyNext.docs.some((d) => Number(d.data().cascadeStep) >= nextIdx))
        return;
    let candidatePhone = null;
    if (conv.candidateEmployeeId) {
        const empSnap = await db.collection('empleados').doc(conv.candidateEmployeeId).get();
        if (empSnap.exists)
            candidatePhone = empSnap.data()?.telefono || null;
    }
    await db.collection('novedades').add({
        type: 'CONVOCATORIA_ESCALADA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        clientId: conv.clientId || null,
        empresaId: conv.empresaId,
        title: reason === 'REJECTED' ? 'Convocatoria rechazada' : 'Sin respuesta — escalando',
        message: `Paso ${step} agotado (${reason}) — escalando a ${next} en ${conv.objectiveName || 'objetivo'}`,
        coverageType: conv.type,
        nextCoverageType: next,
        cascadeStepKey: step,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        candidatePhone,
        status: 'unread',
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const base = {
        ...conv,
        candidateEmployeeId: '',
        candidateEmployeeName: '',
        candidateUid: undefined,
        extendShiftId: undefined,
        advanceShiftId: undefined,
        ftShiftId: undefined,
        sourceShiftId: undefined,
    };
    let cursor = next;
    while (cursor) {
        const sent = await dispararPasoCascada(db, base, cursor, 'AUTO');
        if (sent)
            return;
        cursor = (0, eligibilityFilter_1.nextCascadeStep)(cursor);
    }
    await db.collection('novedades').add({
        type: 'VACANTE_SIN_COBERTURA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId,
        message: `Cascada agotada (sin candidatos posteriores) para ${conv.objectiveName || 'objetivo'}.`,
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function cancelSiblingConvocatorias(batch, db, shiftId, exceptId, onlyTypes) {
    const [pendingSnap, escalatedSnap] = await Promise.all([
        db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'PENDING').get(),
        db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'ESCALATED').get(),
    ]);
    for (const d of [...pendingSnap.docs, ...escalatedSnap.docs]) {
        if (d.id === exceptId)
            continue;
        if (onlyTypes && !onlyTypes.includes(d.data().type))
            continue;
        batch.update(d.ref, { status: 'CANCELLED', cancelledAt: firestore_1.FieldValue.serverTimestamp() });
    }
}
function isShiftAlreadyCovered(data) {
    if (!data)
        return false;
    const st = String(data.status || '').toUpperCase();
    if (st === 'COVERED')
        return true;
    if (data.operacionallyCovered === true)
        return true;
    if (data.coveredByEmployeeId && data.coverageEventId)
        return true;
    if (data.coveredByEmployeeName && data.coverageEventId && st === 'COVERED')
        return true;
    return false;
}
function demoCovererPresenceFields(resolvedBy, presentAt) {
    if (resolvedBy !== 'MODO_DEMO')
        return {};
    const at = presentAt || firestore_1.Timestamp.now();
    return {
        isPresent: true,
        status: 'PRESENT',
        presentAt: at,
        realStartTime: at,
        autoPresencia: true,
        demoSimulated: true,
        modoDemoAt: firestore_1.FieldValue.serverTimestamp(),
    };
}
async function claimConvocatoriaAccept(db, convocatoriaId, respondedBy) {
    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new Error('NOT_FOUND');
            const st = String(snap.data()?.status || '');
            if (st !== 'PENDING' && st !== 'ESCALATED')
                throw new Error('ALREADY_CLAIMED');
            tx.update(ref, {
                status: 'ACCEPTED',
                respondedAt: firestore_1.Timestamp.now(),
                resolvedAt: firestore_1.Timestamp.now(),
                respondedBy,
            });
        });
        return true;
    }
    catch (e) {
        if (e?.message === 'ALREADY_CLAIMED' || e?.message === 'NOT_FOUND')
            return false;
        throw e;
    }
}
async function resolverCobertura(db, conv) {
    const vacantSnap = await db.collection('turnos').doc(conv.shiftId).get();
    const vacantData = vacantSnap.exists ? { id: vacantSnap.id, ...vacantSnap.data() } : { id: conv.shiftId };
    if (isShiftAlreadyCovered(vacantData)) {
        const isDualHalf = (conv.type === 'EXTEND' && !vacantData.coverageDualExtBy)
            || (conv.type === 'ADVANCE' && !vacantData.coverageDualAdvBy);
        const dualComplete = !!vacantData.coverageDualExtBy && !!vacantData.coverageDualAdvBy;
        if (!isDualHalf || dualComplete || String(vacantData.status || '').toUpperCase() === 'COVERED') {
            await db.collection('convocatorias_cobertura').doc(conv.id).set({
                status: 'CANCELLED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                cancelReason: 'VACANTE_YA_CUBIERTA',
            }, { merge: true });
            return 'ALREADY_COVERED';
        }
    }
    if (conv.type === 'EXTEND' && vacantData.coverageDualExtBy) {
        await db.collection('convocatorias_cobertura').doc(conv.id).set({
            status: 'CANCELLED',
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            cancelReason: 'EXT_YA_ASIGNADO',
        }, { merge: true });
        return 'SKIPPED';
    }
    if (conv.type === 'ADVANCE' && vacantData.coverageDualAdvBy) {
        await db.collection('convocatorias_cobertura').doc(conv.id).set({
            status: 'CANCELLED',
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            cancelReason: 'ADV_YA_ASIGNADO',
        }, { merge: true });
        return 'SKIPPED';
    }
    const batch = db.batch();
    const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
        : conv.createdBy === 'AUTO' ? 'AUTO'
            : 'OPERACIONES';
    const titular = (0, coverageLedger_1.resolveTitularFromAbsenceOrVacancy)(vacantData);
    const coverageEventId = vacantData.coverageEventId || (0, coverageLedger_1.newCoverageEventId)();
    const ledgerBase = {
        covererEmployeeId: conv.candidateEmployeeId,
        covererEmployeeName: conv.candidateEmployeeName,
        titularEmployeeId: titular.titularEmployeeId,
        titularEmployeeName: titular.titularEmployeeName,
        titularShiftId: titular.titularShiftId,
        titularIsAbsence: true,
        resolvedBy,
        coverageEventId,
        vacancyExtra: { coverageConvocatoriaId: conv.id, coverageResolvedAt: firestore_1.FieldValue.serverTimestamp() },
        covererExtra: { coverageConvocatoriaId: conv.id, assignedByConvocatoria: conv.id },
    };
    const vacantRef = db.collection('turnos').doc(conv.shiftId);
    const gapPresentAt = conv.startTime instanceof firestore_1.Timestamp
        ? conv.startTime
        : (vacantData.startTime instanceof firestore_1.Timestamp ? vacantData.startTime : null);
    if (conv.type === 'EXTEND' && conv.extendShiftId) {
        const shiftRef = db.collection('turnos').doc(conv.extendShiftId);
        const extendSnap = await shiftRef.get();
        const extendData = extendSnap.data() || {};
        const vacPos = String(vacantData.positionName || conv.positionName || '').trim();
        const srcPos = String(extendData.positionName || '').trim();
        const crossPos = !!(vacPos && srcPos && vacPos.toLowerCase() !== srcPos.toLowerCase());
        const newCode = String(conv.shiftCode || 'M').toUpperCase().startsWith('N') ? 'N12' : 'D12';
        batch.update(shiftRef, {
            code: newCode,
            isExtended: true,
            isRetention: true,
            extendedBy: 'CONVOCATORIA',
            extendedAt: firestore_1.FieldValue.serverTimestamp(),
            resolvedBy,
            ...(crossPos
                ? {
                    coversPositionName: vacPos,
                    coverageSegmentRole: 'EXTENSION',
                }
                : {}),
            ...demoCovererPresenceFields(resolvedBy, extendData.presentAt || extendData.realStartTime || gapPresentAt),
            ...(0, coverageLedger_1.covererLedgerFields)({
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                coverageType: 'EXTEND',
            }),
        });
        const advDone = !!vacantData.coverageDualAdvBy;
        batch.update(vacantRef, {
            coverageDualExtBy: conv.candidateEmployeeId,
            coverageDualExtName: conv.candidateEmployeeName,
            coverageDualExtShiftId: conv.extendShiftId,
            coverageEventId,
            ...(advDone
                ? {
                    status: 'COVERED',
                    resolvedBy,
                    coverageType: 'RETENCION',
                    coveredAt: firestore_1.FieldValue.serverTimestamp(),
                    coveredByEmployeeName: `${conv.candidateEmployeeName} ext + ${vacantData.coverageDualAdvName || ''} adel`,
                }
                : {}),
        });
        if (advDone) {
            (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                covererShiftId: conv.extendShiftId,
                coverageType: 'RETENCION',
                markVacancyCovered: true,
            });
            await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
        }
        else {
            await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id, ['EXTEND']);
        }
    }
    else if (conv.type === 'ADVANCE' && conv.advanceShiftId) {
        const nextRef = db.collection('turnos').doc(conv.advanceShiftId);
        const nextSnap = await nextRef.get();
        const nextData = nextSnap.data() || {};
        const vacPosAdv = String(vacantData.positionName || conv.positionName || '').trim();
        const srcPosAdv = String(nextData.positionName || '').trim();
        const crossPosAdv = !!(vacPosAdv && srcPosAdv && vacPosAdv.toLowerCase() !== srcPosAdv.toLowerCase());
        const plannedStart = nextData.plannedStartTime || nextData.startTime || null;
        batch.update(nextRef, {
            adjustedStartTime: conv.startTime,
            isAdvanced: true,
            isEarlyStart: true,
            advancedBy: 'CONVOCATORIA',
            advancedAt: firestore_1.FieldValue.serverTimestamp(),
            startTime: conv.startTime,
            plannedStartTime: plannedStart,
            resolvedBy,
            ...(crossPosAdv
                ? {
                    coversPositionName: vacPosAdv,
                    coverageSegmentRole: 'EARLY_START',
                }
                : {}),
            ...demoCovererPresenceFields(resolvedBy, gapPresentAt),
            ...(0, coverageLedger_1.covererLedgerFields)({
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                coverageType: 'ADVANCE',
            }),
        });
        const extDone = !!vacantData.coverageDualExtBy;
        const vacLabel = (0, shiftContinuity_1.vacancyCoverageLabel)({
            titularName: titular.titularEmployeeName,
            shiftCode: conv.shiftCode,
            objectiveName: conv.objectiveName,
        });
        batch.update(vacantRef, {
            coverageDualAdvBy: conv.candidateEmployeeId,
            coverageDualAdvName: conv.candidateEmployeeName,
            coverageDualAdvShiftId: conv.advanceShiftId,
            coverageEventId,
            vacancyLabel: vacLabel,
            ...(extDone
                ? {
                    status: 'COVERED',
                    resolvedBy,
                    coverageType: 'RETENCION',
                    coveredAt: firestore_1.FieldValue.serverTimestamp(),
                    coveredByEmployeeName: `${vacantData.coverageDualExtName || ''} ext + ${conv.candidateEmployeeName} adel`,
                }
                : {}),
        });
        if (extDone) {
            (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                covererShiftId: conv.advanceShiftId,
                coverageType: 'RETENCION',
                markVacancyCovered: true,
            });
            await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
        }
        else {
            await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id, ['ADVANCE']);
        }
    }
    else if (conv.type === 'RET' || conv.type === 'ESC' || conv.type === 'INTERCAMBIO') {
        const sourceId = conv.sourceShiftId;
        const vacLabel = (0, shiftContinuity_1.vacancyCoverageLabel)({
            titularName: titular.titularEmployeeName,
            shiftCode: conv.shiftCode || vacantData.code,
            positionName: vacantData.positionName,
            objectiveName: conv.objectiveName,
        });
        if (sourceId) {
            const prevCode = conv.type === 'INTERCAMBIO'
                ? String((await db.collection('turnos').doc(sourceId).get()).data()?.code || 'M')
                : conv.type;
            batch.update(db.collection('turnos').doc(sourceId), {
                ...(0, shiftContinuity_1.buildReassignPassiveToVacancyFields)({
                    objectiveId: conv.objectiveId,
                    objectiveName: conv.objectiveName,
                    clientId: conv.clientId,
                    clientName: conv.clientName,
                    positionName: vacantData.positionName,
                    code: conv.shiftCode || vacantData.code,
                    startTime: conv.startTime || vacantData.startTime,
                    endTime: conv.endTime || vacantData.endTime,
                }, {
                    coverageType: conv.type,
                    resolvedBy,
                    previousCode: prevCode,
                    coverageEventId,
                }),
                vacancyLabel: vacLabel,
                ...demoCovererPresenceFields(resolvedBy, gapPresentAt),
                ...(0, coverageLedger_1.covererLedgerFields)({
                    ...ledgerBase,
                    vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                    coverageType: conv.type,
                }),
            });
        }
        (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
            ...ledgerBase,
            vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
            covererShiftId: sourceId || null,
            coverageType: conv.type,
            markVacancyCovered: true,
            vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel, coveredByEmployeeName: conv.candidateEmployeeName },
        });
        await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    }
    else if (conv.type === 'CROSS_POS') {
        const sourceId = conv.sourceShiftId;
        const vacLabel = (0, shiftContinuity_1.vacancyCoverageLabel)({
            titularName: titular.titularEmployeeName,
            shiftCode: conv.shiftCode || vacantData.code,
            positionName: vacantData.positionName,
            objectiveName: conv.objectiveName,
        });
        if (sourceId) {
            const srcSnap = await db.collection('turnos').doc(sourceId).get();
            const src = srcSnap.data() || {};
            const prevCode = String(src.code || 'M').toUpperCase();
            const prevPos = String(src.positionName || '').trim();
            const wasPresent = src.isPresent === true;
            const freedRef = db.collection('turnos').doc();
            batch.set(freedRef, {
                empresaId: conv.empresaId,
                employeeId: 'VACANTE',
                employeeName: `VACANTE (redir. ${(conv.candidateEmployeeName || '').split(',')[0] || 'guardia'})`,
                isUnassigned: true,
                clientId: src.clientId || conv.clientId || null,
                clientName: src.clientName || conv.clientName || null,
                objectiveId: src.objectiveId || conv.objectiveId,
                objectiveName: src.objectiveName || conv.objectiveName || '',
                positionName: prevPos || src.positionName || null,
                code: prevCode,
                startTime: src.startTime || null,
                endTime: src.endTime || null,
                plannedStartTime: src.plannedStartTime || src.startTime || null,
                plannedEndTime: src.plannedEndTime || src.endTime || null,
                status: 'UNCOVERED',
                origin: 'VACANTE_POR_REDIRECCION',
                causedByShiftId: sourceId,
                causedByEmployeeId: conv.candidateEmployeeId,
                causedByEmployeeName: conv.candidateEmployeeName,
                vacancyLabel: `Vacante por redirección · ${prevPos || 'puesto'} → ${vacantData.positionName || 'hueco'}`,
                coverageEventId,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                reportedBy: resolvedBy,
            });
            batch.update(db.collection('turnos').doc(sourceId), {
                ...(0, shiftContinuity_1.buildReassignPassiveToVacancyFields)({
                    objectiveId: conv.objectiveId,
                    objectiveName: conv.objectiveName,
                    clientId: conv.clientId,
                    clientName: conv.clientName,
                    positionName: vacantData.positionName,
                    code: conv.shiftCode || vacantData.code,
                    startTime: conv.startTime || vacantData.startTime,
                    endTime: conv.endTime || vacantData.endTime,
                }, {
                    coverageType: 'CROSS_POSITION',
                    resolvedBy,
                    previousCode: prevCode,
                    previousPositionName: prevPos || null,
                    coverageEventId,
                }),
                ...(resolvedBy === 'MODO_DEMO'
                    ? demoCovererPresenceFields(resolvedBy, gapPresentAt)
                    : {
                        isPresent: wasPresent,
                        status: wasPresent ? 'PRESENT' : 'PENDING',
                    }),
                vacatedShiftId: freedRef.id,
                vacancyLabel: vacLabel,
                ...(0, coverageLedger_1.covererLedgerFields)({
                    ...ledgerBase,
                    vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                    coverageType: 'CROSS_POSITION',
                }),
            });
            (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                covererShiftId: sourceId,
                coverageType: 'CROSS_POSITION',
                markVacancyCovered: true,
                vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel, coveredByEmployeeName: conv.candidateEmployeeName },
            });
        }
        await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    }
    else if (conv.type === 'FT') {
        if (conv.ftShiftId) {
            const ftRef = db.collection('turnos').doc(conv.ftShiftId);
            const vacLabel = (0, shiftContinuity_1.vacancyCoverageLabel)({
                titularName: titular.titularEmployeeName,
                shiftCode: conv.shiftCode,
                objectiveName: conv.objectiveName,
            });
            batch.update(ftRef, {
                code: String(conv.shiftCode || vacantData.code || 'M').toUpperCase(),
                isFranco: false,
                isFrancoTrabajado: true,
                startTime: conv.startTime,
                endTime: conv.endTime || null,
                plannedStartTime: conv.startTime,
                plannedEndTime: conv.endTime || null,
                objectiveId: conv.objectiveId,
                objectiveName: conv.objectiveName || null,
                clientId: conv.clientId || null,
                clientName: conv.clientName || null,
                positionName: vacantData.positionName || conv.positionName || null,
                coversPositionName: vacantData.positionName || conv.positionName || null,
                coversBandCode: String(conv.shiftCode || vacantData.code || 'M').toUpperCase(),
                coverageStatus: 'COVERED',
                coverageMode: 'FRANCO_TRABAJADO',
                origin: 'OPERATIONS_COVERAGE',
                resolvedBy,
                coveredShiftId: conv.shiftId,
                vacancyLabel: vacLabel,
                assignedAt: firestore_1.FieldValue.serverTimestamp(),
                francoTrabajadoAt: firestore_1.FieldValue.serverTimestamp(),
                francoObjectiveId: conv.objectiveId,
                francoObjectiveName: conv.objectiveName || null,
                empresaId: conv.empresaId || vacantData.empresaId || null,
                ...demoCovererPresenceFields(resolvedBy, gapPresentAt),
                ...(0, coverageLedger_1.covererLedgerFields)({
                    ...ledgerBase,
                    vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                    coverageType: 'FT',
                }),
            });
            (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                covererShiftId: conv.ftShiftId,
                coverageType: 'FT',
                markVacancyCovered: true,
                vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel },
            });
        }
        await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    }
    else {
        const newRef = db.collection('turnos').doc();
        const demoPresence = demoCovererPresenceFields(resolvedBy, gapPresentAt);
        batch.set(newRef, {
            empresaId: conv.empresaId,
            employeeId: conv.candidateEmployeeId,
            employeeName: conv.candidateEmployeeName,
            clientId: conv.clientId || null,
            clientName: conv.clientName || null,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            positionName: vacantData.positionName || conv.positionName || null,
            code: String(conv.shiftCode || 'M'),
            startTime: conv.startTime,
            endTime: conv.endTime || null,
            plannedStartTime: conv.startTime,
            plannedEndTime: conv.endTime || null,
            status: demoPresence.status || 'PENDING',
            origin: 'OPERATIONS_COVERAGE',
            resolvedBy,
            coverageType: conv.type,
            coversBandCode: String(conv.shiftCode || 'M').toUpperCase(),
            coversPositionName: vacantData.positionName || conv.positionName || null,
            coverageStatus: 'COVERED',
            assignedAt: firestore_1.FieldValue.serverTimestamp(),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            ...demoPresence,
            ...(0, coverageLedger_1.covererLedgerFields)({
                ...ledgerBase,
                vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
                coverageType: conv.type,
            }),
        });
        (0, coverageLedger_1.applyCoverageLedgerToBatch)(batch, db, {
            ...ledgerBase,
            vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
            covererShiftId: newRef.id,
            coverageType: conv.type,
            markVacancyCovered: true,
        });
        await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    }
    const novedadRef = db.collection('novedades').doc();
    batch.set(novedadRef, {
        type: 'COBERTURA_RESUELTA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        clientId: conv.clientId || null,
        empresaId: conv.empresaId,
        coverageEventId,
        title: 'Cobertura resuelta',
        message: `${TYPE_LABEL[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
        description: `${TYPE_LABEL[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
        coverageType: conv.type,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        employeeId: conv.candidateEmployeeId,
        employeeName: conv.candidateEmployeeName,
        coversAbsenceEmployeeName: titular.titularEmployeeName || null,
        status: 'unread',
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    await (0, coverageLedger_1.closeAbsenceSiblingVacanciesInBatch)(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        titularShiftId: titular.titularShiftId || conv.shiftId,
        coverageType: conv.type,
        markVacancyCovered: true,
    }, coverageEventId);
    await batch.commit();
    return 'OK';
}
exports.crearConvocatoriaCobertura = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    const db = admin.firestore();
    const { shiftId, candidateEmployeeId, type, empresaId, advanceShiftId, extendShiftId, sourceShiftId, ftShiftId, } = data;
    if (!shiftId || !candidateEmployeeId || !type || !empresaId) {
        throw new functions.https.HttpsError('invalid-argument', 'shiftId, candidateEmployeeId, type y empresaId son requeridos.');
    }
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    }
    const shift = shiftSnap.data();
    await (0, coverage_auth_util_1.assertCoverageOpsCallable)(context, empresaId, shift);
    const empSnap = await db.collection('empleados').doc(candidateEmployeeId).get();
    if (!empSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    }
    const emp = empSnap.data();
    const ctx = {
        objectiveId: String(shift.objectiveId || ''),
        clientId: String(shift.clientId || ''),
        aptitudesRequeridas: [],
    };
    const eligibility = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, type);
    if (!eligibility.eligible) {
        throw new functions.https.HttpsError('failed-precondition', `Candidato no elegible: ${eligibility.reason}`);
    }
    const existing = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', shiftId)
        .where('candidateEmployeeId', '==', candidateEmployeeId)
        .where('status', '==', 'PENDING')
        .limit(1)
        .get();
    if (!existing.empty) {
        throw new functions.https.HttpsError('already-exists', 'Ya hay una convocatoria pendiente para este guardia y turno.');
    }
    const empName = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || candidateEmployeeId;
    const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, candidateEmployeeId, emp);
    const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
    const callerName = callerSnap.exists ? String(callerSnap.data()?.displayName || callerSnap.data()?.name || '') : '';
    const stepKey = (0, eligibilityFilter_1.toCascadeStep)(type) || undefined;
    const convId = await crearConvocatoriaDoc(db, {
        empresaId,
        shiftId,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type,
        cascadeStepKey: stepKey,
        cascadeStep: stepKey ? eligibilityFilter_1.CASCADE_ORDER.indexOf(stepKey) : (0, eligibilityFilter_1.cascadeStepIndex)(type),
        candidateEmployeeId,
        candidateEmployeeName: empName,
        candidateUid: uid || undefined,
        ...(advanceShiftId ? { advanceShiftId } : {}),
        ...(extendShiftId ? { extendShiftId } : {}),
        ...(sourceShiftId ? { sourceShiftId } : {}),
        ...(ftShiftId ? { ftShiftId } : {}),
        createdBy: context.auth.uid,
        createdByName: callerName,
    });
    return { success: true, convocatoriaId: convId };
});
exports.responderConvocatoriaCobertura = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();
    const { convocatoriaId, response, rejectionReason } = data;
    if (!convocatoriaId || !response) {
        throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId y response son requeridos.');
    }
    const convRef = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');
    }
    const conv = convSnap.data();
    if (conv.status !== 'PENDING' && conv.status !== 'ESCALATED') {
        throw new functions.https.HttpsError('failed-precondition', `La convocatoria ya fue ${conv.status}.`);
    }
    const uid = context.auth.uid;
    const empByUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    const empId = empByUid.empty ? uid : empByUid.docs[0].id;
    if (conv.candidateUid && conv.candidateUid !== uid && conv.candidateEmployeeId !== empId) {
        throw new functions.https.HttpsError('permission-denied', 'No podés responder una convocatoria que no te pertenece.');
    }
    const now = firestore_1.Timestamp.now();
    if (conv.type === 'LLEGADA_TARDE') {
        if (response === 'ACCEPTED') {
            await convRef.update({ status: 'ACCEPTED', respondedAt: now, resolvedAt: now });
            await db.collection('turnos').doc(conv.shiftId).update({
                lateArrivalConfirmed: true,
                lateArrivalConfirmedAt: now,
            });
        }
        else {
            await convRef.update({ status: 'REJECTED', respondedAt: now, rejectionReason: rejectionReason || null });
            await db.collection('turnos').doc(conv.shiftId).update({
                isAbsent: true,
                status: 'ABSENT',
                absenceType: 'AA',
                absenceDetectedBy: 'LLEGADA_TARDE_RECHAZADA',
            });
        }
        return { success: true };
    }
    if (response === 'ACCEPTED') {
        const claimed = await claimConvocatoriaAccept(db, convocatoriaId, uid);
        if (!claimed) {
            throw new functions.https.HttpsError('failed-precondition', 'La convocatoria ya fue respondida o cancelada.');
        }
        const result = await resolverCobertura(db, { ...conv, id: convocatoriaId, status: 'ACCEPTED' });
        if (result === 'ALREADY_COVERED') {
            return { success: true, alreadyCovered: true };
        }
    }
    else {
        await convRef.update({
            status: 'REJECTED',
            respondedAt: now,
            rejectionReason: rejectionReason || null,
        });
        await db.collection('novedades').add({
            type: 'CONVOCATORIA_RECHAZADA',
            shiftId: conv.shiftId,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            empresaId: conv.empresaId,
            message: `${conv.candidateEmployeeName} rechazó la convocatoria (${conv.type}).`,
            resolved: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await maybeAvanzarCascada(db, { ...conv, id: convocatoriaId }, 'REJECTED');
    }
    return { success: true };
});
exports.cancelarConvocatoriaCobertura = functions
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .https.onCall(async (data, context) => {
    const db = admin.firestore();
    const { convocatoriaId } = data;
    if (!convocatoriaId)
        throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId requerido.');
    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');
    const convData = snap.data();
    await (0, coverage_auth_util_1.assertCoverageOpsCallable)(context, String(convData.empresaId || ''), convData);
    if (convData.status !== 'PENDING') {
        throw new functions.https.HttpsError('failed-precondition', 'Solo se pueden cancelar convocatorias PENDING.');
    }
    await ref.update({
        status: 'CANCELLED',
        cancelledAt: firestore_1.Timestamp.now(),
        cancelledBy: context.auth.uid,
    });
    return { success: true };
});
exports.getCandidatosCobertura = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    const db = admin.firestore();
    const { shiftId, empresaId, type } = data;
    if (!shiftId || !empresaId) {
        throw new functions.https.HttpsError('invalid-argument', 'shiftId y empresaId son requeridos.');
    }
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    const shift = shiftSnap.data();
    await (0, coverage_auth_util_1.assertCoverageOpsCallable)(context, empresaId, shift);
    const fakeConv = {
        empresaId,
        shiftId,
        objectiveId: String(shift.objectiveId || ''),
        clientId: String(shift.clientId || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        type: type || 'SIN_TURNO',
        urgency: 'NORMAL',
        cascadeStep: 0,
        candidateEmployeeId: '',
        candidateEmployeeName: '',
        status: 'PENDING',
        timeoutAt: firestore_1.Timestamp.now(),
        createdAt: firestore_1.Timestamp.now(),
        createdBy: 'OPS',
        aptitudesRequeridas: [],
    };
    const step = type ? (0, eligibilityFilter_1.toCascadeStep)(type) : null;
    const cands = step
        ? await findCandidatesForStep(db, fakeConv, step)
        : (await Promise.all(eligibilityFilter_1.CASCADE_ORDER.map((s) => findCandidatesForStep(db, fakeConv, s)))).flat();
    const results = cands.map((c) => ({
        employeeId: c.id,
        employeeName: c.name,
        candidateType: c.convocatoriaType,
        eligibility: { eligible: true },
        extendShiftId: c.extendShiftId,
        advanceShiftId: c.advanceShiftId,
        sourceShiftId: c.sourceShiftId,
        ftShiftId: c.ftShiftId,
    }));
    results.sort((a, b) => (0, eligibilityFilter_1.cascadeStepIndex)(a.candidateType) - (0, eligibilityFilter_1.cascadeStepIndex)(b.candidateType));
    return { candidates: results };
});
async function iniciarCascadaCobertura(db, shift, createdBy = 'AUTO') {
    const vacantSnap = await db.collection('turnos').doc(shift.id).get();
    if (vacantSnap.exists && isShiftAlreadyCovered(vacantSnap.data()))
        return;
    const existing = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', shift.id)
        .where('status', '==', 'PENDING')
        .limit(1)
        .get();
    if (!existing.empty)
        return;
    const baseConvData = {
        empresaId: shift.empresaId,
        shiftId: shift.id,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        positionName: String(shift.positionName || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type: 'SIN_TURNO',
        urgency: (0, eligibilityFilter_1.getUrgency)(shift.startTime),
        cascadeStep: 0,
        cascadeStepKey: 'SIN_TURNO',
        candidateEmployeeId: '',
        candidateEmployeeName: '',
        status: 'PENDING',
        timeoutAt: firestore_1.Timestamp.now(),
        createdAt: firestore_1.Timestamp.now(),
        createdBy,
    };
    for (const step of eligibilityFilter_1.CASCADE_ORDER) {
        const sent = await dispararPasoCascada(db, baseConvData, step, createdBy);
        if (sent)
            return;
    }
    await db.collection('novedades').add({
        type: 'VACANTE_SIN_COBERTURA',
        shiftId: shift.id,
        objectiveId: shift.objectiveId,
        objectiveName: shift.objectiveName || '',
        empresaId: shift.empresaId,
        message: `Sin candidatos para turno ${shift.code || ''} en ${shift.objectiveName || 'objetivo'}.`,
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function simularRespuestasConvocatorias(db, empresaId) {
    const THINK_TIME_MS = 15 * 1000;
    const now = firestore_1.Timestamp.now();
    const cutoffMs = now.toMillis() - THINK_TIME_MS;
    const snap = await db.collection('convocatorias_cobertura')
        .where('empresaId', '==', empresaId)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(50)
        .get();
    const byShift = new Map();
    for (const convDoc of snap.docs) {
        const conv = convDoc.data();
        if (conv.type === 'LLEGADA_TARDE')
            continue;
        const createdMs = conv.createdAt instanceof firestore_1.Timestamp ? conv.createdAt.toMillis() : 0;
        if (createdMs > cutoffMs)
            continue;
        const list = byShift.get(conv.shiftId) || [];
        list.push(convDoc);
        byShift.set(conv.shiftId, list);
    }
    let respondidas = 0;
    for (const [shiftId, docs] of byShift) {
        docs.sort((a, b) => {
            const ca = a.data();
            const cb = b.data();
            const sa = Number(ca.cascadeStep ?? 99);
            const sb = Number(cb.cascadeStep ?? 99);
            if (sa !== sb)
                return sa - sb;
            const ta = ca.createdAt instanceof firestore_1.Timestamp ? ca.createdAt.toMillis() : 0;
            const tb = cb.createdAt instanceof firestore_1.Timestamp ? cb.createdAt.toMillis() : 0;
            return ta - tb;
        });
        const vacantFresh = await db.collection('turnos').doc(shiftId).get();
        if (vacantFresh.exists && isShiftAlreadyCovered(vacantFresh.data())) {
            const batch = db.batch();
            for (const d of docs) {
                batch.update(d.ref, { status: 'CANCELLED', cancelledAt: firestore_1.FieldValue.serverTimestamp(), cancelReason: 'VACANTE_YA_CUBIERTA' });
            }
            await batch.commit();
            continue;
        }
        let won = false;
        for (const convDoc of docs) {
            const conv = convDoc.data();
            if (won) {
                const live = await convDoc.ref.get();
                const st = String(live.data()?.status || '');
                if (st === 'PENDING' || st === 'ESCALATED') {
                    await convDoc.ref.update({
                        status: 'CANCELLED',
                        cancelledAt: firestore_1.FieldValue.serverTimestamp(),
                        cancelReason: 'FIRST_WINS_DEMO',
                    });
                }
                continue;
            }
            const live = await convDoc.ref.get();
            const liveSt = String(live.data()?.status || '');
            if (liveSt !== 'PENDING' && liveSt !== 'ESCALATED')
                continue;
            const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
            const accept = hashVal <= 8;
            try {
                if (accept) {
                    const claimed = await claimConvocatoriaAccept(db, convDoc.id, 'MODO_DEMO');
                    if (!claimed)
                        continue;
                    const result = await resolverCobertura(db, {
                        ...conv,
                        id: convDoc.id,
                        createdBy: 'MODO_DEMO',
                        status: 'ACCEPTED',
                    });
                    if (result === 'OK') {
                        won = true;
                        respondidas++;
                    }
                    if (result === 'ALREADY_COVERED') {
                        won = true;
                    }
                }
                else {
                    await convDoc.ref.update({
                        status: 'REJECTED',
                        respondedAt: now,
                        rejectionReason: 'MODO_DEMO_AUTO',
                        respondedBy: 'MODO_DEMO',
                    });
                    await maybeAvanzarCascada(db, { ...conv, id: convDoc.id }, 'REJECTED');
                    respondidas++;
                }
            }
            catch (e) {
                console.warn('[simularRespuestasConvocatorias]', convDoc.id, e?.message);
            }
        }
    }
    return respondidas;
}
exports.checkConvocatoriaTimeouts = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 60,
    memory: '256MiB',
}, async () => {
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    const timedOut = await db.collection('convocatorias_cobertura')
        .where('status', '==', 'PENDING')
        .where('timeoutAt', '<=', now)
        .limit(50)
        .get();
    if (timedOut.empty)
        return;
    for (const d of timedOut.docs) {
        const conv = d.data();
        try {
            if (conv.type === 'LLEGADA_TARDE') {
                await d.ref.update({ status: 'TIMEOUT', escalatedAt: now });
                await db.collection('turnos').doc(conv.shiftId).update({
                    isAbsent: true,
                    status: 'ABSENT',
                    absenceType: 'AA',
                    absenceDetectedBy: 'LLEGADA_TARDE_TIMEOUT',
                });
                console.log(`[checkConvocatoriaTimeouts] LLEGADA_TARDE timeout → isAbsent=true en ${conv.shiftId}`);
            }
            else {
                await d.ref.update({ status: 'ESCALATED', escalatedAt: now });
                await maybeAvanzarCascada(db, { ...conv, id: d.id }, 'TIMEOUT');
            }
        }
        catch (e) {
            console.error(`[checkConvocatoriaTimeouts] Error en ${d.id}:`, e.message);
        }
    }
});
async function crearConvocatoriaLlegadaTarde(db, shift) {
    const existing = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', shift.id)
        .where('type', '==', 'LLEGADA_TARDE')
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(1)
        .get();
    if (!existing.empty)
        return;
    const now = firestore_1.Timestamp.now();
    const timeoutAt = firestore_1.Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);
    const convRef = db.collection('convocatorias_cobertura').doc();
    const convData = {
        empresaId: shift.empresaId,
        shiftId: shift.id,
        objectiveId: shift.objectiveId,
        objectiveName: shift.objectiveName,
        clientId: shift.clientId,
        shiftCode: shift.shiftCode,
        startTime: shift.startTime,
        endTime: shift.endTime,
        type: 'LLEGADA_TARDE',
        urgency: (0, eligibilityFilter_1.getUrgency)(shift.startTime),
        cascadeStep: -1,
        candidateEmployeeId: shift.employeeId,
        candidateEmployeeName: shift.employeeName,
        candidateUid: shift.employeeUid,
        aptitudesRequeridas: [],
        status: 'PENDING',
        timeoutAt,
        createdAt: now,
        createdBy: 'AUTO',
    };
    await convRef.set(convData);
    await crearNotifConvocatoria(db, { ...convData, id: convRef.id });
    console.log(`[crearConvocatoriaLlegadaTarde] Enviada a ${shift.employeeName} para turno ${shift.id}`);
}
//# sourceMappingURL=convocatoriasCobertura.js.map