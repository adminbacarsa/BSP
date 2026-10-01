/**
 * CRONOGRAMA_SIN_PUBLICAR — auditoría SOLO LECTURA por defecto.
 * Cuenta las novedades por empresa, agrupa por objetivo-mes y detecta duplicados
 * (el cron viejo creaba una por objetivo y DÍA: crono_sin_pub_{emp}_{obj}_{yyyy-mm-dd}).
 *
 *   node scripts/audit-cronograma-sin-publicar.mjs                 (empresa pruebas_sa)
 *   node scripts/audit-cronograma-sin-publicar.mjs --empresa X
 *   node scripts/audit-cronograma-sin-publicar.mjs --apply --allow-prod
 *
 * --apply: deja UNA por objetivo-mes (la más reciente, con el status más conservador:
 * si alguna sigue PENDIENTE queda PENDIENTE) y marca las demás como ATENDIDA
 * (atendidaPor 'Sistema', resolution 'DUPLICADO_OBJETIVO_MES'). No borra documentos.
 * Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const empresaArg = args.indexOf('--empresa');
const EMPRESA_ID = empresaArg >= 0 ? args[empresaArg + 1] : 'pruebas_sa';
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const vista = (s) => ['ATENDIDA', 'atendida'].includes(String(s || ''));
const mesDe = (d) => {
  if (d.mesKey) return String(d.mesKey);
  const ymd = String(d.dayYmd || '');
  return /^\d{4}-\d{2}/.test(ymd) ? ymd.slice(0, 7) : '?';
};
const fecha = (ts) => (ts?.toDate ? ts.toDate().toISOString().slice(0, 16) : '-');

const snap = await db.collection('novedades')
  .where('empresaId', '==', EMPRESA_ID)
  .where('type', '==', 'CRONOGRAMA_SIN_PUBLICAR')
  .get();
const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const pendientes = rows.filter((r) => !vista(r.status));
console.log(`empresa ${EMPRESA_ID}: ${rows.length} CRONOGRAMA_SIN_PUBLICAR (${pendientes.length} pendientes, ${rows.length - pendientes.length} vistas)`);

const grupos = new Map();
for (const r of rows) {
  const key = `${String(r.objectiveId || '?')}|${mesDe(r)}`;
  if (!grupos.has(key)) grupos.set(key, []);
  grupos.get(key).push(r);
}
const dup = [...grupos.entries()].filter(([, list]) => list.length > 1);
console.log(`objetivo-mes distintos: ${grupos.size} · con duplicados: ${dup.length}`);
for (const [key, list] of [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const [oid, mes] = key.split('|');
  const name = list[0].objectiveName || oid;
  const pend = list.filter((r) => !vista(r.status)).length;
  console.log(`  ${mes} ${name} (${oid}): ${list.length} docs · ${pend} pendientes · días ${list.map((r) => String(r.dayYmd || '').slice(8)).sort().join(',')}`);
}

const plan = [];
for (const [, list] of dup) {
  list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const [keep, ...rest] = list;
  const algunaPendiente = list.some((r) => !vista(r.status));
  plan.push({ keep: keep.id, keepStatus: algunaPendiente ? 'PENDIENTE' : keep.status, rest: rest.map((r) => r.id) });
}
const aMarcar = plan.reduce((acc, p) => acc + p.rest.length, 0);
console.log(`\nplan: conservar ${plan.length} · marcar ATENDIDA (duplicado) ${aMarcar}`);
for (const p of plan.slice(0, 20)) console.log(`  keep ${p.keep} [${p.keepStatus}] ← ${p.rest.length} dup (${fecha(rows.find((r) => r.id === p.rest[0])?.createdAt)}…)`);

if (!apply) {
  console.log('dryRun: no se escribió nada.');
  process.exit(0);
}
if (!allowProd) {
  console.error('Falta --allow-prod. No se escribió.');
  process.exit(1);
}
let batch = db.batch();
let n = 0;
for (const p of plan) {
  if (p.keepStatus === 'PENDIENTE') batch.update(db.collection('novedades').doc(p.keep), { status: 'PENDIENTE' });
  for (const id of p.rest) {
    batch.update(db.collection('novedades').doc(id), {
      status: 'ATENDIDA',
      atendidaAt: admin.firestore.FieldValue.serverTimestamp(),
      atendidaPor: 'Sistema',
      resolution: 'DUPLICADO_OBJETIVO_MES',
    });
    n += 1;
    if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
}
await batch.commit();
console.log(`listo: ${n} duplicados marcados como vistos.`);
