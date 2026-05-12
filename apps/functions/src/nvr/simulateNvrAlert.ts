import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { format } from 'date-fns';

const ALLOWED_ROLES = ['admin', 'SuperAdmin', 'Operator', 'Operador', 'Director', 'Auditor', 'Scheduler'];

function ensureAdmin() {
  if (!admin.apps.length) admin.initializeApp();
}

/**
 * Callable: simula una alerta NVR desde la plataforma (formulario de pruebas).
 * Solo operadores/admins. Crea doc en alerts + sube imagen a Storage; onAlertCreated envía FCM.
 */
export const simulateNvrAlert = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const role = (context.auth.token as { role?: string })?.role;
    if (!role || !ALLOWED_ROLES.includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Solo operadores o administradores pueden simular alertas.');
    }

    ensureAdmin();
    const imageBase64 = typeof data?.imageBase64 === 'string' ? data.imageBase64 : '';
    if (!imageBase64) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta imagen (imageBase64).');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(imageBase64, 'base64');
    } catch {
      throw new functions.https.HttpsError('invalid-argument', 'Imagen no válida (base64).');
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw new functions.https.HttpsError('invalid-argument', 'Imagen demasiado grande (máx 10MB).');
    }

    const channelId = typeof data?.channel_id === 'number' ? data.channel_id : Number(data?.channel_id) || 2;
    const cameraName = typeof data?.camera_name === 'string' ? data.camera_name : 'Prueba desde plataforma';
    const eventType = typeof data?.event_type === 'string' ? data.event_type : 'Tripwire';
    const objectType = typeof data?.object_type === 'string' ? data.object_type : 'human';

    let objectiveId: string | null = typeof data?.objective_id === 'string' && data.objective_id.trim() ? data.objective_id.trim() : null;
    let postId: string | null = typeof data?.post_id === 'string' && data.post_id.trim() ? data.post_id.trim() : null;
    let routeKey = `default__${channelId}`;

    if (!objectiveId) {
      const routeSnap = await admin.firestore().collection('camera_routes').doc(routeKey).get();
      const routeData = routeSnap.exists ? routeSnap.data() || {} : {};
      objectiveId = typeof routeData.objective_id === 'string' ? routeData.objective_id : null;
      postId = typeof routeData.post_id === 'string' ? routeData.post_id : null;
    } else {
      routeKey = `simulated_${objectiveId}`;
    }

    const db = admin.firestore();
    const alertRef = db.collection('alerts').doc();
    const alertId = alertRef.id;

    const dayFolder = format(new Date(), 'yyyy-MM-dd');
    const storagePath = `alerts/${dayFolder}/${alertId}.jpg`;

    const bucket = admin.storage().bucket();
    const token = randomUUID();
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      storagePath
    )}?alt=media&token=${token}`;

    await alertRef.set({
      id: alertId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      camera_name: cameraName,
      channel_id: channelId,
      event_type: eventType,
      object_type: objectType || null,
      image_url: imageUrl,
      status: 'pending',
      assigned_guard: null,
      resolution_time: 0,
      guard_notes: '',
      objective_id: objectiveId,
      post_id: postId,
      route_key: routeKey,
      simulated: true,
      simulated_by: context.auth.uid,
    });

    return { ok: true, alertId };
  });
