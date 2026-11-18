/**
 * Turno cortado (dos horarios del mismo turno) guardado antes de que la grilla escribiera `blocks`:
 * quedó con solo el primer tramo y las horas del reloj (ej. GPS 11:30–14:00 = 2,5 h en vez de 6,5 h).
 * Completa `blocks` y `hours` (suma de los tramos) con lo que define el servicio del mes.
 *
 * Solo toca turnos de trabajo cuyo inicio coincide con el primer tramo del servicio. Saltea francos,
 * borrados, extensiones, adelantos, coberturas y los que ya tienen `blocks`.
 * Sin --apply solo lista. Escribir en prod pide --apply --allow-prod.
 *
 *   node scripts/completar-turno-cortado.mjs --empresa pruebas_sa --desde 2026-10-01 --hasta 2026-12-31
 *   node scripts/completar-turno-cortado.mjs --empresa bacarsa --objetivos "General Paz" --apply --allow-prod
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
const DESDE = leer('--desde', '2026-01-01');
const HASTA = leer('--hasta', '2026-12-31');
const FILTRO = String(leer('--objetivos', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const APPLY = args.includes('--apply');
const EMULADOR = !!process.env.FIRESTORE_EMULATOR_HOST;
if (APPLY && !EMULADOR && !args.includes('--allow-prod')) {
  console.log('Escribir en prod pide --apply --allow-prod.');
  process.exit(1);
}

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const up = (s) => String(s ?? '').trim().toUpperCase();
const TZ = 'America/Argentina/Cordoba';

function ymd(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(v.toDate());
  }
  return '';
}
function hhmmLocal(v) {
  const d = v && typeof v.toDate === 'function' ? v.toDate() : null;
  if (!d) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function minutos(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function horasDeBloques(blocks) {
  let min = 0;
  for (const b of blocks) {
    const a = minutos(b.startTime);
    const z = minutos(b.endTime);
    if (a == null || z == null) return 0;
    let d = z - a;
    if (d <= 0) d += 24 * 60;
    min += d;
  }
  return Math.round((min / 60) * 100) / 100;
}
function listaPuestos(sla) {
  const raw = sla.positions;
  return (Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : [])).filter((p) => p && typeof p === 'object');
}
function bloquesValidos(shift) {
  const raw = shift?.blocks;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = raw.map((b) => ({ startTime: String(b?.startTime || '').slice(0, 5), endTime: String(b?.endTime || '').slice(0, 5) }));
  if (out.some((b) => minutos(b.startTime) == null || minutos(b.endTime) == null)) return null;
  return out;
}

if (EMULADOR) admin.initializeApp({ projectId: 'comtroldata' });
else admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const clientes = await db.collection('clients').where('empresaId', '==', EMPRESA).get();
const nombreObj = new Map();
for (const d of clientes.docs) {
  for (const o of d.data().objetivos || []) {
    const id = String(o.id || o.name || '');
    if (id) nombreObj.set(id, o.name || id);
  }
}
const elegido = (objId) => !FILTRO.length || FILTRO.some((f) => norm(nombreObj.get(objId) || objId).includes(f));
console.log(`${EMULADOR ? '[EMULADOR] ' : ''}empresa ${EMPRESA} · ${DESDE} → ${HASTA}${FILTRO.length ? ` · objetivos: ${FILTRO.join(', ')}` : ''}`);

// SLA del mes por objetivo: puesto + código → tramos
const slas = await db.collection('servicios_sla').where('empresaId', '==', EMPRESA).get();
const defs = [];
for (const d of slas.docs) {
  const data = d.data();
  if (['INACTIVE', 'INACTIVO', 'DELETED'].includes(String(data.status || '').toUpperCase())) continue;
  const objId = String(data.objectiveId || '');
  if (!objId || !elegido(objId)) continue;
  const ini = ymd(data.startDate) || '0000-01-01';
  const fin = ymd(data.endDate) || '9999-12-31';
  if (ini > HASTA || fin < DESDE) continue;
  for (const p of listaPuestos(data)) {
    const puesto = String(p.name || p.positionName || '').trim();
    for (const s of (p.allowedShiftTypes || p.shifts || [])) {
      const blocks = bloquesValidos(s);
      if (!blocks || !s.code) continue;
      defs.push({ objId, puesto: norm(puesto), code: up(s.code), ini, fin, blocks });
    }
  }
}
console.log(`códigos de turno cortado en servicios del período: ${defs.length}`);
if (!defs.length) process.exit(0);

const snap = await db.collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(new Date(`${DESDE}T00:00:00-03:00`)))
  .where('startTime', '<=', admin.firestore.Timestamp.fromDate(new Date(`${HASTA}T23:59:59-03:00`)))
  .get();

const cambios = [];
const saltados = new Map();
const saltar = (motivo) => saltados.set(motivo, (saltados.get(motivo) || 0) + 1);
let yaOk = 0;
let segundoDoc = 0;

for (const doc of snap.docs) {
  const t = doc.data();
  if (t.isDeleted === true || t.isFranco === true) continue;
  const objId = String(t.objectiveId || '');
  if (!elegido(objId)) continue;
  const code = up(t.code);
  const dia = String(t.scheduleDate || ymd(t.startTime));
  const def = defs.find((x) => x.objId === objId && x.code === code && x.puesto === norm(t.positionName) && x.ini <= dia && x.fin >= dia);
  if (!def) continue;
  if (t.isSecondBlock === true) { segundoDoc += 1; continue; }
  if (Array.isArray(t.blocks) && t.blocks.length >= 2) { yaOk += 1; continue; }
  if (t.isExtended === true || t.isEarlyStart === true || t.extExtraHours || t.adjustedStartTime || t.adjustedEndTime) { saltar('con extensión o adelanto'); continue; }
  if (t.coverageMode || t.coversEmployeeId || t.coveragePackageId || t.isReten === true) { saltar('cobertura o retén'); continue; }
  if (hhmmLocal(t.startTime) !== def.blocks[0].startTime) { saltar('el inicio no coincide con el primer tramo del servicio'); continue; }
  cambios.push({
    ref: doc.ref,
    objetivo: nombreObj.get(objId) || objId,
    dia,
    code,
    empleado: t.employeeName || t.employeeId,
    antes: Number(t.hours) || null,
    blocks: def.blocks,
    hours: horasDeBloques(def.blocks),
  });
}

console.log(`turnos revisados: ${snap.size} · ya con blocks: ${yaOk} · a completar: ${cambios.length}`);
if (segundoDoc) console.log(`  aviso: ${segundoDoc} turno(s) con isSecondBlock (el motor viejo partía en dos documentos); no se tocan.`);
for (const [m, n] of saltados) console.log(`  salteados ${n}: ${m}`);
for (const c of cambios.slice(0, 40)) {
  console.log(`  ${c.objetivo} · ${c.dia} · ${c.code} · ${c.empleado} · ${c.antes ?? 'reloj'} h → ${c.hours} h (${c.blocks.map((b) => `${b.startTime}–${b.endTime}`).join(' + ')})`);
}
if (cambios.length > 40) console.log(`  … y ${cambios.length - 40} más`);

if (!APPLY) {
  console.log(`Sin --apply: no se escribió nada. Se actualizarían ${cambios.length} turno(s).`);
  process.exit(0);
}
let hechos = 0;
for (let i = 0; i < cambios.length; i += 400) {
  const batch = db.batch();
  for (const c of cambios.slice(i, i + 400)) batch.update(c.ref, { blocks: c.blocks, hours: c.hours });
  await batch.commit();
  hechos += Math.min(400, cambios.length - i);
}
console.log(`Actualizados ${hechos} turno(s).`);
