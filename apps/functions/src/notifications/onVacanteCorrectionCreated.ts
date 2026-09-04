/**
 * Cuando se crea un turno VACANTE_CORRECCION, notifica a los usuarios admin
 * de la empresa. El tipo y mensaje varían según actionTarget:
 *   PLANIFICACION → VACANTE_PLANIFICACION  (link /admin/planificacion)
 *   OPERACIONES   → VACANTE_OPERACIONES    (link /admin/operaciones, urgente)
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const onVacanteCorrectionCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('turnos/{turnoId}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    if (data.origin !== 'VACANTE_CORRECCION') return;

    const actionTarget = String(data.actionTarget || '');
    if (actionTarget !== 'PLANIFICACION' && actionTarget !== 'OPERACIONES') return;

    const empresaId = typeof data.empresaId === 'string' ? data.empresaId : null;
    if (!empresaId) return;

    const db = admin.firestore();

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
    const slotDesc = `turno ${code} de ${causedBy}${positionName ? ` (${positionName})` : ''} del ${scheduleDate}`;

    const isPlan = actionTarget === 'PLANIFICACION';
    const type  = isPlan ? 'VACANTE_PLANIFICACION' : 'VACANTE_OPERACIONES';
    const title = isPlan
      ? `Vacante en planificación — ${objectiveName || 'puesto'}`
      : `⚠ Vacante urgente — ${objectiveName || 'puesto'}`;
    const body  = isPlan
      ? `Se eliminó el ${slotDesc}. Requiere reasignación en planificación.`
      : `Se eliminó el ${slotDesc}. Requiere cobertura operativa inmediata.`;

    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    for (const userDoc of sysSnap.docs) {
      const uid = String(userDoc.data()?.uid || userDoc.id);
      const notifRef = db.collection('user_notifications').doc();
      batch.set(notifRef, {
        uid,
        userId: uid,
        empresaId,
        type,
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
          actionTarget,
        },
      });
    }

    await batch.commit();
    console.log(
      `[onVacanteCorrectionCreated] ${sysSnap.size} notificaciones ${type} para empresa ${empresaId}`,
    );
  });
