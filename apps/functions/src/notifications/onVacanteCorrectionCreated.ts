/**
 * Cuando se crea un turno VACANTE_CORRECCION con actionTarget PLANIFICACION,
 * notifica a todos los usuarios admin de la empresa para que reasignen.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const onVacanteCorrectionCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('turnos/{turnoId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    if (data.origin !== 'VACANTE_CORRECCION') return;
    if (data.actionTarget !== 'PLANIFICACION') return;

    const empresaId = typeof data.empresaId === 'string' ? data.empresaId : null;
    if (!empresaId) return;

    const db = admin.firestore();

    // Buscar usuarios admin de la empresa (doc id = uid)
    const sysSnap = await db.collection('system_users')
      .where('empresaId', '==', empresaId)
      .get();

    if (sysSnap.empty) {
      console.warn(`[onVacanteCorrectionCreated] Sin system_users para empresa ${empresaId}`);
      return;
    }

    const positionName = String(data.positionName || '');
    const objectiveName = String(data.objectiveName || '');
    const scheduleDate = String(data.scheduleDate || '');
    const causedBy = String(data.causedByEmployeeName || 'Guardia');
    const code = String(data.code || '');

    const title = `Vacante en planificación — ${objectiveName || 'puesto'}`;
    const body = `Se eliminó el turno ${code} de ${causedBy}${positionName ? ` (${positionName})` : ''} del ${scheduleDate}. Requiere reasignación.`;

    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    for (const userDoc of sysSnap.docs) {
      const uid = String(userDoc.data()?.uid || userDoc.id);
      const notifRef = db.collection('user_notifications').doc();
      batch.set(notifRef, {
        uid,
        userId: uid,
        empresaId,
        type: 'VACANTE_PLANIFICACION',
        title,
        body,
        read: false,
        createdAt: ts,
        relatedTurnoId: snap.id,
        data: {
          turnoId: snap.id,
          objectiveId: data.objectiveId || '',
          objectiveName,
          scheduleDate,
          code,
          positionName,
          actionTarget: 'PLANIFICACION',
        },
      });
    }

    await batch.commit();
    console.log(
      `[onVacanteCorrectionCreated] ${sysSnap.size} notificaciones VACANTE_PLANIFICACION para empresa ${empresaId}`,
    );
  });
