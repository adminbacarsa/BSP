/**
 * Analiza Excel de marcaciones vs objetivos CRM y legajos.
 * Uso: node scripts/analyze-marcaciones-julio.js "C:/Users/Mauro/Downloads/Mauro- Julio LOL.xlsx"
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '../apps/web2/node_modules/xlsx'));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const EXCEL = process.argv[2] || 'C:/Users/Mauro/Downloads/Mauro- Julio LOL.xlsx';
const YEAR = 2026;
const MONTH = 7; // julio

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}
const db = getFirestore();

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseNombre(raw) {
  const s = String(raw || '');
  const m = s.match(/^(.+?)DNI:(\d+)/i);
  return m ? { name: m[1].trim(), dni: m[2] } : { name: s.trim(), dni: '' };
}

function parseFechaHora(fechaRaw, horaRaw) {
  const fecha = String(fechaRaw || '').trim();
  const hora = String(horaRaw || '').trim();
  const m = fecha.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const [hh, mi, ss] = hora.split(':').map(Number);
  if (!Number.isFinite(hh)) return null;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh, mi || 0, ss || 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ccostoToObjectiveHint(cc) {
  let s = String(cc || '').trim();
  s = s.replace(/^SP\s*-\s*/i, '').replace(/^BACAR SA\s*-\s*/i, '');
  s = s.replace(/^Casisa\s+/i, 'CASISA ');
  return norm(s);
}

function scoreMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t) && t.length > 2) inter++;
  const union = new Set([...ta, ...tb]).size;
  return Math.round((inter / union) * 100);
}

function bestObjectiveForCc(cc, objectives) {
  const hint = ccostoToObjectiveHint(cc);
  let best = null;
  for (const o of objectives) {
    const candidates = [o.name, o.nombre, o.displayName, o.alias].filter(Boolean);
    for (const c of candidates) {
      const sc = scoreMatch(hint, c);
      if (!best || sc > best.score) best = { ...o, score: sc, matchedOn: c };
    }
    const sc2 = scoreMatch(hint, cc);
    if (!best || sc2 > best.score) best = { ...o, score: sc2, matchedOn: cc };
  }
  return best;
}

async function loadObjectives() {
  const snap = await db.collection('clients').where('status', '==', 'ACTIVE').get();
  const objectives = [];
  const byClient = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const clientName = data.name || data.razonSocial || doc.id;
    const objs = Array.isArray(data.objetivos) ? data.objetivos : [];
    for (const o of objs) {
      if (!o || o.status === 'INACTIVE') continue;
      const row = {
        clientId: doc.id,
        clientName,
        objectiveId: o.id || o.objectiveId,
        name: o.name || o.nombre || o.displayName || '',
        empresaId: data.empresaId || o.empresaId || '',
      };
      objectives.push(row);
    }
    byClient.set(doc.id, { name: clientName, count: objs.length });
  }
  return { objectives, byClient, clients: snap.size };
}

async function loadEmpleados() {
  const snap = await db.collection('empleados').get();
  const byDni = new Map();
  const byId = new Map();
  for (const doc of snap.docs) {
    const d = doc.data();
    const status = String(d.status || d.estado || 'active').toLowerCase();
    const row = {
      id: doc.id,
      dni: String(d.dni || d.document || '').replace(/\D/g, ''),
      name: `${d.firstName || d.nombre || ''} ${d.lastName || d.apellido || ''}`.trim() || d.name || '',
      status,
      empresaId: d.empresaId || '',
      fileNumber: String(d.fileNumber || d.legajo || ''),
    };
    byId.set(doc.id, row);
    if (row.dni) {
      const prev = byDni.get(row.dni);
      if (!prev || (prev.status.includes('inactiv') && !status.includes('inactiv'))) {
        byDni.set(row.dni, row);
      }
    }
  }
  return { byDni, byId, total: snap.size };
}

async function sampleTurnoMatch(empId, objectiveId, dayStart, dayEnd) {
  const q = await db.collection('turnos')
    .where('employeeId', '==', empId)
    .where('objectiveId', '==', objectiveId)
    .where('startTime', '>=', dayStart)
    .where('startTime', '<', dayEnd)
    .limit(5)
    .get();
  return q.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function main() {
  console.log('Leyendo', EXCEL);
  const wb = XLSX.readFile(EXCEL);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log('Marcaciones Excel:', rows.length);

  const [{ objectives, clients }, emps] = await Promise.all([loadObjectives(), loadEmpleados()]);
  console.log('Clientes ACTIVE:', clients, '| Objetivos:', objectives.length, '| Empleados:', emps.total);

  const ccMap = new Map();
  const dniMissing = new Set();
  const dniFound = new Set();
  const parsed = [];

  for (const r of rows) {
    const { dni, name } = parseNombre(r.Nombre);
    const cc = String(r.CCosto || '').trim();
    const entrada = parseFechaHora(r['Fecha entrada'], r.Entrada);
    const salida = parseFechaHora(r['Fecha salida'], r.Salida);
    if (!ccMap.has(cc)) ccMap.set(cc, { count: 0, hint: ccostoToObjectiveHint(cc), best: null });
    ccMap.get(cc).count += 1;
    const emp = dni ? emps.byDni.get(dni) : null;
    if (dni) (emp ? dniFound : dniMissing).add(dni);
    parsed.push({ dni, name, cc, entrada, salida, empId: emp?.id || null });
  }

  for (const [cc, info] of ccMap) {
    info.best = bestObjectiveForCc(cc, objectives);
  }

  const ccSorted = [...ccMap.entries()].sort((a, b) => b[1].count - a[1].count);
  const high = ccSorted.filter(([, i]) => i.best && i.best.score >= 80);
  const mid = ccSorted.filter(([, i]) => i.best && i.best.score >= 50 && i.best.score < 80);
  const low = ccSorted.filter(([, i]) => !i.best || i.best.score < 50);

  console.log('\n=== EMPLEADOS ===');
  console.log('DNI únicos Excel:', dniFound.size + dniMissing.size);
  console.log('DNI encontrados en empleados:', dniFound.size);
  console.log('DNI sin legajo:', dniMissing.size);
  if (dniMissing.size && dniMissing.size <= 30) {
    console.log('  ', [...dniMissing].join(', '));
  }

  console.log('\n=== CENTROS DE COSTO → OBJETIVOS (auto-match) ===');
  console.log('Match alto (≥80):', high.length, '/', ccMap.size);
  console.log('Match medio (50-79):', mid.length);
  console.log('Match bajo (<50):', low.length);

  console.log('\n--- Match alto ---');
  high.slice(0, 25).forEach(([cc, info]) => {
    console.log(`${info.count}x [${info.best.score}] "${cc}" → ${info.best.clientName} / ${info.best.name} (${info.best.objectiveId})`);
  });

  console.log('\n--- Requieren revisión manual ---');
  [...mid, ...low].slice(0, 30).forEach(([cc, info]) => {
    const b = info.best;
    console.log(`${info.count}x [${b?.score || 0}] "${cc}" → ${b ? `${b.clientName} / ${b.name}` : 'SIN MATCH'}`);
  });

  let matchPlan = 0;
  let noEmp = 0;
  let noObj = 0;
  let noTurno = 0;
  let alreadyFichado = 0;
  const samples = [];
  const SAMPLE = Math.min(parsed.length, 400);

  for (let idx = 0; idx < SAMPLE; idx++) {
    const p = parsed[idx];
    if (!p.empId) { noEmp++; continue; }
    const info = ccMap.get(p.cc)?.best;
    if (!info || info.score < 70) { noObj++; continue; }
    if (!p.entrada) continue;
    const dayStart = new Date(p.entrada);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const turnos = await sampleTurnoMatch(p.empId, info.best.objectiveId, dayStart, dayEnd);
    if (!turnos.length) { noTurno++; continue; }
    const t = turnos[0];
    const fichado = !!(t.realStartTime || t.checkInTime || t.isPresent);
    if (fichado) alreadyFichado++;
    else matchPlan++;
    if (samples.length < 8 && !fichado) {
      samples.push({ dni: p.dni, cc: p.cc, obj: info.best.name, turnoId: t.id, code: t.code || t.type });
    }
  }

  const scale = parsed.length / SAMPLE;
  console.log('\n=== MATCH MARCACIÓN → TURNO PLANIFICADO (muestra', SAMPLE, 'filas, score obj ≥70) ===');
  console.log('Proyección importables:', Math.round(matchPlan * scale));
  console.log('Proyección ya fichados:', Math.round(alreadyFichado * scale));
  console.log('Muestra sin legajo:', noEmp, '→ ~', Math.round(noEmp * scale));
  console.log('Muestra sin objetivo confiable:', noObj, '→ ~', Math.round(noObj * scale));
  console.log('Muestra sin turno planificado:', noTurno, '→ ~', Math.round(noTurno * scale));
  console.log('\nMuestras importables:');
  samples.forEach(s => console.log(JSON.stringify(s)));
}

main().catch(e => { console.error(e); process.exit(1); });
