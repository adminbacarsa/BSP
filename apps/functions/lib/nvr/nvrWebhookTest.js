"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvrWebhookTest = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
function readRawBody(req, maxWaitMs = 8000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let settled = false;
        const finish = (buf) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(t);
            resolve(buf);
        };
        const t = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            resolve(Buffer.concat(chunks));
        }, maxWaitMs);
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => finish(Buffer.concat(chunks)));
        req.on('error', (e) => {
            if (!settled) {
                settled = true;
                clearTimeout(t);
                reject(e);
            }
        });
    });
}
exports.nvrWebhookTest = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .https.onRequest(async (req, res) => {
    const method = req.method || 'UNKNOWN';
    const contentType = (req.headers['content-type'] || '').slice(0, 100);
    const contentLength = req.headers['content-length'] || '';
    const query = req.query;
    const queryKeys = Object.keys(query);
    let bodyLength = 0;
    let bodyPreview = '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        try {
            const raw = await readRawBody(req);
            bodyLength = raw.length;
            if (raw.length > 0) {
                const preview = raw.slice(0, 200);
                bodyPreview = preview.toString('utf8').replace(/[^\x20-\x7E]/g, '.') || '(binario)';
            }
        }
        catch (e) {
            bodyPreview = `(error leyendo body: ${e?.message})`;
        }
    }
    const logPayload = {
        method,
        contentType,
        contentLengthHeader: contentLength,
        bodyLength,
        bodyPreview: bodyPreview.slice(0, 150),
        queryKeys,
        hasKey: !!query.key,
        url: req.url?.slice(0, 120),
    };
    console.log('[NVR_WEBHOOK_TEST] Request received:', JSON.stringify(logPayload, null, 2));
    try {
        ensureAdmin();
        await admin.firestore().collection('nvr_webhook_test_logs').add({
            at: admin.firestore.FieldValue.serverTimestamp(),
            method: logPayload.method,
            contentType: logPayload.contentType,
            contentLengthHeader: logPayload.contentLengthHeader,
            bodyLength: logPayload.bodyLength,
            bodyPreview: logPayload.bodyPreview,
            queryKeys: logPayload.queryKeys,
            hasKey: logPayload.hasKey,
            url: logPayload.url,
        });
    }
    catch (e) {
        console.error('[NVR_WEBHOOK_TEST] Error writing to Firestore:', e?.message);
    }
    res.status(200).json({
        ok: true,
        message: 'API de diagnóstico NVR: petición recibida correctamente.',
        received: {
            method,
            bodyLength,
            contentType: contentType || '(no enviado)',
            queryParams: queryKeys.length,
        },
    });
});
//# sourceMappingURL=nvrWebhookTest.js.map