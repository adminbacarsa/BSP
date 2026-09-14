"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ejecutarExtenderJornada = ejecutarExtenderJornada;
exports.ejecutarCubrirAusencia = ejecutarCubrirAusencia;
exports.ejecutarCrearTurnoRefuerzo = ejecutarCrearTurnoRefuerzo;
exports.ejecutarConfirmarPresencia = ejecutarConfirmarPresencia;
exports.ejecutarRegistrarAusencia = ejecutarRegistrarAusencia;
exports.ejecutarCerrarTurno = ejecutarCerrarTurno;
exports.ejecutarPlanificarObjetivoMes = ejecutarPlanificarObjetivoMes;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
function startOfDayAr(dateYmd) {
    const [y, m, d] = dateYmd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}
function addHours(date, h) {
    return new Date(date.getTime() + h * 3600 * 1000);
}
function codigoToHoras(code) {
    if (code === 'D12' || code === 'N12')
        return 12;
    return 8;
}
async function ejecutarExtenderJornada(empresaId, payload) {
    const { shiftId, nuevoCodigo } = payload;
    if (!shiftId || !nuevoCodigo)
        throw new Error('Payload incompleto: falta shiftId o nuevoCodigo.');
    const db = admin.firestore();
    const ref = db.collection('turnos').doc(shiftId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new Error(`Turno ${shiftId} no encontrado.`);
    const data = snap.data();
    const startTime = data.startTime;
    const startDate = startTime.toDate();
    const newEndTime = firestore_1.Timestamp.fromDate(addHours(startDate, codigoToHoras(nuevoCodigo)));
    await ref.update({
        code: nuevoCodigo,
        endTime: newEndTime,
        modifiedByAgent: true,
        modifiedByAgentAt: firestore_1.Timestamp.now(),
        modifiedByAgentEmpresaId: empresaId,
    });
    return { ok: true, message: `✓ Jornada extendida a **${nuevoCodigo}** correctamente.` };
}
async function ejecutarCubrirAusencia(empresaId, payload) {
    const { empleadoId, objetivoId, clientId, banda, fecha, empleadoNombre, objetivoNombre } = payload;
    if (!empleadoId || !objetivoId || !banda || !fecha)
        throw new Error('Payload incompleto para cubrir_ausencia.');
    const [y, m, d] = fecha.split('-').map(Number);
    const startAr = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
    const bandaOffsets = {
        M: [0, 8], T: [8, 16], N: [16, 24],
        D12: [0, 12], N12: [12, 24],
    };
    const [startH, endH] = bandaOffsets[banda] ?? [0, 8];
    const startTime = firestore_1.Timestamp.fromDate(addHours(startAr, startH));
    const endTime = firestore_1.Timestamp.fromDate(addHours(startAr, endH));
    const db = admin.firestore();
    await db.collection('turnos').add({
        employeeId: empleadoId,
        objectiveId: objetivoId,
        clientId: clientId ?? '',
        empresaId,
        code: banda,
        startTime,
        endTime,
        origin: 'OPERATIONS_COVERAGE',
        isPresent: false,
        isAbsent: false,
        isCompleted: false,
        draft: false,
        createdByAgent: true,
        createdByAgentAt: firestore_1.Timestamp.now(),
    });
    const nombreDisplay = empleadoNombre ?? empleadoId;
    const sitioDisplay = objetivoNombre ?? objetivoId;
    return { ok: true, message: `✓ Cobertura creada: **${nombreDisplay}** cubrirá turno **${banda}** el ${fecha} en **${sitioDisplay}**.` };
}
async function ejecutarCrearTurnoRefuerzo(empresaId, payload) {
    const { empleadoId, objetivoId, clientId, banda, fecha, empleadoNombre, objetivoNombre } = payload;
    if (!empleadoId || !objetivoId || !banda || !fecha)
        throw new Error('Payload incompleto para crear_turno_refuerzo.');
    const [y, m, d] = fecha.split('-').map(Number);
    const startAr = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
    const bandaOffsets = {
        M: [0, 8], T: [8, 16], N: [16, 24],
        D12: [0, 12], N12: [12, 24],
    };
    const [startH, endH] = bandaOffsets[banda] ?? [0, 8];
    const startTime = firestore_1.Timestamp.fromDate(addHours(startAr, startH));
    const endTime = firestore_1.Timestamp.fromDate(addHours(startAr, endH));
    const db = admin.firestore();
    await db.collection('turnos').add({
        employeeId: empleadoId,
        objectiveId: objetivoId,
        clientId: clientId ?? '',
        empresaId,
        code: banda,
        startTime,
        endTime,
        origin: 'OPERATIONS_COVERAGE',
        isPresent: false,
        isAbsent: false,
        isCompleted: false,
        draft: false,
        createdByAgent: true,
        createdByAgentAt: firestore_1.Timestamp.now(),
    });
    const nombreDisplay = empleadoNombre ?? empleadoId;
    const sitioDisplay = objetivoNombre ?? objetivoId;
    return { ok: true, message: `✓ Refuerzo creado: **${nombreDisplay}** turno **${banda}** el ${fecha} en **${sitioDisplay}**.` };
}
async function ejecutarConfirmarPresencia(empresaId, payload) {
    const { shiftId, empleadoNombre, objetivoNombre, fecha } = payload;
    if (!shiftId)
        throw new Error('Payload incompleto: falta shiftId.');
    const db = admin.firestore();
    const { registrarPresencia } = await Promise.resolve().then(() => require('../fichajes/registrarPresencia'));
    const result = await registrarPresencia(db, {
        shiftId,
        source: 'VIGI',
        actorName: 'Asistente COSP (VIGI)',
    });
    const nombre = empleadoNombre ?? 'Empleado';
    const sitio = objetivoNombre ? ` en **${objetivoNombre}**` : '';
    const dia = fecha ? ` el ${fecha}` : '';
    if (result.alreadyPresent) {
        return { ok: true, message: `✓ **${nombre}** ya estaba presente${dia}${sitio}.` };
    }
    const relevo = result.relieved
        ? ` Relevó a **${result.relieved.employeeName}** (FIFO).`
        : '';
    return {
        ok: true,
        message: `✓ Presencia confirmada: **${nombre}**${dia}${sitio} marcado como presente.${relevo}`,
    };
}
async function ejecutarRegistrarAusencia(empresaId, payload) {
    const { shiftId, empleadoId, objetivoId, fecha, empleadoNombre, objetivoNombre, motivo } = payload;
    if (!shiftId || !empleadoId || !fecha)
        throw new Error('Payload incompleto para registrar_ausencia.');
    const db = admin.firestore();
    await db.collection('turnos').doc(shiftId).update({
        isAbsent: true,
        modifiedByAgent: true,
        modifiedByAgentAt: firestore_1.Timestamp.now(),
        modifiedByAgentEmpresaId: empresaId,
    });
    await db.collection('ausencias').add({
        employeeId: empleadoId,
        objectiveId: objetivoId ?? '',
        shiftId,
        empresaId,
        date: fecha,
        motivo: motivo ?? 'AA',
        origin: 'AGENT',
        createdByAgent: true,
        createdByAgentAt: firestore_1.Timestamp.now(),
    });
    const nombre = empleadoNombre ?? 'Empleado';
    const sitio = objetivoNombre ? ` en **${objetivoNombre}**` : '';
    return { ok: true, message: `✓ Ausencia registrada: **${nombre}** marcado como ausente${sitio} el ${fecha}.` };
}
async function ejecutarCerrarTurno(empresaId, payload) {
    const { shiftId, empleadoId, empleadoNombre, objetivoId, objetivoNombre, fecha } = payload;
    if (!shiftId)
        throw new Error('Payload incompleto: falta shiftId.');
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    await db.collection('turnos').doc(shiftId).update({
        status: 'COMPLETED',
        isCompleted: true,
        isPresent: false,
        realEndTime: now,
        modifiedByAgent: true,
        modifiedByAgentAt: now,
        modifiedByAgentEmpresaId: empresaId,
    });
    const nombre = empleadoNombre ?? 'Guardia';
    const sitio = objetivoNombre ?? '';
    db.collection('audit_logs').add({
        action: 'CHECKOUT',
        module: 'ASISTENTE_IA',
        actorName: 'Asistente COSP',
        timestamp: now,
        empleadoId: empleadoId ?? '',
        employeeId: empleadoId ?? '',
        empleadoNombre: nombre,
        employeeName: nombre,
        objetivoId: objetivoId ?? '',
        objectiveId: objetivoId ?? '',
        objetivoNombre: sitio,
        objectiveName: sitio,
        shiftId,
        empresaId,
        details: `${nombre} finalizó turno${sitio ? ` en ${sitio}` : ''} (vía Asistente IA).`,
    }).catch(() => { });
    const AUTO_DISMISS = ['RETENCION_LARGA', 'RECARGO_12H', 'RETENCION_DETECTADA'];
    db.collection('novedades')
        .where('shiftId', '==', shiftId)
        .where('status', '==', 'pending')
        .limit(20)
        .get()
        .then((snap) => {
        if (snap.empty)
            return;
        const toUpdate = snap.docs.filter((d) => AUTO_DISMISS.includes(d.data().type));
        if (!toUpdate.length)
            return;
        const batch = db.batch();
        toUpdate.forEach((d) => batch.update(d.ref, { status: 'ATENDIDA', atendidaAt: now, atendidaPor: 'AUTO_CHECKOUT_AGENT' }));
        return batch.commit();
    })
        .catch(() => { });
    if (empleadoId) {
        db.collection('empleados').doc(empleadoId).get().then((empSnap) => {
            const uid = empSnap.exists ? empSnap.data()?.uid : undefined;
            return db.collection('user_notifications').add({
                type: 'TURNO_FINALIZADO',
                title: 'Tu turno fue cerrado',
                body: `Tu turno${sitio ? ` en ${sitio}` : ''}${fecha ? ` del ${fecha}` : ''} fue registrado como finalizado.`,
                employeeId: empleadoId,
                ...(uid ? { uid } : {}),
                shiftId,
                empresaId,
                createdAt: now,
                read: false,
            });
        }).catch(() => { });
    }
    const dia = fecha ? ` del ${fecha}` : '';
    return { ok: true, message: `✓ Turno cerrado: **${nombre}**${dia}${sitio ? ` en **${sitio}**` : ''} — estado COMPLETED, presencia finalizada. El guardia fue notificado.` };
}
async function ejecutarPlanificarObjetivoMes(empresaId, payload) {
    const { objetivoId, clientId, year, month, objetivoNombre } = payload;
    if (!objetivoId || !year || !month)
        throw new Error('Payload incompleto para planificar_objetivo_mes.');
    const { runAutoScheduleCore } = await Promise.resolve().then(() => require('../scheduling/runAutoSchedule'));
    const result = await runAutoScheduleCore({ objectiveId: objetivoId, year, month, empresaId });
    if (!result.ok && result.error)
        throw new Error(result.error);
    const db = admin.firestore();
    const agentAt = firestore_1.Timestamp.now();
    const BATCH_SIZE = 400;
    function arHhmm(dateStr, timeStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const [h, min] = timeStr.split(':').map(Number);
        return new Date(Date.UTC(y, m - 1, d, h + 3, min, 0, 0));
    }
    let written = 0;
    let currentBatch = db.batch();
    let batchOps = 0;
    const commits = [];
    for (const a of result.assignments) {
        if (batchOps >= BATCH_SIZE) {
            commits.push(currentBatch.commit());
            currentBatch = db.batch();
            batchOps = 0;
        }
        const startUtc = arHhmm(a.dateStr, a.startTime);
        let endUtc = a.endTime ? arHhmm(a.dateStr, a.endTime) : new Date(startUtc.getTime() + a.hours * 3600000);
        if (endUtc <= startUtc)
            endUtc = new Date(endUtc.getTime() + 86400000);
        currentBatch.set(db.collection('turnos').doc(), {
            employeeId: a.empId,
            objectiveId: objetivoId,
            clientId: clientId ?? '',
            empresaId,
            code: a.code,
            startTime: firestore_1.Timestamp.fromDate(startUtc),
            endTime: firestore_1.Timestamp.fromDate(endUtc),
            isFranco: a.isFranco ?? false,
            isPresent: false,
            isAbsent: false,
            isCompleted: false,
            draft: true,
            createdByAgent: true,
            createdByAgentAt: agentAt,
        });
        batchOps++;
        written++;
    }
    if (batchOps > 0)
        commits.push(currentBatch.commit());
    await Promise.all(commits);
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const mesNombre = MESES[(month - 1)] ?? String(month);
    const sitio = objetivoNombre ?? objetivoId;
    const pct = Math.round((result.coverage?.coverageRatio ?? 0) * 100);
    return {
        ok: true,
        message: `✓ Planificación generada en borrador para **${sitio}** — ${mesNombre} ${year}.\n- **${written}** turnos creados · Cobertura: **${pct}%** SLA\n- **${result.meta.employeeCount}** empleados · **${result.meta.positionCount}** puestos\n\nRevisá en **Planificación** y publicá cuando estés listo.`,
    };
}
//# sourceMappingURL=assistantWriteActions.js.map