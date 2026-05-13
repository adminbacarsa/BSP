"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
exports.generateApiKey = generateApiKey;
const admin = require("firebase-admin");
const crypto = require("crypto");
const INTEGRATIONS_COLLECTION = 'integraciones_api';
const hashApiKey = (apiKey, salt) => {
    return crypto.createHash('sha256').update(`${salt}:${apiKey}`).digest('hex');
};
const sendError = (res, status, code, message) => {
    res.status(status).json({ error: { code, message } });
};
const clientIp = (req) => {
    const xff = (req.headers['x-forwarded-for'] || '');
    if (xff)
        return xff.split(',')[0].trim();
    return (req.ip || '').trim();
};
async function requireApiKey(req, res, requiredScope) {
    const apiKey = (req.header('X-API-Key') || req.header('x-api-key') || '').trim();
    if (!apiKey) {
        sendError(res, 401, 'missing_api_key', 'Falta header X-API-Key.');
        return false;
    }
    const db = admin.firestore();
    const snap = await db
        .collection(INTEGRATIONS_COLLECTION)
        .where('status', '==', 'ACTIVE')
        .where('apiKeyPrefix', '==', apiKey.slice(0, 8))
        .limit(5)
        .get();
    let match = null;
    for (const doc of snap.docs) {
        const data = doc.data();
        const salt = String(data.apiKeySalt || '');
        const expected = String(data.apiKeyHash || '');
        if (!salt || !expected)
            continue;
        const actual = hashApiKey(apiKey, salt);
        if (crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
            match = doc;
            break;
        }
    }
    if (!match) {
        sendError(res, 401, 'invalid_api_key', 'API Key inválida o revocada.');
        return false;
    }
    const data = match.data();
    const integration = {
        id: match.id,
        name: data.name || match.id,
        empresaId: data.empresaId || 'bacarsa',
        scopes: Array.isArray(data.scopes) ? data.scopes : [],
        status: data.status || 'ACTIVE',
        apiKeyPrefix: data.apiKeyPrefix,
        ipAllowlist: Array.isArray(data.ipAllowlist) ? data.ipAllowlist : undefined,
    };
    if (integration.ipAllowlist && integration.ipAllowlist.length > 0) {
        const ip = clientIp(req);
        if (!integration.ipAllowlist.includes(ip)) {
            sendError(res, 403, 'ip_not_allowed', `IP ${ip} no permitida para esta integración.`);
            return false;
        }
    }
    if (!integration.scopes.includes(requiredScope) && !integration.scopes.includes('*')) {
        sendError(res, 403, 'missing_scope', `Esta API Key no tiene el scope ${requiredScope}.`);
        return false;
    }
    req.integration = integration;
    match.ref
        .update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(() => undefined);
    db.collection('audit_logs')
        .add({
        module: 'PAYROLL_API',
        action: 'API_HIT',
        actorName: `integraciones_api/${integration.id}`,
        actorUid: 'API_KEY',
        details: `${req.method} ${req.path}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        empresaId: integration.empresaId,
        ip: clientIp(req) || null,
    })
        .catch(() => undefined);
    return true;
}
function generateApiKey() {
    const apiKey = `csp_${crypto.randomBytes(28).toString('base64url')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashApiKey(apiKey, salt);
    return { apiKey, salt, hash, prefix: apiKey.slice(0, 8) };
}
//# sourceMappingURL=auth.js.map