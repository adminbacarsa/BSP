/**
 * Clientes copiados entre empresas guardan un campo `id` viejo que, al leerse con
 * `{ id: d.id, ...d.data() }`, pisa el id real del documento. Deja `id` = id del doc
 * y corrige los servicios que quedaron con ese id viejo como `clientId`.
 *
 * Por defecto solo muestra (dry-run). Escribir: --apply --allow-prod (solo con OK de Mauro).
 */
import admin from 'firebase-admin';

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--allow-prod')) {
  console.error('Para escribir hace falta --apply --allow-prod.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const clientes = await db.collection('clients').get();
const ids = new Set(clientes.docs.map((d) => d.id));
const porViejoYEmpresa = new Map();
const clientesMal = [];
for (const d of clientes.docs) {
  const v = d.data();
  if (v.id && v.id !== d.id) {
    clientesMal.push({ ref: d.ref, id: d.id, viejo: v.id, empresaId: v.empresaId, name: v.name });
    porViejoYEmpresa.set(`${v.id}|${v.empresaId}`, d.id);
  }
}
console.log(`Clientes con campo id viejo: ${clientesMal.length} de ${clientes.size}`);
for (const c of clientesMal) console.log(`  ${c.empresaId} · ${c.name}: id ${c.viejo} → ${c.id}`);

const slas = await db.collection('servicios_sla').get();
const slasMal = [];
for (const d of slas.docs) {
  const x = d.data();
  if (!x.clientId || ids.has(x.clientId)) continue;
  const real = porViejoYEmpresa.get(`${x.clientId}|${x.empresaId}`);
  slasMal.push({ ref: d.ref, id: d.id, x, real });
}
console.log(`\nServicios con cliente inexistente: ${slasMal.length}`);
for (const s of slasMal) {
  console.log(`  ${s.id} ${s.x.empresaId} · ${s.x.clientName} · ${s.x.objectiveName} ${String(s.x.startDate).slice(0, 10)}: clientId ${s.x.clientId} → ${s.real || 'SIN PAREJA (no se toca)'}`);
}

if (!apply) {
  console.log('\nDry-run: no se escribió nada.');
  process.exit(0);
}
const batch = db.batch();
for (const c of clientesMal) batch.update(c.ref, { id: c.id, idAnterior: c.viejo });
for (const s of slasMal) if (s.real) batch.update(s.ref, { clientId: s.real });
batch.set(db.collection('audit_logs').doc(), {
  timestamp: admin.firestore.FieldValue.serverTimestamp(),
  actorUid: 'SCRIPT',
  actorName: 'fix-clients-id-viejo',
  action: 'FIX_CLIENT_ID',
  module: 'CRM',
  details: `Alineó el campo id de ${clientesMal.length} clientes y el clientId de ${slasMal.filter((s) => s.real).length} servicios`,
});
await batch.commit();
console.log('\nListo.');
