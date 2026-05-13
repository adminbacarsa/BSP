/**
 * Middleware de autenticación para la API de liquidación.
 *
 * Modelo:
 *   - Cada integración externa (sistema de liquidación) tiene un documento en
 *     `integraciones_api/{id}` con la forma:
 *       {
 *         name: string,
 *         empresaId: string,            // multitenant
 *         scopes: string[],             // ej. ['payroll.read', 'payroll.close']
 *         apiKeyHash: string,           // sha256(apiKey + salt)
 *         apiKeySalt: string,
 *         apiKeyPrefix: string,         // primeros 8 chars de la apiKey, para identificar logs
 *         status: 'ACTIVE' | 'REVOKED',
 *         createdAt: Timestamp,
 *         createdBy: string,            // uid de admin que la creó
 *         ipAllowlist?: string[],       // opcional
 *         lastUsedAt?: Timestamp,
 *       }
 *
 *   - El cliente manda el header `X-API-Key: <apiKey>`.
 *   - Validamos: existe documento ACTIVE con hash coincidente.
 *   - El handler accede a `req.integration` con la info de la integración.
 *
 * NOTA: las API Keys NO se guardan en claro. Sólo se entrega la clave en el
 * momento de crearla (ver scripts/seed-payroll-api-key.js).
 */
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import type * as functions from 'firebase-functions';

type Request = functions.https.Request;
type Response = any;

export interface ApiIntegration {
    id: string;
    name: string;
    empresaId: string;
    scopes: string[];
    status: 'ACTIVE' | 'REVOKED';
    apiKeyPrefix?: string;
    ipAllowlist?: string[];
}

export interface AuthedRequest extends Request {
    integration?: ApiIntegration;
}

const INTEGRATIONS_COLLECTION = 'integraciones_api';

const hashApiKey = (apiKey: string, salt: string): string => {
    return crypto.createHash('sha256').update(`${salt}:${apiKey}`).digest('hex');
};

const sendError = (res: Response, status: number, code: string, message: string) => {
    res.status(status).json({ error: { code, message } });
};

const clientIp = (req: Request): string => {
    const xff = (req.headers['x-forwarded-for'] || '') as string;
    if (xff) return xff.split(',')[0].trim();
    return (req.ip || '').trim();
};

/**
 * Valida la API Key y popula `req.integration`. Si la key es inválida o el
 * scope requerido no está, responde 401/403 directamente.
 */
export async function requireApiKey(
    req: AuthedRequest,
    res: Response,
    requiredScope: string,
): Promise<boolean> {
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

    let match: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (const doc of snap.docs) {
        const data = doc.data();
        const salt = String(data.apiKeySalt || '');
        const expected = String(data.apiKeyHash || '');
        if (!salt || !expected) continue;
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
    const integration: ApiIntegration = {
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

    // Auditoría: registrar el hit. No bloqueante.
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

/**
 * Helper de uso interno (scripts): genera una API Key nueva y devuelve el doc
 * para guardarlo en `integraciones_api/{id}`. La clave en claro solo existe en
 * el retorno; el caller debe entregársela a la integración una sola vez.
 */
export function generateApiKey(): { apiKey: string; salt: string; hash: string; prefix: string } {
    const apiKey = `csp_${crypto.randomBytes(28).toString('base64url')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashApiKey(apiKey, salt);
    return { apiKey, salt, hash, prefix: apiKey.slice(0, 8) };
}
