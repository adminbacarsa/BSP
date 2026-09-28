import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { buildChunks, claimChunks, markChunk, processedOf, type LedgerChunk } from './jobPlan';
import { parsePeriod, personaOfMonth, rebuildObjectives, rollupStoredMonth } from './rebuildHoursLedger';

const JOBS = 'hours_ledger_jobs';
const LOCK_MS = 4 * 60 * 1000;

export function hoursLedgerJobDocId(empresaId: string, period: string, dryRun: boolean) {
  return [empresaId, period, dryRun ? 'dry' : 'save'].join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export async function enqueueHoursLedgerJob(opts: {
  empresaId: string;
  period?: string;
  dryRun?: boolean;
  createdBy?: string;
  uid?: string;
  force?: boolean;
}) {
  const empresaId = String(opts.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido');
  const { periodKey } = parsePeriod(opts.period || '');
  const dryRun = opts.dryRun !== false;
  const id = hoursLedgerJobDocId(empresaId, periodKey, dryRun);
  const ref = admin.firestore().collection(JOBS).doc(id);
  const snap = await ref.get();
  const cur = snap.data();
  const busy = cur && (cur.status === 'QUEUED' || cur.status === 'RUNNING');
  if (busy) return { jobId: id, queued: true, reused: true, period: periodKey, dryRun };
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

export async function retryHoursLedgerJob(jobId: string) {
  const ref = admin.firestore().collection(JOBS).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('El trabajo no existe');
  const chunks = ((snap.data()?.chunks || []) as LedgerChunk[]).map((c) => (
    c.status === 'DONE' ? c : { ...c, status: 'PENDING' as const, error: '' }
  ));
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

export async function enqueueOpenMonthAllEmpresas() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const period = `${year}-${month}`;
  const empresas = await admin.firestore().collection('empresas').get();
  const jobs: string[] = [];
  for (const e of empresas.docs) {
    const r = await enqueueHoursLedgerJob({ empresaId: e.id, period, dryRun: false, createdBy: 'nocturno' });
    jobs.push(r.jobId);
  }
  return { period, jobs };
}

async function listObjectives(empresaId: string, period: string) {
  const db = admin.firestore();
  const { year, month } = parsePeriod(period);
  const start = new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`);
  const endDay = new Date(year, month, 0).getDate();
  const end = new Date(`${year}-${pad(month)}-${pad(endDay)}T23:59:59.999-03:00`);
  const [slas, turnos] = await Promise.all([
    db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
    db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', Timestamp.fromDate(start))
      .where('startTime', '<=', Timestamp.fromDate(end))
      .select('objectiveId', 'objectiveName')
      .get(),
  ]);
  const names = new Map<string, string>();
  const take = (id: unknown, name: unknown) => {
    const oid = String(id || '').trim();
    if (!oid) return;
    if (!names.has(oid)) names.set(oid, String(name || oid));
  };
  slas.docs.forEach((d) => take(d.data().objectiveId, d.data().objectiveName || d.data().objetivo));
  turnos.docs.forEach((d) => take(d.data().objectiveId, d.data().objectiveName));
  return [...names.entries()].map(([id, name]) => ({ id, name }));
}

function chunkError(chunks: LedgerChunk[]) {
  const bad = chunks.filter((c) => c.status === 'ERROR');
  if (!bad.length) return null;
  return bad.map((c) => c.error || `Tanda ${c.start}-${c.end}`).join(' · ').slice(0, 800);
}

export async function stepHoursLedgerJob(jobId: string) {
  const db = admin.firestore();
  const ref = db.collection(JOBS).doc(jobId);
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const j = snap.data() || {};
    const status = String(j.status || '');
    if (status === 'DONE' || status === 'ERROR') return null;
    const lock = typeof j.lockUntil?.toMillis === 'function' ? j.lockUntil.toMillis() : 0;
    if (lock > Date.now()) return null;
    const lockUntil = Timestamp.fromMillis(Date.now() + LOCK_MS);
    if (!Array.isArray(j.objectiveIds)) {
      tx.update(ref, { status: 'RUNNING', lockUntil, startedAt: j.startedAt || new Date().toISOString() });
      return { kind: 'prep' as const };
    }
    const chunks = ((j.chunks || []) as LedgerChunk[]).map((c) => (
      c.status === 'RUNNING' ? { ...c, status: 'PENDING' as const } : c
    ));
    const indexes = claimChunks(chunks);
    if (!indexes.length) {
      tx.update(ref, { lockUntil, phase: 'finalize' });
      return { kind: 'finalize' as const };
    }
    let next = chunks;
    for (const i of indexes) next = next.map((c, n) => (n === i ? { ...c, status: 'RUNNING' as const } : c));
    const ids = (j.objectiveIds || []) as string[];
    const names = (j.objectiveNames || {}) as Record<string, string>;
    const current = ids[next[indexes[0]].start];
    tx.update(ref, {
      status: 'RUNNING',
      chunks: next,
      lockUntil,
      startedAt: j.startedAt || new Date().toISOString(),
      currentObjectiveName: names[current] || current || '',
    });
    return {
      kind: 'wave' as const,
      indexes,
      empresaId: String(j.empresaId || ''),
      period: String(j.period || ''),
      dryRun: j.dryRun !== false,
      objectiveIds: ids,
      names,
    };
  });
  if (!claim) return;

  try {
    if (claim.kind === 'prep') {
      const snap = await ref.get();
      const j = snap.data() || {};
      const listed = await listObjectives(String(j.empresaId || ''), String(j.period || ''));
      await ref.update({
        objectiveIds: listed.map((o) => o.id),
        objectiveNames: Object.fromEntries(listed.map((o) => [o.id, o.name])),
        chunks: buildChunks(listed.length),
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    await ref.update({
      status: 'ERROR',
      error: message.slice(0, 800),
      lockUntil: null,
      finishedAt: new Date().toISOString(),
    });
  }
}

async function runWave(ref: FirebaseFirestore.DocumentReference, claim: {
  indexes: number[];
  empresaId: string;
  period: string;
  dryRun: boolean;
  objectiveIds: string[];
  names: Record<string, string>;
}) {
  const snap = await ref.get();
  let chunks = ((snap.data()?.chunks || []) as LedgerChunk[]);
  const failed: Array<{ objectiveId: string; name: string; error: string }> = Array.isArray(snap.data()?.failed) ? snap.data()!.failed : [];
  const ids = claim.indexes.flatMap((index) => {
    const chunk = chunks[index];
    return chunk ? claim.objectiveIds.slice(chunk.start, chunk.end) : [];
  });
  const first = claim.indexes.some((index) => chunks[index]?.start === 0);
  try {
    const built = await rebuildObjectives({
      empresaId: claim.empresaId,
      period: claim.period,
      objectiveIds: ids,
      dryRun: claim.dryRun,
      includeUnscopedPaidAbsences: first,
    });
    if (claim.dryRun) {
      for (const index of claim.indexes) {
        const chunk = chunks[index];
        if (!chunk) continue;
        const set = new Set(claim.objectiveIds.slice(chunk.start, chunk.end));
        const objectives = built.objectives.filter((m) => set.has(String(m.objectiveId || '')) || (first && chunk.start === 0 && m.objectiveId === '_sin_objetivo'));
        const days = built.days.filter((d) => set.has(String(d.objectiveId || '')) || (first && chunk.start === 0 && d.objectiveId === '_sin_objetivo'));
        const body = JSON.stringify({ objectives, days });
        await ref.collection('slices').doc(String(chunk.start)).set(
          body.length > 700000 ? { objectives, days: [], daysOmitted: true } : { objectives, days },
        );
      }
    }
    for (const index of claim.indexes) chunks = markChunk(chunks, index, 'DONE');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    for (const index of claim.indexes) {
      chunks = markChunk(chunks, index, 'ERROR', message.slice(0, 400));
      const chunk = chunks[index];
      const sliceIds = chunk ? claim.objectiveIds.slice(chunk.start, chunk.end) : [];
      for (const id of sliceIds) failed.push({ objectiveId: id, name: claim.names[id] || id, error: message.slice(0, 240) });
    }
  }
  const last = claim.objectiveIds[chunks[claim.indexes[claim.indexes.length - 1]]?.end - 1];
  await ref.update({
    chunks,
    failed,
    processed: processedOf(chunks),
    currentObjectiveName: claim.names[last] || last || '',
    error: chunkError(chunks),
    lockUntil: null,
    updatedAt: new Date().toISOString(),
  });
}

async function finalizeJob(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.get();
  const j = snap.data() || {};
  const empresaId = String(j.empresaId || '');
  const period = String(j.period || '');
  const dryRun = j.dryRun !== false;
  const chunks = (j.chunks || []) as LedgerChunk[];
  let objectives: Array<Record<string, any>> = [];
  if (dryRun) {
    const slices = await ref.collection('slices').get();
    for (const d of slices.docs) {
      const rows = d.data().objectives;
      if (Array.isArray(rows)) objectives.push(...rows);
    }
  } else {
    const monthly = await admin.firestore().collection('hours_ledger_monthly')
      .where('empresaId', '==', empresaId)
      .where('periodKey', '==', period)
      .get();
    objectives = monthly.docs.map((d) => d.data()).filter((d) => d.level === 'objetivo') as Array<Record<string, any>>;
  }
  const persona = await personaOfMonth(empresaId, period);
  const weightSum = Object.values(persona.weights).reduce((s, n) => s + n, 0);
  if (persona.worked > 0 && weightSum > 0) {
    for (const m of objectives) {
      const w = persona.weights[String(m.objectiveId || '')] || 0;
      m.worked = Math.round((persona.worked * (w / weightSum)) * 10) / 10;
    }
    const assigned = objectives.reduce((s, m) => s + (Number(m.worked) || 0), 0);
    const drift = Math.round((persona.worked - assigned) * 10) / 10;
    if (objectives[0] && drift) objectives[0].worked = Math.round((objectives[0].worked + drift) * 10) / 10;
  }
  const keys = ['slaActive', 'slaInactive', 'slaClosed', 'planPublished', 'planDraft', 'worked', 'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga'];
  const blank = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
  const add = (a: Record<string, number>, b: Record<string, any>) => {
    for (const k of keys) a[k] = Math.round(((a[k] || 0) + (Number(b[k]) || 0)) * 10) / 10;
  };
  const empresa = blank();
  const byClient = new Map<string, Record<string, any>>();
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
  empresa.worked = persona.worked || empresa.worked;
  const empresaDoc = {
    empresaId, periodKey: period, level: 'empresa', clientId: '', clientName: '', objectiveId: '', objectiveName: '',
    ...empresa,
  };
  const monthly = [empresaDoc, ...byClient.values(), ...objectives];
  const failed = chunks.filter((c) => c.status === 'ERROR');
  await ref.update({
    status: failed.length ? 'ERROR' : 'DONE',
    processed: Number(j.total) || processedOf(chunks),
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
        batch.set(db.collection('hours_ledger_monthly').doc(id), { worked: m.worked, updatedAt: new Date().toISOString() }, { merge: true });
      });
      await batch.commit();
    }
    await rollupStoredMonth(empresaId, period);
    const empresaRef = db.collection('hours_ledger_monthly').doc([empresaId, 'empresa', period].join('_'));
    await empresaRef.set({ worked: empresa.worked, updatedAt: new Date().toISOString() }, { merge: true });
  }
}
