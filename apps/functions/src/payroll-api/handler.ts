/**
 * Router HTTP de la API de liquidación.
 *
 * Endpoints (todos requieren header `X-API-Key`):
 *   GET  /v1/payroll/cycles?count=12
 *   GET  /v1/payroll/liquidacion?cycleId=YYYY-MM&clientId=&page=&pageSize=
 *   POST /v1/payroll/liquidacion/:cycleId/close
 *   GET  /v1/payroll/health
 *
 * Decisiones (alineadas con la UI de Reportes):
 *   - Turnos sin fichada → NO suman a Hs Reales, se reportan en warnings.
 *   - Ausencias injustificadas (AA) → solo se reportan como días, no descuentan
 *     en horas.
 *   - El JSON entrega únicamente el ACUMULADO por empleado (sin detalle de
 *     turnos), igual a la grilla del reporte que ve el liquidador.
 *   - El cierre del ciclo (`POST /close`) es obligatorio antes de liquidar:
 *     genera un snapshot inmutable en `payroll_cycles_locks/{cycleId}` y deja
 *     `payrollLockedAt` en cada turno/ausencia del ciclo para que las reglas
 *     de Firestore puedan rechazar ediciones posteriores.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { requireApiKey, AuthedRequest } from './auth';

type Request = functions.https.Request;
type Response = any;
import { listRecentCycles, parseCycleId, toTs } from './cycle';
import { buildLiquidacionSnapshot, LiquidacionSnapshot } from './calc';

const applyCors = (req: Request, res: Response): boolean => {
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

const json = (res: Response, status: number, body: any) => {
    res.status(status).set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
};

const matchRoute = (req: Request, method: string, pattern: RegExp): RegExpExecArray | null => {
    if (req.method !== method) return null;
    return pattern.exec(req.path || '/');
};

/** GET /v1/payroll/cycles */
async function handleListCycles(req: AuthedRequest, res: Response) {
    const count = Math.min(36, Math.max(1, Number(req.query?.count) || 12));
    const cycles = listRecentCycles(count);
    const lockSnap = await admin.firestore().collection('payroll_cycles_locks').get();
    const lockedMap = new Map<string, any>();
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

/** GET /v1/payroll/liquidacion */
async function handleLiquidacion(req: AuthedRequest, res: Response) {
    const cycleId = String(req.query?.cycleId || '');
    const cycle = parseCycleId(cycleId);
    if (!cycle) {
        return json(res, 400, {
            error: { code: 'invalid_cycle', message: 'cycleId debe tener formato YYYY-MM.' },
        });
    }
    const empresaId = req.integration!.empresaId;
    const snapshot = await buildLiquidacionSnapshot({
        cycle,
        empresaId,
        clientIdFilter: req.query?.clientId ? String(req.query.clientId) : undefined,
        page: req.query?.page ? Number(req.query.page) : 1,
        pageSize: req.query?.pageSize ? Number(req.query.pageSize) : 100,
    });
    json(res, 200, snapshot);
}

/** POST /v1/payroll/liquidacion/:cycleId/close */
async function handleCloseCycle(req: AuthedRequest, res: Response, cycleId: string) {
    const cycle = parseCycleId(cycleId);
    if (!cycle) {
        return json(res, 400, {
            error: { code: 'invalid_cycle', message: 'cycleId debe tener formato YYYY-MM.' },
        });
    }
    if (!req.integration!.scopes.includes('payroll.close') && !req.integration!.scopes.includes('*')) {
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

    // Generamos el snapshot que vamos a archivar (idempotencia + auditoría).
    const empresaId = req.integration!.empresaId;
    const snapshot = await buildLiquidacionSnapshot({ cycle, empresaId });

    const now = admin.firestore.Timestamp.now();
    const lockedBy = `integraciones_api/${req.integration!.id}`;

    // 1) Lock principal con el snapshot adjunto.
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

    // 2) Marcar payrollLockedAt en cada turno y ausencia del ciclo (en batches).
    const tStart = toTs(cycle.cycleStart);
    const tEnd = toTs(cycle.cycleEnd);

    const stampDocs = async (
        snap: FirebaseFirestore.QuerySnapshot,
        extraFilter?: (d: FirebaseFirestore.QueryDocumentSnapshot) => boolean,
    ) => {
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
        if (empresaId && data.empresaId && data.empresaId !== empresaId) return false;
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

    const closedSnapshot: LiquidacionSnapshot = {
        ...snapshot,
        lockedAt: now.toDate().toISOString(),
    };
    json(res, 200, { success: true, snapshot: closedSnapshot });
}

/** Dispatcher principal. */
async function dispatch(req: AuthedRequest, res: Response) {
    // /v1/payroll/cycles
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/cycles\/?$/)) {
        if (!(await requireApiKey(req, res, 'payroll.read'))) return;
        return handleListCycles(req, res);
    }
    // /v1/payroll/liquidacion
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/liquidacion\/?$/)) {
        if (!(await requireApiKey(req, res, 'payroll.read'))) return;
        return handleLiquidacion(req, res);
    }
    // /v1/payroll/liquidacion/:cycleId/close
    const closeMatch = matchRoute(req, 'POST', /^\/v1\/payroll\/liquidacion\/([\w-]+)\/close\/?$/);
    if (closeMatch) {
        if (!(await requireApiKey(req, res, 'payroll.read'))) return;
        return handleCloseCycle(req, res, closeMatch[1]);
    }
    // /v1/payroll/health
    if (matchRoute(req, 'GET', /^\/v1\/payroll\/health\/?$/)) {
        return json(res, 200, { status: 'ok', time: new Date().toISOString() });
    }
    return json(res, 404, { error: { code: 'not_found', message: `Ruta ${req.method} ${req.path} no existe.` } });
}

/**
 * Cloud Function HTTP. Se exporta desde `apps/functions/src/index.ts` como
 * `payrollApi` y se monta como rewrite en `firebase.json` (o se consume
 * directamente vía la URL https://us-central1-<project>.cloudfunctions.net/payrollApi).
 */
export const payrollApi = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onRequest(async (req, res) => {
        if (applyCors(req, res)) return;
        try {
            await dispatch(req as AuthedRequest, res);
        } catch (err: any) {
            console.error('[payrollApi] Error inesperado:', err);
            json(res, 500, {
                error: { code: 'internal_error', message: err?.message || 'Error interno.' },
            });
        }
    });
