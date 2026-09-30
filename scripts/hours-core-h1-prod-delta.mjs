/**
 * H1 — delta de solo lectura contra PRODUCCIÓN.
 *
 * Ciclo CCT 26→25 (default 2026-09 = 26/08→25/09). No escribe Firestore
 * ni toca hoursCoreEnabled en el documento de la empresa: el flag ON se
 * simula en memoria sobre el submódulo flag.js.
 *
 * Tres totales para la empresa objetivo:
 *   - Reportes legacy: motor F0 (el que corre el hook con el flag OFF = producción actual)
 *   - Reportes core: buildPersonaBook (flag ON simulado, mismo fetch que la pantalla)
 *   - payrollApi core: buildLiquidacionSnapshot con el flag forzado ON
 * Reportes core y payrollApi core se comparan por legajo (hs reales).
 *
 *   node scripts/hours-core-h1-prod-delta.mjs [--empresa pruebas_sa] [--cycle 2026-09]
 *
 * Salida: scripts/out/ (gitignored).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const FT_CAP = 12 + 59 / 60;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

function installWriteGuard() {
  const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
  const deny = (what) => function denied() {
    throw new Error(`[hours-core-h1-delta] escritura bloqueada (${what})`);
  };
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(`doc.${m}`);
  CollectionReference.prototype.add = deny('collection.add');
  WriteBatch.prototype.commit = deny('batch.commit');
  Firestore.prototype.runTransaction = deny('runTransaction');
  Firestore.prototype.recursiveDelete = deny('recursiveDelete');
}

function resolveFlagModule() {
  const entry = requireFn.resolve('@cosp/hours-core');
  return requireFn(path.join(path.dirname(entry), 'flag.js'));
}

function resolveF0() {
  const entry = requireFn.resolve('@cosp/hours-core');
  return requireFn(path.join(path.dirname(entry), 'motors', 'legacy', 'reportesLiquidationF0.js'));
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (arr) => round2(arr.reduce((s, n) => s + (Number(n) || 0), 0));

function inst(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d && !isNaN(d.getTime()) ? d : null;
  }
  const sec = v.seconds ?? v._seconds;
  if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isDemoShift(s) {
  const origin = String(s?.origin || '').toUpperCase();
  return origin === 'AUTO_DEMO' || !!s?.modoDemoAt;
}

function maskFromId(employeeId, legajoById) {
  const legajo = String(legajoById.get(employeeId) || '').trim();
  if (legajo) return `L${legajo.slice(-3).padStart(3, '0')}`;
  const id = String(employeeId || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `E${String(h % 1000).padStart(3, '0')}`;
}

/** Reportes legacy: mismo armado que useReportes con el flag OFF (motor F0). */
function reportesLegacyByEmployee(f0, turnos, ctx) {
  const { empNameById, publishStatusMap, holidays } = ctx;
  const usePlannedHours = false;
  const ftShiftIds = new Set();
  const allByEmp = {};
  for (const s of turnos) {
    if (!s.employeeId) continue;
    (allByEmp[s.employeeId] ||= []).push(s);
  }
  for (const empShifts of Object.values(allByEmp)) {
    f0.propagateFrancoTrabajadoFlags(empShifts, { usePlannedHours }).forEach((s) => {
      if (s.isFrancoTrabajado || s._inferredFrancoTrabajado) ftShiftIds.add(s.id);
    });
  }
  const raw = turnos.filter((d) => f0.isShiftEligibleForReports(d, publishStatusMap, 'all'));
  const groups = {};
  for (const s of raw) {
    if (!s.employeeId || !empNameById[s.employeeId]) continue;
    const row = ftShiftIds.has(s.id)
      ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || 'FT' }
      : s;
    (groups[s.employeeId] ||= []).push(row);
  }
  const out = new Map();
  for (const [employeeId, group] of Object.entries(groups)) {
    const prepared = f0.prepareShiftsForEmployeeLiquidation(
      f0.dedupeShiftsByAbsencePriority(
        f0.propagateFrancoTrabajadoFlags(group, { usePlannedHours }),
        { usePlannedHours },
      ),
    );
    const stats = f0.calculateLiquidationHoursStats(prepared, holidays, { usePlannedHours });
    out.set(employeeId, stats?.horasReales || 0);
  }
  return out;
}

function isTramo(t) {
  if (!t) return false;
  if (t.isExtended || t.isEarlyStart) return true;
  const role = String(t.coverageSegmentRole || '').toUpperCase();
  if (role === 'EXTENSION' || role === 'EARLY_START') return true;
  const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
  return Number.isFinite(ex) && ex > 0;
}

function overlaps(a, b) {
  const sa = inst(a.startTime);
  const ea = inst(a.endTime);
  const sb = inst(b.startTime);
  const eb = inst(b.endTime);
  if (!sa || !ea || !sb || !eb) return false;
  return sa.getTime() < eb.getTime() && sb.getTime() < ea.getTime();
}

function shouldMerge(a, b) {
  return overlaps(a, b) || isTramo(a) || isTramo(b);
}

function clustersOf(group) {
  const n = group.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMerge(group[i], group[j])) {
        const rx = find(i);
        const ry = find(j);
        if (rx !== ry) parent[rx] = ry;
      }
    }
  }
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (map.get(r) || map.set(r, []).get(r)).push(group[i]);
  }
  return [...map.values()];
}

function ymdAR(d) {
  const ar = new Date(d.getTime() - 3 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${ar.getUTCFullYear()}-${p(ar.getUTCMonth() + 1)}-${p(ar.getUTCDate())}`;
}

/** Horas que el clamp F0 (producción) vs F1 paga en un turno suelto, sin colapsar el día. */
function paySingle(s, which) {
  const ps = inst(s.startTime);
  const pe = inst(s.endTime);
  const rs = inst(s.realStartTime) || inst(s.checkInTime);
  const re = inst(s.realEndTime) || inst(s.checkOutTime);
  if (!ps || !pe || !rs || !re) return null;
  if (s.isAbsent === true) return null;
  const st = String(s.status || '').toLowerCase();
  if (st.includes('absent') || st.includes('ausent') || st.includes('cancel')) return null;
  if (pe.getTime() > Date.now()) return null;
  const early = s.isEarlyStart === true;
  const retention = s.isRetention === true || (s.retentionMinutes ?? 0) > 0;
  const relevo = !!(s.relievedBy || s.relievedByName);
  const spanH = (pe.getTime() - ps.getTime()) / 3600000;
  const isFT = s.isFrancoTrabajado === true || String(s.code || '').toUpperCase() === 'FT';
  const fullDay = isFT && spanH >= 23.5;
  let cs = rs;
  let ce = re;
  if (which === 'f0') {
    cs = early ? rs : ps;
    if (re < pe) ce = pe;
    else if (retention) ce = re;
    else ce = pe;
  } else {
    cs = early ? rs : (rs.getTime() > ps.getTime() ? rs : ps);
    if (re < pe) ce = relevo ? pe : re;
    else if (retention) ce = re;
    else ce = pe;
  }
  let h = Math.max(0, (ce.getTime() - cs.getTime()) / 3600000);
  if (fullDay && which === 'f1') h = Math.min(h, FT_CAP);
  else h = Math.min(h, 24);
  return h;
}

function pushCase(bucket, row) {
  bucket.rows.push(row);
  bucket.horas = round2(bucket.horas + row.horas);
  bucket.legajos.add(row.employeeId);
}

function emptySide() {
  return { horas: 0, legajos: new Set(), rows: [] };
}

function classifyDecisions(turnos, empNameById) {
  const sides = () => ({ real: emptySide(), demo: emptySide() });
  const d2 = sides();
  const d3 = sides();
  const d4 = sides();
  const d5 = sides();
  const byDay = new Map();
  for (const s of turnos) {
    if (!s.employeeId || !empNameById[s.employeeId]) continue;
    const start = inst(s.startTime);
    if (!start) continue;
    const key = `${s.employeeId}_${ymdAR(start)}`;
    (byDay.get(key) || byDay.set(key, []).get(key)).push(s);
  }

  for (const docs of byDay.values()) {
    if (docs.length >= 2) {
      const groups = clustersOf(docs);
      if (groups.length >= 2) {
        const paysF1 = groups.map((g) => {
          const h = paySingle(g[0], 'f1');
          return h == null ? 0 : h;
        });
        const paysF0 = docs.map((d) => paySingle(d, 'f0')).filter((h) => h != null);
        const f1 = paysF1.reduce((a, b) => a + b, 0);
        const f0 = paysF0.length ? Math.max(...paysF0) : 0;
        const horas = round2(f1 - f0);
        if (horas !== 0) {
          const demo = docs.every(isDemoShift);
          pushCase(demo ? d2.demo : d2.real, {
            employeeId: docs[0].employeeId,
            horas,
            turnos: docs.length,
            dia: ymdAR(inst(docs[0].startTime)),
          });
        }
      }
    }
    for (const s of docs) {
      const demo = isDemoShift(s);
      const ps = inst(s.startTime);
      const pe = inst(s.endTime);
      const rs = inst(s.realStartTime) || inst(s.checkInTime);
      const re = inst(s.realEndTime) || inst(s.checkOutTime);
      if (!ps || !pe || !rs || !re) continue;
      if (s.isAbsent === true) continue;
      const side3 = demo ? d3.demo : d3.real;
      const side4 = demo ? d4.demo : d4.real;
      const side5 = demo ? d5.demo : d5.real;
      const spanH = (pe.getTime() - ps.getTime()) / 3600000;
      const isFT = s.isFrancoTrabajado === true || String(s.code || '').toUpperCase() === 'FT';
      const fullDayFt = isFT && spanH >= 23.5;
      const retention = s.isRetention === true || (s.retentionMinutes ?? 0) > 0;
      const relevo = !!(s.relievedBy || s.relievedByName);
      if (!fullDayFt && !s.isEarlyStart && rs.getTime() > ps.getTime() + 60 * 1000) {
        const horas = round2((ps.getTime() - rs.getTime()) / 3600000);
        pushCase(side5, { employeeId: s.employeeId, horas, min: Math.round((rs - ps) / 60000) });
      }
      if (!fullDayFt && !retention && !relevo && re.getTime() < pe.getTime() - 60 * 1000) {
        const horas = round2((re.getTime() - pe.getTime()) / 3600000);
        pushCase(side3, { employeeId: s.employeeId, horas, min: Math.round((pe - re) / 60000) });
      }
      if (fullDayFt) {
        const f0 = paySingle(s, 'f0');
        const f1 = paySingle(s, 'f1');
        if (f0 != null && f1 != null) {
          const horas = round2(f1 - f0);
          if (horas !== 0) pushCase(side4, { employeeId: s.employeeId, horas });
        }
      }
    }
  }
  return { d2, d3, d4, d5 };
}

function packDecision(label, side, legajoById) {
  const top = [...side.rows].sort((a, b) => Math.abs(b.horas) - Math.abs(a.horas)).slice(0, 3);
  return {
    decision: label,
    horas: side.horas,
    legajos: side.legajos.size,
    ejemplos: top.map((r, i) => ({
      ejemplo: `${label}-${i + 1}`,
      legajo: maskFromId(r.employeeId, legajoById),
      horas: r.horas,
      ...(r.min != null ? { minutos: r.min } : {}),
      ...(r.turnos != null ? { turnosEnElDia: r.turnos } : {}),
    })),
  };
}

async function fetchTurnosLikeReportes(db, empresaId, scopeEmpresa, start, end) {
  const byId = new Map();
  // Meses calendario AR del rango (el ciclo cruza dos meses).
  const startAR = new Date(start.getTime() - 3 * 3600000);
  const endAR = new Date(end.getTime() - 3 * 3600000);
  const monthKeys = [];
  let y = startAR.getUTCFullYear();
  let m = startAR.getUTCMonth() + 1;
  const endY = endAR.getUTCFullYear();
  const endM = endAR.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    monthKeys.push({ y, m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  for (const { y: yy, m: mm } of monthKeys) {
    const monthStart = new Date(`${yy}-${String(mm).padStart(2, '0')}-01T00:00:00.000-03:00`);
    const next = mm === 12 ? new Date(`${yy + 1}-01-01T00:00:00.000-03:00`) : new Date(`${yy}-${String(mm + 1).padStart(2, '0')}-01T00:00:00.000-03:00`);
    const monthEnd = new Date(next.getTime() - 1);
    const from = monthStart < start ? start : monthStart;
    const to = monthEnd > end ? end : monthEnd;
    if (from > to) continue;
    let q = db.collection('turnos').where('startTime', '>=', admin.firestore.Timestamp.fromDate(from)).where('startTime', '<=', admin.firestore.Timestamp.fromDate(to));
    if (scopeEmpresa) q = q.where('empresaId', '==', empresaId);
    const snap = await q.get();
    snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  }
  return [...byId.values()];
}

function progress(file, line) {
  fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  process.stdout.write(`${line}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const empresaId = args.empresa || 'pruebas_sa';
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const prog = path.join(outDir, '_h1-delta-progress.log');
  fs.writeFileSync(prog, '');

  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.GCLOUD_PROJECT;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  installWriteGuard();
  const db = admin.firestore();

  const { buildLiquidacionSnapshot } = requireFn('./lib/payroll-api/calc.js');
  const { parseCycleId } = requireFn('./lib/payroll-api/cycle.js');
  const { resolveAssistantEmpresaScope, queryEmpleadosDocsScoped, belongsToEmpresaView } = requireFn('./lib/assistant/assistantEmpresaScope.js');
  const hours = requireFn('@cosp/hours-core');
  const f0 = resolveF0();
  const flagMod = resolveFlagModule();

  const cycleId = args.cycle || '2026-09';
  const cycle = parseCycleId(cycleId);
  if (!cycle) throw new Error(`cycleId inválido: ${cycleId}`);
  progress(prog, `ciclo ${cycle.cycleId} ${cycle.cycleStartStr} → ${cycle.cycleEndStr}`);

  const empresaSnap = await db.collection('empresas').doc(empresaId).get();
  const empresaData = empresaSnap.data() || {};
  const { scopeEmpresa, migracionCompleta } = await resolveAssistantEmpresaScope(db, empresaId);
  progress(prog, `empresa ${empresaId} scope=${scopeEmpresa} flagReal=${empresaData.hoursCoreEnabled === true} demo=${empresaData.modoDemoEnabled === true}`);

  const empDocs = await queryEmpleadosDocsScoped(db, empresaId, scopeEmpresa, 5000);
  const empNameById = {};
  const legajoById = new Map();
  empDocs.forEach((d) => {
    const data = d.data();
    if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
    const st = String(data.status || '').toLowerCase();
    if (st === 'inactive' || st === 'inactivo') return;
    empNameById[d.id] = hours.personaEmployeeDisplayName(data);
    legajoById.set(d.id, data.fileNumber || data.legajo || '');
  });

  const holidaysSnap = await db.collection('feriados').get();
  const holidays = {};
  holidaysSnap.forEach((d) => {
    const v = d.data()?.date;
    if (typeof v === 'string') holidays[v.slice(0, 10)] = true;
  });

  progress(prog, 'descargando turnos (mismo corte que Reportes: startTime por mes, empresa si hay scope)');
  const turnosAll = await fetchTurnosLikeReportes(db, empresaId, scopeEmpresa, cycle.cycleStart, cycle.cycleEnd);
  const turnos = turnosAll.filter((t) => {
    const hasPlanned = !!inst(t.startTime);
    const hasReal = !!inst(t.realStartTime);
    if (!hasPlanned && !hasReal) return false;
    return belongsToEmpresaView(t, empresaId, migracionCompleta);
  });
  const conFichada = turnos.filter((t) => inst(t.realStartTime) && inst(t.realEndTime)).length;
  progress(prog, `turnos=${turnos.length} conFichada=${conFichada} legajos=${Object.keys(empNameById).length}`);

  const ausSnap = await db.collection('ausencias').where('startDate', '<=', cycle.cycleEndStr).get();
  const ausencias = [];
  ausSnap.forEach((doc) => {
    const data = doc.data();
    if (!data || !belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
    const status = String(data.status || '').toUpperCase();
    if (status === 'PENDIENTE' || status === 'PENDING' || status === 'REJECTED' || status === 'RECHAZADA') return;
    ausencias.push({ id: doc.id, ...data });
  });

  const planifSnap = await db.collection('planificacion_estados').get();
  const publishStatusMap = hours.buildPersonaPublishStatusMap(
    planifSnap.docs.filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta)).map((d) => d.id),
  );

  const ctx = { empNameById, publishStatusMap, holidays };
  progress(prog, 'Reportes legacy (F0)');
  const legacyMap = reportesLegacyByEmployee(f0, turnos, ctx);
  const totalLegacy = sum([...legacyMap.values()]);
  if (totalLegacy === 0) {
    const sample = turnos.find((t) => t.realStartTime);
    const keys = sample ? Object.keys(sample.realStartTime || {}) : [];
    throw new Error(
      `Reportes legacy = 0 h con ${turnos.length} turnos y ${conFichada} fichadas. ` +
      `Timestamp de muestra: ${keys.join(',') || 'sin realStartTime'}. El fetch no está viendo las fichadas.`,
    );
  }

  progress(prog, 'Reportes core (buildPersonaBook)');
  const book = hours.buildPersonaBook({
    turnos,
    ausencias,
    publishStatusMap,
    rangeStartYmd: cycle.cycleStartStr,
    rangeEndYmd: cycle.cycleEndStr,
    empNameById,
    holidays,
    usePlannedHours: false,
    publishFilter: 'all',
  });
  const coreMap = new Map();
  for (const entry of book.employees) {
    const fig = hours.personaStatsToPayrollFigures(entry, 0);
    coreMap.set(entry.employeeId, fig.acumulado.hsReales);
  }
  const totalCore = sum([...coreMap.values()]);

  progress(prog, 'payrollApi core (flag ON en memoria)');
  const originalFn = flagMod.isHoursCoreEnabled;
  let payroll;
  let payrollFlagOff;
  try {
    flagMod.isHoursCoreEnabled = () => true;
    payroll = await buildLiquidacionSnapshot({ cycle, empresaId, page: 1, pageSize: 5000, hoursMode: 'real' });
    flagMod.isHoursCoreEnabled = () => false;
    payrollFlagOff = await buildLiquidacionSnapshot({ cycle, empresaId, page: 1, pageSize: 5000, hoursMode: 'real' });
  } finally {
    flagMod.isHoursCoreEnabled = originalFn;
  }
  const payrollMap = new Map(payroll.items.map((i) => [i.employee.id, i.acumulado?.hsReales || 0]));
  const totalPayroll = sum([...payrollMap.values()]);

  const ids = new Set([...coreMap.keys(), ...payrollMap.keys()]);
  let legajosDistintos = 0;
  const ejemplosDiff = [];
  for (const id of ids) {
    const a = round2(coreMap.get(id) || 0);
    const b = round2(payrollMap.get(id) || 0);
    if (a !== b) {
      legajosDistintos++;
      if (ejemplosDiff.length < 5) {
        ejemplosDiff.push({ legajo: maskFromId(id, legajoById), reportesCore: a, payrollApiCore: b });
      }
    }
  }

  // Comparación por legajo motor viejo (F0) vs hours-core: la suma total puede coincidir con compensaciones entre legajos.
  const idsLegacy = new Set([...legacyMap.keys(), ...coreMap.keys()]);
  const porLegajo = [];
  let legajosLegacyVsCoreDistintos = 0;
  for (const id of idsLegacy) {
    const legacy = round2(legacyMap.get(id) || 0);
    const core = round2(coreMap.get(id) || 0);
    const payrollH = round2(payrollMap.get(id) || 0);
    if (legacy === 0 && core === 0 && payrollH === 0) continue;
    if (legacy !== core) legajosLegacyVsCoreDistintos++;
    porLegajo.push({ legajo: maskFromId(id, legajoById), nombre: empNameById[id] || '', legacy, core, payrollApi: payrollH, deltaCoreMenosLegacy: round2(core - legacy) });
  }
  porLegajo.sort((a, b) => Math.abs(b.deltaCoreMenosLegacy) - Math.abs(a.deltaCoreMenosLegacy) || b.core - a.core);
  const codigosConHoras = {};
  for (const t of turnos) {
    if (t.draft === true) continue;
    const code = String(t.shiftCode || t.code || t.shiftType || '').toUpperCase() || '(sin código)';
    codigosConHoras[code] = (codigosConHoras[code] || 0) + 1;
  }

  const classified = classifyDecisions(turnos, empNameById);
  const decisiones = {
    real: {
      decision2: packDecision('D2', classified.d2.real, legajoById),
      decision3: packDecision('D3', classified.d3.real, legajoById),
      decision4: packDecision('D4', classified.d4.real, legajoById),
      decision5: packDecision('D5', classified.d5.real, legajoById),
    },
    demo: {
      decision2: packDecision('D2', classified.d2.demo, legajoById),
      decision3: packDecision('D3', classified.d3.demo, legajoById),
      decision4: packDecision('D4', classified.d4.demo, legajoById),
      decision5: packDecision('D5', classified.d5.demo, legajoById),
    },
  };

  const flagOffReal = empresaData.hoursCoreEnabled !== true && payrollFlagOff.diagnostics?.hoursCoreEnabled !== true;
  const report = {
    generatedAt: new Date().toISOString(),
    cycle: { id: cycle.cycleId, start: cycle.cycleStartStr, end: cycle.cycleEndStr },
    empresaId,
    modoDemoEnabled: empresaData.modoDemoEnabled === true,
    hoursCoreEnabledReal: empresaData.hoursCoreEnabled === true,
    turnos: turnos.length,
    turnosConFichada: conFichada,
    totales: {
      reportesLegacy: totalLegacy,
      reportesCore: totalCore,
      payrollApiCore: totalPayroll,
      deltaCoreMenosLegacy: round2(totalCore - totalLegacy),
    },
    reportesCoreVsPayrollApi: {
      legajosConDiferencia: legajosDistintos,
      ejemplos: ejemplosDiff,
    },
    legacyVsCore: {
      legajosConHoras: porLegajo.length,
      legajosConDiferencia: legajosLegacyVsCoreDistintos,
      turnosNoBorradorPorCodigo: codigosConHoras,
      porLegajo,
    },
    decisiones,
    flagOff: {
      diferenciaContraProduccionActualHoras: flagOffReal ? 0 : null,
      nota: flagOffReal
        ? 'hoursCoreEnabled real es false: Reportes sigue en el motor F0 (calculateStatsExact) y payrollApi no entra a buildLiquidacionSnapshotPersona. Diferencia contra producción actual = 0 h.'
        : 'La empresa ya tiene el flag real en true: no se puede afirmar 0 h contra producción.',
    },
  };

  const outFile = path.join(outDir, `hours-core-h1-prod-delta-${empresaId}-${cycle.cycleId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  progress(prog, `legacy=${totalLegacy} core=${totalCore} payroll=${totalPayroll} legajosDistintos=${legajosDistintos}`);
  progress(prog, `archivo ${outFile}`);
  console.log(JSON.stringify({
    totales: report.totales,
    legajosDistintos,
    decisionesReales: {
      d2: decisiones.real.decision2,
      d3: decisiones.real.decision3,
      d4: decisiones.real.decision4,
      d5: decisiones.real.decision5,
    },
    demo: {
      d2: decisiones.demo.decision2.horas,
      d3: decisiones.demo.decision3.horas,
      d4: decisiones.demo.decision4.horas,
      d5: decisiones.demo.decision5.horas,
    },
    flagOff: report.flagOff.diferenciaContraProduccionActualHoras,
  }, null, 2));
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
