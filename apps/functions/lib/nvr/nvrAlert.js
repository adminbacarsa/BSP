"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvrAlert = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Busboy = require("busboy");
const crypto_1 = require("crypto");
const date_fns_1 = require("date-fns");
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
function getHeader(req, name) {
    const v = req.header(name);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
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
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            reject(new Error('content-type inválido (se espera multipart/form-data)'));
            return;
        }
        readRawBody(req)
            .then((rawBody) => {
            const busboy = Busboy({
                headers: req.headers,
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
    const received = (typeof req.query.key === 'string' ? req.query.key : null) ||
        getHeader(req, 'x-webhook-secret') ||
        getHeader(req, 'x-nvr-secret');
    if (!received || received !== expected) {
        throw new functions.https.HttpsError('permission-denied', 'Webhook secret inválido.');
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
exports.nvrAlert = functions
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onRequest(async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        await validateSecret(req);
        ensureAdmin();
        const parsed = await parseMultipart(req);
        if (!parsed.file || !parsed.file.buffer?.length) {
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
        const nvrId = (typeof req.query.nvrId === 'string' ? req.query.nvrId : null) ||
            (typeof req.query.nvr_id === 'string' ? req.query.nvr_id : null) ||
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
        const route = await resolveRoute(routeKey);
        if (route?.disabled) {
            res.status(200).send('OK (route disabled)');
            return;
        }
        const routeData = route?.data || {};
        const objectiveId = typeof routeData.objective_id === 'string' ? routeData.objective_id : null;
        const postId = typeof routeData.post_id === 'string' ? routeData.post_id : null;
        const db = admin.firestore();
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
        const code = err?.code || '';
        console.error('[NVR_ALERT_ERROR]', { code, msg, stack: err?.stack });
        res.status(code === 'permission-denied' ? 403 : 500).send(msg);
    }
});
//# sourceMappingURL=nvrAlert.js.map