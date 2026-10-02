/**
 * CRONOGRAMA_SIN_PUBLICAR de objetivos SIN SLA vigente (auditor?a 01/10: 38 de 41 avisos eran de
 * contratos cerrados de meses anteriores). Las marca ATENDIDA (no borra). SOLO LECTURA por defecto.
 *
 * Criterio: el objetivo no tiene ning?n `servicios_sla` que cubra el d?a avisado (`dayYmd`; si falta,
 * alg?n d?a del `mesKey`) ? mismo universo que `slaDayCoverage` (activo o cerrado con vigencia que
 * incluye el d?a) ? o su cliente est? inactivo.
 *
 *   node scripts/fix-cronograma-sin-publicar-sin-sla.mjs                 # pruebas_sa, dryRun
 *   node scripts/fix-cronograma-sin-publicar-sin-sla.mjs --empresa=bacarsa
 *   node scripts/fix-cronograma-sin-publicar-sin-sla.mjs --apply --allow-prod
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');
const empresaId = (args.find((a) => a.startsWith('--empresa=')) || '--empresa=pruebas_sa').split('=')[1];
const FIX_TAG = 'fix-cronograma-sin-publicar-sin-sla';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const ymdOf = (v) => {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.trim().slice(0, 10);
  if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const slaActive = (status) => {
  const st = String(status ?? '').trim().toLowerCase();
  return !st || (st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado');
};
const clientActive = (c) => {
  if (!c) return true;
  if (c.active === false) return false;
  const u = String(c.status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
};
/** ?Alg?n SLA del objetivo cubre ese d?a (y su cliente est? activo)? */
const slaCubre = (slas, clients, ymd) => slas.some((s) => {
  if (!slaActive(s.status)) return false;
  const start = ymdOf(s.startDate) || '1970-01-01';
  const end = ymdOf(s.endDate) || '2099-12-31';
  if (!ymdOf(s.startDate) && !ymdOf(s.endDate)) return false;
  if (!(ymd >= start && ymd <= end)) return false;
  const cid = String(s.clientId || '').trim();
  return !cid || !clients.has(cid) || clientActive(clients.get(cid));
});
const diasDelMes = (mesKey) => {
  const [y, m] = mesKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${mesKey}-${String(i + 1).padStart(2, '0')}`);
};

const [slaSnap, cliSnap, novSnap] = await Promise.all([
  db.collection('servicios_sla').where('empresaId', '==', empresaId).get(),
  db.collection('clients').where('empresaId', '==', empresaId).get(),
  db.collection('novedades').where('empresaId', '==', empresaId).where('type', '==', 'CRONOGRAMA_SIN_PUBLICAR').get(),
]);
const slasByObj = new Map();
slaSnap.docs.forEach((d) => { const s = d.data(); const oid = String(s.objectiveId || '').trim(); if (!oid) return; if (!slasByObj.has(oid)) slasByObj.set(oid, []); slasByObj.get(oid).push(s); });
const clients = new Map(cliSnap.docs.map((d) => [d.id, d.data()]));

console.log(`${empresaId}: ${novSnap.size} novedades CRONOGRAMA_SIN_PUBLICAR, ${slaSnap.size} SLA, ${cliSnap.size} clientes`);
const patches = [];
let yaVistas = 0;
let conSla = 0;
for (const d of novSnap.docs) {
  const n = d.data();
  const oid = String(n.objectiveId || '').trim();
  const dayYmd = String(n.dayYmd || '').trim();
  const mesKey = String(n.mesKey || dayYmd.slice(0, 7) || '').trim();
  const dias = dayYmd ? [dayYmd] : (mesKey ? diasDelMes(mesKey) : []);
  const slas = slasByObj.get(oid) || [];
  const tieneSla = dias.some((ymd) => slaCubre(slas, clients, ymd));
  const vista = String(n.status || '').toUpperCase() === 'ATENDIDA';
  const tag = tieneSla ? 'SLA ' : (vista ? 'VIST' : 'FIX ');
  console.log(`${tag} ${d.id} | ${(n.objectiveName || oid).slice(0, 32).padEnd(32)} | ${dayYmd || mesKey} | ${n.status} | slas=${slas.length}`);
  if (tieneSla) { conSla += 1; continue; }
  if (vista) { yaVistas += 1; continue; }
  patches.push({
    id: d.id,
    label: `${n.objectiveName || oid} ${dayYmd || mesKey} ? ATENDIDA (sin SLA vigente)`,
    patch: {
      status: 'ATENDIDA',
      atendidaAt: FieldValue.serverTimestamp(),
      atendidaPor: FIX_TAG,
      descartadaMotivo: 'SIN_SLA_VIGENTE',
      correctedBy: FIX_TAG,
      correctionNote: 'Objetivo sin SLA vigente en el d?a avisado (o cliente inactivo): no hay cronograma que publicar.',
    },
  });
}

console.log(`\ncon SLA vigente (se dejan): ${conSla} ? sin SLA ya vistas: ${yaVistas} ? parches: ${patches.length}`);
for (const p of patches) console.log(`DRY novedades/${p.id} ? ${p.label}`);

if (!apply) {
  console.log('dryRun: no se escribi? nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribi?.');
  process.exit(1);
}
for (const p of patches) await db.collection('novedades').doc(p.id).update(p.patch);
console.log(`apply ${patches.length}`);
