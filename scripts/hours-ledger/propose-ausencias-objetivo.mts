/**
 * Ausencias sin objectiveId: propuesta de asignación con evidencia.
 *   npx tsx scripts/hours-ledger/propose-ausencias-objetivo.mts [empresaId ...]
 *   npx tsx scripts/hours-ledger/propose-ausencias-objetivo.mts --apply --allow-prod pruebas_sa bacarsa
 *
 * Sin --apply es dryRun (escritura bloqueada). --apply exige --allow-prod.
 * Escribe solo objectiveId, objectiveName, objectiveIdAssignedBy y objectiveIdEvidence
 * en ALTA o MEDIA con objetivo que existe en clients.objetivos (el id propuesto o el canónico por nombre).
 * HELMANN / LOPEZ (objetivo de legajo fuera de clientes, sin canónico) no se tocan: quedan en decisionHumana.
 * No borra campos. Un audit_logs por lote. Marca hours_ledger_dirty del objetivo-mes
 * (el trigger desplegado no lee startDate; el planificador ya sí, para el próximo deploy).
 *
 * Evidencia, en orden: turno vinculado (shiftId) → malla del legajo en los días de la ausencia →
 * último puesto antes / primero después (±60 días) → objetivo del legajo. Si la malla del período
 * muestra más de un objetivo y antes/después no coinciden, queda AMBIGUA con los candidatos.
 * Salida: scripts/out/ausencias-sin-objetivo-{empresa}.json (gitignored).
 */
import { classifyAusenciaObjetivo, AUSENCIA_OBJETIVO_ASSIGNED_BY } from './ausenciaObjetivoApply.ts';
import { dirtyMarksForAbsence, ledgerDirtyDocId } from '../../apps/functions/src/hoursLedger/ledgerDirtyPlan.ts';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const requireFn = createRequire(path.join(repo, 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const allowProd = argv.includes('--allow-prod');
if (apply && !allowProd) {
  console.error('Falta --allow-prod. No se escribió nada.');
  process.exit(1);
}
const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
if (!apply) {
  const deny = (what: string) => function denied() { throw new Error(`escritura bloqueada (${what})`); };
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
  CollectionReference.prototype.add = deny('add');
  WriteBatch.prototype.commit = deny('batch');
  Firestore.prototype.runTransaction = deny('tx');
  Firestore.prototype.recursiveDelete = deny('recursiveDelete');
}
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const empresas = argv.filter((a) => !a.startsWith('--'));
if (!empresas.length) empresas.push('pruebas_sa', 'bacarsa', 'grupos_bacar_sa');
const LICENSE_CODES = new Set(['V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS', 'F', 'FF', 'FP']);

function ymdAR(value: unknown): string {
  if (!value) return '';
  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  let d: Date | null = null;
  if (typeof v.toDate === 'function') d = v.toDate();
  else if (typeof (v.seconds ?? v._seconds) === 'number') d = new Date(Number(v.seconds ?? v._seconds) * 1000);
  else if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00.000-03:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function proposeEmpresa(empresaId: string) {
  const snap = await db.collection('ausencias').where('empresaId', '==', empresaId).get();
  const sin = snap.docs.filter((d) => !String(d.data().objectiveId || '').trim());
  const clients = await db.collection('clients').where('empresaId', '==', empresaId).get();
  const objName = new Map<string, string>();
  const objPlain = new Map<string, string>();
  const clientObjIds = new Set<string>();
  const canonicalByName = new Map<string, string>();
  for (const c of clients.docs) {
    for (const o of (c.data().objetivos || []) as Array<{ id?: string; name?: string }>) {
      if (!o?.id) continue;
      objName.set(String(o.id), `${o.name || o.id} (${c.data().name || c.id})`);
      objPlain.set(String(o.id), String(o.name || o.id));
      clientObjIds.add(String(o.id));
      if (o.name) canonicalByName.set(String(o.name).trim().toLowerCase(), String(o.id));
    }
  }
  const turnoObjName = new Map<string, string>();
  const rows: any[] = [];
  for (const d of sin) {
    const a = d.data();
    const employeeId = String(a.employeeId || '').trim();
    const start = ymdAR(a.startDate || a.fecha);
    const end = ymdAR(a.endDate) || start;
    const evidence: Record<string, unknown> = {};
    const candidates = new Map<string, { rango: number; codigos: Set<string>; antes: number; despues: number }>();
    const bump = (oid: string, k: 'rango' | 'antes' | 'despues', code?: string) => {
      if (!oid) return;
      const c = candidates.get(oid) || { rango: 0, codigos: new Set<string>(), antes: 0, despues: 0 };
      c[k] += 1;
      if (code) c.codigos.add(code);
      candidates.set(oid, c);
    };
    let linked = '';
    if (a.shiftId) {
      const s = await db.collection('turnos').doc(String(a.shiftId)).get();
      linked = String(s.data()?.objectiveId || '').trim();
      evidence.turnoVinculado = s.exists ? { shiftId: a.shiftId, objectiveId: linked, code: s.data()?.code } : { shiftId: a.shiftId, existe: false };
    }
    let before = '';
    let beforeDay = '';
    let after = '';
    let afterDay = '';
    if (employeeId && start) {
      const from = new Date(`${addDays(start, -60)}T00:00:00.000-03:00`);
      const to = new Date(`${addDays(end, 60)}T23:59:59.999-03:00`);
      const ts = await db.collection('turnos').where('employeeId', '==', employeeId)
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(from))
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(to))
        .select('objectiveId', 'objectiveName', 'code', 'startTime', 'draft', 'origin').get();
      const list = ts.docs.map((t) => ({ ...t.data(), day: ymdAR(t.data().startTime) })).filter((t) => t.day && String(t.objectiveId || '').trim());
      for (const t of list) {
        const oid = String(t.objectiveId).trim();
        const code = String(t.code || '').toUpperCase();
        if (t.day >= start && t.day <= end) bump(oid, 'rango', code || '(sin)');
        else if (t.day < start && !LICENSE_CODES.has(code)) {
          bump(oid, 'antes');
          if (t.day > beforeDay) { beforeDay = t.day; before = oid; }
        } else if (t.day > end && !LICENSE_CODES.has(code)) {
          bump(oid, 'despues');
          if (!afterDay || t.day < afterDay) { afterDay = t.day; after = oid; }
        }
        if (t.objectiveName) turnoObjName.set(oid, String(t.objectiveName));
        if (!objName.has(oid) && t.objectiveName) objName.set(oid, `${t.objectiveName} (sin cliente)`);
      }
      evidence.turnosLegajo120d = list.length;
    }
    let legajoObj = '';
    if (employeeId) {
      const e = await db.collection('empleados').doc(employeeId).get();
      legajoObj = String(e.data()?.preferredObjectiveId || e.data()?.objectiveId || e.data()?.objetivoId || '').trim();
      if (legajoObj) evidence.objetivoLegajo = legajoObj;
    }
    const inRange = [...candidates.entries()].filter(([, c]) => c.rango > 0).map(([oid]) => oid);
    let propuesta = '';
    let fuente = '';
    let confianza: 'ALTA' | 'MEDIA' | 'AMBIGUA' | 'SIN_EVIDENCIA' = 'SIN_EVIDENCIA';
    if (linked) { propuesta = linked; fuente = 'turno vinculado (shiftId)'; confianza = 'ALTA'; }
    else if (inRange.length === 1) { propuesta = inRange[0]; fuente = 'malla del legajo en los días de la ausencia'; confianza = 'ALTA'; }
    else if (inRange.length > 1) { propuesta = ''; fuente = `malla con ${inRange.length} objetivos en el rango`; confianza = 'AMBIGUA'; }
    else if (before && after && before === after) { propuesta = before; fuente = `mismo puesto antes (${beforeDay}) y después (${afterDay})`; confianza = 'ALTA'; }
    else if (before && !after) { propuesta = before; fuente = `último puesto antes (${beforeDay}); sin malla después`; confianza = 'MEDIA'; }
    else if (!before && after) { propuesta = after; fuente = `primer puesto después (${afterDay}); sin malla antes`; confianza = 'MEDIA'; }
    else if (before && after) { propuesta = ''; fuente = `antes ${before} (${beforeDay}) ≠ después ${after} (${afterDay})`; confianza = 'AMBIGUA'; }
    else if (legajoObj) { propuesta = legajoObj; fuente = 'objetivo del legajo'; confianza = 'MEDIA'; }
    // El id propuesto puede ser un objetivo viejo que ya no está en clients.objetivos: se sugiere el canónico por nombre.
    let canonicoSugerido = '';
    if (propuesta && !clientObjIds.has(propuesta)) {
      const byName = canonicalByName.get(String(turnoObjName.get(propuesta) || '').trim().toLowerCase());
      canonicoSugerido = byName || '';
      if (confianza === 'ALTA') confianza = 'MEDIA';
      fuente += canonicoSugerido ? `; el id no está en clients.objetivos → canónico por nombre ${canonicoSugerido}` : '; el id no está en clients.objetivos';
    }
    const decision = classifyAusenciaObjetivo({ confianza, propuesta, canonicoSugerido }, clientObjIds);
    rows.push({
      id: d.id, empresaId, employeeId, employee: a.employeeName || '', type: a.type || a.codigo || a.code, status: a.status, start, end,
      propuesta, propuestaNombre: propuesta ? objName.get(propuesta) || propuesta : '', canonicoSugerido, fuente, confianza,
      accion: decision.action,
      objetivoAplicar: decision.objectiveId,
      objectiveName: decision.objectiveId ? (objPlain.get(decision.objectiveId) || '') : '',
      evidenceCorta: fuente.slice(0, 240),
      candidatos: [...candidates.entries()].map(([oid, c]) => ({ objectiveId: oid, nombre: objName.get(oid) || oid, enRango: c.rango, codigos: [...c.codigos], antes: c.antes, despues: c.despues }))
        .sort((x, y) => (y.enRango - x.enRango) || ((y.antes + y.despues) - (x.antes + x.despues))),
      evidence,
    });
  }
  const resumen = { empresaId, ausencias: snap.size, sinObjetivo: sin.length, ALTA: 0, MEDIA: 0, AMBIGUA: 0, SIN_EVIDENCIA: 0, aplicar: 0, decisionHumana: 0 } as Record<string, unknown>;
  for (const r of rows) {
    resumen[r.confianza] = Number(resumen[r.confianza] || 0) + 1;
    if (r.accion === 'APLICAR') resumen.aplicar = Number(resumen.aplicar) + 1;
    else resumen.decisionHumana = Number(resumen.decisionHumana) + 1;
  }
  fs.mkdirSync(path.join(repo, 'scripts', 'out'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts', 'out', `ausencias-sin-objetivo-${empresaId}.json`), JSON.stringify({ resumen, dryRun: !apply, rows }, null, 2));
  const humana = rows.filter((r) => r.accion !== 'APLICAR').map((r) => ({
    id: r.id, employee: r.employee, type: r.type, start: r.start, end: r.end, confianza: r.confianza, fuente: r.fuente, propuesta: r.propuestaNombre,
  }));
  return { resumen, decisionHumana: humana, rows };
}

async function applyEmpresa(empresaId: string, rows: any[]) {
  const patches = rows.filter((r) => r.accion === 'APLICAR' && r.objetivoAplicar);
  const empresa = await db.collection('empresas').doc(empresaId).get();
  const coreOn = empresa.data()?.hoursCoreEnabled === true;
  const CHUNK = 400;
  let written = 0;
  const dirtyIds = new Set<string>();
  for (let i = 0; i < patches.length; i += CHUNK) {
    const slice = patches.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const p of slice) {
      const patch: Record<string, string> = {
        objectiveId: p.objetivoAplicar,
        objectiveIdAssignedBy: AUSENCIA_OBJETIVO_ASSIGNED_BY,
        objectiveIdEvidence: String(p.evidenceCorta || '').slice(0, 240),
      };
      if (p.objectiveName) patch.objectiveName = p.objectiveName;
      batch.update(db.collection('ausencias').doc(p.id), patch);
    }
    await batch.commit();
    await db.collection('audit_logs').add({
      action: 'AUSENCIA_OBJETIVO_ASIGNADO',
      actorName: AUSENCIA_OBJETIVO_ASSIGNED_BY,
      actorUid: 'SCRIPT',
      module: 'RRHH',
      empresaId,
      count: slice.length,
      ausenciaIds: slice.map((p) => p.id),
      details: `objectiveId en ${slice.length} ausencias (ALTA o MEDIA con objetivo en clients). Sin borrar campos.`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    written += slice.length;
    if (coreOn) {
      const due = admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
      const dirtyBatch = db.batch();
      let n = 0;
      for (const p of slice) {
        for (const m of dirtyMarksForAbsence({ empresaId, objectiveId: p.objetivoAplicar, startDate: p.start, endDate: p.end || p.start })) {
          const id = ledgerDirtyDocId(m.empresaId, m.objectiveId, m.periodKey);
          if (dirtyIds.has(id)) continue;
          dirtyIds.add(id);
          dirtyBatch.set(db.collection('hours_ledger_dirty').doc(id), {
            empresaId: m.empresaId,
            objectiveId: m.objectiveId,
            periodKey: m.periodKey,
            reason: 'ausencia',
            dueAt: due,
            touchAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          n += 1;
        }
      }
      if (n) await dirtyBatch.commit();
    }
  }
  return { written, dirty: dirtyIds.size, hoursCoreEnabled: coreOn };
}

const out: any[] = [];
for (const e of empresas) {
  const proposed = await proposeEmpresa(e);
  let applied = null;
  if (apply) applied = await applyEmpresa(e, proposed.rows);
  out.push({ resumen: proposed.resumen, decisionHumana: proposed.decisionHumana, applied });
}
console.log(JSON.stringify(out, null, 2));
process.exit(0);
