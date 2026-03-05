"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvrAgentEvents = void 0;
const admin = require("firebase-admin");
const date_fns_1 = require("date-fns");
const https_1 = require("firebase-functions/v2/https");
const schedule_1 = require("./schedule");
const DEFAULT_AGENT_SECRET = 'Bacar2026';
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
function getHeader(req, name) {
    const v = req.headers[name.toLowerCase()] ?? req.get?.(name);
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.trim() ? s.trim() : null;
}
let cachedSecret = { value: DEFAULT_AGENT_SECRET, fetchedAtMs: 0 };
async function getExpectedSecret() {
    ensureAdmin();
    const now = Date.now();
    const ttlMs = 60_000;
    if (now - cachedSecret.fetchedAtMs < ttlMs)
        return cachedSecret.value;
    try {
        const snap = await admin.firestore().doc('nvr_config/webhook').get();
        const secret = snap.exists && typeof snap.data()?.secret === 'string' ? String(snap.data()?.secret).trim() : '';
        cachedSecret = { value: secret || DEFAULT_AGENT_SECRET, fetchedAtMs: now };
        return cachedSecret.value;
    }
    catch (e) {
        console.error('[NVR_AGENT_SECRET_READ]', e?.message ?? e);
        cachedSecret = { value: DEFAULT_AGENT_SECRET, fetchedAtMs: now };
        return DEFAULT_AGENT_SECRET;
    }
}
function getReceivedSecret(req) {
    const qKey = req.query?.key;
    const fromQuery = typeof qKey === 'string' ? qKey : Array.isArray(qKey) ? qKey[0] : null;
    if (fromQuery && fromQuery.trim())
        return fromQuery.trim();
    const fromWebhook = getHeader(req, 'x-webhook-secret');
    if (fromWebhook)
        return fromWebhook;
    const fromNvr = getHeader(req, 'x-nvr-secret');
    if (fromNvr)
        return fromNvr;
    const fromApiKey = getHeader(req, 'x-api-key');
    if (fromApiKey)
        return fromApiKey;
    const auth = getHeader(req, 'authorization');
    if (auth && auth.toLowerCase().startsWith('bearer '))
        return auth.slice(7).trim();
    return null;
}
async function validateSecret(req, bodyNvrId) {
    const received = getReceivedSecret(req);
    if (!received) {
        throw new https_1.HttpsError('permission-denied', 'Secreto inválido.');
    }
    const globalExpected = await getExpectedSecret();
    if (received === globalExpected)
        return;
    if (bodyNvrId && String(bodyNvrId).trim()) {
        ensureAdmin();
        const nvrSnap = await admin.firestore().collection('nvr_devices').doc(String(bodyNvrId).trim()).get();
        const agentSecret = nvrSnap.exists && typeof nvrSnap.data()?.agent_secret === 'string'
            ? String(nvrSnap.data()?.agent_secret).trim()
            : '';
        if (agentSecret && received === agentSecret)
            return;
    }
    throw new https_1.HttpsError('permission-denied', 'Secreto inválido.');
}
function buildRouteKey(nvrId, channel0Based) {
    const safeNvr = (nvrId && nvrId.trim()) ? nvrId.trim() : 'default';
    const ch = channel0Based < 0 ? 1 : channel0Based + 1;
    return `${safeNvr}__${ch}`;
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
exports.nvrAgentEvents = (0, https_1.onRequest)({ timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
    try {
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        const body = (req.body || {});
        const nvrId = (body.nvrId && String(body.nvrId).trim()) || 'default';
        await validateSecret(req, nvrId);
        const channel0 = typeof body.channel === 'number' ? body.channel : -1;
        const eventTypeName = (body.eventTypeName && String(body.eventTypeName)) || 'ALARM';
        const status = (body.status && String(body.status)) || 'event';
        if (status !== 'start') {
            res.status(200).json({ ok: true, skipped: 'status_not_start' });
            return;
        }
        const routeKey = buildRouteKey(nvrId, channel0);
        ensureAdmin();
        const db = admin.firestore();
        const nvrSnap = await db.collection('nvr_devices').doc(nvrId).get();
        const nvrData = nvrSnap.exists ? nvrSnap.data() : null;
        if (nvrData && nvrData.enabled === false) {
            res.status(200).json({ ok: true, skipped: 'nvr_disabled' });
            return;
        }
        const route = await resolveRoute(routeKey);
        if (route?.disabled) {
            res.status(200).json({ ok: true, skipped: 'route_disabled' });
            return;
        }
        if (nvrData && nvrData.schedule_enabled === true && !(0, schedule_1.isWithinSchedule)(nvrData)) {
            res.status(200).json({ ok: true, skipped: 'outside_nvr_schedule' });
            return;
        }
        const routeData = (route?.data || {});
        if (route?.data && !(0, schedule_1.isWithinSchedule)(routeData)) {
            res.status(200).json({ ok: true, skipped: 'outside_schedule' });
            return;
        }
        const objectiveId = typeof routeData.objective_id === 'string' ? routeData.objective_id : null;
        const postId = typeof routeData.post_id === 'string' ? routeData.post_id : null;
        const routeCameraName = typeof routeData.camera_name === 'string' && routeData.camera_name.trim() ? routeData.camera_name : null;
        const bodyChannelName = typeof body.channelName === 'string' && body.channelName.trim() ? body.channelName.trim() : null;
        const cameraName = routeCameraName || bodyChannelName || `Canal ${channel0 + 1}`;
        const nvrDisplayName = (typeof body.nvrName === 'string' && body.nvrName.trim())
            ? body.nvrName.trim()
            : (typeof nvrData?.name === 'string' && nvrData.name
                ? nvrData.name
                : null);
        const clientId = typeof nvrData?.client_id === 'string' && nvrData.client_id
            ? nvrData.client_id
            : (typeof routeData.client_id === 'string' && routeData.client_id ? routeData.client_id : null);
        const vendor = 'dahua';
        const now = new Date();
        const alertRef = db.collection('alerts').doc();
        const alertId = alertRef.id;
        await alertRef.set({
            id: alertId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            camera_name: cameraName,
            source_camera_name: cameraName,
            channel_id: channel0 + 1,
            event_type: eventTypeName,
            object_type: null,
            image_urls: [],
            status: 'pending',
            assigned_guard: null,
            resolution_time: 0,
            guard_notes: '',
            objective_id: objectiveId,
            post_id: postId,
            route_key: routeKey,
            event_time_readable: (0, date_fns_1.format)(now, 'yyyy-MM-dd HH:mm:ss'),
            schedule_enabled: routeData.schedule_enabled === true,
            schedule_time_start: typeof routeData.schedule_time_start === 'string' ? routeData.schedule_time_start : null,
            schedule_time_end: typeof routeData.schedule_time_end === 'string' ? routeData.schedule_time_end : null,
            source: 'nvr-agent',
            vendor,
            ...(nvrDisplayName ? { nvr_name: nvrDisplayName } : {}),
            ...(clientId ? { client_id: clientId } : {}),
            ...(typeof routeData.alert_group_id === 'string' && routeData.alert_group_id.trim() ? { alert_group_id: routeData.alert_group_id.trim() } : {}),
        });
        res.status(200).json({ ok: true, alertId: alertRef.id, route_key: routeKey });
    }
    catch (e) {
        const err = e;
        console.error('[NVR_AGENT_EVENTS]', err?.message || e);
        if (e instanceof https_1.HttpsError) {
            res.status(e.httpErrorCode?.status || 500).send(e.message);
        }
        else {
            res.status(500).send(err?.message || 'Error');
        }
    }
});
//# sourceMappingURL=nvrAgentEvents.js.map