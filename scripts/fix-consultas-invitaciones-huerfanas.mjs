/**
 * Invitaciones que siguieron abiertas después de que la consulta cerró.
 * SOLO LECTURA por defecto. No manda push ni mail.
 *
 *   node scripts/fix-consultas-invitaciones-huerfanas.mjs
 *   node scripts/fix-consultas-invitaciones-huerfanas.mjs --empresa pruebas_sa
 *   node scripts/fix-consultas-invitaciones-huerfanas.mjs --apply --allow-prod --empresa pruebas_sa
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { cierreDeConsulta, invitacionHayQueCerrarla } from '../apps/web2/src/lib/eventuales/consultaDisponibilidad.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : 'pruebas_sa';

if (apply && !allowProd) {
  console.error('Para escribir hace falta --apply --allow-prod');
  process.exit(1);
}
if (!empresaId) {
  console.error('Falta --empresa');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const INV = 'consultas_disponibilidad_invitaciones';
const COL = 'consultas_disponibilidad';

const invSnap = await db.collection(INV).where('empresaId', '==', empresaId).get();
const padres = new Map();
const planes = [];

for (const doc of invSnap.docs) {
  const data = doc.data() || {};
  if (!invitacionHayQueCerrarla(data.estado)) continue;
  const consultaId = String(data.consultaId || '');
  if (!consultaId) continue;
  if (!padres.has(consultaId)) {
    padres.set(consultaId, await db.collection(COL).doc(consultaId).get());
  }
  const parent = padres.get(consultaId);
  const status = parent.exists ? String(parent.data()?.status || '') : '';
  if (status === 'ABIERTA') continue;
  const plan = parent.exists
    ? cierreDeConsulta(status)
    : { estado: 'CANCELADA', motivo: 'Ya no hace falta, gracias' };
  if (!plan) continue;
  const vencePadre = Number(parent.data()?.venceAtMs || parent.data()?.venceAt?.toMillis?.() || 0);
  const vence = Number(data.venceAtMs || 0) > 0 ? Number(data.venceAtMs) : vencePadre;
  planes.push({
    ref: doc.ref,
    id: doc.id,
    consultaId,
    status: status || 'SIN_PADRE',
    antes: String(data.estado || ''),
    estado: plan.estado,
    motivo: plan.motivo,
    vence,
  });
}

const porEstado = {};
for (const p of planes) porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
console.log(`${apply ? 'APPLY' : 'DRY-RUN'} empresa=${empresaId} invitaciones=${invSnap.size} a_cerrar=${planes.length} ${JSON.stringify(porEstado)}`);
for (const p of planes.slice(0, 40)) {
  console.log(`${p.consultaId} ${p.status} ${p.id} ${p.antes} → ${p.estado}${p.vence ? '' : ' sin-vence'}`);
}
if (planes.length > 40) console.log(`… y ${planes.length - 40} más`);

if (!apply) {
  console.log('Nada escrito. Para aplicar: --apply --allow-prod');
  process.exit(0);
}

let escritos = 0;
for (let i = 0; i < planes.length; i += 400) {
  const batch = db.batch();
  for (const p of planes.slice(i, i + 400)) {
    const patch = {
      estado: p.estado,
      motivo: p.motivo,
      cerradaAt: FieldValue.serverTimestamp(),
    };
    if (p.vence > 0) patch.venceAtMs = p.vence;
    batch.update(p.ref, patch);
  }
  await batch.commit();
  escritos += Math.min(400, planes.length - i);
}
console.log(`Escritas ${escritos} invitaciones. Sin avisos.`);
