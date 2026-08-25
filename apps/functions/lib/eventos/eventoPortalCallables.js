"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondEventoConvocatoria = void 0;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const firestore_1 = require("firebase-admin/firestore");
const eventoAssignAdmin_1 = require("./eventoAssignAdmin");
async function resolveEmployeeIdForUid(db, uid) {
    const byUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    if (!byUid.empty) {
        const d = byUid.docs[0];
        return { empId: d.id, empData: d.data() };
    }
    const byId = await db.collection('empleados').doc(uid).get();
    if (byId.exists) {
        return { empId: byId.id, empData: byId.data() };
    }
    return null;
}
function employeeDisplayName(data) {
    if (!data)
        return 'Empleado';
    const name = `${data.lastName || ''} ${data.firstName || ''}`.trim();
    return name || String(data.email || 'Empleado');
}
function isSuperAdminClaims(claims) {
    if (!claims)
        return false;
    const role = String(claims.role || claims.type || '')
        .toUpperCase()
        .replace(/_/g, '');
    return role === 'SUPERADMIN';
}
async function assertPortalEmployee(context, asEmployeeId) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();
    const authUid = context.auth.uid;
    const previewId = String(asEmployeeId || '').trim();
    if (previewId && isSuperAdminClaims(context.auth.token)) {
        const empSnap = await db.collection('empleados').doc(previewId).get();
        if (!empSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Legajo de preview no encontrado.');
        }
        return {
            uid: authUid,
            empId: previewId,
            empData: empSnap.data(),
            actingAsPreview: true,
        };
    }
    const resolved = await resolveEmployeeIdForUid(db, authUid);
    if (!resolved) {
        if (isSuperAdminClaims(context.auth.token)) {
            throw new functions.https.HttpsError('failed-precondition', 'Estás en sesión SuperAdmin. Entrá en Preview de un legajo (la app envía asEmployeeId) o usá el login del vigilador.');
        }
        throw new functions.https.HttpsError('permission-denied', 'Perfil de vigilador no encontrado.');
    }
    return { uid: authUid, empId: resolved.empId, empData: resolved.empData, actingAsPreview: false };
}
function calcHorasServicio(tipoTurno, horaInicio, horaFin) {
    if (tipoTurno === '3x8' || tipoTurno === '2x12')
        return 24;
    const [sh, sm] = horaInicio.split(':').map(Number);
    const [eh, em] = horaFin.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0)
        mins += 24 * 60;
    return Math.round(mins / 60);
}
exports.respondEventoConvocatoria = functions.https.onCall(async (data, context) => {
    const solicitudId = String(data?.solicitudId || '').trim();
    const accept = data?.accept === true;
    const asEmployeeId = String(data?.asEmployeeId || data?.empleadoId || '').trim();
    if (!solicitudId) {
        throw new functions.https.HttpsError('invalid-argument', 'solicitudId requerido.');
    }
    const { empId, empData, actingAsPreview } = await assertPortalEmployee(context, asEmployeeId);
    const db = admin.firestore();
    const ref = db.collection('solicitudes_evento').doc(solicitudId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
    }
    const sol = snap.data();
    if (String(sol.empleadoId) !== empId) {
        throw new functions.https.HttpsError('permission-denied', 'La convocatoria no es tuya.');
    }
    if (sol.status !== 'convocado') {
        throw new functions.https.HttpsError('failed-precondition', 'La solicitud ya no espera tu respuesta.');
    }
    if (!accept) {
        await ref.update({
            status: 'rechazada',
            respondidoAt: firestore_1.FieldValue.serverTimestamp(),
            ...(actingAsPreview ? { previewRespondedBy: context.auth.uid } : {}),
        });
        return { success: true, status: 'rechazada' };
    }
    const eventoSnap = await db.collection('eventos').doc(String(sol.eventoId)).get();
    const evento = eventoSnap.data() || {};
    const servicios = (evento.servicios || []);
    const servicio = servicios.find((s) => s.id === sol.servicioId);
    const horaInicio = String(servicio?.horaInicio || '08:00');
    const horaFin = String(servicio?.horaFin || '16:00');
    const tipoTurno = String(servicio?.tipoTurno || 'libre');
    const horas = calcHorasServicio(tipoTurno, horaInicio, horaFin);
    const empNombre = employeeDisplayName(empData);
    await (0, eventoAssignAdmin_1.assignGuardToEventAdmin)(db, {
        empresaId: String(sol.empresaId || empData.empresaId || ''),
        empleadoId: empId,
        empleadoNombre: empNombre,
        eventoId: String(sol.eventoId),
        eventoNombre: String(sol.eventoNombre || evento.nombre || ''),
        clienteId: evento.clienteId ? String(evento.clienteId) : undefined,
        clienteNombre: evento.clienteNombre ? String(evento.clienteNombre) : undefined,
        servicioId: String(sol.servicioId),
        servicioNombre: String(sol.servicioNombre || ''),
        servicioFecha: String(sol.servicioFecha),
        horaInicio,
        horaFin,
        horas,
        solicitudId,
    });
    const guardUid = typeof empData.uid === 'string' && empData.uid ? empData.uid : context.auth.uid;
    await db.collection('user_notifications').add({
        uid: guardUid,
        employeeId: empId,
        empresaId: sol.empresaId || empData.empresaId || null,
        type: 'EVENTO_CONFIRMADO',
        target: 'employee',
        title: 'Evento confirmado',
        body: `Quedaste asignado a ${sol.servicioNombre || sol.eventoNombre}.`,
        eventoId: sol.eventoId,
        servicioId: sol.servicioId,
        solicitudId,
        read: false,
        readAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { success: true, status: 'aprobada' };
});
//# sourceMappingURL=eventoPortalCallables.js.map