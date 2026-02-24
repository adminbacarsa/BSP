"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvrAlertV2 = void 0;
const admin = require("firebase-admin");
const Busboy = require("busboy");
const crypto_1 = require("crypto");
const date_fns_1 = require("date-fns");
const https_1 = require("firebase-functions/v2/https");
const schedule_1 = require("./schedule");
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
function getHeader(req, name) {
    const v = req.headers[name.toLowerCase()] ?? req.get?.(name);
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
}
function pickFirst(fields, keys) {
    for (const k of keys) {
        const v = fields[k];
        if (typeof v === 'string' && v.trim())
            return v.trim();
    }
    return null;
}
function safeNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v)))
        return Number(v);
    return null;
}
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
function toHeaderString(v) {
    return Array.isArray(v) ? v[0] ?? '' : (v ?? '');
}
function headersForBusboy(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined)
            out[k] = toHeaderString(v);
    }
    return out;
}
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const contentType = toHeaderString(req.headers['content-type']);
        if (!contentType || !contentType.includes('multipart/form-data')) {
            reject(new Error('content-type inválido (se espera multipart/form-data)'));
            return;
        }
        readRawBody(req)
            .then((rawBody) => {
            const busboy = Busboy({
                headers: headersForBusboy(req.headers),
                limits: { files: 1, fileSize: 10 * 1024 * 1024 },
            });
            const fields = {};
            const fileChunks = [];
            let fileMeta = null;
            busboy.on('field', (name, val) => {
                if (typeof name === 'string' && name)
                    fields[name] = String(val ?? '');
            });
            busboy.on('file', (_name, file, info) => {
                const filename = info?.filename || 'snapshot.jpg';
                const mimeType = info?.mimeType || 'application/octet-stream';
                fileMeta = { filename, mimeType };
                file.on('data', (d) => fileChunks.push(d));
                file.on('limit', () => reject(new Error('Archivo demasiado grande (limit 10MB)')));
            });
            busboy.on('error', (e) => reject(e));
            busboy.on('finish', () => {
                const parsed = { fields };
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
let cachedSecret = { value: null, fetchedAtMs: 0 };
async function getExpectedSecretFromFirestore() {
    ensureAdmin();
    const now = Date.now();
    const ttlMs = 60_000;
    if (now - cachedSecret.fetchedAtMs < ttlMs)
        return cachedSecret.value;
    try {
        const snap = await admin.firestore().doc('nvr_config/webhook').get();
        const secret = snap.exists && typeof snap.data()?.secret === 'string' ? String(snap.data()?.secret).trim() : '';
        cachedSecret = { value: secret || null, fetchedAtMs: now };
        return cachedSecret.value;
    }
    catch (e) {
        console.error('[NVR_SECRET_READ_ERROR]', e?.message || e);
        cachedSecret = { value: null, fetchedAtMs: now };
        return null;
    }
}
async function validateSecret(req) {
    const expected = await getExpectedSecretFromFirestore();
    if (!expected)
        return;
    const qKey = req.query?.key;
    const received = (typeof qKey === 'string' ? qKey : Array.isArray(qKey) ? qKey[0] : null) ||
        getHeader(req, 'x-webhook-secret') ||
        getHeader(req, 'x-nvr-secret');
    if (!received || received !== expected) {
        throw new https_1.HttpsError('permission-denied', 'Webhook secret inválido.');
    }
}
function buildRouteKey(nvrId, channelId) {
    if (channelId == null || Number.isNaN(channelId))
        return null;
    const safeNvr = nvrId && nvrId.trim() ? nvrId.trim() : 'default';
    return `${safeNvr}__${channelId}`;
}
async function resolveRoute(routeKey) {
    ensureAdmin();
    if (!routeKey)
        return null;
    const doc = await admin.firestore().collection('camera_routes').doc(routeKey).get();
    if (!doc.exists)
        return null;
    const data = doc.data() || {};
    if (data.enabled === false)
        return { disabled: true, data };
    return { disabled: false, data };
}
exports.nvrAlertV2 = (0, https_1.onRequest)({ timeoutSeconds: 120, memory: '512MiB' }, async (req, res) => {
    const contentType = (Array.isArray(req.headers['content-type']) ? req.headers['content-type'][0] : req.headers['content-type']) || '';
    const queryKey = req.query?.key != null;
    console.log('[NVR_ALERT] Request received', { method: req.method, contentType: contentType.slice(0, 50), queryKey });
    try {
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
        const channelId = safeNumber(fields.channel_id) ??
            safeNumber(fields.channelId) ??
            safeNumber(fields.Channel) ??
            safeNumber(fields.channel) ??
            null;
        const cameraName = pickFirst(fields, ['camera_name', 'cameraName', 'CameraName', 'camera', 'Camera']) || '';
        const eventType = pickFirst(fields, ['event_type', 'eventType', 'EventType', 'event', 'Event']) || '';
        const objectTypeRaw = pickFirst(fields, ['object_type', 'objectType', 'ObjectType', 'object', 'Object']) || '';
        const objectType = objectTypeRaw.toLowerCase().includes('vehicle')
            ? 'vehicle'
            : objectTypeRaw.toLowerCase().includes('human')
                ? 'human'
                : objectTypeRaw.toLowerCase().includes('person')
                    ? 'human'
                    : '';
        const qNvrId = req.query?.nvrId;
        const qNvrIdAlt = req.query?.nvr_id;
        const nvrId = (typeof qNvrId === 'string' ? qNvrId : Array.isArray(qNvrId) ? qNvrId[0] : null) ||
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
        const db = admin.firestore();
        if (routeKey && !route) {
            const cameraNameFromRequest = pickFirst(fields, ['camera_name', 'cameraName', 'CameraName', 'camera', 'Camera']) || '';
            await db.collection('camera_routes').doc(routeKey).set({
                enabled: true,
                camera_name: cameraNameFromRequest || `NVR ${routeKey}`,
                event_type: eventType || 'Tripwire',
                objective_id: null,
                post_id: null,
                created_from_alert: true,
                first_seen_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            route = await resolveRoute(routeKey);
        }
        if (route?.disabled) {
            res.status(200).send('OK (route disabled)');
            return;
        }
        if (route?.data && !(0, schedule_1.isWithinSchedule)(route.data)) {
            console.log('[NVR_ALERT] Fuera de horario de atención, no se crea alerta.', { routeKey });
            res.status(200).json({ ok: true, skipped: 'outside_schedule' });
            return;
        }
        const routeData = route?.data || {};
        const objectiveId = typeof routeData.objective_id === 'string' ? routeData.objective_id : null;
        const postId = typeof routeData.post_id === 'string' ? routeData.post_id : null;
        const alertRef = db.collection('alerts').doc();
        const alertId = alertRef.id;
        const dayFolder = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd');
        const storagePath = `alerts/${dayFolder}/${alertId}.jpg`;
        const bucket = admin.storage().bucket();
        const token = (0, crypto_1.randomUUID)();
        await bucket.file(storagePath).save(parsed.file.buffer, {
            resumable: false,
            contentType: parsed.file.mimeType || 'image/jpeg',
            metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
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
    }
    catch (e) {
        const err = e;
        const msg = err?.message || 'Error';
        const code = String(err?.code || '');
        console.error('[NVR_ALERT_ERROR]', { code, msg, stack: err?.stack });
        if (err instanceof https_1.HttpsError) {
            res.status(err.httpErrorCode?.status || 403).send(err.message);
        }
        else {
            res.status(code === 'permission-denied' ? 403 : 500).send(msg);
        }
    }
});
//# sourceMappingURL=nvrAlert.js.map