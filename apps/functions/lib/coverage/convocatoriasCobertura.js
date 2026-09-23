"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkConvocatoriaTimeouts = exports.getCandidatosCobertura = exports.cancelarConvocatoriaCobertura = exports.responderConvocatoriaCobertura = exports.crearConvocatoriaCobertura = void 0;
exports.resolverCobertura = resolverCobertura;
exports.iniciarCascadaCobertura = iniciarCascadaCobertura;
exports.simularRespuestasConvocatorias = simularRespuestasConvocatorias;
exports.crearConvocatoriaLlegadaTarde = crearConvocatoriaLlegadaTarde;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const markShiftAbsent_1 = require("../attendance/markShiftAbsent");
const coverageTraceShift_1 = require("./coverageTraceShift");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_1 = require("firebase-admin/firestore");
const eligibilityFilter_1 = require("./eligibilityFilter");
const escalarVacanteSinCobertura_1 = require("./escalarVacanteSinCobertura");
const TIMEOUT_MINUTES = 3;
async function crearNotifConvocatoria(db, conv) {
    const urgencyLabel = conv.urgency === 'URGENTE' ? '⚡ URGENTE' : conv.urgency === 'INTERMEDIO' ? 'Intermedia' : 'Normal';
    const typeLabel = {
        RET: 'Retención (RET)',
        REF: 'Refuerzo (REF)',
        ESC: 'Escuela (ESC)',
        VOLANTE: 'Cobertura volante',
        SIN_TURNO_CON_EXP: 'Cobertura disponible',
        EXTEND: 'Extensión de jornada',
        ADVANCE: 'Adelanto de turno',
        SIN_TURNO: 'Cobertura disponible',
        FT: 'Franco Trabajado (FT)',
        LLEGADA_TARDE: '¿Estás en camino?',
    };
    const tz = 'America/Argentina/Buenos_Aires';
    const startDate = conv.startTime instanceof firestore_1.Timestamp
        ? conv.startTime.toDate()
        : null;
    const endDate = conv.endTime instanceof firestore_1.Timestamp
        ? conv.endTime.toDate()
        : null;
    const horaInicio = startDate
        ? startDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
        : '--:--';
    const horaFin = endDate
        ? endDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
        : '';
    const fechaTurno = startDate
        ? startDate.toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: tz,
        })
        : '';
    const lugar = [conv.clientName, conv.objectiveName, conv.positionName]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join(' · ');
    const lugarTxt = lugar || 'objetivo / puesto';
    const horarioTxt = horaFin ? `${horaInicio}–${horaFin}` : horaInicio;
    const codigo = String(conv.shiftCode || '').trim();
    const isLlegadaTarde = conv.type === 'LLEGADA_TARDE';
    const title = isLlegadaTarde ? '⏰ ¿Estás en camino?' : `[${urgencyLabel}] Cobertura requerida`;
    const body = isLlegadaTarde
        ? `Tu turno ${codigo} en ${lugarTxt} (${fechaTurno} ${horarioTxt}) ya comenzó. Confirmá si estás en camino en los próximos ${TIMEOUT_MINUTES} min.`
        : `${typeLabel[conv.type]} en ${lugarTxt}. Turno ${codigo || '—'} · ${fechaTurno} ${horarioTxt}. Respondé en los próximos ${TIMEOUT_MINUTES} min.`;
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
        objectiveName: conv.objectiveName || null,
        positionName: conv.positionName || null,
        clientId: conv.clientId || null,
        clientName: conv.clientName || null,
        shiftCode: conv.shiftCode || null,
        startTime: conv.startTime || null,
        endTime: conv.endTime || null,
        read: false,
        readAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
}
async function avanzarCascada(db, conv, reason) {
    if (conv.type === 'LLEGADA_TARDE')
        return;
    const nextType = (0, eligibilityFilter_1.nextCascadeStep)(conv.type);
    if (!nextType) {
        await (0, escalarVacanteSinCobertura_1.escalarVacanteSinCobertura)(db, {
            shiftId: conv.shiftId,
            empresaId: conv.empresaId,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            positionName: conv.positionName || '',
            message: `Cascada agotada para turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}. Sin candidatos disponibles.`,
            attemptRetention: true,
            source: 'CASCADE_EXHAUSTED',
        });
        return;
    }
    if (nextType === 'FT') {
        await dispararBroadcastFT(db, conv);
        return;
    }
    const candidate = await findBestCandidate(db, conv, nextType);
    if (!candidate) {
        const fakeConv = { ...conv, type: nextType };
        await avanzarCascada(db, fakeConv, reason);
        return;
    }
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
        message: `${conv.candidateEmployeeName} ${reason === 'REJECTED' ? 'rechazó' : 'no respondió'} — escalando a ${nextType} en ${conv.objectiveName || 'objetivo'}`,
        coverageType: conv.type,
        nextCoverageType: nextType,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        candidatePhone,
        status: 'unread',
        resolved: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    await crearConvocatoriaDoc(db, {
        ...conv,
        type: nextType,
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf(nextType),
        candidateEmployeeId: candidate.id,
        candidateEmployeeName: candidate.name,
        candidateUid: candidate.uid,
        extendShiftId: candidate.extendShiftId,
        advanceShiftId: candidate.advanceShiftId,
        candidateShiftId: candidate.candidateShiftId,
        createdBy: 'AUTO',
    });
}
async function crearConvocatoriaDoc(db, data) {
    const now = firestore_1.Timestamp.now();
    const timeoutAt = firestore_1.Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);
    const urgency = (0, eligibilityFilter_1.getUrgency)(data.startTime);
    const docData = {
        ...data,
        urgency,
        status: 'PENDING',
        timeoutAt,
        createdAt: now,
    };
    const ref = await db.collection('convocatorias_cobertura').add(docData);
    await crearNotifConvocatoria(db, { ...docData, id: ref.id });
    const typeLabel = {
        RET: 'RET',
        REF: 'Refuerzo',
        ESC: 'Escuela',
        EXTEND: 'Extender jornada',
        ADVANCE: 'Adelantar turno',
        FT: 'Franco Trabajado',
        VOLANTE: 'Volante',
        SIN_TURNO: 'Sin turno',
        SIN_TURNO_CON_EXP: 'Sin turno (con exp.)',
    };
    await db.collection('novedades').add({
        type: 'CONVOCATORIA_ENVIADA',
        convocatoriaId: ref.id,
        shiftId: data.shiftId,
        objectiveId: data.objectiveId,
        objectiveName: data.objectiveName || '',
        clientId: data.clientId || null,
        empresaId: data.empresaId,
        title: 'Convocatoria enviada',
        message: `${typeLabel[data.type] || data.type} → ${data.candidateEmployeeName} — turno ${data.shiftCode || ''} en ${data.objectiveName || 'objetivo'}`,
        coverageType: data.type,
        candidateEmployeeId: data.candidateEmployeeId,
        candidateEmployeeName: data.candidateEmployeeName,
        status: 'unread',
        resolved: false,
        createdAt: now,
    });
    return ref.id;
}
async function findBestCandidate(db, conv, type) {
    const ctx = {
        objectiveId: conv.objectiveId,
        clientId: conv.clientId,
        aptitudesRequeridas: conv.aptitudesRequeridas || [],
    };
    if (type === 'EXTEND') {
        const active = await db.collection('turnos')
            .where('objectiveId', '==', conv.objectiveId)
            .where('empresaId', '==', conv.empresaId)
            .where('isPresent', '==', true)
            .where('isCompleted', '==', false)
            .limit(10)
            .get();
        for (const d of active.docs) {
            const t = d.data();
            const code = String(t.code || '').toUpperCase();
            if (code !== 'M' && code !== 'T' && code !== 'N')
                continue;
            const empSnap = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'EXTEND');
            if (check.eligible) {
                return {
                    id: t.employeeId,
                    name: t.employeeName || '',
                    uid: emp.uid,
                    extendShiftId: d.id,
                };
            }
        }
        return null;
    }
    if (type === 'ADVANCE') {
        const now = firestore_1.Timestamp.now();
        const endOfDay = firestore_1.Timestamp.fromMillis(new Date(new Date().setHours(23, 59, 59, 0)).getTime());
        const next = await db.collection('turnos')
            .where('objectiveId', '==', conv.objectiveId)
            .where('empresaId', '==', conv.empresaId)
            .where('startTime', '>', now)
            .where('startTime', '<=', endOfDay)
            .where('isCompleted', '==', false)
            .orderBy('startTime')
            .limit(5)
            .get();
        for (const d of next.docs) {
            const t = d.data();
            if (!t.employeeId || t.employeeId === 'VACANTE')
                continue;
            const empSnap = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'ADVANCE');
            if (check.eligible) {
                return {
                    id: t.employeeId,
                    name: t.employeeName || '',
                    uid: emp.uid,
                    advanceShiftId: d.id,
                };
            }
        }
        return null;
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
    const todayShiftsSnap = await db.collection('turnos')
        .where('objectiveId', '==', conv.objectiveId)
        .where('empresaId', '==', conv.empresaId)
        .where('startTime', '>=', firestore_1.Timestamp.fromDate(todayStart))
        .where('startTime', '<=', firestore_1.Timestamp.fromDate(todayEnd))
        .limit(100)
        .get();
    const shiftsByEmp = new Map();
    for (const d of todayShiftsSnap.docs) {
        const t = d.data();
        if (t.employeeId)
            shiftsByEmp.set(t.employeeId, String(t.code || ''));
    }
    const allTodaySnap = await db.collection('turnos')
        .where('empresaId', '==', conv.empresaId)
        .where('startTime', '>=', firestore_1.Timestamp.fromDate(todayStart))
        .where('startTime', '<=', firestore_1.Timestamp.fromDate(todayEnd))
        .limit(500)
        .get();
    const busyEmpIds = new Set();
    const francoEmpIds = new Set();
    const retEmpIds = new Map();
    for (const d of allTodaySnap.docs) {
        const t = d.data();
        if (!t.employeeId || t.employeeId === 'VACANTE')
            continue;
        const code = String(t.code || '').toUpperCase();
        if (['F', 'FF', 'FP'].includes(code)) {
            francoEmpIds.add(t.employeeId);
        }
        else if (code === 'RET') {
            if (t.objectiveId === conv.objectiveId) {
                retEmpIds.set(t.employeeId, d.id);
            }
        }
        else if (!['FT'].includes(code)) {
            busyEmpIds.add(t.employeeId);
        }
    }
    const activeConvSnap = await db.collection('convocatorias_cobertura')
        .where('empresaId', '==', conv.empresaId)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .get();
    const alreadyConvocadoIds = new Set();
    for (const d of activeConvSnap.docs) {
        const c = d.data();
        if (c.shiftId !== conv.shiftId && c.candidateEmployeeId) {
            alreadyConvocadoIds.add(String(c.candidateEmployeeId));
        }
    }
    if (type === 'REF' || type === 'ESC') {
        const want = type;
        for (const d of todayShiftsSnap.docs) {
            const t = d.data();
            const code = String(t.code || '').toUpperCase();
            if (code !== want)
                continue;
            if (t.isAbsent || !t.employeeId)
                continue;
            if (alreadyConvocadoIds.has(String(t.employeeId)))
                continue;
            const empSnap = await db.collection('empleados').doc(t.employeeId).get();
            if (!empSnap.exists)
                continue;
            const emp = empSnap.data();
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'RET');
            if (!check.eligible)
                continue;
            const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, t.employeeId, emp);
            return {
                id: t.employeeId,
                name: t.employeeName || `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
                uid: uid || undefined,
                candidateShiftId: d.id,
            };
        }
        return null;
    }
    for (const empDoc of empSnap.docs) {
        const emp = empDoc.data();
        const empId = empDoc.id;
        if (type === 'RET') {
            if (!retEmpIds.has(empId))
                continue;
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'RET');
            if (check.eligible) {
                const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
                const retShiftId = retEmpIds.get(empId);
                return {
                    id: empId,
                    name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId,
                    uid: uid || undefined,
                    ...(retShiftId ? { candidateShiftId: retShiftId } : {}),
                };
            }
        }
        if (type === 'VOLANTE') {
            if (busyEmpIds.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            if (!(emp.volante || []).includes(conv.objectiveId))
                continue;
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'VOLANTE');
            if (check.eligible) {
                const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
                return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
            }
        }
        if (type === 'SIN_TURNO_CON_EXP') {
            if (busyEmpIds.has(empId) || francoEmpIds.has(empId) || retEmpIds.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            const isTitular = emp.preferredObjectiveId === conv.objectiveId;
            const hasExp = !!(emp.experienciaObjetivos || {})[conv.objectiveId];
            if (!isTitular && !hasExp)
                continue;
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'SIN_TURNO_CON_EXP');
            if (check.eligible) {
                const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
                return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
            }
        }
        if (type === 'SIN_TURNO') {
            if (busyEmpIds.has(empId) || francoEmpIds.has(empId) || retEmpIds.has(empId) || alreadyConvocadoIds.has(empId))
                continue;
            const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'SIN_TURNO');
            if (check.eligible) {
                const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empId, emp);
                return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
            }
        }
    }
    return null;
}
async function dispararBroadcastFT(db, conv) {
    const ctx = { objectiveId: conv.objectiveId, clientId: conv.clientId, aptitudesRequeridas: conv.aptitudesRequeridas };
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
    const francoShiftByEmp = new Map();
    for (const d of allTodaySnap.docs) {
        const t = d.data();
        if (!t.employeeId)
            continue;
        const code = String(t.code || '').toUpperCase();
        if (['F', 'FF', 'FP'].includes(code))
            francoShiftByEmp.set(t.employeeId, d.id);
    }
    const batch = [];
    for (const empDoc of empSnap.docs) {
        if (!francoShiftByEmp.has(empDoc.id))
            continue;
        const emp = empDoc.data();
        const check = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, 'FT');
        if (!check.eligible)
            continue;
        const uid = await (0, eligibilityFilter_1.findEmployeeUid)(db, empDoc.id, emp);
        batch.push(crearConvocatoriaDoc(db, {
            ...conv,
            type: 'FT',
            cascadeStep: 6,
            candidateEmployeeId: empDoc.id,
            candidateEmployeeName: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empDoc.id,
            candidateUid: uid || undefined,
            ftShiftId: francoShiftByEmp.get(empDoc.id),
            createdBy: 'AUTO',
        }));
        if (batch.length >= 5)
            break;
    }
    if (batch.length > 0)
        await Promise.all(batch);
}
function dualSiblingConvType(type) {
    const u = String(type || '').toUpperCase();
    if (u === 'EXTEND')
        return 'ADVANCE';
    if (u === 'ADVANCE')
        return 'EXTEND';
    return null;
}
async function extAdvSiblingAccepted(db, absenceShiftId, current) {
    const other = current === 'EXTEND' ? 'ADVANCE' : 'EXTEND';
    const snap = await db
        .collection('convocatorias_cobertura')
        .where('shiftId', '==', absenceShiftId)
        .where('type', '==', other)
        .where('status', '==', 'ACCEPTED')
        .limit(1)
        .get();
    return !snap.empty;
}
async function hasActiveConvocatoriaForType(db, shiftId, convType) {
    const [pending, escalated] = await Promise.all([
        db.collection('convocatorias_cobertura')
            .where('shiftId', '==', shiftId)
            .where('type', '==', convType)
            .where('status', '==', 'PENDING')
            .limit(1)
            .get(),
        db.collection('convocatorias_cobertura')
            .where('shiftId', '==', shiftId)
            .where('type', '==', convType)
            .where('status', '==', 'ESCALATED')
            .limit(1)
            .get(),
    ]);
    return !pending.empty || !escalated.empty;
}
async function ensureMissingDualLegConvocatoria(db, conv) {
    const missing = dualSiblingConvType(conv.type);
    if (!missing)
        return;
    const titularSnap = await db.collection('turnos').doc(conv.shiftId).get();
    const st = String(titularSnap.data()?.coverageStatus || '').toUpperCase();
    if (st !== 'PARTIAL')
        return;
    const siblingAccepted = await extAdvSiblingAccepted(db, conv.shiftId, conv.type);
    if (siblingAccepted)
        return;
    if (await hasActiveConvocatoriaForType(db, conv.shiftId, missing))
        return;
    const candidate = await findBestCandidate(db, conv, missing);
    if (!candidate) {
        await db.collection('novedades').add({
            type: 'VACANTE_PARCIAL',
            shiftId: conv.shiftId,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            empresaId: conv.empresaId,
            message: `Cobertura parcial: falta pata ${missing} y no hay candidato disponible en ${conv.objectiveName || 'objetivo'}.`,
            coverageType: missing,
            resolved: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return;
    }
    const { extendShiftId: _prevExt, advanceShiftId: _prevAdv, candidateShiftId: _prevCand, ...convWithoutLegIds } = conv;
    await crearConvocatoriaDoc(db, {
        ...convWithoutLegIds,
        type: missing,
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf(missing),
        candidateEmployeeId: candidate.id,
        candidateEmployeeName: candidate.name,
        ...(candidate.uid ? { candidateUid: candidate.uid } : {}),
        ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
        ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
        ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
        createdBy: conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO' : 'AUTO',
    });
}
async function avanzarCascadaOrPartialVacante(db, conv, reason) {
    if (conv.type === 'EXTEND' || conv.type === 'ADVANCE') {
        const titularSnap = await db.collection('turnos').doc(conv.shiftId).get();
        const st = String(titularSnap.data()?.coverageStatus || '').toUpperCase();
        if (st === 'PARTIAL') {
            await db.collection('novedades').add({
                type: 'VACANTE_PARCIAL',
                shiftId: conv.shiftId,
                objectiveId: conv.objectiveId,
                objectiveName: conv.objectiveName || '',
                empresaId: conv.empresaId,
                title: 'Cobertura parcial incompleta',
                message: `${conv.candidateEmployeeName} ${reason === 'REJECTED' ? 'rechazó' : 'no respondió'} la pata ${conv.type}. El titular sigue PARTIAL — falta completar EXT+ADV.`,
                coverageType: conv.type,
                candidateEmployeeId: conv.candidateEmployeeId,
                candidateEmployeeName: conv.candidateEmployeeName,
                status: 'unread',
                resolved: false,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            return;
        }
    }
    await avanzarCascada(db, conv, reason);
}
function convTypeToCoverageType(type) {
    const u = String(type || '').toUpperCase();
    if (u === 'VOLANTE' || u.startsWith('SIN_TURNO'))
        return 'SIN_TURNO';
    return u;
}
async function resolverCobertura(db, conv) {
    const { syncAusenciaCoberturaGestionada, isTitularAlreadyCovered, applyCoverage, CoverageApplyError, } = await Promise.resolve().then(() => require('./syncAusenciaCobertura'));
    const titularRef = db.collection('turnos').doc(conv.shiftId);
    const convRef = db.collection('convocatorias_cobertura').doc(conv.id);
    const claimAgeMs = (claimAt) => {
        if (!claimAt)
            return null;
        const ts = claimAt;
        if (typeof ts.toMillis === 'function')
            return Date.now() - ts.toMillis();
        if (typeof ts.seconds === 'number')
            return Date.now() - ts.seconds * 1000;
        return null;
    };
    const claim = await db.runTransaction(async (tx) => {
        const titularSnap = await tx.get(titularRef);
        const titularData = titularSnap.data() || {};
        const claimConv = String(titularData.coverageClaimConvocatoriaId || '').trim();
        if (isTitularAlreadyCovered(titularData)) {
            if (String(titularData.coverageConvocatoriaId || '') === conv.id
                || claimConv === conv.id) {
                return { ok: true, already: true, titular: titularData, heldClaim: false };
            }
            tx.update(convRef, {
                status: 'CANCELLED',
                cancelReason: 'ALREADY_COVERED',
                cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { ok: false, already: true, titular: titularData, heldClaim: false };
        }
        if (claimConv && claimConv !== conv.id) {
            const age = claimAgeMs(titularData.coverageClaimAt);
            if (age !== null && age < 2 * 60 * 1000) {
                tx.update(convRef, {
                    status: 'CANCELLED',
                    cancelReason: 'CLAIM_HELD_BY_OTHER_CONVOCATORIA',
                    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                return { ok: false, already: true, titular: titularData, heldClaim: false };
            }
        }
        tx.update(titularRef, {
            coverageClaimConvocatoriaId: conv.id,
            coverageClaimAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: true, already: false, titular: titularData, heldClaim: true };
    });
    if (!claim.ok) {
        console.log(`[resolverCobertura] skip ${conv.id}: ausencia ${conv.shiftId} ya cubierta`);
        return;
    }
    const claimHeld = !!claim.heldClaim && !claim.already;
    const releaseClaim = async () => {
        if (!claimHeld)
            return;
        try {
            await titularRef.update({ coverageClaimConvocatoriaId: firestore_1.FieldValue.delete() });
        }
        catch (err) {
            console.warn('[resolverCobertura] release claim:', err.message);
        }
    };
    const batch = db.batch();
    const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
        : conv.createdBy === 'AUTO' ? 'AUTO'
            : 'OPERACIONES';
    const titularData = claim.titular;
    const empresaId = String(conv.empresaId || titularData.empresaId || '');
    let titularCloseMode = 'FULL';
    let rrhhCoverageType = convTypeToCoverageType(String(conv.type));
    const { dualExtAdvSegmentTimestamps, titularAnchorFromShift, extensionEndTimestamp, adjustedStartTimestamp, resolveCoverageBandCode: resolveBand, } = await Promise.resolve().then(() => require('./coverageExtAdvSegments'));
    try {
        if (conv.type === 'EXTEND' && conv.extendShiftId) {
            const anchor = titularAnchorFromShift(titularData);
            const gapBand = resolveBand({ code: conv.shiftCode, startTime: conv.startTime });
            const seg = dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand });
            const dualOk = await extAdvSiblingAccepted(db, conv.shiftId, 'EXTEND');
            titularCloseMode = dualOk ? 'FULL' : 'PARTIAL';
            rrhhCoverageType = dualOk ? 'RETENCION' : 'EXTEND';
            await applyCoverage(db, batch, {
                titularShiftId: conv.shiftId,
                titularShift: titularData,
                candidateEmployeeId: conv.candidateEmployeeId,
                candidateEmployeeName: conv.candidateEmployeeName,
                sourceShiftId: conv.extendShiftId,
                coverageType: 'EXTEND',
                resolvedBy: resolvedBy,
                empresaId,
                code: conv.shiftCode,
                objectiveId: conv.objectiveId,
                objectiveName: conv.objectiveName,
                clientId: conv.clientId,
                convocatoriaId: conv.id,
                titularCloseMode,
                covSegmentStart: seg.extCov.start,
                covSegmentEnd: seg.extCov.end,
                extensionEndTime: extensionEndTimestamp(anchor, seg.extCov.extensionEndHm),
            });
        }
        else if (conv.type === 'ADVANCE' && conv.advanceShiftId) {
            const anchor = titularAnchorFromShift(titularData);
            const gapBand = resolveBand({ code: conv.shiftCode, startTime: conv.startTime });
            const seg = dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand });
            const dualOk = await extAdvSiblingAccepted(db, conv.shiftId, 'ADVANCE');
            titularCloseMode = dualOk ? 'FULL' : 'PARTIAL';
            rrhhCoverageType = dualOk ? 'RETENCION' : 'ADVANCE';
            await applyCoverage(db, batch, {
                titularShiftId: conv.shiftId,
                titularShift: titularData,
                candidateEmployeeId: conv.candidateEmployeeId,
                candidateEmployeeName: conv.candidateEmployeeName,
                sourceShiftId: conv.advanceShiftId,
                coverageType: 'ADVANCE',
                resolvedBy: resolvedBy,
                empresaId,
                code: conv.shiftCode,
                objectiveId: conv.objectiveId,
                objectiveName: conv.objectiveName,
                clientId: conv.clientId,
                convocatoriaId: conv.id,
                titularCloseMode,
                covSegmentStart: seg.advCov.start,
                covSegmentEnd: seg.advCov.end,
                adjustedStartTime: adjustedStartTimestamp(anchor, seg.advCov.adjustedStartHm),
            });
        }
        else {
            const sourceShiftId = conv.type === 'FT'
                ? conv.ftShiftId
                : conv.candidateShiftId;
            rrhhCoverageType = convTypeToCoverageType(String(conv.type));
            await applyCoverage(db, batch, {
                titularShiftId: conv.shiftId,
                titularShift: titularData,
                candidateEmployeeId: conv.candidateEmployeeId,
                candidateEmployeeName: conv.candidateEmployeeName,
                sourceShiftId: sourceShiftId || null,
                coverageType: rrhhCoverageType,
                resolvedBy: resolvedBy,
                empresaId,
                startTime: conv.startTime,
                endTime: conv.endTime,
                code: conv.type === 'FT' ? 'FT' : conv.shiftCode,
                objectiveId: conv.objectiveId,
                objectiveName: conv.objectiveName,
                clientId: conv.clientId,
                convocatoriaId: conv.id,
                titularCloseMode: 'FULL',
            });
        }
        if (titularCloseMode === 'FULL') {
            await syncAusenciaCoberturaGestionada(db, {
                shiftId: conv.shiftId,
                coveredByEmployeeId: conv.candidateEmployeeId,
                coveredByEmployeeName: conv.candidateEmployeeName,
                coverageType: rrhhCoverageType,
                resolvedBy,
                empresaId: conv.empresaId || null,
            }, batch);
        }
        const [pendingSnap, escalatedSnap] = await Promise.all([
            db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'PENDING').get(),
            db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'ESCALATED').get(),
        ]);
        const siblingKeepType = titularCloseMode === 'PARTIAL' ? dualSiblingConvType(String(conv.type)) : null;
        for (const d of [...pendingSnap.docs, ...escalatedSnap.docs]) {
            if (d.id === conv.id)
                continue;
            if (siblingKeepType && String(d.data().type || '').toUpperCase() === siblingKeepType) {
                continue;
            }
            batch.update(d.ref, { status: 'CANCELLED', cancelledAt: firestore_1.FieldValue.serverTimestamp() });
        }
        const novedadRef = db.collection('novedades').doc();
        const typeLabel = {
            RET: 'RET activado',
            REF: 'Refuerzo (REF)',
            ESC: 'Escuela (ESC)',
            EXTEND: 'Jornada extendida',
            ADVANCE: 'Turno adelantado',
            FT: 'Franco Trabajado',
            VOLANTE: 'Cobertura volante',
            SIN_TURNO: 'Guardia disponible',
            SIN_TURNO_CON_EXP: 'Guardia con experiencia',
        };
        batch.set(novedadRef, {
            type: 'COBERTURA_RESUELTA',
            shiftId: conv.shiftId,
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName || '',
            clientId: conv.clientId || null,
            empresaId: conv.empresaId,
            title: 'Cobertura resuelta',
            message: `${typeLabel[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
            description: `${typeLabel[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
            coverageType: conv.type,
            candidateEmployeeId: conv.candidateEmployeeId,
            candidateEmployeeName: conv.candidateEmployeeName,
            employeeId: conv.candidateEmployeeId,
            employeeName: conv.candidateEmployeeName,
            status: 'unread',
            resolved: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        if (titularCloseMode === 'PARTIAL'
            && (conv.type === 'EXTEND' || conv.type === 'ADVANCE')) {
            await ensureMissingDualLegConvocatoria(db, conv);
        }
    }
    catch (e) {
        if (e instanceof CoverageApplyError && e.code === 'ALREADY_COVERED') {
            console.warn(`[resolverCobertura] ALREADY_COVERED conv=${conv.id} shift=${conv.shiftId}: ${e.message}`);
            const errBatch = db.batch();
            errBatch.update(convRef, {
                status: 'CANCELLED',
                cancelReason: 'ALREADY_COVERED',
                cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            });
            await errBatch.commit();
            return;
        }
        console.error(`[resolverCobertura] error conv=${conv.id}:`, e.message);
        throw e;
    }
    finally {
        await releaseClaim();
    }
}
exports.crearConvocatoriaCobertura = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();
    const { shiftId, candidateEmployeeId, type, empresaId, advanceShiftId, extendShiftId, ftShiftId, candidateShiftId, } = data;
    if (!shiftId || !candidateEmployeeId || !type || !empresaId) {
        throw new functions.https.HttpsError('invalid-argument', 'shiftId, candidateEmployeeId, type y empresaId son requeridos.');
    }
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    }
    const shift = shiftSnap.data();
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
    const convId = await crearConvocatoriaDoc(db, {
        empresaId,
        shiftId,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        positionName: String(shift.positionName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type,
        cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf(type),
        candidateEmployeeId,
        candidateEmployeeName: empName,
        candidateUid: uid || undefined,
        ...(advanceShiftId ? { advanceShiftId } : {}),
        ...(extendShiftId ? { extendShiftId } : {}),
        ...(ftShiftId ? { ftShiftId } : {}),
        ...(candidateShiftId ? { candidateShiftId } : {}),
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
    const { convocatoriaId, response, rejectionReason, etaMinutes } = data;
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
        const shiftSnap = await db.collection('turnos').doc(conv.shiftId).get();
        const shiftData = (shiftSnap.data() || {});
        if ((0, coverageTraceShift_1.skipAbsencePipelineForShift)(shiftData)) {
            return { success: true, skipped: 'trace_registration' };
        }
        const startMs = shiftData.startTime?.toMillis?.() ?? 0;
        if (response === 'ACCEPTED') {
            await convRef.update({ status: 'ACCEPTED', respondedAt: now, resolvedAt: now });
            const eta = Number.isFinite(Number(etaMinutes)) ? Math.max(1, Math.floor(Number(etaMinutes))) : 30;
            const etaAt = startMs > 0 ? firestore_1.Timestamp.fromMillis(startMs + eta * 60 * 1000) : now;
            await db.collection('turnos').doc(conv.shiftId).update({
                lateArrivalConfirmed: true,
                lateArrivalConfirmedAt: now,
                lateArrivalEtaMinutes: eta,
                lateArrivalEtaAt: etaAt,
            });
        }
        else {
            await convRef.update({ status: 'REJECTED', respondedAt: now, rejectionReason: rejectionReason || null });
            await (0, markShiftAbsent_1.markShiftAbsent)(db, conv.shiftId, {
                reason: 'LLEGADA_TARDE_RECHAZADA',
                by: context.auth.uid,
            });
        }
        return { success: true };
    }
    if (response === 'ACCEPTED') {
        await convRef.update({
            status: 'ACCEPTED',
            respondedAt: now,
            resolvedAt: now,
        });
        await resolverCobertura(db, { ...conv, id: convocatoriaId });
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
            message: `${conv.candidateEmployeeName} rechazó la convocatoria (${conv.type}). Avanzando cascada.`,
            resolved: false,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await avanzarCascadaOrPartialVacante(db, { ...conv, id: convocatoriaId }, 'REJECTED');
    }
    return { success: true };
});
exports.cancelarConvocatoriaCobertura = functions
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();
    const { convocatoriaId } = data;
    if (!convocatoriaId)
        throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId requerido.');
    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');
    if (snap.data()?.status !== 'PENDING') {
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
    if (!context.auth?.uid)
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    const db = admin.firestore();
    const { shiftId, empresaId, type } = data;
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists)
        throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    const shift = shiftSnap.data();
    const ctx = {
        objectiveId: String(shift.objectiveId || ''),
        clientId: String(shift.clientId || ''),
        aptitudesRequeridas: [],
    };
    const empSnap = await db.collection('empleados')
        .where('empresaId', '==', empresaId)
        .where('status', '==', 'ACTIVE')
        .limit(200)
        .get();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 0);
    const allTodaySnap = await db.collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('startTime', '>=', firestore_1.Timestamp.fromDate(todayStart))
        .where('startTime', '<=', firestore_1.Timestamp.fromDate(todayEnd))
        .limit(500)
        .get();
    const empShiftCode = new Map();
    for (const d of allTodaySnap.docs) {
        const t = d.data();
        if (t.employeeId)
            empShiftCode.set(t.employeeId, String(t.code || ''));
    }
    const results = [];
    for (const empDoc of empSnap.docs) {
        const emp = empDoc.data();
        const empId = empDoc.id;
        const shiftCode = empShiftCode.get(empId);
        let derivedType = null;
        if (shiftCode === 'RET' && shift.objectiveId === emp.preferredObjectiveId) {
            derivedType = 'RET';
        }
        else if (shiftCode && ['F', 'FF', 'FP'].includes(shiftCode)) {
            derivedType = 'FT';
        }
        else if (!shiftCode) {
            derivedType = (emp.volante || []).includes(shift.objectiveId)
                ? 'VOLANTE'
                : (emp.preferredObjectiveId === shift.objectiveId || !!(emp.experienciaObjetivos || {})[shift.objectiveId])
                    ? 'SIN_TURNO_CON_EXP'
                    : 'SIN_TURNO';
        }
        if (!derivedType)
            continue;
        if (type && derivedType !== type)
            continue;
        const eligibility = (0, eligibilityFilter_1.checkEligibility)(emp, ctx, derivedType);
        results.push({
            employeeId: empId,
            employeeName: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId,
            candidateType: derivedType,
            eligibility,
        });
    }
    const order = ['RET', 'VOLANTE', 'SIN_TURNO_CON_EXP', 'SIN_TURNO', 'FT'];
    results.sort((a, b) => {
        if (a.eligibility.eligible !== b.eligibility.eligible)
            return a.eligibility.eligible ? -1 : 1;
        return order.indexOf(a.candidateType) - order.indexOf(b.candidateType);
    });
    return { candidates: results };
});
async function iniciarCascadaCobertura(db, shift, createdBy = 'AUTO') {
    const { isTitularAlreadyCovered, isActiveOpsCoverageDoc } = await Promise.resolve().then(() => require('./syncAusenciaCobertura'));
    const titularSnap = await db.collection('turnos').doc(shift.id).get();
    const titularData = (titularSnap.data() || {});
    if (isTitularAlreadyCovered(titularData)) {
        console.log(`[iniciarCascadaCobertura] skip ${shift.id}: ya cubierta`);
        return;
    }
    const priorCov = await db.collection('turnos')
        .where('absenceShiftId', '==', shift.id)
        .limit(20)
        .get();
    if (priorCov.docs.some((d) => isActiveOpsCoverageDoc(d.data()))) {
        console.log(`[iniciarCascadaCobertura] skip ${shift.id}: ya hay OPERATIONS_COVERAGE activa`);
        return;
    }
    const existing = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', shift.id)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(1)
        .get();
    if (!existing.empty)
        return;
    const baseConvData = {
        empresaId: shift.empresaId,
        shiftId: shift.id,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        positionName: String(shift.positionName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type: 'RET',
        urgency: (0, eligibilityFilter_1.getUrgency)(shift.startTime),
        cascadeStep: 0,
        candidateEmployeeId: '',
        candidateEmployeeName: '',
        status: 'PENDING',
        timeoutAt: firestore_1.Timestamp.now(),
        createdAt: firestore_1.Timestamp.now(),
        createdBy,
    };
    for (const type of eligibilityFilter_1.CASCADE_ORDER) {
        if (type === 'FT') {
            await dispararBroadcastFT(db, baseConvData);
            return;
        }
        const candidate = await findBestCandidate(db, baseConvData, type);
        if (!candidate)
            continue;
        await crearConvocatoriaDoc(db, {
            ...baseConvData,
            type,
            cascadeStep: eligibilityFilter_1.CASCADE_ORDER.indexOf(type),
            candidateEmployeeId: candidate.id,
            candidateEmployeeName: candidate.name,
            candidateUid: candidate.uid,
            ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
            ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
            ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
            createdBy,
        });
        return;
    }
    await (0, escalarVacanteSinCobertura_1.escalarVacanteSinCobertura)(db, {
        shiftId: shift.id,
        empresaId: shift.empresaId,
        objectiveId: shift.objectiveId,
        objectiveName: shift.objectiveName || '',
        positionName: shift.positionName || '',
        message: `Sin candidatos para turno ${shift.code || ''} en ${shift.objectiveName || 'objetivo'} (${createdBy}).`,
        attemptRetention: true,
        source: 'INICIAR_CASCADA',
    });
}
async function simularRespuestasConvocatorias(db, empresaId) {
    const THINK_TIME_MS = 90 * 1000;
    const now = firestore_1.Timestamp.now();
    const cutoffMs = now.toMillis() - THINK_TIME_MS;
    const snap = await db.collection('convocatorias_cobertura')
        .where('empresaId', '==', empresaId)
        .where('status', 'in', ['PENDING', 'ESCALATED'])
        .limit(50)
        .get();
    let respondidas = 0;
    for (const convDoc of snap.docs) {
        const conv = convDoc.data();
        const createdMs = conv.createdAt instanceof firestore_1.Timestamp ? conv.createdAt.toMillis() : 0;
        if (createdMs > cutoffMs)
            continue;
        const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
        const accept = hashVal <= 7;
        try {
            if (accept) {
                await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: now, respondedBy: 'MODO_DEMO' });
                await resolverCobertura(db, { ...conv, id: convDoc.id });
            }
            else {
                await convDoc.ref.update({ status: 'REJECTED', respondedAt: now, rejectionReason: 'MODO_DEMO_AUTO', respondedBy: 'MODO_DEMO' });
                await avanzarCascadaOrPartialVacante(db, { ...conv, id: convDoc.id }, 'REJECTED');
            }
            respondidas++;
        }
        catch (e) {
            console.warn('[simularRespuestasConvocatorias]', convDoc.id, e?.message);
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
                const sh = (await db.collection('turnos').doc(conv.shiftId).get()).data();
                if (!(0, coverageTraceShift_1.skipAbsencePipelineForShift)(sh)) {
                    await (0, markShiftAbsent_1.markShiftAbsent)(db, conv.shiftId, {
                        reason: 'LLEGADA_TARDE_TIMEOUT',
                        by: 'SYSTEM_SCHEDULER',
                    });
                }
                console.log(`[checkConvocatoriaTimeouts] LLEGADA_TARDE timeout → ausente ${conv.shiftId}`);
            }
            else {
                await d.ref.update({ status: 'ESCALATED', escalatedAt: now });
                await avanzarCascadaOrPartialVacante(db, { ...conv, id: d.id }, 'TIMEOUT');
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