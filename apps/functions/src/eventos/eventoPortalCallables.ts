import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue } from 'firebase-admin/firestore';
import { assignGuardToEventAdmin } from './eventoAssignAdmin';

async function resolveEmployeeIdForUid(
  db: admin.firestore.Firestore,
  uid: string,
): Promise<{ empId: string; empData: admin.firestore.DocumentData } | null> {
  const byUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
  if (!byUid.empty) {
    const d = byUid.docs[0];
    return { empId: d.id, empData: d.data() };
  }
  const byId = await db.collection('empleados').doc(uid).get();
  if (byId.exists) {
    return { empId: byId.id, empData: byId.data()! };
  }
  return null;
}

function employeeDisplayName(data: admin.firestore.DocumentData | undefined): string {
  if (!data) return 'Empleado';
  const name = `${data.lastName || ''} ${data.firstName || ''}`.trim();
  return name || String(data.email || 'Empleado');
}

async function assertPortalEmployee(context: functions.https.CallableContext): Promise<{
  uid: string;
  empId: string;
  empData: admin.firestore.DocumentData;
}> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
  }
  const db = admin.firestore();
  const resolved = await resolveEmployeeIdForUid(db, context.auth.uid);
  if (!resolved) {
    throw new functions.https.HttpsError('permission-denied', 'Perfil de vigilador no encontrado.');
  }
  return { uid: context.auth.uid, empId: resolved.empId, empData: resolved.empData };
}

function calcHorasServicio(tipoTurno: string, horaInicio: string, horaFin: string): number {
  if (tipoTurno === '3x8' || tipoTurno === '2x12') return 24;
  const [sh, sm] = horaInicio.split(':').map(Number);
  const [eh, em] = horaFin.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round(mins / 60);
}

export const respondEventoConvocatoria = functions.https.onCall(async (data, context) => {
  const { empId, empData } = await assertPortalEmployee(context);
  const solicitudId = String(data?.solicitudId || '').trim();
  const accept = data?.accept === true;
  if (!solicitudId) {
    throw new functions.https.HttpsError('invalid-argument', 'solicitudId requerido.');
  }

  const db = admin.firestore();
  const ref = db.collection('solicitudes_evento').doc(solicitudId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const sol = snap.data()!;
  if (String(sol.empleadoId) !== empId) {
    throw new functions.https.HttpsError('permission-denied', 'La convocatoria no es tuya.');
  }
  if (sol.status !== 'convocado') {
    throw new functions.https.HttpsError('failed-precondition', 'La solicitud ya no espera tu respuesta.');
  }

  if (!accept) {
    await ref.update({
      status: 'rechazada',
      respondidoAt: FieldValue.serverTimestamp(),
    });
    return { success: true, status: 'rechazada' };
  }

  const eventoSnap = await db.collection('eventos').doc(String(sol.eventoId)).get();
  const evento = eventoSnap.data() || {};
  const servicios = (evento.servicios || []) as Array<Record<string, unknown>>;
  const servicio = servicios.find((s) => s.id === sol.servicioId);
  const horaInicio = String(servicio?.horaInicio || '08:00');
  const horaFin = String(servicio?.horaFin || '16:00');
  const tipoTurno = String(servicio?.tipoTurno || 'libre');
  const horas = calcHorasServicio(tipoTurno, horaInicio, horaFin);
  const empNombre = employeeDisplayName(empData);

  await assignGuardToEventAdmin(db, {
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

  await db.collection('user_notifications').add({
    uid: context.auth!.uid,
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
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, status: 'aprobada' };
});
