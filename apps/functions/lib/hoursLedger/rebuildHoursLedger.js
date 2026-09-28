"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildOpenMonthAllEmpresas = exports.runDueLedgerDirty = exports.markLedgerDirty = exports.rebuildHoursLedger = exports.parsePeriod = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const bundledEngine_1 = require("./bundledEngine");
const DAY_COL = 'hours_ledger';
const MONTH_COL = 'hours_ledger_monthly';
function pad(n) {
    return String(n).padStart(2, '0');
}
function arParts(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value || '';
    return { year: Number(get('year')), month: Number(get('month')), day: get('day') };
}
function parsePeriod(period, now = new Date()) {
    const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
    if (m)
        return { year: Number(m[1]), month: Number(m[2]), periodKey: `${m[1]}-${m[2]}` };
    const ar = arParts(now);
    return { year: ar.year, month: ar.month, periodKey: `${ar.year}-${pad(ar.month)}` };
}
exports.parsePeriod = parsePeriod;
function publishMap(docs) {
    const map = {};
    for (const d of docs) {
        const data = d.data();
        if (data.publishedAt == null || data.publishedAt === '')
            continue;
        const id = d.id;
        const parsed = id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
        const oid = String(data.objectiveId || data.objetivoId || parsed?.[1] || '').trim();
        const y = Number(data.year ?? data.año ?? parsed?.[2]);
        const mo = Number(data.month ?? data.mes ?? parsed?.[3]);
        if (oid && Number.isFinite(y) && Number.isFinite(mo))
            map[`${oid}_${y}_${mo}`] = true;
    }
    return map;
}
function docId(parts) {
    return parts.join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}
async function loadMonth(empresaId, year, month) {
    const db = admin.firestore();
    const start = new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`);
    const endDay = new Date(year, month, 0).getDate();
    const end = new Date(`${year}-${pad(month)}-${pad(endDay)}T23:59:59.999-03:00`);
    const [empresaSnap, clientsSnap, slaSnap, planifSnap, empSnap, ausSnap, turnosSnap] = await Promise.all([
        db.collection('empresas').doc(empresaId).get(),
        db.collection('clients').where('empresaId', '==', empresaId).get(),
        db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
        db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
        db.collection('empleados').where('empresaId', '==', empresaId).get(),
        db.collection('ausencias').where('empresaId', '==', empresaId).get(),
        db.collection('turnos')
            .where('empresaId', '==', empresaId)
            .where('startTime', '>=', firestore_1.Timestamp.fromDate(start))
            .where('startTime', '<=', firestore_1.Timestamp.fromDate(end))
            .get(),
    ]);
    const empNameById = {};
    empSnap.docs.forEach((d) => {
        const e = d.data();
        const st = String(e.status || '').toLowerCase();
        if (st === 'inactive' || st === 'inactivo')
            return;
        empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
    });
    const built = (0, bundledEngine_1.buildLedgerMonth)({
        empresaId,
        year,
        month,
        hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
        clients: clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        slas: slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        turnos: turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ausencias: ausSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        publishStatusMap: publishMap(planifSnap.docs),
        empNameById,
    });
    return built;
}
function roundTotals(t) {
    const out = {};
    for (const [k, v] of Object.entries(t))
        out[k] = Math.round(Number(v) || 0);
    return out;
}
async function commitWrites(rows) {
    const db = admin.firestore();
    let batch = db.batch();
    let n = 0;
    for (const row of rows) {
        batch.set(row.ref, row.data, { merge: false });
        n += 1;
        if (n >= 400) {
            await batch.commit();
            batch = db.batch();
            n = 0;
        }
    }
    if (n > 0)
        await batch.commit();
}
async function deleteStale(col, empresaId, periodKey, keep) {
    const db = admin.firestore();
    const snap = await db.collection(col).where('empresaId', '==', empresaId).where('periodKey', '==', periodKey).get();
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
        if (keep.has(d.id))
            continue;
        batch.delete(d.ref);
        n += 1;
        if (n >= 400) {
            await batch.commit();
            batch = db.batch();
            n = 0;
        }
    }
    if (n > 0)
        await batch.commit();
}
async function rebuildHoursLedger(opts) {
    const empresaId = String(opts.empresaId || '').trim();
    if (!empresaId)
        throw new Error('empresaId requerido');
    const { year, month, periodKey } = parsePeriod(opts.period || '');
    const dryRun = opts.dryRun !== false;
    const built = await loadMonth(empresaId, year, month);
    const db = admin.firestore();
    const now = new Date().toISOString();
    const dayRows = built.days.map((d) => {
        const id = docId([empresaId, d.objectiveId, d.puestoId, d.date]);
        return { id, data: { ...d, id, updatedAt: now } };
    });
    const monthRows = built.monthly.map((m) => {
        const id = m.level === 'empresa'
            ? docId([empresaId, 'empresa', periodKey])
            : m.level === 'cliente'
                ? docId([empresaId, 'cli', m.clientId || 'sin', periodKey])
                : docId([empresaId, 'obj', m.objectiveId, periodKey]);
        return { id, data: { ...m, id, updatedAt: now } };
    });
    if (!dryRun) {
        await commitWrites(dayRows.map((r) => ({ ref: db.collection(DAY_COL).doc(r.id), data: r.data })));
        await commitWrites(monthRows.map((r) => ({ ref: db.collection(MONTH_COL).doc(r.id), data: r.data })));
        await deleteStale(DAY_COL, empresaId, periodKey, new Set(dayRows.map((r) => r.id)));
        await deleteStale(MONTH_COL, empresaId, periodKey, new Set(monthRows.map((r) => r.id)));
    }
    return {
        dryRun,
        empresaId,
        periodKey,
        hoursCoreEnabled: built.monthly.find((m) => m.level === 'empresa')?.hoursCoreEnabled === true,
        totals: roundTotals(built.totals),
        monthly: monthRows.map((r) => r.data),
        days: dayRows.map((r) => r.data),
        counts: { days: dayRows.length, monthly: monthRows.length },
    };
}
exports.rebuildHoursLedger = rebuildHoursLedger;
async function markLedgerDirty(opts) {
    const empresaId = String(opts.empresaId || '').trim();
    if (!empresaId)
        return;
    const ar = arParts();
    const periodKey = opts.periodKey || `${ar.year}-${pad(ar.month)}`;
    const objectiveId = String(opts.objectiveId || '_empresa').trim() || '_empresa';
    const id = docId([empresaId, objectiveId, periodKey]);
    const due = firestore_1.Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
    await admin.firestore().collection('hours_ledger_dirty').doc(id).set({
        empresaId,
        objectiveId,
        periodKey,
        dueAt: due,
        touchAt: firestore_1.Timestamp.now(),
    }, { merge: true });
}
exports.markLedgerDirty = markLedgerDirty;
async function runDueLedgerDirty(limit = 20) {
    const db = admin.firestore();
    const snap = await db.collection('hours_ledger_dirty').where('dueAt', '<=', firestore_1.Timestamp.now()).limit(limit).get();
    const seen = new Set();
    for (const d of snap.docs) {
        const data = d.data();
        const key = `${data.empresaId}|${data.periodKey}`;
        if (!seen.has(key)) {
            seen.add(key);
            await rebuildHoursLedger({ empresaId: String(data.empresaId), period: String(data.periodKey), dryRun: false });
        }
        await d.ref.delete();
    }
    return { processed: snap.size, months: seen.size };
}
exports.runDueLedgerDirty = runDueLedgerDirty;
async function rebuildOpenMonthAllEmpresas() {
    const db = admin.firestore();
    const ar = arParts();
    const period = `${ar.year}-${pad(ar.month)}`;
    const empresas = await db.collection('empresas').get();
    const done = [];
    for (const e of empresas.docs) {
        await rebuildHoursLedger({ empresaId: e.id, period, dryRun: false });
        done.push(e.id);
    }
    return { period, empresas: done };
}
exports.rebuildOpenMonthAllEmpresas = rebuildOpenMonthAllEmpresas;
//# sourceMappingURL=rebuildHoursLedger.js.map