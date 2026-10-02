/**
 * Al crear user_notifications de tipos que el cliente/admin solo dejan en bandeja
 * (sin FCM propio), envía push al dispositivo del vigilador.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  groupTokensByShiftAlertChannel,
  isShiftAlertFcmType,
  shiftAlertPlatformConfig,
  type DeviceTokenRow,
} from './shiftAlertFcm';
import { logConvocatoriaEvento } from '../coverage/convocatoriaEventos';

/** Tipos que NO envían FCM en el mismo flujo que crean la notificación. */
const INBOX_NEEDS_FCM = new Set([
  'CONVOCATORIA_EVENTO',
  'EVENTO_CONFIRMADO',
  'EVENTO_CUPO_COMPLETO',       // «Ya se cubrió el cupo, gracias»: la convocatoria se cerró sola
  'SWAP_REQUEST',
  'TURNO_FINALIZADO',
  'TOPE_JORNADA',
  // Operaciones CC real
  'SOLICITUD_ESTADO_LLEGADA',   // ¿por qué no fichaste? ¿llegás tarde?
  'SOLICITUD_ESTADO_RELEVO',    // ¿llegás a relevar? hay un guardia esperando
  'RELEVO',                     // tu relevo llegó, turno finalizado
  'RETENCION_AVISO',            // relevo llega tarde — quedás retenido hasta que llegue
  // Planificación / Operaciones
  'VACANTE_PLANIFICACION',      // vacante — requiere reasignación en planificación
  'VACANTE_OPERACIONES',        // vacante — requiere cobertura operativa urgente
  // Convocatoria de cobertura operativa (cascada RET → FT)
  'CONVOCATORIA_COBERTURA',     // llamado a cubrir turno vacante — requiere respuesta en 10 min
  'AVISO_TURNO_PROXIMO',        // T−5: tu turno empieza, ¿estás llegando?
  'AVISO_ENTRANTE_SIN_FICHAR',  // T: el entrante no fichó — saliente espera
  'DEVICE_REGISTRATION_REJECTED',
  'DEVICE_REGISTRATION_APPROVED',
  'CODIGO_ANEXO',
]);

async function collectTokens(
  db: admin.firestore.Firestore,
  uid: string | null | undefined,
  employeeId: string | null | undefined,
): Promise<DeviceTokenRow[]> {
  const byToken = new Map<string, DeviceTokenRow>();
  const queries: Promise<admin.firestore.QuerySnapshot>[] = [];
  if (employeeId) {
    queries.push(db.collection('device_tokens').where('employeeId', '==', employeeId).get());
  }
  if (uid) {
    queries.push(db.collection('device_tokens').where('uid', '==', uid).get());
  }
  if (queries.length === 0) return [];

  const snaps = await Promise.all(queries);
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() || {};
      const t = data.token;
      if (typeof t === 'string' && t.length > 10 && !byToken.has(t)) byToken.set(t, { token: t, data });
    }
  }
  return [...byToken.values()];
}

export const onEmployeeNotificationCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('user_notifications/{notifId}')
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const type = String(data.type || '')
      .trim()
      .toUpperCase();
    if (!INBOX_NEEDS_FCM.has(type)) return;
    if (data.fcmSent === true || data.skipFcm === true) return;

    const title = String(data.title || 'COSP Guardia').trim() || 'COSP Guardia';
    const body = String(data.body || '').trim() || 'Tenés una nueva alerta.';
    const uid = typeof data.uid === 'string' && data.uid ? data.uid : null;
    const employeeId =
      typeof data.employeeId === 'string' && data.employeeId ? data.employeeId : null;

    const db = admin.firestore();
    let tokenRows = await collectTokens(db, uid, employeeId);

    // Si no hay uid en la notif, intentar desde el legajo
    if (tokenRows.length === 0 && employeeId) {
      const empSnap = await db.collection('empleados').doc(employeeId).get();
      const empUid = empSnap.exists ? (empSnap.data()?.uid as string | undefined) : undefined;
      if (empUid) {
        tokenRows = await collectTokens(db, empUid, employeeId);
      }
    }
    const tokens = tokenRows.map((r) => r.token);

    const convocatoriaId = String(data.convocatoriaId || '').trim();
    const auditPush = type === 'CONVOCATORIA_COBERTURA' && !!convocatoriaId;

    if (tokens.length === 0) {
      console.warn(
        `[onEmployeeNotificationCreated] Sin tokens FCM type=${type} emp=${employeeId} uid=${uid}`,
      );
      await snap.ref.set(
        { fcmSent: false, fcmSkipReason: 'no_tokens', fcmCheckedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      if (auditPush) {
        await logConvocatoriaEvento(db, convocatoriaId, { type: 'PUSH', result: 'no_token' });
      }
      return;
    }

    const link =
      type === 'CONVOCATORIA_EVENTO' || type === 'EVENTO_CONFIRMADO' || type === 'EVENTO_CUPO_COMPLETO'
        ? '/eventos'
        : type === 'SWAP_REQUEST'
          ? '/permutas'
          : type === 'VACANTE_PLANIFICACION'
            ? '/admin/planificacion'
            : type === 'VACANTE_OPERACIONES'
              ? '/admin/operaciones'
              : type === 'CONVOCATORIA_COBERTURA'
                ? '/app/'
                : type === 'DEVICE_REGISTRATION_REJECTED' || type === 'DEVICE_REGISTRATION_APPROVED'
                  ? '/app/device-blocked'
                  : '/app/'; // SOLICITUD_ESTADO_LLEGADA, SOLICITUD_ESTADO_RELEVO, RELEVO, TURNO_FINALIZADO

    const shiftAlert = isShiftAlertFcmType(type);
    // Alertas de turno: un envío por canal (v2 solo a binarios que lo tienen).
    const groups: Array<{ channel: string | null; tokens: string[] }> = shiftAlert
      ? [...groupTokensByShiftAlertChannel(tokenRows).entries()].map(([channel, list]) => ({ channel, tokens: list }))
      : [{ channel: null, tokens }];
    try {
      const sentTokens: string[] = [];
      const responses: Array<{ success: boolean; error?: { code?: string } }> = [];
      let successCount = 0;
      let failureCount = 0;
      for (const group of groups) {
        const platform = group.channel ? shiftAlertPlatformConfig(group.channel) : null;
        const partial = await admin.messaging().sendEachForMulticast({
          notification: { title, body },
          data: {
            type,
            title,
            body,
            link,
            notificationId: snap.id,
            eventoId: data.eventoId ? String(data.eventoId) : '',
            solicitudId: data.solicitudId ? String(data.solicitudId) : '',
            servicioId: data.servicioId ? String(data.servicioId) : '',
            contratoId: data.contratoId ? String(data.contratoId) : '',
            convocatoriaId: data.convocatoriaId ? String(data.convocatoriaId) : '',
          },
          android: platform?.android ?? {
            priority: 'high',
            notification: { channelId: 'default' },
          },
          ...(platform ? { apns: platform.apns } : {}),
          webpush: {
            headers: shiftAlert ? { Urgency: 'high' } : undefined,
            notification: { title, body, icon: '/icons/icon-192x192.png', requireInteraction: true },
            fcmOptions: { link },
          },
          tokens: group.tokens,
        });
        sentTokens.push(...group.tokens);
        responses.push(...partial.responses);
        successCount += partial.successCount;
        failureCount += partial.failureCount;
      }
      const result = { successCount, failureCount, responses };

      console.log(
        `[onEmployeeNotificationCreated] ${type} success=${result.successCount} fail=${result.failureCount}`,
      );

      const invalid: string[] = [];
      result.responses.forEach((r, i) => {
        if (
          !r.success &&
          (r.error?.code === 'messaging/registration-token-not-registered' ||
            r.error?.code === 'messaging/invalid-registration-token')
        ) {
          invalid.push(sentTokens[i]);
        }
      });
      if (auditPush) {
        for (let i = 0; i < result.responses.length; i++) {
          const r = result.responses[i];
          const token = sentTokens[i] || '';
          await logConvocatoriaEvento(db, convocatoriaId, {
            type: 'PUSH',
            tokenSuffix: token.slice(-6),
            result: r.success ? 'sent' : 'failed',
            ...(r.error?.code ? { errorCode: r.error.code } : {}),
          });
        }
      }

      if (invalid.length > 0) {
        const cleanSnap = await db.collection('device_tokens').where('token', 'in', invalid.slice(0, 10)).get();
        const batch = db.batch();
        cleanSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      await snap.ref.set(
        {
          fcmSent: result.successCount > 0,
          fcmSuccessCount: result.successCount,
          fcmFailureCount: result.failureCount,
          fcmSentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn('[onEmployeeNotificationCreated] FCM error:', (e as Error)?.message);
      await snap.ref.set(
        {
          fcmSent: false,
          fcmSkipReason: (e as Error)?.message || 'fcm_error',
          fcmCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });
