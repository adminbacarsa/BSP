"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payrollApi = void 0;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const auth_1 = require("./auth");
const cycle_1 = require("./cycle");
const calc_1 = require("./calc");
const applyCors = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Idempotency-Key');
    res.set('Access-Control-Max-Age', '3600');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
};
const json = (res, status, body) => {
    res.status(status).set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
};
const matchRoute = (req, method, pattern) => {
    if (req.method !== method)
        return null;
    return pattern.exec(req.path || '/');
};
async function handleListCycles(req, res) {
    const count = Math.min(36, Math.max(1, Number(req.query?.count) || 12));
    const cycles = (0, cycle_1.listRecentCycles)(count);
    const lockSnap = await admin.firestore().collection('payroll_cycles_locks').get();
    const lockedMap = new Map();
    lockSnap.forEach((d) => lockedMap.set(d.id, d.data()));
    json(res, 200, {
        cycles: cycles.map((c) => {
            const lock = lockedMap.get(c.cycleId);
            return {
                cycleId: c.cycleId,
                cycleStart: c.cycleStartStr,
                cycleEnd: c.cycleEndStr,
                cctVersion: '422/05',
                lockedAt: lock?.lockedAt ? lock.lockedAt.toDate().toISOString() : null,
                lockedBy: lock?.lockedBy || null,
            };
        }),
    });
}
async function handleLiquidacion(req, res) {
    const cycleId = String(req.query?.cycleId || '');
    const cycle = (0, cycle_1.parseCycleId)(cycleId);
    if (!cycle) {
        return json(res, 400, {
            error: { code: 'invalid_cycle', message: 'cycleId debe tener formato YYYY-MM.' },
        });
    }
    const empresaId = req.integration.empresaId;
    const snapshot = await (0, calc_1.buildLiquidacionSnapshot)({
        cycle,
        empresaId,
        clientIdFilter: req.query?.clientId ? String(req.query.clientId) : undefined,
        page: req.query?.page ? Number(req.query.page) : 1,
        pageSize: req.query?.pageSize ? Number(req.query.pageSize) : 100,
    });
    json(res, 200, snapshot);
}
async function handleCloseCycle(req, res, cycleId) {
    const cycle = (0, cycle_1.parseCycleId)(cycleId);
    if (!cycle) {
        return json(res, 400, {
            error: { code: 'invalid_cycle', message: 'cycleId debe tener formato YYYY-MM.' },
        });
    }
    if (!req.integration.scopes.includes('payroll.close') && !req.integration.scopes.includes('*')) {
        return json(res, 403, {
            error: { code: 'missing_scope', message: 'Esta API Key no tiene el scope payroll.close.' },
        });
    }
    const db = admin.firestore();
    const lockRef = db.collection('payroll_cycles_locks').doc(cycle.cycleId);
    const existing = await lockRef.get();
    if (existing.exists) {
        return json(res, 409, {
            error: {
                code: 'cycle_already_locked',
                message: `El ciclo ${cycle.cycleId} ya fue cerrado.`,
                lockedAt: existing.data()?.lockedAt?.toDate?.()?.toISOString?.() || null,
                lockedBy: existing.data()?.lockedBy || null,
            },
        });
    }
    const empresaId = req.integration.empresaId;
    const snapshot = await (0, calc_1.buildLiquidacionSnapshot)({ cycle, empresaId });
    const now = admin.firestore.Timestamp.now();
    const lockedBy = `integraciones_api/${req.integration.id}`;
    await lockRef.set({
        cycleId: cycle.cycleId,
        cycleStart: cycle.cycleStartStr,
        cycleEnd: cycle.cycleEndStr,
        empresaId,
        lockedAt: now,
        lockedBy,
        idempotencyKey: req.header('Idempotency-Key') || null,
        snapshot,
    });
    const tStart = (0, cycle_1.toTs)(cycle.cycleStart);
    const tEnd = (0, cycle_1.toTs)(cycle.cycleEnd);
    const stampDocs = async (snap, extraFilter) => {
        const docs = extraFilter ? snap.docs.filter(extraFilter) : snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
            const batch = db.batch();
            for (const d of docs.slice(i, i + 400)) {
                batch.update(d.ref, {
                    payrollLockedAt: now,
                    payrollLockedBy: lockedBy,
                    payrollCycleId: cycle.cycleId,
                });
            }
            await batch.commit();
        }
    };
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();
    await stampDocs(turnosSnap, (d) => (empresaId ? d.data().empresaId === empresaId : true));
    const ausSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();
    await stampDocs(ausSnap, (d) => {
        const data = d.data();
        if (empresaId && data.empresaId && data.empresaId !== empresaId)
            return false;
        const end = String(data.endDate || data.startDate || '');
        return end >= cycle.cycleStartStr;
    });
    await db.collection('audit_logs').add({
        module: 'PAYROLL_API',
        action: 'CYCLE_CLOSE',
        actorName: lockedBy,
        actorUid: 'API_KEY',
        details: `Ciclo ${cycle.cycleId} cerrado · ${snapshot.items.length} empleados`,
        timestamp: now,
        empresaId,
    });
    const closedSnapshot = {
        ...snapshot,
        lockedAt: now.toDate().toISOString(),
    };
    json(res, 200, { success: true, snapshot: closedSnapshot });
}
async function dispatch(req, res) {
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/cycles\/?$/)) {
        if (!(await (0, auth_1.requireApiKey)(req, res, 'payroll.read')))
            return;
        return handleListCycles(req, res);
    }
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/liquidacion\/?$/)) {
        if (!(await (0, auth_1.requireApiKey)(req, res, 'payroll.read')))
            return;
        return handleLiquidacion(req, res);
    }
    const closeMatch = matchRoute(req, 'POST', /^\/v1\/payroll\/liquidacion\/([\w-]+)\/close\/?$/);
    if (closeMatch) {
        if (!(await (0, auth_1.requireApiKey)(req, res, 'payroll.read')))
            return;
        return handleCloseCycle(req, res, closeMatch[1]);
    }
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/health\/?$/)) {
        return json(res, 200, { status: 'ok', time: new Date().toISOString() });
    }
    return json(res, 404, { error: { code: 'not_found', message: `Ruta ${req.method} ${req.path} no existe.` } });
}
exports.payrollApi = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onRequest(async (req, res) => {
    if (applyCors(req, res))
        return;
    try {
        await dispatch(req, res);
    }
    catch (err) {
        console.error('[payrollApi] Error inesperado:', err);
        json(res, 500, {
            error: { code: 'internal_error', message: err?.message || 'Error interno.' },
        });
    }
});
//# sourceMappingURL=handler.js.map