#!/usr/bin/env node
/** Lista clientes/objetivos/SLA activos en emulador para autoplanificar. */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const y = new Date().getFullYear();
const m = String(new Date().getMonth() + 1).padStart(2, '0');
const monthStart = `${y}-${m}-01`;
const monthEnd = `${y}-${m}-31`;

const clientsSnap = await db.collection('clients').get();
const slaSnap = await db.collection('servicios_sla').where('active', '==', true).get();
const empsSnap = await db.collection('empleados').where('empresaId', '==', 'bacarsa').get();

console.log(`\n=== Emulador Firestore — mes ${y}-${m} ===\n`);
console.log(`Clientes: ${clientsSnap.size}`);
console.log(`SLA activos: ${slaSnap.size}`);
console.log(`Empleados bacarsa: ${empsSnap.size}\n`);

const slasByObj = new Map();
for (const d of slaSnap.docs) {
  const s = d.data();
  const from = String(s.effectiveFrom || '').slice(0, 10);
  const to = String(s.effectiveTo || '9999-12-31').slice(0, 10);
  const vigente = from <= monthEnd && to >= monthStart;
  if (!vigente) continue;
  const key = `${s.clientId || '?'}::${s.objectiveId || '?'}`;
  slasByObj.set(key, { id: d.id, hours: s.totalMonthlyHours, from, to, positions: s.positions?.length || 0 });
}

for (const d of clientsSnap.docs) {
  const c = d.data();
  const objs = c.objetivos || [];
  console.log(`CLIENTE: ${c.name || d.id} (${d.id}) empresa=${c.empresaId || '?'}`);
  for (const o of objs) {
    const oid = o.id || o.name;
    const key = `${d.id}::${oid}`;
    const sla = slasByObj.get(key);
    const active = o.active !== false && o.status !== 'INACTIVE';
    const emps = empsSnap.docs.filter((e) => {
      const ed = e.data();
      return ed.preferredObjectiveId === oid || ed.preferredObjectiveId === d.id;
    }).length;
    console.log(`  └ objetivo: ${o.name || oid} (${oid}) activo=${active} empleados_pref=${emps} SLA=${sla ? `${sla.hours}h vig ${sla.from}→${sla.to}` : 'SIN SLA VIGENTE'}`);
  }
  console.log('');
}
