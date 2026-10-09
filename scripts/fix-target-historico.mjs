/**
 * Opción B (OK de Mauro 09/10): licencias marcadas «Cubierto split» a las que les falta la extensión o el adelanto
 * y que no se pueden completar con certeza dejan de figurar como cubiertas. Quedan como cobertura no registrada
 * (histórico). No toca horas de nadie: las partes que sí existen quedan como están.
 *
 *   node scripts/fix-target-historico.mjs --empresa bacarsa --mes 2026-07            (dry-run)
 *   node scripts/fix-target-historico.mjs --empresa bacarsa --mes 2026-07 --apply --allow-prod
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? String(process.argv[i + 1] || '').trim() : ''; };
const empresaId = arg('--empresa');
const mes = arg('--mes');
const apply = process.argv.includes('--apply');
// --ids a,b,c: limita a esos turnos (lo aprobado); sin --ids lista todo.
const soloIds = new Set(arg('--ids').split(',').map((x) => x.trim()).filter(Boolean));
if (!empresaId || !/^\d{4}-\d{2}$/.test(mes)) { console.error('Uso: --empresa X --mes YYYY-MM [--apply --allow-prod]'); process.exit(1); }
if (apply && !process.argv.includes('--allow-prod')) { console.error('--apply escribe en prod: agregá --allow-prod'); process.exit(1); }

admin.initializeApp({ projectId: 'comtroldata' });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const AR = 3 * 3600e3;
const ms = (v) => (v?.toMillis ? v.toMillis() : 0);
const ymdAr = (v) => { const t = ms(v); return t ? new Date(t - AR).toISOString().slice(0, 10) : ''; };
const diaDe = (r) => String(r.scheduleDate || '').slice(0, 10) || ymdAr(r.startTime);
const sumaDia = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };

const [y, m] = mes.split('-').map(Number);
const snap = await db.collection('turnos').where('empresaId', '==', empresaId)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, 1) - 2 * 86400e3)))
  .where('startTime', '<', admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m, 1) + 2 * 86400e3))).get();
const rows = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((r) => !r.isDeleted);
const empSnap = await db.collection('empleados').where('empresaId', '==', empresaId).get();
const nombre = new Map(empSnap.docs.map((d) => [d.id, d.data().name || '']));

const rol = (r) => String(r.coverageSegmentRole || '').toUpperCase();
const esExt = (r) => rol(r) === 'EXTENSION' || (rol(r) !== 'EARLY_START' && r.isExtended === true && r.isEarlyStart !== true);
const esAdel = (r) => rol(r) === 'EARLY_START' || (rol(r) !== 'EXTENSION' && r.isEarlyStart === true && r.isExtended !== true);
const notaDe = (r) => `${r.coverageNote || ''} ${r.coveredBy || ''}`;
// Mismo criterio de «target split» y de patas que scripts/fix-target-sin-patas.mjs.
const esTarget = (r) => {
  if (/cubierto split/i.test(notaDe(r))) return true;
  if (rol(r) !== 'TARGET') return false;
  const tipo = String(r.coverageType || '').toLowerCase();
  if (tipo === 'substitute') return false;
  return tipo === 'split' || /\bext\b/i.test(notaDe(r));
};

const plan = [];
for (const t of rows.filter((r) => diaDe(r).startsWith(mes) && esTarget(r) && (!soloIds.size || soloIds.has(r.id)))) {
  const dia = diaDe(t);
  const pkg = t.coveragePackageId || null;
  const legs = rows.filter((r) => {
    if (!(esExt(r) || esAdel(r))) return false;
    if (pkg && r.coveragePackageId) return r.coveragePackageId === pkg;
    const explicito = String(r.coversDateStr || '').slice(0, 10);
    if (explicito && explicito !== dia) return false;
    if (!explicito && ![dia, sumaDia(dia, -1), sumaDia(dia, 1)].includes(diaDe(r))) return false;
    if (r.coversEmployeeId && r.coversEmployeeId !== t.employeeId) return false;
    return r.objectiveId === t.objectiveId;
  });
  const soloExt = /extensi[oó]n sola|solo ext/i.test(notaDe(t));
  const soloAdel = /adelanto solo|solo adel/i.test(notaDe(t));
  const faltaExt = !soloAdel && !legs.some(esExt);
  const faltaAdel = !soloExt && !legs.some(esAdel);
  if (!faltaExt && !faltaAdel) continue;
  const parcial = legs.length > 0;
  const nota = String(t.coverageNote || t.coveredBy || '');
  plan.push({
    t, ref: t.ref, id: t.id,
    texto: `${dia} · ${nombre.get(t.employeeId) || t.employeeId} · ${t.code} · ${parcial ? 'parcial (quedan las partes que existen)' : 'sin partes'} · «${nota.slice(0, 90)}»`,
    patch: {
      coverageStatus: parcial ? 'PARTIAL' : FieldValue.delete(),
      coverageSegmentRole: FieldValue.delete(),
      coveredBy: null,
      coverageNote: `Cobertura no registrada (histórico)${parcial ? ' · parcial' : ''}. Nota original: ${nota}`.slice(0, 300),
      coverageNoteOriginal: nota,
      coberturaNoRegistrada: true,
      fixTargetHistoricoAt: FieldValue.serverTimestamp(),
    },
  });
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${empresaId} ${mes}: ${plan.length} licencias dejan de figurar cubiertas`);
for (const p of plan) console.log(`  - ${p.texto} [${p.id}]`);

if (apply && plan.length) {
  for (const p of plan) {
    await p.ref.update(p.patch);
    await db.collection('audit_logs').add({
      action: 'FIX_TARGET_HISTORICO', empresaId, turnoId: p.id, detalle: p.texto,
      motivo: 'Licencia marcada cubierta sin su extensión/adelanto; no se puede completar con certeza (opción B, OK de Mauro 09/10)',
      actor: 'script fix-target-historico', timestamp: FieldValue.serverTimestamp(),
    });
  }
  console.log(`Escritos: ${plan.length}`);
}
process.exit(0);
