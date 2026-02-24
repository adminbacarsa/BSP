import * as admin from 'firebase-admin';
import Busboy = require('busboy');
import { randomUUID } from 'crypto';
import { format } from 'date-fns';
import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { isWithinSchedule } from './schedule';

// Compatible con Express Request (v2) y con query tipo ParsedQs
type RequestLike = { method?: string; headers: Record<string, string | string[] | undefined>; query: Record<string, unknown>; on(event: string, cb: (...args: any[]) => void): void };

type ParsedMultipart = {
  fields: Record<string, string>;
  file?: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
};

function ensureAdmin() {
  if (!admin.apps.length) admin.initializeApp();
}

function getHeader(req: RequestLike, name: string): string | null {
  const v = req.headers[name.toLowerCase()] ?? (req as any).get?.(name);
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

function pickFirst(fields: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function readRawBody(req: RequestLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toHeaderString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : (v ?? '');
}

function headersForBusboy(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) out[k] = toHeaderString(v);
  }
  return out;
}

function parseMultipart(req: RequestLike): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const contentType = toHeaderString(req.headers['content-type']);
    if (!contentType || !contentType.includes('multipart/form-data')) {
      reject(new Error('content-type inválido (se espera multipart/form-data)'));
      return;
    }

    readRawBody(req)
      .then((rawBody) => {
        const busboy = Busboy({
          headers: headersForBusboy(req.headers as Record<string, string | string[] | undefined>),
          limits: { files: 1, fileSize: 10 * 1024 * 1024 },
        });

        const fields: Record<string, string> = {};
        const fileChunks: Buffer[] = [];
        let fileMeta: { filename: string; mimeType: string } | null = null;

        busboy.on('field', (name, val) => {
          if (typeof name === 'string' && name) fields[name] = String(val ?? '');
        });

        busboy.on('file', (_name, file, info) => {
          const filename = info?.filename || 'snapshot.jpg';
          const mimeType = info?.mimeType || 'application/octet-stream';
          fileMeta = { filename, mimeType };

          file.on('data', (d: Buffer) => fileChunks.push(d));
          file.on('limit', () => reject(new Error('Archivo demasiado grande (limit 10MB)')));
        });

        busboy.on('error', (e) => reject(e));
        busboy.on('finish', () => {
          const parsed: ParsedMultipart = { fields };
          if (fileMeta) {
            parsed.file = {
              buffer: Buffer.concat(fileChunks),
              filename: fileMeta.filename,
              mimeType: fileMeta.mimeType,
            };
          }
          resolve(parsed);
        });

        busboy.write(rawBody);
        busboy.end();
      })
      .catch(reject);
  });
}

let cachedSecret: { value: string | null; fetchedAtMs: number } = { value: null, fetchedAtMs: 0 };

async function getExpectedSecretFromFirestore(): Promise<string | null> {
  ensureAdmin();
  const now = Date.now();
  const ttlMs = 60_000;
  if (now - cachedSecret.fetchedAtMs < ttlMs) return cachedSecret.value;

  try {
    const snap = await admin.firestore().doc('nvr_config/webhook').get();
    const secret =
      snap.exists && typeof snap.data()?.secret === 'string' ? String(snap.data()?.secret).trim() : '';
    cachedSecret = { value: secret || null, fetchedAtMs: now };
    return cachedSecret.value;
  } catch (e) {
    console.error('[NVR_SECRET_READ_ERROR]', (e as Error)?.message || e);
    cachedSecret = { value: null, fetchedAtMs: now };
    return null;
  }
}

async function validateSecret(req: RequestLike): Promise<void> {
  const expected = await getExpectedSecretFromFirestore();
  if (!expected) return;

  const qKey = req.query?.key as string | string[] | undefined;
  const received =
    (typeof qKey === 'string' ? qKey : Array.isArray(qKey) ? qKey[0] : null) ||
    getHeader(req, 'x-webhook-secret') ||
    getHeader(req, 'x-nvr-secret');

  if (!received || received !== expected) {
    throw new HttpsError('permission-denied', 'Webhook secret inválido.');
  }
}

function buildRouteKey(nvrId: string | null, channelId: number | null): string | null {
  if (channelId == null || Number.isNaN(channelId)) return null;
  const safeNvr = nvrId && nvrId.trim() ? nvrId.trim() : 'default';
  return `${safeNvr}__${channelId}`;
}

async function resolveRoute(routeKey: string | null) {
  ensureAdmin();
  if (!routeKey) return null;
  const doc = await admin.firestore().collection('camera_routes').doc(routeKey).get();
  if (!doc.exists) return null;
  const data = doc.data() || {};
  if (data.enabled === false) return { disabled: true, data };
  return { disabled: false, data };
}

// 2nd gen: función nueva con otro nombre para evitar upgrade in-place (la URL del webhook cambia a nvrAlertV2)
export const nvrAlertV2 = onRequest(
  { timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    const contentType = (Array.isArray(req.headers['content-type']) ? req.headers['content-type'][0] : req.headers['content-type']) || '';
    const queryKey = req.query?.key != null;
    console.log('[NVR_ALERT] Request received', { method: req.method, contentType: contentType.slice(0, 50), queryKey });
    try {
      // Prueba de conexión: GET devuelve 200 para que el NVR no marque "fallido" al testear la URL
      if (req.method === 'GET') {
        console.log('[NVR_ALERT] GET (prueba de conexión)');
        res.status(200).json({ ok: true, message: 'Webhook NVR activo. Enviar POST con multipart/form-data e imagen para alertas.' });
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      await validateSecret(req);
      ensureAdmin();

      const parsed = await parseMultipart(req);
      if (!parsed.file || !parsed.file.buffer?.length) {
        console.log('[NVR_ALERT] Rejected: no file in multipart. Fields:', Object.keys(parsed.fields));
        res.status(400).send('Falta archivo (snapshot) en multipart.');
        return;
      }

      const fields = parsed.fields;

      const channelId =
        safeNumber(fields.channel_id) ??
        safeNumber(fields.channelId) ??
        safeNumber(fields.Channel) ??
        safeNumber(fields.channel) ??
        null;

      const cameraName = pickFirst(fields, ['camera_name', 'cameraName', 'CameraName', 'camera', 'Camera']) || '';
      const eventType = pickFirst(fields, ['event_type', 'eventType', 'EventType', 'event', 'Event']) || '';
      const objectTypeRaw = pickFirst(fields, ['object_type', 'objectType', 'ObjectType', 'object', 'Object']) || '';

      const objectType =
        objectTypeRaw.toLowerCase().includes('vehicle')
          ? 'vehicle'
          : objectTypeRaw.toLowerCase().includes('human')
            ? 'human'
            : objectTypeRaw.toLowerCase().includes('person')
              ? 'human'
              : ('' as 'human' | 'vehicle' | '');

      const qNvrId = req.query?.nvrId as string | string[] | undefined;
      const qNvrIdAlt = req.query?.nvr_id as string | string[] | undefined;
      const nvrId =
        (typeof qNvrId === 'string' ? qNvrId : Array.isArray(qNvrId) ? qNvrId[0] : null) ||
        (typeof qNvrIdAlt === 'string' ? qNvrIdAlt : Array.isArray(qNvrIdAlt) ? qNvrIdAlt[0] : null) ||
        getHeader(req, 'x-nvr-id') ||
        pickFirst(fields, [
          'nvr_id',
          'nvrId',
          'NVR',
          'DeviceID',
          'deviceId',
          'device_id',
          'SerialNumber',
          'serialNumber',
        ]);

      const routeKey = buildRouteKey(nvrId, channelId);
      let route = await resolveRoute(routeKey);

      // Si no existe camera_route para este NVR/canal, crearlo para que aparezca en Firestore y se pueda asignar cliente/objetivo
      const db = admin.firestore();
      if (routeKey && !route) {
        const cameraNameFromRequest = pickFirst(fields, ['camera_name', 'cameraName', 'CameraName', 'camera', 'Camera']) || '';
        await db.collection('camera_routes').doc(routeKey).set(
          {
            enabled: true,
            camera_name: cameraNameFromRequest || `NVR ${routeKey}`,
            event_type: eventType || 'Tripwire',
            objective_id: null,
            post_id: null,
            created_from_alert: true,
            first_seen_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        route = await resolveRoute(routeKey);
      }

      if (route?.disabled) {
        res.status(200).send('OK (route disabled)');
        return;
      }

      if (route?.data && !isWithinSchedule(route.data as import('./schedule').ScheduleRouteData)) {
        console.log('[NVR_ALERT] Fuera de horario de atención, no se crea alerta.', { routeKey });
        res.status(200).json({ ok: true, skipped: 'outside_schedule' });
        return;
      }

      const routeData = route?.data || {};
      const objectiveId = typeof routeData.objective_id === 'string' ? routeData.objective_id : null;
      const postId = typeof routeData.post_id === 'string' ? routeData.post_id : null;
      const alertRef = db.collection('alerts').doc();
      const alertId = alertRef.id;

      const dayFolder = format(new Date(), 'yyyy-MM-dd');
      const storagePath = `alerts/${dayFolder}/${alertId}.jpg`;

      const bucket = admin.storage().bucket();
      const token = randomUUID();
      await bucket.file(storagePath).save(parsed.file.buffer, {
        resumable: false,
        contentType: parsed.file.mimeType || 'image/jpeg',
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });

      const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
        storagePath
      )}?alt=media&token=${token}`;

      await alertRef.set({
        id: alertId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        camera_name: cameraName || routeData.camera_name || '',
        channel_id: channelId ?? null,
        event_type: eventType || routeData.event_type || '',
        object_type: objectType || null,
        image_url: imageUrl,
        status: 'pending',
        assigned_guard: null,
        resolution_time: 0,
        guard_notes: '',
        objective_id: objectiveId,
        post_id: postId,
        route_key: routeKey,
        raw_fields: fields,
      });

      res.status(200).json({ ok: true, alertId });
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string; stack?: string };
      const msg = err?.message || 'Error';
      const code = String(err?.code || '');
      console.error('[NVR_ALERT_ERROR]', { code, msg, stack: err?.stack });
      if (err instanceof HttpsError) {
        res.status(err.httpErrorCode?.status || 403).send(err.message);
      } else {
        res.status(code === 'permission-denied' ? 403 : 500).send(msg);
      }
    }
  }
);
