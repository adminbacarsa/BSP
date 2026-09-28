"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stepHoursLedgerJob = exports.enqueueOpenMonthAllEmpresas = exports.retryHoursLedgerJob = exports.enqueueHoursLedgerJob = exports.hoursLedgerJobDocId = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const jobPlan_1 = require("./jobPlan");
const bundledEngine_1 = require("./bundledEngine");
const rebuildHoursLedger_1 = require("./rebuildHoursLedger");
const JOBS = 'hours_ledger_jobs';
const LOCK_MS = 4 * 60 * 1000;
function hoursLedgerJobDocId(empresaId, period, dryRun) {
    return [empresaId, period, dryRun ? 'dry' : 'save'].join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}
exports.hoursLedgerJobDocId = hoursLedgerJobDocId;
function pad(n) {
    return String(n).padStart(2, '0');
}
async function enqueueHoursLedgerJob(opts) {
    const empresaId = String(opts.empresaId || '').trim();
    if (!empresaId)
        throw new Error('empresaId requerido');
    const { periodKey } = (0, rebuildHoursLedger_1.parsePeriod)(opts.period || '');
    const dryRun = opts.dryRun !== false;
    const id = hoursLedgerJobDocId(empresaId, periodKey, dryRun);
    const ref = admin.firestore().collection(JOBS).doc(id);
    const snap = await ref.get();
    const cur = snap.data();
    const busy = cur && (cur.status === 'QUEUED' || cur.status === 'RUNNING');
    if (busy)
        return { jobId: id, queued: true, reused: true, period: periodKey, dryRun };
    const oldSlices = await ref.collection('slices').get();
    if (!oldSlices.empty) {
        const batch = admin.firestore().batch();
        oldSlices.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }
    await ref.set({
        empresaId,
        period: periodKey,
        dryRun,
        status: 'QUEUED',
        total: 0,
        processed: 0,
        currentObjectiveName: '',
        startedAt: null,
        finishedAt: null,
        error: null,
        createdBy: opts.createdBy || '',
        createdByUid: opts.uid || '',
        objectiveIds: null,
        objectiveNames: {},
        chunks: [],
        failed: [],
        result: null,
        lockUntil: null,
        updatedAt: new Date().toISOString(),
    });
    return { jobId: id, queued: true, reused: false, period: periodKey, dryRun };
}
exports.enqueueHoursLedgerJob = enqueueHoursLedgerJob;
async function retryHoursLedgerJob(jobId) {
    const ref = admin.firestore().collection(JOBS).doc(jobId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new Error('El trabajo no existe');
    const chunks = (snap.data()?.chunks || []).map((c) => (c.status === 'DONE' ? c : { ...c, status: 'PENDING', error: '' }));
    await ref.update({
        chunks,
        status: 'QUEUED',
        error: null,
        failed: [],
        lockUntil: null,
        finishedAt: null,
        updatedAt: new Date().toISOString(),
    });
    return { jobId, queued: true, retry: true };
}
exports.retryHoursLedgerJob = retryHoursLedgerJob;
async function enqueueOpenMonthAllEmpresas() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const period = `${year}-${month}`;
    const empresas = await admin.firestore().collection('empresas').get();
    const jobs = [];
    for (const e of empresas.docs) {
        const r = await enqueueHoursLedgerJob({ empresaId: e.id, period, dryRun: false, createdBy: 'nocturno' });
        jobs.push(r.jobId);
    }
    return { period, jobs };
}
exports.enqueueOpenMonthAllEmpresas = enqueueOpenMonthAllEmpresas;
async function listObjectives(empresaId, period) {
    const db = admin.firestore();
    const { year, month } = (0, rebuildHoursLedger_1.parsePeriod)(period);
    const start = new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`);
    const endDay = new Date(year, month, 0).getDate();
    const end = new Date(`${year}-${pad(month)}-${pad(endDay)}T23:59:59.999-03:00`);
    const [slas, turnos] = await Promise.all([
        db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
        db.collection('turnos')
            .where('empresaId', '==', empresaId)
            .where('startTime', '>=', firestore_1.Timestamp.fromDate(start))
            .where('startTime', '<=', firestore_1.Timestamp.fromDate(end))
            .select('objectiveId', 'objectiveName')
            .get(),
    ]);
    const names = new Map();
    const take = (id, name) => {
        const oid = String(id || '').trim();
        if (!oid)
            return;
        if (!names.has(oid))
            names.set(oid, String(name || oid));
    };
    slas.docs.forEach((d) => take(d.data().objectiveId, d.data().objectiveName || d.data().objetivo));
    turnos.docs.forEach((d) => take(d.data().objectiveId, d.data().objectiveName));
    return [...names.entries()].map(([id, name]) => ({ id, name }));
}
function chunkError(chunks) {
    const bad = chunks.filter((c) => c.status === 'ERROR');
    if (!bad.length)
        return null;
    return bad.map((c) => c.error || `Tanda ${c.start}-${c.end}`).join(' · ').slice(0, 800);
}
async function stepHoursLedgerJob(jobId) {
    const db = admin.firestore();
    const ref = db.collection(JOBS).doc(jobId);
    const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists)
            return null;
        const j = snap.data() || {};
        const status = String(j.status || '');
        if (status === 'DONE' || status === 'ERROR')
            return null;
        const lock = typeof j.lockUntil?.toMillis === 'function' ? j.lockUntil.toMillis() : 0;
        if (lock > Date.now())
            return null;
        const lockUntil = firestore_1.Timestamp.fromMillis(Date.now() + LOCK_MS);
        if (!Array.isArray(j.objectiveIds)) {
            tx.update(ref, { status: 'RUNNING', lockUntil, startedAt: j.startedAt || new Date().toISOString() });
            return { kind: 'prep' };
        }
        const chunks = (j.chunks || []).map((c) => (c.status === 'RUNNING' ? { ...c, status: 'PENDING' } : c));
        const indexes = (0, jobPlan_1.claimChunks)(chunks);
        if (!indexes.length) {
            tx.update(ref, { lockUntil, phase: 'finalize' });
            return { kind: 'finalize' };
        }
        let next = chunks;
        for (const i of indexes)
            next = next.map((c, n) => (n === i ? { ...c, status: 'RUNNING' } : c));
        const ids = (j.objectiveIds || []);
        const names = (j.objectiveNames || {});
        const current = ids[next[indexes[0]].start];
        tx.update(ref, {
            status: 'RUNNING',
            chunks: next,
            lockUntil,
            startedAt: j.startedAt || new Date().toISOString(),
            currentObjectiveName: names[current] || current || '',
        });
        return {
            kind: 'wave',
            indexes,
            empresaId: String(j.empresaId || ''),
            period: String(j.period || ''),
            dryRun: j.dryRun !== false,
            objectiveIds: ids,
            names,
        };
    });
    if (!claim)
        return;
    try {
        if (claim.kind === 'prep') {
            const snap = await ref.get();
            const j = snap.data() || {};
            const listed = await listObjectives(String(j.empresaId || ''), String(j.period || ''));
            await ref.update({
                objectiveIds: listed.map((o) => o.id),
                objectiveNames: Object.fromEntries(listed.map((o) => [o.id, o.name])),
                chunks: (0, jobPlan_1.buildChunks)(listed.length),
                total: listed.length,
                processed: 0,
                lockUntil: null,
                status: 'RUNNING',
                updatedAt: new Date().toISOString(),
            });
            return;
        }
        if (claim.kind === 'finalize') {
            await finalizeJob(ref);
            return;
        }
        await runWave(ref, claim);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await ref.update({
            status: 'ERROR',
            error: message.slice(0, 800),
            lockUntil: null,
            finishedAt: new Date().toISOString(),
        });
    }
}
exports.stepHoursLedgerJob = stepHoursLedgerJob;
async function runWave(ref, claim) {
    const snap = await ref.get();
    let chunks = (snap.data()?.chunks || []);
    const failed = Array.isArray(snap.data()?.failed) ? snap.data().failed : [];
    const ids = claim.indexes.flatMap((index) => {
        const chunk = chunks[index];
        return chunk ? claim.objectiveIds.slice(chunk.start, chunk.end) : [];
    });
    const first = claim.indexes.some((index) => chunks[index]?.start === 0);
    try {
        const built = await (0, rebuildHoursLedger_1.rebuildObjectives)({
            empresaId: claim.empresaId,
            period: claim.period,
            objectiveIds: ids,
            dryRun: claim.dryRun,
            includeUnscopedPaidAbsences: first,
        });
        if (claim.dryRun) {
            for (const index of claim.indexes) {
                const chunk = chunks[index];
                if (!chunk)
                    continue;
                const set = new Set(claim.objectiveIds.slice(chunk.start, chunk.end));
                const objectives = built.objectives.filter((m) => set.has(String(m.objectiveId || '')) || (first && chunk.start === 0 && m.objectiveId === '_sin_objetivo'));
                const days = built.days.filter((d) => set.has(String(d.objectiveId || '')) || (first && chunk.start === 0 && d.objectiveId === '_sin_objetivo'));
                const body = JSON.stringify({ objectives, days });
                await ref.collection('slices').doc(String(chunk.start)).set(body.length > 700000 ? { objectives, days: [], daysOmitted: true } : { objectives, days });
            }
        }
        for (const index of claim.indexes)
            chunks = (0, jobPlan_1.markChunk)(chunks, index, 'DONE');
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        for (const index of claim.indexes) {
            chunks = (0, jobPlan_1.markChunk)(chunks, index, 'ERROR', message.slice(0, 400));
            const chunk = chunks[index];
            const sliceIds = chunk ? claim.objectiveIds.slice(chunk.start, chunk.end) : [];
            for (const id of sliceIds)
                failed.push({ objectiveId: id, name: claim.names[id] || id, error: message.slice(0, 240) });
        }
    }
    const last = claim.objectiveIds[chunks[claim.indexes[claim.indexes.length - 1]]?.end - 1];
    await ref.update({
        chunks,
        failed,
        processed: (0, jobPlan_1.processedOf)(chunks),
        currentObjectiveName: claim.names[last] || last || '',
        error: chunkError(chunks),
        lockUntil: null,
        updatedAt: new Date().toISOString(),
    });
}
async function finalizeJob(ref) {
    const snap = await ref.get();
    const j = snap.data() || {};
    const empresaId = String(j.empresaId || '');
    const period = String(j.period || '');
    const dryRun = j.dryRun !== false;
    const chunks = (j.chunks || []);
    let objectives = [];
    if (dryRun) {
        const slices = await ref.collection('slices').get();
        for (const d of slices.docs) {
            const rows = d.data().objectives;
            if (Array.isArray(rows))
                objectives.push(...rows);
        }
    }
    else {
        const monthly = await admin.firestore().collection('hours_ledger_monthly')
            .where('empresaId', '==', empresaId)
            .where('periodKey', '==', period)
            .get();
        objectives = monthly.docs.map((d) => d.data()).filter((d) => d.level === 'objetivo');
    }
    const persona = await (0, rebuildHoursLedger_1.personaOfMonth)(empresaId, period);
    const inOperation = new Set(objectives.filter((m) => (Number(m.slaActive) || 0) > 0).map((m) => String(m.objectiveId || '')));
    const shares = (0, bundledEngine_1.assignWorkedShares)(persona.worked, persona.weights, inOperation);
    const shareById = new Map(shares.rows.map((row) => [row.objectiveId, row]));
    for (const m of objectives) {
        const row = shareById.get(String(m.objectiveId || ''));
        m.worked = row?.worked || 0;
        m.workedOutside = row?.workedOutside || 0;
    }
    for (const row of shares.rows) {
        if (objectives.some((m) => String(m.objectiveId || '') === row.objectiveId))
            continue;
        if (!(row.worked > 0) && !(row.workedOutside > 0))
            continue;
        objectives.push({
            empresaId, periodKey: period, level: 'objetivo', clientId: '', clientName: '',
            objectiveId: row.objectiveId, objectiveName: row.objectiveId,
            worked: row.worked, workedOutside: row.workedOutside,
        });
    }
    const keys = ['slaActive', 'slaInactive', 'slaClosed', 'slaWithoutPlan', 'planPublished', 'planDraft', 'worked', 'workedOutside', 'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga'];
    const blank = () => Object.fromEntries(keys.map((k) => [k, 0]));
    const add = (a, b) => {
        for (const k of keys)
            a[k] = Math.round(((a[k] || 0) + (Number(b[k]) || 0)) * 10) / 10;
    };
    const empresa = blank();
    const byClient = new Map();
    for (const m of objectives) {
        add(empresa, m);
        const cid = String(m.clientId || '_sin_cliente');
        let c = byClient.get(cid);
        if (!c) {
            c = {
                empresaId, periodKey: period, level: 'cliente', clientId: m.clientId || '', clientName: m.clientName || 'Sin cliente',
                objectiveId: '', objectiveName: '', ...blank(),
            };
            byClient.set(cid, c);
        }
        add(c, m);
    }
    empresa.worked = shares.worked;
    empresa.workedOutside = shares.workedOutside;
    const empresaDoc = {
        empresaId, periodKey: period, level: 'empresa', clientId: '', clientName: '', objectiveId: '', objectiveName: '',
        ...empresa,
    };
    const monthly = [empresaDoc, ...byClient.values(), ...objectives];
    const failed = chunks.filter((c) => c.status === 'ERROR');
    await ref.update({
        status: failed.length ? 'ERROR' : 'DONE',
        processed: Number(j.total) || (0, jobPlan_1.processedOf)(chunks),
        result: { totals: empresa, monthly },
        error: chunkError(chunks),
        finishedAt: new Date().toISOString(),
        lockUntil: null,
        currentObjectiveName: '',
        updatedAt: new Date().toISOString(),
    });
    if (!dryRun && objectives.length) {
        const db = admin.firestore();
        for (let i = 0; i < objectives.length; i += 400) {
            const batch = db.batch();
            objectives.slice(i, i + 400).forEach((m) => {
                const id = [empresaId, 'obj', m.objectiveId, period].join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
                batch.set(db.collection('hours_ledger_monthly').doc(id), { worked: m.worked, workedOutside: m.workedOutside || 0, updatedAt: new Date().toISOString() }, { merge: true });
            });
            await batch.commit();
        }
        await (0, rebuildHoursLedger_1.rollupStoredMonth)(empresaId, period);
        const empresaRef = db.collection('hours_ledger_monthly').doc([empresaId, 'empresa', period].join('_'));
        await empresaRef.set({ worked: empresa.worked, workedOutside: empresa.workedOutside, updatedAt: new Date().toISOString() }, { merge: true });
    }
}
//# sourceMappingURL=hoursLedgerJob.js.map