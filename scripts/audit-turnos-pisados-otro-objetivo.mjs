/**
 * Turnos de otro objetivo pisados desde la vista agrupada. SOLO LISTA.
 * No tiene modo de escritura.
 *
 *   node scripts/audit-turnos-pisados-otro-objetivo.mjs --empresa pruebas_sa --desde 2026-10-01 --hasta 2026-10-31
 *
 * Indicio: una clave empId_fecha estaba en un snapshot de un objetivo FUERA del grupo
 * y el turno actual de esa clave tiene objectiveId DENTRO del grupo.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const leer = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const EMPRESA = leer('--empresa', 'pruebas_sa');
const DESDE = leer('--desde', '2026-10-01');
const HASTA = leer('--hasta', '2026-10-31');

if (args.includes('--apply') || args.includes('--allow-prod')) {
  console.log('Este script no escribe. Se ignora --apply / --allow-prod.');
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const claveDe = (key) => {
  const m = String(key).match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
  return m ? { empId: m[1], fecha: m[2] } : null;
};
const enRango = (fecha) => fecha >= DESDE && fecha <= HASTA;
const ms = (ts) => ts?.toMillis?.() || ts?.seconds * 1000 || 0;
const cuando = (ts) => (ms(ts) ? new Date(ms(ts)).toISOString().slice(0, 16) : '-');

const clientes = await db.collection('clients').where('empresaId', '==', EMPRESA).get();
const nombreObj = new Map();
const objsEmpresa = new Set();
for (const d of clientes.docs) {
  for (const o of d.data().objetivos || []) {
    const id = String(o.id || o.name || '');
    if (!id) continue;
    objsEmpresa.add(id);
    nombreObj.set(id, o.name || id);
  }
}
const gruposSnap = await db.collection('grupos_objetivos').where('empresaId', '==', EMPRESA).get();
const grupos = gruposSnap.docs.map((d) => {
  const data = d.data();
  return {
    id: d.id,
    nombre: data.nombre || d.id,
    objectiveIds: (data.objectiveIds || []).map(String),
  };
});
console.log(`empresa ${EMPRESA} · ${DESDE} → ${HASTA}`);
console.log(`objetivos en clientes: ${objsEmpresa.size} · grupos: ${grupos.length}`);
for (const g of grupos) {
  console.log(`  grupo ${g.nombre}: ${g.objectiveIds.map((id) => nombreObj.get(id) || id).join(' · ')}`);
}

let turnos = [];
try {
  const snap = await db.collection('turnos')
    .where('empresaId', '==', EMPRESA)
    .where('scheduleDate', '>=', DESDE)
    .where('scheduleDate', '<=', HASTA)
    .get();
  turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`turnos por scheduleDate: ${turnos.length}`);
} catch (e) {
  console.log(`turnos scheduleDate no consultable (${e.message}). Pruebo startTime.`);
  try {
    const desdeTs = admin.firestore.Timestamp.fromDate(new Date(`${DESDE}T00:00:00-03:00`));
    const hastaTs = admin.firestore.Timestamp.fromDate(new Date(`${HASTA}T23:59:59-03:00`));
    const snap = await db.collection('turnos')
      .where('empresaId', '==', EMPRESA)
      .where('startTime', '>=', desdeTs)
      .where('startTime', '<=', hastaTs)
      .get();
    turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`turnos por startTime: ${turnos.length}`);
  } catch (e2) {
    console.log(`turnos startTime no consultable (${e2.message}). Sin listado de turnos.`);
  }
}

const actual = new Map();
for (const t of turnos) {
  if (t.isDeleted === true) continue;
  const fecha = String(t.scheduleDate || '').slice(0, 10);
  if (!enRango(fecha) || !t.employeeId) continue;
  const key = `${t.employeeId}_${fecha}`;
  const prev = actual.get(key);
  const row = {
    id: t.id,
    objectiveId: String(t.objectiveId || ''),
    code: String(t.code || t.type || ''),
    employeeName: t.employeeName || '',
    positionName: t.positionName || '',
    updated: t.updatedAt || t.createdAt || null,
  };
  if (!prev || ms(row.updated) >= ms(prev.updated)) actual.set(key, row);
}

const empleados = await db.collection('empleados').where('empresaId', '==', EMPRESA).get();
const nombreEmp = new Map();
const capdevilaIds = new Set();
for (const d of empleados.docs) {
  const data = d.data();
  const name = data.name || `${data.lastName || ''}, ${data.firstName || ''}`.trim();
  nombreEmp.set(d.id, name);
  if (/capdevila/i.test(name) || /capdevila/i.test(String(data.lastName || ''))) capdevilaIds.add(d.id);
}
console.log(`empleados CAPDEVILA: ${capdevilaIds.size} (${[...capdevilaIds].map((id) => nombreEmp.get(id)).join(' · ') || 'ninguno'})`);

const snapsPorObj = new Map();
for (const objId of objsEmpresa) {
  let docs = [];
  try {
    const snap = await db.collection('planificaciones_historial').where('objectiveId', '==', objId).get();
    docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.log(`historial ${objId}: ${e.message}`);
    continue;
  }
  const delPeriodo = [];
  for (const h of docs) {
    const period = String(h.period || '');
    const [mes, anio] = period.split('-');
    const mesKey = anio && mes ? `${anio}-${String(mes).padStart(2, '0')}` : '';
    if (mesKey && (mesKey < DESDE.slice(0, 7) || mesKey > HASTA.slice(0, 7))) continue;
    let parsed = {};
    try { parsed = JSON.parse(h.snapshot || '{}'); } catch { parsed = {}; }
    const keys = new Set();
    for (const k of Object.keys(parsed)) {
      const c = claveDe(k);
      if (c && enRango(c.fecha)) keys.add(k);
    }
    delPeriodo.push({
      id: h.id,
      ts: h.timestamp,
      user: h.user || '',
      keys,
      changes: Array.isArray(h.changes) ? h.changes : [],
    });
  }
  delPeriodo.sort((a, b) => ms(a.ts) - ms(b.ts));
  if (delPeriodo.length) snapsPorObj.set(objId, delPeriodo);
}
console.log(`objetivos con historial en el período: ${snapsPorObj.size}`);

const hallazgos = [];
const visto = new Set();
const anotar = (row) => {
  const id = `${row.key}|${row.fuera}|${row.dentro}|${row.motivo}`;
  if (visto.has(id)) return;
  visto.add(id);
  hallazgos.push(row);
};

for (const grupo of grupos) {
  const dentro = new Set(grupo.objectiveIds);
  const fuera = [...objsEmpresa].filter((id) => !dentro.has(id));
  for (const fueraId of fuera) {
    const snaps = snapsPorObj.get(fueraId) || [];
    if (!snaps.length) continue;
    const ultimo = snaps[snaps.length - 1];
    const algunaVez = new Set();
    for (const s of snaps) for (const k of s.keys) algunaVez.add(k);
    const tambienEnElGrupo = new Set();
    for (const dentroId of dentro) {
      for (const s of snapsPorObj.get(dentroId) || []) for (const k of s.keys) tambienEnElGrupo.add(k);
    }
    for (const key of algunaVez) {
      if (!tambienEnElGrupo.has(key)) continue;
      const turno = actual.get(key);
      const empId = claveDe(key)?.empId || '';
      const base = {
        grupo: grupo.nombre,
        key,
        emp: nombreEmp.get(empId) || turno?.employeeName || empId,
        fecha: claveDe(key)?.fecha,
        fuera: nombreObj.get(fueraId) || fueraId,
        fueraId,
        ultimoSnapshot: cuando(ultimo.ts),
      };
      if (!turno) {
        anotar({
          ...base,
          dentro: 'sin turno',
          dentroId: '',
          code: '',
          turnoId: '',
          motivo: 'estaba en un snapshot de afuera y también del grupo; hoy no hay turno ese día',
        });
        continue;
      }
      if (!dentro.has(turno.objectiveId)) continue;
      const seguiaAfuera = ultimo.keys.has(key);
      anotar({
        ...base,
        dentro: nombreObj.get(turno.objectiveId) || turno.objectiveId,
        dentroId: turno.objectiveId,
        code: turno.code,
        turnoId: turno.id,
        motivo: seguiaAfuera
          ? 'el último snapshot de afuera todavía lo tiene, pero el doc actual está en el grupo'
          : 'estaba en un snapshot de afuera y desapareció; el turno actual está en el grupo',
      });
    }
  }
}

console.log(`\nhallazgos: ${hallazgos.length}`);
for (const h of hallazgos) {
  console.log(`- ${h.fecha} ${h.emp} · era ${h.fuera} → ahora ${h.dentro} (${h.code}) · ${h.motivo}`);
  console.log(`  turno ${h.turnoId} · grupo ${h.grupo} · último snapshot afuera ${h.ultimoSnapshot}`);
}

console.log('\nCAPDEVILA — turnos del período');
if (!capdevilaIds.size) console.log('  no hay legajo CAPDEVILA en empleados de la empresa');
for (const empId of capdevilaIds) {
  const filas = [...actual.entries()]
    .filter(([k]) => k.startsWith(`${empId}_`))
    .sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`  ${nombreEmp.get(empId)} (${empId}): ${filas.length} días`);
  const porObj = new Map();
  for (const [k, t] of filas) {
    if (!porObj.has(t.objectiveId)) porObj.set(t.objectiveId, []);
    porObj.get(t.objectiveId).push(`${claveDe(k)?.fecha?.slice(8)} ${t.code}`);
  }
  for (const [obj, dias] of porObj) console.log(`    ${dias.length} en ${nombreObj.get(obj) || obj}: ${dias.join(', ')}`);
  const suyos = hallazgos.filter((h) => h.key.startsWith(`${empId}_`));
  console.log(`    indicios de pisado: ${suyos.length}`);
  for (const h of suyos) console.log(`    ${h.fecha} ${h.fuera} → ${h.dentro} · ${h.motivo}`);
}

let logsNota = 'sin consulta';
try {
  const logs = await db.collection('audit_logs')
    .where('empresaId', '==', EMPRESA)
    .where('module', '==', 'PLANIFICADOR')
    .limit(3000)
    .get();
  const filas = logs.docs.map((d) => d.data()).filter((d) => {
    const texto = `${d.details || ''} ${d.employeeName || ''}`.toLowerCase();
    return /capdevila/.test(texto);
  });
  logsNota = `${logs.size} leídos, ${filas.length} mencionan CAPDEVILA`;
  for (const d of filas.slice(0, 30)) {
    console.log(`  audit ${cuando(d.timestamp)} ${d.action || ''} · ${d.details || ''}`);
  }
} catch (e) {
  logsNota = `no consultable (${e.message})`;
}
console.log(`\naudit_logs PLANIFICADOR: ${logsNota}`);
console.log('dryRun: no se escribió nada.');
