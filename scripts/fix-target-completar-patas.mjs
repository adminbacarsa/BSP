/**
 * Completa la extensión o el adelanto que falta en licencias marcadas «Cubierto split» (opción A, OK de Mauro 09/10).
 * Toma de la nota del titular quién extiende y quién adelanta, busca su turno contiguo al hueco en el mismo objetivo
 * y escribe los mismos campos que deja el planificador (coverageSegmentRole, segmento, coversDateStr…).
 * No cambia horarios ni toca turnos que no encuentre con certeza: esos se listan para revisar a mano.
 *
 *   node scripts/fix-target-completar-patas.mjs --empresa bacarsa --mes 2026-07            (dry-run)
 *   node scripts/fix-target-completar-patas.mjs --empresa bacarsa --mes 2026-07 --apply --allow-prod
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? String(process.argv[i + 1] || '').trim() : ''; };
const empresaId = arg('--empresa');
const mes = arg('--mes');
const apply = process.argv.includes('--apply');
if (!empresaId || !/^\d{4}-\d{2}$/.test(mes)) { console.error('Uso: --empresa X --mes YYYY-MM [--apply --allow-prod]'); process.exit(1); }
if (apply && !process.argv.includes('--allow-prod')) { console.error('--apply escribe en prod: agregá --allow-prod'); process.exit(1); }

admin.initializeApp({ projectId: 'comtroldata' });
const db = admin.firestore();

const AR = 3 * 3600e3;
const ms = (v) => (v?.toMillis ? v.toMillis() : 0);
const hmAr = (v) => { const t = ms(v); return t ? new Date(t - AR).toISOString().slice(11, 16) : ''; };
const ymdAr = (v) => { const t = ms(v); return t ? new Date(t - AR).toISOString().slice(0, 10) : ''; };
const diaDe = (r) => String(r.scheduleDate || '').slice(0, 10) || ymdAr(r.startTime);
const sumaDia = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd + n)); return t.toISOString().slice(0, 10); };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const apellido = (s) => norm(s).split(/[ ,]+/)[0];
// Hora AR de un día → epoch ms. El fin del tramo cae al día siguiente si cruza la medianoche.
const instante = (dia, hm) => Date.parse(`${dia}T${hm}:00-03:00`);
const instanteFin = (dia, de, a) => instante(dia, a) + (a <= de ? 86400e3 : 0);

const [y, m] = mes.split('-').map(Number);
const desde = new Date(Date.UTC(y, m - 1, 1) - 2 * 86400e3);
const hasta = new Date(Date.UTC(y, m, 1) + 2 * 86400e3);
const snap = await db.collection('turnos').where('empresaId', '==', empresaId)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(desde))
  .where('startTime', '<', admin.firestore.Timestamp.fromDate(hasta)).get();
const rows = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((r) => !r.isDeleted);
const empSnap = await db.collection('empleados').where('empresaId', '==', empresaId).get();
const nombreEmp = new Map(empSnap.docs.map((d) => { const e = d.data(); return [d.id, e.name || [e.lastName, e.firstName].filter(Boolean).join(' ') || '']; }));
for (const r of rows) if (!r.employeeName) r.employeeName = nombreEmp.get(r.employeeId) || '';

const rol = (r) => String(r.coverageSegmentRole || '').toUpperCase();
const esExt = (r) => rol(r) === 'EXTENSION' || (rol(r) !== 'EARLY_START' && r.isExtended === true && r.isEarlyStart !== true);
const esAdel = (r) => rol(r) === 'EARLY_START' || (rol(r) !== 'EXTENSION' && r.isEarlyStart === true && r.isExtended !== true);
const RE = /Cubierto split · (.+?) ext (\d{2}:\d{2})-(\d{2}:\d{2}) \+ (.+?) adel (\d{2}:\d{2})-(\d{2}:\d{2})/i;

const targets = rows.filter((r) => diaDe(r).startsWith(mes) && RE.test(`${r.coverageNote || ''} ${r.coveredBy || ''}`));
const plan = [];
const revisar = [];

for (const t of targets) {
  const dia = diaDe(t);
  const [, extNom, extDe, extA, adelNom, adelDe, adelA] = `${t.coverageNote || ''} ${t.coveredBy || ''}`.match(RE);
  const pkg = t.coveragePackageId || null;
  // Mismo criterio que scripts/fix-target-sin-patas.mjs (acredita).
  const legs = rows.filter((r) => {
    if (!(esExt(r) || esAdel(r))) return false;
    if (pkg && r.coveragePackageId) return r.coveragePackageId === pkg;
    const explicito = String(r.coversDateStr || '').slice(0, 10);
    if (explicito && explicito !== dia) return false;
    if (!explicito && ![dia, sumaDia(dia, -1), sumaDia(dia, 1)].includes(diaDe(r))) return false;
    if (r.coversEmployeeId && r.coversEmployeeId !== t.employeeId) return false;
    return r.objectiveId === t.objectiveId;
  });
  const banda = String(t.coversBandCode || t.originalCode || '').toUpperCase() || null;
  const pos = t.coversPositionName || t.originalPositionName || t.positionName || null;
  const titular = apellido(t.employeeName);
  const tareas = [
    { tipo: 'ext', falta: !legs.some(esExt), nombre: extNom, de: extDe, a: extA, dias: [dia, sumaDia(dia, -1)] },
    { tipo: 'adel', falta: !legs.some(esAdel), nombre: adelNom, de: adelDe, a: adelA, dias: [dia, sumaDia(dia, 1)] },
  ];
  for (const k of tareas) {
    if (!k.falta) continue;
    const ape = apellido(k.nombre);
    const cand = rows.filter((r) => r.objectiveId === t.objectiveId && r.employeeId !== t.employeeId
      && apellido(r.employeeName) === ape && k.dias.includes(diaDe(r))
      && !esExt(r) && !esAdel(r)
      && (k.tipo === 'ext' ? ms(r.endTime) === instante(dia, k.de) : ms(r.startTime) === instanteFin(dia, k.de, k.a)));
    const ctx = `${dia} · ${t.employeeName} · ${t.objectiveName || t.objectiveId} · ${k.tipo === 'ext' ? 'extensión' : 'adelanto'} de ${k.nombre} ${k.de}-${k.a}`;
    if (cand.length !== 1) { revisar.push(`${ctx} → ${cand.length ? `${cand.length} turnos posibles` : 'no encontré su turno contiguo'}`); continue; }
    const s = cand[0];
    const sPos = s.positionName || pos || 'General';
    const nota = k.tipo === 'ext'
      ? `Ext ${pos || sPos} ${k.de}-${k.a} · cubre ${titular}`
      : `Adel ${k.de}-${k.a} · ${pos || sPos} · cubre ${titular}`;
    const horas = Math.round(((Number(k.a.slice(0, 2)) * 60 + Number(k.a.slice(3)) - Number(k.de.slice(0, 2)) * 60 - Number(k.de.slice(3)) + 1440) % 1440) / 6) / 10;
    const patch = {
      isExtended: k.tipo === 'ext',
      isEarlyStart: k.tipo === 'adel',
      coverageType: 'ABSENCE_COVERAGE',
      coverageSegmentRole: k.tipo === 'ext' ? 'EXTENSION' : 'EARLY_START',
      coverageNote: nota,
      comments: nota,
      coverageStatus: 'COVERED',
      coverageMode: 'SPLIT',
      coversEmployeeId: t.employeeId,
      coversPositionName: pos,
      coversBandCode: banda,
      coversDateStr: dia,
      segmentFromTime: k.de,
      segmentToTime: k.a,
      extExtraHours: horas,
      ...(pkg ? { coveragePackageId: pkg } : {}),
      ...(k.tipo === 'ext' ? { extensionEndTime: k.a } : {}),
      fixCompletarPatasAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    plan.push({ ctx, turno: `${s.employeeName} ${s.code} ${diaDe(s)} ${hmAr(s.startTime)}-${hmAr(s.endTime)}`, ref: s.ref, id: s.id, patch });
  }
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${empresaId} ${mes}: ${targets.length} licencias split, ${plan.length} partes a completar, ${revisar.length} para revisar a mano`);
for (const p of plan) console.log(`  + ${p.ctx}\n      → ${p.turno} [${p.id}]`);
if (revisar.length) { console.log('Revisar a mano:'); for (const r of revisar) console.log(`  ? ${r}`); }

if (apply && plan.length) {
  let n = 0;
  for (const p of plan) {
    await p.ref.update(p.patch);
    await db.collection('audit_logs').add({
      action: 'FIX_COMPLETAR_PATA_COBERTURA', empresaId, turnoId: p.id, detalle: p.ctx,
      motivo: 'Licencia marcada cubierta sin su extensión/adelanto (opción A, OK de Mauro 09/10)',
      actor: 'script fix-target-completar-patas', timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    n++;
  }
  console.log(`Escritos: ${n}`);
}
process.exit(0);
