"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvrAlertV2 = void 0;
const admin = require("firebase-admin");
const Busboy = require("busboy");
const crypto_1 = require("crypto");
const date_fns_1 = require("date-fns");
const https_1 = require("firebase-functions/v2/https");
const schedule_1 = require("./schedule");
const ALERT_COOLDOWN_SECONDS = 90;
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
const BODY_READ_TIMEOUT_MS = 90000;
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let timeoutId = null;
        const finish = (err) => {
            if (timeoutId)
                clearTimeout(timeoutId);
            if (err)
                reject(err);
            else
                resolve(Buffer.concat(chunks));
        };
        timeoutId = setTimeout(() => {
            timeoutId = null;
            reject(new Error('Timeout leyendo body (90s)'));
        }, BODY_READ_TIMEOUT_MS);
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => finish());
        req.on('error', (e) => finish(e));
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
function getBoundary(contentType) {
    const m = contentType.match(/\bboundary\s*=\s*["']?([^"'\s;]+)["']?/i);
    return m ? m[1].trim() : null;
}
function looksLikeJpeg(buf) {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
function extractJpegFromBuffer(buf, boundaryStr) {
    const delim = Buffer.from('--' + boundaryStr, 'utf8');
    for (let i = 0; i < buf.length - 2; i++) {
        if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
            const next = buf.indexOf(delim, i);
            const end = next >= 0 ? next : buf.length;
            const chunk = buf.subarray(i, end);
            if (chunk.length > 100 && chunk.length <= 10 * 1024 * 1024)
                return chunk;
            return null;
        }
    }
    return null;
}
function parseMixedReplace(rawBody, contentType) {
    const boundary = getBoundary(contentType);
    if (!boundary)
        throw new Error('multipart sin boundary');
    const boundaryStr = boundary.replace(/^["']|["']$/g, '');
    const delim = Buffer.from('--' + boundaryStr, 'utf8');
    const delimEnd = Buffer.from('--' + boundaryStr + '--', 'utf8');
    let idx = rawBody.indexOf(delim);
    if (idx < 0)
        idx = rawBody.indexOf(Buffer.from('\r\n' + '--' + boundaryStr, 'utf8'));
    if (idx < 0)
        idx = rawBody.indexOf(Buffer.from('\n' + '--' + boundaryStr, 'utf8'));
    if (idx < 0) {
        const jpeg = extractJpegFromBuffer(rawBody, boundaryStr);
        if (jpeg)
            return { fields: {}, file: { buffer: jpeg, filename: 'snapshot.jpg', mimeType: 'image/jpeg' } };
        throw new Error('boundary no encontrado en body');
    }
    if (rawBody[idx] === 0x0d || rawBody[idx] === 0x0a)
        idx += rawBody[idx] === 0x0d && rawBody[idx + 1] === 0x0a ? 2 : 1;
    idx += delim.length;
    while (idx < rawBody.length && (rawBody[idx] === 0x0d || rawBody[idx] === 0x0a))
        idx++;
    const nextDelim = rawBody.indexOf(delim, idx);
    const endDelim = rawBody.indexOf(delimEnd, idx);
    const partEnd = nextDelim >= 0 ? nextDelim : endDelim >= 0 ? endDelim : rawBody.length;
    const part = rawBody.subarray(idx, partEnd);
    const dblCrlf = part.indexOf(Buffer.from('\r\n\r\n'));
    const dblLf = part.indexOf(Buffer.from('\n\n'));
    const headerEnd = dblCrlf >= 0 ? dblCrlf + 4 : dblLf >= 0 ? dblLf + 2 : -1;
    let body = headerEnd >= 0 ? part.subarray(headerEnd) : part;
    if (body[0] === 0x0d || body[0] === 0x0a)
        body = body.subarray(body[0] === 0x0d && body[1] === 0x0a ? 2 : 1);
    if (body.length > 10 * 1024 * 1024)
        throw new Error('Archivo demasiado grande (limit 10MB)');
    if (body.length < 100 || !looksLikeJpeg(body)) {
        const jpeg = extractJpegFromBuffer(part, boundaryStr);
        if (jpeg)
            return { fields: {}, file: { buffer: jpeg, filename: 'snapshot.jpg', mimeType: 'image/jpeg' } };
        throw new Error('Parte multipart demasiado pequeña o no es JPEG');
    }
    return {
        fields: {},
        file: { buffer: Buffer.from(body), filename: 'snapshot.jpg', mimeType: 'image/jpeg' },
    };
}
function parseRawJpeg(rawBody) {
    if (rawBody.length < 100 || rawBody.length > 10 * 1024 * 1024)
        return null;
    if (!looksLikeJpeg(rawBody))
        return null;
    return {
        fields: {},
        file: { buffer: Buffer.from(rawBody), filename: 'snapshot.jpg', mimeType: 'image/jpeg' },
    };
}
function parseMultipartFromBuffer(rawBody, contentType, headers) {
    return new Promise((resolve, reject) => {
        const rawJpeg = parseRawJpeg(rawBody);
        if (rawJpeg && (!contentType || !contentType.includes('multipart'))) {
            resolve(rawJpeg);
            return;
        }
        if (!contentType || !contentType.includes('multipart')) {
            reject(new Error('content-type inválido (se espera multipart o body JPEG)'));
            return;
        }
        if (contentType.includes('multipart/x-mixed-replace')) {
            try {
                resolve(parseMixedReplace(rawBody, contentType));
            }
            catch (e) {
                const boundary = getBoundary(contentType);
                const jpeg = boundary ? extractJpegFromBuffer(rawBody, boundary.replace(/^["']|["']$/g, '')) : null;
                if (jpeg)
                    resolve({ fields: {}, file: { buffer: jpeg, filename: 'snapshot.jpg', mimeType: 'image/jpeg' } });
                else if (rawJpeg)
                    resolve(rawJpeg);
                else
                    reject(e);
            }
            return;
        }
        if (!contentType.includes('multipart/form-data')) {
            if (rawJpeg)
                resolve(rawJpeg);
            else
                reject(new Error('content-type inválido'));
            return;
        }
        const busboy = Busboy({
            headers: headersForBusboy(headers),
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
    });
}
function parseMultipart(req) {
    const contentType = toHeaderString(req.headers['content-type']);
    return readRawBody(req).then((rawBody) => parseMultipartFromBuffer(rawBody, contentType, req.headers));
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
        const rawBody = typeof req.rawBody === 'object' && Buffer.isBuffer(req.rawBody)
            ? req.rawBody
            : await readRawBody(req);
        await validateSecret(req);
        ensureAdmin();
        const contentType = toHeaderString(req.headers['content-type']);
        console.log('[NVR_ALERT] Body recibido:', rawBody.length, 'bytes', 'Content-Type:', (contentType || '(vacío)').slice(0, 70));
        const parsed = await parseMultipartFromBuffer(rawBody, contentType, req.headers);
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
            safeNumber(fields.ChannelNo) ??
            safeNumber(fields.ChannelNumber) ??
            safeNumber(fields.ch) ??
            1;
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
        console.log('[NVR_ALERT] routeKey=', routeKey, 'channelId=', channelId, 'nvrId=', nvrId, 'fields keys=', Object.keys(fields).join(', '));
        let route = await resolveRoute(routeKey);
        const db = admin.firestore();
        if (routeKey && !route) {
            console.log('[NVR_ALERT] Creando camera_routes/', routeKey, '(primera vez para este NVR/canal)');
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
        const dayFolder = (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd');
        const bucket = admin.storage().bucket();
        const nowMs = Date.now();
        const cooldownMs = ALERT_COOLDOWN_SECONDS * 1000;
        const recentPending = await db
            .collection('alerts')
            .where('route_key', '==', routeKey)
            .where('status', '==', 'pending')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
        let existingAlertId = null;
        if (!recentPending.empty) {
            const lastDoc = recentPending.docs[0];
            const lastData = lastDoc.data();
            const lastTs = lastData?.timestamp?.toMillis?.() ?? (lastData?.timestamp?.seconds ?? 0) * 1000;
            if (nowMs - lastTs <= cooldownMs) {
                existingAlertId = lastDoc.id;
            }
        }
        if (existingAlertId) {
            const storagePathByRoute = `alerts/${dayFolder}/${routeKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
            const token = (0, crypto_1.randomUUID)();
            await bucket.file(storagePathByRoute).save(parsed.file.buffer, {
                resumable: false,
                contentType: parsed.file.mimeType || 'image/jpeg',
                metadata: { metadata: { firebaseStorageDownloadTokens: token } },
            });
            const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePathByRoute)}?alt=media&token=${token}`;
            await db.collection('alerts').doc(existingAlertId).update({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                image_url: imageUrl,
                camera_name: cameraName || routeData.camera_name || (await db.collection('alerts').doc(existingAlertId).get()).data()?.camera_name || '',
                event_type: eventType || routeData.event_type || '',
                object_type: objectType || null,
                raw_fields: fields,
            });
            console.log('[NVR_ALERT] Agrupado: actualizada alerta', existingAlertId, 'routeKey=', routeKey);
            res.status(200).json({ ok: true, alertId: existingAlertId, updated: true });
            return;
        }
        const alertRef = db.collection('alerts').doc();
        const alertId = alertRef.id;
        const storagePath = `alerts/${dayFolder}/${alertId}.jpg`;
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
        console.log('[NVR_ALERT] OK alertId=', alertId, 'routeKey=', routeKey);
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