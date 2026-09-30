"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arcaEnviosApi = void 0;
exports.aplicarTransicion = aplicarTransicion;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const arcaEnviosCore_1 = require("./arcaEnviosCore");
const altaArcaDenorm_1 = require("./altaArcaDenorm");
const ARCA_ROBOT_KEY = (0, params_1.defineSecret)('ARCA_ROBOT_KEY');
const COLL = 'arca_envios';
const MAX_PENDIENTES = 25;
function db() {
    return admin.firestore();
}
function clientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '');
    return fwd.split(',')[0].trim() || req.ip || 'desconocida';
}
async function auditar(action, details, extra = {}) {
    await db().collection('audit_logs').add({
        action,
        actorName: 'ARCA envíos (endpoint)',
        actorUid: 'SYSTEM',
        module: 'RRHH',
        details,
        timestamp: firestore_1.FieldValue.serverTimestamp(),
        ...extra,
    });
}
async function aplicarTransicion(envioId, input) {
    const ref = db().collection(COLL).doc(envioId);
    const snap = await ref.get();
    if (!snap.exists)
        return { status: 404, body: { error: 'NO_EXISTE' } };
    const envio = snap.data() || {};
    const out = (0, arcaEnviosCore_1.transicionEnvio)(envio, input);
    if (!out.ok)
        return { status: 409, body: { error: out.codigo } };
    if (input.estado === 'CONFIRMADO' && envio.enviable === false) {
        return { status: 409, body: { error: 'NO_ENVIABLE' } };
    }
    const patch = { ...out.patch, updatedAt: firestore_1.FieldValue.serverTimestamp() };
    if (input.marcarTokenUsado)
        patch.tokenUsadoAt = firestore_1.FieldValue.serverTimestamp();
    await ref.update(patch);
    if (input.estado === 'CONFIRMADO') {
        const contratoIds = Array.isArray(envio.contratoIds) ? envio.contratoIds.map(String) : [];
        const encender = envio.tipo === 'AT';
        if (envio.tipo === 'AT' || envio.tipo === 'BT' || envio.tipo === 'NA') {
            await (0, altaArcaDenorm_1.propagarAltaEnTurnos)(db(), {
                contratoIds,
                nroTransaccion: input.nroTransaccion || envio.nroTransaccion,
                encender,
            });
        }
        if (envio.loteId) {
            const hermanos = await db().collection(COLL).where('loteId', '==', envio.loteId).get();
            for (const doc of hermanos.docs) {
                if (doc.id === envioId || doc.data().estado === 'CONFIRMADO' || doc.data().enviable === false)
                    continue;
                const data = doc.data();
                await doc.ref.update({
                    estado: 'CONFIRMADO',
                    nroTransaccion: String(input.nroTransaccion || '').trim(),
                    origen: input.origen,
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                await (0, altaArcaDenorm_1.propagarAltaEnTurnos)(db(), {
                    contratoIds: Array.isArray(data.contratoIds) ? data.contratoIds.map(String) : [],
                    nroTransaccion: input.nroTransaccion,
                    encender: data.tipo === 'AT',
                });
            }
        }
    }
    if (input.estado === 'CONFIRMADO' && !envio.driveFileId && envio.txt) {
        try {
            const { subirTxtADrive } = await Promise.resolve().then(() => require('./arcaEnvioDrive'));
            const drive = await subirTxtADrive({
                envioId,
                empresaId: String(envio.empresaId || ''),
                tipo: envio.tipo === 'BT' ? 'BT' : 'AT',
                txt: String(envio.txt),
            });
            if (drive.ok)
                await ref.update({ driveFileId: drive.driveFileId, driveLink: drive.driveLink });
            else
                await ref.update({ driveSkipReason: drive.reason });
        }
        catch (e) {
            await ref.update({ driveSkipReason: e?.message || 'DRIVE_ERROR' });
        }
    }
    await auditar(`ARCA_ENVIO_${input.estado}`, `Envío ${envioId} (${envio.tipo}) por ${input.origen}`, {
        empresaId: envio.empresaId || null,
        envioId,
    });
    return { status: 200, body: { ok: true, estado: input.estado } };
}
exports.arcaEnviosApi = (0, https_1.onRequest)({ region: 'us-central1', secrets: [ARCA_ROBOT_KEY], timeoutSeconds: 60, memory: '256MiB', cors: true }, async (req, res) => {
    const nowMs = Date.now();
    const action = String(req.query.action || '');
    const token = String(req.query.token || '');
    const ip = clientIp(req);
    try {
        if (action === 'link' || action === 'link-resultado') {
            if (!(0, arcaEnviosCore_1.rateLimitHit)(`link:${ip}`, nowMs, 20)) {
                res.status(429).json({ error: 'RATE_LIMIT' });
                return;
            }
            const snap = await db().collection(COLL).where('token', '==', token).limit(1).get();
            const doc = token ? snap.docs[0] : undefined;
            const envio = doc?.data();
            const check = (0, arcaEnviosCore_1.validarToken)(envio ? envio : null, token, nowMs);
            if (!check.ok) {
                res.status(403).json({ error: check.codigo });
                return;
            }
            if (action === 'link') {
                res.status(200).json({ envio: (0, arcaEnviosCore_1.vistaPublicaEnvio)(envio), txt: String(envio.txt || '') });
                return;
            }
            const nroTransaccion = String(req.body?.nroTransaccion || '').trim();
            if (!nroTransaccion) {
                res.status(400).json({ error: 'FALTA_NRO_TRANSACCION' });
                return;
            }
            await doc.ref.update({
                cargaManual: {
                    ip,
                    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
                    at: firestore_1.FieldValue.serverTimestamp(),
                },
            });
            const out = await aplicarTransicion(doc.id, {
                estado: 'CONFIRMADO',
                origen: 'LINK',
                nroTransaccion,
                constanciaUrl: String(req.body?.constanciaUrl || '') || undefined,
                actor: `link ${ip}`,
                marcarTokenUsado: true,
            });
            res.status(out.status).json(out.body);
            return;
        }
        const key = String(req.headers['x-arca-key'] || '');
        if (!key || key !== ARCA_ROBOT_KEY.value()) {
            await auditar('ARCA_ENVIO_AUTH_FALLIDA', `Clave inválida desde ${ip}`);
            res.status(401).json({ error: 'NO_AUTORIZADO' });
            return;
        }
        if (!(0, arcaEnviosCore_1.rateLimitHit)(`robot:${ip}`, nowMs, 30)) {
            res.status(429).json({ error: 'RATE_LIMIT' });
            return;
        }
        if (action === 'config-avisos' && req.method === 'GET') {
            const empresaId = String(req.query.empresaId || '');
            if (!empresaId) {
                res.status(400).json({ error: 'PARAMETROS' });
                return;
            }
            const resuelto = await resolverAvisosEmpresa(empresaId);
            const tipo = String(req.query.tipo || '');
            res.status(200).json(tipo ? { empresaId, tipo, ...(resuelto[tipo] || vacioAviso()) } : { empresaId, avisos: resuelto });
            return;
        }
        if (action === 'pendientes' && req.method === 'GET') {
            const empresaId = String(req.query.empresaId || '');
            let q = db().collection(COLL).where('estado', 'in', ['PENDIENTE', 'ERROR']);
            if (empresaId)
                q = q.where('empresaId', '==', empresaId);
            const snap = await q.limit(MAX_PENDIENTES).get();
            res.status(200).json({
                envios: snap.docs
                    .filter((d) => d.data().enviable !== false)
                    .map((d) => ({
                    envioId: d.id,
                    empresaId: d.data().empresaId,
                    tipo: d.data().tipo,
                    estado: d.data().estado,
                    txt: d.data().txt,
                })),
            });
            return;
        }
        if (action === 'link-emitir' && req.method === 'POST') {
            const envioId = String(req.body?.envioId || '');
            if (!envioId) {
                res.status(400).json({ error: 'PARAMETROS' });
                return;
            }
            const ref = db().collection(COLL).doc(envioId);
            const snap = await ref.get();
            if (!snap.exists) {
                res.status(404).json({ error: 'NO_EXISTE' });
                return;
            }
            if (snap.data()?.estado === 'CONFIRMADO') {
                res.status(409).json({ error: 'YA_CONFIRMADO' });
                return;
            }
            const t = (0, arcaEnviosCore_1.nuevoToken)(nowMs);
            await ref.update({ ...t, updatedAt: firestore_1.FieldValue.serverTimestamp() });
            await auditar('ARCA_ENVIO_LINK_EMITIDO', `Link de un solo uso para el envío ${envioId}`, {
                empresaId: snap.data()?.empresaId || null,
                envioId,
            });
            const base = String(process.env.ARCA_LINK_BASE_URL || 'https://comtroldata.web.app/arca-envio/');
            const linkUrl = `${base}?token=${t.token}`;
            const tipoAviso = snap.data()?.tipo === 'BT' ? 'ARCA_BAJA_PENDIENTE' : 'ARCA_ALTA_PENDIENTE';
            const sinEscala = Array.isArray(snap.data()?.advertencias) && snap.data().advertencias.includes('RETRIBUCION_PENDIENTE');
            const pushes = await enviarPushAviso(String(snap.data()?.empresaId || ''), tipoAviso, linkUrl, sinEscala);
            res.status(200).json({
                envioId,
                tipo: snap.data()?.tipo || null,
                linkUrl,
                venceAt: t.tokenExpiraAt,
                pushes,
            });
            return;
        }
        if (action === 'resultado' && req.method === 'POST') {
            const body = (req.body || {});
            const envioId = String(body.envioId || '');
            const estado = String(body.estado || '');
            if (!envioId || !arcaEnviosCore_1.ESTADOS_ENVIO.includes(estado)) {
                res.status(400).json({ error: 'PARAMETROS' });
                return;
            }
            const out = await aplicarTransicion(envioId, {
                estado,
                origen: 'ROBOT',
                nroTransaccion: String(body.nroTransaccion || '') || undefined,
                constanciaUrl: String(body.constanciaUrl || '') || undefined,
                error: String(body.error || '') || undefined,
                actor: 'n8n-local',
            });
            res.status(out.status).json(out.body);
            return;
        }
        res.status(400).json({ error: 'ACCION_DESCONOCIDA' });
    }
    catch (e) {
        console.error('[arcaEnviosApi]', e);
        res.status(500).json({ error: 'ERROR_INTERNO' });
    }
});
function vacioAviso() {
    return { pushes: [], mails: [], whatsapps: [] };
}
async function resolverAvisosEmpresa(empresaId) {
    const { resolverAvisos, TIPOS_AVISO } = await Promise.resolve().then(() => require('../../../web2/src/lib/eventuales/avisos.mjs'));
    const empresa = await db().collection('empresas').doc(empresaId).get();
    const avisos = (empresa.data()?.avisos || {});
    const usersSnap = await db().collection('system_users').where('empresaId', '==', empresaId).get();
    const usuarios = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const roleIds = [...new Set(usuarios.map((u) => String(u.role || '')).filter(Boolean))];
    const roleSnaps = roleIds.length
        ? await db().getAll(...roleIds.map((id) => db().collection('roles').doc(id)))
        : [];
    const roles = roleSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    const uids = usuarios.map((u) => u.uid);
    const tokens = [];
    for (let i = 0; i < uids.length; i += 10) {
        const slice = uids.slice(i, i + 10);
        if (!slice.length)
            continue;
        const snap = await db().collection('device_tokens').where('uid', 'in', slice).get();
        snap.forEach((d) => {
            const data = d.data();
            tokens.push({ uid: String(data.uid || ''), token: String(data.token || d.id) });
        });
    }
    const out = {};
    for (const tipo of TIPOS_AVISO) {
        out[tipo] = resolverAvisos({ avisos, tipo, usuarios, roles, tokens });
    }
    return out;
}
async function enviarPushAviso(empresaId, tipo, linkUrl, sinEscala = false) {
    if (!empresaId)
        return 0;
    const avisos = await resolverAvisosEmpresa(empresaId);
    const tokens = (avisos[tipo]?.pushes || []).map((p) => p.token).filter(Boolean);
    if (!tokens.length)
        return 0;
    const titulo = tipo === 'ARCA_BAJA_PENDIENTE' ? 'Baja ARCA pendiente' : 'Alta ARCA pendiente';
    const body = sinEscala
        ? 'RETRIBUCION_PENDIENTE: no se puede enviar hasta aprobar la escala salarial.'
        : 'Hay un envío de carga masiva esperando.';
    const result = await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(0, 500),
        data: { title: titulo, body, url: linkUrl, tipo },
        webpush: { fcmOptions: { link: linkUrl } },
    });
    return result.successCount;
}
//# sourceMappingURL=arcaEnviosApi.js.map