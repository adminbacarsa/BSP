/**
 * Al crear una convocatoria (admin_convoca), asegura user_notifications + FCM
 * aunque el legajo no tenga Auth uid o el panel web no escriba la alerta.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

function fmtFechaAr(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export const onSolicitudEventoCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('solicitudes_evento/{solicitudId}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const tipo = String(data.tipo || '');
    const status = String(data.status || '');
    const esConvocatoria = tipo === 'admin_convoca' && status === 'convocado';
    const esAsignacionDirecta = tipo === 'admin_asigna' && status === 'aprobada';
    if (!esConvocatoria && !esAsignacionDirecta) return;

    const empleadoId = String(data.empleadoId || '').trim();
    if (!empleadoId) {
      console.warn('[onSolicitudEventoCreated] Sin empleadoId', snap.id);
      return;
    }

    const db = admin.firestore();
    const solicitudId = snap.id;

    // Evitar duplicar si el panel ya escribió la alerta
    const existing = await db
      .collection('user_notifications')
      .where('solicitudId', '==', solicitudId)
      .where('type', '==', 'CONVOCATORIA_EVENTO')
      .limit(1)
      .get();
    if (!existing.empty) {
      console.log('[onSolicitudEventoCreated] Notif ya existe para', solicitudId);
      return;
    }

    const empSnap = await db.collection('empleados').doc(empleadoId).get();
    const empData = empSnap.exists ? empSnap.data() || {} : {};
    const empUid = typeof empData.uid === 'string' && empData.uid ? empData.uid : null;

    const eventoNombre = String(data.eventoNombre || 'Evento');
    const servicioNombre = String(data.servicioNombre || 'Servicio');
    const servicioFecha = String(data.servicioFecha || '');
    const title = esAsignacionDirecta ? `Asignado a evento: ${eventoNombre}` : `Convocatoria: ${eventoNombre}`;
    const body = `${servicioNombre}${servicioFecha ? ` · ${fmtFechaAr(servicioFecha)}` : ''}`;

    await db.collection('user_notifications').add({
      empresaId: data.empresaId || empData.empresaId || null,
      uid: empUid,
      employeeId: empleadoId,
      type: 'CONVOCATORIA_EVENTO',
      target: 'employee',
      title,
      body,
      eventoId: data.eventoId || null,
      eventoNombre,
      servicioId: data.servicioId || null,
      servicioNombre,
      solicitudId,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      source: 'onSolicitudEventoCreated',
    });

    console.log(
      `[onSolicitudEventoCreated] Notif creada solicitud=${solicitudId} emp=${empleadoId} uid=${empUid || 'null'}`,
    );
  });
