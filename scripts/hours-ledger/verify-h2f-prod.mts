/**
 * Noche H2f — SOLO LECTURA contra prod. ¿El libro se recalculó solo y las pantallas coinciden?
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/verify-h2f-prod.mts [empresa,...] [yyyy-mm]
 *
 * Por empresa: flag, libro hot (engineVersion, updatedAt), jobs, sucios pendientes,
 * libro guardado vs recálculo fresco (dryRun) y las lecturas de cada pantalla sobre septiembre.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'h2-readonly';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const requireFn = createRequire(path.join(repo, 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
const deny = (what: string) => function denied() { throw new Error(`escritura bloqueada (${what})`); };
for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
CollectionReference.prototype.add = deny('add');
WriteBatch.prototype.commit = deny('batch');
Firestore.prototype.runTransaction = deny('tx');
Firestore.prototype.recursiveDelete = deny('recursiveDelete');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

const { rebuildHoursLedger } = requireFn(path.join(repo, 'apps/functions/lib/hoursLedger/rebuildHoursLedger.js'));
const { LEDGER_ENGINE_VERSION, hotPeriodKeys } = requireFn(path.join(repo, 'apps/functions/lib/hoursLedger/ledgerDirtyPlan.js'));
const { sumPublishedPlanHours } = await import('../../packages/hours-core/src/index.ts');
const { sumPlannedHoursForClient } = await import('../../apps/web2/src/lib/crm/plannedHours.ts');
const { pickVigenteSlasForPeriod, slaHoursForServiceInRange } = await import('../../apps/web2/src/lib/crm/slaObjectiveHours.ts');

const args = process.argv.slice(2);
const period = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-09';
const empresas = args.filter((a) => !/^\d{4}-\d{2}$/.test(a)).flatMap((a) => a.split(/[,\s]+/)).map((s) => s.trim()).filter(Boolean);
if (!empresas.length) empresas.push('bacarsa', 'grupos_bacar_sa');
const [py, pm] = period.split('-').map(Number);
const monthStart = new Date(`${period}-01T00:00:00.000-03:00`);
const lastDay = new Date(py, pm, 0).getDate();
const monthEnd = new Date(`${period}-${String(lastDay).padStart(2, '0')}T23:59:59.999-03:00`);
const r0 = (n: unknown) => Math.round(Number(n) || 0);

function isOperationalOriginShift(data: Record<string, unknown>) {
  const o = String(data?.origin || '').toUpperCase();
  return o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL';
}

function official(row: any) {
  return { sla: r0(row?.slaActive), planPublished: r0(row?.planPublished), worked: r0(row?.worked) };
}

async function verifyEmpresa(empresaId: string) {
  const empresaSnap = await db.collection('empresas').doc(empresaId).get();
  const flag = empresaSnap.data()?.hoursCoreEnabled === true;
  const hot: string[] = hotPeriodKeys();

  const libro: Record<string, any> = {};
  for (const pk of hot) {
    const snap = await db.collection('hours_ledger_monthly').where('empresaId', '==', empresaId).where('periodKey', '==', pk).get();
    const versions: Record<string, number> = {};
    let updatedAt = '';
    let empresaRow: any = null;
    let objetivos = 0;
    for (const d of snap.docs) {
      const data = d.data();
      const v = String(data.engineVersion ?? 'sin');
      versions[v] = (versions[v] || 0) + 1;
      if (String(data.updatedAt || '') > updatedAt) updatedAt = String(data.updatedAt || '');
      if (data.level === 'empresa') empresaRow = data;
      if (data.level === 'objetivo') objetivos += 1;
    }
    libro[pk] = {
      docs: snap.size,
      objetivos,
      versions,
      vigente: snap.size > 0 && Object.keys(versions).every((v) => Number(v) >= LEDGER_ENGINE_VERSION),
      updatedAt,
      empresa: empresaRow ? official(empresaRow) : null,
    };
  }

  const jobsSnap = await db.collection('hours_ledger_jobs').where('empresaId', '==', empresaId).get();
  const jobs = jobsSnap.docs.map((d) => {
    const j = d.data();
    return {
      id: d.id, period: j.period, dryRun: j.dryRun !== false, status: j.status, createdBy: j.createdBy,
      total: j.total, processed: j.processed, error: j.error || null, failed: Array.isArray(j.failed) ? j.failed.length : 0,
      finishedAt: j.finishedAt || null, objectiveIds: Array.isArray(j.objectiveIds) ? j.objectiveIds.length : null,
    };
  }).sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || '')));
  const dirtySnap = await db.collection('hours_ledger_dirty').where('empresaId', '==', empresaId).get();
  const dirty = dirtySnap.docs.map((d) => ({ id: d.id, reason: d.data().reason, dueAt: d.data().dueAt?.toDate?.()?.toISOString?.() }));

  const fresh = await rebuildHoursLedger({ empresaId, period, dryRun: true });
  const freshEmpresa = (fresh.monthly || []).find((m: any) => m.level === 'empresa');
  const freshOff = official(freshEmpresa);
  const stored = libro[period]?.empresa;
  const freshObj = new Map<string, any>((fresh.monthly || []).filter((m: any) => m.level === 'objetivo').map((m: any) => [m.objectiveId, m]));
  const storedObjSnap = await db.collection('hours_ledger_monthly').where('empresaId', '==', empresaId).where('periodKey', '==', period).get();
  const objDiffs: any[] = [];
  for (const d of storedObjSnap.docs) {
    const s = d.data();
    if (s.level !== 'objetivo') continue;
    const f = freshObj.get(s.objectiveId);
    const a = official(s);
    const b = official(f);
    if (a.sla !== b.sla || a.planPublished !== b.planPublished || Math.abs(a.worked - b.worked) > 1) {
      objDiffs.push({ objectiveId: s.objectiveId, name: s.objectiveName, stored: a, fresh: b });
    }
  }

  const [clientsSnap, slaSnap, planifSnap, turnosSnap] = await Promise.all([
    db.collection('clients').where('empresaId', '==', empresaId).get(),
    db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
    db.collection('planificacion_estados').where('empresaId', '==', empresaId).get(),
    db.collection('turnos').where('empresaId', '==', empresaId)
      .where('startTime', '>=', admin.firestore.Timestamp.fromDate(monthStart))
      .where('startTime', '<=', admin.firestore.Timestamp.fromDate(monthEnd)).get(),
  ]);
  const clients = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const turnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const publishedObj = new Set<string>();
  for (const d of planifSnap.docs) {
    const data = d.data();
    if (data.publishedAt == null || data.publishedAt === '') continue;
    const parsed = d.id.match(/^(.*)_(\d{4})_(\d{1,2})$/);
    const oid = String(data.objectiveId || data.objetivoId || parsed?.[1] || '').trim();
    const y = Number(data.year ?? data.año ?? parsed?.[2]);
    const mo = Number(data.month ?? data.mes ?? parsed?.[3]);
    if (oid && y === py && mo === pm) publishedObj.add(oid);
  }

  // CRM (modo Publicadas): plan por cliente desde la malla; SLA y trabajadas del libro.
  let crmPlanned = 0;
  for (const c of clients) {
    crmPlanned += Math.round(sumPlannedHoursForClient(turnos, { id: c.id, name: c.name, legalName: c.legalName, objetivos: c.objetivos || [] }, { start: monthStart, end: monthEnd }));
  }
  // Planificación → Estado de cronogramas: sumPublishedPlanHours por objetivo, sin turnos operativos.
  const byObj = new Map<string, any[]>();
  for (const t of turnos) {
    const oid = String(t.objectiveId || '').trim();
    if (!oid || isOperationalOriginShift(t)) continue;
    (byObj.get(oid) || byObj.set(oid, []).get(oid)!).push(t);
  }
  let cronoAll = 0;
  let cronoPublished = 0;
  const cronoNoPublicado: any[] = [];
  for (const [oid, list] of byObj) {
    const hs = sumPublishedPlanHours(list).hours;
    cronoAll += hs;
    if (publishedObj.has(oid)) cronoPublished += hs;
    else if (hs > 0) cronoNoPublicado.push({ objectiveId: oid, name: list[0]?.objectiveName || oid, hs: Math.round(hs) });
  }
  // Dashboard / Servicios (cálculo vivo): SLA de contratos vigentes; después pisan con el libro.
  const slas = slaSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const vivo = pickVigenteSlasForPeriod(slas, monthStart, monthEnd).reduce((s: number, srv: any) => s + slaHoursForServiceInRange(srv, monthStart, monthEnd), 0);

  const base = stored || freshOff;
  const screens = {
    banco: stored,
    servicios: { sla: stored?.sla ?? null, vivoFallback: Math.round(vivo) },
    crm: { sla: stored?.sla ?? null, planned: crmPlanned, worked: stored?.worked ?? null },
    analisis: stored,
    dashboard: { sla: stored?.sla ?? null, vivoFallback: Math.round(vivo) },
    cronogramas: { planPublicados: Math.round(cronoPublished), planTodos: Math.round(cronoAll), objetivosSinPublicar: cronoNoPublicado },
  };
  const diffs: string[] = [];
  if (!stored) diffs.push('no hay libro guardado del mes');
  if (stored && (stored.sla !== freshOff.sla || stored.planPublished !== freshOff.planPublished || Math.abs(stored.worked - freshOff.worked) > 1)) {
    diffs.push(`libro guardado ${JSON.stringify(stored)} != recálculo fresco ${JSON.stringify(freshOff)}`);
  }
  if (crmPlanned !== base.planPublished) diffs.push(`CRM plan ${crmPlanned} != libro ${base.planPublished}`);
  if (Math.round(cronoPublished) !== base.planPublished) diffs.push(`cronogramas plan publicado ${Math.round(cronoPublished)} != libro ${base.planPublished}`);
  if (Math.round(vivo) !== base.sla) diffs.push(`SLA vivo ${Math.round(vivo)} != libro ${base.sla} (inactivos, cerrados o sin plan publicado)`);

  return {
    empresaId, flag, engineVersion: LEDGER_ENGINE_VERSION, hot, libro, jobs, dirty,
    fresh: { ...freshOff, slaClosed: r0(freshEmpresa?.slaClosed), slaInactive: r0(freshEmpresa?.slaInactive), slaWithoutPlan: r0(freshEmpresa?.slaWithoutPlan), workedOutside: r0(freshEmpresa?.workedOutside) },
    objetivosDistintos: objDiffs,
    screens,
    diffs,
    turnos: turnos.length,
  };
}

const out: any[] = [];
for (const e of empresas) out.push(await verifyEmpresa(e));
const outDir = path.join(repo, 'scripts', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `verify-h2f-${period}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
