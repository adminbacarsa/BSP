import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { buildChunks, claimChunks, markChunk, processedOf, type LedgerChunk } from './jobPlan';
import { applyBillableOnRows, assignWorkedShares } from './bundledEngine';
import { parsePeriod, personaOfMonth, rebuildObjectives, rollupStoredMonth } from './rebuildHoursLedger';
import { LEDGER_ENGINE_VERSION } from './ledgerDirtyPlan';

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
  /** Si viene, el job no lista toda la empresa: solo estas tandas. */
  objectiveIds?: string[];
}) {
  const empresaId = String(opts.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido');
  const { periodKey } = parsePeriod(opts.period || '');
  const dryRun = opts.dryRun !== false;
  const id = hoursLedgerJobDocId(empresaId, periodKey, dryRun);
  const ref = admin.firestore().collection(JOBS).doc(id);
  const snap = await ref.get();
  const cur = snap.data();
  const asked = opts.objectiveIds
    ? [...new Set(opts.objectiveIds.map((x) => String(x || '').trim()).filter(Boolean))]
    : null;
  const busy = cur && (cur.status === 'QUEUED' || cur.status === 'RUNNING');
  if (busy && !opts.force) {
    const curIds = cur.objectiveIds;
    if (!Array.isArray(curIds)) return { jobId: id, queued: true, reused: true, covered: true, period: periodKey, dryRun };
    if (!asked) {
      if (cur.status === 'QUEUED') {
        await ref.update({
          objectiveIds: null,
          chunks: [],
          total: 0,
          updatedAt: new Date().toISOString(),
        });
        return { jobId: id, queued: true, reused: true, covered: true, period: periodKey, dryRun };
      }
      return { jobId: id, queued: true, reused: true, covered: false, period: periodKey, dryRun };
    }
    const missing = asked.filter((oid) => !curIds.includes(oid));
    if (!missing.length) return { jobId: id, queued: true, reused: true, covered: true, period: periodKey, dryRun };
    if (cur.status === 'QUEUED') {
      const next = [...curIds, ...missing];
      await ref.update({
        objectiveIds: next,
        chunks: buildChunks(next.length),
        total: next.length,
        updatedAt: new Date().toISOString(),
      });
      return { jobId: id, queued: true, reused: true, covered: true, period: periodKey, dryRun };
    }
    return { jobId: id, queued: true, reused: true, covered: false, period: periodKey, dryRun };
  }
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
    total: asked ? asked.length : 0,
    processed: 0,
    currentObjectiveName: '',
    startedAt: null,
    finishedAt: null,
    error: null,
    createdBy: opts.createdBy || '',
    createdByUid: opts.uid || '',
    engineVersion: LEDGER_ENGINE_VERSION,
    objectiveIds: asked,
    objectiveNames: {},
    chunks: asked ? buildChunks(asked.length) : [],
    failed: [],
    result: null,
    lockUntil: null,
    updatedAt: new Date().toISOString(),
  });
  return { jobId: id, queued: true, reused: false, covered: true, period: periodKey, dryRun };
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
  const { hoursCoreOn } = await import('./rebuildHoursLedger');
  const empresas = await admin.firestore().collection('empresas').where('hoursCoreEnabled', '==', true).get();
  const jobs: string[] = [];
  for (const e of empresas.docs) {
    if (!(await hoursCoreOn(e.id))) continue;
    const r = await enqueueHoursLedgerJob({ empresaId: e.id, period, dryRun: false, createdBy: 'nocturno', force: true });
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
  const inOperation = new Set(objectives.filter((m) => (Number(m.slaActive) || 0) > 0).map((m) => String(m.objectiveId || '')));
  const shares = assignWorkedShares(persona.worked, persona.weights, inOperation);
  const shareById = new Map(shares.rows.map((row) => [row.objectiveId, row]));
  for (const m of objectives) {
    const row = shareById.get(String(m.objectiveId || ''));
    m.worked = row?.worked || 0;
    m.workedOutside = row?.workedOutside || 0;
  }
  for (const row of shares.rows) {
    if (objectives.some((m) => String(m.objectiveId || '') === row.objectiveId)) continue;
    if (!(row.worked > 0) && !(row.workedOutside > 0)) continue;
    objectives.push({
      empresaId, periodKey: period, level: 'objetivo', clientId: '', clientName: '',
      objectiveId: row.objectiveId, objectiveName: row.objectiveId,
      worked: row.worked, workedOutside: row.workedOutside,
    });
  }
  const liq = new Map<string, { ft: number; ext: number; adv: number }>();
  for (const p of persona.parts || []) {
    const oid = String(p.objectiveId || '').trim();
    if (!oid) continue;
    const cur = liq.get(oid) || { ft: 0, ext: 0, adv: 0 };
    cur.ft += p.ft || 0;
    cur.ext += p.ext || 0;
    cur.adv += p.adv || 0;
    liq.set(oid, cur);
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  for (const m of objectives) {
    const p = liq.get(String(m.objectiveId || ''));
    if (p) {
      m.ft = r1(p.ft);
      m.ext = r1(p.ext);
      m.adv = r1(p.adv);
    }
    const relief = Number(m.reliefHours) || 0;
    if ((Number(m.slaActive) || 0) > 0 && Number(m.covered) > Number(m.worked) + relief + 0.05) {
      const prevUncovered = Number(m.uncovered) || 0;
      m.covered = r1(Number(m.worked) + relief);
      m.uncovered = r1(Math.max(0, Number(m.slaActive) - Number(m.covered)));
      // El ajuste de trabajadas es global (recién se conoce al cerrar el job): la diferencia
      // no se puede atribuir a una causa puntual, así que engrosa falta de planificación.
      const delta = r1(m.uncovered - prevUncovered);
      if (delta) m.uncoveredFaltaPlan = r1((Number(m.uncoveredFaltaPlan) || 0) + delta);
    }
  }
  const ordersSnap = await admin.firestore().collection('ordenes_compra').where('empresaId', '==', empresaId).get();
  for (const m of objectives) if (!m.periodKey) m.periodKey = period;
  applyBillableOnRows(objectives, ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  const keys = [
    'slaActive', 'slaInactive', 'slaClosed', 'slaWithoutPlan', 'planPublished', 'planDraft', 'worked', 'workedOutside',
    'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga', 'novedadPagaOutside',
    'licV', 'licE', 'licL', 'licA', 'licPG', 'licSUS', 'licSGS',
    'ausenciaHoras', 'ausenciaHorasOutside', 'ausenciaTurnos', 'ausenciaTurnosOutside', 'ausenciaLegajos',
    'uncoveredAusencia', 'uncoveredRetiro', 'uncoveredFaltaPlan',
    'billable', 'workedNotBilled', 'billedNotWorked',
  ];
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
        batch.set(db.collection('hours_ledger_monthly').doc(id), {
          worked: m.worked, workedOutside: m.workedOutside || 0,
          ft: m.ft || 0, ext: m.ext || 0, adv: m.adv || 0,
          covered: m.covered || 0, uncovered: m.uncovered || 0,
          billable: m.billable || 0, workedNotBilled: m.workedNotBilled || 0, billedNotWorked: m.billedNotWorked || 0,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
      await batch.commit();
    }
    await rollupStoredMonth(empresaId, period);
    const empresaRef = db.collection('hours_ledger_monthly').doc([empresaId, 'empresa', period].join('_'));
    await empresaRef.set({ worked: empresa.worked, workedOutside: empresa.workedOutside, updatedAt: new Date().toISOString() }, { merge: true });
  }
}
