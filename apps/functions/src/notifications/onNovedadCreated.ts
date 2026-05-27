import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const ALERT_TYPES = [
  'INGRESO_AUTOREGISTRO',
  'AUSENCIA_DETECTADA',
  'RETENCION_DETECTADA',
  'VACANTE_AUTO_REPORTADA',
  'VACANTE_NO_CUBIERTA',
  'AUSENCIA_CORTO_PLAZO',
  'AVISO_AUSENCIA_ANTICIPADA',
];

const TYPE_LABELS: Record<string, string> = {
  INGRESO_AUTOREGISTRO:      '⚡ Ingreso por Portal',
  AUSENCIA_DETECTADA:        '⚠️ Ausencia Detectada',
  RETENCION_DETECTADA:       '⏰ Guardia en Recargo',
  VACANTE_AUTO_REPORTADA:    '🔴 Vacante Reportada',
  VACANTE_NO_CUBIERTA:       '🔴 Vacante Devuelta',
  AUSENCIA_CORTO_PLAZO:      '🚨 Ausencia Urgente — menos de 4hs',
  AVISO_AUSENCIA_ANTICIPADA: '⚠️ Aviso Anticipado de Ausencia',
};

export const onNovedadCreated = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .firestore.document('novedades/{novedadId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    if (!ALERT_TYPES.includes(data?.type)) return;

    const db = admin.firestore();
    const empresaId: string | null = data?.empresaId || null;

    // ── Resolver tokens destinatarios ────────────────────────────────────────
    // Prioridad 1: operador con sesión activa para esta empresa
    // Prioridad 2: todos los tokens de admins de esta empresa
    // En ambos casos se filtra por role === 'admin' para nunca llegar a empleados.

    let tokenDocs: admin.firestore.QueryDocumentSnapshot[] = [];

    if (empresaId) {
      // Buscar sesión de operador activa
      const sessionSnap = await db.collection('sesiones_operador')
        .where('empresaId', '==', empresaId)
        .where('status', '==', 'ACTIVO')
        .limit(1)
        .get();

      if (!sessionSnap.empty) {
        const operatorId = sessionSnap.docs[0].data()?.operatorId as string;
        const opTokensSnap = await db.collection('device_tokens')
          .where('uid', '==', operatorId)
          .get();
        // Aunque la sesión exista, solo usar tokens con role admin (no mezclar con empleado)
        tokenDocs = opTokensSnap.docs.filter(d => d.data().role === 'admin');
      }

      // Si no hay sesión activa (o el operador no tiene token admin), usar todos los admins de la empresa
      if (tokenDocs.length === 0) {
        const allSnap = await db.collection('device_tokens')
          .where('empresaId', '==', empresaId)
          .get();
        tokenDocs = allSnap.docs.filter(d => d.data().role === 'admin');
      }
    }

    const tokens = tokenDocs
      .map(d => d.data()?.token)
      .filter((t): t is string => typeof t === 'string' && t.length > 10);

    const title = TYPE_LABELS[data.type] || 'Alerta Operativa';
    const body  = data.description || data.title || 'Nueva novedad';

    // ── Guardar en user_notifications para cada admin destinatario ───────────
    const now = admin.firestore.FieldValue.serverTimestamp();
    const adminUids = [...new Set(tokenDocs.map(d => d.data().uid as string).filter(Boolean))];
    await Promise.all(adminUids.map(uid =>
      db.collection('user_notifications').add({
        uid,
        title,
        body,
        type: data.type,
        novedadId: snap.id,
        empresaId: empresaId || null,
        read: false,
        readAt: null,
        createdAt: now,
      })
    ));

    if (!tokens.length) {
      console.warn('[onNovedadCreated] No admin tokens for empresa:', empresaId);
      return;
    }

    // ── Enviar FCM ────────────────────────────────────────────────────────────
    const message: admin.messaging.MulticastMessage = {
      notification: { title, body },
      data: {
        novedadId: snap.id,
        type: data.type,
        objectiveName: data.objectiveName || '',
        click_action: 'OPERACIONES_ALERT',
        link: '/admin/operaciones',
      },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/badge-72x72.png',
          requireInteraction: true,
        },
        fcmOptions: { link: '/admin/operaciones' },
      },
      tokens,
    };

    try {
      const result = await admin.messaging().sendEachForMulticast(message);
      await snap.ref.update({
        fcmSent: result.successCount > 0,
        fcmSuccessCount: result.successCount,
        fcmFailureCount: result.failureCount,
      });

      // Limpiar tokens inválidos
      const invalidTokens: string[] = [];
      result.responses.forEach((r, i) => {
        if (!r.success && (
          r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token'
        )) {
          invalidTokens.push(tokens[i]);
        }
      });
      if (invalidTokens.length > 0) {
        const cleanSnap = await db.collection('device_tokens')
          .where('token', 'in', invalidTokens).get();
        const batch = db.batch();
        cleanSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      console.error('[onNovedadCreated] FCM error:', (e as Error)?.message);
    }
  });
