import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { buildLedgerMonth, personaMonthWorked } from './bundledEngine';
import { LEDGER_ENGINE_VERSION, ledgerDirtyDocId, hotPeriodKeys, objectivesNeedingEngine } from './ledgerDirtyPlan';

const DAY_COL = 'hours_ledger';
const MONTH_COL = 'hours_ledger_monthly';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function arParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { year: Number(get('year')), month: Number(get('month')), day: get('day') };
}

export function parsePeriod(period: string, now = new Date()) {
  const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), periodKey: `${m[1]}-${m[2]}` };
  const ar = arParts(now);
  return { year: ar.year, month: ar.month, periodKey: `${ar.year}-${pad(ar.month)}` };
}

function publishMap(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const map: Record<string, boolean> = {};
  for (const d of docs) {
    const data = d.data();
    if (data.publishedAt == null || data.publishedAt === '') continue;
    const id = d.id;
    const parsed = id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
    const oid = String(data.objectiveId || data.objetivoId || parsed?.[1] || '').trim();
    const y = Number(data.year ?? data.año ?? parsed?.[2]);
    const mo = Number(data.month ?? data.mes ?? parsed?.[3]);
    if (oid && Number.isFinite(y) && Number.isFinite(mo)) map[`${oid}_${y}_${mo}`] = true;
  }
  return map;
}

function docId(parts: string[]) {
  return parts.join('_').replace(/[/\s#?[\]]+/g, '_').slice(0, 700);
}

const coreFlagCache = new Map<string, { on: boolean; at: number }>();

export async function hoursCoreOn(empresaId: string): Promise<boolean> {
  const hit = coreFlagCache.get(empresaId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  const snap = await admin.firestore().collection('empresas').doc(empresaId).get();
  const on = snap.data()?.hoursCoreEnabled === true;
  coreFlagCache.set(empresaId, { on, at: Date.now() });
  return on;
}

/**
 * Doc id siempre gana sobre un campo `id` del data. Los clients clonados entre empresas
 * (pruebas_sa) traen el `id` viejo de bacarsa y el libro terminaba agrupando por un cliente borrado.
 */
function withDocId(d: FirebaseFirestore.QueryDocumentSnapshot) {
  return { ...d.data(), id: d.id };
}

async function loadMonth(empresaId: string, year: number, month: number, opts?: {
  objectiveIds?: string[];
  skipPersona?: boolean;
  includeUnscopedPaidAbsences?: boolean;
}) {
  const db = admin.firestore();
  const start = new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`);
  const endDay = new Date(year, month, 0).getDate();
  const end = new Date(`${year}-${pad(month)}-${pad(endDay)}T23:59:59.999-03:00`);
  const onlyIds = [...new Set((opts?.objectiveIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  let turnosQuery: FirebaseFirestore.Query = db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('startTime', '>=', Timestamp.fromDate(start))
    .where('startTime', '<=', Timestamp.fromDate(end));
  if (onlyIds.length > 0 && onlyIds.length <= 30) {
    turnosQuery = db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('objectiveId', 'in', onlyIds)
      .where('startTime', '>=', Timestamp.fromDate(start))
      .where('startTime', '<=', Timestamp.fromDate(end));
  }
  const [empresaSnap, clientsSnap, slaSnap, planifSnap, empSnap, ausSnap, contractsSnap, ordersSnap, turnosSnap] = await Promise.all([
    db.collection('empresas').doc(empresaId).get(),
    db.collection('clients').where('empresaId', '==', empresaId).get(),
    db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
    db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
    db.collection('empleados').where('empresaId', '==', empresaId).get(),
    db.collection('ausencias').where('empresaId', '==', empresaId).get(),
    db.collection('contracts').get(),
    db.collection('ordenes_compra').where('empresaId', '==', empresaId).get(),
    turnosQuery.get(),
  ]);
  const empNameById: Record<string, string> = {};
  empSnap.docs.forEach((d) => {
    const e = d.data();
    const st = String(e.status || '').toLowerCase();
    if (st === 'inactive' || st === 'inactivo') return;
    empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
  });
  const clientIds = new Set(clientsSnap.docs.map((d) => d.id));
  const built = buildLedgerMonth({
    empresaId,
    year,
    month,
    hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
    clients: clientsSnap.docs.map(withDocId),
    slas: slaSnap.docs.map(withDocId),
    turnos: turnosSnap.docs.map(withDocId),
    ausencias: ausSnap.docs.map(withDocId),
    publishStatusMap: publishMap(planifSnap.docs),
    empNameById,
    onlyObjectiveIds: opts?.objectiveIds,
    skipPersona: opts?.skipPersona === true,
    includeUnscopedPaidAbsences: opts?.includeUnscopedPaidAbsences,
    contracts: contractsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => clientIds.has(String((c as { clientId?: string }).clientId || ''))),
    purchaseOrders: ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  });
  return built;
}

function roundTotals(t: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) out[k] = Math.round(Number(v) || 0);
  return out;
}

async function commitWrites(rows: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>) {
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
  if (n > 0) await batch.commit();
}

async function deleteStale(col: string, empresaId: string, periodKey: string, keep: Set<string>) {
  const db = admin.firestore();
  const snap = await db.collection(col).where('empresaId', '==', empresaId).where('periodKey', '==', periodKey).get();
  let batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if (keep.has(d.id)) continue;
    batch.delete(d.ref);
    n += 1;
    if (n >= 400) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

export async function rebuildHoursLedger(opts: {
  empresaId: string;
  period?: string;
  dryRun?: boolean;
}) {
  const empresaId = String(opts.empresaId || '').trim();
  if (!empresaId) throw new Error('empresaId requerido');
  const { year, month, periodKey } = parsePeriod(opts.period || '');
  const dryRun = opts.dryRun !== false;
  const built = await loadMonth(empresaId, year, month);
  const db = admin.firestore();
  const now = new Date().toISOString();

  const dayRows = built.days.map((d) => {
    const id = docId([empresaId, d.objectiveId, d.puestoId, d.date]);
    return { id, data: { ...d, id, updatedAt: now, engineVersion: LEDGER_ENGINE_VERSION } };
  });
  const monthRows = built.monthly.map((m) => {
    const id = m.level === 'empresa'
      ? docId([empresaId, 'empresa', periodKey])
      : m.level === 'cliente'
        ? docId([empresaId, 'cli', m.clientId || 'sin', periodKey])
        : docId([empresaId, 'obj', m.objectiveId, periodKey]);
    return { id, data: { ...m, id, updatedAt: now, engineVersion: LEDGER_ENGINE_VERSION } };
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

export async function markLedgerDirty(opts: {
  empresaId: string;
  objectiveId?: string;
  periodKey?: string;
  reason?: string;
}) {
  const empresaId = String(opts.empresaId || '').trim();
  const objectiveId = String(opts.objectiveId || '').trim();
  const periodKey = String(opts.periodKey || '').trim();
  if (!empresaId || !objectiveId || !/^\d{4}-\d{2}$/.test(periodKey)) return;
  if (!(await hoursCoreOn(empresaId))) return;
  const id = ledgerDirtyDocId(empresaId, objectiveId, periodKey);
  const due = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
  await admin.firestore().collection('hours_ledger_dirty').doc(id).set({
    empresaId,
    objectiveId,
    periodKey,
    reason: opts.reason || '',
    dueAt: due,
    touchAt: Timestamp.now(),
  }, { merge: true });
}

type DirtyGroup = { empresaId: string; period: string; ids: Set<string>; full: boolean; refs: FirebaseFirestore.DocumentReference[] };

/** Solo los objetivos marcados sucios. `_empresa` (cambio de cliente) encola el mes entero. */
export async function runDueLedgerDirty(limit = 20) {
  const db = admin.firestore();
  const snap = await db.collection('hours_ledger_dirty').where('dueAt', '<=', Timestamp.now()).limit(limit).get();
  if (snap.empty) return { processed: 0, months: 0 };
  const groups = new Map<string, DirtyGroup>();
  for (const d of snap.docs) {
    const data = d.data();
    const empresaId = String(data.empresaId || '');
    const period = String(data.periodKey || '');
    const key = `${empresaId}|${period}`;
    const g = groups.get(key) || { empresaId, period, ids: new Set<string>(), full: false, refs: [] };
    const oid = String(data.objectiveId || '');
    if (!oid || oid === '_empresa') g.full = true;
    else g.ids.add(oid);
    g.refs.push(d.ref);
    groups.set(key, g);
  }
  const { enqueueHoursLedgerJob } = await import('./hoursLedgerJob');
  for (const g of groups.values()) {
    if (!(await hoursCoreOn(g.empresaId))) {
      for (const ref of g.refs) await ref.delete();
      continue;
    }
    const queued = await enqueueHoursLedgerJob({
      empresaId: g.empresaId,
      period: g.period,
      dryRun: false,
      createdBy: 'sucio',
      objectiveIds: g.full || g.ids.size === 0 ? undefined : [...g.ids],
    });
    if (queued.covered === false) {
      const later = Timestamp.fromMillis(Date.now() + 5 * 60 * 1000);
      for (const ref of g.refs) await ref.set({ dueAt: later }, { merge: true });
      continue;
    }
    for (const ref of g.refs) await ref.delete();
  }
  const { stepHoursLedgerJob } = await import('./hoursLedgerJob');
  const stuck = await db.collection('hours_ledger_jobs').where('status', 'in', ['QUEUED', 'RUNNING']).limit(3).get();
  for (const d of stuck.docs) {
    const lock = typeof d.data().lockUntil?.toMillis === 'function' ? d.data().lockUntil.toMillis() : 0;
    if (lock < Date.now()) await stepHoursLedgerJob(d.id);
  }
  return { processed: snap.size, months: groups.size };
}

export async function rebuildObjectives(opts: {
  empresaId: string;
  period?: string;
  objectiveIds: string[];
  dryRun?: boolean;
  includeUnscopedPaidAbsences?: boolean;
}) {
  const empresaId = String(opts.empresaId || '').trim();
  const ids = [...new Set(opts.objectiveIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const { year, month, periodKey } = parsePeriod(opts.period || '');
  const dryRun = opts.dryRun !== false;
  const built = await loadMonth(empresaId, year, month, {
    objectiveIds: ids,
    skipPersona: true,
    includeUnscopedPaidAbsences: opts.includeUnscopedPaidAbsences === true,
  });
  const objectives = built.monthly.filter((m) => m.level === 'objetivo');
  const now = new Date().toISOString();
  const dayRows = built.days.map((d) => {
    const id = docId([empresaId, d.objectiveId, d.puestoId, d.date]);
    return { id, data: { ...d, id, updatedAt: now, engineVersion: LEDGER_ENGINE_VERSION } };
  });
  const monthRows = objectives.map((m) => {
    const id = docId([empresaId, 'obj', m.objectiveId, periodKey]);
    return { id, data: { ...m, id, updatedAt: now, engineVersion: LEDGER_ENGINE_VERSION } };
  });
  if (!dryRun) {
    await preserveWorked(monthRows);
    await commitWrites(dayRows.map((r) => ({ ref: admin.firestore().collection(DAY_COL).doc(r.id), data: r.data })));
    await commitWrites(monthRows.map((r) => ({ ref: admin.firestore().collection(MONTH_COL).doc(r.id), data: r.data })));
  }
  return { periodKey, objectives, days: built.days, dryRun };
}

async function preserveWorked(monthRows: Array<{ id: string; data: Record<string, unknown> }>) {
  const db = admin.firestore();
  for (let i = 0; i < monthRows.length; i += 100) {
    const slice = monthRows.slice(i, i + 100);
    const prev = await db.getAll(...slice.map((r) => db.collection(MONTH_COL).doc(r.id)));
    prev.forEach((snap, idx) => {
      if (!snap.exists) return;
      const worked = Number(snap.data()?.worked) || 0;
      if (worked > 0) slice[idx].data.worked = worked;
    });
  }
}

/** Rearma cliente/empresa desde los objetivos ya guardados. No toca trabajadas de empresa. */
export async function rollupStoredMonth(empresaId: string, periodKey: string) {
  const db = admin.firestore();
  const snap = await db.collection(MONTH_COL).where('empresaId', '==', empresaId).where('periodKey', '==', periodKey).get();
  const objectives = snap.docs.map((d) => d.data()).filter((d) => d.level === 'objetivo');
  const prevEmpresa = snap.docs.find((d) => d.data().level === 'empresa')?.data();
  const now = new Date().toISOString();
  const blank = () => ({
    slaActive: 0, slaInactive: 0, slaClosed: 0, slaWithoutPlan: 0, planPublished: 0, planDraft: 0, worked: 0, workedOutside: 0,
    covered: 0, uncovered: 0, ft: 0, ext: 0, adv: 0, novedadPaga: 0, novedadPagaOutside: 0,
    licV: 0, licE: 0, licL: 0, licA: 0, licPG: 0, licSUS: 0, licSGS: 0,
    ausenciaHoras: 0, ausenciaHorasOutside: 0, ausenciaTurnos: 0, ausenciaTurnosOutside: 0, ausenciaLegajos: 0,
    uncoveredAusencia: 0, uncoveredRetiro: 0, uncoveredFaltaPlan: 0,
    billable: 0, workedNotBilled: 0, billedNotWorked: 0,
  });
  const keys = Object.keys(blank());
  const add = (a: Record<string, number>, b: Record<string, unknown>) => {
    for (const k of keys) a[k] = Math.round(((Number(a[k]) || 0) + (Number(b[k]) || 0)) * 10) / 10;
  };
  const byClient = new Map<string, Record<string, unknown>>();
  const empresa = blank();
  for (const m of objectives) {
    add(empresa, m);
    const cid = String(m.clientId || '_sin_cliente');
    let c = byClient.get(cid);
    if (!c) {
      c = {
        empresaId, periodKey, level: 'cliente', clientId: m.clientId || '', clientName: m.clientName || 'Sin cliente',
        objectiveId: '', objectiveName: '', hoursCoreEnabled: prevEmpresa?.hoursCoreEnabled === true, ...blank(),
      };
      byClient.set(cid, c);
    }
    add(c as Record<string, number>, m);
  }
  empresa.worked = Number(prevEmpresa?.worked) || empresa.worked;
  const empresaIdDoc = docId([empresaId, 'empresa', periodKey]);
  const rows = [
    {
      id: empresaIdDoc,
      data: {
        empresaId, periodKey, level: 'empresa', clientId: '', clientName: '', objectiveId: '', objectiveName: '',
        hoursCoreEnabled: prevEmpresa?.hoursCoreEnabled === true, ...empresa, id: empresaIdDoc, updatedAt: now,
        engineVersion: LEDGER_ENGINE_VERSION,
      },
    },
    ...[...byClient.entries()].map(([cid, c]) => {
      const id = docId([empresaId, 'cli', cid === '_sin_cliente' ? 'sin' : cid, periodKey]);
      return { id, data: { ...c, id, updatedAt: now, engineVersion: LEDGER_ENGINE_VERSION } };
    }),
  ];
  await commitWrites(rows.map((r) => ({ ref: db.collection(MONTH_COL).doc(r.id), data: r.data })));
  const keep = new Set([...rows.map((r) => r.id), ...snap.docs.filter((d) => d.data().level === 'objetivo').map((d) => d.id)]);
  await deleteStale(MONTH_COL, empresaId, periodKey, keep);
}

export async function personaOfMonth(empresaId: string, period: string) {
  const { year, month } = parsePeriod(period);
  const db = admin.firestore();
  const start = new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`);
  const endDay = new Date(year, month, 0).getDate();
  const end = new Date(`${year}-${pad(month)}-${pad(endDay)}T23:59:59.999-03:00`);
  const [empresaSnap, empSnap, ausSnap, planifSnap, turnosSnap] = await Promise.all([
    db.collection('empresas').doc(empresaId).get(),
    db.collection('empleados').where('empresaId', '==', empresaId).get(),
    db.collection('ausencias').where('empresaId', '==', empresaId).get(),
    db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
    db.collection('turnos').where('empresaId', '==', empresaId).where('startTime', '>=', Timestamp.fromDate(start)).where('startTime', '<=', Timestamp.fromDate(end)).get(),
  ]);
  const empNameById: Record<string, string> = {};
  empSnap.docs.forEach((d) => {
    const e = d.data();
    const st = String(e.status || '').toLowerCase();
    if (st === 'inactive' || st === 'inactivo') return;
    empNameById[d.id] = String(e.nombre || e.name || e.displayName || d.id);
  });
  return personaMonthWorked({
    turnos: turnosSnap.docs.map(withDocId),
    ausencias: ausSnap.docs.map(withDocId),
    publishStatusMap: publishMap(planifSnap.docs),
    year,
    month,
    hoursCoreEnabled: empresaSnap.data()?.hoursCoreEnabled === true,
    empNameById,
  });
}

export async function rebuildOpenMonthAllEmpresas() {
  const { enqueueOpenMonthAllEmpresas } = await import('./hoursLedgerJob');
  return enqueueOpenMonthAllEmpresas();
}

/** Meses hot cuyo libro tiene engineVersion vieja: el job H2c los reescribe en tandas. */
export async function enqueueStaleEngineMonths(limitEmpresas = 6) {
  const { enqueueHoursLedgerJob } = await import('./hoursLedgerJob');
  const empresas = await admin.firestore().collection('empresas').where('hoursCoreEnabled', '==', true).limit(limitEmpresas).get();
  const periods = hotPeriodKeys();
  let enqueued = 0;
  for (const e of empresas.docs) {
    for (const period of periods) {
      const snap = await admin.firestore().collection(MONTH_COL)
        .where('empresaId', '==', e.id)
        .where('periodKey', '==', period)
        .select('level', 'objectiveId', 'engineVersion')
        .get();
      const stale = objectivesNeedingEngine(snap.docs.map((d) => d.data() as { level?: string; objectiveId?: string; engineVersion?: unknown }));
      if (!stale.length) continue;
      await enqueueHoursLedgerJob({
        empresaId: e.id,
        period,
        dryRun: false,
        createdBy: 'engine',
        objectiveIds: stale,
      });
      enqueued += 1;
    }
  }
  return { enqueued, version: LEDGER_ENGINE_VERSION };
}
