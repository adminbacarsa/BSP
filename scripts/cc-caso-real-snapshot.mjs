/**
 * Casos reales del Centro de Comando: snapshot de prod (SOLO LECTURA) → JSON → emulador.
 *
 * export (prod comtroldata vía ADC, no escribe nada en prod):
 *   gcloud auth application-default login   # si hace falta
 *   node scripts/cc-caso-real-snapshot.mjs export --empresa pruebas_sa --objective "CAPS Angelelli" --date 2026-09-26 [--lookback 7] [--shift <id> ...] [--name caps-angelelli-2026-09-26]
 *
 * load (solo emulador; por defecto proyecto aislado demo-cc-casos para no pisar el lab):
 *   node scripts/cc-caso-real-snapshot.mjs load --name caps-angelelli-2026-09-26 [--project demo-cc-casos]
 *
 * Salida: scripts/out/cc-casos/{name}.json (gitignored: contiene datos personales).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const DEFAULT_LOAD_PROJECT = 'demo-cc-casos';
const OUT_DIR = path.join(__dirname, 'out', 'cc-casos');
const AR_OFFSET_MS = 3 * 3600000;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd, shift: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    if (key === 'shift') opts.shift.push(val);
    else opts[key] = val;
  }
  return opts;
}

function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 00:00 AR del día `ymd` + `addDays`, en ms UTC. */
function arDayStartMs(ymd, addDays = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d + addDays, 0, 0, 0) + AR_OFFSET_MS;
}

function fmtAr(ms) {
  if (ms == null) return '—';
  const d = new Date(ms - AR_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function tsMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v.__ts === 'number') return v.__ts;
  if (typeof v === 'object' && typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof admin.firestore.Timestamp) return { __ts: value.toMillis() };
  if (value instanceof admin.firestore.GeoPoint) return { __geo: [value.latitude, value.longitude] };
  if (value instanceof admin.firestore.DocumentReference) return { __ref: value.path };
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

function deserialize(value, db) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => deserialize(v, db));
  if (typeof value === 'object') {
    if (typeof value.__ts === 'number' && Object.keys(value).length === 1) {
      return admin.firestore.Timestamp.fromMillis(value.__ts);
    }
    if (Array.isArray(value.__geo) && Object.keys(value).length === 1) {
      return new admin.firestore.GeoPoint(value.__geo[0], value.__geo[1]);
    }
    if (typeof value.__ref === 'string' && Object.keys(value).length === 1) {
      return db.doc(value.__ref);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deserialize(v, db);
    return out;
  }
  return value;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function queryWithFallback(label, primary, fallback, filterFn) {
  try {
    const snap = await primary();
    return snap.docs;
  } catch (e) {
    console.warn(`[snapshot] ${label}: query con rango falló (${e.code || e.message}); filtro en memoria.`);
    const snap = await fallback();
    return snap.docs.filter((d) => filterFn(d.data()));
  }
}

async function resolveEmpresa(db, empresaArg) {
  const direct = await db.collection('empresas').doc(empresaArg).get();
  if (direct.exists) return direct;
  for (const field of ['slug', 'code', 'nombre', 'name']) {
    const q = await db.collection('empresas').where(field, '==', empresaArg).limit(1).get();
    if (!q.empty) return q.docs[0];
  }
  throw new Error(`Empresa no encontrada: ${empresaArg}`);
}

async function resolveObjective(db, empresaId, objectiveArg) {
  const clients = await db.collection('clients').where('empresaId', '==', empresaId).get();
  const needle = slug(objectiveArg);
  const matches = [];
  for (const c of clients.docs) {
    const objetivos = Array.isArray(c.data().objetivos) ? c.data().objetivos : [];
    for (const o of objetivos) {
      const id = String(o?.id || '');
      const name = String(o?.name || o?.nombre || '');
      if (id === objectiveArg || (needle && slug(name).includes(needle))) {
        matches.push({ clientDoc: c, objectiveId: id, objectiveName: name });
      }
    }
  }
  if (matches.length === 0) throw new Error(`Objetivo no encontrado en ${empresaId}: ${objectiveArg}`);
  if (matches.length > 1) {
    const list = matches.map((m) => `${m.objectiveId} (${m.objectiveName})`).join(', ');
    throw new Error(`Objetivo ambiguo "${objectiveArg}": ${list}. Pasá el id.`);
  }
  return matches[0];
}

async function runExport(opts) {
  if (!opts.empresa || !opts.objective || !opts.date) {
    throw new Error('export requiere --empresa --objective --date (YYYY-MM-DD)');
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  const db = admin.firestore();

  const lookback = Number(opts.lookback ?? 7);
  const empresaDoc = await resolveEmpresa(db, opts.empresa);
  const empresaId = empresaDoc.id;
  const { clientDoc, objectiveId, objectiveName } = await resolveObjective(db, empresaId, opts.objective);
  const clientId = clientDoc.id;

  const fromMs = arDayStartMs(opts.date, -lookback);
  const toMs = arDayStartMs(opts.date, 2);
  const nearFromMs = arDayStartMs(opts.date, -1);
  const fromTs = admin.firestore.Timestamp.fromMillis(fromMs);
  const toTs = admin.firestore.Timestamp.fromMillis(toMs);
  const nearFromTs = admin.firestore.Timestamp.fromMillis(nearFromMs);

  const docs = new Map();
  const put = (snap) => {
    if (snap?.exists) docs.set(snap.ref.path, serialize(snap.data()));
  };

  put(empresaDoc);
  put(clientDoc);

  const inRange = (data, a, b) => {
    const ms = tsMs(data.startTime);
    return ms != null && ms >= a && ms < b;
  };

  const objectiveShifts = await queryWithFallback(
    'turnos objetivo',
    () => db.collection('turnos').where('objectiveId', '==', objectiveId)
      .where('startTime', '>=', fromTs).where('startTime', '<', toTs).get(),
    () => db.collection('turnos').where('objectiveId', '==', objectiveId).get(),
    (d) => inRange(d, fromMs, toMs),
  );
  // Días previos: solo los que seguían abiertos al empezar el día del caso (zombis).
  const keepShift = (data) => {
    const start = tsMs(data.startTime);
    if (start != null && start >= nearFromMs) return true;
    const wasPresent = data.status === 'PRESENT' || data.isPresent === true
      || tsMs(data.realStartTime) != null || data.completionReason === 'AUTO_ZOMBIE_12H';
    const closedAt = tsMs(data.completedAt) ?? tsMs(data.realEndTime);
    return wasPresent && (data.isCompleted !== true || (closedAt != null && closedAt >= nearFromMs));
  };
  for (const d of objectiveShifts) {
    if (keepShift(d.data())) put(d);
  }

  for (const id of opts.shift) put(await db.collection('turnos').doc(id).get());

  const shiftPaths = () => [...docs.keys()].filter((p) => p.startsWith('turnos/'));
  const employeeIds = new Set();
  for (const p of shiftPaths()) {
    const e = docs.get(p).employeeId;
    if (e && e !== 'VACANTE') employeeIds.add(String(e));
  }

  for (const empId of employeeIds) {
    const empShifts = await queryWithFallback(
      `turnos empleado ${empId}`,
      () => db.collection('turnos').where('employeeId', '==', empId)
        .where('startTime', '>=', fromTs).where('startTime', '<', toTs).get(),
      () => db.collection('turnos').where('employeeId', '==', empId).get(),
      (d) => inRange(d, fromMs, toMs),
    );
    for (const d of empShifts) {
      if (keepShift(d.data())) put(d);
    }
    put(await db.collection('empleados').doc(empId).get());
  }

  for (const ids of chunk(shiftPaths().map((p) => p.split('/')[1]), 30)) {
    const conv = await db.collection('convocatorias_cobertura').where('shiftId', 'in', ids).get();
    conv.docs.forEach(put);
  }
  const convObj = await db.collection('convocatorias_cobertura').where('objectiveId', '==', objectiveId).get();
  convObj.docs.filter((d) => inRange(d.data(), nearFromMs, toMs)).forEach(put);

  const LINK_FIELDS = [
    'extendShiftId', 'advanceShiftId', 'candidateShiftId', 'sourceShiftId', 'coverageSourceShiftId',
    'absenceShiftId', 'coveredShiftId', 'titularShiftId', 'causedByShiftId', 'retentionAbsenceShiftId',
    'shiftId', 'extendedShiftId',
  ];
  for (let hop = 0; hop < 2; hop++) {
    const missing = new Set();
    for (const [p, d] of docs) {
      if (!p.startsWith('turnos/') && !p.startsWith('convocatorias_cobertura/')) continue;
      for (const f of LINK_FIELDS) {
        const id = d[f];
        if (typeof id === 'string' && id && !docs.has(`turnos/${id}`)) missing.add(id);
      }
    }
    if (missing.size === 0) break;
    for (const id of missing) put(await db.collection('turnos').doc(id).get());
  }

  for (const ids of chunk(shiftPaths().map((p) => p.split('/')[1]), 30)) {
    const aus = await db.collection('ausencias').where('shiftId', 'in', ids).get();
    aus.docs.forEach(put);
    const nov = await db.collection('novedades').where('shiftId', 'in', ids).get();
    nov.docs.forEach(put);
  }

  const slas = await db.collection('servicios_sla').where('objectiveId', '==', objectiveId).get();
  slas.docs.forEach(put);

  const sesiones = await db.collection('sesiones_operador').where('empresaId', '==', empresaId).get();
  sesiones.docs
    .filter((d) => {
      const data = d.data();
      const a = tsMs(data.startedAt) ?? tsMs(data.createdAt);
      return a != null && a >= nearFromMs && a < toMs;
    })
    .forEach(put);

  const [y, m] = opts.date.split('-').map(Number);
  put(await db.collection('planificacion_estados').doc(`${objectiveId}_${y}_${m}`).get());
  put(await db.collection('planificacion_estados').doc(`${objectiveId}_${y}_${m - 1}`).get());

  const name = opts.name || `${slug(objectiveName)}-${opts.date}`;
  const payload = {
    meta: {
      name,
      exportedAt: new Date().toISOString(),
      sourceProject: PROD_PROJECT,
      empresaId,
      clientId,
      objectiveId,
      objectiveName,
      date: opts.date,
      lookbackDays: lookback,
      extraShiftIds: opts.shift,
    },
    docs: Object.fromEntries(docs),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));

  const byCollection = {};
  for (const p of docs.keys()) {
    const col = p.split('/')[0];
    byCollection[col] = (byCollection[col] || 0) + 1;
  }
  console.log(`\nSnapshot ${name} → ${path.relative(process.cwd(), outFile)}`);
  console.log(`Empresa ${empresaId} · Objetivo ${objectiveName} (${objectiveId}) · Cliente ${clientId}`);
  console.log('Docs por colección:', byCollection);
  printShiftTable(payload);
}

function printShiftTable(payload) {
  const rows = Object.entries(payload.docs)
    .filter(([p]) => p.startsWith('turnos/'))
    .map(([p, d]) => ({ id: p.split('/')[1], ...d }))
    .sort((a, b) => (tsMs(a.startTime) ?? 0) - (tsMs(b.startTime) ?? 0));
  console.log(`\nTurnos (${rows.length}; "+" = otro objetivo):`);
  for (const d of rows) {
    const flags = [
      d.objectiveId === payload.meta.objectiveId ? '' : `+${String(d.objectiveName || d.objectiveId || '').slice(0, 20)}`,
      d.status,
      d.isPresent ? 'PRES' : '',
      d.isAbsent ? 'AUS' : '',
      d.isCompleted ? 'COMP' : '',
      d.isRetention ? 'RET!' : '',
      d.origin || '',
      d.completionReason || '',
    ].filter(Boolean).join(' ');
    console.log(
      `  ${d.id.padEnd(28)} ${String(d.code || '').padEnd(4)} ${fmtAr(tsMs(d.startTime))}→${fmtAr(tsMs(d.endTime))}`
      + `  real ${fmtAr(tsMs(d.realStartTime))}→${fmtAr(tsMs(d.realEndTime))}`
      + `  ${String(d.employeeName || d.employeeId || '').slice(0, 26).padEnd(26)} ${flags}`,
    );
  }
}

async function runLoad(opts) {
  if (!opts.name && !opts.file) throw new Error('load requiere --name o --file');
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  if (!/^(127\.0\.0\.1|localhost|192\.168\.)/.test(host)) {
    throw new Error(`FIRESTORE_EMULATOR_HOST=${host} no parece un emulador; abortado.`);
  }
  process.env.FIRESTORE_EMULATOR_HOST = host;
  const projectId = opts.project || DEFAULT_LOAD_PROJECT;
  if (projectId === PROD_PROJECT && opts['allow-lab-project'] !== 'true') {
    throw new Error(`Cargar en ${PROD_PROJECT} pisaría el lab; usá --project ${DEFAULT_LOAD_PROJECT} o --allow-lab-project.`);
  }
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const file = opts.file || path.join(OUT_DIR, `${opts.name}.json`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Object.entries(payload.docs);
  for (const part of chunk(entries, 400)) {
    const batch = db.batch();
    for (const [p, data] of part) batch.set(db.doc(p), deserialize(data, db));
    await batch.commit();
  }
  console.log(`Cargados ${entries.length} docs de ${payload.meta.name} en emulador ${host} (proyecto ${projectId}).`);
  printShiftTable(payload);
}

export async function loadCaseIntoDb(db, name) {
  const payload = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${name}.json`), 'utf8'));
  const entries = Object.entries(payload.docs);
  for (const part of chunk(entries, 400)) {
    const batch = db.batch();
    for (const [p, data] of part) batch.set(db.doc(p), deserialize(data, db));
    await batch.commit();
  }
  return payload.meta;
}

export function caseFileExists(name) {
  return fs.existsSync(path.join(OUT_DIR, `${name}.json`));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const fn = opts.cmd === 'export' ? runExport : opts.cmd === 'load' ? runLoad : null;
  if (!fn) {
    console.log('Uso: node scripts/cc-caso-real-snapshot.mjs export|load [opciones] (ver cabecera)');
    process.exit(1);
  }
  fn(opts).then(
    () => process.exit(0),
    (e) => {
      console.error(e.message || e);
      process.exit(1);
    },
  );
}
